// GH-954 (D-W8): a model sets a stance and runs production through `order`, as a human does, against the REAL
// `MatchRoom` over the fake Durable Object (`test-room.ts`). Every case goes through the tools exactly as the stdio
// server calls them and reads back what reached the room, and what both sims did with it. No model, no key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMsg, SocketLike } from '@lions/net';
import type { MatchWorld } from '../../../packages/app/src/net/match-world';
import { AgentClient } from './agent-client';
import { createContext, TOOLS, type ToolContext, type ToolResult } from './mcp-tools';
import { ROOM_BUILD, ROOM_CODE, newRoom, play, type Loop } from './test-room';

beforeEach(() => { vi.useFakeTimers({ now: 1_790_000_000_000 }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

interface Joined { client: AgentClient; sock: () => SocketLike }
function join(loop: Loop, ticket: string, seat: 0 | 1, role: 'seat' | 'advisor' = 'seat'): Joined {
  let sock: SocketLike | null = null;
  const client = new AgentClient({
    server: 'https://room.test', code: ROOM_CODE, ticket, build: ROOM_BUILD, role, seat, log: () => {},
    open: () => { sock = loop.open(); return sock; },
  });
  return { client, sock: () => { if (sock === null) throw new Error('no socket yet'); return sock; } };
}
const sentBy = (loop: Loop, j: Joined): ClientMsg[] => loop.sent.get(j.sock()) ?? [];
const cmdsBy = (loop: Loop, j: Joined): Record<string, unknown>[] => sentBy(loop, j).flatMap((m) => (m.t === 'cmd' ? [m.cmd as unknown as Record<string, unknown>] : []));

async function call(ctx: ToolContext, name: string, args: unknown = {}): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return tool.run(ctx, args);
}
const body = (r: ToolResult): Record<string, unknown> => JSON.parse(r.text) as Record<string, unknown>;

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

type Room = Awaited<ReturnType<typeof newRoom>>;
interface Seats { loop: Loop; a: Joined; c: Joined; room: Room; ctx: ToolContext; ctxC: ToolContext; wa: MatchWorld; wc: MatchWorld }
/** Two human seats. `economy`: KDF against Sarim on a map with a rules file (a runtime in the world); else a mirror room. */
async function seats(economy: boolean): Promise<Seats> {
  const room = await newRoom(economy ? { map: 'wadi_tarfan', matchup: 'kdf' } : {});
  const a = join(room.loop, await room.ticket(0), 0);
  const c = join(room.loop, await room.ticket(1), 1);
  await room.loop.flush();
  await Promise.all([a.client.ready, c.client.ready]);
  const wa = a.client.world() as MatchWorld;
  const wc = c.client.world() as MatchWorld;
  // Premise: the room is the kind the case claims.
  expect(wa.runtime !== null).toBe(economy);
  return { loop: room.loop, a, c, room, ctx: createContext(a.client, 'command'), ctxC: createContext(c.client, 'command'), wa, wc };
}
/** Sends the order, runs the room until the desk has flushed it and both seats have run its frame. */
async function send(s: Seats, args: Record<string, unknown>, ctx: ToolContext = s.ctx): Promise<ToolResult> {
  const r = await call(ctx, 'order', args);
  if (r.ok) await drive(s.loop, [s.a.client, s.c.client], call(ctx, 'wait', { ticks: 45 }));
  return r;
}
const observe = async (ctx: ToolContext): Promise<Record<string, any>> => body(await call(ctx, 'observe')); // eslint-disable-line @typescript-eslint/no-explicit-any
const unitLine = (o: Record<string, any>, id: number): Record<string, any> => (o.units as Record<string, any>[]).find((u) => u.id === id) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('observe shows the stance and the legal stances (GH-954)', () => {
  it('every own unit reads `free` at the start, the three stances are listed, and a contact carries no stance', async () => {
    const s = await seats(false);
    const o = await observe(s.ctx);
    expect(o.stances).toEqual(['hold', 'ambush', 'patrol']);
    expect(o.units.length).toBe(sideIds(s.wa, 0).length);
    for (const u of o.units) expect(u.stance, `unit ${u.id}`).toBe('free');
    for (const c of o.contacts) expect(c, 'a contact').not.toHaveProperty('stance');
    expect(o).not.toHaveProperty('economy');
  });
});

describe('order: setStance (GH-954)', () => {
  it('ambush with a radius reaches the room, both sims hold it, and observe reads it back as ambush and the radius', async () => {
    const s = await seats(false);
    const own = sideIds(s.wa, 0).slice(0, 2);
    const [other] = sideIds(s.wa, 0).slice(2, 3);
    const r = await send(s, { verb: 'setStance', ids: own, stance: 'ambush', radius: 4 });
    expect(r.ok, r.text).toBe(true);
    expect(cmdsBy(s.loop, s.a)).toEqual([{ kind: 'setStance', ids: own, stance: 'ambush', radius: 4 * 65536 }]);
    for (const w of [s.wa, s.wc]) for (const id of own) expect(w.sim.ambushRadiusSqOf(id), `unit ${id}`).toBe(16 * 65536);
    expect(s.wa.sim.hash()).toBe(s.wc.sim.hash());
    const o = await observe(s.ctx);
    for (const id of own) expect(unitLine(o, id)).toMatchObject({ stance: 'ambush', radius: 4 });
    expect(unitLine(o, other).stance).toBe('free');
    const rec = (o.orders as Record<string, unknown>[])[0];
    expect(rec).toMatchObject({ verb: 'setStance', status: 'applied', stance: 'ambush' });
  });

  it('ambush without a radius takes the default, hold clears it, and a patrol reads as patrol with its points', async () => {
    const s = await seats(false);
    const [u, p] = sideIds(s.wa, 0);
    expect((await send(s, { verb: 'setStance', ids: [u], stance: 'ambush' })).ok).toBe(true);
    expect(unitLine(await observe(s.ctx), u)).toMatchObject({ stance: 'ambush', radius: 3 });
    expect((await send(s, { verb: 'setStance', ids: [u], stance: 'hold' })).ok).toBe(true);
    expect(unitLine(await observe(s.ctx), u).stance).toBe('free');
    const r = await send(s, { verb: 'setStance', ids: [p], stance: 'patrol', waypoints: [[12, 14], [16, 14], [16, 18]] });
    expect(r.ok, r.text).toBe(true);
    expect(unitLine(await observe(s.ctx), p)).toMatchObject({ stance: 'patrol', points: 3 });
    for (const w of [s.wa, s.wc]) expect(w.sim.isPatrolling(p)).toBe(true);
    expect(s.wa.sim.hash()).toBe(s.wc.sim.hash());
  });

  it('a stance order that is not well-formed is refused with the reason, and nothing is sent', async () => {
    const s = await seats(false);
    const [u] = sideIds(s.wa, 0);
    const enemy = sideIds(s.wa, 1)[0];
    const size = (await observe(s.ctx)).size as [number, number];
    const cases: [Record<string, unknown>, string, string | undefined][] = [
      [{ verb: 'setStance', ids: [u] }, 'invalid', 'setStance needs a stance: one of hold, ambush, patrol'],
      [{ verb: 'setStance', ids: [u], stance: 'dig_in' }, 'invalid', 'setStance needs a stance: one of hold, ambush, patrol'],
      [{ verb: 'setStance', ids: [u], stance: 'hold', radius: 3 }, 'invalid', 'radius is for the ambush stance only'],
      [{ verb: 'setStance', ids: [u], stance: 'ambush', radius: 0 }, 'invalid', 'radius is an integer 1-10 (tiles)'],
      [{ verb: 'setStance', ids: [u], stance: 'ambush', radius: 11 }, 'invalid', 'radius is an integer 1-10 (tiles)'],
      [{ verb: 'setStance', ids: [u], stance: 'ambush', radius: 2.5 }, 'invalid', 'radius is an integer 1-10 (tiles)'],
      [{ verb: 'setStance', ids: [u], stance: 'ambush', waypoints: [[1, 1], [2, 2]] }, 'invalid', 'waypoints are for the patrol stance only'],
      [{ verb: 'setStance', ids: [u], stance: 'patrol' }, 'invalid', 'a patrol needs waypoints: 2-4 tiles, each [x, y]'],
      [{ verb: 'setStance', ids: [u], stance: 'patrol', waypoints: [[1, 1]] }, 'invalid', 'a patrol needs waypoints: 2-4 tiles, each [x, y]'],
      [{ verb: 'setStance', ids: [u], stance: 'patrol', waypoints: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]] }, 'invalid', 'a patrol needs waypoints: 2-4 tiles, each [x, y]'],
      [{ verb: 'setStance', ids: [u], stance: 'patrol', waypoints: [[1, 1], [2]] }, 'invalid', 'each waypoint is a pair of integer tiles [x, y]'],
      [{ verb: 'setStance', ids: [u], stance: 'patrol', waypoints: [[1, 1], [size[0], 2]] }, 'off the map', undefined],
      [{ verb: 'setStance', ids: [enemy], stance: 'hold' }, 'not your unit', undefined],
    ];
    for (const [args, error, detail] of cases) {
      const r = await call(s.ctx, 'order', args);
      expect(r.ok, JSON.stringify(args)).toBe(false);
      expect(body(r), JSON.stringify(args)).toEqual(detail === undefined ? expect.objectContaining({ error }) : { error, detail });
    }
    await s.loop.flush();
    expect(cmdsBy(s.loop, s.a)).toEqual([]);
  });

  it('assist: a stance order is a proposal to the human, never a cmd', async () => {
    const room = await newRoom();
    const human = join(room.loop, await room.ticket(0), 0);
    const other = join(room.loop, await room.ticket(1), 1);
    const adv = join(room.loop, await room.advisorTicket(0, 'assist'), 0, 'advisor');
    await room.loop.flush();
    await Promise.all([human.client.ready, other.client.ready, adv.client.ready]);
    const ctx = createContext(adv.client, 'assist');
    const own = sideIds(adv.client.world() as MatchWorld, 0)[0];
    const r = await call(ctx, 'order', { verb: 'setStance', ids: [own], stance: 'ambush', radius: 5, note: 'wait for them' });
    expect(body(r)).toEqual({ proposal: 1, status: 'pending' });
    await room.loop.flush();
    const said = sentBy(room.loop, adv);
    expect(said.filter((m) => m.t === 'advisor')).toEqual([
      { t: 'advisor', a: { kind: 'proposal', id: 1, cmd: { kind: 'setStance', ids: [own], stance: 'ambush', radius: 5 * 65536 }, note: 'wait for them' } },
    ]);
    expect(said.filter((m) => m.t === 'cmd')).toHaveLength(0);
  });
});

describe('observe shows the economy, and only the seat\'s own (GH-954)', () => {
  it('KDF against Sarim: each seat reads its own purse, lines, menu and cap, and the other side\'s menu appears nowhere', async () => {
    const s = await seats(true);
    const k = await observe(s.ctx);
    const z = await observe(s.ctxC);
    expect(k.faction).toBe('kdf');
    expect(z.faction).toBe('sarim');
    expect(k.economy).toMatchObject({ purse: 1500, perMin: 0, population: { used: 22, cap: 40 } });
    expect(z.economy).toMatchObject({ purse: 2400, population: { used: 32, cap: 56 } });
    expect(k.economy.lines).toEqual([{ line: 0, alive: true, tile: expect.any(Array), building: null, progress: 0, secondsLeft: 0, contested: false, queued: [], rally: null }]);
    expect(k.economy.menu.find((m: { unit: string }) => m.unit === 'inf_squad')).toEqual({ unit: 'inf_squad', cost: 292, population: 1, buildSeconds: 15 });
    expect(z.economy.menu.find((m: { unit: string }) => m.unit === 'rocket_battery')).toMatchObject({ cost: 201, population: 3, buildSeconds: 40 });
    // The menus are the seat's own: nothing of the other faction's roster, nor its purse, is in the text.
    const kText = JSON.stringify(k);
    expect(kText).not.toContain('sarim_rifles');
    expect(kText).not.toContain('2400');
    expect(JSON.stringify(z)).not.toContain('inf_squad');
  });

  it('what the other seat queues does not move this seat\'s observe by a byte (fog)', async () => {
    const s = await seats(true);
    const before = (await call(s.ctx, 'observe')).text;
    expect(s.wa.runtime?.requestBuild('sarim_rifles', undefined, 1)).toBe(true);
    expect(s.wa.runtime?.logisticsOf(1)).toBeLessThan(2400);
    expect((await call(s.ctx, 'observe')).text).toBe(before);
  });
});

describe('order: build, cancelBuild, setRally, clearRally (GH-954)', () => {
  it('build is sent as the seat\'s own side, paid when it runs, shown in the queue, and both sims agree', async () => {
    const s = await seats(true);
    const r = await send(s, { verb: 'build', unit: 'inf_squad' });
    expect(r.ok, r.text).toBe(true);
    expect(cmdsBy(s.loop, s.a)).toEqual([{ kind: 'build', side: 0, unit: 'inf_squad' }]);
    const o = await observe(s.ctx);
    expect(o.economy.purse).toBe(1500 - 292);
    expect(o.economy.lines[0]).toMatchObject({ building: 'inf_squad', queued: [] });
    expect(o.economy.lines[0].secondsLeft).toBeGreaterThan(0);
    expect(o.economy.population.used).toBe(23);
    expect((o.orders as Record<string, unknown>[])[0]).toMatchObject({ verb: 'build', status: 'applied', unit: 'inf_squad' });
    expect(s.wa.sim.hash()).toBe(s.wc.sim.hash());
    expect(s.wa.runtime?.digest()).toBe(s.wc.runtime?.digest());
    // The Sarim seat's world holds the same spend, and its own observe is untouched.
    const z = await observe(s.ctxC);
    expect(z.economy.purse).toBe(2400);
    expect(z.economy.lines[0].building).toBeNull();
  });

  it('a build the purse cannot pay is refused, with the runtime\'s count, and nothing is sent; the menu says so first', async () => {
    const s = await seats(true);
    expect((await send(s, { verb: 'build', unit: 'mbt_lavi' })).ok).toBe(true);   // 906 of 1500
    const o = await observe(s.ctx);
    expect(o.economy.purse).toBe(594);
    expect(o.economy.menu.find((m: { unit: string }) => m.unit === 'mbt_lavi').blocked).toBe('not enough logistics (costs 906, you have 594)');
    expect(o.economy.menu.find((m: { unit: string }) => m.unit === 'inf_squad')).not.toHaveProperty('blocked');
    const r = await call(s.ctx, 'order', { verb: 'build', unit: 'mbt_lavi' });
    expect(r.ok).toBe(false);
    expect(body(r)).toEqual({ error: 'refused', detail: 'not enough logistics (costs 906, you have 594)' });
    await s.loop.flush();
    expect(cmdsBy(s.loop, s.a)).toHaveLength(1);
  });

  it('a unit off the seat\'s menu, a line that is not there and a malformed order are each refused with the reason', async () => {
    const s = await seats(true);
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ verb: 'build', unit: 'sarim_rifles' }, { error: 'refused', detail: 'not available in the field' }],
      [{ verb: 'build', unit: 'inf_squad', line: 1 }, { error: 'refused', detail: 'no such line (yours are 0-0)' }],
      [{ verb: 'build', unit: 'inf_squad', line: 4 }, { error: 'invalid', detail: 'build needs a line: an integer 0-3, from economy.lines in observe' }],
      [{ verb: 'build' }, { error: 'invalid', detail: 'build needs a unit: an id from economy.menu in observe' }],
      [{ verb: 'cancelBuild', line: 0 }, { error: 'invalid', detail: 'cancelBuild needs an index: -1 for the item in production, or 0-15 for one waiting' }],
      [{ verb: 'cancelBuild', line: 0, index: -1 }, { error: 'refused', detail: 'nothing is in production on that line' }],
      [{ verb: 'cancelBuild', line: 0, index: 3 }, { error: 'refused', detail: 'nothing is queued at index 3 (0 waiting)' }],
      [{ verb: 'setRally', line: 0, x: 999, y: 3 }, { error: 'off the map' }],
      [{ verb: 'setRally', line: 0, x: 3 }, { error: 'invalid', detail: 'setRally needs integer tiles x and y' }],
      [{ verb: 'setRally', x: 3, y: 3 }, { error: 'invalid', detail: 'setRally needs a line: an integer 0-3, from economy.lines in observe' }],
      [{ verb: 'clearRally', line: 2 }, { error: 'refused', detail: 'no such line (yours are 0-0)' }],
    ];
    for (const [args, want] of cases) {
      const r = await call(s.ctx, 'order', args);
      expect(r.ok, JSON.stringify(args)).toBe(false);
      expect(body(r), JSON.stringify(args)).toEqual(want);
    }
    await s.loop.flush();
    expect(cmdsBy(s.loop, s.a)).toEqual([]);
  });

  it('a rally point on a blocked tile is refused; on an open tile it is set, shown, and cleared', async () => {
    const s = await seats(true);
    const sim = s.wa.sim;
    let open: [number, number] | null = null;
    let wall: [number, number] | null = null;
    for (let y = 0; y < sim.height && (open === null || wall === null); y++) {
      for (let x = 0; x < sim.width; x++) {
        const blocked = sim.blocked[y * sim.width + x] !== 0;
        if (blocked && wall === null) wall = [x, y];
        if (!blocked && open === null && x > 8 && y > 8) open = [x, y];
      }
    }
    expect(open).not.toBeNull();
    expect(wall).not.toBeNull();
    const refused = await call(s.ctx, 'order', { verb: 'setRally', line: 0, x: wall![0], y: wall![1] });
    expect(body(refused)).toEqual({ error: 'refused', detail: 'the rally point must be an open tile (not a building, ridge or boulder)' });
    expect((await send(s, { verb: 'setRally', line: 0, x: open![0], y: open![1] })).ok).toBe(true);
    expect((await observe(s.ctx)).economy.lines[0].rally).toEqual(open);
    expect((await send(s, { verb: 'clearRally', line: 0 })).ok).toBe(true);
    expect((await observe(s.ctx)).economy.lines[0].rally).toBeNull();
    expect(s.wa.runtime?.digest()).toBe(s.wc.runtime?.digest());
  });

  it('cancelBuild: index 0 takes a waiting item and refunds it, -1 takes the one in production', async () => {
    const s = await seats(true);
    expect((await send(s, { verb: 'build', unit: 'inf_squad' })).ok).toBe(true);
    expect((await send(s, { verb: 'build', unit: 'at_team' })).ok).toBe(true);
    let o = await observe(s.ctx);
    expect(o.economy.lines[0]).toMatchObject({ building: 'inf_squad', queued: ['at_team'] });
    expect(o.economy.purse).toBe(1500 - 292 - 236);
    expect((await send(s, { verb: 'cancelBuild', line: 0, index: 0 })).ok).toBe(true);
    o = await observe(s.ctx);
    expect(o.economy.lines[0]).toMatchObject({ building: 'inf_squad', queued: [] });
    expect(o.economy.purse).toBe(1500 - 292);
    expect((await send(s, { verb: 'cancelBuild', line: 0, index: -1 })).ok).toBe(true);
    o = await observe(s.ctx);
    expect(o.economy.lines[0].building).toBeNull();
    expect(o.economy.purse).toBe(1500);
    expect(s.wa.runtime?.digest()).toBe(s.wc.runtime?.digest());
  });

  it('a mirror room has no production: the four verbs are refused as invalid, saying so, and nothing is sent', async () => {
    const s = await seats(false);
    for (const args of [{ verb: 'build', unit: 'inf_squad' }, { verb: 'cancelBuild', line: 0, index: -1 }, { verb: 'setRally', line: 0, x: 12, y: 14 }, { verb: 'clearRally', line: 0 }]) {
      const r = await call(s.ctx, 'order', args);
      expect(r.ok, JSON.stringify(args)).toBe(false);
      expect(body(r).error).toBe('invalid');
      expect(body(r).detail, JSON.stringify(args)).toMatch(/is for KDF-against-Sarim rooms, which have a production economy; this room has none/);
    }
    await s.loop.flush();
    expect(cmdsBy(s.loop, s.a)).toEqual([]);
  });

  it('assist: a build is a proposal to the human, never a cmd, and the runtime\'s refusal applies to it too', async () => {
    const room = await newRoom({ map: 'wadi_tarfan', matchup: 'kdf' });
    const human = join(room.loop, await room.ticket(0), 0);
    const other = join(room.loop, await room.ticket(1), 1);
    const adv = join(room.loop, await room.advisorTicket(0, 'assist'), 0, 'advisor');
    await room.loop.flush();
    await Promise.all([human.client.ready, other.client.ready, adv.client.ready]);
    const ctx = createContext(adv.client, 'assist');
    expect(body(await call(ctx, 'order', { verb: 'build', unit: 'inf_squad', note: 'more infantry' }))).toEqual({ proposal: 1, status: 'pending' });
    expect(body(await call(ctx, 'order', { verb: 'build', unit: 'sarim_rifles' }))).toEqual({ error: 'refused', detail: 'not available in the field' });
    await room.loop.flush();
    const said = sentBy(room.loop, adv);
    expect(said.filter((m) => m.t === 'advisor')).toEqual([
      { t: 'advisor', a: { kind: 'proposal', id: 1, cmd: { kind: 'build', side: 0, unit: 'inf_squad' }, note: 'more infantry' } },
    ]);
    expect(said.filter((m) => m.t === 'cmd')).toHaveLength(0);
  });
});
