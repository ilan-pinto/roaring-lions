import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import type { ParityRow } from '../golden-diff/parity-bands';
import {
  CENSUS_RULES,
  G_BANDING_CEILING,
  P2_LAYERS,
  bandingOf,
  classifyCensus,
  gateTableP2,
  missingFiles,
  p2ParityRows,
  p2SheetHtml,
  parityTable,
  rebaseFiles,
  triangleDisagreements,
  type BandingCell,
  type CropId,
  type P2GateInputs,
} from './webgpu-p2-sheet-lib';

const W = 512;
const H = 200;
const CROPS = { penumbra: { x: 0, y: 0, w: W, h: H }, lit: { x: 0, y: 0, w: W, h: H } };
const framePng = (f: (x: number, y: number) => number): PNG => {
  const p = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = Math.max(0, Math.min(255, Math.round(f(x, y))));
      const i = (y * W + x) * 4;
      p.data[i] = p.data[i + 1] = p.data[i + 2] = v;
      p.data[i + 3] = 255;
    }
  return p;
};
const ramp = (x: number): number => 100 + (16 * x) / W;
/** The IGN-triangular dither the shipped output carries (two samples, +-1 LSB). */
const ign = (x: number, y: number): number => {
  const f = (v: number): number => v - Math.floor(v);
  return f(52.9829189 * f(0.06711056 * x + 0.00583715 * y));
};
const dithered = (x: number, y: number): number => ramp(x) + ign(x, y) + ign(y + 7, x + 3) - 1;

describe('bandingOf', () => {
  it('reads a quantised ramp as banded and the same ramp dithered far below it, per named crop', () => {
    const banded = bandingOf(framePng(ramp), CROPS);
    const dith = bandingOf(framePng(dithered), CROPS);
    for (const c of ['penumbra', 'lit'] as const) {
      expect('index' in banded[c] && (banded[c] as { index: number }).index).toBeGreaterThan(0.8);
      expect('index' in dith[c] && (dith[c] as { index: number }).index).toBeLessThan(G_BANDING_CEILING + 0.05);
    }
  });
  it('carries an empty mask as a REFUSAL, never as an index of 0', () => {
    const flat = bandingOf(framePng(() => 128), CROPS);
    expect('refused' in flat.penumbra).toBe(true);
  });
});

const cell = (v: number): Record<CropId, BandingCell> => ({ penumbra: { index: v, masked: 1000 }, lit: { index: v, masked: 1000 } });
const verdictOf = (g: P2GateInputs, item: RegExp): string | undefined => gateTableP2(g).find((r) => item.test(r.item))?.verdict;
const good: P2GateInputs = {
  sheetFrames: 22,
  expectedFrames: 22,
  sheetUnsettled: 0,
  abba: [
    { test: 'G', target: 300, ratio: 0.95, withinSpread: false, met: true },
    { test: 'G', target: 600, ratio: 1.0, withinSpread: false, met: true },
  ],
  triangles: [
    { zoom: 1, L: 1000, G: 1005 },
    { zoom: 2.5, L: 2000, G: 2000 },
  ],
  banding: { L: cell(0), G: cell(0.001), LS: cell(0) },
  census: { G: { expected: [{ kind: 'partial', key: 'rl-ground: wet terms', objects: 1, reason: 'wet' }], unexpected: [] } },
  wind: { L: 500, G: 480 },
  validationErrors: 0,
};

describe('gateTableP2 goes red on a constructed input', () => {
  it('passes the good inputs on every row', () => {
    expect(gateTableP2(good).every((r) => r.verdict === 'PASS')).toBe(true);
  });
  it('G over its ABBA bar, or missing at one of the two counts, is FAIL', () => {
    expect(verdictOf({ ...good, abba: [{ test: 'G', target: 300, ratio: 1.2, withinSpread: false, met: false }, good.abba[1] as never] }, /n300/)).toBe('FAIL');
    expect(verdictOf({ ...good, abba: [good.abba[0] as never] }, /n600/)).toBe('FAIL');
    expect(verdictOf({ ...good, abba: [] }, /n300/)).toBe('FAIL');
  });
  it('triangles: 1.5% off is FAIL, an L of 0 is FAIL (a failed reading is not an agreement), none is FAIL', () => {
    expect(verdictOf({ ...good, triangles: [{ zoom: 1, L: 1000, G: 1015 }] }, /triangle/)).toBe('FAIL');
    expect(verdictOf({ ...good, triangles: [{ zoom: 1, L: 0, G: 0 }] }, /triangle/)).toBe('FAIL');
    expect(verdictOf({ ...good, triangles: [] }, /triangle/)).toBe('FAIL');
    expect(triangleDisagreements([{ zoom: 1, L: 1000, G: 1010 }])).toHaveLength(0);
  });
  it('banding: G at the defect (0.636), a refusal, or no reading is FAIL', () => {
    expect(verdictOf({ ...good, banding: { G: cell(0.636) } }, /bandingIndex/)).toBe('FAIL');
    expect(verdictOf({ ...good, banding: { G: { penumbra: { refused: 'x' }, lit: { index: 0, masked: 1 } } } }, /bandingIndex/)).toBe('FAIL');
    expect(verdictOf({ ...good, banding: {} }, /bandingIndex/)).toBe('FAIL');
  });
  it('census: an unexpected entry is FAIL, and no census at all is FAIL', () => {
    const bad = { G: { expected: [], unexpected: [{ kind: 'shader-material', key: 'rl-selection-ring', objects: 3 }] } };
    expect(verdictOf({ ...good, census: bad }, /census G/)).toBe('FAIL');
    expect(verdictOf({ ...good, census: {} }, /census/)).toBe('FAIL');
  });
  it('wind that does not move, validation errors and a short frame count are FAIL', () => {
    expect(verdictOf({ ...good, wind: { L: 500, G: 0 } }, /wind/)).toBe('FAIL');
    expect(verdictOf({ ...good, wind: null }, /wind/)).toBe('FAIL');
    expect(verdictOf({ ...good, validationErrors: 1 }, /GPUValidation/)).toBe('FAIL');
    expect(verdictOf({ ...good, sheetFrames: 21 }, /sheet:/)).toBe('FAIL');
  });
});

describe('classifyCensus', () => {
  it('names the wet terms and the garrison banner, and calls a ported material that came back UNEXPECTED', () => {
    const v = classifyCensus([
      { kind: 'partial', key: 'rl-ground: wet terms', objects: 1 },
      { kind: 'on-before-compile', key: 'rl-garrison-banner', objects: 4 },
      { kind: 'shader-material', key: 'rl-selection-ring', objects: 3 },
      { kind: 'on-before-compile', key: 'rl-foliage-sway', objects: 9 },
    ]);
    expect(v.expected.map((e) => e.key)).toEqual(['rl-ground: wet terms', 'rl-garrison-banner']);
    expect(v.unexpected.map((e) => e.key)).toEqual(['rl-selection-ring', 'rl-foliage-sway']);
  });
  it('the P3/P4 entries read off the Metal census are expected, and only under their own kind', () => {
    const v = classifyCensus([
      { kind: 'shader-material', key: 'ShaderMaterial', objects: 30 },
      { kind: 'on-before-compile', key: 'BakedMaterial', objects: 25 },
      { kind: 'on-before-compile', key: 'backdrop-kit-lod1', objects: 1 },
      { kind: 'on-before-compile', key: 'rl-silhouette-outline', objects: 38 },
    ]);
    expect(v.unexpected).toHaveLength(0);
    // the same names under the wrong kind, and a ported ground that came back, are NOT expected
    const w = classifyCensus([
      { kind: 'on-before-compile', key: 'ShaderMaterial', objects: 1 },
      { kind: 'shader-material', key: 'BakedMaterial', objects: 1 },
      { kind: 'on-before-compile', key: 'rl-ground', objects: 1 },
    ]);
    expect(w.unexpected).toHaveLength(3);
  });
  it('every rule carries a reason that names a phase or a ruling', () => {
    for (const r of CENSUS_RULES) expect(r.reason).toMatch(/P\d|ruled|by design/);
  });
});

describe('the P2 parity table', () => {
  const row = (layer: string, r0: number | null, band: 'loose' | 'tight' = 'loose'): ParityRow => ({ scenario: 'quiet', layer, band, r0: { wgl2: r0, wgpu: r0 }, nodeFloor: { wgl2: null, wgpu: null }, note: '' });
  it('keeps only P2 layers (and only the quiet repaint-control), and flags an r0 outside its band', () => {
    const rows = p2ParityRows([row('roads', 0.72), row('bloom', 1), row('fog', 1), { ...row('repaint-control', 0), scenario: 'graded' }, row('repaint-control', 0)]);
    expect(rows.map((r) => r.layer)).toEqual(['roads', 'repaint-control']);
    expect(parityTable(rows).join('\n')).toContain('OUTSIDE');
    expect(parityTable([row('roads', 1)]).join('\n')).not.toContain('OUTSIDE');
    expect(parityTable([row('roads', null)]).join('\n')).toContain('unread');
  });
  it('names every P2 layer of the plan table', () => {
    expect(Object.keys(P2_LAYERS).sort()).toEqual(['disturb', 'height-contours', 'macro', 'repaint-control', 'roads', 'ground-albedo', 'selection-ring', 'slope-light', 'wash', 'wind'].sort());
  });
});

describe('p2SheetHtml', () => {
  it('says so for a frame the run did not capture', () => {
    expect(p2SheetHtml('t', [{ title: 's', rows: [[null, { caption: 'c', file: '/a/b.png' }]] }])).toMatch(/not captured in this run[\s\S]*b\.png/);
  });
  it('escapes a double quote in a filename, so it cannot close the src attribute', () => {
    const html = p2SheetHtml('t', [{ title: 's', rows: [[{ caption: 'a "q" <b>', file: '/d/x" onerror="alert(1).png' }]] }]);
    expect(html).toContain('<img src="x&quot; onerror=&quot;alert(1).png">');
    expect(html).not.toContain('onerror="');
    expect(html).toContain('a &quot;q&quot; &lt;b&gt;');
  });
});

describe('rebaseFiles (--report-only after the output directory moved)', () => {
  const rec = {
    startedAt: '/not/a/path/but-a-string',
    pages: [
      { arm: 'L', frames: [{ key: 'z1', png: '/old/run/frame-L-z1.png' }], minimap: '/old/run/minimap-L.png', banding: { flatPng: '/old/run/frame-L-z1-flat.png' }, wind: { on: { file: '/old/run/wind-L-on-diff.png', changed: 7 } } },
    ],
  };
  it('moves every stored frame path onto the new directory by base name, and leaves other strings and numbers alone', () => {
    const r = rebaseFiles(rec, '/new/dir');
    expect(r.pages[0]?.frames[0]?.png).toBe('/new/dir/frame-L-z1.png');
    expect(r.pages[0]?.minimap).toBe('/new/dir/minimap-L.png');
    expect(r.pages[0]?.banding.flatPng).toBe('/new/dir/frame-L-z1-flat.png');
    expect(r.pages[0]?.wind.on.file).toBe('/new/dir/wind-L-on-diff.png');
    expect(r.pages[0]?.wind.on.changed).toBe(7);
    expect(r.startedAt).toBe('/not/a/path/but-a-string');
  });
  it('returns a copy and does not touch the record it was given', () => {
    rebaseFiles(rec, '/new/dir');
    expect(rec.pages[0]?.frames[0]?.png).toBe('/old/run/frame-L-z1.png');
  });
});

describe('missingFiles (--report-only refuses a run directory with a PNG missing)', () => {
  const rec = { pages: [{ frames: [{ key: 'z1', png: '/d/frame-L-z1.png' }], minimap: '/d/minimap-L.png', wind: { on: { file: '/d/wind-L-on-diff.png', changed: 7 } } }] };
  it('lists exactly the recorded paths the disk lacks, wind difference included', () => {
    expect(missingFiles(rec, () => true)).toEqual([]);
    expect(missingFiles(rec, (f) => f !== '/d/wind-L-on-diff.png')).toEqual(['/d/wind-L-on-diff.png']);
    expect(missingFiles(rec, () => false)).toEqual(['/d/frame-L-z1.png', '/d/minimap-L.png', '/d/wind-L-on-diff.png']);
  });
});
