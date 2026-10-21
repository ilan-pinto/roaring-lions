import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { AIR_AIRBORNE, AIR_LANDING, AIR_LANDED, AIR_LIFTING } from './tuning';

// GH-698 Task 2: the air carrier state block. Three per-unit columns
// (airState, airTimer, airWant), folded into hash() only once an air carrier
// type is registered (Q-A, deferred fold), and `isAirborne` (Q-C: a LANDING
// carrier is a ground target). Nothing in the sim reads the columns yet.

const RIFLES: UnitTypeJson = {
  id: 'ac_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

const JEEP: UnitTypeJson = {
  id: 'ac_jeep',
  name: 'Jeep',
  role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};

const DRONE: UnitTypeJson = {
  id: 'ac_drone',
  role: 'drone',
  hull: { hp: 120, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 2.2, domain: 'air' },
  sensors: { optics: 2, sight_tiles: 16, signature: 0.3 },
};

const HELO: UnitTypeJson = {
  id: 'ac_helo',
  name: 'Yanshuf',
  role: 'transport',
  hull: { hp: 900, armor: { front: 4, side: 4, rear: 4 }, transport_slots: 6 },
  mobility: { speed_tiles_s: 4, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
  weapons: [],
};

function world(withCarrier: boolean): { sim: Sim; inf: number; jeep: number; drone: number; helo: number } {
  const sim = new Sim({ seed: 0x6980_0002, width: 20, height: 20, capacity: 16 });
  const ti = sim.addUnitType(RIFLES);
  const tj = sim.addUnitType(JEEP);
  const td = sim.addUnitType(DRONE);
  const inf = sim.spawn(ti, 0, fx.fromInt(3), fx.fromInt(3));
  const jeep = sim.spawn(tj, 0, fx.fromInt(5), fx.fromInt(5));
  const drone = sim.spawn(td, 0, fx.fromInt(7), fx.fromInt(7));
  let helo = -1;
  if (withCarrier) helo = sim.spawn(sim.addUnitType(HELO), 0, fx.fromInt(9), fx.fromInt(9));
  for (let i = 0; i < 5; i++) sim.tick();
  return { sim, inf, jeep, drone, helo };
}

describe('air carrier state block (GH-698 Task 2)', () => {
  it('isAirCarrier: an air type with seats only', () => {
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    const types = [HELO, DRONE, JEEP].map((j) => sim.unitTypes[sim.addUnitType(j)]);
    expect(types.map((t) => t.isAirCarrier)).toEqual([true, false, false]);
  });

  it('a fresh spawn has airState 0, airTimer 0, airWant 0', () => {
    const { sim, helo, inf } = world(true);
    for (const id of [helo, inf]) {
      expect(sim.state.airState[id]).toBe(0);
      expect(sim.state.airTimer[id]).toBe(0);
      expect(sim.state.airWant[id]).toBe(0);
    }
  });

  it('registering an air carrier type turns the fold on; a drone or a jeep does not', () => {
    expect(world(false).sim.airCarrierLive).toBe(false);
    expect(world(true).sim.airCarrierLive).toBe(true);
  });

  const columns = ['airState', 'airTimer', 'airWant'] as const;
  for (const name of columns) {
    it(`hash covers ${name}`, () => {
      const { sim, helo } = world(true);
      const before = sim.hash();
      sim.state[name][helo] += 1;
      expect(sim.hash()).not.toBe(before);
    });
  }

  it('no air carrier registered: airState is not folded', () => {
    // Q-A: a world with a drone (air, no seats) and a jeep (seats, ground) has no
    // air carrier type, so the block folds nothing and no pin can move.
    const { sim, drone } = world(false);
    const before = sim.hash();
    sim.state.airState[drone] = 2;
    sim.state.airTimer[drone] = 7;
    sim.state.airWant[drone] = 1;
    expect(sim.hash()).toBe(before);
  });

  it('isAirborne: AIRBORNE and LIFTING are air', () => {
    const { sim, helo } = world(true);
    sim.state.airState[helo] = AIR_AIRBORNE;
    expect(sim.isAirborne(helo)).toBe(true);
    sim.state.airState[helo] = AIR_LIFTING;
    expect(sim.isAirborne(helo)).toBe(true);
  });

  it('Q-C: a LANDING carrier is a ground target', () => {
    const { sim, helo } = world(true);
    sim.state.airState[helo] = AIR_LANDING;
    expect(sim.isAirborne(helo)).toBe(false);
  });

  it('isAirborne: a LANDED carrier is a ground target', () => {
    const { sim, helo } = world(true);
    sim.state.airState[helo] = AIR_LANDED;
    expect(sim.isAirborne(helo)).toBe(false);
  });

  it('isAirborne: a ground unit is never airborne, in every state', () => {
    const { sim, inf, jeep } = world(true);
    for (const id of [inf, jeep]) {
      for (const s of [0, 1, 2, 3]) {
        sim.state.airState[id] = s;
        expect(sim.isAirborne(id)).toBe(false);
      }
    }
  });
});
