/**
 * Vehicle-only ambient VFX: dust kicked up by a moving vehicle, thin engine
 * exhaust on a stationary one. Three-only -- there is no Pixi counterpart
 * and none is owed. `renderer.ts` stays frozen and byte-identical to `main`
 * (unchanged constraint); what changed is the reason: per CLAUDE.md's "VFX
 * are exempt from this diff as of 2026-08-30", an effect that lives only in
 * three is the intended end state, not a divergence pending reconciliation.
 *
 * This module holds the PURE decision math -- moving-vs-idle hysteresis and
 * spawn geometry -- extracted out of `ThreeRenderer.updateVehicleAmbientFx`
 * so it is unit-testable with no `WebGLRenderer`, the same "thin glue, real
 * logic elsewhere" split `frame-state.ts`'s `stepTurretFacing` already
 * established for this class (its own doc comment: a caller with no sheet
 * to resolve can still drive the identical spring off the same persisted
 * state). Nothing here reads or writes `Sim` -- every input is a plain
 * number the caller already measured (`entitySpeed`, `curX`/`curY`,
 * `fx.toNumber(facing)`), so this stays presentation-only by construction:
 * invariant 4 holds because there is no sim state in reach to mutate.
 *
 * Dispatch (the `EmitterLibrary.byName` lookups, the `!type.isSoft` vehicle
 * gate, the per-entity accumulator arrays, the actual `particleSystem.spawn`
 * calls) lives in `ThreeRenderer` itself, exactly where `spawnAmbient` and
 * `spawnCollapseFx` already live -- see `vfx/emitters.ts`'s `byName` doc
 * comment for why an ambient effect is dispatched by the renderer's own
 * clip/speed read rather than a sim event: idling (and, here, moving) is not
 * an event and must not become one, since widening the replay hash for
 * something no combat outcome depends on is exactly the failure that doc
 * comment already rules out for the cigarette effects this one is modelled
 * on.
 */

/**
 * Above this speed a stopped vehicle is considered moving. Set against the
 * SLOWEST vehicle in the current roster (`mbt_lavi`, 1.1 tiles/s) rather
 * than a round number -- 0.15 sits roughly 7x below it, so ordinary cruising
 * (any roster vehicle, any gear) never drifts anywhere near this value; only
 * genuine acceleration from a standstill crosses it.
 */
export const VEHICLE_MOVE_ON_SPEED_TILES_S = 0.15;

/**
 * Below this speed a moving vehicle is considered stopped. Deliberately
 * BELOW `VEHICLE_MOVE_ON_SPEED_TILES_S`, not equal to it -- see
 * `nextVehicleMoving`'s own doc comment for why a single shared cutoff would
 * flicker and this two-threshold gap does not.
 */
export const VEHICLE_MOVE_OFF_SPEED_TILES_S = 0.05;

/**
 * Hysteresis step for the moving/idle decision. A single threshold flickers
 * every frame a vehicle's measured speed (`entitySpeed`, itself derived from
 * one tick's position delta, so it is naturally noisy at low speed) hovers
 * near it -- braking to a stop, or nudging against a flow-field obstacle,
 * both cross a lone cutoff repeatedly within a couple of ticks. Two
 * thresholds with a gap between them fix that: a moving vehicle stays
 * "moving" until it falls all the way through to OFF, and a stopped one
 * stays "stopped" until it climbs all the way through to ON -- the band
 * between the two is dead zone in both directions, so a single noisy sample
 * can never flip the state on its own.
 *
 * This is also the ONE place dust and exhaust are gated as mutually
 * exclusive: a vehicle is always in exactly one of the two states this
 * function returns, never both, so a vehicle cannot be told to spawn dust
 * and exhaust in the same frame by construction, not by a caller-side
 * `if`/`else` that could drift out of sync with it.
 */
export function nextVehicleMoving(wasMoving: boolean, speedTilesS: number): boolean {
  if (wasMoving) return speedTilesS >= VEHICLE_MOVE_OFF_SPEED_TILES_S;
  return speedTilesS > VEHICLE_MOVE_ON_SPEED_TILES_S;
}

/**
 * Ground speed at or above which vehicle dust reads at full density/size.
 * `ParticleSystem.spawn`'s own `magnitude` parameter already does this
 * scaling (count and size_px both grow with it) -- `vehicleDustMagnitude`
 * below just derives that 0..1 input from measured speed. Set just under
 * the roster's slowest cruising vehicle (`mbt_lavi`, 1.1 tiles/s) so a
 * crawling tank still kicks up a substantial cloud, not a fraction of one;
 * only the transition through the ON threshold itself (0.15) reads as
 * visibly thinner.
 */
export const VEHICLE_DUST_FULL_SPEED_TILES_S = 1.0;

/** 0 at a standstill (in practice, never called there -- see
 *  `nextVehicleMoving`), ramping linearly to 1 at
 *  `VEHICLE_DUST_FULL_SPEED_TILES_S` and clamped there for anything faster,
 *  so the roster's fastest vehicle (`technical`, 2.6 tiles/s) does not
 *  out-dust everything else merely for being fast. */
export function vehicleDustMagnitude(speedTilesS: number): number {
  const m = speedTilesS / VEHICLE_DUST_FULL_SPEED_TILES_S;
  return m < 0 ? 0 : m > 1 ? 1 : m;
}

/** World spawn point and emission bearing for a vehicle's ambient FX. */
export interface VehicleFxAnchor {
  x: number;
  y: number;
  /** 0..1 turns -- the direction `ParticleSystem.spawn`'s `dirTurns`
   *  parameter expects. Points BACKWARD along the hull's own heading, so
   *  the emission cone (`cone_deg` scatters around it) drifts the cloud
   *  further behind the vehicle as it ages rather than washing forward
   *  over the hull it just left. */
  dirTurns: number;
}

/**
 * Offsets the spawn point behind the hull along its current facing by
 * `offsetTiles`, rather than spawning at the vehicle's own geometric
 * centre -- ground truth for both effects: dust is kicked up by the tracks/
 * wheels at the rear, and exhaust vents from the engine deck, which sits at
 * the rear on every roster vehicle. Both call sites pass the SAME facing and
 * position (`curX`/`curY`, the exact last-tick position turret math already
 * prefers over the interpolated one -- see `TurretSpringInput`'s own doc
 * comment for why), differing only in `offsetTiles`, so idling and moving
 * anchor at the same physical point on the hull and the transition between
 * them does not visibly jump.
 */
export function vehicleFxAnchor(cx: number, cy: number, facingNorm: number, offsetTiles: number): VehicleFxAnchor {
  const facingRad = facingNorm * Math.PI * 2;
  return {
    x: cx - Math.cos(facingRad) * offsetTiles,
    y: cy - Math.sin(facingRad) * offsetTiles,
    // facingNorm + 0.5 turns, wrapped back into [0, 1) -- turning a heading
    // exactly backward without leaving the 0..1 convention every other
    // dirTurns caller in this file (onFire's own `facingRad / (Math.PI * 2)`)
    // already uses.
    dirTurns: (((facingNorm + 0.5) % 1) + 1) % 1,
  };
}
