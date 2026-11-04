// The 4 Nov bot report (five findings from the lead's bot fight), each held by a case that was watched going red.
// 1 stale target, 2 order log, 5 clock: against the REAL `MatchRoom` (`test-room.ts`) or a stub client. No model, no key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocketLike } from '@lions/net';
import { fx } from '@lions/sim';
import type { MatchWorld } from '../../../packages/app/src/net/match-world';
import { AgentClient } from './agent-client';
import { createContext, TOOLS, type ToolContext, type ToolResult } from './mcp-tools';
import { ROOM_BUILD, ROOM_CODE, ROOM_NOW, newRoom, play, type Loop } from './test-room';

beforeEach(() => { vi.useFakeTimers({ now: ROOM_NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

interface Joined { client: AgentClient; sock: () => SocketLike }
function join(loop: Loop, ticket: string, seat: 0 | 1): Joined {
  let sock: SocketLike | null = null;
  const client = new AgentClient({
    server: 'https://room.test', code: ROOM_CODE, ticket, build: ROOM_BUILD, role: 'seat', seat, log: () => {},
    open: () => { sock = loop.open(); return sock; },
  });
  return { client, sock: () => { if (sock === null) throw new Error('no socket yet'); return sock; } };
}
async function call(ctx: ToolContext, name: string, args: unknown = {}): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return tool.run(ctx, args);
}
const body = (r: ToolResult): Record<string, any> => JSON.parse(r.text) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sideIds = (w: MatchWorld, side: 0 | 1): number[] => {
  const st = w.sim.state;
  const out: number[] = [];
  for (let i = 0; i < w.sim.entityCount; i++) if (st.alive[i] === 1 && st.side[i] === side) out.push(i);
  return out;
};
async function drive<T>(loop: Loop, runners: { pump(n: number): number }[], p: Promise<T>, maxTicks = 400): Promise<T> {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  await play(loop, maxTicks, runners, () => settled);
  expect(settled, 'the tool call never settled').toBe(true);
  return p;
}
async function twoSeats(): Promise<{ loop: Loop; a: Joined; c: Joined }> {
  const room = await newRoom({});
  const a = join(room.loop, await room.ticket(0), 0);
  const c = join(room.loop, await room.ticket(1), 1);
  await room.loop.flush();
  await Promise.all([a.client.ready, c.client.ready]);
  return { loop: room.loop, a, c };
}

/**
 * The shared fixture: seat 0's `mine` and `spare` idle in the open, an enemy teleported onto `mine`'s ground so it is a
 * contact, nobody able to shoot (so only `debugKill` kills). Identical on both machines between the same two frames.
 */
async function metEnemy(meet = true): Promise<{ loop: Loop; a: Joined; c: Joined; ctx: ToolContext; w: MatchWorld; sims: MatchWorld['sim'][]; mine: number; spare: number; enemy: number; metTile: [number, number]; metTick: number; hidden: number }> {
  const { loop, a, c } = await twoSeats();
  const ctx = createContext(a.client, 'command');
  await play(loop, 10, [a.client, c.client], () => a.client.tick() >= 5 && c.client.tick() >= 5);
  const sims = [a.client, c.client].map((cl) => (cl.world() as MatchWorld).sim);
  const w = a.client.world() as MatchWorld;
  const st = w.sim.state;
  const inOpen = (id: number): boolean => st.garrisonedIn[id] < 0 && st.carriedBy[id] < 0 && st.tunnelIn[id] < 0;
  const [mine, spare] = a.client.view().units.filter((u) => u.flags.every((f) => f === 'idle')).map((u) => u.id);
  const [enemy, hidden] = sideIds(w, 1).filter(inOpen);
  if (!meet) return { loop, a, c, ctx, w, sims, mine, spare, enemy, metTile: [0, 0], metTick: a.client.tick(), hidden };
  for (const sim of sims) {
    for (let id = 0; id < sim.entityCount; id++) sim.debugDisableFirepower(id);
    sim.teleport(enemy, sim.state.posX[mine], sim.state.posY[mine]);
  }
  const met = a.client.tick();
  await play(loop, 20, [a.client, c.client], () => a.client.tick() >= met + 5 && c.client.tick() >= met + 5);
  expect(a.client.view().contacts.map((u) => u.id)).toContain(enemy);
  const metTile = a.client.view().contacts.find((u) => u.id === enemy)?.tile as [number, number];
  return { loop, a, c, ctx, w, sims, mine, spare, enemy, metTile, metTick: a.client.tick(), hidden };
}
/** The enemy goes back into the fog at its own camp (both machines, the same two frames). */
async function loseSight(f: Awaited<ReturnType<typeof metEnemy>>): Promise<void> {
  const camp = f.a.client.view().enemyCamp;
  for (const sim of f.sims) sim.teleport(f.enemy, fx.from(camp[0] + 0.5), fx.from(camp[1] + 0.5));
  const at = f.a.client.tick();
  await play(f.loop, 20, [f.a.client, f.c.client], () => f.a.client.tick() >= at + 5 && f.c.client.tick() >= at + 5);
  expect(f.a.client.view().contacts.map((u) => u.id)).not.toContain(f.enemy);
}

describe('item 1: an attack on a target that left sight (the 4 Nov bot report)', () => {
  it('is refused as `target no longer in sight`, with the last-seen tile and tick, and a fallback attackMove nothing converts', async () => {
    const f = await metEnemy();
    await loseSight(f);
    const before = f.a.client.desk.records(50).length;
    const r = await call(f.ctx, 'order', { verb: 'attack', ids: [f.mine, f.spare], target: f.enemy });
    expect(r.ok).toBe(false);
    const b = body(r);
    expect(b.error).toBe('target no longer in sight');
    // The seat's OWN last sighting: the tile it stood on when it was a contact, not where it stands now.
    expect(b.lastSeen.tile).toEqual(f.metTile);
    expect(b.lastSeen.tick).toBeGreaterThanOrEqual(f.metTick - 4);   // fog refreshes every fourth tick
    expect(b.lastSeen.tick).toBeLessThanOrEqual(f.a.client.tick());
    expect(b.target).toBe(f.enemy);
    expect(b.fallback).toEqual({ verb: 'attackMove', ids: [f.mine, f.spare], x: f.metTile[0], y: f.metTile[1] });
    expect(b.detail).toMatch(/Nothing was sent/);
    // Not converted for the model: nothing reached the desk.
    expect(f.a.client.desk.records(50).length).toBe(before);
    // The hint works as written.
    const taken = await call(f.ctx, 'order', b.fallback);
    expect(taken.ok, taken.text).toBe(true);
    expect(f.a.client.desk.records(1)[0].cmd.kind).toBe('attackMove');
  });

  it('says nothing more about an enemy id the seat never saw: `not a contact`, no position, the same as for an id that does not exist', async () => {
    const f = await metEnemy();
    await loseSight(f);
    const unseen = body(await call(f.ctx, 'order', { verb: 'attack', ids: [f.mine], target: f.hidden }));
    const nowhere = body(await call(f.ctx, 'order', { verb: 'attack', ids: [f.mine], target: 99_999 }));
    expect(unseen).toEqual(nowhere);
    expect(unseen.error).toBe('not a contact');
    expect(unseen).not.toHaveProperty('lastSeen');
    expect(unseen).not.toHaveProperty('fallback');
    // The refusal for a seen target carries its sighting and nothing of its present position.
    const enemyNow = f.w.sim.state.posX[f.enemy] >> 16;
    const stale = JSON.stringify(body(await call(f.ctx, 'order', { verb: 'attack', ids: [f.mine], target: f.enemy })));
    expect(f.w.sim.state.posX[f.enemy] >> 16).toBe(enemyNow);
    expect(stale).toContain(`"tile":[${f.metTile[0]},${f.metTile[1]}]`);
    const camp = f.a.client.view().enemyCamp;
    expect(stale).not.toContain(`"tile":[${camp[0]},${camp[1]}]`);
  });

  it('an attack accepted while the target is in sight stays `applied` when it leaves sight, and its record shows `out of sight` with the last sighting (not `dropped`)', async () => {
    const f = await metEnemy();
    const ok = await call(f.ctx, 'order', { verb: 'attack', ids: [f.mine], target: f.enemy });
    expect(ok.ok, ok.text).toBe(true);
    // The order is carried (applied) while the target is still a contact; ownership never checks sight.
    await drive(f.loop, [f.a.client, f.c.client], call(f.ctx, 'wait', { ticks: 45 }));
    await loseSight(f);
    const rec = body(await call(f.ctx, 'observe')).orders.find((o: { ref: number }) => o.ref === body(ok).ref);
    expect(rec.status).toBe('applied');
    expect(rec.reason).toBeUndefined();
    expect(rec.target).toBe('out of sight');
    expect(rec.lastSeen.tile).toEqual(f.metTile);
  });
});

describe('item 2: the order log (the 4 Nov bot report)', () => {
  it('reads oldest first, and a unit that died after its order was applied reads `died @tick` beside the still-applied order', async () => {
    const f = await metEnemy(false);   // no meeting: a room with every weapon disabled answered `match over` within a hundred ticks
    const first = body(await call(f.ctx, 'order', { verb: 'halt', ids: [f.mine, f.spare] })) as { ref: number };
    await drive(f.loop, [f.a.client, f.c.client], call(f.ctx, 'wait', { ticks: 45 }));
    const secondR = await call(f.ctx, 'order', { verb: 'move', ids: [f.mine], x: 12, y: 14 });
    expect(secondR.ok, secondR.text).toBe(true);
    const second = body(secondR) as { ref: number };
    await drive(f.loop, [f.a.client, f.c.client], call(f.ctx, 'wait', { ticks: 45 }));
    const control = body(await call(f.ctx, 'observe')).orders as { ref: number }[];
    expect(control.map((o) => o.ref)).toEqual([first.ref, second.ref]);   // time order, not newest first
    // `spare` dies; nothing else changes.
    const killedAt = f.a.client.tick();
    for (const sim of f.sims) sim.debugKill(f.spare);
    await play(f.loop, 10, [f.a.client, f.c.client], () => f.a.client.tick() >= killedAt + 3 && f.c.client.tick() >= killedAt + 3);
    const orders = body(await call(f.ctx, 'observe')).orders as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const rec = orders.find((o) => o.ref === first.ref) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(rec.status).toBe('applied');                     // the order WAS applied, and still reads so
    expect(rec.settledTick).toBeGreaterThan(0);
    expect(rec.ids).toEqual([f.mine]);
    expect(rec.fates).toEqual([{ id: f.spare, fate: 'died', tick: expect.any(Number) }]);
    expect(rec.fates[0].tick).toBeGreaterThan(killedAt - 1);
    expect(rec.fates[0].tick).toBeLessThanOrEqual(killedAt + 3);
    expect(rec).not.toHaveProperty('gone');                 // `gone` was the unexplained one; the death is explained now
    expect(orders.find((o) => o.ref === second.ref)).not.toHaveProperty('fates');   // it never named the dead unit
  });
});

describe('item 2: a unit taken off the board alive is not called dead', () => {
  it('reads `removed`, with its tick, where a destroyed one reads `died`', async () => {
    const f = await metEnemy(false);
    const first = body(await call(f.ctx, 'order', { verb: 'halt', ids: [f.mine, f.spare] })) as { ref: number };
    await drive(f.loop, [f.a.client, f.c.client], call(f.ctx, 'wait', { ticks: 45 }));
    for (const sim of f.sims) sim.removeFromPlay(f.spare);
    const at = f.a.client.tick();
    await play(f.loop, 10, [f.a.client, f.c.client], () => f.a.client.tick() >= at + 3 && f.c.client.tick() >= at + 3);
    const rec = (body(await call(f.ctx, 'observe')).orders as Record<string, any>[]).find((o) => o.ref === first.ref) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(rec.fates).toEqual([{ id: f.spare, fate: 'removed', tick: expect.any(Number) }]);
    expect(rec.status).toBe('applied');
  });
});

// ---- item 5: a stub client, so the three tools can be read at one instant with frames waiting ----

interface Stub { ctx: ToolContext; set(tick: number, behind: number): void }
/** A client at `tick` with `behind` frames queued and a result, so `wait` returns at once. Nothing runs between calls. */
function stubCtx(): Stub {
  let tick = 0;
  let behind = 0;
  const view = {
    tick: 0, clock: '00:00', side: 0, faction: 'kdf', map: 'm', size: [64, 64], camp: [1, 1], enemyCamp: [60, 60],
    units: [], contacts: [], casualties: { mine: [], theirs: [] }, held: [], stances: [], score: {}, mode: 'annihilation', result: 'won (annihilation)', by: 'annihilation',
  };
  const client = {
    config: () => ({ seats: [{ kind: 'bot' }, { kind: 'bot' }], pace: { kind: 'realtime' } }),
    // The view's own tick (the sim's count) is made to differ: the clock must come from one place.
    view: () => ({ ...view, tick: tick - 1 }),
    tick: () => tick,
    result: () => ({ kind: 'won', side: 0, by: 'annihilation' }),
    joinedUnderway: () => false,
    memory: () => null,
    desk: { records: () => [] },
    seat: 0,
    // The link's own report lags the live count (it is refreshed on events): status must still say one `behind`.
    transport: { status: () => ({ kind: 'live', behind: 0 }), behind: () => behind },
  };
  return { ctx: { client: client as unknown as AgentClient, scope: 'command', inbox: [], proposals: new Map(), doneRound: -1, nextProposal: 1, seen: true }, set: (t, b) => { tick = t; behind = b; } };
}

describe('item 5: one clock in observe, status and wait', () => {
  it('all three report the same simTick, relayTick and behind, with frames waiting (a lag of 3)', async () => {
    const s = stubCtx();
    s.set(1234, 3);
    const o = body(await call(s.ctx, 'observe'));
    const st = body(await call(s.ctx, 'status'));
    const w = body(await call(s.ctx, 'wait', { ticks: 5 }));
    for (const [name, r] of [['observe', o], ['status', st], ['wait', w]] as const) {
      expect(r.simTick, name).toBe(1234);
      expect(r.relayTick, name).toBe(1237);
      expect(r.behind, name).toBe(3);
      expect(r.tick, `${name}: tick is simTick`).toBe(r.simTick);
    }
    // status's link report is the same lag, not a second figure
    expect(st.transport).toEqual({ kind: 'live', behind: 3 });
  });

  it('on a real room: status and observe, read back to back, agree; wait\'s answer is one coherent reading; a later call may read a larger simTick', async () => {
    const { loop, a, c } = await twoSeats();
    const ctx = createContext(a.client, 'command');
    const waited = body(await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 30 })));
    // (`drive` runs one more room tick after `wait` settles, so the readings below are of a slightly later instant: the
    // match runs on between calls, which is the lead's "ahead of wait" and is what the docs now say.)
    const st = body(await call(ctx, 'status'));
    const ob = body(await call(ctx, 'observe'));
    expect([st.simTick, st.tick, ob.simTick, ob.tick]).toEqual([st.simTick, st.simTick, st.simTick, st.simTick]);
    expect([ob.relayTick, ob.behind]).toEqual([st.relayTick, st.behind]);
    expect(st.relayTick).toBe(st.simTick + st.behind);
    expect(waited.relayTick).toBe(waited.simTick + waited.behind);
    expect(waited.simTick).toBeGreaterThanOrEqual(30);
    expect(waited.simTick).toBeLessThanOrEqual(st.simTick);
    expect(waited.ran).toBeGreaterThanOrEqual(30);
    // The room mints frames the harness has not run: `behind` is exactly the frames waiting, in both tools.
    for (let i = 0; i < 3; i++) await loop.tick();
    const later = body(await call(ctx, 'status'));
    expect(later.behind).toBe(a.client.transport.behind());
    expect(later.behind).toBeGreaterThan(0);
    expect(later.simTick).toBe(st.simTick);   // frames waiting have not run
    expect(later.relayTick).toBe(st.simTick + later.behind);
    expect(body(await call(ctx, 'observe'))).toMatchObject({ simTick: later.simTick, relayTick: later.relayTick, behind: later.behind });
  });
});
