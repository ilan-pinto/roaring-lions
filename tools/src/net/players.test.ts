// N4b task 12: the arena's two baselines (`passive`, `rush`) and the
// in-process player, played on the local relay -- the real Worker routes and
// the real `MatchRoom`, real sockets, paced rooms. Every relay and player a
// test starts is closed by its own handle in `afterEach`; every port is the
// OS's (`listen(0)`).
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
async function pacedRoom(relay: LocalRelay, roundWallMs: number): Promise<{ code: string; tickets: [string, string] }> {
  const pace = { kind: 'paced', roundTicks: ROUND_TICKS, roundWallMs };
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
  running: [RunningPlayer, RunningPlayer];
}

/** Plays one game, `players[s]` on seat `s` (seat s is side s in versus), to
 *  a result or the cap; the cap's result is `capOutcome` on seat 0's sim. */
async function play(players: [ArenaPlayer, ArenaPlayer], o: { seed: number; capTicks: number; roundWallMs?: number; timeoutMs: number }): Promise<Game> {
  const relay = await relayOf(o.seed);
  const { code, tickets } = await pacedRoom(relay, o.roundWallMs ?? 1000);
  const t0 = Date.now();
  const running = await Promise.all(([0, 1] as const).map((seat) => players[seat].start({
    server: relay.url, origin: relay.origin, code, seat, ticket: tickets[seat], build: BUILD, capTicks: o.capTicks,
  }))) as [RunningPlayer, RunningPlayer];
  for (const r of running) cleanups.push(() => r.stop());
  const config = await running[0].client?.ready;
  // A malformed pace is silently realtime: a "paced" result from a realtime room would be no result.
  expect(config?.pace).toEqual({ kind: 'paced', roundTicks: ROUND_TICKS, roundWallMs: o.roundWallMs ?? 1000 });
  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    Promise.all(running.map((r) => r.done)),
    new Promise((_, rej) => { timer = setTimeout(() => { rej(new Error(`no end in ${o.timeoutMs} ms: ticks ${running.map((r) => r.client?.tick()).join(', ')}`)); }, o.timeoutMs); }),
  ]);
  if (timer !== null) clearTimeout(timer);
  const ms = Date.now() - t0;
  const [a, b] = running.map((r) => r.client);
  if (a === null || b === null) throw new Error('an in-process player has a client');
  const sim = a.world()?.sim;
  if (sim === undefined) throw new Error('seat 0 never built its world');
  const own = a.result();
  const result = own ?? capOutcome(sim);
  // Both seats ran the same frames: they agree on the result, or both stand at the cap.
  if (own !== null) expect(b.result()).toEqual(own);
  else { expect(a.tick()).toBe(o.capTicks); expect(b.tick()).toBe(o.capTicks); }
  return { result, capped: own === null, ticks: a.tick(), ms, running };
}

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
    // Checked after the calls themselves: a rush that marched on the hiders
    // would see them, so its later calls are not blind -- the first one is.
    expect(blind.length).toBeGreaterThanOrEqual(3);
  }, 90_000);
});

describe('the controls, on the local relay (paced 40 ticks, seed 1)', () => {
  const CAP = 6000;
  // A paced game costs its frames at `tickMs` (1) and the two sims' own work,
  // never `roundWallMs` (1 s) a round: a player that forgot `done` would cost
  // 1 s each of CAP / ROUND_TICKS rounds.
  const budgetMs = (ticks: number): number => ticks * 1 + 20_000;

  for (const rushSeat of [0, 1] as const) {
    it(`rush beats passive with rush on seat ${rushSeat}, by annihilation or on forces at the cap`, async () => {
      const players: [ArenaPlayer, ArenaPlayer] = rushSeat === 0
        ? [inProcess('rush', rush, { log: () => {} }), inProcess('passive', passive, { log: () => {} })]
        : [inProcess('passive', passive, { log: () => {} }), inProcess('rush', rush, { log: () => {} })];
      const game = await play(players, { seed: 1, capTicks: CAP, timeoutMs: 150_000 });
      process.stderr.write(`rush on seat ${rushSeat}: ${JSON.stringify(game.result)} at tick ${game.ticks}, ${game.ms} ms\n`);
      expect(game.result.kind).toBe('won');
      if (game.result.kind !== 'won') return;
      expect(game.result.side).toBe(rushSeat);
      expect(['annihilation', 'time']).toContain(game.result.by);
      expect(game.ms).toBeLessThan(budgetMs(game.ticks));
      const reports = await Promise.all(game.running.map((r) => r.done));
      for (const r of reports) expect(r).toEqual({ tokens: null, timeouts: 0, errors: [] });
    }, 180_000);
  }

  it('passive against passive draws at the cap on equal forces (the mirror)', async () => {
    const game = await play([inProcess('passive', passive, { log: () => {} }), inProcess('passive', passive, { log: () => {} })], { seed: 1, capTicks: 400, timeoutMs: 30_000 });
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
    expect(game.ms).toBeLessThan(waited * 1000 + 3000);
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
