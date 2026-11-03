/**
 * The arena's local server (GH-954 W1, decision D-W3): ONE 127.0.0.1 process that serves the DEV-only arena
 * screens through Vite's dev server in middleware mode (so those screens exist only in a dev build: no telemetry,
 * no service worker, and nothing in a production bundle) and the small JSON API the watch screen reads.
 * `pnpm arena --watch` (or `--serve`) starts it; nothing else does.
 *
 * Security, in the order a request meets it (every refusal is before Vite or a handler sees the request):
 *  1. The socket binds 127.0.0.1 and nothing else, on a port the caller names or the OS picks.
 *  2. `Host` must be `127.0.0.1:<port>` or `localhost:<port>` -- DNS rebinding: a page on `evil.example` that
 *     resolves to 127.0.0.1 arrives with `Host: evil.example` and is refused (421).
 *  3. A present `Origin` must be this server's own (403). A browser adds none to a same-origin GET and always one
 *     to a POST, so a POST with none is refused too.
 *  4. `/arena/api/*` only: the run's one `x-arena-token` (403), compared in constant time. The token is printed once,
 *     in the URL FRAGMENT (`/arena/watch#k=<token>`), which a browser never puts in a request line, a Referer or
 *     a log; the page reads it from `location.hash` and sends it as the header.
 *  5. The method is the route's own: a GET for a POST route (an action) is 405, never run.
 *  6. The API handlers run BEFORE Vite's middlewares, so Vite never sees an `/arena/api` path.
 * Unknown `/arena/api` paths are 404. A body is read only for a POST, capped at 8 KiB. Nothing here reads a key,
 * a template or a file; the one thing a response carries beyond the run's labels is a spectator ticket, in the
 * JSON body and nowhere else (never a URL, a header or storage).
 *
 * The ticket: `/arena/api/live` asks the CURRENT game's relay for a fresh `watch` ticket (`POST
 * /api/match/:code/watch`, traded from the seat ticket the arena holds). The relay answers only because the
 * arena started it with `watch: true` (`ARENA_WATCH`), and only for a bot match.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Matchup } from '@lions/net';
import type { GameRecord } from './arena-score';

/** What `playGame` tells the server when a game's room is confirmed and its players are running. */
export interface GameStart {
  /** 1-based, and the run's total. */
  n: number;
  of: number;
  seed: number;
  map: string;
  matchup: Matchup;
  /** By seat. */
  names: [string, string];
  factions: GameRecord['factions'];
  code: string;
  relay: { url: string; origin: string };
  /** Seat 0's own ticket: the only thing a spectator ticket can be traded from. Never leaves this process. */
  seatTicket: string;
  build: string;
  capTicks: number;
  pace: number;
  roundWallMs: number;
}

export interface ArenaServeOptions {
  /** 0 (default): the OS picks. */
  port?: number;
  log?: (line: string) => void;
  /** A one-line label of the run (the players), shown on the watch strip. */
  runLabel?: string;
  /** The run's token, for a spec; default 24 random bytes. */
  token?: string;
  /** false: no Vite (a spec, or a machine without the app): the page routes answer 404. Default true. */
  app?: boolean;
  /** How long `close()` waits after `runFinished()`, so the page's next poll hears the end. Default 4000. */
  finishedGraceMs?: number;
  /** Extra API routes, for a spec or a later phase. Registered beside `live`. */
  routes?: Record<string, ApiRoute>;
}

export interface ApiRoute {
  method: 'GET' | 'POST';
  handle(req: IncomingMessage, body: unknown): Promise<{ status: number; body: unknown }> | { status: number; body: unknown };
}

export interface ArenaServe {
  /** `http://127.0.0.1:<port>`. */
  origin: string;
  /** Every origin the page may be served from (`127.0.0.1` and `localhost`): what a relay must allow. */
  origins: readonly string[];
  port: number;
  /** The address the socket is bound to (always `127.0.0.1`; a spec pins it). */
  address: string;
  /** The run's token (a spec reads it; the CLI prints it only inside `url`). */
  token: string;
  /** `origin + path`, with `#k=<token>` appended: what the CLI prints. */
  url(path: string): string;
  gameStarted(info: GameStart): void;
  gameEnded(record: GameRecord): void;
  runFinished(): void;
  close(o?: { now?: boolean }): Promise<void>;
}

/** The body of `/arena/api/live`. `game` is null between games and before the first. */
export interface LiveResponse {
  state: 'waiting' | 'running' | 'between' | 'finished';
  game: { n: number; of: number; seed: number; map: string; matchup: Matchup } | null;
  wsUrl: string | null;
  code: string | null;
  /** A spectator ticket for `code`, minted for this request. In the body only. */
  ticket: string | null;
  build: string | null;
  /** The players, by seat. */
  labels: [string, string] | null;
  capTicks: number | null;
  /** The paced room's round length in ticks (what the strip's "round" divides by). */
  roundTicks: number | null;
  run: string | null;
  /** The last finished game's verdict, once there is one. */
  last: { n: number; outcome: string; by: string; ticks: number; players: [string, string] } | null;
}

const MAX_BODY = 8 * 1024;
const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, '../../../packages/app');
const TICKET_MS = 10_000;

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
};
const refuse = (res: ServerResponse, status: number, why: string): void => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(why);
};

/** Constant-time token compare; false for anything that is not a string of the right length. */
export function tokenMatches(want: string, got: string | string[] | undefined): boolean {
  if (typeof got !== 'string') return false;
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The origins this server answers to, for its port. */
export function ownOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/** Why a request is refused before any handler (status and reason), or null. Pure, so a spec calls it with
 *  headers and no socket. `isApi` and `method` decide the Origin and token rules. */
export function requestRefusal(h: { host?: string; origin?: string }, o: { port: number; token: string; tokenHeader?: string | string[] }, isApi: boolean, method: string): { status: number; why: string } | null {
  const own = ownOrigins(o.port);
  if (h.host === undefined || !own.some((x) => x === `http://${h.host}`)) return { status: 421, why: 'host' };
  if (h.origin !== undefined && !own.includes(h.origin)) return { status: 403, why: 'origin' };
  if (isApi) {
    // A browser sends no Origin on a same-origin GET and always one on a POST.
    if (method !== 'GET' && method !== 'HEAD' && h.origin === undefined) return { status: 403, why: 'origin' };
    if (!tokenMatches(o.token, o.tokenHeader)) return { status: 403, why: 'token' };
  }
  return null;
}

function readJson(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((res) => {
    const parts: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) over = true; else parts.push(c); });
    req.on('end', () => {
      if (over) { res(null); return; }
      try { res(parts.length === 0 ? {} : JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { res(null); }
    });
    req.on('error', () => { res(null); });
  });
}

export async function startArenaServe(o: ArenaServeOptions = {}): Promise<ArenaServe> {
  const log = o.log ?? ((s: string) => { process.stderr.write(`${s}\n`); });
  const token = o.token ?? randomBytes(24).toString('base64url');
  const graceMs = o.finishedGraceMs ?? 4000;
  let current: GameStart | null = null;
  let last: LiveResponse['last'] = null;
  let finished = false;
  let started = false;
  let port = 0;
  let closed: Promise<void> | null = null;
  let cutGrace: () => void = () => {};
  // Vite's middleware, once it is up (a dynamic import: the tools that never serve a page never load Vite).
  let vite: { middlewares: (req: IncomingMessage, res: ServerResponse, next: () => void) => void; close(): Promise<void> } | null = null;

  const live = async (): Promise<{ status: number; body: unknown }> => {
    const base: LiveResponse = { state: finished ? 'finished' : started ? 'between' : 'waiting', game: null, wsUrl: null, code: null, ticket: null, build: null, labels: null, capTicks: null, roundTicks: null, run: o.runLabel ?? null, last };
    const g = current;
    if (g === null) return { status: 200, body: base };
    // A fresh spectator ticket for this game, from the seat ticket held here. The relay refuses unless it was
    // started with watch on and the room is a bot match; either refusal is a 502 here, with no detail.
    let ticket: string;
    try {
      const r = await fetch(`${g.relay.url}/api/match/${encodeURIComponent(g.code)}/watch`, {
        method: 'POST', headers: { origin: g.relay.origin, 'content-type': 'application/json' }, body: JSON.stringify({ ticket: g.seatTicket }),
        signal: AbortSignal.timeout(TICKET_MS),
      });
      if (r.status !== 200) return { status: 502, body: { error: 'watch_refused', status: r.status } };
      const b = (await r.json()) as { ticket?: unknown };
      if (typeof b.ticket !== 'string') return { status: 502, body: { error: 'no_ticket' } };
      ticket = b.ticket;
    } catch {
      return { status: 502, body: { error: 'relay_unreachable' } };
    }
    const body: LiveResponse = {
      ...base, state: 'running',
      game: { n: g.n, of: g.of, seed: g.seed, map: g.map, matchup: g.matchup },
      wsUrl: `${g.relay.url.replace(/^http/, 'ws')}/api/match/${encodeURIComponent(g.code)}/ws`,
      code: g.code, ticket, build: g.build, labels: [g.names[0], g.names[1]], capTicks: g.capTicks, roundTicks: g.pace,
    };
    return { status: 200, body };
  };

  const routes: Record<string, ApiRoute> = { live: { method: 'GET', handle: live }, ...(o.routes ?? {}) };

  const onRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      const isApi = path === '/arena/api' || path.startsWith('/arena/api/');
      const method = req.method ?? 'GET';
      const why = requestRefusal(
        { host: req.headers.host, origin: req.headers.origin },
        { port, token, tokenHeader: req.headers['x-arena-token'] },
        isApi, method,
      );
      if (why !== null) { refuse(res, why.status, why.why); return; }
      if (isApi) {
        const name = path.slice('/arena/api/'.length);
        const route = Object.hasOwn(routes, name) ? routes[name] : undefined;
        if (route === undefined) { json(res, 404, { error: 'not_found' }); return; }
        if (method !== route.method) { res.setHeader('allow', route.method); json(res, 405, { error: 'method' }); return; }
        let body: unknown = {};
        if (route.method === 'POST') {
          body = await readJson(req);
          if (body === null) { json(res, 400, { error: 'body' }); return; }
        }
        const out = await route.handle(req, body);
        json(res, out.status, out.body);
        return;
      }
      if (vite === null) { refuse(res, 404, 'not found'); return; }
      vite.middlewares(req, res, () => { refuse(res, 404, 'not found'); });
    } catch (e) {
      log(`arena server: request failed: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) refuse(res, 500, 'error');
      else res.end();
    }
  };

  const server: Server = createServer((req, res) => { void onRequest(req, res); });
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(o.port ?? 0, '127.0.0.1', () => { server.off('error', rej); res(); });
  });
  port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;

  if (o.app !== false) {
    try {
      const { createServer: createVite } = await import('vite');
      // The app's own config (palette, cursors, the asset watcher, the defines), in middleware mode: this
      // server owns the socket, so Vite binds nothing. HMR is off: a hot reload would only ever drop a
      // running game's page, and an HMR socket is one more thing on the port.
      vite = await createVite({
        root: APP_ROOT,
        configFile: resolve(APP_ROOT, 'vite.config.ts'),
        appType: 'spa',
        logLevel: 'warn',
        clearScreen: false,
        server: { middlewareMode: true, hmr: false },
      });
    } catch (e) {
      await new Promise<void>((res) => { server.close(() => { res(); }); });
      throw e;
    }
  }
  log(`arena server: listening on ${origin}${vite === null ? ' (no app)' : ''}`);

  const close = (c?: { now?: boolean }): Promise<void> => {
    if (c?.now === true) cutGrace();
    closed ??= (async () => {
      if (finished && graceMs > 0 && c?.now !== true) {
        await new Promise<void>((res) => {
          const t = setTimeout(res, graceMs);
          cutGrace = () => { clearTimeout(t); res(); };
        });
      }
      server.closeAllConnections();
      await new Promise<void>((res) => { server.close(() => { res(); }); });
      if (vite !== null) await vite.close();
      log('arena server: closed');
    })();
    return closed;
  };

  return {
    origin, origins: ownOrigins(port), port, address: (server.address() as AddressInfo).address, token,
    url: (path) => `${origin}${path}#k=${token}`,
    gameStarted: (info) => { current = info; started = true; },
    gameEnded: (r) => {
      if (current !== null) last = { n: current.n, outcome: r.outcome, by: r.by, ticks: r.ticks, players: [r.players[0], r.players[1]] };
      current = null;
    },
    runFinished: () => { current = null; finished = true; },
    close,
  };
}
