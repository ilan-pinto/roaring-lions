/**
 * The blast package's one pure module: what a full-power blast is worth, and
 * what a caller with a smaller power term gets instead.
 *
 * R-B adopts `data/vfx/catastrophic_kill.json` as the authored blast emitter
 * rather than a second file beside it -- it already declared `hit_stop_ms`,
 * `screen_shake` and `light` at full scale. R-P gave it the two mesh flags
 * its neighbours already carry: `mesh_burst: true` on the hot `soft_dot` core
 * (already `additive`) so a vehicle kill's fireball is the same pooled,
 * modelled burst `structure_collapse.json` uses instead of stacked quads, and
 * `mesh_plume: true` on the `smoke_puff` aftermath layer for the same reason.
 * R-Q measured that `shell_impact.json` (a mortar or rocket landing) had NO
 * persistent smoke at all -- a fireball and nothing that lingers -- and gave
 * it a fourth particle layer modelled on `structure_collapse.json`'s own
 * fourth layer (so the mesh_plume fallback is real authored art, not a bare
 * marker on an empty layer) plus the same three root blocks at mortar scale,
 * one notch below `catastrophic_kill.json`'s own: a bomb crater is not a
 * burning hull.
 *
 * Both files are validated against `data/schemas/vfx_emitter.schema.json`
 * unchanged -- `hit_stop_ms`, `screen_shake` and `light` were already
 * declared there, and `catastrophic_kill` was already in the `trigger` enum.
 * This module changes no schema.
 *
 * Scaling rule (R-R): every caller has a power term in [0, 1] --
 * `explosionBurstPowerFromMaxHp` for a vehicle kill, `SHELL_PROFILES[kind]
 * .impactPower` for a shell (0.3 mortar, 0.45 rocket) -- and where two
 * sources would overlap the renderer takes the MAX of them, never the sum,
 * so two blasts landing together read as one large blast rather than a
 * double-bright one. Within a single blast, only STRENGTH scales:
 * `light.intensity`, `screen_shake.amplitude_px` and `hit_stop_ms` shrink
 * with power, while `light.radius_tiles`, `light.decay_ms`,
 * `screen_shake.duration_ms` and `screen_shake.falloff_tiles` stay exactly
 * as authored. A weaker blast is quieter, not shorter and not smaller in the
 * world -- a shake whose duration shrank with power would read as a
 * different effect rather than a smaller one, and a light whose radius
 * shrank would stop touching the ground it is meant to be lighting.
 *
 * Each function answers `null`/`0` rather than a zeroed-out object whenever
 * there is nothing to scale -- a missing emitter, a `power <= 0`, or an
 * emitter that never declared the block in question -- so a caller cannot
 * accidentally spawn a silent light, shake or freeze built from defaults
 * nobody authored.
 */
import type { EmitterSpec } from '../vfx/emitters';
import type { FlashLightSpec } from './flash-light';

/** The adopted blast emitter -- a vehicle's catastrophic kill. */
export const BLAST_EMITTER_ID = 'catastrophic_kill';
/** The mortar/rocket landing emitter, scaled at the caller's own `impactPower`. */
export const SHELL_IMPACT_EMITTER_ID = 'shell_impact';

/** `EmitterSpec.screen_shake`, camelCased and scaled -- never partially built. */
export interface ScaledShake {
  amplitudePx: number;
  durationMs: number;
  falloffTiles: number;
}

/**
 * The emitter's `light` block, with `intensity` scaled by `power`.
 * `radius_tiles` and `decay_ms` are reach and duration, not strength, and
 * pass through unscaled. `null` when there is no emitter, no power, or the
 * emitter never declared a `light` with an `intensity` to scale.
 */
export function blastLightSpec(em: EmitterSpec | null, power: number): FlashLightSpec | null {
  if (em === null || power <= 0) return null;
  const light = em.light;
  if (light === undefined || light.intensity === undefined) return null;
  return {
    color: light.color,
    intensity: light.intensity * power,
    radius_tiles: light.radius_tiles,
    decay_ms: light.decay_ms,
  };
}

/**
 * The emitter's `screen_shake` block, with `amplitude_px` scaled by `power`.
 * `duration_ms` and `falloff_tiles` are duration and reach, not strength, and
 * pass through unscaled. `null` when there is no emitter, no power, or the
 * emitter never declared a `screen_shake` with an `amplitude_px` to scale.
 */
export function blastShake(em: EmitterSpec | null, power: number): ScaledShake | null {
  if (em === null || power <= 0) return null;
  const shake = em.screen_shake;
  if (shake === undefined || shake.amplitude_px === undefined) return null;
  return {
    amplitudePx: shake.amplitude_px * power,
    durationMs: shake.duration_ms ?? 0,
    falloffTiles: shake.falloff_tiles ?? 0,
  };
}

/**
 * The emitter's `hit_stop_ms`, scaled by `power`. `0` when there is no
 * emitter, no power, or the emitter never declared one.
 */
export function blastHitStopMs(em: EmitterSpec | null, power: number): number {
  if (em === null || power <= 0) return 0;
  const hitStopMs = em.hit_stop_ms;
  if (hitStopMs === undefined) return 0;
  return hitStopMs * power;
}
