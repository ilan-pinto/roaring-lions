// E6 (GH-274) item 1, G1: the Tzav's placed charge. Engine only: no shipped unit carries
// `demolition_method: "placed"` yet, so these fixtures are the only content the sim sees.
// Rules, each with the one-line mutation that turns its test red noted beside it (the
// falsification run is in the commit message):
//   1. set only on an explicit `demolish` order, never on halting;
//   2. setting takes demolition_time_s, and the building stands while the fuse burns;
//   3. it falls exactly fuse_s later, carrier alive or dead (attribution outlives it);
//   4. the blast hurts soft units, own troops and civilians included, with linear falloff;
//   5. the carrier withdraws on its own, to withdraw_tiles away, through nearestOpenTile;
//   6. chargeSet / chargeDetonated, in order;
//   7. the deferred fold: no placed type, no hash movement; with one, the fuse is state.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import type { StructureTypeJson } from './structures';

const PLACED: UnitTypeJson = {
  id: 'test_placed',
  role: 'engineer',
  hull: { hp: 2600, armor: { front: 380, side: 200, rear: 120 } },
  mobility: { speed_tiles_s: 1.0, wheeled: true },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['demolish'],
  demolition_time_s: 3.0,
  demolition_method: 'placed',
  placed_charge: { fuse_s: 8, blast_tiles: 2.5, damage: 300, suppression: 120, withdraw_tiles: 4 },
  weapons: [],
};
/** Soft (armour < SOFT_ARMOR_LIMIT) bystander with plenty of hp, so damage is readable. */
const RIFLEMAN: UnitTypeJson = {
  id: 'test_rifle',
  role: 'infantry',
  hull: { hp: 1000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [],
};
/** A bystander that dies to one blast, to see who is credited. */
const GLASS: UnitTypeJson = { ...RIFLEMAN, id: 'test_glass', hull: { hp: 20, armor: { front: 10, side: 10, rear: 10 } } };
const SHACK: StructureTypeJson = { id: 'test_shack', hp_per_tile: 100, garrison_slots: 4 };

const W = 32;
const FUSE_TICKS = 160; // 8 s
/** 3 s of held station (60 ticks) plus the one tick the order spends stopping the unit in range. */
const SET_TICKS = 61;
const SHACK_AT = 10 * W + 10;

interface World {
  sim: Sim;
  carrier: number;
  s: number;
  rifle: number;
}

function world(opts: { carrierSide?: number } = {}): World {
  const sim = new Sim({ seed: 7, width: W, height: W, capacity: 16 });
  const st = sim.addStructureType(SHACK);
  const s = sim.addStructure(st, [SHACK_AT]);
  const t = sim.addUnitType(PLACED);
  const r = sim.addUnitType(RIFLEMAN);
  sim.addUnitType(GLASS);
  const carrier = sim.spawn(t, opts.carrierSide ?? 0, fx.from(11.5), fx.from(10.5));
  const rifle = sim.spawn(r, 0, fx.from(10.5), fx.from(8.5)); // 2 tiles from the shack's centre
  return { sim, carrier, s, rifle };
}

/** Tick n times, returning every event with the tick number it came on (1-based). */
function run(sim: Sim, n: number, from = 0): { n: number; e: SimEvent }[] {
  const out: { n: number; e: SimEvent }[] = [];
  for (let k = 1; k <= n; k++) for (const e of sim.tick()) out.push({ n: from + k, e });
  return out;
}

const tilesBetween = (sim: Sim, a: number, x: number, y: number): number => {
  const dx = (sim.state.posX[a] - fx.from(x)) / 65536;
  const dy = (sim.state.posY[a] - fx.from(y)) / 65536;
  return Math.sqrt(dx * dx + dy * dy);
};

describe('placed charge: schema numbers reach the type', () => {
  it('reads fuse, blast, damage, suppression and withdraw as fixed point', () => {
    const sim = new Sim({ seed: 7, width: W, height: W, capacity: 4 });
    const t = sim.addUnitType(PLACED);
    const pc = sim.unitTypes[t].placed;
    expect(pc).not.toBeNull();
    expect(pc?.fuseTicks).toBe(FUSE_TICKS);
    expect(pc?.blast).toBe(fx.from(2.5));
    expect(pc?.damage).toBe(fx.from(300));
    expect(pc?.suppression).toBe(fx.from(120));
    expect(pc?.withdraw).toBe(fx.from(4));
  });

  it('refuses a placed unit with no block, and a block on a unit that is not placed', () => {
    const sim = new Sim({ seed: 7, width: W, height: W, capacity: 4 });
    const { placed_charge: _drop, ...bare } = PLACED;
    expect(() => sim.addUnitType({ ...bare, id: 'x1' })).toThrow(/needs placed_charge/);
    expect(() => sim.addUnitType({ ...PLACED, id: 'x2', demolition_method: 'charges' })).toThrow(/needs demolition_method/);
  });
});

describe('placed charge: only on an explicit order', () => {
  it('a placed unit halted beside a house does nothing', () => {
    const { sim, s } = world();
    const ev = run(sim, 600);
    expect(sim.structureAt(10, 10)).toBe(s);
    expect(ev.filter((x) => x.e.kind === 'chargeSet')).toHaveLength(0);
  });

  it('an explicit demolish order sets the charge, and the building still stands', () => {
    const { sim, carrier, s } = world();
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    const ev = run(sim, SET_TICKS + 5);
    const set = ev.filter((x) => x.e.kind === 'chargeSet');
    expect(set).toHaveLength(1);
    expect(sim.structureAt(10, 10)).toBe(s);
  });

  it('a plain charges unit on the same order still falls at once (the old path is untouched)', () => {
    const sim = new Sim({ seed: 7, width: W, height: W, capacity: 8 });
    const st = sim.addStructureType(SHACK);
    const s = sim.addStructure(st, [SHACK_AT]);
    const t = sim.addUnitType({ ...PLACED, id: 'sapper', demolition_method: 'charges', placed_charge: undefined });
    const id = sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    sim.queueCommand({ kind: 'demolish', ids: [id], structure: s });
    run(sim, SET_TICKS + 2);
    expect(sim.structureAt(10, 10)).toBe(-1);
  });
});

describe('placed charge: the fuse', () => {
  it('sets after demolition_time_s and falls fuse_s later, to the tick', () => {
    const { sim, carrier, s } = world();
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    const ev = run(sim, SET_TICKS + FUSE_TICKS + 20);
    const set = ev.find((x) => x.e.kind === 'chargeSet');
    const boom = ev.find((x) => x.e.kind === 'chargeDetonated');
    expect(set?.n).toBe(SET_TICKS);
    expect(SET_TICKS - 1).toBe(fx.toInt(fx.mul(fx.from(PLACED.demolition_time_s ?? 0), fx.fromInt(20))));
    expect(boom).toBeDefined();
    expect((boom?.n ?? 0) - (set?.n ?? 0)).toBe(FUSE_TICKS);
    // The wall is up the tick before and gone the tick it goes off.
    expect(sim.structureAt(10, 10)).toBe(-1);
    // Events come in the order chargeSet, ..., chargeDetonated, with structureDestroyed on the boom tick.
    const kinds = ev.map((x) => x.e.kind);
    expect(kinds.indexOf('chargeSet')).toBeLessThan(kinds.indexOf('chargeDetonated'));
    expect(ev.filter((x) => x.e.kind === 'structureDestroyed' && x.n === boom?.n)).toHaveLength(1);
  });

  it('the building is intact one tick before the boom', () => {
    const { sim, carrier, s } = world();
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    run(sim, SET_TICKS + FUSE_TICKS - 1);
    expect(sim.structureAt(10, 10)).toBe(s);
    run(sim, 1);
    expect(sim.structureAt(10, 10)).toBe(-1);
  });

  it('a second carrier finishing against an armed wall does not restart the fuse', () => {
    const { sim, carrier, s } = world();
    const t2 = sim.addUnitType({ ...PLACED, id: 'test_placed2' });
    const other = sim.spawn(t2, 0, fx.from(9.5), fx.from(10.5));
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    run(sim, 30);
    sim.queueCommand({ kind: 'demolish', ids: [other], structure: s });
    const ev = run(sim, SET_TICKS + FUSE_TICKS, 30);
    expect(ev.filter((x) => x.e.kind === 'chargeSet')).toHaveLength(1);
    const boom = ev.find((x) => x.e.kind === 'chargeDetonated');
    expect(boom?.n).toBe(SET_TICKS + FUSE_TICKS);
    expect(boom?.e.kind === 'chargeDetonated' && boom.e.by).toBe(carrier);
  });

  it('a wall that falls some other way first takes the charge with it: no blast', () => {
    const { sim, carrier, s, rifle } = world();
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    run(sim, SET_TICKS + 10);
    sim.debugDestroyStructure(s);
    const hp = sim.state.hp[rifle];
    const ev = run(sim, FUSE_TICKS + 20, SET_TICKS + 10);
    expect(ev.filter((x) => x.e.kind === 'chargeDetonated')).toHaveLength(0);
    expect(sim.state.hp[rifle]).toBe(hp);
  });
});

describe('placed charge: the carrier outlives nothing, and the charge outlives the carrier', () => {
  it('detonates when the carrier is killed after setting, still credited to it', () => {
    const { sim, carrier, s } = world();
    const glass = sim.unitTypes.findIndex((u) => u.id === 'test_glass');
    const victim = sim.spawn(glass, 0, fx.from(10.5), fx.from(9.5));
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    run(sim, SET_TICKS + 5);
    sim.debugKill(carrier);
    expect(sim.state.alive[carrier]).toBe(0);
    const ev = run(sim, FUSE_TICKS, SET_TICKS + 5);
    const boom = ev.find((x) => x.e.kind === 'chargeDetonated');
    expect(boom).toBeDefined();
    expect(boom?.e.kind === 'chargeDetonated' && boom.e.by).toBe(carrier);
    expect(sim.structureAt(10, 10)).toBe(-1);
    // The blast's own kill is credited to the dead carrier too -- ROE reads side[by].
    const kill = ev.find((x) => x.e.kind === 'destroyed' && x.e.entity === victim);
    expect(kill?.e.kind === 'destroyed' && kill.e.by).toBe(carrier);
    const down = ev.find((x) => x.e.kind === 'structureDestroyed');
    expect(down?.e.kind === 'structureDestroyed' && down.e.by).toBe(carrier);
    expect(sim.state.side[carrier]).toBe(0);
  });
});

describe('placed charge: the blast', () => {
  it('hurts a soft unit inside the radius, linearly less toward the edge, and spares one outside', () => {
    const sim = new Sim({ seed: 7, width: W, height: W, capacity: 16 });
    const st = sim.addStructureType(SHACK);
    const s = sim.addStructure(st, [SHACK_AT]);
    const t = sim.addUnitType(PLACED);
    const r = sim.addUnitType(RIFLEMAN);
    const carrier = sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    // centre of the shack is (10.5, 10.5): 0.5, 1.5, 2.0 tiles to the north, then 3.5.
    const near = sim.spawn(r, 0, fx.from(10.5), fx.from(10.0));
    const mid = sim.spawn(r, 0, fx.from(10.5), fx.from(9.0));
    const edge = sim.spawn(r, 0, fx.from(10.5), fx.from(8.5));
    const out = sim.spawn(r, 0, fx.from(10.5), fx.from(7.0));
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    run(sim, SET_TICKS + FUSE_TICKS);
    const lost = (id: number): number => 1000 - sim.state.hp[id] / 65536;
    expect(lost(near)).toBeGreaterThan(lost(mid));
    expect(lost(mid)).toBeGreaterThan(lost(edge));
    expect(lost(edge)).toBeGreaterThan(0);
    expect(lost(out)).toBe(0);
    // Damage 300 at the centre falling to 0 at 2.5 tiles: 0.5 tiles out is 0.8 of it.
    expect(lost(near)).toBeCloseTo(240, 0);
    expect(sim.state.suppression[edge]).toBeGreaterThan(0);
  });

  it('hurts own troops and civilians (the lead: yes)', () => {
    const { sim, carrier, s, rifle } = world({ carrierSide: 0 });
    const before = sim.state.hp[rifle];
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    run(sim, SET_TICKS + FUSE_TICKS);
    // `rifle` is side 0, the carrier's own.
    expect(sim.state.hp[rifle]).toBeLessThan(before);
    // A civilian-role body takes it the same way.
    const sim2 = new Sim({ seed: 7, width: W, height: W, capacity: 16 });
    const st = sim2.addStructureType(SHACK);
    const s2 = sim2.addStructure(st, [SHACK_AT]);
    const t = sim2.addUnitType(PLACED);
    const c = sim2.addUnitType({ ...RIFLEMAN, id: 'test_civ', role: 'civilian' });
    const carrier2 = sim2.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    const civ = sim2.spawn(c, 1, fx.from(10.5), fx.from(9.0));
    const hp = sim2.state.hp[civ];
    sim2.queueCommand({ kind: 'demolish', ids: [carrier2], structure: s2 });
    run(sim2, SET_TICKS + FUSE_TICKS);
    expect(sim2.state.hp[civ]).toBeLessThan(hp);
  });

  it('does not hurt armour (isSoft only): the carrier itself is excluded', () => {
    const { sim, carrier, s } = world();
    const hp = sim.state.hp[carrier];
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    run(sim, SET_TICKS + FUSE_TICKS);
    expect(sim.state.hp[carrier]).toBe(hp);
  });

  it('a garrison inside falls with the wall (destroyStructure runs first)', () => {
    const { sim, carrier, s } = world();
    const r = sim.unitTypes.findIndex((u) => u.id === 'test_rifle');
    const inside = sim.spawn(r, 1, fx.from(10.5), fx.from(10.5));
    sim.queueCommand({ kind: 'garrison', ids: [inside], structure: s });
    run(sim, 40);
    expect(sim.state.garrisonedIn[inside]).toBe(s);
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    run(sim, SET_TICKS + FUSE_TICKS, 40);
    expect(sim.state.alive[inside]).toBe(0);
  });
});

describe('placed charge: the carrier withdraws', () => {
  it('backs away from the wall by withdraw_tiles on its own and does not re-set', () => {
    const { sim, carrier, s } = world();
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    const ev = run(sim, SET_TICKS + 1);
    expect(ev.filter((x) => x.e.kind === 'chargeSet')).toHaveLength(1);
    expect(sim.state.moving[carrier]).toBe(1);
    // Still alive and walking ~4 tiles east of where it stood (11.5, 10.5), speed 1 tile/s.
    run(sim, 20 * 6, SET_TICKS + 1);
    expect(sim.state.moving[carrier]).toBe(0);
    expect(tilesBetween(sim, carrier, 11.5, 10.5)).toBeGreaterThan(3.5);
    expect(tilesBetween(sim, carrier, 11.5, 10.5)).toBeLessThan(4.5);
    expect(sim.state.posX[carrier]).toBeGreaterThan(fx.from(14.5));
    // Still no second charge once it stops: the order was consumed.
    const more = run(sim, 100, SET_TICKS + 1 + 120);
    expect(more.filter((x) => x.e.kind === 'chargeSet')).toHaveLength(0);
  });

  it('retreats along the line from the wall through the carrier, not always the same way', () => {
    const sim = new Sim({ seed: 7, width: W, height: W, capacity: 8 });
    const st = sim.addStructureType(SHACK);
    const s = sim.addStructure(st, [SHACK_AT]);
    const t = sim.addUnitType(PLACED);
    const carrier = sim.spawn(t, 0, fx.from(10.5), fx.from(9.5)); // north of the wall
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    run(sim, SET_TICKS + 20 * 6);
    expect(sim.state.posY[carrier]).toBeLessThan(fx.from(6.5));
    expect(Math.abs(sim.state.posX[carrier] - fx.from(10.5))).toBeLessThan(fx.from(0.5));
  });

  it('snaps the retreat to open ground when the straight point is a wall', () => {
    const { sim, carrier, s } = world();
    // Wall off the straight-line retreat point (15.5, 10.5): its tile is a building.
    const st2 = sim.addStructureType({ id: 'test_wall', hp_per_tile: 100 });
    sim.addStructure(st2, [10 * W + 15]);
    sim.queueCommand({ kind: 'demolish', ids: [carrier], structure: s });
    run(sim, SET_TICKS + 1);
    run(sim, 20 * 8, SET_TICKS + 1);
    const tx = fx.toInt(sim.state.posX[carrier]);
    const ty = fx.toInt(sim.state.posY[carrier]);
    expect(sim.structureAt(tx, ty)).toBe(-1);
    expect(tilesBetween(sim, carrier, 11.5, 10.5)).toBeGreaterThan(2);
  });
});

describe('placed charge: the hash', () => {
  const twin = (placedType: boolean): Sim => {
    const sim = new Sim({ seed: 7, width: W, height: W, capacity: 8 });
    const st = sim.addStructureType(SHACK);
    sim.addStructure(st, [SHACK_AT]);
    const t = sim.addUnitType(placedType ? PLACED : { ...PLACED, id: 'plain', demolition_method: 'charges', placed_charge: undefined });
    sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    return sim;
  };

  it('a world with no placed type hashes as it did: the block is not folded', () => {
    const a = twin(false);
    const b = twin(false);
    for (let k = 0; k < 50; k++) {
      a.tick();
      b.tick();
    }
    expect(a.hash()).toBe(b.hash());
    // The deferred fold: the same world with a placed type registered differs ONLY by the block.
    const c = twin(true);
    for (let k = 0; k < 50; k++) c.tick();
    expect(c.hash()).not.toBe(a.hash());
  });

  it('with a placed type the fuse is hashed state', () => {
    const a = world();
    const b = world();
    a.sim.queueCommand({ kind: 'demolish', ids: [a.carrier], structure: a.s });
    b.sim.queueCommand({ kind: 'demolish', ids: [b.carrier], structure: b.s });
    run(a.sim, SET_TICKS + 10);
    run(b.sim, SET_TICKS + 10);
    expect(a.sim.hash()).toBe(b.sim.hash());
    run(a.sim, 1, SET_TICKS + 10);
    run(b.sim, 1, SET_TICKS + 10);
    expect(a.sim.hash()).toBe(b.sim.hash());
    // Same world, same positions, but one fuse shorter: only the charge column differs.
    const c = world();
    c.sim.queueCommand({ kind: 'demolish', ids: [c.carrier], structure: c.s });
    run(c.sim, SET_TICKS + 10);
    const h = c.sim.hash();
    (c.sim as unknown as { stChargeTicks: Int32Array }).stChargeTicks[c.s] += 1;
    expect(c.sim.hash()).not.toBe(h);
  });
});
