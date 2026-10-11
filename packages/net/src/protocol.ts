/**
 * Every message between a client and a `MatchRoom`, and the parser that is
 * the ONLY way bytes become one. Spec §3.2.3. The room never learns a
 * position: the only battle facts here are `Command`s and hashes.
 */
import type { Command } from '@lions/sim';
import { validateConfig, type MatchConfig, type Seat } from './config';
import type { Frame, Stamped } from './frames';

export const MAX_MESSAGE_BYTES = 4096;
export const MAX_CMDS_PER_SEAT_PER_FRAME = 32;

/** `Command['kind']` as a value, so a wire command can be checked at runtime. */
export const COMMAND_KINDS = [
  'move', 'attackMove', 'halt', 'garrison', 'load', 'unload', 'reveal', 'callStrike', 'smoke', 'demolish', 'chargeTunnel',
] as const satisfies readonly Command['kind'][];

export interface SeatState { seat: Seat; callsign: string; connected: boolean; ready: boolean }

export type ClientMsg =
  | { t: 'hello'; ticket: string; build: string }
  | { t: 'ready' }
  | { t: 'cmd'; seq: number; cmd: Command }
  | { t: 'ack'; tick: number }
  | { t: 'hash'; tick: number; h: number }
  | { t: 'bye' };

export const ERROR_CODES = ['bad_message', 'bad_ticket', 'build_mismatch', 'full', 'not_running', 'origin'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type StallReason = 'behind' | 'gone';

export type ServerMsg =
  | { t: 'lobby'; config: MatchConfig | null; seats: SeatState[]; you: Seat }
  | { t: 'start'; config: MatchConfig }
  | { t: 'frame'; tick: number; cmds: Stamped[] }
  | { t: 'stall'; reason: StallReason; seat: Seat }
  | { t: 'resume' }
  | { t: 'hashOk'; tick: number }
  | { t: 'desync'; tick: number; hashes: [number, number] }
  | { t: 'log'; config: MatchConfig; frames: Frame[] }
  | { t: 'ended'; reason: 'left' | 'void' | 'expired' }
  | { t: 'error'; code: ErrorCode };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isSeat = (v: unknown): v is Seat => v === 0 || v === 1;
const isIntArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(isInt);

/** The fields `move` and `attackMove` share. `sweep` is attack-move's alone. */
const isMoveShape = (c: Record<string, unknown>): boolean =>
  isIntArray(c.ids) && isInt(c.x) && isInt(c.y) &&
  (c.append === undefined || typeof c.append === 'boolean') && (c.exact === undefined || typeof c.exact === 'boolean');

/** Shape check only: every field the union declares, with the type it
 *  declares. Ownership and existence are the client's job (`ownership.ts`).
 *  The command is returned as parsed, never rebuilt, so a field the union
 *  gains later (an optional flag) passes through without an edit here.
 *  The switch's `never` default makes `tsc` fail when the sim's `Command`
 *  union gains a kind this function does not handle. */
export function isCommand(v: unknown): v is Command {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  if (!isStr(c.kind) || !(COMMAND_KINDS as readonly string[]).includes(c.kind)) return false;
  const kind = c.kind as Command['kind'];
  switch (kind) {
    case 'move':
      return isMoveShape(c);
    case 'attackMove':
      return isMoveShape(c) && (c.sweep === undefined || typeof c.sweep === 'boolean');
    case 'halt':
    case 'unload':
      return isIntArray(c.ids);
    case 'garrison':
    case 'demolish':
      return isIntArray(c.ids) && isInt(c.structure);
    case 'load':
      return isIntArray(c.ids) && isInt(c.carrier);
    case 'chargeTunnel':
      return isIntArray(c.ids) && isInt(c.tunnel);
    case 'reveal':
      return isInt(c.side) && isInt(c.x) && isInt(c.y);
    case 'callStrike':
      return isInt(c.caller) && isInt(c.x) && isInt(c.y);
    case 'smoke':
      return isIntArray(c.ids) && isInt(c.x) && isInt(c.y);
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
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
    case 'cmd': return isInt(m.seq) && isCommand(m.cmd) ? { t: 'cmd', seq: m.seq, cmd: m.cmd } : null;
    case 'ack': return isInt(m.tick) ? { t: 'ack', tick: m.tick } : null;
    case 'hash': return isInt(m.tick) && isInt(m.h) ? { t: 'hash', tick: m.tick, h: m.h } : null;
    case 'bye': return { t: 'bye' };
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

/** `log` and `lobby` are the two messages that can exceed the client cap
 *  (a 20-minute log is ~24,000 frames), so the size cap applies to CLIENT
 *  messages only; a server message is trusted to come from the room. */
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
      return Array.isArray(m.seats) && m.seats.every(isSeatState) && isSeat(m.you) ? { t: 'lobby', config: c, seats: m.seats, you: m.you } : null;
    }
    case 'start': { const c = validateConfig(m.config); return c ? { t: 'start', config: c } : null; }
    case 'frame': return isInt(m.tick) && Array.isArray(m.cmds) && m.cmds.every(isStamped) ? { t: 'frame', tick: m.tick, cmds: m.cmds } : null;
    case 'stall': return (m.reason === 'behind' || m.reason === 'gone') && isSeat(m.seat) ? { t: 'stall', reason: m.reason, seat: m.seat } : null;
    case 'resume': return { t: 'resume' };
    case 'hashOk': return isInt(m.tick) ? { t: 'hashOk', tick: m.tick } : null;
    case 'desync': return isInt(m.tick) && Array.isArray(m.hashes) && m.hashes.length === 2 && m.hashes.every(isInt)
      ? { t: 'desync', tick: m.tick, hashes: [m.hashes[0], m.hashes[1]] } : null;
    case 'log': { const c = validateConfig(m.config); return c && Array.isArray(m.frames) && m.frames.every(isFrame) ? { t: 'log', config: c, frames: m.frames } : null; }
    case 'ended': return m.reason === 'left' || m.reason === 'void' || m.reason === 'expired' ? { t: 'ended', reason: m.reason } : null;
    case 'error': return (ERROR_CODES as readonly unknown[]).includes(m.code) ? { t: 'error', code: m.code as ErrorCode } : null;
    default: return null;
  }
}
