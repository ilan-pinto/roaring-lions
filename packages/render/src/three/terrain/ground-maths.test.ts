/**
 * GH-943 P2 (T3): the ground blend's shared maths on numbers (`NUMBER_OPS`), against LITERAL expected values worked by hand from
 * the spec numbers (half-width 0.36, falloff 0.18, bend 0.08, shoulder 0.12 at 40%, ruts 0.17 out, 0.06 wide, 35%, junction fade
 * 0.4; height blend 0.15; macro luminance 0.07, hue 0.04), never from the code under test.
 */
import { describe, expect, it } from 'vitest';
import { NUMBER_OPS } from '../fog-ops';
import { groundBlend, heightBiased, macroDecode, macroFactor, rescaleWeights, roadBands, type BlendVec, type GroundKnobs, type GroundTaps } from './ground-maths';
import type { Ops } from '../fog-ops';

const o = NUMBER_OPS;
const FAR = 10;

describe('roadBands', () => {
  it('is packed surface on the centreline, no shoulder, no rut', () => {
    expect(roadBands(o, 0, 0, FAR)).toEqual({ surface: 1, shoulder: 0, rut: 0 });
  });
  it('is half surface at the half-width, with a 20% shoulder (0.4 x 0.5 x 1)', () => {
    const b = roadBands(o, 0.36, 0, FAR);
    expect(b.surface).toBeCloseTo(0.5, 12);
    expect(b.shoulder).toBeCloseTo(0.2, 12);
    expect(b.rut).toBe(0);
  });
  it('bends the edge out by 0.08 at bend 1: surface 0.0089163 at the half-width', () => {
    expect(roadBands(o, 0.36, 1, FAR).surface).toBeCloseTo(0.0089163237, 9);
  });
  it('lays the shoulder past the edge: 0.4 x (1 - smoothstep(0.45, 0.57, 0.5)) = 0.249537', () => {
    const b = roadBands(o, 0.5, 0, FAR);
    expect(b.surface).toBe(0);
    expect(b.shoulder).toBeCloseTo(0.2495370370, 9);
  });
  it('puts a full 35% rut at 0.17 from the centre, and none at 0.06 (the rut width, not its offset)', () => {
    expect(roadBands(o, 0.17, 0, FAR).rut).toBeCloseTo(0.35, 12);
    expect(roadBands(o, 0.06, 0, FAR).rut).toBe(0);
    expect(roadBands(o, 0.1, 0, FAR).rut).toBe(0);
  });
  it('half a rut band, half faded by a junction 0.2 away: 0.35 x 0.5 x 0.5 = 0.0875', () => {
    expect(roadBands(o, 0.2, 0, 0.2).rut).toBeCloseTo(0.0875, 10);
    expect(roadBands(o, 0.17, 0, 0).rut).toBe(0);
  });
});

describe('heightBiased and rescaleWeights', () => {
  it('biases a mid-blend weight by 0.15 x h, and leaves 0 and 1 alone', () => {
    expect(heightBiased(o, 0.5, 1)).toBeCloseTo(0.65, 12);
    expect(heightBiased(o, 0.25, 0.5)).toBeCloseTo(0.30625, 12);
    expect(heightBiased(o, 1, 1)).toBe(1);
    expect(heightBiased(o, 0, 1)).toBe(0);
  });
  it('never goes below 0 (0.5 - 1.5 clamps)', () => {
    expect(heightBiased(o, 0.5, -10)).toBe(0);
  });
  it('rescales the biased weights to the input total', () => {
    const r = rescaleWeights(o, [0.5, 0.5], [0.9, 0.3]);
    expect(r[0]).toBeCloseTo(0.75, 12);
    expect(r[1]).toBeCloseTo(0.25, 12);
    expect(rescaleWeights(o, [0.3, 0.3], [0.5, 0.1])).toEqual([0.5, 0.1]);
  });
  it('returns the weights unchanged when every biased weight is 0 (the fallback arm, not the scaled one)', () => {
    expect(rescaleWeights(o, [0, 0, 0], [0, 0, 0])).toEqual([0, 0, 0]);
    expect(rescaleWeights(o, [0.5, 0.5], [0, 0])).toEqual([0.5, 0.5]);
  });
});

describe('macroDecode and macroFactor', () => {
  it('decodes the byte exactly: 128 is 0, 255 is 1, 0 is -128/127', () => {
    expect(macroDecode(o, 128 / 255)).toBeCloseTo(0, 12);
    expect(macroDecode(o, 1)).toBe(1);
    expect(macroDecode(o, 0)).toBeCloseTo(-1.0078740157, 9);
  });
  it('is neutral at m = 0 and at amp = 0', () => {
    expect(macroFactor(o, 0, 1, 1.2, 0.8)).toBe(1);
    expect(macroFactor(o, 1, 0, 1.2, 0.8)).toBe(1);
  });
  it('pulls bright toward the bright tint and dark toward the dark one', () => {
    expect(macroFactor(o, 1, 1, 1.2, 0.8)).toBeCloseTo(1.07856, 12);
    expect(macroFactor(o, -1, 1, 1.2, 0.8)).toBeCloseTo(0.92256, 12);
    expect(macroFactor(o, 0.5, 0.5, 1.2, 0.8)).toBeCloseTo(1.019535, 12);
  });
});

/**
 * `Ops` on number VECTORS, element-wise, a length-1 vector broadcasting against any length: rgb values are length 3, scalars
 * length 1. `NUMBER_OPS` does every element's arithmetic, so this is the numbers path of the same composition the node ground runs.
 */
type V = readonly number[];
const lift2 = (f: (a: number, b: number) => number) => (a: V, b: V): V => {
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => f(a[a.length === 1 ? 0 : i] as number, b[b.length === 1 ? 0 : i] as number));
};
const lift1 = (f: (a: number) => number) => (a: V): V => a.map(f);
const at = (x: V, i: number): number => x[x.length === 1 ? 0 : i] as number;
const VEC: Ops<V> = {
  lit: (n) => [n],
  add: lift2(o.add), sub: lift2(o.sub), mul: lift2(o.mul), div: lift2(o.div),
  sin: lift1(o.sin), cos: lift1(o.cos), clamp01: lift1(o.clamp01), fract: lift1(o.fract), abs: lift1(o.abs), floor: lift1(o.floor),
  sqrt: lift1(o.sqrt), exp: lift1(o.exp), sign: lift1(o.sign),
  clamp: (a, lo, hi) => a.map((x) => o.clamp(x, lo, hi)),
  length2: lift2(o.length2), min: lift2(o.min), max: lift2(o.max), step: lift2(o.step), pow: lift2(o.pow), atan2: lift2(o.atan2),
  mix: (a, b, t) => {
    const n = Math.max(a.length, b.length, t.length);
    return Array.from({ length: n }, (_, i) => o.mix(at(a, i), at(b, i), at(t, i)));
  },
  smoothstep: (e0, e1, x) => {
    const n = Math.max(e0.length, e1.length, x.length);
    return Array.from({ length: n }, (_, i) => o.smoothstep(at(e0, i), at(e1, i), at(x, i)));
  },
  selectLt: (a, b, x, y) => {
    const n = Math.max(a.length, b.length, x.length, y.length);
    return Array.from({ length: n }, (_, i) => (at(a, i) < at(b, i) ? at(x, i) : at(y, i)));
  },
};
const BV: BlendVec<V> = { luma: (c) => [0.2126 * at(c, 0) + 0.7152 * at(c, 1) + 0.0722 * at(c, 2)], one3: [1, 1, 1] };

const grey = (x: number): V => [x, x, x];
/** Open ground (control A open = 1), no road within range (B.g = 1), a neutral macro byte, every image at its mean except the
 *  open slot's (texel 0.6 over mean 0.5: ratio 1.2, strength 1). Vertex tone (0.5, 0.4, 0.3). */
function taps(over: Partial<GroundTaps<V>> = {}): GroundTaps<V> {
  return {
    vertexTone: [0.5, 0.4, 0.3],
    wall: [-1],
    slotTexels: [grey(0.6), grey(0.8), grey(0.5), grey(0.5), grey(0.5)],
    controlA: [[1], [0], [0], [0]],
    controlB: [[0], [1], [1], [0.5]],
    grainTexel: grey(0.5),
    macroTexel: [128 / 255],
    ...over,
  };
}
function knobs(over: Partial<GroundKnobs<V>> = {}): GroundKnobs<V> {
  return {
    strengths: [[1], [1], [1], [1], [1]],
    means: [grey(0.5), grey(0.5), grey(0.5), grey(0.5), grey(0.5)],
    grainMean: grey(0.5),
    roadOn: [1],
    grainGain: [0],
    roadTone: [0.7, 0.6, 0.5],
    shoulderTone: [0.9, 0.9, 0.9],
    rutTone: [0.2, 0.2, 0.2],
    macroAmp: [1],
    macroBright: [1.2, 1, 0.8],
    macroDark: [0.8, 1, 1.2],
    ...over,
  };
}
const blend = (t: GroundTaps<V>, k: GroundKnobs<V>) => groundBlend(VEC, BV, 1, t, k);
const close = (got: V, want: readonly number[]): void => {
  expect(got).toHaveLength(3);
  got.forEach((g, i) => expect(g, `channel ${i}`).toBeCloseTo(want[i] as number, 9));
};

describe('groundBlend: the composition the node ground runs, on numbers, against hand-worked colours', () => {
  it('open ground, no road, neutral macro: the vertex tone x the open slot ratio 1.2', () => {
    const b = blend(taps(), knobs());
    close(b.colour, [0.6, 0.48, 0.36]);
    expect(b.top).toEqual([1]);
  });
  it('on the road centreline (B.g = 0, junction 1 tile away): exactly the road tone, the slots taken away', () => {
    close(blend(taps({ controlB: [[0], [0], [1], [0.5]] }), knobs()).colour, [0.7, 0.6, 0.5]);
  });
  it('a ridge cliff (wall 1) takes its ROCK weight (ratio 1.6) and no road, even with a road in control B beneath it', () => {
    const b = blend(taps({ wall: [1], controlB: [[0], [0], [1], [0.5]] }), knobs());
    close(b.colour, [0.8, 0.64, 0.48]);
    expect(b.top).toEqual([0]);
  });
  it('macro amplitude 0 is neutral whatever the field reads; amplitude 1 at m = 1 pulls toward the bright tint', () => {
    close(blend(taps({ macroTexel: [1] }), knobs({ macroAmp: [0] })).colour, [0.6, 0.48, 0.36]);
    // 1.07 x (1 + 0.04 x (bright - 1)) = (1.07856, 1.07, 1.06144), times (0.6, 0.48, 0.36).
    close(blend(taps({ macroTexel: [1] }), knobs()).colour, [0.647136, 0.5136, 0.3821184]);
  });
  it('the road switch off leaves the open ground as it was', () => {
    close(blend(taps({ controlB: [[0], [0], [1], [0.5]] }), knobs({ roadOn: [0] })).colour, [0.6, 0.48, 0.36]);
  });
});
