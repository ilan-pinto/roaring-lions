/**
 * The stall hint (polish lane, the interim for GH-540's real mission time limit).
 *
 * Once a mission's timed primaries resolve, most missions can end only in a
 * win, a wipe or a Conduct failure: their remaining primaries (`locate`,
 * `capture`, `hold_for`, `eliminate_hvt`) can never fail. A player who has
 * lost the recon drone and does not know which post is still unseen just
 * waits. This is the feed line that says what is still open.
 *
 * Pure and app-side. It reads only what the sim already exposes to the app
 * (the objective rows, the sim's events, the mission's events) and writes
 * nothing back (invariant 4). Time is SIM time -- the tick the caller passes
 * in -- never the wall clock, so a paused sim (no ticks) cannot stall and a
 * fast-forward counts exactly what it simulated.
 *
 * What counts as progress, any of which re-arms the detector:
 *  - an objective changed state (the signature of every row changed);
 *  - a `hold_for`/`capture` clock moved or its pause reason flipped;
 *  - a mission event of any kind (wave, trigger, ROE line, loss, evacuation);
 *  - a kill on either side (`destroyed`);
 *  - one of our sensors identifying something (`contact` identified, side 0).
 * Shots fired are deliberately NOT progress: measured on Khan Rafid I with the
 * recon drone dead and no orders given, the garrison fires ~1,000 rounds in
 * 75 s at the idle column, so counting `fire` would silence the hint in the
 * very case it exists for. A kill is a result; a shot is only noise.
 * A DEADLINE or `survive_until` clock is deliberately NOT progress: it counts
 * down on its own, and the hint is for the primary the player can do
 * something about.
 */
import { TICKS_PER_SECOND } from '@lions/sim';
import { t } from '../i18n/t';
import { DEADLINE_TYPES } from './hud-model';

/** Seconds of sim time with no progress before the hint. Measured over every
 *  plan `pnpm playtest` runs (85 runs, 2026-10-11): outside Wadi Halam IV, a
 *  search mission whose optimal plan legitimately sits 94-125 s with its
 *  `eliminate_hvt` unfound (the hint is true there), the longest quiet stretch
 *  an optimal-play victory sits through with a hintable primary open is
 *  54.6 s, and each of those ends in the win within seconds. 60 clears them
 *  and still speaks inside a minute to a player who has lost the thread. */
export const STALL_SECONDS = 60;
export const STALL_TICKS = STALL_SECONDS * TICKS_PER_SECOND;

export interface StallRow {
  id: string;
  type?: string;
  text: string;
  primary: boolean;
  status: string;
  ticksLeft?: number;
  paused?: 'contested' | 'unheld';
}

/** The sim and mission event kinds the detector reads. Structural, so a test
 *  needs no `Sim`. */
export interface StallEvent {
  kind: string;
  side?: number;
  level?: string;
}

/** Whether one tick's events count as progress. */
export function tickIsActive(events: readonly StallEvent[], missionEvents: readonly unknown[]): boolean {
  if (missionEvents.length > 0) return true;
  for (const e of events) {
    if (e.kind === 'destroyed') return true;
    if (e.kind === 'contact' && e.level === 'identified' && e.side === 0) return true;
  }
  return false;
}

/** The types whose own clock is progress (it only moves while somebody is on
 *  the ground). The deadline types and `survive_until` count down regardless. */
const GROUND_TYPES: ReadonlySet<string> = new Set(['hold_for', 'capture']);

/** A string that changes exactly when an objective changes state or a ground
 *  clock moves. */
export function stallSignature(rows: readonly StallRow[]): string {
  return rows
    .map((o) =>
      o.type !== undefined && GROUND_TYPES.has(o.type)
        ? `${o.id}:${o.status}:${o.ticksLeft ?? ''}:${o.paused ?? ''}`
        : `${o.id}:${o.status}`
    )
    .join('|');
}

/** The open primary a hint should point at: the first one the player can act
 *  on. A running deadline or `survive_until` clock resolves by itself. */
export function hintTarget(rows: readonly StallRow[]): StallRow | null {
  for (const o of rows) {
    if (!o.primary || o.status !== 'active') continue;
    if (o.type === 'survive_until' || (o.type !== undefined && DEADLINE_TYPES.has(o.type))) continue;
    return o;
  }
  return null;
}

export interface StallState {
  signature: string;
  /** The tick the current quiet stretch began. */
  since: number;
  /** Whether this stall has already said its line. */
  hinted: boolean;
}

export function stallStart(tick: number): StallState {
  return { signature: '', since: tick, hinted: false };
}

export interface StallInput {
  /** False in a tutorial, a sandbox, a paused sim or an ended mission: the
   *  detector re-baselines and says nothing. */
  enabled: boolean;
  /** Sim tick, never wall time. */
  tick: number;
  /** Whether any tick since the last call was progress (`tickIsActive`). */
  active: boolean;
  rows: readonly StallRow[];
}

/** One look. Returns the next state and, at most once per stall, the row to
 *  point at. */
export function stallStep(state: StallState, input: StallInput): { state: StallState; hint: StallRow | null } {
  if (!input.enabled) return { state: stallStart(input.tick), hint: null };
  const signature = stallSignature(input.rows);
  if (input.active || signature !== state.signature) {
    return { state: { signature, since: input.tick, hinted: false }, hint: null };
  }
  if (state.hinted || input.tick - state.since < STALL_TICKS) return { state, hint: null };
  const target = hintTarget(input.rows);
  if (target === null) return { state, hint: null };
  return { state: { ...state, hinted: true }, hint: target };
}

/** The feed line for one hint: the action only, by objective type. The
 *  objective's own text is deliberately not in it -- the strip already shows
 *  it, and a short line fits one feed row. */
export function stallHintLine(row: StallRow): string {
  switch (row.type) {
    case 'locate':
      return t('hud.stall.locate');
    case 'capture':
    case 'hold_for':
      return t(
        row.paused === 'unheld' ? 'hud.stall.ground.unheld' : row.paused === 'contested' ? 'hud.stall.ground.contested' : 'hud.stall.ground'
      );
    case 'eliminate_hvt':
      return t('hud.stall.hvt');
    case 'destroy_all':
      return t('hud.stall.destroy');
    default:
      return t('hud.stall.other');
  }
}
