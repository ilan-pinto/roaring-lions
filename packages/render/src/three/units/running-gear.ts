/**
 * Wheels that spin and tracks that scroll: the second half of GH-177, the
 * part WP-A1.3's R-J deferred. Design: `docs/superpowers/specs/2026-10-12-
 * wheels-and-tracks-design.md`, approved by the lead as written (A1-A12).
 *
 * This module is the pure half: what the running gear of one vehicle should
 * read this frame, from the same smoothed motion the weight model already
 * draws the hull with. There is no `three`, sim or data import here, the
 * `vehicle-weight.ts` split. The shader that draws the result is
 * `running-gear-material.ts`, and `ThreeRenderer.updateVehicleMeshes` feeds
 * both.
 *
 * Presentation only, on the FRAME clock (`frameDtSeconds`, 0 during a
 * hit-stop): nothing here is read back by the sim (invariant 4), and the
 * determinism hash cannot see it.
 *
 * Four things a later reader will otherwise get wrong:
 *
 * **The drive speed is SIGNED, and it is not the sim's speed.** It is the
 * weight model's own ramp (`smoothedSpeed`), so a wheel spins up exactly as
 * the hull squats, times the cosine between where the unit is going and
 * where its hull points (A11). The sim moves a unit a full step along its
 * route while `turnToward` is still bringing the hull round at its authored
 * rate (`sim.ts`, `stepMovement`), so a Lavi reversing its route slides
 * backwards for three seconds. With an unsigned speed its tracks would run
 * forwards the whole time.
 *
 * **Increasing facing is a RIGHT turn**, toward mesh-local +Z, the hull's
 * physical right (`meshYawFromFacing` is `-2 pi facing`, and three's
 * rotation about +Y by `-theta` carries local +X onto world (cos, 0, sin)).
 * So the LEFT side is the outside of a turn with increasing facing and runs
 * faster: `vL = v + omega * gL`, `vR = v - omega * gR`. On the spot (`v` 0)
 * the two sides run opposite (A10), wheeled vehicles included.
 *
 * **A rolling wheel turns NEGATIVELY about mesh-local +Z.** Its centre moves
 * +X over a contact point that is still, so the angular velocity is
 * `(0, 0, -v / r)`. A track's loop coordinate grows clockwise in side view
 * (`running-gear-pass.ts`, `loopFromPoints`), which runs REARWARD along the
 * bottom run, so forward motion ADDS to the phase.
 *
 * **Steering is the bicycle model, faded out near standstill.** The angle
 * is `atan(wheelbase * omega / v)`, so a turn on the spot does not crab the
 * front wheels. It is clamped to the axle's measured clearance
 * (`maxSteerRad`, the smaller of its two wheels') under A9's 20 degrees.
 */

/** The most wheels one vehicle declares: the shader's uniform arrays. */
export const RG_MAX_WHEELS = 16;
/** A8: the fastest a wheel is drawn turning, rad/s. At 30 fps that is 29
 *  degrees a frame, under half the period of a 6-lug wheel. The jeep at
 *  cruise would turn 20.2 rad/s and the technical 24.7. */
export const RG_MAX_WHEEL_RAD_S = 15;
/** Below this forward speed, m/s, the steering angle fades to 0. */
export const RG_STEER_FADE_MPS = 0.5;
/** A7: the tread bars reach full strength at this share of cruise. */
export const RG_TREAD_RAMP_SHARE = 0.25;
/** A6: a bar is this share of its pitch. */
export const RG_TREAD_DUTY = 0.35;
/** A6: how much a bar darkens the bake, mean-preserving. */
export const RG_TREAD_DEPTH = 0.35;
/** One tile is 3 m (`MESH_UNITS_PER_TILE`, and 1 GLB unit is 1 m). */
const METRES_PER_TILE = 3;

export type RgSide = 'r' | 'l';

export interface RgWheelSpec {
  readonly side: RgSide;
  readonly index: number;
  readonly centre: readonly [number, number, number];
  readonly radius: number;
  readonly steer: boolean;
}

/** One vehicle type's running gear, as the runtime uses it. */
export interface RunningGearSpec {
  readonly wheels: readonly RgWheelSpec[];
  /** Per side: [loopLength, pitch], or absent for no track on that side. */
  readonly track: { readonly r?: readonly [number, number]; readonly l?: readonly [number, number] };
  /** Mean distance of each side's wheels (or track) from the centreline, m. */
  readonly gauge: { readonly r: number; readonly l: number };
  /** Front axle to rear axle, m (0 without wheels). */
  readonly wheelbase: number;
  /** The steering clamp: the smallest measured clearance among the steered
   *  wheels, radians. 0 when nothing steers. */
  readonly steerLimit: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The spec from a vehicle scene's `userData.rl_running_gear` (the GLB's scene
 * extras), or `null` when it carries none. Throws on a malformed one rather
 * than drawing something plausible: a wrong radius turns a wheel at the
 * wrong rate and looks fine on a still.
 */
export function parseRunningGear(userData: unknown, vehicleId: string): RunningGearSpec | null {
  const raw = (userData as { rl_running_gear?: unknown } | null)?.rl_running_gear;
  if (raw === undefined) return null;
  const bad = (why: string): never => {
    throw new Error(`running-gear: ${vehicleId}'s extras.rl_running_gear ${why} (mesh-unit contract v7)`);
  };
  const r = raw as { version?: unknown; wheels?: unknown; tracks?: unknown };
  if (r.version !== 1) bad(`has version ${String(r.version)}, not 1`);
  if (!Array.isArray(r.wheels) || !Array.isArray(r.tracks)) bad('has no wheels/tracks arrays');
  const wheelsRaw = r.wheels as unknown[];
  if (wheelsRaw.length > RG_MAX_WHEELS) bad(`declares ${wheelsRaw.length} wheels, more than ${RG_MAX_WHEELS}`);
  let steerLimit = Infinity;
  const wheels: RgWheelSpec[] = wheelsRaw.map((w, k) => {
    const x = w as { side?: unknown; index?: unknown; centre?: unknown; radius?: unknown; steer?: unknown; maxSteerRad?: unknown };
    const c = x.centre as unknown[];
    if ((x.side !== 'r' && x.side !== 'l') || !isNum(x.index) || !Array.isArray(c) || c.length !== 3 || !c.every(isNum)) {
      bad(`wheel ${k} is malformed`);
    }
    if (!isNum(x.radius) || x.radius <= 0) bad(`wheel ${k} has radius ${String(x.radius)}`);
    if (x.steer === true) {
      if (!isNum(x.maxSteerRad) || x.maxSteerRad < 0) bad(`wheel ${k} steers with no maxSteerRad`);
      steerLimit = Math.min(steerLimit, x.maxSteerRad as number);
    }
    return {
      side: x.side as RgSide,
      index: x.index as number,
      centre: [c[0] as number, c[1] as number, c[2] as number],
      radius: x.radius as number,
      steer: x.steer === true,
    };
  });
  const track: { r?: [number, number]; l?: [number, number] } = {};
  const trackGauge = { r: 0, l: 0 };
  for (const t of r.tracks as unknown[]) {
    const x = t as { side?: unknown; loopLength?: unknown; pitch?: unknown; gauge?: unknown };
    if ((x.side !== 'r' && x.side !== 'l') || !isNum(x.loopLength) || !isNum(x.pitch) || x.pitch <= 0 || !isNum(x.gauge)) {
      bad('has a malformed track');
    }
    track[x.side as RgSide] = [x.loopLength as number, x.pitch as number];
    trackGauge[x.side as RgSide] = x.gauge as number;
  }
  const gaugeOf = (side: RgSide): number => {
    const ws = wheels.filter((w) => w.side === side);
    return ws.length > 0 ? ws.reduce((s, w) => s + Math.abs(w.centre[2]), 0) / ws.length : trackGauge[side];
  };
  const xs = wheels.map((w) => w.centre[0]);
  const spec: RunningGearSpec = {
    wheels,
    track,
    gauge: { r: gaugeOf('r'), l: gaugeOf('l') },
    wheelbase: xs.length > 0 ? Math.max(...xs) - Math.min(...xs) : 0,
    steerLimit: Number.isFinite(steerLimit) ? steerLimit : 0,
  };
  return spec;
}

/** Per-entity state, indexed by entity id (one set per renderer). */
export interface RunningGearState {
  /** `RG_MAX_WHEELS` angles per entity, radians, kept in (-pi, pi]. */
  readonly angle: Float64Array;
  /** Two track phases per entity (r, l), in [0, 1). */
  readonly phase: Float64Array;
  readonly steer: Float64Array;
  /** The tread bars' strength, 0..1 (A7). */
  readonly amp: Float64Array;
  /** The last travel-vs-hull cosine, held while the unit has no tick delta. */
  readonly lastCos: Float64Array;
  /** 1 once the entity has ever moved or turned: the renderer swaps in the
   *  running-gear material only then, so a vehicle that never moved draws
   *  through exactly the material and program it always did. */
  readonly moved: Uint8Array;
}

export function makeRunningGearState(n: number): RunningGearState {
  const lastCos = new Float64Array(n);
  lastCos.fill(1);
  return {
    angle: new Float64Array(n * RG_MAX_WHEELS),
    phase: new Float64Array(n * 2),
    steer: new Float64Array(n),
    amp: new Float64Array(n),
    lastCos,
    moved: new Uint8Array(n),
  };
}

/** A fresh entity starts at rest: every angle and phase 0, no steer, no
 *  tread, the travel cosine 1, not yet moved. */
export function resetRunningGear(state: RunningGearState, entityId: number): void {
  state.angle.fill(0, entityId * RG_MAX_WHEELS, (entityId + 1) * RG_MAX_WHEELS);
  state.phase[entityId * 2] = 0;
  state.phase[entityId * 2 + 1] = 0;
  state.steer[entityId] = 0;
  state.amp[entityId] = 0;
  state.lastCos[entityId] = 1;
  state.moved[entityId] = 0;
}

export interface RunningGearInput {
  readonly entityId: number;
  readonly spec: RunningGearSpec;
  /** The weight model's `smoothedSpeed`, tiles/s, unsigned. */
  readonly smoothedSpeedTilesS: number;
  /** The weight model's `smoothedYawRate`, turns/s (+ = increasing facing). */
  readonly yawRateTurnsS: number;
  /** The last tick's movement, tiles (`curX - prevX`, `curY - prevY`). */
  readonly moveX: number;
  readonly moveY: number;
  /** The hull's facing, 0..1 turns. */
  readonly headingTurns: number;
  /** The unit's authored top speed, tiles/s (A7's ramp is a share of it). */
  readonly cruiseTilesS: number;
  /** `frameDtSeconds`: 0 during a hit-stop, which is an exact no-op here. */
  readonly dtSeconds: number;
}

const TWO_PI = Math.PI * 2;
const wrapAngle = (a: number): number => {
  const w = a - TWO_PI * Math.round(a / TWO_PI);
  return w === -Math.PI ? Math.PI : w;
};
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The side speeds, m/s: the outside of a turn with increasing facing is
 *  the LEFT side (this module's header). */
export function sideSpeeds(forwardMps: number, yawRadS: number, gauge: { r: number; l: number }): { r: number; l: number } {
  return { r: forwardMps - yawRadS * gauge.r, l: forwardMps + yawRadS * gauge.l };
}

/** The signed forward speed, m/s, and the cosine it used. */
export function forwardSpeed(input: RunningGearInput, lastCos: number): { mps: number; cos: number } {
  let cos = lastCos;
  if (input.moveX !== 0 || input.moveY !== 0) {
    const travel = Math.atan2(input.moveY, input.moveX);
    cos = Math.cos(travel - input.headingTurns * TWO_PI);
  }
  return { mps: input.smoothedSpeedTilesS * METRES_PER_TILE * cos, cos };
}

/** Advance one entity's running gear by one frame. */
export function stepRunningGear(state: RunningGearState, input: RunningGearInput): void {
  const i = input.entityId;
  const { spec, dtSeconds: dt } = input;
  const fwd = forwardSpeed(input, state.lastCos[i]);
  state.lastCos[i] = fwd.cos;
  const v = fwd.mps;
  const omega = input.yawRateTurnsS * TWO_PI;
  if (v !== 0 || omega !== 0) state.moved[i] = 1;
  const sides = sideSpeeds(v, omega, spec.gauge);

  const base = i * RG_MAX_WHEELS;
  spec.wheels.forEach((w, k) => {
    const spin = clamp(sides[w.side] / w.radius, -RG_MAX_WHEEL_RAD_S, RG_MAX_WHEEL_RAD_S);
    state.angle[base + k] = wrapAngle(state.angle[base + k] - spin * dt);
  });
  for (const [s, slot] of [['r', 0], ['l', 1]] as const) {
    const t = spec.track[s];
    if (!t) continue;
    const p = state.phase[i * 2 + slot] + (sides[s] * dt) / t[1];
    state.phase[i * 2 + slot] = p - Math.floor(p);
  }

  if (spec.steerLimit > 0) {
    const speed = Math.abs(v);
    let target = speed > 1e-6 ? Math.atan((spec.wheelbase * omega) / v) : 0;
    target *= Math.min(1, speed / RG_STEER_FADE_MPS);
    state.steer[i] = clamp(target, -spec.steerLimit, spec.steerLimit);
  }

  const cruiseMps = input.cruiseTilesS * METRES_PER_TILE;
  const fastest = Math.max(Math.abs(sides.r), Math.abs(sides.l));
  state.amp[i] = cruiseMps > 0 ? clamp(fastest / (RG_TREAD_RAMP_SHARE * cruiseMps), 0, 1) : 0;
}

/**
 * Wheel `k`'s rotation for the shader: `(cos phi, sin phi, cos alpha, sin
 * alpha)`, spin `phi` about mesh-local +Z and then yaw `alpha` about +Y.
 * A right turn (positive steer state) yaws the front wheels toward +Z, which
 * is a NEGATIVE rotation about +Y (`rotation.y = a` carries +X to (cos a, 0,
 * -sin a)). `hidden` (the `running-gear` debug layer) answers the rest pose,
 * exactly `(1, 0, 1, 0)`.
 */
export function wheelRotation(
  state: RunningGearState,
  entityId: number,
  spec: RunningGearSpec,
  k: number,
  hidden: boolean,
  out: [number, number, number, number]
): [number, number, number, number] {
  if (hidden) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 1;
    out[3] = 0;
    return out;
  }
  const phi = state.angle[entityId * RG_MAX_WHEELS + k];
  const alpha = spec.wheels[k]?.steer ? -state.steer[entityId] : 0;
  out[0] = Math.cos(phi);
  out[1] = Math.sin(phi);
  out[2] = Math.cos(alpha);
  out[3] = Math.sin(alpha);
  return out;
}

/**
 * The vertex shader's wheel transform, mirrored in TypeScript so it can be
 * tested (`running-gear-material.ts` holds the GLSL, `rgApply` there).
 * `p` is relative to the axle. Spin about +Z, then yaw about +Y.
 */
export function applyWheelRotation(
  d: readonly [number, number, number],
  rot: readonly [number, number, number, number]
): [number, number, number] {
  const ax = rot[0] * d[0] - rot[1] * d[1];
  const ay = rot[1] * d[0] + rot[0] * d[1];
  const az = d[2];
  return [rot[2] * ax + rot[3] * az, ay, -rot[3] * ax + rot[2] * az];
}

/** The vertex shader's whole position update for a tagged vertex, in the
 *  `p + (R d - d)` form that returns `p` bit for bit at the rest rotation. */
export function wheelVertex(
  p: readonly [number, number, number],
  centre: readonly [number, number, number],
  rot: readonly [number, number, number, number]
): [number, number, number] {
  const d: [number, number, number] = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
  const r = applyWheelRotation(d, rot);
  return [p[0] + (r[0] - d[0]), p[1] + (r[1] - d[1]), p[2] + (r[2] - d[2])];
}
