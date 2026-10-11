/**
 * One match (spec §3.2). A thin shell over `room-core.ts`: sockets in, effects
 * out, state in this object's storage. The WebSocket Hibernation API holds
 * the sockets, and a socket's seat lives in its ATTACHMENT (tags are fixed at
 * `acceptWebSocket`, before the hello says which seat it is). A 50 ms
 * `setInterval` is the metronome while the match lives, restarted by
 * `ensureClock()` from every handler so an eviction never strands a running
 * match (Review Focus 5). N0 has no alarms: the six-hour TTL is checked at the
 * start of every handler as well as on the clock.
 */
import { parseClientMsg, validateConfig, type ClientMsg, type Frame, type MatchConfig, type Seat, type SeatConfig, type ServerMsg } from '@lions/net';
import type { Env } from '../d1';
import type { DurableStateLike, HibernatingSocket, UpgradeInit } from '../do-types';
import { createRoom, seatJoin, seatMessage, seatGone, clockTick, expire, type Effect, type RoomState } from './room-core';
import { verifyTicket } from './ticket';

export const TICK_MS = 50;
const SIM_SEED_N0 = 20260727;   // the app's SIM_SEED; N1 mints one per match
const DEFAULT_MAP = 'beit_sahwan_outskirts';
const CREATE_SQL = 'CREATE TABLE IF NOT EXISTS frame (tick INTEGER PRIMARY KEY, cmds TEXT NOT NULL)';
const INSERT_SQL = 'INSERT OR REPLACE INTO frame (tick, cmds) VALUES (?, ?)';
const SELECT_SQL = 'SELECT tick, cmds FROM frame ORDER BY tick';

/** What `/create` fixed and `/join` reserved; stored beside the room state. */
interface RoomMeta {
  map: string;
  build: string;
  /** Set by the first `/join`, so a second one is refused before the guest's hello (R5). */
  seat1Reserved: boolean;
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
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

export class MatchRoom {
  private st: RoomState | null = null;
  private meta: RoomMeta | null = null;
  private loading: Promise<RoomState | null> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ctx: DurableStateLike, private readonly env: Env) {
    this.ctx.storage.sql.exec(CREATE_SQL);
  }

  // --- storage --------------------------------------------------------------

  /** Once per instance; memoised so two handlers racing a cold start cannot
   *  each read their own copy and lose the other's writes. */
  private load(): Promise<RoomState | null> {
    if (this.st) return Promise.resolve(this.st);
    this.loading ??= (async () => {
      this.meta = (await this.ctx.storage.get<RoomMeta>('meta')) ?? null;
      this.st = (await this.ctx.storage.get<RoomState>('state')) ?? null;
      this.loading = null;
      return this.st;
    })();
    return this.loading;
  }
  private async save(): Promise<void> {
    if (this.st) await this.ctx.storage.put('state', this.st);
  }
  private readLog(): Frame[] {
    return this.ctx.storage.sql.exec(SELECT_SQL).toArray()
      .map((r) => ({ tick: r.tick as number, cmds: JSON.parse(r.cmds as string) as Frame['cmds'] }));
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
    const seatConfig = (seat: Seat): SeatConfig => {
      const s = st.seats[seat];
      return { seat, side: 0, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: s?.player ?? '', callsign: s?.callsign ?? '', kind: 'human' };
    };
    const config = validateConfig({
      matchId: st.matchId, code: st.code, seed: SIM_SEED_N0, map: this.meta?.map ?? DEFAULT_MAP, mode: 'sandbox',
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
   *  its seat closes every OTHER socket on that seat. A frame reaches SQLite
   *  before it reaches a socket. */
  private async apply(effects: Effect[], keep?: WebSocket): Promise<void> {
    for (const e of effects) {
      if (e.kind === 'frame') this.ctx.storage.sql.exec(INSERT_SQL, e.frame.tick, JSON.stringify(e.frame.cmds));
      else if (e.kind === 'send') this.send(e.to, e.msg);
      else for (const ws of this.socketsFor(e.seat)) if (ws !== keep) shut(ws, 4000, 'replaced');
    }
    await this.save();
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
      this.st = createRoom(body.code, body.matchId, Date.now());
      this.meta = { map: str(body.map, DEFAULT_MAP), build: str(body.build, ''), seat1Reserved: false };
      await this.ctx.storage.put('meta', this.meta);
      await this.save();
      return Response.json({ ok: true });
    }
    if (!st) return new Response('no such room', { status: 404 });
    if (pathname === '/state') return Response.json({ status: st.status, seats: st.seats.filter((s) => s !== null).length });
    if (pathname === '/join' && req.method === 'POST') {
      if (st.status === 'ended') return new Response('ended', { status: 410 });
      const meta = this.meta ?? { map: DEFAULT_MAP, build: '', seat1Reserved: false };
      if (st.seats[1] !== null || meta.seat1Reserved) return new Response('full', { status: 409 });
      this.meta = { ...meta, seat1Reserved: true };
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
    const build = this.meta?.build ?? '';
    if (build !== '' && msg.build !== build) { reply(ws, { t: 'error', code: 'build_mismatch' }); shut(ws, 4002, 'build'); return; }
    (ws as HibernatingSocket).serializeAttachment({ seat: ticket.seat } satisfies SocketAttachment);
    // N0's ticket `player` carries the callsign the client sent; N1 splits them.
    await this.apply(seatJoin(st, ticket.seat, ticket.player, ticket.player, Date.now(), () => this.readLog()), ws);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      const st = await this.begin();
      const seat = seatOf(ws);
      if (!st || seat === null) return;
      if (this.socketsFor(seat).some((s) => s !== ws)) return;   // a replacement is live
      await this.apply(seatGone(st, seat, Date.now()));
    } finally {
      this.ensureClock();
    }
  }
  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws); }
}
