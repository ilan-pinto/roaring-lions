import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from './sim';

/**
 * Flight is two rules and nothing else: an air unit ignores terrain, and it is
 * only shootable by weapons that declare they can reach it. There is no
 * altitude value in the sim — height is presentation. Modelling a z axis would
 * buy nothing the two rules do not already give, and would cost a third
 * dimension in every distance check in the hot loop.
 */

/** One weapon, declared once, so no test has to index into an optional array. */
const RIFLE_WEAPON = {
  id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6,
  accuracy: 0.6, penetration: 10, damage: 40, suppression: 30, rof_per_min: 300,
  can_target: ['ground', 'air'],
} as const;

const RIFLES: UnitTypeJson = {
  id: 'f_inf',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 2.0 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  weapons: [{ ...RIFLE_WEAPON, can_target: ['ground', 'air'] }],
};

/** Same rifles, but they cannot elevate. The control for every air test. */
const RIFLES_NO_AA: UnitTypeJson = {
  ...RIFLES,
  id: 'f_inf_noaa',
  weapons: [{ ...RIFLE_WEAPON, can_target: ['ground'] }],
};

const DRONE: UnitTypeJson = {
  id: 'f_drone',
  role: 'drone',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 3.0, domain: 'air' },
  sensors: { optics: 1.4, sight_tiles: 12, signature: 0.3 },
};

const TRUCK: UnitTypeJson = {
  id: 'f_truck',
  role: 'technical',
  hull: { hp: 300, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 3.0 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.8 },
};

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

describe('an air unit ignores terrain', () => {
  it('crosses a wall that stops an identical ground unit', () => {
    const sim = new Sim({ seed: 11, width: 24, height: 12, capacity: 8 });
    // A wall clean across the map, with no gap to path around.
    for (let y = 0; y < 12; y++) sim.setBlocked(12, y, true);
    const air = sim.addUnitType(DRONE);
    const ground = sim.addUnitType(TRUCK);
    const a = sim.spawn(air, 0, fx.from(4.5), fx.from(6.5));
    const g = sim.spawn(ground, 0, fx.from(4.5), fx.from(8.5));
    sim.queueCommand({ kind: 'move', ids: [a, g], x: fx.from(20.5), y: fx.from(6.5) });
    run(sim, 30 * TICKS_PER_SECOND);
    expect(fx.toNumber(sim.state.posX[a])).toBeGreaterThan(13);
    expect(fx.toNumber(sim.state.posX[g])).toBeLessThan(12);
  });

  it('does not get shoved off its goal by the wall it is flying over', () => {
    const sim = new Sim({ seed: 12, width: 24, height: 12, capacity: 8 });
    for (let y = 0; y < 12; y++) sim.setBlocked(12, y, true);
    const air = sim.addUnitType(DRONE);
    const a = sim.spawn(air, 0, fx.from(4.5), fx.from(6.5));
    sim.queueCommand({ kind: 'move', ids: [a], x: fx.from(12.5), y: fx.from(6.5) });
    run(sim, 30 * TICKS_PER_SECOND);
    // Stopping *on* the blocked tile is the point: nothing underneath matters.
    expect(fx.toNumber(sim.state.posX[a])).toBeCloseTo(12.5, 1);
  });
});

describe('only weapons that can reach air engage it', () => {
  it('rifles that can elevate shoot down a drone', () => {
    const sim = new Sim({ seed: 13, width: 24, height: 12, capacity: 8 });
    const inf = sim.addUnitType(RIFLES);
    const air = sim.addUnitType(DRONE);
    sim.spawn(inf, 0, fx.from(6.5), fx.from(6.5));
    const d = sim.spawn(air, 1, fx.from(9.5), fx.from(6.5));
    run(sim, 60 * TICKS_PER_SECOND);
    expect(sim.state.alive[d]).toBe(0);
  });

  it('rifles that cannot elevate never touch it, at the same range', () => {
    const sim = new Sim({ seed: 13, width: 24, height: 12, capacity: 8 });
    const inf = sim.addUnitType(RIFLES_NO_AA);
    const air = sim.addUnitType(DRONE);
    sim.spawn(inf, 0, fx.from(6.5), fx.from(6.5));
    const d = sim.spawn(air, 1, fx.from(9.5), fx.from(6.5));
    run(sim, 60 * TICKS_PER_SECOND);
    expect(sim.state.alive[d]).toBe(1);
    expect(fx.toNumber(sim.state.hp[d])).toBe(200);
  });

  it('a ground unit beside the drone is still engaged by the same weapon', () => {
    // Guards the obvious way to get this wrong: filtering out every target
    // rather than only the airborne ones.
    const sim = new Sim({ seed: 14, width: 24, height: 12, capacity: 8 });
    const inf = sim.addUnitType(RIFLES_NO_AA);
    const air = sim.addUnitType(DRONE);
    const truck = sim.addUnitType(TRUCK);
    sim.spawn(inf, 0, fx.from(6.5), fx.from(6.5));
    const d = sim.spawn(air, 1, fx.from(9.5), fx.from(6.5));
    const t = sim.spawn(truck, 1, fx.from(9.5), fx.from(7.5));
    run(sim, 60 * TICKS_PER_SECOND);
    expect(sim.state.alive[d]).toBe(1);
    expect(sim.state.alive[t]).toBe(0);
  });

  it('an air unit with a ground-only weapon still shoots ground', () => {
    // Direction matters: can_target constrains what a weapon may shoot, not
    // what may shoot its owner.
    const ARMED_AIR: UnitTypeJson = {
      ...DRONE,
      id: 'f_gunship',
      weapons: [{ ...RIFLE_WEAPON, id: 'pkm', can_target: ['ground'] }],
    };
    const sim = new Sim({ seed: 15, width: 24, height: 12, capacity: 8 });
    const air = sim.addUnitType(ARMED_AIR);
    const truck = sim.addUnitType(TRUCK);
    sim.spawn(air, 0, fx.from(6.5), fx.from(6.5));
    const t = sim.spawn(truck, 1, fx.from(9.5), fx.from(6.5));
    run(sim, 60 * TICKS_PER_SECOND);
    expect(sim.state.alive[t]).toBe(0);
  });
});

describe('a weapon with no can_target keeps its old reach', () => {
  it('engages ground, and does not gain air for free', () => {
    // Every shipped weapon predates this field. Absent must mean "ground
    // only" and never "everything", or omitting it would silently hand every
    // rifle in the game an anti-air capability.
    const LEGACY: UnitTypeJson = {
      ...RIFLES,
      id: 'f_legacy',
      weapons: [{ ...RIFLE_WEAPON, can_target: undefined }],
    };
    const sim = new Sim({ seed: 16, width: 24, height: 12, capacity: 8 });
    const inf = sim.addUnitType(LEGACY);
    const air = sim.addUnitType(DRONE);
    const truck = sim.addUnitType(TRUCK);
    sim.spawn(inf, 0, fx.from(6.5), fx.from(6.5));
    const d = sim.spawn(air, 1, fx.from(9.5), fx.from(6.5));
    const t = sim.spawn(truck, 1, fx.from(9.5), fx.from(7.5));
    run(sim, 60 * TICKS_PER_SECOND);
    expect(sim.state.alive[d]).toBe(1);
    expect(sim.state.alive[t]).toBe(0);
  });
});
