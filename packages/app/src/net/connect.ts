/**
 * Resolves the battlefield's transport BEFORE the sim exists (spec §3.3): a
 * `LocalTransport` with no `?net`, else a room. `?net=new` creates one and
 * rewrites the URL to `?net=<code>&seat=0`; `?net=<code>` joins. The returned
 * promise resolves at the room's `start`, which carries the seed and the map.
 *
 * Nothing here reads a Vite define: the `build` string is the caller's
 * (`main.ts` composes it from `__APP_BUILD__` and `__APP_COMMIT__`), so this
 * module runs under vitest, where those defines do not exist.
 */
import { LocalTransport, WsTransport, type MatchConfig, type MatchTransport, type Seat, type SocketLike } from '@lions/net';

export interface ConnectDeps {
  fetch: typeof fetch;
  origin: string;
  openSocket: (url: string) => SocketLike;
  replaceUrl: (code: string, seat: Seat) => void;
  note: (text: string) => void;
  /** The battlefield's own `req.signal`: a player who leaves while the room
   *  waits for the other seat must not leave a socket behind (the disposer
   *  contract), and the boot must not resolve into a screen already gone. */
  signal?: AbortSignal;
}

export interface Connected { transport: MatchTransport; seat: Seat | null; config: MatchConfig | null }

/** Thrown for a URL that already carries `seat` (N0 final review M1). */
export const RELOAD_REFUSED = 'a reload cannot rejoin a running room in N0; open a new room (?net=new)';

const aborted = (): DOMException => new DOMException('left while connecting to the room', 'AbortError');

export async function connectMatch(query: URLSearchParams, mapId: string, build: string, deps: ConnectDeps): Promise<Connected> {
  const net = query.get('net');
  if (net === null) return { transport: new LocalTransport(), seat: null, config: null };
  // `?net=new` rewrites the URL to `?net=<code>&seat=0`, so `seat` on the URL
  // means this page has been here before: a reload. A /join from it would
  // take seat 1 of the host's OWN room, leave seat 0 empty in the lobby, and
  // answer the real guest 409 -- a wedged room with a blank stage. N0 has no
  // rejoin, so say so instead.
  if (query.has('seat')) throw new Error(RELOAD_REFUSED);
  const callsign = query.get('callsign') ?? 'Lion';
  const creating = net === 'new';
  // Room codes are upper case; a code typed or pasted in lower case is the same room.
  const joinCode = net.toUpperCase();
  const url = creating ? `${deps.origin}/api/match` : `${deps.origin}/api/match/${encodeURIComponent(joinCode)}/join`;
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callsign, map: mapId, build }),
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`match ${creating ? 'create' : 'join'} failed: HTTP ${res.status}`);
  const { code, seat, ticket } = (await res.json()) as { code: string; seat: Seat; ticket: string };
  if (deps.signal?.aborted) throw aborted();
  if (creating) deps.replaceUrl(code, seat);
  deps.note(`Room ${code} · seat ${seat} · waiting for the other seat`);
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
