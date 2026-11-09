import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { RAMP_LAYOUT, RAMP_TOLERANCE, RAMP_VALUES, cardRefusal, compareCards, rampPatches, readPatches, type Rgb8 } from './ramp-card';

const flat = (v: number): Rgb8[] => rampPatches().map((_, i) => [Math.min(255, v + i), 10, 20] as const);

describe('ramp card layout', () => {
  it('is 0 then 2^-8..2^4 in half-octaves, ending exactly at 16', () => {
    expect(RAMP_VALUES).toHaveLength(RAMP_LAYOUT.cols);
    expect(RAMP_VALUES[0]).toBe(0);
    expect(RAMP_VALUES[1]).toBeCloseTo(1 / 256, 12);
    expect(RAMP_VALUES[RAMP_VALUES.length - 1]).toBeCloseTo(16, 12);
    expect(rampPatches()).toHaveLength(RAMP_LAYOUT.cols * RAMP_LAYOUT.rows);
  });
});

describe('compareCards', () => {
  it('identical cards pass with delta 0', () => {
    const v = compareCards(flat(5), flat(5));
    expect(v).toMatchObject({ pass: true, maxDelta: 0, failing: 0 });
  });
  it('one level apart passes (the tolerance is inclusive), two levels fails', () => {
    // Falsify: change `d > tolerance` to `d >= tolerance` in compareCards (the one-level case then fails).
    const a = flat(5);
    const b = a.map((p, i) => (i === 3 ? ([p[0] + RAMP_TOLERANCE, p[1], p[2]] as const) : p));
    expect(compareCards(a, b).pass).toBe(true);
    const c = a.map((p, i) => (i === 3 ? ([p[0], p[1], p[2] + 2] as const) : p));
    const v = compareCards(a, c);
    expect(v.pass).toBe(false);
    expect(v.failing).toBe(1);
    expect(v.maxDelta).toBe(2);
    expect(v.worst?.col).toBe(3);
  });
  it('a truncated card is an error, not a pass', () => {
    expect(() => compareCards(flat(5).slice(1), flat(5))).toThrow(/expected/);
  });
});

describe('cardRefusal and readPatches', () => {
  it('refuses a card that drew nothing', () => {
    expect(cardRefusal(rampPatches().map(() => [0, 0, 0] as const), 'x')).toMatch(/nothing was drawn/);
    expect(cardRefusal(flat(5), 'x')).toBeNull();
  });
  it('reads the patch centres of a PNG, in patch order', () => {
    const png = new PNG({ width: RAMP_LAYOUT.width, height: RAMP_LAYOUT.height });
    for (const p of rampPatches()) {
      const i = (Math.floor(p.y) * png.width + Math.floor(p.x)) * 4;
      png.data[i] = p.col;
      png.data[i + 1] = p.row;
      png.data[i + 2] = 7;
      png.data[i + 3] = 255;
    }
    const got = readPatches(PNG.sync.write(png));
    got.forEach((rgb, i) => {
      const p = rampPatches()[i] as { col: number; row: number };
      expect(rgb).toEqual([p.col, p.row, 7]);
    });
    expect(() => readPatches(PNG.sync.write(new PNG({ width: 10, height: 10 })))).toThrow(/expected/);
  });
});
