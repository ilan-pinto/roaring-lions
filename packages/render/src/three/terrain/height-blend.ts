/**
 * GH-1226 (S1): height- and slope-based ground blending, the MATHS and the CONSTANTS only. Nothing here draws: no renderer wiring,
 * no field bake (S2), no record (S4). Design: `docs/superpowers/specs/2026-11-12-gh1226-height-blend-design.md` (sections 2 and 3.2;
 * the lead approved every default on 12 Nov 2026).
 *
 * Written ONCE against `Ops<T>` (`../fog-ops.ts`), like `ground-maths.ts`: the CPU tests run it on `NUMBER_OPS`, and the node
 * ground (S4) will run it on TSL nodes. A leaf: it imports `macroDecode` and two types from `ground-maths.ts` and nothing else.
 * Presentation only. Nothing here is read by the sim.
 *
 * The stage's per-fragment inputs are the FIELD texel (R slope byte, G tpi byte, B patch byte, each 0..1 as sampled; S2 bakes it)
 * and the rock slot's strength-mixed ratio. The tones are palette KEYS below, resolved by the app and handed over LINEAR (S5).
 *
 * Flat ground contributes exactly 0: slope byte 0 and tpi byte 128 give `eRaw` = 0, hence e = j = h = 0, and every update is
 * written so a 0 mask returns its input BIT for BIT (`mix(x, y, 0)`, `w - w * 0`, `f + (1 - f) * 0`). The softening is therefore
 * written `mix(f, 1, kH * mH)`, not the algebraically equal `mix(1, f, 1 - kH * mH)`, which returns `1 + (f - 1)` and is not f.
 */
import type { Ops } from '../fog-ops';
import { macroDecode, type GroundStage, type BlendVec } from './ground-maths';

// -- The thresholds (design 2.2; decision 5) ---------------------------------------------------------------------------------

/** Exposure from slope: 0 at 10 degrees, 1 at 22 (a one-level step is about 14 degrees). */
export const SLOPE_EXPOSURE_LO_DEG = 10;
export const SLOPE_EXPOSURE_HI_DEG = 22;
/** Crest: + 0.6 x smoothstep(0.15, 0.45) level above the 1.5-tile mean. */
export const CREST_GAIN = 0.6;
export const CREST_LO_LEVELS = 0.15;
export const CREST_HI_LEVELS = 0.45;
/** Patch noise: exposure x (1 + 0.5 x (2n - 1)); mean factor 1. */
export const PATCH_AMPLITUDE = 0.5;
/** Texture edge: the exposure biased by the rock texel's luminance ratio, at this gain, in `heightBiased`'s form. */
export const TEXTURE_EDGE_GAIN = 0.6;
/** Joints: where the rock image's luminance ratio is below 0.85-1.00 (smoothstep): 20-32% of exposed rock across the zoom range. */
export const JOINT_RATIO_LO = 0.85;
export const JOINT_RATIO_HI = 1.0;
/** Hollow: smoothstep(0.12, 0.40) level BELOW the 1.5-tile mean, cut to 0 on slopes from 8 to 16 degrees, and never under rock. */
export const HOLLOW_LO_LEVELS = 0.12;
export const HOLLOW_HI_LEVELS = 0.4;
export const HOLLOW_SLOPE_CUT_LO_DEG = 8;
export const HOLLOW_SLOPE_CUT_HI_DEG = 16;
/** The scrub weight's share that counts as soil (soil = open + knoll + half of scrub). */
export const SCRUB_SOIL_SHARE = 0.5;

// -- The field's encoding (S2 bakes it; fixed here so the decode and the bake cannot drift) -------------------------------------

/** The slope byte is `round(theta / 64 x 255)`: a quarter degree a step. */
export const SLOPE_BYTE_RANGE_DEG = 64;
/** The patch noise: `fbm2`, 2 octaves, a 3-tile period, this seed. */
export const HEIGHT_BLEND_PATCH_SEED = 1226;
export const PATCH_PERIOD_TILES = 3;
export const PATCH_OCTAVES = 2;
/** Field texels a tile, and the TPI's box (1.5 tiles, odd): 13 x 13 texels. */
export const HEIGHT_FIELD_TEXELS_PER_TILE = 4;
export const TPI_BOX_TEXELS = 13;

// -- The tones: palette KEYS only, never a hex (design 2.2; decisions 3 and 4) -------------------------------------------------

/** One tone: a `data/palette.json` key and the amplitude it is mixed over the ground it replaces. */
export interface HeightBlendTone {
  readonly key: string;
  readonly amplitude: number;
}
export interface HeightBlendTheme {
  readonly rock: HeightBlendTone;
  /** Absent: no joints (arid). */
  readonly joint?: HeightBlendTone;
  readonly hollow: HeightBlendTone;
  /** How much of the open slot's texture detail the hollow softens away (`kH`). */
  readonly soften: number;
}

/** v1 covers highland and arid-with-relief only; `wetland` and `green` are out (decision 1), Rujm Sawda opts out per map (decision 2). */
export const HEIGHT_BLEND_THEMES: { readonly highland: HeightBlendTheme; readonly arid: HeightBlendTheme } = {
  highland: {
    rock: { key: 'karst.1', amplitude: 0.75 },
    joint: { key: 'terracotta.1', amplitude: 0.6 },
    hollow: { key: 'terracotta.1', amplitude: 0.45 },
    soften: 0.4,
  },
  arid: {
    rock: { key: 'karst.0', amplitude: 0.7 },
    hollow: { key: 'limestone.4', amplitude: 0.6 },
    soften: 0.5,
  },
};

// -- The maths -------------------------------------------------------------------------------------------------------------

/** The field texel as sampled (each channel 0..1): R slope byte, G tpi byte, B patch byte. */
export type HeightBlendField<T> = readonly [T, T, T];

/** The record's values, as the stage reads them. `amp` is the debug and preset amplitude (1 shipped, 0 hides the layer). */
export interface HeightBlendKnobs<T> {
  /** rgb, LINEAR. */
  readonly rockTone: T;
  readonly jointTone: T;
  readonly hollowTone: T;
  /** `aR`, `aJ`, `aH`: the amplitudes. */
  readonly rockAmp: T;
  readonly jointAmp: T;
  readonly hollowAmp: T;
  /** `kH`. */
  readonly soften: T;
  readonly amp: T;
}

/** What `low` leaves out (a graph choice made at build time, not a uniform): the texture edge and the joints. */
export interface HeightBlendOptions {
  readonly textureEdge: boolean;
  readonly joints: boolean;
}
export const HEIGHT_BLEND_FULL: HeightBlendOptions = { textureEdge: true, joints: true };

/** The three masks of one fragment. `exposure` is `e`, `joint` is `j`, `hollow` is `h`; `eRaw` and `eP` are kept for the tests. */
export interface HeightBlendMasks<T> {
  readonly eRaw: T;
  readonly eP: T;
  readonly exposure: T;
  readonly joint: T;
  readonly hollow: T;
}

/**
 * `eRaw`, patch, texture edge, joints and hollow from the decoded field: `s` degrees, `t` levels, `n` 0..1, and `lr`, the rock
 * slot's luminance ratio (pass 1 for "no texture": the tone half and the decal twin do). With `textureEdge` false the exposure is
 * the patched one; with `joints` false `j` is 0.
 */
export function heightBlendMasks<T>(
  o: Ops<T>,
  s: T,
  t: T,
  n: T,
  lr: T,
  options: HeightBlendOptions = HEIGHT_BLEND_FULL
): HeightBlendMasks<T> {
  const lit = o.lit;
  const one = lit(1);
  const slope = o.smoothstep(lit(SLOPE_EXPOSURE_LO_DEG), lit(SLOPE_EXPOSURE_HI_DEG), s);
  const crest = o.mul(lit(CREST_GAIN), o.smoothstep(lit(CREST_LO_LEVELS), lit(CREST_HI_LEVELS), t));
  const eRaw = o.clamp01(o.add(slope, crest));
  const patch = o.add(one, o.mul(lit(PATCH_AMPLITUDE), o.sub(o.mul(lit(2), n), one)));
  const eP = o.clamp01(o.mul(eRaw, patch));
  const exposure = options.textureEdge
    ? o.clamp01(o.add(eP, o.mul(o.mul(o.mul(o.mul(lit(TEXTURE_EDGE_GAIN), o.sub(lr, one)), lit(4)), eP), o.sub(one, eP))))
    : eP;
  const joint = options.joints
    ? o.mul(exposure, o.sub(one, o.smoothstep(lit(JOINT_RATIO_LO), lit(JOINT_RATIO_HI), lr)))
    : lit(0);
  const hollowDepth = o.smoothstep(lit(HOLLOW_LO_LEVELS), lit(HOLLOW_HI_LEVELS), o.sub(lit(0), t));
  const flat = o.sub(one, o.smoothstep(lit(HOLLOW_SLOPE_CUT_LO_DEG), lit(HOLLOW_SLOPE_CUT_HI_DEG), s));
  const hollow = o.mul(o.mul(hollowDepth, flat), o.sub(one, exposure));
  return { eRaw, eP, exposure, joint, hollow };
}

/** The field texel to `s` (degrees: the byte is theta / 64 x 255, so a sampled 0..1 channel times 64), `t`, `t` (levels, via the macro field's own decode) and `n` (0..1). */
function decodeField<T>(o: Ops<T>, field: HeightBlendField<T>): { s: T; t: T; n: T } {
  return { s: o.mul(field[0], o.lit(SLOPE_BYTE_RANGE_DEG)), t: macroDecode(o, field[1]), n: field[2] };
}

/**
 * The tone half: the vertex tone mixed toward the hollow tone and the rock tone, with no texture edge and no joints (`lr` = 1).
 * It is what the node decal twin divides by (design 3.4), so a crater's lip keeps the colour the ground drew. `soil` is the
 * caller's soil weight at that point (after the rescale, before the road): the decal twin has the controls, this function does not.
 */
export function heightBlendTone<T>(
  o: Ops<T>,
  baseTone: T,
  field: HeightBlendField<T>,
  soil: T,
  k: HeightBlendKnobs<T>
): T {
  const { s, t, n } = decodeField(o, field);
  const m = heightBlendMasks(o, s, t, n, o.lit(1), { textureEdge: false, joints: false });
  const mE = o.mul(o.mul(k.amp, m.exposure), soil);
  const mH = o.mul(o.mul(k.amp, m.hollow), soil);
  const withHollow = o.mix(baseTone, k.hollowTone, o.mul(k.hollowAmp, mH));
  return o.mix(withHollow, k.rockTone, o.mul(k.rockAmp, mE));
}

/**
 * The stage `groundBlend` runs between the rescale and the road. Weights are in `GROUND_SLOTS` order: open, rock, scrub, grove,
 * knoll. Open, knoll and half the scrub give up the fraction `amp x e` of themselves to the rock slot (the sum is unchanged); the
 * open slot's factor is softened toward 1 in hollows; the tone is the chain `tone <- mix(mix(mix(vertexTone, hollow, aH mH),
 * rock, aR mE), joint, aJ mJ)`. `v.luma` gives the rock slot's luminance ratio `Lr`.
 */
export function heightBlendStage<T>(
  o: Ops<T>,
  v: BlendVec<T>,
  field: HeightBlendField<T>,
  k: HeightBlendKnobs<T>,
  options: HeightBlendOptions = HEIGHT_BLEND_FULL
): GroundStage<T> {
  return ({ weights, factors, vertexTone }) => {
    if (weights.length !== 5 || factors.length !== 5) {
      throw new Error(`heightBlendStage: five slots expected, got ${weights.length} weights and ${factors.length} factors`);
    }
    const [wOpen, wRock, wScrub, wGrove, wKnoll] = weights as readonly [T, T, T, T, T];
    const { s, t, n } = decodeField(o, field);
    const m = heightBlendMasks(o, s, t, n, v.luma(factors[1] as T), options);
    const scrubHalf = o.lit(SCRUB_SOIL_SHARE);
    const soil = o.add(o.add(wOpen, wKnoll), o.mul(scrubHalf, wScrub));
    const ae = o.mul(k.amp, m.exposure);
    const mE = o.mul(ae, soil);
    const mH = o.mul(o.mul(k.amp, m.hollow), soil);
    const giveOpen = o.mul(wOpen, ae);
    const giveKnoll = o.mul(wKnoll, ae);
    const giveScrub = o.mul(o.mul(scrubHalf, wScrub), ae);
    const movedWeights: readonly T[] = [
      o.sub(wOpen, giveOpen),
      o.add(wRock, o.add(o.add(giveOpen, giveKnoll), giveScrub)),
      o.sub(wScrub, giveScrub),
      wGrove,
      o.sub(wKnoll, giveKnoll),
    ];
    const movedFactors = factors.map((f, i) => (i === 0 ? o.mix(f, v.one3, o.mul(k.soften, mH)) : f));
    let tone = o.mix(vertexTone, k.hollowTone, o.mul(k.hollowAmp, mH));
    tone = o.mix(tone, k.rockTone, o.mul(k.rockAmp, mE));
    if (options.joints) tone = o.mix(tone, k.jointTone, o.mul(k.jointAmp, o.mul(o.mul(k.amp, m.joint), soil)));
    return { weights: movedWeights, factors: movedFactors, vertexTone: tone };
  };
}
