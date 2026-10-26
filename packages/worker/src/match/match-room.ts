/**
 * One match (spec §3.2). A thin shell over `room-core.ts`: sockets in, effects
 * out, state in this object's storage. The WebSocket Hibernation API holds
 * the sockets, and a socket's seat lives in its ATTACHMENT (tags are fixed at
 * `acceptWebSocket`, before the hello says which seat it is). A 50 ms
 * `setInterval` is the metronome while the match lives, restarted by
 * `ensureClock()` from every handler so an eviction never strands a running
 * match (Review Focus 5). The six-hour TTL is checked at the start of every
 * handler as well as on the clock.
 *
 * The watchdog (R38): an eviction kills the interval, and before N1 only the
 * next socket event restarted it. A storage alarm survives the eviction, so
 * `alarm()` restarts the clock with nobody's help. It is armed when the
 * interval starts and re-arms itself only while the match is running or
 * stalled with a seat still connected (`wantsClock`); otherwise the one alarm
 * every room keeps (#559 H-1, `alarmFor`) is aimed at the six-hour TTL, the
 * armed close, or -- once the room has ended -- the wipe, `PURGE_AFTER_MS`
 * later, when `deleteAll` removes every key, the frame table and the alarm.
 * No storage exists before `/create`: a probe of a code with no room writes
 * nothing. An abandoned room therefore sleeps until its TTL and is then
 * removed, rather than sitting in storage for ever. Every `WATCHDOG_MS` = 5 s, not 1 s,
 * because Cloudflare bills each `setAlarm()` as a row written: 1 s would cost
 * a whole row a second per running match, as much as the frames, and any
 * socket event (an order, an ack, a reconnect) restarts the clock sooner
 * anyway, so 5 s bounds only a freeze nobody is acting through (R-N12).
 *
 * The room's own close (L-1, R-B26): once both seats have reported the
 * result (`over`), the room closes itself `OVER_CLOSE_MS` later. The alarm is
 * aimed at that deadline (`alarmFor`): the watchdog never sleeps past it, so
 * an evicted room closes on time by the alarm alone, and a room both seats
 * have left -- no clock -- keeps exactly one alarm, at the deadline. Ended,
 * the room runs no clock and writes no row until the wipe.
 *
 * Storage is budgeted for Workers Free (task 8b, R34; R-N12). Frames persist
 * as `batch` rows of variable length: a batch closes when it holds
 * `BATCH_TICKS` frames OR at the first frame that carries a command (R36,
 * write-through), and each close writes one row. So a match writes
 * `max(command frames a second, 1)` rows a second plus 0.2 for the watchdog:
 * about 1.2 idle and 2.2 with one order a second from each seat, over the
 * 2-a-second bound N0 set (R-N12 accepts it). The open batch lives in memory
 * and `log` answers from both. The room state is written only when its
 * lifecycle changes (`persistKey`: create, seats joining, going, readying,
 * start, end), never per tick, ack, command, hash or behind/silent stall
 * (R37) -- and every such write first flushes the open batch (rewriting its
 * one row in place), so the persisted frames always reach the persisted
 * state's tick.
 *
 * What an eviction costs, and why it is safe: a revived room continues at
 * `max(state.tick, end of the last persisted batch)` (`revive`), reading each
 * batch's end as `first_tick + frames.length`. The frames after that point
 * were sent but never persisted -- and since a command frame always closes
 * its batch, every one of them was EMPTY (R36). The room mints those ticks
 * again, empty unless an order reaches the revived room first; an empty copy
 * equals the original, and both clients drop the copies as duplicates
 * (`LockstepClock`) anyway, so any command the revived room stamps into them
 * is lost on BOTH clients alike and nobody desyncs. Pending commands, acks,
 * half hash pairs and the open batch were memory only; acks and hashes are
 * re-earned. One residue: a re-minted tick that DID take a new order differs
 * from the empty original, and the log holds the revived room's copy, so a
 * client that takes that tick from `log` (a rejoin) runs an order the live
 * clients dropped; the next hash comparison voids the match loudly
 * (`desync`), never silently. A seat going ('gone' persists through
 * `connected`) flushes the open batch with its write, so an eviction while
 * waiting for a reconnect re-sends nothing.
 */
import { advisorMayRelay, factionsOfMatchup, matchupAllowed, sidesOfFactions, matchupField, parseClientMsg, versusMapAllowed, validateConfig, REPLACED_CLOSE_CODE, LOG_PART_CHARS, SNAPSHOT_EVERY_TICKS, SNAPSHOT_EVERY_TICKS_MAX, SNAPSHOT_FORMAT, SNAPSHOT_MAX_COMPRESSED_BYTES, SNAPSHOT_MAX_RAW_BYTES, gunzipCapped, readSnapshotHeader, sha256Hex, snapshotEvery, type AdvisorScope, type ClientMsg, type Frame, type MatchConfig, type Pace, type Seat, type SeatConfig, type ServerMsg } from '@lions/net';
import type { Env } from '../d1';
import type { DurableStateLike, HibernatingSocket, UpgradeInit } from '../do-types';
import { readCapped } from '../read-capped';
import { LOG_FROM_SQL, SNAP_CREATE_SQL, SNAP_GET_SQL, SNAP_PUT_SQL, SNAP_TICK_SQL } from './snapshot-sql';
import { PendingBook, admitTick, decide } from './snapshot-intake';
import { SNAP_MISMATCH_PER_ROOM, writeSnapMismatch } from './snap-mismatch-log';
import { createRoom, endedMsg, lobbyMsg, logParts, pausedMsg, seatJoin, seatMessage, seatGone, clockTick, closeIfDue, expire, forfeitDueAt, forfeitIfDue, persistKey, revive, ROOM_TTL_MS, type Effect, type RoomState } from './room-core';
import { verifyTicket } from './ticket';
import { DEFAULT_MAP, callsignField, kitField, mapField, paceField, seatKindField, seatTiersField, textField, type Kit, type SeatKind, type SeatTiers } from './room-fields';
import { compactLog, writeDesync } from './desync-log';

export const TICK_MS = 50;
/** The local relay's options (N4b task 11). workerd never passes them. */
export interface MatchRoomOptions {
  /** The clock's period in ms; default `TICK_MS`. */
  tickMs?: number;
  /** A versus room's seed from its code; default 32 bits from `crypto.getRandomValues`. A sandbox room keeps N0's. */
  seed?: (code: string) => number;
  /** Frame ticks between snapshots, minted into the room's config; default
   *  `SNAPSHOT_EVERY_TICKS`. Accepted only as a non-negative multiple of 20 (the
   *  hash cadence) up to `SNAPSHOT_EVERY_TICKS_MAX`, else the default stands; 0
   *  turns snapshots off. */
  snapshotEveryTicks?: number;
}
/** A sandbox room's seed: the app's SIM_SEED, so the two-machine protocol stays N0's. A versus room mints its own. */
const SIM_SEED_N0 = 20260727;
/** Frames per persisted row: one row a second at the 20 Hz tick. */
export const BATCH_TICKS = 20;
/** R38: the watchdog alarm's period. 5 s, not 1 s: each `setAlarm` is a row written (R-N12). */
export const WATCHDOG_MS = 5000;
/**
 * #559 H-1: how long an ended room keeps its tombstone before `deleteAll`
 * wipes it -- the meta, the state and every frame row. Two minutes, the same
 * grace the result's own close gives: a seat that drops just as the match
 * ends can still reconnect and be told how it ended, and a desync's D1 write
 * (awaited when the room ends) is long done. After it, a socket for the code
 * hears `ended expired`, exactly what a seat of a room that timed out heard.
 */
export const PURGE_AFTER_MS = 120_000;
const CREATE_SQL = 'CREATE TABLE IF NOT EXISTS batch (first_tick INTEGER PRIMARY KEY, frames TEXT NOT NULL)';
const UPSERT_SQL = 'INSERT OR REPLACE INTO batch (first_tick, frames) VALUES (?, ?)';
const SELECT_SQL = 'SELECT first_tick, frames FROM batch ORDER BY first_tick';
const LAST_SQL = 'SELECT first_tick, frames FROM batch ORDER BY first_tick DESC LIMIT 1';

/** What `/create` fixed and `/join` reserved; stored beside the room state. */
interface RoomMeta {
  map: string;
  build: string;
  /** `sandbox` is N0's two-humans-on-side-0 room; `versus` seats the guest on side 1. */
  mode: 'sandbox' | 'versus';
  /** The match seed, fixed at `/create`: one per versus room, the app's SIM_SEED for a sandbox. */
  seed: number;
  /** What each seat typed, from `/create` and `/join`; the ticket carries the player id instead. */
  callsigns: [string, string];
  /** Set by the first `/join`, so a second one is refused before the guest's hello (R5). */
  seat1Reserved: boolean;
  /** Per-match seat tokens (N1b task 12): what `start`/`log` carry as `seats[i].player`, so
   *  a friend never learns the other seat's persistent anonymous id. Minted at `/create`. */
  tokens: [string, string];
  /** Each seat's kind (N4a), from `/create` and `/join`: a bot seat is what makes a paced room pace. */
  kinds: [SeatKind, SeatKind];
  /** The pace `/create` asked for, clamped (D5). `mintConfig` mints it only when a seat is a bot. */
  pace: Pace;
  /** The room's kit rule (per-seat kit), from `/create`: `matched` unless a versus host asked for
   *  exactly `brigade`. A sandbox room is always `matched`. */
  kit: Kit;
  /** What each seat claims to own, from `/create` and `/join`, cleaned against the shipped tracks
   *  (`seatTiersField`). Recorded whatever the kit rule; `mintConfig` reads it only for a KDF
   *  seat in a `brigade` room. */
  claims: [SeatTiers, SeatTiers];
}
/** 16 random hex characters: 64 bits from `crypto.getRandomValues`. */
function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
const mintTokens = (): [string, string] => [mintToken(), mintToken()];
const isToken = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
/** A room persisted by N0 has no mode, seed or callsigns in its meta: it reads
 *  as the sandbox it was, on N0's seed, and its callsigns are the ones its
 *  seats already hold (N0 put the callsign in the ticket's `player`). */
function legacyMeta(m: Partial<RoomMeta>, st: RoomState | null): RoomMeta {
  return {
    map: m.map ?? DEFAULT_MAP,
    build: m.build ?? '',
    mode: m.mode === 'versus' ? 'versus' : 'sandbox',
    seed: typeof m.seed === 'number' ? m.seed : SIM_SEED_N0,
    callsigns: Array.isArray(m.callsigns) && m.callsigns.length === 2 ? m.callsigns : [st?.seats[0]?.callsign ?? '', st?.seats[1]?.callsign ?? ''],
    seat1Reserved: m.seat1Reserved === true,
    // A room created before tokens existed mints them here, at wake. They only become visible
    // when `mintConfig` runs (once, at start); `st.config` then holds them for every `log`.
    tokens: Array.isArray(m.tokens) && m.tokens.length === 2 && isToken(m.tokens[0]) && isToken(m.tokens[1]) ? [m.tokens[0], m.tokens[1]] : mintTokens(),
    // A room from before N4a: two humans, realtime.
    kinds: Array.isArray(m.kinds) && m.kinds.length === 2 ? [seatKindField(m.kinds[0]), seatKindField(m.kinds[1])] : ['human', 'human'],
    pace: paceField(m.pace),
    // A room from before the per-seat kit: matched, no claims. A stored claim is cleaned again,
    // so what a revived room mints is never more than `seatTiersField` lets through.
    kit: m.mode === 'versus' ? kitField(m.kit) : 'matched',
    claims: Array.isArray(m.claims) && m.claims.length === 2 ? [seatTiersField(m.claims[0]), seatTiersField(m.claims[1])] : [seatTiersField(null), seatTiersField(null)],
  };
}
/** A socket's seat; `at`, while it has none, is when it was accepted, for the
 *  hello deadline (#559 M-1). A socket the room has closed has neither.
 *  `role: 'advisor'` (N4a) is that seat's ADVISOR, never the seat: it is
 *  counted as a live socket and sent what the room sends everyone, and it is
 *  never one of `socketsFor(seat)`, so it holds no seat, gets no seat-targeted
 *  message, and its close marks nobody gone. Who it is lives here and nowhere
 *  else, so the advisor survives an eviction with no row written. */
interface SocketAttachment { seat: Seat | null; at?: number; role?: 'advisor'; scope?: AdvisorScope }
/**
 * #559 M-1: what one room lets sockets do.
 * - `HELLO_TIMEOUT_MS`: a socket with no seat after 10 s is closed, and so is
 *   one whose first message does not parse.
 * - `MAX_ROOM_SOCKETS`: two seats need two sockets, plus a few reconnects in
 *   flight; past 8 live ones a new socket is closed at once.
 * - `SOCKET_BUDGET`: a token bucket per socket, 160 at once and 80 a second;
 *   empty, the socket is closed with 1008. An ack or hash that ADVANCES this
 *   socket's last one and names a tick the room has minted is free: a
 *   rejoining seat replays its log at many ticks a frame and sends one ack per
 *   10 ticks and one hash per 20, which is bounded by the room's own tick
 *   count rather than by time.
 */
export const HELLO_TIMEOUT_MS = 10_000;
export const MAX_ROOM_SOCKETS = 8;
export const SOCKET_BUDGET = { burst: 160, perSecond: 80 } as const;
/** N4a: the least gap between two advisor messages one advisor socket may have relayed;
 *  a quicker one is dropped. Memory only, like the socket budget it sits beside. */
export const ADVISOR_MIN_GAP_MS = 250;
/** Policy violation: the close code for a socket the room will not serve. */
const POLICY_CLOSE = 1008;
interface SocketMeter { tokens: number; atMs: number; ack: number; hash: number }
/** The command JSON a log holds, as `clockTick` counts it (#559 H-1). */
const cmdCharsOf = (frames: Frame[]): number => frames.reduce((n, f) => n + f.cmds.reduce((m, c) => m + JSON.stringify(c.cmd).length, 0), 0);

function attachmentOf(ws: WebSocket): SocketAttachment | null {
  try { return (ws as HibernatingSocket).deserializeAttachment() as SocketAttachment | null; } catch { return null; }
}
/** The seat this socket SPEAKS FOR: null for a seatless socket and for an advisor. */
function seatOf(ws: WebSocket): Seat | null {
  const a = attachmentOf(ws);
  return a === null || a.role === 'advisor' ? null : a.seat;
}
/** The seat this socket advises, and how, or null when it is not an advisor. */
function advisorOf(ws: WebSocket): { seat: Seat; scope: AdvisorScope } | null {
  const a = attachmentOf(ws);
  return a !== null && a.role === 'advisor' && a.seat !== null && a.scope !== undefined ? { seat: a.seat, scope: a.scope } : null;
}
function reply(ws: WebSocket, msg: ServerMsg): void {
  try { ws.send(JSON.stringify(msg)); } catch { /* closing */ }
}
function shut(ws: WebSocket, code: number, reason: string): void {
  try { ws.close(code, reason); } catch { /* already gone */ }
}
/** A replaced socket gives up its seat BEFORE it is closed: workerd keeps a
 *  closing socket in `getWebSockets()`, and one still wearing the seat would
 *  take the seat's broadcasts and make the replacement's own close look like
 *  "a replacement is live". */
function retire(ws: WebSocket): void {
  disown(ws);
  shut(ws, REPLACED_CLOSE_CODE, 'replaced');
}
/** The socket no longer speaks for a seat. */
function disown(ws: WebSocket): void {
  try { (ws as HibernatingSocket).serializeAttachment({ seat: null } satisfies SocketAttachment); } catch { /* already gone */ }
}

/** Whether the clock (and its watchdog) has work to do: the match lives AND a
 *  seat is connected. With both seats gone nothing can change until a hello,
 *  and a hello is a handler that starts the clock itself, so an abandoned
 *  room runs no interval and arms no alarm, and the object may sleep (R38).
 *  `connected` is the persisted seat state, so a revived instance reads the
 *  same answer. One seat still connected keeps it running: that client is
 *  there, and the TTL's `ended` must reach it. */
function wantsClock(st: RoomState): boolean {
  return (st.status === 'running' || st.status === 'stalled') && st.seats.some((s) => s !== null && s.connected);
}

/** When the alarm should next wake the room. Every room keeps exactly one
 *  (#559 H-1), so none is ever left in storage with nothing to clear it:
 *  - ended: the wipe, `PURGE_AFTER_MS` after the end;
 *  - a lobby, or a match nobody is connected to: the six-hour TTL -- or, for
 *    the match, its armed close (L-1) or a disconnected seat's forfeit
 *    (`forfeitDueAt`) if that is sooner;
 *  - a match with its clock running: the watchdog, `WATCHDOG_MS` on (R38),
 *    but never later than the armed close or the forfeit, so the last wake
 *    lands ON the deadline rather than up to 5 s past it, at no extra row.
 *  The forfeit adds no alarm of its own: it only aims the one every room
 *  already keeps, and while a seat is connected the 50 ms clock asks it anyway. */
function alarmFor(st: RoomState, nowMs: number): number {
  if (st.status === 'ended') return (st.endedAtMs ?? nowMs) + PURGE_AFTER_MS;
  const ttl = st.createdMs + ROOM_TTL_MS + 1;
  if (st.status === 'lobby') return ttl;
  const close = Math.min(st.closeAtMs ?? ttl, forfeitDueAt(st) ?? ttl);
  if (!wantsClock(st)) return Math.min(close, ttl);
  return Math.min(nowMs + WATCHDOG_MS, close, ttl);
}

export class MatchRoom {
  private st: RoomState | null = null;
  private meta: RoomMeta | null = null;
  private loading: Promise<RoomState | null> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  /** The batch not yet closed: memory only, until it closes or the state is written. */
  private open: Frame[] = [];
  /** Each socket's message budget (#559 M-1): memory only, so a woken room starts every socket full. */
  private readonly meters = new WeakMap<WebSocket, SocketMeter>();
  /** When each advisor socket last had a message relayed (N4a, `ADVISOR_MIN_GAP_MS`): memory only. */
  private readonly advisorRelayedAt = new WeakMap<WebSocket, number>();
  /** The alarm this instance last set, or null when it set none (or the runtime consumed it). */
  private alarmAt: number | null = null;
  /** `persistKey` of the state as last written (or loaded). */
  private savedKey: string | null = null;
  /** Set once this instance has logged a desync: the match is void after the first, so one write is the bound. */
  private desyncLogged = false;

  /** The clock's period: `TICK_MS` unless the local relay asked for another. */
  private readonly tickMs: number;
  /** A versus room's seed, or null for the crypto one. */
  private readonly seedFor: ((code: string) => number) | null;
  /** The cadence minted into every room's config (`MatchRoomOptions.snapshotEveryTicks`). */
  private readonly snapshotEveryTicks: number;
  /** The match digest both seats agreed on at a snapshot tick, signed int32 as
   *  the hash messages carry it. MEMORY ONLY (no row): the two newest ticks. An
   *  eviction forgets them, and that tick can then never be accepted. */
  private readonly agreedDigests = new Map<number, number>();
  /** Uploads waiting for their pair: memory only, at most two snapshot ticks (256 KiB at the 64 KiB cap). */
  private readonly pending = new PendingBook();
  /** The frame tick of the stored snapshot, or -1 for none. Read from the row once per instance (`openSnapshotStore`). */
  private storedTick = -1;
  /** Whether this instance has created the `snapshot` table and read `storedTick`. */
  private snapshotStoreReady = false;
  /** D1 mismatch rows this instance has tried to write, bounded by `SNAP_MISMATCH_PER_ROOM`. */
  private snapMismatches = 0;

  /** No storage here (#559 H-1): an object is made for every code anyone
   *  probes, and only `/create` may give it a table, a key or an alarm.
   *  `opts` is the local relay's (N4b task 11, `tools/src/net/local-relay.ts`):
   *  workerd constructs a Durable Object with two arguments and never passes
   *  it, so a deployed room keeps `TICK_MS`, the crypto seed and
   *  `SNAPSHOT_EVERY_TICKS`. */
  constructor(private readonly ctx: DurableStateLike, private readonly env: Env, opts: MatchRoomOptions = {}) {
    this.tickMs = typeof opts.tickMs === 'number' && Number.isFinite(opts.tickMs) && opts.tickMs > 0 ? opts.tickMs : TICK_MS;
    this.seedFor = opts.seed ?? null;
    const every = opts.snapshotEveryTicks;
    this.snapshotEveryTicks = typeof every === 'number' && Number.isInteger(every) && every >= 0 && every <= SNAPSHOT_EVERY_TICKS_MAX && every % 20 === 0 ? every : SNAPSHOT_EVERY_TICKS;
  }

  // --- storage --------------------------------------------------------------

  /** Once per instance; memoised so two handlers racing a cold start cannot
   *  each read their own copy and lose the other's writes. */
  private load(): Promise<RoomState | null> {
    if (this.st) return Promise.resolve(this.st);
    this.loading ??= (async () => {
      const stored = (await this.ctx.storage.get<Partial<RoomMeta>>('meta')) ?? null;
      const st = (await this.ctx.storage.get<RoomState>('state')) ?? null;
      this.meta = stored === null ? null : legacyMeta(stored, st);
      let gone: Effect[] = [];
      if (st) {
        // A room made before snapshots existed gets its table here, lazily; a code with no room never reaches this.
        this.openSnapshotStore();
        const [lastRow] = this.batches(LAST_SQL);
        revive(st, lastRow ? lastRow.firstTick + lastRow.frames.length : 0, Date.now());
        // The stored command count dates from the last lifecycle write; the log is the truth (#559 H-1).
        if (st.status !== 'ended' && st.status !== 'lobby') st.cmdChars = Math.max(st.cmdChars, cmdCharsOf(this.batches().flatMap((b) => b.frames)));
        // A room persisted before the lobby carried its map has none: the meta has it.
        if (st.map === '') st.map = this.meta?.map ?? DEFAULT_MAP;
        this.savedKey = persistKey(st);
        gone = this.reconcileSockets(st);
        // A room from before every room kept an alarm (#559 H-1) gets one now, so it cannot outlive its TTL.
        if (!wantsClock(st) && (await this.ctx.storage.getAlarm()) === null) {
          const at = alarmFor(st, Date.now());
          await this.ctx.storage.setAlarm(at);
          this.alarmAt = at;
        }
      }
      this.st = st;
      this.loading = null;
      // Applied once `st` is in place, so the effects (a stall, the state write) act on it.
      if (gone.length > 0) await this.apply(gone);
      return this.st;
    })();
    return this.loading;
  }
  /** A revived instance's persisted `connected` can be stale. An EVICTION
   *  keeps hibernated sockets listed, but a deploy or reset drops every
   *  socket and delivers no close to anyone, so a seat would read connected
   *  forever and its alarm would keep the room awake until the TTL. Every seat
   *  marked connected with no socket wearing it is gone, through the same
   *  `seatGone` a close takes. Costs one state write per revive that finds
   *  one (a lifecycle change, R34/R37), and nothing when every seat has its socket. */
  private reconcileSockets(st: RoomState): Effect[] {
    if (st.status === 'ended') return [];
    const held = new Set(this.ctx.getWebSockets().map(seatOf));
    const now = Date.now();
    return st.seats.flatMap((s) => (s !== null && s.connected && !held.has(s.seat) ? seatGone(st, s.seat, now) : []));
  }
  /** The state, and the open batch with it. */
  private async save(): Promise<void> {
    if (!this.st) return;
    this.writeOpenBatch();
    await this.ctx.storage.put('state', this.st);
    this.savedKey = persistKey(this.st);
  }
  private async saveIfChanged(): Promise<void> {
    if (this.st && persistKey(this.st) !== this.savedKey) await this.save();
  }
  /** The snapshot table and the stored tick, once per instance. Only a room that
   *  exists reaches it (`/create`, `load()` with a persisted state): a code with
   *  no room touches no storage (#559 H-1). Costs no row. */
  private openSnapshotStore(): void {
    if (this.snapshotStoreReady) return;
    this.ctx.storage.sql.exec(SNAP_CREATE_SQL);
    const [r] = this.ctx.storage.sql.exec(SNAP_TICK_SQL).toArray();
    this.storedTick = r === undefined ? -1 : Number(r.frame_tick);
    this.snapshotStoreReady = true;
  }
  /** Rewrites the open batch's row in place until it closes. */
  private writeOpenBatch(): void {
    const first = this.open[0];
    if (first) this.ctx.storage.sql.exec(UPSERT_SQL, first.tick, JSON.stringify(this.open));
  }
  /** A batch closes when full, or at once on a frame carrying commands (R36):
   *  write-through and the close are one row, so a revived room can re-mint
   *  only empty frames. */
  private record(frame: Frame): void {
    this.open.push(frame);
    if (this.open.length < BATCH_TICKS && frame.cmds.length === 0) return;
    this.writeOpenBatch();
    this.open = [];
  }
  private batches(query = SELECT_SQL, ...bind: unknown[]): { firstTick: number; frames: Frame[] }[] {
    return this.ctx.storage.sql.exec(query, ...bind).toArray()
      .map((r) => ({ firstTick: r.first_tick as number, frames: JSON.parse(r.frames as string) as Frame[] }));
  }
  /** Every frame so far: the persisted batches, then the open one (whose
   *  partial row, if a state write flushed one, the memory copy supersedes). */
  private readLog(): Frame[] {
    const openFirst = this.open[0]?.tick;
    return [...this.batches().filter((b) => b.firstTick !== openFirst).flatMap((b) => b.frames), ...this.open];
  }
  /** The log from tick `from` on (a hello's `from`, snapshot S3). A batch holds
   *  at most `BATCH_TICKS` frames, so any batch that can hold a tick >= `from`
   *  starts after `from - BATCH_TICKS`: only those rows are read. The open
   *  batch follows under `readLog`'s rule (the memory copy supersedes its own
   *  partial row), and a filter trims the head of the batch that spans `from`.
   *  No `from` is `readLog()` exactly as before. */
  private readLogFrom(from: number | undefined): Frame[] {
    if (from === undefined) return this.readLog();
    const openFirst = this.open[0]?.tick;
    return [...this.batches(LOG_FROM_SQL, from - BATCH_TICKS).filter((b) => b.firstTick !== openFirst).flatMap((b) => b.frames), ...this.open]
      .filter((f) => f.tick >= from);
  }
  /** Every handler starts here: load, then the TTL (R28), then a forfeit
   *  that has fallen due -- before any hello, so a seat that reconnects after
   *  `FORFEIT_MS` hears that it lost rather than cancelling it, and before an
   *  alarm's own work, which is how a room with nobody connected forfeits. */
  private async begin(): Promise<RoomState | null> {
    const st = await this.load();
    if (st) {
      const fx = expire(st, Date.now());
      if (fx.length > 0) await this.apply(fx);
      const forfeit = forfeitIfDue(st, Date.now());
      if (forfeit.length > 0) await this.apply(forfeit);
    }
    return st;
  }

  // --- effects --------------------------------------------------------------

  private mintConfig(st: RoomState): MatchConfig {
    // The seat's real id (`RoomSeat.player`) stays in the room; the config carries a per-match token.
    const tokens = this.meta?.tokens ?? mintTokens();
    const mode = this.meta?.mode ?? 'sandbox';
    const kinds = this.meta?.kinds ?? ['human', 'human'];
    // D5: a room paces only when a seat is a bot; two humans are never waited for.
    const pace: Pace = this.meta?.pace.kind === 'paced' && kinds.includes('bot') ? this.meta.pace : { kind: 'realtime' };
    // Per-seat kit: a sandbox room is always matched. A seat fields its claim only in a
    // brigade room and only as KDF -- the claims are KDF tracks, and a Sarim seat has none.
    const kit: Kit = mode === 'versus' ? this.meta?.kit ?? 'matched' : 'matched';
    // LD1 (N3): a seat's SIDE follows its faction -- the KDF seat is side 0 in
    // a KDF-vs-Sarim room whichever seat hosts -- while its spawn END follows
    // the seat (`endOfSeat`). A mirror is seat s on side s, as before.
    const sides = sidesOfFactions(st.factions);
    const seatConfig = (seat: Seat): SeatConfig => {
      const s = st.seats[seat];
      const faction = mode === 'versus' ? st.factions[seat] : 'kdf';
      const tiers: SeatTiers = kit === 'brigade' && faction === 'kdf' ? this.meta?.claims[seat] ?? {} : {};
      return { seat, side: mode === 'versus' ? sides[seat] : 0, faction, kit, tiers, unlocks: [], player: tokens[seat], callsign: this.meta?.callsigns[seat] ?? s?.callsign ?? '', kind: kinds[seat] };
    };
    // `dataDigest: 0` stays in the wire format, but no client folds it (L4):
    // each folds the digest of its own content.
    const config = validateConfig({
      matchId: st.matchId, code: st.code, seed: this.meta?.seed ?? SIM_SEED_N0, map: this.meta?.map ?? DEFAULT_MAP, mode,
      seats: [seatConfig(0), seatConfig(1)],
      pace, hashEveryTicks: 20, bufferTicks: 2, build: this.meta?.build ?? '', dataDigest: 0, snapshotEveryTicks: this.snapshotEveryTicks,
    });
    if (config === null) throw new Error('MatchRoom minted a config its own validator refuses');
    return config;
  }
  /** The sockets that speak for `seat`: never its advisor. */
  private socketsFor(seat: Seat): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => seatOf(ws) === seat);
  }
  /** `seat`'s advisor sockets: one at most while the room is healthy (a retired one is disowned). */
  private advisorsFor(seat: Seat): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => advisorOf(ws)?.seat === seat);
  }
  /** A `lobby` as `seat` is told it: its own seat, and the room's kit rule when
   *  it is `brigade` (the lobby shows it to both seats; absent is matched). */
  private lobbyFor(msg: Extract<ServerMsg, { t: 'lobby' }>, seat: Seat): ServerMsg {
    return { ...msg, you: seat, ...(this.meta?.kit === 'brigade' && this.meta.mode === 'versus' ? { kit: 'brigade' as const } : {}) };
  }
  /** `'all'` reaches every seated socket, advisors included, each `lobby` naming
   *  the socket's own seat; a seat-targeted message reaches that seat's own
   *  sockets and never its advisor. */
  private send(to: Seat | 'all', msg: ServerMsg): void {
    const seats: Seat[] = to === 'all' ? [0, 1] : [to];
    for (const seat of seats) {
      const text = JSON.stringify(msg.t === 'lobby' ? this.lobbyFor(msg, seat) : msg);
      const targets = to === 'all' ? [...this.socketsFor(seat), ...this.advisorsFor(seat)] : this.socketsFor(seat);
      for (const ws of targets) { try { ws.send(text); } catch { /* closing */ } }
    }
  }
  /** Which scope each seat's advisor has, read from the sockets' attachments:
   *  no state and no row, and it survives hibernation as the sockets do. */
  private advisorsPresent(): Extract<ServerMsg, { t: 'advisors' }> {
    const present: [AdvisorScope | null, AdvisorScope | null] = [null, null];
    for (const ws of this.ctx.getWebSockets()) {
      const a = advisorOf(ws);
      if (a !== null) present[a.seat] = a.scope;
    }
    return { t: 'advisors', present };
  }
  /** `keep` is the socket whose hello produced these effects: a `close` for
   *  its seat closes every OTHER socket on that seat. The state is written
   *  only if its lifecycle changed. */
  private async apply(effects: Effect[], keep?: WebSocket): Promise<void> {
    let desync: Extract<ServerMsg, { t: 'desync' }> | null = null;
    const snapshots: Promise<void>[] = [];
    for (const e of effects) {
      // Every kind is named: an unknown one must never fall into `close` and
      // retire a seat's sockets (the `never` below fails to compile on a new kind).
      switch (e.kind) {
        case 'frame': this.record(e.frame); break;
        case 'send':
          this.send(e.to, e.msg);
          if (e.msg.t === 'desync') desync = e.msg;
          break;
        case 'shut':
          // The room is over (L-1): each socket gives up its seat, so its close
          // (from either end) finds no seat to mark gone and writes nothing.
          for (const ws of [...this.socketsFor(e.seat), ...this.advisorsFor(e.seat)]) { disown(ws); shut(ws, 1000, 'ended'); }
          break;
        case 'close':
          for (const ws of this.socketsFor(e.seat)) if (ws !== keep) retire(ws);
          break;
        // Its synchronous part (remembering the digest, a snapshot row) runs here, before the
        // hashOk goes out; only a D1 report is awaited, after the sends (below).
        case 'agreed': snapshots.push(this.onAgreed(e.tick, e.h)); break;
        default: { const unhandled: never = e; throw new Error(`MatchRoom: unhandled effect ${JSON.stringify(unhandled)}`); }
      }
    }
    await this.saveIfChanged();
    // After the sends and the state write, so a slow or failing D1 delays nothing a player sees.
    // AWAITED: an unawaited D1 call may be cancelled when the object hibernates.
    await Promise.all(snapshots);
    if (desync !== null) await this.logDesync(desync.tick, desync.hashes);
  }
  /** The pair's hashes for a snapshot tick agreed on `h`: remember the two
   *  newest in memory (no row), then see whether the uploads waiting for this
   *  tick can now be settled. A snapshot is accepted against this value only. */
  private async onAgreed(tick: number, h: number): Promise<void> {
    this.agreedDigests.set(tick, h);
    while (this.agreedDigests.size > 2) this.agreedDigests.delete(Math.min(...this.agreedDigests.keys()));
    await this.settleSnapshot(tick);
  }
  /** Decides `tick`'s pending uploads (the pure `decide`) and acts: `stored`
   *  writes the one snapshot row, `held` writes nothing, `mismatch` drops both
   *  uploads and reports to D1. Everything before the D1 await is synchronous,
   *  so the book, `storedTick` and the agreed digests change in one step. */
  private async settleSnapshot(tick: number): Promise<'stored' | 'held' | 'mismatch'> {
    const st = this.st;
    if (st === null) return 'held';
    const d = decide(this.pending, tick, this.agreedDigests.get(tick));
    if (d.kind === 'held') return 'held';
    if (d.kind === 'accept') {
      this.ctx.storage.sql.exec(SNAP_PUT_SQL, tick, d.sha, d.digest, d.body.slice().buffer);
      this.storedTick = tick;
      this.pending.dropThrough(tick);
      for (const t of [...this.agreedDigests.keys()]) if (t <= tick) this.agreedDigests.delete(t);
      return 'stored';
    }
    this.pending.drop(tick);
    // The first bad upload of a tick is reported; a room that keeps sending them is not reported past its bound.
    if (this.snapMismatches < SNAP_MISMATCH_PER_ROOM) {
      this.snapMismatches++;
      try {
        const written = await writeSnapMismatch(this.env.DB, { code: st.code, tick, kind: d.why, shaA: d.shas[0], shaB: d.shas[1], digest: d.digest, createdAt: Date.now() });
        if (!written) console.warn('MatchRoom: snapshot mismatch not logged, the daily budget is spent', st.code, tick);
      } catch (e) {
        // A missing table (migration not applied), a D1 outage or a missing binding never breaks the room.
        console.error('MatchRoom: snapshot mismatch log failed', e);
      }
    }
    return 'mismatch';
  }
  /** Writes a desync's evidence to D1, once per room. AWAITED by `apply`: an
   *  unawaited D1 call may be cancelled when the object hibernates, and this
   *  is the one write whose purpose is to survive. It runs once a match, so
   *  its latency is irrelevant. A log write must never break the room (a
   *  missing binding, a D1 outage, a throw and a rejection all end in a
   *  console.error), and the sends have already gone. */
  private async logDesync(tick: number, hashes: [number, number]): Promise<void> {
    const st = this.st;
    if (this.desyncLogged || st === null || st.config === null) return;
    this.desyncLogged = true;
    try {
      const frames = this.readLog();
      const written = await writeDesync(this.env.DB, {
        code: st.code, tick, hashA: hashes[0], hashB: hashes[1],
        config: JSON.stringify(st.config), frames: JSON.stringify(compactLog(frames)), frameCount: frames.length, createdAt: Date.now(),
      });
      if (!written) console.warn('MatchRoom: desync not logged, the daily budget is spent', st.code, tick);
    } catch (e) {
      console.error('MatchRoom: desync log failed', e);
    }
  }
  private ensureClock(): void {
    const st = this.st;
    const live = st !== null && wantsClock(st);
    if (live && this.clock === null) {
      this.clock = setInterval(() => { void this.onClock(); }, this.tickMs);
      this.armAlarm();
    } else if (!live && this.clock !== null) {
      clearInterval(this.clock);
      this.clock = null;
      // Re-aimed: at the wipe if the room ended, else the armed close or the TTL.
      this.armAlarm();
    } else if (!live && st !== null && st.status === 'ended' && this.alarmAt !== alarmFor(st, Date.now())) {
      // A room that ended with no clock of its own (a lobby, an abandoned
      // match, a revived instance): its alarm is aimed at the wipe, once.
      this.armAlarm();
    }
  }
  /** Unawaited, as the clock's start and stop are synchronous; a refusal
   *  (storage over quota, say) must not become an unhandled rejection. The
   *  cost of a lost arm is only R38's protection, until the next start. */
  private armAlarm(): void {
    if (this.st === null) return;
    const at = alarmFor(this.st, Date.now());
    this.alarmAt = at;
    this.ctx.storage.setAlarm(at).catch((e: unknown) => { console.error('MatchRoom: setAlarm failed', e); });
  }
  /** #559 H-1: the room is over and its grace has passed. Every socket goes,
   *  then every key, the frame table and the alarm; the instance forgets the
   *  room, so the code answers as one that never existed. */
  private async purge(): Promise<void> {
    if (this.clock !== null) { clearInterval(this.clock); this.clock = null; }
    for (const ws of this.ctx.getWebSockets()) { disown(ws); shut(ws, 1000, 'ended'); }
    this.st = null;
    this.meta = null;
    this.open = [];
    this.savedKey = null;
    this.desyncLogged = false;
    this.pending.clear();
    this.agreedDigests.clear();
    this.storedTick = -1;
    this.snapshotStoreReady = false;
    this.snapMismatches = 0;
    this.alarmAt = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
  /** R38: the watchdog. An eviction kills `setInterval`; a storage alarm
   *  survives it. While the match lives it re-arms itself -- here when the
   *  interval was still running, or through `ensureClock` when it was not,
   *  which arms as it starts the clock (one row either way, never two). A
   *  lobby, an ended room, one this very call expired, and an abandoned one
   *  (`wantsClock`) re-arm nothing and start no clock -- unless the abandoned
   *  room has a close armed (L-1): it closes here when the deadline has come,
   *  with no clock, and is woken at the deadline otherwise. */
  async alarm(): Promise<void> {
    this.alarmAt = null;   // the runtime consumed it
    try {
      const st = await this.begin();   // the TTL, too: an abandoned lobby ends here
      if (st === null) return;
      if (st.status === 'ended') {
        if (Date.now() >= alarmFor(st, Date.now())) await this.purge();
        return;
      }
      const closed = closeIfDue(st, Date.now());
      if (closed.length > 0) await this.apply(closed);
    } finally {
      this.ensureClock();
      // Re-armed here when the clock runs on (or no clock is wanted); a clock
      // that starts or stops was re-armed by `ensureClock` -- one row either way.
      if (this.alarmAt === null) this.armAlarm();
    }
  }
  private async onClock(): Promise<void> {
    try {
      const st = await this.load();
      if (st) {
        if (st.tick % 20 === 0) this.closeStaleSockets(Date.now());
        await this.apply(clockTick(st, Date.now()));
      }
    } finally {
      this.ensureClock();
    }
  }

  // --- HTTP -----------------------------------------------------------------

  async fetch(req: Request): Promise<Response> {
    try {
      return await this.route(req);
    } finally {
      this.ensureClock();
    }
  }

  private async route(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const st = await this.begin();
    if (pathname === '/create' && req.method === 'POST') {
      // The body is read BEFORE the check-and-set below, as /join's is: an await between
      // them let a second /create pass the same check and overwrite the first room.
      // `this.st`, not `st`: the local was read before the await.
      let body: Record<string, unknown> | null = null;
      try { const v: unknown = await req.json(); if (typeof v === 'object' && v !== null) body = v as Record<string, unknown>; } catch { /* refused below */ }
      if (this.st) return new Response('exists', { status: 409 });
      if (body === null || typeof body.code !== 'string' || typeof body.matchId !== 'string') {
        return new Response('bad body', { status: 400 });
      }
      // An empty build would switch the hello's build check off: refuse it here as the route does.
      const build = textField(body.build, '');
      if (build === '') return new Response('no build', { status: 400 });
      // The ticket's `player` is the anonymous id; a room without one cannot tell its seats apart.
      if (textField(body.player, '') === '') return new Response('no player', { status: 400 });
      const mode = body.mode === 'versus' ? 'versus' : 'sandbox';
      // A signed int32: validateConfig takes any integer, so the sign needs no care.
      // A versus room's seed is the relay's when it supplies one (N4b), never otherwise.
      const seed = mode !== 'versus' ? SIM_SEED_N0 : this.seedFor !== null ? this.seedFor(body.code) | 0 : crypto.getRandomValues(new Uint32Array(1))[0] | 0;
      const map = mapField(body.map);
      if (map === null) return new Response('unknown map', { status: 400 });
      // A versus room is offered only on the maps measured fair (#561, the lead, 2026-10-14):
      // refused here as the route refuses it, before any room state exists.
      if (mode === 'versus' && !versusMapAllowed(map)) return new Response('map not offered for versus', { status: 400 });
      // The host's matchup (2026-10-14): a versus room's only; a sandbox room is the mirror.
      // KDF vs Sarim plays only on FACTION_MATCHUP_MAPS (the lead's ruling): refused here as the route refuses it.
      const matchup = mode === 'versus' ? matchupField(body.matchup) : 'mirror';
      if (!matchupAllowed(matchup, map)) return new Response('matchup not offered on this map', { status: 400 });
      const factions = factionsOfMatchup(matchup);
      this.st = createRoom(body.code, body.matchId, Date.now(), map, factions);
      this.meta = { map, build, mode, seed, callsigns: [callsignField(body.callsign), ''], seat1Reserved: false, tokens: mintTokens(), kinds: [seatKindField(body.kind), 'human'], pace: paceField(body.pace),
        kit: mode === 'versus' ? kitField(body.kit) : 'matched', claims: [seatTiersField(body.tiers), seatTiersField(null)] };
      // The table, the keys and the TTL alarm exist from here, and only from here (#559 H-1).
      this.ctx.storage.sql.exec(CREATE_SQL);
      this.openSnapshotStore();
      await this.ctx.storage.put('meta', this.meta);
      await this.save();
      this.armAlarm();
      return Response.json({ ok: true });
    }
    if (pathname === '/ws' && !st) {
      // #559 H-1: no room (never made, or wiped after it ended). The socket is
      // told so and closed, touching no storage: a seat that missed the end
      // stops reconnecting instead of retrying every second for ever, and a
      // probe learns nothing a live room's 101 would not also show.
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      const ws = pair[1] as WebSocket & { accept(): void };
      ws.accept();
      reply(ws, { t: 'ended', reason: 'expired' });
      shut(ws, 1000, 'no room');
      return new Response(null, { status: 101, webSocket: pair[0] } as UpgradeInit);
    }
    if (!st) return new Response('no such room', { status: 404 });
    if (pathname === '/snapshot') {
      if (req.method === 'POST') return this.snapshotUpload(req);
      if (req.method === 'GET') return this.snapshotServe(req);
      return new Response('method', { status: 405 });
    }
    if (pathname === '/state') return Response.json({ status: st.status, seats: st.seats.filter((s) => s !== null).length });
    if (pathname === '/join' && req.method === 'POST') {
      // The body is read BEFORE the check-and-set below: an await between them lets a
      // second /join pass the same check (a non-storage await does not hold the input gate).
      let body: Record<string, unknown> = {};
      try { const v: unknown = await req.json(); if (typeof v === 'object' && v !== null) body = v as Record<string, unknown>; } catch { /* no body: the callsign defaults */ }
      if (st.status === 'ended') return new Response('ended', { status: 410 });
      const meta = this.meta ?? legacyMeta({}, st);
      if (st.seats[1] !== null || meta.seat1Reserved) return new Response('full', { status: 409 });
      this.meta = { ...meta, callsigns: [meta.callsigns[0], callsignField(body.callsign)], seat1Reserved: true, kinds: [meta.kinds[0], seatKindField(body.kind)], claims: [meta.claims[0], seatTiersField(body.tiers)] };
      await this.ctx.storage.put('meta', this.meta);
      return Response.json({ seat: 1 });
    }
    if (pathname === '/ws') {
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      this.acceptSocket(pair[1] as HibernatingSocket);
      return new Response(null, { status: 101, webSocket: pair[0] } as UpgradeInit);
    }
    return new Response('not found', { status: 404 });
  }

  // --- snapshots --------------------------------------------------------------

  /** Checks 2 and 3 of the snapshot contract: a `Bearer` ticket that verifies,
   *  names THIS match and is a seat's (an advisor ticket never passes). The room
   *  is read again after the HMAC await: a purge may have run in between. */
  private async snapshotSeat(req: Request): Promise<{ st: RoomState; seat: Seat } | Response> {
    const auth = req.headers.get('authorization');
    if (auth === null || !auth.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 });
    const secret = this.env.TICKET_SECRET;
    const ticket = secret ? await verifyTicket(secret, auth.slice('Bearer '.length), Date.now()) : null;
    const st = this.st;
    if (st === null) return new Response('no such room', { status: 404 });
    if (ticket === null || ticket.matchId !== st.matchId || ticket.role !== 'seat') return new Response('forbidden', { status: 403 });
    return { st, seat: ticket.seat };
  }
  /** Checks 4, 6 and 7 against the room as it is NOW (`this.st`, `storedTick`
   *  and the book), never a value read before an await (G-6): called before the
   *  body is read and again after the last await. With no `tick` only check 4 runs. */
  private snapshotRefusal(seat: Seat, tick: number | null): Response | null {
    const st = this.st;
    if (st === null) return new Response('no such room', { status: 404 });
    const every = st.config === null ? 0 : snapshotEvery(st.config);
    if ((st.status !== 'running' && st.status !== 'stalled') || every <= 0) return new Response('not_running', { status: 409 });
    if (tick === null) return null;
    if (admitTick(tick, { every, roomTick: st.tick, storedTick: this.storedTick }) !== 'ok') return new Response('stale', { status: 409 });
    if (this.pending.has(seat, tick)) return new Response('duplicate', { status: 409 });
    return null;
  }
  /** `POST /snapshot` (the contract's checks 1 to 13, cheap before costly). A
   *  refused, held or mismatched upload writes no row of this room's; only an
   *  accepted pair does (one row, `INSERT OR REPLACE`). */
  private async snapshotUpload(req: Request): Promise<Response> {
    const who = await this.snapshotSeat(req);
    if (who instanceof Response) return who;
    const { seat } = who;
    const early = this.snapshotRefusal(seat, null);
    if (early !== null) return early;
    const declaredTick = req.headers.get('x-snapshot-tick');
    if (declaredTick === null || !/^(0|[1-9][0-9]{0,9})$/.test(declaredTick)) return new Response('bad request', { status: 400 });
    const tick = Number(declaredTick);
    const stale = this.snapshotRefusal(seat, tick);
    if (stale !== null) return stale;
    const declared = req.headers.get('content-length');
    if (declared !== null && !(Number(declared) <= SNAPSHOT_MAX_COMPRESSED_BYTES)) return new Response('too_large', { status: 413 });
    const gz = await readCapped(req, SNAPSHOT_MAX_COMPRESSED_BYTES);
    if (gz === null) return new Response('too_large', { status: 413 });
    const raw = await gunzipCapped(gz, SNAPSHOT_MAX_RAW_BYTES);
    if (!raw.ok) return raw.reason === 'too_large' ? new Response('too_large', { status: 413 }) : new Response('bad_gzip', { status: 400 });
    const header = readSnapshotHeader(raw.bytes);
    if (header === null || header.format !== SNAPSHOT_FORMAT || header.frameTick !== tick) return new Response('bad snapshot', { status: 400 });
    const sha = await sha256Hex(raw.bytes);
    // Step 12: that was the last await that matters, so the checks a write depends on run again, against the
    // room as it is now, and the upload is recorded in the same synchronous step as the decision (G-6).
    const refused = this.snapshotRefusal(seat, tick);
    if (refused !== null) return refused;
    this.pending.put(seat, tick, { sha, digest: header.matchDigest, body: gz });
    const outcome = await this.settleSnapshot(tick);
    if (outcome === 'stored') return new Response('stored', { status: 201 });
    if (outcome === 'held') return new Response('held', { status: 202 });
    return new Response('mismatch', { status: 409 });
  }

  /** `GET /snapshot`: checks 1 to 3 (an advisor ticket is refused), then the one
   *  row. No row, or a lobby, is 204. Writes nothing and runs in any status while
   *  the room exists, an ended room before its wipe included. The bytes are the
   *  stored gzip as uploaded; the client inflates them itself. */
  private async snapshotServe(req: Request): Promise<Response> {
    const who = await this.snapshotSeat(req);
    if (who instanceof Response) return who;
    const [row] = this.ctx.storage.sql.exec(SNAP_GET_SQL).toArray();
    if (row === undefined) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    return new Response(row.bytes as ArrayBuffer, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        'x-snapshot-tick': String(row.frame_tick),
        'x-snapshot-sha': String(row.sha),
        // The agreed match digest as an unsigned decimal: the row holds the header's u32 (the fake and SQLite refuse a signed one).
        'x-snapshot-digest': String(row.digest),
      },
    });
  }

  /** The room's half of `/ws`: hand the server end to the Hibernation API,
   *  seatless until its hello. Public because a `WebSocketPair` and a 101
   *  `Response` exist only in workerd, so node tests enter here. */
  acceptSocket(ws: HibernatingSocket): void {
    const now = Date.now();
    this.closeStaleSockets(now);
    const live = this.ctx.getWebSockets().filter((s) => { const a = attachmentOf(s); return a !== null && (a.seat !== null || a.at !== undefined); }).length;
    this.ctx.acceptWebSocket(ws);
    if (live >= MAX_ROOM_SOCKETS) {
      ws.serializeAttachment({ seat: null } satisfies SocketAttachment);
      shut(ws, POLICY_CLOSE, 'too many sockets');
      return;
    }
    ws.serializeAttachment({ seat: null, at: now } satisfies SocketAttachment);
  }
  /** #559 M-1: every socket still without a seat `HELLO_TIMEOUT_MS` after it was accepted is closed. */
  private closeStaleSockets(now: number): void {
    for (const ws of this.ctx.getWebSockets()) {
      const a = attachmentOf(ws);
      if (a === null || a.seat !== null || a.at === undefined || now - a.at < HELLO_TIMEOUT_MS) continue;
      disown(ws);
      shut(ws, POLICY_CLOSE, 'no hello');
    }
  }
  /** Spends this message from the socket's budget (#559 M-1); false when it is empty. */
  private spend(ws: WebSocket, msg: ClientMsg | null, st: RoomState, now: number): boolean {
    let m = this.meters.get(ws);
    if (m === undefined) { m = { tokens: SOCKET_BUDGET.burst, atMs: now, ack: -1, hash: -1 }; this.meters.set(ws, m); }
    if (msg !== null && (msg.t === 'ack' || msg.t === 'hash') && msg.tick < st.tick && msg.tick > m[msg.t]) {
      m[msg.t] = msg.tick;
      return true;
    }
    m.tokens = Math.min(SOCKET_BUDGET.burst, m.tokens + ((now - m.atMs) * SOCKET_BUDGET.perSecond) / 1000);
    m.atMs = now;
    if (m.tokens < 1) return false;
    m.tokens -= 1;
    return true;
  }

  // --- sockets --------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const st = await this.begin();
      if (!st) { reply(ws, { t: 'ended', reason: 'expired' }); shut(ws, 4004, 'no room'); return; }
      const msg = parseClientMsg(typeof message === 'string' ? message : new TextDecoder().decode(message));
      const now = Date.now();
      this.closeStaleSockets(now);
      if (!this.spend(ws, msg, st, now)) {
        // Read before `disown`: the close that follows finds the socket seatless and cannot clear the badge.
        const advising = advisorOf(ws);
        disown(ws);
        shut(ws, POLICY_CLOSE, 'rate');
        if (advising !== null) this.send('all', this.advisorsPresent());
        return;
      }
      const seat = seatOf(ws);
      const advisor = advisorOf(ws);
      if (msg === null) {
        reply(ws, { t: 'error', code: 'bad_message' });
        // A socket with no seat has nothing to lose by a bad first message but its socket (#559 M-1).
        if (seat === null && advisor === null) { disown(ws); shut(ws, POLICY_CLOSE, 'bad message'); }
        return;
      }
      if (advisor !== null) { this.advisorMessage(ws, advisor, msg, now); return; }
      if (seat === null) { await this.hello(ws, st, msg); return; }
      const effects = seatMessage(st, seat, msg, Date.now(), () => this.mintConfig(st));
      // The human's half of its pair: to its own advisor, never the other seat; nothing stored.
      if (msg.t === 'advisor') {
        for (const ws2 of this.advisorsFor(seat)) {
          const scope = advisorOf(ws2)?.scope;
          if (scope !== undefined && advisorMayRelay('human', scope, msg.a)) reply(ws2, { t: 'advisor', from: 'human', a: msg.a });
        }
      }
      await this.apply(effects);
    } finally {
      this.ensureClock();
    }
  }

  /** An advisor socket's message (N4a), after its budget was spent: only
   *  `advisor` is acted on, relayed to the seat it advises when its scope
   *  allows, at most one per `ADVISOR_MIN_GAP_MS`. Every other kind is ignored:
   *  an advisor never orders, readies, pauses, ends or reports anything. The
   *  room's state is not touched, so this writes no row. */
  private advisorMessage(ws: WebSocket, advisor: { seat: Seat; scope: AdvisorScope }, msg: ClientMsg, now: number): void {
    if (msg.t !== 'advisor' || !advisorMayRelay('advisor', advisor.scope, msg.a)) return;
    const lastMs = this.advisorRelayedAt.get(ws);
    if (lastMs !== undefined && now - lastMs < ADVISOR_MIN_GAP_MS) return;
    this.advisorRelayedAt.set(ws, now);
    for (const seatWs of this.socketsFor(advisor.seat)) reply(seatWs, { t: 'advisor', from: 'advisor', a: msg.a });
  }

  private async hello(ws: WebSocket, st: RoomState, msg: ClientMsg): Promise<void> {
    if (st.status === 'ended') {
      // A seat of this match coming back to an ending that names a result (a
      // surrender, a leave, a forfeit, the room's own close) is given the log
      // first, so it can run the match to the room's last tick -- the one the
      // other seat ended on -- and show the same result. Only to a verified
      // ticket on this build; anyone else hears the ending alone, as before.
      if (st.config !== null && (await this.mayReplay(st, msg))) {
        const from = msg.t === 'hello' ? msg.from : undefined;
        for (const part of logParts(st.config, this.readLogFrom(from), LOG_PART_CHARS, from)) reply(ws, part);
      }
      reply(ws, endedMsg(st));
      shut(ws, 1000, 'ended');
      return;
    }
    if (msg.t !== 'hello') { reply(ws, { t: 'error', code: 'bad_ticket' }); shut(ws, 4001, 'hello first'); return; }
    const secret = this.env.TICKET_SECRET;
    const ticket = secret ? await verifyTicket(secret, msg.ticket, Date.now()) : null;
    if (!ticket || ticket.matchId !== st.matchId) { reply(ws, { t: 'error', code: 'bad_ticket' }); shut(ws, 4001, 'bad ticket'); return; }
    // /create refuses an empty build, so `''` here means meta was never written: fail closed.
    const build = this.meta?.build ?? '';
    if (build === '' || msg.build !== build) { reply(ws, { t: 'error', code: 'build_mismatch' }); shut(ws, 4002, 'build'); return; }
    if (ticket.role === 'advisor' && ticket.scope !== undefined) { this.advisorHello(ws, st, ticket.seat, ticket.scope, msg.from); return; }
    if (ticket.role !== 'seat') { reply(ws, { t: 'error', code: 'bad_ticket' }); shut(ws, 4001, 'bad ticket'); return; }
    (ws as HibernatingSocket).serializeAttachment({ seat: ticket.seat } satisfies SocketAttachment);
    await this.apply(seatJoin(st, ticket.seat, ticket.player, this.meta?.callsigns[ticket.seat] ?? '', Date.now(), () => this.readLogFrom(msg.from), msg.from), ws);
    // A seat that (re)joins is told the advisor badges it would otherwise have missed.
    const present = this.advisorsPresent();
    if (present.present.some((p) => p !== null)) reply(ws, present);
  }

  /** An advisor's hello (N4a, decision D1): one per seat, so an earlier one
   *  for the same seat is retired; it is told the lobby, or the log and a pause
   *  in force, as its seat would be; and everyone learns the badge. It never
   *  joins the seat: no `seatJoin`, no state change, no row. */
  private advisorHello(ws: WebSocket, st: RoomState, seat: Seat, scope: AdvisorScope, from?: number): void {
    for (const old of this.advisorsFor(seat)) if (old !== ws) retire(old);
    (ws as HibernatingSocket).serializeAttachment({ seat, role: 'advisor', scope } satisfies SocketAttachment);
    if (st.status === 'lobby') reply(ws, this.lobbyFor(lobbyMsg(st, seat) as Extract<ServerMsg, { t: 'lobby' }>, seat));
    else if (st.config !== null) {
      for (const part of logParts(st.config, this.readLogFrom(from), LOG_PART_CHARS, from)) reply(ws, part);
      if (st.pause !== null) reply(ws, pausedMsg(st, Date.now(), st.pause));
    }
    this.send('all', this.advisorsPresent());
  }

  /** Whether a hello to an ENDED room may have the log: the ending names a
   *  result the clients drain to (`WsTransport`), and the hello is a seat of
   *  this match on its build. Reads storage only for such a hello. */
  private async mayReplay(st: RoomState, msg: ClientMsg): Promise<boolean> {
    const r = st.endedReason;
    if (msg.t !== 'hello' || (r !== 'left' && r !== 'surrender' && r !== 'forfeit' && r !== 'over')) return false;
    const secret = this.env.TICKET_SECRET;
    const ticket = secret ? await verifyTicket(secret, msg.ticket, Date.now()) : null;
    const build = this.meta?.build ?? '';
    return ticket !== null && ticket.role === 'seat' && ticket.matchId === st.matchId && build !== '' && msg.build === build;
  }

  /** Close and error both land here, and the runtime may deliver BOTH for one
   *  socket (R30). The socket gives up its seat first, so the second delivery
   *  finds it seatless and cannot mark a replacement's live seat gone; a
   *  replaced socket was `retire`d the same way before it was closed. */
  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      // The reciprocal close, as Cloudflare's hibernation example does: whether
      // this compat date answers a client's close frame by itself is unconfirmed
      // (N0 final review M2). Code 1000, never the one received: 1005 and 1006
      // may not be sent. `shut` swallows the throw from a socket already closed.
      shut(ws, 1000, 'closed');
      const seat = seatOf(ws);
      const advisor = advisorOf(ws);
      disown(ws);
      const st = await this.begin();
      if (!st) return;
      // An advisor going is only a badge going: no seat is gone, nothing stalls, nothing is written.
      if (advisor !== null) { this.send('all', this.advisorsPresent()); return; }
      if (seat === null) return;
      await this.apply(seatGone(st, seat, Date.now()));
    } finally {
      this.ensureClock();
    }
  }
  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws); }
}
