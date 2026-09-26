import { describe, expect, it } from 'vitest';
import { DECOR_GROVE, DECOR_KNOLL, DECOR_RIDGE, DECOR_ROAD } from './shared';
import type { TerrainInput } from './types';
import {
  buildControlMap, buildMacroField, CONTROL_TEXELS_PER_TILE as N, heightBiased, macroBlurTexels,
  macroFactor, MACRO_OCTAVES, MACRO_PERIOD_TILES, neutralTint, tileSurface,
} from './control-map';
import { boxBlur, fbm2 } from './noise';
import { roadDistanceAt, buildRoadGraph } from './road-graph';

/** '.' open, 'r' road, 'o' grove, 'n' knoll, '1'-'3' cover, '#' pad, '^' ridge. */
function map(rows: readonly string[]): TerrainInput {
  const height = rows.length;
  const width = rows[0].length;
  const decor = new Uint8Array(width * height);
  const blocked = new Uint8Array(width * height);
  const cover = new Uint8Array(width * height);
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      const i = y * width + x;
      if (c === 'r') decor[i] = DECOR_ROAD;
      if (c === 'o') { decor[i] = DECOR_GROVE; cover[i] = 1; }
      if (c === 'n') { decor[i] = DECOR_KNOLL; cover[i] = 2; }
      if (c >= '1' && c <= '3') cover[i] = Number(c);
      if (c === '#') blocked[i] = 1;
      if (c === '^') { blocked[i] = 1; decor[i] = DECOR_RIDGE; }
    })
  );
  return { width, height, decor, elevation: null, blocked, cover };
}
/** h rows of one symbol repeated w times. */
const fill = (w: number, h: number, c: string): string[] => Array.from({ length: h }, () => c.repeat(w));
/** h copies of one authored row. */
const rowsOf = (h: number, row: string): string[] => Array.from({ length: h }, () => row);
/** Channel `c` of texture `t` at the texel containing world (x, z). */
function at(cm: ReturnType<typeof buildControlMap>, t: 'a' | 'b', x: number, z: number, c: number): number {
  const i = Math.floor(x * N);
  const j = Math.floor(z * N);
  return cm[t][(j * cm.width + i) * 4 + c];
}
const OPEN = 0, ROCK = 1, SCRUB = 2, GROVE = 3; // control A
const KNOLL = 0, ROADD = 1, JUNCD = 2, BEND = 3; // control B

describe('tileSurface -- albedoFor\'s order, one decision', () => {
  const m = map(['^#ron123.']);
  it.each([
    [0, 'rock', 1], [1, 'pad', 0], [2, 'road', 1], [3, 'grove', 1], [4, 'knoll', 1],
    [5, 'scrub', 0.4], [6, 'scrub', 0.65], [7, 'scrub', 1], [8, 'open', 1],
  ])('tile %i is %s at %f', (x, kind, strength) => {
    expect(tileSurface(m, x, 0)).toEqual({ kind, strength });
  });
});

describe('buildControlMap', () => {
  it('is 8 texels a tile, RGBA each', () => {
    const cm = buildControlMap(map(fill(6, 4, '.')));
    expect([cm.width, cm.height]).toEqual([6 * N, 4 * N]);
    expect(cm.a.length).toBe(6 * N * 4 * N * 4);
    expect(cm.b.length).toBe(cm.a.length);
  });

  it('is pure open deep in open ground', () => {
    const cm = buildControlMap(map(fill(9, 9, '.')));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 4.5, 4.5, c))).toEqual([255, 0, 0, 0]);
    expect(at(cm, 'b', 4.5, 4.5, KNOLL)).toBe(0);
  });

  it('counts a road tile as open ground under the road', () => {
    const rows = fill(9, 9, '.');
    rows[4] = 'r'.repeat(9);
    const cm = buildControlMap(map(rows));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 4.44, 4.44, c))).toEqual([255, 0, 0, 0]);
  });

  // D1: the edge is 0.5 tile wide, NOT the plan's 1.5. A lone cover-1 tile's
  // core keeps its strength and nothing smears past 0.45 tile outside it.
  it('keeps a lone cover tile readable and does not smear it (D1)', () => {
    const rows = fill(9, 9, '.');
    rows[4] = '....1....';
    const cm = buildControlMap(map(rows));
    for (const x of [4.4375, 4.5625]) for (const z of [4.4375, 4.5625]) expect(at(cm, 'a', x, z, SCRUB)).toBeGreaterThanOrEqual(92);
    for (let j = 0; j < cm.height; j++)
      for (let i = 0; i < cm.width; i++) {
        const x = (i + 0.5) / N;
        const z = (j + 0.5) / N;
        // Per-axis reach is 0.25 (half band) + 0.2 (bend), so the bound is Chebyshev.
        const dx = Math.max(4 - x, 0, x - 5);
        const dz = Math.max(4 - z, 0, z - 5);
        if (Math.max(dx, dz) > 0.45) expect(cm.a[(j * cm.width + i) * 4 + SCRUB], `(${x}, ${z})`).toBe(0);
      }
  });

  it('centres the band on the tile edge, bent but never more than 0.45 tile off it', () => {
    const cm = buildControlMap(map(rowsOf(32, '......oooooo')));
    let midSum = 0;
    for (let j = 0; j < cm.height; j++) {
      const row = (x: number): number => cm.a[(j * cm.width + Math.floor(x * N)) * 4 + GROVE];
      expect(row(5.4)).toBe(0); // texel centre 5.4375: 0.5625 from the edge, past the 0.45 reach
      expect(row(6.6)).toBe(255); // texel centre 6.5625
      midSum += (row(5.9375) + row(6.0625)) / 2;
    }
    const mid = midSum / cm.height / 255;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it('keeps a pad hard and the open ground beside it fully textured (R-4)', () => {
    const cm = buildControlMap(map(rowsOf(3, '...#....')));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 3.5, 1.5, c))).toEqual([0, 0, 0, 0]);
    expect(at(cm, 'a', 2.9375, 1.5, OPEN)).toBe(255);
    expect(at(cm, 'a', 4.0625, 1.5, OPEN)).toBe(255);
  });

  it('keeps a ridge top pure rock and lays a 0.5-tile apron on the open side only', () => {
    const cm = buildControlMap(map(rowsOf(3, '....^^^^')));
    expect([0, 1, 2, 3].map((c) => at(cm, 'a', 4.0625, 1.5, c))).toEqual([0, 255, 0, 0]);
    expect(at(cm, 'a', 3.9375, 1.5, ROCK)).toBeGreaterThanOrEqual(102);
    expect(at(cm, 'a', 3.1875, 1.5, ROCK)).toBe(0);
    expect(at(cm, 'a', 3.1875, 1.5, OPEN)).toBe(255);
  });

  it('writes each cover tier at its own strength, and never draws a grove or knoll as scrub', () => {
    const cm = buildControlMap(map(rowsOf(4, '111222333oooonnnn')));
    expect(at(cm, 'a', 1.5, 1.5, SCRUB)).toBe(102);
    expect(at(cm, 'a', 4.5, 1.5, SCRUB)).toBe(166);
    expect(at(cm, 'a', 7.5, 1.5, SCRUB)).toBe(255);
    expect(at(cm, 'a', 10.5, 1.5, GROVE)).toBe(255);
    expect(at(cm, 'a', 10.5, 1.5, SCRUB)).toBe(0);
    expect(at(cm, 'b', 14.5, 1.5, KNOLL)).toBe(255);
    expect(at(cm, 'a', 14.5, 1.5, SCRUB)).toBe(0);
  });

  it('bakes the road distance, clamped at one tile', () => {
    const rows = fill(9, 9, '.');
    rows[4] = 'r'.repeat(9);
    const input = map(rows);
    const cm = buildControlMap(input);
    const g = buildRoadGraph(input);
    for (const [x, z] of [[4.5625, 4.5625], [2.0625, 4.8125], [3.3125, 5.0625]]) {
      const want = Math.round(Math.min(1, roadDistanceAt(g, x, z)) * 255);
      expect(at(cm, 'b', x, z, ROADD), `(${x}, ${z})`).toBe(want);
    }
    expect(at(cm, 'b', 4.5, 7.5, ROADD)).toBe(255);
    expect(at(cm, 'b', 4.5625, 4.5625, JUNCD)).toBe(255);
  });

  it('marks a crossroads in the junction channel', () => {
    const cm = buildControlMap(map(['.....', '..r..', '.rrr.', '..r..', '.....']));
    expect(at(cm, 'b', 2.5625, 2.5625, JUNCD)).toBeLessThanOrEqual(23);
  });

  it('bakes a signed edge bend that uses both halves of its byte', () => {
    const cm = buildControlMap(map(fill(16, 16, '.')));
    let lo = 255;
    let hi = 0;
    for (let k = BEND; k < cm.b.length; k += 4) {
      lo = Math.min(lo, cm.b[k]);
      hi = Math.max(hi, cm.b[k]);
    }
    expect(lo).toBeLessThan(100);
    expect(hi).toBeGreaterThan(156);
  });

  it('is deterministic', () => {
    const m = map(['..1o^#rn..', '.r..2..3..']);
    const a = buildControlMap(m);
    const b = buildControlMap(m);
    expect(Array.from(a.a)).toEqual(Array.from(b.a));
    expect(Array.from(a.b)).toEqual(Array.from(b.b));
  });
});

describe('heightBiased -- the 0.15 height blend', () => {
  it('leaves a tile interior (weights 0 or 1) exactly as it was', () => {
    expect(heightBiased([1, 0, 0], [0.3, -0.2, 0.1])).toEqual([1, 0, 0]);
    expect(heightBiased([0.4, 0, 0], [0.3, 0, 0])).toEqual([0.4, 0, 0]);
  });
  it('lets the brighter texel win inside the band, and preserves the total', () => {
    const w = heightBiased([0.5, 0.5], [0.4, -0.4]);
    expect(w[0]).toBeGreaterThan(0.5);
    expect(w[0] + w[1]).toBeCloseTo(1, 9);
  });
});

describe('the macro field', () => {
  const f = buildMacroField(48, 48);
  it('is 256 x 256 R8', () => {
    expect(f.size).toBe(256);
    expect(f.data.length).toBe(256 * 256);
  });
  // F-2: step 3 normalises by the field's own max|v|, so only ONE extreme is
  // guaranteed to reach the end of the range -- a prototype measured lo=1,
  // hi=240 BEFORE the F-13 border fade below is applied. F-13 then pulls
  // whichever texel carried that extreme back toward neutral if it happens
  // to fall inside the fade band -- measured, on this seed and map size, it
  // does: with the fade applied the same field reads lo=17, hi=224 (max
  // deviation 111). Both are genuine consequences of normalising by max|v|
  // and then fading the border, not a bug -- so the threshold below is
  // calibrated to the POST-fade measurement with headroom, not to the plan's
  // "lo <= 5 && hi >= 250" (which min/max normalisation would satisfy but
  // which would move neutral off 128 and bias the ground's tone).
  it('uses its whole range around a neutral middle (F-2)', () => {
    let lo = 255;
    let hi = 0;
    let sum = 0;
    for (const v of f.data) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      sum += v;
    }
    expect(Math.max(128 - lo, hi - 128)).toBeGreaterThanOrEqual(100);
    expect(lo).toBeLessThanOrEqual(64);
    expect(hi).toBeGreaterThanOrEqual(192);
    expect(Math.abs(sum / f.data.length - 128)).toBeLessThan(12);
  });
  it('is low-frequency: the mean step between neighbouring texels is small', () => {
    let steps = 0;
    let n = 0;
    for (let j = 0; j < 256; j++)
      for (let i = 1; i < 256; i++) {
        steps += Math.abs(f.data[j * 256 + i] - f.data[j * 256 + i - 1]);
        n++;
      }
    expect(steps / n).toBeLessThan(6);
  });
  it('blurs by 1.5 tiles', () => {
    expect(macroBlurTexels(48)).toBe(8);
  });
  it('is deterministic', () => {
    expect(Array.from(buildMacroField(48, 48).data)).toEqual(Array.from(f.data));
  });
  // F-13: without this, a luminance step of up to 7% would land exactly on
  // the map's own edge and outline it against the skirt beyond, which never
  // samples the field at all.
  it('fades to neutral at the border (F-13)', () => {
    for (let i = 0; i < 256; i++) {
      expect(f.data[i], `top row i=${i}`).toBe(128);
      expect(f.data[255 * 256 + i], `bottom row i=${i}`).toBe(128);
    }
    for (let j = 0; j < 256; j++) {
      expect(f.data[j * 256], `left col j=${j}`).toBe(128);
      expect(f.data[j * 256 + 255], `right col j=${j}`).toBe(128);
    }
  });
  it('does not force a texel two tiles in to neutral (F-13)', () => {
    // Two tiles in, on a 48-tile map at 256 texels/side, is well past the
    // 1.5-tile (8-texel) fade band on every side.
    const i = Math.round((2 / 48) * 256);
    const j = i;
    expect(f.data[j * 256 + i]).not.toBe(128);
  });
  // Fix round 1: nothing above tells max|v| normalisation (F-2's ruling)
  // from min/max normalisation (the plan's own, which F-2 explicitly
  // rejects) -- both satisfy every existing assertion on this field. This
  // test rebuilds the raw, blurred field independently of buildMacroField,
  // finds the texel OUTSIDE the F-13 fade band whose blurred value sits
  // closest to zero, and checks that buildMacroField reads that texel as
  // neutral. max|v| normalisation maps raw 0 to byte 128 everywhere by
  // construction (128 + 127 * (0 / maxAbs) = 128); min/max normalisation
  // does not, except when the field happens to be exactly symmetric, and
  // maps raw 0 to a byte offset from 128 by the field's own skew instead.
  it('reads neutral at the texel whose blurred value is nearest zero (F-2, max|v| vs min/max)', () => {
    const size = 256;
    const mapWidth = 48;
    const mapHeight = 48;
    const raw = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
      const pz = ((j + 0.5) / size) * mapHeight;
      for (let i = 0; i < size; i++) {
        const px = ((i + 0.5) / size) * mapWidth;
        raw[j * size + i] = fbm2(px, pz, MACRO_PERIOD_TILES, MACRO_OCTAVES, 404);
      }
    }
    const band = macroBlurTexels(mapWidth);
    const blurred = boxBlur(raw, size, size, band);

    let bestI = -1;
    let bestJ = -1;
    let bestAbs = Infinity;
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const edge = Math.min(i, size - 1 - i, j, size - 1 - j);
        if (edge < band) continue; // inside the F-13 fade band -- forced toward neutral regardless.
        const abs = Math.abs(blurred[j * size + i]);
        if (abs < bestAbs) {
          bestAbs = abs;
          bestI = i;
          bestJ = j;
        }
      }

    const byte = f.data[bestJ * size + bestI];
    expect(byte, `texel (${bestI}, ${bestJ}), blurred value ${bestAbs}`).toBeGreaterThanOrEqual(127);
    expect(byte, `texel (${bestI}, ${bestJ}), blurred value ${bestAbs}`).toBeLessThanOrEqual(129);
  });
});

describe('macroFactor', () => {
  const bright = neutralTint('#D9C7A7'); // limestone.2
  const dark = neutralTint('#D1A668'); // dust.1
  const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  it('builds luminance-neutral tints', () => {
    expect(lum(bright)).toBeCloseTo(1, 9);
    expect(lum(dark)).toBeCloseTo(1, 9);
  });
  it('is neutral at m = 0 and at amplitude 0 (the macro layer hidden)', () => {
    expect(macroFactor(0, 1, bright, dark)).toEqual([1, 1, 1]);
    expect(macroFactor(0.8, 0, bright, dark)).toEqual([1, 1, 1]);
  });
  it('moves luminance by exactly +/-7% at the extremes', () => {
    expect(lum(macroFactor(1, 1, bright, dark))).toBeCloseTo(1.07, 9);
    expect(lum(macroFactor(-1, 1, bright, dark))).toBeCloseTo(0.93, 9);
  });
  it('pulls hue toward the dust side when dark', () => {
    const c = macroFactor(-1, 1, bright, dark);
    expect(c[0] / c[2]).toBeGreaterThan(1);
  });
});
