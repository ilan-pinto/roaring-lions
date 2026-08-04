/**
 * Clip resolution: sim state → which animation clip a unit should be showing.
 *
 * A pure precedence chain, deliberately kept free of Pixi and of the Sim type
 * so the ordering can be tested directly. Precedence bugs here hide well — a
 * unit firing while pinned, a dead unit still walking — and are invisible in
 * a screenshot but obvious in play.
 *
 * Renderer-only: reads sim state, never writes it (invariant 4).
 */

import type { ClipName } from './sheet';

/** The slice of a unit's state that decides its posture. */
export interface UnitAnimInput {
  alive: number;
  routed: number;
  pinned: number;
  /** Measured ground speed in tiles/s, not the move order. */
  speed: number;
  /** True while the one-shot fire clip is still latched. */
  firing: boolean;
}

/**
 * Gait multiplier for a broken unit.
 *
 * Rout reuses the `move` clip rather than needing an authored run: at
 * gameplay zoom cadence reads as panic far more clearly than limb positions
 * do, and it costs no art on every future unit.
 */
export const ROUT_CADENCE = 1.6;

/**
 * Resolve the clip for one unit.
 *
 * Order matters, highest priority first:
 *
 *   1. dead      — outranks everything; a corpse's last speed reading is a
 *                  stale tick delta that would otherwise walk it off
 *   2. routed    — rout is what pinning escalates into, so showing `down`
 *                  here would hide the more important state
 *   3. pinned    — the suppression read (GDD 5.5)
 *   4. firing    — loses to pinned: being suppressed interrupts the shot
 *   5. moving    — measured speed, so a blocked unit does not walk on the spot
 *   6. idle
 */
export function resolveClip(u: UnitAnimInput): ClipName {
  if (u.alive === 0) return 'down';
  if (u.routed === 1) return u.speed > 0 ? 'move' : 'down';
  if (u.pinned === 1) return 'down';
  if (u.firing) return 'fire';
  return u.speed > 0 ? 'move' : 'idle';
}

/** Playback rate multiplier for whatever clip `resolveClip` picked. */
export function cadenceScale(u: UnitAnimInput): number {
  return resolveClip(u) === 'move' && u.routed === 1 ? ROUT_CADENCE : 1;
}
