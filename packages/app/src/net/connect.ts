/**
 * Resolves the battlefield's transport BEFORE the sim exists (spec §3.3): a
 * `LocalTransport` with no `?net`, else a room. In order:
 *
 *  1. a transport the lobby handed over for this code (`handoff.ts`) is
 *     returned as it is -- it has already seen the room's `start`;
 *  2. a ticket this tab stored for this code (`ticket-store.ts`) rejoins its
 *     own seat: a socket with that ticket and no request, which the room
 *     answers with its `log` (or its lobby, before the start). That is the
 *     reload path (R-B6), with or without `seat` on the URL;
 *  3. `seat` on the URL with no stored ticket is refused (`RELOAD_REFUSED`);
 *  4. otherwise `?net=new` creates a room and rewrites the URL to
 *     `?net=<code>&seat=0`, and `?net=<code>` joins; either stores its ticket.
 *
 * The returned promise resolves at the room's `start` (or `log`), which
 * carries the seed and the map both machines run.
 *
 * Nothing here reads a Vite define: the `build` string is the caller's
 * (`main.ts` composes it from `__APP_BUILD__` and `__APP_COMMIT__`), so this
 * module runs under vitest, where those defines do not exist.
 */
import { playerId } from './player-id';
import { takeHanded } from './handoff';
import { loadSeat, saveSeat } from './ticket-store';
import type { StorageLike } from '../telemetry/identity';
import { LocalTransport, WsTransport, type MatchConfig, type MatchTransport, type Seat, type SocketLike } from '@lions/net';

export interface ConnectDeps {
  fetch: typeof fetch;
  origin: string;
  openSocket: (url: string) => SocketLike;
  replaceUrl: (code: string, seat: Seat) => void;
  note: (text: string) => void;
  /** Where the anonymous player id lives (`player-id.ts`); null when storage is blocked. */
  store: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Where this tab keeps its seat tickets (`sessionStorage`, `ticket-store.ts`);
   *  absent or null when storage is blocked, and then a reload cannot rejoin. */
  session?: StorageLike | null;
  /** The battlefield's own `req.signal`: a player who leaves while the room
   *  waits for the other seat must not leave a socket behind (the disposer
   *  contract), and the boot must not resolve into a screen already gone. */
  signal?: AbortSignal;
}

export interface Connected { transport: MatchTransport; seat: Seat | null; config: MatchConfig | null }

/** Thrown for a URL that carries `seat` when this tab holds no ticket for
 *  that room (N0 final review M1): a /join from it would take the other seat
 *  of the room this URL already sits in. */
export const RELOAD_REFUSED = 'this tab holds no seat in that room, so a reload cannot rejoin it; open a new room (?net=new)';

const aborted = (): DOMException => new DOMException('left while connecting to the room', 'AbortError');

export async function connectMatch(query: URLSearchParams, mapId: string, build: string, deps: ConnectDeps): Promise<Connected> {
  const net = query.get('net');
  if (net === null) return { transport: new LocalTransport(), seat: null, config: null };
  const creating = net === 'new';
  // Room codes are upper case; a code typed or pasted in lower case is the same room.
  const joinCode = net.toUpperCase();
  if (!creating) {
    const handed = takeHanded(joinCode);
    if (handed !== null) return handed;
    const stored = loadSeat(deps.session ?? null, joinCode);
    if (stored !== null) {
      deps.note(`Room ${joinCode} · seat ${stored.seat} · rejoining`);
      return awaitStart(joinCode, stored.seat, stored.ticket, build, deps);
    }
  }
  // `?net=new` rewrites the URL to `?net=<code>&seat=0`, so `seat` on the URL
  // means this page has been here before. With no ticket stored for it (a
  // new tab, blocked storage), a /join would take seat 1 of the host's OWN
  // room, leave seat 0 empty in the lobby, and answer the real guest 409 --
  // a wedged room with a blank stage. Say so instead.
  if (query.has('seat')) throw new Error(RELOAD_REFUSED);
  const callsign = query.get('callsign') ?? 'Lion';
  // The room's mode is fixed at create; a joiner takes whatever the room is.
  const mode = query.get('mode') === 'versus' ? 'versus' : 'sandbox';
  const url = creating ? `${deps.origin}/api/match` : `${deps.origin}/api/match/${encodeURIComponent(joinCode)}/join`;
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ player: playerId(deps.store), callsign, map: mapId, build, ...(creating ? { mode } : {}) }),
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`match ${creating ? 'create' : 'join'} failed: HTTP ${res.status}`);
  const { code, seat, ticket } = (await res.json()) as { code: string; seat: Seat; ticket: string };
  if (deps.signal?.aborted) throw aborted();
  // Stored before the URL names the room, so a reload of the rewritten URL finds it.
  saveSeat(deps.session ?? null, code, { ticket, seat });
  if (creating) deps.replaceUrl(code, seat);
  deps.note(`Room ${code} · seat ${seat} · waiting for the other seat`);
  return awaitStart(code, seat, ticket, build, deps);
}

/** Opens the room's socket with `ticket` and resolves at the room's `start`
 *  (a `log` on a rejoin becomes one: `WsTransport` begins from its config). */
function awaitStart(code: string, seat: Seat, ticket: string, build: string, deps: ConnectDeps): Promise<Connected> {
  const wsUrl = `${deps.origin.replace(/^http/, 'ws')}/api/match/${encodeURIComponent(code)}/ws`;
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
    const transport: WsTransport = new WsTransport(() => deps.openSocket(wsUrl), ticket, build, {
      // Ready only once BOTH seats are in: the room starts at the second ready.
      onLobby: (seats) => { if (seats.length === 2 && seats.every((s) => s.connected)) transport.ready(); },
      onStart: (config) => {
        if (settled) return;
        settled = true;
        deps.signal?.removeEventListener('abort', onAbort);
        resolve({ transport, seat, config });
      },
      onError: (c) => { if (c === 'bad_ticket' || c === 'build_mismatch') fail(new Error(`room refused: ${c}`)); },
      onDesync: (tick) => deps.note(`DESYNC at tick ${tick}`),
      onEnded: (reason) => {
        deps.note(`match ended: ${reason}`);
        // Before the start an ended room can never start: fail the boot rather
        // than wait on it forever.
        fail(new Error(`room ended before the start: ${reason}`));
      },
    });
    deps.signal?.addEventListener('abort', onAbort, { once: true });
  });
}
