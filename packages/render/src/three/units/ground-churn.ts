/**
 * Churn and clods (GH-984 N2): the earth a vehicle tears up when it PIVOTS on the spot or LAUNCHES
 * hard from a halt. Pure and three-free; `ThreeRenderer.snapshot()` calls `stepChurn` once per sim
 * TICK for every vehicle in `vehicle-tracks.ts`'s table and acts on the answer:
 *  - a `churn` decal through `stampGroundDecal` (the FADING pool, dated at the tick, +0 draw calls);
 *  - a clod burst (`data/vfx/vehicle_clods.json`), recorded as an EVENT with its tick and spawned by
 *    the frame that presents that tick, aged by sim time, seeded by (entity, tick) -- a pure function
 *    of sim time as `rotor-wash.ts`'s puffs are, never of the frame cadence.
 *
 * Detection is per TICK, from the sim's own numbers (the ground speed and the facing change of that
 * tick), never from the drawn hull or the weight model, whose lag is frame-timed:
 *  - PIVOT (tracked hulls only): `running-gear.ts`'s `sideSpeeds` split, one side's track reversing,
 *    which is `|yaw| x halfGauge >= |speed|` (a turn on the spot or nearly), at a yaw rate that is a
 *    real turn and not a correction, held for `CHURN_PIVOT_HOLD_TICKS`; then one scuff per
 *    `CHURN_PIVOT_PERIOD_TICKS` while it lasts;
 *  - LAUNCH (any tracked or wheeled hull): the first tick over a tenth of cruise after at least
 *    `CHURN_LAUNCH_STOPPED_TICKS` standing, at most once per `CHURN_LAUNCH_COOLDOWN_TICKS`.
 *
 * Reduced motion drops the clods (a frame-time read in the renderer) and keeps the decal, which does not move.
 */
import { TRACK_FOOTPRINT, trackStampCenters, type VehicleTrackKind } from '../vehicle-tracks';

export const CHURN_EVENT_NONE = 0;
export const CHURN_EVENT_PIVOT = 1;
export const CHURN_EVENT_LAUNCH = 2;
export type ChurnEvent = typeof CHURN_EVENT_NONE | typeof CHURN_EVENT_PIVOT | typeof CHURN_EVENT_LAUNCH;

/** A pivot is a turn of at least this many turns a second (18 deg/s): a hull settling onto a bearing is not one. */
export const CHURN_PIVOT_MIN_YAW_TURNS_S = 0.05;
export const CHURN_PIVOT_HOLD_TICKS = 4;
export const CHURN_PIVOT_PERIOD_TICKS = 10;
/** Standing is under this share of cruise; a launch is the first tick over it after `CHURN_LAUNCH_STOPPED_TICKS` of standing. */
export const CHURN_STAND_SHARE = 0.1;
export const CHURN_LAUNCH_STOPPED_TICKS = 6;
export const CHURN_LAUNCH_COOLDOWN_TICKS = 40;
/** The scuff's half extents, tiles: a pivot's round one under each track, a launch's long one behind each driven wheel or track. */
export const CHURN_PIVOT_RADIUS_TILES = 0.5;
export const CHURN_LAUNCH_HALF_LENGTH_TILES = 0.5;
export const CHURN_LAUNCH_HALF_WIDTH_TILES = 0.2;
/** How far behind the hull's centre a launch digs in, tiles: past a hull's rear edge, so the scuff is not all under it. */
export const CHURN_LAUNCH_BACK_TILES = 0.8;

/** The wrapped change of a heading in turns, in [-0.5, 0.5). */
export function turnDelta(prevTurns: number, curTurns: number): number {
  const d = curTurns - prevTurns;
  return d - Math.floor(d + 0.5);
}

/** True when a hull turning `yawTurnsS` at `speedTilesS` has one side of its running gear reversing. */
export function isPivoting(speedTilesS: number, yawTurnsS: number, halfGaugeTiles: number): boolean {
  const yaw = Math.abs(yawTurnsS);
  return yaw >= CHURN_PIVOT_MIN_YAW_TURNS_S && yaw * 2 * Math.PI * halfGaugeTiles >= speedTilesS;
}

export interface ChurnState {
  /** Consecutive ticks standing, and consecutive ticks pivoting. */
  readonly stood: Uint16Array;
  readonly pivoting: Uint16Array;
  readonly lastPivotTick: Int32Array;
  readonly lastLaunchTick: Int32Array;
}

const NEVER = -1_000_000;

export function makeChurnState(n: number): ChurnState {
  return {
    stood: new Uint16Array(n),
    pivoting: new Uint16Array(n),
    lastPivotTick: new Int32Array(n).fill(NEVER),
    lastLaunchTick: new Int32Array(n).fill(NEVER),
  };
}

/** A newcomer, or a hull that teleported: no history, no event. */
export function resetChurn(s: ChurnState, e: number): void {
  s.stood[e] = 0;
  s.pivoting[e] = 0;
  s.lastPivotTick[e] = NEVER;
  s.lastLaunchTick[e] = NEVER;
}

/**
 * One tick for one hull. `speedTilesS` is that tick's ground speed, `yawTurnsS` its change of heading
 * in turns a second, `cruiseTilesS` the type's own top speed, `kind` its running gear.
 */
export function stepChurn(
  s: ChurnState,
  e: number,
  tick: number,
  speedTilesS: number,
  yawTurnsS: number,
  cruiseTilesS: number,
  kind: VehicleTrackKind
): ChurnEvent {
  let event: ChurnEvent = CHURN_EVENT_NONE;
  const standing = speedTilesS < CHURN_STAND_SHARE * cruiseTilesS;
  if (kind === 'tracked' && isPivoting(speedTilesS, yawTurnsS, TRACK_FOOTPRINT.tracked.gaugeTiles)) {
    if (s.pivoting[e] < 65535) s.pivoting[e]++;
    if (s.pivoting[e] >= CHURN_PIVOT_HOLD_TICKS && tick - s.lastPivotTick[e] >= CHURN_PIVOT_PERIOD_TICKS) {
      s.lastPivotTick[e] = tick;
      event = CHURN_EVENT_PIVOT;
    }
  } else {
    s.pivoting[e] = 0;
  }
  if (standing) {
    if (s.stood[e] < 65535) s.stood[e]++;
  } else {
    // The first tick out of a halt that lasted: the launch. A pivot's own event wins the tick it shares.
    if (
      event === CHURN_EVENT_NONE &&
      s.stood[e] >= CHURN_LAUNCH_STOPPED_TICKS &&
      tick - s.lastLaunchTick[e] >= CHURN_LAUNCH_COOLDOWN_TICKS
    ) {
      s.lastLaunchTick[e] = tick;
      event = CHURN_EVENT_LAUNCH;
    }
    s.stood[e] = 0;
  }
  return event;
}

export interface ChurnStamp {
  readonly x: number;
  readonly y: number;
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly facingNorm: number;
}

/** The decals one event lays: under each track on a pivot, behind each driven wheel or track on a launch. */
export function churnStamps(event: ChurnEvent, cx: number, cy: number, facingNorm: number, kind: VehicleTrackKind): ChurnStamp[] {
  if (event === CHURN_EVENT_NONE) return [];
  if (event === CHURN_EVENT_PIVOT) {
    return trackStampCenters(cx, cy, facingNorm, kind).map((c) => ({
      x: c.x,
      y: c.y,
      halfLength: CHURN_PIVOT_RADIUS_TILES,
      halfWidth: CHURN_PIVOT_RADIUS_TILES,
      facingNorm,
    }));
  }
  const rad = facingNorm * Math.PI * 2;
  return trackStampCenters(
    cx - Math.cos(rad) * CHURN_LAUNCH_BACK_TILES,
    cy - Math.sin(rad) * CHURN_LAUNCH_BACK_TILES,
    facingNorm,
    kind
  ).map((c) => ({
    x: c.x,
    y: c.y,
    halfLength: CHURN_LAUNCH_HALF_LENGTH_TILES,
    halfWidth: CHURN_LAUNCH_HALF_WIDTH_TILES,
    facingNorm,
  }));
}

/** Clod bursts: two events a second at most per hull, each alive for under 0.6 s, so a two-deep history is every event a frame can still owe. */
export const CLOD_HISTORY = 2;
/** The longest a clod layer lives, ms: an event older than this at the frame that sees it spawns nothing. */
export const CLOD_MAX_LIFE_MS = 600;
/** The burst's strength for `ParticleSystem.spawn`'s magnitude: a pivot's is steady, a launch's a full kick. */
export const CLOD_PIVOT_MAGNITUDE = 0.5;
export const CLOD_LAUNCH_MAGNITUDE = 0.9;

/** The two directions (turns, relative to the hull's heading) a pivot throws clods: out of each flank. */
export const CLOD_PIVOT_DIRS: readonly [number, number] = [0.25, 0.75];
/** A launch throws them straight back. */
export const CLOD_LAUNCH_DIR = 0.5;
/** Where a burst is born, tiles from the hull's centre along its own direction of throw: at the hull's edge, not under it (clods draw below the units). */
export const CLOD_SPAWN_OFFSET_TILES = 0.6;
