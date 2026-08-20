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
  /**
   * True while the sim reports a tunnel charge actually being worked
   * (`tunnelChargeProgress > 0`) — a continuous state, not a latch: the sim's
   * own clock resets it the moment the work is interrupted.
   */
  working: boolean;
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
 *   4. working   — below the three above (a pinned, broken or dead man is not
 *                  working) and ABOVE fire — see the comment in the body
 *   5. firing    — loses to pinned: being suppressed interrupts the shot
 *   6. moving    — measured speed, so a blocked unit does not walk on the spot
 *   7. idle
 */
export function resolveClip(u: UnitAnimInput): ClipName {
  if (u.alive === 0) return 'down';
  if (u.routed === 1) return u.speed > 0 ? 'move' : 'down';
  if (u.pinned === 1) return 'down';
  // `work` outranking `fire` is load-bearing, not tidiness — do not reorder.
  // `fire` latches per shot, and `work` is the one clip allowed to change a
  // figure's height (the Yahalom lead kneels). If fire won, every burst from a
  // charging team would stand the kneeling man up and drop him again — the
  // exact whole-team bob that teams.py's `_standing_posture` docstring records
  // having to fix once already by forbidding `fire` any height change. So a
  // charging team holds the work pose continuously, and its covering fire
  // reads through muzzle VFX rather than a pose change.
  if (u.working) return 'work';
  if (u.firing) return 'fire';
  return u.speed > 0 ? 'move' : 'idle';
}

/** Playback rate multiplier for whatever clip `resolveClip` picked. */
export function cadenceScale(u: UnitAnimInput): number {
  return resolveClip(u) === 'move' && u.routed === 1 ? ROUT_CADENCE : 1;
}

/**
 * Which clip a *turret* sheet should show, given the hull's resolved clip.
 *
 * Separate from `resolveClip` because a weapon station has a much smaller
 * vocabulary than the vehicle carrying it: a truck that is driving plays
 * `move`, and no turret sheet has a `move`. Asking the hull's clip of the
 * turret directly would miss every time and silently fall back.
 *
 * So only `fire` transfers, and only when the sheet actually declares it.
 * Everything else is idle — which is what a gun does when it is not shooting.
 *
 * Pure and exported so the choice is testable: this lived inline in the draw
 * loop as "always idle", which made the gun truck's 16 recoil frames dead art
 * that nothing could ever display.
 */
export function resolveTurretClip(
  hullClip: ClipName,
  available: Partial<Record<ClipName, unknown>> | undefined
): ClipName {
  if (hullClip === 'fire' && available?.fire) return 'fire';
  return 'idle';
}
