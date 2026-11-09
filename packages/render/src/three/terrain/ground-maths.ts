/**
 * GH-943 WebGPU P2 (T3): the ground blend's arithmetic, written ONCE against `Ops<T>` (`../fog-ops.ts`).
 *
 * The CPU mirrors run it through `NUMBER_OPS` (`road-graph.ts`'s `roadProfile`, `control-map.ts`'s `heightBiased` and
 * `macroFactor`), and the node ground (`mesh.node.ts`) receives it as VALUES through `MATERIAL_MATHS.ground` and runs it on TSL
 * nodes. The legacy GLSL (`mesh.ts`'s `GROUND_BLEND_GLSL`) keeps its own text, pinned to the constants below by `mesh.test.ts`.
 *
 * The constants of the road's cross-section, the height blend and the macro field live HERE, and `road-graph.ts` and
 * `control-map.ts` re-export them under their old names: this file is a leaf (it imports only a type), so neither of those two
 * modules is pulled into an import cycle by calling the maths it shares.
 *
 * three-free and import-free (one type). Presentation only. Nothing here is read by the sim.
 */
import type { Ops } from '../fog-ops';

// -- The road's cross-section (spec §5; `road-graph.ts` re-exports these) ----------------------------------------------------

/** Half the packed-surface width, in tiles either side of the centreline. */
export const ROAD_HALF_WIDTH = 0.36;
/** Width, in tiles, the surface edge softens across -- centred on
 *  `ROAD_HALF_WIDTH`, so it runs from `H - F/2` to `H + F/2`. */
export const ROAD_EDGE_FALLOFF = 0.18;
/** How far, in tiles, a wander signal (`bend`, typically an `fbm2` sample at
 *  `ROAD_EDGE_BEND_CYCLES`) can push the edge in or out. Keeps a long road's
 *  edge from reading as a perfectly straight ruler line. */
export const ROAD_EDGE_BEND = 0.08;

/** Width, in tiles, of the bleached shoulder band just past the surface
 *  edge. */
export const SHOULDER_TILES = 0.12;
/** The shoulder's peak strength, at the surface edge itself. */
export const SHOULDER_ALPHA = 0.4;

/** Distance, in tiles either side of the centreline, of each wheel rut. */
export const RUT_OFFSET = 0.17;
/** Width, in tiles, of one rut. */
export const RUT_WIDTH = 0.06;
/** A rut's peak strength, away from any junction. */
export const RUT_ALPHA = 0.35;
/** Distance, in tiles, over which the ruts fade in as a query point moves
 *  away from a junction -- what keeps a crossroads from drawing four
 *  ruts as concentric rings through its own centre. */
export const RUT_JUNCTION_FADE = 0.4;

// -- The height blend and the macro field (`control-map.ts` re-exports these) ----------------------------------------------

/** How strongly a tile's OWN blend weight is pulled toward 1 (and its
 *  neighbours' pulled toward 0) by a favourable relative height, at the
 *  midpoint of the blend (`w = 0.5`) where the pull is strongest. Zero at
 *  `w = 0` and `w = 1`: a tile that already owns the whole texel, or none of
 *  it, has nothing left to gain from height. */
export const HEIGHT_BLEND = 0.15;
/** Maximum luminance swing the macro field can apply, at `m = +/-1` and
 *  amplitude 1 -- see `macroFactor`. */
export const MACRO_LUMINANCE = 0.07;
/** Maximum hue-mix weight the macro field can apply toward its bright/dark
 *  tint, at `|m| = 1` and amplitude 1 -- see `macroFactor`. */
export const MACRO_HUE = 0.04;

// -- The maths -------------------------------------------------------------------------------------------------------------

/** The road's three bands at one point (`road-graph.ts`'s `RoadProfile` is `RoadBands<number>`). */
export interface RoadBands<T> {
  /** 1 on packed road surface, fading to 0 past the edge. */
  readonly surface: T;
  /** 0..`SHOULDER_ALPHA`, a bleached band just past the surface edge. */
  readonly shoulder: T;
  /** 0..`RUT_ALPHA`, the two wheel-track darkenings, faded near a junction. */
  readonly rut: T;
}

/**
 * The road's cross-section at perpendicular distance `d` (tiles, `>= 0`: both physical ruts read the same unsigned distance) from
 * the centreline, bent by `bend` (a signed wander sample) and faded near a junction by `junctionDist` (tiles).
 *
 * Ruts read the UNBENT `d` rather than the bent edge `e`: they are worn by traffic following the centreline, not by whatever noise
 * wobbles the surface's outer edge. The derived band edges are folded from the constants here once, in JavaScript, on both paths.
 * The rut carries the surface, unscaled by the road switch or the top mask; a caller that scales the surface scales the rut too.
 */
export function roadBands<T>(o: Ops<T>, d: T, bend: T, junctionDist: T): RoadBands<T> {
  const e = o.add(d, o.mul(o.lit(ROAD_EDGE_BEND), bend));
  const edgeLo = ROAD_HALF_WIDTH - ROAD_EDGE_FALLOFF / 2;
  const edgeHi = ROAD_HALF_WIDTH + ROAD_EDGE_FALLOFF / 2;
  const edgeT = o.smoothstep(o.lit(edgeLo), o.lit(edgeHi), e);
  const surface = o.sub(o.lit(1), edgeT);

  const shoulderT = o.sub(o.lit(1), o.smoothstep(o.lit(edgeHi), o.lit(edgeHi + SHOULDER_TILES), e));
  const shoulder = o.mul(o.mul(o.lit(SHOULDER_ALPHA), edgeT), shoulderT);

  const rutLo = RUT_WIDTH / 2 - 0.01;
  const rutHi = RUT_WIDTH / 2 + 0.01;
  const rutBand = o.sub(o.lit(1), o.smoothstep(o.lit(rutLo), o.lit(rutHi), o.abs(o.sub(d, o.lit(RUT_OFFSET)))));
  const junctionFade = o.smoothstep(o.lit(0), o.lit(RUT_JUNCTION_FADE), junctionDist);
  const rut = o.mul(o.mul(o.mul(o.lit(RUT_ALPHA), rutBand), junctionFade), surface);

  return { surface, shoulder, rut };
}

/**
 * One blend weight's height bias, before the rescale: `max(0, w + HEIGHT_BLEND * h * 4 * w * (1 - w))`. `h` is the relative
 * height (the GLSL's `rlHeightBiased` passes the Rec. 709 luminance deviation of the strength-scaled texel ratio). Exactly 0 change
 * at `w = 0` and `w = 1`, so a tile interior is untouched.
 */
export function heightBiased<T>(o: Ops<T>, w: T, h: T): T {
  const pull = o.mul(o.mul(o.mul(o.mul(o.lit(HEIGHT_BLEND), h), o.lit(4)), w), o.sub(o.lit(1), w));
  return o.max(o.lit(0), o.add(w, pull));
}

/**
 * The rescale after the bias: every biased weight `b_i` scaled by `sum(w) / sum(b)`, so the bias neither invents nor destroys
 * weight. Where every biased weight collapsed to 0 (only possible if every input weight was already 0), the weights are returned
 * as they were (`sum(b) > 0 ? b_i * scale : w_i`), branch-free.
 */
export function rescaleWeights<T>(o: Ops<T>, w: readonly T[], b: readonly T[]): T[] {
  if (w.length !== b.length || w.length === 0) throw new Error(`rescaleWeights: ${w.length} weights against ${b.length} biased`);
  const sum = (xs: readonly T[]): T => xs.slice(1).reduce((acc, x) => o.add(acc, x), xs[0] as T);
  const wantSum = sum(w);
  const rawSum = sum(b);
  const scale = o.div(wantSum, rawSum);
  return b.map((bi, i) => o.selectLt(o.lit(0), rawSum, o.mul(bi, scale), w[i] as T));
}

/** The macro field's byte decode, the EXACT inverse of its `round(128 + 127 v)` encoding: `(r * 255 - 128) / 127`, where `r` is
 *  the sampled 0..1 texel. The 1x1 default of 128 decodes to exactly 0. */
export function macroDecode<T>(o: Ops<T>, r: T): T {
  return o.div(o.sub(o.mul(r, o.lit(255)), o.lit(128)), o.lit(127));
}

/**
 * The multiplier the macro field applies at a texel reading `m` (in `[-1, 1]`, 0 neutral) under amplitude `amp`, for ONE channel
 * (or, on nodes, all three at once) whose bright and dark tints are `bright` and `dark`:
 * `(1 + MACRO_LUMINANCE * m * amp) * (1 + MACRO_HUE * |m| * amp * ((m >= 0 ? bright : dark) - 1))`. Neutral at `m = 0` or `amp = 0`.
 */
export function macroFactor<T>(o: Ops<T>, m: T, amp: T, bright: T, dark: T): T {
  const luminance = o.add(o.lit(1), o.mul(o.mul(o.lit(MACRO_LUMINANCE), m), amp));
  const hueWeight = o.mul(o.mul(o.lit(MACRO_HUE), o.abs(m)), amp);
  const tint = o.selectLt(m, o.lit(0), dark, bright);
  return o.mul(luminance, o.add(o.lit(1), o.mul(hueWeight, o.sub(tint, o.lit(1)))));
}

// -- The blend's composition (T3 fix round) ---------------------------------------------------------------------------------

/** What the composition needs beyond `Ops<T>`: a Rec. 709 luminance of an rgb value (a scalar) and the rgb constant (1, 1, 1). */
export interface BlendVec<T> {
  luma(rgb: T): T;
  readonly one3: T;
}

/** The sampled inputs of one ground fragment. rgb values are `T` vectors; channels are passed one by one. */
export interface GroundTaps<T> {
  /** The vertex palette tone (rgb). */
  readonly vertexTone: T;
  /** The `wallAlbedo` attribute: -1 on a top, else the wall's rock weight. */
  readonly wall: T;
  /** Each slot's texel at its own repeat (rgb), in `GROUND_SLOTS` order: open, rock, scrub, grove, knoll. */
  readonly slotTexels: readonly T[];
  /** Control A (open, rock, scrub, grove weights) and control B (knoll weight, road distance, junction distance, edge bend). */
  readonly controlA: readonly [T, T, T, T];
  readonly controlB: readonly [T, T, T, T];
  /** The knoll image at the road grain's uv (rgb). */
  readonly grainTexel: T;
  /** The macro field's red channel, 0..1. */
  readonly macroTexel: T;
}

/** The uniform record's values the composition reads. */
export interface GroundKnobs<T> {
  /** Per slot, in `GROUND_SLOTS` order. */
  readonly strengths: readonly T[];
  readonly means: readonly T[];
  /** The knoll image's mean (the grain's divisor). */
  readonly grainMean: T;
  readonly roadOn: T;
  readonly grainGain: T;
  readonly roadTone: T;
  readonly shoulderTone: T;
  readonly rutTone: T;
  readonly macroAmp: T;
  readonly macroBright: T;
  readonly macroDark: T;
}

/**
 * The dry ground blend after the taps, in the legacy `GROUND_BLEND_GLSL` order: slot ratios mixed from 1 by strength; the five
 * weights from controls A/B (`top = step(wall, -0.5)`; a wall ignores the map and takes its rock weight); height bias and rescale;
 * the road bands from control B's distance (G), junction distance (B) and bend (A), gated by the road switch AND the top mask; the
 * surface takes the weights beneath it down and adds its grain term; the tones mixed into the vertex colour; then albedo x macro.
 * Returns the colour (rgb) and `top` (the relief read applies on tops only). `roadRangeTiles` is `ROAD_DISTANCE_RANGE_TILES`.
 * Written once: the node ground runs it on TSL nodes, the tests on number vectors.
 */
export function groundBlend<T>(
  o: Ops<T>,
  v: BlendVec<T>,
  roadRangeTiles: number,
  taps: GroundTaps<T>,
  k: GroundKnobs<T>
): { readonly colour: T; readonly top: T } {
  const one = v.one3;
  const lit = o.lit;
  if (taps.slotTexels.length !== 5 || k.strengths.length !== 5 || k.means.length !== 5) {
    throw new Error(`groundBlend: five slots expected, got ${taps.slotTexels.length} texels`);
  }
  // Slot factors: the texel as a ratio to its mean, mixed from 1 by the strength.
  const factors = taps.slotTexels.map((t, i) => o.mix(one, o.div(t, k.means[i] as T), k.strengths[i] as T));
  // The five weights. A wall ignores the map.
  const [aR, aG, aB, aA] = taps.controlA;
  const [bR, bG, bB, bA] = taps.controlB;
  const top = o.step(taps.wall, lit(-0.5));
  const w = [
    o.mul(top, aR),
    o.add(o.mul(top, aG), o.mul(o.sub(lit(1), top), o.max(taps.wall, lit(0)))),
    o.mul(top, aB),
    o.mul(top, aA),
    o.mul(top, bR),
  ];
  // Height bias by each weight's own strength-scaled texel luminance deviation, then the rescale.
  const biased = w.map((wi, i) => heightBiased(o, wi, o.sub(v.luma(factors[i] as T), lit(1))));
  const weights = rescaleWeights(o, w, biased);
  // The road.
  const range = lit(roadRangeTiles);
  const bands = roadBands(o, o.mul(bG, range), o.sub(o.mul(bA, lit(2)), lit(1)), o.mul(bB, range));
  const gate = o.mul(k.roadOn, top);
  const surf = o.mul(gate, bands.surface);
  const shoulder = o.mul(gate, bands.shoulder);
  const grain = o.div(taps.grainTexel, k.grainMean);
  const rut = o.mul(o.mul(bands.rut, gate), o.smoothstep(lit(0.85), lit(1.05), v.luma(grain)));
  const grainTerm = o.mul(surf, o.sub(o.mix(one, grain, k.grainGain), one));
  const offRoad = o.sub(lit(1), surf);
  // The tones into the vertex colour, then albedo x macro.
  let tone = o.mix(taps.vertexTone, k.roadTone, surf);
  tone = o.mix(tone, k.shoulderTone, shoulder);
  tone = o.mix(tone, k.rutTone, rut);
  let albedo = one;
  for (let i = 0; i < weights.length; i++) albedo = o.add(albedo, o.mul(o.mul(weights[i] as T, offRoad), o.sub(factors[i] as T, one)));
  albedo = o.add(albedo, grainTerm);
  const m = macroDecode(o, taps.macroTexel);
  const macro = macroFactor(o, m, k.macroAmp, k.macroBright, k.macroDark);
  return { colour: o.mul(o.mul(tone, albedo), macro), top };
}
