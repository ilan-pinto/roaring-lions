/**
 * E6 (GH-274) chunk C: the beam's heat shimmer, as pure numbers (spec 2026-10-24 section 6.3).
 *
 * The distortion itself runs in `fog-pass.ts`, spliced BEFORE the shroud mix the way the dust haze
 * was (R-13): the pass already has the scene colour in hand, so the shimmer is ALU there and costs
 * 0 draw calls. `fog-pass.ts` carries the same expression in GLSL with every constant below
 * interpolated into its source, and `fog-pass.test.ts` pins that it does - `shimmerOffsetPx` and
 * the shader are a mirror pair, exactly as `hazeAmount` and the haze are.
 *
 * Pure: no `three`. A SITE is where a beam lands: a screen position, a radius, an amplitude. The
 * pass offsets its scene-colour sample by a two-octave sine field inside each site's disc -
 * radius 10 px at zoom 1, scaled with zoom, at most 1.5 px of offset - and does nothing at all
 * when no site exists (`uShimmerCount == 0`), so a frame without a beam is bit-identical to one
 * from before the shimmer. The phase is the SIM clock, so a frozen frame is a fixed distortion.
 */

/** The most sites the pass carries; a uniform array's length is fixed at compile time. */
export const SHIMMER_MAX_SITES = 8;
/** A site's radius at zoom 1, CSS pixels. */
export const SHIMMER_RADIUS_PX = 10;
/** The largest offset the field produces, CSS pixels. */
export const SHIMMER_MAX_OFFSET_PX = 1.5;

/** The two octaves: spatial frequency along the disc's radius-normalised y, and angular speed (rad/s). */
export const SHIMMER_K1 = 11;
export const SHIMMER_W1 = 5.1;
export const SHIMMER_K2 = 23;
export const SHIMMER_W2 = 8.3;
/** The second octave's skew along x, so the ripple is not a pure horizontal stripe. */
export const SHIMMER_KX = 7;
/** Heat shimmer is mostly sideways wobble; the vertical component is this fraction of it. */
export const SHIMMER_VERTICAL = 0.25;
/** The field's largest unnormalised length: `(1, SHIMMER_VERTICAL)`. Divides the offset to MAX. */
export const SHIMMER_NORM = Math.sqrt(1 + SHIMMER_VERTICAL * SHIMMER_VERTICAL);

/** One site, as the shader's `uShimmer[i]` reads it: `[u, v, radiusInUvY, amplitude]`. */
export type ShimmerSite = readonly [number, number, number, number];

import { NUMBER_OPS, type Ops } from './fog-ops';

/** The falloff across the disc, written once against `Ops` (GH-943 P1 T4): 1 at the centre, 0 at and beyond the rim, smoothstep between. */
export function shimmerWeightOps<T>(o: Ops<T>, distOverRadius: T): T {
  const f = o.sub(o.lit(1), o.clamp01(distOverRadius));
  return o.mul(o.mul(f, f), o.sub(o.lit(3), o.mul(o.lit(2), f)));
}

/** The falloff across the disc: 1 at the centre, 0 at and beyond the rim, smoothstep between. */
export function shimmerWeight(distOverRadius: number): number {
  return shimmerWeightOps(NUMBER_OPS, distOverRadius);
}

/**
 * The sample offset, in CSS pixels, at disc-normalised position (`dx`, `dy`), written once against `Ops`: the TSL graph in
 * `fog-pass.node.ts` and `shimmerOffsetPx` are this one body.
 */
export function shimmerOffsetOps<T>(o: Ops<T>, dx: T, dy: T, amp: T, timeSec: T): [T, T] {
  const weight = shimmerWeightOps(o, o.length2(dx, dy));
  const w1 = o.sin(o.add(o.mul(dy, o.lit(SHIMMER_K1)), o.mul(timeSec, o.lit(SHIMMER_W1))));
  const w2 = o.sin(o.add(o.sub(o.mul(dy, o.lit(SHIMMER_K2)), o.mul(timeSec, o.lit(SHIMMER_W2))), o.mul(dx, o.lit(SHIMMER_KX))));
  const a = o.div(o.mul(o.mul(amp, weight), o.lit(SHIMMER_MAX_OFFSET_PX)), o.lit(SHIMMER_NORM));
  return [
    o.mul(o.div(o.add(w1, o.mul(o.lit(0.5), w2)), o.lit(1.5)), a),
    o.mul(o.mul(o.lit(SHIMMER_VERTICAL), w2), a),
  ];
}

/**
 * The sample offset, in CSS pixels, at disc-normalised position (`dx`, `dy`) (each divided by the
 * site's radius, x already corrected for the aspect ratio) with site amplitude `amp` at sim time
 * `timeSec`. The shader's expression.
 */
export function shimmerOffsetPx(dx: number, dy: number, amp: number, timeSec: number): [number, number] {
  return shimmerOffsetOps(NUMBER_OPS, dx, dy, amp, timeSec);
}

/**
 * A site from a projected world point. `ndcX`/`ndcY` are the point's normalised device
 * coordinates (-1..1, y up); `heightPx` is the viewport's CSS height. The radius is carried in
 * UV-y units, which is what the shader divides by after correcting x for the aspect ratio.
 */
export function shimmerSite(ndcX: number, ndcY: number, amp: number, zoom: number, heightPx: number): ShimmerSite {
  return [ndcX * 0.5 + 0.5, ndcY * 0.5 + 0.5, (SHIMMER_RADIUS_PX * zoom) / Math.max(heightPx, 1), amp];
}

/**
 * Whether a site's disc touches the viewport at all. A site is a disc of radius `radiusUvY` (UV-y
 * units, `shimmerSite`'s third element), which is `2 * radiusUvY` in NDC-y and `2 * radiusUvY /
 * aspect` in NDC-x; one whose centre is further outside the frame than that distorts nothing the
 * player can see, and must not take one of the `SHIMMER_MAX_SITES` slots from a beam that does.
 */
export function shimmerSiteOnScreen(ndcX: number, ndcY: number, radiusUvY: number, aspect: number): boolean {
  const ry = 2 * radiusUvY;
  const rx = ry / Math.max(aspect, 1e-6);
  return Math.abs(ndcX) <= 1 + rx && Math.abs(ndcY) <= 1 + ry;
}

/** A `ShimmerSite` whose cells can be rewritten: the renderer's per-frame pool. */
export type MutableShimmerSite = [number, number, number, number];

/** `shimmerSite`, written into `out` instead of allocating a tuple: the per-frame path. */
export function shimmerSiteInto(out: MutableShimmerSite, ndcX: number, ndcY: number, amp: number, zoom: number, heightPx: number): MutableShimmerSite {
  out[0] = ndcX * 0.5 + 0.5;
  out[1] = ndcY * 0.5 + 0.5;
  out[2] = (SHIMMER_RADIUS_PX * zoom) / Math.max(heightPx, 1);
  out[3] = amp;
  return out;
}
