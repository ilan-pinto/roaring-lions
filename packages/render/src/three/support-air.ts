/**
 * GH-748: the aircraft over a fire-support call, as pure maths.
 *
 * Two kinds fly (the lead's ruling of 22 Oct, `_coord/barrage-fx/proposal.md`):
 *
 * - **Mortar barrage**: the Peten gunship (`heli_peten_gunship.glb`, reused)
 *   flies in from the friendly side, holds station `HELI_STATION_TILES` from
 *   the aim point with its nose on the target, drifts a slow arc round it
 *   while the six rounds land, and leaves after the last.
 * - **Air strike**: a fixed-wing jet (`vfx/strike_jet.glb`) runs in along the
 *   line from the friendly force to the aim point, crosses the aim point
 *   `JET_LEAD_MS` before the round lands, pulls up and climbs out. A short
 *   bomb streak spans those last `JET_LEAD_MS`.
 *
 * Presentation only (invariant 4). The app tells the renderer when a call is
 * ACCEPTED (`Renderer.supportCalled`); every time below is measured from that
 * call on the SIM clock (`presentationSimMs`), so a paused game holds the
 * aircraft still and a frozen capture repeats exactly. The round times are
 * read from the sim's own `FIRE_SUPPORT` table, read-only, so they cannot
 * drift from the rounds the sim really lands. The explosions do NOT come from
 * here: they stay on the sim's `strike` event, at its exact point and tick.
 * The first `strike` a plan sees re-anchors it (`reanchor`), so the one-tick
 * gap between the click and the tick the command is applied never shows.
 *
 * `three`-free on purpose: `support-air.test.ts` pins every pose.
 */
import { FIRE_SUPPORT, FS_AIR_STRIKE, FS_MORTAR_BARRAGE } from '@lions/sim';
import { WORLD_Y_PER_LIFT_PIXEL } from '../project';
import { AIR_LIFT_PX } from './units/frame-state';

/** One sim tick, in ms (20 Hz). */
const MS_PER_TICK = 50;

// --- the barrage's helicopter ------------------------------------------------
/** Where it holds station, tiles from the aim point, on the friendly side. */
export const HELI_STATION_TILES = 4;
/** Where it enters and leaves, tiles from the aim point. */
export const HELI_FAR_TILES = 20;
/** On station this long BEFORE the first round lands. */
export const HELI_ON_STATION_LEAD_MS = 2000;
/** Leaves this long AFTER the last round. */
export const HELI_LEAVE_AFTER_MS = 1500;
/** The leg in or out, ms. */
export const HELI_TRANSIT_MS = 3500;
/** The arc it drifts round the aim point while on station, radians. */
export const HELI_ORBIT_RAD = Math.PI / 3;
/** Lift, screen px at zoom 1: twice a unit's, so it reads as off-board. */
export const HELI_LIFT_PX = 2 * AIR_LIFT_PX;

// --- the air strike's jet ----------------------------------------------------
/** Ground speed, tiles per second. */
export const JET_SPEED_TILES_S = 18;
/** Run-in length, tiles before the aim point. */
export const JET_RUN_IN_TILES = 25;
/** It crosses the aim point this long before the round lands. */
export const JET_LEAD_MS = 400;
/** Gone this long after the round lands. */
export const JET_EXIT_AFTER_MS = 2000;
/** Lift, screen px at zoom 1: six times a unit's. */
export const JET_LIFT_PX = 6 * AIR_LIFT_PX;
/** The climb-out after the pass: extra world-Y per second squared. */
export const JET_CLIMB_WU_S2 = 2.5;
/** The nose-up pitch it settles into during the climb-out, radians. */
export const JET_CLIMB_PITCH_RAD = 0.35;

export type SupportAirKind = 'barrage' | 'strike';

/** The kind of a fire-support call that flies an aircraft, or `null`. */
export function supportAirKind(call: string): SupportAirKind | null {
  if (call === 'mortar_barrage') return 'barrage';
  if (call === 'air_strike') return 'strike';
  return null;
}

/** The sim profile index a kind's rounds carry on their `strike` events. */
export function profileOf(kind: SupportAirKind): number {
  return kind === 'barrage' ? FS_MORTAR_BARRAGE : FS_AIR_STRIKE;
}

/** First and last impact, ms after the call is applied, from `FIRE_SUPPORT`. */
export function impactWindowMs(kind: SupportAirKind): { first: number; last: number } {
  const p = FIRE_SUPPORT[profileOf(kind)];
  const first = p.delayTicks * MS_PER_TICK;
  return { first, last: first + (p.rounds - 1) * p.spacingTicks * MS_PER_TICK };
}

export interface SupportAirPlan {
  readonly kind: SupportAirKind;
  /** Sim ms of the call; `reanchor` may move it once. */
  anchorMs: number;
  /** Set when the first `strike` has re-anchored the plan. */
  anchored: boolean;
  /** Aim point, tiles. */
  readonly ax: number;
  readonly ay: number;
  /** Unit vector from the aim point TOWARD the friendly side (tiles). */
  readonly fx: number;
  readonly fy: number;
}

/**
 * A plan for one accepted call. `fromX`/`fromY` is the friendly force's
 * centroid; when it is missing or on the aim point the aircraft comes from
 * the map's south-west (screen bottom-left), a fixed and harmless default.
 */
export function makeSupportAirPlan(
  kind: SupportAirKind,
  callTick: number,
  ax: number,
  ay: number,
  fromX: number | null,
  fromY: number | null
): SupportAirPlan {
  let dx = fromX === null ? 0 : fromX - ax;
  let dy = fromY === null ? 0 : fromY - ay;
  let len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) {
    dx = -1;
    dy = 1;
    len = Math.SQRT2;
  }
  return { kind, anchorMs: callTick * MS_PER_TICK, anchored: false, ax, ay, fx: dx / len, fy: dy / len };
}

/** The sim-ms span a plan draws over, relative to its anchor. */
export function planSpanMs(kind: SupportAirKind): { start: number; end: number } {
  const w = impactWindowMs(kind);
  if (kind === 'barrage') {
    const onStation = w.first - HELI_ON_STATION_LEAD_MS;
    return { start: onStation - HELI_TRANSIT_MS, end: w.last + HELI_LEAVE_AFTER_MS + HELI_TRANSIT_MS };
  }
  const over = w.first - JET_LEAD_MS;
  return { start: over - (JET_RUN_IN_TILES / JET_SPEED_TILES_S) * 1000, end: w.first + JET_EXIT_AFTER_MS };
}

/** How far (ms) a strike may land from a plan's expected FIRST round and
 *  still be that round: the click-to-apply gap is one tick, so two is slack. */
export const REANCHOR_SLACK_MS = 2 * MS_PER_TICK;

/**
 * Is a `strike` on `strikeTick` this plan's FIRST round? Only that round may
 * re-anchor it: a later round of an EARLIER call over the same ground lands
 * nowhere near this plan's first-round time and is ignored, as is any strike
 * for a call the sim dropped.
 */
export function isFirstRound(plan: SupportAirPlan, strikeTick: number): boolean {
  if (plan.anchored) return false;
  const expected = plan.anchorMs + impactWindowMs(plan.kind).first;
  return Math.abs(strikeTick * MS_PER_TICK - expected) <= REANCHOR_SLACK_MS;
}

/**
 * Moves a plan's anchor so its FIRST impact sits on the tick a `strike` really
 * landed. Only once per plan, and only for the plan's own first round: later
 * rounds are spaced by the table, so they agree by construction.
 */
export function reanchor(plan: SupportAirPlan, strikeTick: number): void {
  if (plan.anchored) return;
  plan.anchored = true;
  plan.anchorMs = strikeTick * MS_PER_TICK - impactWindowMs(plan.kind).first;
}

export interface AirPose {
  /** Tiles. */
  readonly x: number;
  readonly y: number;
  /** World-Y above the ground under (x, y). */
  readonly liftWu: number;
  /** Heading in turns (the sim's `facing` convention: atan2(dy, dx) / 2PI). */
  readonly facingTurns: number;
  /** Nose-up pitch, radians. */
  readonly pitchRad: number;
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const turnsOf = (dx: number, dy: number): number => Math.atan2(dy, dx) / (2 * Math.PI);

/** The pose at sim time `nowMs`, or `null` while the aircraft is not over the map. */
export function supportAirPose(plan: SupportAirPlan, nowMs: number): AirPose | null {
  const t = nowMs - plan.anchorMs;
  const span = planSpanMs(plan.kind);
  if (t < span.start || t > span.end) return null;
  return plan.kind === 'barrage' ? heliPose(plan, t) : jetPose(plan, t);
}

function heliPose(plan: SupportAirPlan, t: number): AirPose {
  const w = impactWindowMs('barrage');
  const stationAt = w.first - HELI_ON_STATION_LEAD_MS;
  const leaveAt = w.last + HELI_LEAVE_AFTER_MS;
  const base = Math.atan2(plan.fy, plan.fx);
  let r: number;
  let ang: number;
  let outbound = false;
  if (t < stationAt) {
    // Inbound: slows into the station (ease-out on the radius).
    const k = smooth((t - (stationAt - HELI_TRANSIT_MS)) / HELI_TRANSIT_MS);
    r = HELI_FAR_TILES + (HELI_STATION_TILES - HELI_FAR_TILES) * k;
    ang = base;
  } else if (t <= leaveAt) {
    r = HELI_STATION_TILES;
    ang = base + HELI_ORBIT_RAD * smooth((t - stationAt) / (leaveAt - stationAt));
  } else {
    const k = smooth((t - leaveAt) / HELI_TRANSIT_MS);
    r = HELI_STATION_TILES + (HELI_FAR_TILES - HELI_STATION_TILES) * k;
    ang = base + HELI_ORBIT_RAD;
    outbound = true;
  }
  const x = plan.ax + Math.cos(ang) * r;
  const y = plan.ay + Math.sin(ang) * r;
  // Nose on the target, or along the way out when leaving.
  const facingTurns = outbound ? turnsOf(x - plan.ax, y - plan.ay) : turnsOf(plan.ax - x, plan.ay - y);
  return { x, y, liftWu: HELI_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL, facingTurns, pitchRad: 0 };
}

function jetPose(plan: SupportAirPlan, t: number): AirPose {
  const over = impactWindowMs('strike').first - JET_LEAD_MS;
  // Travel is FROM the friendly side, i.e. along -f.
  const s = ((t - over) / 1000) * JET_SPEED_TILES_S;
  const x = plan.ax - plan.fx * s;
  const y = plan.ay - plan.fy * s;
  let liftWu = JET_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL;
  let pitchRad = 0;
  if (t > over) {
    const dt = (t - over) / 1000;
    liftWu += JET_CLIMB_WU_S2 * dt * dt;
    pitchRad = JET_CLIMB_PITCH_RAD * smooth(dt / 0.8);
  }
  return { x, y, liftWu, facingTurns: turnsOf(-plan.fx, -plan.fy), pitchRad };
}

/**
 * The air strike's bomb, as a fraction of its fall: `null` outside the last
 * `JET_LEAD_MS` before impact, else 0 (released over the aim point, at the
 * jet's height) to 1 (on the ground at impact).
 */
export function bombFallFraction(plan: SupportAirPlan, nowMs: number): number | null {
  if (plan.kind !== 'strike') return null;
  const impact = impactWindowMs('strike').first;
  const t = nowMs - plan.anchorMs;
  if (t < impact - JET_LEAD_MS || t >= impact) return null;
  return (t - (impact - JET_LEAD_MS)) / JET_LEAD_MS;
}

// --- the strike's scorch on relief -------------------------------------------
/** The air strike's scorch radius on flat ground, tiles (the lead, 22 Oct). */
export const STRIKE_SCORCH_FLAT_TILES = 2.4;
/** ...capped to this where the ground under it is not flat (the decal pool's
 *  full-power size, whose sag over a crest is measured; CLAUDE.md, F-23). */
export const STRIKE_SCORCH_RELIEF_TILES = 1.6;
export const STRIKE_CRATER_TILES = 1.4;
export const BARRAGE_SCORCH_TILES = 1.2;
export const BARRAGE_CRATER_TILES = 0.6;
/** Detonation strengths (`impactPower` units). */
export const BARRAGE_IMPACT_POWER = 0.8;
export const AIR_STRIKE_IMPACT_POWER = 1.5;

/**
 * The strike's scorch radius at (x, y): `STRIKE_SCORCH_FLAT_TILES` when every
 * tile the flat-size disc touches stands at the centre tile's level, else
 * `STRIKE_SCORCH_RELIEF_TILES`. `elevation` is the map's per-tile level grid
 * (row-major, `w * h`), or null for a flat map.
 */
export function strikeScorchRadius(
  elevation: ArrayLike<number> | null,
  w: number,
  h: number,
  x: number,
  y: number
): number {
  if (elevation === null || elevation.length < w * h) return STRIKE_SCORCH_FLAT_TILES;
  const cx = Math.min(w - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(h - 1, Math.max(0, Math.floor(y)));
  const level = elevation[cy * w + cx];
  const r = STRIKE_SCORCH_FLAT_TILES;
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      // Nearest point of the tile to the centre, inside the disc?
      const nx = Math.min(Math.max(x, tx), tx + 1);
      const ny = Math.min(Math.max(y, ty), ty + 1);
      if ((nx - x) * (nx - x) + (ny - y) * (ny - y) > r * r) continue;
      if (elevation[ty * w + tx] !== level) return STRIKE_SCORCH_RELIEF_TILES;
    }
  }
  return r;
}
