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
async function metEnemy(meet = true, onlyThree = false): Promise<{ loop: Loop; a: Joined; c: Joined; ctx: ToolContext; w: MatchWorld; sims: MatchWorld['sim'][]; mine: number; spare: number; enemy: number; metTile: [number, number]; metTick: number; hidden: number }> {
  const { loop, a, c } = await twoSeats();
  const ctx = createContext(a.client, 'command');
  await play(loop, 10, [a.client, c.client], () => a.client.tick() >= 5 && c.client.tick() >= 5);
  const sims = [a.client, c.client].map((cl) => (cl.world() as MatchWorld).sim);
  const w = a.client.world() as MatchWorld;
  const st = w.sim.state;
  const inOpen = (id: number): boolean => st.garrisonedIn[id] < 0 && st.carriedBy[id] < 0 && st.tunnelIn[id] < 0;
  const [mine, spare] = a.client.view().units.filter((u) => u.flags.every((f) => f === 'idle')).map((u) => u.id);
  const [enemy, hidden] = sideIds(w, 1).filter(inOpen);
  // `onlyThree` only: the one seat-0 unit left armed, the farthest from `mine`, so seat 0 is not annihilated for want of a gun
  // and nothing near the fight can shoot `enemy`.
  const armed = sideIds(w, 0).filter((id) => id !== mine && id !== spare)
    .sort((p, q) => Math.hypot(st.posX[q] - st.posX[mine], st.posY[q] - st.posY[mine]) - Math.hypot(st.posX[p] - st.posX[mine], st.posY[p] - st.posY[mine]))[0];
  if (!meet) return { loop, a, c, ctx, w, sims, mine, spare, enemy, metTile: [0, 0], metTick: a.client.tick(), hidden };
  for (const sim of sims) {
    // `onlyThree`: all of seat 0 but its farthest unit, and the one enemy, are unarmed (so nothing but `debugKill` kills `enemy`); the rest of seat 1 keeps its guns, so a room with every weapon dead does not end in a mutual draw at tick ~20.
    for (let id = 0; id < sim.entityCount; id++) if (!onlyThree || id === enemy || (sim.state.side[id] === 0 && id !== armed)) sim.debugDisableFirepower(id);
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

  it('an attack accepted while the target is in sight settles to `dropped` when it leaves sight: reason, lastSeen and the fallback (the second 4 Nov fight, item 2)', async () => {
    const f = await metEnemy();
    const ok = await call(f.ctx, 'order', { verb: 'attack', ids: [f.mine, f.spare], target: f.enemy });
    expect(ok.ok, ok.text).toBe(true);
    // The order is carried (applied) while the target is still a contact; ownership never checks sight.
    await drive(f.loop, [f.a.client, f.c.client], call(f.ctx, 'wait', { ticks: 45 }));
    const still = body(await call(f.ctx, 'observe')).orders.find((o: { ref: number }) => o.ref === body(ok).ref);
    expect(still.status, 'target still in sight: nothing to settle').toBe('applied');
    expect(still).not.toHaveProperty('fallback');
    await loseSight(f);
    const rec = body(await call(f.ctx, 'observe')).orders.find((o: { ref: number }) => o.ref === body(ok).ref);
    expect(rec.status).toBe('dropped');
    expect(rec.reason).toBe('target no longer in sight');
    expect(rec.target).toBe('out of sight');
    expect(rec.lastSeen.tile).toEqual(f.metTile);
    expect(rec.fallback).toEqual({ verb: 'attackMove', ids: [f.mine, f.spare], x: f.metTile[0], y: f.metTile[1] });
    expect(rec.settledTick).toBe(f.a.client.tick());
    // Sticky: seeing the target again does not un-drop it.
    for (const sim of f.sims) sim.teleport(f.enemy, sim.state.posX[f.mine], sim.state.posY[f.mine]);
    const back = f.a.client.tick();
    await play(f.loop, 20, [f.a.client, f.c.client], () => f.a.client.tick() >= back + 5 && f.c.client.tick() >= back + 5);
    expect(f.a.client.view().contacts.map((u) => u.id)).toContain(f.enemy);
    expect(body(await call(f.ctx, 'observe')).orders.find((o: { ref: number }) => o.ref === body(ok).ref).status).toBe('dropped');
  });
});

describe('item 2 (second fight): an attack whose target was destroyed', () => {
  const recOf = async (f: Awaited<ReturnType<typeof metEnemy>>, ref: number): Promise<Record<string, any>> => // eslint-disable-line @typescript-eslint/no-explicit-any
    body(await call(f.ctx, 'observe')).orders.find((o: { ref: number }) => o.ref === ref);

  it('killed in the seat\'s sight reads `done`, `target destroyed`, settled at the kill tick, with no fallback', async () => {
    const f = await metEnemy(true, true);
    const ok = body(await call(f.ctx, 'order', { verb: 'attack', ids: [f.mine], target: f.enemy })) as { ref: number };
    await drive(f.loop, [f.a.client, f.c.client], call(f.ctx, 'wait', { ticks: 45 }));
    const killedAt = f.a.client.tick();
    for (const sim of f.sims) sim.debugKill(f.enemy);
    await play(f.loop, 10, [f.a.client, f.c.client], () => f.a.client.tick() >= killedAt + 3 && f.c.client.tick() >= killedAt + 3);
    const rec = await recOf(f, ok.ref);
    expect(rec.status).toBe('done');
    expect(rec.reason).toBe('target destroyed');
    expect(rec.settledTick).toBeGreaterThanOrEqual(killedAt);
    expect(rec.settledTick).toBeLessThanOrEqual(killedAt + 4);
    expect(rec.target).toBe(f.enemy);
    expect(rec).not.toHaveProperty('fallback');
    expect(rec).not.toHaveProperty('lastSeen');
  });

  it('killed AFTER leaving sight stays `dropped`: a death the seat could not see is never revealed', async () => {
    const f = await metEnemy(true, true);
    const ok = body(await call(f.ctx, 'order', { verb: 'attack', ids: [f.mine], target: f.enemy })) as { ref: number };
    await drive(f.loop, [f.a.client, f.c.client], call(f.ctx, 'wait', { ticks: 45 }));
    await loseSight(f);
    const at = f.a.client.tick();
    for (const sim of f.sims) sim.debugKill(f.enemy);
    await play(f.loop, 10, [f.a.client, f.c.client], () => f.a.client.tick() >= at + 5 && f.c.client.tick() >= at + 5);
    const rec = await recOf(f, ok.ref);
    expect(rec.status).toBe('dropped');
    expect(rec.reason).toBe('target no longer in sight');
    expect(rec.target).toBe('out of sight');
    expect(JSON.stringify(rec)).not.toMatch(/destroyed|died/);
  });

  it('taken off the board alive in sight (not destroyed) is not a kill: it stays `dropped`', async () => {
    const f = await metEnemy(true, true);
    const ok = body(await call(f.ctx, 'order', { verb: 'attack', ids: [f.mine], target: f.enemy })) as { ref: number };
    await drive(f.loop, [f.a.client, f.c.client], call(f.ctx, 'wait', { ticks: 45 }));
    const at = f.a.client.tick();
    for (const sim of f.sims) sim.removeFromPlay(f.enemy);
    await play(f.loop, 10, [f.a.client, f.c.client], () => f.a.client.tick() >= at + 3 && f.c.client.tick() >= at + 3);
    expect((await recOf(f, ok.ref)).status).toBe('dropped');
  });

  it('a dropped attack with no living id left carries no fallback (never `ids: []`)', async () => {
    const f = await metEnemy(true, true);
    const ok = body(await call(f.ctx, 'order', { verb: 'attack', ids: [f.spare], target: f.enemy })) as { ref: number };
    await drive(f.loop, [f.a.client, f.c.client], call(f.ctx, 'wait', { ticks: 45 }));
    for (const sim of f.sims) sim.debugKill(f.spare);
    await loseSight(f);
    const rec = await recOf(f, ok.ref);
    expect(rec.status).toBe('dropped');
    expect(rec.lastSeen.tile).toEqual(f.metTile);
    expect(rec).not.toHaveProperty('fallback');
  });
});

describe('item 1 (second fight): dead ids in an order', () => {
  it('goes to the living ids and answers `lost` in the order log\'s shape', async () => {
    const f = await metEnemy(false);
    const killedAt = f.a.client.tick();
    for (const sim of f.sims) sim.debugKill(f.spare);
    await play(f.loop, 10, [f.a.client, f.c.client], () => f.a.client.tick() >= killedAt + 3 && f.c.client.tick() >= killedAt + 3);
    const r = await call(f.ctx, 'order', { verb: 'move', ids: [f.mine, f.spare], x: 12, y: 14 });
    expect(r.ok, r.text).toBe(true);
    expect(body(r).lost).toEqual([{ id: f.spare, fate: 'died', tick: expect.any(Number) }]);
    expect((f.a.client.desk.records(1)[0].cmd as { ids: number[] }).ids).toEqual([f.mine]);
    // No dead id, no `lost` key.
    const clean = body(await call(f.ctx, 'order', { verb: 'halt', ids: [f.mine] }));
    expect(clean).not.toHaveProperty('lost');
  });

  it('refuses only when no listed id is alive, naming every id and its fate; a never-yours id still refuses', async () => {
    const f = await metEnemy(false);
    const killedAt = f.a.client.tick();
    for (const sim of f.sims) sim.debugKill(f.spare);
    await play(f.loop, 10, [f.a.client, f.c.client], () => f.a.client.tick() >= killedAt + 3 && f.c.client.tick() >= killedAt + 3);
    const before = f.a.client.desk.records(50).length;
    const none = await call(f.ctx, 'order', { verb: 'move', ids: [f.spare], x: 12, y: 14 });
    expect(none.ok).toBe(false);
    expect(body(none).error).toBe('not your unit');
    expect(body(none).detail).toContain(`${f.spare}: died`);
    expect(body(none).lost).toEqual([{ id: f.spare, fate: 'died', tick: expect.any(Number) }]);
    const foreign = await call(f.ctx, 'order', { verb: 'move', ids: [f.mine, f.enemy], x: 12, y: 14 });
    expect(foreign.ok).toBe(false);
    expect(body(foreign).error).toBe('not your unit');
    expect(body(foreign)).not.toHaveProperty('lost');
    expect(f.a.client.desk.records(50).length).toBe(before);   // nothing was sent
  });
});

describe('item 3 (second fight): contacts are never remembered positions', () => {
  it('every contact is `inSight` with a `seenTick` the fog confirmed within the last 4 ticks, and its tile is where it stands now', async () => {
    const f = await metEnemy();
    const o = body(await call(f.ctx, 'observe'));
    const c = o.contacts.find((u: { id: number }) => u.id === f.enemy);
    expect(c.inSight).toBe(true);
    expect(c.seenTick).toBeLessThanOrEqual(o.simTick);
    expect(c.seenTick).toBeGreaterThanOrEqual(o.simTick - 4);
    expect(c.tile).toEqual([f.w.sim.state.posX[f.enemy] >> 16, f.w.sim.state.posY[f.enemy] >> 16]);
    // Gone from sight, it is not a contact at all (no remembered position wears the label).
    await loseSight(f);
    expect(body(await call(f.ctx, 'observe')).contacts.map((u: { id: number }) => u.id)).not.toContain(f.enemy);
  });
});

describe('item 4 (second fight): a pinned unit says it is held', () => {
  it('reads `held: pinned` in its row while suppressed, and not otherwise', async () => {
    const f = await metEnemy(false);
    const rows = (o: Record<string, any>) => o.units as { id: number; held?: string }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(rows(body(await call(f.ctx, 'observe'))).some((u) => u.held !== undefined)).toBe(false);
    const at = f.a.client.tick();
    for (const sim of f.sims) sim.debugSuppress(f.mine, fx.from(8)); // capped at 2.0 after the unit's cover; PIN_AT is 0.7
    await play(f.loop, 10, [f.a.client, f.c.client], () => f.a.client.tick() >= at + 2 && f.c.client.tick() >= at + 2);
    const o = body(await call(f.ctx, 'observe'));
    const row = rows(o).find((u) => u.id === f.mine) as unknown as { held?: string; flags: string[] };
    expect(row.flags).toContain('pinned');
    expect(row.held).toBe('pinned');
    expect(rows(o).find((u) => u.id === f.spare)).not.toHaveProperty('held');
  });
});

describe('item 5 (second fight): the score is one reading', () => {
  it('my `lost` is their `destroyed` and my `destroyed` their `lost`, for kills in and out of sight, at every observe', async () => {
    const f = await metEnemy();
    await loseSight(f);   // `enemy` is out of sight; `hidden` never was in it
    const at = f.a.client.tick();
    for (const sim of f.sims) { sim.debugKill(f.spare); sim.debugKill(f.hidden); sim.debugKill(f.enemy); }
    await play(f.loop, 10, [f.a.client, f.c.client], () => f.a.client.tick() >= at + 3 && f.c.client.tick() >= at + 3);
    const { mine, theirs } = body(await call(f.ctx, 'observe')).score;
    expect(mine.lost).toBe(1);
    expect(mine.destroyed).toBe(2);
    expect([theirs.destroyed, theirs.lost]).toEqual([mine.lost, mine.destroyed]);
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
