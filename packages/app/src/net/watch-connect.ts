/**
 * The watch screen's two requests (GH-954 W1), kept away from `connect.ts`'s seat paths on purpose: a spectator
 * never creates, joins, readies or stores anything.
 *
 * - `fetchLive`: `GET /arena/api/live` on the arena server that served this page, with the run's key. The key
 *   comes from the URL FRAGMENT (`#k=<key>`, `keyFromHash`), which a browser never sends, and is held in memory
 *   only; it goes out as the `x-arena-token` header and nowhere else.
 * - `connectWatch`: opens the room's socket with the spectator ticket from that response and resolves at the
 *   room's `start` (or the `log` it answers a hello with). The ticket lives in the closure and the first
 *   message, exactly as a seat's does: never a URL, never storage. The transport is `role: 'watch'`, which
 *   says hello and nothing else (`WsTransport.send`), so even a bug elsewhere cannot make this page speak.
 *
 * Nothing here reads a Vite define: the `build` string is the live response's (the arena's own `buildId()`),
 * because the room checks it against the build its seats said, and the page's own build string is not that.
 */
import { WsTransport, type Matchup, type MatchConfig, type Seat, type SocketLike } from '@lions/net';
import type { Connected } from './connect';

/** The running game, as `/arena/api/live` describes it. */
export interface LiveGame { n: number; of: number; seed: number; map: string; matchup: Matchup }
/** A finished game's verdict. */
export interface LiveLast { n: number; outcome: string; by: string; ticks: number; players: [string, string] }
export type LiveState = 'waiting' | 'running' | 'between' | 'finished';

/** `/arena/api/live`, validated. A `running` response carries everything a connection needs. */
export interface Live {
  state: LiveState;
  game: LiveGame | null;
  wsUrl: string | null;
  code: string | null;
  ticket: string | null;
  build: string | null;
  labels: [string, string] | null;
  capTicks: number | null;
  roundTicks: number | null;
  run: string | null;
  last: LiveLast | null;
}
/** A `Live` whose game is on and whose connection fields are all there. */
export type RunningLive = Live & { state: 'running'; game: LiveGame; wsUrl: string; code: string; ticket: string; build: string; labels: [string, string]; capTicks: number; roundTicks: number };

/** The arena server refused or could not answer. `status` 0: no answer at all. */
export class WatchRefused extends Error {
  constructor(readonly status: number) {
    super(`the arena server refused: HTTP ${status}`);
    this.name = 'WatchRefused';
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const pair = (v: unknown): [string, string] | null => (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' ? [v[0], v[1]] : null);

/** The run's key out of a URL fragment (`#k=<key>`), or null. Only the fragment: never the query. */
export function keyFromHash(hash: string): string | null {
  const m = /^#?(?:.*&)?k=([A-Za-z0-9_-]{8,128})(?:&.*)?$/.exec(hash);
  return m === null ? null : m[1];
}

/** `/arena/api/live` as an object, or null for anything that is not one. */
export function parseLive(raw: unknown): Live | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const state = r.state;
  if (state !== 'waiting' && state !== 'running' && state !== 'between' && state !== 'finished') return null;
  let game: LiveGame | null = null;
  if (r.game !== null && r.game !== undefined) {
    const g = r.game as Record<string, unknown>;
    if (typeof g !== 'object' || !isInt(g.n) || !isInt(g.of) || typeof g.seed !== 'number' || !isStr(g.map) || !isStr(g.matchup)) return null;
    game = { n: g.n, of: g.of, seed: g.seed as number, map: g.map, matchup: g.matchup as Matchup };
  }
  let last: LiveLast | null = null;
  if (r.last !== null && r.last !== undefined) {
    const l = r.last as Record<string, unknown>;
    const players = pair(l.players);
    if (typeof l !== 'object' || !isInt(l.n) || !isStr(l.outcome) || !isStr(l.by) || !isInt(l.ticks) || players === null) return null;
    last = { n: l.n, outcome: l.outcome, by: l.by, ticks: l.ticks, players };
  }
  const live: Live = {
    state, game, last,
    wsUrl: isStr(r.wsUrl) ? r.wsUrl : null,
    code: isStr(r.code) ? r.code : null,
    ticket: isStr(r.ticket) ? r.ticket : null,
    build: isStr(r.build) ? r.build : null,
    labels: pair(r.labels),
    capTicks: isInt(r.capTicks) ? r.capTicks : null,
    roundTicks: isInt(r.roundTicks) && r.roundTicks > 0 ? r.roundTicks : null,
    run: isStr(r.run) ? r.run : null,
  };
  return live;
}

/** Whether `live` is a game a page can connect to. */
export function isRunning(live: Live): live is RunningLive {
  return live.state === 'running' && live.game !== null && live.wsUrl !== null && live.code !== null && live.ticket !== null && live.build !== null && live.labels !== null && live.capTicks !== null && live.roundTicks !== null;
}

export interface FetchLiveDeps {
  fetch: typeof fetch;
  /** The run's key, from the fragment. */
  key: string;
  signal?: AbortSignal;
}

/** One poll. Throws `WatchRefused` for a non-200 or an answer that is not a live response. */
export async function fetchLive(deps: FetchLiveDeps): Promise<Live> {
  let res: Response;
  try {
    res = await deps.fetch('/arena/api/live', { method: 'GET', headers: { 'x-arena-token': deps.key }, cache: 'no-store', ...(deps.signal ? { signal: deps.signal } : {}) });
  } catch {
    throw new WatchRefused(0);
  }
  if (res.status !== 200) throw new WatchRefused(res.status);
  let body: unknown;
  try { body = await res.json(); } catch { throw new WatchRefused(0); }
  const live = parseLive(body);
  if (live === null) throw new WatchRefused(0);
  return live;
}

export interface ConnectWatchDeps {
  openSocket: (url: string) => SocketLike;
  note: (text: string) => void;
  signal?: AbortSignal;
}

const aborted = (): DOMException => new DOMException('left while connecting to the game', 'AbortError');

/** Opens the spectator socket and resolves at the room's `start` (a `log` becomes one). */
export function connectWatch(live: RunningLive, deps: ConnectWatchDeps): Promise<Connected> {
  if (deps.signal?.aborted) return Promise.reject(aborted());
  return new Promise<Connected>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      deps.signal?.removeEventListener('abort', onAbort);
      transport.close();
      reject(err);
    };
    const onAbort = (): void => fail(aborted());
    const transport: WsTransport = new WsTransport(() => deps.openSocket(live.wsUrl), live.ticket, live.build, {
      onStart: (config: MatchConfig) => {
        if (settled) return;
        settled = true;
        deps.signal?.removeEventListener('abort', onAbort);
        resolve({ transport, seat: 0 as Seat, config });
      },
      onError: (c) => { if (c === 'bad_ticket' || c === 'build_mismatch' || c === 'full') fail(new Error(`the room refused the spectator: ${c}`)); },
      onDesync: (tick) => deps.note(`DESYNC at tick ${tick}`),
      onEnded: (reason) => {
        deps.note(`match ended: ${reason}`);
        // Before the start an ended room can never start.
        fail(new Error(`the game ended before the page joined it: ${reason}`));
      },
    }, undefined, 'watch');
    deps.signal?.addEventListener('abort', onAbort, { once: true });
  });
}
