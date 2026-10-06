/**
 * Squad cohesion, recoil and the kneel, as arithmetic (approved at the motion
 * checkpoint, 5 Oct). Presentation only: nothing here is read back by the
 * sim, every input is the renderer's own interpolated view of sim state, and
 * every "random" number is a hash of the entity id -- the same replay draws
 * the same squad.
 *
 * Kept above the `THREE.*` line, like `mesh-anim.ts`, so it is testable under
 * node; `squad-rig.ts` is the half that touches bones.
 */
import type { ClipName } from '../../sheet';
import { hashEntityId } from './mesh-anim';

/** Metres in a tile (`tools/dimetric.py`'s UNITS_PER_TILE). */
export const METRES_PER_TILE = 3;

// --- the follower -----------------------------------------------------------

/** A figure trails its slot by at most this much, metres (approved). */
export const SLOT_LAG_MAX_M = 0.25;
/** How hard a figure is pulled back to its slot, 1/s. */
export const SLOT_PULL_PER_S = 5;
/** How fast a figure may change speed, m/s^2 -- a standing start to a
 *  2.7 m/s run in ~0.2 s, which is what keeps the lag inside its cap. */
export const FIGURE_ACCEL_M_S2 = 14;
/** Slot drift (approved): along the line of travel and across it. */
export const DRIFT_ALONG_M = 0.25;
export const DRIFT_ACROSS_M = 0.12;
export const DRIFT_ALONG_PERIOD_S: readonly [number, number] = [3, 5];
export const DRIFT_ACROSS_PERIOD_S: readonly [number, number] = [4, 7];
/** A kneeling squad spreads its slots this much wider (approved: 20%). */
export const KNEEL_SPREAD = 0.2;
/** Per-figure cadence variation (approved: +-6%). */
export const CADENCE_VARIANCE = 0.06;
/** Extra clip-phase offsets, as fractions of a cycle, by figure (approved). */
export const FIGURE_PHASES: readonly number[] = [0, 0.37, 0.71];
/** Stagger before each figure follows a stance change, seconds (approved). */
export const STANCE_STAGGER_S: readonly number[] = [0, 0.08, 0.15];
/** The upper body turns toward the aim this far off the legs, at most. */
export const TWIST_MAX_RAD = (60 * Math.PI) / 180;
/** How fast a figure's legs turn onto a new heading, rad/s. */
export const BODY_TURN_RAD_S = (400 * Math.PI) / 180;
/** A turning-in-place figure steps as if walking this fast per rad/s of turn. */
export const TURN_STEP_M_PER_RAD = 0.25;

/** A deterministic number in [0, 1) for (entity, figure, salt). */
export function hash01(entityId: number, figure: number, salt: number): number {
  return (hashEntityId(entityId * 131 + figure * 17 + salt * 7919) % 100000) / 100000;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
}

/** Turn `from` toward `to` by at most `maxStep`, shortest way. */
export function approachAngle(from: number, to: number, maxStep: number): number {
  const d = wrapAngle(to - from);
  return Math.abs(d) <= maxStep ? to : from + Math.sign(d) * maxStep;
}

/** Interpolate a sim facing (turns) between two ticks, the short way round. */
export function lerpFacingTurns(prev: number, cur: number, alpha: number): number {
  let d = cur - prev;
  d -= Math.round(d);
  return prev + d * alpha;
}

/** A figure's drift off its slot at sim time `t`: [along, across], metres. */
export function slotDrift(entityId: number, figure: number, t: number): [number, number] {
  const pa = lerp(DRIFT_ALONG_PERIOD_S[0], DRIFT_ALONG_PERIOD_S[1], hash01(entityId, figure, 1));
  const pc = lerp(DRIFT_ACROSS_PERIOD_S[0], DRIFT_ACROSS_PERIOD_S[1], hash01(entityId, figure, 2));
  const fa = 2 * Math.PI * hash01(entityId, figure, 3);
  const fc = 2 * Math.PI * hash01(entityId, figure, 4);
  return [
    DRIFT_ALONG_M * Math.sin((2 * Math.PI * t) / pa + fa),
    DRIFT_ACROSS_M * Math.sin((2 * Math.PI * t) / pc + fc),
  ];
}

/** This figure's cadence multiplier, in [1 - CADENCE_VARIANCE, 1 + CADENCE_VARIANCE]. */
export function cadenceMultiplier(entityId: number, figure: number): number {
  return 1 + CADENCE_VARIANCE * (2 * hash01(entityId, figure, 5) - 1);
}

/** Clip phase offset (fraction of a cycle) for a figure: its own plus the unit's. */
export function clipPhase(entityId: number, figure: number): number {
  const unit = hash01(entityId, 0, 6);
  return (FIGURE_PHASES[figure % FIGURE_PHASES.length] + unit) % 1;
}

export interface Follower {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/**
 * Advance a figure toward its slot (`tx`, `tz`, metres, world) given the
 * slot's own velocity (`svx`, `svz`, m/s): a pull toward the slot on top of
 * the slot's velocity, with the change of velocity capped by
 * FIGURE_ACCEL_M_S2 (the start/stop ramp), and the figure never further
 * than SLOT_LAG_MAX_M behind its slot (the approved cap).
 */
export function stepFollower(f: Follower, tx: number, tz: number, svx: number, svz: number, dt: number): void {
  if (dt <= 0) return;
  const wantVx = svx + (tx - f.x) * SLOT_PULL_PER_S;
  const wantVz = svz + (tz - f.z) * SLOT_PULL_PER_S;
  const dvx = wantVx - f.vx;
  const dvz = wantVz - f.vz;
  const dv = Math.hypot(dvx, dvz);
  const cap = FIGURE_ACCEL_M_S2 * dt;
  const k = dv > cap ? cap / dv : 1;
  f.vx += dvx * k;
  f.vz += dvz * k;
  f.x += f.vx * dt;
  f.z += f.vz * dt;
  const ex = f.x - tx;
  const ez = f.z - tz;
  const e = Math.hypot(ex, ez);
  if (e > SLOT_LAG_MAX_M) {
    f.x = tx + (ex / e) * SLOT_LAG_MAX_M;
    f.z = tz + (ez / e) * SLOT_LAG_MAX_M;
  }
}

// --- the kneel ----------------------------------------------------------------

/** The fallback drop and rise (no sim brace): 0.2 s, the sim's own 4 ticks
 *  at 20 Hz (PR #402, the lead's ruling, 5 Oct). */
export const KNEEL_TRANSITION_S = 0.2;

export type Stance = 'none' | 'dropping' | 'kneeling' | 'rising';

/** How far down (0 standing, 1 kneeling) a unit is, from its stance. */
export function stanceDepth(stance: Stance, progress: number): number {
  if (stance === 'kneeling') return 1;
  if (stance === 'dropping') return progress;
  if (stance === 'rising') return 1 - progress;
  return 0;
}

/** Move a figure's own depth toward the unit's, at the clip's own rate. */
export function stepDepth(depth: number, target: number, dt: number): number {
  const step = dt / KNEEL_TRANSITION_S;
  return Math.abs(target - depth) <= step ? target : depth + Math.sign(target - depth) * step;
}

// --- recoil -------------------------------------------------------------------

export type RecoilKind = 'rifle' | 'mg' | 'launcher';

/**
 * One shot's kick, as a spine pitch (radians; positive rocks the shoulders
 * back and lifts the muzzle) and a yaw shudder, at `t` seconds after the
 * shot. The approved numbers, at their shipped multipliers (rifle x2.5,
 * MG x2, launcher x1.5, so the kick reads at 25-60 px):
 *
 *   rifle     a 3-round burst 100 ms apart; each round 4 deg of muzzle rise
 *             and 3 cm back (a 4-deg spine pitch is both), 30 ms up, 150 ms
 *             to settle
 *   mg        a 6-9 round burst 75 ms apart, 1.5 deg a round climbing to
 *             5 deg, a +-1 deg yaw shudder, 250 ms recovery
 *   launcher  no push back: a 3-deg flinch and a 2-deg dip over 60 ms,
 *             400 ms to settle, then the tube lowered for 0.8 s
 */
export const RECOIL_MULTIPLIER: Record<RecoilKind, number> = { rifle: 2.5, mg: 2, launcher: 1.5 };
const DEG = Math.PI / 180;

function pulse(t: number, rise: number, settle: number): number {
  if (t < 0) return 0;
  if (t < rise) return t / rise;
  const u = (t - rise) / settle;
  return u >= 1 ? 0 : (1 - u) * (1 - u);
}

export function recoilAt(kind: RecoilKind, t: number, rounds: number): { pitch: number; yaw: number } {
  const m = RECOIL_MULTIPLIER[kind];
  if (kind === 'rifle') {
    let p = 0;
    for (let r = 0; r < 3; r++) p += pulse(t - r * 0.1, 0.03, 0.15);
    return { pitch: m * 4 * DEG * Math.min(1.6, p), yaw: 0 };
  }
  if (kind === 'mg') {
    let p = 0;
    let shudder = 0;
    for (let r = 0; r < rounds; r++) {
      const tr = t - r * 0.075;
      if (tr < 0) continue;
      p += pulse(tr, 0.02, 0.07);
      shudder += (r % 2 === 0 ? 1 : -1) * pulse(tr, 0.02, 0.07);
    }
    const end = (rounds - 1) * 0.075;
    const climb = t < 0 ? 0 : t <= end ? Math.min(1, t / Math.max(end, 1e-6)) : Math.max(0, 1 - (t - end) / 0.25);
    return { pitch: m * DEG * (1.5 * Math.min(1, p) + 5 * climb), yaw: m * DEG * Math.max(-1, Math.min(1, shudder)) };
  }
  const flinch = pulse(t, 0.06, 0.4);
  const lower = t < 0.06 ? 0 : t < 0.86 ? Math.sin((Math.PI * (t - 0.06)) / 0.8) : 0;
  return { pitch: m * DEG * (-2 * flinch - 6 * lower), yaw: 0 };
}

/** How long one shot's kick lasts, seconds (after that it is exactly zero). */
export function recoilSeconds(kind: RecoilKind, rounds: number): number {
  if (kind === 'rifle') return 0.2 + 0.15 + 0.05;
  if (kind === 'mg') return (rounds - 1) * 0.075 + 0.25 + 0.1;
  return 0.9;
}

/** Rounds in an MG burst: 6-9, by hash. */
export function mgBurstRounds(entityId: number, shot: number): number {
  return 6 + (hashEntityId(entityId * 977 + shot) % 4);
}

/** The delay before a shot's kick lands on its figure: 0-120 ms (approved). */
export function shotJitterS(entityId: number, shot: number): number {
  return ((hashEntityId(entityId * 389 + shot * 31) % 1000) / 1000) * 0.12;
}

/** Which way a figure between standing and kneeling is going. */
export type KneelHeading = 'down' | 'up';

/**
 * The heading of a sim-driven stance: up only while the sim says RISING.
 * Without the sim (the fallback), the heading is read off the depth the
 * figure is moving toward; a tie keeps `prev`.
 */
export function kneelHeading(
  stance: Stance,
  fromSim: boolean,
  depth: number,
  target: number,
  prev: KneelHeading
): KneelHeading {
  if (fromSim) return stance === 'rising' ? 'up' : stance === 'dropping' ? 'down' : prev;
  return target > depth ? 'down' : target < depth ? 'up' : prev;
}

/**
 * Which clip a kneel-capable figure shows at stance depth `depth` (0 standing,
 * 1 down), going `heading`, and how far through a drop or a rise to scrub it
 * (a fraction of the clip), or null to let it play. A posture the sim forces
 * (`down`, `work`, a death) outranks the kneel.
 *
 * The heading is passed in, never inferred from depth against target: when
 * the sim drives the stance the renderer sets the depth FROM the target, so
 * the two are equal on the way up as on the way down, and `target >= depth`
 * -- what this read until spike-walk (6 Oct) -- played every rise as a drop.
 */
export function kneelClipFor(
  desired: ClipName,
  depth: number,
  heading: KneelHeading,
  hasKneel: boolean
): { clip: ClipName; scrub: number | null } {
  if (!hasKneel || (desired !== 'idle' && desired !== 'fire' && desired !== 'move' && desired !== 'moveFire')) {
    return { clip: desired, scrub: null };
  }
  if (depth >= 1) return { clip: 'kneel', scrub: null };
  if (depth <= 0) return { clip: desired, scrub: null };
  return heading === 'down' ? { clip: 'kneelIn', scrub: depth } : { clip: 'kneelOut', scrub: 1 - depth };
}
