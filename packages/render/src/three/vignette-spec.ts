/**
 * The corner vignette's NUMBERS and its falloff maths (GH-943 P1 T3), split out of `vignette-pass.ts` so the node twin
 * (`vignette-pass.node.ts`) can import them without importing the legacy file, which has a `three/addons/postprocessing` type
 * import in it. ADDON-FREE. `vignette-pass.ts` re-exports every name here, so nothing that imports it moves.
 *
 * Why the vignette is display-referred and folded into the output stage is explained in `vignette-pass.ts`'s header.
 */
import type { Ops } from './fog-ops';

/** How much of the colour is taken away where the vignette is at FULL strength -- `rgb * (1 - uStrength)`. 0.55: the lit ground must have ALREADY arrived near `shadow.1` by the time it meets the background beyond the skirt. */
export const VIGNETTE_STRENGTH = 0.55;

/** Where the darkening starts, as a fraction of the half-DIAGONAL (0 at the centre, 1 at a corner). `smoothstep` is exactly 0 below it, so a mid-map pixel is bit-identical with the vignette on and off. */
export const VIGNETTE_RADIUS = 0.62;

/** How far past `uRadius` the ramp takes to reach full strength: the top of the ramp (d = 1.07) is PAST the corner, so the gradient is still moving when it runs out of frame. */
export const VIGNETTE_SOFTNESS = 0.45;

/** `length(uv - 0.5) / VIGNETTE_HALF_DIAGONAL` is 0 at the centre and 1 at each corner whatever the aspect ratio. */
export const VIGNETTE_HALF_DIAGONAL = 0.7071;

/**
 * The falloff, 0 at and inside `radius` and 1 past `radius + softness`: `smoothstep(radius, radius + softness, d)` with
 * `d = length((u, v) - 0.5) / 0.7071`. Written ONCE against `ops`: the node twin reads it with TSL operators, the vitest with
 * numbers. (The legacy GLSL, `FALLOFF_GLSL` in `vignette-pass.ts`, is a string and spells the same maths.) `u` and `v` are the
 * 0..1 screen coordinates; the falloff is symmetric in both, so a flipped Y changes nothing.
 */
export function vignetteFactor<T>(ops: Ops<T>, u: T, v: T, radius: T, softness: T): T {
  const half = ops.lit(0.5);
  const d = ops.div(ops.length2(ops.sub(u, half), ops.sub(v, half)), ops.lit(VIGNETTE_HALF_DIAGONAL));
  return ops.smoothstep(radius, ops.add(radius, softness), d);
}

/** The multiplier the colour is scaled by: `1 - strength * factor`. Exactly 1 at strength 0, whatever the factor. */
export function vignetteScale<T>(ops: Ops<T>, strength: T, factor: T): T {
  return ops.sub(ops.lit(1), ops.mul(strength, factor));
}
