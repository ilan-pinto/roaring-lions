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
