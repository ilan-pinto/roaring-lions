/**
 * Every message between a client and a `MatchRoom`, and the parser that is
 * the ONLY way bytes become one. Spec §3.2.3. The room never learns a
 * position: the only battle facts here are `Command`s and hashes.
 */
import { AMBUSH_RADIUS_MAX, FIRE_SUPPORT, FIRE_SUPPORT_KINDS, MAX_LINE_QUEUE, MAX_PRODUCTION_LINES, type Command } from '@lions/sim';
import { isFactionPair, validateConfig, type Faction, type MatchConfig, type Seat } from './config';
import type { Frame, Stamped } from './frames';
import { ADVISOR_SCOPES, cleanAdvisorMsg, type AdvisorMsg, type AdvisorScope } from './advisor';

export const MAX_MESSAGE_BYTES = 4096;
/** The most characters of frames one `log` message carries (#559 H-1): a long
 *  match's log goes in parts, never as one message megabytes long. */
export const LOG_PART_CHARS = 256 * 1024;
/** How many of one seat's commands a frame carries (#559 F2: was 32); the
 *  room holds the rest for the frames after (`room-core.ts`). */
export const MAX_CMDS_PER_SEAT_PER_FRAME = 4;
/** A chat line, in UTF-16 code units (what `String.length` counts). */
export const CHAT_MAX_CHARS = 280;
/** How long one pause lasts before the room ends it by itself. */
export const PAUSE_MS = 90_000;
/** Pauses each seat may call in one match. */
export const PAUSES_PER_SEAT = 3;
/** How long after the result a room closes itself (L-1, R-B26): both seats
 *  have reported the same `over` tick, or one has and the other is gone. */
export const OVER_CLOSE_MS = 120_000;
/** How long a versus seat may stay disconnected before it forfeits (the lead's
 *  ruling, 2026-10-13: the player who drops loses). Wall time, kept by the
 *  room; a reconnect inside it cancels it completely, and a pause does not
 *  stop it. */
export const FORFEIT_MS = 60_000;

/** `Command['kind']` as a value, so a wire command can be checked at runtime. */
export const COMMAND_KINDS = [
  'move', 'attackMove', 'halt', 'setStance', 'garrison', 'load', 'unload', 'reveal', 'callStrike', 'smoke', 'demolish', 'chargeTunnel', 'attack',
  'build', 'support', 'cancelBuild', 'setRally', 'clearRally',
  'construct', 'cancelConstruct', 'raiseWorks', 'cancelWorks',
] as const satisfies readonly Command['kind'][];

/** The other half of the pin (N2 prerequisite P1): `satisfies` above catches a
 *  kind that is not a `Command`, this catches a `Command` kind missing from the
 *  list. Add a kind to the sim's `Command` and forget the whitelist, and
 *  `cleanCommand` would silently drop it off the wire; now it is a compile
 *  error that names the kind. */
type MissingCommandKind = Exclude<Command['kind'], (typeof COMMAND_KINDS)[number]>;
const COMMAND_KINDS_COMPLETE: [MissingCommandKind] extends [never] ? true : { missingFromCOMMAND_KINDS: MissingCommandKind } = true;
void COMMAND_KINDS_COMPLETE;

export interface SeatState { seat: Seat; callsign: string; connected: boolean; ready: boolean }

export type ClientMsg =
  | { t: 'hello'; ticket: string; build: string }
  | { t: 'ready' }
  | { t: 'cmd'; seq: number; cmd: Command }
  | { t: 'ack'; tick: number }
  | { t: 'hash'; tick: number; h: number }
  | { t: 'bye' }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'surrender' }
  | { t: 'chat'; text: string }
  /** This seat's sim decided the match on `tick` (L-1): sent once, so the room can close itself. */
  | { t: 'over'; tick: number }
  /** An advisor's (or its human's) message for the OTHER half of one seat's pair (N4a): the room relays it, stores nothing. */
  | { t: 'advisor'; a: AdvisorMsg }
  /** This seat has finished `round` of a paced room (N4a): a bot seat's turn is over. */
  | { t: 'done'; round: number };

export const ERROR_CODES = ['bad_message', 'bad_ticket', 'build_mismatch', 'full', 'not_running', 'origin'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** A room's kit rule, as the lobby names it (`SeatConfig['kit']`). */
export type LobbyKit = 'matched' | 'brigade';

/** `round`: a paced room is waiting for a bot seat's `done` (N4a). */
export type StallReason = 'behind' | 'gone' | 'round';
/** Why a room ended. `over`: it closed itself `OVER_CLOSE_MS` after the result both seats reached (L-1).
 *  `forfeit`: a versus seat stayed disconnected for `FORFEIT_MS`; `seat` names it, and it lost. */
export const ENDED_REASONS = ['left', 'void', 'expired', 'surrender', 'over', 'forfeit'] as const;
export type EndedReason = (typeof ENDED_REASONS)[number];

export type ServerMsg =
  /** `factions`, by seat: what the host picked (KDF vs Sarim, or the mirror).
   *  Absent from a room made before it existed, which is the mirror.
   *  `kit`: the room's kit rule (per-seat kit); the room names it only when it
   *  is `brigade`, so absent is `matched`, which every older room was. */
  | { t: 'lobby'; config: MatchConfig | null; seats: SeatState[]; you: Seat; map: string; factions?: [Faction, Faction]; kit?: LobbyKit }
  | { t: 'start'; config: MatchConfig }
  | { t: 'frame'; tick: number; cmds: Stamped[] }
  | { t: 'stall'; reason: StallReason; seat: Seat }
  | { t: 'resume' }
  | { t: 'hashOk'; tick: number }
  | { t: 'desync'; tick: number; hashes: [number, number] }
  /** A rejoin's log, in `parts` messages of at most `LOG_PART_CHARS` (#559
   *  H-1): `part` counts from 0. Each part carries the config and a run of
   *  frames that continues the last; a client is live again after the last
   *  part. Absent `part`/`parts` is a whole log in one message (pre-#559). */
  | { t: 'log'; config: MatchConfig; frames: Frame[]; part?: number; parts?: number }
  | { t: 'paused'; seat: Seat; remainingMs: number; pausesLeft: [number, number] }
  /** The room dropped this seat's `cmd` because a pause is in force (L-2). Sent
   *  per refused cmd, to that seat only; it carries nothing the seat does not
   *  know, and the client says why once per pause. */
  | { t: 'cmdRefused' }
  | { t: 'chat'; seat: Seat; text: string }
  /** A versus seat's socket went mid-match: it forfeits in `remainingMs`
   *  unless it comes back (`FORFEIT_MS`). Sent to both seats when it goes, and
   *  to a seat that rejoins while the other is still gone. */
  | { t: 'dropped'; seat: Seat; remainingMs: number }
  /** The dropped seat came back: its forfeit clock is cancelled. */
  | { t: 'back'; seat: Seat }
  /** `seat`: who lost by the ending -- surrendered, left (`bye`) or forfeited. */
  | { t: 'ended'; reason: EndedReason; seat?: Seat }
  /** What a seat's advisor (or its human) said, to that seat's pair only; never to the other seat. */
  | { t: 'advisor'; from: 'human' | 'advisor'; a: AdvisorMsg }
  /** Which advisor scope each seat has seated, or null: the badge both seats see (decision D1). */
  | { t: 'advisors'; present: [AdvisorScope | null, AdvisorScope | null] }
  | { t: 'error'; code: ErrorCode };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isSeat = (v: unknown): v is Seat => v === 0 || v === 1;
/** The most distinct unit ids one command may name (#559 F2). A seat fields a
 *  few dozen units in versus; this bounds what one message can make both
 *  sims chew on, and what the room stores, far above any real selection. */
export const MAX_CMD_IDS = 256;

/** `ids`, deduplicated in first-seen order, or null if it is not an array of
 *  integers or names more than `MAX_CMD_IDS` distinct ids. A repeated id
 *  orders nothing a single one does not, so dropping repeats changes no
 *  honest order. */
function cleanIds(v: unknown): number[] | null {
  if (!Array.isArray(v) || !v.every(isInt)) return null;
  const out = [...new Set(v as number[])];
  return out.length <= MAX_CMD_IDS ? out : null;
}
const optBool = (v: unknown): boolean => v === undefined || typeof v === 'boolean';
/** A unit id on the wire (N2 `build`). The same pattern as `@lions/data`'s
 *  `UNIT_ID_PATTERN`, which `@lions/net` cannot import; `tools/src/unit-id-pattern.test.ts`
 *  pins the two together against every shipped unit id. */
const UNIT_ID = /^[a-z0-9_]{1,32}$/;
/** A production line index on the wire: 0 <= line < MAX_PRODUCTION_LINES (F4). */
const isLine = (v: unknown): v is number => isInt(v) && v >= 0 && v < MAX_PRODUCTION_LINES;
const isSupportKind = (v: unknown): v is (typeof FIRE_SUPPORT_KINDS)[number] =>
  isStr(v) && (FIRE_SUPPORT_KINDS as readonly string[]).includes(v);

/**
 * A wire command REBUILT from the fields its kind declares, each with the
 * type it declares, or null (#559 H-1). Nothing a client adds rides through:
 * before this the parsed object was returned as it came, so an unknown field
 * (a 4 KB `pad`) was stamped into every frame, persisted in the room's log and
 * sent to both seats. A field the union gains later must be added here, or
 * the room drops it -- loudly, since the order then fails to do what it says.
 * Ownership and existence are the client's job (`ownership.ts`). The switch's
 * `never` default makes `tsc` fail when the sim's `Command` union gains a kind
 * this function does not handle.
 */
export function cleanCommand(v: unknown): Command | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  if (!isStr(c.kind) || !(COMMAND_KINDS as readonly string[]).includes(c.kind)) return null;
  const kind = c.kind as Command['kind'];
  const ids = c.ids === undefined ? null : cleanIds(c.ids);
  switch (kind) {
    case 'move':
    case 'attackMove': {
      if (ids === null || !isInt(c.x) || !isInt(c.y) || !optBool(c.append) || !optBool(c.exact)) return null;
      if (kind === 'attackMove' && !optBool(c.sweep)) return null;
      const out: Record<string, unknown> = { kind, ids, x: c.x, y: c.y };
      if (c.append !== undefined) out.append = c.append;
      if (c.exact !== undefined) out.exact = c.exact;
      if (kind === 'attackMove' && c.sweep !== undefined) out.sweep = c.sweep;
      return out as Command;
    }
    case 'halt':
    case 'unload':
      return ids === null ? null : { kind, ids };
    case 'garrison':
    case 'demolish':
      return ids === null || !isInt(c.structure) ? null : { kind, ids, structure: c.structure };
    case 'load':
      return ids === null || !isInt(c.carrier) ? null : { kind, ids, carrier: c.carrier };
    case 'chargeTunnel':
      return ids === null || !isInt(c.tunnel) ? null : { kind, ids, tunnel: c.tunnel };
    case 'attack':
      return ids === null || !isInt(c.target) ? null : { kind, ids, target: c.target };
    case 'reveal':
      return isInt(c.side) && isInt(c.x) && isInt(c.y) ? { kind, side: c.side, x: c.x, y: c.y } : null;
    case 'callStrike':
      if (!isInt(c.caller) || !isInt(c.x) || !isInt(c.y)) return null;
      // F-R5: `profile` is optional (absent = the air strike) but, when present,
      // must index the FIRE_SUPPORT table -- anything else is refused, never
      // silently turned into an air strike on one machine and not another.
      if (c.profile === undefined) return { kind, caller: c.caller, x: c.x, y: c.y };
      return isInt(c.profile) && c.profile >= 0 && c.profile < FIRE_SUPPORT.length
        ? { kind, caller: c.caller, x: c.x, y: c.y, profile: c.profile }
        : null;
    case 'smoke':
      return ids === null || !isInt(c.x) || !isInt(c.y) ? null : { kind, ids, x: c.x, y: c.y };
    case 'setStance': {
      if (ids === null || (c.stance !== 'hold' && c.stance !== 'ambush')) return null;
      if (c.stance === 'hold') return c.radius === undefined ? { kind, ids, stance: 'hold' } : null;
      if (c.radius === undefined) return { kind, ids, stance: 'ambush' };
      return isInt(c.radius) && c.radius > 0 && c.radius <= AMBUSH_RADIUS_MAX ? { kind, ids, stance: 'ambush', radius: c.radius } : null;
    }
    case 'build':
      if (!isInt(c.side) || !isStr(c.unit) || !UNIT_ID.test(c.unit)) return null;
      if (c.line === undefined) return { kind, side: c.side, unit: c.unit };
      return isLine(c.line) ? { kind, side: c.side, unit: c.unit, line: c.line } : null;
    case 'cancelBuild':
      return isInt(c.side) && isLine(c.line) && isInt(c.index) && c.index >= -1 && c.index < MAX_LINE_QUEUE
        ? { kind, side: c.side, line: c.line, index: c.index }
        : null;
    case 'setRally':
      return isInt(c.side) && isLine(c.line) && isInt(c.x) && isInt(c.y)
        ? { kind, side: c.side, line: c.line, x: c.x, y: c.y }
        : null;
    case 'clearRally':
      return isInt(c.side) && isLine(c.line) ? { kind, side: c.side, line: c.line } : null;
    case 'support':
      return isInt(c.side) && isSupportKind(c.support) && isInt(c.x) && isInt(c.y)
        ? { kind, side: c.side, support: c.support, x: c.x, y: c.y }
        : null;
    case 'construct':
    case 'cancelConstruct':
      // The sim's own field-works orders (GH-277) never travel: a client sends
      // `raiseWorks`/`cancelWorks`, which the mission runtime prices and turns
      // into these. A raw `construct` on the wire would raise works unpaid, so
      // it is refused here and vanishes the same way on both machines.
      return null;
    case 'raiseWorks':
      // The player's field-works request, shaped like `build`; a versus room
      // drops it in `validateCommand` (no runtime prices it there).
      return ids === null || !isInt(c.side) || !isStr(c.works) || !UNIT_ID.test(c.works) || !isInt(c.x) || !isInt(c.y)
        ? null
        : { kind, side: c.side, works: c.works, x: c.x, y: c.y, ids };
    case 'cancelWorks':
      return isInt(c.side) && isInt(c.site) ? { kind, side: c.side, site: c.site } : null;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** Shape check only, by the same rules as `cleanCommand`. */
export function isCommand(v: unknown): v is Command {
  return cleanCommand(v) !== null;
}

export function isStamped(v: unknown): v is Stamped {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return isSeat(s.seat) && isInt(s.seq) && isCommand(s.cmd);
}

function parseJson(raw: string): Record<string, unknown> | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseClientMsg(raw: string): ClientMsg | null {
  const m = parseJson(raw);
  if (m === null) return null;
  switch (m.t) {
    case 'hello': return isStr(m.ticket) && isStr(m.build) ? { t: 'hello', ticket: m.ticket, build: m.build } : null;
    case 'ready': return { t: 'ready' };
    case 'cmd': {
      const cmd = isInt(m.seq) ? cleanCommand(m.cmd) : null;
      return cmd !== null && isInt(m.seq) ? { t: 'cmd', seq: m.seq, cmd } : null;
    }
    case 'ack': return isInt(m.tick) ? { t: 'ack', tick: m.tick } : null;
    case 'hash': return isInt(m.tick) && isInt(m.h) ? { t: 'hash', tick: m.tick, h: m.h } : null;
    case 'bye': return { t: 'bye' };
    case 'pause': return { t: 'pause' };
    case 'resume': return { t: 'resume' };
    case 'surrender': return { t: 'surrender' };
    case 'chat': return isStr(m.text) && m.text.length <= CHAT_MAX_CHARS ? { t: 'chat', text: m.text } : null;
    case 'over': return isInt(m.tick) && m.tick >= 0 ? { t: 'over', tick: m.tick } : null;
    case 'advisor': { const a = cleanAdvisorMsg(m.a); return a === null ? null : { t: 'advisor', a }; }
    case 'done': return isInt(m.round) && m.round >= 0 ? { t: 'done', round: m.round } : null;
    default: return null;
  }
}

function isFrame(v: unknown): v is Frame {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return isInt(f.tick) && Array.isArray(f.cmds) && f.cmds.every(isStamped);
}

function isSeatState(v: unknown): v is SeatState {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return isSeat(s.seat) && isStr(s.callsign) && typeof s.connected === 'boolean' && typeof s.ready === 'boolean';
}

/** `log` and `lobby` are the two messages that can exceed the client cap (a
 *  20-minute log is ~24,000 frames, sent in parts of `LOG_PART_CHARS`), so
 *  the size cap applies to CLIENT messages only; a server message is trusted
 *  to come from the room. */
/** Who lost by a room's own ending, or null when it names nobody: a
 *  surrender, a leave (`bye`) and a forfeit name the seat that gave the match
 *  up. A `left` from a room older than this names nobody (`seat` absent): the
 *  seat that hears it stayed. One rule for every client, so both seats of a
 *  match read the same loser from the same message. */
export function endingLoser(reason: string, seat: Seat | undefined): Seat | null {
  if (seat === undefined) return null;
  return reason === 'surrender' || reason === 'left' || reason === 'forfeit' ? seat : null;
}

export function parseServerMsg(raw: string): ServerMsg | null {
  let m: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    m = v as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (m.t) {
    case 'lobby': {
      // A lobby has no config until the host has set one; a config that is present must be valid.
      const c = m.config === null || m.config === undefined ? null : validateConfig(m.config);
      if (c === null && m.config !== null && m.config !== undefined) return null;
      if (m.factions !== undefined && !isFactionPair(m.factions)) return null;
      if (m.kit !== undefined && m.kit !== 'matched' && m.kit !== 'brigade') return null;
      return Array.isArray(m.seats) && m.seats.every(isSeatState) && isSeat(m.you) && isStr(m.map)
        ? { t: 'lobby', config: c, seats: m.seats, you: m.you, map: m.map, ...(m.factions !== undefined ? { factions: m.factions } : {}), ...(m.kit !== undefined ? { kit: m.kit } : {}) } : null;
    }
    case 'start': { const c = validateConfig(m.config); return c ? { t: 'start', config: c } : null; }
    case 'frame': return isInt(m.tick) && Array.isArray(m.cmds) && m.cmds.every(isStamped) ? { t: 'frame', tick: m.tick, cmds: m.cmds } : null;
    case 'stall': return (m.reason === 'behind' || m.reason === 'gone' || m.reason === 'round') && isSeat(m.seat) ? { t: 'stall', reason: m.reason, seat: m.seat } : null;
    case 'resume': return { t: 'resume' };
    case 'hashOk': return isInt(m.tick) ? { t: 'hashOk', tick: m.tick } : null;
    case 'desync': return isInt(m.tick) && Array.isArray(m.hashes) && m.hashes.length === 2 && m.hashes.every(isInt)
      ? { t: 'desync', tick: m.tick, hashes: [m.hashes[0], m.hashes[1]] } : null;
    case 'log': {
      const c = validateConfig(m.config);
      if (!c || !Array.isArray(m.frames) || !m.frames.every(isFrame)) return null;
      if (m.part === undefined && m.parts === undefined) return { t: 'log', config: c, frames: m.frames };
      return isInt(m.part) && isInt(m.parts) && m.part >= 0 && m.part < m.parts
        ? { t: 'log', config: c, frames: m.frames, part: m.part, parts: m.parts } : null;
    }
    case 'paused': return isSeat(m.seat) && isInt(m.remainingMs) && Array.isArray(m.pausesLeft) && m.pausesLeft.length === 2 && m.pausesLeft.every(isInt)
      ? { t: 'paused', seat: m.seat, remainingMs: m.remainingMs, pausesLeft: [m.pausesLeft[0], m.pausesLeft[1]] } : null;
    case 'cmdRefused': return { t: 'cmdRefused' };
    case 'chat': return isSeat(m.seat) && isStr(m.text) ? { t: 'chat', seat: m.seat, text: m.text } : null;
    case 'dropped': return isSeat(m.seat) && isInt(m.remainingMs) && m.remainingMs >= 0 ? { t: 'dropped', seat: m.seat, remainingMs: m.remainingMs } : null;
    case 'back': return isSeat(m.seat) ? { t: 'back', seat: m.seat } : null;
    case 'ended': {
      if (!(ENDED_REASONS as readonly unknown[]).includes(m.reason)) return null;
      const reason = m.reason as EndedReason;
      if (m.seat === undefined) return { t: 'ended', reason };
      return isSeat(m.seat) ? { t: 'ended', reason, seat: m.seat } : null;
    }
    case 'advisor': {
      const a = cleanAdvisorMsg(m.a);
      return a !== null && (m.from === 'human' || m.from === 'advisor') ? { t: 'advisor', from: m.from, a } : null;
    }
    case 'advisors': {
      const p = m.present;
      const ok = (v: unknown): v is AdvisorScope | null => v === null || (ADVISOR_SCOPES as readonly unknown[]).includes(v);
      return Array.isArray(p) && p.length === 2 && ok(p[0]) && ok(p[1]) ? { t: 'advisors', present: [p[0], p[1]] } : null;
    }
    case 'error': return (ERROR_CODES as readonly unknown[]).includes(m.code) ? { t: 'error', code: m.code as ErrorCode } : null;
    default: return null;
  }
}
