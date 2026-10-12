/**
 * One match (spec §3.2). A thin shell over `room-core.ts`: sockets in, effects
 * out, state in this object's storage. The WebSocket Hibernation API holds
 * the sockets, and a socket's seat lives in its ATTACHMENT (tags are fixed at
 * `acceptWebSocket`, before the hello says which seat it is). A 50 ms
 * `setInterval` is the metronome while the match lives, restarted by
 * `ensureClock()` from every handler so an eviction never strands a running
 * match (Review Focus 5). N0 has no alarms: the six-hour TTL is checked at the
 * start of every handler as well as on the clock.
 *
 * Storage is budgeted for Workers Free (task 8b, R34): a running match writes
 * about one row a second. Frames persist as one `batch` row per
 * `BATCH_TICKS` ticks, written when the batch closes; the open batch lives in
 * memory and `log` answers from both. The room state is written only when
 * its lifecycle changes (`persistKey`: create, seats joining, going, readying,
 * start, end), never per tick, ack, command, hash or behind/silent stall
 * (R37) -- and
 * every such write first flushes the open batch, so the persisted frames
 * always reach the persisted state's tick.
 *
 * What an eviction costs, and why it is safe: a revived room continues at
 * `max(state.tick, end of the last persisted batch)` (`revive`). The frames
 * after that point were sent but never persisted, so the room sends those
 * ticks again; both clients already hold the originals and drop the copies as
 * duplicates (`LockstepClock`), so any command the revived room stamps into
 * them is lost on BOTH clients alike and nobody desyncs. Pending commands,
 * acks, half hash pairs and the open batch were memory only; acks and hashes
 * are re-earned. One residue: for those re-sent ticks the log now holds the
 * revived room's copies, so ANY client that takes those ticks from `log`
 * runs them instead of the originals -- a seat that rejoins from a reload,
 * or one whose socket died just before the eviction and reconnects behind
 * them. That diverges only if either copy carried a command, and then the
 * next hash comparison voids the match loudly (`desync`); it is never silent.
 * A seat going ('gone' persists through `connected`) flushes the open batch
 * with its write, so an eviction while waiting for a reconnect re-sends
 * nothing. (Before 8b every frame reached SQLite before any socket.)
 */
import { parseClientMsg, validateConfig, REPLACED_CLOSE_CODE, type ClientMsg, type Frame, type MatchConfig, type Seat, type SeatConfig, type ServerMsg } from '@lions/net';
import type { Env } from '../d1';
import type { DurableStateLike, HibernatingSocket, UpgradeInit } from '../do-types';
import { createRoom, seatJoin, seatMessage, seatGone, clockTick, expire, persistKey, revive, type Effect, type RoomState } from './room-core';
import { verifyTicket } from './ticket';
import { DEFAULT_MAP, callsignField, textField } from './room-fields';

export const TICK_MS = 50;
/** A sandbox room's seed: the app's SIM_SEED, so the two-machine protocol stays N0's. A versus room mints its own. */
const SIM_SEED_N0 = 20260727;
/** Frames per persisted row: one row a second at the 20 Hz tick. */
export const BATCH_TICKS = 20;
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
}
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
  };
}
interface SocketAttachment { seat: Seat | null }

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

export class MatchRoom {
  private st: RoomState | null = null;
  private meta: RoomMeta | null = null;
  private loading: Promise<RoomState | null> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  /** The batch not yet closed: memory only, until it closes or the state is written. */
  private open: Frame[] = [];
  /** `persistKey` of the state as last written (or loaded). */
  private savedKey: string | null = null;

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
      if (st) {
        const [lastRow] = this.batches(LAST_SQL);
        revive(st, lastRow ? lastRow.firstTick + lastRow.frames.length : 0, Date.now());
        this.savedKey = persistKey(st);
      }
      this.st = st;
      this.loading = null;
      return this.st;
    })();
    return this.loading;
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
  private record(frame: Frame): void {
    this.open.push(frame);
    if (this.open.length < BATCH_TICKS) return;
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
    const mode = this.meta?.mode ?? 'sandbox';
    const seatConfig = (seat: Seat): SeatConfig => {
      const s = st.seats[seat];
      return { seat, side: mode === 'versus' ? seat : 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: s?.player ?? '', callsign: this.meta?.callsigns[seat] ?? s?.callsign ?? '', kind: 'human' };
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
    for (const e of effects) {
      if (e.kind === 'frame') this.record(e.frame);
      else if (e.kind === 'send') this.send(e.to, e.msg);
      else for (const ws of this.socketsFor(e.seat)) if (ws !== keep) retire(ws);
    }
    await this.saveIfChanged();
  }
  private ensureClock(): void {
    const st = this.st;
    const live = st !== null && (st.status === 'running' || st.status === 'stalled');
    if (live && this.clock === null) {
      this.clock = setInterval(() => { void this.onClock(); }, TICK_MS);
    } else if (!live && this.clock !== null) {
      clearInterval(this.clock);
      this.clock = null;
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
      if (st) return new Response('exists', { status: 409 });
      let body: Record<string, unknown>;
      try { body = (await req.json()) as Record<string, unknown>; } catch { return new Response('bad body', { status: 400 }); }
      if (typeof body !== 'object' || body === null || typeof body.code !== 'string' || typeof body.matchId !== 'string') {
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
      this.st = createRoom(body.code, body.matchId, Date.now());
      this.meta = { map: textField(body.map, DEFAULT_MAP), build, mode, seed, callsigns: [callsignField(body.callsign), ''], seat1Reserved: false };
      await this.ctx.storage.put('meta', this.meta);
      await this.save();
      return Response.json({ ok: true });
    }
    if (!st) return new Response('no such room', { status: 404 });
    if (pathname === '/state') return Response.json({ status: st.status, seats: st.seats.filter((s) => s !== null).length });
    if (pathname === '/join' && req.method === 'POST') {
      if (st.status === 'ended') return new Response('ended', { status: 410 });
      const meta = this.meta ?? legacyMeta({}, st);
      if (st.seats[1] !== null || meta.seat1Reserved) return new Response('full', { status: 409 });
      let body: Record<string, unknown> = {};
      try { const v: unknown = await req.json(); if (typeof v === 'object' && v !== null) body = v as Record<string, unknown>; } catch { /* no body: the callsign defaults */ }
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
      reply(ws, { t: 'ended', reason: st.endedReason ?? 'expired' });
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
