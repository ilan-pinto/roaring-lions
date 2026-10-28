// GH-859 P1a Task 4: the formation ORDER. Template slots, the group table, arrival facing and
// stance, the ring springing together, and every way out. Every world is hand-built and every
// expectation is a literal (casebook: "the oracle imported its arguments").
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import type { FormationJson } from './formation-template';
import { RIFLES, SHED, TANK } from './golden-worlds.test-helper';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const loadFormation = (id: string): FormationJson => JSON.parse(readFileSync(join(ROOT, 'data', 'formations', `${id}.json`), 'utf8')) as FormationJson;

// ---- unit types ---------------------------------------------------------------------------
const MBT: UnitTypeJson = { ...TANK, id: 'fg_mbt', role: 'mbt', mobility: { speed_tiles_s: 1.1, turn_rate_deg_s: 60 } };
const MORTAR: UnitTypeJson = { ...RIFLES, id: 'fg_mortar', role: 'artillery' };
const JEEP: UnitTypeJson = {
  id: 'fg_jeep',
  role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};
/** An unarmed enemy: it springs a trap and draws fire, and it shoots at nobody. */
const DUMMY: UnitTypeJson = { ...RIFLES, id: 'fg_dummy', weapons: [], abilities: [], hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } } };
/** A medic by class: it carries the wounded (this registers the wound block, which is fine here). */
const MEDIC: UnitTypeJson = { ...RIFLES, id: 'fg_medic', weapons: [], hull: { hp: 200, armor: { front: 10, side: 10, rear: 10 }, can_carry: ['wounded'] } };
/** An aircraft by class. */
const AIR: UnitTypeJson = {
  id: 'fg_air',
  hull: { hp: 100, armor: { front: 5, side: 5, rear: 5 } },
  mobility: { domain: 'air', speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
  weapons: [],
};
/** Class none: the civilian faction. */
const CIVIL: UnitTypeJson = { ...RIFLES, id: 'fg_civil', faction: 'civilian' };

interface World {
  sim: Sim;
  mbt: number;
  inf: number;
  mor: number;
  jeep: number;
  dummy: number;
  civil: number;
  events: SimEvent[];
}
function world(opts: { w?: number; h?: number; register?: boolean; cap?: number } = {}): World {
  const sim = new Sim({ seed: 0x859, width: opts.w ?? 48, height: opts.h ?? 48, capacity: opts.cap ?? 128 });
  const w: World = {
    sim,
    mbt: sim.addUnitType(MBT),
    inf: sim.addUnitType(RIFLES),
    mor: sim.addUnitType(MORTAR),
    jeep: sim.addUnitType(JEEP),
    dummy: sim.addUnitType(DUMMY),
    civil: sim.addUnitType(CIVIL),
    events: [],
  };
  if (opts.register !== false) for (const id of ['column', 'attack', 'ambush']) sim.addFormationType(loadFormation(id));
  return w;
}
const at = (n: number): number => fx.from(n + 0.5);
function spawnAt(w: World, type: number, side: number, x: number, y: number, facing = 0): number {
  return w.sim.spawn(type, side, at(x), at(y), facing);
}
function tick(w: World, n = 1): void {
  for (let i = 0; i < n; i++) for (const e of w.sim.tick()) w.events.push(e);
}
function kinds(w: World, kind: string): SimEvent[] {
  return w.events.filter((e) => e.kind === kind);
}

/** The private columns a test reads (the formation-state tests reach them the same way). */
interface Priv {
  goalX: Int32Array;
  goalY: Int32Array;
  restFacing: Uint16Array;
  fmArrive: Uint8Array;
  fmLive: boolean;
  fgPending: Uint8Array;
  attackMove: Uint8Array;
}
const priv = (sim: Sim): Priv => sim as unknown as Priv;
const goalTile = (sim: Sim, id: number): [number, number] => [priv(sim).goalX[id] >> 16, priv(sim).goalY[id] >> 16];
const goals = (sim: Sim, ids: number[]): [number, number][] => ids.map((id) => goalTile(sim, id));

/** Six units standing as one stack at (24, 40) - the approach is from the south, so forward is -y and
 *  a slot at frame (f, l) is the tile (24 + l, 24 - f). The click is (24, 24). */
function southStack(w: World, types: number[]): number[] {
  return types.map((t) => spawnAt(w, t, 0, 24, 40));
}
const order = (w: World, ids: number[], formation: string | undefined, kind: 'move' | 'attackMove' = 'move', over: Record<string, unknown> = {}): void => {
  w.sim.queueCommand({ kind, ids, x: at(24), y: at(24), ...(formation === undefined ? {} : { formation }), ...over } as never);
};

// ---------------------------------------------------------------------------------------------
describe('byte identity: an order without a formation is today\'s order', () => {
  /** The same little skirmish, scripted, hashed every 50 ticks. */
  function run(register: boolean, field: string | undefined): number[] {
    const w = world({ register });
    const west = [0, 1, 2, 3].map((k) => spawnAt(w, w.inf, 0, 6, 10 + 3 * k));
    const west2 = [spawnAt(w, w.mbt, 0, 4, 20), spawnAt(w, w.mbt, 0, 4, 26)];
    const east = [0, 1, 2].map((k) => spawnAt(w, w.inf, 1, 40, 12 + 4 * k));
    const f = field === undefined ? {} : { formation: field };
    const out: number[] = [];
    for (let t = 0; t < 300; t++) {
      if (t === 5) w.sim.queueCommand({ kind: 'move', ids: west, x: at(20), y: at(18), ...f });
      if (t === 10) w.sim.queueCommand({ kind: 'attackMove', ids: [...west2, ...west], x: at(30), y: at(22), ...f });
      if (t === 60) w.sim.queueCommand({ kind: 'attackMove', ids: east, x: at(12), y: at(20), ...f });
      if (t === 120) w.sim.queueCommand({ kind: 'move', ids: west2, x: at(26), y: at(26), append: true, ...f });
      tick(w);
      if (t % 50 === 49) out.push(w.sim.hash());
    }
    return out;
  }
  it('three formations REGISTERED change nothing for orders that name none', () => {
    const plain = run(false, undefined);
    expect(plain).toHaveLength(6);
    expect(run(true, undefined)).toEqual(plain);
  });
  it('a formation id the world does not hold is the same order as none at all', () => {
    expect(run(true, 'nosuch')).toEqual(run(false, undefined));
  });
});

// ---------------------------------------------------------------------------------------------
describe('shape: a six-unit order lands on the template\'s literal tiles', () => {
  it('Column: armour (0,0) (-1,+2) (-3,0), infantry from row -5, facing north', () => {
    const w = world();
    const ids = southStack(w, [w.mbt, w.mbt, w.mbt, w.inf, w.inf, w.inf]);
    order(w, ids, 'column');
    tick(w);
    expect(goals(w.sim, ids)).toEqual([[24, 24], [26, 25], [24, 27], [24, 29], [26, 29], [24, 30]]);
    for (const id of ids) {
      expect(w.sim.formationGroupOf(id), `id ${id}`).toBe(0);
      expect(priv(w.sim).restFacing[id], `id ${id}`).toBe(49152);
    }
    expect(w.sim.formationMembersOfGroup(0)).toBe(6);
    expect(w.sim.formationTypeOfGroup(0)).toBe(0); // column is the first registered
    expect(w.sim.formationStateOfGroup(0)).toBe(1); // marching
  });
  it('Attack: armour abreast on the click row, infantry 2 behind, facing the approach', () => {
    const w = world();
    const ids = southStack(w, [w.mbt, w.mbt, w.inf, w.inf, w.inf]);
    order(w, ids, 'attack', 'attackMove');
    tick(w);
    expect(goals(w.sim, ids)).toEqual([[24, 24], [26, 24], [24, 26], [25, 26], [23, 26]]);
    for (const id of ids) expect(priv(w.sim).restFacing[id], `id ${id}`).toBe(49152);
    expect(w.sim.formationTypeOfGroup(w.sim.formationGroupOf(ids[0]))).toBe(1);
  });
  it('Ambush: a radius-3 ring, the two armour on opposite halves, each facing the click', () => {
    const w = world();
    const ids = southStack(w, [w.mbt, w.mbt, w.mor, w.inf, w.inf, w.inf]);
    order(w, ids, 'ambush');
    tick(w);
    expect(goals(w.sim, ids)).toEqual([[24, 21], [22, 26], [27, 25], [26, 22], [21, 23], [24, 27]]);
    // inward, an eighth-turn per slot: (24,21) looks south 16384, (22,26) north-east 57344, (27,25) west 32768,
    // (26,22) south-west 24576, (21,23) east 0, (24,27) north 49152
    expect(ids.map((id) => priv(w.sim).restFacing[id])).toEqual([16384, 57344, 32768, 24576, 0, 49152]);
    expect(ids.map((id) => priv(w.sim).fmArrive[id])).toEqual([19, 19, 19, 19, 19, 19]); // 16 + radius 3
  });
});

// ---------------------------------------------------------------------------------------------
describe('plain fallbacks: the template branch is not entered, and the order is today\'s', () => {
  /** Orders three infantry plainly and returns their goals. */
  function plainGoals(): [number, number][] {
    const w = world();
    const ids = [0, 1, 2].map(() => spawnAt(w, w.inf, 0, 24, 40));
    order(w, ids, undefined);
    tick(w);
    return goals(w.sim, ids);
  }
  it('has a reference that is a real spread, not one tile', () => {
    const g = plainGoals();
    expect(new Set(g.map(([x, y]) => `${x},${y}`)).size).toBe(3);
  });
  const cases: { name: string; build: (w: World) => { ids: number[]; formation: string; kind: 'move' | 'attackMove'; over: Record<string, unknown> } }[] = [
    {
      name: 'an attackMove naming a move formation',
      build: (w) => ({ ids: [0, 1, 2].map(() => spawnAt(w, w.inf, 0, 24, 40)), formation: 'column', kind: 'attackMove', over: {} }),
    },
    {
      name: 'a move naming an attackMove formation',
      build: (w) => ({ ids: [0, 1, 2].map(() => spawnAt(w, w.inf, 0, 24, 40)), formation: 'attack', kind: 'move', over: {} }),
    },
    {
      name: 'an exact order',
      build: (w) => ({ ids: [0, 1, 2].map(() => spawnAt(w, w.inf, 0, 24, 40)), formation: 'column', kind: 'move', over: { exact: true } }),
    },
  ];
  for (const c of cases) {
    it(`${c.name} gives no group and no template`, () => {
      const w = world();
      const { ids, formation, kind, over } = c.build(w);
      order(w, ids, formation, kind, over);
      tick(w);
      for (const id of ids) expect(w.sim.formationGroupOf(id), `id ${id}`).toBe(-1);
      expect(priv(w.sim).fmLive).toBe(false);
      if (over.exact !== true) {
        // the same ids ordered plainly land on the same tiles
        const ref = world();
        const rids = [0, 1, 2].map(() => spawnAt(ref, ref.inf, 0, 24, 40));
        order(ref, rids, undefined, kind);
        tick(ref);
        expect(goals(w.sim, ids)).toEqual(goals(ref.sim, rids));
      } else {
        for (const id of ids) expect(goalTile(w.sim, id), `id ${id}`).toEqual([24, 24]);
      }
    });
  }
  it('one placeable unit plus one passenger is below min_members (2): today\'s order', () => {
    const w = world();
    const lone = spawnAt(w, w.inf, 0, 24, 40);
    const rider = spawnAt(w, w.inf, 0, 24, 40);
    const jeep = spawnAt(w, w.jeep, 0, 24, 40);
    w.sim.queueCommand({ kind: 'load', ids: [rider], carrier: jeep });
    tick(w, 80);
    expect(w.sim.state.carriedBy[rider]).toBe(jeep);
    order(w, [lone, rider], 'column');
    tick(w);
    expect(w.sim.formationGroupOf(lone)).toBe(-1);
    expect(w.sim.formationGroupOf(rider)).toBe(-1);
    expect(priv(w.sim).fmLive).toBe(false);
    expect(goalTile(w.sim, lone)).toEqual([24, 24]);
  });
  it('side 2 is never placed: a plain order', () => {
    const w = world();
    const ids = [0, 1, 2].map(() => w.sim.spawn(w.inf, 2, at(24), at(40)));
    order(w, ids, 'column');
    tick(w);
    for (const id of ids) expect(w.sim.formationGroupOf(id)).toBe(-1);
    expect(priv(w.sim).fmLive).toBe(false);
  });
});

describe('a side-2 unit named beside placeable ones is not placed', () => {
  it('two riflemen and a side-2 rifleman: the pair forms, the stray keeps its place', () => {
    const w = world();
    const a = spawnAt(w, w.inf, 0, 24, 40);
    const b = spawnAt(w, w.inf, 0, 24, 40);
    const stray = w.sim.spawn(w.inf, 2, at(10), at(10));
    order(w, [a, b, stray], 'column');
    tick(w);
    expect(w.sim.formationMembersOfGroup(0)).toBe(2);
    expect(w.sim.formationGroupOf(stray)).toBe(-1);
    expect(goalTile(w.sim, stray)).toEqual([0, 0]);
  });
});

describe('class none ignores the formation order', () => {
  it('a civilian named with two riflemen keeps its place: no slot, no write, no group', () => {
    const w = world();
    const a = spawnAt(w, w.inf, 0, 24, 40);
    const b = spawnAt(w, w.inf, 0, 24, 40);
    const civ = spawnAt(w, w.civil, 0, 10, 10);
    order(w, [a, b, civ], 'column');
    tick(w);
    expect(w.sim.formationGroupOf(a)).toBe(0);
    expect(w.sim.formationGroupOf(b)).toBe(0);
    expect(w.sim.formationGroupOf(civ)).toBe(-1);
    expect(w.sim.formationMembersOfGroup(0)).toBe(2);
    expect(w.sim.state.moving[civ]).toBe(0);
    expect(goalTile(w.sim, civ)).toEqual([0, 0]); // never written
  });
});

// ---------------------------------------------------------------------------------------------
describe('rest facing', () => {
  const turnTicks = (w: World, type: number, turns: number): number => Math.ceil((65536 * turns) / w.sim.unitTypes[type].turnPerTick);

  it('an Attack hull already on its slot swings to the front once it has stopped, and not before', () => {
    const w = world();
    // The Lavi stands on its slot facing north; the order comes from the west, so the front is +x (0).
    const a = w.sim.spawn(w.mbt, 0, at(24), at(24), 49152);
    const b = spawnAt(w, w.mbt, 0, 4, 24);
    order(w, [a, b], 'attack', 'attackMove');
    tick(w, 3);
    expect(goalTile(w.sim, a)).toEqual([24, 24]);
    expect(w.sim.state.facing[a], 'still swinging after 3 ticks').not.toBe(0);
    expect(priv(w.sim).restFacing[a]).toBe(0);
    tick(w, turnTicks(w, w.mbt, 1) + 4);
    expect(w.sim.state.facing[a]).toBe(0);
  });

  it('an Ambush hull ends facing inward: the literal eighth, not the way it walked', () => {
    const w = world();
    const ids = southStack(w, [w.mbt, w.mbt, w.mor, w.inf, w.inf, w.inf]);
    order(w, ids, 'ambush');
    tick(w, 600);
    expect(ids.map((id) => w.sim.state.moving[id])).toEqual([0, 0, 0, 0, 0, 0]);
    // Walking north to (24,21) it would arrive facing 49152; inward is south, 16384.
    expect(ids.map((id) => w.sim.state.facing[id])).toEqual([16384, 57344, 32768, 24576, 0, 49152]);
  });

  it('with a target in range the hull turns to it, and when it is dead it returns to its rest facing', () => {
    const w = world();
    const a = w.sim.spawn(w.mbt, 0, at(24), at(24), 0);
    const b = w.sim.spawn(w.mbt, 0, at(24), at(26), 0);
    order(w, [a, b], 'attack', 'attackMove', {}); // click (24,24) from (24,25): front = north (49152)
    tick(w, 100);
    expect(w.sim.state.facing[a]).toBe(49152);
    const foe = spawnAt(w, w.dummy, 1, 30, 24); // due east of A
    let engaged = -1;
    for (let t = 0; t < 120 && engaged < 0; t++) {
      tick(w);
      if (w.sim.state.curTarget[a] === foe) engaged = t;
    }
    expect(engaged, 'A engages the foe').toBeGreaterThanOrEqual(0);
    tick(w, 120);
    expect(w.sim.state.curTarget[a]).toBe(foe);
    // the target wins: east is 0, rest is north 49152; the hull sits on the target
    expect(w.sim.state.facing[a]).toBe(0);
    w.sim.debugKill(foe);
    tick(w, turnTicks(w, w.mbt, 1) + 6);
    expect(w.sim.state.curTarget[a]).toBe(-1);
    expect(w.sim.state.facing[a]).toBe(49152);
  });

  it('a later order clears the rest facing, so the hull is not pulled back to it', () => {
    const w = world();
    const a = w.sim.spawn(w.mbt, 0, at(24), at(24), 49152);
    const b = spawnAt(w, w.mbt, 0, 4, 24);
    order(w, [a, b], 'attack', 'attackMove');
    tick(w, 2);
    expect(priv(w.sim).restFacing[a]).toBe(0);
    w.sim.queueCommand({ kind: 'move', ids: [a], x: at(24), y: at(30) });
    tick(w, 1);
    expect(priv(w.sim).restFacing[a]).toBe(0xffff);
    expect(w.sim.formationGroupOf(a)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------------------------
// The ring: six members (ids 0..5) on the literal tiles, mbt mbt mortar inf inf inf.
const RING_TYPES = (w: World): number[] => [w.mbt, w.mbt, w.mor, w.inf, w.inf, w.inf];
/** R = 3 -> the ambush radius is 3 tiles, squared in Q16.16: 9.0 = 589824. */
const R3_SQ = 589824;

function ringWorld(): { w: World; ids: number[] } {
  const w = world();
  const ids = southStack(w, RING_TYPES(w));
  order(w, ids, 'ambush');
  return { w, ids };
}
/** Tick until every ring member has stopped (bounded), so the stance has been set. */
function settle(w: World, ids: number[]): void {
  tick(w); // the order is queued: it is applied at the top of the first tick
  for (let t = 0; t < 700 && ids.some((id) => w.sim.state.moving[id] === 1); t++) tick(w);
  tick(w, 70); // the longest swing of a hull to its inward facing
}

describe('arrival stance', () => {
  it('an ambush member reads the ring radius squared once it has stopped, and nothing while it walks', () => {
    const { w, ids } = ringWorld();
    tick(w, 5);
    expect(ids.map((id) => w.sim.ambushRadiusSqOf(id))).toEqual([0, 0, 0, 0, 0, 0]);
    settle(w, ids);
    expect(ids.map((id) => w.sim.state.moving[id])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(ids.map((id) => w.sim.ambushRadiusSqOf(id))).toEqual([R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ]);
    expect(ids.map((id) => priv(w.sim).fmArrive[id])).toEqual([0, 0, 0, 0, 0, 0]); // one-shot
  });
  it('a ring that sprang before a straggler arrived sets no stance on arrival', () => {
    const { w, ids } = ringWorld();
    tick(w, 5);
    // an enemy rifleman fires on the mortar (id 2) while the ring is still walking: found out
    const foe = spawnAt(w, w.inf, 1, 40, 40);
    w.sim.debugSplash(w.sim.state.posX[ids[2]], w.sim.state.posY[ids[2]], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    tick(w, 2);
    expect(w.sim.formationStateOfGroup(0)).toBe(4);
    settle(w, ids);
    expect(ids.map((id) => w.sim.ambushRadiusSqOf(id))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(ids.map((id) => w.sim.state.moving[id])).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it('only the ring is set: a medic and an aircraft in an Ambush order stand where placed with no stance', () => {
    const w = world();
    const medic = w.sim.addUnitType(MEDIC);
    const air = w.sim.addUnitType(AIR);
    const ring = [w.mor, w.inf, w.inf].map((t) => spawnAt(w, t, 0, 24, 40));
    const extra = [spawnAt(w, medic, 0, 24, 40), spawnAt(w, air, 0, 24, 40)];
    order(w, [...ring, ...extra], 'ambush');
    tick(w);
    expect(ring.map((id) => priv(w.sim).fmArrive[id])).toEqual([19, 19, 19]); // 3 ring members: radius 3
    expect(extra.map((id) => priv(w.sim).fmArrive[id])).toEqual([0, 0]);
    // the aircraft has no rest facing at all; the medic faces the way it marches (north), not inward
    expect(extra.map((id) => priv(w.sim).restFacing[id])).toEqual([49152, 0xffff]);
    expect(w.sim.formationMembersOfGroup(0)).toBe(5);
    for (let t = 0; t < 700 && [...ring, ...extra].some((id) => w.sim.state.moving[id] === 1); t++) tick(w);
    tick(w, 70);
    expect(ring.map((id) => w.sim.ambushRadiusSqOf(id))).toEqual([R3_SQ, R3_SQ, R3_SQ]);
    expect(extra.map((id) => w.sim.ambushRadiusSqOf(id))).toEqual([0, 0]);
  });
});

describe('a hold arrival', () => {
  it('halts the unit as a halt order does, once, and sets no ambush', () => {
    // No shipped file holds; this is `attack` with arrival.stance "hold".
    const hold = { ...loadFormation('attack'), id: 'hold', arrival: { face: 'front', stance: 'hold' } };
    const run = (stance: boolean): { latch: number; arrive: number } => {
      const w = world({ register: false });
      w.sim.addFormationType(stance ? hold : loadFormation('attack'));
      const ids = [0, 1].map(() => spawnAt(w, w.inf, 0, 24, 40));
      order(w, ids, stance ? 'hold' : 'attack', 'attackMove');
      tick(w);
      const arrive = priv(w.sim).fmArrive[ids[0]];
      for (let t = 0; t < 400 && ids.some((id) => w.sim.state.moving[id] === 1); t++) tick(w);
      expect(ids.map((id) => w.sim.ambushRadiusSqOf(id))).toEqual([0, 0]);
      return { latch: priv(w.sim).attackMove[ids[0]], arrive };
    };
    // a plain attack-mover keeps its attack-move latch on arrival; a held one has it cleared by the halt
    expect(run(false)).toEqual({ latch: 1, arrive: 0 });
    expect(run(true)).toEqual({ latch: 0, arrive: 1 });
  });
});

describe('the ring springs together', () => {
  /** A ring settled and armed, and an unarmed enemy walking in from the north. */
  function armed(): { w: World; ids: number[]; foe: number } {
    const { w, ids } = ringWorld();
    settle(w, ids);
    const foe = spawnAt(w, w.dummy, 1, 24, 3);
    w.sim.queueCommand({ kind: 'move', ids: [foe], x: at(24), y: at(19) });
    return { w, ids, foe };
  }
  it('one enemy walks into one member\'s radius: every member\'s stance is 0 by the next tick, and one event', () => {
    const { w, ids } = armed();
    expect(ids.map((id) => w.sim.ambushRadiusSqOf(id))).toEqual([R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ]);
    let sprung = -1;
    for (let t = 0; t < 400 && sprung < 0; t++) {
      tick(w);
      if (kinds(w, 'ambushSprung').length > 0) sprung = w.sim.tickCount;
    }
    expect(sprung, 'the trap springs').toBeGreaterThan(0);
    // only the north member (id 0, tile (24,21)) was in anyone's radius: it is the springer
    expect((kinds(w, 'ambushSprung')[0] as { entity: number }).entity).toBe(0);
    tick(w, 1);
    expect(ids.map((id) => w.sim.ambushRadiusSqOf(id))).toEqual([0, 0, 0, 0, 0, 0]);
    const sp = kinds(w, 'formationSprung');
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ kind: 'formationSprung', side: 0, group: 0, entity: 0 });
    expect(w.sim.formationStateOfGroup(0)).toBe(4);
    tick(w, 200);
    expect(kinds(w, 'formationSprung')).toHaveLength(1); // once in a group's life
  });
  it('the springer was alone in its radius: the far side of the ring was still armed the tick before', () => {
    const { w, ids } = armed();
    let prior: number[] = [];
    for (let t = 0; t < 400; t++) {
      const before = ids.map((id) => w.sim.ambushRadiusSqOf(id));
      tick(w);
      if (kinds(w, 'ambushSprung').length > 0) {
        prior = before;
        break;
      }
    }
    expect(prior).toEqual([R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ]);
  });
  it('hostile fire on a member springs the ring; friendly splash does not', () => {
    const friendly = ringWorld();
    settle(friendly.w, friendly.ids);
    const mate = spawnAt(friendly.w, friendly.w.inf, 0, 5, 5);
    const m3 = friendly.ids[3];
    friendly.w.sim.debugSplash(friendly.w.sim.state.posX[m3], friendly.w.sim.state.posY[m3], fx.fromInt(1), 0, fx.from(0.2), mate, -1);
    tick(friendly.w, 6);
    expect(friendly.ids.map((id) => friendly.w.sim.ambushRadiusSqOf(id))).toEqual([R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ]);
    expect(friendly.w.sim.formationStateOfGroup(0)).toBe(1);
    expect(priv(friendly.w.sim).fgPending[0]).toBe(0);
    expect(kinds(friendly.w, 'formationSprung')).toHaveLength(0);

    const hostile = ringWorld();
    settle(hostile.w, hostile.ids);
    const foe = spawnAt(hostile.w, hostile.w.inf, 1, 44, 44);
    const h3 = hostile.ids[3];
    hostile.w.sim.debugSplash(hostile.w.sim.state.posX[h3], hostile.w.sim.state.posY[h3], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    tick(hostile.w, 2);
    expect(hostile.ids.map((id) => hostile.w.sim.ambushRadiusSqOf(id))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(hostile.w.sim.formationStateOfGroup(0)).toBe(4);
    const sp = kinds(hostile.w, 'formationSprung');
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ side: 0, group: 0, entity: h3 });
  });
  it('a ring found by an enemy ROUND inside tick() opens fire one tick after the hit, not two', () => {
    const { w, ids } = ringWorld();
    settle(w, ids);
    // An armed rifleman at (33, 26): 6 tiles from the nearest member at (27, 25), too far for a
    // radius-3 trap and inside his own range 8, so his rounds find the ring and nothing else does.
    spawnAt(w, w.inf, 1, 33, 26);
    const ringSet = new Set(ids);
    let hit = -1;
    for (let t = 0; t < 300 && hit < 0; t++) {
      tick(w);
      if (kinds(w, 'formationSprung').length > 0) hit = w.sim.tickCount;
    }
    expect(hit, 'the foe found the ring').toBeGreaterThan(0);
    expect(kinds(w, 'ambushSprung'), 'no radius spring: the fire did it').toHaveLength(0);
    expect(kinds(w, 'formationSprung')[0]).toMatchObject({ side: 0, group: 0 });
    expect(ringSet.has((kinds(w, 'formationSprung')[0] as { entity: number }).entity)).toBe(true);
    // The hit tick is T. Every member still holds its stance at the end of T (the mark is set, not acted on).
    const armedAfterT = ids.filter((id) => w.sim.ambushRadiusSqOf(id) !== 0).length;
    expect(armedAfterT).toBeGreaterThan(0);
    const before = w.events.length;
    tick(w); // T + 1
    // The spring ran BEFORE T+1's combat: every stance is clear at the end of T+1, and members that see
    // the foe have fired DURING T+1 (their stance was clear when stepCombat read it).
    expect(ids.map((id) => w.sim.ambushRadiusSqOf(id))).toEqual([0, 0, 0, 0, 0, 0]);
    const fired = w.events.slice(before).filter((e) => e.kind === 'fire' && ringSet.has((e as { shooter: number }).shooter));
    expect(fired.length, 'a ring member fires on the tick after it was found').toBeGreaterThan(0);
    // event ticks are the index of the tick that pushed them: T + 1 is index `hit` (tickCount after T)
    expect(fired.every((e) => (e as { tick: number }).tick === hit)).toBe(true);
  });
  it('a ring found out while still forming springs too', () => {
    const { w, ids } = ringWorld();
    tick(w, 3);
    const foe = spawnAt(w, w.inf, 1, 44, 44);
    w.sim.debugSplash(w.sim.state.posX[ids[4]], w.sim.state.posY[ids[4]], fx.fromInt(1), 0, fx.from(0.2), foe, -1);
    tick(w, 2);
    expect(w.sim.formationStateOfGroup(0)).toBe(4);
    expect(kinds(w, 'formationSprung')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('membership and exits', () => {
  /** Three riflemen in a Column on side 0: group row 0. */
  function column3(): { w: World; ids: number[] } {
    const w = world();
    const ids = [0, 1, 2].map(() => spawnAt(w, w.inf, 0, 24, 40));
    order(w, ids, 'column');
    tick(w);
    expect(w.sim.formationMembersOfGroup(0)).toBe(3);
    return { w, ids };
  }
  it('a later order takes its units out, one by one; the row stays while any remain', () => {
    const { w, ids } = column3();
    w.sim.queueCommand({ kind: 'move', ids: [ids[0]], x: at(10), y: at(30) });
    tick(w);
    expect(w.sim.formationGroupOf(ids[0])).toBe(-1);
    expect(w.sim.formationMembersOfGroup(0)).toBe(2);
    w.sim.queueCommand({ kind: 'halt', ids: [ids[1]] });
    tick(w);
    expect(w.sim.formationMembersOfGroup(0)).toBe(1);
  });
  it('a refused attack leaves the member in; an accepted one takes it out', () => {
    const { w, ids } = column3();
    const foe = spawnAt(w, w.dummy, 1, 24, 20);
    // not identified: refused whole, and nothing changes (GH-420)
    w.sim.queueCommand({ kind: 'attack', ids: [ids[0]], target: foe });
    tick(w);
    expect(w.sim.state.focusTarget[ids[0]]).toBe(-1);
    expect(w.sim.formationGroupOf(ids[0])).toBe(0);
    expect(w.sim.formationMembersOfGroup(0)).toBe(3);
    // identified and in reach of the lead rifleman: accepted
    for (let t = 0; t < 200; t++) tick(w);
    const near = spawnAt(w, w.dummy, 1, 24, 36);
    w.sim.queueCommand({ kind: 'reveal', side: 0, x: w.sim.state.posX[near], y: w.sim.state.posY[near] });
    tick(w);
    w.sim.queueCommand({ kind: 'attack', ids: [ids[0]], target: near });
    tick(w);
    expect(w.sim.state.focusTarget[ids[0]]).toBe(near);
    expect(w.sim.formationGroupOf(ids[0])).toBe(-1);
    expect(w.sim.formationMembersOfGroup(0)).toBe(2);
  });
  it('death', () => {
    const { w, ids } = column3();
    w.sim.debugKill(ids[1]);
    expect(w.sim.formationMembersOfGroup(0)).toBe(2);
    expect(w.sim.formationGroupOf(ids[1])).toBe(-1);
  });
  it('rout', () => {
    const { w, ids } = column3();
    for (let t = 0; t < 400 && w.sim.state.routed[ids[2]] === 0; t++) {
      w.sim.debugSuppress(ids[2], fx.from(5));
      tick(w);
    }
    expect(w.sim.state.routed[ids[2]], 'sustained suppression routs a rifleman').toBe(1);
    expect(w.sim.formationGroupOf(ids[2])).toBe(-1);
    expect(w.sim.formationMembersOfGroup(0)).toBe(2);
  });
  it('boarding: a rider walking to a vehicle that is appended into a column leaves it when it is seated', () => {
    const w = world();
    const ids = [0, 1, 2].map(() => spawnAt(w, w.inf, 0, 24, 40));
    const jeep = spawnAt(w, w.jeep, 0, 24, 36);
    w.sim.queueCommand({ kind: 'load', ids: [ids[0]], carrier: jeep });
    tick(w, 2);
    expect(w.sim.state.moving[ids[0]]).toBe(1);
    // an APPENDED column order keeps the boarding walk (the append fast-path clears nothing) and joins the group
    order(w, ids, 'column', 'move', { append: true });
    tick(w);
    expect(w.sim.state.carriedBy[ids[0]]).toBe(-1);
    expect(w.sim.formationMembersOfGroup(0)).toBe(3);
    for (let t = 0; t < 400 && w.sim.state.carriedBy[ids[0]] !== jeep; t++) tick(w);
    expect(w.sim.state.carriedBy[ids[0]]).toBe(jeep);
    expect(w.sim.formationGroupOf(ids[0])).toBe(-1);
    expect(w.sim.formationMembersOfGroup(0)).toBe(2);
  });
  it('garrisoning: the same walk into a building', () => {
    const w = world();
    const shed = w.sim.addStructure(w.sim.addStructureType(SHED), [30 * w.sim.width + 24, 30 * w.sim.width + 25, 31 * w.sim.width + 24, 31 * w.sim.width + 25]);
    const ids = [0, 1, 2].map(() => spawnAt(w, w.inf, 0, 24, 40));
    w.sim.queueCommand({ kind: 'garrison', ids: [ids[0]], structure: shed });
    tick(w, 2);
    expect(w.sim.state.moving[ids[0]]).toBe(1);
    order(w, ids, 'column', 'move', { append: true });
    tick(w);
    expect(w.sim.state.garrisonedIn[ids[0]]).toBe(-1);
    expect(w.sim.formationMembersOfGroup(0)).toBe(3);
    for (let t = 0; t < 300 && w.sim.state.garrisonedIn[ids[0]] < 0; t++) tick(w);
    expect(w.sim.state.garrisonedIn[ids[0]]).toBe(shed);
    expect(w.sim.formationGroupOf(ids[0])).toBe(-1);
    expect(w.sim.formationMembersOfGroup(0)).toBe(2);
  });
  it('going below ground', () => {
    const { w, ids } = column3();
    const route = w.sim.addTunnel({ id: 'fg_a', points: [[4, 6], [14, 6]], dig_tiles_per_s: 1, pre_dug: true, side: 0, capacity: 4 });
    w.sim.putInTunnel(ids[1], route);
    expect(w.sim.state.tunnelIn[ids[1]]).toBe(route);
    expect(w.sim.formationGroupOf(ids[1])).toBe(-1);
    expect(w.sim.formationMembersOfGroup(0)).toBe(2);
  });
  it('a row whose members all leave is free: the next order takes row 0 again', () => {
    const { w, ids } = column3();
    for (const id of ids) w.sim.debugKill(id);
    expect(w.sim.formationMembersOfGroup(0)).toBe(0);
    expect(w.sim.formationTypeOfGroup(0)).toBe(-1);
    const fresh = [0, 1].map(() => spawnAt(w, w.inf, 0, 30, 40));
    order(w, fresh, 'attack', 'attackMove');
    tick(w);
    expect(fresh.map((id) => w.sim.formationGroupOf(id))).toEqual([0, 0]);
    expect(w.sim.formationTypeOfGroup(0)).toBe(1); // attack, in the row Column left
  });
  it('ordering a whole group anew re-forms it in the same row', () => {
    const { w, ids } = column3();
    order(w, ids, 'attack', 'attackMove');
    tick(w);
    expect(ids.map((id) => w.sim.formationGroupOf(id))).toEqual([0, 0, 0]);
    expect(w.sim.formationTypeOfGroup(0)).toBe(1);
    expect(w.sim.formationMembersOfGroup(0)).toBe(3);
    expect(w.sim.formationMembersOfGroup(1)).toBe(0);
  });
});

describe('the table: 16 groups a side', () => {
  it('the 17th degrades with its shape, facing and stance but no row, and springs member by member; side 1 is unaffected', () => {
    const w = world({ w: 64, h: 64, cap: 128 });
    const groups: number[][] = [];
    for (let k = 0; k < 16; k++) {
      const ids = [0, 1].map(() => spawnAt(w, w.inf, 0, 4 + 12 * (k % 5), 60));
      w.sim.queueCommand({ kind: 'move', ids, x: at(4 + 12 * (k % 5)), y: at(20 + 8 * ((k - (k % 5)) / 5)), formation: 'column' });
      groups.push(ids);
    }
    tick(w);
    expect(groups.map((ids) => w.sim.formationGroupOf(ids[0]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    // the 17th: a six-unit ring, at (56, 12), the approach from the south
    const ring = RING_TYPES(w).map((t) => spawnAt(w, t, 0, 56, 50));
    w.sim.queueCommand({ kind: 'move', ids: ring, x: at(56), y: at(12), formation: 'ambush' });
    // side 1: a column of two, its own table
    const east = [0, 1].map(() => spawnAt(w, w.inf, 1, 40, 58));
    w.sim.queueCommand({ kind: 'move', ids: east, x: at(40), y: at(40), formation: 'column' });
    tick(w);
    expect(ring.map((id) => w.sim.formationGroupOf(id))).toEqual([-1, -1, -1, -1, -1, -1]);
    expect(east.map((id) => w.sim.formationGroupOf(id))).toEqual([16, 16]);
    expect(w.sim.formationMembersOfGroup(16)).toBe(2);
    // shape: the ring's tiles are the literal ring about (56,12), forward = -y: (56,9) (54,14) (59,13) ...
    expect(goals(w.sim, ring)).toEqual([[56, 9], [54, 14], [59, 13], [58, 10], [53, 11], [56, 15]]);
    // facing and stance survived the missing row
    expect(ring.map((id) => priv(w.sim).restFacing[id])).toEqual([16384, 57344, 32768, 24576, 0, 49152]);
    expect(ring.map((id) => priv(w.sim).fmArrive[id])).toEqual([19, 19, 19, 19, 19, 19]);
    for (let t = 0; t < 900 && ring.some((id) => w.sim.state.moving[id] === 1); t++) tick(w);
    tick(w, 70);
    expect(ring.map((id) => w.sim.ambushRadiusSqOf(id))).toEqual([R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ]);
    // one member springs alone: an unarmed enemy at the north tile's edge
    const foe = spawnAt(w, w.dummy, 1, 56, 3);
    w.sim.queueCommand({ kind: 'move', ids: [foe], x: at(56), y: at(7) });
    for (let t = 0; t < 300 && kinds(w, 'ambushSprung').length === 0; t++) tick(w);
    tick(w, 3);
    const stances = ring.map((id) => w.sim.ambushRadiusSqOf(id));
    expect(stances[0], 'the north member sprang').toBe(0);
    expect(stances.slice(1), 'the rest of a degraded ring stay set: no shared spring').toEqual([R3_SQ, R3_SQ, R3_SQ, R3_SQ, R3_SQ]);
    expect(kinds(w, 'formationSprung')).toHaveLength(0);
  });
});
