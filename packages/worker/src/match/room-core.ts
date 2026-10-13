/**
 * The MatchRoom's rules with no I/O: every input is a function call, every
 * output an `Effect`. The Durable Object (`match-room.ts`) is a thin shell
 * over this so the rules test under node (spec §12). The frame LOG is not
 * held here: the DO keeps each `frame` effect (in batches, see
 * `match-room.ts`) and answers `log` from it; `seatJoin` asks for it through
 * `readLog`.
 */
import {
  canonicalOrder, LOG_PART_CHARS, MAX_CMDS_PER_SEAT_PER_FRAME, PAUSE_MS, PAUSES_PER_SEAT, CHAT_MAX_CHARS, OVER_CLOSE_MS,
  type ClientMsg, type EndedReason, type Frame, type MatchConfig, type Seat, type ServerMsg, type Stamped, type SeatState,
} from '@lions/net';

export type RoomStatus = 'lobby' | 'running' | 'stalled' | 'ended';
export interface RoomSeat {
  seat: Seat; player: string; callsign: string; connected: boolean; ready: boolean;
  /** The newest tick the seat has acknowledged; -1 before any. */
  lastAck: number;
  lastSeenMs: number;
  nextSeq: number;
}
export interface RoomState {
  code: string; matchId: string; createdMs: number;
  status: RoomStatus;
  config: MatchConfig | null;
  seats: [RoomSeat | null, RoomSeat | null];
  /** The tick the NEXT frame will carry. */
  tick: number;
  pending: Stamped[];
  hashes: Record<number, [number | null, number | null]>;
  /** The newest tick whose hashes both seats have reported; -1 before any. Older hashes are replays. */
  lastHashTick: number;
  stall: { reason: 'behind' | 'gone'; seat: Seat } | null;
  endedReason: EndedReason | null;
  /** A player pause in force: who asked, and when the room resumes by itself. While set, no frames flow. */
  pause: { seat: Seat; untilMs: number } | null;
  /** Pauses each seat has left; spent when taken, not when it ends. */
  pausesLeft: [number, number];
  /** When each seat last chatted, for the rate limit; -1 (JSON-safe) before any. */
  lastChatMs: [number, number];
  /** The seat that surrendered, once one has. */
  surrendered: Seat | null;
  /** The map id the lobby shows; '' until the room is given one (Task 3). */
  map: string;
  /** The tick each seat's sim decided the match on (`over`, L-1), -1 (JSON-safe) before it reports. First report only. */
  over: [number, number];
  /** When the room closes itself after the result (L-1, R-B26), once armed; null before. */
  closeAtMs: number | null;
  /** #559 F2: each seat's command budget, a token bucket (`CMD_BUDGET`), and when it was last topped up. */
  cmdTokens: [number, number];
  cmdTokensAtMs: [number, number];
  /** #559 H-1: characters of command JSON stamped into frames so far, against `MAX_LOG_CMD_CHARS`. */
  cmdChars: number;
  /** When the room ended, null while it lives: the room is wiped `PURGE_AFTER_MS` later (#559 H-1). */
  endedAtMs: number | null;
}
export type Effect =
  | { kind: 'send'; to: Seat | 'all'; msg: ServerMsg }
  | { kind: 'frame'; frame: Frame }
  /** A second hello REPLACED this seat: its other sockets go, as replaced. */
  | { kind: 'close'; seat: Seat }
  /** The room is over: this seat's sockets close normally (L-1), not as replaced. */
  | { kind: 'shut'; seat: Seat };

/** One source for the ack cadence: the client's (`WsTransport`). */
export { ACK_EVERY } from '@lions/net';
export const STALL_BEHIND_TICKS = 40;
export const STALL_SILENT_MS = 2000;
/** The least gap between two chat messages from one seat. */
export const CHAT_MIN_GAP_MS = 500;
export const ROOM_TTL_MS = 6 * 3600 * 1000;
/**
 * #559 F2: what one seat's orders may cost both sims. A frame carries at most
 * `MAX_CMDS_PER_SEAT_PER_FRAME` (4) of a seat's commands; more wait in
 * `pending` for the next frames, up to `MAX_PENDING_CMDS_PER_SEAT` (12), and
 * past that are dropped. Each accepted command spends one token of a bucket
 * that holds `CMD_BUDGET.burst` (20) and refills `CMD_BUDGET.perSecond` (20)
 * a second. A real player's heaviest burst is one right-click on a building
 * with a mixed selection -- demolish, garrison and attack-move, three
 * commands (`input/intents.ts`) -- plus a shift-queued order of the same
 * shape: six, which all run, four in the next frame and two 50 ms later.
 * Sustained, 20 a second is 1,200 orders a minute, several times a
 * professional's APM, where the old cap let a seat feed the sims 640.
 */
export const MAX_PENDING_CMDS_PER_SEAT = 12;
export const CMD_BUDGET = { burst: 20, perSecond: 20 } as const;
/**
 * #559 H-1: the most command JSON one room stores, both seats together. An
 * honest order is ~60 characters, so this is tens of thousands of orders --
 * hours of play -- while a seat stuffing every command with ids reaches it in
 * well under a minute. Past it the match is void, as a desync is: the room
 * will not store more, and a log the clients cannot all rejoin from is no
 * match. Empty frames are not counted; they are bounded by time (the TTL).
 */
export const MAX_LOG_CMD_CHARS = 2_000_000;
/** Hash ticks only one seat has reported, kept at most this many (forged ticks cannot grow the table). */
const MAX_OPEN_HASHES = 16;

export function createRoom(code: string, matchId: string, nowMs: number, map = ''): RoomState {
  return { code, matchId, createdMs: nowMs, status: 'lobby', config: null, seats: [null, null], tick: 0, pending: [], hashes: {}, lastHashTick: -1, stall: null, endedReason: null, pause: null, pausesLeft: [PAUSES_PER_SEAT, PAUSES_PER_SEAT], lastChatMs: [-1, -1], surrendered: null, map, over: [-1, -1], closeAtMs: null, cmdTokens: [CMD_BUDGET.burst, CMD_BUDGET.burst], cmdTokensAtMs: [nowMs, nowMs], cmdChars: 0, endedAtMs: null };
}

/** Every way a room ends goes through here, so the end is dated (#559 H-1). */
function endRoom(st: RoomState, reason: EndedReason, nowMs: number): void {
  st.status = 'ended';
  st.endedReason = reason;
  st.endedAtMs = nowMs;
}

const seatStates = (st: RoomState): SeatState[] =>
  st.seats.flatMap((s) => (s ? [{ seat: s.seat, callsign: s.callsign, connected: s.connected, ready: s.ready }] : []));

export function lobbyMsg(st: RoomState, you: Seat): ServerMsg {
  return { t: 'lobby', config: st.config, seats: seatStates(st), you, map: st.map };
}

/** What a seat is told when the room is over (also to a socket that arrives after it ended):
 *  a surrender names who surrendered. */
export function endedMsg(st: RoomState): ServerMsg {
  if (st.endedReason === 'surrender' && st.surrendered !== null) return { t: 'ended', reason: 'surrender', seat: st.surrendered };
  return { t: 'ended', reason: st.endedReason === null || st.endedReason === 'surrender' ? 'expired' : st.endedReason };
}

/** A verified hello. A second hello for an occupied seat REPLACES it (the
 *  reconnect path, spec §3.5); `readLog` supplies the frames for it. */
export function seatJoin(st: RoomState, seat: Seat, player: string, callsign: string, nowMs: number, readLog: () => Frame[] = () => []): Effect[] {
  const prior = st.seats[seat];
  st.seats[seat] = { seat, player, callsign, connected: true, ready: prior?.ready ?? false, lastAck: prior?.lastAck ?? -1, lastSeenMs: nowMs, nextSeq: prior?.nextSeq ?? 0 };
  const out: Effect[] = [];
  if (prior && prior.connected) out.push({ kind: 'close', seat });
  if (st.status === 'lobby') {
    out.push({ kind: 'send', to: 'all', msg: lobbyMsg(st, 0) });   // the DO rewrites `you` per socket
  } else if (st.config) {
    for (const msg of logParts(st.config, readLog())) out.push({ kind: 'send', to: seat, msg });
    // The log makes the client live; a pause in force must be told again.
    if (st.pause !== null) out.push({ kind: 'send', to: seat, msg: pausedMsg(st, nowMs, st.pause) });
    out.push(...recheckStall(st, nowMs));
  }
  return out;
}

/** A rejoin's log as `log` messages of at most `maxChars` characters of
 *  frames each (#559 H-1), in tick order; one part for a short log, and one
 *  (empty) part for a match that has minted nothing. A single frame larger
 *  than `maxChars` goes alone rather than being split. */
export function logParts(config: MatchConfig, frames: readonly Frame[], maxChars = LOG_PART_CHARS): Extract<ServerMsg, { t: 'log' }>[] {
  const runs: Frame[][] = [[]];
  let used = 0;
  for (const f of frames) {
    const size = JSON.stringify(f).length + 1;
    const run = runs[runs.length - 1];
    if (run.length > 0 && used + size > maxChars) { runs.push([f]); used = size; } else { run.push(f); used += size; }
  }
  return runs.map((run, part) => ({ t: 'log', config, frames: run, part, parts: runs.length }));
}

function pausedMsg(st: RoomState, nowMs: number, pause: { seat: Seat; untilMs: number }): ServerMsg {
  return { t: 'paused', seat: pause.seat, remainingMs: Math.max(0, pause.untilMs - nowMs), pausesLeft: [st.pausesLeft[0], st.pausesLeft[1]] };
}

/** A pause is a stall with a reason, ended by its owner or by the clock. */
function endPause(st: RoomState, nowMs: number): Effect[] {
  st.pause = null;
  // A pause is not silence: every seat's clock of silence restarts now.
  for (const s of st.seats) if (s) s.lastSeenMs = nowMs;
  st.status = 'running';
  st.stall = null;
  return [{ kind: 'send', to: 'all', msg: { t: 'resume' } }, ...recheckStall(st, nowMs)];
}

export function seatGone(st: RoomState, seat: Seat, nowMs: number): Effect[] {
  const s = st.seats[seat];
  if (!s) return [];
  s.connected = false;
  s.lastSeenMs = nowMs;
  if (st.status === 'lobby') return [{ kind: 'send', to: 'all', msg: lobbyMsg(st, 0) }];
  armClose(st, nowMs);   // a seat that goes after the other reported the result
  return recheckStall(st, nowMs);
}

/** Arms the room's own close (L-1, R-B26) once the result is settled: both
 *  seats reported the SAME `over` tick, or one did and the other seat is not
 *  connected (it may never come back to say so). Two different ticks arm
 *  nothing: the seats diverged, and the hash comparison voids that match.
 *  Armed once; nothing later (a rejoin, a late report) moves or clears it. */
function armClose(st: RoomState, nowMs: number): void {
  if (st.closeAtMs !== null || (st.status !== 'running' && st.status !== 'stalled')) return;
  // Two reports that disagree stay unarmed for good: a seat that then goes
  // must not let the lone-report rule below rescue the disagreement.
  if (st.over[0] >= 0 && st.over[1] >= 0 && st.over[0] !== st.over[1]) return;
  const settled = ([0, 1] as const).some((seat) => {
    const tick = st.over[seat];
    if (tick < 0) return false;
    const other = seat === 0 ? 1 : 0;
    return st.over[other] === tick || st.seats[other]?.connected !== true;
  });
  if (settled) st.closeAtMs = nowMs + OVER_CLOSE_MS;
}

/** The room's own close, once its deadline has come (L-1): `ended over` to
 *  both seats, and their sockets closed normally. Ended, the room runs no
 *  clock and no alarm and writes nothing more (`match-room.ts`). The clock
 *  asks this first, before a pause or a stall can hold it, and so does the
 *  alarm, for a room whose clock is not running. */
export function closeIfDue(st: RoomState, nowMs: number): Effect[] {
  if ((st.status !== 'running' && st.status !== 'stalled') || st.closeAtMs === null || nowMs < st.closeAtMs) return [];
  endRoom(st, 'over', nowMs);
  st.stall = null;
  st.pause = null;
  return [{ kind: 'send', to: 'all', msg: { t: 'ended', reason: 'over' } }, { kind: 'shut', seat: 0 }, { kind: 'shut', seat: 1 }];
}

export function seatMessage(st: RoomState, seat: Seat, msg: ClientMsg, nowMs: number, mintConfig: () => MatchConfig): Effect[] {
  const s = st.seats[seat];
  if (!s) return [];
  s.lastSeenMs = nowMs;
  switch (msg.t) {
    case 'hello': return [];   // handled by the DO before seatJoin
    case 'ready': {
      if (st.status !== 'lobby') return [];
      s.ready = true;
      const both = st.seats[0]?.ready && st.seats[1]?.ready && st.seats[0]?.connected && st.seats[1]?.connected;
      if (!both) return [{ kind: 'send', to: 'all', msg: lobbyMsg(st, 0) }];
      st.config = mintConfig();
      st.status = 'running';
      // Silence is measured from the start of the match, not from the lobby.
      for (const seatState of st.seats) if (seatState) seatState.lastSeenMs = nowMs;
      return [{ kind: 'send', to: 'all', msg: { t: 'start', config: st.config } }];
    }
    case 'cmd': {
      if (st.status !== 'running' && st.status !== 'stalled') return [{ kind: 'send', to: seat, msg: { t: 'error', code: 'not_running' } }];
      // Orders wait while the match is paused, for both seats (L-2, R-B27): a cmd
      // that arrives under a pause -- one already in flight when it began
      // included -- is refused outright, never pending and never stamped into
      // any frame, so the seat that did not pause gets no planning time. It
      // takes no `nextSeq` either: the number only orders a seat's commands
      // within a frame, so a refusal leaves the next accepted one contiguous.
      // The sender is told (`cmdRefused`, to that seat alone): a cmd already in
      // flight when the pause began would otherwise vanish with no word -- the
      // client says why once per pause. A cmd accepted BEFORE the pause stays
      // pending and runs in the first frame after the resume; it was sent
      // before, and both seats get it alike.
      if (st.pause !== null) return [{ kind: 'send', to: seat, msg: { t: 'cmdRefused' } }];
      if (st.pending.filter((p) => p.seat === seat).length >= MAX_PENDING_CMDS_PER_SEAT) return [];
      if (!spendCmdToken(st, seat, nowMs)) return [];
      st.pending.push({ seat, seq: s.nextSeq++, cmd: msg.cmd });
      return [];
    }
    case 'ack': {
      if (msg.tick > s.lastAck) s.lastAck = msg.tick;
      // An ack can only END a stall. Starting one is the clock's decision (and
      // seatGone's), so a healthy seat's ack never races ahead of the metronome.
      return recheckStall(st, nowMs, false);
    }
    case 'hash': {
      if (st.status !== 'running' && st.status !== 'stalled') return [];
      // A replay, or a tick the room has not minted (#559 M-2, L-2): no seat can
      // hash a frame that does not exist, so a far-future pair is a forgery that
      // would void the match and write a desync row from nothing.
      if (msg.tick < 0 || msg.tick <= st.lastHashTick || msg.tick >= st.tick) return [];
      const pair = st.hashes[msg.tick] ?? [null, null];
      pair[seat] = msg.h;
      st.hashes[msg.tick] = pair;
      const [a, b] = pair;
      if (a === null || b === null) {
        const open = Object.keys(st.hashes).map(Number);
        // Prune the HIGHEST: a forged far-future tick is what a flood adds,
        // and the honest comparison is always the lowest open tick.
        if (open.length > MAX_OPEN_HASHES) delete st.hashes[Math.max(...open)];
        return [];
      }
      st.lastHashTick = msg.tick;
      for (const k of Object.keys(st.hashes)) if (Number(k) <= st.lastHashTick) delete st.hashes[Number(k)];
      if (a === b) return [{ kind: 'send', to: 'all', msg: { t: 'hashOk', tick: msg.tick } }];
      endRoom(st, 'void', nowMs);
      return [{ kind: 'send', to: 'all', msg: { t: 'desync', tick: msg.tick, hashes: [a, b] } }];
    }
    case 'bye': {
      if (st.status === 'ended') return [];
      endRoom(st, 'left', nowMs);
      return [{ kind: 'send', to: 'all', msg: { t: 'ended', reason: 'left' } }];
    }
    case 'pause': {
      if ((st.status !== 'running' && st.status !== 'stalled') || st.pause !== null || st.pausesLeft[seat] <= 0) return [];
      st.pausesLeft[seat]--;
      st.pause = { seat, untilMs: nowMs + PAUSE_MS };
      st.status = 'stalled';
      return [{ kind: 'send', to: 'all', msg: { t: 'paused', seat, remainingMs: PAUSE_MS, pausesLeft: [st.pausesLeft[0], st.pausesLeft[1]] } }];
    }
    case 'resume': {
      // Only the pauser ends it early; an ended room stays ended.
      if (st.status === 'ended' || st.pause === null || st.pause.seat !== seat) return [];
      return endPause(st, nowMs);
    }
    case 'surrender': {
      if (st.status === 'ended' || st.status === 'lobby') return [];
      endRoom(st, 'surrender', nowMs);
      st.surrendered = seat;
      return [{ kind: 'send', to: 'all', msg: { t: 'ended', reason: 'surrender', seat } }];
    }
    case 'chat': {
      if (st.status === 'ended') return [];
      // eslint-disable-next-line no-control-regex -- matching control characters is the point
      const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_CHARS);
      if (text === '' || (st.lastChatMs[seat] >= 0 && nowMs - st.lastChatMs[seat] < CHAT_MIN_GAP_MS)) return [];
      st.lastChatMs[seat] = nowMs;
      return [{ kind: 'send', to: 'all', msg: { t: 'chat', seat, text } }];
    }
    case 'over': {
      // The result this seat's sim reached (L-1): only its first report counts,
      // and only for a tick the room has minted (`st.tick` is the NEXT frame's).
      if ((st.status !== 'running' && st.status !== 'stalled') || st.over[seat] >= 0 || msg.tick >= st.tick) return [];
      st.over[seat] = msg.tick;
      armClose(st, nowMs);
      return [];
    }
  }
}

/** One token of the seat's command budget, if it has one (#559 F2). */
function spendCmdToken(st: RoomState, seat: Seat, nowMs: number): boolean {
  const elapsed = Math.max(0, nowMs - st.cmdTokensAtMs[seat]);
  st.cmdTokens[seat] = Math.min(CMD_BUDGET.burst, st.cmdTokens[seat] + (elapsed * CMD_BUDGET.perSecond) / 1000);
  st.cmdTokensAtMs[seat] = nowMs;
  if (st.cmdTokens[seat] < 1) return false;
  st.cmdTokens[seat] -= 1;
  return true;
}

/** Why the clock must stop, if it must: the first seat that is gone, silent,
 *  or too far behind. Null means run. Silence is judged only while running:
 *  during a stall no frames flow, so a healthy seat has nothing to ack and
 *  would otherwise turn 'silent' and keep the room stalled forever. */
function stallFor(st: RoomState, nowMs: number): { reason: 'behind' | 'gone'; seat: Seat } | null {
  for (const s of st.seats) {
    if (!s) continue;
    // Order matters: a seat that is both far behind and silent is reported as
    // 'behind' (the more specific cause); only a dead socket is always 'gone'.
    if (!s.connected) return { reason: 'gone', seat: s.seat };
    if (st.tick - 1 - s.lastAck >= STALL_BEHIND_TICKS) return { reason: 'behind', seat: s.seat };
    if (st.status === 'running' && nowMs - s.lastSeenMs > STALL_SILENT_MS) return { reason: 'gone', seat: s.seat };
  }
  return null;
}

function recheckStall(st: RoomState, nowMs: number, mayStall = true): Effect[] {
  if (st.pause !== null) return [];   // a pause outranks every other reason to stop
  if (st.status !== 'running' && st.status !== 'stalled') return [];
  const want = stallFor(st, nowMs);
  if (want && st.status === 'running' && mayStall) {
    st.status = 'stalled';
    st.stall = want;
    return [{ kind: 'send', to: 'all', msg: { t: 'stall', reason: want.reason, seat: want.seat } }];
  }
  if (!want && st.status === 'stalled') {
    st.status = 'running';
    st.stall = null;
    for (const seatState of st.seats) if (seatState) seatState.lastSeenMs = nowMs;   // the wait was not silence
    return [{ kind: 'send', to: 'all', msg: { t: 'resume' } }];
  }
  if (want && st.status === 'stalled' && (st.stall?.reason !== want.reason || st.stall.seat !== want.seat)) {
    st.stall = want;
    return [{ kind: 'send', to: 'all', msg: { t: 'stall', reason: want.reason, seat: want.seat } }];
  }
  return [];
}

/** What the DO persists the state for: the lifecycle, never the per-tick
 *  traffic (tick, pending commands, acks, hashes, last-seen times). The state
 *  is written only when this changes, which keeps a running match inside
 *  Workers Free's write budget (task 8b, R34). A stall is NOT lifecycle
 *  (R37): 'stalled' reads as 'running' and the stall itself is left out,
 *  because a seat a little slower than 20 Hz flaps behind-stall/resume on
 *  every ack, and `revive` re-derives a behind or silent stall anyway. A
 *  gone seat (socket closed) still persists, through the seat's `connected`. */
export function persistKey(st: RoomState): string {
  const seats = st.seats.map((s) => (s ? [s.player, s.callsign, s.connected, s.ready] : null));
  const status = st.status === 'stalled' ? 'running' : st.status;
  // The `over` reports and the armed close (L-1): two reports and one arming, each written once,
  // so the deadline survives an eviction; the two minutes' wait itself writes nothing.
  return JSON.stringify([status, st.endedReason, st.config !== null, seats, st.pausesLeft, st.pause?.seat ?? null, st.surrendered, st.over, st.closeAtMs !== null]);
}

/** The state as storage gave it back after an eviction, made live again.
 *  `tick` is where the persisted frames end: the room continues there. What
 *  only memory held is re-earned rather than restored: a seat's ack is taken
 *  as caught up and its silence restarts now (the persisted ones date from
 *  the last lifecycle write, and would stall the room at once), and pending
 *  commands persisted with an older tick were already stamped into a frame,
 *  so they are dropped rather than stamped twice.
 *
 *  So a persisted behind or silent stall is un-stalled at the next clock
 *  tick: a seat that really is behind gets a fresh allowance of
 *  `STALL_BEHIND_TICKS` before it stalls the room again, which costs nothing
 *  but time -- the stall only paces the room, and both clients run the same
 *  frames either way, so no desync. A 'gone' stall stands, since `connected`
 *  is persisted. Left stale on purpose, all harmless: `nextSeq` only orders
 *  a seat's commands WITHIN one frame (`canonicalOrder`), so restarting it
 *  from an older value repeats no order inside any frame; `hashes` and
 *  `lastHashTick` can only be older than the truth, so a hash the clients
 *  already compared arrives as a replay or completes no pair, a half pair
 *  waits for its partner as before, and any leftover is pruned when the next
 *  pair completes. */
export function revive(st: RoomState, tick: number, nowMs: number): void {
  // A room persisted before N1b has none of the newer fields; `undefined !== null`
  // would read as a pause in force, and `pausesLeft[seat]` would throw.
  const stored: Partial<RoomState> = st;
  st.pause = stored.pause ?? null;
  st.pausesLeft = stored.pausesLeft ?? [PAUSES_PER_SEAT, PAUSES_PER_SEAT];
  st.lastChatMs = stored.lastChatMs ?? [-1, -1];
  st.surrendered = stored.surrendered ?? null;
  st.map = stored.map ?? '';
  st.over = stored.over ?? [-1, -1];
  st.closeAtMs = stored.closeAtMs ?? null;
  st.cmdTokens = stored.cmdTokens ?? [CMD_BUDGET.burst, CMD_BUDGET.burst];
  st.cmdTokensAtMs = [nowMs, nowMs];
  st.cmdChars = stored.cmdChars ?? 0;
  // An ended room persisted before the date was kept is wiped from this wake.
  st.endedAtMs = stored.endedAtMs ?? (st.status === 'ended' ? nowMs : null);
  if (tick > st.tick) {
    st.tick = tick;
    st.pending = [];
  }
  for (const s of st.seats) {
    if (!s) continue;
    s.lastAck = Math.max(s.lastAck, st.tick - 1);
    s.lastSeenMs = nowMs;
  }
}

/** The six-hour TTL, in any status but ended. The DO runs it at the start of
 *  EVERY handler as well as on the clock, because a lobby or an abandoned
 *  room has no clock running (N0 has no alarms). */
export function expire(st: RoomState, nowMs: number): Effect[] {
  if (st.status === 'ended' || nowMs - st.createdMs <= ROOM_TTL_MS) return [];
  endRoom(st, 'expired', nowMs);
  return [{ kind: 'send', to: 'all', msg: { t: 'ended', reason: 'expired' } }];
}

/** Every 50 ms while the match lives. One frame per call when running. */
export function clockTick(st: RoomState, nowMs: number): Effect[] {
  if (st.status === 'ended') return [];
  const expired = expire(st, nowMs);
  if (expired.length > 0) return expired;
  if (st.status === 'lobby') return [];
  const closed = closeIfDue(st, nowMs);
  if (closed.length > 0) return closed;
  const out: Effect[] = [];
  if (st.pause !== null) {
    if (nowMs < st.pause.untilMs) return out;
    out.push(...endPause(st, nowMs));   // the deadline: resume, and run this tick's frame
  }
  out.push(...recheckStall(st, nowMs));
  if (st.status !== 'running') return out;
  // At most MAX_CMDS_PER_SEAT_PER_FRAME of each seat's commands (#559 F2); the
  // rest wait, in arrival order, for the next frames.
  const take: Stamped[] = [];
  const wait: Stamped[] = [];
  const taken = [0, 0];
  for (const p of st.pending) (taken[p.seat]++ < MAX_CMDS_PER_SEAT_PER_FRAME ? take : wait).push(p);
  const chars = take.reduce((n, p) => n + JSON.stringify(p.cmd).length, 0);
  if (st.cmdChars + chars > MAX_LOG_CMD_CHARS) {
    // #559 H-1: the room stores no more; the match is void.
    endRoom(st, 'void', nowMs);
    st.stall = null;
    st.pending = [];
    return [...out, { kind: 'send', to: 'all', msg: { t: 'ended', reason: 'void' } }];
  }
  st.cmdChars += chars;
  const frame: Frame = { tick: st.tick, cmds: canonicalOrder(take) };
  st.pending = wait;
  st.tick++;
  out.push({ kind: 'frame', frame });
  out.push({ kind: 'send', to: 'all', msg: { t: 'frame', tick: frame.tick, cmds: frame.cmds } });
  return out;
}
