// N4b task 12: the arena's two baselines (`passive`, `rush`) and the
// in-process player, played on the local relay -- the real Worker routes and
// the real `MatchRoom`, real sockets, paced rooms. Every relay and player a
// test starts is closed by its own handle in `afterEach`; every port is the
// OS's (`listen(0)`).
//
// The base rate behind the rush control, measured in the pure sim at the
// relay's own latency (orders run in the next round's first frame), tel_marum,
// pace 60, cap 12,000 (the arena's defaults): on 20 held-out seeds (2..21) x
// both seat orders rush scores 0.750 against passive (30 won, 10 lost); on the
// arena gate's own seeds (1000 + 7919n, n = 0..9) 0.750 (15 won, 5 lost), read
// and not tuned on. Below Task 16's >= 0.9: see the task-12 report. The seed
// pinned below (3) is a held-out seed the shipped rush wins in both orders by
// annihilation -- a regression pin, not evidence of the rate.
import { afterEach, describe, expect, it } from 'vitest';
import { fx, type Command } from '@lions/sim';
import type { MatchResult } from '../../../packages/app/src/net/outcome';
import { capOutcome } from './cap';
import { startLocalRelay, type LocalRelay } from './local-relay';
import { inProcess, passive, rush, type ArenaPlayer, type Policy, type RunningPlayer } from './players';
import type { SideView } from './view';

const BUILD = 'b-players';
const MAP = 'tel_marum';
const ROUND_TICKS = 40;
/** The arena's own round wall (`arena.ts`, `--round-wall-ms`, default 120 s):
 *  every paced game here plays on it unless the test is ABOUT the wall. A
 *  healthy round is released by both seats' `done` in milliseconds, so at
 *  120 s no load this machine sees can make the wall release one first. */
const ARENA_ROUND_WALL_MS = 120_000;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    try { await c?.(); } catch { /* the next one still runs */ }
  }
});

async function relayOf(seed: number, tickMs = 1): Promise<LocalRelay> {
  const relay = await startLocalRelay({ log: () => {}, tickMs, seedFor: () => seed });
  cleanups.push(() => relay.close());
  return relay;
}
const post = (relay: LocalRelay, path: string, body: unknown): Promise<Response> =>
  fetch(`${relay.url}${path}`, { method: 'POST', headers: { origin: relay.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** A paced versus room with two bot seats, through the relay's own routes. */
async function pacedRoom(relay: LocalRelay, roundWallMs: number, roundTicks = ROUND_TICKS): Promise<{ code: string; tickets: [string, string] }> {
  const pace = { kind: 'paced', roundTicks, roundWallMs };
  const created = await post(relay, '/api/match', { player: 'bot-a', callsign: 'A', build: BUILD, map: MAP, mode: 'versus', kind: 'bot', pace });
  expect(created.status).toBe(201);
  const { code, ticket } = (await created.json()) as { code: string; ticket: string };
  const joined = await post(relay, `/api/match/${code}/join`, { player: 'bot-b', callsign: 'B', kind: 'bot' });
  expect(joined.status).toBe(200);
  const j = (await joined.json()) as { seat: number; ticket: string };
  return { code, tickets: [ticket, j.ticket] };
}

interface Game {
  /** The sim's own result, or the cap's on seat 0's sim. */
  result: MatchResult;
  /** Whether the result is the cap's. */
  capped: boolean;
  ticks: number;
  ms: number;
  /** The longest round wait either seat saw (`stats().stalls.round`, from the
   *  room's `stall` to its `resume`): the room holding a boundary for a bot
   *  seat's `done`. Not the game's total: the window holds only what the
   *  seats do inside it, catching up on at most about one round of frames
   *  and answering, which is bounded and tiny against the wall. */
  roundWaitMs: number;
  /** Per seat, the round waits the room CLOSED (a `stall` then its `resume`),
   *  as of the moment that seat finished: a count, so it does not read the
   *  machine. A wait still open then (the boundary at the cap, which no seat
   *  is asked about) is left out. */
  roundWaits: [number, number];
  running: [RunningPlayer, RunningPlayer];
}

/** Plays one game, `players[s]` on seat `s` (seat s is side s in versus), to
 *  a result or the cap; the cap's result is `capOutcome` on seat 0's sim. */
async function play(players: [ArenaPlayer, ArenaPlayer], o: { seed: number; capTicks: number; roundWallMs?: number; roundTicks?: number; timeoutMs: number }): Promise<Game> {
  const relay = await relayOf(o.seed);
  const { code, tickets } = await pacedRoom(relay, o.roundWallMs ?? ARENA_ROUND_WALL_MS, o.roundTicks);
  const t0 = Date.now();
  const running = await Promise.all(([0, 1] as const).map((seat) => players[seat].start({
    server: relay.url, origin: relay.origin, code, seat, ticket: tickets[seat], build: BUILD, capTicks: o.capTicks,
  }))) as [RunningPlayer, RunningPlayer];
  for (const r of running) cleanups.push(() => r.stop());
  // Read in the same microtask the player finishes in, before any later
  // message (the cap's own wait being released, say) can land.
  const finishedWaits = running.map((r) => r.done.then(() => {
    const t = r.client?.transport;
    if (t === undefined) throw new Error('an in-process player has a client');
    const st = t.status();
    const open = st.kind === 'stalled' && st.reason === 'round' ? 1 : 0;
    return t.stats().stalls.round.count - open;
  }));
  const config = await running[0].client?.ready;
  // A malformed pace is silently realtime: a "paced" result from a realtime room would be no result.
  expect(config?.pace).toEqual({ kind: 'paced', roundTicks: o.roundTicks ?? ROUND_TICKS, roundWallMs: o.roundWallMs ?? ARENA_ROUND_WALL_MS });
  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    Promise.all(running.map((r) => r.done)),
    new Promise((_, rej) => { timer = setTimeout(() => { rej(new Error(`no end in ${o.timeoutMs} ms: ticks ${running.map((r) => r.client?.tick()).join(', ')}`)); }, o.timeoutMs); }),
  ]);
  if (timer !== null) clearTimeout(timer);
  const ms = Date.now() - t0;
  const [a, b] = running.map((r) => r.client);
  if (a === null || b === null) throw new Error('an in-process player has a client');
  const roundWaitMs = Math.max(a.transport.stats().stalls.round.longestMs, b.transport.stats().stalls.round.longestMs);
  const [w0, w1] = await Promise.all(finishedWaits);
  const sim = a.world()?.sim;
  if (sim === undefined) throw new Error('seat 0 never built its world');
  const own = a.result();
  const result = own ?? capOutcome(sim);
  // Both seats ran the same frames: they agree on the result, or both stand at the cap.
  if (own !== null) expect(b.result()).toEqual(own);
  else { expect(a.tick()).toBe(o.capTicks); expect(b.tick()).toBe(o.capTicks); }
  return { result, capped: own === null, ticks: a.tick(), ms, roundWaitMs, roundWaits: [w0, w1], running };
}

const NO_SCORE = { lost: 0, lostValue: 0, destroyed: 0, destroyedValue: 0, remaining: 0 };
/** A view with no fog to speak of: own units placed by hand, for the policy's own contract. */
function viewOf(units: { id: number; tile: [number, number]; flags: string[] }[], contacts: { id: number; tile: [number, number] }[] = []): SideView {
  return {
    tick: 120, clock: '00:06', side: 0, faction: 'kdf', map: MAP, size: [48, 48], camp: [24, 44], enemyCamp: [28, 16],
    units: units.map((u) => ({ ...u, type: 'inf_squad', hp: 100 })),
    contacts: contacts.map((c) => ({ ...c, type: 'inf_squad', hp: 100 })),
    held: [], score: { mine: NO_SCORE, theirs: NO_SCORE }, result: null,
  };
}

describe('rush never breaks off an engagement', () => {
  it('orders only idle units still at home; a unit that is shooting, moving or already out is left alone', async () => {
    const v = viewOf([
      { id: 1, tile: [24, 43], flags: ['idle'] },          // at home, doing nothing: sent
      { id: 2, tile: [25, 42], flags: ['engaging'] },      // at home, halted and shooting: kept on its target
      { id: 3, tile: [23, 44], flags: ['moving'] },        // under way: keeps its order
      { id: 4, tile: [27, 20], flags: ['idle'] },          // already out at the front: not re-sent
    ]);
    expect(await rush(v)).toEqual([{ kind: 'attackMove', ids: [1], x: fx.from(28.5), y: fx.from(16.5), sweep: true }]);
    // Seeing contacts, it sends what is at home on their centroid.
    const seen = viewOf([{ id: 1, tile: [24, 43], flags: ['idle'] }], [{ id: 9, tile: [30, 30] }, { id: 10, tile: [32, 31] }]);
    expect(await rush(seen)).toEqual([{ kind: 'attackMove', ids: [1], x: fx.from(31.5), y: fx.from(30.5), sweep: true }]);
    // Nothing to send: no order at all (a flush costs a row).
    expect(await rush(viewOf([{ id: 2, tile: [25, 42], flags: ['engaging'] }]))).toEqual([]);
  });
});

describe('rush (fog honesty)', () => {
  it('seeing nothing, it orders on the enemy camp, never toward a hidden unit', async () => {
    // Seat 1 hides its whole force at (8,4), far off the camp axis
    // (24,44)->(28,16) and behind the ridge; seat 0 sees none of it. Seat 0's
    // rush is held until tick 800 so the hiders have arrived before it asks.
    const HIDE: [number, number] = [8, 4];
    const hider: Policy = (v) => (v.tick === ROUND_TICKS ? [{ kind: 'move', ids: v.units.map((u) => u.id), x: fx.from(HIDE[0] + 0.5), y: fx.from(HIDE[1] + 0.5) }] : []);
    let seat0: RunningPlayer | null = null;
    const calls: { view: SideView; cmds: Command[]; hidden: [number, number][] }[] = [];
    const recorder: Policy = async (view) => {
      if (view.tick < 800) return [];
      const cmds = await rush(view);
      // The test (never the policy) reads the true world, to know where the hidden units are.
      const sim = seat0?.client?.world()?.sim;
      const hidden: [number, number][] = [];
      if (sim !== undefined) {
        for (let i = 0; i < sim.entityCount; i++) {
          if (sim.state.alive[i] === 1 && sim.state.side[i] === 1) hidden.push([sim.state.posX[i] >> 16, sim.state.posY[i] >> 16]);
        }
      }
      calls.push({ view, cmds, hidden });
      return cmds;
    };
    const rushPlayer = inProcess('rush', recorder, { log: () => {} });
    const wrapped: ArenaPlayer = { name: 'rush', start: async (s) => { seat0 = await rushPlayer.start(s); return seat0; } };
    const game = await play([wrapped, inProcess('hider', hider, { log: () => {} })], { seed: 1, capTicks: 1200, timeoutMs: 60_000 });
    expect(game.capped).toBe(true);

    const blind = calls.filter((c) => c.view.contacts.length === 0 && c.cmds.length > 0);
    for (const c of blind) {
      const [cx, cy] = c.view.enemyCamp;
      // The premise, or the check could not fail: every hidden unit stands far from the camp.
      expect(c.hidden.length).toBeGreaterThan(0);
      for (const [hx, hy] of c.hidden) expect(Math.hypot(hx - cx, hy - cy)).toBeGreaterThan(6);
      for (const cmd of c.cmds) {
        if (cmd.kind !== 'attackMove') throw new Error(`rush ordered a ${cmd.kind}`);
        const [ox, oy] = [cmd.x >> 16, cmd.y >> 16];
        expect([ox, oy]).toEqual([cx, cy]);
        expect([cmd.x, cmd.y]).toEqual([fx.from(cx + 0.5), fx.from(cy + 0.5)]);
        for (const [hx, hy] of c.hidden) expect(Math.hypot(hx - ox, hy - oy)).toBeGreaterThan(3);
      }
    }
    // Checked after the calls themselves: the first call at tick 800 sends the
    // whole force (all idle at home), and that is the call a cheat would aim.
    expect(blind.length).toBeGreaterThanOrEqual(1);
    expect(blind[0].view.tick).toBe(800);
  }, 90_000);
});

describe('the controls, on the local relay (the arena\'s pace 60 and cap 12,000)', () => {
  const CAP = 12_000;
  const PACE = 60;
  // Every round of a paced game is released by both seats' `done`, never by
  // the wall: a player that forgot `done`, or sent it for the wrong round,
  // would leave each boundary to `roundWallMs`. This was a wall-clock budget
  // on the whole game (1 ms a tick + 20 s), and that read the MACHINE, not the
  // player: under a loaded full `pnpm test` seed 3's 4,360 ticks took 40.7 s
  // against its 24.4 s budget with every round released by `done` (31.6 s on
  // the efficiency cores alone, 7.6 s on a quiet run). So these games play on
  // the arena's own 120 s wall and the check asks the room: no round wait, as
  // either seat saw it, reached even half of it. A healthy one reads
  // milliseconds (the window holds only the seats' catch-up on at most about
  // one round of frames and their answer, tiny against the wall); one round left to the wall read 119,998-119,999 ms (a seat
  // hears the `stall` a little after the room closes the round, hence half and
  // not the whole wall); a player that never says `done` does not finish
  // inside `timeoutMs` at all.

  for (const rushSeat of [0, 1] as const) {
    it(`rush beats passive with rush on seat ${rushSeat}, by annihilation or on forces at the cap`, async () => {
      const players: [ArenaPlayer, ArenaPlayer] = rushSeat === 0
        ? [inProcess('rush', rush, { log: () => {} }), inProcess('passive', passive, { log: () => {} })]
        : [inProcess('passive', passive, { log: () => {} }), inProcess('rush', rush, { log: () => {} })];
      const game = await play(players, { seed: 3, capTicks: CAP, roundTicks: PACE, timeoutMs: 150_000 });
      expect(game.result.kind).toBe('won');
      if (game.result.kind !== 'won') return;
      expect(game.result.side).toBe(rushSeat);
      expect(['annihilation', 'time']).toContain(game.result.by);
      expect(game.roundWaitMs).toBeLessThan(ARENA_ROUND_WALL_MS / 2);
      const reports = await Promise.all(game.running.map((r) => r.done));
      for (const r of reports) expect(r).toEqual({ tokens: null, timeouts: 0, errors: [] });
    }, 180_000);
  }

  it('passive against passive draws at the cap on equal forces (the mirror)', async () => {
    const game = await play([inProcess('passive', passive, { log: () => {} }), inProcess('passive', passive, { log: () => {} })], { seed: 1, capTicks: 10 * PACE, roundTicks: PACE, timeoutMs: 30_000 });
    expect(game.capped).toBe(true);
    expect(game.result.kind).toBe('draw');
    if (game.result.kind !== 'draw' || game.result.by === 'mutual') throw new Error(`not a draw on forces: ${JSON.stringify(game.result)}`);
    expect(['time', 'stalemate']).toContain(game.result.by);
    expect(game.result.forces[0]).toBe(game.result.forces[1]);
    expect(game.result.forces[0]).toBeGreaterThan(0);
  }, 60_000);
});

describe('the in-process player in a paced room', () => {
  it('flushes the policy\'s orders before done, so they run in the next round\'s first frame', async () => {
    const game = await play([inProcess('rush', rush, { log: () => {} }), inProcess('passive', passive, { log: () => {} })], { seed: 1, capTicks: 3 * ROUND_TICKS, timeoutMs: 30_000 });
    const records = game.running[0].client?.desk.records(10) ?? [];
    // The policy ran on the boundary (tick 40, every frame of round 0 run);
    // its order left with the last frame's tick and ran in frame 40.
    const first = records.find((r) => r.queuedTick === ROUND_TICKS);
    expect(first).toMatchObject({ status: 'applied', sentTick: ROUND_TICKS - 1, settledTick: ROUND_TICKS });
  }, 60_000);
});

describe('a model that hangs', () => {
  it('costs about roundWallMs a round, and the match still advances; timeouts counts the rounds', async () => {
    const hangs: Policy = () => new Promise<Command[]>(() => {});
    const ROUNDS = 4;
    const game = await play([inProcess('hangs', hangs, { log: () => {} }), inProcess('passive', passive, { log: () => {} })], { seed: 1, capTicks: ROUNDS * ROUND_TICKS, roundWallMs: 1000, timeoutMs: 30_000 });
    expect(game.capped).toBe(true);
    expect(game.ticks).toBe(ROUNDS * ROUND_TICKS);
    // Rounds 0..ROUNDS-2 each closed and waited out by wall time; the last
    // boundary is the cap, where the player stops before asking.
    const waited = ROUNDS - 1;
    expect(game.ms).toBeGreaterThanOrEqual(waited * 1000 * 0.9);
    // The room held each of those boundaries, once: a count, which carries the
    // weight because it does not read the machine. `ms` alone could not say
    // so: with `roundGate` never waiting it still read 3.1 s, the hung seat's
    // own 1 s timer holding its own frames; this reads 0 there.
    expect(game.roundWaits).toEqual([waited, waited]);
    // ...for about one wall each, and not two: the longest wait as a seat saw
    // it, stall to resume. Not the game's total (`ms < waited * 1000 + 3000`,
    // 3 s of slack for 160 ticks plus the connect, which read the machine).
    // The window is still wall time, so its cap sits just under two walls
    // (a doubled wait read 1,998 ms) and not tight on one.
    expect(game.roundWaitMs).toBeLessThan(1000 * 1.9);
    const [hung, calm] = await Promise.all(game.running.map((r) => r.done));
    expect(hung.timeouts).toBe(waited);
    expect(hung.errors).toEqual([]);
    expect(calm.timeouts).toBe(0);
  }, 60_000);
});

describe('the in-process player in a realtime room', () => {
  it('asks the policy every 100 ticks and its orders reach the room through the desk', async () => {
    const relay = await relayOf(1);
    // No pace: a realtime room, bot seats or not.
    const created = await post(relay, '/api/match', { player: 'bot-a', build: BUILD, map: MAP, mode: 'versus', kind: 'bot' });
    const { code, ticket } = (await created.json()) as { code: string; ticket: string };
    const joined = (await (await post(relay, `/api/match/${code}/join`, { player: 'bot-b', kind: 'bot' })).json()) as { ticket: string };
    const asked: number[] = [];
    const counting: Policy = (v) => { asked.push(v.tick); return rush(v); };
    const seat = (s: 0 | 1, p: ArenaPlayer, t: string): Promise<RunningPlayer> => p.start({ server: relay.url, origin: relay.origin, code, seat: s, ticket: t, build: BUILD, capTicks: 300 });
    const running = await Promise.all([seat(0, inProcess('rush', counting, { log: () => {} }), ticket), seat(1, inProcess('passive', passive, { log: () => {} }), joined.ticket)]);
    for (const r of running) cleanups.push(() => r.stop());
    expect((await running[0].client?.ready)?.pace).toEqual({ kind: 'realtime' });
    const reports = await Promise.all(running.map((r) => r.done));
    expect(asked).toEqual([100, 200]);
    const records = running[0].client?.desk.records(10) ?? [];
    // Tick 100 ordered the whole force; at 200 every unit is still under way, so rush orders nothing.
    expect(records.map((r) => [r.queuedTick, r.status, r.cmd.kind === 'attackMove' ? r.cmd.ids.length : 0])).toEqual([[100, 'applied', running[0].client?.world()?.bySide[0].length]]);
    for (const r of reports) expect(r).toEqual({ tokens: null, timeouts: 0, errors: [] });
  }, 30_000);
});
