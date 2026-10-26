/**
 * The real `MatchRoom` over a fake Durable Object runtime (`fake-do.ts`, R19):
 * it replaces the plan's `wrangler dev` smoke. Sockets enter through
 * `acceptSocket`, the half of `/ws` that runs under node -- a
 * `WebSocketPair` and a 101 `Response` exist only in workerd.
 */
import { setImmediate as realImmediate } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OVER_CLOSE_MS, sha256Hex, validateConfig, type AdvisorMsg, type AdvisorScope, type ServerMsg, type Seat } from '@lions/net';
import type { D1Like, Env } from '../d1';
import { openTestD1 } from '../test-d1';
import { FakeState, deliverAlarm, deliverClose, deliverError, openSocket, type FakeSocket } from './fake-do';
import { ADVISOR_MIN_GAP_MS, BATCH_TICKS, HELLO_TIMEOUT_MS, MAX_ROOM_SOCKETS, MatchRoom, PURGE_AFTER_MS, SOCKET_BUDGET, TICK_MS, WATCHDOG_MS } from './match-room';
import { ROOM_TTL_MS } from './room-core';
import type { RoomState } from './room-core';
import { signTicket } from './ticket';
import { gzip, maxSizeBomb, snapshotBytes } from './snapshot-fixture';
import type { PendingBook, ReservationBook } from './snapshot-intake';

const NOW = 1_790_000_000_000;
/** The tests run on fake timers, which never fire the inflate's zero-delay timer turn: a real event-loop turn stands in. */
const YIELD = { inflateYield: (): Promise<void> => realImmediate() };
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

interface CreateOpts { mode?: string; join?: boolean; code?: string; db?: D1Like; matchup?: string; snapshotEveryTicks?: number; kind?: string; pace?: unknown; joinKind?: string; kit?: unknown; tiers?: unknown; joinTiers?: unknown }
/** Creates the room and, unless `join: false`, has the guest reserve seat 1 as the Worker does. */
async function created(state = new FakeState(), opts: CreateOpts = {}): Promise<{ state: FakeState; room: MatchRoom }> {
  const room = new MatchRoom(state, opts.db ? ({ ...env, DB: opts.db } as Env) : env, opts.snapshotEveryTicks === undefined ? YIELD : { ...YIELD, snapshotEveryTicks: opts.snapshotEveryTicks });
  const res = await room.fetch(new Request('https://room/create', {
    method: 'POST',
    body: JSON.stringify({ code: opts.code ?? CODE, matchId: opts.code ?? CODE, map: 'tel_marum', build: BUILD, player: 'p-host', callsign: 'Host', ...(opts.mode ? { mode: opts.mode } : {}), ...(opts.matchup ? { matchup: opts.matchup } : {}), ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.pace ? { pace: opts.pace } : {}), ...(opts.kit !== undefined ? { kit: opts.kit } : {}), ...(opts.tiers !== undefined ? { tiers: opts.tiers } : {}) }),
  }));
  expect(res.status).toBe(200);
  if (opts.join !== false) {
    const join = await room.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: 'p-guest', callsign: 'Guest', ...(opts.joinKind ? { kind: opts.joinKind } : {}), ...(opts.joinTiers !== undefined ? { tiers: opts.joinTiers } : {}) }) }));
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

    // 4,000 ticks minted on the fake clock, then a 600-message replay (3.75x
    // the socket burst, which is the claim). Measured single-file, Apple M3
    // Pro, 2026-10-15: 0.11-0.12 s in three runs at a load average of 12-20 on
    // 12 cores, 0.57-0.98 s in three at 31-78 (two other test loops running).
    // The 5 s crossing was reported from agents' full parallel `pnpm test` runs
    // on a loaded machine, not reproduced single-file (0.98 s at most). The
    // margin is for contention only.
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
    }, 30_000);
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

  it('the host picks its faction: sarim puts seat 0 on Sarim and seat 1 on the KDF, in the lobby and in the config (2026-10-14); the KDF seat is side 0 (LD1, N3)', async () => {
    for (const [matchup, factions, sides] of [['sarim', ['sarim', 'kdf'], [1, 0]], ['kdf', ['kdf', 'sarim'], [0, 1]], ['mirror', ['kdf', 'kdf'], [0, 1]], ['nonsense', ['kdf', 'kdf'], [0, 1]]] as const) {
      const { room } = await created(new FakeState(), { mode: 'versus', matchup });
      const ws0 = await hello(room, 0);
      const ws1 = await hello(room, 1);
      expect(ofType(ws1, 'lobby').at(-1)?.factions).toEqual(factions);
      await say(room, ws0, { t: 'ready' });
      await say(room, ws1, { t: 'ready' });
      for (const ws of [ws0, ws1]) {
        const [start] = ofType(ws, 'start');
        expect(start.config.seats.map((s) => s.faction)).toEqual(factions);
        expect(start.config.seats.map((s) => s.side)).toEqual(sides);
      }
    }
  });

  it('the room refuses a non-mirror matchup on any map but Tel Marum and Wadi Tarfan, and makes no room (the lead, 2026-10-14)', async () => {
    for (const [map, matchup, status] of [
      ['beit_sahwan_outskirts', 'sarim', 400], ['qarn_hadid', 'kdf', 400], ['milh_flats', 'sarim', 400], ['milh_flats', 'kdf', 400],
      ['beit_sahwan_outskirts', 'mirror', 200], ['milh_flats', 'mirror', 200], ['tel_marum', 'sarim', 200], ['wadi_tarfan', 'sarim', 200], ['wadi_tarfan', 'kdf', 200],
    ] as const) {
      const state = new FakeState();
      const room = new MatchRoom(state, env, YIELD);
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
      ['beit_sahwan_outskirts', 'versus', 200], ['tel_marum', 'versus', 200], ['wadi_tarfan', 'versus', 200], ['milh_flats', 'versus', 200],
      // A sandbox room is two humans on one side: not limited.
      ['qarn_hadid', 'sandbox', 200],
    ] as const) {
      const state = new FakeState();
      const room = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
    const ws0 = await hello(revived, 0);
    const ws1 = await hello(revived, 1);
    await say(revived, ws0, { t: 'ready' });
    await say(revived, ws1, { t: 'ready' });
    const tokens = ofType(ws0, 'start')[0].config.seats.map((s) => s.player);
    expect(tokens.every((t) => /^[0-9a-f]{16}$/.test(t))).toBe(true);
    expect(JSON.stringify(ofType(ws0, 'start')[0]).includes('p-host')).toBe(false);
    evict();
    const again = new MatchRoom(state, env, YIELD);
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

  // N4b task 11: the local relay passes a third argument; workerd never does,
  // so a room built with two must keep the 50 ms clock and the crypto seed.
  it('a room built without options ticks every TICK_MS and seeds a versus room from crypto.getRandomValues', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const real = crypto.getRandomValues.bind(crypto);
    const rnd = vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
      if (a instanceof Uint32Array) { a.fill(0x9e3779b9); return a; }
      return real(a as unknown as Uint8Array<ArrayBuffer>) as unknown as T;
    });
    try {
      const { ws0 } = await running({ mode: 'versus' });
      expect(ofType(ws0, 'start')[0].config.seed).toBe(0x9e3779b9 | 0);
      expect(rnd.mock.calls.some(([a]) => a instanceof Uint32Array)).toBe(true);
      const delays = intervals.mock.calls.map((c) => c[1]);
      expect(delays.length).toBeGreaterThan(0);
      expect(delays.every((d) => d === TICK_MS)).toBe(true);
    } finally {
      intervals.mockRestore();
      rnd.mockRestore();
    }
  });
  it('options (the local relay\'s, never workerd\'s): tickMs sets the clock and seed() replaces the crypto seed, given the code', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const rnd = vi.spyOn(crypto, 'getRandomValues');
    const codes: string[] = [];
    try {
      const state = new FakeState();
      const room = new MatchRoom(state, env, { ...YIELD, tickMs: 7, seed: (code) => { codes.push(code); return 7; } });
      const res = await room.fetch(new Request('https://room/create', {
        method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', build: BUILD, player: 'p-host', callsign: 'Host', mode: 'versus' }),
      }));
      expect(res.status).toBe(200);
      expect((await room.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: 'p-guest' }) }))).status).toBe(200);
      const ws0 = await hello(room, 0);
      const ws1 = await hello(room, 1);
      await say(room, ws0, { t: 'ready' });
      await say(room, ws1, { t: 'ready' });
      expect(ofType(ws0, 'start')[0].config.seed).toBe(7);
      expect(codes).toEqual([CODE]);
      expect(rnd.mock.calls.some(([a]) => a instanceof Uint32Array)).toBe(false);
      expect(intervals.mock.calls.map((c) => c[1])).toContain(7);
      expect(intervals.mock.calls.map((c) => c[1])).not.toContain(TICK_MS);
    } finally {
      intervals.mockRestore();
      rnd.mockRestore();
    }
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
    const room = new MatchRoom(new FakeState(), env, YIELD);
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
    const room = new MatchRoom(new FakeState(), env, YIELD);
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
    const room = new MatchRoom(new FakeState(), env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
    await deliverAlarm(revived, state.storage);
    expect((await persisted(state)).seats.map((s) => s?.connected)).toEqual([true, false]);
    expect(last(ws0)).toEqual({ t: 'stall', reason: 'gone', seat: 1 });
    expect(state.storage.alarmAt).toBe(Date.now() + WATCHDOG_MS);   // seat 0 is still there: the room serves it
  });

  it('a match that ends in a revived instance (no clock of its own) re-aims the old instance\'s alarm at the wipe', async () => {
    const { state, ws0 } = await running();
    expect(state.storage.alarmAt).not.toBeNull();
    evict();
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
    await revived.fetch(new Request('https://room/state'));
    const st = (revived as unknown as { st: RoomState }).st;
    expect(st.cmdChars).toBe(JSON.stringify({ kind: 'halt', ids: [1, 2, 3] }).length);
  });

  describe('#559 H-1: storage exists only between /create and the wipe', () => {
    it('a probe of a code with no room -- /state, /join, a hello, a close, an alarm -- touches no storage at all', async () => {
      const state = new FakeState();
      const room = new MatchRoom(state, env, YIELD);
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
      await deliverAlarm(new MatchRoom(state, env, YIELD), state.storage);
      expect((await persisted(state))).toMatchObject({ status: 'ended', endedReason: 'expired', endedAtMs: TTL_AT });
      expect(state.storage.alarmAt).toBe(TTL_AT + PURGE_AFTER_MS);
      evict();
      vi.setSystemTime(TTL_AT + PURGE_AFTER_MS);
      await deliverAlarm(new MatchRoom(state, env, YIELD), state.storage);
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
    const revived = new MatchRoom(old.state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const room = new MatchRoom(state, env, YIELD);
    const res = await room.fetch(new Request('https://room/create', { method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, build: BUILD, player: 'p', map: '__proto__' }) }));
    expect(res.status).toBe(400);
    expect(state.storage.rowsWritten).toBe(0);
  });

  it('/create refuses an empty build, so the hello build check can never be off', async () => {
    const room = new MatchRoom(new FakeState(), env, YIELD);
    const res = await room.fetch(new Request('https://room/create', { method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, player: 'p-host' }) }));
    expect(res.status).toBe(400);
    expect((await room.fetch(new Request('https://room/state'))).status).toBe(404);
  });

  it('a room whose meta was never written refuses every hello on build, even an empty one', async () => {
    const { state } = await created();
    state.storage.kv.delete('meta');
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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
      const revived = new MatchRoom(state, env, YIELD);
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
    const wakes: number[] = [];
    // The isolate dies after every wake: only the storage alarm brings the room back.
    for (let i = 0; i < 100 && state.storage.alarmAt !== null && ofType(ws0, 'ended').length === 0; i++) {
      evict();
      const instance = new MatchRoom(state, env, YIELD);
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
    const revived = new MatchRoom(state, env, YIELD);
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

/** N4a task 7: a seat's advisor rides a third socket that relays to its own seat only, and is never a seat. */
describe('advisor sockets (N4a task 7)', () => {
  const advisorTicket = (seat: Seat, scope: AdvisorScope, matchId = CODE): Promise<string> =>
    signTicket(SECRET, { matchId, seat, player: 'advisor', exp: NOW + 3600 * 1000, role: 'advisor', scope });
  const advisorHello = async (room: MatchRoom, seat: Seat, scope: AdvisorScope): Promise<FakeSocket> => hello(room, seat, await advisorTicket(seat, scope));
  const relays = (ws: FakeSocket): Extract<ServerMsg, { t: 'advisor' }>[] => ofType(ws, 'advisor');
  const PROPOSAL: AdvisorMsg = { kind: 'proposal', id: 1, cmd: { kind: 'halt', ids: [3] }, note: 'hold' };

  it('an advisor hello in a running match gets the log, leaves the seat\'s socket alone, writes nothing, and both seats see the badge', async () => {
    const { state, room, ws0, ws1 } = await running({ mode: 'versus' });
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    const before = state.storage.rowsWritten;
    const seatsBefore = (await persisted(state)).seats;
    const adv = await advisorHello(room, 0, 'assist');
    expect(adv.closed).toBeNull();
    const [log] = ofType(adv, 'log');
    expect(log.frames.map((f) => f.tick)).toEqual([0, 1, 2]);
    expect(log.config.seats[0].kind).toBe('human');
    expect(ws0.closed).toBeNull();
    expect(ofType(ws0, 'log')).toEqual([]);
    for (const ws of [ws0, ws1, adv]) expect(last(ws)).toEqual({ t: 'advisors', present: ['assist', null] });
    expect(state.storage.rowsWritten).toBe(before);
    expect((await persisted(state)).seats).toEqual(seatsBefore);
    // ...and the advisor hears what both seats hear: the next frame.
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(last(adv)).toMatchObject({ t: 'frame', tick: 3 });
    expect(last(ws0)).toMatchObject({ t: 'frame', tick: 3 });
  });

  it('a seat that rejoins gets its log alone: its advisor neither hears it again nor is replaced with the seat', async () => {
    const { room, ws1 } = await running({ mode: 'versus' });
    await vi.advanceTimersByTimeAsync(2 * TICK_MS);
    const adv = await advisorHello(room, 1, 'advise');
    const again = await hello(room, 1);
    expect(ws1.closed?.code).toBe(4000);
    expect(adv.closed).toBeNull();
    expect(ofType(adv, 'log')).toHaveLength(1);
    expect(ofType(again, 'log')).toHaveLength(1);
    // The rejoined seat is told the badge it already wears.
    expect(last(again)).toEqual({ t: 'advisors', present: [null, 'advise'] });
  });

  it('an advisor in the lobby is told the lobby as its seat, and its ready readies nobody', async () => {
    const { state, room } = await created();
    const ws0 = await hello(room, 0);
    const ws1 = await hello(room, 1);
    const adv = await advisorHello(room, 1, 'advise');
    expect(ofType(adv, 'lobby').at(-1)?.you).toBe(1);
    await say(room, ws0, { t: 'ready' });
    await say(room, adv, { t: 'ready' });
    expect((await persisted(state)).seats[1]?.ready).toBe(false);
    expect(ofType(ws0, 'start')).toEqual([]);
    expect(ofType(ws1, 'start')).toEqual([]);
  });

  it('an advisor\'s cmd, ready, pause, resume, surrender, chat, hash, ack, over, done and bye each change nothing', async () => {
    const { state, room, ws0, ws1 } = await running({ mode: 'versus' });
    await vi.advanceTimersByTimeAsync(25 * TICK_MS);
    const adv = await advisorHello(room, 0, 'assist');
    const before = state.storage.rowsWritten;
    const stBefore = await persisted(state);
    for (const m of [
      { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1] } }, { t: 'ready' }, { t: 'pause' }, { t: 'resume' }, { t: 'surrender' },
      { t: 'chat', text: 'gg' }, { t: 'hash', tick: 19, h: 1 }, { t: 'ack', tick: 20 }, { t: 'over', tick: 10 }, { t: 'done', round: 0 }, { t: 'bye' },
    ]) await say(room, adv, m);
    expect(adv.closed).toBeNull();
    expect(state.storage.rowsWritten).toBe(before);
    await vi.advanceTimersByTimeAsync(10 * TICK_MS);
    const after = await persisted(state);
    expect(after.status).toBe('running');
    expect(after.pausesLeft).toEqual(stBefore.pausesLeft);
    expect(after.over).toEqual([-1, -1]);
    expect(after.surrendered).toBeNull();
    for (const ws of [ws0, ws1, adv]) {
      expect(ofType(ws, 'frame').every((f) => f.cmds.length === 0)).toBe(true);
      expect(ofType(ws, 'frame').at(-1)?.tick).toBe(34);
      for (const t of ['ended', 'paused', 'chat', 'desync', 'cmdRefused', 'error'] as const) expect(ofType(ws, t), t).toEqual([]);
    }
  });

  it('an assist advisor\'s proposal reaches its own seat alone; an advise advisor\'s reaches nobody; the human\'s accept reaches its advisor alone', async () => {
    const { room, ws0, ws1 } = await running({ mode: 'versus' });
    const adv0 = await advisorHello(room, 0, 'assist');
    const adv1 = await advisorHello(room, 1, 'advise');
    await say(room, adv0, { t: 'advisor', a: PROPOSAL });
    expect(relays(ws0)).toEqual([{ t: 'advisor', from: 'advisor', a: PROPOSAL }]);
    for (const ws of [ws1, adv0, adv1]) expect(relays(ws)).toEqual([]);
    await say(room, adv1, { t: 'advisor', a: PROPOSAL });
    for (const ws of [ws1, adv1, adv0]) expect(relays(ws)).toEqual([]);
    expect(relays(ws0)).toHaveLength(1);
    await say(room, ws0, { t: 'advisor', a: { kind: 'accept', id: 1 } });
    expect(relays(adv0)).toEqual([{ t: 'advisor', from: 'human', a: { kind: 'accept', id: 1 } }]);
    expect(relays(ws0)).toHaveLength(1);   // no echo to the human
    for (const ws of [ws1, adv1]) expect(relays(ws)).toEqual([]);
    // A seat's own proposal is relayed to nobody, and an advisor's accept is not relayed either.
    await say(room, ws1, { t: 'advisor', a: PROPOSAL });
    expect(relays(adv1)).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    await say(room, adv0, { t: 'advisor', a: { kind: 'veto', id: 1 } });
    expect(relays(ws0)).toHaveLength(1);
    // Text goes both ways at either scope, to the pair only.
    await say(room, adv1, { t: 'advisor', a: { kind: 'text', text: 'ridge' } });
    expect(relays(ws1)).toEqual([{ t: 'advisor', from: 'advisor', a: { kind: 'text', text: 'ridge' } }]);
    expect(relays(ws0)).toHaveLength(1);
  });

  it('an advisor relays at most one message per ADVISOR_MIN_GAP_MS; a quicker one is dropped, not queued', async () => {
    const { room, ws0 } = await running({ mode: 'versus' });
    const adv = await advisorHello(room, 0, 'advise');
    const text = (n: number): unknown => ({ t: 'advisor', a: { kind: 'text', text: `t${n}` } });
    await say(room, adv, text(1));
    await say(room, adv, text(2));
    vi.setSystemTime(Date.now() + ADVISOR_MIN_GAP_MS - 1);
    await say(room, adv, text(3));
    vi.setSystemTime(Date.now() + 1);
    await say(room, adv, text(4));
    expect(relays(ws0).map((m) => (m.a.kind === 'text' ? m.a.text : ''))).toEqual(['t1', 't4']);
    expect(adv.closed).toBeNull();
  });

  it('closing an advisor mid-match stalls nothing, drops nobody, forfeits nothing, writes nothing, and clears the badge', async () => {
    const { state, room, ws0, ws1 } = await running({ mode: 'versus' });
    await vi.advanceTimersByTimeAsync(5 * TICK_MS);
    const adv = await advisorHello(room, 1, 'assist');
    const before = state.storage.rowsWritten;
    await deliverClose(room, adv, 1006, 'gone');
    expect(state.storage.rowsWritten).toBe(before);
    for (const ws of [ws0, ws1]) expect(last(ws)).toEqual({ t: 'advisors', present: [null, null] });
    // No forfeit clock started (`dropped` is its start), and the match runs on.
    await vi.advanceTimersByTimeAsync(10 * TICK_MS);
    expect(state.storage.alarmAt).not.toBeNull();
    for (const ws of [ws0, ws1]) {
      expect(ofType(ws, 'frame').at(-1)?.tick).toBe(14);
      for (const t of ['stall', 'dropped', 'ended'] as const) expect(ofType(ws, t), t).toEqual([]);
    }
    expect((await persisted(state)).seats.map((s) => s?.connected)).toEqual([true, true]);
  });

  it('a second advisor hello for a seat retires the first (4000); the retired one\'s late close changes nothing', async () => {
    const { room, ws0, ws1 } = await running({ mode: 'versus' });
    const first = await advisorHello(room, 0, 'assist');
    const second = await advisorHello(room, 0, 'advise');
    expect(first.closed).toEqual({ code: 4000, reason: 'replaced' });
    expect(second.closed).toBeNull();
    expect(last(ws1)).toEqual({ t: 'advisors', present: ['advise', null] });
    await deliverClose(room, first, 4000, 'replaced');
    expect(last(ws1)).toEqual({ t: 'advisors', present: ['advise', null] });
    // The live one is the advise advisor: its proposal is relayed to nobody, its text to the seat.
    await say(room, second, { t: 'advisor', a: PROPOSAL });
    expect(relays(ws0)).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    await say(room, second, { t: 'advisor', a: { kind: 'text', text: 'here' } });
    expect(relays(ws0)).toHaveLength(1);
    expect(first.sendsAfterClose).toBe(0);
  });

  it('through an eviction the advisor still relays: who it is lives in its attachment, not in storage', async () => {
    const { state, room, ws0 } = await running({ mode: 'versus' });
    const adv = await advisorHello(room, 0, 'assist');
    evict();
    const revived = new MatchRoom(state, env, YIELD);
    await say(revived, adv, { t: 'advisor', a: PROPOSAL });
    expect(relays(ws0)).toEqual([{ t: 'advisor', from: 'advisor', a: PROPOSAL }]);
    await say(revived, ws0, { t: 'advisor', a: { kind: 'veto', id: 1 } });
    expect(relays(adv)).toEqual([{ t: 'advisor', from: 'human', a: { kind: 'veto', id: 1 } }]);
    await deliverClose(revived, adv);
    expect(last(ws0)).toEqual({ t: 'advisors', present: [null, null] });
  });

  it('after a deploy drops the seat\'s socket, its surviving advisor does not hold the seat: the revived room marks it gone', async () => {
    const { state, room, ws0, ws1 } = await running({ mode: 'versus' });
    await advisorHello(room, 0, 'assist');
    evict();
    state.vanish(ws0);
    const revived = new MatchRoom(state, env, YIELD);
    await say(revived, ws1, { t: 'ack', tick: 0 });
    expect((await persisted(state)).seats[0]?.connected).toBe(false);
    expect(ofType(ws1, 'dropped').map((m) => m.seat)).toEqual([0]);
  });

  it('an advisor counts toward the 8: two seats, two advisors and four in flight fill the room, and the ninth is closed 1008', async () => {
    const { room } = await running({ mode: 'versus' });
    const a0 = await advisorHello(room, 0, 'assist');
    const a1 = await advisorHello(room, 1, 'advise');
    const flight = Array.from({ length: MAX_ROOM_SOCKETS - 4 }, () => openSocket(room));
    expect([a0, a1, ...flight].every((w) => w.closed === null)).toBe(true);
    expect(openSocket(room).closed).toEqual({ code: 1008, reason: 'too many sockets' });
  });

  it('an advisor floods its own socket\'s budget like any socket: closed 1008, the badge clears, and the seat plays on', async () => {
    const { state, room, ws0, ws1 } = await running({ mode: 'versus' });
    const adv = await advisorHello(room, 0, 'advise');   // its hello spent one
    for (const ws of [ws0, ws1]) expect(last(ws)).toEqual({ t: 'advisors', present: ['advise', null] });
    const before = state.storage.rowsWritten;
    for (let i = 0; i < SOCKET_BUDGET.burst - 1; i++) await say(room, adv, { t: 'ack', tick: 0 });
    expect(adv.closed).toBeNull();
    await say(room, adv, { t: 'ack', tick: 0 });
    expect(adv.closed).toEqual({ code: 1008, reason: 'rate' });
    expect(ws0.closed).toBeNull();
    // The rate close disowns the socket first, so its own close cannot clear the badge: the close here does.
    for (const ws of [ws0, ws1]) expect(last(ws)).toEqual({ t: 'advisors', present: [null, null] });
    await deliverClose(room, adv, 1008, 'rate');
    for (const ws of [ws0, ws1]) expect(last(ws)).toEqual({ t: 'advisors', present: [null, null] });
    expect(state.storage.rowsWritten).toBe(before);
  });

  it('an advisor ticket never replays an ended match as its seat: it hears the ending alone, while the seat\'s own ticket still gets the log', async () => {
    const { state, room, ws0 } = await running({ mode: 'versus' });
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    await say(room, ws0, { t: 'surrender' });
    evict();
    const revived = new MatchRoom(state, env, YIELD);
    const adv = await advisorHello(revived, 0, 'assist');
    expect(msgs(adv)).toEqual([{ t: 'ended', reason: 'surrender', seat: 0 }]);
    const seat = await hello(revived, 0);
    expect(ofType(seat, 'log')).toHaveLength(1);
    expect(last(seat)).toEqual({ t: 'ended', reason: 'surrender', seat: 0 });
  });

  it('when the room closes itself after the result, the advisor is told and closed with the seats; its late close writes nothing', async () => {
    const { state, room, ws0, ws1 } = await running({ mode: 'versus' });
    const adv = await advisorHello(room, 1, 'assist');
    await vi.advanceTimersByTimeAsync(10 * TICK_MS);
    await say(room, ws0, { t: 'over', tick: 5 });
    await say(room, ws1, { t: 'over', tick: 5 });
    await vi.advanceTimersByTimeAsync(OVER_CLOSE_MS + TICK_MS);
    expect(last(adv)).toEqual({ t: 'ended', reason: 'over' });
    expect(adv.closed).toEqual({ code: 1000, reason: 'ended' });
    const rows = state.storage.rowsWritten;
    const sent = ws0.sent.length;
    await deliverClose(room, adv);
    expect(state.storage.rowsWritten).toBe(rows);
    expect(ws0.sent.length).toBe(sent);
  });

  it('refuses an advisor ticket for another match or another build, and seats nobody', async () => {
    const { room, ws0 } = await running({ mode: 'versus' });
    const other = await hello(room, 0, await advisorTicket(0, 'assist', 'ZZZZZZ'));
    expect(other.closed?.code).toBe(4001);
    const old = await hello(room, 0, await advisorTicket(0, 'assist'), 'b0');
    expect(old.closed?.code).toBe(4002);
    expect(ofType(ws0, 'advisors')).toEqual([]);
  });
});

describe('bot seats and the paced config (N4a task 7, D5)', () => {
  const PACED = { kind: 'paced', roundTicks: 5, roundWallMs: 2000 };
  it('a paced versus room with a bot join mints paced, with roundTicks clamped to 20; the same room with no bot mints realtime', async () => {
    const bot = await running({ mode: 'versus', pace: PACED, joinKind: 'bot' });
    const [start] = ofType(bot.ws0, 'start');
    expect(start.config.pace).toEqual({ kind: 'paced', roundTicks: 20, roundWallMs: 2000 });
    expect(start.config.seats.map((s) => s.kind)).toEqual(['human', 'bot']);
    const humans = await running({ mode: 'versus', pace: PACED });
    expect(ofType(humans.ws0, 'start')[0].config.pace).toEqual({ kind: 'realtime' });
    expect(ofType(humans.ws0, 'start')[0].config.seats.map((s) => s.kind)).toEqual(['human', 'human']);
    const host = await running({ mode: 'versus', kind: 'bot' });
    expect(ofType(host.ws0, 'start')[0].config.seats.map((s) => s.kind)).toEqual(['bot', 'human']);
    expect(ofType(host.ws0, 'start')[0].config.pace).toEqual({ kind: 'realtime' });
  });

  it('a room persisted before seat kinds and pace existed revives with two humans, realtime', async () => {
    const { state } = await created(new FakeState(), { mode: 'versus' });
    const meta = await state.storage.get<Record<string, unknown>>('meta');
    delete meta?.kinds;
    delete meta?.pace;
    await state.storage.put('meta', meta);
    const room = new MatchRoom(state, env, YIELD);
    const ws0 = await hello(room, 0);
    const ws1 = await hello(room, 1);
    await say(room, ws0, { t: 'ready' });
    await say(room, ws1, { t: 'ready' });
    const [start] = ofType(ws0, 'start');
    expect(start.config.pace).toEqual({ kind: 'realtime' });
    expect(start.config.seats.map((s) => s.kind)).toEqual(['human', 'human']);
  });

  it('a bot that never sends done: the clock and the watchdog keep running through the wait, and roundWallMs releases the round (Review Focus 5)', async () => {
    const { state, ws0 } = await running({ mode: 'versus', pace: { kind: 'paced', roundTicks: 20, roundWallMs: 1000 }, joinKind: 'bot' });
    await vi.advanceTimersByTimeAsync(20 * TICK_MS);
    expect(ofType(ws0, 'frame').at(-1)?.tick).toBe(19);
    await vi.advanceTimersByTimeAsync(10 * TICK_MS);
    expect(ofType(ws0, 'frame').at(-1)?.tick).toBe(19);
    expect(ofType(ws0, 'stall')).toEqual([{ t: 'stall', reason: 'round', seat: 1 }]);
    expect(vi.getTimerCount()).toBeGreaterThan(0);   // the 50 ms clock still runs
    expect(state.storage.alarmAt).not.toBeNull();     // and so does the watchdog
    const before = state.storage.rowsWritten;
    await vi.advanceTimersByTimeAsync(5 * TICK_MS);
    expect(state.storage.rowsWritten).toBe(before);   // the wait writes nothing
    await vi.advanceTimersByTimeAsync(10 * TICK_MS);
    expect(ofType(ws0, 'frame').at(-1)?.tick).toBeGreaterThanOrEqual(20);
    expect(ofType(ws0, 'resume')).toHaveLength(1);
  });

  it('evicted mid-wait, the watchdog alarm alone restarts the clock and the revived room releases the round', async () => {
    const { state, ws0 } = await running({ mode: 'versus', pace: { kind: 'paced', roundTicks: 20, roundWallMs: 600_000 }, joinKind: 'bot' });
    await vi.advanceTimersByTimeAsync(25 * TICK_MS);
    expect(ofType(ws0, 'stall')).toEqual([{ t: 'stall', reason: 'round', seat: 1 }]);
    const at = state.storage.alarmAt;
    expect(at).not.toBeNull();
    evict();
    const revived = new MatchRoom(state, env, YIELD);
    vi.setSystemTime(at ?? 0);
    await deliverAlarm(revived, state.storage);
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    expect(ofType(ws0, 'frame').at(-1)?.tick).toBeGreaterThanOrEqual(20);
  });
});

describe('per-seat kit: the room records each seat\'s claim and mints it only into a brigade KDF seat', () => {
  const HOST = { mbt_lavi: { armour: 2, warp: 1 }, sarim_rifles: { armour: 1 } };
  const GUEST = { inf_squad: { sensors: 99 } };
  const startOf = async (opts: CreateOpts) => {
    const { ws0, ws1 } = await running(opts);
    const [start] = ofType(ws0, 'start');
    expect(ofType(ws1, 'start')[0].config).toEqual(start.config);
    expect(validateConfig(JSON.parse(JSON.stringify(start.config)))).not.toBeNull();
    return start.config;
  };
  it('the lobby names the kit rule to both seats when it is brigade, and says nothing for a matched or sandbox room', async () => {
    const lobbyKit = async (opts: CreateOpts) => {
      const { room } = await created(new FakeState(), opts);
      const ws0 = await hello(room, 0);
      const ws1 = await hello(room, 1);
      return [ofType(ws0, 'lobby').at(-1)?.kit, ofType(ws1, 'lobby').at(-1)?.kit];
    };
    expect(await lobbyKit({ mode: 'versus', kit: 'brigade' })).toEqual(['brigade', 'brigade']);
    expect(await lobbyKit({ mode: 'versus', kit: 'matched' })).toEqual([undefined, undefined]);
    expect(await lobbyKit({ mode: 'versus' })).toEqual([undefined, undefined]);
    expect(await lobbyKit({ kit: 'brigade' })).toEqual([undefined, undefined]);
  });
  it('a matched room with tiers in both bodies mints tiers {} on both seats', async () => {
    const c = await startOf({ mode: 'versus', kit: 'matched', tiers: HOST, joinTiers: GUEST });
    expect(c.seats.map((s) => [s.kit, s.tiers])).toEqual([['matched', {}], ['matched', {}]]);
  });
  it('no kit in the body is a matched room', async () => {
    const c = await startOf({ mode: 'versus', tiers: HOST, joinTiers: GUEST });
    expect(c.seats.map((s) => [s.kit, s.tiers])).toEqual([['matched', {}], ['matched', {}]]);
  });
  it('a brigade room mints each seat\'s own claim, cleaned', async () => {
    const c = await startOf({ mode: 'versus', kit: 'brigade', tiers: HOST, joinTiers: GUEST });
    expect(c.seats.map((s) => [s.kit, s.tiers])).toEqual([['brigade', { mbt_lavi: { armour: 2 } }], ['brigade', { inf_squad: { sensors: 3 } }]]);
  });
  it('a Sarim seat in a brigade room mints {}; its KDF opponent keeps its claim', async () => {
    const c = await startOf({ mode: 'versus', matchup: 'kdf', kit: 'brigade', tiers: HOST, joinTiers: GUEST });
    expect(c.seats.map((s) => [s.faction, s.kit, s.tiers])).toEqual([['kdf', 'brigade', { mbt_lavi: { armour: 2 } }], ['sarim', 'brigade', {}]]);
    const d = await startOf({ mode: 'versus', matchup: 'sarim', kit: 'brigade', tiers: HOST, joinTiers: GUEST });
    expect(d.seats.map((s) => [s.faction, s.tiers])).toEqual([['sarim', {}], ['kdf', { inf_squad: { sensors: 3 } }]]);
  });
  it('a sandbox room is always matched', async () => {
    const c = await startOf({ kit: 'brigade', tiers: HOST, joinTiers: GUEST });
    expect(c.mode).toBe('sandbox');
    expect(c.seats.map((s) => [s.kit, s.tiers])).toEqual([['matched', {}], ['matched', {}]]);
  });
  it('a room persisted before the kit existed revives matched, with no claims', async () => {
    const { state } = await created(new FakeState(), { mode: 'versus' });
    const meta = await state.storage.get<Record<string, unknown>>('meta');
    delete meta?.kit;
    delete meta?.claims;
    await state.storage.put('meta', meta);
    const room = new MatchRoom(state, env, YIELD);
    const ws0 = await hello(room, 0);
    const ws1 = await hello(room, 1);
    await say(room, ws0, { t: 'ready' });
    await say(room, ws1, { t: 'ready' });
    const [start] = ofType(ws0, 'start');
    expect(start.config.seats.map((s) => [s.kit, s.tiers])).toEqual([['matched', {}], ['matched', {}]]);
    expect(validateConfig(start.config)).not.toBeNull();
  });
  it('stored claims are cleaned again on revive: own keys only, clamped, a malformed pair is two empty claims', async () => {
    const { state } = await created(new FakeState(), { mode: 'versus', kit: 'brigade' });
    const meta = await state.storage.get<Record<string, unknown>>('meta');
    if (!meta) throw new Error('no meta');
    meta.claims = [JSON.parse('{"mbt_lavi":{"armour":99},"__proto__":{"armour":1}}'), { at_team: { firepower: 1 }, nope: { armour: 1 } }];
    await state.storage.put('meta', meta);
    const c1 = await (async () => {
      const room = new MatchRoom(state, env, YIELD);
      const ws0 = await hello(room, 0);
      const ws1 = await hello(room, 1);
      await say(room, ws0, { t: 'ready' });
      await say(room, ws1, { t: 'ready' });
      return ofType(ws0, 'start')[0].config;
    })();
    expect(c1.seats.map((s) => s.tiers)).toEqual([{ mbt_lavi: { armour: 3 } }, { at_team: { firepower: 1 } }]);
    const other = await created(new FakeState(), { mode: 'versus', kit: 'brigade', tiers: HOST });
    const m2 = await other.state.storage.get<Record<string, unknown>>('meta');
    if (!m2) throw new Error('no meta');
    m2.claims = 'junk';
    await other.state.storage.put('meta', m2);
    const room = new MatchRoom(other.state, env, YIELD);
    const ws0 = await hello(room, 0);
    const ws1 = await hello(room, 1);
    await say(room, ws0, { t: 'ready' });
    await say(room, ws1, { t: 'ready' });
    expect(ofType(ws0, 'start')[0].config.seats.map((s) => [s.kit, s.tiers])).toEqual([['brigade', {}], ['brigade', {}]]);
  });
});

describe('hello.from (D6, snapshot S3)', () => {
  type FrameT = { tick: number; cmds: unknown[] };
  const logOf = (ws: FakeSocket): ReturnType<typeof ofType<'log'>> => ofType(ws, 'log');
  const framesOf = (ws: FakeSocket): FrameT[] => logOf(ws).flatMap((l) => l.frames);
  /** A hello that may carry `from`. */
  async function helloFrom(room: MatchRoom, seat: Seat, from?: number, t?: string): Promise<FakeSocket> {
    const ws = openSocket(room);
    await say(room, ws, { t: 'hello', ticket: t ?? (await ticket(seat)), build: BUILD, ...(from === undefined ? {} : { from }) });
    return ws;
  }
  /** Both seats ack every 10 ticks, as clients do (a seat 40 ticks behind stalls the room). */
  const live = new Map<MatchRoom, FakeSocket[]>();
  async function step(n: number, room?: MatchRoom): Promise<void> {
    const r = room ?? [...live.keys()].at(-1);
    for (let left = n; left > 0; left -= 10) {
      await vi.advanceTimersByTimeAsync(Math.min(10, left) * TICK_MS);
      if (!r) continue;
      for (const ws of live.get(r) ?? []) {
        const tick = ofType(ws, 'frame').at(-1)?.tick;
        if (tick !== undefined && ws.closed === null) await say(r, ws, { t: 'ack', tick });
      }
    }
  }
  const halt = (id: number) => ({ kind: 'halt', ids: [id] });
  /** 56 ticks (0..55) with orders at tick 10 and tick 44. Batches: 0..10 and 11..30 (filled: 11..30), 31..44, 45..55 open... see the assertions. */
  async function played(): Promise<{ state: FakeState; room: MatchRoom; ws0: FakeSocket; ws1: FakeSocket }> {
    const r = await running();
    live.clear();
    live.set(r.room, [r.ws0, r.ws1]);
    await step(10);
    await say(r.room, r.ws0, { t: 'cmd', seq: 0, cmd: halt(1) });   // minted at tick 10
    await step(34);
    await say(r.room, r.ws1, { t: 'cmd', seq: 0, cmd: halt(2) });   // minted at tick 44
    await step(12);
    return r;
  }
  const full = async (room: MatchRoom): Promise<FrameT[]> => framesOf(await helloFrom(room, 1));

  it('1. a hello without from gets today\'s log, byte for byte, with no from key (G-5)', async () => {
    const { room } = await played();
    const ws = await helloFrom(room, 1);
    const [text] = ws.sent.filter((t) => t.startsWith('{"t":"log"'));
    const [log] = logOf(ws);
    expect(text).toBe(JSON.stringify({ t: 'log', config: log.config, frames: log.frames, part: 0, parts: 1 }));
    expect(text).not.toContain('"from"');
    expect(log.frames.map((f) => f.tick)).toEqual([...Array(log.frames.length).keys()]);
  });

  it('2. from 0 answers the full log, echoed', async () => {
    const { room } = await played();
    const all = await full(room);
    const ws = await helloFrom(room, 1, 0);
    expect(framesOf(ws)).toEqual(all);
    expect(logOf(ws).every((l) => l.from === 0)).toBe(true);
  });

  it('3. from inside a persisted batch gives exactly the full log from that tick, and echoes it', async () => {
    const { state, room } = await played();
    const all = await full(room);
    const from = 38;
    // The test needs a batch that really spans `from`, with orders on both sides of it.
    const spans = [...state.storage.batches.keys()].some((k) => k < from && from < k + row(state, k).length);
    expect(spans).toBe(true);
    expect(all.filter((f) => f.tick < from && f.cmds.length > 0).length).toBeGreaterThan(0);
    expect(all.filter((f) => f.tick >= from && f.cmds.length > 0).length).toBeGreaterThan(0);
    const ws = await helloFrom(room, 1, from);
    expect(framesOf(ws)).toEqual(all.filter((f) => f.tick >= from));
    expect(framesOf(ws)[0].tick).toBe(from);
    expect(logOf(ws).every((l) => l.from === from)).toBe(true);
  });

  it('4. from inside the open (unflushed) batch: no duplicate, even when a state write flushed a partial row', async () => {
    const { state, room } = await played();
    const all = await full(room);
    const seat1 = await helloFrom(room, 1);   // the live socket of seat 1
    const openFirst = 45;   // the order at tick 44 closed a batch, so 45..55 are open
    expect(state.storage.batches.has(openFirst)).toBe(false);
    await deliverClose(room, seat1, 1006, 'abnormal');   // a state write: it flushes the open batch's partial row
    expect(state.storage.batches.has(openFirst)).toBe(true);
    const from = 50;
    const ws = await helloFrom(room, 1, from);
    const ticks = framesOf(ws).map((f) => f.tick);
    expect(ticks).toEqual(all.filter((f) => f.tick >= from).map((f) => f.tick));
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it('5. from === st.tick and from > st.tick: one part with no frames', async () => {
    const { room, ws0 } = await played();
    const next = ofType(ws0, 'frame').at(-1)!.tick + 1;
    for (const from of [next, next + 500]) {
      const ws = await helloFrom(room, 1, from);
      expect(logOf(ws)).toHaveLength(1);
      expect(logOf(ws)[0]).toMatchObject({ frames: [], part: 0, parts: 1, from });
    }
  });

  it('6. after an eviction the revived room is behind the client\'s from: one empty part, then the re-minted ticks as frames', async () => {
    const { state, ws1 } = await running();
    await step(30);   // 0..19 closed by filling; 20..29 are memory only
    expect(ofType(ws1, 'frame').at(-1)?.tick).toBe(29);
    evict();
    const revived = new MatchRoom(state, env, YIELD);
    const back = await helloFrom(revived, 1, 30);
    expect(logOf(back)).toHaveLength(1);
    expect(logOf(back)[0]).toMatchObject({ frames: [], from: 30 });
    await step(12);
    const ticks = ofType(back, 'frame').map((f) => f.tick);
    expect(ticks[0]).toBe(20);   // the revived clock restarts at the last persisted batch
    expect(ticks.length).toBeGreaterThan(8);
  });

  it('7. an advisor\'s hello with from, and an ended room\'s replay with from', async () => {
    const { room, ws0 } = await played();
    const all = await full(room);
    const ws1 = await helloFrom(room, 1);   // the live socket of seat 1
    const advTicket = await signTicket(SECRET, { matchId: CODE, seat: 0, player: 'advisor', exp: NOW + 3600 * 1000, role: 'advisor', scope: 'assist' });
    const adv = await helloFrom(room, 0, 38, advTicket);
    expect(framesOf(adv)).toEqual(all.filter((f) => f.tick >= 38));
    expect(logOf(adv).every((l) => l.from === 38)).toBe(true);
    // The ended-room replay: both seats report the same result tick, the room closes itself.
    const tick = 40;
    await say(room, ws0, { t: 'over', tick });
    await say(room, ws1, { t: 'over', tick });
    await vi.advanceTimersByTimeAsync(OVER_CLOSE_MS + TICK_MS);
    expect((await room.fetch(new Request('https://room/state'))).status).toBe(200);
    const late = await helloFrom(room, 1, 38);
    expect(last(late)).toEqual({ t: 'ended', reason: 'over' });
    expect(logOf(late).length).toBeGreaterThan(0);
    expect(framesOf(late).map((f) => f.tick)[0]).toBe(38);
    expect(framesOf(late).every((f) => f.tick >= 38)).toBe(true);
    expect(logOf(late).every((l) => l.from === 38)).toBe(true);
    const lateAll = framesOf(await helloFrom(room, 1));
    expect(lateAll[0].tick).toBe(0);
  });

  it('8. a rejoin half way through a long match reads only the batch rows that can hold its ticks', async () => {
    const { state, room, ws0, ws1 } = await running();
    live.clear();
    live.set(room, [ws0, ws1]);
    await step(2400);
    const from = 1500;
    const keys = [...state.storage.batches.keys()];
    expect(keys.length).toBeGreaterThanOrEqual(120);
    const readsOf = async (f?: number): Promise<{ delta: number; ws: FakeSocket }> => {
      const before = state.storage.rowsRead;
      const ws = await helloFrom(room, 1, f);
      return { delta: state.storage.rowsRead - before, ws };
    };
    const whole = await readsOf();
    const trimmed = await readsOf(from);
    expect(whole.delta).toBe(keys.length);
    expect(trimmed.delta).toBe(keys.filter((k) => k > from - BATCH_TICKS).length);
    expect(trimmed.delta).toBeLessThan(whole.delta / 2);
    expect(framesOf(trimmed.ws).map((f) => f.tick)[0]).toBe(from);
    expect(framesOf(trimmed.ws).map((f) => f.tick)).toEqual(framesOf(whole.ws).filter((f) => f.tick >= from).map((f) => f.tick));
  }, 5_000);   // measured 0.2 s
});

describe('the room mints the snapshot cadence and learns agreed digests (snapshot S3)', () => {
  const startOf = (ws: FakeSocket): Extract<ServerMsg, { t: 'start' }> | undefined => ofType(ws, 'start').at(0);
  /** `n` ticks, both seats acking every ten as clients do (a seat 40 ticks behind stalls the room). */
  async function run(room: MatchRoom, socks: FakeSocket[], n: number): Promise<void> {
    for (let left = n; left > 0; left -= 10) {
      await vi.advanceTimersByTimeAsync(Math.min(10, left) * TICK_MS);
      for (const ws of socks) {
        const tick = ofType(ws, 'frame').at(-1)?.tick;
        if (tick !== undefined && ws.closed === null) await say(room, ws, { t: 'ack', tick });
      }
    }
  }
  const agreedOf = (room: MatchRoom): Map<number, number> => (room as unknown as { agreedDigests: Map<number, number> }).agreedDigests;

  it('the minted start config carries snapshotEveryTicks 1200', async () => {
    const { ws0 } = await running();
    expect(startOf(ws0)?.config.snapshotEveryTicks).toBe(1200);
  });

  it('the snapshotEveryTicks option makes it 40; 0 turns it off; an odd value falls back to 1200', async () => {
    expect(startOf((await running({ snapshotEveryTicks: 40 })).ws0)?.config.snapshotEveryTicks).toBe(40);
    expect(startOf((await running({ snapshotEveryTicks: 0 })).ws0)?.config.snapshotEveryTicks).toBe(0);
    expect(startOf((await running({ snapshotEveryTicks: 30 })).ws0)?.config.snapshotEveryTicks).toBe(1200);
    expect(startOf((await running({ snapshotEveryTicks: 72_020 })).ws0)?.config.snapshotEveryTicks).toBe(1200);
    expect(startOf((await running({ snapshotEveryTicks: -40 })).ws0)?.config.snapshotEveryTicks).toBe(1200);
  });

  it('an agreed effect leaves both seats\' sockets open and unretired, and writes no row', async () => {
    const { state, room, ws0, ws1 } = await running({ snapshotEveryTicks: 40 });
    await run(room, [ws0, ws1], 45);
    const before = state.storage.rowsWritten;
    await say(room, ws0, { t: 'hash', tick: 39, h: 5 });
    await say(room, ws1, { t: 'hash', tick: 39, h: 5 });
    expect(agreedOf(room).get(39)).toBe(5);   // the effect really arrived
    expect(state.storage.rowsWritten - before).toBe(0);
    for (const ws of [ws0, ws1]) expect(ws.closed).toBeNull();
    expect(ofType(ws0, 'hashOk').at(-1)).toEqual({ t: 'hashOk', tick: 39 });
    // A seat's socket still speaks for its seat: a later order is accepted, not dropped by a retired socket.
    await say(room, ws0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [1] } });
    expect(ofType(ws0, 'error')).toEqual([]);
  });

  it('keeps the agreed digest of the two newest snapshot ticks only (memory, three agreements -> two entries)', async () => {
    const { room, ws0, ws1 } = await running({ snapshotEveryTicks: 40 });
    await run(room, [ws0, ws1], 125);
    for (const [tick, h] of [[39, 111], [79, -559038737], [119, 333]] as const) {
      await say(room, ws0, { t: 'hash', tick, h });
      await say(room, ws1, { t: 'hash', tick, h });
    }
    expect([...agreedOf(room).entries()]).toEqual([[79, -559038737], [119, 333]]);
  });
});

describe('snapshot upload (snapshot S3)', () => {
  // Every case below measured under 0.05 s (the room runs on fake timers), so each carries a 2 s bound.
  /** 0xdeadbeef: above 2^31 on purpose, so the signed hash and the u32 header word are different numbers. */
  const DIGEST = 3735928559;
  const HASH = -559038737;
  const OPTS = { ...YIELD, snapshotEveryTicks: 40 };
  type Rig = { state: FakeState; room: MatchRoom; ws0: FakeSocket; ws1: FakeSocket; db?: ReturnType<typeof openTestD1> };

  /** `n` ticks, both seats acking every ten as clients do (a seat 40 ticks behind stalls the room). */
  async function run(room: MatchRoom, socks: FakeSocket[], n: number): Promise<void> {
    for (let left = n; left > 0; left -= 10) {
      await vi.advanceTimersByTimeAsync(Math.min(10, left) * TICK_MS);
      for (const ws of socks) {
        const tick = ofType(ws, 'frame').at(-1)?.tick;
        if (tick !== undefined && ws.closed === null) await say(room, ws, { t: 'ack', tick });
      }
    }
  }
  /** Runs until the room has minted past `tick`. */
  async function reach(r: { room: MatchRoom; ws0: FakeSocket; ws1: FakeSocket }, tick: number): Promise<void> {
    while ((ofType(r.ws0, 'frame').at(-1)?.tick ?? -1) < tick + 2) await run(r.room, [r.ws0, r.ws1], 10);
  }
  /** The test D1 with every statement taking `hops` microtask turns, so a write the room forgot to await is still unwritten when its handler returns. */
  function slowD1(inner: ReturnType<typeof openTestD1>, hops = 200): D1Like {
    const slow = async (): Promise<void> => { for (let i = 0; i < hops; i++) await Promise.resolve(); };
    const wrap = (st: ReturnType<D1Like['prepare']>): ReturnType<D1Like['prepare']> => ({
      bind: (...v) => wrap(st.bind(...v)),
      run: async () => { await slow(); return st.run(); },
      all: async <T,>() => { await slow(); return st.all<T>(); },
      first: async <T,>() => { await slow(); return st.first<T>(); },
    });
    return { prepare: (sql) => wrap(inner.prepare(sql)), batch: (ss) => inner.batch(ss) };
  }
  async function rig(opts: CreateOpts & { slow?: boolean } = {}): Promise<Rig> {
    const db = openTestD1();
    const r = await running({ ...OPTS, db: opts.slow ? slowD1(db) : db, ...opts });
    return { ...r, db };
  }
  async function agree(r: Rig, tick: number, h = HASH): Promise<void> {
    await say(r.room, r.ws0, { t: 'hash', tick, h });
    await say(r.room, r.ws1, { t: 'hash', tick, h });
  }
  /** The compressed body for a tick; `fill` varies the inflated bytes, `digest` the header's match digest. */
  const bodyFor = (tick: number, fill = 1, digest = DIGEST): Promise<Uint8Array> => gzip(snapshotBytes({ frameTick: tick, matchDigest: digest, fill }));
  /** The same inflated bytes in a different gzip wrapper (the header's mtime word), so seat 0's and seat 1's bodies can be told apart. */
  const rewrapped = (gz: Uint8Array): Uint8Array => { const c = gz.slice(); c[4] = 1; return c; };
  interface PostOver { authorization?: string | null; tick?: string | null; headers?: Record<string, string> }
  async function post(room: MatchRoom, seat: Seat, tick: number, payload: BodyInit | Uint8Array, over: PostOver = {}): Promise<Response> {
    const authorization = over.authorization === undefined ? `Bearer ${await ticket(seat)}` : over.authorization;
    const headers: Record<string, string> = { ...(authorization === null ? {} : { authorization }), ...(over.tick === null ? {} : { 'x-snapshot-tick': over.tick ?? String(tick) }), ...over.headers };
    return room.fetch(new Request('https://room/snapshot', { method: 'POST', headers, body: payload as BodyInit, duplex: 'half' } as RequestInit));
  }
  const d1Rows = (r: Rig): unknown[] => r.db!.raw.prepare('SELECT code, tick, kind, sha_a, sha_b, digest FROM match_snap_mismatch ORDER BY tick').all();
  const shaOf = (tick: number, fill = 1): Promise<string> => sha256Hex(snapshotBytes({ frameTick: tick, matchDigest: DIGEST, fill }));
  const bookOf = (room: MatchRoom): PendingBook => (room as unknown as { pending: PendingBook }).pending;
  const reservedOf = (room: MatchRoom): ReservationBook => (room as unknown as { reserved: ReservationBook }).reserved;
  const text = async (res: Response): Promise<string> => res.text();
  /** Every refusal writes no row and keeps whatever snapshot was stored. */
  async function refused(r: Rig, tick: number, payload: BodyInit | Uint8Array, status: number, why: string, over: PostOver = {}, seat: Seat = 0): Promise<void> {
    const rows = r.state.storage.rowsWritten;
    const kept = r.state.storage.snapshotRow;
    const res = await post(r.room, seat, tick, payload, over);
    expect([res.status, await text(res)]).toEqual([status, why]);
    expect(r.state.storage.rowsWritten).toBe(rows);
    expect(r.state.storage.snapshotRow).toEqual(kept);
  }

  it('accept, agreed first: both seats hash tick 39, then both upload (202 then 201); one row with the tick, SHA, digest and seat 0\'s bytes', async () => {
    const r = await rig();
    await run(r.room, [r.ws0, r.ws1], 45);
    await agree(r, 39);
    const rows = r.state.storage.rowsWritten;
    const gz0 = await bodyFor(39);
    const gz1 = rewrapped(gz0);
    expect((await post(r.room, 0, 39, gz0)).status).toBe(202);
    expect(r.state.storage.snapshotRow).toBeNull();
    expect((await post(r.room, 1, 39, gz1)).status).toBe(201);
    const row = r.state.storage.snapshotRow;
    expect(row).toMatchObject({ frame_tick: 39, sha: await shaOf(39), digest: DIGEST });
    expect(new Uint8Array(row!.bytes)).toEqual(gz0);
    expect(new Uint8Array(row!.bytes)).not.toEqual(gz1);
    expect(r.state.storage.rowsWritten - rows).toBe(1);
    expect(bookOf(r.room).ticks()).toEqual([]);
  }, 2_000);

  it('accept, agreed last: both upload (202, 202), then the hash pair agrees and the row is written inside apply', async () => {
    const r = await rig();
    await run(r.room, [r.ws0, r.ws1], 45);
    const rows = r.state.storage.rowsWritten;
    expect((await post(r.room, 0, 39, await bodyFor(39))).status).toBe(202);
    expect((await post(r.room, 1, 39, await bodyFor(39))).status).toBe(202);
    expect(r.state.storage.rowsWritten).toBe(rows);
    await say(r.room, r.ws0, { t: 'hash', tick: 39, h: HASH });
    expect(r.state.storage.snapshotRow).toBeNull();
    await say(r.room, r.ws1, { t: 'hash', tick: 39, h: HASH });
    expect(r.state.storage.snapshotRow).toMatchObject({ frame_tick: 39, sha: await shaOf(39), digest: DIGEST });
    expect(r.state.storage.rowsWritten - rows).toBe(1);
  }, 2_000);

  it('one seat only: 202, then no row after 200 more ticks; the book never exceeds two ticks', async () => {
    const r = await rig();
    await run(r.room, [r.ws0, r.ws1], 45);
    const rows = r.state.storage.rowsWritten;
    expect((await post(r.room, 0, 39, await bodyFor(39))).status).toBe(202);
    expect(r.state.storage.rowsWritten).toBe(rows);
    for (const tick of [79, 119, 159, 199, 239]) {
      await reach(r, tick);
      await agree(r, tick - 40);
      expect((await post(r.room, 0, tick, await bodyFor(tick))).status).toBe(202);
      expect(bookOf(r.room).ticks().length).toBeLessThanOrEqual(2);
    }
    expect(bookOf(r.room).ticks()).toEqual([199, 239]);
    expect(r.state.storage.snapshotRow).toBeNull();
  }, 2_000);

  it('SHA mismatch: 409, no DO row, the previous row kept, one D1 row of kind sha with both SHAs; the fourth in one instance writes no D1 row', async () => {
    const r = await rig();
    await run(r.room, [r.ws0, r.ws1], 45);
    await agree(r, 39);
    await post(r.room, 0, 39, await bodyFor(39));
    expect((await post(r.room, 1, 39, await bodyFor(39))).status).toBe(201);
    const kept = r.state.storage.snapshotRow;
    await reach(r, 79);
    expect((await post(r.room, 0, 79, await bodyFor(79, 1))).status).toBe(202);
    const rows = r.state.storage.rowsWritten;
    const res = await post(r.room, 1, 79, await bodyFor(79, 2));
    expect([res.status, await text(res)]).toEqual([409, 'mismatch']);
    expect(r.state.storage.rowsWritten).toBe(rows);
    expect(r.state.storage.snapshotRow).toEqual(kept);
    expect(bookOf(r.room).ticks()).toEqual([]);
    expect(d1Rows(r)).toEqual([{ code: CODE, tick: 79, kind: 'sha', sha_a: await shaOf(79, 1), sha_b: await shaOf(79, 2), digest: DIGEST }]);
    for (const tick of [119, 159]) {
      await reach(r, tick);
      await post(r.room, 0, tick, await bodyFor(tick, 1));
      expect((await post(r.room, 1, tick, await bodyFor(tick, 2))).status).toBe(409);
    }
    expect(d1Rows(r).length).toBe(3);
    await reach(r, 199);
    await post(r.room, 0, 199, await bodyFor(199, 1));
    expect((await post(r.room, 1, 199, await bodyFor(199, 2))).status).toBe(409);
    expect(d1Rows(r).length).toBe(3);   // the bound is three a room, and the fourth is still refused
    expect(r.state.storage.snapshotRow).toEqual(kept);
  }, 2_000);

  it('digest mismatch (same bytes, header digest differs from the agreed one): 409 and a D1 row of kind digest', async () => {
    const r = await rig();
    await run(r.room, [r.ws0, r.ws1], 45);
    await agree(r, 39);
    const rows = r.state.storage.rowsWritten;
    const bad = await bodyFor(39, 1, 0x12345678);
    expect((await post(r.room, 0, 39, bad)).status).toBe(202);
    expect((await post(r.room, 1, 39, bad)).status).toBe(409);
    expect(r.state.storage.rowsWritten).toBe(rows);
    expect(r.state.storage.snapshotRow).toBeNull();
    const sha = await sha256Hex(snapshotBytes({ frameTick: 39, matchDigest: 0x12345678, fill: 1 }));
    expect(d1Rows(r)).toEqual([{ code: CODE, tick: 39, kind: 'digest', sha_a: sha, sha_b: sha, digest: 0x12345678 }]);
  }, 2_000);

  it('digest mismatch found when the hash pair agrees last: the D1 row is written before apply returns', async () => {
    const r = await rig({ slow: true });
    await run(r.room, [r.ws0, r.ws1], 45);
    const bad = await bodyFor(39, 1, 0x12345678);
    await post(r.room, 0, 39, bad);
    await post(r.room, 1, 39, bad);
    await say(r.room, r.ws0, { t: 'hash', tick: 39, h: HASH });
    await say(r.room, r.ws1, { t: 'hash', tick: 39, h: HASH });
    expect(d1Rows(r).map((x) => (x as { kind: string }).kind)).toEqual(['digest']);
    expect(r.state.storage.snapshotRow).toBeNull();
    expect(bookOf(r.room).ticks()).toEqual([]);
  }, 2_000);

  describe('sizes and bad bytes', () => {
    /** Valid gzip of exactly `size` bytes: incompressible filler from a fixed xorshift, its length tuned until the gzip is that long. */
    async function gzipOfSize(tick: number, size: number): Promise<Uint8Array> {
      let n = size - 80;
      for (let i = 0; i < 12; i++) {
        const raw = snapshotBytes({ frameTick: tick, matchDigest: DIGEST, length: n });
        let x = 0x9e3779b9;
        for (let j = 22; j < raw.length; j++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; raw[j] = x & 255; }
        const gz = await gzip(raw);
        if (gz.length === size) return gz;
        n += size - gz.length;
      }
      throw new Error('no gzip of that size');
    }

    it('a declared Content-Length of 64 KiB + 1 is 413 before the body is read; an undeclared 64 KiB + 1 is 413; exactly 64 KiB of valid gzip is admitted', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      let pulled = false;
      const unread = new ReadableStream<Uint8Array>({ pull(c) { pulled = true; c.enqueue(new Uint8Array(10)); c.close(); } }, { highWaterMark: 0 });
      // These steps test the size caps, not the one attempt a seat and tick gets: each starts with its slot free.
      await refused(r, 39, unread, 413, 'too_large', { headers: { 'content-length': '65537' } });
      expect(pulled).toBe(false);
      reservedOf(r.room).clear();
      await refused(r, 39, new Uint8Array(65537), 413, 'too_large');
      expect(bookOf(r.room).ticks()).toEqual([]);
      reservedOf(r.room).clear();
      const exact = await gzipOfSize(39, 65536);
      expect(exact.length).toBe(65536);
      expect((await post(r.room, 0, 39, exact, { headers: { 'content-length': '65536' } })).status).toBe(202);
      expect(bookOf(r.room).has(0, 39)).toBe(true);
    }, 2_000);

    it('a decompression bomb is 413; not gzip, an empty body, a wrong magic, a wrong format and a header tick that is not the declared one are 400', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      // These cases test what each body is refused for, not the one attempt a seat and tick gets: each starts with its slot free.
      const refusedFresh: typeof refused = (...a) => { reservedOf(r.room).clear(); return refused(...a); };
      // The largest bomb the 64 KiB compressed cap admits (about 64 MiB inflated), not a token one.
      const max = maxSizeBomb();
      expect(max.byteLength).toBeGreaterThan(60_000);
      expect(max.byteLength).toBeLessThanOrEqual(65_536);
      await refusedFresh(r, 39, max, 413, 'too_large');
      await refusedFresh(r, 39, new TextEncoder().encode('this is not gzip'), 400, 'bad_gzip');
      await refusedFresh(r, 39, new Uint8Array(0), 400, 'bad_gzip');
      const magic = snapshotBytes({ frameTick: 39, matchDigest: DIGEST }); magic[0] = 0x58;
      await refusedFresh(r, 39, await gzip(magic), 400, 'bad snapshot');
      const format = snapshotBytes({ frameTick: 39, matchDigest: DIGEST }); format[4] = 2;
      await refusedFresh(r, 39, await gzip(format), 400, 'bad snapshot');
      await refusedFresh(r, 39, await gzip(snapshotBytes({ frameTick: 79, matchDigest: DIGEST })), 400, 'bad snapshot');
      await refusedFresh(r, 39, await gzip(new Uint8Array(10)), 400, 'bad snapshot');
      expect(bookOf(r.room).ticks()).toEqual([]);
    }, 2_000);

    it('a missing, non-numeric, signed, fractional or padded X-Snapshot-Tick is 400', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      const gz = await bodyFor(39);
      for (const t of [null, '', 'abc', '-39', '39.0', '039', '0x27', '12345678901']) await refused(r, 39, gz, 400, 'bad request', { tick: t });
    }, 2_000);
  });

  describe('who may upload', () => {
    it('an advisor ticket, another match\'s seat ticket and an expired ticket are 403; no or a malformed Authorization is 401; a bad ticket is 403', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      const gz = await bodyFor(39);
      const advisor = await signTicket(SECRET, { matchId: CODE, seat: 0, player: 'advisor', exp: NOW + 3600 * 1000, role: 'advisor', scope: 'assist' });
      await refused(r, 39, gz, 403, 'forbidden', { authorization: `Bearer ${advisor}` });
      await refused(r, 39, gz, 403, 'forbidden', { authorization: `Bearer ${await ticket(0, 'ZZZZZZ')}` });
      await refused(r, 39, gz, 403, 'forbidden', { authorization: `Bearer ${await signTicket(SECRET, { matchId: CODE, seat: 0, player: 'p-host', exp: NOW - 1 })}` });
      await refused(r, 39, gz, 403, 'forbidden', { authorization: 'Bearer garbage' });
      await refused(r, 39, gz, 403, 'forbidden', { authorization: `Bearer ${await signTicket('another-secret', { matchId: CODE, seat: 0, player: 'p-host', exp: NOW + 3600 * 1000 })}` });
      await refused(r, 39, gz, 401, 'unauthorized', { authorization: null });
      await refused(r, 39, gz, 401, 'unauthorized', { authorization: `Basic ${await ticket(0)}` });
      await refused(r, 39, gz, 401, 'unauthorized', { authorization: await ticket(0) });
      await refused(r, 39, gz, 401, 'unauthorized', { authorization: 'Bearer' });
      // The scheme is `Bearer` and one space, exactly: the same valid ticket under another case is refused unread.
      await refused(r, 39, gz, 401, 'unauthorized', { authorization: `bearer ${await ticket(0)}` });
      await refused(r, 39, gz, 401, 'unauthorized', { authorization: `BEARER ${await ticket(0)}` });
      await refused(r, 39, gz, 403, 'forbidden', { authorization: `Bearer  ${await ticket(0)}` });
      expect(bookOf(r.room).ticks()).toEqual([]);
    }, 2_000);
  });

  describe('which tick', () => {
    it('a tick that is not on the cadence, not yet minted, equal to the stored one, older than the window, or a repeat from the same seat is 409', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      const gz = (t: number): Promise<Uint8Array> => bodyFor(t);
      await refused(r, 40, await gz(40), 409, 'stale');          // not a snapshot tick
      await refused(r, 79, await gz(79), 409, 'stale');          // not yet minted
      await refused(r, 45, await gz(45), 409, 'stale');          // the room's own tick, not on the cadence either
      // equal to the stored tick
      await agree(r, 39);
      await post(r.room, 0, 39, await gz(39));
      expect((await post(r.room, 1, 39, await gz(39))).status).toBe(201);
      await refused(r, 39, await gz(39), 409, 'stale');
      await refused(r, 39, await gz(39), 409, 'stale', {}, 1);
      // older than the window: the room is at ~130, so the window is 119 and 79
      await reach(r, 129);
      await refused(r, 39, await gz(39), 409, 'stale');
      // a duplicate from the same seat for a tick in the window
      expect((await post(r.room, 0, 79, await gz(79))).status).toBe(202);
      await refused(r, 79, await gz(79), 409, 'duplicate');
      // and the window's edge, 79, was in
      expect(bookOf(r.room).has(0, 79)).toBe(true);
    }, 2_000);
  });

  describe('lifecycle', () => {
    it('a lobby, an ended room and a room with cadence 0 are 409 not_running', async () => {
      const lobby = await created(new FakeState(), OPTS);
      const gz = await bodyFor(39);
      let res = await post(lobby.room, 0, 39, gz);
      expect([res.status, await text(res)]).toEqual([409, 'not_running']);
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      await say(r.room, r.ws1, { t: 'bye' });
      res = await post(r.room, 0, 39, gz);
      expect([res.status, await text(res)]).toEqual([409, 'not_running']);
      expect(r.state.storage.snapshotRow).toBeNull();
      const off = await rig({ snapshotEveryTicks: 0 });
      await run(off.room, [off.ws0, off.ws1], 45);
      res = await post(off.room, 0, 39, gz);
      expect([res.status, await text(res)]).toEqual([409, 'not_running']);
    }, 2_000);

    it('a code with no room is 404 and touches no storage at all', async () => {
      const state = new FakeState();
      const room = new MatchRoom(state, env, OPTS);
      const res = await post(room, 0, 39, await bodyFor(39));
      expect(res.status).toBe(404);
      expect(state.storage.hasTable).toBe(false);
      expect(state.storage.hasSnapshotTable).toBe(false);
      expect(state.storage.kv.size).toBe(0);
      expect(state.storage.rowsWritten).toBe(0);
      expect(state.storage.alarmAt).toBeNull();
    });

    it('a room made before the snapshot table gets it when it loads, and then accepts a snapshot; /create makes it for a new room', async () => {
      const r = await rig();
      expect(r.state.storage.hasSnapshotTable).toBe(true);
      (r.state.storage as unknown as { snapshotTable: boolean }).snapshotTable = false;
      evict();
      const revived = new MatchRoom(r.state, { ...env, DB: r.db } as Env, OPTS);
      await revived.fetch(new Request('https://room/state'));
      expect(r.state.storage.hasSnapshotTable).toBe(true);
      await run(revived, [r.ws0, r.ws1], 45);
      await say(revived, r.ws0, { t: 'hash', tick: 39, h: HASH });
      await say(revived, r.ws1, { t: 'hash', tick: 39, h: HASH });
      await post(revived, 0, 39, await bodyFor(39));
      expect((await post(revived, 1, 39, await bodyFor(39))).status).toBe(201);
    }, 2_000);

    it('the wipe clears the book, the agreed digests and the stored tick; the same instance can make the code again', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      await agree(r, 39);
      await post(r.room, 0, 39, await bodyFor(39));
      await post(r.room, 1, 39, await bodyFor(39));
      await say(r.room, r.ws1, { t: 'bye' });
      vi.setSystemTime(Date.now() + PURGE_AFTER_MS);
      await deliverAlarm(r.room, r.state.storage);
      expect(r.state.storage.hasSnapshotTable).toBe(false);
      expect(r.state.storage.snapshotRow).toBeNull();
      const inner = r.room as unknown as { storedTick: number; agreedDigests: Map<number, number>; snapshotStoreReady: boolean };
      expect([inner.storedTick, inner.agreedDigests.size, inner.snapshotStoreReady, bookOf(r.room).ticks()]).toEqual([-1, 0, false, []]);
      const again = await r.room.fetch(new Request('https://room/create', { method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, build: BUILD, player: 'p' }) }));
      expect(again.status).toBe(200);
      expect(r.state.storage.hasSnapshotTable).toBe(true);
    }, 2_000);

    it('a Content-Length that is not a plain decimal within the cap (signed, hex, exponent, zero-padded, blank, a fraction, too long) is 413 before the body is read; plain decimals pass', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      for (const bad of ['-1', '+5', '0x10', '1e3', '', '1.5', '007', '12345678901', 'abc', '65537']) {
        let pulled = false;
        const unread = new ReadableStream<Uint8Array>({ pull(c) { pulled = true; c.enqueue(new Uint8Array(10)); c.close(); } }, { highWaterMark: 0 });
        reservedOf(r.room).clear();   // this loop tests the header, not the one attempt a seat and tick gets
        await refused(r, 39, unread, 413, 'too_large', { headers: { 'content-length': bad } });
        expect([bad, pulled]).toEqual([bad, false]);
      }
      const gz = await bodyFor(39);
      for (const ok of ['0', String(gz.length), '65536']) {
        const res = await post(r.room, 0, 39, gz, { headers: { 'content-length': ok } });
        expect([ok, res.status === 413]).toEqual([ok, false]);
        bookOf(r.room).clear();
        reservedOf(r.room).clear();
      }
    }, 2_000);
  });

  it('race: two uploads from the same seat for the same tick, started together, record one and refuse the other as a duplicate', async () => {
    const r = await rig();
    await run(r.room, [r.ws0, r.ws1], 45);
    await agree(r, 39);
    const gz = await bodyFor(39);
    const both = await Promise.all([post(r.room, 0, 39, gz), post(r.room, 0, 39, gz)]);
    expect(both.map((x) => x.status).sort()).toEqual([202, 409]);
    expect(await text(both.find((x) => x.status === 409)!)).toBe('duplicate');
    expect(bookOf(r.room).ticks()).toEqual([39]);
    expect((await post(r.room, 1, 39, gz)).status).toBe(201);
  }, 2_000);

  describe('one inflate a seat and tick (security review)', () => {
    /** Counts the decompressors the room builds while `fn` runs. */
    async function inflates<T>(fn: () => Promise<T>): Promise<{ result: T; n: number }> {
      const real = globalThis.DecompressionStream;
      let n = 0;
      globalThis.DecompressionStream = class Counting extends real { constructor(fmt: CompressionFormat) { super(fmt); n++; } } as typeof DecompressionStream;
      try { return { result: await fn(), n }; } finally { globalThis.DecompressionStream = real; }
    }

    it('ten uploads of one seat and tick, every body still unread when the rest have been admitted: one is inflated and held, nine are 409 duplicate', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      const gz = await bodyFor(39);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let pulled = 0;
      const parkedBody = (): ReadableStream<Uint8Array> => new ReadableStream<Uint8Array>({ async pull(c) { pulled++; await gate; c.enqueue(gz); c.close(); } }, { highWaterMark: 0 });
      const { result, n } = await inflates(async () => {
        const all = Array.from({ length: 10 }, () => post(r.room, 0, 39, parkedBody()));
        // The ticket check is a real (macrotask) await: let every upload reach the room before any body arrives.
        for (let i = 0; i < 200 && pulled < 1; i++) await realImmediate();
        for (let i = 0; i < 50; i++) await realImmediate();
        release();
        return Promise.all(all);
      });
      expect(n).toBe(1);
      expect(result.map((x) => x.status).sort()).toEqual([202, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
      for (const x of result.filter((y) => y.status === 409)) expect(await text(x)).toBe('duplicate');
    }, 2_000);

    it('a refusal after the reservation spends it: a bad-header upload, then a good one for the same seat and tick, is 409 duplicate and is not inflated', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      await refused(r, 39, await gzip(snapshotBytes({ frameTick: 79, matchDigest: DIGEST })), 400, 'bad snapshot');
      const good = await bodyFor(39);
      const { result, n } = await inflates(() => post(r.room, 0, 39, good));
      expect([result.status, await text(result)]).toEqual([409, 'duplicate']);
      expect(n).toBe(0);
      // The other seat's slot for that tick is its own.
      expect((await post(r.room, 1, 39, await bodyFor(39))).status).toBe(202);
    }, 2_000);

    it('every kind of refusal spends the slot: not gzip, too large and a wrong format each make the next upload for that seat and tick a 409', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      await reach(r, 79);
      await refused(r, 39, new TextEncoder().encode('this is not gzip'), 400, 'bad_gzip');
      await refused(r, 39, await bodyFor(39), 409, 'duplicate');
      await refused(r, 79, new Uint8Array(65537), 413, 'too_large');
      await refused(r, 79, await bodyFor(79), 409, 'duplicate');
      const format = snapshotBytes({ frameTick: 39, matchDigest: DIGEST }); format[4] = 2;
      await refused(r, 39, await gzip(format), 400, 'bad snapshot', {}, 1);
      await refused(r, 39, await bodyFor(39), 409, 'duplicate', {}, 1);
    }, 2_000);

    it('a mismatch spends the slots too: after it, neither seat can upload that tick again', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      expect((await post(r.room, 0, 39, await bodyFor(39, 1))).status).toBe(202);
      expect((await post(r.room, 1, 39, await bodyFor(39, 2))).status).toBe(409);
      expect(bookOf(r.room).ticks()).toEqual([]);
      await refused(r, 39, await bodyFor(39, 1), 409, 'duplicate', {}, 0);
      await refused(r, 39, await bodyFor(39, 1), 409, 'duplicate', {}, 1);
      expect(r.state.storage.snapshotRow).toBeNull();
    }, 2_000);

    it('the reservations are kept for the two newest ticks only, and the wipe clears them', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      for (const tick of [39, 79, 119]) {
        await reach(r, tick);
        expect((await post(r.room, 0, tick, await bodyFor(tick))).status).toBe(202);
      }
      expect(reservedOf(r.room).ticks()).toEqual([79, 119]);
      await say(r.room, r.ws1, { t: 'bye' });
      vi.setSystemTime(Date.now() + PURGE_AFTER_MS);
      await deliverAlarm(r.room, r.state.storage);
      expect(reservedOf(r.room).ticks()).toEqual([]);
    }, 2_000);
  });

  describe('the checks a write depends on run again after the last await (G-6)', () => {
    /** A request body that stays unread until `open()`: the upload is parked in `readCapped`, and the room can change under it. */
    function parked(gz: Uint8Array): { body: ReadableStream<Uint8Array>; open: () => void; reading: () => Promise<void> } {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let markPulled: () => void = () => undefined;
      const pulledP = new Promise<void>((resolve) => { markPulled = resolve; });
      const body = new ReadableStream<Uint8Array>({ async pull(c) { markPulled(); await gate; c.enqueue(gz); c.close(); } }, { highWaterMark: 0 });
      // The ticket check is a real async crypto call of unbounded duration, so wait for the event itself (the first pull
      // of the body), never for a count of turns; a hang is caught by the test's own timeout.
      const reading = (): Promise<void> => pulledP;
      return { body, open: release, reading };
    }
    /** Seat 0's upload for tick 39 parked mid-body; `change` alters the room; then the body arrives. */
    async function parkedThen(r: Rig, change: () => Promise<void>): Promise<{ res: Response; rows: number }> {
      const p = parked(await bodyFor(39));
      const inflight = post(r.room, 0, 39, p.body);
      await p.reading();
      await change();
      const rows = r.state.storage.rowsWritten;
      p.open();
      return { res: await inflight, rows };
    }

    it('check 6, storedTick: another pair\'s accept of tick 79 lands during the body read, so tick 39 is 409 stale and records nothing', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      const { res, rows } = await parkedThen(r, async () => {
        await reach(r, 79);
        await agree(r, 79);
        await post(r.room, 0, 79, await bodyFor(79));
        expect((await post(r.room, 1, 79, await bodyFor(79))).status).toBe(201);
      });
      expect([res.status, await text(res)]).toEqual([409, 'stale']);
      expect(r.state.storage.rowsWritten).toBe(rows);
      expect(r.state.storage.snapshotRow).toMatchObject({ frame_tick: 79 });
      expect(bookOf(r.room).ticks()).toEqual([]);
    }, 2_000);

    it('check 6, the window: the room ticks past tick 39\'s window during the body read, so it is 409 stale and records nothing', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      const { res, rows } = await parkedThen(r, async () => { await reach(r, 129); });
      expect([res.status, await text(res)]).toEqual([409, 'stale']);
      expect(r.state.storage.rowsWritten).toBe(rows);
      expect(r.state.storage.snapshotRow).toBeNull();
      expect(bookOf(r.room).ticks()).toEqual([]);
    }, 2_000);

    it('check 4: the room ends during the body read, so the upload is 409 not_running and records nothing', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      await agree(r, 39);
      const { res, rows } = await parkedThen(r, async () => { await say(r.room, r.ws1, { t: 'bye' }); });
      expect([res.status, await text(res)]).toEqual([409, 'not_running']);
      expect(r.state.storage.rowsWritten).toBe(rows);
      expect(r.state.storage.snapshotRow).toBeNull();
      expect(bookOf(r.room).ticks()).toEqual([]);
    }, 2_000);
  });

  describe('agreed last settles without re-running the admission (settleSnapshot)', () => {
    it('a pair whose tick has left the window by the time the hashes agree is still stored, as it is above storedTick', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      expect((await post(r.room, 0, 39, await bodyFor(39))).status).toBe(202);
      expect((await post(r.room, 1, 39, await bodyFor(39))).status).toBe(202);
      await reach(r, 129);   // tick 39 is now outside the two newest snapshot ticks: a fresh upload of it is stale
      expect([(await post(r.room, 0, 39, await bodyFor(39))).status]).toEqual([409]);
      await agree(r, 39);
      expect(r.state.storage.snapshotRow).toMatchObject({ frame_tick: 39, sha: await shaOf(39), digest: DIGEST });
      expect(bookOf(r.room).ticks()).toEqual([]);
    }, 2_000);

    it('nothing at or below storedTick stays pending: the accept of tick 79 drops tick 39\'s uploads, and a late agreement of 39 stores nothing', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      await post(r.room, 0, 39, await bodyFor(39));
      await post(r.room, 1, 39, await bodyFor(39));
      await reach(r, 79);
      await agree(r, 79);
      await post(r.room, 0, 79, await bodyFor(79));
      expect((await post(r.room, 1, 79, await bodyFor(79))).status).toBe(201);
      expect(bookOf(r.room).ticks()).toEqual([]);
      const rows = r.state.storage.rowsWritten;
      await agree(r, 39);   // room-core ignores a hash at or below the last compared tick
      expect(r.state.storage.snapshotRow).toMatchObject({ frame_tick: 79 });
      expect(r.state.storage.rowsWritten).toBe(rows);
    }, 2_000);
  });

  describe('a snapshot row the storage refuses', () => {
    it('agreed last: the hash pair completes without a rejection, the failure is logged, the uploads stay in the book, and a later cadence stores once the write works', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      await post(r.room, 0, 39, await bodyFor(39));
      await post(r.room, 1, 39, await bodyFor(39));
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const unhandled: unknown[] = [];
      const onUnhandled = (e: unknown): void => { unhandled.push(e); };
      process.on('unhandledRejection', onUnhandled);
      try {
        r.state.storage.failSnapshotPut = true;
        await say(r.room, r.ws0, { t: 'hash', tick: 39, h: HASH });
        await expect(say(r.room, r.ws1, { t: 'hash', tick: 39, h: HASH })).resolves.toBeUndefined();
        for (let i = 0; i < 20; i++) await realImmediate();
        expect(errors.mock.calls.map((c) => c[0])).toEqual(['MatchRoom: snapshot settle failed']);
        expect(unhandled).toEqual([]);
        expect(ofType(r.ws0, 'hashOk').map((m) => m.tick)).toContain(39);
        expect(r.state.storage.snapshotRow).toBeNull();
        expect(bookOf(r.room).ticks()).toEqual([39]);
        // The room is still a room: its next cadence is accepted once the write works.
        r.state.storage.failSnapshotPut = false;
        await reach(r, 79);
        await agree(r, 79);
        await post(r.room, 0, 79, await bodyFor(79));
        expect((await post(r.room, 1, 79, await bodyFor(79))).status).toBe(201);
      } finally {
        process.off('unhandledRejection', onUnhandled);
        errors.mockRestore();
      }
    }, 2_000);
    it('agreed first: the upload that completes the pair is answered 500 store failed, the failure is logged, no row is written, and the next cadence stores', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      await agree(r, 39);
      expect((await post(r.room, 0, 39, await bodyFor(39))).status).toBe(202);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        r.state.storage.failSnapshotPut = true;
        const res = await post(r.room, 1, 39, await bodyFor(39));
        expect([res.status, await text(res)]).toEqual([500, 'store failed']);
        expect(errors.mock.calls.map((c) => c[0])).toEqual(['MatchRoom: snapshot settle failed']);
        expect(r.state.storage.snapshotRow).toBeNull();
        r.state.storage.failSnapshotPut = false;
        await reach(r, 79);
        await agree(r, 79);
        await post(r.room, 0, 79, await bodyFor(79));
        expect((await post(r.room, 1, 79, await bodyFor(79))).status).toBe(201);
      } finally {
        errors.mockRestore();
      }
    }, 2_000);
  });

  describe('eviction', () => {
    it('mid-upload: seat 0\'s pending is gone, so seat 1\'s upload is held and no row follows; the next cadence, both seats, is accepted', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      expect((await post(r.room, 0, 39, await bodyFor(39))).status).toBe(202);
      evict();
      const room2 = new MatchRoom(r.state, { ...env, DB: r.db } as Env, OPTS);
      expect((await post(room2, 1, 39, await bodyFor(39))).status).toBe(202);
      await say(room2, r.ws0, { t: 'hash', tick: 39, h: HASH });
      await say(room2, r.ws1, { t: 'hash', tick: 39, h: HASH });
      expect(r.state.storage.snapshotRow).toBeNull();
      const live = { room: room2, ws0: r.ws0, ws1: r.ws1 };
      await reach(live, 79);
      await say(room2, r.ws0, { t: 'hash', tick: 79, h: HASH });
      await say(room2, r.ws1, { t: 'hash', tick: 79, h: HASH });
      expect((await post(room2, 0, 79, await bodyFor(79))).status).toBe(202);
      expect((await post(room2, 1, 79, await bodyFor(79))).status).toBe(201);
      expect(r.state.storage.snapshotRow).toMatchObject({ frame_tick: 79, sha: await shaOf(79) });
    }, 2_000);

    it('after an accept: the revived instance reads the stored tick from SQL and refuses the same tick as stale', async () => {
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      await agree(r, 39);
      await post(r.room, 0, 39, await bodyFor(39));
      expect((await post(r.room, 1, 39, await bodyFor(39))).status).toBe(201);
      evict();
      const room2 = new MatchRoom(r.state, { ...env, DB: r.db } as Env, OPTS);
      await room2.fetch(new Request('https://room/state'));   // the revival's own writes are done
      const rows = r.state.storage.rowsWritten;
      const res = await post(room2, 0, 39, await bodyFor(39));
      expect([res.status, await text(res)]).toEqual([409, 'stale']);
      expect(r.state.storage.rowsWritten).toBe(rows);
    }, 2_000);
  });

  describe('GET (the room serves its snapshot)', () => {
    const get = async (room: MatchRoom, auth: string | null): Promise<Response> =>
      room.fetch(new Request('https://room/snapshot', { method: 'GET', headers: auth === null ? {} : { authorization: auth } }));
    const getAs = async (room: MatchRoom, seat: Seat): Promise<Response> => get(room, `Bearer ${await ticket(seat)}`);
    /** Both seats hash `tick` and upload, seat 0's body wrapped differently from seat 1's. Returns seat 0's compressed body. */
    async function accepted(r: Rig, tick: number, fill = 1): Promise<Uint8Array> {
      await reach(r, tick);
      await agree(r, tick);
      const gz0 = await bodyFor(tick, fill);
      expect((await post(r.room, 0, tick, gz0)).status).toBe(202);
      expect((await post(r.room, 1, tick, rewrapped(gz0))).status).toBe(201);
      return gz0;
    }

    it('is 204 before any accept, in a running room and in a lobby, and writes nothing', async () => {
      const lobby = await created(new FakeState(), OPTS);
      const rows0 = lobby.state.storage.rowsWritten;
      expect((await getAs(lobby.room, 1)).status).toBe(204);
      expect(lobby.state.storage.rowsWritten).toBe(rows0);
      const r = await rig();
      await run(r.room, [r.ws0, r.ws1], 45);
      const rows = r.state.storage.rowsWritten;
      const res = await getAs(r.room, 0);
      expect([res.status, await res.text()]).toEqual([204, '']);
      expect(r.state.storage.rowsWritten).toBe(rows);
    }, 2_000);

    it('is 200 after an accept: seat 0\'s exact bytes, the SHA of the inflated bytes, the unsigned digest and the tick', async () => {
      const r = await rig();
      const gz0 = await accepted(r, 39);
      const rows = r.state.storage.rowsWritten;
      for (const seat of [0, 1] as const) {
        const res = await getAs(r.room, seat);
        expect(res.status).toBe(200);
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(gz0);
        expect(res.headers.get('x-snapshot-tick')).toBe('39');
        expect(res.headers.get('x-snapshot-sha')).toBe(await sha256Hex(new Uint8Array(gunzipSync(gz0))));
        expect(res.headers.get('x-snapshot-digest')).toBe('3735928559');
        expect(res.headers.get('content-type')).toBe('application/octet-stream');
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('content-encoding')).toBeNull();
      }
      expect(r.state.storage.rowsWritten).toBe(rows);
    }, 2_000);

    it('after a second accept it returns the newer one: the row is replaced, never two', async () => {
      const r = await rig();
      await accepted(r, 39, 1);
      const gz79 = await accepted(r, 79, 2);
      const res = await getAs(r.room, 0);
      expect(res.headers.get('x-snapshot-tick')).toBe('79');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(gz79);
      expect(res.headers.get('x-snapshot-sha')).toBe(await shaOf(79, 2));
    }, 2_000);

    it('an ended room serves it until the wipe, and after PURGE_AFTER_MS the code is 404', async () => {
      const r = await rig();
      const gz0 = await accepted(r, 39);
      await say(r.room, r.ws1, { t: 'bye' });
      const endedAt = Date.now();
      vi.setSystemTime(endedAt + PURGE_AFTER_MS - 1);
      const res = await getAs(r.room, 0);
      expect(res.status).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(gz0);
      vi.setSystemTime(endedAt + PURGE_AFTER_MS);
      await deliverAlarm(r.room, r.state.storage);
      expect((await getAs(r.room, 0)).status).toBe(404);
    }, 2_000);

    it('an advisor ticket and another match\'s seat ticket are 403; no ticket, a malformed header or a ticket in the query is 401; none of them writes', async () => {
      const r = await rig();
      await accepted(r, 39);
      const rows = r.state.storage.rowsWritten;
      const advisor = await signTicket(SECRET, { matchId: CODE, seat: 0, player: 'advisor', exp: NOW + 3600 * 1000, role: 'advisor', scope: 'assist' });
      expect((await get(r.room, `Bearer ${advisor}`)).status).toBe(403);
      expect((await get(r.room, `Bearer ${await ticket(0, 'ZZZZZZ')}`)).status).toBe(403);
      expect((await get(r.room, 'Bearer garbage')).status).toBe(403);
      expect((await get(r.room, null)).status).toBe(401);
      expect((await get(r.room, `Basic ${await ticket(0)}`)).status).toBe(401);
      const query = await r.room.fetch(new Request(`https://room/snapshot?ticket=${await ticket(0)}`));
      expect(query.status).toBe(401);
      expect(r.state.storage.rowsWritten).toBe(rows);
    }, 2_000);

    it('a code with no room is 404 and touches no storage; a method other than GET and POST is 405', async () => {
      const state = new FakeState();
      const room = new MatchRoom(state, env, OPTS);
      expect((await getAs(room, 0)).status).toBe(404);
      expect(state.storage.hasTable).toBe(false);
      expect(state.storage.hasSnapshotTable).toBe(false);
      expect(state.storage.rowsWritten).toBe(0);
      const r = await rig();
      expect((await r.room.fetch(new Request('https://room/snapshot', { method: 'PUT', body: 'x' }))).status).toBe(405);
    }, 2_000);
  });
});
