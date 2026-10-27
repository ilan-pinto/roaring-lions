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
import { WsTransport, type Frame, type ServerMsg, type SocketLike } from '@lions/net';
import type { Env } from '../../../packages/worker/src/d1';
import { FakeState, deliverAlarm, deliverClose, openSocket, type FakeSocket } from '../../../packages/worker/src/match/fake-do';
import { MatchRoom, TICK_MS } from '../../../packages/worker/src/match/match-room';
import { signTicket } from '../../../packages/worker/src/match/ticket';
import { MAX_CATCHUP_TICKS, roomTickCap } from '../../../packages/app/src/net/catch-up';

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
    const client: SocketLike = {
      onopen: null, onmessage: null, onclose: null,
      send: (data) => {
        if (!live) throw new Error('send on a closed socket');
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

/** A seat's frame loop with no sim: run up to `cap` frames, ack and hash as the battlefield does. */
class Seat {
  readonly taken: Frame[] = [];
  readonly t: WsTransport;
  constructor(loop: Loop, ticket: string) {
    this.t = new WsTransport(loop.open, ticket, BUILD, { onStart: () => {} });
  }
  run(cap: number): number {
    const frames = this.t.take(cap);
    for (const f of frames) {
      this.taken.push(f);
      this.t.reportTick(f.tick, f.tick % 20 === 19 ? 0x5eed : null);
    }
    return frames.length;
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
