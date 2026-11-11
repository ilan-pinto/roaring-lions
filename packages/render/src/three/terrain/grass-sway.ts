/**
 * GH-1167 S4: the 3D grass field's two vertex terms of its own, written ONCE against `Ops<T>` (`fog-ops.ts`), so the number tests
 * and the node material (`grass-field.node.ts`) run the same body. Design: docs/superpowers/specs/2026-11-11-wadi-halam-3d-grass-design.md,
 * sections 2.1 (Wind, Width floor) and 3.4 (items 3 and 4).
 *
 * The wind and the disturbers are NOT here: the field runs the shipped bodies (`foliageLeanOps`, `disturbSlotPushOps`,
 * `disturbBendOps`) with the grass class, unchanged (design decision 13 adds the flutter only).
 *
 * Both terms are offsets ALONG THE BLADE'S OWN WIDTH AXIS, in the clump's local frame (tiles), which the material carries through
 * the instance matrix's linear part. The axis and the vertex's signed half width come from the blade (`GRASS_WIDTH_ATTRIBUTE`,
 * `grass-blade.ts`).
 *
 * Imports nothing but a type: the node chunk receives these as values (`GrassFieldMaths`), never by importing a legacy file.
 * Presentation only. Nothing here is read by the sim.
 */
import type { Ops } from '../fog-ops';

/** The flutter's amplitude, tiles at the clump's scale 1, at the top of the clump box (design 2.1: 0.004 tile). */
export const GRASS_FLUTTER_AMP_TILES = 0.004;
/** A blade's flutter period, seconds: each blade draws its own from its phase, inside this band (design 2.1: 0.9 to 1.3 s). */
export const GRASS_FLUTTER_PERIOD_MIN_S = 0.9;
export const GRASS_FLUTTER_PERIOD_MAX_S = 1.3;
/**
 * The period is drawn from the blade's phase by a second, decorrelated fract (`fract(phase * K + C)`), so two blades with close
 * phases do not also share a period. K is irrational-ish so no simple phase maps to the band's edge.
 */
export const GRASS_FLUTTER_PERIOD_HASH_K = 7.31;
export const GRASS_FLUTTER_PERIOD_HASH_C = 0.37;

/** The width floor: never narrower than this many DEVICE px on screen (design 2.1). */
export const GRASS_WIDTH_FLOOR_DEVICE_PX = 1;

export interface GrassFlutterInputs<T> {
  /** SIM seconds (`uSwayTime`, `presentationSimMs / 1000`). */
  readonly t: T;
  /** The blade's phase in turns, [0, 1) (`rlNature.z`). */
  readonly phase: T;
  /** The vertex's height in the clump box, 0 root to 1 top (`rlNature.x`). */
  readonly hN: T;
  /** `uWindMode`: 1 the wind, 0 reduced motion. The flutter is MULTIPLIED by it, so it is off in reduced motion. */
  readonly mode: T;
  /** `uSwayAmp`: the debug amplitude the `wind` layer writes (0 hides the wind, and so the flutter). */
  readonly amp: T;
}

/** A blade's flutter period in seconds, from its phase. */
export function grassFlutterPeriodOps<T>(o: Ops<T>, phase: T): T {
  const u = o.fract(o.add(o.mul(phase, o.lit(GRASS_FLUTTER_PERIOD_HASH_K)), o.lit(GRASS_FLUTTER_PERIOD_HASH_C)));
  return o.add(o.lit(GRASS_FLUTTER_PERIOD_MIN_S), o.mul(o.lit(GRASS_FLUTTER_PERIOD_MAX_S - GRASS_FLUTTER_PERIOD_MIN_S), u));
}

/**
 * The per-blade flutter: a signed offset along the blade's width axis, clump-local tiles.
 * `AMP * amp * mode * hN^2 * sin(2 pi (t / period + phase))`: rooted (hN squared, as the shipped grass class bends), each blade on
 * its own phase AND period, so 16 blades never move as one card.
 */
export function grassFlutterOps<T>(o: Ops<T>, x: GrassFlutterInputs<T>): T {
  const period = grassFlutterPeriodOps(o, x.phase);
  const arg = o.mul(o.lit(2 * Math.PI), o.add(o.div(x.t, period), x.phase));
  const weight = o.mul(x.hN, x.hN);
  return o.mul(o.mul(o.mul(o.lit(GRASS_FLUTTER_AMP_TILES), x.amp), o.mul(x.mode, weight)), o.sin(arg));
}

export interface GrassWidthFloorInputs<T> {
  /** The vertex's signed half width at rest (clump-local tiles): `-half` on one edge, `+half` on the other, 0 on the tip. */
  readonly signedHalf: T;
  /** The blade's half width at its ROOT for this LOD (clump-local tiles): the taper's scale. */
  readonly baseHalf: T;
  /**
   * The ON-SCREEN length of one clump-local tile along the blade's width axis, in VIEW units:
   * `length((modelViewMatrix * mat3(instanceMatrix) * widthAxis).xy)`. It carries the clump's turn, its scale and the dimetric
   * squash (a width axis running toward the camera shows `SIN_EL` of its length), so the floor holds at every azimuth.
   */
  readonly viewLen: T;
  /** The camera's zoom (`OrthographicCamera.zoom`). */
  readonly zoom: T;
  /** The device pixel ratio. */
  readonly dpr: T;
  /**
   * CSS px per VIEW unit at zoom 1 (`SILHOUETTE_PX_PER_WORLD_UNIT`, the dimetric camera's own figure). The orthographic frustum
   * maps a view unit to the same CSS px on both screen axes (`updateDimetricCamera`), so one figure converts any view-space length.
   */
  readonly pxPerUnit: T;
}

/**
 * The width floor: the extra signed offset along the width axis (clump-local tiles) that keeps the blade at least
 * `GRASS_WIDTH_FLOOR_DEVICE_PX` device px wide at its root, tapering to the tip as the blade does. Zero when the blade is already
 * wide enough, so at close zoom the blade keeps its authored shape.
 *
 * The blade's half width scales by `f = max(1, minHalf / baseHalf)`, `minHalf` being half a floor's width in local tiles; the
 * offset is `signedHalf * (f - 1)`, so the taper (and the tip) are kept. Measured by the width axis's own on-screen length
 * (`viewLen`), so a blade whose width runs toward the camera is widened by the squash it suffers: 1 device px at every azimuth.
 */
export function grassWidthFloorOps<T>(o: Ops<T>, x: GrassWidthFloorInputs<T>): T {
  const devicePxPerLocal = o.mul(o.mul(x.pxPerUnit, o.max(x.zoom, o.lit(1e-3))), o.mul(x.dpr, o.max(x.viewLen, o.lit(1e-6))));
  const minHalf = o.div(o.lit(GRASS_WIDTH_FLOOR_DEVICE_PX * 0.5), devicePxPerLocal);
  const f = o.max(o.lit(1), o.div(minHalf, o.max(x.baseHalf, o.lit(1e-6))));
  return o.mul(x.signedHalf, o.sub(f, o.lit(1)));
}
