// N4a task 8: the MCP tools a model drives the headless client with, against
// the REAL `MatchRoom` over the fake Durable Object runtime (`test-room.ts`).
// Every case goes through the tools exactly as the stdio server calls them
// (`run(ctx, args)`), and reads back what reached the room from the sockets.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMsg, ServerMsg, SocketLike } from '@lions/net';
import { fx } from '@lions/sim';
import type { MatchWorld } from '../../../packages/app/src/net/match-world';
import { AgentClient } from './agent-client';
import { createContext, toolsFor, TOOLS, type Scope, type ToolContext, type ToolResult } from './mcp-tools';
import { ROOM_BUILD, ROOM_CODE, ROOM_MAP, ROOM_NOW, newRoom, play, type Loop } from './test-room';
import { versusConfig } from './test-config';
import { VERSUS_FORMATIONS_CLOSED_MAPS } from '../../../packages/app/src/net/versus-formations';

beforeEach(() => { vi.useFakeTimers({ now: ROOM_NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

/** A client whose socket the spec can name. */
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
const heardBy = (loop: Loop, j: Joined): ServerMsg[] => loop.received.get(j.sock()) ?? [];

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

/** Drives the room until `p` settles (bounded), pumping the runners after each tick. */
async function drive<T>(loop: Loop, runners: { pump(n: number): number }[], p: Promise<T>, maxTicks = 400): Promise<T> {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  await play(loop, maxTicks, runners, () => settled);
  expect(settled, 'the tool call never settled').toBe(true);
  return p;
}

/** Two seat clients, both started; both seats human unless `kinds` says otherwise. */
async function twoSeats(kinds: { host?: 'human' | 'bot'; guest?: 'human' | 'bot'; map?: string; matchup?: 'kdf' | 'sarim' } = {}): Promise<{ loop: Loop; a: Joined; c: Joined; room: Awaited<ReturnType<typeof newRoom>> }> {
  const room = await newRoom(kinds);
  const a = join(room.loop, await room.ticket(0), 0);
  const c = join(room.loop, await room.ticket(1), 1);
  await room.loop.flush();
  await Promise.all([a.client.ready, c.client.ready]);
  return { loop: room.loop, a, c, room };
}

describe('the tools a scope is given (case 1)', () => {
  const names = (s: Scope): string[] => toolsFor(s).map((t) => t.name).sort();
  it('advise has no order and no end_round; assist has order, not end_round; command has both and no ping', () => {
    expect(names('advise')).toEqual(['inbox', 'observe', 'ping', 'say', 'status', 'terrain', 'wait']);
    expect(names('assist')).toEqual(['inbox', 'observe', 'order', 'ping', 'say', 'status', 'terrain', 'wait']);
    expect(names('command')).toEqual(['end_round', 'inbox', 'observe', 'order', 'say', 'status', 'terrain', 'wait']);
  });
  it('a tool called outside its scope refuses, whatever the server registered', async () => {
    const sockless = new AgentClient({ server: 'https://room.test', code: ROOM_CODE, ticket: 't', build: ROOM_BUILD, role: 'advisor', seat: 0, log: () => {}, open: () => ({ onopen: null, onmessage: null, onclose: null, send: () => {}, close: () => {} }) });
    const r = await call(createContext(sockless, 'advise'), 'order', { verb: 'halt', ids: [1] });
    expect(r.ok).toBe(false);
    expect(body(r).error).toBe('not in this scope');
  });
});

describe('order in command scope (case 2)', () => {
  it('an enemy id is refused as not your unit; an own id answers a ref, applied after 40 ticks', async () => {
    const { loop, a, c } = await twoSeats();
    const ctx = createContext(a.client, 'command');
    const w = a.client.world() as MatchWorld;
    const enemy = sideIds(w, 1)[0];
    const own = sideIds(w, 0)[0];
    const refused = await call(ctx, 'order', { verb: 'halt', ids: [enemy] });
    expect(refused.ok).toBe(false);
    expect(body(refused).error).toBe('not your unit');
    const unknown = await call(ctx, 'order', { verb: 'callStrike', ids: [own] });
    expect(body(unknown).error).toBe('unknown verb');
    // GH-954 (D-W8): the stance and production verbs are verbs now; what stays out is fire support and the tunnel two.
    for (const verb of ['support', 'enterTunnel', 'vent', 'reveal', 'raiseWorks', 'cancelWorks', 'construct', 'cancelConstruct']) {
      expect(body(await call(ctx, 'order', { verb, ids: [own] })).error, verb).toBe('unknown verb');
    }
    const off = await call(ctx, 'order', { verb: 'move', ids: [own], x: 999, y: 3 });
    expect(body(off).error).toBe('off the map');
    const taken = await call(ctx, 'order', { verb: 'move', ids: [own], x: 12, y: 14 });
    expect(taken.ok).toBe(true);
    const { ref, status } = body(taken) as { ref: number; status: string };
    expect(status).toBe('queued');
    const waited = await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 40 }));
    expect(body(waited).reason).toBe('ticks');
    const orders = body(await call(ctx, 'observe')).orders as { ref: number; status: string; verb: string; tile: number[] }[];
    expect(orders.find((o) => o.ref === ref)).toMatchObject({ status: 'applied', verb: 'move', tile: [12, 14] });
    // Nothing the room refused: no frame carried the enemy id from seat 0.
    expect(sentBy(loop, a).filter((m) => m.t === 'cmd')).toHaveLength(1);
  });

  it('rescue (GH-707) is a verb: it needs an integer target from casualties.mine, which a healthy unit, a contact and an enemy are not', async () => {
    const { a } = await twoSeats();
    const ctx = createContext(a.client, 'command');
    const w = a.client.world() as MatchWorld;
    const [own, other] = sideIds(w, 0);
    const enemy = sideIds(w, 1)[0];
    expect(body(await call(ctx, 'order', { verb: 'rescue', ids: [own] })).error).toBe('not a casualty');
    expect(body(await call(ctx, 'order', { verb: 'rescue', ids: [own], target: enemy })).error).toBe('not a casualty');
    expect(body(await call(ctx, 'order', { verb: 'rescue', ids: [own], target: 99999 })).error).toBe('not a casualty');
    expect(body(await call(ctx, 'order', { verb: 'rescue', ids: [own], target: other })).error).toBe('not a casualty'); // a healthy unit of his own
    // An ENEMY casualty in sight: a wounded body of side 1 two tiles from one of seat 0's units. He is listed under
    // `casualties.theirs` (so he is no unit and no contact), and `rescue` on his id is refused like any other non-own id:
    // the order is for your own side's wounded only.
    const woundedIdx = w.sim.unitTypes.findIndex((t) => t.id === 'wounded_kdf');
    expect(woundedIdx).toBeGreaterThanOrEqual(0);
    const foe = w.sim.spawn(woundedIdx, 1, w.sim.state.posX[own] + (2 << 16), w.sim.state.posY[own]);
    w.sim.tick();
    (a.client as unknown as { live: { fog: { step(): void } } }).live.fog.step(); // the seat's fog sees the body, as the harness tick does
    const theirs = body(await call(ctx, 'observe')) as { casualties: { theirs: { id: number }[] } };
    expect(theirs.casualties.theirs.map((c) => c.id)).toContain(foe);
    expect(body(await call(ctx, 'order', { verb: 'rescue', ids: [own], target: foe })).error).toBe('not a casualty');
    // A real casualty: one of seat 0's infantry squads, hit until a man falls wounded and goes DOWN. He is listed under
    // `casualties.mine` and not under `units`, and that is the id a medic is sent to.
    const squad = sideIds(w, 0).find((i) => w.sim.unitTypes[w.sim.state.typeIdx[i]].id === 'inf_squad');
    if (squad === undefined) throw new Error('no KDF rifle squad on seat 0');
    // Flake fix: the squad's fall roll is a 0.6 chance on its own rng stream, and the squad (3 figures) is destroyed after at most
    // three rolls, so ~6% of stream positions left no body at all (the stream position moves with how many ticks the harness ran).
    // Pin the roll to a certainty: a chance of ONE draws nothing (`fallMan`), so the first man to fall always lives as a wounded body.
    // Still red if wounds stop spawning: the roll is bypassed, not the spawn, the cap or the type lookup.
    const squadWounds = w.sim.unitTypes[w.sim.state.typeIdx[squad]].wounds;
    if (squadWounds === null) throw new Error('inf_squad carries no hull.wounds');
    squadWounds.chance = fx.fromInt(1);
    const before = w.sim.entityCount;
    for (let k = 0; k < 40 && w.sim.entityCount === before; k++) {
      (w.sim as unknown as { applyDamage(t: number, d: number, by: number): void }).applyDamage(squad, fx.fromInt(100), enemy);
    }
    expect(w.sim.entityCount, 'a man went down').toBeGreaterThan(before);
    const seen = body(await call(ctx, 'observe')) as { casualties: { mine: { id: number }[] } };
    expect(seen.casualties.mine.length).toBeGreaterThan(0);
    const man = seen.casualties.mine[0].id;
    expect(sideIds(w, 0)).toContain(man);
    const sent = await call(ctx, 'order', { verb: 'rescue', ids: [own], target: man });
    expect(sent.ok).toBe(true);
    expect((body(sent) as { status: string }).status).toBe('queued');
  });
});

// The ruling (15 Oct, coordinator, lead-delegated): the human UI never sends
// `sweep` (the lead's 11 Oct ruling), so an agent may send it only where no
// human seat plays -- command scope, both seats `kind: 'bot'` (the arena,
// parity with the in-process `rush`) -- and never in assist.
const BOTS = { host: 'bot', guest: 'bot' } as const;
/** The one versus room that closes formations: a Tel Marum economy room (KDF v Sarim, the host Sarim). */
const CLOSED_ROOM = { map: 'tel_marum', matchup: 'sarim' } as const;
/** The first `n` of this seat's own unit ids, as `observe` lists them (a Sarim host is side 1). */
async function ownIds(ctx: ToolContext, n: number): Promise<number[]> {
  const ids = (body(await call(ctx, 'observe')) as { units: { id: number }[] }).units.slice(0, n).map((u) => u.id);
  expect(ids).toHaveLength(n);
  return ids;
}
// GH-859 P1a: the agent harness orders a combat formation through the same door a human's click will use.
describe('order: the formation field (GH-859 P1a)', () => {
  // Task 6V (the lead's ruling, 29 Oct): formations are OFF in versus rooms until S4 passed. They opened on 1 Nov on the maps S4 covered, and
  // map by map after (Wadi Tarfan with GH-945, Rujm Sawda on 3 Nov, Wadi Tarfan (large) with PR 1104), so the refusal is witnessed in the one
  // room still closed: a Tel Marum economy room (KDF v Sarim; `formations_closed_in` in data/versus/tel_marum.json, the lead's 5 Nov ruling).
  // A Sarim host is side 1, so the ids are read from `observe`. The open map is the last test of this block.
  // `twoSeats` is a versus room. The agent
  // harness checks an order with the same `validateCommand` the receiver runs, so a formation order is refused before it is sent.
  // The open-gate plumbing (stamped, framed, the same group on both sims) is witnessed in `two-client.test.ts` ("GATE OPEN").
  it('a Column move in a closed versus room is refused as invalid and nothing is sent; the plain move goes through and forms no group', async () => {
    const { loop, a, c } = await twoSeats({ ...BOTS, ...CLOSED_ROOM });
    const ctx = createContext(a.client, 'command');
    const wa = a.client.world() as MatchWorld;
    const wc = c.client.world() as MatchWorld;
    const own = await ownIds(ctx, 4);
    expect(own).toHaveLength(4);
    // Both machines still REGISTER the formations: the sim is untouched, the door is what is shut.
    for (const w of [wa, wc]) expect(w.sim.formationTypeCount()).toBe(3);
    const r = await call(ctx, 'order', { verb: 'move', ids: own, x: 20, y: 20, formation: 'column' });
    expect(r.ok).toBe(false);
    // M8: the refusal names its cause (the formation gate), where P1a answered a bare `invalid`.
    expect(body(r)).toEqual({ error: 'invalid', detail: 'formations-closed-in-versus' });
    await loop.flush();
    expect(sentBy(loop, a).filter((m) => m.t === 'cmd')).toEqual([]);
    // The same order without the field is an ordinary order: sent, framed for both seats, no group.
    const plain = await call(ctx, 'order', { verb: 'move', ids: own, x: 20, y: 20 });
    expect(plain.ok, plain.text).toBe(true);
    await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 40 }));
    const sent = sentBy(loop, a).filter((m) => m.t === 'cmd');
    expect(sent).toHaveLength(1);
    expect('formation' in (sent[0] as { cmd: object }).cmd).toBe(false);
    for (const w of [wa, wc]) expect(own.map((id) => w.sim.formationGroupOf(id))).toEqual([-1, -1, -1, -1]);
    expect(wa.sim.hash()).toBe(wc.sim.hash());
  });
  it('an attack formation on an attackMove is refused the same way, and the plain attackMove forms no group', async () => {
    const { loop, a, c } = await twoSeats({ ...BOTS, ...CLOSED_ROOM });
    const ctx = createContext(a.client, 'command');
    const wa = a.client.world() as MatchWorld;
    const own = await ownIds(ctx, 3);
    const r = await call(ctx, 'order', { verb: 'attackMove', ids: own, x: 20, y: 20, formation: 'attack' });
    expect(r.ok).toBe(false);
    expect(body(r)).toEqual({ error: 'invalid', detail: 'formations-closed-in-versus' });
    expect((await call(ctx, 'order', { verb: 'attackMove', ids: own, x: 20, y: 20 })).ok).toBe(true);
    await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 40 }));
    expect(own.map((id) => wa.sim.formationGroupOf(id))).toEqual([-1, -1, -1]);
  });
  it('GH-859 (7 Nov): Wadi Tarfan (large), once closed, is open: the same Column move is accepted, sent with its formation, and forms a group', async () => {
    const { loop, a, c } = await twoSeats({ ...BOTS, map: 'wadi_tarfan_l' });
    const ctx = createContext(a.client, 'command');
    const wa = a.client.world() as MatchWorld;
    const own = sideIds(wa, 0).slice(0, 4);
    const r = await call(ctx, 'order', { verb: 'move', ids: own, x: 20, y: 20, formation: 'column' });
    expect(r.ok, r.text).toBe(true);
    await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 40 }));
    const sent = sentBy(loop, a).filter((m) => m.t === 'cmd');
    expect(sent).toHaveLength(1);
    expect((sent[0] as { cmd: { formation?: string } }).cmd.formation).toBe('column');
    expect(own.every((id) => wa.sim.formationGroupOf(id) >= 0)).toBe(true);
  });
   it('GH-859 (1 Nov): on a map S4 covered (the default room map) the same Column move is accepted, sent with its formation, and forms the same group on both machines', async () => {
    const { loop, a, c } = await twoSeats(BOTS);
    const ctx = createContext(a.client, 'command');
    const wa = a.client.world() as MatchWorld;
    const wc = c.client.world() as MatchWorld;
    const own = sideIds(wa, 0).slice(0, 4);
    const r = await call(ctx, 'order', { verb: 'move', ids: own, x: 20, y: 20, formation: 'column' });
    expect(r.ok, r.text).toBe(true);
    await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 40 }));
    const sent = sentBy(loop, a).filter((m) => m.t === 'cmd');
    expect(sent).toHaveLength(1);
    expect((sent[0] as { cmd: { formation?: string } }).cmd.formation).toBe('column');
    for (const w of [wa, wc]) expect(own.every((id) => w.sim.formationGroupOf(id) >= 0)).toBe(true);
    expect(wa.sim.hash()).toBe(wc.sim.hash());
  });
 it('the order tool says where formations are refused, and names the detail it answers with (M8); it no longer calls them closed in versus (GH-1097)', () => {
    const order = TOOLS.find((t) => t.name === 'order');
    expect(order).toBeDefined();
    expect(order!.description).toContain('formations-closed-in-versus');
    expect(order!.description).toContain('except a Tel Marum economy room');
    expect(order!.description).not.toContain('wadi_tarfan_l');
    expect(order!.description).not.toContain('while formations are closed in versus rooms');
  });
  // GH-1097: the 7 Nov match gave no formation order. `observe` now says which the room accepts, from the receiver's own gate.
  it('GH-1097: observe lists the three formations in an open room, and the Column it lists is accepted and sent as a Command with its formation', async () => {
    const { loop, a, c } = await twoSeats(BOTS);
    const ctx = createContext(a.client, 'command');
    const seen = body(await call(ctx, 'observe')) as { formations: { id: string; verb: string }[] };
    expect(seen.formations).toEqual([{ id: 'ambush', verb: 'move' }, { id: 'attack', verb: 'attackMove' }, { id: 'column', verb: 'move' }]);
    const own = sideIds(a.client.world() as MatchWorld, 0).slice(0, 3);
    const r = await call(ctx, 'order', { verb: 'attackMove', ids: own, x: 20, y: 20, formation: 'attack' });
    expect(r.ok, r.text).toBe(true);
    await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 40 }));
    const sent = sentBy(loop, a).filter((m) => m.t === 'cmd') as { cmd: { kind: string; formation?: string } }[];
    expect(sent.map((m) => [m.cmd.kind, m.cmd.formation])).toEqual([['attackMove', 'attack']]);
  });
  it('GH-1097: terrain answers the map\'s rows (a window when asked), and refuses a window off the map', async () => {
    const { a } = await twoSeats(BOTS);
    const ctx = createContext(a.client, 'command');
    const w = a.client.world() as MatchWorld;
    const whole = body(await call(ctx, 'terrain')) as { rows: string[]; origin: number[]; size: number[] };
    expect(whole.size).toEqual([w.sim.width, w.sim.height]);
    expect(whole.rows).toHaveLength(w.sim.height);
    expect(whole.rows.every((r) => r.length === w.sim.width)).toBe(true);
    const part = body(await call(ctx, 'terrain', { x: 4, y: 6, w: 3, h: 2 })) as { rows: string[]; origin: number[] };
    expect(part.origin).toEqual([4, 6]);
    expect(part.rows).toEqual(whole.rows.slice(6, 8).map((r) => r.slice(4, 7)));
    expect(body(await call(ctx, 'terrain', { x: w.sim.width, y: 0 }))).toMatchObject({ error: 'off the map' });
    expect(body(await call(ctx, 'terrain', { x: 0, y: w.sim.height }))).toMatchObject({ error: 'off the map' });
    // A window past the right and bottom edges is clamped to the map, not refused.
    const corner = body(await call(ctx, 'terrain', { x: w.sim.width - 2, y: w.sim.height - 3, w: 10, h: 10 })) as { rows: string[]; origin: number[] };
    expect(corner.origin).toEqual([w.sim.width - 2, w.sim.height - 3]);
    expect(corner.rows).toEqual(whole.rows.slice(w.sim.height - 3).map((r) => r.slice(w.sim.width - 2)));
  });
  it('GH-1097 review: a building that falls far from every unit of the seat still stands in its terrain (no news through the fog)', async () => {
    const { a } = await twoSeats(BOTS);
    const ctx = createContext(a.client, 'command');
    const w = a.client.world() as MatchWorld;
    const sim = w.sim;
    const own = (body(await call(ctx, 'observe')) as { units: { tile: [number, number] }[] }).units.map((u) => u.tile);
    // The building tile farthest from the seat's own force: out of any sight range on this map (asserted, not assumed).
    let best: [number, number] = [-1, -1];
    let bestD = -1;
    for (let y = 0; y < sim.height; y++) for (let x = 0; x < sim.width; x++) {
      if (sim.blocked[y * sim.width + x] === 0 || w.mapJson.rows[y][x] === '^') continue;
      const d = Math.min(...own.map(([ux, uy]) => Math.hypot(ux - x, uy - y)));
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
    expect(bestD).toBeGreaterThan(20);
    const [x, y] = best;
    expect((body(await call(ctx, 'terrain', { x, y, w: 1, h: 1 })) as { rows: string[] }).rows).toEqual(['#']);
    (sim.blocked as Uint8Array)[y * sim.width + x] = 0; // fixture: a collapse (sim.ts `collapse`), on this seat's own world
    (sim.cover as Uint8Array)[y * sim.width + x] = 1;
    expect((body(await call(ctx, 'terrain', { x, y, w: 1, h: 1 })) as { rows: string[] }).rows).toEqual(['#']);
  });
  // PR 1104 (the lead, 7 Nov) opens Wadi Tarfan (large): `VERSUS_FORMATIONS_CLOSED_MAPS` becomes []. Until it lands on this branch's
  // base the map is still closed, so the case runs once the constant no longer names it; it is never edited to pass.
  it.skipIf(VERSUS_FORMATIONS_CLOSED_MAPS.includes('wadi_tarfan_l'))('GH-1097: on wadi_tarfan_l observe lists all three formations, and a Column move is accepted', async () => {
    const { a } = await twoSeats({ ...BOTS, map: 'wadi_tarfan_l' });
    const ctx = createContext(a.client, 'command');
    const seen = body(await call(ctx, 'observe')) as { formations: { id: string }[] };
    expect(seen.formations.map((f) => f.id)).toEqual(['ambush', 'attack', 'column']);
    const r = await call(ctx, 'order', { verb: 'move', ids: await ownIds(ctx, 3), x: 20, y: 20, formation: 'column' });
    expect(r.ok, r.text).toBe(true);
  });
  it('GH-1097: observe lists none in a tel_marum economy room (closed by its rules file), where the order is refused with the reason and nothing is sent', async () => {
    for (const o of [CLOSED_ROOM]) {
      const { loop, a } = await twoSeats({ ...BOTS, ...o });
      const ctx = createContext(a.client, 'command');
      const seen = body(await call(ctx, 'observe')) as { formations: unknown[]; units: { id: number }[] };
      expect(seen.formations, o.map).toEqual([]);
      const own = seen.units.slice(0, 3).map((u) => u.id); // a Sarim host is side 1
      const r = await call(ctx, 'order', { verb: 'move', ids: own, x: 20, y: 20, formation: 'column' });
      expect(body(r), o.map).toEqual({ error: 'invalid', detail: 'formations-closed-in-versus' });
      await loop.flush();
      expect(sentBy(loop, a).filter((m) => m.t === 'cmd'), o.map).toEqual([]);
    }
  });
  it('an id nobody ships, a formation on the wrong verb or on another verb, is refused and nothing is sent', async () => {
    const { loop, a } = await twoSeats(BOTS);
    const ctx = createContext(a.client, 'command');
    const own = sideIds(a.client.world() as MatchWorld, 0)[0];
    const cases: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ verb: 'move', ids: [own], x: 12, y: 14, formation: 'nosuch' }, { error: 'unknown formation', detail: 'one of ambush, attack, column' }],
      [{ verb: 'move', ids: [own], x: 12, y: 14, formation: 'attack' }, { error: 'invalid', detail: 'attack is for attackMove, not move' }],
      [{ verb: 'attackMove', ids: [own], x: 12, y: 14, formation: 'column' }, { error: 'invalid', detail: 'column is for move, not attackMove' }],
      [{ verb: 'halt', ids: [own], formation: 'column' }, { error: 'invalid', detail: 'formation is for move and attackMove only' }],
      [{ verb: 'smoke', ids: [own], x: 12, y: 14, formation: 'column' }, { error: 'invalid', detail: 'formation is for move and attackMove only' }],
    ];
    for (const [args, want] of cases) {
      const r = await call(ctx, 'order', args);
      expect(r.ok, JSON.stringify(args)).toBe(false);
      expect(body(r), JSON.stringify(args)).toEqual(want);
    }
    await loop.flush();
    expect(sentBy(loop, a).filter((m) => m.t === 'cmd')).toEqual([]);
  });
});

describe('order: attackMove with sweep (N4b minors)', () => {
  it('bot against bot: sweep: true reaches the room on the frame and both sims queue it with sweep: true', async () => {
    const { loop, a, c } = await twoSeats(BOTS);
    const ctx = createContext(a.client, 'command');
    const wa = a.client.world() as MatchWorld;
    const wc = c.client.world() as MatchWorld;
    const own = sideIds(wa, 0)[0];
    const queuedA = vi.spyOn(wa.sim, 'queueCommand');
    const queuedC = vi.spyOn(wc.sim, 'queueCommand');
    const r = await call(ctx, 'order', { verb: 'attackMove', ids: [own], x: 20, y: 20, sweep: true });
    expect(r.ok, r.text).toBe(true);
    await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 40 }));
    // What seat 0 sent, and what the room minted into a frame for BOTH seats.
    const sent = sentBy(loop, a).filter((m) => m.t === 'cmd');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ cmd: { kind: 'attackMove', ids: [own], sweep: true } });
    for (const j of [a, c]) {
      const framed = heardBy(loop, j).flatMap((m) => (m.t === 'frame' ? m.cmds : [])).map((s) => s.cmd);
      expect(framed).toEqual([{ kind: 'attackMove', ids: [own], x: fx.from(20.5), y: fx.from(20.5), sweep: true }]);
    }
    // Applied: ownership passed it, on both machines, into the sim with the flag.
    for (const q of [queuedA, queuedC]) {
      expect(q.mock.calls.map(([cmd]) => cmd)).toEqual([{ kind: 'attackMove', ids: [own], x: fx.from(20.5), y: fx.from(20.5), sweep: true }]);
    }
  });
  it('bot against bot: sweep without it is absent from the command, and sweep: false is carried as false', async () => {
    const { loop, a, c } = await twoSeats(BOTS);
    const ctx = createContext(a.client, 'command');
    const own = sideIds(a.client.world() as MatchWorld, 0)[0];
    expect((await call(ctx, 'order', { verb: 'attackMove', ids: [own], x: 20, y: 20 })).ok).toBe(true);
    expect((await call(ctx, 'order', { verb: 'attackMove', ids: [own], x: 21, y: 20, sweep: false })).ok).toBe(true);
    await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 40 }));
    const sent = sentBy(loop, a).filter((m) => m.t === 'cmd').map((m) => (m as { cmd: Record<string, unknown> }).cmd);
    expect(sent).toHaveLength(2);
    expect('sweep' in sent[0]).toBe(false);
    expect(sent[1].sweep).toBe(false);
  });
  it('bot against bot: sweep on any verb but attackMove is refused, and nothing is sent', async () => {
    const { loop, a } = await twoSeats(BOTS);
    const ctx = createContext(a.client, 'command');
    const own = sideIds(a.client.world() as MatchWorld, 0)[0];
    for (const args of [
      { verb: 'move', ids: [own], x: 12, y: 14, sweep: true },
      { verb: 'move', ids: [own], x: 12, y: 14, sweep: false },
      { verb: 'halt', ids: [own], sweep: true },
    ]) {
      const r = await call(ctx, 'order', args);
      expect(r.ok, JSON.stringify(args)).toBe(false);
      expect(body(r)).toEqual({ error: 'invalid', detail: 'sweep is for attackMove only' });
    }
    const notBool = await call(ctx, 'order', { verb: 'attackMove', ids: [own], x: 12, y: 14, sweep: 'yes' });
    expect(body(notBool)).toEqual({ error: 'invalid', detail: 'sweep is true or false' });
    await loop.flush();
    expect(sentBy(loop, a).filter((m) => m.t === 'cmd')).toEqual([]);
  });
  for (const [label, kinds] of [['both seats human', {}], ['a bot seat against a human', { host: 'bot', guest: 'human' }], ['a human seat against a bot', { host: 'human', guest: 'bot' }]] as const) {
    it(`command, ${label}: sweep is refused as not available against a human seat, and nothing is sent`, async () => {
      const { loop, a } = await twoSeats(kinds);
      const ctx = createContext(a.client, 'command');
      const own = sideIds(a.client.world() as MatchWorld, 0)[0];
      for (const sweep of [true, false]) {
        const r = await call(ctx, 'order', { verb: 'attackMove', ids: [own], x: 20, y: 20, sweep });
        expect(r.ok).toBe(false);
        expect(body(r).error).toBe('not available against a human seat');
      }
      // The same order without it is taken.
      expect((await call(ctx, 'order', { verb: 'attackMove', ids: [own], x: 20, y: 20 })).ok).toBe(true);
      await loop.flush();
      expect(sentBy(loop, a).filter((m) => m.t === 'cmd' && 'sweep' in (m as { cmd: object }).cmd)).toEqual([]);
    });
  }
  it('assist: sweep is always refused, even with both seats bots, and no proposal is sent', async () => {
    const room = await newRoom(BOTS);
    const human = join(room.loop, await room.ticket(0), 0);
    const other = join(room.loop, await room.ticket(1), 1);
    const adv = join(room.loop, await room.advisorTicket(0, 'assist'), 0, 'advisor');
    await room.loop.flush();
    await Promise.all([human.client.ready, other.client.ready, adv.client.ready]);
    const ctx = createContext(adv.client, 'assist');
    const own = sideIds(adv.client.world() as MatchWorld, 0)[0];
    const r = await call(ctx, 'order', { verb: 'attackMove', ids: [own], x: 20, y: 20, sweep: true });
    expect(r.ok).toBe(false);
    expect(body(r).error).toBe('not in this scope');
    expect(String(body(r).detail)).toMatch(/sweep/);
    await room.loop.flush();
    expect(sentBy(room.loop, adv).filter((m) => m.t === 'advisor')).toEqual([]);
  });
  it('the schema offers sweep as a boolean', () => {
    const order = TOOLS.find((t) => t.name === 'order');
    expect((order?.schema.properties as Record<string, unknown>).sweep).toMatchObject({ type: 'boolean' });
  });
});

describe('order in assist scope (case 3)', () => {
  it('sends a proposal to the seat and NO cmd: the room received an advisor message and zero cmds from it', async () => {
    const room = await newRoom();
    const human = join(room.loop, await room.ticket(0), 0);
    const other = join(room.loop, await room.ticket(1), 1);
    const adv = join(room.loop, await room.advisorTicket(0, 'assist'), 0, 'advisor');
    await room.loop.flush();
    await Promise.all([human.client.ready, other.client.ready, adv.client.ready]);
    const ctx = createContext(adv.client, 'assist');
    const own = sideIds(adv.client.world() as MatchWorld, 0)[0];
    const r = await call(ctx, 'order', { verb: 'attackMove', ids: [own], x: 20, y: 20, note: 'push' });
    expect(r.ok).toBe(true);
    expect(body(r)).toEqual({ proposal: 1, status: 'pending' });
    await room.loop.flush();
    const said = sentBy(room.loop, adv);
    expect(said.filter((m) => m.t === 'advisor')).toEqual([
      { t: 'advisor', a: { kind: 'proposal', id: 1, cmd: { kind: 'attackMove', ids: [own], x: 20 * 65536 + 32768, y: 20 * 65536 + 32768 }, note: 'push' } },
    ]);
    expect(said.filter((m) => m.t === 'cmd')).toHaveLength(0);
    // The room relayed it to the seat it advises, and to nobody else.
    expect(heardBy(room.loop, human).filter((m) => m.t === 'advisor')).toHaveLength(1);
    expect(heardBy(room.loop, other).filter((m) => m.t === 'advisor')).toHaveLength(0);
    // The human's accept lands in the inbox and in observe's proposal statuses.
    human.client.transport.advisor({ kind: 'accept', id: 1 });
    await room.loop.flush();
    expect(body(await call(ctx, 'observe')).orders).toEqual([{ proposal: 1, status: 'accepted' }]);
    expect(body(await call(ctx, 'inbox')).lines).toEqual(['human accepted proposal 1']);
    expect(body(await call(ctx, 'inbox')).lines).toEqual([]);
  });
});

/** Every number under an id-naming key, anywhere in a parsed observe. */
function idsIn(v: unknown, under = false, out: number[] = []): number[] {
  if (typeof v === 'number') { if (under) out.push(v); return out; }
  if (Array.isArray(v)) { for (const x of v) idsIn(x, under, out); return out; }
  if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v)) idsIn(x, k === 'id' || k === 'ids' || k === 'target' || k === 'carrier', out);
  }
  return out;
}

describe('observe respects the seat\'s fog (case 4)', () => {
  it('never names an id sideView would not list: no hidden enemy id appears anywhere in the JSON', async () => {
    const { loop, a, c } = await twoSeats();
    const ctx = createContext(a.client, 'command');
    const w = a.client.world() as MatchWorld;
    // An order, so the ledger's ids are in the text too.
    await call(ctx, 'order', { verb: 'halt', ids: sideIds(w, 0).slice(0, 2) });
    await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 30 }));
    const view = a.client.view();
    const listed = new Set([...view.units.map((u) => u.id), ...view.contacts.map((u) => u.id)]);
    const hidden = sideIds(w, 1).filter((id) => !listed.has(id));
    expect(hidden.length).toBeGreaterThan(5);   // the enemy force is in fog at the start
    const text = (await call(ctx, 'observe')).text;
    const named = idsIn(JSON.parse(text));
    expect(named.length).toBeGreaterThan(sideIds(w, 0).length);
    for (const id of named) expect(listed.has(id), `observe named id ${id}`).toBe(true);
    for (const id of hidden) expect(text).not.toMatch(new RegExp(`"id":${id}[,}]`));
  });
});

describe('an order record hides what the seat can no longer see', () => {
  it('a unit that died since the order names its fate (died), and an attack target that left sight reads out of sight', async () => {
    const { loop, a, c } = await twoSeats();
    const ctx = createContext(a.client, 'command');
    await play(loop, 10, [a.client, c.client], () => a.client.tick() >= 5 && c.client.tick() >= 5);
    expect(c.client.tick()).toBe(a.client.tick());
    const sims = [a.client, c.client].map((cl) => (cl.world() as MatchWorld).sim);
    const w = a.client.world() as MatchWorld;
    // The room mints the seed, so pick by state rather than by index: units in
    // the open, on foot or wheels, not inside a building, carrier or tunnel.
    const st = w.sim.state;
    const inOpen = (id: number): boolean => st.garrisonedIn[id] < 0 && st.carriedBy[id] < 0 && st.tunnelIn[id] < 0;
    const [mine, spare] = a.client.view().units.filter((u) => u.flags.every((f) => f === 'idle')).map((u) => u.id);
    const enemy = sideIds(w, 1).filter(inOpen)[0];
    expect([mine, spare, enemy].every((id) => id !== undefined)).toBe(true);
    // The sim's own dev hooks, identically on both machines between the same
    // two frames: an enemy steps onto our unit's own ground, so it is a
    // contact, and nobody's weapons work, so nobody dies of anything but
    // `debugKill` (the room's seed varies, and a point-blank duel with it).
    for (const sim of sims) {
      for (let id = 0; id < sim.entityCount; id++) sim.debugDisableFirepower(id);
      sim.teleport(enemy, sim.state.posX[mine], sim.state.posY[mine]);
    }
    // Fog refreshes every fourth tick (the renderer's cadence): five ticks see it.
    const met = a.client.tick();
    await play(loop, 20, [a.client, c.client], () => a.client.tick() >= met + 5 && c.client.tick() >= met + 5);
    expect(a.client.view().contacts.map((u) => u.id)).toContain(enemy);
    const r = await call(ctx, 'order', { verb: 'attack', ids: [mine, spare], target: enemy });
    expect(r.ok).toBe(true);
    const ref = (body(r) as { ref: number }).ref;
    const record = async (): Promise<Record<string, unknown> | undefined> =>
      (body(await call(ctx, 'observe')).orders as Record<string, unknown>[]).find((o) => o.ref === ref);
    // Control: while both are listed, the record names them.
    expect(await record()).toMatchObject({ ids: [mine, spare], target: enemy });
    expect((await record())?.gone).toBeUndefined();
    // Our second unit dies, and the enemy goes back into the fog at its own camp.
    expect(c.client.tick()).toBe(a.client.tick());
    const camp = a.client.view().enemyCamp;
    for (const sim of sims) {
      sim.debugKill(spare);
      sim.teleport(enemy, fx.from(camp[0] + 0.5), fx.from(camp[1] + 0.5));
    }
    const at = a.client.tick();
    await play(loop, 20, [a.client, c.client], () => a.client.tick() >= at + 5 && c.client.tick() >= at + 5);
    const view = a.client.view();
    expect(w.sim.state.alive[enemy]).toBe(1);
    expect(view.contacts.map((u) => u.id)).not.toContain(enemy);
    const after = await record();
    // The dead unit is OURS, so its id and its fate are the seat's own (the 4 Nov bot report, item 2): `fates`, not a bare `gone`.
    expect(after).toMatchObject({ ids: [mine], fates: [{ id: spare, fate: 'died' }], target: 'out of sight' });
    expect(after).not.toHaveProperty('gone');
    expect(idsIn(after)).toEqual([mine, spare, mine]);   // [mine] from `ids`, [spare] from `fates`, and [mine] again from the dropped attack's `fallback.ids`: all ours; no id-naming key carries the fogged target
    expect(after).toMatchObject({ status: 'dropped', reason: 'target no longer in sight' });
    expect(a.client.transport.stats().desyncTick).toBeNull();
  });
});

describe('wait (case 5)', () => {
  it('resolves on a REAL result before its ticks have run; the sim stops on the deciding hash tick, and the room hears over', async () => {
    const { loop, a, c } = await twoSeats();
    const ctx = createContext(a.client, 'command');
    await play(loop, 30, [a.client, c.client], () => a.client.tick() >= 25 && c.client.tick() >= 25);
    const at = a.client.tick();
    expect(c.client.tick()).toBe(at);
    // Side 1 destroyed through the sim's own debug path, identically on both
    // machines between the same two frames: both reach the same result on
    // the next hash tick, and their hashes still agree.
    for (const cl of [a.client, c.client]) {
      const w = cl.world() as MatchWorld;
      for (const id of sideIds(w, 1)) w.sim.debugKill(id);
    }
    const decidedOn = Math.ceil((at + 1) / 20) * 20 - 1;   // the first hash tick still to run
    const waiting = call(ctx, 'wait', { ticks: 200 });
    // Let frames pile up PAST the deciding tick before anyone runs them.
    for (let i = 0; i < decidedOn - at + 8; i++) await loop.tick();
    expect(a.client.transport.behind()).toBeGreaterThan(decidedOn - at + 2);
    a.client.pump(200);
    c.client.pump(200);
    expect(a.client.tick()).toBe(decidedOn + 1);   // nothing ran past the result
    expect(a.client.result()).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
    expect(c.client.result()).toEqual({ kind: 'won', side: 0, by: 'annihilation' });
    const r = await drive(loop, [a.client, c.client], waiting, 20);
    expect(body(r)).toMatchObject({ reason: 'result', ran: decidedOn + 1 - at, result: 'won (annihilation)' });
    expect(sentBy(loop, a)).toContainEqual({ t: 'over', tick: decidedOn, result: { winner: 0, by: 'annihilation' } });
    expect(sentBy(loop, c)).toContainEqual({ t: 'over', tick: decidedOn, result: { winner: 0, by: 'annihilation' } });
    expect(a.client.transport.stats().desyncTick).toBeNull();
    // An acting tool says the match is over.
    expect(body(await call(ctx, 'order', { verb: 'halt', ids: sideIds(a.client.world() as MatchWorld, 0) })).error).toBe('match over');
  });
});

describe('say (case 6) and inbox', () => {
  it('command scope: say is a room chat, the other seat hears it, and its reply lands in the inbox', async () => {
    const { loop, a, c } = await twoSeats();
    const ctx = createContext(a.client, 'command');
    const r = await call(ctx, 'say', { text: 'good luck' });
    expect(r.ok).toBe(true);
    await loop.flush();
    expect(sentBy(loop, a).filter((m) => m.t === 'chat')).toEqual([{ t: 'chat', text: 'good luck' }]);
    expect(sentBy(loop, a).filter((m) => m.t === 'advisor')).toHaveLength(0);
    expect(heardBy(loop, c)).toContainEqual({ t: 'chat', seat: 0, text: 'good luck' });
    c.client.transport.chat('you too');
    await loop.flush();
    expect(body(await call(ctx, 'inbox')).lines).toEqual(['seat 1: you too']);   // its own line is not an inbox line
  });
  it('advise scope: say is an advisor text, never a chat; the human\'s text and ping land in the inbox', async () => {
    const room = await newRoom();
    const human = join(room.loop, await room.ticket(0), 0);
    const other = join(room.loop, await room.ticket(1), 1);
    const adv = join(room.loop, await room.advisorTicket(0, 'advise'), 0, 'advisor');
    await room.loop.flush();
    await Promise.all([human.client.ready, other.client.ready, adv.client.ready]);
    const ctx = createContext(adv.client, 'advise');
    expect((await call(ctx, 'say', { text: 'armour on the ridge' })).ok).toBe(true);
    await room.loop.flush();
    expect(sentBy(room.loop, adv).filter((m) => m.t === 'advisor')).toEqual([{ t: 'advisor', a: { kind: 'text', text: 'armour on the ridge' } }]);
    expect(sentBy(room.loop, adv).filter((m) => m.t === 'chat')).toHaveLength(0);
    expect(heardBy(room.loop, human)).toContainEqual({ t: 'advisor', from: 'advisor', a: { kind: 'text', text: 'armour on the ridge' } });
    expect(body(await call(ctx, 'ping', { x: 300, y: 2 })).error).toBe('off the map');
    human.client.transport.advisor({ kind: 'text', text: 'watch the saddle' });
    human.client.transport.advisor({ kind: 'ping', x: 10, y: 12 });
    await room.loop.flush();
    expect(body(await call(ctx, 'inbox')).lines).toEqual(['human: watch the saddle', 'human pinged tile (10, 12)']);
  });
});

describe('status', () => {
  it('reports the tick, the transport, the pace and no round in a realtime room; end_round is refused there', async () => {
    const { a } = await twoSeats();
    const ctx = createContext(a.client, 'command');
    const s = body(await call(ctx, 'status'));
    expect(s).toMatchObject({ tick: 0, clock: '00:00', pace: { kind: 'realtime' }, round: null, result: null, seat: 0, scope: 'command' });
    expect(body(await call(ctx, 'end_round')).error).toBe('not a paced room');
  });
});

describe('a paced room and end_round (the done ruling)', () => {
  const PACE = { kind: 'paced', roundTicks: 20, roundWallMs: 5000 } as const;
  /** Seat 0 is a human-kind client the room never waits for; seat 1 is the bot. */
  async function pacedMatch(modelEndsRounds: boolean): Promise<{ frames: number; gapMs: number; refusedMidRound: boolean }> {
    const room = await newRoom({ pace: PACE, guest: 'bot' });
    const human = join(room.loop, await room.ticket(0), 0);
    const bot = join(room.loop, await room.ticket(1), 1);
    await room.loop.flush();
    const config = await bot.client.ready;
    expect(config.pace).toEqual(PACE);
    expect(config.seats[1].kind).toBe('bot');
    const ctx = createContext(bot.client, 'command');
    let refusedMidRound = false;
    const minted = (tick: number): boolean => heardBy(room.loop, human).some((m) => m.t === 'frame' && m.tick === tick);
    let at19: number | null = null;
    let at20: number | null = null;
    for (let i = 0; i < 200; i++) {
      await room.loop.tick();
      human.client.pump(10);
      bot.client.pump(10);
      if (modelEndsRounds) {
        const r = await call(ctx, 'end_round');
        if (!r.ok && bot.client.tick() % 20 !== 0) refusedMidRound ||= body(r).error === 'round not finished';
      }
      await room.loop.flush();
      if (at19 === null && minted(19)) at19 = Date.now();
      if (at20 === null && minted(20)) at20 = Date.now();
    }
    expect(at19).not.toBeNull();
    expect(at20).not.toBeNull();
    return { frames: human.client.tick(), gapMs: (at20 ?? 0) - (at19 ?? 0), refusedMidRound };
  }
  it('a model that ends each round after running its last frame keeps the room flowing', async () => {
    const r = await pacedMatch(true);
    expect(r.refusedMidRound).toBe(true);
    expect(r.gapMs).toBeLessThan(300);
    expect(r.frames).toBeGreaterThan(170);
  });
  it('a model that never ends a round is released only after roundWallMs', async () => {
    const r = await pacedMatch(false);
    expect(r.gapMs).toBeGreaterThanOrEqual(PACE.roundWallMs);
    expect(r.gapMs).toBeLessThan(PACE.roundWallMs + 300);
    expect(r.frames).toBeLessThan(60);
  });
  it('wait returns when the room is waiting on this seat\'s end_round, and end_round answers the round it closed', async () => {
    const room = await newRoom({ pace: PACE, guest: 'bot' });
    const human = join(room.loop, await room.ticket(0), 0);
    const bot = join(room.loop, await room.ticket(1), 1);
    await room.loop.flush();
    await bot.client.ready;
    const ctx = createContext(bot.client, 'command');
    expect(body(await call(ctx, 'end_round')).error).toBe('round not finished');
    const w = await drive(room.loop, [human.client, bot.client], call(ctx, 'wait', { ticks: 100 }));
    expect(body(w)).toMatchObject({ reason: 'round', tick: 20 });
    expect(body(await call(ctx, 'status')).round).toMatchObject({ index: 1, ticks: 20, awaitingEndRound: true });
    const e = await call(ctx, 'end_round');
    expect(body(e)).toEqual({ round: 0, done: true });
    await room.loop.flush();
    expect(sentBy(room.loop, bot)).toContainEqual({ t: 'done', round: 0 });
    expect(body(await call(ctx, 'end_round')).error).toBe('round not finished');
  });
});

describe('a paced round the room released on wall time', () => {
  // The room's own config buffers 2 frames, which hides a mid-round client
  // from "every frame received has run" in steady flow; with no buffer it is
  // reached on every frame, so the round test cannot lean on `behind()`.
  it('mid-round with every received frame run, wait answers ticks and status does not claim the room waits on this seat', async () => {
    const PACE = { kind: 'paced', roundTicks: 20, roundWallMs: 5000 } as const;
    const config = { ...versusConfig(ROOM_MAP, { pace: PACE, kinds: ['human', 'bot'] }), bufferTicks: 0 };
    let onmessage: ((e: { data: string }) => void) | null = null;
    const sock: SocketLike = {
      onopen: null, onclose: null, send: () => {}, close: () => {},
      get onmessage() { return onmessage; },
      set onmessage(f) { onmessage = f; },
    };
    const recv = (m: unknown): void => { onmessage?.({ data: JSON.stringify(m) }); };
    const client = new AgentClient({ server: 'https://room.test', code: ROOM_CODE, ticket: 't', build: ROOM_BUILD, role: 'seat', seat: 1, log: () => {}, open: () => sock });
    sock.onopen?.({});
    recv({ t: 'lobby', config: null, you: 1, map: ROOM_MAP, seats: [{ seat: 0, callsign: 'c0', connected: true, ready: true }, { seat: 1, callsign: 'c1', connected: true, ready: false }] });
    recv({ t: 'start', config });
    await client.ready;
    const ctx = createContext(client, 'command');
    // Round 0 is never ended: the room released it on wall time and round 1 is under way.
    for (let tick = 0; tick < 25; tick++) recv({ t: 'frame', tick, cmds: [] });
    client.pump(40);
    expect(client.tick()).toBe(25);
    expect(client.transport.behind()).toBe(0);
    expect(body(await call(ctx, 'status')).round).toMatchObject({ index: 1, finished: 0, awaitingEndRound: false });
    const waiting = call(ctx, 'wait', { ticks: 3 });
    for (let tick = 25; tick < 28; tick++) recv({ t: 'frame', tick, cmds: [] });
    client.pump(40);
    await vi.advanceTimersByTimeAsync(50);
    expect(body(await waiting)).toMatchObject({ reason: 'ticks', ran: 3, tick: 28 });
    // At the round's boundary the room does wait on it.
    for (let tick = 28; tick < 40; tick++) recv({ t: 'frame', tick, cmds: [] });
    client.pump(40);
    expect(body(await call(ctx, 'status')).round).toMatchObject({ index: 2, finished: 1, awaitingEndRound: true });
    expect(body(await call(ctx, 'wait', { ticks: 10 }))).toMatchObject({ reason: 'round', tick: 40 });
  });
});

describe('a view before the start', () => {
  it('observe answers that the match has not started', async () => {
    const room = await newRoom();
    const a = join(room.loop, await room.ticket(0), 0);
    const r = await call(createContext(a.client, 'command'), 'observe');
    expect(r.ok).toBe(false);
    expect(body(r).error).toBe('match not started');
  });
});

// GH-973 item 5: an `attack` the sim refuses for every shooter (the enemy left sight, or was never identified)
// changes nothing, and is shown `dropped` with the reason, not `applied`.
describe('an attack on a target the sim will not take (GH-973)', () => {
  it('shows dropped with a reason in observe, while a plain move beside it is applied', async () => {
    const { loop, a, c } = await twoSeats();
    const ctx = createContext(a.client, 'command');
    const w = a.client.world() as MatchWorld;
    const own = sideIds(w, 0)[0];
    const enemy = sideIds(w, 1)[0];   // at its own camp: nowhere near identified
    // Straight to the desk: the `order` tool would refuse a target that is not a contact NOW, and the case is one that stopped
    // being one between the model's order and the frame that carried it.
    const atk = a.client.desk.submit({ kind: 'attack', ids: [own], target: enemy }, a.client.tick()) as { ref: number };
    const mv = a.client.desk.submit({ kind: 'move', ids: [own], x: fx.from(12.5), y: fx.from(14.5) }, a.client.tick()) as { ref: number };
    await drive(loop, [a.client, c.client], call(ctx, 'wait', { ticks: 60 }));
    const orders = body(await call(ctx, 'observe')).orders as { ref: number; status: string; reason?: string }[];
    const got = (ref: number) => orders.find((o) => o.ref === ref);
    expect(got(atk.ref)?.status).toBe('dropped');
    expect(got(atk.ref)?.reason).toMatch(/not in sight/);
    expect(got(mv.ref)?.status).toBe('applied');
    expect(got(mv.ref)?.reason).toBeUndefined();
  });
});
