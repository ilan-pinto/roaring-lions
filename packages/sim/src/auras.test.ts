// Field works (#277) Task 6: the `aura` parse, stepAuras, heal / repair / components /
// accuracy, and the garrison range and sight bonuses. Spec
// docs/superpowers/specs/2026-09-29-field-works-design.md §3; plan Task 6.
//
// Every expected number is a literal with its hand arithmetic beside it, never a value
// read back from the code under test.
import { describe, expect, it } from 'vitest';
import { fx, type Fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { structureTypeFromJson, type StructureTypeJson } from './structures';

const MEDIC: StructureTypeJson = {
  id: 'a_medic', hp_per_tile: 200, garrison_slots: 0,
  aura: { area: [{ radius: 4, affects: 'foot', heal_per_s: 0.01, heal_cap: 1 }] },
};
const CLINIC: StructureTypeJson = {
  id: 'a_clinic', hp_per_tile: 200,
  aura: { area: [{ radius: 3, affects: 'foot', heal_per_s: 0.0075, heal_cap: 1 }] },
};
const WORKSHOP: StructureTypeJson = {
  id: 'a_workshop', hp_per_tile: 300,
  aura: {
    area: [
      { radius: 4, affects: 'vehicle', repair_per_s: 0.01, repair_components_s: 30 },
      { radius: 4, affects: 'any', accuracy_mult: 1.06 },
    ],
  },
};
/** A garrisonable outpost: +1 tile range on top of the global +1, +2 sight. */
const OUTPOST: StructureTypeJson = {
  id: 'a_outpost', hp_per_tile: 400, garrison_slots: 2,
  aura: { garrison: { range_bonus: 1, sight_bonus: 2 } },
};
/** The same building authoring no bonus: what shipped data will carry (range_bonus 0). */
const OUTPOST_ZERO: StructureTypeJson = {
  id: 'a_outpost0', hp_per_tile: 400, garrison_slots: 2,
  aura: { garrison: { range_bonus: 0, sight_bonus: 0 } },
};
const HOUSE: StructureTypeJson = { id: 'a_house', hp_per_tile: 260, garrison_slots: 2 };

const RIFLE_WEAPON = {
  id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6,
  penetration: 8, damage: 15, suppression: 50, rof_per_min: 300,
};
const SQUAD: UnitTypeJson = {
  id: 'a_squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [RIFLE_WEAPON],
};
/** Accuracy 0.99: x1.06 overshoots ONE, so the cap is visible. */
const SHARP: UnitTypeJson = {
  ...SQUAD, id: 'a_sharp',
  weapons: [{ ...RIFLE_WEAPON, id: 'sharp', accuracy: 0.99 }],
};
const MORTAR: UnitTypeJson = {
  ...SQUAD, id: 'a_mortar', role: 'artillery',
  weapons: [{
    id: 'm60', type: 'mortar', range_tiles: 18, effective_range_tiles: 14, accuracy: 0.3,
    damage: 60, splash_tiles: 1, suppression: 60, rof_per_min: 12, fires_from_building: true,
  }],
};
const TANK: UnitTypeJson = {
  id: 'a_tank', role: 'mbt',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1, sight_tiles: 12, signature: 1 },
  weapons: [],
};
const DRONE: UnitTypeJson = {
  id: 'a_drone', role: 'drone',
  hull: { hp: 120, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 2.2, domain: 'air' },
  sensors: { optics: 2, sight_tiles: 16, signature: 0.3 },
};
const DUMMY: UnitTypeJson = {
  id: 'a_dummy', role: 'infantry',
  hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};

function world() {
  const sim = new Sim({ seed: 11, width: 48, height: 32, capacity: 32 });
  const t = {
    medic: sim.addStructureType(MEDIC),
    workshop: sim.addStructureType(WORKSHOP),
    outpost: sim.addStructureType(OUTPOST),
    outpost0: sim.addStructureType(OUTPOST_ZERO),
    house: sim.addStructureType(HOUSE),
  };
  const u = {
    squad: sim.addUnitType(SQUAD),
    sharp: sim.addUnitType(SHARP),
    mortar: sim.addUnitType(MORTAR),
    tank: sim.addUnitType(TANK),
    drone: sim.addUnitType(DRONE),
    dummy: sim.addUnitType(DUMMY),
  };
  return { sim, t, u };
}

function rect(sim: Sim, typeIdx: number, x: number, y: number, opts?: { owner?: number; progress?: Fx }): number {
  const tiles: number[] = [];
  for (let ty = y; ty < y + 2; ty++) for (let tx = x; tx < x + 2; tx++) tiles.push(ty * sim.width + tx);
  return sim.addStructure(typeIdx, tiles, opts);
}

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

/** The one damage path a hit takes (applyDamage stamps lastDamagedTick). */
function damage(sim: Sim, id: number, hp: number): void {
  (sim as unknown as { applyDamage(t: number, d: Fx, by: number): void }).applyDamage(id, fx.fromInt(hp), -1);
}

function garrison(sim: Sim, id: number, s: number): void {
  sim.queueCommand({ kind: 'garrison', ids: [id], structure: s });
  for (let k = 0; k < 400; k++) {
    sim.tick();
    if (sim.state.garrisonedIn[id] === s) return;
  }
  throw new Error(`unit ${id} never got into structure ${s}`);
}

// A 2x2 at (20,14) has its centroid at (21, 15). (23.5, 15.5) is 2.5^2 + 0.5^2 = 6.5 tile^2
// from it, inside radius 4 (16); (26.5, 15.5) is 30.25 + 0.25 = 30.5, outside.
const IN_X = 23.5;
const OUT_X = 26.5;
const ROW_Y = 15.5;

describe('aura parse (Q16.16 at load)', () => {
  const t = (j: StructureTypeJson) => structureTypeFromJson(j, 20);
  it('the medic rate is 33 raw: fx.from(0.010) = 655, (655 + 10) / 20 = 33 (fx.div would give 32)', () => {
    expect(t(MEDIC).aura?.area[0]?.healRate).toBe(33);
  });
  it("the militia clinic's 0.0075/s is 25 raw: fx.from = 492, (492 + 10) / 20 = 25", () => {
    expect(t(CLINIC).aura?.area[0]?.healRate).toBe(25);
  });
  it('x1.06 is 69468 (1.06 x 65536 = 69468.16)', () => {
    expect(t(WORKSHOP).aura?.area[1]?.accMult).toBe(69468);
  });
  it('repair reads repair_per_s, its cap defaults to ONE, and 30 s of components is 600 ticks', () => {
    const e = t(WORKSHOP).aura?.area[0];
    expect(e?.healRate).toBe(33);
    expect(e?.healCap).toBe(65536);
    expect(e?.compTicks).toBe(600);
    expect(e?.radiusSq).toBe(16 * 65536);
  });
  it('a type with no aura parses to null; garrison bonuses are tiles in Q16.16', () => {
    expect(t(HOUSE).aura).toBeNull();
    expect(t(OUTPOST).aura?.rangeBonus).toBe(65536);
    expect(t(OUTPOST).aura?.sightBonus).toBe(131072);
  });
  it('an unknown affects is refused', () => {
    expect(() => t({ id: 'x', hp_per_tile: 1, aura: { area: [{ radius: 1, affects: 'air' }] } })).toThrow(/affects/);
  });
});

// Squad hp 400 = 26214400 raw. 30% is 120 hp = 7864320 raw (280 taken at tick 0).
// Medic: fx.mul(26214400, 33) = 400 x 33 = 13200 raw a tick. Delay: REGEN_DELAY_TICKS 200,
// so the first heal is tick 200. (26214400 - 7864320) / 13200 = 1390.15 -> the 1391st heal
// tick, tickCount 200 + 1390 = 1590, lands on full: full after 1591 ticks, not after 1590.
describe('medic station', () => {
  function healed(opts: { x?: number; medics?: number; progress?: Fx; side?: number; type?: 'squad' | 'tank' } = {}) {
    const { sim, t, u } = world();
    const s = rect(sim, t.medic, 20, 14, { owner: 0, progress: opts.progress });
    if ((opts.medics ?? 1) > 1) rect(sim, t.medic, 20, 17, { owner: 0 });
    const id = sim.spawn(u[opts.type ?? 'squad'], opts.side ?? 0, fx.from(opts.x ?? IN_X), fx.from(ROW_Y));
    const hp = opts.type === 'tank' ? 3000 : 400;
    damage(sim, id, (hp * 7) / 10);
    return { sim, id, s };
  }

  it('waits 200 ticks, then heals 13200 raw a tick', () => {
    const { sim, id } = healed();
    run(sim, 200);
    expect(sim.state.hp[id]).toBe(7864320);
    run(sim, 1);
    expect(sim.state.hp[id]).toBe(7864320 + 13200);
    expect(sim.state.auraHealRate[id]).toBe(33);
  });
  it('to full HP on the hand-computed tick', () => {
    const { sim, id } = healed();
    run(sim, 1590);
    expect(sim.state.hp[id]).toBe(7864320 + 1390 * 13200); // 26212320, one short
    run(sim, 1);
    expect(sim.state.hp[id]).toBe(26214400);
  });
  // Field regen: 400 x 16 = 6400 raw a tick to 0.7 = 400 x 45875 = 18350000.
  // (18350000 - 7864320) / 6400 = 1638.39 -> 1639 ticks from tick 200: capped after 1839.
  it('outside the radius it caps at 0.7 at the field rate', () => {
    const { sim, id } = healed({ x: OUT_X });
    run(sim, 201);
    expect(sim.state.hp[id]).toBe(7864320 + 6400);
    run(sim, 1638);
    expect(sim.state.hp[id]).toBe(18350000);
    run(sim, 400);
    expect(sim.state.hp[id]).toBe(18350000);
  });
  // Tank 3000 hp: field regen 3000 x 16 = 48000 raw a tick; 30% = 900 hp = 58982400 raw.
  it('a vehicle in the medic radius gets field regen only', () => {
    const { sim, id } = healed({ type: 'tank' });
    run(sim, 201);
    expect(sim.state.auraHealRate[id]).toBe(0);
    expect(sim.state.hp[id]).toBe(58982400 + 48000);
  });
  it('two overlapping medics give the same rate as one', () => {
    const two = healed({ medics: 2 });
    run(two.sim, 201);
    expect(two.sim.state.auraHealRate[two.id]).toBe(33);
    expect(two.sim.state.hp[two.id]).toBe(7864320 + 13200);
  });
  it('nothing while the station is unfinished', () => {
    const { sim, id } = healed({ progress: fx.from(0.5) });
    run(sim, 201);
    expect(sim.state.auraHealRate[id]).toBe(0);
    expect(sim.state.hp[id]).toBe(7864320 + 6400);
  });
  it('nothing after it is destroyed (from the next cadence tick)', () => {
    const { sim, id, s } = healed();
    run(sim, 20);
    expect(sim.state.auraHealRate[id]).toBe(33);
    sim.debugDestroyStructure(s);
    run(sim, 10); // ticks 20..29: tick 20 refreshes
    expect(sim.state.auraHealRate[id]).toBe(0);
    expect(sim.state.auraHealCap[id]).toBe(0);
  });
  it("nothing for the other side's units", () => {
    const { sim, id } = healed({ side: 1 });
    run(sim, 201);
    expect(sim.state.auraHealRate[id]).toBe(0);
    expect(sim.state.hp[id]).toBe(7864320 + 6400);
  });
  it('nothing for a unit garrisoned inside the radius', () => {
    const { sim, t, u } = world();
    rect(sim, t.medic, 20, 14, { owner: 0 });
    const house = rect(sim, t.house, 23, 14); // centroid (24, 15): 9 + 0 = 9 tile^2 from (21, 15)
    const id = sim.spawn(u.squad, 0, fx.from(IN_X), fx.from(13.5));
    garrison(sim, id, house);
    run(sim, 20);
    expect(sim.state.auraHealRate[id]).toBe(0);
    // The control: the same unit standing at the door is covered.
    const out = sim.spawn(u.squad, 0, fx.from(IN_X), fx.from(13.5));
    run(sim, 10);
    expect(sim.state.auraHealRate[out]).toBe(33);
  });
  it('nothing in a world with no owned station: the arrays stay at rest', () => {
    const { sim, t, u } = world();
    rect(sim, t.medic, 20, 14); // neutral: owner -1
    const id = sim.spawn(u.squad, 0, fx.from(IN_X), fx.from(ROW_Y));
    run(sim, 20);
    expect(sim.state.auraHealRate[id]).toBe(0);
    expect(sim.state.auraAccMult[id]).toBe(65536);
  });
});

describe('cadence (AURA_CADENCE_TICKS 10)', () => {
  it('a unit entering the radius at tick 11 gets the rate at tick 20, not before', () => {
    const { sim, t, u } = world();
    rect(sim, t.medic, 20, 14, { owner: 0 });
    const id = sim.spawn(u.squad, 0, fx.from(OUT_X), fx.from(ROW_Y));
    run(sim, 11); // ticks 0..10
    sim.teleport(id, fx.from(IN_X), fx.from(ROW_Y));
    run(sim, 9); // ticks 11..19
    expect(sim.state.auraHealRate[id]).toBe(0);
    run(sim, 1); // tick 20
    expect(sim.state.auraHealRate[id]).toBe(33);
  });
});

// Tank 3000 hp: 3000 x 33 = 99000 raw a tick. 30% = 58982400 raw; full = 196608000.
// (196608000 - 58982400) / 99000 = 1390.16 -> full on tickCount 1590, after 1591 ticks.
describe('workshop', () => {
  function shop() {
    const { sim, t, u } = world();
    const s = rect(sim, t.workshop, 20, 14, { owner: 0 });
    const id = sim.spawn(u.tank, 0, fx.from(IN_X), fx.from(ROW_Y));
    return { sim, u, s, id };
  }
  it('a tank at 30% reaches full on the hand-computed tick', () => {
    const { sim, id } = shop();
    damage(sim, id, 2100);
    run(sim, 1590);
    expect(sim.state.hp[id]).toBe(58982400 + 1390 * 99000); // 196592400
    run(sim, 1);
    expect(sim.state.hp[id]).toBe(196608000);
  });
  // compAt 600. Tick 0 refreshes compAt, upkeep counts 1; tick 599 counts 600 and clears.
  it('mobilityKilled clears after 600 covered, undamaged ticks', () => {
    const { sim, id } = shop();
    sim.state.mobilityKilled[id] = 1;
    sim.state.firepowerKilled[id] = 1;
    run(sim, 599);
    expect(sim.state.mobilityKilled[id]).toBe(1);
    expect(sim.state.auraRepairTicks[id]).toBe(599);
    run(sim, 1);
    expect(sim.state.mobilityKilled[id]).toBe(0);
    expect(sim.state.firepowerKilled[id]).toBe(0);
  });
  // Hit on tick 599 resets the count to 0; ticks 600..1199 count 1..600: clear after 1200.
  it('and a hit on tick 599 restarts the count', () => {
    const { sim, id } = shop();
    sim.state.mobilityKilled[id] = 1;
    run(sim, 599);
    damage(sim, id, 10);
    run(sim, 1);
    expect(sim.state.mobilityKilled[id]).toBe(1);
    expect(sim.state.auraRepairTicks[id]).toBe(0);
    run(sim, 599); // to tick 1198
    expect(sim.state.mobilityKilled[id]).toBe(1);
    run(sim, 1);
    expect(sim.state.mobilityKilled[id]).toBe(0);
  });
  it('outside the radius a mobility kill stays', () => {
    const { sim, t, u } = world();
    rect(sim, t.workshop, 20, 14, { owner: 0 });
    const id = sim.spawn(u.tank, 0, fx.from(OUT_X), fx.from(ROW_Y));
    sim.state.mobilityKilled[id] = 1;
    run(sim, 700);
    expect(sim.state.mobilityKilled[id]).toBe(1);
  });
  it('an air unit is excluded from both areas', () => {
    const { sim, u } = shop();
    const d = sim.spawn(u.drone, 0, fx.from(IN_X), fx.from(16.5));
    const foot = sim.spawn(u.squad, 0, fx.from(IN_X), fx.from(13.5)); // the control: "any" covers foot
    run(sim, 1);
    expect(sim.state.auraAccMult[d]).toBe(65536);
    expect(sim.state.auraCompAt[d]).toBe(0);
    expect(sim.state.auraHealRate[d]).toBe(0);
    expect(sim.state.auraAccMult[foot]).toBe(69468);
    expect(sim.state.auraCompAt[foot]).toBe(0);
  });
});

describe('accuracy', () => {
  function acc(type: 'squad' | 'sharp', x: number, vet: number): number {
    const { sim, t, u } = world();
    rect(sim, t.workshop, 20, 14, { owner: 0 });
    const id = sim.spawn(u[type], 0, fx.from(x), fx.from(ROW_Y), 0, vet);
    const tgt = sim.spawn(u.dummy, 1, fx.from(x), fx.from(ROW_Y + 4));
    run(sim, 1);
    sim.identifyTo(0, tgt);
    const p = sim.projectHit(id, tgt);
    if (p.kind !== 'shot') throw new Error(`no shot: ${p.kind}`);
    return p.factors.accuracy;
  }
  // fx.from(0.6) = 39322; x 69468 (1 + VET_ACC_BONUS 3932, and x1.06): fx.mul = 41681.
  it('a vet-0 unit in a x1.06 area shoots as a vet-1 unit outside it (one veterancy level)', () => {
    expect(acc('squad', IN_X, 0)).toBe(41681);
    expect(acc('squad', OUT_X, 1)).toBe(41681);
    expect(acc('squad', OUT_X, 0)).toBe(39322); // the control
  });
  // 0.99 x 1.06 = 1.0494: capped at ONE.
  it('capped at ONE', () => {
    expect(acc('sharp', IN_X, 0)).toBe(65536);
    expect(acc('sharp', OUT_X, 0)).toBe(64881); // fx.from(0.99) = 64880.64 -> 64881
  });
});

// Outpost 2x2 at (20,14); the man inside fights from the east window (21.5, 14.5).
describe('garrison range and sight', () => {
  function shot(
    type: 'outpost' | 'outpost0' | 'house',
    beyond: number,
    opts: { unit?: 'squad' | 'mortar'; side?: number; owner?: number } = {}
  ): string {
    const { sim, t, u } = world();
    const s = rect(sim, t[type], 20, 14, { owner: opts.owner ?? (type === 'house' ? -1 : 0) });
    const side = opts.side ?? 0;
    const id = sim.spawn(u[opts.unit ?? 'squad'], side, fx.from(19.5), fx.from(14.5));
    garrison(sim, id, s);
    const target = sim.spawn(u.dummy, 1 - side, fx.from(21.5 + beyond), fx.from(14.5));
    sim.identifyTo(side, target);
    return sim.projectHit(id, target).kind;
  }
  // Rifle 8 + global 1 + range_bonus 1 = 10 from the window.
  it('range_bonus 1: a garrisoned rifle reaches 8 + 1 + 1 = 10', () => expect(shot('outpost', 9.75)).toBe('shot'));
  it('and not beyond', () => expect(shot('outpost', 10.25)).toBe('noSolution'));
  // range_bonus 0: exactly today's reach, 8 + 1 = 9.
  it('range_bonus 0 is exactly today: 9.75 is out of reach', () => expect(shot('outpost0', 9.75)).toBe('noSolution'));
  it('and 8.75 is in it', () => expect(shot('outpost0', 8.75)).toBe('shot'));
  it('a plain house reaches 9 too (the global bonus alone)', () => expect(shot('house', 9.75)).toBe('noSolution'));
  // Mortar 18 + global 1 = 19; range_bonus excluded for indirect fire.
  it('a garrisoned mortar gets no range_bonus: 19.25 is out of reach', () =>
    expect(shot('outpost', 19.25, { unit: 'mortar' })).toBe('noSolution'));
  it('and 18.75 is in it (the control)', () => expect(shot('outpost', 18.75, { unit: 'mortar' })).toBe('shot'));
  it("an enemy inside a side-0 outpost gets the window, not the owner's bonus", () =>
    expect(shot('outpost', 9.75, { side: 1 })).toBe('noSolution'));

  it('the falloff reads the bonused effective range', () => {
    function falloff(type: 'outpost' | 'outpost0'): number {
      const { sim, t, u } = world();
      const s = rect(sim, t[type], 20, 14, { owner: 0 });
      const id = sim.spawn(u.squad, 0, fx.from(19.5), fx.from(14.5));
      garrison(sim, id, s);
      const target = sim.spawn(u.dummy, 1, fx.from(27.5), fx.from(14.5)); // 6 from the window
      sim.identifyTo(0, target);
      const p = sim.projectHit(id, target);
      if (p.kind !== 'shot') throw new Error('no shot');
      return p.factors.rangeFalloff;
    }
    expect(falloff('outpost')).toBeGreaterThan(falloff('outpost0'));
  });

  // Squad sight 8; +2 = 10. A target 9.5 tiles east of the window.
  function sees(type: 'outpost' | 'outpost0', beyond: number): boolean {
    const { sim, t, u } = world();
    const s = rect(sim, t[type], 20, 14, { owner: 0 });
    const id = sim.spawn(u.squad, 0, fx.from(19.5), fx.from(14.5));
    garrison(sim, id, s);
    const target = sim.spawn(u.dummy, 1, fx.from(21.5 + beyond), fx.from(14.5));
    return sim.debugDetection(id, target)?.visible ?? false;
  }
  it('with sight_bonus 2 a garrisoned squad (sight 8) detects at 9.5', () => expect(sees('outpost', 9.5)).toBe(true));
  it('and not at 10.5', () => expect(sees('outpost', 10.5)).toBe(false));
  it('with sight_bonus 0 it does not detect at 9.5 (the control)', () => expect(sees('outpost0', 9.5)).toBe(false));

  // The owned-structure latch measures sight from the window too. An enemy-owned house at
  // x 30-31: its nearest tile centre (30.5, 14.5) is 9 tiles from the window, past sight 8
  // and inside 8 + 2.
  it('the owned-structure latch reads the sight bonus', () => {
    function latched(type: 'outpost' | 'outpost0'): boolean {
      const { sim, t, u } = world();
      const s = rect(sim, t[type], 20, 14, { owner: 0 });
      const enemy = rect(sim, t.house, 30, 14, { owner: 1 });
      const id = sim.spawn(u.squad, 0, fx.from(19.5), fx.from(14.5));
      garrison(sim, id, s);
      run(sim, 1);
      return sim.structureKnownTo(0, enemy);
    }
    expect(latched('outpost')).toBe(true);
    expect(latched('outpost0')).toBe(false);
  });
});
