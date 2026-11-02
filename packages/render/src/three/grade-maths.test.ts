import { describe, it, expect } from 'vitest';
import {
  bakeLutFloats,
  gradeColor,
  GRADE_LUT_SIZE,
  hueDirection,
  IDENTITY_GRADE,
  isIdentity,
  resolveGrade,
  type GradeJson,
} from './grade-maths';
import dawn from '../../../../data/grades/dawn.json';
import dusk from '../../../../data/grades/dusk.json';

/** Keys the pins resolve through a table, so the expected numbers do not depend on the palette file. */
const KEYS: Record<string, string> = { 'k.cool': '#4E7186', 'k.warm': '#D1A668' };
const resolve = (key: string): string => {
  const hex = KEYS[key];
  if (hex === undefined) throw new Error(`no key ${key}`);
  return hex;
};

/** A grade that touches every stage. Its expected texels below were computed by an independent
 *  re-implementation (a Python script written from the spec's formulas, not from grade-maths.ts). */
const KNOWN: GradeJson = {
  id: 'known',
  lift: { tint: 'k.cool', amount: 0.04, level: 0.01 },
  gamma: { tint: 'k.warm', amount: 0.1, value: 1.1 },
  gain: { tint: 'k.warm', amount: 0.1, value: 0.95 },
  saturation: 1.1,
  warmth: 0.5,
  split_tone: { shadows: { tint: 'k.cool', amount: 0.05 }, highlights: { tint: 'k.warm', amount: 0.04 }, balance: 0.2 },
};

const close = (a: readonly number[], b: readonly number[], eps = 1e-5): void => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(Math.abs(v - b[i]), `channel ${i}: ${v} vs ${b[i]}`).toBeLessThan(eps));
};

describe('hueDirection', () => {
  it('is the colour minus its own luma, scaled to a largest channel of 1, and nothing for a grey', () => {
    const d = hueDirection('#4E7186');
    expect(Math.max(...d.map(Math.abs))).toBeCloseTo(1, 9);
    expect(d[0]).toBeLessThan(0); // a cool key leans away from red
    expect(d[2]).toBeGreaterThan(0);
    expect(hueDirection('#808080')).toEqual([0, 0, 0]);
  });
});

describe('gradeColor: literal texels from an independent computation', () => {
  const g = resolveGrade(KNOWN, 1, resolve);
  const cases: [readonly [number, number, number], readonly number[]][] = [
    [[0, 0, 0], [0, 0.036055, 0.094324]],
    [[1, 1, 1], [1, 0.945057, 0.750293]],
    [[0.5, 0.5, 0.5], [0.570434, 0.512719, 0.404601]],
    [[1, 0, 0], [1, 0.013448, 0.064593]],
    [[0, 1, 0], [0, 0.972876, 0]],
    [[0, 0, 1], [0, 0.030574, 0.92392]],
    [[0.25, 0.5, 0.75], [0.270175, 0.518299, 0.626514]],
  ];
  for (const [c, want] of cases) {
    it(`(${c.join(', ')})`, () => close(gradeColor(c, g), want));
  }
  it('strength 0.5 scales every deviation from identity', () => {
    close(gradeColor([0.25, 0.5, 0.75], resolveGrade(KNOWN, 0.5, resolve)), [0.259168, 0.509468, 0.68991]);
  });
  it('strength 0 is the identity', () => {
    expect(isIdentity(resolveGrade(KNOWN, 0, resolve))).toBe(true);
    close(gradeColor([0.3, 0.6, 0.9], resolveGrade(KNOWN, 0, resolve)), [0.3, 0.6, 0.9], 1e-12);
  });
});

describe('the baked LUT', () => {
  const g = resolveGrade(KNOWN, 1, resolve);
  const lut = bakeLutFloats(g);
  const at = (i: number, j: number, k: number): number[] => {
    const o = ((k * GRADE_LUT_SIZE + j) * GRADE_LUT_SIZE + i) * 4;
    return [lut[o], lut[o + 1], lut[o + 2], lut[o + 3]];
  };
  it('is 32^3 RGBA, red fastest', () => {
    expect(GRADE_LUT_SIZE).toBe(32);
    expect(lut.length).toBe(32 * 32 * 32 * 4);
  });
  it('holds the literal texels at the cube corners, with alpha 1', () => {
    const e = GRADE_LUT_SIZE - 1;
    close(at(0, 0, 0), [0, 0.036055, 0.094324, 1]);
    close(at(e, e, e), [1, 0.945057, 0.750293, 1]);
    close(at(e, 0, 0), [1, 0.013448, 0.064593, 1]);
    close(at(0, e, 0), [0, 0.972876, 0, 1]);
    close(at(0, 0, e), [0, 0.030574, 0.92392, 1]);
  });
  it('an identity grade bakes the identity ramp exactly', () => {
    const id = bakeLutFloats(IDENTITY_GRADE);
    const e = GRADE_LUT_SIZE - 1;
    const o = ((7 * 32 + 13) * 32 + 21) * 4;
    close([id[o], id[o + 1], id[o + 2]], [21 / e, 13 / e, 7 / e], 1e-7);
  });
});

describe('the shipped grades (dawn, dusk)', () => {
  it('are not identities, and the keys they name resolve through the palette', () => {
    for (const json of [dawn, dusk] as GradeJson[]) {
      const g = resolveGrade(json);
      expect(isIdentity(g), json.id).toBe(false);
      expect(gradeColor([0.5, 0.5, 0.5], g).every(Number.isFinite)).toBe(true);
    }
  });
  it('lean the right way: both warm a mid grey (red above blue) and cool a deep shadow (blue above red)', () => {
    const grey = [0.5, 0.5, 0.5] as const;
    const black = [0.02, 0.02, 0.02] as const;
    for (const json of [dawn, dusk] as GradeJson[]) {
      const g = resolveGrade(json);
      const mid = gradeColor(grey, g);
      const shadow = gradeColor(black, g);
      expect(mid[0] - mid[2], `${json.id} mid`).toBeGreaterThan(0.02);
      expect(shadow[2] - shadow[0], `${json.id} shadow`).toBeGreaterThan(0.01);
    }
  });
});
