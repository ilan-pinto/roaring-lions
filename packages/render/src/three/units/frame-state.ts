/**
 * What survives of the per-entity BILLBOARD frame decision (Task B3.3,
 * `entityFrame`), now that the billboard path is retired (WP-A3.3): the two
 * pieces the MESH path shares with it.
 *
 *  - `AIR_LIFT_PX`: how high an `isAir` unit flies, in lift pixels, read by
 *    `ThreeRenderer.updateVehicleMeshes`, the proxy boxes and
 *    `units/missiles.ts`.
 *  - `stepTurretFacing`: the turret-traverse spring a mesh vehicle's
 *    `turret_pivot` follows -- one implementation, so a type's turret
 *    bearing is computed in exactly one place.
 *
 * `entityFrame`, `EntityFrame`/`EntityFrameInput`, `assignRoofSlots`, the
 * roof-slot and recoil/flinch pixel constants are gone with the billboards.
 * The gait multipliers the mesh path reads (`walkFps`, `cadenceScale`) were
 * never here: they live in `anim.ts` and `clip.ts`, and `units/mesh-anim.ts`
 * reads them directly.
 *
 * No `Sim`, no three.js, no DOM: testable under `environment: 'node'`.
 */

/**
 * Air-lift height, in lift pixels -- converted through
 * `WORLD_Y_PER_LIFT_PIXEL` by every caller into a genuine world-Y height
 * above the ground, not a screen-space nudge: an air unit is real geometry
 * the depth buffer resolves (and a ridge can hide). The value is Pixi's
 * `AIR_LIFT_PX` (14), kept when that backend's sprite nudge became a real
 * height, and kept again when the billboards went (WP-A3.3).
 */
export const AIR_LIFT_PX = 14;

/**
 * Task B3.6: turret traverse spring constants (Pixi's own values, 90/13). A
 * damped spring, not a linear lerp, so traverse overshoots slightly and
 * settles -- Pixi's own comment: "A turret has mass; the old lerp read as a
 * servo snapping to its setpoint."
 */
export const TURRET_STIFFNESS = 90;
export const TURRET_DAMPING = 13;

/**
 * Everything `stepTurretFacing` needs, extracted verbatim from `entityFrame`'s
 * own turret-spring block (Task B3.6, renderer.ts:2111-2170) so a caller that
 * has no `SheetSpec`/clip to resolve -- a mesh vehicle, which has no billboard
 * turret sheet at all -- can still drive the identical spring, off the SAME
 * persisted per-entity state (`turretFacing`/`turretVel`/`turretSeeded`), the
 * SAME seeding rule, and the SAME `TURRET_STIFFNESS`/`TURRET_DAMPING`
 * constants a turreted billboard vehicle already uses.
 *
 * This is the mesh-unit-contract's own "Turret bearing... already comes from
 * sim state on the billboard path... reuse that source; do not invent a
 * second one" requirement, made literal: `entityFrame` below and
 * `ThreeRenderer.updateVehicleMeshes` both call this SAME function, so a
 * type's turret bearing is computed in exactly one place regardless of which
 * path draws it.
 */
export interface TurretSpringInput {
  /** Index into the persisted `turretFacing`/`turretVel`/`turretSeeded`
   *  arrays -- the sim entity id, exactly like `EntityFrameInput.entityId`. */
  entityId: number;
  /** The hull's own facing, 0..1 turns -- `fx.toNumber(facing)`, already
   *  crossed out of Q16.16 by the caller. */
  facingNorm: number;
  /** The shooter's own last-tick EXACT position (`curX`/`curY`, never the
   *  frame-interpolated position) -- see this function's own body comment
   *  for why. */
  curX: number;
  curY: number;
  /** World position to aim at, or `null` for "no live target -- spring back
   *  to the hull's own heading". */
  targetX: number | null;
  targetY: number | null;
  dtSeconds: number;
  /** Persisted per-entity turret facing (0..1 turns) and angular velocity
   *  (turns/s), mutated in place -- owned by the caller across frames. */
  turretFacing: Float64Array;
  turretVel: Float64Array;
  turretSeeded: Uint8Array;
}

/**
 * Advances one entity's turret-traverse spring by one frame and returns its
 * new facing (0..1 turns). Extracted from the retired billboard
 * `entityFrame`'s turret block with no behavioural change; the tests that
 * pinned it through `entityFrame` now call it directly.
 */
export function stepTurretFacing(input: TurretSpringInput): number {
  const { entityId, facingNorm, curX, curY, targetX, targetY, dtSeconds, turretFacing, turretVel, turretSeeded } =
    input;

  if (turretSeeded[entityId] === 0) {
    // Seed to the hull's CURRENT facing the first time this entity is ever
    // decided with turret art loaded -- mirrors Pixi's own "seed turret
    // facing to hull facing on first snapshot" (renderer.ts:748-750), but
    // keyed per-entity (`turretSeeded`) rather than Pixi's single
    // `frameN === 0` gate, so a reinforcement that spawns mid-mission is
    // seeded on ITS OWN first frame rather than left frozen at 0
    // (Float64Array's zero-fill) until something gives it a target.
    turretFacing[entityId] = facingNorm;
    turretSeeded[entityId] = 1;
  }

  // With no target the turret returns to the hull's heading
  // (renderer.ts:2116-2117). `curX`/`curY`, not the interpolated `wx`/`wy`
  // -- Pixi's own goal-angle math reads `this.curX[i]`/`this.curY[i]`
  // (the shooter) against `this.curX[target]`/`this.curY[target]` (or the
  // structure's centre), both last-tick exact positions, never the
  // frame-interpolated ones (renderer.ts:2119-2123).
  let goalTurn = facingNorm;
  if (targetX !== null && targetY !== null) {
    const dx = targetX - curX;
    const dy = targetY - curY;
    goalTurn = (((Math.atan2(dy, dx) / (Math.PI * 2)) % 1) + 1) % 1;
  }

  // Damped spring, not a linear lerp -- traverse overshoots slightly and
  // settles (renderer.ts:2125-2138). See TURRET_STIFFNESS/TURRET_DAMPING's
  // own doc comment.
  let delta = goalTurn - turretFacing[entityId];
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  // Bounded integration step -- explicit Euler diverges once damping * dt
  // exceeds 1, which a 100ms frame hitch would reach, so the spring
  // integrates on a bounded step even when the frame took longer
  // (renderer.ts:2131-2134).
  const sdt = Math.min(dtSeconds, 1 / 30);
  const accel = delta * TURRET_STIFFNESS - turretVel[entityId] * TURRET_DAMPING;
  turretVel[entityId] += accel * sdt;
  turretFacing[entityId] += turretVel[entityId] * sdt;
  turretFacing[entityId] = ((turretFacing[entityId] % 1) + 1) % 1;
  return turretFacing[entityId];
}
