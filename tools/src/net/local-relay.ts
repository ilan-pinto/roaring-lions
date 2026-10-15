/**
 * The local relay (N4b task 11): the REAL Worker routes (`handleMatch`) and
 * the REAL `MatchRoom`, hosted in this Node process on 127.0.0.1, so the arena
 * and a spawned `pnpm agent` can play with no Durable Object, no D1, no billed
 * row and no network beyond loopback.
 *
 * - HTTP: `POST /api/match*` becomes a `Request` handed to `handleMatch`, with
 *   the `Origin` header passed through: the Worker's own Origin rule is the
 *   relay's, unchanged. There are no rate limiters and no `DB`.
 * - Rooms: `env.ROOMS` maps each code to one `MatchRoom` over the fake Durable
 *   Object state (`fake-do.ts`), built with this relay's `tickMs` and seed.
 * - Sockets: the `/ws` upgrade goes through `handleMatch` first (Origin, code,
 *   method). The room's own `/ws` makes a `WebSocketPair`, which only workerd
 *   has, so the namespace's stub answers it with a marker and the relay hands
 *   the accepted `ws` socket to `room.acceptSocket` -- the half of `/ws` that
 *   runs under node, exactly as the specs enter it.
 * - The alarm: nothing in node fires a Durable Object alarm, so the relay
 *   checks every room's scheduled alarm every `ALARM_POLL_MS` and delivers the
 *   ones due (the TTL, a forfeit, the result's close, the wipe).
 * - The input gate: a Durable Object runs one event at a time. Every event for
 *   a room -- a message or a close from any of its sockets, and its alarm --
 *   goes through ONE promise chain per room, in arrival order, so a handler
 *   that awaits is never overlapped by another event of the same room. (Until
 *   the N4b minors the chain was per socket: two sockets' messages and the
 *   alarm could interleave across awaits, which workerd would not allow.)
 *
 * The ticket secret is minted in memory at start (`randomBytes(32)`) and is
 * never logged and never written: a ticket from one relay is worthless to the
 * next. The server binds 127.0.0.1 only, on a port the OS chooses.
 *
 * Decision D2: this is the one non-test tool that imports `packages/worker`;
 * a spec pins that no shipped package (app, render, net, sim) ever does.
 */
import { createServer, STATUS_CODES, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { DurableObjectNamespaceLike, Env } from '../../../packages/worker/src/d1';
import { handleMatch } from '../../../packages/worker/src/match/routes';
import { MatchRoom } from '../../../packages/worker/src/match/match-room';
import { FakeSocket, FakeState, deliverAlarm, deliverClose } from '../../../packages/worker/src/match/fake-do';

export interface LocalRelay {
  /** `http://127.0.0.1:<port>`: what `pnpm agent --server` and `AgentClient` take. */
  url: string;
  /** The relay's own origin, the one `Origin` it accepts (decision D9). */
  origin: string;
  /** The listening server, for its address. */
  server: Server;
  /** Closes every socket, stops every room's clock and alarm, and frees the port. Idempotent. */
  close(): Promise<void>;
}

export interface LocalRelayOptions {
  /** The rooms' clock period in ms; default the room's own `TICK_MS` (50). */
  tickMs?: number;
  /** A versus room's seed from its code; default the room's crypto seed. */
  seedFor?: (code: string) => number;
  /** Where the relay's few lines go; default stderr. Never stdout, never the secret. */
  log?: (s: string) => void;
}

/** How often a room's scheduled alarm is checked. */
const ALARM_POLL_MS = 250;
/** The largest request body the relay reads; the routes' own bodies are a few hundred bytes. */
const MAX_BODY_BYTES = 64 * 1024;
/** Larger than the room's own message cap (`MAX_MESSAGE_BYTES`, 4,096), so the room is what refuses. */
const MAX_WS_PAYLOAD = 64 * 1024;
/** The namespace stub's answer to `/ws`, read only by this file: accept, or there is no room. */
const UPGRADE_MARKER = 'x-local-relay-upgrade';

/** `ws` hands a text frame over as a Buffer (or fragments, or an ArrayBuffer). */
function text(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/** A `FakeSocket` whose sends and closes reach a real socket. It keeps no copy
 *  of what it sent (the fake's `sent` log would hold a whole match). */
class RelaySocket extends FakeSocket {
  constructor(private readonly ws: WebSocket) { super(); }
  override send(data: string): void {
    if (this.closed) throw new Error('send on a closed socket');
    this.ws.send(data);
  }
  override close(code?: number, reason?: string): void {
    const first = this.closed === null;
    super.close(code, reason);
    if (!first) return;
    try { this.ws.close(code, reason); } catch { this.ws.terminate(); }
  }
}

interface Hosted {
  room: MatchRoom;
  state: FakeState;
  /** An alarm delivery is queued or running: the poll queues no second one. */
  alarming: boolean;
  /** The room's input gate: the tail of the one chain every event of this room runs on. */
  gate: Promise<void>;
}

/** A body up to `MAX_BODY_BYTES`, or null when it is larger. */
function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((res, rej) => {
    const parts: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) over = true;
      else parts.push(c);
    });
    req.on('end', () => { res(over ? null : Buffer.concat(parts)); });
    req.on('error', rej);
  });
}

/** The relay, with a ticket secret the caller supplies. `startLocalRelay` is
 *  the one production entry and mints its own; specs call this to pin that
 *  the secret they chose never reaches a log. */
export async function serveLocalRelay(o: LocalRelayOptions & { ticketSecret: string }): Promise<LocalRelay> {
  const log = o.log ?? ((s: string) => { process.stderr.write(`${s}\n`); });
  const hosted = new Map<string, Hosted>();
  let origin = '';
  let closing = false;
  let closed: Promise<void> | null = null;

  /** The Durable Object namespace: one room per code, made on first use as the runtime makes one. */
  const host = (code: string): Hosted => {
    let h = hosted.get(code);
    if (h === undefined) {
      const state = new FakeState();
      h = { state, room: new MatchRoom(state, env, { tickMs: o.tickMs, seed: o.seedFor }), alarming: false, gate: Promise.resolve() };
      hosted.set(code, h);
    }
    return h;
  };
  const rooms: DurableObjectNamespaceLike = {
    idFromName: (name: string) => name,
    get: (id: unknown) => {
      const h = host(String(id));
      return {
        fetch: async (req: Request): Promise<Response> => {
          if (new URL(req.url).pathname !== '/ws') return h.room.fetch(req);
          // Only workerd can answer the upgrade itself: say whether the room exists.
          const probe = await h.room.fetch(new Request('https://room/state'));
          return new Response(null, { status: 200, headers: { [UPGRADE_MARKER]: probe.status === 404 ? 'none' : 'accept' } });
        },
      };
    },
  };
  const noD1 = (): never => { throw new Error('the local relay has no D1'); };
  const env = {
    TICKET_SECRET: o.ticketSecret,
    ROOMS: rooms,
    DB: { prepare: noD1, batch: noD1 },
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
  } as Env;

  /** Runs `f` after every event of the room that arrived before it, and before any that arrives after. */
  const gated = (h: Hosted, what: string, f: () => Promise<void>): Promise<void> => {
    h.gate = h.gate.then(f).catch((e: unknown) => { log(`local relay: ${what} failed: ${e instanceof Error ? e.message : String(e)}`); });
    return h.gate;
  };

  const sockets = new Set<Promise<void>>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });

  /** One accepted socket, wired to its room. Its messages and then its close
   *  join the ROOM's gate, so they keep their order and never overlap another
   *  socket's events or the alarm. */
  const attach = (ws: WebSocket, h: Hosted): void => {
    const fake = new RelaySocket(ws);
    ws.on('message', (data: RawData) => { void gated(h, 'room handler', () => h.room.webSocketMessage(fake.asSocket(), text(data))); });
    ws.on('error', () => { /* a close follows */ });
    const done = new Promise<void>((res) => {
      ws.once('close', (code: number) => {
        void gated(h, 'room handler', () => deliverClose(h.room, fake, code === 1005 || code === 1006 ? 1000 : code, 'closed')).then(() => {
          sockets.delete(done);
          res();
        });
      });
    });
    sockets.add(done);
    h.room.acceptSocket(fake.asSocket());
  };

  const requestFor = (req: IncomingMessage, body?: Buffer): Request => {
    const headers = new Headers();
    for (const name of ['origin', 'content-type']) {
      const v = req.headers[name];
      if (typeof v === 'string') headers.set(name, v);
    }
    // Built on the relay's own origin, never the Host header: the Origin rule compares against it.
    return new Request(new URL(req.url ?? '/', origin), { method: req.method, headers, body: body?.toString('utf8') });
  };
  const isMatchPath = (req: IncomingMessage): boolean => /^\/api\/match(?:\/|$|\?)/.test(req.url ?? '');

  const onRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (closing || !isMatchPath(req)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const body = hasBody ? await readBody(req) : undefined;
      if (body === null) { res.writeHead(413, { 'content-type': 'text/plain' }).end('too large'); return; }
      const r = await handleMatch(requestFor(req, body), env, Date.now());
      // A plain GET of `/ws` reached the room's upgrade: workerd answers it 426.
      if (r.headers.get(UPGRADE_MARKER) !== null) { res.writeHead(426, { 'content-type': 'text/plain' }).end('expected websocket'); return; }
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/plain' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      log(`local relay: request failed: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end();
    }
  };

  const refuseUpgrade = (socket: Duplex, status: number): void => {
    socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const onUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    socket.on('error', () => { /* the client went */ });
    try {
      if (closing || !isMatchPath(req)) { refuseUpgrade(socket, 404); return; }
      const r = await handleMatch(requestFor(req), env, Date.now());
      const verdict = r.headers.get(UPGRADE_MARKER);
      if (verdict === null) { refuseUpgrade(socket, r.status); return; }
      if (closing) { socket.destroy(); return; }
      const code = new URL(req.url ?? '/', origin).pathname.split('/')[3]?.toUpperCase() ?? '';
      const h = hosted.get(code);
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (verdict === 'none' || h === undefined) {
          // As the room tells a socket for a code with no room (#559 H-1).
          ws.send(JSON.stringify({ t: 'ended', reason: 'expired' }));
          ws.close(1000, 'no room');
          return;
        }
        attach(ws, h);
      });
    } catch (e) {
      log(`local relay: upgrade failed: ${e instanceof Error ? e.message : String(e)}`);
      socket.destroy();
    }
  };

  /** Queues every room's alarm that has fallen due on that room's gate. The
   *  scheduled time is consumed when the delivery RUNS, not when it is queued:
   *  an event ahead of it may move or clear it, and then nothing fires. */
  const alarms = setInterval(() => {
    for (const h of hosted.values()) {
      const at = h.state.storage.alarmAt;
      if (at === null || at > Date.now() || h.alarming || closing) continue;
      h.alarming = true;
      void gated(h, 'alarm', async () => {
        try {
          const due = h.state.storage.alarmAt;
          if (due !== null && due <= Date.now() && !closing) await deliverAlarm(h.room, h.state.storage);
        } finally {
          h.alarming = false;
        }
      });
    }
  }, ALARM_POLL_MS);

  const server = createServer((req, res) => { void onRequest(req, res); });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => { void onUpgrade(req, socket, head); });
  try {
    await new Promise<void>((res, rej) => {
      server.once('error', rej);
      server.listen(0, '127.0.0.1', () => { server.off('error', rej); res(); });
    });
  } catch (e) {
    clearInterval(alarms);
    throw e;
  }
  const addr = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${addr.port}`;
  env.ALLOWED_ORIGINS = origin;
  log(`local relay: listening on ${origin}`);

  const close = (): Promise<void> => {
    closed ??= (async () => {
      closing = true;
      // Every socket goes, and its close reaches its room: each seat is gone,
      // so each room stops its own clock (`wantsClock`).
      for (const ws of wss.clients) ws.terminate();
      await Promise.all([...sockets]);
      clearInterval(alarms);
      await new Promise<void>((res) => { wss.close(() => { res(); }); });
      server.closeAllConnections();
      await new Promise<void>((res) => { server.close(() => { res(); }); });
      log('local relay: closed');
    })();
    return closed;
  };
  return { url: origin, origin, server, close };
}

/** The relay, with a ticket secret minted here, in memory: 32 random bytes,
 *  never logged and never written. */
export function startLocalRelay(o: LocalRelayOptions = {}): Promise<LocalRelay> {
  return serveLocalRelay({ ...o, ticketSecret: randomBytes(32).toString('base64url') });
}
