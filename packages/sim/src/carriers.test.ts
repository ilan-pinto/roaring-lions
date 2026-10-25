import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

// Two new shapes of unit: a munition that flies into its target and is gone,
// and a vehicle that carries infantry and keeps shooting while it does.

const RIFLES: UnitTypeJson = {
  id: 'c_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 15, suppression: 40, rof_per_min: 300 },
  ],
};

const TANK: UnitTypeJson = {
  id: 'c_tank',
  name: 'Tank',
  role: 'mbt',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1, sight_tiles: 12, signature: 1 },
  weapons: [],
};

const KAMIKAZE: UnitTypeJson = {
  id: 'c_loiter',
  name: 'Loitering Munition',
  role: 'drone',
  hull: { hp: 90, armor: { front: 0, side: 0, rear: 0 }, suppression_resistance: 1 },
  mobility: { speed_tiles_s: 3.0, turn_rate_deg_s: 240 },
  sensors: { optics: 1.4, sight_tiles: 14, signature: 0.3 },
  abilities: ['kamikaze'],
  weapons: [
    { id: 'warhead', type: 'heat', range_tiles: 1.2, effective_range_tiles: 1.2, accuracy: 0.9, penetration: 500, damage: 600, splash_tiles: 1.2, suppression: 70, rof_per_min: 60 },
  ],
};

const JEEP: UnitTypeJson = {
  id: 'c_jeep',
  name: 'Jeep',
  role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [
    { id: 'mg', type: 'hmg', range_tiles: 8, effective_range_tiles: 6, accuracy: 0.6, penetration: 22, damage: 35, suppression: 50, rof_per_min: 360 },
  ],
};

function world(): { sim: Sim; inf: number; drone: number; jeep: number; tank: number } {
  const sim = new Sim({ seed: 6, width: 40, height: 20, capacity: 32 });
  return {
    sim,
    inf: sim.addUnitType(RIFLES),
    drone: sim.addUnitType(KAMIKAZE),
    jeep: sim.addUnitType(JEEP),
    tank: sim.addUnitType(TANK),
  };
}

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

describe('loitering munition', () => {
  it('flies into its target, hurts it, and is spent', () => {
    const { sim, drone, tank } = world();
    const bird = sim.spawn(drone, 0, fx.from(4.5), fx.from(10.5));
    const victim = sim.spawn(tank, 1, fx.from(16.5), fx.from(10.5)); // inside its optics
    const hpBefore = sim.state.hp[victim];

    const events = run(sim, 40 * TICKS_PER_SECOND);
    expect(sim.state.alive[bird]).toBe(0); // spent itself
    expect(events.some((e) => e.kind === 'destroyed' && e.entity === bird)).toBe(true);
    expect(sim.state.hp[victim]).toBeLessThan(hpBefore); // and it told
  });

  it('closes on the target by itself, without being ordered in', () => {
    const { sim, drone, tank } = world();
    const bird = sim.spawn(drone, 0, fx.from(4.5), fx.from(10.5));
    sim.spawn(tank, 1, fx.from(11.5), fx.from(10.5));
    const startX = fx.toNumber(sim.state.posX[bird]);
    // Long enough to identify the contact — it will not dive at a rumour.
    run(sim, 12 * TICKS_PER_SECOND);
    expect(fx.toNumber(sim.state.posX[bird])).toBeGreaterThan(startX + 1);
  });

  it('does not detonate on civilians', () => {
    const { sim, drone, inf } = world();
    const bird = sim.spawn(drone, 0, fx.from(4.5), fx.from(10.5));
    const civ = sim.spawn(inf, 2, fx.from(12.5), fx.from(10.5));
    run(sim, 30 * TICKS_PER_SECOND);
    expect(sim.state.alive[bird]).toBe(1);
    expect(sim.state.alive[civ]).toBe(1);
  });
});

describe('transport', () => {
  it('loads infantry, carries them, and puts them down where told', () => {
    const { sim, jeep, inf } = world();
    const car = sim.spawn(jeep, 0, fx.from(6.5), fx.from(10.5));
    const squad = sim.spawn(inf, 0, fx.from(5.5), fx.from(10.5));

    sim.queueCommand({ kind: 'load', ids: [squad], carrier: car });
    const loading = run(sim, 10 * TICKS_PER_SECOND);
    expect(loading.some((e) => e.kind === 'transport' && e.entity === squad && e.loaded)).toBe(true);
    expect(sim.state.carriedBy[squad]).toBe(car);
    expect(sim.passengerCount(car)).toBe(1);

    // Carried men ride along rather than walking.
    sim.queueCommand({ kind: 'move', ids: [car], x: fx.from(30.5), y: fx.from(10.5) });
    run(sim, 20 * TICKS_PER_SECOND);
    expect(fx.toNumber(sim.state.posX[car])).toBeGreaterThan(25);
    expect(sim.state.posX[squad]).toBe(sim.state.posX[car]);

    sim.queueCommand({ kind: 'unload', ids: [car] });
    const out = run(sim, 3 * TICKS_PER_SECOND);
    expect(out.some((e) => e.kind === 'transport' && e.entity === squad && !e.loaded)).toBe(true);
    expect(sim.state.carriedBy[squad]).toBe(-1);
    expect(sim.passengerCount(car)).toBe(0);
    // Set down beside the vehicle, not inside it.
    expect(fx.toNumber(sim.state.posX[squad])).toBeGreaterThan(25);
  });

  it('carries them faster than they walk', () => {
    const { sim, jeep, inf } = world();
    const car = sim.spawn(jeep, 0, fx.from(4.5), fx.from(10.5));
    const rider = sim.spawn(inf, 0, fx.from(4.5), fx.from(11.5));
    const walker = sim.spawn(inf, 0, fx.from(4.5), fx.from(14.5));
    sim.queueCommand({ kind: 'load', ids: [rider], carrier: car });
    run(sim, 3 * TICKS_PER_SECOND);
    sim.queueCommand({ kind: 'move', ids: [car], x: fx.from(34.5), y: fx.from(10.5) });
    sim.queueCommand({ kind: 'move', ids: [walker], x: fx.from(34.5), y: fx.from(14.5) });
    run(sim, 12 * TICKS_PER_SECOND);
    expect(fx.toNumber(sim.state.posX[rider])).toBeGreaterThan(fx.toNumber(sim.state.posX[walker]) + 5);
  });

  it('keeps firing while loaded', () => {
    const { sim, jeep, inf } = world();
    const car = sim.spawn(jeep, 0, fx.from(10.5), fx.from(10.5));
    const squad = sim.spawn(inf, 0, fx.from(9.5), fx.from(10.5));
    sim.queueCommand({ kind: 'load', ids: [squad], carrier: car });
    run(sim, 5 * TICKS_PER_SECOND);
    expect(sim.passengerCount(car)).toBe(1);
    sim.spawn(inf, 1, fx.from(15.5), fx.from(10.5));
    const events = run(sim, 20 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'fire' && e.shooter === car)).toBe(true);
  });

  it('passengers cannot be shot at while aboard', () => {
    const { sim, jeep, inf } = world();
    const car = sim.spawn(jeep, 0, fx.from(10.5), fx.from(10.5));
    const squad = sim.spawn(inf, 0, fx.from(9.5), fx.from(10.5));
    sim.queueCommand({ kind: 'load', ids: [squad], carrier: car });
    run(sim, 5 * TICKS_PER_SECOND);
    sim.spawn(inf, 1, fx.from(14.5), fx.from(10.5));
    const events = run(sim, 25 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'fire' && e.target === squad)).toBe(false);
  });

  it('bails the squad out, badly shaken, when the vehicle brews up', () => {
    const { sim, jeep, inf } = world();
    const car = sim.spawn(jeep, 0, fx.from(10.5), fx.from(10.5));
    const squad = sim.spawn(inf, 0, fx.from(9.5), fx.from(10.5));
    sim.queueCommand({ kind: 'load', ids: [squad], carrier: car });
    run(sim, 5 * TICKS_PER_SECOND);
    const hpBefore = sim.state.hp[squad];

    sim.debugKill(car);
    expect(sim.state.carriedBy[squad]).toBe(-1);
    expect(sim.state.hp[squad]).toBeLessThan(hpBefore); // they do not walk away clean
    expect(sim.state.suppression[squad]).toBeGreaterThan(0);
  });

  it('keeps passengers aboard when the whole selection is ordered to move', () => {
    // A box-select still contains the infantry after they board, so the player's
    // next right-click reaches the passengers too. That used to dismount them on
    // the spot: the APC drove off and the squad was left standing in the road.
    const { sim, jeep, inf } = world();
    const car = sim.spawn(jeep, 0, fx.from(6.5), fx.from(10.5));
    const squad = sim.spawn(inf, 0, fx.from(5.5), fx.from(10.5));
    sim.queueCommand({ kind: 'load', ids: [squad], carrier: car });
    run(sim, 10 * TICKS_PER_SECOND);
    expect(sim.state.carriedBy[squad]).toBe(car);

    // The order a player actually gives: everything still selected, one click.
    sim.queueCommand({ kind: 'move', ids: [car, squad], x: fx.from(30.5), y: fx.from(10.5) });
    run(sim, 20 * TICKS_PER_SECOND);

    expect(sim.state.carriedBy[squad]).toBe(car);
    expect(sim.passengerCount(car)).toBe(1);
    expect(fx.toNumber(sim.state.posX[car])).toBeGreaterThan(25);
    expect(sim.state.posX[squad]).toBe(sim.state.posX[car]);
  });

  it('a rider chases a MOVING carrier to its seat (GH-581), not to where it was', () => {
    // The carrier drives off across the rider's line (slower than he walks, so he can catch it).
    // The chase used to rewrite the goal POINT every tick but leave the flow field on the
    // carrier's original tile: he walked to that tile, arrived, and halted short of a hull that
    // had moved on. Measured before the fix: stuck a few tiles from it for 40 s.
    const { sim, inf } = world();
    const crawler = sim.addUnitType({ ...JEEP, id: 'c_crawler', mobility: { speed_tiles_s: 0.6, turn_rate_deg_s: 150 } });
    const car = sim.spawn(crawler, 0, fx.from(10.5), fx.from(14.5));
    const squad = sim.spawn(inf, 0, fx.from(6.5), fx.from(10.5));
    sim.queueCommand({ kind: 'move', ids: [car], x: fx.from(10.5), y: fx.from(2.5) });
    sim.queueCommand({ kind: 'load', ids: [squad], carrier: car });
    run(sim, 40 * TICKS_PER_SECOND);
    expect(sim.state.carriedBy[squad]).toBe(car);
  });

  it('refuses to load a tank into a personnel carrier', () => {
    // A carrier is not a flatbed. The old rule was "anything that is not
    // itself a carrier can ride", which is true of tanks — so a box-select
    // over an armoured force filled both seats with Merkavas and left the
    // infantry standing in the road.
    const { sim, jeep, inf, tank } = world();
    const car = sim.spawn(jeep, 0, fx.from(10.5), fx.from(10.5));
    const armour = sim.spawn(tank, 0, fx.from(9.5), fx.from(10.5));
    const squad = sim.spawn(inf, 0, fx.from(9.5), fx.from(11.5));

    sim.queueCommand({ kind: 'load', ids: [armour, squad], carrier: car });
    run(sim, 20 * TICKS_PER_SECOND);

    expect(sim.state.carriedBy[armour]).toBe(-1);
    expect(sim.state.carriedBy[squad]).toBe(car);
    expect(sim.passengerCount(car)).toBe(1);
  });

  it('refuses more passengers than it has seats', () => {
    const { sim, jeep, inf } = world();
    const car = sim.spawn(jeep, 0, fx.from(10.5), fx.from(10.5));
    const ids: number[] = [];
    for (let k = 0; k < 4; k++) ids.push(sim.spawn(inf, 0, fx.from(9.5), fx.from(9.5 + k * 0.5)));
    sim.queueCommand({ kind: 'load', ids, carrier: car });
    run(sim, 20 * TICKS_PER_SECOND);
    expect(sim.passengerCount(car)).toBe(2);
  });

  it('stays deterministic with carriers and munitions in play', () => {
    const build = (): number => {
      const { sim, jeep, inf, drone, tank } = world();
      const car = sim.spawn(jeep, 0, fx.from(6.5), fx.from(10.5));
      const squad = sim.spawn(inf, 0, fx.from(5.5), fx.from(10.5));
      sim.spawn(drone, 0, fx.from(4.5), fx.from(6.5));
      sim.spawn(tank, 1, fx.from(30.5), fx.from(10.5));
      sim.queueCommand({ kind: 'load', ids: [squad], carrier: car });
      sim.queueCommand({ kind: 'attackMove', ids: [car], x: fx.from(28.5), y: fx.from(10.5) });
      run(sim, 900);
      return sim.hash();
    };
    expect(build()).toBe(build());
  });
});

// Mounted delivery: infantry a *mission* authored aboard, rather than a player
// ordering them in. Everything below the seating itself is already covered above —
// riding with the hull, immunity while aboard, and the bail-out when the carrier
// brews up, which is what makes a delivery a risk the player can pre-empt.
describe('embarkAtSpawn', () => {
  it('seats a passenger immediately, on the hull rather than beside it', () => {
    const { sim, jeep, inf } = world();
    const car = sim.spawn(jeep, 1, fx.from(10.5), fx.from(10.5));
    const squad = sim.spawn(inf, 1, fx.from(20.5), fx.from(20.5));

    expect(sim.embarkAtSpawn(car, squad)).toBe(true);
    expect(sim.state.carriedBy[squad]).toBe(car);
    expect(sim.passengerCount(car)).toBe(1);
    // Snapped on, so a passenger never renders beside a vehicle it is inside for
    // the tick before stepTransport runs.
    expect(sim.state.posX[squad]).toBe(sim.state.posX[car]);
    expect(sim.state.posY[squad]).toBe(sim.state.posY[car]);
  });

  it('refuses past capacity, so a mission cannot overfill a carrier', () => {
    const { sim, jeep, inf } = world();
    const car = sim.spawn(jeep, 1, fx.from(10.5), fx.from(10.5));
    const seated = [0, 1, 2].map(() =>
      sim.embarkAtSpawn(car, sim.spawn(inf, 1, fx.from(10.5), fx.from(10.5))),
    );
    // The jeep has two seats; the third is refused rather than silently dropped.
    expect(seated).toEqual([true, true, false]);
    expect(sim.passengerCount(car)).toBe(2);
  });

  it('refuses a type that cannot ride, by the same rule as a player load', () => {
    const { sim, jeep, tank } = world();
    const car = sim.spawn(jeep, 1, fx.from(10.5), fx.from(10.5));
    const armour = sim.spawn(tank, 1, fx.from(10.5), fx.from(10.5));
    expect(sim.embarkAtSpawn(car, armour)).toBe(false);
    expect(sim.passengerCount(car)).toBe(0);
  });

  it('refuses a carrier with no seats, and refuses seating a unit twice', () => {
    const { sim, jeep, inf, tank } = world();
    const notACarrier = sim.spawn(tank, 1, fx.from(10.5), fx.from(10.5));
    const squad = sim.spawn(inf, 1, fx.from(10.5), fx.from(10.5));
    expect(sim.embarkAtSpawn(notACarrier, squad)).toBe(false);

    const car = sim.spawn(jeep, 1, fx.from(12.5), fx.from(12.5));
    expect(sim.embarkAtSpawn(car, squad)).toBe(true);
    expect(sim.embarkAtSpawn(car, squad)).toBe(false);
    expect(sim.passengerCount(car)).toBe(1);
  });

  it('rides until unloaded, then stands on the ground', () => {
    const { sim, jeep, inf } = world();
    const car = sim.spawn(jeep, 1, fx.from(6.5), fx.from(10.5));
    const squad = sim.spawn(inf, 1, fx.from(6.5), fx.from(10.5));
    sim.embarkAtSpawn(car, squad);

    sim.queueCommand({ kind: 'move', ids: [car], x: fx.from(16.5), y: fx.from(10.5) });
    run(sim, 8 * TICKS_PER_SECOND);
    // Still aboard, and moved with the hull rather than walking.
    expect(sim.state.carriedBy[squad]).toBe(car);
    expect(sim.state.posX[squad]).toBe(sim.state.posX[car]);
    const droppedAt = sim.state.posX[car];

    sim.queueCommand({ kind: 'unload', ids: [car] });
    run(sim, 2);
    expect(sim.state.carriedBy[squad]).toBe(-1);
    expect(sim.passengerCount(car)).toBe(0);
    // Put down beside the vehicle, near where it had got to.
    expect(Math.abs(sim.state.posX[squad] - droppedAt)).toBeLessThan(fx.from(3));
  });

  it('leaves the golden hash alone when nobody is authored aboard', () => {
    // The delivery must not perturb a mission that does not use it. Two worlds
    // that differ only in an unused code path have to hash the same.
    const build = (embark: boolean): number => {
      const { sim, jeep, inf, tank } = world();
      const car = sim.spawn(jeep, 0, fx.from(6.5), fx.from(10.5));
      const squad = sim.spawn(inf, 0, fx.from(6.5), fx.from(10.5));
      sim.spawn(tank, 1, fx.from(30.5), fx.from(10.5));
      if (embark) sim.embarkAtSpawn(car, squad);
      sim.queueCommand({ kind: 'attackMove', ids: [car], x: fx.from(28.5), y: fx.from(10.5) });
      run(sim, 200);
      return sim.hash();
    };
    // Same seed, same orders: seating someone must change the state (they are
    // aboard), so this asserts the paths are distinct rather than accidentally
    // identical — the determinism suite covers the no-passenger case itself.
    expect(build(false)).not.toBe(build(true));
    expect(build(true)).toBe(build(true));
    expect(build(false)).toBe(build(false));
  });
});

// GH-698 Task 6 (R8, item 11): the replay pins for air carriers.
//
// Ground carriers stay bit-identical. hash() cannot witness that (Task 2 may fold
// air columns once a heli is registered), so the existing jeep scenario is digested
// over the NON-AIR columns only: posX, posY, hp, alive, carriedBy and the seat count.
// The literal below was captured on the P2 base commit 41b2c731, before any air
// carrier code existed, and must not change at any task.
function groundDigest(sim: Sim, h: number): number {
  const fold = (v: number): void => {
    h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
  };
  for (let i = 0; i < sim.entityCount; i++) {
    fold(sim.state.posX[i]);
    fold(sim.state.posY[i]);
    fold(sim.state.hp[i]);
    fold(sim.state.alive[i]);
    fold(sim.state.carriedBy[i]);
    fold(sim.passengerCount(i));
  }
  return h;
}

describe('ground carrier is bit-identical (GH-698 Task 6)', () => {
  it('the jeep scenario digests to the base commit literal over non-air columns', () => {
    const { sim, jeep, inf, drone, tank } = world();
    const car = sim.spawn(jeep, 0, fx.from(6.5), fx.from(10.5));
    const squad = sim.spawn(inf, 0, fx.from(5.5), fx.from(10.5));
    sim.spawn(drone, 0, fx.from(4.5), fx.from(6.5));
    sim.spawn(tank, 1, fx.from(30.5), fx.from(10.5));
    sim.queueCommand({ kind: 'load', ids: [squad], carrier: car });
    sim.queueCommand({ kind: 'attackMove', ids: [car], x: fx.from(28.5), y: fx.from(10.5) });
    let h = 2166136261;
    for (let k = 0; k < 18; k++) {
      run(sim, 50);
      h = groundDigest(sim, h); // sampled every 50 ticks, 900 in all
    }
    expect(h).toBe(1417887594);
  });
});

describe('ground disembark is bit-identical (GH-698 review T6)', () => {
  it('unload and bail-out landings digest to a pinned literal', () => {
    const { sim, jeep, inf } = world();
    const carA = sim.spawn(jeep, 0, fx.from(6.5), fx.from(4.5));
    const carB = sim.spawn(jeep, 0, fx.from(6.5), fx.from(14.5));
    const a = sim.spawn(inf, 0, fx.from(5.5), fx.from(4.5));
    const b = sim.spawn(inf, 0, fx.from(5.5), fx.from(14.5));
    sim.queueCommand({ kind: 'load', ids: [a], carrier: carA });
    sim.queueCommand({ kind: 'load', ids: [b], carrier: carB });
    run(sim, 100);
    expect(sim.state.carriedBy[a]).toBe(carA);
    expect(sim.state.carriedBy[b]).toBe(carB);
    sim.queueCommand({ kind: 'move', ids: [carA, carB], x: fx.from(20.5), y: fx.from(9.5) });
    run(sim, 150);
    let h = 2166136261;
    sim.queueCommand({ kind: 'unload', ids: [carA] });
    run(sim, 2);
    h = groundDigest(sim, h);
    sim.debugKill(carB); // bail-out: disembark(shaken)
    h = groundDigest(sim, h);
    run(sim, 40);
    h = groundDigest(sim, h);
    expect(sim.state.carriedBy[a]).toBe(-1);
    expect(sim.state.carriedBy[b]).toBe(-1);
    expect(h).toBe(859034492);
  });
});

const AIR_RIFLES: UnitTypeJson = { ...RIFLES, id: 'c_air_inf', weapons: [] };

const HELI: UnitTypeJson = {
  id: 'c_heli',
  name: 'Yanshuf',
  role: 'apc',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 3.2, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
  weapons: [],
};

const MANPAD: UnitTypeJson = {
  id: 'c_manpad',
  name: 'MANPAD team',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
  weapons: [
    { id: 'manpad', type: 'hmg', range_tiles: 8, effective_range_tiles: 6, accuracy: 0.6, penetration: 60, damage: 40, suppression: 20, rof_per_min: 120, can_target: ['air'] },
  ],
};

describe('carrier replay, air (GH-698 Task 6)', () => {
  const build = (): number => {
    const sim = new Sim({ seed: 0x6980_0006, width: 40, height: 20, capacity: 32 });
    const heliT = sim.addUnitType(HELI);
    const infT = sim.addUnitType(AIR_RIFLES);
    const manpadT = sim.addUnitType(MANPAD);
    const tankT = sim.addUnitType(TANK);
    const heli = sim.spawn(heliT, 0, fx.from(6.5), fx.from(10.5));
    const squads: number[] = [];
    for (let k = 0; k < 6; k++) squads.push(sim.spawn(infT, 0, fx.from(5.5 + (k % 3)), fx.from(8.5 + 2 * Math.floor(k / 3))));
    sim.spawn(manpadT, 1, fx.from(30.5), fx.from(8.5));
    sim.spawn(tankT, 1, fx.from(33.5), fx.from(14.5));
    sim.queueCommand({ kind: 'load', ids: squads, carrier: heli });
    run(sim, 300);
    sim.queueCommand({ kind: 'attackMove', ids: [heli], x: fx.from(26.5), y: fx.from(10.5) });
    run(sim, 400);
    sim.queueCommand({ kind: 'unload', ids: [heli] });
    run(sim, 300);
    return sim.hash();
  };

  it('is deterministic: two builds hash the same', () => {
    expect(build()).toBe(build());
  });

  it('is pinned (GH-698, 2026-10-21): load, attackMove, unload with a MANPAD and a tank', () => {
    // A new test-local literal, captured from the first run of this scenario. It is
    // not one of the shipped pins. Any change to the air carrier machine, a tuning
    // constant, or an rng draw moves it.
    //
    // 2026-10-25: Vehicle avoidance (GH-421 Stage 2): the columns sepWait and sepLast join the hash.
    // No behaviour moved: with their hashArray lines removed the scenario reads 8862049 exactly.
    // Was 8862049.
    expect(build()).toBe(338428513);
  });
});
