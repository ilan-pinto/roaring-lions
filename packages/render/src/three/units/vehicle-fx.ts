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
 *
 * WP-A1.3 Task 5 adds one more pure function to this split:
 * `vehicleDustIntervalMs` makes the dust spawn CADENCE a function of speed --
 * the magnitude ramp above (`vehicleDustMagnitude`) is untouched, and sizes
 * and populates each puff exactly as before -- and shortens the cadence
 * further under a launch surge while the vehicle is actively accelerating.
 * Dust stays TIME-based on purpose, unlike `vehicle-tracks.ts`'s
 * distance-based tyre marks: a tyre mark is a mark on the ground, and a
 * fixed time would leave gaps at speed and clumps at a crawl, but dust is
 * thrown by the engine -- a vehicle spinning its wheels at a standstill
 * throws dust while covering no ground at all, and a distance rule would
 * give it none.
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

/**
 * The dust spawn interval at the reference speed
 * (`VEHICLE_DUST_FULL_SPEED_TILES_S`), in ms -- the fixed cadence
 * `ThreeRenderer.updateVehicleAmbientFx` fired every moving vehicle's dust on
 * before WP-A1.3, kept as the point `vehicleDustIntervalMs` below scales
 * from. Since that package's Task 6 this is the ONLY copy: the renderer's own
 * private constant is gone and its dust cadence calls
 * `vehicleDustIntervalMs` directly.
 */
export const VEHICLE_DUST_INTERVAL_MS = 250;

/**
 * Floor under `vehicleDustIntervalMs`'s result, comfortably (50%) above
 * `FRAME_DT_CEILING_MS` (100, `ThreeRenderer.ts`). That ceiling is the most
 * a single frame's clamped `dt` can add to the spawn accumulator, and the
 * accumulator spends at most one interval's worth of credit per call (an
 * `if`, never a `while` -- see `updateVehicleAmbientFx`'s own "the ceiling
 * is load-bearing" section). An interval at or below that ceiling would let
 * one long, clamped frame cross it twice, and a `while` loop patched in to
 * cope would spend the backlog one puff per CALL exactly the way the
 * 2026-09-18 emission-backlog defect did (CLAUDE.md's "vehicle repaint
 * drift") -- for the fastest vehicles in the roster, which are exactly the
 * ones this module now speeds the cadence for.
 */
export const VEHICLE_DUST_MIN_INTERVAL_MS = 150;

/**
 * The most `vehicleDustIntervalMs` shortens its result by, ms, under full
 * launch acceleration (`accelFraction` at its clamped maximum of 1). Sized
 * against the reference interval above: at cruise (`accelFraction` 0) the
 * roster's slowest vehicle (`mbt_lavi`, 1.1 tiles/s) already reads roughly
 * 227 ms, so a surge this size visibly thickens the plume the instant it
 * pulls away, without outrunning the floor at every other speed in the
 * roster the way a larger one would.
 */
export const VEHICLE_DUST_LAUNCH_SURGE = 90;

/**
 * Smallest speed `vehicleDustIntervalMs` divides by. Guards a
 * `speedTilesS === 0` call against a division by zero rather than assuming
 * one never arrives -- `nextVehicleMoving` never routes a genuine standstill
 * into the dust branch in practice (`vehicleDustMagnitude`'s own comment
 * says the same for the magnitude ramp), but this module has no way to
 * enforce that from the caller's side.
 */
const MIN_DUST_SPEED_TILES_S = 1e-3;

/**
 * How often a moving vehicle's dust should spawn, in ms, given its ground
 * speed and how hard it is currently accelerating.
 *
 * The shipped `VEHICLE_DUST_INTERVAL_MS` scaled by
 * `VEHICLE_DUST_FULL_SPEED_TILES_S / speed`, so a vehicle at the reference
 * speed gets exactly today's cadence, a slower one gets a longer interval
 * (less frequent dust), and a faster one a shorter one -- a crawling
 * `mbt_lavi` (1.1 tiles/s) and a sprinting `technical` (2.6) no longer dust
 * at the identical fixed rate `updateVehicleAmbientFx` gave them. Shortened
 * further by up to `VEHICLE_DUST_LAUNCH_SURGE` while the vehicle is
 * actively pulling away: the moment a vehicle breaks traction is the moment
 * it throws the most dust, and Task 3's weight model
 * (`vehicle-weight.ts`'s `VehicleWeightOutput.accelFraction`) is the first
 * time this renderer has had an acceleration signal to hang that on.
 * Floored at `VEHICLE_DUST_MIN_INTERVAL_MS` so the result never asks the
 * frame-clamped accumulator for an interval it cannot deliver singly.
 *
 * `accelFraction` is Task 3's own signal verbatim: +1 pulling away, -1
 * braking, 0 at cruise. Only the positive half shortens the interval here
 * -- braking is clamped to the same 0 cruise reads, not inverted into a
 * surge of its own, real wheelspin belongs to launching, not stopping. The
 * clamp to [0, 1] runs before anything else in this function, so an input
 * outside that range from some future caller cannot invert the curve
 * either.
 */
export function vehicleDustIntervalMs(speedTilesS: number, accelFraction: number): number {
  const accel = accelFraction < 0 ? 0 : accelFraction > 1 ? 1 : accelFraction;
  const speed = speedTilesS > MIN_DUST_SPEED_TILES_S ? speedTilesS : MIN_DUST_SPEED_TILES_S;
  const scaled = VEHICLE_DUST_INTERVAL_MS * (VEHICLE_DUST_FULL_SPEED_TILES_S / speed);
  const surged = scaled - accel * VEHICLE_DUST_LAUNCH_SURGE;
  return surged < VEHICLE_DUST_MIN_INTERVAL_MS ? VEHICLE_DUST_MIN_INTERVAL_MS : surged;
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
 * position, differing only in `offsetTiles`, so idling and moving anchor at
 * the same physical point on the hull and the transition between them does
 * not visibly jump. Since WP-A1.3 that position is the hull as DRAWN for a
 * mesh vehicle (`entity.root.position`, the weight model's lag and the
 * recoil shove included) so the plume comes off the hull the player sees,
 * and `curX`/`curY` for a vehicle with no mesh entity, as before.
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
