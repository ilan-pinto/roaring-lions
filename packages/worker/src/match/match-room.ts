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
 * interval starts, re-arms itself only while the match is running or stalled
 * with a seat still connected (`wantsClock`), and is deleted when the clock
 * stops or the match ends; a lobby never arms one, and an alarm that reaches
 * an ended, expired or abandoned room (both seats gone, no bye) neither
 * re-arms nor starts the clock, so an abandoned room cannot keep a Free-tier
 * object awake. Every `WATCHDOG_MS` = 5 s, not 1 s,
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
 * the room runs no clock, keeps no alarm and writes no row.
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
import { parseClientMsg, validateConfig, REPLACED_CLOSE_CODE, type ClientMsg, type Frame, type MatchConfig, type Seat, type SeatConfig, type ServerMsg } from '@lions/net';
import type { Env } from '../d1';
import type { DurableStateLike, HibernatingSocket, UpgradeInit } from '../do-types';
import { createRoom, endedMsg, seatJoin, seatMessage, seatGone, clockTick, closeIfDue, expire, persistKey, revive, type Effect, type RoomState } from './room-core';
import { verifyTicket } from './ticket';
import { DEFAULT_MAP, callsignField, textField } from './room-fields';
import { compactLog, writeDesync } from './desync-log';

export const TICK_MS = 50;
/** A sandbox room's seed: the app's SIM_SEED, so the two-machine protocol stays N0's. A versus room mints its own. */
const SIM_SEED_N0 = 20260727;
/** Frames per persisted row: one row a second at the 20 Hz tick. */
export const BATCH_TICKS = 20;
/** R38: the watchdog alarm's period. 5 s, not 1 s: each `setAlarm` is a row written (R-N12). */
export const WATCHDOG_MS = 5000;
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
  };
}
interface SocketAttachment { seat: Seat | null }
/** The command JSON a log holds, as `clockTick` counts it (#559 H-1). */
const cmdCharsOf = (frames: Frame[]): number => frames.reduce((n, f) => n + f.cmds.reduce((m, c) => m + JSON.stringify(c.cmd).length, 0), 0);

function seatOf(ws: WebSocket): Seat | null {
  const a = (ws as HibernatingSocket).deserializeAttachment() as SocketAttachment | null;
  return a === null ? null : a.seat;
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

/** When the alarm should next wake the room, or null for none. While the
 *  clock runs it is the watchdog, `WATCHDOG_MS` on -- but never later than the
 *  room's armed close (L-1), so the last wake lands ON the deadline rather
 *  than up to 5 s past it, at no extra row. With no clock (both seats gone)
 *  only an armed close wakes the room, once, at its deadline; a lobby, an
 *  ended room and an abandoned one with no close armed keep no alarm (R38). */
function alarmFor(st: RoomState, nowMs: number): number | null {
  if (st.status !== 'running' && st.status !== 'stalled') return null;
  if (!wantsClock(st)) return st.closeAtMs;
  const watchdog = nowMs + WATCHDOG_MS;
  return st.closeAtMs === null ? watchdog : Math.min(watchdog, st.closeAtMs);
}

export class MatchRoom {
  private st: RoomState | null = null;
  private meta: RoomMeta | null = null;
  private loading: Promise<RoomState | null> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  /** The batch not yet closed: memory only, until it closes or the state is written. */
  private open: Frame[] = [];
  /** Set when this instance deleted the alarm, so an ended room deletes it once, not per handler. */
  private disarmed = false;
  /** `persistKey` of the state as last written (or loaded). */
  private savedKey: string | null = null;
  /** Set once this instance has logged a desync: the match is void after the first, so one write is the bound. */
  private desyncLogged = false;

  constructor(private readonly ctx: DurableStateLike, private readonly env: Env) {
    this.ctx.storage.sql.exec(CREATE_SQL);
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
        const [lastRow] = this.batches(LAST_SQL);
        revive(st, lastRow ? lastRow.firstTick + lastRow.frames.length : 0, Date.now());
        // The stored command count dates from the last lifecycle write; the log is the truth (#559 H-1).
        if (st.status !== 'ended' && st.status !== 'lobby') st.cmdChars = Math.max(st.cmdChars, cmdCharsOf(this.batches().flatMap((b) => b.frames)));
        // A room persisted before the lobby carried its map has none: the meta has it.
        if (st.map === '') st.map = this.meta?.map ?? DEFAULT_MAP;
        this.savedKey = persistKey(st);
        gone = this.reconcileSockets(st);
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
  private batches(query = SELECT_SQL): { firstTick: number; frames: Frame[] }[] {
    return this.ctx.storage.sql.exec(query).toArray()
      .map((r) => ({ firstTick: r.first_tick as number, frames: JSON.parse(r.frames as string) as Frame[] }));
  }
  /** Every frame so far: the persisted batches, then the open one (whose
   *  partial row, if a state write flushed one, the memory copy supersedes). */
  private readLog(): Frame[] {
    const openFirst = this.open[0]?.tick;
    return [...this.batches().filter((b) => b.firstTick !== openFirst).flatMap((b) => b.frames), ...this.open];
  }
  /** Every handler starts here: load, then the TTL (R28). */
  private async begin(): Promise<RoomState | null> {
    const st = await this.load();
    if (st) {
      const fx = expire(st, Date.now());
      if (fx.length > 0) await this.apply(fx);
    }
    return st;
  }

  // --- effects --------------------------------------------------------------

  private mintConfig(st: RoomState): MatchConfig {
    // The seat's real id (`RoomSeat.player`) stays in the room; the config carries a per-match token.
    const tokens = this.meta?.tokens ?? mintTokens();
    const mode = this.meta?.mode ?? 'sandbox';
    const seatConfig = (seat: Seat): SeatConfig => {
      const s = st.seats[seat];
      return { seat, side: mode === 'versus' ? seat : 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: tokens[seat], callsign: this.meta?.callsigns[seat] ?? s?.callsign ?? '', kind: 'human' };
    };
    const config = validateConfig({
      matchId: st.matchId, code: st.code, seed: this.meta?.seed ?? SIM_SEED_N0, map: this.meta?.map ?? DEFAULT_MAP, mode,
      seats: [seatConfig(0), seatConfig(1)],
      pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: this.meta?.build ?? '', dataDigest: 0,
    });
    if (config === null) throw new Error('MatchRoom minted a config its own validator refuses');
    return config;
  }
  private socketsFor(seat: Seat): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => seatOf(ws) === seat);
  }
  private send(to: Seat | 'all', msg: ServerMsg): void {
    const seats: Seat[] = to === 'all' ? [0, 1] : [to];
    for (const seat of seats) {
      const text = JSON.stringify(msg.t === 'lobby' ? { ...msg, you: seat } : msg);
      for (const ws of this.socketsFor(seat)) { try { ws.send(text); } catch { /* closing */ } }
    }
  }
  /** `keep` is the socket whose hello produced these effects: a `close` for
   *  its seat closes every OTHER socket on that seat. The state is written
   *  only if its lifecycle changed. */
  private async apply(effects: Effect[], keep?: WebSocket): Promise<void> {
    let desync: Extract<ServerMsg, { t: 'desync' }> | null = null;
    for (const e of effects) {
      if (e.kind === 'frame') this.record(e.frame);
      else if (e.kind === 'send') {
        this.send(e.to, e.msg);
        if (e.msg.t === 'desync') desync = e.msg;
      } else if (e.kind === 'shut') {
        // The room is over (L-1): each socket gives up its seat, so its close
        // (from either end) finds no seat to mark gone and writes nothing.
        for (const ws of this.socketsFor(e.seat)) { disown(ws); shut(ws, 1000, 'ended'); }
      } else for (const ws of this.socketsFor(e.seat)) if (ws !== keep) retire(ws);
    }
    await this.saveIfChanged();
    // After the sends and the state write, so a slow or failing D1 delays nothing a player sees.
    if (desync !== null) await this.logDesync(desync.tick, desync.hashes);
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
      await writeDesync(this.env.DB, {
        code: st.code, tick, hashA: hashes[0], hashB: hashes[1],
        config: JSON.stringify(st.config), frames: JSON.stringify(compactLog(frames)), frameCount: frames.length, createdAt: Date.now(),
      });
    } catch (e) {
      console.error('MatchRoom: desync log failed', e);
    }
  }
  private ensureClock(): void {
    const st = this.st;
    const live = st !== null && wantsClock(st);
    if (live && this.clock === null) {
      this.clock = setInterval(() => { void this.onClock(); }, TICK_MS);
      this.armWatchdog();
    } else if (!live && this.clock !== null) {
      clearInterval(this.clock);
      this.clock = null;
      // Deleted -- or, with a close armed and both seats gone, aimed at the deadline (L-1).
      this.armWatchdog();
    } else if (!live && st?.status === 'ended' && !this.disarmed) {
      // An instance revived after the clock's own instance died ends the match
      // with no clock of its own to stop: the alarm the old one armed goes too.
      this.disarmWatchdog();
    }
  }
  /** Unawaited, as the clock's start and stop are synchronous; a refusal
   *  (storage over quota, say) must not become an unhandled rejection. The
   *  cost of a lost arm is only R38's protection, until the next start. */
  private armWatchdog(): void {
    const at = this.st === null ? null : alarmFor(this.st, Date.now());
    if (at === null) { this.disarmWatchdog(); return; }
    this.disarmed = false;
    this.ctx.storage.setAlarm(at).catch((e: unknown) => { console.error('MatchRoom: setAlarm failed', e); });
  }
  private disarmWatchdog(): void {
    this.disarmed = true;
    this.ctx.storage.deleteAlarm().catch((e: unknown) => { console.error('MatchRoom: deleteAlarm failed', e); });
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
    try {
      const st = await this.begin();
      if (st) {
        const closed = closeIfDue(st, Date.now());
        if (closed.length > 0) {
          await this.apply(closed);
        } else {
          // Re-armed here when the clock runs on, or when no clock is wanted (an
          // abandoned room's deadline); a clock that must start or stop is armed
          // or re-aimed by `ensureClock` instead -- one row either way, never two.
          const at = alarmFor(st, Date.now());
          if (at !== null && (this.clock !== null) === wantsClock(st)) await this.ctx.storage.setAlarm(at);
        }
      }
    } finally {
      this.ensureClock();
    }
  }
  private async onClock(): Promise<void> {
    try {
      const st = await this.load();
      if (st) await this.apply(clockTick(st, Date.now()));
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
      const seed = mode === 'versus' ? crypto.getRandomValues(new Uint32Array(1))[0] | 0 : SIM_SEED_N0;
      const map = textField(body.map, DEFAULT_MAP);
      this.st = createRoom(body.code, body.matchId, Date.now(), map);
      this.meta = { map, build, mode, seed, callsigns: [callsignField(body.callsign), ''], seat1Reserved: false, tokens: mintTokens() };
      await this.ctx.storage.put('meta', this.meta);
      await this.save();
      return Response.json({ ok: true });
    }
    if (!st) return new Response('no such room', { status: 404 });
    if (pathname === '/state') return Response.json({ status: st.status, seats: st.seats.filter((s) => s !== null).length });
    if (pathname === '/join' && req.method === 'POST') {
      // The body is read BEFORE the check-and-set below: an await between them lets a
      // second /join pass the same check (a non-storage await does not hold the input gate).
      let body: Record<string, unknown> = {};
      try { const v: unknown = await req.json(); if (typeof v === 'object' && v !== null) body = v as Record<string, unknown>; } catch { /* no body: the callsign defaults */ }
      if (st.status === 'ended') return new Response('ended', { status: 410 });
      const meta = this.meta ?? legacyMeta({}, st);
      if (st.seats[1] !== null || meta.seat1Reserved) return new Response('full', { status: 409 });
      this.meta = { ...meta, callsigns: [meta.callsigns[0], callsignField(body.callsign)], seat1Reserved: true };
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

  /** The room's half of `/ws`: hand the server end to the Hibernation API,
   *  seatless until its hello. Public because a `WebSocketPair` and a 101
   *  `Response` exist only in workerd, so node tests enter here. */
  acceptSocket(ws: HibernatingSocket): void {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ seat: null } satisfies SocketAttachment);
  }

  // --- sockets --------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const st = await this.begin();
      if (!st) { shut(ws, 4004, 'no room'); return; }
      const msg = parseClientMsg(typeof message === 'string' ? message : new TextDecoder().decode(message));
      if (msg === null) { reply(ws, { t: 'error', code: 'bad_message' }); return; }
      const seat = seatOf(ws);
      if (seat === null) { await this.hello(ws, st, msg); return; }
      await this.apply(seatMessage(st, seat, msg, Date.now(), () => this.mintConfig(st)));
    } finally {
      this.ensureClock();
    }
  }

  private async hello(ws: WebSocket, st: RoomState, msg: ClientMsg): Promise<void> {
    if (st.status === 'ended') {
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
    (ws as HibernatingSocket).serializeAttachment({ seat: ticket.seat } satisfies SocketAttachment);
    await this.apply(seatJoin(st, ticket.seat, ticket.player, this.meta?.callsigns[ticket.seat] ?? '', Date.now(), () => this.readLog()), ws);
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
      disown(ws);
      const st = await this.begin();
      if (!st || seat === null) return;
      await this.apply(seatGone(st, seat, Date.now()));
    } finally {
      this.ensureClock();
    }
  }
  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws); }
}
