import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import catalogue from '../../../data/structures.json';
import { CivilianFlight, CIV_FLEE_AT } from './civilians';
import { fx, type Fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import type { StructureTypeJson } from './structures';

// GH-707 Task 1: the wound data shape and the deferred fold. Twelve per-unit columns plus
// the per-side wounded count and the evac table, folded into hash() only once a
// wound-related type is registered (`woundLive`, the `airLive`/`fwLive` shape), so a world
// with no wound content moves no pin. Nothing in the sim reads the columns yet.

const RIFLES: UnitTypeJson = {
  id: 'wd_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

/** The squad with every wound field: 4 men, 0.6 chance, 60 s bleed. */
const WOUNDABLE: UnitTypeJson = {
  ...RIFLES,
  id: 'wd_squad',
  hull: {
    hp: 400,
    armor: { front: 10, side: 10, rear: 10 },
    figures: 4,
    wounds: { wound_chance: 0.6, bleed_s: 60, type: 'wounded_test' },
  },
};

const WOUNDED: UnitTypeJson = {
  id: 'wounded_test',
  role: 'wounded',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true },
  mobility: { speed_tiles_s: 0.12 },
  sensors: { optics: 0.5, sight_tiles: 0, signature: 0.3 },
};

const MEDIC: UnitTypeJson = {
  ...RIFLES,
  id: 'wd_medic',
  abilities: ['rescue'],
  hull: { hp: 200, armor: { front: 10, side: 10, rear: 10 }, figures: 2, transport_slots: 1, can_carry: ['wounded'] },
  rescue: { radius_tiles: 8, treat_s: 6, drag_speed_mult: 0.5, carry_speed_mult: 0.75 },
};

/** A medic with seats but no `can_carry`: the `rescue` block alone must turn the fold on. */
const MEDIC_RESCUE_ONLY: UnitTypeJson = {
  ...RIFLES,
  id: 'wd_medic_plain',
  abilities: ['rescue'],
  rescue: { radius_tiles: 8, treat_s: 6, drag_speed_mult: 0.5, carry_speed_mult: 0.75 },
};

const AMBULANCE: UnitTypeJson = {
  id: 'wd_ambulance',
  role: 'apc',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 }, transport_slots: 4, can_carry: ['wounded'], stabilise_radius: 1.5 },
  mobility: { speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8 },
};

const AID_POST: StructureTypeJson = {
  id: 'wd_aid_post',
  hp_per_tile: 200,
  owner: 0,
  aid: { admit_radius: 1, treat_s: 20, dispatch_radius: 12 },
};

function world(extra: readonly UnitTypeJson[]): { sim: Sim; inf: number } {
  const sim = new Sim({ seed: 0x7070_0001, width: 16, height: 16, capacity: 16 });
  const ti = sim.addUnitType(RIFLES);
  for (const t of extra) sim.addUnitType(t);
  const inf = sim.spawn(ti, 0, fx.fromInt(3), fx.fromInt(3));
  sim.spawn(ti, 1, fx.fromInt(9), fx.fromInt(9));
  for (let i = 0; i < 10; i++) sim.tick();
  return { sim, inf };
}

/** Every shipped unit JSON under data/units, read off the disk. */
function shippedUnits(): UnitTypeJson[] {
  const out: UnitTypeJson[] = [];
  const walk = (dir: string): void => {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.json')) out.push(JSON.parse(readFileSync(p, 'utf8')) as UnitTypeJson);
    }
  };
  walk(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'units'));
  return out;
}

const COLUMNS = [
  'figuresUp',
  'scars',
  'woundParent',
  'woundBy',
  'woundState',
  'bleedTicks',
  'woundTimer',
  'medState',
  'medTarget',
  'medTimer',
  'speedMul',
  'admittedAt',
  'woundedAlive', // per side, not per unit: index 0 is side 0's count
] as const;

describe('wound data shape (GH-707 Task 1)', () => {
  it('a sim with every shipped unit and structure type is not wound-live', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    // Less the `wounded`-role types and the structure types carrying `aid`: landing those (GH-707 P2,
    // `wounded_kdf` and `wounded_sarim`) IS wound content, and registering one turns the fold on --
    // the next test pins exactly that. What this one still holds is that no OTHER shipped type
    // does it by accident.
    const units = shippedUnits().filter((u) => (u as { role?: string }).role !== 'wounded');
    expect(units.length).toBeGreaterThan(30); // the walk found the roster, not an empty dir
    for (const u of units) sim.addUnitType(u);
    for (const s of Object.values(catalogue.types)) {
      if ((s as { aid?: unknown }).aid !== undefined) continue;
      sim.addStructureType(s as StructureTypeJson);
    }
    expect(sim.woundsLive).toBe(false);
  });

  it('each wound-related type flips it: wounds, role wounded, rescue, can_carry, an aid post', () => {
    for (const t of [WOUNDABLE, WOUNDED, MEDIC_RESCUE_ONLY, MEDIC, AMBULANCE]) {
      const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
      sim.addUnitType(RIFLES);
      expect(sim.woundsLive).toBe(false);
      sim.addUnitType(t);
      expect(sim.woundsLive).toBe(true);
    }
    // An aid post flips it when one is placed or staked (addStructure), not when its type is registered: every world
    // registers the whole structure catalogue (standMapStructures), so a registration trigger
    // folded the wound block into every mission and versus world (GH-707 P2: six versus/net
    // pins moved the moment kdf_aid_post entered data/structures.json).
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const house = sim.addStructureType({ id: 'wd_house', hp_per_tile: 100 });
    const post = sim.addStructureType(AID_POST);
    expect(sim.woundsLive).toBe(false);
    sim.addStructure(house, [0]);
    expect(sim.woundsLive).toBe(false);
    sim.addStructure(post, [2]);
    expect(sim.woundsLive).toBe(true);
  });

  it('parses the fields into fixed point and ticks at load', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const [sq, wd, md, amb, inf] = [WOUNDABLE, WOUNDED, MEDIC, AMBULANCE, RIFLES].map(
      (j) => sim.unitTypes[sim.addUnitType(j)],
    );
    // 0.6 x 65536 = 39321.6 -> 39322; 60 s x 20 = 1200 ticks.
    expect(sq.figures).toBe(4);
    expect(sq.wounds).toEqual({ chance: 39322, bleedTicks: 1200, typeId: 'wounded_test', inPlace: false });
    expect(sq.woundedTypeIdx).toBe(-1);
    expect(sq.isWounded).toBe(false);
    expect(wd.isWounded).toBe(true);
    // radius 8 -> 64 tile^2 = 4194304; 6 s = 120 ticks; 0.5 = 32768; 0.75 = 49152.
    expect(md.rescue).toEqual({ radiusSq: 4194304, treatTicks: 120, dragMult: 32768, carryMult: 49152 });
    expect(md.canCarry).toEqual(['wounded']);
    // 1.5 tiles = 98304; 98304^2 >> 16 = 147456 (2.25 tile^2).
    expect(amb.stabiliseRadiusSq).toBe(147456);
    // Defaults: one man, no wounds, no medic, ordinary seating, no aura.
    expect(inf.figures).toBe(1);
    expect(inf.wounds).toBeNull();
    expect(inf.rescue).toBeNull();
    expect(inf.canCarry).toBeNull();
    expect(inf.stabiliseRadiusSq).toBe(0);
    // Aid: admit 1 -> 65536; 20 s = 400 ticks; dispatch 12 -> 144 tile^2 = 9437184.
    const post = sim.structureTypes[sim.addStructureType(AID_POST)];
    expect(post.aid).toEqual({ admitRadiusSq: 65536, treatTicks: 400, dispatchRadiusSq: 9437184 });
    expect(sim.structureTypes[sim.addStructureType({ id: 'wd_house', hp_per_tile: 100 })].aid).toBeNull();
  });

  it('refuses a chance above one, a bleed under a tick and a figure count outside 1..8', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const bad = (hull: Partial<UnitTypeJson['hull']>): UnitTypeJson => ({ ...WOUNDABLE, hull: { ...WOUNDABLE.hull, ...hull } });
    expect(() => sim.addUnitType(bad({ wounds: { wound_chance: 1.5, bleed_s: 60, type: 'w' } }))).toThrow(/wound_chance/);
    expect(() => sim.addUnitType(bad({ wounds: { wound_chance: 0.5, bleed_s: 0.01, type: 'w' } }))).toThrow(/bleed_s/);
    expect(() => sim.addUnitType(bad({ figures: 9 }))).toThrow(/figures/);
    expect(() => sim.addUnitType(bad({ figures: 0 }))).toThrow(/figures/);
  });

  it('refuses a duration over 1600 s or a radius over 64 tiles rather than wrapping it in Fx', () => {
    // 1700 s x 20 = 34000 ticks; x 65536 passes 2^31, so fx.mul would wrap without the check.
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const w = { wound_chance: 0.5, bleed_s: 1700, type: 'w' };
    expect(() => sim.addUnitType({ ...WOUNDABLE, hull: { ...WOUNDABLE.hull, wounds: w } })).toThrow(/bleed_s must be <= 1600/);
    const r = MEDIC_RESCUE_ONLY.rescue ?? { radius_tiles: 0, treat_s: 0, drag_speed_mult: 0, carry_speed_mult: 0 };
    expect(() => sim.addUnitType({ ...MEDIC_RESCUE_ONLY, rescue: { ...r, treat_s: 1700 } })).toThrow(/treat_s must be <= 1600/);
    expect(() => sim.addUnitType({ ...MEDIC_RESCUE_ONLY, rescue: { ...r, radius_tiles: 65 } })).toThrow(/radius_tiles must be 0..64/);
    expect(() => sim.addUnitType({ ...AMBULANCE, hull: { ...AMBULANCE.hull, stabilise_radius: 65 } })).toThrow(/stabilise_radius must be 0..64/);
    const aid = { admit_radius: 1, treat_s: 20, dispatch_radius: 12 };
    expect(() => sim.addStructureType({ ...AID_POST, aid: { ...aid, treat_s: 1700 } })).toThrow(/treat_s must be <= 1600/);
    expect(() => sim.addStructureType({ ...AID_POST, aid: { ...aid, dispatch_radius: 65 } })).toThrow(/radii must be 0..64/);
    // The bounds themselves load: 1600 s = 32000 ticks, 64 tiles -> 4096 tile^2 = 268435456.
    const edge = sim.unitTypes[sim.addUnitType({ ...MEDIC_RESCUE_ONLY, rescue: { ...r, treat_s: 1600, radius_tiles: 64 } })];
    expect(edge.rescue?.treatTicks).toBe(32000);
    expect(edge.rescue?.radiusSq).toBe(268435456);
  });

  it('spawn writes the defaults: figuresUp = type.figures, speedMul ONE, -1 links, 0 states', () => {
    const { sim } = world([WOUNDABLE]);
    const id = sim.spawn(sim.unitTypes.findIndex((t) => t.id === 'wd_squad'), 0, fx.fromInt(5), fx.fromInt(5));
    const s = sim.state;
    expect([s.figuresUp[id], s.scars[id], s.woundState[id], s.bleedTicks[id], s.woundTimer[id]]).toEqual([4, 0, 0, 0, 0]);
    expect([s.medState[id], s.medTimer[id], s.speedMul[id]]).toEqual([0, 0, 65536]);
    expect([s.woundParent[id], s.woundBy[id], s.medTarget[id], s.admittedAt[id]]).toEqual([-1, -1, -1, -1]);
    expect(s.figuresUp[0]).toBe(1); // a one-man type
  });
});

describe('the deferred fold (GH-707 Task 1)', () => {
  it('registering a wound type, nothing spawned from it, changes the hash; without one it does not', () => {
    const plain = world([]);
    const sameAgain = world([]);
    const wounded = world([WOUNDABLE]);
    expect(plain.sim.hash()).toBe(sameAgain.sim.hash());
    expect(wounded.sim.hash()).not.toBe(plain.sim.hash());
    // A world registering a NON-wound type (same index shift, no fold) hashes as the plain one:
    // type tables are not hashed, so only the fold can explain the difference above.
    expect(world([{ ...RIFLES, id: 'wd_other' }]).sim.hash()).toBe(plain.sim.hash());
  });

  it('no wound type registered: no wound column is folded', () => {
    const { sim, inf } = world([]);
    const before = sim.hash();
    for (const name of COLUMNS) sim.state[name][inf] += 3;
    expect(sim.hash()).toBe(before);
  });

  // The evac table (Task 1 review, owed): its three arrays and its count. addEvacPoint is
  // the only writer; the rows are reached past `private` for the mutation.
  type EvacTable = { evacX: Int32Array; evacY: Int32Array; evacSide: Int32Array; evacCount: number };
  for (const name of ['evacX', 'evacY', 'evacSide'] as const) {
    it(`wound-live: hash covers ${name}`, () => {
      const { sim } = world([WOUNDABLE]);
      sim.addEvacPoint(0, fx.fromInt(2), fx.fromInt(3));
      const before = sim.hash();
      (sim as unknown as EvacTable)[name][0] += 1;
      expect(sim.hash()).not.toBe(before);
    });
  }
  it('wound-live: hash covers evacCount', () => {
    const { sim } = world([WOUNDABLE]);
    const before = sim.hash();
    (sim as unknown as EvacTable).evacCount = 1; // an all-zero row 0: only the count differs
    expect(sim.hash()).not.toBe(before);
  });
  // `removed` (Task 7): evacuation and admission write it once wounds are live, so it joins
  // the block -- and only the block: a remove trigger in a wound-free world must move no pin.
  it('wound-live: hash covers removed', () => {
    const { sim, inf } = world([WOUNDABLE]);
    const before = sim.hash();
    (sim.state.removed as Uint8Array)[inf] = 1;
    expect(sim.hash()).not.toBe(before);
  });
  it('no wound type registered: removed is not folded', () => {
    const { sim, inf } = world([]);
    const before = sim.hash();
    (sim.state.removed as Uint8Array)[inf] = 1;
    expect(sim.hash()).toBe(before);
  });
  it('no wound type registered: an evac point is not folded', () => {
    const { sim } = world([]);
    const before = sim.hash();
    sim.addEvacPoint(1, fx.fromInt(2), fx.fromInt(3));
    expect(sim.hash()).toBe(before);
  });

  for (const name of COLUMNS) {
    it(`wound-live: hash covers ${name}`, () => {
      const { sim, inf } = world([WOUNDABLE]);
      const before = sim.hash();
      sim.state[name][inf] += 1;
      expect(sim.hash()).not.toBe(before);
    });
  }
});

// ---------------------------------------------------------------------------
// GH-707 Task 2: falling.
// ---------------------------------------------------------------------------

/** 400 hp, 4 figures: one man per 100 hp. `chance` is the wound roll. */
function squadType(chance: number, type = 'wounded_test'): UnitTypeJson {
  return {
    ...RIFLES,
    id: `wd_squad_${chance}_${type}`,
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 }, figures: 4, wounds: { wound_chance: chance, bleed_s: 60, type } },
  };
}

/** A one-man unit that goes down in place (the civilians' shape). */
const IN_PLACE: UnitTypeJson = {
  ...RIFLES,
  id: 'wd_civ',
  role: 'civilian',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, wounds: { wound_chance: 1, bleed_s: 60, type: 'wounded_test', in_place: true } },
};

/** The sim's one damage path, as a hit takes it. */
function hit(sim: Sim, id: number, hp: number, by: number): void {
  (sim as unknown as { applyDamage(t: number, d: Fx, by: number): void }).applyDamage(id, fx.fromInt(hp), by);
}

/** A sim with the wounded type registered, one squad of `sq` on side 0 at (5.5, 5.5) and a
 *  shooter on side 1 far away (no weapons: nobody fires on their own). */
function fallWorld(sq: UnitTypeJson, capacity = 32, withWounded = true): { sim: Sim; squad: number; shooter: number; ti: number } {
  const sim = new Sim({ seed: 0x7070_0002, width: 16, height: 16, capacity });
  const ti = sim.addUnitType(sq);
  if (withWounded) sim.addUnitType(WOUNDED);
  const ri = sim.addUnitType(RIFLES);
  const squad = sim.spawn(ti, 0, fx.from(5.5), fx.from(5.5));
  const shooter = sim.spawn(ri, 1, fx.from(14.5), fx.from(14.5));
  sim.tick();
  return { sim, squad, shooter, ti };
}

const of = <K extends SimEvent['kind']>(evs: readonly SimEvent[], k: K): Extract<SimEvent, { kind: K }>[] =>
  evs.filter((e): e is Extract<SimEvent, { kind: K }> => e.kind === k);

describe('falling (GH-707 Task 2)', () => {
  it('a 100-hp hit on 400 hp / 4 men sheds exactly one wounded at the squad, chance 1', () => {
    const { sim, squad, shooter } = fallWorld(squadType(1));
    const before = sim.entityCount;
    hit(sim, squad, 100, shooter);
    const s = sim.state;
    expect(sim.entityCount).toBe(before + 1);
    const w = before; // the next id
    expect(s.figuresUp[squad]).toBe(3);
    expect(s.alive[w]).toBe(1);
    expect(sim.unitTypes[s.typeIdx[w]].id).toBe('wounded_test');
    expect([s.posX[w], s.posY[w], s.side[w]]).toEqual([360448, 360448, 0]); // 5.5 x 65536
    expect([s.woundState[w], s.woundParent[w], s.woundBy[w], s.bleedTicks[w]]).toEqual([1, squad, shooter, 1200]); // 60 s x 20
    expect(s.woundedAlive[0]).toBe(1);
    expect(s.hp[squad]).toBe(300 * 65536);
    const evs = sim.tick();
    expect(of(evs, 'woundedDown')).toEqual([{ kind: 'woundedDown', tick: 1, entity: w, parent: squad, by: shooter }]);
    expect(of(evs, 'manKilled')).toEqual([]);
  });

  it('chance 0: the man is killed (manKilled), nothing spawns, no draw is needed', () => {
    const { sim, squad, shooter } = fallWorld(squadType(0));
    const before = sim.entityCount;
    hit(sim, squad, 100, shooter);
    expect(sim.entityCount).toBe(before);
    expect(sim.state.figuresUp[squad]).toBe(3);
    expect(sim.state.woundedAlive[0]).toBe(0);
    const evs = sim.tick();
    expect(of(evs, 'manKilled')).toEqual([{ kind: 'manKilled', tick: 1, entity: squad, by: shooter }]);
    expect(of(evs, 'woundedDown')).toEqual([]);
  });

  it('a hit below a share boundary sheds nobody; 99 more crosses it', () => {
    const { sim, squad, shooter } = fallWorld(squadType(1));
    const before = sim.entityCount;
    hit(sim, squad, 99, shooter); // 301 hp -> ceil(3.01) = 4 standing
    expect([sim.entityCount, sim.state.figuresUp[squad]]).toEqual([before, 4]);
    hit(sim, squad, 1, shooter); // 300 hp -> 3
    expect([sim.entityCount, sim.state.figuresUp[squad]]).toEqual([before + 1, 3]);
  });

  it('400 hp in one hit: three wounded with the squad as parent, then the squad dies and its last man leaves a body with parent -1', () => {
    const { sim, squad, shooter } = fallWorld(squadType(1));
    const before = sim.entityCount;
    hit(sim, squad, 400, shooter);
    const s = sim.state;
    expect(s.alive[squad]).toBe(0);
    expect(sim.entityCount).toBe(before + 4);
    const parents = [0, 1, 2, 3].map((k) => s.woundParent[before + k]);
    expect(parents).toEqual([squad, squad, squad, -1]);
    expect([0, 1, 2, 3].map((k) => s.woundState[before + k])).toEqual([1, 1, 1, 1]);
    expect(s.figuresUp[squad]).toBe(0);
    expect(s.woundedAlive[0]).toBe(4);
    const evs = sim.tick();
    expect(of(evs, 'destroyed')).toEqual([{ kind: 'destroyed', tick: 1, entity: squad, by: shooter }]);
    expect(of(evs, 'woundedDown').map((e) => e.parent)).toEqual([squad, squad, squad, -1]);
    expect(of(evs, 'manKilled')).toEqual([]);
  });

  it('400 hp in one hit, chance 0: three manKilled, then the squad destroyed, and no fourth manKilled', () => {
    const { sim, squad, shooter } = fallWorld(squadType(0));
    const before = sim.entityCount;
    hit(sim, squad, 400, shooter);
    expect(sim.entityCount).toBe(before);
    const evs = sim.tick();
    expect(of(evs, 'manKilled').length).toBe(3);
    expect(of(evs, 'destroyed').map((e) => e.entity)).toEqual([squad]);
  });

  it('the 25th wounded on a side is killed, not spawned (MAX_WOUNDED_PER_SIDE 24)', () => {
    const { sim, ti, shooter } = fallWorld(squadType(1), 64);
    // Six squads x 4 men = 24 wounded on side 0.
    for (let k = 0; k < 6; k++) {
      const q = sim.spawn(ti, 0, fx.fromInt(2 + k), fx.fromInt(2));
      hit(sim, q, 400, shooter);
    }
    expect(sim.state.woundedAlive[0]).toBe(24);
    const seventh = sim.spawn(ti, 0, fx.fromInt(10), fx.fromInt(10));
    const before = sim.entityCount;
    hit(sim, seventh, 100, shooter);
    expect(sim.entityCount).toBe(before);
    expect(sim.state.figuresUp[seventh]).toBe(3);
    expect(sim.state.woundedAlive[0]).toBe(24);
    expect(of(sim.tick(), 'manKilled')).toEqual([{ kind: 'manKilled', tick: 1, entity: seventh, by: shooter }]);
    // Side 1 has its own count: one of theirs still falls wounded.
    const theirs = sim.spawn(ti, 1, fx.fromInt(12), fx.fromInt(12));
    hit(sim, theirs, 100, -1);
    expect(sim.state.woundedAlive[1]).toBe(1);
  });

  it('a fall at the sim capacity kills the man and does not throw', () => {
    // capacity 3: squad, shooter, one free id. 200 hp crosses two shares.
    const { sim, squad, shooter } = fallWorld(squadType(1), 3);
    expect(() => hit(sim, squad, 200, shooter)).not.toThrow();
    expect(sim.entityCount).toBe(3);
    expect(sim.state.figuresUp[squad]).toBe(2);
    const evs = sim.tick();
    expect(of(evs, 'woundedDown').length).toBe(1);
    expect(of(evs, 'manKilled').length).toBe(1);
  });

  it('wounds.type naming no registered wounded-role type kills the man, never throws', () => {
    for (const [sq, withWounded] of [
      [squadType(1, 'wounded_missing'), true],
      [squadType(1), false], // 'wounded_test' never registered
      [squadType(1, 'wd_inf'), true], // registered, but a rifle squad, not role wounded
    ] as const) {
      const { sim, squad, shooter } = fallWorld(sq, 32, withWounded);
      const before = sim.entityCount;
      expect(() => hit(sim, squad, 100, shooter)).not.toThrow();
      expect(sim.entityCount).toBe(before);
      expect(sim.state.figuresUp[squad]).toBe(3);
      expect(of(sim.tick(), 'manKilled').length).toBe(1);
    }
  });

  it('a blast that downs a man does not hit the wounded it made (splash reads count once)', () => {
    const { sim, squad, shooter } = fallWorld(squadType(1));
    const before = sim.entityCount;
    // 100 hp at the squad's own point (falloff 1): one man down, at distance 0 from the blast.
    sim.debugSplash(fx.from(5.5), fx.from(5.5), fx.fromInt(1), fx.fromInt(100), 0, shooter, -1);
    expect(sim.entityCount).toBe(before + 1);
    expect(sim.state.alive[before]).toBe(1);
    expect(sim.state.hp[before]).toBe(30 * 65536);
    expect(sim.state.figuresUp[squad]).toBe(3);
  });

  it('regen tops out at the standing men: 0.7 x 400 x 1/4 = 70 hp, not 280', () => {
    const { sim, squad, shooter } = fallWorld(squadType(1));
    hit(sim, squad, 350, shooter); // 50 hp -> ceil(0.5) = 1 standing: three fall
    expect(sim.state.figuresUp[squad]).toBe(1);
    for (let t = 0; t < 3000; t++) sim.tick();
    // REGEN_CAP 0.7 = 45875: 26214400 x 45875 >> 16 = 18350000; x 1/4 = 4587500 (69.9997 hp).
    expect(sim.state.hp[squad]).toBe(4587500);
  });

  it('a team one man down regens to three quarters of the 0.7 ceiling', () => {
    const { sim, squad, shooter } = fallWorld(squadType(1));
    hit(sim, squad, 199, shooter); // 201 hp: ceil(2.01) = 3 standing, one man down
    for (let t = 0; t < 3000; t++) sim.tick();
    // 3 of 4 standing: 18350000 x 3 / 4 = 13762500 (209.9997 hp), not the full 18350000.
    expect(sim.state.hp[squad]).toBe(13762500);
  });

  it('in place: the fatal hit downs the unit itself, same id, 1 hp, no destroyed', () => {
    const { sim, squad: civ, shooter } = fallWorld(IN_PLACE);
    const before = sim.entityCount;
    hit(sim, civ, 50, shooter);
    const s = sim.state;
    expect(sim.entityCount).toBe(before);
    expect([s.alive[civ], s.hp[civ], s.woundState[civ], s.figuresUp[civ]]).toEqual([1, 65536, 1, 0]);
    expect([s.woundParent[civ], s.woundBy[civ], s.bleedTicks[civ]]).toEqual([-1, shooter, 1200]);
    expect(s.woundedAlive[0]).toBe(1);
    let evs = sim.tick();
    expect(of(evs, 'destroyed')).toEqual([]);
    expect(of(evs, 'woundedDown')).toEqual([{ kind: 'woundedDown', tick: 1, entity: civ, parent: -1, by: shooter }]);
    // Down, his regen ceiling is zero: 400 quiet ticks leave him at 1 hp.
    for (let t = 0; t < 400; t++) sim.tick();
    expect(s.hp[civ]).toBe(65536);
    // Any further hit kills him, and the side's count comes back down.
    hit(sim, civ, 1, shooter);
    expect(s.alive[civ]).toBe(0);
    expect(s.woundedAlive[0]).toBe(0);
    evs = sim.tick();
    expect(of(evs, 'destroyed')).toEqual([{ kind: 'destroyed', tick: 402, entity: civ, by: shooter }]);
  });

  it('in place with chance 0 dies as today', () => {
    const { sim, squad: civ, shooter } = fallWorld({ ...IN_PLACE, hull: { ...IN_PLACE.hull, wounds: { wound_chance: 0, bleed_s: 60, type: 'wounded_test', in_place: true } } });
    hit(sim, civ, 50, shooter);
    expect(sim.state.alive[civ]).toBe(0);
    expect(sim.state.woundedAlive[0]).toBe(0);
  });

  it('in_place needs a one-man type', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const bad = { ...IN_PLACE, hull: { ...IN_PLACE.hull, figures: 4 } };
    expect(() => sim.addUnitType(bad)).toThrow(/in_place needs hull.figures 1/);
  });

  it('woundedAlive drops on a wounded death or removal, once', () => {
    const { sim, squad, shooter } = fallWorld(squadType(1));
    const before = sim.entityCount;
    hit(sim, squad, 200, shooter); // two wounded
    expect(sim.state.woundedAlive[0]).toBe(2);
    sim.debugKill(before);
    expect(sim.state.woundedAlive[0]).toBe(1);
    sim.debugKill(before); // already dead: no second decrement
    expect(sim.state.woundedAlive[0]).toBe(1);
    // `destroy` reached twice for one death (it is private; every caller guards today):
    // the count is not taken twice.
    (sim as unknown as { destroy(t: number, by: number): void }).destroy(before, -1);
    expect(sim.state.woundedAlive[0]).toBe(1);
    sim.removeFromPlay(before + 1);
    expect(sim.state.woundedAlive[0]).toBe(0);
    // Killing the squad itself (not a wounded) touches nothing.
    sim.debugKill(squad);
    expect(sim.state.woundedAlive[0]).toBe(0);
  });

  it('a wounded hit is an ordinary hit: 30 hp, no falling of his own', () => {
    const { sim, squad, shooter } = fallWorld(squadType(1));
    const before = sim.entityCount;
    hit(sim, squad, 100, shooter);
    hit(sim, before, 30, shooter);
    expect(sim.state.alive[before]).toBe(0);
    expect(sim.entityCount).toBe(before + 1);
    expect(sim.state.woundedAlive[0]).toBe(0);
  });

  it('no wound content: a figures-4 type takes hits exactly as today', () => {
    const FOUR: UnitTypeJson = { ...RIFLES, id: 'wd_four', hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 }, figures: 4 } };
    const sim = new Sim({ seed: 3, width: 16, height: 16, capacity: 8 });
    const ti = sim.addUnitType(FOUR);
    expect(sim.woundsLive).toBe(false);
    const q = sim.spawn(ti, 0, fx.fromInt(5), fx.fromInt(5));
    hit(sim, q, 350, -1);
    expect([sim.entityCount, sim.state.figuresUp[q]]).toEqual([1, 4]);
    for (let t = 0; t < 3000; t++) sim.tick();
    expect(sim.state.hp[q]).toBe(18350000); // the ordinary 0.7 ceiling
  });

  it('the same fight from the same seed sheds the same men (one draw per intermediate man)', () => {
    const run = (): number[] => {
      const { sim, squad, shooter } = fallWorld(squadType(0.5));
      hit(sim, squad, 400, shooter);
      return [sim.entityCount, sim.hash(), ...of(sim.tick(), 'woundedDown').map((e) => e.parent)];
    };
    expect(run()).toEqual(run());
  });
});

// ---------------------------------------------------------------------------
// GH-707 Task 2 review fix (b): the cap in downInPlace.
// ---------------------------------------------------------------------------

describe('the wounded cap in place (GH-707 Task 2 review)', () => {
  it('the 25th downing on a capped side, in place, dies as today: destroyed, no woundedDown', () => {
    const { sim, ti, shooter } = fallWorld(squadType(1), 64);
    const ci = sim.addUnitType(IN_PLACE);
    // Six squads x 4 men = 24 wounded on side 0, the cap.
    for (let k = 0; k < 6; k++) hit(sim, sim.spawn(ti, 0, fx.fromInt(2 + k), fx.fromInt(2)), 400, shooter);
    expect(sim.state.woundedAlive[0]).toBe(24);
    sim.tick();
    const civ = sim.spawn(ci, 0, fx.fromInt(10), fx.fromInt(10));
    hit(sim, civ, 50, shooter); // chance 1: only the cap can kill him
    expect(sim.state.alive[civ]).toBe(0);
    expect(sim.state.woundState[civ]).toBe(0);
    expect(sim.state.woundedAlive[0]).toBe(24);
    const evs = sim.tick();
    expect(of(evs, 'woundedDown')).toEqual([]);
    expect(of(evs, 'destroyed')).toEqual([{ kind: 'destroyed', tick: 2, entity: civ, by: shooter }]);
  });
});

// ---------------------------------------------------------------------------
// GH-707 Task 3: the wounded man -- bleed, crawl, hors de combat.
// ---------------------------------------------------------------------------

/** 400 hp / 4 men, chance 1, bleed 2 s = 40 ticks. */
const BLEEDER: UnitTypeJson = {
  ...RIFLES,
  id: 'wd_bleeder',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 }, figures: 4, wounds: { wound_chance: 1, bleed_s: 2, type: 'wounded_test' } },
};

const GUN = {
  type: 'small_arms',
  range_tiles: 8,
  effective_range_tiles: 6,
  accuracy: 0.6,
  penetration: 8,
  damage: 1,
  suppression: 0,
  rof_per_min: 300,
};

/** An armed enemy rifle team. */
const GUNNERS: UnitTypeJson = { ...RIFLES, id: 'wd_gunners', weapons: [{ id: 'rifle', ...GUN }] };

/** A plain APC: seats, no aura, no medic. */
const APC: UnitTypeJson = {
  id: 'wd_apc',
  role: 'apc',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 }, transport_slots: 4 },
  mobility: { speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8 },
};

interface WoundWorld {
  sim: Sim;
  squad: number;
  shooter: number;
  /** The first wounded the 100-hp hit made. */
  w: number;
  spawnType: (t: UnitTypeJson, side: number, x: number, y: number) => number;
}

/** BLEEDER at (5.5, 5.5) hit for 100 by a far side-1 shooter: one wounded `w` at (5.5, 5.5). */
function woundWorld(sq: UnitTypeJson = BLEEDER): WoundWorld {
  const { sim, squad, shooter } = fallWorld(sq);
  const types = new Map<string, number>();
  const spawnType = (t: UnitTypeJson, side: number, x: number, y: number): number => {
    let ti = types.get(t.id);
    if (ti === undefined) {
      ti = sim.addUnitType(t);
      types.set(t.id, ti);
    }
    return sim.spawn(ti, side, fx.from(x), fx.from(y));
  };
  const w = sim.entityCount;
  hit(sim, squad, 100, shooter);
  expect(sim.state.woundState[w]).toBe(1);
  return { sim, squad, shooter, w, spawnType };
}

/** Ticks until `id` dies (or `max`), with `each` run before every tick. */
function ticksToDeath(sim: Sim, id: number, max: number, each?: () => void): { n: number; evs: SimEvent[] } {
  for (let n = 1; n <= max; n++) {
    each?.();
    const evs = sim.tick();
    if (sim.state.alive[id] === 0) return { n, evs };
  }
  return { n: -1, evs: [] };
}

describe('bleeding (GH-707 Task 3)', () => {
  it('a DOWN wounded with bleed_s 2 dies on his 40th tick: bledOut, then destroyed by the man who downed him', () => {
    const { sim, w, shooter } = woundWorld();
    expect(sim.state.bleedTicks[w]).toBe(40); // 2 s x 20
    const { n, evs } = ticksToDeath(sim, w, 100);
    expect(n).toBe(40);
    const mine = evs.filter((e) => (e.kind === 'bledOut' || e.kind === 'destroyed') && e.entity === w);
    expect(mine).toEqual([
      { kind: 'bledOut', tick: 40, entity: w },
      { kind: 'destroyed', tick: 40, entity: w, by: shooter },
    ]);
    expect(sim.state.woundedAlive[0]).toBe(0);
  });

  it('pinned, he bleeds twice as fast: dead on tick 20 (40 / 2)', () => {
    const { sim, w } = woundWorld();
    expect(ticksToDeath(sim, w, 100, () => (sim.state.pinned[w] = 1)).n).toBe(20);
  });

  it('a friendly medic within 2 tiles pauses the bleed; out of reach, an enemy medic, or a dead one does not', () => {
    // Every medic here is PARKED by a halt (Task 5): left alone he would treat the man, and a
    // STABILISED man never bleeds -- this is the bleed pause alone, not the rescue.
    const { sim, w, spawnType } = woundWorld();
    const medic = spawnType(MEDIC, 0, 6.5, 5.5); // 1 tile off
    sim.queueCommand({ kind: 'halt', ids: [medic] });
    for (let t = 0; t < 200; t++) sim.tick();
    expect([sim.state.alive[w], sim.state.bleedTicks[w]]).toEqual([1, 40]);
    sim.debugKill(medic);
    expect(ticksToDeath(sim, w, 100).n).toBe(40);

    const b = woundWorld();
    const enemyMedic = b.spawnType(MEDIC, 1, 6.5, 5.5); // the enemy's medic
    const farMedic = b.spawnType(MEDIC, 0, 8.5, 5.5); // 3 tiles off: 9 tile^2 > 4
    b.sim.queueCommand({ kind: 'halt', ids: [enemyMedic, farMedic] });
    expect(ticksToDeath(b.sim, b.w, 100).n).toBe(40);

    // Exactly 2 tiles off is in reach (4 tile^2 <= 4).
    const c = woundWorld();
    c.sim.queueCommand({ kind: 'halt', ids: [c.spawnType(MEDIC, 0, 7.5, 5.5)] });
    for (let t = 0; t < 100; t++) c.sim.tick();
    expect(c.sim.state.bleedTicks[c.w]).toBe(40);
  });

  it('a medic downed in place cannot tend: the wounded beside him bleeds out on time (Task 3 review)', () => {
    // A one-man medic type that goes down in place (in_place, chance 1, 30 hp). Standing 1 tile
    // off he pauses the bleed (the case above); downed by a 30-hp hit he is woundState DOWN and
    // woundTended skips him, so the wounded dies on his 40th tick as if alone.
    const MEDIC_DOWNABLE: UnitTypeJson = {
      ...MEDIC_RESCUE_ONLY,
      id: 'wd_medic_downable',
      hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, wounds: { wound_chance: 1, bleed_s: 60, type: 'wounded_test', in_place: true } },
    };
    const { sim, w, shooter, spawnType } = woundWorld();
    const medic = spawnType(MEDIC_DOWNABLE, 0, 6.5, 5.5);
    hit(sim, medic, 30, shooter);
    expect([sim.state.alive[medic], sim.state.woundState[medic]]).toEqual([1, 1]);
    expect(ticksToDeath(sim, w, 100).n).toBe(40);
  });

  it('a friendly carrier pauses it inside its stabilise radius (1.5) and not outside it', () => {
    const a = woundWorld();
    a.spawnType(AMBULANCE, 0, 6.5, 5.5); // 1 tile: 1 <= 2.25
    for (let t = 0; t < 100; t++) a.sim.tick();
    expect(a.sim.state.bleedTicks[a.w]).toBe(40);
    const b = woundWorld();
    b.spawnType(AMBULANCE, 0, 7.5, 5.5); // 2 tiles: 4 > 2.25
    expect(ticksToDeath(b.sim, b.w, 100).n).toBe(40);
  });

  it('carried, he does not bleed', () => {
    const { sim, w, spawnType } = woundWorld();
    const apc = spawnType(APC, 0, 5.5, 5.5);
    (sim as unknown as { seat(car: number, id: number): void }).seat(apc, w);
    for (let t = 0; t < 100; t++) sim.tick();
    expect([sim.state.alive[w], sim.state.bleedTicks[w]]).toEqual([1, 40]);
  });

  it('STABILISED never bleeds', () => {
    const { sim, w } = woundWorld();
    sim.state.woundState[w] = 2;
    for (let t = 0; t < 100; t++) sim.tick();
    expect([sim.state.alive[w], sim.state.bleedTicks[w]]).toEqual([1, 40]);
  });
});

describe('crawling to cover (GH-707 Task 3)', () => {
  const SLOW: UnitTypeJson = { ...BLEEDER, id: 'wd_slow', hull: { ...BLEEDER.hull, wounds: { wound_chance: 1, bleed_s: 60, type: 'wounded_test' } } };

  it('a crawler on cover 0 beside a cover-2 tile crawls onto it at his own speed and stops', () => {
    const { sim, w } = woundWorld(SLOW);
    sim.setCover(6, 5, 2);
    const s = sim.state;
    // 0.12 tiles/s: 0.12 x 65536 = 7864; x DT 3277 >> 16 = 393 a tick at most (fx.sqrt of the
    // shrinking gap rounds the direction, so a tick may come out a few units short; 390 is
    // the floor asserted). Tile 6 starts 0.5 tile (32768) east of 5.5 (360448):
    // 80 x 393 = 31440 short of it; 85 x 390 = 33150 onto it.
    for (let t = 0; t < 80; t++) sim.tick();
    expect(s.posX[w] >> 16).toBe(5);
    expect(s.posX[w]).toBeGreaterThanOrEqual(360448 + 80 * 390);
    expect(s.posX[w]).toBeLessThanOrEqual(360448 + 80 * 393);
    for (let t = 0; t < 5; t++) sim.tick();
    expect(s.posX[w] >> 16).toBe(6);
    expect(s.posY[w]).toBe(360448);
    const stopped = s.posX[w];
    expect(stopped).toBeLessThan(393216 + 393); // he stopped on the first tick onto the tile (6.0 = 393216)
    for (let t = 0; t < 200; t++) sim.tick();
    expect([s.posX[w], s.posY[w]]).toEqual([stopped, 360448]);
    expect(s.moving[w]).toBe(0);
  });

  it('an off-centre diagonal crawl that would cut a blocked corner stops at the wall', () => {
    // He lies at (5.9, 5.1), inside tile (5,5); cover 2 at (6,6), the diagonal neighbour, which
    // bestCoverTile takes (a one-away tile has nothing between it and the start CENTRE). His own
    // line to (6.5, 6.5) crosses x = 6 at y = 5.1 + 1.4 x 0.1 / 0.6 = 5.33: tile (6,5),
    // blocked. The crawl's own blocked-tile guard is what stops him there.
    const { sim, w } = woundWorld(SLOW);
    sim.setCover(6, 6, 2);
    sim.setBlocked(6, 5, true);
    const s = sim.state;
    s.posX[w] = fx.from(5.9);
    s.posY[w] = fx.from(5.1);
    const start = [s.posX[w], s.posY[w]];
    let walled = 0;
    for (let t = 0; t < 200; t++) {
      sim.tick();
      if (s.posX[w] >> 16 === 6 && s.posY[w] >> 16 === 5) walled++;
    }
    expect(walled).toBe(0);
    // He crawled up to the wall's edge (x just under 6.0 = 393216) and lies there.
    expect(s.posX[w]).toBeLessThan(393216);
    expect(s.posX[w]).toBeGreaterThanOrEqual(start[0]);
  });

  it('with no better cover in reach he lies still', () => {
    const { sim, w } = woundWorld(SLOW);
    sim.setCover(9, 5, 3); // four tiles off: outside the 5x5
    for (let t = 0; t < 100; t++) sim.tick();
    expect([sim.state.posX[w], sim.state.posY[w]]).toEqual([360448, 360448]);
  });

  it('a tended wounded does not crawl', () => {
    const { sim, w, spawnType } = woundWorld(SLOW);
    sim.setCover(6, 5, 2);
    spawnType(MEDIC, 0, 5.5, 7.0);
    for (let t = 0; t < 100; t++) sim.tick();
    expect([sim.state.posX[w], sim.state.posY[w]]).toEqual([360448, 360448]);
  });

  it('no order moves him, and no autonomous `moving` walks him', () => {
    const { sim, w, squad } = woundWorld(SLOW);
    sim.queueCommand({ kind: 'move', ids: [w, squad], x: fx.from(10.5), y: fx.from(5.5) });
    sim.tick();
    expect(sim.state.moving[w]).toBe(0);
    expect(sim.state.moving[squad]).toBe(1); // the squad in the same order went
    // A `moving` set behind the orders' back (a rout is one such setter) takes no step: a goal
    // 5 tiles east, with him lying on cover 2 so his own crawl (which steers by the same goal
    // columns) stays put.
    sim.setCover(5, 5, 2);
    (sim as unknown as { goalX: Int32Array }).goalX[w] = fx.from(10.5);
    sim.state.moving[w] = 1;
    for (let t = 0; t < 30; t++) sim.tick();
    expect([sim.state.posX[w], sim.state.posY[w]]).toEqual([360448, 360448]);
  });
});

describe('hors de combat (GH-707 Task 3)', () => {
  /** The whole squad down in one hit (4 wounded, no squad left), an identified enemy rifle
   *  team 3 tiles east, and a wounded-role body spawned bare (woundState NONE). */
  function field(): { sim: Sim; rifle: number; wounded: number[] } {
    const { sim, squad, shooter } = fallWorld({ ...BLEEDER, id: 'wd_b60', hull: { ...BLEEDER.hull, wounds: { wound_chance: 1, bleed_s: 60, type: 'wounded_test' } } });
    const first = sim.entityCount;
    hit(sim, squad, 400, shooter);
    const bare = sim.spawn(sim.unitTypes.findIndex((t) => t.id === 'wounded_test'), 0, fx.from(5.5), fx.from(6.5));
    const rifle = sim.spawn(sim.addUnitType(GUNNERS), 1, fx.from(8.5), fx.from(5.5));
    const wounded = [first, first + 1, first + 2, first + 3, bare];
    for (const t of wounded) sim.identifyTo(1, t);
    return { sim, rifle, wounded };
  }

  it('an enemy rifle team beside them never fires at a wounded man, of either kind', () => {
    const { sim, rifle, wounded } = field();
    let fires = 0;
    for (let t = 0; t < 100; t++) {
      for (const k of wounded) sim.identifyTo(1, k);
      fires += of(sim.tick(), 'fire').filter((e) => e.shooter === rifle).length;
    }
    expect(fires).toBe(0);
    for (const k of wounded) expect(sim.state.alive[k]).toBe(1);
  });

  it('canFocus refuses him and an attack order on him changes nothing', () => {
    const { sim, rifle, wounded } = field();
    for (const k of wounded) expect(sim.canFocus(rifle, k)).toBe(false);
    sim.queueCommand({ kind: 'attack', ids: [rifle], target: wounded[0] });
    sim.tick();
    expect(sim.state.focusTarget[rifle]).toBe(-1);
  });

  it('a loitering munition does not dive at him', () => {
    const { sim, wounded } = field();
    const MUNITION: UnitTypeJson = {
      id: 'wd_munition',
      role: 'drone',
      hull: { hp: 90, armor: { front: 0, side: 0, rear: 0 } },
      mobility: { speed_tiles_s: 2.8, domain: 'air' },
      sensors: { optics: 1, sight_tiles: 13, signature: 0.3 },
      abilities: ['kamikaze'],
      weapons: [{ id: 'warhead', type: 'heat', range_tiles: 1.2, effective_range_tiles: 1.2, accuracy: 0.9, penetration: 480, damage: 520, splash_tiles: 1.2, suppression: 70, rof_per_min: 6 }],
    };
    const m = sim.spawn(sim.addUnitType(MUNITION), 1, fx.from(12.5), fx.from(5.5));
    for (let t = 0; t < 20; t++) {
      for (const k of wounded) sim.identifyTo(1, k);
      sim.tick();
    }
    expect(sim.state.curTarget[m]).toBe(-1);
    for (const k of wounded) expect(sim.state.alive[k]).toBe(1);
  });

  it('splash still finds him', () => {
    const { sim, wounded } = field();
    sim.debugSplash(fx.from(5.5), fx.from(5.5), fx.fromInt(1), fx.fromInt(100), 0, -1, -1);
    for (const k of wounded.slice(0, 4)) expect(sim.state.alive[k]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GH-707 Task 2 review fix (a): a downed civilian is no longer a fleeing family.
// ---------------------------------------------------------------------------

describe('a downed civilian and CivilianFlight (GH-707)', () => {
  const CIV: UnitTypeJson = { ...IN_PLACE, id: 'wd_civ_walk', mobility: { speed_tiles_s: 0.8 } };
  const REFUGE: readonly [Fx, Fx] = [fx.from(12.5), fx.from(12.5)];

  function civWorld(): { sim: Sim; civ: number; shooter: number; flight: CivilianFlight } {
    const sim = new Sim({ seed: 0x7070_0003, width: 16, height: 16, capacity: 16 });
    const ci = sim.addUnitType(CIV);
    sim.addUnitType(WOUNDED);
    const ri = sim.addUnitType(RIFLES);
    const civ = sim.spawn(ci, 2, fx.from(5.5), fx.from(5.5));
    const shooter = sim.spawn(ri, 1, fx.from(14.5), fx.from(1.5));
    sim.tick();
    return { sim, civ, shooter, flight: new CivilianFlight({ shepherd: false }) };
  }

  it('step: a downed civilian under fire is not ordered out and not latched as fled', () => {
    const { sim, civ, shooter, flight } = civWorld();
    hit(sim, civ, 50, shooter);
    expect(sim.state.woundState[civ]).toBe(1);
    sim.state.suppression[civ] = CIV_FLEE_AT + 1;
    flight.step(sim, [civ], [], REFUGE);
    sim.tick();
    expect(flight.hasFled(civ)).toBe(false);
    expect(sim.state.moving[civ]).toBe(0);
    // Control: the same fear on a standing civilian sends him.
    const b = civWorld();
    b.sim.state.suppression[b.civ] = CIV_FLEE_AT + 1;
    b.flight.step(b.sim, [b.civ], [], REFUGE);
    b.sim.tick();
    expect(b.flight.hasFled(b.civ)).toBe(true);
    expect(b.sim.state.moving[b.civ]).toBe(1);
  });

  it('step: one who fled and was then downed is not re-ordered', () => {
    const { sim, civ, shooter, flight } = civWorld();
    sim.state.suppression[civ] = CIV_FLEE_AT + 1;
    flight.step(sim, [civ], [], REFUGE);
    sim.tick();
    expect(sim.state.moving[civ]).toBe(1);
    hit(sim, civ, 50, shooter); // down in place: moving 0
    flight.step(sim, [civ], [], REFUGE);
    sim.tick();
    expect(sim.state.moving[civ]).toBe(0);
  });

  it('collect: a downed civilian lying in the zone is not evacuated; a standing one is', () => {
    const { sim, civ, shooter, flight } = civWorld();
    hit(sim, civ, 50, shooter);
    const zone = [4, 4, 4, 4]; // tiles 4..7: (5,5) is inside
    expect(flight.collect(sim, [civ], zone)).toEqual([]);
    expect(sim.state.alive[civ]).toBe(1);
    expect(sim.state.woundedAlive[2]).toBe(1);
    const b = civWorld();
    expect(b.flight.collect(b.sim, [b.civ], zone)).toEqual([b.civ]);
  });
});
