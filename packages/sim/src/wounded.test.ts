import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import catalogue from '../../../data/structures.json';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
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
