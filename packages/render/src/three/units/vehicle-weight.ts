/**
 * The terrain conform: a hull's pitch and roll from the ground under its own
 * footprint, recomputed from nothing every frame. This half of WP-A1.3 has
 * NO STATE AT ALL -- Task 3's dynamic weight (smoothed speed, positional lag,
 * the settle spring) is deliberately a separate concern layered on top, not
 * folded in here, because conflating the two is how a purely geometric
 * answer acquires a filter it does not need and stops agreeing with the
 * ground the player can actually see under the hull.
 *
 * No `three` import, no `Sim` import, no `@lions/data` import -- every
 * function here takes plain numbers and returns plain numbers, the same
 * "pure decision math here, dispatch in `ThreeRenderer`" split
 * `units/vehicle-fx.ts` already uses for the ambient dust/exhaust effects.
 * That makes this module testable with no `WebGLRenderer` and presentation
 * -only by construction: there is no sim state in reach to mutate, so
 * invariant 4 holds trivially.
 *
 * Two properties a later reader will otherwise get wrong:
 *
 * **Positive pitch is nose-up and positive roll drops the right side.**
 * Chosen to match `MESH_HULL_PITCH_RAD`'s own recoil sign
 * (`ThreeRenderer.ts:440`, applied at `ThreeRenderer.ts:5342-5348` as
 * `entity.root.rotation.x`, XYZ Euler order, local pitch before yaw) -- the
 * recoil rocks a tank back onto its rear road wheels, which that constant
 * treats as positive. Ground rising ahead of the hull tilts it the same
 * direction a recoiling gun does, so it reads positive here too. Roll's
 * sign is otherwise a coin flip that looks fine on a screenshot of a
 * symmetric hull, which is exactly why it is stated rather than left to be
 * inferred: ground falling away to the right (the right corner sampling
 * LOWER than the left) reads positive, i.e. the right side drops.
 *
 * **The span is a parameter, not a constant, because a longer hull tilts
 * less on the same step in the ground** -- the angle is `atan(delta / span)`,
 * so doubling the span roughly halves the angle for a small delta. That is
 * why the half-extents this module's caller measures come from
 * `vehicleMeshBounds` (`ThreeRenderer.ts:4088`, backed by
 * `vehicleShroudBounds`, `mesh-vehicle.ts:477`) rather than one constant
 * shared by every vehicle: the shroud bounds are already the live body's
 * measured size in tile units, excluding `death_root`, with the template
 * root carrying only `MESH_SCALE` and no rotation -- so `bounds.x` is length
 * along the hull's forward axis and `bounds.z` is its width, and there is no
 * per-vehicle footprint table to author or let go stale on a re-export.
 *
 * **Zero on flat ground is the load-bearing property, not an edge case.**
 * `beit_sahwan_outskirts` and `tutorial_ground` declare no `elevation` grid
 * at all, so three of the four gated golden scenarios sample four equal
 * ground heights and both `terrainPitchRad` and `terrainRollRad` must
 * return EXACTLY `0` there -- not a value close to zero -- or the `vehicle`
 * baseline moves for every parked vehicle on those maps. `atan2(0, x)` for
 * `x > 0` already returns exact `0` in IEEE 754, so this falls out of the
 * formula rather than needing a special case, but it is the single fact
 * this module exists to protect (R-G).
 */

/**
 * The four corners of a hull's own footprint, as tile-unit offsets from its
 * centre, at the current facing. Recomputed from scratch on every call --
 * this module carries no history, exactly like the single `groundWorldY`
 * sample it joins (`ThreeRenderer.ts:5321`), which samples the SAME centre
 * position every frame with no memory of the last one either.
 */
export interface HullCorners {
  frontX: number;
  frontY: number;
  rearX: number;
  rearY: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

/**
 * `facingNorm` is a sim `facing` in 0..1 turns, the same unit
 * `meshYawFromFacing` (`mesh-anim.ts`) takes, but this function does NOT
 * reuse that one's `-2*PI*facing` mesh-yaw convention -- it works in GAME
 * space, not mesh-local space, because `frontGroundY`/`rearGroundY` etc. are
 * sampled at world positions this module's caller derives from game
 * coordinates (`EntityFrame`'s own convention: game x -> world X, game y ->
 * world Z), and the hull's rest pose facing local +X only matters once
 * `meshYawFromFacing` places the mesh into the scene -- a step downstream of
 * this module entirely. Facing `0` therefore turns is world/game `+X`
 * directly here, matching `vehicle-fx.ts`'s own `vehicleFxAnchor`
 * (`facingRad = facingNorm * Math.PI * 2`, forward at `(cos, sin)`), so
 * "front" at facing `0` is `+X` and the flanks sit on `+/-Y` --
 * `hullCornerOffsets(0, ...)`'s own test pins exactly that.
 *
 * `halfLengthTiles`/`halfWidthTiles` are HALF the measured hull size along
 * its forward and flank axes respectively (half of `vehicleMeshBounds.x` and
 * `.z` -- see this module's header), so the four corners this returns sit at
 * the hull's own edge, not its centre or its full extent.
 *
 * The flank axis (`left`/`right`) is the forward axis rotated a quarter turn
 * -- `(leftX, leftY) = (-sin(theta), cos(theta)) * halfWidthTiles` -- which
 * keeps `front . left == 0` at every heading by construction (a rotated pair
 * of perpendicular unit vectors stays perpendicular), not merely at the two
 * axis-aligned headings a less thorough test would check.
 */
export function hullCornerOffsets(
  facingNorm: number,
  halfLengthTiles: number,
  halfWidthTiles: number
): HullCorners {
  const facingRad = facingNorm * Math.PI * 2;
  const cos = Math.cos(facingRad);
  const sin = Math.sin(facingRad);
  const frontX = cos * halfLengthTiles;
  const frontY = sin * halfLengthTiles;
  const leftX = -sin * halfWidthTiles;
  const leftY = cos * halfWidthTiles;
  return {
    frontX,
    frontY,
    rearX: -frontX,
    rearY: -frontY,
    leftX,
    leftY,
    rightX: -leftX,
    rightY: -leftY,
  };
}

/**
 * Pitch from the ground height under the front and rear corners
 * (`hullCornerOffsets`' `frontX/frontY` and `rearX/rearY`, each fed through
 * the caller's own `groundWorldY` sample), positive nose-up -- see this
 * module's header for why that sign matches `MESH_HULL_PITCH_RAD`'s recoil.
 *
 * `lengthWorld` is the full fore-aft span the two samples are taken across
 * (front-to-rear, i.e. `2 * halfLengthTiles`, in the same world/tile units
 * as the two ground heights) -- a parameter rather than a constant because a
 * longer hull tilts LESS on the same step in the ground, which is the
 * physical answer: `atan(delta / span)` shrinks as `span` grows for a fixed
 * `delta`.
 *
 * `atan2(frontGroundY - rearGroundY, lengthWorld)` rather than a plain
 * `Math.atan` of the ratio: `lengthWorld` is always strictly positive (it is
 * twice a measured half-extent), so this is equivalent to `atan` of the
 * ratio here, but stays inside `(-PI/2, PI/2)` by construction with no
 * separate clamp needed, and returns EXACTLY `0` when the two samples agree
 * (`atan2(0, x)` for `x > 0` is exact IEEE-754 `+0`) -- the one property
 * `beit_sahwan_outskirts` and `tutorial_ground`'s flat elevation grids
 * depend on (R-G).
 */
export function terrainPitchRad(frontGroundY: number, rearGroundY: number, lengthWorld: number): number {
  return Math.atan2(frontGroundY - rearGroundY, lengthWorld);
}

/**
 * Roll from the ground height under the left and right corners
 * (`hullCornerOffsets`' `leftX/leftY` and `rightX/rightY`), positive when
 * the ground falls away to the RIGHT (the right corner samples lower than
 * the left) -- see this module's header for why that sign is stated rather
 * than left as a coin flip.
 *
 * `widthWorld` is the full beam the two samples are taken across
 * (left-to-right, `2 * halfWidthTiles`), for the identical "a wider hull
 * tilts less" reason `terrainPitchRad`'s `lengthWorld` exists, and the same
 * `atan2` shape gives the same exact-zero-on-flat-ground guarantee.
 */
export function terrainRollRad(leftGroundY: number, rightGroundY: number, widthWorld: number): number {
  return Math.atan2(leftGroundY - rightGroundY, widthWorld);
}

// ===========================================================================
// The dynamic weight: per-entity state, stepped on the frame clock.
// ===========================================================================

/**
 * The half of WP-A1.3 that needs memory: a hull that squats pulling away,
 * dives braking, settles when it stops, leans in a turn and trails the sim a
 * little while it moves. Same rules as the conform above -- plain numbers in,
 * plain numbers out, no `three`, no `Sim` -- and the same shape as
 * `stepTurretFacing` (`frame-state.ts`): persisted typed arrays indexed by
 * entity id and mutated in place, a `seeded` companion consulted first, a
 * `dtSeconds` the caller takes from `frameDtSeconds`. The state is per entity
 * and never shared, because a group order does not stop its vehicles on the
 * same tick (`formation.ts` gives each its own slot).
 *
 * Presentation only: the input is what the renderer already observes
 * (`entitySpeed`, `facing`, the position it draws at) and nothing here is ever
 * read back by the sim.
 *
 * Three things a reader will otherwise get wrong:
 *
 * **The sim has no acceleration, and this is where the ramp is invented.**
 * `stepMovement` (`packages/sim/src/sim.ts`) moves a moving unit by exactly
 * `type.stepPerTick` -- rout and pin only ever SLOW it -- and snaps onto the
 * goal on arrival. `entitySpeed` is the tick-to-tick delta times `SIM_HZ`
 * (`ThreeRenderer.snapshot`): it steps 0 -> cruise in one tick and holds for
 * three frames at 60 fps. Its derivative is zero at cruise and one frame of
 * infinity at a standing start. So `smoothedSpeed` is a RAMP that chases the
 * sim's speed at the constant rate `cruiseTilesS / accelSeconds` -- R-M's
 * normalisation made literal: a standing start accelerates at exactly the
 * reference rate for `accelSeconds`, reads exactly 1 while it does, and
 * exactly 0 the instant it lands on the sim's speed. It is a ramp and not the
 * first-order filter R-M names, and that was measured rather than argued
 * (the filter, stepped at 60 fps with `accelSeconds` 0.35): its derivative is
 * LARGEST on the first frame -- a standing start draws 97.7% of the maximum
 * pitch on frame one, the spike relocated rather than removed -- and it never
 * reaches zero: two seconds after a stop at +/-2 degrees it still reads
 * 1.18e-4 rad, 118x the settle test's own 1e-6 rest bound, which is R-G's "a
 * filter that never settles to zero". A ramp lands exactly, in finite time.
 *
 * The ramp's acceleration is a rectangle, so it is not drawn directly (that IS
 * the spike). It is the REST POINT of a damped spring -- `settle`, in radians
 * of pitch -- and the spring's position is what is drawn: pitch = the rest
 * point plus the settle term, the spring's distance from it. The spring is
 * what makes a launch ramp in over a fifth of a second instead of popping,
 * and what makes a stop dive, pass level once and come to rest. It is not a
 * bounce: at cruise its rest point is zero and it sits there, exactly.
 * `settleSeconds` is its 2% settling time (`omega = 4 / (zeta * settleSeconds)`)
 * and `settleDamping` its damping ratio.
 *
 * **Roll needs no constant, because the sim already rate-limits yaw.**
 * `turnToward` clamps every facing change to `turnPerTick`, from each unit's
 * authored `turn_rate_deg_s`, so the yaw rate has a known per-unit ceiling and
 * `yawRate / turnRateTurnsS` is full lean exactly when a hull turns as hard as
 * it can. It is scaled by the speed share `smoothedSpeed / cruiseTilesS`
 * (0..1, so still bounded by construction), because body roll is LATERAL
 * acceleration -- speed times yaw rate -- and a hull pivoting in place has
 * none: `aimHullAt` swings a PARKED hull onto its target at the full rate, and
 * leaning it would move the drawn pose of a vehicle the sim reports
 * stationary. The body rolls to the OUTSIDE of the turn, the way mass on a
 * suspension does. Sign: positive roll lowers the corner `hullCornerOffsets`
 * names `right` -- the same convention `terrainRollRad` returns, so the two
 * sum -- and an INCREASING heading puts that corner on the outside, so a turn
 * with increasing heading rolls positive. (That corner sits at game offset
 * `(sin, -cos)` of the heading, which at facing 0 is game -y, world -Z: with
 * world Y up, that is the hull's PHYSICAL left. Compose by the corner, not by
 * the name.) Flipping `ROLL_TO_OUTSIDE` leans into the turn instead.
 *
 * **The heading wrap is not optional.** Facing is 0..1 turns and wraps, so a
 * yaw rate computed without the `stepTurretFacing` +/-0.5 adjustment reads a
 * 0.99 -> 0.01 step as a 0.98-turn slew and slams the lean to full on a hull
 * that barely moved.
 *
 * **The bound (R-C, R-K).** The drawn position trails the true one along the
 * heading by `lagTiles` times the speed share, through a filtered offset
 * (`lagX`/`lagY`) so a vehicle first seen moving grows its lag rather than
 * popping it in, clamped to `lagTiles` every frame, and forced to EXACTLY zero
 * on any frame the sim reports the unit stationary. It is deliberately not
 * clamped to `MAX_LAG_TILES` here: the parameter tables are what must stay
 * inside that budget, and a silent clamp would hide one that did not.
 * `ThreeRenderer` clamps the COMBINED lag-plus-recoil once against
 * `MAX_DRAWN_OFFSET_TILES`. Pitch and roll never exceed `maxPitchRad`/
 * `maxRollRad` for any input, NaN and Infinity included.
 *
 * **The clock.** Every piece is propagated in closed form (the ramp is linear,
 * the spring and both filters are solved exactly over each constant-input
 * stretch, and a frame is split at the instant the ramp lands), so the state
 * at a given moment does not depend on how the frames were sliced -- 60 fps,
 * 30 fps and an uneven clock agree to rounding for the same motion -- and a
 * zero `dtSeconds` (hit-stop) is an exact no-op on the state.
 */

/** R-C: the most the drawn hull may sit from the sim's own position, in tiles,
 *  with every writer of `entity.root.position` counted. */
export const MAX_DRAWN_OFFSET_TILES = 0.25;
/** R-K: the lag's own share of that budget -- 0.25 less the 0.16 the hull
 *  recoil (`MESH_HULL_RECOIL_TILES`, `ThreeRenderer.ts`) already spends on the
 *  same `entity.root.position` in the same frame. */
export const MAX_LAG_TILES = 0.09;

/** The per-vehicle numbers, resolved once per type (Task 4). */
export interface VehicleWeightParams {
  /** Pitch at the nominal acceleration, radians; positive is nose-up. */
  maxPitchRad: number;
  /** Roll at the unit's own full turn rate at cruise, radians. */
  maxRollRad: number;
  /** Seconds a standing start takes to reach cruise -- the ramp's rate is
   *  `cruiseTilesS / accelSeconds`, and the heading and lag filters use it as
   *  their time constant. 0 means instant, and draws no pitch at all. */
  accelSeconds: number;
  /** The settle spring's 2% settling time, seconds. */
  settleSeconds: number;
  /** The settle spring's damping ratio: under 1 overshoots, 1 is critical. */
  settleDamping: number;
  /** How far the drawn hull trails the sim at cruise, tiles. */
  lagTiles: number;
}

/** What a frame draws. `accelFraction` is the ramp's own acceleration as a
 *  fraction of the nominal rate: +1 pulling away, -1 braking, 0 otherwise. */
export interface VehicleWeightOutput {
  drawX: number;
  drawY: number;
  pitchRad: number;
  rollRad: number;
  accelFraction: number;
}

/** The persisted per-entity state, indexed by entity id and owned by the
 *  caller (one set per renderer). `out` is the scratch result every call
 *  writes into, so the per-vehicle, per-frame call allocates nothing: read it
 *  before the next call, or pass your own. */
export interface VehicleWeightArrays {
  smoothedSpeed: Float64Array;
  smoothedHeading: Float64Array;
  lagX: Float64Array;
  lagY: Float64Array;
  settle: Float64Array;
  settleVel: Float64Array;
  seeded: Uint8Array;
  readonly out: VehicleWeightOutput;
}

export interface VehicleWeightInput {
  /** Index into the arrays -- the sim entity id. */
  entityId: number;
  /** The sim's own tick-to-tick speed (`entitySpeed[i]`), tiles/s. */
  speedTilesS: number;
  /** The unit's authored top speed (`mobility.speed_tiles_s`), tiles/s. */
  cruiseTilesS: number;
  /** The hull's facing, 0..1 turns (`fx.toNumber(facing)`). */
  headingTurns: number;
  /** The unit's own turn rate, turns/s (`turn_rate_deg_s / 360`). */
  turnRateTurnsS: number;
  /** Where the sim has the unit, in tiles -- what the hull trails. */
  trueX: number;
  trueY: number;
  /** `frameDtSeconds(dtMs)`: the presentation clock, 0 during hit-stop. */
  dtSeconds: number;
  params: VehicleWeightParams;
}

/** Mirrors `FRAME_DT_CEILING_MS` (`ThreeRenderer.ts`), which the caller's
 *  `frameDtSeconds` already applies; held here too so a caller that forgot
 *  cannot integrate a five-second stall in one step. */
const MAX_STEP_SECONDS = 0.1;
/** A speed sample above this multiple of cruise is a discontinuity, not
 *  motion: the sim never moves a unit faster than its own `stepPerTick` (rout
 *  and pin only slow it), so the only way `entitySpeed` reads higher is a
 *  position that jumped -- a spawn's first snapshot, read from the zero-filled
 *  slot, is hundreds of tiles a second. Such a sample holds the ramp where it
 *  is. 1.5 clears the Q16.16 rounding by three orders of magnitude. */
const OVERSPEED_CEILING = 1.5;
/** Sanitising range for `settleDamping`, well outside anything authored: at 0
 *  the spring would never come to rest, and a negative ratio grows. */
const SETTLE_DAMPING_MIN = 0.2;
const SETTLE_DAMPING_MAX = 4;
/** Below this `settleSeconds` the spring is treated as rigid, rather than
 *  letting `omega` overflow. */
const SETTLE_SECONDS_MIN = 1e-3;
/** How close to rest counts as rest, so rest is EXACT (R-G) rather than an
 *  exponential tail: 1e-9 rad of pitch is a billionth of a radian, and a
 *  heading 1e-9 turns behind its input reads a yaw rate nobody can see. */
const REST_EPSILON = 1e-9;
/** +1: the body rolls to the outside of the turn. See the header. */
const ROLL_TO_OUTSIDE = 1;

/** Allocates the per-entity state for `n` entity ids (`sim.capacity`). */
export function makeVehicleWeightArrays(n: number): VehicleWeightArrays {
  return {
    smoothedSpeed: new Float64Array(n),
    smoothedHeading: new Float64Array(n),
    lagX: new Float64Array(n),
    lagY: new Float64Array(n),
    settle: new Float64Array(n),
    settleVel: new Float64Array(n),
    seeded: new Uint8Array(n),
    out: { drawX: 0, drawY: 0, pitchRad: 0, rollRad: 0, accelFraction: 0 },
  };
}

/** `x` if it is a positive finite number, else 0 -- NaN included. */
function nonNegative(x: number): number {
  return x > 0 && x < Infinity ? x : 0;
}

function clampUnit(x: number): number {
  return x > 1 ? 1 : x < -1 ? -1 : x;
}

/**
 * Advances entity `i`'s settle spring by `h` seconds toward the rest point
 * `rest`, in closed form: exact for a rest point held constant over `h`, so
 * the result does not depend on how `h` was divided into frames. Under-,
 * critically and over-damped share one expression through `c` and `s`
 * (`cos`/`sin(bh)/b`, their `h`-limit, or `cosh`/`sinh(ch)/c`); the
 * over-damped pair is formed from two decaying exponentials so it cannot
 * overflow however stiff the spring.
 */
function propagateSettle(
  arrays: VehicleWeightArrays,
  i: number,
  rest: number,
  h: number,
  omega: number,
  zeta: number
): void {
  const x0 = arrays.settle[i] - rest;
  const v0 = arrays.settleVel[i];
  const a = zeta * omega;
  let c: number;
  let s: number;
  if (zeta < 1 - 1e-6) {
    const b = omega * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-a * h);
    c = e * Math.cos(b * h);
    s = (e * Math.sin(b * h)) / b;
  } else if (zeta > 1 + 1e-6) {
    const q = omega * Math.sqrt(zeta * zeta - 1);
    const slow = Math.exp(-(a - q) * h);
    const fast = Math.exp(-(a + q) * h);
    c = (slow + fast) / 2;
    s = (slow - fast) / (2 * q);
  } else {
    const e = Math.exp(-a * h);
    c = e;
    s = e * h;
  }
  arrays.settle[i] = rest + x0 * c + (v0 + a * x0) * s;
  arrays.settleVel[i] = v0 * c - (a * v0 + omega * omega * x0) * s;
}

function writeIdentity(out: VehicleWeightOutput, trueX: number, trueY: number): VehicleWeightOutput {
  out.drawX = trueX;
  out.drawY = trueY;
  out.pitchRad = 0;
  out.rollRad = 0;
  out.accelFraction = 0;
  return out;
}

/**
 * Advances one vehicle's weight state by one frame and returns what to draw.
 * The result is written into `out` (by default the arrays' own scratch
 * object) and returned; nothing is allocated.
 */
export function stepVehicleWeight(
  arrays: VehicleWeightArrays,
  input: VehicleWeightInput,
  out: VehicleWeightOutput = arrays.out
): VehicleWeightOutput {
  const { entityId: i, trueX, trueY, params } = input;
  if (!Number.isInteger(i) || i < 0 || i >= arrays.seeded.length) return writeIdentity(out, trueX, trueY);

  // A cruise speed that cannot normalise anything cannot draw anything: forget
  // the entity, so the first frame that makes sense seeds it afresh.
  const cruise = input.cruiseTilesS;
  if (!(cruise > 0 && cruise < Infinity)) {
    arrays.seeded[i] = 0;
    return writeIdentity(out, trueX, trueY);
  }

  const rawSpeed = input.speedTilesS;
  // The sim's own "stationary", exactly (R-C). `-0 === 0`, and NaN is not.
  const stationary = rawSpeed === 0;
  // Motion is a sample in [0, ceiling]; anything else -- NaN, negative, a
  // teleport -- carries no information about acceleration.
  const isMotion = rawSpeed >= 0 && rawSpeed <= cruise * OVERSPEED_CEILING;
  const rawHeading = input.headingTurns;
  const headingKnown = Number.isFinite(rawHeading);
  const heading = headingKnown ? rawHeading - Math.floor(rawHeading) : 0;

  const smoothedSpeed = arrays.smoothedSpeed;
  const smoothedHeading = arrays.smoothedHeading;
  const lagX = arrays.lagX;
  const lagY = arrays.lagY;
  const settle = arrays.settle;
  const settleVel = arrays.settleVel;

  // 1. The seed (R-N): an entity's first frame -- or the first after its state
  // was found unusable -- starts from its own current speed and heading, with
  // nothing in flight, and draws the identity.
  if (
    arrays.seeded[i] === 0 ||
    !Number.isFinite(smoothedSpeed[i] + smoothedHeading[i] + lagX[i] + lagY[i] + settle[i] + settleVel[i])
  ) {
    if (!headingKnown) {
      arrays.seeded[i] = 0;
      return writeIdentity(out, trueX, trueY);
    }
    smoothedSpeed[i] = isMotion ? Math.min(rawSpeed, cruise) + 0 : 0;
    smoothedHeading[i] = heading;
    lagX[i] = 0;
    lagY[i] = 0;
    settle[i] = 0;
    settleVel[i] = 0;
    arrays.seeded[i] = 1;
    return writeIdentity(out, trueX, trueY);
  }

  const dtIn = input.dtSeconds;
  const dt = dtIn > 0 ? (dtIn < MAX_STEP_SECONDS ? dtIn : MAX_STEP_SECONDS) : 0;
  const maxPitch = nonNegative(params.maxPitchRad);
  const maxRoll = nonNegative(params.maxRollRad);
  const lagTiles = nonNegative(params.lagTiles);
  const tau = nonNegative(params.accelSeconds);

  // 2. The speed ramp, split at the instant it lands.
  const s0 = smoothedSpeed[i];
  const target = isMotion ? Math.min(rawSpeed, cruise) + 0 : s0;
  const gap = target - s0;
  const dir = gap > 0 ? 1 : gap < 0 ? -1 : 0;
  // Seconds left until the ramp lands at the nominal rate; instant at tau 0.
  const landIn = dir === 0 || tau === 0 ? 0 : (Math.abs(gap) / cruise) * tau;
  const ramping = landIn > dt ? dt : landIn;
  const landed = landIn <= dt;
  const s1 = landed ? target : s0 + (dir * cruise * dt) / tau;
  smoothedSpeed[i] = s1;
  const accelNow = landed ? 0 : dir;

  // 3. Pitch: the settle spring, whose rest point is the ramp's acceleration.
  const zetaIn = params.settleDamping;
  const zeta =
    zetaIn >= SETTLE_DAMPING_MIN
      ? zetaIn <= SETTLE_DAMPING_MAX
        ? zetaIn
        : SETTLE_DAMPING_MAX
      : Number.isNaN(zetaIn)
        ? 1
        : SETTLE_DAMPING_MIN;
  const settleSecondsIn = params.settleSeconds;
  if (settleSecondsIn > 0 && settleSecondsIn < Infinity) {
    const omega = 4 / (zeta * Math.max(settleSecondsIn, SETTLE_SECONDS_MIN));
    if (ramping > 0) propagateSettle(arrays, i, dir * maxPitch, ramping, omega, zeta);
    if (dt - ramping > 0 && (settle[i] !== 0 || settleVel[i] !== 0)) {
      propagateSettle(arrays, i, 0, dt - ramping, omega, zeta);
    }
    if (accelNow === 0 && Math.abs(settle[i]) < REST_EPSILON && Math.abs(settleVel[i]) < REST_EPSILON * omega) {
      settle[i] = 0;
      settleVel[i] = 0;
    }
  } else {
    // No spring authored: the pitch IS the rest point (and will step).
    settle[i] = accelNow * maxPitch;
    settleVel[i] = 0;
  }
  const p = settle[i];
  const pitch = p > maxPitch ? maxPitch : p < -maxPitch ? -maxPitch : p;

  // 4. Roll, from the smoothed heading's own derivative. The filter is solved
  // in closed form as "how far behind the input it sits": `behind` decays by
  // exp(-dt / tau), and the derivative of the smoothed heading is behind/tau.
  const speedShare = s1 >= cruise ? 1 : s1 / cruise;
  let yawRate = 0; // turns/s
  if (headingKnown) {
    let delta = heading - smoothedHeading[i];
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    let behind = tau > 0 ? delta * Math.exp(-dt / tau) : 0;
    if (Math.abs(behind) < REST_EPSILON) behind = 0;
    if (dt > 0) {
      const h = heading - behind;
      smoothedHeading[i] = h - Math.floor(h);
    }
    yawRate = tau > 0 ? behind / tau : 0;
  }
  const turnRate = input.turnRateTurnsS;
  const roll =
    turnRate > 0 && turnRate < Infinity
      ? ROLL_TO_OUTSIDE * clampUnit(yawRate / turnRate) * maxRoll * speedShare
      : 0;

  // 5. The lag: an offset trailing the hull's own heading, filtered toward
  // lagTiles x speed share, with the speed share solved as the ramp it is.
  if (stationary) {
    lagX[i] = 0;
    lagY[i] = 0;
  } else if (dt > 0) {
    const angle = (headingKnown ? heading : smoothedHeading[i]) * Math.PI * 2;
    const backX = -Math.cos(angle) * lagTiles;
    const backY = -Math.sin(angle) * lagTiles;
    if (tau === 0) {
      lagX[i] = backX * speedShare;
      lagY[i] = backY * speedShare;
    } else {
      // Over the ramp the target moves linearly (share' = dir / tau); after
      // it lands the target holds. x(h) = A + B h - B tau + (x0 - A + B tau) e^(-h/tau).
      // (Only a cruise that changed under a live slot can leave s0 above
      // cruise, where the share is pinned at 1 rather than linear; that frame
      // is taken as a held target instead, and the clamp below still binds.)
      const linear = ramping > 0 && s0 <= cruise;
      const share0 = s0 / cruise;
      let x = lagX[i];
      let y = lagY[i];
      if (linear) {
        const e = Math.exp(-ramping / tau);
        const bX = (backX * dir) / tau;
        const bY = (backY * dir) / tau;
        const aX = backX * share0;
        const aY = backY * share0;
        x = aX + bX * ramping - bX * tau + (x - aX + bX * tau) * e;
        y = aY + bY * ramping - bY * tau + (y - aY + bY * tau) * e;
      }
      const rest = linear ? dt - ramping : dt;
      if (rest > 0) {
        const e = Math.exp(-rest / tau);
        const tX = backX * speedShare;
        const tY = backY * speedShare;
        x = tX + (x - tX) * e;
        y = tY + (y - tY) * e;
      }
      lagX[i] = x;
      lagY[i] = y;
    }
  }
  // The hard clamp, on every frame including a frozen one: the filter alone
  // stays inside a lagTiles it was always given, but a slot re-used under
  // smaller params inherits a longer lag, and nothing else moves at dt 0.
  const len = Math.sqrt(lagX[i] * lagX[i] + lagY[i] * lagY[i]);
  if (len > lagTiles) {
    const k = lagTiles / len;
    lagX[i] *= k;
    lagY[i] *= k;
  }

  out.drawX = trueX + lagX[i];
  out.drawY = trueY + lagY[i];
  out.pitchRad = pitch + 0; // `+ 0` turns a -0 into the +0 R-G's pins compare with
  out.rollRad = roll + 0;
  out.accelFraction = accelNow + 0;
  return out;
}
