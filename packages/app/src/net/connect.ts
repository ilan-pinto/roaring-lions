/**
 * Resolves the battlefield's transport BEFORE the sim exists (spec §3.3): a
 * `LocalTransport` with no `?net`, else a room. In order:
 *
 *  1. a transport the lobby handed over for this code (`handoff.ts`) is
 *     returned -- it has already seen the room's `start` -- after the
 *     battlefield's hooks replace the lobby's (`setHooks`): from here the
 *     battlefield owns it and closes it on leave;
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
import { dropHanded, takeHanded } from './handoff';
import { forgetSeat, loadSeat, saveSeat } from './ticket-store';
import type { StorageLike } from '../telemetry/identity';
import { LocalTransport, WsTransport, type MatchConfig, type MatchTransport, type Seat, type SeatState, type SocketLike } from '@lions/net';

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
  // A screen already left when this runs must take nothing: a handed transport
  // is let go (detach, no bye -- the room sees a gone seat, the honest account
  // of a boot that never arrived), and no socket is opened or request made.
  if (deps.signal?.aborted) {
    if (!creating) dropHanded(joinCode);
    throw aborted();
  }
  if (!creating) {
    const handed = takeHanded(joinCode);
    if (handed !== null) {
      // The lobby's hooks come off and the battlefield's go on, in one call.
      // The match has started, so only what can still arrive matters: a
      // desync and an end are noted as `awaitStart` notes them; nothing can
      // fail the boot any more, and the lobby's screen is gone.
      handed.transport.setHooks({
        onLobby: undefined,
        onChat: undefined,
        onPaused: undefined,
        onStart: () => {},
        onError: () => {},
        onDesync: (tick) => deps.note(`DESYNC at tick ${tick}`),
        onEnded: (reason) => deps.note(`match ended: ${reason}`),
      });
      return handed;
    }
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
    // A room that refuses this ticket or has ended will refuse it again: the
    // next reload must fall to a fresh join rather than loop on it (R-B19). A
    // build mismatch keeps it -- the room is alive and the seat still ours.
    const failStale = (err: Error): void => {
      if (!settled) forgetSeat(deps.session ?? null, code);
      fail(err);
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
      onError: (c) => {
        if (c === 'bad_ticket') failStale(new Error(`room refused: ${c}`));
        else if (c === 'build_mismatch') fail(new Error(`room refused: ${c}`));
      },
      onDesync: (tick) => deps.note(`DESYNC at tick ${tick}`),
      onEnded: (reason) => {
        deps.note(`match ended: ${reason}`);
        // Before the start an ended room can never start: fail the boot rather
        // than wait on it forever.
        failStale(new Error(`room ended before the start: ${reason}`));
      },
    });
    deps.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// --- the lobby's half (N1b task 6, R-B8) -----------------------------------
// `connectMatch` cannot serve the lobby: it says `ready` by itself once both
// seats are in and resolves only at the start. The lobby needs the opposite --
// an open, NOT-yet-started transport whose Ready is the player's click -- so
// this is its own path, beside that one and sharing only the ticket store.

/** What the `/versus` screens ask for. */
export type RoomRequest =
  | { kind: 'create'; map: string; callsign: string }
  | { kind: 'join'; code: string; callsign: string };

/** The room as its first `lobby` message described it. */
export interface LobbyState { seats: SeatState[]; map: string }

/** An open room: its code, this tab's seat, the live transport (nothing said
 *  but `hello`), and the lobby it first answered with. */
export interface OpenedRoom { code: string; seat: Seat; transport: WsTransport; lobby: LobbyState }

export type OpenDeps = Pick<ConnectDeps, 'fetch' | 'origin' | 'openSocket' | 'store' | 'session' | 'signal'>;

/** Why a room could not be opened, as the lobby words it: no such room, a
 *  full one, a different build, or anything else (offline, a 5xx, a room
 *  that ended before it answered). */
export type RefusedReason = 'not_found' | 'full' | 'build' | 'failed';

export class RoomRefused extends Error {
  /** `stale`: the room refused THIS TICKET (`bad_ticket`) or has ended -- the
   *  only refusals after which a fresh join is worth trying. */
  constructor(readonly reason: RefusedReason, detail: string, readonly stale = false) {
    super(detail);
    this.name = 'RoomRefused';
  }
}

/** The room this tab holds a seat in has ALREADY STARTED (a lobby reloaded
 *  after the start, Task 7 review (g)). Still a `failed` refusal to anything
 *  that only knows `RoomRefused`; the lobby reads `map` and goes to the match
 *  (`routes.sandbox(map)?net=<code>`), where `connectMatch` rejoins with the
 *  stored ticket this refusal leaves in place. */
export class RoomStarted extends RoomRefused {
  constructor(readonly map: string, readonly code: string) {
    super('failed', `room ${code} already started on ${map}`);
    this.name = 'RoomStarted';
  }
}

/**
 * Creates (`mode: 'versus'`, the chosen map) or joins a room and opens its
 * socket, resolving at the room's FIRST `lobby` message with no `ready` sent.
 * The ticket is stored (`ticket-store.ts`) as soon as it is known, so the
 * battlefield's reload path finds it. A join for a code this tab already
 * holds a seat in rejoins that seat with the stored ticket (a reload of the
 * lobby); if the room refuses it, the ticket is forgotten and the join goes
 * on as a fresh request.
 */
export async function openRoom(req: RoomRequest, build: string, deps: OpenDeps): Promise<OpenedRoom> {
  const session = deps.session ?? null;
  if (req.kind === 'join') {
    const code = req.code.toUpperCase();
    const stored = loadSeat(session, code);
    if (stored !== null) {
      try {
        return await awaitLobby(code, stored.seat, stored.ticket, build, deps);
      } catch (err) {
        // Only a ticket the room no longer honours (or a room that ended) is
        // forgotten and falls through to a fresh join. A build mismatch, a
        // match already running (the battlefield's rejoin needs this ticket)
        // and anything else are the caller's to show.
        if (!(err instanceof RoomRefused && err.stale)) throw err;
        forgetSeat(session, code);
      }
    }
  }
  const creating = req.kind === 'create';
  const url = creating ? `${deps.origin}/api/match` : `${deps.origin}/api/match/${encodeURIComponent(req.code.toUpperCase())}/join`;
  const player = playerId(deps.store);
  const body = creating
    ? { player, callsign: req.callsign, map: req.map, build, mode: 'versus' }
    : { player, callsign: req.callsign, build };
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch (err) {
    if (deps.signal?.aborted) throw aborted();
    throw new RoomRefused('failed', `match ${req.kind} failed: ${String(err)}`);
  }
  if (res.status !== 201 && res.status !== 200) {
    // A malformed code is answered 400 by the route: to a player that is no such room.
    const reason: RefusedReason = creating ? 'failed' : res.status === 404 || res.status === 400 ? 'not_found' : res.status === 409 ? 'full' : 'failed';
    throw new RoomRefused(reason, `match ${req.kind} failed: HTTP ${res.status}`);
  }
  const { code, seat, ticket } = (await res.json()) as { code: string; seat: Seat; ticket: string };
  if (deps.signal?.aborted) throw aborted();
  saveSeat(session, code, { ticket, seat });
  return awaitLobby(code, seat, ticket, build, deps);
}

/** Opens the room's socket with `ticket` and resolves at its first `lobby`.
 *  The transport's hooks here only settle this promise: the lobby screen
 *  replaces them (`setHooks`) as soon as it holds the transport.
 *
 *  A `start` (or a `log`, which a rejoin into a running match is answered
 *  with) before any lobby means the match is already under way: the lobby has
 *  nothing to show. The transport is let go with `detach` -- no `bye`, which
 *  would end a live match for the other seat -- and the stored ticket stays
 *  for the battlefield's own rejoin, which the rejection (`RoomStarted`,
 *  naming the started config's map) sends the lobby to. */
function awaitLobby(code: string, seat: Seat, ticket: string, build: string, deps: OpenDeps): Promise<OpenedRoom> {
  const wsUrl = `${deps.origin.replace(/^http/, 'ws')}/api/match/${encodeURIComponent(code)}/ws`;
  return new Promise<OpenedRoom>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error, bye = true): void => {
      if (settled) return;
      settled = true;
      deps.signal?.removeEventListener('abort', onAbort);
      if (bye) transport.close(); else transport.detach();
      reject(err);
    };
    const onAbort = (): void => fail(aborted());
    const transport: WsTransport = new WsTransport(() => deps.openSocket(wsUrl), ticket, build, {
      onLobby: (seats, _you, map) => {
        if (settled) return;
        settled = true;
        deps.signal?.removeEventListener('abort', onAbort);
        resolve({ code, seat, transport, lobby: { seats, map } });
      },
      onStart: (config) => fail(new RoomStarted(config.map, code), false),
      onError: (c) => {
        if (c === 'build_mismatch') fail(new RoomRefused('build', `room refused: ${c}`));
        else if (c === 'bad_ticket') fail(new RoomRefused('failed', `room refused: ${c}`, true));
        else if (c === 'full') fail(new RoomRefused('full', `room refused: ${c}`));
      },
      onEnded: (reason) => fail(new RoomRefused('failed', `room ended before the lobby: ${reason}`, true)),
    });
    deps.signal?.addEventListener('abort', onAbort, { once: true });
  });
}
