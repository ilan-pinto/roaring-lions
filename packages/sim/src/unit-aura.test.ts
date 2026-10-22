// E1 (GH-709): the field-works aura carried by a unit. Spec
// docs/superpowers/specs/2026-10-22-special-units-design.md §2 E1. The same `aura.area`
// shape a structure carries, read by the same stepAuras pass into the same columns, plus
// two unit-only parts: `affects: "passengers"` and `stationary`.
//
// Every expected number is a literal with its hand arithmetic beside it, never a value
// read back from the code under test.
import { describe, expect, it } from 'vitest';
import { fx, type Fx } from './fixed';
import { Sim, unitTypeFromJson, type UnitTypeJson } from './sim';
import { structureTypeFromJson, type StructureTypeJson } from './structures';

const SQUAD: UnitTypeJson = {
  id: 'ua_squad', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};
/** The spec's medic squad aura: radius 2.5, foot, 0.02/s, cap 1, stationary. */
const MEDIC: UnitTypeJson = {
  ...SQUAD, id: 'ua_medic', role: 'support',
  aura: { area: [{ radius: 2.5, affects: 'foot', heal_per_s: 0.02, heal_cap: 1, stationary: true }] },
};
/** The same aura without `stationary`, for the moving control. */
const MEDIC_ALWAYS: UnitTypeJson = {
  ...SQUAD, id: 'ua_medic_always', role: 'support',
  aura: { area: [{ radius: 2.5, affects: 'foot', heal_per_s: 0.02, heal_cap: 1 }] },
};
const TANK: UnitTypeJson = {
  id: 'ua_tank', role: 'mbt',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1, sight_tiles: 12, signature: 1 },
  weapons: [],
};
/** A ground carrier healing its riders (`passengers`) at 0.03/s, the medevac's rate. */
const AMBULANCE: UnitTypeJson = {
  id: 'ua_ambulance', role: 'apc',
  hull: { hp: 1700, armor: { front: 240, side: 150, rear: 90 }, transport_slots: 4 },
  mobility: { speed_tiles_s: 1.4 },
  sensors: { optics: 1, sight_tiles: 8 },
  aura: { area: [{ radius: 1, affects: 'passengers', heal_per_s: 0.03 }] },
};
/** The medevac: an air carrier whose only effect is `passengers`. */
const MEDEVAC: UnitTypeJson = {
  id: 'ua_medevac', role: 'apc',
  hull: { hp: 800, armor: { front: 32, side: 20, rear: 14 }, transport_slots: 4 },
  mobility: { speed_tiles_s: 3, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 10 },
  aura: { area: [{ radius: 1, affects: 'passengers', heal_per_s: 0.03 }] },
};
/** `wheeled: false` matters: role `wounded` is not in FOOT_ROLES, so without it the body
 *  is a VEHICLE by default and a foot aura would skip it for the wrong reason (the first
 *  cut of this fixture had exactly that, and the wounded mutation survived it). */
const WOUNDED: UnitTypeJson = {
  id: 'ua_wounded', role: 'wounded',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true },
  mobility: { speed_tiles_s: 0.12, wheeled: false },
  sensors: { optics: 0.5, sight_tiles: 0, signature: 0.3 },
};
/** A vehicle-scope aura: an engineer team's field repair, 0.01/s to vehicles only. */
const FITTER: UnitTypeJson = {
  ...SQUAD, id: 'ua_fitter', role: 'engineer',
  aura: { area: [{ radius: 3, affects: 'vehicle', repair_per_s: 0.01 }] },
};
/** A carrier with seats and no aura, for the passengers scope's own-riders rule. */
const APC: UnitTypeJson = { ...AMBULANCE, id: 'ua_apc' };
delete (APC as { aura?: unknown }).aura;
const STATION: StructureTypeJson = {
  id: 'ua_station', hp_per_tile: 200, garrison_slots: 0,
  aura: { area: [{ radius: 4, affects: 'foot', heal_per_s: 0.01, heal_cap: 1 }] },
};

function world(extra: readonly UnitTypeJson[] = []) {
  const sim = new Sim({ seed: 0xe1, width: 48, height: 32, capacity: 32 });
  const u = {
    squad: sim.addUnitType(SQUAD),
    medic: sim.addUnitType(MEDIC),
    always: sim.addUnitType(MEDIC_ALWAYS),
    tank: sim.addUnitType(TANK),
    ambulance: sim.addUnitType(AMBULANCE),
    medevac: sim.addUnitType(MEDEVAC),
    fitter: sim.addUnitType(FITTER),
    apc: sim.addUnitType(APC),
  };
  const more = extra.map((t) => sim.addUnitType(t));
  const station = sim.addStructureType(STATION);
  return { sim, u, more, station };
}

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

/** The one damage path a hit takes (applyDamage stamps lastDamagedTick). */
function damage(sim: Sim, id: number, hp: number): void {
  (sim as unknown as { applyDamage(t: number, d: Fx, by: number): void }).applyDamage(id, fx.fromInt(hp), -1);
}

const at = (n: number): Fx => fx.from(n);

// Rates, by hand. fx.from rounds half away from zero; the per-tick rate is the ROUNDED
// integer division (raw + 10) / 20, truncated by `| 0`:
//   0.02/s: 0.02 x 65536 = 1310.72 -> 1311; (1311 + 10) / 20 = 66.05 -> 66 raw a tick.
//   0.03/s: 1966.08 -> 1966; (1966 + 10) / 20 = 98.8 -> 98 raw a tick.
//   0.01/s (the station): 655.36 -> 655; 665 / 20 = 33.25 -> 33.
// A 400 hp squad (26214400 raw) heals fx.mul(26214400, r) = 400 r a tick: 26400 at 66,
// 39200 at 98, 13200 at 33; field regen REGEN_FRAC 16 is 6400. 70% damage leaves 120 hp,
// 7864320 raw. The first heal is tick 200 (REGEN_DELAY_TICKS after the hit at tick 0).
const HURT = 7864320;

describe('unit aura parse', () => {
  it('0.02/s is 66 raw a tick and the radius 2.5 squares to 6.25 tiles^2 (409600 raw)', () => {
    const a = unitTypeFromJson(MEDIC).aura;
    expect(a?.[0]?.healRate).toBe(66);
    expect(a?.[0]?.radiusSq).toBe(409600);
    expect(a?.[0]?.stationary).toBe(true);
    expect(a?.[0]?.healCap).toBe(65536);
  });
  it('passengers parses to code 3 and 0.03/s is 98 raw', () => {
    const a = unitTypeFromJson(AMBULANCE).aura;
    expect(a?.[0]?.affects).toBe(3);
    expect(a?.[0]?.healRate).toBe(98);
  });
  it('a unit with no aura parses to null', () => {
    expect(unitTypeFromJson(SQUAD).aura).toBeNull();
  });
  it('a structure still refuses passengers and stationary', () => {
    const t = (j: StructureTypeJson) => structureTypeFromJson(j, 20);
    expect(() => t({ id: 'x', hp_per_tile: 1, aura: { area: [{ radius: 1, affects: 'passengers' }] } })).toThrow(
      /affects "passengers", expected foot, vehicle or any/,
    );
    expect(() => t({ id: 'x', hp_per_tile: 1, aura: { area: [{ radius: 1, affects: 'foot', stationary: true }] } })).toThrow(
      /stationary is for units only/,
    );
  });
  it('a unit refuses an unknown affects, component repair, an empty list, and an aircraft area scope', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    expect(() => sim.addUnitType({ ...SQUAD, id: 'a', aura: { area: [{ radius: 1, affects: 'air' }] } })).toThrow(/affects/);
    expect(() =>
      sim.addUnitType({ ...SQUAD, id: 'b', aura: { area: [{ radius: 1, affects: 'vehicle', repair_components_s: 30 }] } }),
    ).toThrow(/repair_components_s/);
    expect(() => sim.addUnitType({ ...SQUAD, id: 'c', aura: { area: [] } })).toThrow(/empty/);
    expect(() =>
      sim.addUnitType({ ...MEDEVAC, id: 'd', aura: { area: [{ radius: 3, affects: 'foot', heal_per_s: 0.03 }] } }),
    ).toThrow(/aircraft/);
  });
});

describe('unit aura: a medic heals in range and not out of it', () => {
  // Medic at (20.5, 15.5). (22.5, 15.5) is 2^2 = 4 tiles^2, inside 6.25; (23.5, 15.5) is 9, outside.
  function healed(x: number, opts: { side?: number; type?: 'squad' | 'tank'; medic?: 'medic' | 'always' } = {}) {
    const { sim, u } = world();
    const medic = sim.spawn(u[opts.medic ?? 'medic'], 0, at(20.5), at(15.5));
    const id = sim.spawn(u[opts.type ?? 'squad'], opts.side ?? 0, at(x), at(15.5));
    const hp = opts.type === 'tank' ? 3000 : 400;
    damage(sim, id, (hp * 7) / 10);
    return { sim, u, medic, id };
  }

  it('in range: waits 200 ticks, then heals 26400 raw a tick', () => {
    const { sim, id } = healed(22.5);
    run(sim, 200);
    expect(sim.state.hp[id]).toBe(HURT);
    run(sim, 1);
    expect(sim.state.hp[id]).toBe(HURT + 26400);
    expect(sim.state.auraHealRate[id]).toBe(66);
    expect(sim.state.auraHealCap[id]).toBe(65536);
  });
  // (26214400 - 7864320) / 26400 = 695.08 -> 696 heal ticks, from tick 200: full after 896.
  it('to full HP on the hand-computed tick', () => {
    const { sim, id } = healed(22.5);
    run(sim, 895);
    expect(sim.state.hp[id]).toBe(HURT + 695 * 26400); // 26212320, one heal short
    run(sim, 1);
    expect(sim.state.hp[id]).toBe(26214400);
  });
  it('out of range: field regen only, 6400 a tick, capped at 0.7', () => {
    const { sim, id } = healed(23.5);
    run(sim, 201);
    expect(sim.state.auraHealRate[id]).toBe(0);
    expect(sim.state.hp[id]).toBe(HURT + 6400);
  });
  it("nothing for the other side's units", () => {
    const { sim, id } = healed(22.5, { side: 1 });
    run(sim, 201);
    expect(sim.state.auraHealRate[id]).toBe(0);
  });
  it('a foot aura does not touch a vehicle in range', () => {
    const { sim, id } = healed(22.5, { type: 'tank' });
    run(sim, 201);
    expect(sim.state.auraHealRate[id]).toBe(0);
  });
  it('the carrier never covers itself', () => {
    const { sim, medic, id } = healed(22.5);
    damage(sim, medic, 280);
    run(sim, 201);
    expect(sim.state.auraHealRate[id]).toBe(66);
    expect(sim.state.auraHealRate[medic]).toBe(0);
    expect(sim.state.hp[medic]).toBe(HURT + 6400);
  });
  it('a dead medic covers nobody from the next cadence tick', () => {
    const { sim, medic, id } = healed(22.5);
    run(sim, 20);
    expect(sim.state.auraHealRate[id]).toBe(66);
    sim.debugKill(medic);
    run(sim, 10); // ticks 20..29: tick 20 refreshes
    expect(sim.state.auraHealRate[id]).toBe(0);
  });
  it('stationary: nothing while the medic is moving, the rate back once it stops', () => {
    const { sim, medic, id } = healed(22.5);
    // Walk it two tiles along the row: still within 2.5 of the squad the whole way.
    sim.queueCommand({ kind: 'move', ids: [medic], x: at(21.5), y: at(15.5), exact: true });
    run(sim, 11); // ticks 0..10: the cadence tick 10 sees it moving
    expect(sim.state.moving[medic]).toBe(1);
    expect(sim.state.auraHealRate[id]).toBe(0);
    run(sim, 60);
    expect(sim.state.moving[medic]).toBe(0);
    expect(sim.state.auraHealRate[id]).toBe(66);
  });
  it('without stationary a moving medic still covers (the control)', () => {
    const { sim, medic, id } = healed(22.5, { medic: 'always' });
    sim.queueCommand({ kind: 'move', ids: [medic], x: at(21.5), y: at(15.5), exact: true });
    run(sim, 11);
    expect(sim.state.moving[medic]).toBe(1);
    expect(sim.state.auraHealRate[id]).toBe(66);
  });
});

describe('unit aura: vehicle scope', () => {
  // Tank 3000 hp = 196608000 raw; 0.01/s is 33 raw: fx.mul(196608000, 33) = 3000 x 33 = 99000.
  it('repairs a vehicle in range and not a squad beside it', () => {
    const { sim, u } = world();
    sim.spawn(u.fitter, 0, at(20.5), at(15.5));
    const tank = sim.spawn(u.tank, 0, at(22.5), at(15.5));
    const sq = sim.spawn(u.squad, 0, at(21.5), at(15.5));
    damage(sim, tank, 2100);
    damage(sim, sq, 280);
    run(sim, 201);
    expect(sim.state.auraHealRate[tank]).toBe(33);
    expect(sim.state.hp[tank]).toBe(58982400 + 99000); // 900 hp left = 58982400 raw
    expect(sim.state.auraHealRate[sq]).toBe(0);
  });
});

describe('unit aura: stacking takes the max, never a sum', () => {
  it('two medics give one medic\'s rate', () => {
    const { sim, u } = world();
    sim.spawn(u.medic, 0, at(20.5), at(15.5));
    sim.spawn(u.medic, 0, at(20.5), at(16.5));
    const id = sim.spawn(u.squad, 0, at(22.5), at(15.5));
    damage(sim, id, 280);
    run(sim, 201);
    expect(sim.state.auraHealRate[id]).toBe(66);
    expect(sim.state.hp[id]).toBe(HURT + 26400);
  });
  it('two medics standing together heal each other (neither covers itself)', () => {
    const { sim, u } = world();
    const a = sim.spawn(u.medic, 0, at(20.5), at(15.5));
    const b = sim.spawn(u.medic, 0, at(21.5), at(15.5));
    run(sim, 10);
    expect(sim.state.auraHealRate[a]).toBe(66);
    expect(sim.state.auraHealRate[b]).toBe(66);
  });
  it('a medic inside a station takes the larger rate (66), not 33 + 66', () => {
    const { sim, u, station } = world();
    const tiles: number[] = [];
    for (let ty = 14; ty < 16; ty++) for (let tx = 20; tx < 22; tx++) tiles.push(ty * sim.width + tx);
    sim.addStructure(station, tiles, { owner: 0 }); // centroid (21, 15)
    sim.spawn(u.medic, 0, at(20.5), at(17.5));
    const id = sim.spawn(u.squad, 0, at(22.5), at(16.5)); // station: 2.25 + 2.25; medic: 4 + 1
    damage(sim, id, 280);
    run(sim, 201);
    expect(sim.state.auraHealRate[id]).toBe(66);
    expect(sim.state.hp[id]).toBe(HURT + 26400);
  });
});

describe('unit aura: passengers', () => {
  it("a ground carrier heals its own rider at 39200 a tick, and nobody beside it", () => {
    const { sim, u } = world();
    const car = sim.spawn(u.ambulance, 0, at(20.5), at(15.5));
    const rider = sim.spawn(u.squad, 0, at(20.5), at(15.5));
    damage(sim, rider, 280); // before boarding: applyDamage ignores a carried unit
    expect(sim.embarkAtSpawn(car, rider)).toBe(true);
    const beside = sim.spawn(u.squad, 0, at(21), at(15.5)); // 0.25 tiles^2: inside any radius
    damage(sim, beside, 280);
    run(sim, 201);
    expect(sim.state.auraHealRate[rider]).toBe(98);
    expect(sim.state.hp[rider]).toBe(HURT + 39200);
    expect(sim.state.auraHealRate[beside]).toBe(0);
    expect(sim.state.hp[beside]).toBe(HURT + 6400);
  });
  it("covers only its OWN riders: a man in another carrier gets nothing", () => {
    const { sim, u } = world();
    const car = sim.spawn(u.ambulance, 0, at(20.5), at(15.5));
    const mine = sim.spawn(u.squad, 0, at(20.5), at(15.5));
    expect(sim.embarkAtSpawn(car, mine)).toBe(true);
    const other = sim.spawn(u.apc, 0, at(21.5), at(15.5));
    const theirs = sim.spawn(u.squad, 0, at(21.5), at(15.5));
    expect(sim.embarkAtSpawn(other, theirs)).toBe(true);
    run(sim, 10);
    expect(sim.state.auraHealRate[mine]).toBe(98);
    expect(sim.state.auraHealRate[theirs]).toBe(0);
  });
  it('an air carrier heals its rider in flight', () => {
    const { sim, u } = world();
    const car = sim.spawn(u.medevac, 0, at(20.5), at(15.5));
    const rider = sim.spawn(u.squad, 0, at(20.5), at(15.5));
    damage(sim, rider, 280);
    expect(sim.embarkAtSpawn(car, rider)).toBe(true);
    run(sim, 201);
    expect(sim.isAirborne(car)).toBe(true);
    expect(sim.state.auraHealRate[rider]).toBe(98);
    expect(sim.state.hp[rider]).toBe(HURT + 39200);
  });
  it("a medic's foot aura does not reach a carried man; only his carrier's passengers rate does", () => {
    const { sim, u } = world();
    sim.spawn(u.medic, 0, at(20.5), at(15.5));
    const amb = sim.spawn(u.ambulance, 0, at(21.5), at(15.5));
    const rider = sim.spawn(u.squad, 0, at(21.5), at(15.5)); // 1 tile^2 from the medic
    expect(sim.embarkAtSpawn(amb, rider)).toBe(true);
    run(sim, 10);
    expect(sim.state.auraHealRate[rider]).toBe(98); // the ambulance's passengers rate, not 66
  });
});

describe('unit aura and GH-707 wounded (the E1 ruling)', () => {
  it('a medic that is itself down projects nothing', () => {
    const { sim, u, more } = world([WOUNDED]);
    void more; // registering the wounded type turns the wound fold on
    const medic = sim.spawn(u.medic, 0, at(20.5), at(15.5));
    const id = sim.spawn(u.squad, 0, at(22.5), at(15.5));
    run(sim, 10);
    expect(sim.state.auraHealRate[id]).toBe(66); // the control
    sim.state.woundState[medic] = 1; // WOUND_DOWN (tuning.ts)
    run(sim, 10);
    expect(sim.state.auraHealRate[id]).toBe(0);
  });
  it('a wounded body in range is not covered and bleeds exactly as without the medic', () => {
    const bleedAfter = (withMedic: boolean): { bleed: number; rate: number; squadRate: number } => {
      const { sim, u, more } = world([WOUNDED]);
      const wt = more[0] ?? -1;
      if (withMedic) sim.spawn(u.medic, 0, at(20.5), at(15.5));
      else sim.spawn(u.squad, 0, at(20.5), at(15.5)); // same entity ids, no aura
      const w = sim.spawn(wt, 0, at(21.5), at(15.5));
      const sq = sim.spawn(u.squad, 0, at(21.5), at(16.5));
      run(sim, 100);
      return { bleed: sim.state.bleedTicks[w], rate: sim.state.auraHealRate[w], squadRate: sim.state.auraHealRate[sq] };
    };
    const on = bleedAfter(true);
    const off = bleedAfter(false);
    expect(on.squadRate).toBe(66); // the control: the aura is live in this world
    expect(on.rate).toBe(0);
    expect(on.bleed).toBe(off.bleed);
    expect(on.bleed).toBeGreaterThan(0);
  });
});

describe('unit aura: the deferred fold (no pin moves while unused)', () => {
  function play(register: boolean, spawnMedic: boolean): { hashes: number[]; live: boolean } {
    const sim = new Sim({ seed: 0xe1, width: 48, height: 32, capacity: 32 });
    const sq = sim.addUnitType(SQUAD);
    const med = register ? sim.addUnitType(MEDIC) : -1;
    const a = sim.spawn(sq, 0, at(20.5), at(15.5));
    sim.spawn(sq, 1, at(26.5), at(15.5));
    damage(sim, a, 200);
    if (spawnMedic) sim.spawn(med, 0, at(10.5), at(10.5));
    const hashes: number[] = [];
    for (let i = 0; i < 300; i++) {
      sim.tick();
      if (i % 50 === 0) hashes.push(sim.hash());
    }
    return { hashes, live: sim.fieldWorksLive };
  }
  it('registering an aura type without fielding one changes no hash and leaves fwLive off', () => {
    const without = play(false, false);
    const registered = play(true, false);
    expect(registered.hashes).toEqual(without.hashes);
    expect(registered.live).toBe(false);
  });
  it('fielding one turns the field-works fold on, so its heal is hashed', () => {
    expect(play(true, true).live).toBe(true);
  });
  it('replays bit-identically', () => {
    expect(play(true, true).hashes).toEqual(play(true, true).hashes);
  });
  it('a medic fielded mid-mission (tick 137) replays bit-identically and differs from none', () => {
    const late = (spawnAt: number): number[] => {
      const sim = new Sim({ seed: 0xe1, width: 48, height: 32, capacity: 32 });
      const sq = sim.addUnitType(SQUAD);
      const med = sim.addUnitType(MEDIC);
      const a = sim.spawn(sq, 0, at(20.5), at(15.5));
      damage(sim, a, 200);
      const hashes: number[] = [];
      for (let i = 0; i < 400; i++) {
        if (i === spawnAt) sim.spawn(med, 0, at(21.5), at(15.5));
        sim.tick();
        if (i % 50 === 0) hashes.push(sim.hash());
      }
      return hashes;
    };
    expect(late(137)).toEqual(late(137));
    expect(late(137)).not.toEqual(late(-1));
  });
});
