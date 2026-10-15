// N4a task 7, case 10: a bot seat and an advisor cost the room no more rows
// than R-N12 accepted for two humans (2.2 a second). The real `MatchRoom`
// over the fake Durable Object runtime, three real `WsTransport`s (two seats
// and seat 0's advisor), and the real `OrderDesk` feeding the bot -- so the
// cadence that holds the budget is the desk's own (decision D4), not a
// number copied into the test.
//
// It lives in tools/ because the desk does (R2): tools may import the worker
// by relative path; the worker never imports tools. The bound is
// `room-loop.test.ts`'s `bound()`, copied as arithmetic: a command frame closes
// its batch (one row), a batch with none closes every 20 ticks (one a second),
// and the watchdog re-arms every 5 s (0.2 a second).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsTransport, type AdvisorMsg, type Frame, type SocketLike } from '@lions/net';
import type { Env } from '../../../packages/worker/src/d1';
import { FakeState, deliverAlarm, deliverClose, openSocket, type FakeSocket } from '../../../packages/worker/src/match/fake-do';
import { MatchRoom, TICK_MS } from '../../../packages/worker/src/match/match-room';
import { signTicket } from '../../../packages/worker/src/match/ticket';
import { OrderDesk } from './order-desk';

const NOW = 1_790_000_000_000;
const SECRET = 'bot-row-budget-secret';
const CODE = 'BOTROW';
const BUILD = 'b-bot';
const env = { DB: {}, ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: SECRET } as unknown as Env;
const SECONDS = 60;
const TICKS_PER_SECOND = 1000 / TICK_MS;
/** A paced room (D5): one round a second, a bot waited for at most a second. */
const PACE = { kind: 'paced', roundTicks: 20, roundWallMs: 1000 } as const;

/** The in-memory socket pair `room-loop.test.ts` uses, cut to what this needs. */
class Loop {
  private readonly pending = new Set<Promise<unknown>>();
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
    const client: SocketLike = {
      onopen: null, onmessage: null, onclose: null,
      send: (data) => {
        if (!live) throw new Error('send on a closed socket');
        this.track(this.room.webSocketMessage(server.asSocket(), data));
      },
      close: () => {
        if (!live) return;
        live = false;
        this.track(deliverClose(this.room, server, 1000, 'client closed'));
        this.track(Promise.resolve().then(() => client.onclose?.({})));
      },
    };
    server.onSend((text) => { if (live) client.onmessage?.({ data: text }); });
    this.track(Promise.resolve().then(() => client.onopen?.({})));
    return client;
  };
  /** One room tick, then the watchdog alarm if it is due (R38). */
  async tick(): Promise<void> {
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const storage = this.state.storage;
    if (storage.alarmAt !== null && storage.alarmAt <= Date.now()) await deliverAlarm(this.room, storage);
    await this.flush();
  }
}

/** A seat's game loop with no sim: run what the transport yields, ack and hash. */
class Seat {
  readonly taken: Frame[] = [];
  readonly heard: { from: 'human' | 'advisor'; a: AdvisorMsg }[] = [];
  readonly t: WsTransport;
  constructor(loop: Loop, ticket: string, private readonly onFrame: (f: Frame) => void = () => {}) {
    this.t = new WsTransport(loop.open, ticket, BUILD, { onStart: () => {}, onAdvisor: (from, a) => { this.heard.push({ from, a }); } });
  }
  pump(): void {
    for (const f of this.t.take(10)) {
      this.taken.push(f);
      this.t.reportTick(f.tick, f.tick % 20 === 19 ? 0x5eed : null);
      this.onFrame(f);
    }
  }
  lastTick(): number { return this.taken.at(-1)?.tick ?? -1; }
}

beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

interface Run { rows: number; cmdFrames: number; botCmdFrames: number; frames: number; relayed: number; refused: number }

/** A 60 s running paced match: seat 1 is a bot whose model submits an order
 *  EVERY tick to its `OrderDesk`, and says `done` for every round it has run;
 *  seat 0 orders once a second; seat 0's assist advisor speaks four times a
 *  second, or not at all. */
async function botMatch(advisorSpeaks: boolean): Promise<Run> {
  const state = new FakeState();
  const room = new MatchRoom(state, env);
  const created = await room.fetch(new Request('https://room/create', {
    method: 'POST', body: JSON.stringify({ code: CODE, matchId: CODE, map: 'tel_marum', build: BUILD, player: 'Host', callsign: 'Host', mode: 'versus', pace: PACE }),
  }));
  expect(created.status).toBe(200);
  expect((await room.fetch(new Request('https://room/join', { method: 'POST', body: JSON.stringify({ player: 'Bot', callsign: 'Bot', kind: 'bot' }) }))).status).toBe(200);
  const loop = new Loop(room, state);
  const exp = NOW + 3600 * 1000;
  const human = new Seat(loop, await signTicket(SECRET, { matchId: CODE, seat: 0, player: 'Host', exp }));
  let desk: OrderDesk | null = null;
  const bot = new Seat(loop, await signTicket(SECRET, { matchId: CODE, seat: 1, player: 'Bot', exp }), (f) => { desk?.onTick(f.tick); });
  desk = new OrderDesk((cmd) => { bot.t.queueCommand(cmd); });
  // The bot says `done` for every round whose last frame it has RECEIVED: its
  // clock holds the newest `bufferTicks` frames back from `take`, and the room
  // mints no more until the bot is done, so waiting to RUN that frame would
  // hold every round to `roundWallMs`.
  let doneRound = -1;
  const sayDone = (): void => {
    const received = bot.lastTick() + bot.t.behind();
    const closed = Math.floor((received + 1) / PACE.roundTicks) - 1;
    if (closed > doneRound) { doneRound = closed; bot.t.done(closed); }
  };
  const advisor = new WsTransport(loop.open, await signTicket(SECRET, { matchId: CODE, seat: 0, player: 'advisor', exp, role: 'advisor', scope: 'assist' }), BUILD, { onStart: () => {} }, () => Date.now(), 'advisor');
  await loop.flush();
  human.t.ready();
  bot.t.ready();
  await loop.flush();
  expect(human.t.status().kind).toBe('live');

  const before = state.storage.rowsWritten;
  let refused = 0;
  let said = 0;
  for (let s = 0; s < SECONDS; s++) {
    for (let i = 0; i < TICKS_PER_SECOND; i++) {
      // The human: one order a second, mid-second.
      if (i === TICKS_PER_SECOND / 2) human.t.queueCommand({ kind: 'halt', ids: [s] });
      // The model: an order every tick; the desk queues 12 and refuses the rest.
      if ('error' in desk.submit({ kind: 'halt', ids: [1000 + s * TICKS_PER_SECOND + i] }, bot.lastTick())) refused++;
      // The advisor: four a second, ADVISOR_MIN_GAP_MS apart.
      if (advisorSpeaks && i % 5 === 0) {
        advisor.advisor(said % 2 === 0
          ? { kind: 'proposal', id: said, cmd: { kind: 'halt', ids: [said] }, note: 'hold' }
          : { kind: 'text', text: `t${said}` });
        said++;
      }
      await loop.tick();
      human.pump();
      bot.pump();
      sayDone();
      await loop.flush();
    }
  }
  // The match really ran, paced, for the whole minute, and nobody fell out.
  expect(human.t.status().kind).toBe('live');
  expect(bot.t.status().kind).toBe('live');
  expect(bot.taken).toEqual(human.taken.slice(0, bot.taken.length));
  return {
    rows: state.storage.rowsWritten - before,
    cmdFrames: human.taken.filter((f) => f.cmds.length > 0).length,
    botCmdFrames: human.taken.filter((f) => f.cmds.some((c) => c.seat === 1)).length,
    frames: human.taken.length,
    relayed: human.heard.length,
    refused,
  };
}
const bound = (b: { cmdFrames: number; seconds: number }): number => Math.max(b.cmdFrames, b.seconds) + 0.2 * b.seconds;

describe('Workers Free with a bot seat and an advisor (N4a task 7, R-N12, D4)', () => {
  it('a bot fed by the OrderDesk every tick, a human ordering once a second and an assist advisor speaking four times a second: rows <= the R-N12 bound and <= 2.2 a second; the advisor costs zero rows', async () => {
    const loud = await botMatch(true);
    expect(loud.frames).toBeGreaterThan(SECONDS * TICKS_PER_SECOND - 30);
    expect(loud.refused).toBeGreaterThan(SECONDS * TICKS_PER_SECOND / 2);   // the model really outran the desk
    expect(loud.botCmdFrames).toBeLessThanOrEqual(SECONDS + 1);                // ...which flushed at most once a second
    expect(loud.relayed).toBeGreaterThan(SECONDS * 4 - 5);                     // and the advisor really spoke
    expect(loud.rows, `${loud.rows} rows in ${SECONDS} s`).toBeLessThanOrEqual(bound({ cmdFrames: loud.cmdFrames, seconds: SECONDS }));
    expect(loud.rows).toBeLessThanOrEqual(2.2 * 60 + 1);
    const quiet = await botMatch(false);
    expect(quiet.relayed).toBe(0);
    expect(quiet.frames).toBe(loud.frames);
    expect(loud.rows).toBe(quiet.rows);
  });
});
