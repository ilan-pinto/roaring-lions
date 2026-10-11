/**
 * The real `MatchRoom` over a fake Durable Object runtime (`fake-do.ts`, R19):
 * it replaces the plan's `wrangler dev` smoke. Sockets enter through
 * `acceptSocket`, the half of `/ws` that runs under node -- a
 * `WebSocketPair` and a 101 `Response` exist only in workerd.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMsg, Seat } from '@lions/net';
import type { Env } from '../d1';
import { FakeState, deliverClose, deliverError, openSocket, type FakeSocket } from './fake-do';
import { MatchRoom, TICK_MS } from './match-room';
import type { RoomState } from './room-core';
import { signTicket } from './ticket';

const NOW = 1_790_000_000_000;
const SECRET = 'room-test-secret';
const CODE = 'ABCDEF';
const BUILD = 'b1';
const env = { DB: {}, ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: SECRET } as unknown as Env;

const ticket = (seat: Seat, matchId = CODE, player = seat === 0 ? 'Host' : 'Guest'): Promise<string> =>
  signTicket(SECRET, { matchId, seat, player, exp: NOW + 3600 * 1000 });
const msgs = (ws: FakeSocket): ServerMsg[] => ws.messages() as ServerMsg[];
const last = (ws: FakeSocket): ServerMsg | undefined => msgs(ws).at(-1);
const ofType = <T extends ServerMsg['t']>(ws: FakeSocket, t: T): Extract<ServerMsg, { t: T }>[] =>
  msgs(ws).filter((m): m is Extract<ServerMsg, { t: T }> => m.t === t);

async function created(state = new FakeState()): Promise<{ state: FakeState; room: MatchRoom }> {
  const room = new MatchRoom(state, env);
  const res = await room.fetch(new Request('https://room/create', {
    method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', build: BUILD }),
  }));
  expect(res.status).toBe(200);
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
async function running(): Promise<{ state: FakeState; room: MatchRoom; ws0: FakeSocket; ws1: FakeSocket }> {
  const { state, room } = await created();
  const ws0 = await hello(room, 0);
  const ws1 = await hello(room, 1);
  await say(room, ws0, { t: 'ready' });
  await say(room, ws1, { t: 'ready' });
  return { state, room, ws0, ws1 };
}
const persisted = async (state: FakeState): Promise<RoomState> => {
  const st = await state.storage.get<RoomState>('state');
  if (!st) throw new Error('no persisted state');
  return st;
};

beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('MatchRoom', () => {
  it('a hello with a valid ticket joins the lobby, and each socket is told its own seat', async () => {
    const { room } = await created();
    const ws0 = await hello(room, 0);
    expect(last(ws0)).toEqual({ t: 'lobby', config: null, seats: [{ seat: 0, callsign: 'Host', connected: true, ready: false }], you: 0 });
    const ws1 = await hello(room, 1);
    const seats = [{ seat: 0, callsign: 'Host', connected: true, ready: false }, { seat: 1, callsign: 'Guest', connected: true, ready: false }];
    expect(last(ws0)).toEqual({ t: 'lobby', config: null, seats, you: 0 });
    expect(last(ws1)).toEqual({ t: 'lobby', config: null, seats, you: 1 });
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

  it('the clock sends a frame per 50 ms to both seats and persists each one', async () => {
    const { state, room, ws0, ws1 } = await running();
    await say(room, ws0, { t: 'cmd', seq: 0, cmd: { kind: 'halt', ids: [3] } });
    await vi.advanceTimersByTimeAsync(3 * TICK_MS);
    for (const ws of [ws0, ws1]) {
      expect(ofType(ws, 'frame').map((f) => f.tick)).toEqual([0, 1, 2]);
      expect(ofType(ws, 'frame')[0].cmds).toEqual([{ seat: 0, seq: 0, cmd: { kind: 'halt', ids: [3] } }]);
    }
    expect([...state.storage.frames.keys()]).toEqual([0, 1, 2]);
    expect(JSON.parse(state.storage.frames.get(0) ?? 'null')).toEqual([{ seat: 0, seq: 0, cmd: { kind: 'halt', ids: [3] } }]);
    expect((await persisted(state)).tick).toBe(3);
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

  it('/create refuses an empty build, so the hello build check can never be off', async () => {
    const room = new MatchRoom(new FakeState(), env);
    const res = await room.fetch(new Request('https://room/create', { method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE }) }));
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
    const { state, room } = await created();
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
    const { state, room } = await created();
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

  const wakers: [string, (room: MatchRoom, ws0: FakeSocket) => Promise<unknown>][] = [
    ['fetch /state', (room) => room.fetch(new Request('https://room/state'))],
    ['a malformed message (an early return)', (room, ws0) => say(room, ws0, 'nope')],
    ['the close of a seatless socket (an early return)', async (room) => {
      await deliverClose(room, openSocket(room));
    }],
  ];
  it.each(wakers)('after an eviction, %s restarts the clock from the persisted tick', async (_name, wake) => {
    const { state, ws0, ws1 } = await running();
    await vi.advanceTimersByTimeAsync(2 * TICK_MS);
    expect(ofType(ws1, 'frame').map((f) => f.tick)).toEqual([0, 1]);
    vi.clearAllTimers();   // the isolate dies; storage and the hibernated sockets survive
    const revived = new MatchRoom(state, env);
    await vi.advanceTimersByTimeAsync(4 * TICK_MS);
    expect(ofType(ws1, 'frame')).toHaveLength(2);   // nothing runs a clock until a handler does
    await wake(revived, ws0);
    await vi.advanceTimersByTimeAsync(2 * TICK_MS);
    expect(ofType(ws1, 'frame').map((f) => f.tick)).toEqual([0, 1, 2, 3]);
    expect([...state.storage.frames.keys()]).toEqual([0, 1, 2, 3]);
  });
});
