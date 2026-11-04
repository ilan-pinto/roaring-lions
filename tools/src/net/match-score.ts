/**
 * Match scoring (GH-973, the lead's ruling of 3 Nov): a score for BOTH players
 * of a versus match, 1-10 on each of five criteria with a one-line reason for
 * each, plus an overall score.
 *
 * - `pnpm bot`: the bot scores both players itself (the harness's `match_stats`
 *   and `submit_score` tools; bot.ts writes the result into its report).
 * - `pnpm arena --judge`: a separate judge process scores each side on the same
 *   rubric (judge.ts).
 *
 * This module is the whole of what both share:
 *
 * 1. The RUBRIC: criteria ids, labels, the 1-10 bounds, the reason limit.
 * 2. The REFEREE'S STATS: what the match looked like to someone who sees both
 *    sides. They are read from the referee's own sim, read-only (invariant 4),
 *    by `scan` at the end and by `RefereeTally` as the match runs (the things
 *    an end state cannot say: idle time, first orders, a timeline).
 * 3. The PROMPT builder for the scorer.
 * 4. A strict PARSER/VALIDATOR of the scorer's JSON reply. It never repairs:
 *    a score out of range, a criterion missing, an extra key or a reason that
 *    is not one line is `invalid`, and the caller records it as such. A score
 *    is never invented.
 *
 * Scores are for reading. Nothing here is fed back into the sim, the room or a
 * game's result (D7: results are not changed by scoring), and the referee's
 * numbers are shown to the bot only once the match has a result, so they are
 * never a way to see through the fog.
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import type { Faction, Seat, WinMode } from '@lions/net';
import type { Sim, SimEvent } from '@lions/sim';
import { WOUND_NONE, WOUND_STABILISED, ZONE_CONTESTED } from '@lions/sim';
import { unitCost, type MatchResult } from '../../../packages/app/src/net/outcome';
import { isIdle } from '../../../packages/app/src/ui/idle';

// ---------------------------------------------------------------------------
// The rubric
// ---------------------------------------------------------------------------

/** The lead's five criteria (GH-973, 3 Nov), in order. */
export const CRITERIA = [
  {
    id: 'fewer_deaths',
    label: 'Fewer deaths',
    hint: 'Units destroyed, men killed inside squads and wounded men who died, against the force it had and against what the opponent lost. Fewer is better.',
  },
  {
    id: 'wounded_care',
    label: 'Wounded treatment and evacuation',
    hint: 'Of the men who fell wounded, how many were rescued (stabilised, carried off, treated) rather than left to bleed. If none fell wounded, score 5 and say so.',
  },
  {
    id: 'force_preservation',
    label: 'Force preservation',
    hint: 'Force value left at the end, and how efficiently value was traded: value lost against value destroyed, units not thrown away.',
  },
  {
    id: 'tempo_initiative',
    label: 'Tempo and initiative',
    hint: 'How early and how often it acted (first order, orders sent), how much of its force sat idle, and who forced the engagements.',
  },
  {
    id: 'adaptation',
    label: 'Adaptation',
    hint: 'Whether it changed its approach as the match developed: new orders after losses or contact, a shift in where and how it fought, rather than repeating one plan.',
  },
] as const;

export type CriterionId = (typeof CRITERIA)[number]['id'];
export const CRITERION_IDS: readonly CriterionId[] = CRITERIA.map((c) => c.id);

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
/** A reason is one line of at most this many characters (UTF-16 code units). */
export const MAX_REASON_CHARS = 240;

export interface Scored { score: number; reason: string }
export interface PlayerScore {
  criteria: Record<CriterionId, Scored>;
  overall: Scored;
}
/** Both players' scores, BY SEAT. */
export interface ScoreSet { seat0: PlayerScore; seat1: PlayerScore }

export const SEAT_KEYS = ['seat0', 'seat1'] as const;

// ---------------------------------------------------------------------------
// The strict validator
// ---------------------------------------------------------------------------

export type Validated = { ok: true; scores: ScoreSet } | { ok: false; problems: string[] };

/** The most problems one verdict lists: a reply that is wrong everywhere says so in the first few. */
const MAX_PROBLEMS = 12;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A line break of any kind, or any other control character: LF, CR, VT, FF, NEL, LS, PS (Unicode Cc, Zl, Zp). */
const NOT_ONE_LINE = /[\p{Cc}\p{Zl}\p{Zp}]/u;

function checkScored(where: string, v: unknown, problems: string[]): Scored | null {
  if (!isRecord(v)) { problems.push(`${where} must be an object {"score": 1-10, "reason": "one line"}`); return null; }
  const extra = Object.keys(v).filter((k) => k !== 'score' && k !== 'reason');
  if (extra.length > 0) problems.push(`${where} has unknown key(s): ${extra.join(', ')}`);
  let good = true;
  const score = v.score;
  if (typeof score !== 'number' || !Number.isInteger(score)) { problems.push(`${where}.score must be a whole number ${SCORE_MIN}-${SCORE_MAX}`); good = false; }
  else if (score < SCORE_MIN || score > SCORE_MAX) { problems.push(`${where}.score is ${score}, outside ${SCORE_MIN}-${SCORE_MAX}`); good = false; }
  const reason = v.reason;
  if (typeof reason !== 'string') { problems.push(`${where}.reason must be a string`); good = false; }
  else if (reason.trim() === '') { problems.push(`${where}.reason is empty`); good = false; }
  else if (NOT_ONE_LINE.test(reason)) { problems.push(`${where}.reason must be one line (no line break or control character)`); good = false; }
  else if (reason.length > MAX_REASON_CHARS) { problems.push(`${where}.reason is ${reason.length} characters; at most ${MAX_REASON_CHARS}`); good = false; }
  return good && extra.length === 0 ? { score: score as number, reason: (reason as string).trim() } : null;
}

function checkPlayer(where: string, v: unknown, problems: string[]): PlayerScore | null {
  if (!isRecord(v)) { problems.push(`${where} must be an object {"criteria": {...}, "overall": {...}}`); return null; }
  const extra = Object.keys(v).filter((k) => k !== 'criteria' && k !== 'overall');
  if (extra.length > 0) problems.push(`${where} has unknown key(s): ${extra.join(', ')}`);
  let ok = extra.length === 0;
  const criteria: Partial<Record<CriterionId, Scored>> = {};
  const c = v.criteria;
  if (!isRecord(c)) { problems.push(`${where}.criteria must be an object with the keys ${CRITERION_IDS.join(', ')}`); ok = false; }
  else {
    const unknown = Object.keys(c).filter((k) => !(CRITERION_IDS as readonly string[]).includes(k));
    if (unknown.length > 0) { problems.push(`${where}.criteria has unknown key(s): ${unknown.join(', ')}`); ok = false; }
    for (const id of CRITERION_IDS) {
      if (!(id in c)) { problems.push(`${where}.criteria.${id} is missing`); ok = false; continue; }
      const s = checkScored(`${where}.criteria.${id}`, c[id], problems);
      if (s === null) ok = false; else criteria[id] = s;
    }
  }
  if (!('overall' in v)) { problems.push(`${where}.overall is missing`); ok = false; }
  const overall = 'overall' in v ? checkScored(`${where}.overall`, v.overall, problems) : null;
  if (overall === null) ok = false;
  return ok && overall !== null ? { criteria: criteria as Record<CriterionId, Scored>, overall } : null;
}

/**
 * The scorer's reply as an object, or why it is not a score. Strict: exactly
 * `seat0` and `seat1` (optionally under one `scores` key), each with the five
 * criteria and an `overall`, every score a whole number 1-10 and every reason
 * one non-empty line. It lists every problem it finds (up to a dozen) so a
 * model that submits through a tool can fix them all at once.
 */
export function validateScores(v: unknown): Validated {
  const problems: string[] = [];
  let top: unknown = v;
  if (isRecord(v) && 'scores' in v) {
    if (Object.keys(v).length !== 1) problems.push('with a "scores" key the reply has nothing else');
    top = v.scores;
  }
  if (!isRecord(top)) return { ok: false, problems: [...problems, 'the scores must be an object {"seat0": {...}, "seat1": {...}}'] };
  const extra = Object.keys(top).filter((k) => k !== 'seat0' && k !== 'seat1');
  if (extra.length > 0) problems.push(`unknown key(s): ${extra.join(', ')} (only seat0 and seat1)`);
  const s0 = 'seat0' in top ? checkPlayer('seat0', top.seat0, problems) : (problems.push('seat0 is missing'), null);
  const s1 = 'seat1' in top ? checkPlayer('seat1', top.seat1, problems) : (problems.push('seat1 is missing'), null);
  if (problems.length > 0 || s0 === null || s1 === null) return { ok: false, problems: problems.slice(0, MAX_PROBLEMS) };
  return { ok: true, scores: { seat0: s0, seat1: s1 } };
}

/**
 * The JSON object in a scorer's text: the whole text when it is one, else the
 * body of a single fenced block (```json). Nothing is hunted for in running
 * prose: a reply that quotes an example object and then says something else
 * is not a score.
 */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; problem: string } {
  const t = text.trim();
  if (t === '') return { ok: false, problem: 'the reply is empty' };
  const tryParse = (s: string): { ok: true; value: unknown } | { ok: false; problem: string } => {
    try { return { ok: true, value: JSON.parse(s) as unknown }; } catch (e) { return { ok: false, problem: `the reply is not valid JSON (${e instanceof Error ? e.message : String(e)})` }; }
  };
  if (t.startsWith('{')) return tryParse(t);
  const fences = [...t.matchAll(/```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/g)];
  if (fences.length === 1) return tryParse(fences[0][1]);
  if (fences.length > 1) return { ok: false, problem: 'the reply has more than one fenced block' };
  return { ok: false, problem: 'the reply is not a JSON object (nor one fenced block)' };
}

/** A scorer's text -> the validated scores, or the reasons it is not. */
export function parseScoreReply(text: string): Validated {
  const j = extractJson(text);
  return j.ok ? validateScores(j.value) : { ok: false, problems: [j.problem] };
}

/**
 * What a command-line client printed: with `--output-format json` the last
 * line is one result object whose `result` is the model's text (and `usage`
 * its spend); a plain client's stdout is the reply itself.
 */
export function clientReply(stdout: string): { text: string; isError: boolean } {
  const lines = stdout.trimEnd().split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (last.startsWith('{')) {
    try {
      const o = JSON.parse(last) as { result?: unknown; is_error?: unknown; type?: unknown };
      if (isRecord(o) && typeof o.result === 'string' && (o.type === 'result' || 'usage' in o || 'is_error' in o)) {
        return { text: o.result, isError: o.is_error === true };
      }
    } catch { /* not a result object: the whole output is the reply */ }
  }
  return { text: stdout, isError: false };
}

// ---------------------------------------------------------------------------
// The referee's stats
// ---------------------------------------------------------------------------

/** Idle time is sampled once a game second. */
export const SAMPLE_EVERY_TICKS = 20;
/** The timeline keeps a point every 30 game seconds. */
export const TIMELINE_EVERY_TICKS = 600;
export const TIMELINE_MAX = 200;
const TICKS_PER_SECOND = 20;

/** One side's end-of-match numbers, read from the sim. BY SEAT in `RefereeStats`. */
export interface SeatStats {
  seat: Seat;
  side: 0 | 1;
  faction: Faction;
  /** Fighting and support units (a squad is one unit) destroyed. A squad counts once, when its last man goes. */
  unitsLost: number;
  /** Men of this side who died inside a squad that wounds can fall from, short of its last man (the sim's `manKilled`); read from the event stream, so a client that joined late misses the earlier ones. */
  menKilled: number;
  /** Their cost in logistics value (the number the cost curve and the scoreboard use). */
  lostValue: number;
  /** Enemy fighting units this side destroyed. */
  destroyed: number;
  destroyedValue: number;
  /** Units and value still alive at the end. */
  remainingUnits: number;
  remainingValue: number;
  /** Men of this side who fell wounded (each a body on the field). */
  woundedFell: number;
  /** Wounded still down or stabilised on the field at the end. */
  woundedOnField: number;
  /** ...of those, the ones a medic had stabilised. */
  woundedStabilised: number;
  /** Wounded taken off the field alive: carried to an evacuation point or an aid post, treated, or returned to a squad. */
  woundedRescued: number;
  /** Wounded who bled out or were killed. */
  woundedDied: number;
  /** `unitsLost + menKilled + woundedDied`: every death on this side. */
  deaths: number;
  /** Unit-seconds the side's units stood idle (the idle finder's own rule), and unit-seconds alive; both sampled once a game second. */
  idleUnitSeconds: number;
  unitSeconds: number;
  /** `idleUnitSeconds / unitSeconds` as a percentage, 1 decimal; null with no sample. */
  idlePct: number | null;
  /** Commands this seat sent (a command can still be dropped by the sim), by verb. */
  ordersSent: number;
  ordersByKind: Record<string, number>;
  /** The tick of this seat's first command, and of the first moment (to a second) one of its units had been lost. null: never. */
  firstOrderTick: number | null;
  firstLossTick: number | null;
  /** A points race only (GH-976 P2, GH-973's goal timeline): the points this seat banked, by SOURCE. `total` is the race's own
   *  number (whole points, the runtime's score); `fromZones` is what its held zones paid and `fromKills` what the enemy units it
   *  destroyed paid, over the span this client observed (to one decimal point; they sum to `total` when it observed the whole race);
   *  `byZone` splits `fromZones` by zone id. */
  points?: { total: number; fromZones: number; fromKills: number; byZone: Record<string, number> };
}

/** The match every 30 game seconds: a compact event log. BY SEAT. */
export interface TimelinePoint {
  tick: number;
  /** Units alive (wounded bodies apart). */
  units: [number, number];
  /** Surviving force value. */
  force: [number, number];
  /** Wounded down or stabilised on the field. */
  woundedOnField: [number, number];
  /** Commands sent since the previous point. */
  orders: [number, number];
  /** A points race only: whole points banked so far, by seat. */
  points?: [number, number];
}

export interface RefereeStats {
  version: 1;
  map: string;
  tick: number;
  clock: string;
  /** How the match ended, in words, or null while it has no result (the arena's cap is decided by the arena: it passes its verdict). */
  result: string | null;
  /** The first tick the tally observed. Above 0 only when this client joined late (a snapshot rejoin): the idle, order and timeline figures then cover the rest of the match. */
  observedFromTick: number;
  /** How the room is won (GH-976 P2): `annihilation`, or the win mode. Absent on stats from before. */
  mode?: 'annihilation' | WinMode;
  /** A points race only: the points target. */
  target?: number;
  seats: [SeatStats, SeatStats];
  timeline: TimelinePoint[];
}

/** What the tally reads of a points race (GH-976 P2): the runtime's exact score and its zone holders, and the mode file's
 *  rates and target. Structural, so a test can hand it a plain object. A pure read. */
export interface PointsTap {
  readonly runtime: {
    scoreUnitsOf(side: 0 | 1): number;
    readonly incomeZones: readonly { readonly zone: string; readonly state: number; readonly holder: number }[];
  };
  readonly rules: { readonly target: number; readonly zones: readonly { readonly zone: string; readonly per_min: number }[] };
}

/** A score is held in 1/1200ths of a point (`mission.ts`'s `SCORE_UNITS`: a minute of ticks). A test pins the copy. */
export const POINTS_UNITS = 1200;
const onePlace = (units: number): number => Math.round((units * 10) / POINTS_UNITS) / 10;

interface SideScan {
  unitsLost: number;
  lostValue: number;
  alive: number;
  value: number;
  woundedFell: number;
  woundedOnField: number;
  woundedStabilised: number;
  woundedRescued: number;
  woundedDied: number;
  idle: number;
}
const blankScan = (): SideScan => ({ unitsLost: 0, lostValue: 0, alive: 0, value: 0, woundedFell: 0, woundedOnField: 0, woundedStabilised: 0, woundedRescued: 0, woundedDied: 0, idle: 0 });

/**
 * One pass over the sim, by SIDE. Read-only. `costOf` prices a unit type (the
 * scoreboard's own `unitCost`). A wounded man is a body of a `wounded`-role
 * type (or any unit with a wound state): he is counted apart and never as a
 * unit alive or lost. A body taken off the board WITHOUT a fight (`removed`) is
 * not a loss; for a wounded man it is exactly a rescue.
 */
export function scan(sim: Sim, costOf: (typeId: string) => number = unitCost): [SideScan, SideScan] {
  const out: [SideScan, SideScan] = [blankScan(), blankScan()];
  const st = sim.state;
  for (let i = 0; i < sim.entityCount; i++) {
    const side = st.side[i];
    if (side !== 0 && side !== 1) continue; // civilians are nobody's
    const s = out[side];
    const type = sim.unitTypes[st.typeIdx[i]];
    const alive = st.alive[i] === 1;
    const removed = st.removed[i] === 1;
    if (type.isWounded || st.woundState[i] !== WOUND_NONE) {
      s.woundedFell++;
      if (alive) {
        s.woundedOnField++;
        if (st.woundState[i] === WOUND_STABILISED) s.woundedStabilised++;
      } else if (removed) s.woundedRescued++;
      else s.woundedDied++;
      continue;
    }
    if (alive) {
      s.alive++;
      s.value += costOf(type.id);
      if (isIdle({
        alive: true, side, moving: st.moving[i] !== 0, waypoints: sim.waypointCount(i),
        curTarget: st.curTarget[i], curStructure: st.curStructure[i], demoTarget: st.demoTarget[i],
        carriedBy: st.carriedBy[i], garrisonedIn: st.garrisonedIn[i],
      }, side)) s.idle++;
    } else if (!removed) {
      s.unitsLost++;
      s.lostValue += costOf(type.id);
    }
  }
  return out;
}

/**
 * What a running match leaves that its end state cannot say: idle time, the
 * commands each seat sent, the first order and the first loss of each, and the
 * timeline. An `AgentClient` feeds it from its own frame loop: `onFrame` before
 * a frame runs, `onTick` after the tick. It reads the sim and writes nothing to
 * it. A client that replays the room's log (a respawned harness) feeds it the
 * whole match again, so it reads the same.
 */
export class RefereeTally {
  private first = -1;
  private readonly idle: [number, number] = [0, 0];
  private readonly seconds: [number, number] = [0, 0];
  private readonly sent: [number, number] = [0, 0];
  /** Men killed inside a squad, BY SIDE. */
  private readonly men: [number, number] = [0, 0];
  private readonly byKind: [Record<string, number>, Record<string, number>] = [{}, {}];
  private readonly firstOrder: [number | null, number | null] = [null, null];
  private readonly firstLoss: [number | null, number | null] = [null, null];
  private readonly timeline: TimelinePoint[] = [];
  private sentAtPoint: [number, number] = [0, 0];
  /** The points race this tally reads, when the room plays one (`setPoints`). */
  private tap: PointsTap | null = null;
  /** Per SIDE: the score units seen at the last tick, what the zones paid (by zone), and what that makes of the rest (kills). */
  private lastUnits: [number, number] | null = null;
  private readonly zoneUnits: [Record<string, number>, Record<string, number>] = [{}, {}];
  private readonly killUnits: [number, number] = [0, 0];

  /** Reads this room's points race from now on. Called once, when the world is built. */
  setPoints(tap: PointsTap): void {
    this.tap = tap;
  }

  /**
   * One tick of a points race. The runtime pays each zone's holder `per_min` score units a tick (never a contested or empty
   * zone) and the value of every enemy unit that died, so the tick's rise in a side's units is the zones' share plus the
   * kills'. The zones' share is read from the holders and the file's rates; the kills' is what is left of the rise, so the two
   * always add to the runtime's own number. A tick on which a side completes its goal stops its score short of the rates
   * (a completed objective stops accumulating), so the zones' share is capped at the rise: zones are credited first.
   */
  private stepPoints(tap: PointsTap): void {
    const now: [number, number] = [tap.runtime.scoreUnitsOf(0), tap.runtime.scoreUnitsOf(1)];
    const last = this.lastUnits;
    this.lastUnits = now;
    if (last === null) return;   // the first tick seen: what came before is not ours to split
    for (const side of [0, 1] as const) {
      const rise = now[side] - last[side];
      if (rise <= 0) continue;
      let zones = 0;
      for (const z of tap.rules.zones) {
        const live = tap.runtime.incomeZones.find((x) => x.zone === z.zone);
        if (live === undefined || live.state === ZONE_CONTESTED || live.holder !== side) continue;
        const paid = Math.min(z.per_min, rise - zones);
        if (paid <= 0) continue;
        zones += paid;
        this.zoneUnits[side][z.zone] = (this.zoneUnits[side][z.zone] ?? 0) + paid;
      }
      this.killUnits[side] += rise - zones;
    }
  }

  /** Commands in a frame, by seat (`Stamped.seat`; the room stamps it). */
  onFrame(tick: number, cmds: readonly { seat: Seat; cmd: { kind: string } }[]): void {
    if (this.first < 0) this.first = tick;
    for (const c of cmds) {
      this.sent[c.seat]++;
      this.byKind[c.seat][c.cmd.kind] = (this.byKind[c.seat][c.cmd.kind] ?? 0) + 1;
      this.firstOrder[c.seat] ??= tick;
    }
  }

  /** The tick's sim events: a man killed inside a squad that lives on (`manKilled`) is a death no end state shows. */
  onEvents(sim: Sim, events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.kind !== 'manKilled') continue;
      const side = sim.state.side[e.entity];
      if (side === 0 || side === 1) this.men[side]++;
    }
  }

  /** After a tick has run. `sides[seat]` is the side the seat plays. Samples once a game second. */
  onTick(sim: Sim, sides: readonly [0 | 1, 0 | 1]): void {
    const t = sim.tickCount;
    if (this.first < 0) this.first = t;
    if (this.tap !== null) this.stepPoints(this.tap);
    if (t % SAMPLE_EVERY_TICKS !== 0) return;
    const sc = scan(sim);
    for (const seat of [0, 1] as const) {
      const s = sc[sides[seat]];
      this.idle[seat] += s.idle;
      this.seconds[seat] += s.alive;
      if (s.unitsLost > 0) this.firstLoss[seat] ??= t;
    }
    if (t % TIMELINE_EVERY_TICKS === 0 && this.timeline.length < TIMELINE_MAX) {
      const [a, b] = [sc[sides[0]], sc[sides[1]]];
      this.timeline.push({
        tick: t,
        units: [a.alive, b.alive],
        force: [a.value, b.value],
        woundedOnField: [a.woundedOnField, b.woundedOnField],
        orders: [this.sent[0] - this.sentAtPoint[0], this.sent[1] - this.sentAtPoint[1]],
        ...(this.tap === null ? {} : { points: [Math.floor(this.tap.runtime.scoreUnitsOf(sides[0]) / POINTS_UNITS), Math.floor(this.tap.runtime.scoreUnitsOf(sides[1]) / POINTS_UNITS)] as [number, number] }),
      });
      this.sentAtPoint = [this.sent[0], this.sent[1]];
    }
  }

  /** A side's points by source. */
  private pointsOf(side: 0 | 1): NonNullable<SeatStats['points']> {
    const tap = this.tap as PointsTap;
    const byZone: Record<string, number> = {};
    let zones = 0;
    for (const [zone, units] of Object.entries(this.zoneUnits[side])) { byZone[zone] = onePlace(units); zones += units; }
    return { total: Math.floor(tap.runtime.scoreUnitsOf(side) / POINTS_UNITS), fromZones: onePlace(zones), fromKills: onePlace(this.killUnits[side]), byZone };
  }

  /** The numbers so far, from the sim as it stands. `result`: how the match ended in words, if it has. */
  stats(sim: Sim, o: { map: string; sides: readonly [0 | 1, 0 | 1]; factions: readonly [Faction, Faction]; result: string | null }): RefereeStats {
    const sc = scan(sim);
    const seat = (n: Seat): SeatStats => {
      const mine = sc[o.sides[n]];
      const theirs = sc[o.sides[n] === 0 ? 1 : 0];
      const idleSec = this.idle[n];
      const sec = this.seconds[n];
      return {
        seat: n,
        side: o.sides[n],
        faction: o.factions[n],
        unitsLost: mine.unitsLost,
        menKilled: this.men[o.sides[n]],
        lostValue: mine.lostValue,
        destroyed: theirs.unitsLost,
        destroyedValue: theirs.lostValue,
        remainingUnits: mine.alive,
        remainingValue: mine.value,
        woundedFell: mine.woundedFell,
        woundedOnField: mine.woundedOnField,
        woundedStabilised: mine.woundedStabilised,
        woundedRescued: mine.woundedRescued,
        woundedDied: mine.woundedDied,
        deaths: mine.unitsLost + this.men[o.sides[n]] + mine.woundedDied,
        idleUnitSeconds: idleSec,
        unitSeconds: sec,
        idlePct: sec === 0 ? null : Math.round((idleSec / sec) * 1000) / 10,
        ordersSent: this.sent[n],
        ordersByKind: { ...this.byKind[n] },
        firstOrderTick: this.firstOrder[n],
        firstLossTick: this.firstLoss[n],
        ...(this.tap === null ? {} : { points: this.pointsOf(o.sides[n]) }),
      };
    };
    return {
      version: 1,
      map: o.map,
      tick: sim.tickCount,
      clock: clockOf(sim.tickCount),
      result: o.result,
      observedFromTick: Math.max(0, this.first),
      mode: this.tap === null ? 'annihilation' : 'points',
      ...(this.tap === null ? {} : { target: this.tap.rules.target }),
      seats: [seat(0), seat(1)],
      timeline: this.timeline.map((p) => ({ ...p })),
    };
  }
}

function clockOf(tick: number): string {
  const s = Math.floor(tick / TICKS_PER_SECOND);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** A result in words, BY SEAT: `seat 1 won (annihilation)`, `draw (time)`, or null. */
export function resultText(r: MatchResult | null, sides: readonly [0 | 1, 0 | 1]): string | null {
  if (r === null) return null;
  if (r.kind === 'draw') return `draw (${r.by})`;
  return `seat ${sides[0] === r.side ? 0 : 1} won (${r.by})`;
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/** The rubric as text: what each criterion asks, and what 1, 5 and 10 mean. */
export function rubricText(): string {
  return [
    `Score each player ${SCORE_MIN}-${SCORE_MAX} (whole numbers) on five criteria, and give an overall score. ${SCORE_MIN} is disastrous, 5 is ordinary, ${SCORE_MAX} is exemplary. Score how the player PLAYED, not whether it won: a loser can play well and a winner badly, and the opponent's strength matters.`,
    '',
    ...CRITERIA.map((c, i) => `${i + 1}. \`${c.id}\` (${c.label}): ${c.hint}`),
    '',
    `Every score has a \`reason\`: ONE line (at most ${MAX_REASON_CHARS} characters, no line break) that cites a number from the referee's stats. Lead with the evidence, not a verdict.`,
  ].join('\n');
}

/** The reply format: the JSON object, with every key the validator wants. */
export function replyFormat(): string {
  const crit = CRITERION_IDS.map((id) => `      "${id}": {"score": 6, "reason": "one line, with a number from the stats"}`).join(',\n');
  const player = `{\n    "criteria": {\n${crit}\n    },\n    "overall": {"score": 6, "reason": "one line"}\n  }`;
  return `{\n  "seat0": ${player},\n  "seat1": ${player}\n}`;
}

/** What the referee's numbers mean: stated once, for either kind of scorer. */
export function statsGlossary(): string {
  return [
    'The referee\'s stats come from the game itself and cover BOTH seats, with no fog.',
    '- `unitsLost`: units destroyed (a squad counts once, when its last man goes); `lostValue` is their cost. `destroyed` and `destroyedValue` are the enemy units this seat destroyed.',
    '- `woundedFell`: men who went down wounded. `woundedRescued`: taken off the field alive (carried off, evacuated, treated). `woundedDied`: bled out or killed. `woundedOnField`: still down at the end; `woundedStabilised` of them had a medic.',
    '- `menKilled`: men who died inside a squad short of its last man (only squads that can lose men wounded report them; a squad that lost 2 of 4 men and fights on shows 2 here and 0 in `unitsLost`).',
    '- `deaths` = `unitsLost` + `menKilled` + `woundedDied`.',
    '- `idlePct`: the share of unit-seconds a seat\'s units stood idle (no order, no target). `ordersSent` and `ordersByKind`: commands sent; `firstOrderTick`, `firstLossTick`: when. 20 ticks are one game second.',
    '- `timeline`: every 30 game seconds, units alive, force value, wounded on the field and orders sent in the interval, by seat.',
    '- `observedFromTick` above 0 means the idle, order and timeline figures cover only the rest of the match.',
    '- `mode` is how the match is won (`annihilation`, or `points`). In a points race `target` is the points to reach, each seat has `points` (`total` banked, `fromZones` what its held zones paid, `fromKills` what the enemy units it destroyed paid, `byZone` the zone split), and each timeline point has the `points` banked so far by seat. Judge tempo and adaptation against that goal (how early and how long it held ground and banked points), not against the kill count.',
  ].join('\n');
}

/**
 * The judge's prompt (`pnpm arena --judge`): a third model that sees only the
 * referee's numbers. `players` names the two seats; `outcome` is the arena's
 * verdict in words (a cap is decided by the arena, not the room).
 */
export function judgePrompt(stats: RefereeStats, players: readonly [string, string], outcome: string): string {
  return [
    '# Roaring Lions: score a finished match',
    '',
    'You are the judge of a 1v1 real-time tactics match between two players. You did not play it. Below are the referee\'s end-of-match statistics for both seats. Score both players.',
    '',
    `- seat 0: ${players[0]}`,
    `- seat 1: ${players[1]}`,
    `- Outcome: ${outcome}`,
    '',
    '## The rubric',
    '',
    rubricText(),
    '',
    '## What the stats mean',
    '',
    statsGlossary(),
    '',
    '## The referee\'s stats',
    '',
    '```json',
    JSON.stringify(stats, null, 2),
    '```',
    '',
    '## Your reply',
    '',
    'Reply with ONE JSON object and nothing else (no prose before or after; a single ```json fence is accepted). The keys are exactly `seat0` and `seat1`; each has `criteria` (all five ids) and `overall`:',
    '',
    '```json',
    replyFormat(),
    '```',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The score file (`pnpm bot`): the harness writes it, bot.ts reads it
// ---------------------------------------------------------------------------

/** What the harness leaves for `pnpm bot` (`--score-file`). `scores` is null until a valid submission. */
export interface ScoreFile {
  version: 1;
  /** The seat the harness plays. */
  seat: Seat;
  referee: RefereeStats;
  scores: ScoreSet | null;
  /** The tick the accepted scores were submitted at. */
  submittedTick: number | null;
}

/** Writes the file whole and atomically (a reader never sees half of it), 0600. */
export function writeScoreFile(path: string, f: ScoreFile): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(f, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * The referee's numbers, left at the result for a bot that never scores. A file that is already there is NEVER
 * replaced: a harness respawned into an ended room replays the end, and must not wipe the scores the model
 * already submitted. Returns whether it wrote.
 */
export function leaveStatsIfAbsent(path: string, seat: Seat, referee: RefereeStats): boolean {
  if (existsSync(path)) return false;
  writeScoreFile(path, { version: 1, seat, referee, scores: null, submittedTick: null });
  return true;
}

/** The largest score file bot.ts reads. */
export const SCORE_FILE_MAX_BYTES = 256 * 1024;

const SEAT_NUMBERS = ['unitsLost', 'menKilled', 'lostValue', 'destroyed', 'destroyedValue', 'remainingUnits', 'remainingValue', 'woundedFell', 'woundedOnField', 'woundedStabilised', 'woundedRescued', 'woundedDied', 'deaths', 'idleUnitSeconds', 'unitSeconds', 'ordersSent'] as const;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(isNum);

/** `v` as referee stats, or null if any field a report prints is missing or the wrong type: a file is read, never trusted. */
export function checkReferee(v: unknown): RefereeStats | null {
  if (!isRecord(v) || v.version !== 1 || typeof v.map !== 'string' || !isNum(v.tick) || typeof v.clock !== 'string' || !isNum(v.observedFromTick)) return null;
  if (v.result !== null && typeof v.result !== 'string') return null;
  if (!Array.isArray(v.seats) || v.seats.length !== 2 || !Array.isArray(v.timeline)) return null;
  for (let n = 0; n < 2; n++) {
    const s: unknown = v.seats[n];
    if (!isRecord(s) || s.seat !== n || (s.side !== 0 && s.side !== 1) || (s.faction !== 'kdf' && s.faction !== 'sarim')) return null;
    if (!SEAT_NUMBERS.every((k) => isNum(s[k]))) return null;
    for (const k of ['idlePct', 'firstOrderTick', 'firstLossTick']) if (s[k] !== null && !isNum(s[k])) return null;
    if (!isRecord(s.ordersByKind) || !Object.values(s.ordersByKind).every(isNum)) return null;
    if (s.points !== undefined && (!isRecord(s.points) || !isNum(s.points.total) || !isNum(s.points.fromZones) || !isNum(s.points.fromKills) || !isRecord(s.points.byZone) || !Object.values(s.points.byZone).every(isNum))) return null;
  }
  if (v.mode !== undefined && v.mode !== 'annihilation' && v.mode !== 'points' && v.mode !== 'camp') return null;
  if (v.target !== undefined && !isNum(v.target)) return null;
  for (const p of v.timeline as unknown[]) {
    if (!isRecord(p) || !isNum(p.tick) || !isPair(p.units) || !isPair(p.force) || !isPair(p.woundedOnField) || !isPair(p.orders) || (p.points !== undefined && !isPair(p.points))) return null;
  }
  return v as unknown as RefereeStats;
}

/** What a score file said, for a report: scored, or why not. A score is never invented. */
export type ScoreOutcome =
  | { status: 'scored'; scores: ScoreSet; referee: RefereeStats | null; submittedTick: number | null }
  | { status: 'invalid'; problems: string[]; referee: RefereeStats | null }
  | { status: 'missing'; reason: string; referee: RefereeStats | null };

/** Reads the harness's score file (see `writeScoreFile`) and validates what it holds. Never throws. */
export function readScoreFile(path: string): ScoreOutcome {
  if (!existsSync(path)) return { status: 'missing', reason: 'no scores were submitted and the match left no stats (it may not have ended, or the model never reached the scoring tools)', referee: null };
  let text: string;
  try {
    if (statSync(path).size > SCORE_FILE_MAX_BYTES) return { status: 'invalid', problems: [`the score file is larger than ${SCORE_FILE_MAX_BYTES} bytes`], referee: null };
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { status: 'invalid', problems: [`the score file could not be read (${e instanceof Error ? e.message : String(e)})`], referee: null };
  }
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { status: 'invalid', problems: ['the score file is not valid JSON'], referee: null }; }
  if (!isRecord(v)) return { status: 'invalid', problems: ['the score file is not an object'], referee: null };
  const referee = checkReferee(v.referee);
  if (v.scores === null || v.scores === undefined) return { status: 'missing', reason: 'the model did not submit scores (the match stats are below)', referee };
  const ok = validateScores(v.scores);
  if (!ok.ok) return { status: 'invalid', problems: ok.problems, referee };
  return { status: 'scored', scores: ok.scores, referee, submittedTick: isNum(v.submittedTick) ? v.submittedTick : null };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const row = (cells: readonly (string | number)[]): string => `| ${cells.map((c) => cell(String(c))).join(' | ')} |`;
const sep = (n: number): string => row(Array.from({ length: n }, () => '---'));
const dash = (v: number | null): string | number => (v === null ? '—' : v);

/** The referee's stats as one table (a row per seat) with the names given. */
export function refereeMarkdown(stats: RefereeStats, names: readonly [string, string]): string[] {
  const out: string[] = [];
  out.push(`Referee's stats at tick ${stats.tick} (${stats.clock})${stats.result === null ? '' : `, ${stats.result}`}. Deaths = units lost + men killed in squads + wounded who died.`);
  out.push('');
  out.push(row(['seat', 'player', 'deaths', 'men killed', 'units lost (value)', 'destroyed (value)', 'left (value)', 'wounded fell', 'rescued', 'died', 'on field', 'idle %', 'orders', 'first order', 'first loss']));
  out.push(sep(15));
  for (const s of stats.seats) {
    out.push(row([s.seat, names[s.seat], s.deaths, s.menKilled, `${s.unitsLost} (${s.lostValue})`, `${s.destroyed} (${s.destroyedValue})`, `${s.remainingUnits} (${s.remainingValue})`, s.woundedFell, s.woundedRescued, s.woundedDied, s.woundedOnField, dash(s.idlePct), s.ordersSent, dash(s.firstOrderTick), dash(s.firstLossTick)]));
  }
  if (stats.seats.some((s) => s.points !== undefined)) {
    out.push('');
    out.push(`Points race, first to ${stats.target ?? '?'}. Points by source: held zones and enemy units destroyed (zone split in brackets).`);
    out.push('');
    out.push(row(['seat', 'player', 'points', 'from zones', 'from kills', 'by zone']));
    out.push(sep(6));
    for (const s of stats.seats) {
      if (s.points === undefined) continue;
      const zones = Object.entries(s.points.byZone).map(([z, v]) => `${z} ${v}`).join(', ');
      out.push(row([s.seat, names[s.seat], s.points.total, s.points.fromZones, s.points.fromKills, zones === '' ? '—' : zones]));
    }
  }
  return out;
}

/** Both players' scores: a table of the scores, then each reason on its own line. */
export function scoresMarkdown(scores: ScoreSet, names: readonly [string, string]): string[] {
  const out: string[] = [];
  out.push(row(['seat', 'player', ...CRITERIA.map((c) => c.label), 'Overall']));
  out.push(sep(2 + CRITERIA.length + 1));
  for (const seat of [0, 1] as const) {
    const p = scores[SEAT_KEYS[seat]];
    out.push(row([seat, names[seat], ...CRITERION_IDS.map((id) => p.criteria[id].score), p.overall.score]));
  }
  for (const seat of [0, 1] as const) {
    const p = scores[SEAT_KEYS[seat]];
    out.push('');
    out.push(`**Seat ${seat}, ${names[seat]}**`);
    out.push('');
    for (const c of CRITERIA) out.push(`- ${c.label}: ${p.criteria[c.id].score}. ${p.criteria[c.id].reason}`);
    out.push(`- Overall: ${p.overall.score}. ${p.overall.reason}`);
  }
  return out;
}
