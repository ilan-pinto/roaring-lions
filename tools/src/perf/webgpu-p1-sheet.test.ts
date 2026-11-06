import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { countValidationErrors, diffPanel, gateTable, parseQuietMax, r0Outside, syncedSummary, type GateInputs } from './webgpu-p1-sheet-lib';

const flat = (v: number): PNG => {
  const p = new PNG({ width: 2, height: 1 });
  p.data.fill(v);
  return p;
};

describe('diffPanel', () => {
  it('reads 0 for identical frames and gains the difference x8 otherwise', () => {
    expect(diffPanel(flat(10), flat(10)).meanAbsChannelDelta).toBe(0);
    const d = diffPanel(flat(10), flat(13));
    expect(d.meanAbsChannelDelta).toBe(3);
    expect(d.png.data[0]).toBe(24);
    expect(d.changedPixels).toBe(2);
    expect(diffPanel(flat(0), flat(200)).png.data[0]).toBe(255);
  });
  it('refuses a size mismatch', () => {
    expect(() => diffPanel(flat(1), new PNG({ width: 1, height: 1 }))).toThrow(/vs/);
  });
});

describe('syncedSummary', () => {
  it('median of rounds plus spread; fewer than 3 rounds throws', () => {
    expect(syncedSummary([10, 12, 11])).toEqual({ value: 11, spread: 2, rounds: 3 });
    expect(() => syncedSummary([1, 2])).toThrow(/at least 3/);
  });
});

const good: GateInputs = {
  sheetFrames: 10,
  sheetUnsettled: 0,
  abba: [
    { test: 'G', target: 300, ratio: 0.9, withinSpread: false, met: true },
    { test: 'G', target: 600, ratio: 0.95, withinSpread: false, met: true },
    { test: 'F', target: 300, ratio: 1.0, withinSpread: true, met: true },
    { test: 'F', target: 600, ratio: 1.2, withinSpread: false, met: false },
  ],
  triangles: [{ zoom: 1, L: 1000, F: 1005, G: 1000 }],
  bloom: [
    { arm: 'G', exit: 0, quietMax: 0.5 },
    { arm: 'F', exit: 0, quietMax: 0.5 },
  ],
  rafLine: 'hypothesis: ... -> CONFIRMED',
  validationErrors: 0,
};
const verdictOf = (g: GateInputs, item: RegExp): string | undefined => gateTable(g).find((r) => item.test(r.item))?.verdict;

describe('gateTable goes red on a constructed input', () => {
  it('passes the good inputs, and reports F at 600 as FAIL', () => {
    expect(verdictOf(good, /G <= 1.05/)).toBe('PASS');
    expect(verdictOf(good, /n600: F/)).toBe('FAIL');
  });
  it('G over its bar and outside the spread is FAIL', () => {
    const g = { ...good, abba: [{ test: 'G' as const, target: 300, ratio: 1.2, withinSpread: false, met: false }] };
    expect(verdictOf(g, /G <= 1.05/)).toBe('FAIL');
  });
  it('no G timing at all is FAIL, never a silent pass', () => {
    expect(verdictOf({ ...good, abba: good.abba.filter((a) => a.test === 'F') }, /ABBA: G/)).toBe('FAIL');
  });
  it('a triangle disagreement above 1% is FAIL', () => {
    expect(verdictOf({ ...good, triangles: [{ zoom: 1, L: 1000, F: 1000, G: 1020 }] }, /triangle/)).toBe('FAIL');
    expect(verdictOf({ ...good, triangles: [] }, /triangle/)).toBe('FAIL');
  });
  it('a bloom quiet max at the ceiling, an unread max or a non-zero exit is FAIL', () => {
    expect(verdictOf({ ...good, bloom: [{ arm: 'G', exit: 0, quietMax: 0.9 }] }, /bloom/)).toBe('FAIL');
    expect(verdictOf({ ...good, bloom: [{ arm: 'G', exit: 0, quietMax: null }] }, /bloom/)).toBe('FAIL');
    expect(verdictOf({ ...good, bloom: [{ arm: 'G', exit: 2, quietMax: 0.1 }] }, /bloom/)).toBe('FAIL');
  });
  it('one validation error, a missing rAF line or a short sheet is FAIL', () => {
    expect(verdictOf({ ...good, validationErrors: 1 }, /Validation/)).toBe('FAIL');
    expect(verdictOf({ ...good, rafLine: 'hypothesis: ... -> NOT CONFIRMED as stated' }, /rAF/)).toBe('FAIL');
    expect(verdictOf({ ...good, rafLine: null }, /rAF/)).toBe('FAIL');
    expect(verdictOf({ ...good, sheetFrames: 9 }, /sheet/)).toBe('FAIL');
  });
});

describe('parsers', () => {
  it('counts validation errors', () => {
    expect(countValidationErrors(['ok', 'GPUValidationError: x', 'Destroyed texture y'])).toBe(2);
  });
  it('takes the highest max column of the census table, ignoring the header and the aftermath rows', () => {
    const out = ['map | quality | view (x,y,zoom) | samples | p50 | p99 | max | frac>1.0', 'a | high | whole (1,2,0.5) | 10 | 0.1 | 0.4 | 0.62 | 0.0000', 'b | high | force (1,2,1.6) | 10 | 0.1 | 0.4 | 0.71 | 0.0000'].join('\n');
    expect(parseQuietMax(out)).toBe(0.71);
    expect(parseQuietMax('nothing')).toBeNull();
  });
});

describe('r0Outside', () => {
  const row = (r0: number | null) => [{ scenario: 's', layer: 'l', band: 'tight' as const, r0: { wgl2: r0, wgpu: null }, note: '' }];
  it('reports an r0 outside the band, not an unread one or an inside one', () => {
    expect(r0Outside(row(1.2))).toHaveLength(1);
    expect(r0Outside(row(1.0))).toHaveLength(0);
    expect(r0Outside(row(null))).toHaveLength(0);
  });
});
