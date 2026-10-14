/**
 * The real `MatchRoom` over a fake Durable Object runtime (`fake-do.ts`, R19):
 * it replaces the plan's `wrangler dev` smoke. Sockets enter through
 * `acceptSocket`, the half of `/ws` that runs under node -- a
 * `WebSocketPair` and a 101 `Response` exist only in workerd.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OVER_CLOSE_MS, validateConfig, type ServerMsg, type Seat } from '@lions/net';
import type { D1Like, Env } from '../d1';
import { openTestD1 } from '../test-d1';
import { FakeState, deliverAlarm, deliverClose, deliverError, openSocket, type FakeSocket } from './fake-do';
import { BATCH_TICKS, HELLO_TIMEOUT_MS, MAX_ROOM_SOCKETS, MatchRoom, PURGE_AFTER_MS, SOCKET_BUDGET, TICK_MS, WATCHDOG_MS } from './match-room';
import { ROOM_TTL_MS } from './room-core';
import type { RoomState } from './room-core';
import { signTicket } from './ticket';

const NOW = 1_790_000_000_000;
/** Where a room created at NOW keeps its alarm while nothing else wants one (#559 H-1). */
const TTL_AT = NOW + ROOM_TTL_MS + 1;
const SECRET = 'room-test-secret';
const CODE = 'ABCDEF';
const BUILD = 'b1';
const env = { DB: {}, ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: SECRET } as unknown as Env;

/** The ticket's `player` is the anonymous player id; the callsign is the room's (N1a task 8). */
const ticket = (seat: Seat, matchId = CODE, player = seat === 0 ? 'p-host' : 'p-guest'): Promise<string> =>
  signTicket(SECRET, { matchId, seat, player, exp: NOW + 3600 * 1000 });
const msgs = (ws: FakeSocket): ServerMsg[] => ws.messages() as ServerMsg[];
const last = (ws: FakeSocket): ServerMsg | undefined => msgs(ws).at(-1);
const ofType = <T extends ServerMsg['t']>(ws: FakeSocket, t: T): Extract<ServerMsg, { t: T }>[] =>
  msgs(ws).filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

interface CreateOpts { mode?: string; join?: boolean; code?: string; db?: D1Like; matchup?: string }
/** Creates the room and, unless `join: false`, has the guest reserve seat 1 as the Worker does. */
async function created(state = new FakeState(), opts: CreateOpts = {}): Promise<{ state: FakeState; room: MatchRoom }> {
  const room = new MatchRoom(state, opts.db ? ({ ...env, DB: opts.db } as Env) : env);
  const res = await room.fetch(new Request('https://room/create', {
    method: 'POST',
    body: JSON.stringify({ code: opts.code ?? CODE, matchId: opts.code ?? CODE, map: 'tel_marum', build: BUILD, player: 'p-host', callsign: 'Host', ...(opts.mode ? { mode: opts.mode } : {}), ...(opts.matchup ? { matchup: opts.matchup } : {}) }),
  }));
  expect(res.status).toBe(200);
  if (opts.join !== false) {
    const join = await room.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: 'p-guest', callsign: 'Guest' }) }));
    expect(join.status).toBe(200);
  }
  return { state, room };
}
async function say(room: MatchRoom, ws: FakeSocket, msg: unknown): Promise<void> {
  await room.webSocketMessage(ws.asSocket(), typeof msg === 'string' ? msg : JSON.stringify(msg));
}
async function hello(room: MatchRoom, seat: Seat, t?: string, build = BUILD): Promise<FakeSocket> {
  const ws = openSocket(room);
  await say(room, ws, { t: 'hello', ticket: t ?? (await ticket(seat)), build });
  return ws;
}
async function running(opts: CreateOpts = {}): Promise<{ state: FakeState; room: MatchRoom; ws0: FakeSocket; ws1: FakeSocket }> {
  const { state, room } = await created(new FakeState(), opts);
  const ws0 = await hello(room, 0);
  const ws1 = await hello(room, 1);
  await say(room, ws0, { t: 'ready' });
  await say(room, ws1, { t: 'ready' });
  return { state, room, ws0, ws1 };
}
/** One persisted batch row, parsed. */
const row = (state: FakeState, firstTick: number): { tick: number; cmds: unknown[] }[] =>
  JSON.parse(state.storage.batches.get(firstTick) ?? 'null') as { tick: number; cmds: unknown[] }[];
/** Lets the room's unawaited desync write (a few microtasks) settle. */
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const persisted = async (state: FakeState): Promise<RoomState> => {
  const st = await state.storage.get<RoomState>('state');
  if (!st) throw new Error('no persisted state');
  return st;
};

/** The isolate dies: its timers go, storage and the hibernated sockets
 *  survive. `vi.clearAllTimers()` also rewinds the fake clock to its start,
 *  which would hide a revived room's stale times, so the time is kept. */
function evict(): void {
  const now = Date.now();
  vi.clearAllTimers();
  vi.setSystemTime(now);
}
beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('MatchRoom', () => {
  it('a hello with a valid ticket joins the lobby, and each socket is told its own seat', async () => {
    const { room } = await created();
    const ws0 = await hello(room, 0);
    expect(last(ws0)).toEqual({ t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'Host', connected: true, ready: false }], you: 0, map: 'tel_marum', factions: ['kdf', 'kdf'] });
    const ws1 = await hello(room, 1);
    const seats = [{ seat: 0, callsign: 'Host', connected: true, ready: false }, { seat: 1, callsign: 'Guest', connected: true, ready: false }];
    expect(last(ws0)).toEqual({ t: 'lobby', config: null, seats, you: 0, map: 'tel_marum', factions: ['kdf', 'kdf'] });
    expect(last(ws1)).toEqual({ t: 'lobby', config: null, seats, you: 1, map: 'tel_marum', factions: ['kdf', 'kdf'] });
  });

  it('answers a seated socket\'s malformed message with one bad_message and carries on', async () => {
    const { room } = await created();
    const ws = await hello(room, 0);
    await say(room, ws, '{not json');
    expect(last(ws)).toEqual({ t: 'error', code: 'bad_message' });
    expect(ws.closed).toBeNull();
    await say(room, ws, { t: 'ready' });
    expect(last(ws)?.t).toBe('lobby');
  });

  describe('#559 M-1: socket limits', () => {
    it('a socket with no seat whose first message is garbage is told once and closed', async () => {
      const { room } = await created();
      const ws = openSocket(room);
      await say(room, ws, '{not json');
      expect(msgs(ws)).toEqual([{ t: 'error', code: 'bad_message' }]);
      expect(ws.closed).toEqual({ code: 1008, reason: 'bad message' });
    });

    it('a socket with no hello after 10 s is closed by the next thing that wakes the room; a quicker one is seated', async () => {
      const { room } = await created();
      const lurker = openSocket(room);
      vi.setSystemTime(Date.now() + HELLO_TIMEOUT_MS - 1);
      const quick = openSocket(room);
      expect(lurker.closed).toBeNull();
      vi.setSystemTime(Date.now() + 1);
      await say(room, quick, { t: 'hello', ticket: await ticket(0), build: BUILD });
      expect(lurker.closed).toEqual({ code: 1008, reason: 'no hello' });
      expect(quick.closed).toBeNull();
      expect(last(quick)?.t).toBe('lobby');
    });

    it('a running clock sweeps them too', async () => {
      const { room } = await running();
      const lurker = openSocket(room);
      await vi.advanceTimersByTimeAsync(HELLO_TIMEOUT_MS + 2000);
      expect(lurker.closed?.code).toBe(1008);
    });

    it('a room serves at most 8 live sockets; the ninth is closed at once, and a closed one frees its place', async () => {
      const { state, room } = await created();
      const socks = Array.from({ length: MAX_ROOM_SOCKETS }, () => openSocket(room));
      expect(socks.every((w) => w.closed === null)).toBe(true);
      const ninth = openSocket(room);
      expect(ninth.closed).toEqual({ code: 1008, reason: 'too many sockets' });
      await deliverClose(room, socks[0]);
      expect(openSocket(room).closed).toBeNull();
      expect(state.getWebSockets().length).toBeLessThanOrEqual(MAX_ROOM_SOCKETS + 1);
    });

    it('a seat flooding the room is closed with 1008 once its budget runs out', async () => {
      const { room, ws0 } = await running();   // its hello and ready spent two
      for (let i = 0; i < SOCKET_BUDGET.burst - 2; i++) await say(room, ws0, { t: 'chat', text: 'x' });
      expect(ws0.closed).toBeNull();
      await say(room, ws0, { t: 'chat', text: 'x' });
      expect(ws0.closed).toEqual({ code: 1008, reason: 'rate' });
    });

    it('a rejoining seat replaying its log may ack and hash every minted tick at once: advancing acks and hashes are free', async () => {
      const { room, ws0, ws1 } = await running();
      for (let tick = 9; tick < 4000; tick += 10) {
        await vi.advanceTimersByTimeAsync(10 * TICK_MS);
        await say(room, ws0, { t: 'ack', tick });
        await say(room, ws1, { t: 'ack', tick });
      }
      const again = await hello(room, 1);
      for (let tick = 9; tick < 4000; tick += 10) {
        await say(room, again, { t: 'ack', tick });
        if (tick % 20 === 19) await say(room, again, { t: 'hash', tick, h: 7 });
      }
      expect(again.closed).toBeNull();
      // ...but the same ack over and over is not progress, and is charged.
      for (let i = 0; i <= SOCKET_BUDGET.burst; i++) await say(room, again, { t: 'ack', tick: 9 });
      expect(again.closed?.code).toBe(1008);
      expect(ws1.closed?.code).toBe(4000);   // the replaced socket
    });
  });

  it('closes a socket whose first message is not a hello', async () => {
    const { room } = await created();
    const ws = openSocket(room);
    await say(room, ws, { t: 'ready' });
    expect(msgs(ws)).toEqual([{ t: 'error', code: 'bad_ticket' }]);
    expect(ws.closed?.code).toBe(4001);
  });

  it('refuses a ticket signed for another match, and seats nobody', async () => {
    const { state, room } = await created();
    const ws = await hello(room, 0, await ticket(0, 'ZZZZZZ'));
    expect(msgs(ws)).toEqual([{ t: 'error', code: 'bad_ticket' }]);
    expect(ws.closed?.code).toBe(4001);
    expect((await persisted(state)).seats).toEqual([null, null]);
  });

  it('refuses a client built from something else', async () => {
    const { room } = await created();
    const ws = await hello(room, 0, undefined, 'b2');
    expect(msgs(ws)).toEqual([{ t: 'error', code: 'build_mismatch' }]);
    expect(ws.closed?.code).toBe(4002);
  });

  it('starts when both seats are ready: one start, to both, with the map and build /create fixed', async () => {
    const { ws0, ws1 } = await running();
    for (const ws of [ws0, ws1]) {
      const starts = ofType(ws, 'start');
      expect(starts).toHaveLength(1);
      expect(starts[0].config).toMatchObject({ matchId: CODE, code: CODE, map: 'tel_marum', build: BUILD, mode: 'sandbox' });
      expect(starts[0].config.seats.map((s) => s.callsign)).toEqual(['Host', 'Guest']);
    }
  });

  it('a versus room puts seat 1 on side 1, both on kdf, with the callsigns sent at create and join', async () => {
    const { ws0, ws1 } = await running({ mode: 'versus' });
    for (const ws of [ws0, ws1]) {
      const [start] = ofType(ws, 'start');
      expect(start.config.mode).toBe('versus');
      expect(start.config.seats.map((s) => s.side)).toEqual([0, 1]);
      expect(start.config.seats.map((s) => s.faction)).toEqual(['kdf', 'kdf']);
      expect(start.config.seats.map((s) => s.callsign)).toEqual(['Host', 'Guest']);
    }
  });

  it('the host picks its side: sarim puts seat 0 on Sarim and seat 1 on the KDF, in the lobby and in the config (2026-10-14)', async () => {
    for (const [matchup, factions] of [['sarim', ['sarim', 'kdf']], ['kdf', ['kdf', 'sarim']], ['mirror', ['kdf', 'kdf']], ['nonsense', ['kdf', 'kdf']]] as const) {
      const { room } = await created(new FakeState(), { mode: 'versus', matchup });
      const ws0 = await hello(room, 0);
      const ws1 = await hello(room, 1);
      expect(ofType(ws1, 'lobby').at(-1)?.factions).toEqual(factions);
      await say(room, ws0, { t: 'ready' });
      await say(room, ws1, { t: 'ready' });
      for (const ws of [ws0, ws1]) {
        const [start] = ofType(ws, 'start');
        expect(start.config.seats.map((s) => s.faction)).toEqual(factions);
        expect(start.config.seats.map((s) => s.side)).toEqual([0, 1]);
      }
    }
  });

  it('the room refuses a non-mirror matchup on any map but Tel Marum, and makes no room (the lead, 2026-10-14)', async () => {
    for (const [map, matchup, status] of [['beit_sahwan_outskirts', 'sarim', 400], ['qarn_hadid', 'kdf', 400], ['beit_sahwan_outskirts', 'mirror', 200], ['tel_marum', 'sarim', 200]] as const) {
      const state = new FakeState();
      const room = new MatchRoom(state, env);
      const res = await room.fetch(new Request('https://room/create', {
        method: 'POST',
        body: JSON.stringify({ code: CODE, matchId: CODE, map, build: BUILD, player: 'p-host', callsign: 'Host', mode: 'versus', matchup }),
      }));
      expect(res.status).toBe(status);
      expect((await state.storage.get('state')) === undefined).toBe(status === 400);
    }
  });

  it('the room refuses a versus create on any map not measured fair, and makes no room (#561, the lead, 2026-10-14)', async () => {
    for (const [map, mode, status] of [
      ['qarn_hadid', 'versus', 400], ['wadi_halam_basin', 'versus', 400], ['tel_marum_3', 'versus', 400],
      ['beit_sahwan_outskirts', 'versus', 200], ['tel_marum', 'versus', 200],
      // A sandbox room is two humans on one side: not limited.
      ['qarn_hadid', 'sandbox', 200],
    ] as const) {
      const state = new FakeState();
      const room = new MatchRoom(state, env);
      const res = await room.fetch(new Request('https://room/create', {
        method: 'POST',
        body: JSON.stringify({ code: CODE, matchId: CODE, map, build: BUILD, player: 'p-host', callsign: 'Host', mode }),
      }));
      expect(res.status, `${map} ${mode}`).toBe(status);
      expect((await state.storage.get('state')) === undefined, `${map} ${mode}`).toBe(status === 400);
      if (status === 400) expect(await res.text()).toBe('map not offered for versus');
    }
  });

  it('a sandbox room is the KDF mirror whatever the create asked for', async () => {
    const { ws0 } = await running({ matchup: 'sarim' });
    expect(ofType(ws0, 'lobby').at(-1)?.factions).toEqual(['kdf', 'kdf']);
    expect(ofType(ws0, 'start')[0].config.seats.map((s) => s.faction)).toEqual(['kdf', 'kdf']);
  });

  it('a room persisted before the matchup existed revives as the mirror', async () => {
    const { state, room } = await created(new FakeState(), { mode: 'versus', matchup: 'sarim' });
    await hello(room, 0);
    const stored = (await state.storage.get<Record<string, unknown>>('state')) ?? {};
    delete stored.factions;
    await state.storage.put('state', stored);
    evict();
    const revived = new MatchRoom(state, env);
    const ws = await hello(revived, 1);
    expect(ofType(ws, 'lobby').at(-1)?.factions).toEqual(['kdf', 'kdf']);
  });

  it('start carries per-match seat tokens: 16 hex, one per seat, never either player id (N1b task 12)', async () => {
    for (const mode of ['versus', 'sandbox']) {
      const { ws0, ws1 } = await running({ mode });
      for (const ws of [ws0, ws1]) {
        const raw = JSON.stringify(ofType(ws, 'start')[0]);
        expect(raw.includes('p-host')).toBe(false);
        expect(raw.includes('p-guest')).toBe(false);
        const [a, b] = ofType(ws, 'start')[0].config.seats.map((s) => s.player);
        expect(a).toMatch(/^[0-9a-f]{16}$/);
        expect(b).toMatch(/^[0-9a-f]{16}$/);
        expect(a).not.toBe(b);
      }
      // Both seats of one match see the same two tokens.
      expect(ofType(ws1, 'start')[0].config.seats.map((s) => s.player)).toEqual(ofType(ws0, 'start')[0].config.seats.map((s) => s.player));
    }
  });

  it('two rooms mint different tokens, and the real ids stay inside the room', async () => {
    const a = await running({ mode: 'versus' });
    const b = await running({ mode: 'versus' });
    const tokens = (r: { ws0: FakeSocket }): string[] => ofType(r.ws0, 'start')[0].config.seats.map((s) => s.player);
    expect(tokens(a).some((t) => tokens(b).includes(t))).toBe(false);
    // The tickets' ids are still what the room seats on.
    const st = await persisted(a.state);
    expect(st.seats.map((s) => s?.player)).toEqual(['p-host', 'p-guest']);
  });

  it('a reconnecting seat gets the SAME tokens in its log, and a late hello never sees an id', async () => {
    const { state, ws0 } = await running({ mode: 'versus' });
    const tokens = ofType(ws0, 'start')[0].config.seats.map((s) => s.player);
    evict();
    const revived = new MatchRoom(state, env);
    const back = await hello(revived, 1);
    const [log] = ofType(back, 'log');
    expect(log.config.seats.map((s) => s.player)).toEqual(tokens);
    expect(JSON.stringify(log).includes('p-guest')).toBe(false);
    expect(JSON.stringify(log).includes('p-host')).toBe(false);
  });

  it('a room persisted before tokens existed mints them lazily at start, stable in the log', async () => {
    const { state, room } = await created(new FakeState(), { mode: 'versus' });
    await hello(room, 0);
    await hello(room, 1);
    const meta = state.storage.kv.get('meta') as Record<string, unknown>;
    expect(meta.tokens).toHaveLength(2);
    delete meta.tokens;
    state.storage.kv.set('meta', meta);
    evict();
    const revived = new MatchRoom(state, env);
    const ws0 = await hello(revived, 0);
    const ws1 = await hello(revived, 1);
    await say(revived, ws0, { t: 'ready' });
    await say(revived, ws1, { t: 'ready' });
    const tokens = ofType(ws0, 'start')[0].config.seats.map((s) => s.player);
    expect(tokens.every((t) => /^[0-9a-f]{16}$/.test(t))).toBe(true);
    expect(JSON.stringify(ofType(ws0, 'start')[0]).includes('p-host')).toBe(false);
    evict();
    const again = new MatchRoom(state, env);
    const back = await hello(again, 0);
    expect(ofType(back, 'log')[0].config.seats.map((s) => s.player)).toEqual(tokens);
  });

  it('two versus rooms created in a row mint different seeds, and both seeds are valid config seeds', async () => {
    const a = await running({ mode: 'versus' });
    const b = await running({ mode: 'versus' });
    const seedA = ofType(a.ws0, 'start')[0].config.seed;
    const seedB = ofType(b.ws0, 'start')[0].config.seed;
    expect(Number.isInteger(seedA) && Number.isInteger(seedB)).toBe(true);
    expect(seedA).not.toBe(seedB);
    // Both seats of one match carry the one seed.
    expect(ofType(a.ws1, 'start')[0].config.seed).toBe(seedA);
  });

  it('a sandbox room keeps N0: both seats on side 0, seed 20260727', async () => {
    const { ws0 } = await running();
    const [start] = ofType(ws0, 'start');
    expect(start.config.mode).toBe('sandbox');
    expect(start.config.seats.map((s) => s.side)).toEqual([0, 0]);
    expect(start.config.seed).toBe(20260727);
    const explicit = await running({ mode: 'sandbox' });
    expect(ofType(explicit.ws0, 'start')[0].config.seed).toBe(20260727);
  });

  it('an unknown mode is a sandbox, and /create refuses an empty player', async () => {
    const { ws0 } = await running({ mode: 'conquest' });
    expect(ofType(ws0, 'start')[0].config.mode).toBe('sandbox');
    const room = new MatchRoom(new FakeState(), env);
    for (const player of [undefined, '', 7]) {
      const res = await room.fetch(new Request('https://room/create', { method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, build: BUILD, ...(player === undefined ? {} : { player }) }) }));
      expect(res.status).toBe(400);
    }
    expect((await room.fetch(new Request('https://room/state'))).status).toBe(404);
  });

  it('a rejoin shows the callsign the room holds, whatever player id the new ticket carries', async () => {
    const { room } = await created(new FakeState(), { mode: 'versus' });
    await hello(room, 1);
    const again = await hello(room, 1, await ticket(1, CODE, 'p-guest-other-tab'));
    expect(ofType(again, 'lobby').at(-1)?.seats).toEqual([{ seat: 1, callsign: 'Guest', connected: true, ready: false }]);
  });

  it('a callsign handed to the room directly is cleaned too: the lobby and the config never carry a control or bidi character', async () => {
    const room = new MatchRoom(new FakeState(), env);
    await room.fetch(new Request('https://room/create', {
      method: 'POST',
      body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', build: BUILD, player: 'p-host', callsign: 'Ho\u202Est\u0000', mode: 'versus' }),
    }));
    await room.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: 'p-guest', callsign: ' Gu\u200Best\n' + 'z'.repeat(40) }) }));
    const ws0 = await hello(room, 0);
    const ws1 = await hello(room, 1);
    expect(ofType(ws0, 'lobby').at(-1)?.seats.map((s) => s.callsign)).toEqual(['Host', 'Guest '+'z'.repeat(18)]);
    await say(room, ws0, { t: 'ready' });
    await say(room, ws1, { t: 'ready' });
    const start = ofType(ws0, 'start')[0];
    expect(start.config.seats.map((s) => s.callsign)).toEqual(['Host', 'Guest '+'z'.repeat(18)]);
  });

  it('two concurrent /join calls: exactly one gets seat 1, the other 409 (the check-and-set is synchronous)', async () => {
    const { room } = await created(new FakeState(), { join: false });
    // A body that yields before it is read, so an await between the check and the write cannot go unnoticed.
    const join = (callsign: string) => {
      const req = new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: `p-${callsign}`, callsign }) });
      const json = req.json.bind(req);
      req.json = async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); return json(); };
      return room.fetch(req);
    };
    const settled = Promise.all([join('A'), join('B')]);
    await vi.advanceTimersByTimeAsync(5);
    const statuses = (await settled).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('two concurrent /create calls: exactly one makes the room, the other 409 (N1a final review)', async () => {
    const room = new MatchRoom(new FakeState(), env);
    // As the /join case: a body that yields before it is read, so a check made before the read cannot pass.
    const create = (callsign: string) => {
      const req = new Request('https://room/create', {
        method: 'POST',
        body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', build: BUILD, player: `p-${callsign}`, callsign }),
      });
      const json = req.json.bind(req);
      req.json = async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); return json(); };
      return room.fetch(req);
    };
    const settled = Promise.all([create('A'), create('B')]);
    await vi.advanceTimersByTimeAsync(5);
    const statuses = (await settled).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('a versus room keeps its seed across an eviction: the revived room starts the same match', async () => {
    const { state, room } = await created(new FakeState(), { mode: 'versus' });
    const meta = state.storage.kv.get('meta') as { seed: number; mode: string };
    expect(meta.mode).toBe('versus');
    await hello(room, 0);
    await hello(room, 1);
    evict();
    const revived = new MatchRoom(state, env);
    const ws0 = await hello(revived, 0);
    const ws1 = await hello(revived, 1);
    await say(revived, ws0, { t: 'ready' });
    await say(revived, ws1, { t: 'ready' });
    const [start] = ofType(ws0, 'start');
    expect(start.config.seed).toBe(meta.seed);
    expect(start.config.seats.map((s) => s.side)).toEqual([0, 1]);
  });

  it('the largest random draw mints seed -1, and that config still passes validateConfig', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((a: Uint32Array) => { a[0] = 0xFFFFFFFF; return a; }) as never);
    try {
      const { ws0 } = await running({ mode: 'versus' });
      const [start] = ofType(ws0, 'start');
      expect(start.config.seed).toBe(-1);
      expect(validateConfig(start.config)).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('a lobby persisted by N0 (no mode, seed or callsigns in its meta) revives as a sandbox, keeping the callsigns its seats held', async () => {
    const { state, room } = await created();
    await hello(room, 0);
    await hello(room, 1);
    state.storage.kv.set('meta', { map: 'tel_marum', build: BUILD, seat1Reserved: true });
    evict();
    const revived = new MatchRoom(state, env);
    const ws0 = await hello(revived, 0);
    const ws1 = await hello(revived, 1);
    expect(ofType(ws0, 'lobby').at(-1)?.seats.map((s) => s.callsign)).toEqual(['Host', 'Guest']);
    await say(revived, ws0, { t: 'ready' });
    await say(revived, ws1, { t: 'ready' });
    const [start] = ofType(ws0, 'start');
    expect(start.config).toMatchObject({ mode: 'sandbox', seed: 20260727 });
    expect(start.config.seats.map((s) => [s.side, s.callsign])).toEqual([[0, 'Host'], [0, 'Guest']]);
  });

  it('the clock sends a frame per 50 ms to both seats; a command frame closes its batch at once (R36), an empty batch closes at 20 ticks', async () => {
    const { state, room, ws0, ws1 } = await running();
    const halt = [{ seat: 0, seq: 0, cmd: { kind: 'halt', ids: [3] } }];
    await say(room, ws0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [3] } });
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    for (const ws of [ws0, ws1]) {
      expect(ofType(ws, 'frame').map((f) => f.tick)).toEqual([0, 1, 2]);
      expect(ofType(ws, 'frame')[0].cmds).toEqual(halt);
    }
    // Tick 0 carried an order: its batch closed at it, and 1..2 are memory only.
    expect([...state.storage.batches.keys()]).toEqual([0]);
    expect(row(state, 0)).toEqual([{ tick: 0, cmds: halt }]);
    await vi.advanceTimersByTimeAsync((BATCH_TICKS - 2) * TICK_MS);   // ticks 3..20
    expect([...state.storage.batches.keys()]).toEqual([0, 1]);
    expect(row(state, 1).map((f) => f.tick)).toEqual([...Array(BATCH_TICKS).keys()].map((i) => i + 1));
    expect((await persisted(state)).tick).toBe(0);   // the state is written at the start, not per tick
  });

  it('write-through: the frame carrying an order is in a persisted row after one clock tick (R36)', async () => {
    const { state, room, ws0 } = await running();
    await vi.advanceTimersByTimeAsync(5 * TICK_MS);   // ticks 0..4, empty, memory only
    expect(state.storage.batches.size).toBe(0);
    await say(room, ws0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [7] } });
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const frames = [...state.storage.batches.values()].flatMap((t) => JSON.parse(t) as { tick: number; cmds: unknown[] }[]);
    expect(frames.filter((f) => f.cmds.length > 0)).toEqual([{ tick: 5, cmds: [{ seat: 0, seq: 0, cmd: { kind: 'halt', ids: [7] } }] }]);
  });

  it('a revived room re-mints only empty frames: its log holds every tick once, and the one order at the tick it was first minted', async () => {
    const { state, room, ws0 } = await running();
    await vi.advanceTimersByTimeAsync((BATCH_TICKS + 2) * TICK_MS);   // 0..19 closed by filling, 20..21 open
    await say(room, ws0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [9] } });
    await vi.advanceTimersByTimeAsync(4 * TICK_MS);   // 22 carries it and closes 20..22; 23..25 memory only
    const sent = ofType(ws0, 'frame').map((f) => ({ tick: f.tick, cmds: f.cmds }));
    expect(sent.map((f) => f.tick)).toEqual([...Array(26).keys()]);
    evict();   // the isolate dies; storage and the hibernated sockets survive
    const revived = new MatchRoom(state, env);
    await hello(revived, 1);   // a handler: the revived clock starts at the last persisted tick
    await vi.advanceTimersByTimeAsync(6 * TICK_MS);
    const [log] = ofType(await hello(revived, 0), 'log');
    const ticks = log.frames.map((f) => f.tick);
    expect(ticks).toEqual([...Array(ticks.length).keys()]);   // no tick twice, none missing
    expect(ticks.length).toBeGreaterThan(sent.length);
    expect(log.frames.filter((f) => f.cmds.length > 0)).toEqual([{ tick: 22, cmds: [{ seat: 0, seq: 0, cmd: { kind: 'halt', ids: [9] } }] }]);
    expect(log.frames.slice(0, sent.length)).toEqual(sent);   // the re-minted 23..25 equal the originals
  });

  it('the watchdog alarm runs only while the match runs, re-arms itself, and a bye aims it at the wipe (R38, #559 H-1)', async () => {
    const { state, room } = await created();
    const ws0 = await hello(room, 0);
    const ws1 = await hello(room, 1);
    expect(state.storage.alarmAt).toBe(TTL_AT);   // a lobby keeps only its TTL
    await say(room, ws0, { t: 'ready' });
    await say(room, ws1, { t: 'ready' });
    expect(state.storage.alarmAt).toBe(Date.now() + WATCHDOG_MS);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    await deliverAlarm(room, state.storage);
    expect(state.storage.alarmAt).toBe(Date.now() + WATCHDOG_MS);
    await say(room, ws0, { t: 'bye' });
    expect(state.storage.alarmAt).toBe(Date.now() + PURGE_AFTER_MS);
  });

  it('after an eviction the alarm alone restarts the clock from the last persisted batch, and re-arms (R38)', async () => {
    const { state, ws1 } = await running();
    const sent = BATCH_TICKS + 2;
    await vi.advanceTimersByTimeAsync(sent * TICK_MS);
    evict();
    const revived = new MatchRoom(state, env);
    await vi.advanceTimersByTimeAsync(4 * TICK_MS);
    expect(ofType(ws1, 'frame')).toHaveLength(sent);   // no handler, no clock
    await deliverAlarm(revived, state.storage);
    expect(state.storage.alarmAt).toBe(Date.now() + WATCHDOG_MS);
    await vi.advanceTimersByTimeAsync(2 * TICK_MS);
    expect(ofType(ws1, 'frame').slice(sent).map((f) => f.tick)).toEqual([BATCH_TICKS, BATCH_TICKS + 1]);
  });

  it('an abandoned match (both sockets closed, no bye) runs no clock and keeps only its TTL alarm; a hello brings the watchdog back', async () => {
    const { state, room, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    await deliverClose(room, ws0, 1006, 'abnormal');
    await deliverClose(room, ws1, 1006, 'abnormal');
    expect((await persisted(state)).seats.map((s) => s?.connected)).toEqual([false, false]);
    expect(state.storage.alarmAt).toBe(TTL_AT);
    expect(vi.getTimerCount()).toBe(0);
    evict();
    const revived = new MatchRoom(state, env);
    await deliverAlarm(revived, state.storage);
    expect(state.storage.alarmAt).toBe(TTL_AT);   // no watchdog: the room may sleep until its TTL
    expect(vi.getTimerCount()).toBe(0);
    const back = await hello(revived, 0);
    expect(state.storage.alarmAt).toBe(Date.now() + WATCHDOG_MS);
    expect(vi.getTimerCount()).toBe(1);
    expect(ofType(back, 'log')).toHaveLength(1);
  });

  it('a match evicted while armed, then abandoned in the revived instance: its alarm fires once and stops', async () => {
    const { state, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    evict();
    const revived = new MatchRoom(state, env);
    await deliverClose(revived, ws0, 1006, 'abnormal');
    await deliverClose(revived, ws1, 1006, 'abnormal');
    await deliverAlarm(revived, state.storage);
    expect(state.storage.alarmAt).toBe(TTL_AT);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('after a deploy drops every socket (no close delivered), the revived room marks both seats gone, writes the state and its TTL alarm, and wakes nothing', async () => {
    const { state, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    expect(state.storage.alarmAt).not.toBeNull();
    state.vanish(ws0, ws1);
    evict();
    const revived = new MatchRoom(state, env);
    const before = state.storage.rowsWritten;
    await deliverAlarm(revived, state.storage);
    expect((await persisted(state)).seats.map((s) => s?.connected)).toEqual([false, false]);
    expect(state.storage.rowsWritten - before).toBe(2);   // the state write that records both seats gone, and the TTL alarm
    expect(state.storage.alarmAt).toBe(TTL_AT);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('after a reset that kept seat 0 hibernated, the revived room keeps seat 0 and marks seat 1 gone', async () => {
    const { state, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    state.vanish(ws1);
    evict();
    const revived = new MatchRoom(state, env);
    await deliverAlarm(revived, state.storage);
    expect((await persisted(state)).seats.map((s) => s?.connected)).toEqual([true, false]);
    expect(last(ws0)).toEqual({ t: 'stall', reason: 'gone', seat: 1 });
    expect(state.storage.alarmAt).toBe(Date.now() + WATCHDOG_MS);   // seat 0 is still there: the room serves it
  });

  it('a match that ends in a revived instance (no clock of its own) re-aims the old instance\'s alarm at the wipe', async () => {
    const { state, ws0 } = await running();
    expect(state.storage.alarmAt).not.toBeNull();
    evict();
    const revived = new MatchRoom(state, env);
    vi.setSystemTime(Date.now() + 6 * 3600 * 1000 + 1);
    await say(revived, ws0, { t: 'ready' });   // any handler: the TTL ends the room
    expect((await persisted(state)).status).toBe('ended');
    expect(state.storage.alarmAt).toBe(Date.now() + PURGE_AFTER_MS);
  });

  it('a refused setAlarm is logged, never an unhandled rejection, and the match runs on', async () => {
    const { state, room } = await created();
    const ws0 = await hello(room, 0);
    const ws1 = await hello(room, 1);
    state.storage.setAlarm = (): Promise<void> => Promise.reject(new Error('over quota'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await say(room, ws0, { t: 'ready' });
      await say(room, ws1, { t: 'ready' });
      await vi.advanceTimersByTimeAsync(2 * TICK_MS);
      expect(logged).toHaveBeenCalledWith('MatchRoom: setAlarm failed', expect.any(Error));
      expect(ofType(ws1, 'frame').map((f) => f.tick)).toEqual([0, 1]);
    } finally {
      logged.mockRestore();
    }
  });

  it('#559 H-1/F2: a seat stuffing every command (a 4 KB pad, 32 a frame) leaves a few KB in storage, not megabytes', async () => {
    const { state, room, ws0, ws1 } = await running();
    const padded = (seq: number): string => {
      const base = { t: 'cmd', seq, cmd: { kind: 'halt', ids: [0], pad: '' } };
      base.cmd.pad = 'A'.repeat(4096 - JSON.stringify(base).length);
      return JSON.stringify(base);
    };
    let seq = 0;
    for (let tick = 0; tick < 20; tick++) {
      for (let i = 0; i < 32; i++) { await say(room, ws0, padded(seq)); await say(room, ws1, padded(seq)); seq++; }
      await vi.advanceTimersByTimeAsync(TICK_MS);
    }
    const bytes = [...state.storage.batches.values()].reduce((a, t) => a + t.length, 0);
    expect(bytes).toBeLessThan(16 * 1024);   // was 5.2 MiB for the same second of play
    expect([...state.storage.batches.values()].join('')).not.toContain('AAAA');
  });

  it('#559 H-1: a revived room counts the commands its log already holds against the cap', async () => {
    const { state, room, ws0 } = await running();
    await say(room, ws0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1, 2, 3] } });
    await vi.advanceTimersByTimeAsync(2 * TICK_MS);
    evict();
    const revived = new MatchRoom(state, env);
    await revived.fetch(new Request('https://room/state'));
    const st = (revived as unknown as { st: RoomState }).st;
    expect(st.cmdChars).toBe(JSON.stringify({ kind: 'halt', ids: [1, 2, 3] }).length);
  });

  describe('#559 H-1: storage exists only between /create and the wipe', () => {
    it('a probe of a code with no room -- /state, /join, a hello, a close, an alarm -- touches no storage at all', async () => {
      const state = new FakeState();
      const room = new MatchRoom(state, env);
      expect((await room.fetch(new Request('https://room/state'))).status).toBe(404);
      expect((await room.fetch(new Request('https://room/join', { method: 'POST', body: '{}' }))).status).toBe(404);
      const ws = await hello(room, 0);
      expect(msgs(ws)).toEqual([{ t: 'ended', reason: 'expired' }]);   // told, so a client stops reconnecting
      expect(ws.closed?.code).toBe(4004);
      await deliverClose(room, openSocket(room));
      await deliverAlarm(room, state.storage);
      expect(state.storage.hasTable).toBe(false);
      expect(state.storage.kv.size).toBe(0);
      expect(state.storage.rowsWritten).toBe(0);
      expect(state.storage.alarmAt).toBeNull();
    });

    it('/create makes the table and arms the TTL alarm', async () => {
      const { state } = await created();
      expect(state.storage.hasTable).toBe(true);
      expect(state.storage.alarmAt).toBe(TTL_AT);
    });

    it('a lobby nobody comes back to is ended at its TTL by the alarm alone, and wiped two minutes later', async () => {
      const { state } = await created();
      evict();
      vi.setSystemTime(TTL_AT);
      await deliverAlarm(new MatchRoom(state, env), state.storage);
      expect((await persisted(state))).toMatchObject({ status: 'ended', endedReason: 'expired', endedAtMs: TTL_AT });
      expect(state.storage.alarmAt).toBe(TTL_AT + PURGE_AFTER_MS);
      evict();
      vi.setSystemTime(TTL_AT + PURGE_AFTER_MS);
      await deliverAlarm(new MatchRoom(state, env), state.storage);
      expect(state.storage.kv.size + state.storage.batches.size).toBe(0);
      expect(state.storage.hasTable).toBe(false);
      expect(state.storage.alarmAt).toBeNull();
    });

    it('a match that ends by a bye is wiped two minutes later, frames and all; until then a late hello is told', async () => {
      const { state, room, ws0, ws1 } = await running();
      await say(room, ws0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1] } });
      await vi.advanceTimersByTimeAsync(30 * TICK_MS);
      await say(room, ws1, { t: 'bye' });
      expect(state.storage.batches.size).toBeGreaterThan(0);
      const endedAt = Date.now();
      vi.setSystemTime(endedAt + PURGE_AFTER_MS - 1);
      const late = await hello(room, 0);
      expect(last(late)).toEqual({ t: 'ended', reason: 'left', seat: 1 });
      vi.setSystemTime(endedAt + PURGE_AFTER_MS);
      await deliverAlarm(room, state.storage);
      expect(state.storage.kv.size + state.storage.batches.size).toBe(0);
      expect(state.storage.hasTable).toBe(false);
      // The code can be minted again: a fresh /create makes a fresh room.
      const again = await room.fetch(new Request('https://room/create', { method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, build: BUILD, player: 'p' }) }));
      expect(again.status).toBe(200);
      expect((await persisted(state)).status).toBe('lobby');
    });

    it('a desync writes its D1 row before the wipe, and the wipe keeps it', async () => {
      const db = openTestD1();
      const { state, room, ws0, ws1 } = await running({ db });
      await vi.advanceTimersByTimeAsync(25 * TICK_MS);
      await say(room, ws0, { t: 'hash', tick: 19, h: 1 });
      await say(room, ws1, { t: 'hash', tick: 19, h: 2 });
      vi.setSystemTime(Date.now() + PURGE_AFTER_MS);
      await deliverAlarm(room, state.storage);
      expect(state.storage.wipes).toBe(1);
      expect((db.raw.prepare('SELECT COUNT(*) AS n FROM match_desync').get() as { n: number }).n).toBe(1);
    });
  });

  it('a command frame is in storage before it is broadcast (R36: write, then send)', async () => {
    const { state, room, ws0, ws1 } = await running();
    const seen: [number, boolean][] = [];
    ws1.onSend((text) => {
      const m = JSON.parse(text) as ServerMsg;
      if (m.t === 'frame' && m.cmds.length > 0) {
        const stored = [...state.storage.batches.values()].some((t) => (JSON.parse(t) as { tick: number }[]).some((f) => f.tick === m.tick));
        seen.push([m.tick, stored]);
      }
    });
    await vi.advanceTimersByTimeAsync(2 * TICK_MS);
    await say(room, ws0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [4] } });
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(seen).toEqual([[2, true]]);
  });

  it('an alarm that reaches a lobby, an ended room or an expired one starts no clock, and aims at the TTL or the wipe', async () => {
    const { state, room } = await created();
    const ws0 = await hello(room, 0);
    await deliverAlarm(room, state.storage);
    expect(state.storage.alarmAt).toBe(TTL_AT);
    const ended = await running();
    await say(ended.room, ended.ws0, { t: 'bye' });
    const heard = ofType(ended.ws1, 'frame').length;
    const endedAt = Date.now();
    await deliverAlarm(ended.room, ended.state.storage);
    await vi.advanceTimersByTimeAsync(4 * TICK_MS);
    expect(ended.state.storage.alarmAt).toBe(endedAt + PURGE_AFTER_MS);
    expect(ofType(ended.ws1, 'frame')).toHaveLength(heard);
    // A running room whose instance was evicted, reached by its alarm after the TTL.
    const old = await running();
    evict();
    const revived = new MatchRoom(old.state, env);
    vi.setSystemTime(Date.now() + 6 * 3600 * 1000 + 1);
    await deliverAlarm(revived, old.state.storage);
    expect(last(old.ws0)).toEqual({ t: 'ended', reason: 'expired' });
    expect(old.state.storage.alarmAt).toBe(Date.now() + PURGE_AFTER_MS);
    expect(ofType(ws0, 'frame')).toEqual([]);
  });

  it('a versus seat gone 60 s forfeits, through an eviction too; a late hello with its ticket gets the log first, any other ticket the ending alone', async () => {
    const { state, room, ws0, ws1 } = await running({ mode: 'versus' });
    await vi.advanceTimersByTimeAsync(30 * TICK_MS);
    await deliverClose(room, ws1, 1006, 'gone');
    expect(last(ws0)).toMatchObject({ t: 'stall', reason: 'gone', seat: 1 });
    expect(ofType(ws0, 'dropped')).toEqual([{ t: 'dropped', seat: 1, remainingMs: 60_000 }]);
    evict();   // the clock dies with the isolate: the watchdog alarm brings it back, and the drop date was persisted
    const revived = new MatchRoom(state, env);
    vi.setSystemTime(Date.now() + 60_000);
    await deliverAlarm(revived, state.storage);
    expect(last(ws0)).toEqual({ t: 'ended', reason: 'forfeit', seat: 1 });
    expect((await persisted(state))).toMatchObject({ status: 'ended', endedReason: 'forfeit', surrendered: 1 });
    const late = await hello(revived, 1);
    expect(ofType(late, 'log')).toHaveLength(1);
    expect(ofType(late, 'log')[0].frames.length).toBeGreaterThan(0);
    expect(last(late)).toEqual({ t: 'ended', reason: 'forfeit', seat: 1 });
    expect(late.closed).toEqual({ code: 1000, reason: 'ended' });
    const forged = await hello(revived, 1, await signTicket(SECRET, { matchId: 'OTHER1', seat: 1, player: 'p-guest', exp: NOW + 3600 * 1000 }));
    expect(msgs(forged)).toEqual([{ t: 'ended', reason: 'forfeit', seat: 1 }]);
    const oldBuild = await hello(revived, 1, undefined, 'b0');
    expect(msgs(oldBuild)).toEqual([{ t: 'ended', reason: 'forfeit', seat: 1 }]);
  });

  it('both versus seats gone: no clock runs, the one alarm is aimed at the first forfeit, and it ends the match there (the seat gone longer loses)', async () => {
    const { state, room, ws0, ws1 } = await running({ mode: 'versus' });
    await vi.advanceTimersByTimeAsync(30 * TICK_MS);
    const firstDrop = Date.now();
    await deliverClose(room, ws0, 1006, 'gone');
    vi.setSystemTime(firstDrop + 10_000);
    await deliverClose(room, ws1, 1006, 'gone');
    expect(vi.getTimerCount()).toBe(0);
    expect(state.storage.alarmAt).toBe(firstDrop + 60_000);
    vi.setSystemTime(firstDrop + 60_000);
    await deliverAlarm(room, state.storage);
    expect((await persisted(state))).toMatchObject({ status: 'ended', endedReason: 'forfeit', surrendered: 0 });
    expect(state.storage.alarmAt).toBe(firstDrop + 60_000 + PURGE_AFTER_MS);   // then the wipe, as any ending
  });

  it('a surrender reaches both seats, survives an eviction, and a late hello is told who surrendered (N1b task 2)', async () => {
    const { state, room, ws0, ws1 } = await running();
    await say(room, ws1, { t: 'surrender' });
    expect(last(ws0)).toEqual({ t: 'ended', reason: 'surrender', seat: 1 });
    expect(last(ws1)).toEqual({ t: 'ended', reason: 'surrender', seat: 1 });
    evict();
    const revived = new MatchRoom(state, env);
    const late = await hello(revived, 0);
    expect(last(late)).toEqual({ t: 'ended', reason: 'surrender', seat: 1 });
  });

  it('a second hello for a seat replaces it: the old socket is closed, the new one gets the log, and the old close is ignored', async () => {
    const { state, room, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(2 * TICK_MS);
    const again = await hello(room, 0);
    expect(ws0.closed).toEqual({ code: 4000, reason: 'replaced' });
    expect(again.closed).toBeNull();
    const [log] = ofType(again, 'log');
    expect(log.frames.map((f) => f.tick)).toEqual([0, 1]);
    expect(log.config.map).toBe('tel_marum');
    // The runtime delivers the replaced socket's close AFTER the new one is live.
    await deliverClose(room, ws0, 4000, 'replaced');
    expect((await persisted(state)).seats[0]?.connected).toBe(true);
    expect(ofType(ws1, 'stall')).toEqual([]);
    // The live socket's own close does mark the seat gone.
    await deliverClose(room, again, 1001, 'tab closed');
    expect((await persisted(state)).seats[0]?.connected).toBe(false);
    expect(ofType(ws1, 'stall')).toEqual([{ t: 'stall', reason: 'gone', seat: 0 }]);
  });

  it('a replaced socket still CLOSING neither counts as the seat nor receives its broadcasts', async () => {
    const { state, room, ws0, ws1 } = await running();
    const again = await hello(room, 0);
    expect(ws0.closed?.code).toBe(4000);   // closed by the room, its close event not yet delivered
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(ofType(again, 'frame')).toHaveLength(1);
    expect(ws0.sendsAfterClose).toBe(0);
    // The replacement goes away while the old socket is still in getWebSockets().
    await deliverClose(room, again, 1001, 'tab closed');
    expect((await persisted(state)).seats[0]?.connected).toBe(false);
    expect(ofType(ws1, 'stall')).toEqual([{ t: 'stall', reason: 'gone', seat: 0 }]);
    // ...and the old socket's late close changes nothing.
    await deliverClose(room, ws0, 4000, 'replaced');
    expect(ofType(ws1, 'stall')).toHaveLength(1);
  });

  it('an error then a close for one socket marks its seat gone once: a replacement seated between them stays live', async () => {
    const { state, room, ws0, ws1 } = await running();
    await deliverError(room, ws0);
    expect((await persisted(state)).seats[0]?.connected).toBe(false);
    expect(ofType(ws1, 'stall')).toEqual([{ t: 'stall', reason: 'gone', seat: 0 }]);
    const again = await hello(room, 0);
    expect((await persisted(state)).seats[0]?.connected).toBe(true);
    // The same socket's close, delivered after the replacement is seated.
    await deliverClose(room, ws0, 1006, 'abnormal');
    expect((await persisted(state)).seats[0]?.connected).toBe(true);
    expect(ofType(ws1, 'stall')).toHaveLength(1);
    expect(again.closed).toBeNull();
  });

  it('a close the runtime delivers is answered with a close of our own (M2)', async () => {
    const { state, room, ws0, ws1 } = await running();
    // The client's close frame arrived; the room has not closed its end yet.
    expect(ws1.closed).toBeNull();
    await room.webSocketClose(ws1.asSocket() as WebSocket);
    expect(ws1.closed).toEqual({ code: 1000, reason: 'closed' });
    expect((await persisted(state)).seats[1]?.connected).toBe(false);
    // An error event closes too (it runs the same path).
    await room.webSocketError(ws0.asSocket() as WebSocket);
    expect(ws0.closed).toEqual({ code: 1000, reason: 'closed' });
  });

  it('#559 F5: /create refuses a map the game does not ship, and stores nothing', async () => {
    const state = new FakeState();
    const room = new MatchRoom(state, env);
    const res = await room.fetch(new Request('https://room/create', { method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, build: BUILD, player: 'p', map: '__proto__' }) }));
    expect(res.status).toBe(400);
    expect(state.storage.rowsWritten).toBe(0);
  });

  it('/create refuses an empty build, so the hello build check can never be off', async () => {
    const room = new MatchRoom(new FakeState(), env);
    const res = await room.fetch(new Request('https://room/create', { method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, player: 'p-host' }) }));
    expect(res.status).toBe(400);
    expect((await room.fetch(new Request('https://room/state'))).status).toBe(404);
  });

  it('a room whose meta was never written refuses every hello on build, even an empty one', async () => {
    const { state } = await created();
    state.storage.kv.delete('meta');
    const revived = new MatchRoom(state, env);
    for (const build of [BUILD, '']) {
      const ws = await hello(revived, 0, undefined, build);
      expect(msgs(ws)).toEqual([{ t: 'error', code: 'build_mismatch' }]);
    }
  });

  it('/join reserves seat 1 in storage: a second join is refused before any hello', async () => {
    const { state, room } = await created(new FakeState(), { join: false });
    const join = () => room.fetch(new Request('https://room/join', { method: 'POST', body: '{}' }));
    const first = await join();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ seat: 1 });
    expect((await join()).status).toBe(409);
    // ...and the reservation outlives the instance.
    const revived = new MatchRoom(state, env);
    expect((await revived.fetch(new Request('https://room/join', { method: 'POST', body: '{}' }))).status).toBe(409);
  });

  it('an expired lobby answers `ended expired` from any handler and refuses work (no clock, no alarm)', async () => {
    const { state, room } = await created(new FakeState(), { join: false });
    const ws0 = await hello(room, 0);
    vi.setSystemTime(NOW + 6 * 3600 * 1000 + 1);
    expect((await room.fetch(new Request('https://room/join', { method: 'POST', body: '{}' }))).status).toBe(410);
    expect(last(ws0)).toEqual({ t: 'ended', reason: 'expired' });
    const late = openSocket(room);
    await say(room, late, { t: 'hello', ticket: await ticket(1), build: BUILD });
    expect(msgs(late)).toEqual([{ t: 'ended', reason: 'expired' }]);
    expect(late.closed?.code).toBe(1000);
    await say(room, ws0, { t: 'ready' });
    expect((await persisted(state)).status).toBe('ended');
    expect(ofType(ws0, 'ended')).toHaveLength(1);
  });

  it('a lifecycle write flushes the open batch: a room evicted during a stall loses no frame', async () => {
    const { state, room, ws0, ws1 } = await running();
    const sent = BATCH_TICKS + 5;
    await vi.advanceTimersByTimeAsync(sent * TICK_MS);
    await deliverClose(room, ws1, 1006, 'abnormal');   // seat 1 gone: the room stalls and writes its state
    expect(ofType(ws0, 'stall')).toEqual([{ t: 'stall', reason: 'gone', seat: 1 }]);
    evict();   // the isolate dies; storage and the hibernated sockets survive
    const revived = new MatchRoom(state, env);
    const back = await hello(revived, 1);
    const [log] = ofType(back, 'log');
    expect(log.frames.map((f) => f.tick)).toEqual([...Array(sent).keys()]);
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(ofType(ws0, 'frame').slice(sent).map((f) => f.tick)).toEqual([sent]);   // resumed where it stalled
  });

  const wakers: [string, (room: MatchRoom, ws0: FakeSocket) => Promise<unknown>][] = [
    ['fetch /state', (room) => room.fetch(new Request('https://room/state'))],
    ['a malformed message (an early return)', (room, ws0) => say(room, ws0, 'nope')],
    ['the close of a seatless socket (an early return)', async (room) => {
      await deliverClose(room, openSocket(room));
    }],
  ];
  it.each(wakers)('after an eviction, %s restarts the clock from the last persisted batch', async (_name, wake) => {
    const { state, ws0, ws1 } = await running();
    const sent = BATCH_TICKS + 2;   // one closed batch, and two frames only memory held
    await vi.advanceTimersByTimeAsync(sent * TICK_MS);
    expect(ofType(ws1, 'frame').map((f) => f.tick)).toEqual([...Array(sent).keys()]);
    evict();   // the isolate dies; storage and the hibernated sockets survive
    const revived = new MatchRoom(state, env);
    await vi.advanceTimersByTimeAsync(4 * TICK_MS);
    expect(ofType(ws1, 'frame')).toHaveLength(sent);   // nothing runs a clock until a handler does
    await wake(revived, ws0);
    await vi.advanceTimersByTimeAsync(2 * TICK_MS);
    // The two unpersisted ticks are sent again: a client drops them as duplicates.
    expect(ofType(ws1, 'frame').slice(sent).map((f) => f.tick)).toEqual([BATCH_TICKS, BATCH_TICKS + 1]);
    expect(ofType(ws1, 'stall')).toEqual([]);
    expect([...state.storage.batches.keys()]).toEqual([0]);
  });

  describe('N1b: the map and the desync log', () => {
    it('a lobby message after /create carries the map the room was created with', async () => {
      const { room } = await created();
      const ws0 = await hello(room, 0);
      const lobby = ofType(ws0, 'lobby').at(-1);
      expect(lobby?.map).toBe('tel_marum');
    });

    it('a room persisted before the map was stored takes it from its meta on revive', async () => {
      const { state } = await created();
      const st = await persisted(state);
      const stale: Partial<RoomState> = st;
      delete stale.map;
      await state.storage.put('state', st);
      const revived = new MatchRoom(state, env);
      const ws0 = await hello(revived, 0);
      expect(ofType(ws0, 'lobby').at(-1)?.map).toBe('tel_marum');
    });

    it('two different hashes for one tick write exactly one match_desync row naming it', async () => {
      const db = openTestD1();
      const { room, ws0, ws1 } = await running({ db });
      await vi.advanceTimersByTimeAsync(20 * TICK_MS);   // tick 19 minted: a hash may name it (#559 M-2)
      await say(room, ws0, { t: 'hash', tick: 19, h: 111 });
      await say(room, ws1, { t: 'hash', tick: 19, h: 222 });
      const rows = db.raw.prepare('SELECT code, tick, hash_a, hash_b, config, frames, frame_count FROM match_desync').all() as { code: string; tick: number; hash_a: number; hash_b: number; config: string; frames: string; frame_count: number }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ code: CODE, tick: 19, hash_a: 111, hash_b: 222 });
      expect((JSON.parse(rows[0].config) as { code: string }).code).toBe(CODE);
      expect(JSON.parse(rows[0].frames)).toEqual({ last: 19, orders: [] });
      expect(rows[0].frame_count).toBe(20);
    });

    it('the row carries the order-bearing frames that came before the desync', async () => {
      const db = openTestD1();
      const { room, ws0, ws1 } = await running({ db });
      await say(room, ws0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [3] } });
      await vi.advanceTimersByTimeAsync(20 * TICK_MS);
      await say(room, ws0, { t: 'hash', tick: 19, h: 1 });
      await say(room, ws1, { t: 'hash', tick: 19, h: 2 });
      const r = db.raw.prepare('SELECT frames, frame_count FROM match_desync').get() as { frames: string; frame_count: number };
      const log = JSON.parse(r.frames) as { last: number; orders: { tick: number; cmds: { seat: number; cmd: { kind: string; ids: number[] } }[] }[] };
      expect(r.frame_count).toBeGreaterThanOrEqual(3);
      expect(log.last).toBe(r.frame_count - 1);
      expect(log.orders).toHaveLength(1);
      expect(log.orders[0].cmds[0]).toMatchObject({ seat: 0, cmd: { kind: 'halt', ids: [3] } });
    });

    it('the desync handler waits for the D1 write (an unawaited call can be cancelled on hibernation)', async () => {
      const db = openTestD1();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => { release = r; });
      const slow: D1Like = {
        ...db,
        prepare: (sql) => {
          const stmt = db.prepare(sql);
          const gated = (bound: ReturnType<D1Like['prepare']>): ReturnType<D1Like['prepare']> => ({
            ...bound, bind: (...v) => gated(bound.bind(...v)), run: async () => { await gate; return bound.run(); },
          });
          return gated(stmt);
        },
      };
      const { room, ws0, ws1 } = await running({ db: slow });
      await vi.advanceTimersByTimeAsync(20 * TICK_MS);
      await say(room, ws0, { t: 'hash', tick: 19, h: 1 });
      let done = false;
      const second = say(room, ws1, { t: 'hash', tick: 19, h: 2 }).then(() => { done = true; });
      await settle();
      expect(ofType(ws0, 'desync')).toHaveLength(1);   // the sends went out first
      expect(done).toBe(false);                        // ... but the handler is still waiting on D1
      release();
      await second;
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM match_desync').get()).toEqual({ n: 1 });
    });

    it('#559 M-2/L-2: a forged pair for a far-future tick voids nothing and writes no row', async () => {
      const db = openTestD1();
      const { state, room, ws0, ws1 } = await running({ db });
      await vi.advanceTimersByTimeAsync(20 * TICK_MS);
      await say(room, ws0, { t: 'hash', tick: 999_999, h: 1 });
      await say(room, ws1, { t: 'hash', tick: 999_999, h: 2 });
      await settle();
      expect(ofType(ws0, 'desync')).toEqual([]);
      expect((await persisted(state)).status).toBe('running');
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM match_desync').get()).toEqual({ n: 0 });
    });

    it('equal hashes write nothing', async () => {
      const db = openTestD1();
      const { room, ws0, ws1 } = await running({ db });
      await vi.advanceTimersByTimeAsync(20 * TICK_MS);
      await say(room, ws0, { t: 'hash', tick: 19, h: 5 });
      await say(room, ws1, { t: 'hash', tick: 19, h: 5 });
      await settle();
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM match_desync').get()).toEqual({ n: 0 });
    });

    it('a failing log write never breaks the room: both seats still hear the desync', async () => {
      const db = openTestD1();
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const broken: D1Like = { ...db, prepare: () => { throw new Error('d1 down'); } };
      const { room, ws0, ws1 } = await running({ db: broken });
      await vi.advanceTimersByTimeAsync(20 * TICK_MS);
      await say(room, ws0, { t: 'hash', tick: 19, h: 1 });
      await say(room, ws1, { t: 'hash', tick: 19, h: 2 });
      await settle();
      expect(ofType(ws0, 'desync')).toHaveLength(1);
      expect(ofType(ws1, 'desync')).toHaveLength(1);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });
  });
});

describe('the room closes itself 2 minutes after the result (L-1, R-B26)', () => {
  /** A hash tick early in the match: the frames up to it are minted within 0.3 s. */
  const RESULT_TICK = 5;
  /** Both seats report the same result tick at the current time, once the room
   *  has minted it (a report of an unminted tick is ignored); returns the deadline. */
  async function bothOver(room: MatchRoom, ws0: FakeSocket, ws1: FakeSocket, tick = RESULT_TICK): Promise<number> {
    await vi.advanceTimersByTimeAsync((tick + 1) * TICK_MS);
    await say(room, ws0, { t: 'over', tick });
    await say(room, ws1, { t: 'over', tick });
    return Date.now() + OVER_CLOSE_MS;
  }

  it('closes at +120 s to the tick: ended over to both, both sockets shut normally, then no clock, one alarm at the wipe, and the wipe (#559 H-1)', async () => {
    const { state, room, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(10 * TICK_MS);
    const closeAt = await bothOver(room, ws0, ws1);
    expect((await persisted(state)).closeAtMs).toBe(closeAt);   // armed, and written: it survives an eviction
    await vi.advanceTimersByTimeAsync(closeAt - Date.now() - TICK_MS);
    expect(ofType(ws0, 'ended')).toEqual([]);   // one tick before the deadline: still open
    expect(ws0.closed).toBeNull();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(Date.now()).toBe(closeAt);
    for (const ws of [ws0, ws1]) {
      expect(last(ws)).toEqual({ t: 'ended', reason: 'over' });
      expect(ws.closed).toEqual({ code: 1000, reason: 'ended' });
    }
    expect((await persisted(state))).toMatchObject({ status: 'ended', endedReason: 'over', endedAtMs: closeAt });
    expect(state.storage.alarmAt).toBe(closeAt + PURGE_AFTER_MS);
    expect(vi.getTimerCount()).toBe(0);
    // After the close: the runtime delivers both closes, a stray early alarm and a late hello arrive.
    // The early alarm only re-aims at the wipe (one row); nothing else is written.
    const rows = state.storage.rowsWritten;
    const sent = [ws0.sent.length, ws1.sent.length];
    await deliverClose(room, ws0);
    await deliverClose(room, ws1);
    await deliverAlarm(room, state.storage);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(state.storage.rowsWritten - rows).toBe(1);
    expect([ws0.sent.length, ws1.sent.length]).toEqual(sent);
    expect(state.storage.alarmAt).toBe(closeAt + PURGE_AFTER_MS);
    expect(vi.getTimerCount()).toBe(0);
    const late = await hello(room, 1);
    expect(last(late)).toEqual({ t: 'ended', reason: 'over' });   // a seat that missed it is told, inside the grace
    expect(state.storage.rowsWritten - rows).toBe(1);
    // The wipe: every key and frame row, and the alarm. Then the code is no room at all.
    vi.setSystemTime(closeAt + PURGE_AFTER_MS);
    await deliverAlarm(room, state.storage);
    expect(state.storage.wipes).toBe(1);
    expect(state.storage.kv.size).toBe(0);
    expect(state.storage.batches.size).toBe(0);
    expect(state.storage.hasTable).toBe(false);
    expect(state.storage.alarmAt).toBeNull();
    expect(late.closed?.code).toBe(1000);
    const after = await hello(room, 1);
    expect(msgs(after)).toEqual([{ t: 'ended', reason: 'expired' }]);
    expect(after.closed?.code).toBe(4004);
    expect((await room.fetch(new Request('https://room/state'))).status).toBe(404);
  });

  it('one seat reports while the other is gone: the rejoined seat reports the same result and the close fires two minutes after it (#559 L-1)', async () => {
    const { room, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync((RESULT_TICK + 1) * TICK_MS);
    await deliverClose(room, ws1, 1006, 'abnormal');
    await say(room, ws0, { t: 'over', tick: RESULT_TICK });
    await vi.advanceTimersByTimeAsync(30_000);
    const back = await hello(room, 1);
    expect(ofType(back, 'log')).toHaveLength(1);
    await say(room, back, { t: 'over', tick: RESULT_TICK });   // as WsTransport repeats its report after a log
    const closeAt = Date.now() + OVER_CLOSE_MS;
    await vi.advanceTimersByTimeAsync(closeAt - Date.now() - TICK_MS);
    expect(ofType(ws0, 'ended')).toEqual([]);
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(last(ws0)).toEqual({ t: 'ended', reason: 'over' });
    expect(last(back)).toEqual({ t: 'ended', reason: 'over' });
  });

  it('#559 L-1: an early over from one seat and a one-second blip of the other end nothing', async () => {
    const { room, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(TICK_MS * 5);
    await say(room, ws1, { t: 'over', tick: 1 });
    await deliverClose(room, ws0);
    const back = await hello(room, 0);
    await vi.advanceTimersByTimeAsync(121_000);
    expect(ofType(back, 'ended')).toEqual([]);
    expect(ofType(ws1, 'ended')).toEqual([]);
  });

  it('two different ticks never close the room', async () => {
    const { state, room, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(30 * TICK_MS);
    await say(room, ws0, { t: 'over', tick: RESULT_TICK });
    await say(room, ws1, { t: 'over', tick: RESULT_TICK + 20 });
    await vi.advanceTimersByTimeAsync(2 * OVER_CLOSE_MS);
    expect(ofType(ws0, 'ended')).toEqual([]);
    expect((await persisted(state)).closeAtMs).toBeNull();
  });

  it('the alarm is aimed at the deadline: evicted with no clock, the room still closes at +120 s exactly, by the alarm alone', async () => {
    const { state, room, ws0, ws1 } = await running();
    // Off the watchdog's 5 s grid, so a watchdog that merely kept its period would miss the deadline.
    await vi.advanceTimersByTimeAsync(1234);
    const closeAt = await bothOver(room, ws0, ws1);
    expect((closeAt - NOW) % WATCHDOG_MS).not.toBe(0);
    let instance = room;
    const wakes: number[] = [];
    // The isolate dies after every wake: only the storage alarm brings the room back.
    for (let i = 0; i < 100 && state.storage.alarmAt !== null && ofType(ws0, 'ended').length === 0; i++) {
      evict();
      instance = new MatchRoom(state, env);
      vi.setSystemTime(state.storage.alarmAt);
      wakes.push(Date.now());
      await deliverAlarm(instance, state.storage);
    }
    expect(wakes.at(-1)).toBe(closeAt);   // the last wake is the deadline itself, not the next 5 s watchdog
    expect(wakes.every((t, i) => i === 0 || t - wakes[i - 1] <= WATCHDOG_MS)).toBe(true);
    expect(last(ws0)).toEqual({ t: 'ended', reason: 'over' });
    expect(last(ws1)).toEqual({ t: 'ended', reason: 'over' });
    expect((await persisted(state)).endedReason).toBe('over');
    expect(state.storage.alarmAt).toBe(closeAt + PURGE_AFTER_MS);   // the wipe, next
    evict();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('both seats gone after the result: no clock, one alarm at the deadline, and the room ends with nobody there', async () => {
    const { state, room, ws0, ws1 } = await running();
    const closeAt = await bothOver(room, ws0, ws1);
    await deliverClose(room, ws0, 1006, 'abnormal');
    await deliverClose(room, ws1, 1006, 'abnormal');
    expect(vi.getTimerCount()).toBe(0);   // abandoned: no clock
    expect(state.storage.alarmAt).toBe(closeAt);   // but the deadline still wakes it
    evict();
    const revived = new MatchRoom(state, env);
    // A wake before the deadline (an alarm left from before) re-aims it rather than losing it.
    vi.setSystemTime(closeAt - 10_000);
    await deliverAlarm(revived, state.storage);
    expect(state.storage.alarmAt).toBe(closeAt);
    expect((await persisted(state)).endedReason).toBeNull();
    const rows = state.storage.rowsWritten;
    vi.setSystemTime(closeAt);
    await deliverAlarm(revived, state.storage);
    expect((await persisted(state))).toMatchObject({ status: 'ended', endedReason: 'over' });
    expect(state.storage.rowsWritten - rows).toBe(2);   // the ended state, and the alarm re-aimed at the wipe
    expect(state.storage.alarmAt).toBe(closeAt + PURGE_AFTER_MS);
    expect(vi.getTimerCount()).toBe(0);
    const late = await hello(revived, 0);
    expect(last(late)).toEqual({ t: 'ended', reason: 'over' });
  });
});
