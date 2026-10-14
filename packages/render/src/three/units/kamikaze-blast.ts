/**
 * GH-85: a kamikaze's warhead going off -- `charge_squad`, `loiter_drone` and
 * `attack_drone`, fielded in nine missions, which until this drew no
 * explosion on a soft target and only the flat flash on armour.
 *
 * **The renderer INFERS the detonation; the sim says nothing new.**
 * `Sim.stepKamikaze` ends a strike with `destroy(munition, target)` straight
 * after writing `curTarget[munition] = target`, and `destroy` does not clear
 * `curTarget`. So the `destroyed` event of a kamikaze type whose `by` is its
 * own `curTarget` is the detonation, and `sim.ts` needs no event, flag or
 * field for it (invariant 4: the sim is not widened for a picture).
 *
 * **One known false positive, accepted** (the coordinator's ruling on this
 * task): a munition SHOT DOWN by the very unit it was diving on carries the
 * same `(by === curTarget)` signature, because `curTarget` is the dive
 * target and the dive target is the one shooting back. Nothing the renderer
 * can read tells those two apart at close range. `isKamikazeDetonation`
 * narrows it with a reach test -- a strike happens only inside
 * `KAMIKAZE_STRIKE_SQ` of the target, so a drone a Lavi's coax knocks down
 * six tiles out is NOT drawn as a detonation -- but a drone shot down inside
 * that reach still draws the blast. Recorded in the PR body too.
 *
 * Pure and three-free, so every rule here is unit-tested without a renderer.
 */

/**
 * `KAMIKAZE_STRIKE_SQ` in `packages/sim/src/tuning.ts`, in squared TILES
 * (98304 / 65536). COPIED, never imported: the renderer takes sim types
 * read-only and this task makes no change to `@lions/sim`, whose index does
 * not export it. `kamikaze-blast.test.ts` reads the sim's value out of
 * `tuning.ts` AS TEXT and pins this copy to it, the way `missiles.ts` pins
 * its copy of `PROJ_SPEED`.
 */
export const SIM_KAMIKAZE_STRIKE_SQ_TILES = 1.5;

/**
 * How far past the strike radius a detonation may still be read, in tiles.
 * The sim tests the distance at the START of the kamikaze step, but the
 * renderer reads `curX`/`curY` at the END of the tick, after `stepMovement`
 * has moved a surviving target on. 0.5 tile is several ticks of the fastest
 * ground unit's travel, and still far inside any gun's engagement range, so
 * it costs the reach test nothing it was added to catch.
 */
export const KAMIKAZE_REACH_SLACK_TILES = 0.5;

/** The reach, in tiles: the strike radius plus the slack. */
export const KAMIKAZE_REACH_TILES = Math.sqrt(SIM_KAMIKAZE_STRIKE_SQ_TILES) + KAMIKAZE_REACH_SLACK_TILES;

/**
 * The detonation's size, fed to `missile_impact` as a landing's `power`
 * (the burst mesh and particle magnitude) and to the scorch radius.
 *
 * `SHELL_PROFILES.rocket.impactPower`, the Grad's: a 520-damage warhead with
 * a 1.2-1.6 tile splash is the heaviest single round a unit carries into a
 * target, well past an ATGM's 0.25-0.3 and short of a vehicle brewing up
 * (`explosionBurstPowerFromMaxHp`, up to 1).
 */
export const KAMIKAZE_BLAST_POWER = 0.45;

/**
 * The light and shake scale a detonation is thrown at: `missile_impact`'s
 * authored values, unscaled -- the same 1 a hit missile lands at (an APS
 * intercept is 0.5).
 */
export const KAMIKAZE_BLAST_SCALE = 1;

export interface DetonationQuery {
  /** The dead unit's type is a kamikaze (`UnitType.isKamikaze`). */
  readonly isKamikaze: boolean;
  /** The `destroyed` event's `by`. -1 is a kill by nobody (`debugKill`, a
   *  tunnel collapse). */
  readonly by: number;
  /** `sim.state.curTarget[entity]`, read on the tick of the event. */
  readonly curTarget: number;
  /** The munition's own last position, and its target's, in tiles. */
  readonly x: number;
  readonly y: number;
  readonly tx: number;
  readonly ty: number;
}

/** Whether a `destroyed` event is a kamikaze's warhead going off. See this
 *  file's top comment for the inference and its one accepted false positive. */
export function isKamikazeDetonation(q: DetonationQuery): boolean {
  if (!q.isKamikaze || q.by < 0 || q.by !== q.curTarget) return false;
  const dx = q.tx - q.x;
  const dy = q.ty - q.y;
  return dx * dx + dy * dy <= KAMIKAZE_REACH_TILES * KAMIKAZE_REACH_TILES;
}

/**
 * The bearing the spall cone leaves along, in turns: from the munition onto
 * its target, the way a missile's impact leaves along the missile's own
 * heading. A munition standing on its target's own point has no bearing, so
 * it falls back to `facingTurns` rather than `atan2(0, 0)`'s arbitrary 0.
 */
export function detonationHeadingTurns(x: number, y: number, tx: number, ty: number, facingTurns: number): number {
  const dx = tx - x;
  const dy = ty - y;
  if (dx * dx + dy * dy < 1e-6) return facingTurns;
  return (((Math.atan2(dy, dx) / (Math.PI * 2)) % 1) + 1) % 1;
}
