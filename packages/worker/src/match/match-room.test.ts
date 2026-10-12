/**
 * The real `MatchRoom` over a fake Durable Object runtime (`fake-do.ts`, R19):
 * it replaces the plan's `wrangler dev` smoke. Sockets enter through
 * `acceptSocket`, the half of `/ws` that runs under node -- a
 * `WebSocketPair` and a 101 `Response` exist only in workerd.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateConfig, type ServerMsg, type Seat } from '@lions/net';
import type { Env } from '../d1';
import { FakeState, deliverAlarm, deliverClose, deliverError, openSocket, type FakeSocket } from './fake-do';
import { BATCH_TICKS, MatchRoom, TICK_MS, WATCHDOG_MS } from './match-room';
import type { RoomState } from './room-core';
import { signTicket } from './ticket';

const NOW = 1_790_000_000_000;
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

interface CreateOpts { mode?: string; join?: boolean; code?: string }
/** Creates the room and, unless `join: false`, has the guest reserve seat 1 as the Worker does. */
async function created(state = new FakeState(), opts: CreateOpts = {}): Promise<{ state: FakeState; room: MatchRoom }> {
  const room = new MatchRoom(state, env);
  const res = await room.fetch(new Request('https://room/create', {
    method: 'POST',
    body: JSON.stringify({ code: opts.code ?? CODE, matchId: opts.code ?? CODE, map: 'tel_marum', build: BUILD, player: 'p-host', callsign: 'Host', ...(opts.mode ? { mode: opts.mode } : {}) }),
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
    expect(last(ws0)).toEqual({ t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'Host', connected: true, ready: false }], you: 0, map: '' });
    const ws1 = await hello(room, 1);
    const seats = [{ seat: 0, callsign: 'Host', connected: true, ready: false }, { seat: 1, callsign: 'Guest', connected: true, ready: false }];
    expect(last(ws0)).toEqual({ t: 'lobby', config: null, seats, you: 0, map: '' });
    expect(last(ws1)).toEqual({ t: 'lobby', config: null, seats, you: 1, map: '' });
  });

  it('answers a malformed message with one bad_message and carries on', async () => {
    const { room } = await created();
    const ws = openSocket(room);
    await say(room, ws, '{not json');
    expect(msgs(ws)).toEqual([{ t: 'error', code: 'bad_message' }]);
    expect(ws.closed).toBeNull();
    await say(room, ws, { t: 'hello', ticket: await ticket(0), build: BUILD });
    expect(last(ws)?.t).toBe('lobby');
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
      expect(start.config.seats.map((s) => s.player)).toEqual(['p-host', 'p-guest']);
    }
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

  it('the watchdog alarm is armed only while the match runs, re-arms itself, and a bye deletes it (R38)', async () => {
    const { state, room } = await created();
    const ws0 = await hello(room, 0);
    const ws1 = await hello(room, 1);
    expect(state.storage.alarmAt).toBeNull();   // a lobby keeps nothing awake
    await say(room, ws0, { t: 'ready' });
    await say(room, ws1, { t: 'ready' });
    expect(state.storage.alarmAt).toBe(Date.now() + WATCHDOG_MS);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    await deliverAlarm(room, state.storage);
    expect(state.storage.alarmAt).toBe(Date.now() + WATCHDOG_MS);
    await say(room, ws0, { t: 'bye' });
    expect(state.storage.alarmAt).toBeNull();
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

  it('an abandoned match (both sockets closed, no bye) runs no clock and arms no alarm; a hello brings both back', async () => {
    const { state, room, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    await deliverClose(room, ws0, 1006, 'abnormal');
    await deliverClose(room, ws1, 1006, 'abnormal');
    expect((await persisted(state)).seats.map((s) => s?.connected)).toEqual([false, false]);
    expect(state.storage.alarmAt).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    evict();
    const revived = new MatchRoom(state, env);
    await deliverAlarm(revived, state.storage);
    expect(state.storage.alarmAt).toBeNull();   // nothing re-arms: the room may sleep
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
    expect(state.storage.alarmAt).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('after a deploy drops every socket (no close delivered), the revived room marks both seats gone, writes once, and its alarm wakes nothing', async () => {
    const { state, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    expect(state.storage.alarmAt).not.toBeNull();
    state.vanish(ws0, ws1);
    evict();
    const revived = new MatchRoom(state, env);
    const before = state.storage.rowsWritten;
    await deliverAlarm(revived, state.storage);
    expect((await persisted(state)).seats.map((s) => s?.connected)).toEqual([false, false]);
    expect(state.storage.rowsWritten - before).toBe(1);   // the one state write that records both seats gone
    expect(state.storage.alarmAt).toBeNull();
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

  it('a match that ends in a revived instance (no clock of its own) deletes the alarm the old instance armed', async () => {
    const { state, ws0 } = await running();
    expect(state.storage.alarmAt).not.toBeNull();
    evict();
    const revived = new MatchRoom(state, env);
    vi.setSystemTime(Date.now() + 6 * 3600 * 1000 + 1);
    await say(revived, ws0, { t: 'ready' });   // any handler: the TTL ends the room
    expect((await persisted(state)).status).toBe('ended');
    expect(state.storage.alarmAt).toBeNull();
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

  it('an alarm that reaches a lobby, an ended room or an expired one neither re-arms nor starts a clock', async () => {
    const { state, room } = await created();
    const ws0 = await hello(room, 0);
    await deliverAlarm(room, state.storage);
    expect(state.storage.alarmAt).toBeNull();
    const ended = await running();
    await say(ended.room, ended.ws0, { t: 'bye' });
    const heard = ofType(ended.ws1, 'frame').length;
    await deliverAlarm(ended.room, ended.state.storage);
    await vi.advanceTimersByTimeAsync(4 * TICK_MS);
    expect(ended.state.storage.alarmAt).toBeNull();
    expect(ofType(ended.ws1, 'frame')).toHaveLength(heard);
    // A running room whose instance was evicted, reached by its alarm after the TTL.
    const old = await running();
    evict();
    const revived = new MatchRoom(old.state, env);
    vi.setSystemTime(Date.now() + 6 * 3600 * 1000 + 1);
    await deliverAlarm(revived, old.state.storage);
    expect(last(old.ws0)).toEqual({ t: 'ended', reason: 'expired' });
    expect(old.state.storage.alarmAt).toBeNull();
    expect(ofType(ws0, 'frame')).toEqual([]);
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
});
