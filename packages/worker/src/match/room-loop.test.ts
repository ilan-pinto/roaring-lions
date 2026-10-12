/**
 * The whole loop under node (R19): the real `MatchRoom` over the fake Durable
 * Object runtime (`fake-do.ts`), and two real `WsTransport`s, each wired to
 * the room through an in-memory socket pair. Fake timers drive both the
 * room's 50 ms clock and the transport's reconnect delay, so nothing here
 * waits on a wall clock or opens a port.
 *
 * The pair: a client `send` becomes a `webSocketMessage` on the room (async,
 * tracked so `flush` can wait for it); a room `send` on the server socket is
 * handed straight to the client's `onmessage`; `open` fires on a microtask,
 * after the transport has installed its handlers, as a browser's would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_DELAY_MS, WsTransport, type Frame, type MatchConfig, type Seat, type ServerMsg, type SocketLike } from '@lions/net';
import type { Env } from '../d1';
import { FakeState, deliverAlarm, deliverClose, openSocket, type FakeSocket } from './fake-do';
import { MatchRoom, TICK_MS } from './match-room';
import { signTicket } from './ticket';

const NOW = 1_790_000_000_000;
const SECRET = 'room-loop-test-secret';
const CODE = 'LOOPAB';
const BUILD = 'b-loop';
const env = { DB: {}, ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: SECRET } as unknown as Env;

/** One client end and the server socket the room accepted for it. */
interface Wire { server: FakeSocket; received: ServerMsg[]; live: boolean; drop(): void }

class Loop {
  readonly wires: Wire[] = [];
  private readonly pending = new Set<Promise<unknown>>();
  /** Mutable so a test can evict the object: every wire reaches whatever room is current. */
  constructor(public room: MatchRoom) {}

  private track(p: Promise<unknown>): void {
    this.pending.add(p);
    const done = (): void => { this.pending.delete(p); };
    p.then(done, done);
  }
  /** Every client message the room is still handling, including ones those handlers caused. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
  /** The socket factory a transport is given: each call is a fresh pair. */
  readonly open = (): SocketLike => {
    const server = openSocket(this.room);
    const client: SocketLike = {
      onopen: null, onmessage: null, onclose: null,
      send: (data) => {
        if (!wire.live) throw new Error('send on a closed socket');
        this.track(this.room.webSocketMessage(server.asSocket(), data));
      },
      close: () => {
        if (!wire.live) return;
        wire.live = false;
        this.track(deliverClose(this.room, server, 1000, 'client closed'));
        this.track(Promise.resolve().then(() => client.onclose?.({})));
      },
    };
    const wire: Wire = {
      server, received: [], live: true,
      // The network fails: both ends learn of it, with no bye.
      drop: () => {
        wire.live = false;
        this.track(deliverClose(this.room, server, 1006, 'abnormal'));
        client.onclose?.({});
      },
    };
    server.onSend((text) => {
      if (!wire.live) return;
      wire.received.push(JSON.parse(text) as ServerMsg);
      client.onmessage?.({ data: text });
    });
    this.wires.push(wire);
    this.track(Promise.resolve().then(() => client.onopen?.({})));
    return client;
  };
}

/** A seat's game loop with no sim: run what the transport yields, ack, and hash. */
class Player {
  readonly taken: Frame[] = [];
  readonly configs: MatchConfig[] = [];
  readonly lobbies: Seat[] = [];
  readonly desyncs: [number, [number, number]][] = [];
  readonly t: WsTransport;
  constructor(loop: Loop, ticket: string, public digest: (tick: number) => number | null) {
    this.t = new WsTransport(loop.open, ticket, BUILD, {
      onStart: (c) => { this.configs.push(c); },
      onLobby: (_seats, you) => { this.lobbies.push(you); },
      onDesync: (tick, hashes) => { this.desyncs.push([tick, hashes]); },
    });
  }
  pump(max = 10): void {
    for (const f of this.t.take(max)) {
      this.taken.push(f);
      this.t.reportTick(f.tick, this.digest(f.tick));
    }
  }
  ticks(): number[] { return this.taken.map((f) => f.tick); }
}

const sameHash = (tick: number): number | null => (tick % 20 === 19 ? 0x5eed : null);

interface Match { state: FakeState; loop: Loop; p0: Player; p1: Player }
/** The watchdog fires as the runtime would: whenever the scheduled time has come, on the fake clock. */
const watchdogs = new WeakMap<Loop, FakeState>();
async function setUp(digest1: (tick: number) => number | null = sameHash): Promise<Match> {
  const state = new FakeState();
  const room = new MatchRoom(state, env);
  const res = await room.fetch(new Request('https://room/create', {
    method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', build: BUILD, player: 'Host', callsign: 'Host' }),
  }));
  expect(res.status).toBe(200);
  expect((await room.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: 'Guest', callsign: 'Guest' }) }))).status).toBe(200);
  const loop = new Loop(room);
  watchdogs.set(loop, state);
  const exp = NOW + 3600 * 1000;
  const p0 = new Player(loop, await signTicket(SECRET, { matchId: CODE, seat: 0, player: 'Host', exp }), sameHash);
  const p1 = new Player(loop, await signTicket(SECRET, { matchId: CODE, seat: 1, player: 'Guest', exp }), digest1);
  await loop.flush();
  return { state, loop, p0, p1 };
}
async function started(digest1?: (tick: number) => number | null): Promise<Match> {
  const s = await setUp(digest1);
  s.p0.t.ready();
  s.p1.t.ready();
  await s.loop.flush();
  return s;
}
/** `n` room ticks; after each, the watchdog alarm fires if it is due (R38),
 *  and both seats run what they may and report it. */
async function step(loop: Loop, players: Player[], n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const storage = watchdogs.get(loop)?.storage;
    if (storage && storage.alarmAt !== null && storage.alarmAt <= Date.now()) await deliverAlarm(loop.room, storage);
    for (const p of players) p.pump();
    await loop.flush();
  }
}
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const kinds = (w: Wire): string[] => w.received.map((m) => m.t);

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

describe('room loop: MatchRoom and two WsTransports', () => {
  it('both hellos reach the lobby, both ready, and one start with the same config reaches both', async () => {
    const { loop, p0, p1 } = await setUp();
    expect(p0.lobbies.at(-1)).toBe(0);
    expect(p1.lobbies.at(-1)).toBe(1);
    expect(p0.t.status()).toEqual({ kind: 'waiting' });
    p0.t.ready();
    p1.t.ready();
    await loop.flush();
    expect(p0.configs).toHaveLength(1);
    expect(p1.configs).toEqual(p0.configs);
    expect(p0.configs[0]).toMatchObject({ matchId: CODE, map: 'tel_marum', build: BUILD });
    expect(p0.t.status()).toEqual({ kind: 'live', behind: 0 });
  });

  it('commands from both seats run in both clients at the same tick, in (seat, seq) order', async () => {
    const { loop, p0, p1 } = await started();
    // Arrival order is seat 1, then seat 0 twice: the frame must not keep it.
    p1.t.queueCommand({ kind: 'halt', ids: [21] });
    await loop.flush();
    p0.t.queueCommand({ kind: 'halt', ids: [1] });
    await loop.flush();
    p0.t.queueCommand({ kind: 'halt', ids: [2] });
    await loop.flush();
    await step(loop, [p0, p1], 6);
    expect(p0.ticks()).toEqual(range(4));
    expect(p1.taken).toEqual(p0.taken);
    expect(p0.taken[0].cmds).toEqual([
      { seat: 0, seq: 0, cmd: { kind: 'halt', ids: [1] } },
      { seat: 0, seq: 1, cmd: { kind: 'halt', ids: [2] } },
      { seat: 1, seq: 0, cmd: { kind: 'halt', ids: [21] } },
    ]);
    expect(p0.taken.slice(1).every((f) => f.cmds.length === 0)).toBe(true);
  });

  it('equal digests on a hash tick are hashOk to both; no desync', async () => {
    const { loop, p0, p1 } = await started();
    await step(loop, [p0, p1], 25);
    expect(p0.ticks()).toContain(19);
    for (const w of loop.wires) expect(w.received.filter((m) => m.t === 'hashOk')).toEqual([{ t: 'hashOk', tick: 19 }]);
    expect([...p0.desyncs, ...p1.desyncs]).toEqual([]);
    expect(p0.t.status().kind).toBe('live');
    expect(p1.t.status().kind).toBe('live');
  });

  it('different digests on a hash tick: both clients see the desync and stop', async () => {
    const { loop, p0, p1 } = await started((tick) => (tick === 39 ? 0xbad : sameHash(tick)));
    await step(loop, [p0, p1], 45);
    expect(p0.desyncs).toEqual([[39, [0x5eed, 0xbad]]]);
    expect(p1.desyncs).toEqual([[39, [0x5eed, 0xbad]]]);
    expect(p0.t.status()).toEqual({ kind: 'desync', tick: 39 });
    expect(p1.t.status()).toEqual({ kind: 'desync', tick: 39 });
    const ran = p0.taken.length;
    await step(loop, [p0, p1], 5);
    expect(p0.taken).toHaveLength(ran);   // a desynced client runs nothing more
  });

  it('a seat that stops running for over 40 ticks stalls the room behind; once it runs again the room resumes (R31)', async () => {
    const { loop, p0, p1 } = await started();
    await step(loop, [p0, p1], 12);   // seat 1 has run 0..9 and acked 9
    await step(loop, [p0], 45);       // ...then runs and acks nothing
    const behind = { t: 'stall', reason: 'behind', seat: 1 };
    for (const w of loop.wires) expect(w.received).toContainEqual(behind);
    expect(p1.t.status()).toEqual({ kind: 'stalled', reason: 'behind', seat: 1 });
    // The lagging seat must run its buffered frames DURING the stall: only its ack ends it.
    await step(loop, [p0, p1], 30);
    for (const w of loop.wires) expect(w.received.filter((m) => m.t === 'resume')).toHaveLength(1);
    expect(p0.t.status().kind).toBe('live');
    expect(p1.t.status().kind).toBe('live');
    expect(p1.ticks()).toEqual(range(p1.taken.length));
    expect(p1.taken.length).toBeGreaterThan(60);
    const common = Math.min(p0.taken.length, p1.taken.length);
    expect(p1.taken.slice(0, common)).toEqual(p0.taken.slice(0, common));
  });

  it('a dropped socket reconnects, receives the log, and runs on from nextTick with no duplicate and no gap', async () => {
    const { loop, p0, p1 } = await started();
    await step(loop, [p0, p1], 12);
    const before = p1.ticks();
    expect(before).toEqual(range(10));
    const [, first1] = loop.wires;
    first1.drop();
    await loop.flush();
    expect(p1.t.status()).toEqual({ kind: 'stalled', reason: 'connecting', seat: null });
    expect(loop.wires[0].received.at(-1)).toEqual({ t: 'stall', reason: 'gone', seat: 1 });
    // The room holds its clock while seat 1 is gone; the transport reopens after its delay.
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS);
    await loop.flush();
    expect(loop.wires).toHaveLength(3);
    const second1 = loop.wires[2];
    expect(kinds(second1)).toContain('log');
    const log = second1.received.find((m): m is Extract<ServerMsg, { t: 'log' }> => m.t === 'log');
    expect(log?.frames.map((f) => f.tick)).toEqual(range(12));
    expect(p1.configs).toHaveLength(1);   // a reconnect mid-match is not a second start
    await step(loop, [p0, p1], 10);
    expect(p1.ticks()).toEqual(range(p1.taken.length));
    expect(p1.taken.length).toBeGreaterThan(before.length + 5);
    expect(p1.taken).toEqual(p0.taken.slice(0, p1.taken.length));
    expect(p1.t.status().kind).toBe('live');
  });

  /** R-N12's budget: a command frame closes its batch (one row each), a batch
   *  with none closes every 20 ticks (one a second), and the watchdog re-arms
   *  every 5 s. So rows <= (max(command frames a second, 1) + 0.2) x seconds. */
  async function budget(ordersPerSecond: boolean): Promise<{ rows: number; cmdFrames: number; seconds: number; alarms: number }> {
    const { state, loop, p0, p1 } = await started();
    const before = state.storage.rowsWritten;
    let alarms = 0;
    const arm = state.storage.setAlarm.bind(state.storage);
    state.storage.setAlarm = async (t: number): Promise<void> => { alarms++; await arm(t); };
    const SECONDS = 60;
    const ticksPerSecond = 1000 / TICK_MS;
    for (let s = 0; s < SECONDS; s++) {
      // One command a second from each seat, mid-second so they land in different frames.
      if (ordersPerSecond) p0.t.queueCommand({ kind: 'halt', ids: [s] });
      await step(loop, [p0, p1], ticksPerSecond / 2);
      if (ordersPerSecond) p1.t.queueCommand({ kind: 'halt', ids: [100 + s] });
      await step(loop, [p0, p1], ticksPerSecond / 2);
    }
    // The match really ran: every tick, acked and hashed.
    expect(p0.t.status().kind).toBe('live');
    expect(p0.taken.length).toBeGreaterThan(SECONDS * ticksPerSecond - 5);
    expect(p1.taken).toEqual(p0.taken.slice(0, p1.taken.length));
    for (const w of loop.wires) expect(w.received.filter((m) => m.t === 'hashOk').length).toBeGreaterThan(55);
    expect(state.storage.alarmAt).not.toBeNull();
    return { rows: state.storage.rowsWritten - before, cmdFrames: p0.taken.filter((f) => f.cmds.length > 0).length, seconds: SECONDS, alarms };
  }
  const bound = (b: { cmdFrames: number; seconds: number }): number => Math.max(b.cmdFrames, b.seconds) + 0.2 * b.seconds;

  it('Workers Free, one order a second from each seat: rows <= (command frames a second + 0.2) x seconds, the watchdog firing (R-N12)', async () => {
    const b = await budget(true);
    expect(b.cmdFrames).toBe(2 * b.seconds);
    expect(b.alarms).toBeGreaterThanOrEqual(b.seconds / 5 - 1);   // the watchdog really ran
    expect(b.rows, `${b.rows} rows in ${b.seconds} s`).toBeLessThanOrEqual(bound(b));
  });

  it('Workers Free, a running match with no orders: rows <= 1.2 x seconds, the watchdog firing (R-N12)', async () => {
    const b = await budget(false);
    expect(b.cmdFrames).toBe(0);
    expect(b.alarms).toBeGreaterThanOrEqual(b.seconds / 5 - 1);
    expect(b.rows, `${b.rows} rows in ${b.seconds} s`).toBeLessThanOrEqual(bound(b));
  });

  it('a seat running at 18 Hz flaps between a behind stall and resume, and the room still writes at most 2 rows a second', async () => {
    const { state, loop, p0, p1 } = await started();
    const before = state.storage.rowsWritten;
    const SECONDS = 60;
    for (let i = 0; i < SECONDS * (1000 / TICK_MS); i++) {
      await vi.advanceTimersByTimeAsync(TICK_MS);
      p0.pump();
      if (i % 10 !== 9) p1.pump(1);   // one frame a tick, nine ticks in ten: 18 Hz
      await loop.flush();
    }
    const rows = state.storage.rowsWritten - before;
    const [w0] = loop.wires;
    expect(w0.received.filter((m) => m.t === 'stall').length).toBeGreaterThan(10);   // it really flaps
    expect(w0.received.filter((m) => m.t === 'resume').length).toBeGreaterThan(10);
    expect(p1.ticks()).toEqual(range(p1.taken.length));
    expect(rows, `${rows} rows in ${SECONDS} s`).toBeLessThanOrEqual(2 * SECONDS);
  });

  const liveFrames = (w: Wire): Frame[] =>
    w.received.flatMap((m) => (m.t === 'frame' ? [{ tick: m.tick, cmds: m.cmds }] : []));

  it('a seat reconnecting mid-batch gets every frame: the closed batches and the open one, commands included', async () => {
    const { loop, p0, p1 } = await started();
    const orders: [Player, number, number][] = [[p0, 1, 5], [p1, 2, 37], [p0, 3, 5]];   // ticks 0, 5 and 42: the last in the open batch
    for (const [p, id, steps] of orders) {
      p.t.queueCommand({ kind: 'halt', ids: [id] });
      await loop.flush();
      await step(loop, [p0, p1], steps);
    }
    const sent = liveFrames(loop.wires[0]);
    expect(sent.map((f) => f.tick)).toEqual(range(47));
    expect(sent.filter((f) => f.cmds.length > 0).map((f) => f.tick)).toEqual([0, 5, 42]);
    loop.wires[1].drop();
    await loop.flush();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS);
    await loop.flush();
    const log = loop.wires[2].received.find((m): m is Extract<ServerMsg, { t: 'log' }> => m.t === 'log');
    expect(log?.frames).toEqual(sent);
  });

  it('after an eviction the room continues at the last closed batch; both clients drop the re-sent ticks and run on with no gap', async () => {
    const { state, loop, p0, p1 } = await started();
    p0.t.queueCommand({ kind: 'halt', ids: [1] });
    await loop.flush();
    await step(loop, [p0, p1], 47);   // ticks 0..46: tick 0 carries the order and closes its batch, 1..20 and 21..40 fill and close, 41..46 open
    const heard = loop.wires.map((w) => w.received.length);
    evict();   // the isolate dies; storage and the hibernated sockets survive
    loop.room = new MatchRoom(state, env);
    // The first handler to reach the revived room is an order; it is stamped into a re-sent tick.
    p1.t.queueCommand({ kind: 'halt', ids: [2] });
    await loop.flush();
    await step(loop, [p0, p1], 40);
    for (const [i, w] of loop.wires.entries()) {
      const after = w.received.slice(heard[i]);
      expect(after.find((m) => m.t === 'frame')).toMatchObject({ tick: 41 });
      expect(after.filter((m) => m.t === 'stall')).toEqual([]);
    }
    for (const p of [p0, p1]) {
      expect(p.ticks()).toEqual(range(p.taken.length));
      expect(p.t.status().kind).toBe('live');
    }
    expect(p0.taken.length).toBeGreaterThan(70);   // 47 + 40 sent, less the 6 re-sent and the buffer
    expect(p1.taken).toEqual(p0.taken.slice(0, p1.taken.length));
    // What both ran at 40..46 is what the first room sent; the order the revived room took was lost on both alike.
    expect(p0.taken.flatMap((f) => f.cmds)).toEqual([{ seat: 0, seq: 0, cmd: { kind: 'halt', ids: [1] } }]);
  });
});
