import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import catalogue from '../../../data/structures.json';
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
    const units = shippedUnits();
    expect(units.length).toBeGreaterThan(30); // the walk found the roster, not an empty dir
    for (const u of units) sim.addUnitType(u);
    for (const s of Object.values(catalogue.types)) sim.addStructureType(s as StructureTypeJson);
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
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    sim.addStructureType({ id: 'wd_house', hp_per_tile: 100 });
    expect(sim.woundsLive).toBe(false);
    sim.addStructureType(AID_POST);
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
