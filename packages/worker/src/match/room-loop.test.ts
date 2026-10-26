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
import { endingLoser, FORFEIT_MS, LOG_PART_CHARS, OVER_CLOSE_MS, RECONNECT_DELAY_MS, WsTransport, type Frame, type MatchConfig, type Seat, type ServerMsg, type SocketLike } from '@lions/net';
import type { Env } from '../d1';
import { FakeState, deliverAlarm, deliverClose, openSocket, type FakeSocket } from './fake-do';
import { MatchRoom, PURGE_AFTER_MS, TICK_MS } from './match-room';
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
  readonly endings: { reason: string; seat?: Seat }[] = [];
  readonly t: WsTransport;
  constructor(loop: Loop, ticket: string, public digest: (tick: number) => number | null) {
    this.t = new WsTransport(loop.open, ticket, BUILD, {
      onStart: (c) => { this.configs.push(c); },
      onLobby: (_seats, you) => { this.lobbies.push(you); },
      onDesync: (tick, hashes) => { this.desyncs.push([tick, hashes]); },
      onEnded: (reason, seat) => { this.endings.push(seat === undefined ? { reason } : { reason, seat }); },
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
async function setUp(digest1: (tick: number) => number | null = sameHash, mode?: 'versus'): Promise<Match> {
  const state = new FakeState();
  const room = new MatchRoom(state, env);
  const res = await room.fetch(new Request('https://room/create', {
    method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', build: BUILD, player: 'Host', callsign: 'Host', ...(mode ? { mode } : {}) }),
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
async function started(digest1?: (tick: number) => number | null, mode?: 'versus'): Promise<Match> {
  const s = await setUp(digest1, mode);
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

  it('orders sent during a pause, by either seat, are in no frame either seat ever runs; one after the resume is (L-2, R-B27)', async () => {
    const { loop, p0, p1 } = await started();
    p0.t.queueCommand({ kind: 'halt', ids: [100] });   // before the pause: it runs
    await loop.flush();
    await step(loop, [p0, p1], 3);
    p0.t.pause();
    await loop.flush();
    expect(p1.t.status().kind).toBe('paused');
    // The pauser, and the seat that did not pause: both blocked at the room.
    p0.t.queueCommand({ kind: 'halt', ids: [1] });
    p1.t.queueCommand({ kind: 'halt', ids: [2] });
    await loop.flush();
    await step(loop, [p0, p1], 8);
    p1.t.queueCommand({ kind: 'halt', ids: [3] });
    await loop.flush();
    p0.t.resume();
    await loop.flush();
    p1.t.queueCommand({ kind: 'halt', ids: [4] });   // after the resume: accepted
    await loop.flush();
    await step(loop, [p0, p1], 6);
    // Both seats' frame logs are identical, and hold the paused cmds nowhere.
    expect(p1.taken).toEqual(p0.taken);
    const ids = p0.taken.flatMap((f) => f.cmds.flatMap((c) => (c.cmd.kind === 'halt' ? c.cmd.ids : [])));
    expect(ids).toEqual([100, 4]);
    expect(p0.ticks()).toEqual(range(p0.taken.length));
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
    // Seat 1 held ticks 0..11 when the link dropped, so the log starts at 12 (D6): nothing is re-sent.
    expect(log?.from).toBe(12);
    expect(log?.frames.map((f) => f.tick)).toEqual([]);
    expect(p1.configs).toHaveLength(1);   // a reconnect mid-match is not a second start
    await step(loop, [p0, p1], 10);
    expect(p1.ticks()).toEqual(range(p1.taken.length));
    expect(p1.taken.length).toBeGreaterThan(before.length + 5);
    expect(p1.taken).toEqual(p0.taken.slice(0, p1.taken.length));
    expect(p1.t.status().kind).toBe('live');
  });

  it('D6: a seat that dropped and kept its clock asks for the log from its next tick, gets a small fraction of the full log, and stays in lockstep (snapshot S3)', async () => {
    const { loop, p0, p1 } = await started();
    await step(loop, [p0, p1], 600);
    expect(p1.t.status().kind).toBe('live');
    const logsOf = (w: Wire): Extract<ServerMsg, { t: 'log' }>[] => w.received.filter((m): m is Extract<ServerMsg, { t: 'log' }> => m.t === 'log');
    const chars = (logs: ServerMsg[]): number => logs.reduce((n, m) => n + JSON.stringify(m).length, 0);
    // The link goes quiet before either end learns it: the room keeps minting
    // frames that seat 1 never receives (it stalls behind a seat that stops
    // acking only after 40 ticks, so 30 fit), then the socket drops for good.
    const lost = loop.wires[1];
    lost.live = false;
    await step(loop, [p0], 30);
    lost.drop();
    await loop.flush();
    const heldTo = Math.max(...lost.received.flatMap((m) => (m.t === 'frame' ? [m.tick] : [])));
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS);
    await loop.flush();
    const rejoin = loop.wires[2];
    const logs = logsOf(rejoin);
    expect(logs.length).toBeGreaterThan(0);
    // Every part names where it starts, and holds nothing before it.
    for (const m of logs) {
      expect(m.from).toBe(heldTo + 1);
      expect(m.frames.every((f) => f.tick >= heldTo + 1)).toBe(true);
    }
    const sent = logs.flatMap((m) => m.frames);
    expect(sent.length).toBeGreaterThanOrEqual(30);   // the loss was real: those frames came back
    expect(sent[0].tick).toBe(heldTo + 1);
    const trimmed = chars(logs);
    await step(loop, [p0, p1], 200);
    expect(p1.ticks()).toEqual(range(p1.taken.length));
    expect(p1.taken).toEqual(p0.taken.slice(0, p1.taken.length));
    expect(p1.taken.length).toBeGreaterThan(heldTo + 150);
    expect(p1.t.stats().hashOk.lastTick).toBeGreaterThan(heldTo);
    expect(p1.t.status().kind).toBe('live');
    // The same room answering a hello with no from: the whole log.
    const bare = openSocket(loop.room);
    const bareReceived: ServerMsg[] = [];
    bare.onSend((text) => { bareReceived.push(JSON.parse(text) as ServerMsg); });
    const ticket = await signTicket(SECRET, { matchId: CODE, seat: 1, player: 'Guest', exp: NOW + 3600 * 1000 });
    await loop.room.webSocketMessage(bare.asSocket(), JSON.stringify({ t: 'hello', ticket, build: BUILD }));
    const full = chars(bareReceived.filter((m) => m.t === 'log'));
    expect(full).toBeGreaterThan(0);
    expect(trimmed, `${trimmed} chars trimmed against ${full} chars for the full log`).toBeLessThan(full / 10);
  }, 60_000);

  it('#559 H-1: a long log reaches a rejoining seat in parts of at most LOG_PART_CHARS, and the seat runs on with no gap', async () => {
    const { loop, p0, p1 } = await started();
    // Heavy orders -- 200 ids each, one a tick from each seat (the budget's 20 a second) -- so the log passes one part.
    const ids = Array.from({ length: 200 }, (_, i) => 1000 + i);
    for (let i = 0; i < 160; i++) {
      p0.t.queueCommand({ kind: 'halt', ids });
      p1.t.queueCommand({ kind: 'halt', ids });
      await step(loop, [p0, p1], 1);
    }
    const sent = loop.wires[0].received.flatMap((m) => (m.t === 'frame' ? [{ tick: m.tick, cmds: m.cmds }] : []));
    expect(JSON.stringify(sent).length).toBeGreaterThan(LOG_PART_CHARS);
    // A reload: a new transport on seat 1's ticket has no clock, so it sends no from and gets the whole log.
    const p1b = new Player(loop, await signTicket(SECRET, { matchId: CODE, seat: 1, player: 'Guest', exp: NOW + 3600 * 1000 }), sameHash);
    await loop.flush();
    const logs = (loop.wires.at(-1)?.received ?? []).filter((m): m is Extract<ServerMsg, { t: 'log' }> => m.t === 'log');
    expect(logs.length).toBeGreaterThanOrEqual(2);
    logs.forEach((m, i) => {
      expect([m.part, m.parts]).toEqual([i, logs.length]);
      expect(JSON.stringify(m.frames).length).toBeLessThanOrEqual(LOG_PART_CHARS + 2);
    });
    expect(logs.flatMap((m) => m.frames)).toEqual(sent);
    expect(logs.every((m) => m.from === undefined)).toBe(true);   // no from, no echo: the whole log
    expect(p1b.t.status().kind).toBe('live');
    expect(p1b.configs).toHaveLength(1);
    await step(loop, [p0, p1b], 40);
    expect(p1b.ticks()).toEqual(range(p1b.taken.length));
    expect(p1b.taken).toEqual(p0.taken.slice(0, p1b.taken.length));
    expect(p1b.taken.length).toBeGreaterThan(sent.length);
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
    // A reload (no clock, so no from): the whole log, closed batches and the open one.
    new Player(loop, await signTicket(SECRET, { matchId: CODE, seat: 1, player: 'Guest', exp: NOW + 3600 * 1000 }), sameHash);
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

  /** L-1 (R-B26): the result, then the room's own close. Both seats run to the
   *  result's hash tick, report it (`over`) and stop running -- as a seat
   *  does once its end panel is up -- and the room waits two minutes,
   *  behind-stalled, its watchdog firing, then closes itself. */
  it('after the result: rows until the close are ~0.27 a second (the watchdog\'s 0.2, plus one-offs amortised), both seats hear ended over, and the closed room writes nothing', async () => {
    const { state, loop, p0, p1 } = await started();
    const RESULT_TICK = 399;
    while (Math.min(p0.taken.length, p1.taken.length) <= RESULT_TICK) await step(loop, [p0, p1], 1);
    for (const p of [p0, p1]) {
      p.taken.splice(RESULT_TICK + 1);   // a seat runs nothing past the tick that decided it
      p.t.over(RESULT_TICK);
    }
    // The meter, by kind: the state blob (`put`), the alarm (set and delete) and the batch rows (the rest).
    const tally = { put: 0, alarm: 0 };
    const { put, setAlarm, deleteAlarm } = state.storage;
    state.storage.put = async <T>(k: string, v: T): Promise<void> => { tally.put++; await put.call(state.storage, k, v); };
    state.storage.setAlarm = async (t: number): Promise<void> => { tally.alarm++; await setAlarm.call(state.storage, t); };
    state.storage.deleteAlarm = async (): Promise<void> => { if (state.storage.alarmAt !== null) tally.alarm++; await deleteAlarm.call(state.storage); };
    const rowsAtResult = state.storage.rowsWritten;
    await loop.flush();
    const closeAt = Date.now() + OVER_CLOSE_MS;
    const ended = (w: Wire): boolean => w.received.some((m) => m.t === 'ended');
    await step(loop, [], OVER_CLOSE_MS / TICK_MS - 1);
    expect(loop.wires.some(ended)).toBe(false);   // a tick before the deadline: nobody has heard it
    await step(loop, [], 1);
    expect(Date.now()).toBe(closeAt);
    for (const w of loop.wires) expect(w.received.at(-1)).toEqual({ t: 'ended', reason: 'over' });
    for (const p of [p0, p1]) expect(p.t.status()).toEqual({ kind: 'closed', reason: 'over' });
    expect(state.storage.alarmAt).toBe(closeAt + PURGE_AFTER_MS);   // re-aimed by the close itself at the wipe (#559 H-1)
    expect(vi.getTimerCount()).toBe(0);
    const between = state.storage.rowsWritten - rowsAtResult;
    const seconds = OVER_CLOSE_MS / 1000;
    const batches = between - tally.put - tally.alarm;
    // The state blob: each seat's report (the second one arms the close) and the close itself.
    expect(tally.put).toBe(3);
    // The watchdog every 5 s while the room waits, and the close's re-aim at the wipe.
    expect(tally.alarm).toBeLessThanOrEqual(seconds / 5 + 1);
    // Batch rows: the frames minted until the unacked seats stall the room (2 s), and each state write's flush of the open batch.
    expect(batches).toBeLessThanOrEqual(2 + tally.put);
    // Measured: 32 rows in 120 s (state 3, alarm 25, batch 4) = 0.267 a second; at most 0.275.
    expect(between / seconds).toBeLessThanOrEqual(0.275);
    // Closed: the clients go on pumping (and acking into a closed room), a stray alarm fires and only
    // re-aims at the wipe (one row); then, PURGE_AFTER_MS after the close, the wipe (#559 H-1).
    const rowsAtClose = state.storage.rowsWritten;
    const heard = loop.wires.map((w) => w.received.length);
    await deliverAlarm(loop.room, state.storage);
    await step(loop, [p0, p1], 60 * 1000 / TICK_MS);
    expect(state.storage.rowsWritten - rowsAtClose).toBe(1);
    expect(loop.wires.map((w) => w.received.length)).toEqual(heard);
    expect(state.storage.alarmAt).toBe(closeAt + PURGE_AFTER_MS);
    expect(vi.getTimerCount()).toBe(0);   // no room clock, and no reconnect timer on either seat
    const stored = state.storage.kv.size + state.storage.batches.size;
    await step(loop, [p0, p1], 60 * 1000 / TICK_MS);
    expect(state.storage.wipes).toBe(1);
    expect(state.storage.kv.size + state.storage.batches.size).toBe(0);
    // The wipe is billed as the rows it deletes: what the match stored, once.
    expect(state.storage.rowsWritten - rowsAtClose).toBe(1 + stored);
    expect(state.storage.alarmAt).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** The lead's ruling (2026-10-13): in a versus match the player who drops loses. */
describe('room loop: the player who drops loses', () => {
  const ticket1 = (): Promise<string> => signTicket(SECRET, { matchId: CODE, seat: 1, player: 'Guest', exp: NOW + 3600 * 1000 });
  /** The winner seen by a client: the side that did not give the match up, from the room's own ending. */
  const loserOf = (p: Player): Seat | null => {
    const e = p.endings.at(-1);
    return e === undefined ? null : endingLoser(e.reason, e.seat);
  };

  it('a seat whose tab closes is gone 60 s: both clients end on the same final tick with the same result, the dropper on its reload', async () => {
    const { loop, p0, p1 } = await started(undefined, 'versus');
    await step(loop, [p0, p1], 30);
    p1.t.detach();   // the tab closes: the socket goes with no bye, and no reconnect
    await loop.flush();
    const dropped = loop.wires[0].received.find((m) => m.t === 'dropped');
    expect(dropped).toEqual({ t: 'dropped', seat: 1, remainingMs: FORFEIT_MS });
    expect(p0.t.forfeitClock()).toEqual({ seat: 1, untilMs: Date.now() + FORFEIT_MS });
    await step(loop, [p0], FORFEIT_MS / TICK_MS - 1);
    expect(p0.endings).toEqual([]);   // a tick before the limit: still waiting
    await step(loop, [p0], 1);
    expect(p0.endings).toEqual([{ reason: 'forfeit', seat: 1 }]);
    await step(loop, [p0], 5);   // the drain: what it held, buffer included
    // The dropper comes back inside the room's two-minute grace (a reload, a new transport on its ticket).
    const back = new Player(loop, await ticket1(), sameHash);
    await loop.flush();
    for (let i = 0; i < 20; i++) back.pump(100);
    expect(back.endings).toEqual([{ reason: 'forfeit', seat: 1 }]);
    expect(back.t.status()).toEqual({ kind: 'closed', reason: 'forfeit' });
    // Same last tick, same frames, same loser -- so the same winner on both panels.
    expect(back.ticks()).toEqual(range(back.taken.length));
    expect(back.taken).toEqual(p0.taken);
    expect(back.ticks().at(-1)).toBe(p0.ticks().at(-1));
    expect([loserOf(p0), loserOf(back)]).toEqual([1, 1]);
  });

  it('Workers Free: the forfeit clock costs no row of its own -- the 60 s wait is the watchdog alone, and the ending one state write and the alarm re-aimed at the wipe', async () => {
    const { state, loop, p0, p1 } = await started(undefined, 'versus');
    await step(loop, [p0, p1], 30);
    const tally = { put: 0, alarm: 0 };
    const { put, setAlarm } = state.storage;
    state.storage.put = async <T>(k: string, v: T): Promise<void> => { tally.put++; await put.call(state.storage, k, v); };
    state.storage.setAlarm = async (t: number): Promise<void> => { tally.alarm++; await setAlarm.call(state.storage, t); };
    const before = state.storage.rowsWritten;
    p1.t.detach();
    await loop.flush();
    const atDrop = { rows: state.storage.rowsWritten - before, put: tally.put };
    await step(loop, [p0], FORFEIT_MS / TICK_MS);
    expect(p0.endings).toEqual([{ reason: 'forfeit', seat: 1 }]);
    const rows = state.storage.rowsWritten - before;
    const batches = rows - tally.put - tally.alarm;
    // The drop: one state write (`connected`), flushing the open batch with it.
    expect(atDrop.put).toBe(1);
    // The ending: one more state write. No other state write in the wait.
    expect(tally.put).toBe(2);
    // The watchdog every 5 s, as for any running room, plus the re-aim at the wipe.
    expect(tally.alarm).toBeLessThanOrEqual(FORFEIT_MS / 5000 + 1);
    // Batch rows: the flushes that ride on the two state writes, and nothing else -- no frame is minted while a seat is gone.
    expect(batches).toBeLessThanOrEqual(2);
    // Measured: 17 rows in 60 s (state 2, alarm 13, batch 2) = 0.283 a second, under a running match's 1.2-2.2.
    // Before the ruling the same wait cost the watchdog's 0.2 a second with no end: a seat that never came
    // back held the room stalled, waking every 5 s, until its six-hour TTL (~4,300 alarm rows).
    expect(rows / (FORFEIT_MS / 1000)).toBeLessThanOrEqual(0.3);
  });

  it('a reconnect at 59 s cancels it: no ending, the match runs on, and both clients run the same frames', async () => {
    const { loop, p0, p1 } = await started(undefined, 'versus');
    await step(loop, [p0, p1], 30);
    p1.t.detach();
    await loop.flush();
    await step(loop, [p0], (FORFEIT_MS - 1000) / TICK_MS);
    const again = new Player(loop, await ticket1(), sameHash);
    await loop.flush();
    expect(loop.wires[0].received.at(-1)?.t === 'back' || loop.wires[0].received.some((m) => m.t === 'back')).toBe(true);
    expect(p0.t.forfeitClock()).toBeNull();
    await step(loop, [p0, again], FORFEIT_MS / TICK_MS);
    expect([...p0.endings, ...again.endings]).toEqual([]);
    expect(p0.t.status().kind).toBe('live');
    expect(again.taken).toEqual(p0.taken.slice(0, again.taken.length));
    expect(again.taken.length).toBeGreaterThan(30 + 1000);
  });

  it('pressing Leave (bye) mid-match: the other seat wins at once, and both read the same loser', async () => {
    const { loop, p0, p1 } = await started(undefined, 'versus');
    await step(loop, [p0, p1], 30);
    // The bye, then the close, as a browser's socket delivers them: in order.
    // (`close()` sends both at once, and this harness would race them.)
    await loop.room.webSocketMessage(loop.wires[1].server.asSocket(), JSON.stringify({ t: 'bye' }));
    p1.t.detach();
    await loop.flush();
    expect(p0.endings).toEqual([{ reason: 'left', seat: 1 }]);
    expect(loserOf(p0)).toBe(1);
  });
});
