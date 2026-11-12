/**
 * GH-1226 S1, gate G1: the height blend's maths on `NUMBER_OPS` (and a vector lift of it) against LITERAL oracles, worked by hand
 * from the approved numbers (slope 10-22 degrees, crest 0.6 x (0.15-0.45) level, patch +/-50%, texture edge gain 0.6, joints below a
 * rock luminance ratio of 0.85-1.00, hollow 0.12-0.40 level cut on slopes 8-16 degrees). Nothing here imports a constant from
 * `height-blend.ts`: the thresholds are written out, so changing one in the code turns a test red.
 *
 * The flat identity is held by BIT equality, through `groundBlend`, on fragments chosen so the mutations the design lists cannot
 * survive: a rock texel brighter than its mean (Lr > 1), a soil weight > 0 and a rock tone that differs from the vertex tone.
 */
import { describe, expect, it } from 'vitest';
import { NUMBER_OPS } from '../fog-ops';
import type { Ops } from '../fog-ops';
import { groundBlend, type BlendVec, type GroundKnobs, type GroundTaps } from './ground-maths';
import { HEIGHT_BLEND_THEMES, heightBlendMasks, heightBlendStage, heightBlendTone, type HeightBlendKnobs } from './height-blend';

const o = NUMBER_OPS;
const masks = (s: number, t: number, n = 0.5, lr = 1) => heightBlendMasks(o, s, t, n, lr);

describe('heightBlendMasks: exposure from slope and crest', () => {
  it('the slope ramp: 0 at 10, 1 at 22, 0.5 at 16, and ASYMMETRIC off the midpoint (13 is 0.15625, 19 is 0.84375)', () => {
    expect(masks(10, 0).eRaw).toBe(0);
    expect(masks(22, 0).eRaw).toBe(1);
    expect(masks(16, 0).eRaw).toBe(0.5);
    expect(masks(13, 0).eRaw).toBeCloseTo(0.15625, 12);
    expect(masks(19, 0).eRaw).toBeCloseTo(0.84375, 12);
    expect(masks(5, 0).eRaw).toBe(0);
    expect(masks(40, 0).eRaw).toBe(1);
  });
  it('the crest: 0.6 x smoothstep(0.15, 0.45) of the level above the mean; 0.3 is 0.3, 0.225 is 0.09375, 0.375 is 0.50625', () => {
    expect(masks(0, 0.15).eRaw).toBe(0);
    expect(masks(0, 0.45).eRaw).toBeCloseTo(0.6, 12);
    expect(masks(0, 0.3).eRaw).toBeCloseTo(0.3, 12);
    expect(masks(0, 0.225).eRaw).toBeCloseTo(0.09375, 12);
    expect(masks(0, 0.375).eRaw).toBeCloseTo(0.50625, 12);
    expect(masks(0, 1).eRaw).toBeCloseTo(0.6, 12);
  });
  it('slope and crest add, and the sum clamps at 1 (22 degrees + a 0.45 crest is 1, not 1.6)', () => {
    expect(masks(16, 0.3).eRaw).toBeCloseTo(0.8, 12);
    expect(masks(22, 0.45).eRaw).toBe(1);
  });
  it('the patch noise scales the exposure by 1 + 0.5 x (2n - 1): n 0.5 is neutral, n 1 is x1.5, n 0 is x0.5', () => {
    expect(masks(16, 0, 0.5).eP).toBe(0.5);
    expect(masks(16, 0, 1).eP).toBeCloseTo(0.75, 12);
    expect(masks(16, 0, 0).eP).toBeCloseTo(0.25, 12);
    expect(masks(22, 0, 1).eP).toBe(1);
    expect(masks(0, 0, 1).eP).toBe(0);
  });
});

describe('heightBlendMasks: the texture edge and the joints', () => {
  it('biases the exposure by the rock texel: eP 0.5 at Lr 1.1 is 0.56, at Lr 0.9 is 0.44', () => {
    expect(masks(16, 0, 0.5, 1.1).exposure).toBeCloseTo(0.56, 12);
    expect(masks(16, 0, 0.5, 0.9).exposure).toBeCloseTo(0.44, 12);
  });
  it('changes nothing at exposure 0 or 1, whatever the texel reads', () => {
    for (const lr of [0.5, 0.9, 1.3, 2]) {
      expect(masks(0, 0, 0.5, lr).exposure).toBe(0);
      expect(masks(30, 0, 0.5, lr).exposure).toBe(1);
    }
  });
  it('joints: none at Lr 1, all of the exposure at Lr 0.85 and below, half of it at 0.925', () => {
    expect(masks(16, 0, 0.5, 1).joint).toBe(0);
    expect(masks(16, 0, 0.5, 1.3).joint).toBe(0);
    // Lr 0.85: e = 0.5 + 0.6 x (-0.15) x 4 x 0.25 = 0.41, and j = e.
    expect(masks(16, 0, 0.5, 0.85).exposure).toBeCloseTo(0.41, 12);
    expect(masks(16, 0, 0.5, 0.85).joint).toBeCloseTo(0.41, 12);
    expect(masks(16, 0, 0.5, 0.5).joint).toBeCloseTo(masks(16, 0, 0.5, 0.5).exposure, 12);
    // Lr 0.925: e = 0.5 - 0.045 = 0.455; j = 0.455 x 0.5.
    expect(masks(16, 0, 0.5, 0.925).joint).toBeCloseTo(0.2275, 12);
  });
  it('no joint on bare soil: exposure 0 gives j 0 whatever the texel reads', () => {
    expect(masks(0, 0, 0.5, 0.5).joint).toBe(0);
  });
  it('the low tier: no texture edge and no joints are a graph choice, the patched exposure stands', () => {
    const m = heightBlendMasks(o, 16, 0, 0.5, 0.9, { textureEdge: false, joints: false });
    expect(m.exposure).toBe(0.5);
    expect(m.joint).toBe(0);
  });
});

describe('heightBlendMasks: the hollow', () => {
  it('fills a hollow on the flat: 0 at 0.12 below the mean, 0.5 at 0.26, 1 at 0.40, 0.15625 at 0.19', () => {
    expect(masks(0, -0.12).hollow).toBe(0);
    expect(masks(0, -0.26).hollow).toBeCloseTo(0.5, 12);
    expect(masks(0, -0.4).hollow).toBe(1);
    expect(masks(0, -0.19).hollow).toBeCloseTo(0.15625, 12);
  });
  it('never fills a crest (the sign of t matters): 0.4 ABOVE the mean is no hollow at all', () => {
    expect(masks(0, 0.4).hollow).toBe(0);
    expect(masks(0, 0.12).hollow).toBe(0);
  });
  it('is cut on slopes: 8 degrees keeps it, 16 removes it, and at 12 degrees it is 0.5 x (1 - the 12-degree exposure 0.0740741)', () => {
    expect(masks(8, -0.4).hollow).toBe(1);
    expect(masks(16, -0.4).hollow).toBe(0);
    expect(masks(12, -0.4).hollow).toBeCloseTo(0.4629629630, 9);
  });
  it('never sits under exposed rock: a steep hollow texel is rock, not soil', () => {
    expect(masks(30, -0.4).hollow).toBe(0);
  });
});

// -- Vectors, for the stage and for groundBlend -----------------------------------------------------------------------------

type V = readonly number[];
const at = (x: V, i: number): number => x[x.length === 1 ? 0 : i] as number;
const lift2 = (f: (a: number, b: number) => number) => (a: V, b: V): V =>
  Array.from({ length: Math.max(a.length, b.length) }, (_, i) => f(at(a, i), at(b, i)));
const lift1 = (f: (a: number) => number) => (a: V): V => a.map(f);
const VEC: Ops<V> = {
  lit: (n) => [n],
  add: lift2(o.add), sub: lift2(o.sub), mul: lift2(o.mul), div: lift2(o.div),
  sin: lift1(o.sin), cos: lift1(o.cos), clamp01: lift1(o.clamp01), fract: lift1(o.fract), abs: lift1(o.abs), floor: lift1(o.floor),
  sqrt: lift1(o.sqrt), exp: lift1(o.exp), sign: lift1(o.sign),
  clamp: (a, lo, hi) => a.map((x) => o.clamp(x, lo, hi)),
  length2: lift2(o.length2), min: lift2(o.min), max: lift2(o.max), step: lift2(o.step), pow: lift2(o.pow), atan2: lift2(o.atan2),
  mix: (a, b, t) => Array.from({ length: Math.max(a.length, b.length, t.length) }, (_, i) => o.mix(at(a, i), at(b, i), at(t, i))),
  smoothstep: (e0, e1, x) =>
    Array.from({ length: Math.max(e0.length, e1.length, x.length) }, (_, i) => o.smoothstep(at(e0, i), at(e1, i), at(x, i))),
  selectLt: (a, b, x, y) =>
    Array.from({ length: Math.max(a.length, b.length, x.length, y.length) }, (_, i) => (at(a, i) < at(b, i) ? at(x, i) : at(y, i))),
};
const BV: BlendVec<V> = { luma: (c) => [0.2126 * at(c, 0) + 0.7152 * at(c, 1) + 0.0722 * at(c, 2)], one3: [1, 1, 1] };
const grey = (x: number): V => [x, x, x];

const ROCK = [0.3, 0.6, 0.9];
const JOINT = [0.8, 0.2, 0.1];
const HOLLOW = [0.1, 0.1, 0.5];
function knobs(over: Partial<HeightBlendKnobs<V>> = {}): HeightBlendKnobs<V> {
  return {
    rockTone: ROCK, jointTone: JOINT, hollowTone: HOLLOW,
    rockAmp: [0.75], jointAmp: [0.6], hollowAmp: [0.45], soften: [0.4], amp: [1],
    ...over,
  };
}
/** A field texel from the BYTES the bake writes: R = degrees / 64 x 255, G = 128 + 127 x tpi, B = patch. */
const field = (rByte: number, gByte: number, bByte: number): [V, V, V] => [[rByte / 255], [gByte / 255], [bByte / 255]];
const NEUTRAL_B = 127.5;
const stageOf = (f: [V, V, V], k = knobs(), opts?: Parameters<typeof heightBlendStage<V>>[4]) => heightBlendStage(VEC, BV, f, k, opts);
const FACTORS: V[] = [[1.2, 0.8, 1.0], grey(1), grey(1), grey(1), grey(1)];
const close = (got: V, want: readonly number[], digits = 9): void => {
  expect(got).toHaveLength(want.length);
  got.forEach((g, i) => expect(g, `channel ${i}`).toBeCloseTo(want[i] as number, digits));
};

describe('heightBlendStage: weights, softening and tone, on literals worked by hand', () => {
  it('a 16-degree bank (R byte 64, G 128, patch neutral): open/knoll/half-scrub give half to rock, the sum is conserved', () => {
    const out = stageOf(field(63.75, 128, NEUTRAL_B))({ weights: [[0.4], [0.1], [0.2], [0.1], [0.2]], factors: FACTORS, vertexTone: [0.5, 0.4, 0.3] });
    // e = 0.5, soil = 0.4 + 0.2 + 0.5 x 0.2 = 0.7; open 0.4 -> 0.2, knoll 0.2 -> 0.1, scrub gives 0.5 x 0.2 x 0.5 = 0.05.
    const w = out.weights.map((x) => x[0] as number);
    [0.2, 0.45, 0.15, 0.1, 0.1].forEach((want, i) => expect(w[i], `weight ${i}`).toBeCloseTo(want, 12));
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    // no hollow here: the softening leaves the factors alone.
    expect(out.factors).toEqual(FACTORS);
    // tone = mix(vertex, rock, 0.75 x 0.5 x 0.7 = 0.2625).
    close(out.vertexTone, [0.4475, 0.4525, 0.4575]);
  });
  it('the grove weight is never touched, and a rock texel at its mean (Lr 1) makes no joints', () => {
    const out = stageOf(field(63.75, 128, NEUTRAL_B))({ weights: [[0], [0], [0], [1], [0]], factors: FACTORS, vertexTone: [0.5, 0.4, 0.3] });
    expect(out.weights.map((x) => x[0])).toEqual([0, 0, 0, 1, 0]);
    expect(out.vertexTone).toEqual([0.5, 0.4, 0.3]);
  });
  it('joints: Lr 0.925 gives e 0.455, j 0.2275, and the tone ends toward mix(rock tone, joint tone, 0.6) = (0.6, 0.36, 0.42) at weight 0.2275 x 0.7', () => {
    const f: V[] = [FACTORS[0] as V, grey(0.925), grey(1), grey(1), grey(1)];
    const out = stageOf(field(63.75, 128, NEUTRAL_B))({ weights: [[0.4], [0.1], [0.2], [0.1], [0.2]], factors: f, vertexTone: [0.5, 0.4, 0.3] });
    [0.218, 0.4185, 0.1545, 0.1, 0.109].forEach((want, i) => expect(out.weights[i]?.[0], `weight ${i}`).toBeCloseTo(want, 9));
    close(out.vertexTone, [0.47575816875, 0.43379683125, 0.43961049375]);
  });
  it('the low tier builds no joints: the same fragment ends on the rock mix alone', () => {
    const f: V[] = [FACTORS[0] as V, grey(0.925), grey(1), grey(1), grey(1)];
    const out = stageOf(field(63.75, 128, NEUTRAL_B), knobs(), { textureEdge: false, joints: false })({
      weights: [[0.4], [0.1], [0.2], [0.1], [0.2]], factors: f, vertexTone: [0.5, 0.4, 0.3],
    });
    close(out.vertexTone, [0.4475, 0.4525, 0.4575]);
  });
  it('a hollow (G byte 77, 0.4 below the mean, flat): the open factor softens toward 1 by kH x mH, the tone fills toward the hollow colour', () => {
    const out = stageOf(field(0, 77, NEUTRAL_B))({ weights: [[0.5], [0.1], [0.2], [0.1], [0.1]], factors: FACTORS, vertexTone: [0.5, 0.4, 0.3] });
    // h = 1, soil = 0.7, mH = 0.7: factor 1.2 -> 1.2 + (1 - 1.2) x 0.4 x 0.7 = 1.144, 0.8 -> 0.856, 1 -> 1.
    close(out.factors[0] as V, [1.144, 0.856, 1]);
    expect(out.weights.map((x) => x[0])).toEqual([0.5, 0.1, 0.2, 0.1, 0.1]);
    // tone = mix(vertex, hollow, 0.45 x 0.7 = 0.315).
    close(out.vertexTone, [0.374, 0.3055, 0.363]);
  });
  it('a flat field returns weights, factors and tone bit for bit, on factors where 1 + (f - 1) is not f (0.3, 0.1)', () => {
    const inp = { weights: [[0.4], [0.1], [0.2], [0.1], [0.2]] as V[], factors: [[0.3, 0.1, 0.7], grey(0.3), grey(0.1), grey(0.7), grey(0.9)] as V[], vertexTone: [0.5, 0.4, 0.3] as V };
    const out = stageOf(field(0, 128, 128))(inp);
    expect(out.weights).toEqual(inp.weights);
    expect(out.factors).toEqual(inp.factors);
    expect(out.vertexTone).toEqual(inp.vertexTone);
  });
  it('amp 0 hides the layer: every output equals its input, bit for bit, on a steep fragment', () => {
    const inp = { weights: [[0.4], [0.1], [0.2], [0.1], [0.2]] as V[], factors: FACTORS, vertexTone: [0.5, 0.4, 0.3] as V };
    const out = stageOf(field(200, 77, 200), knobs({ amp: [0] }))(inp);
    expect(out.weights).toEqual(inp.weights);
    expect(out.factors).toEqual(inp.factors);
    expect(out.vertexTone).toEqual(inp.vertexTone);
  });
  it('refuses a slot count other than five', () => {
    expect(() => stageOf(field(0, 128, 128))({ weights: [[1]], factors: [grey(1)], vertexTone: [0, 0, 0] })).toThrow(/five slots/);
  });
});

describe('heightBlendTone: the tone half the decal twin divides by (Lr = 1: no texture edge, no joints)', () => {
  it('matches the stage tone at the same texel when the rock slot reads its mean', () => {
    const f = field(63.75, 128, NEUTRAL_B);
    close(heightBlendTone(VEC, [0.5, 0.4, 0.3], f, [0.7], knobs()), [0.4475, 0.4525, 0.4575]);
    close(heightBlendTone(VEC, [0.5, 0.4, 0.3], field(0, 77, NEUTRAL_B), [0.7], knobs()), [0.374, 0.3055, 0.363]);
  });
  it('is the base tone on flat ground, bit for bit, and at amp 0 or soil 0 on a steep one', () => {
    expect(heightBlendTone(VEC, [0.5, 0.4, 0.3], field(0, 128, NEUTRAL_B), [1], knobs())).toEqual([0.5, 0.4, 0.3]);
    expect(heightBlendTone(VEC, [0.5, 0.4, 0.3], field(200, 200, 30), [1], knobs({ amp: [0] }))).toEqual([0.5, 0.4, 0.3]);
    expect(heightBlendTone(VEC, [0.5, 0.4, 0.3], field(200, 200, 30), [0], knobs())).toEqual([0.5, 0.4, 0.3]);
  });
  it('a fully exposed soil texel (R byte 255 is 64 degrees, e 1, soil 1) goes to the rock tone at its amplitude 0.75', () => {
    const t = heightBlendTone(VEC, [0.5, 0.4, 0.3], field(255, 128, 255), [1], knobs({ amp: [1] }));
    // e = 1 (the patch factor only raises it, and it clamps), mE = 1 -> mix(vertex, rock, 0.75).
    close(t, [0.5 + (0.3 - 0.5) * 0.75, 0.4 + (0.6 - 0.4) * 0.75, 0.3 + (0.9 - 0.3) * 0.75]);
  });
});

describe('the flat identity: the stage adds exactly 0 (bit equality with the stage-absent groundBlend)', () => {
  /** Every slot at its mean EXCEPT the rock texel, which is brighter (ratio 1.6 > 1, so Lr > 1 and a texture edge that forgot its
   *  exposure factor would be non-zero), and a darker one (Lr < 1) for the other side. */
  function taps(over: Partial<GroundTaps<V>>, rock = 0.8, open = 0.6): GroundTaps<V> {
    return {
      vertexTone: [0.5, 0.4, 0.3],
      wall: [-1],
      slotTexels: [grey(open), grey(rock), grey(0.5), grey(0.5), grey(0.55)],
      controlA: [[0.5], [0.2], [0.2], [0.1]],
      controlB: [[0.3], [1], [1], [0.5]],
      grainTexel: grey(0.5),
      macroTexel: [128 / 255],
      ...over,
    };
  }
  const gk: GroundKnobs<V> = {
    strengths: [[1], [1], [1], [1], [1]],
    means: [grey(0.5), grey(0.5), grey(0.5), grey(0.5), grey(0.5)],
    grainMean: grey(0.5), roadOn: [1], grainGain: [0.5],
    roadTone: [0.7, 0.6, 0.5], shoulderTone: [0.9, 0.9, 0.9], rutTone: [0.2, 0.2, 0.2],
    macroAmp: [1], macroBright: [1.2, 1, 0.8], macroDark: [0.8, 1, 1.2],
  };
  const fragments: Record<string, Partial<GroundTaps<V>>> = {
    'open mix with soil, rock and knoll weights': {},
    'a road edge (B.g 0.4)': { controlB: [[0.3], [0.4], [1], [0.5]] },
    'a ridge top (rock weight 1, no soil)': { controlA: [[0], [1], [0], [0]], controlB: [[0], [1], [1], [0.5]] },
    'a wall (rock weight 0.7, not a top)': { wall: [0.7] },
    'pure scrub': { controlA: [[0], [0], [1], [0]], controlB: [[0], [1], [1], [0.5]] },
  };
  // The PLACEHOLDER field, from its bytes: R 0, G 128, B 128.
  const placeholder = field(0, 128, 128);
  for (const [name, over] of Object.entries(fragments)) {
    // The open texel 0.15 is a ratio of 0.3 (and 0.05 of 0.1): `1 + (f - 1)` is NOT f for those, so the softening has to be written
    // `mix(f, 1, k)` to return f bit for bit. The rock texels are brighter and darker than the mean.
    for (const [rock, open] of [[0.8, 0.6], [0.3, 0.15], [0.8, 0.05]] as const) {
      it(`${name}, rock texel ${rock}, open texel ${open}: colour and top equal the stage-absent blend exactly`, () => {
        const plain = groundBlend(VEC, BV, 1, taps(over, rock, open), gk);
        const staged = groundBlend(VEC, BV, 1, taps(over, rock, open), gk, stageOf(placeholder));
        expect(staged.colour).toEqual(plain.colour);
        expect(staged.top).toEqual(plain.top);
      });
    }
  }
  it('is live: a 16-degree bank on the same open fragment DOES move the colour', () => {
    const plain = groundBlend(VEC, BV, 1, taps({}), gk);
    const staged = groundBlend(VEC, BV, 1, taps({}), gk, stageOf(field(63.75, 128, NEUTRAL_B)));
    expect(staged.colour).not.toEqual(plain.colour);
  });
  it('with no stage the blend is the five-argument one: groundBlend takes its stage as an optional sixth', () => {
    expect(groundBlend(VEC, BV, 1, taps({}), gk, undefined).colour).toEqual(groundBlend(VEC, BV, 1, taps({}), gk).colour);
  });
  it('the softened open factor reaches the albedo: with no tone change (aH 0) a hollow still moves the colour, toward 1', () => {
    const k = knobs({ hollowAmp: [0] });
    const plain = groundBlend(VEC, BV, 1, taps({}), gk);
    const staged = groundBlend(VEC, BV, 1, taps({}), gk, stageOf(field(0, 77, NEUTRAL_B), k));
    expect(staged.colour).not.toEqual(plain.colour);
    // the open texel is 0.6 over a 0.5 mean (ratio 1.2) at weight ~0.5: softening pulls it down toward 1, so the colour darkens.
    expect(staged.colour[0]).toBeLessThan(plain.colour[0] as number);
  });
  it('the seam: a stage that moves only the TONE, only the FACTORS or only the WEIGHTS reaches the colour in each case', () => {
    const plain = groundBlend(VEC, BV, 1, taps({}), gk).colour;
    const toneOnly = groundBlend(VEC, BV, 1, taps({}), gk, ({ weights, factors }) => ({ weights, factors, vertexTone: [0.25, 0.2, 0.15] })).colour;
    close(toneOnly, plain.map((c) => c * 0.5), 9);
    const factorsOnly = groundBlend(VEC, BV, 1, taps({}), gk, ({ weights, vertexTone }) => ({ weights, factors: [grey(1), grey(1), grey(1), grey(1), grey(1)], vertexTone })).colour;
    expect(factorsOnly).not.toEqual(plain);
    const weightsOnly = groundBlend(VEC, BV, 1, taps({}), gk, ({ factors, vertexTone }) => ({ weights: [[0], [0], [0], [0], [0]], factors, vertexTone })).colour;
    expect(weightsOnly).not.toEqual(plain);
  });
  it('a stage may not change the slot count', () => {
    expect(() => groundBlend(VEC, BV, 1, taps({}), gk, ({ weights, factors, vertexTone }) => ({ weights: weights.slice(1), factors, vertexTone }))).toThrow(/stage must return/);
  });
});

describe('the approved palette keys (decisions 3 and 4)', () => {
  it('highland: karst.1 at 0.75, terracotta.1 joints at 0.6, terracotta.1 hollows at 0.45, softening 0.4', () => {
    const h = HEIGHT_BLEND_THEMES.highland;
    expect([h.rock.key, h.rock.amplitude]).toEqual(['karst.1', 0.75]);
    expect([h.joint?.key, h.joint?.amplitude]).toEqual(['terracotta.1', 0.6]);
    expect([h.hollow.key, h.hollow.amplitude, h.soften]).toEqual(['terracotta.1', 0.45, 0.4]);
  });
  it('arid: karst.0 at 0.7, no joints, loess limestone.4 hollows at 0.6, softening 0.5', () => {
    const a = HEIGHT_BLEND_THEMES.arid;
    expect([a.rock.key, a.rock.amplitude]).toEqual(['karst.0', 0.7]);
    expect(a.joint).toBeUndefined();
    expect([a.hollow.key, a.hollow.amplitude, a.soften]).toEqual(['limestone.4', 0.6, 0.5]);
  });
  it('wetland and green have no entry (v1)', () => {
    expect(Object.keys(HEIGHT_BLEND_THEMES).sort()).toEqual(['arid', 'highland']);
  });
});
