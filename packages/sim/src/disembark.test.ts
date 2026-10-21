import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from './sim';

// GH-698 item 7: a passenger set down at a vehicle stands on foot-open ground.
// Old rule: (car + 0.5, car + 0.5) clamped to the map. Kept bit-for-bit when
// that tile is foot-open; otherwise the nearest foot-open tile centre.

const RIFLES: UnitTypeJson = {
  id: 'd_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [],
};

const JEEP: UnitTypeJson = {
  id: 'd_jeep',
  name: 'Jeep',
  role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};

function world(): { sim: Sim; inf: number; jeep: number } {
  const sim = new Sim({ seed: 3, width: 20, height: 20, capacity: 16 });
  return { sim, inf: sim.addUnitType(RIFLES), jeep: sim.addUnitType(JEEP) };
}

function tileOf(sim: Sim, id: number): [number, number] {
  return [fx.toInt(sim.state.posX[id]), fx.toInt(sim.state.posY[id])];
}

function ride(sim: Sim, jeep: number, inf: number, x: number, y: number): { car: number; squad: number } {
  const car = sim.spawn(jeep, 0, fx.from(x), fx.from(y));
  const squad = sim.spawn(inf, 0, fx.from(x), fx.from(y));
  sim.embarkAtSpawn(car, squad);
  return { car, squad };
}

describe('disembark landing', () => {
  it('lands on open ground beside a wall, not in it', () => {
    const { sim, jeep, inf } = world();
    sim.setBlocked(6, 6, true);
    const { car, squad } = ride(sim, jeep, inf, 5.5, 5.5);
    sim.queueCommand({ kind: 'unload', ids: [car] });
    sim.tick();
    expect(sim.state.carriedBy[squad]).toBe(-1);
    const [tx, ty] = tileOf(sim, squad);
    expect(sim.blocked[ty * 20 + tx]).toBe(0);
    expect(Math.abs(tx - 6)).toBeLessThanOrEqual(1);
    expect(Math.abs(ty - 6)).toBeLessThanOrEqual(1);
    // Ring 1 around (6,6) scans y 5..7, x 5..7 row-major: (5,5) is first open.
    expect([tx, ty]).toEqual([5, 5]);
  });

  it('is bit-identical on clear ground', () => {
    const { sim, jeep, inf } = world();
    const { car, squad } = ride(sim, jeep, inf, 5.5, 5.5);
    sim.queueCommand({ kind: 'unload', ids: [car] });
    sim.tick();
    // 5.5 + 0.5 = 6.0 on both axes; 6 * 65536 = 393216.
    expect(sim.state.posX[squad]).toBe(393216);
    expect(sim.state.posY[squad]).toBe(393216);
  });

  it('lands in-map at the last column', () => {
    const { sim, jeep, inf } = world();
    sim.setBlocked(19, 10, true); // the clamped landing (19.5,10.5+0.5) is tile (19,11)
    sim.setBlocked(19, 11, true);
    const { car, squad } = ride(sim, jeep, inf, 19.5, 10.5);
    sim.queueCommand({ kind: 'unload', ids: [car] });
    sim.tick();
    const [tx, ty] = tileOf(sim, squad);
    expect(tx).toBeGreaterThanOrEqual(0);
    expect(tx).toBeLessThan(20);
    expect(sim.blocked[ty * 20 + tx]).toBe(0);
  });

  it('puts a bailed-out squad on open ground, still shaken', () => {
    const { sim, jeep, inf } = world();
    sim.setBlocked(6, 6, true);
    const { car, squad } = ride(sim, jeep, inf, 5.5, 5.5);
    sim.debugKill(car);
    expect(sim.state.carriedBy[squad]).toBe(-1);
    const [tx, ty] = tileOf(sim, squad);
    expect(sim.blocked[ty * 20 + tx]).toBe(0);
    // 0.4 of 400 hp = 160 lost, 240 left (within one Q16 rounding step).
    expect(sim.state.hp[squad]).toBeLessThan(fx.from(241));
    expect(sim.state.hp[squad]).toBeGreaterThan(fx.from(239));
    expect(sim.state.suppression[squad]).toBeGreaterThan(0);
    expect(TICKS_PER_SECOND).toBe(20);
  });

  it('treats a boulder as foot-open', () => {
    const { sim, jeep, inf } = world();
    sim.setBoulder(6, 6, true);
    const { car, squad } = ride(sim, jeep, inf, 5.5, 5.5);
    sim.queueCommand({ kind: 'unload', ids: [car] });
    sim.tick();
    expect(tileOf(sim, squad)).toEqual([6, 6]);
  });
});
