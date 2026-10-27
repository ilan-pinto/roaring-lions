// N1b final fix wave, I-1: a reload rejoin runs its log down at the RAISED
// cap, and keeps it through the room's behind-stall. The real `MatchRoom`
// over the fake Durable Object runtime, two real `WsTransport`s, and the
// battlefield's own cap (`roomTickCap`), wired as `main.ts`'s frame loop
// wires them: one animation frame per room tick here, which is a third of a
// 60 fps browser's -- the gap between the raised cap and the floor only grows
// with more frames.
//
// Why the stall happens at all: on a reload the room keeps the seat's old
// `lastAck` (near the live tick), and the rejoiner replays from tick 0, so
// its acks are older and ignored; 40 room ticks later the room behind-stalls
// on the rejoiner (`stall{behind, seat}`), and the rejoiner's status is
// `stalled` for the rest of its replay while the other seat is frozen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setImmediate as realImmediate } from 'node:timers/promises';
import {
  WsTransport, gunzipCapped, gzipBytes, isSnapshotTick, matchDigest, sha256Hex, SNAPSHOT_META_OFFSET,
  type ClientMsg, type Frame, type MatchConfig, type ServerMsg, type SocketLike,
} from '@lions/net';
import { SNAPSHOT_MATCH_DIGEST_OFFSET, Sim, SnapshotRefused, encodeSim, type SnapshotMeta } from '@lions/sim';
import type { Env } from '../../../packages/worker/src/d1';
import { FakeState, deliverAlarm, deliverClose, openSocket, type FakeSocket } from '../../../packages/worker/src/match/fake-do';
import { MatchRoom, TICK_MS } from '../../../packages/worker/src/match/match-room';
import { signTicket } from '../../../packages/worker/src/match/ticket';
import { MAX_CATCHUP_TICKS, roomTickCap } from '../../../packages/app/src/net/catch-up';
import { shippedContentDigest } from '../../../packages/app/src/net/content-digest';
import type { MatchWorld } from '../../../packages/app/src/net/match-world';
import { FALLBACK_REASONS, SNAPSHOT_FETCH_TIMEOUT_MS, prepareRejoin, snapshotLink, type FallbackReason, type Prepared, type SnapshotLink } from '../../../packages/app/src/net/snapshot-link';
import { settleRejoin, type RestoreDeps } from '../../../packages/app/src/net/snapshot-rejoin';

const NOW = 1_790_000_000_000;
const SECRET = 'rejoin-catchup-secret';
const CODE = 'REJOIN';
const BUILD = 'b-rejoin';
const env = { DB: {}, ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: SECRET } as unknown as Env;
/** ms a tick: the cap's budget (12 ms) fits 12 of them, three times the floor. */
const COST_MS = 1;
/** Room ticks the match runs before the reload: the log the rejoiner must run down. */
const PLAYED = 1000;

/** The in-memory socket pair `room-loop.test.ts` uses, cut to what this needs. */
class Loop {
  private readonly pending = new Set<Promise<unknown>>();
  readonly received = new Map<SocketLike, ServerMsg[]>();
  /** Every socket opened, in order, and what each sent the room (snapshot S4 T12: the rejoiner's hellos). */
  readonly sockets: SocketLike[] = [];
  readonly sent = new Map<SocketLike, ClientMsg[]>();
  constructor(readonly room: MatchRoom, readonly state: FakeState) {}
  private track(p: Promise<unknown>): void {
    this.pending.add(p);
    const done = (): void => { this.pending.delete(p); };
    p.then(done, done);
  }
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
  readonly open = (): SocketLike => {
    const server: FakeSocket = openSocket(this.room);
    let live = true;
    const heard: ServerMsg[] = [];
    const said: ClientMsg[] = [];
    const client: SocketLike = {
      onopen: null, onmessage: null, onclose: null,
      send: (data) => {
        if (!live) throw new Error('send on a closed socket');
        said.push(JSON.parse(data) as ClientMsg);
        this.track(this.room.webSocketMessage(server.asSocket(), data));
      },
      // A reload: the tab's socket closes with no `bye`.
      close: () => {
        if (!live) return;
        live = false;
        this.track(deliverClose(this.room, server, 1001, 'going away'));
        this.track(Promise.resolve().then(() => client.onclose?.({})));
      },
    };
    server.onSend((text) => {
      if (!live) return;
      heard.push(JSON.parse(text) as ServerMsg);
      client.onmessage?.({ data: text });
    });
    this.received.set(client, heard);
    this.sockets.push(client);
    this.sent.set(client, said);
    this.track(Promise.resolve().then(() => client.onopen?.({})));
    return client;
  };
  /** One room tick, then the watchdog if it is due. */
  async tick(): Promise<void> {
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const storage = this.state.storage;
    if (storage.alarmAt !== null && storage.alarmAt <= Date.now()) await deliverAlarm(this.room, storage);
    await this.flush();
  }
}

interface SeatUpload {
  link: SnapshotLink;
  /** The snapshot bytes this seat uploads for snapshot tick `tick`. */
  rawFor: (tick: number) => Uint8Array;
}

interface SeatOptions {
  /** The transport's `onStart` (default nothing). */
  onStart?: (config: MatchConfig) => void;
  /** A snapshot rejoin's start (`WsTransport`'s `from`). */
  from?: number;
  /** The digest this seat reports at a hash tick (default 0x5eed). */
  digest?: number;
  /** Set: upload a snapshot at each snapshot tick this seat runs. */
  upload?: SeatUpload;
}

/** The production cadence: the room's `MatchRoom` default, minted into every config. */
const SNAPSHOT_EVERY = 1200;

/** A seat's frame loop with no sim: run up to `cap` frames, ack and hash as the battlefield does. */
class Seat {
  readonly taken: Frame[] = [];
  readonly t: WsTransport;
  /** Uploads in flight (snapshot S4 T12), each settled by `settle()`. */
  private readonly flying: Promise<void>[] = [];
  /** What each upload came to, in order. */
  readonly outcomes: { tick: number; outcome: string }[] = [];
  constructor(loop: Loop, ticket: string, private readonly o: SeatOptions = {}) {
    this.t = new WsTransport(loop.open, ticket, BUILD, { onStart: (config) => { o.onStart?.(config); } }, undefined, 'seat', o.from === undefined ? {} : { from: o.from });
  }
  run(cap: number): number {
    const frames = this.t.take(cap);
    for (const f of frames) {
      this.taken.push(f);
      this.t.reportTick(f.tick, f.tick % 20 === 19 ? (this.o.digest ?? 0x5eed) : null);
      // The producer's moment (`runFrames` then `afterFrame`): a seat with a link uploads at each snapshot tick it runs.
      const up = this.o.upload;
      if (up !== undefined && isSnapshotTick(f.tick, SNAPSHOT_EVERY)) this.flying.push(this.uploadAt(f.tick, up));
    }
    return frames.length;
  }
  private async uploadAt(tick: number, up: SeatUpload): Promise<void> {
    const gz = await gzipBytes(up.rawFor(tick));
    this.outcomes.push({ tick, outcome: await up.link.upload(tick, gz) });
  }
  /** Waits for every upload started so far (they run on real event-loop turns, under the room's fake clock). */
  async settle(): Promise<void> {
    while (this.flying.length > 0) await this.flying.shift();
  }
  /** The battlefield's cap (`main.ts`'s frame loop): the status, the cost, and the clock's backlog. */
  cap(): number {
    return roomTickCap(this.t.status(), COST_MS, this.t.behind());
  }
}

beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('a reload rejoin (I-1)', () => {
  it('runs its log down at the raised cap THROUGH the room\'s behind-stall, and frees the other seat in far fewer room ticks than the floor would', async () => {
    const state = new FakeState();
    const room = new MatchRoom(state, env);
    const created = await room.fetch(new Request('https://room/create', {
      method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', build: BUILD, player: 'Host', callsign: 'Host' }),
    }));
    expect(created.status).toBe(200);
    expect((await room.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: 'Guest', callsign: 'Guest' }) }))).status).toBe(200);
    const loop = new Loop(room, state);
    const exp = NOW + 3600 * 1000;
    const ticket1 = await signTicket(SECRET, { matchId: CODE, seat: 1, player: 'Guest', exp });
    const p0 = new Seat(loop, await signTicket(SECRET, { matchId: CODE, seat: 0, player: 'Host', exp }));
    const first1 = new Seat(loop, ticket1);
    await loop.flush();
    p0.t.ready();
    first1.t.ready();
    await loop.flush();
    for (let i = 0; i < PLAYED; i++) {
      await loop.tick();
      p0.run(10);
      first1.run(10);
      await loop.flush();
    }
    expect(first1.taken.length).toBeGreaterThan(PLAYED - 10);

    // The reload: the old tab's socket closes with no bye; the new tab rejoins with the stored ticket.
    first1.t.detach();
    await loop.flush();
    const p1 = new Seat(loop, ticket1);
    await loop.flush();
    expect(p1.t.behind()).toBeGreaterThan(PLAYED - 10);   // the whole log, from tick 0

    let stalledFarBehind = 0;
    let roomTicks = 0;
    while (roomTicks < 400 && !(p1.t.status().kind === 'live' && p1.t.behind() <= 2)) {
      await loop.tick();
      roomTicks++;
      p0.run(10);
      const status = p1.t.status();
      const cap = p1.cap();
      if (status.kind === 'stalled' && status.reason === 'behind' && p1.t.behind() > 2 * MAX_CATCHUP_TICKS) {
        stalledFarBehind++;
        // The point of I-1: a behind-stalled rejoiner far behind runs at the raised cap, not the floor.
        expect(cap, `cap at room tick ${roomTicks}, ${p1.t.behind()} behind`).toBe(12);
      }
      p1.run(cap);
      await loop.flush();
    }
    // The room really did behind-stall on the rejoiner while it was still far behind...
    const heard0 = [...loop.received.values()][0];
    expect(heard0).toContainEqual({ t: 'stall', reason: 'behind', seat: 1 });
    expect(stalledFarBehind).toBeGreaterThan(10);
    // ...and the rejoiner caught up: at 12 a frame it gains 11 ticks a room
    // tick and needs ~90; at the floor it would gain 3 and need over 300.
    expect(p1.t.status().kind).toBe('live');
    expect(roomTicks).toBeLessThan(130);
    // The same frames, in order, on both seats.
    expect(p1.taken.map((f) => f.tick)).toEqual(Array.from({ length: p1.taken.length }, (_, i) => i));
    expect(p1.taken).toEqual(p0.taken.slice(0, p1.taken.length));
  });
});

// Snapshot S4, Task 1A: the baseline. Today's reload replays the WHOLE log
// from tick 0, and the room freezes the other seat for as long as it takes, so
// the frozen time grows with the log. The snapshot client (S4) exists to remove
// that growth; these numbers are the "before". The harness is the one above.
// Counted on the room's clock (one room tick = TICK_MS), not wall time: the
// browser's own frame cost is Task 1C's.
interface Baseline {
  /** The rejoiner's `behind()` right after its `log`: the frames it must run. */
  replayed: number;
  /** Room ticks, from the drop until the rejoiner is live within 2, in which seat 0 was `stalled`. */
  frozenRoomTicks: number;
  /** Room ticks from the `hello` until the rejoiner is live within 2. */
  catchUpRoomTicks: number;
}

/** A match of `played` room ticks, then seat 1 reloads (`reload`) or only drops its socket and keeps its transport. */
async function runBaseline(played: number, reload: boolean): Promise<Baseline> {
  const state = new FakeState();
  const room = new MatchRoom(state, env);
  const created = await room.fetch(new Request('https://room/create', {
    method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', build: BUILD, player: 'Host', callsign: 'Host' }),
  }));
  expect(created.status).toBe(200);
  expect((await room.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: 'Guest', callsign: 'Guest' }) }))).status).toBe(200);
  const loop = new Loop(room, state);
  const exp = NOW + 3600 * 1000;
  const ticket1 = await signTicket(SECRET, { matchId: CODE, seat: 1, player: 'Guest', exp });
  const p0 = new Seat(loop, await signTicket(SECRET, { matchId: CODE, seat: 0, player: 'Host', exp }));
  const first1 = new Seat(loop, ticket1);
  await loop.flush();
  p0.t.ready();
  first1.t.ready();
  await loop.flush();
  for (let i = 0; i < played; i++) {
    await loop.tick();
    p0.run(10);
    first1.run(10);
    await loop.flush();
  }
  expect(first1.taken.length).toBeGreaterThan(played - 10);

  let p1: Seat;
  if (reload) {
    // A reload: the old tab's socket closes with no bye; the new tab rejoins with the stored ticket.
    first1.t.detach();
    await loop.flush();
    p1 = new Seat(loop, ticket1);
    await loop.flush();
  } else {
    // A socket drop with no reload: the transport survives and reconnects after RECONNECT_DELAY_MS.
    (first1.t as unknown as { sock: SocketLike }).sock.close();
    await loop.flush();
    p1 = first1;
  }
  const replayed = p1.t.behind();
  let frozenRoomTicks = 0;
  let catchUpRoomTicks = 0;
  while (catchUpRoomTicks < 3000 && !(catchUpRoomTicks > 0 && p1.t.status().kind === 'live' && p1.t.behind() <= 2)) {
    await loop.tick();
    catchUpRoomTicks++;
    p0.run(10);
    if (p0.t.status().kind === 'stalled') frozenRoomTicks++;
    p1.run(p1.cap());
    await loop.flush();
  }
  expect(p1.t.status().kind).toBe('live');
  return { replayed, frozenRoomTicks, catchUpRoomTicks };
}

describe('baseline: the full-log reload (snapshot S4 T1)', () => {
  it('replays the whole log, and the other seat is frozen for longer the longer the match ran', async () => {
    const small = await runBaseline(1200, true);
    const large = await runBaseline(6000, true);
    const name = `1200 ticks: replayed ${small.replayed}, frozen ${small.frozenRoomTicks}, catch-up ${small.catchUpRoomTicks}; `
      + `6000 ticks: replayed ${large.replayed}, frozen ${large.frozenRoomTicks}, catch-up ${large.catchUpRoomTicks}`;
    // The six numbers are the test's output (Task 1C reads them beside the browser's): in the log and in every failure message.
    console.log(`rejoin baseline (full-log reload) -- ${name}`);
    expect(small.replayed, name).toBeGreaterThanOrEqual(1200 - 10);
    expect(large.replayed, name).toBeGreaterThanOrEqual(6000 - 10);
    expect(small.frozenRoomTicks, name).toBeGreaterThan(0);
    // Frozen time grows with the log: the property S4 removes.
    expect(large.frozenRoomTicks, name).toBeGreaterThan(3 * small.frozenRoomTicks);
  }, 10_000);   // two runs of the file took 0.43 s each; the margin is for a loaded CI runner
});


// ---------------------------------------------------------------------------
// Snapshot S4, Task 12: the stall bound, and every fallback branch.
//
// The rejoiner is built by the REAL client code: `prepareRejoin` over a
// `snapshotLink` whose fetch is routed to the room, a `WsTransport` that starts
// at `from`, and `settleRejoin` at `onStart` (restart deferred past the log
// handler, as `AgentClient` does). The seats run no sim, so the snapshot is
// the bytes of a tiny `Sim` whose header carries the digest the seats report
// (`AGREED`), and the world a rejoiner restores onto is that tiny sim again:
// the restore, the digest after it and the cadence checks are the real ones.
// Task 13 does the same with real worlds.
// ---------------------------------------------------------------------------
const ORIGIN = 'https://room.test';
const tinySim = (seed = 1): Sim => new Sim({ seed, width: 8, height: 8, capacity: 4 });
const tinyWorld = (seed = 1): MatchWorld => ({ sim: tinySim(seed), runtime: null }) as unknown as MatchWorld;
/** The digest both seats report at every hash tick, and the snapshot header's `matchDigest` (as a u32). */
const AGREED = matchDigest(tinySim().hash(), 0, shippedContentDigest());
const rawAt = (tick: number, over: Partial<SnapshotMeta> = {}, sim: Sim = tinySim()): Uint8Array =>
  encodeSim(sim, { build: BUILD, matchId: CODE, contentDigest: shippedContentDigest() >>> 0, frameTick: tick, matchDigest: AGREED >>> 0, ...over });

/** A `fetch` that reaches the room's snapshot route, whatever the URL (the real URL shape is `snapshotLink`'s). */
const routed = (room: MatchRoom): typeof fetch => (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
  room.fetch(new Request('https://room/snapshot', { ...init, duplex: 'half' } as RequestInit))) as typeof fetch;

interface Rig {
  room: MatchRoom;
  loop: Loop;
  ticket0: string;
  ticket1: string;
  p0: Seat;
  first1: Seat;
  /** Room ticks run so far (drives the order cadence). */
  n: number;
}

/** A created room with both seats joined and playing. A seat uploads the tiny snapshot at each snapshot tick it runs. */
async function newRig(o: { mode: 'versus' | 'sandbox'; lostAt?: number }): Promise<Rig> {
  const state = new FakeState();
  // Fake timers never fire an upload's inflate turn (a zero-delay timer): a real event-loop turn stands in.
  const room = new MatchRoom(state, env, { inflateYield: (): Promise<void> => realImmediate() });
  const created = await room.fetch(new Request('https://room/create', {
    method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', ...(o.mode === 'versus' ? { mode: 'versus' } : {}), build: BUILD, player: 'Host', callsign: 'Host' }),
  }));
  expect(created.status).toBe(200);
  expect((await room.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: 'Guest', callsign: 'Guest' }) }))).status).toBe(200);
  const loop = new Loop(room, state);
  const exp = NOW + 3600 * 1000;
  const ticket0 = await signTicket(SECRET, { matchId: CODE, seat: 0, player: 'Host', exp });
  const ticket1 = await signTicket(SECRET, { matchId: CODE, seat: 1, player: 'Guest', exp });
  const linkOf = (ticket: string): SnapshotLink => snapshotLink({ fetch: routed(room), origin: ORIGIN, code: CODE, ticket, yieldTurn: (): Promise<void> => realImmediate() });
  const p0 = new Seat(loop, ticket0, { digest: AGREED, upload: { link: linkOf(ticket0), rawFor: (t) => rawAt(t) } });
  // The lost-cadence case: this seat's bytes for `lostAt` differ from its peer's (another sim), so the room drops the pair.
  const first1 = new Seat(loop, ticket1, { digest: AGREED, upload: { link: linkOf(ticket1), rawFor: (t) => (t === o.lostAt ? rawAt(t, {}, tinySim(2)) : rawAt(t)) } });
  await loop.flush();
  p0.t.ready();
  first1.t.ready();
  await loop.flush();
  return { room, loop, ticket0, ticket1, p0, first1, n: 0 };
}

const order = (n: number) => ({ kind: 'attackMove' as const, ids: [1 + (n % 7)], x: 65536 * (2 + (n % 5)), y: 65536 * (3 + (n % 3)) });

/** Plays room ticks until seat 1 (the one that will reload) has run `frames` frames. Orders ride the frames so equality means something. */
async function advance(rig: Rig, frames: number): Promise<void> {
  while (rig.first1.taken.length < frames) {
    const n = rig.n++;
    await rig.loop.tick();
    if (n % 100 === 50) rig.p0.t.queueCommand(order(n));
    if (n % 100 === 0 && n > 0) rig.first1.t.queueCommand(order(n + 1));
    rig.p0.run(10);
    rig.first1.run(10);
    await rig.p0.settle();
    await rig.first1.settle();
    await rig.loop.flush();
  }
}

/** The tick of the snapshot the room would serve a seat now ('none' for a 204). */
async function servedTick(rig: Rig): Promise<string> {
  const res = await routed(rig.room)('', { method: 'GET', headers: { authorization: `Bearer ${rig.ticket0}` } });
  return res.status === 200 ? (res.headers.get('x-snapshot-tick') ?? 'no header') : 'none';
}

interface RejoinOpts {
  /** Replaces the rejoiner's fetch (the one-change fakes of the fallback table). */
  fetch?: typeof fetch;
  /** Fake-timer ms to advance while the GET is in flight (the timeout row). */
  advanceMs?: number;
  /** Changes the config `settleRejoin` sees (a post-hello reason by a config field). */
  tamper?: (c: MatchConfig) => MatchConfig;
  /** The restore / build `settleRejoin` is given (default: the tiny world, the real `restoreSim`). */
  deps?: () => RestoreDeps;
}

interface Rejoined {
  p1: Seat;
  prepared: Prepared;
  /** What `settleRejoin` handed the battlefield, or null if `onStart` never ran. */
  settled: () => ReturnType<typeof settleRejoin> | null;
  restarts: () => number;
  /** The rejoiner's hellos in order, across all its sockets. */
  hellos: () => { from?: number }[];
  sockets: () => number;
  /** `behind()` once the log has arrived (and the restart's log, on a post-hello fallback). */
  behindAtLog: number;
}

/** A reload of seat 1: `prepareRejoin`, a transport that starts at `from`, `settleRejoin` at `onStart`. */
async function rejoin(rig: Rig, o: RejoinOpts = {}): Promise<Rejoined> {
  const link = snapshotLink({ fetch: o.fetch ?? routed(rig.room), origin: ORIGIN, code: CODE, ticket: rig.ticket1, yieldTurn: (): Promise<void> => realImmediate() });
  const pending = prepareRejoin(link, { code: CODE, build: BUILD, contentDigest: shippedContentDigest() });
  if (o.advanceMs !== undefined) await vi.advanceTimersByTimeAsync(o.advanceMs);
  const prepared = await pending;
  const first = rig.loop.sockets.length;
  let settled: ReturnType<typeof settleRejoin> | null = null;
  let restarts = 0;
  const me: { seat?: Seat } = {};
  const deps = { build: () => tinyWorld(), ...o.deps?.() };
  const p1 = new Seat(rig.loop, rig.ticket1, {
    digest: AGREED,
    ...(prepared.path === 'snapshot' ? { from: prepared.verified.frameTick + 1 } : {}),
    onStart: (config) => {
      // Not inside the log handler: the restart is deferred one microtask, as `AgentClient` does (`WsTransport.restartFromZero`).
      settled = settleRejoin(o.tamper === undefined ? config : o.tamper(config), prepared, { restartFromZero: () => { restarts++; queueMicrotask(() => { me.seat?.t.restartFromZero(); }); } }, deps);
    },
  });
  me.seat = p1;
  await rig.loop.flush();
  const mine = (): SocketLike[] => rig.loop.sockets.slice(first);
  return {
    p1, prepared, behindAtLog: p1.t.behind(),
    settled: () => settled, restarts: () => restarts, sockets: () => mine().length,
    hellos: () => mine().flatMap((sk) => rig.loop.sent.get(sk) ?? []).filter((m): m is Extract<ClientMsg, { t: 'hello' }> => m.t === 'hello').map((m) => (m.from === undefined ? {} : { from: m.from })),
  };
}

/** Room ticks, as `runBaseline` counts them, from now until the rejoiner is live within 2. */
async function catchUp(rig: Rig, p1: Seat): Promise<{ frozenRoomTicks: number; roomTicks: number }> {
  let frozenRoomTicks = 0;
  let roomTicks = 0;
  while (roomTicks < 3000 && !(roomTicks > 0 && p1.t.status().kind === 'live' && p1.t.behind() <= 2)) {
    await rig.loop.tick();
    roomTicks++;
    rig.p0.run(10);
    await rig.p0.settle();
    if (rig.p0.t.status().kind === 'stalled') frozenRoomTicks++;
    p1.run(p1.cap());
    await rig.loop.flush();
  }
  expect(p1.t.status().kind).toBe('live');
  return { frozenRoomTicks, roomTicks };
}

/** The rejoiner's frames are consecutive from `from` and are seat 0's, command for command. */
function expectSameFrames(rig: Rig, p1: Seat, from: number, label: string): void {
  expect(p1.taken.length, label).toBeGreaterThan(0);
  expect(p1.taken.map((f) => f.tick), label).toEqual(Array.from({ length: p1.taken.length }, (_, i) => from + i));
  expect(p1.taken, label).toEqual(rig.p0.taken.slice(from, from + p1.taken.length));
  // Premise: orders rode these frames, so the comparison covers more than empty frames.
  expect(p1.taken.some((f) => f.cmds.length > 0), `${label}: some replayed frame carries an order`).toBe(true);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('a snapshot rejoin: the stall bound (snapshot S4 T12)', () => {
  it('the worst case: seat 1 drops after frame 3,598, before its upload of 3,599. It replays at most 1,242 frames from 2,400, and seat 0 is frozen for under half the full-log baseline', async () => {
    const rig = await newRig({ mode: 'versus' });
    await advance(rig, 3599);
    expect(rig.first1.taken.length).toBe(3599);
    expect(rig.first1.taken[3598]?.tick).toBe(3598);
    // Both cadences so far were accepted (one stored and one held each: the pair's first upload is held), and 3,599 is not uploaded yet.
    for (const seat of [rig.p0, rig.first1]) expect(seat.outcomes.map((x) => x.tick)).toEqual([1199, 2399]);
    const all = [...rig.p0.outcomes, ...rig.first1.outcomes];
    expect(all.filter((x) => x.outcome === 'stored').map((x) => x.tick).sort()).toEqual([1199, 2399]);
    expect(all.filter((x) => x.outcome === 'held').map((x) => x.tick).sort()).toEqual([1199, 2399]);
    expect(await servedTick(rig)).toBe('2399');

    rig.first1.t.detach();
    await rig.loop.flush();
    const r = await rejoin(rig);
    // The path ran (G-7): a snapshot, from 2,400, and the hello said so.
    expect(r.prepared.path).toBe('snapshot');
    expect(r.settled()?.rejoin).toMatchObject({ path: 'snapshot', from: 2400 });
    expect(r.hellos()).toEqual([{ from: 2400 }]);
    expect(r.restarts()).toBe(0);
    // Ruling 9: at most every + 42 frames. 1,242 = 1,200 + STALL_BEHIND_TICKS (40) + bufferTicks (2).
    // The room is frozen (`gone`) from the drop to the hello, so right after the log the backlog is 3,598 - 2,400 + 1 frames; the worst case is reached (>= 1,150).
    expect(r.behindAtLog).toBeLessThanOrEqual(1242);
    expect(r.behindAtLog).toBeGreaterThanOrEqual(1150);
    const { frozenRoomTicks, roomTicks } = await catchUp(rig, r.p1);
    // The frames run to be live, including those the room minted while it caught up.
    expect(r.p1.taken.length).toBeLessThanOrEqual(1242);
    expect(r.p1.taken.length).toBeGreaterThanOrEqual(1150);
    expectSameFrames(rig, r.p1, 2400, 'snapshot rejoin');
    // The baseline, measured here at the same PLAYED: a reload with no snapshot.
    const base = await runBaseline(3599, true);
    console.log(`rejoin by snapshot, worst case: replayed ${r.behindAtLog} at the log, ${r.p1.taken.length} to live; seat 0 frozen ${frozenRoomTicks} room ticks (${roomTicks} to live) against ${base.frozenRoomTicks} frozen / ${base.catchUpRoomTicks} to live for the full log (${base.replayed} replayed)`);
    expect(base.replayed).toBeGreaterThanOrEqual(3599 - 10);
    expect(frozenRoomTicks, `frozen ${frozenRoomTicks} vs baseline ${base.frozenRoomTicks}`).toBeLessThan(base.frozenRoomTicks / 2);
  }, 30_000);

  it('a lost cadence: seat 1\'s bytes for 2,399 differ, the room drops the pair and keeps 1,199; the rejoin is from 1,200 and replays at most 2,442 frames', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rig = await newRig({ mode: 'versus', lostAt: 2399 });
    await advance(rig, 3599);
    // The room saw the mismatch (it tries to log it to a D1 this fake does not have), and keeps the older snapshot.
    expect(errors.mock.calls.some((c) => String(c[0]).includes('snapshot mismatch'))).toBe(true);
    const at2399 = [...rig.p0.outcomes, ...rig.first1.outcomes].filter((x) => x.tick === 2399).map((x) => x.outcome).sort();
    expect(at2399).toEqual(['held', 'mismatch']);
    expect(await servedTick(rig)).toBe('1199');

    rig.first1.t.detach();
    await rig.loop.flush();
    const r = await rejoin(rig);
    expect(r.settled()?.rejoin).toMatchObject({ path: 'snapshot', from: 1200 });
    expect(r.hellos()).toEqual([{ from: 1200 }]);
    // 2 x every + 42, and the worst case is reached: 3,598 - 1,200 + 1.
    expect(r.behindAtLog).toBeLessThanOrEqual(2442);
    expect(r.behindAtLog).toBeGreaterThanOrEqual(2350);
    await catchUp(rig, r.p1);
    expect(r.p1.taken.length).toBeLessThanOrEqual(2442);
    expectSameFrames(rig, r.p1, 1200, 'lost cadence');
  }, 30_000);
});

/** What the room served, ready to be changed one way: the headers and the inflated bytes. */
interface Served { headers: Record<string, string>; raw: Uint8Array }
/** A fetch that serves the room's own answer after `edit` has changed it; `edit` may return a whole Response instead. */
const serving = (real: typeof fetch, edit: (s: Served) => Response | undefined | Promise<Response | undefined>): typeof fetch =>
  (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const res = await real(input, init);
    if (res.status !== 200) return res;
    const headers = Object.fromEntries(res.headers.entries());
    const inflated = await gunzipCapped(new Uint8Array(await res.arrayBuffer()), 64 * 1024 * 1024, () => realImmediate());
    if (!inflated.ok) throw new Error('fixture: the room served bytes that do not inflate');
    const s: Served = { headers, raw: inflated.bytes };
    const direct = await edit(s);
    if (direct !== undefined) return direct;
    return new Response((await gzipBytes(s.raw)) as BodyInit, { status: 200, headers: s.headers });
  }) as typeof fetch;
const resha = async (s: Served): Promise<void> => { s.headers['x-snapshot-sha'] = await sha256Hex(s.raw); };
const flip = (s: Served, at: number): void => { s.raw[at] = (s.raw[at] ?? 0) ^ 1; };
/** Where the match id starts in the meta: after the build string (a u16 length, then bytes) and its own u16 length. */
const matchIdAt = (raw: Uint8Array): number => SNAPSHOT_META_OFFSET + 2 + new DataView(raw.buffer, raw.byteOffset).getUint16(SNAPSHOT_META_OFFSET, true) + 2;

interface Row {
  where: 'pre' | 'post';
  /** A sandbox room (default versus). */
  mode?: 'sandbox';
  /** Pre: how the GET goes wrong, given the real one. */
  fetch?: (real: typeof fetch) => typeof fetch;
  advanceMs?: number;
  /** Post: a config field changed under `settleRejoin`, or its restore / build. */
  tamper?: (c: MatchConfig) => MatchConfig;
  deps?: () => RestoreDeps;
}

/** One row per reason, typed by the table itself: a reason added to `FALLBACK_REASONS` is a compile error here, and a runtime one below. */
const ROWS: Record<FallbackReason, Row> = {
  fetch_failed: { where: 'pre', fetch: () => ((): never => { throw new TypeError('no socket'); }) as unknown as typeof fetch },
  timeout: { where: 'pre', fetch: () => (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch, advanceMs: SNAPSHOT_FETCH_TIMEOUT_MS },
  http_status: { where: 'pre', fetch: () => (async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch },
  none: { where: 'pre', fetch: () => (async () => new Response(null, { status: 204 })) as unknown as typeof fetch },
  bad_headers: { where: 'pre', fetch: (real) => serving(real, (s) => { delete s.headers['x-snapshot-sha']; return undefined; }) },
  too_large: { where: 'pre', fetch: (real) => serving(real, (s) => new Response(new Uint8Array(65537), { status: 200, headers: s.headers })) },
  bad_gzip: { where: 'pre', fetch: (real) => serving(real, (s) => new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { status: 200, headers: s.headers })) },
  // One bit flipped in the body after the room took its SHA: header and meta still read true.
  sha_mismatch: { where: 'pre', fetch: (real) => serving(real, (s) => { flip(s, s.raw.length - 1); return undefined; }) },
  bad_header: { where: 'pre', fetch: (real) => serving(real, async (s) => { s.raw[0] = 0x58; await resha(s); return undefined; }) },
  format: { where: 'pre', fetch: (real) => serving(real, async (s) => { s.raw[4] = 2; await resha(s); return undefined; }) },
  tick_mismatch: { where: 'pre', fetch: (real) => serving(real, (s) => { s.headers['x-snapshot-tick'] = String(Number(s.headers['x-snapshot-tick']) - 1); return undefined; }) },
  digest_mismatch: { where: 'pre', fetch: (real) => serving(real, (s) => { s.headers['x-snapshot-digest'] = String(Number(s.headers['x-snapshot-digest']) + 1); return undefined; }) },
  build_mismatch: { where: 'pre', fetch: (real) => serving(real, async (s) => { flip(s, SNAPSHOT_META_OFFSET + 2); await resha(s); return undefined; }) },
  content_mismatch: { where: 'pre', fetch: (real) => serving(real, async (s) => { flip(s, SNAPSHOT_MATCH_DIGEST_OFFSET + 4); await resha(s); return undefined; }) },
  match_mismatch: { where: 'pre', fetch: (real) => serving(real, async (s) => { flip(s, matchIdAt(s.raw)); await resha(s); return undefined; }) },
  // The room's config here is a sandbox one: `not_versus` arises naturally.
  not_versus: { where: 'post', mode: 'sandbox' },
  cadence_off: { where: 'post', tamper: (c) => ({ ...c, snapshotEveryTicks: 0 }) },
  not_snapshot_tick: { where: 'post', tamper: (c) => ({ ...c, snapshotEveryTicks: 1000 }) },
  config_match_mismatch: { where: 'post', tamper: (c) => ({ ...c, matchId: 'OTHER' }) },
  // The first build (the restore's) throws; the fresh world the fallback needs is built by the second.
  build_failed: { where: 'post', deps: () => { let n = 0; return { build: () => { if (n++ === 0) throw new Error('no such map'); return tinyWorld(); } }; } },
  refused: { where: 'post', deps: () => ({ restore: (): never => { throw new SnapshotRefused('test'); } }) },
  // The restore does nothing and the world is another sim: its digest is not the header's.
  digest_after_restore: { where: 'post', deps: () => { let n = 0; return { build: () => tinyWorld(n++ === 0 ? 2 : 1), restore: (() => undefined) as unknown as RestoreDeps['restore'] }; } },
  restore_threw: { where: 'post', deps: () => ({ restore: (): never => { throw new Error('boom'); } }) },
};

describe('every fallback reaches the full log (snapshot S4 T12)', () => {
  it('CENSUS: a row for every reason in FALLBACK_REASONS and for no other, each tagged as the table tags it', () => {
    expect(Object.keys(ROWS).sort()).toEqual(Object.keys(FALLBACK_REASONS).sort());
    for (const [reason, row] of Object.entries(ROWS)) expect(row.where, reason).toBe(FALLBACK_REASONS[reason as FallbackReason]);
    // Literal floor: the contract names 15 pre and 8 post reasons.
    expect(Object.values(ROWS).filter((r) => r.where === 'pre')).toHaveLength(15);
    expect(Object.values(ROWS).filter((r) => r.where === 'post')).toHaveLength(8);
  });

  it('the premise of the digest row: another seed is another hash', () => {
    expect(tinySim(2).hash()).not.toBe(tinySim(1).hash());
  });

  for (const [reason, row] of Object.entries(ROWS) as [FallbackReason, Row][]) {
    it(`${reason} (${row.where}-hello): the path is full with that reason, the hello and restart are as the table says, and the rejoiner ends live on frames 0..N equal to seat 0's`, async () => {
      const rig = await newRig({ mode: row.mode ?? 'versus' });
      await advance(rig, 1300);
      expect(await servedTick(rig), 'the room holds the snapshot of 1,199').toBe('1199');
      rig.first1.t.detach();
      await rig.loop.flush();
      const real = routed(rig.room);
      const r = await rejoin(rig, {
        ...(row.fetch === undefined ? {} : { fetch: row.fetch(real) }),
        ...(row.advanceMs === undefined ? {} : { advanceMs: row.advanceMs }),
        ...(row.tamper === undefined ? {} : { tamper: row.tamper }),
        ...(row.deps === undefined ? {} : { deps: row.deps }),
      });
      expect(r.settled()?.rejoin, 'the path is positive evidence').toEqual({ path: 'full', reason });
      if (row.where === 'pre') {
        expect(r.prepared).toEqual({ path: 'full', reason });
        expect(r.hellos()).toEqual([{}]);
        expect(r.restarts()).toBe(0);
        expect(r.sockets()).toBe(1);
      } else {
        // The snapshot passed every check made before the hello, so the first hello asked from 1,200...
        expect(r.prepared.path).toBe('snapshot');
        expect(r.hellos()).toEqual([{ from: 1200 }, {}]);
        // ...and the failure after the log restarted the transport once, which asked for the whole log.
        expect(r.restarts()).toBe(1);
        expect(r.sockets()).toBe(2);
      }
      expect(r.behindAtLog, 'the whole log').toBeGreaterThanOrEqual(1300 - 10);
      await catchUp(rig, r.p1);
      expectSameFrames(rig, r.p1, 0, reason);
    }, 30_000);
  }
});
