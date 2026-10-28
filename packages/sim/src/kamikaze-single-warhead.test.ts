import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';

// GH-867. A loitering munition's warhead is delivered ONCE, by stepKamikaze's terminal strike. Before
// the fix stepCombat also fired it as an ordinary round (inside the 1.2-tile range), the strike
// destroyed the drone, and the round landed two ticks later from a dead shooter: two penetrations
// from one munition. Every expectation below is a count of events, a literal.

/** 90 hp, pen 480, damage 520, 1.2-tile splash (the shape of attack_drone / loiter_drone). */
const MUNITION: UnitTypeJson = {
  id: 'k_munition', role: 'drone', hull: { hp: 90, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 3 }, sensors: { optics: 1.4, sight_tiles: 14, signature: 0.3 },
  abilities: ['kamikaze'],
  weapons: [
    { id: 'warhead', type: 'heat', range_tiles: 1.3, effective_range_tiles: 1.3, accuracy: 0.9, penetration: 480, damage: 520, splash_tiles: 1.2, suppression: 70, rof_per_min: 60 },
  ],
};
/** A hard hull with a thin side plate, so the strike always penetrates (z far above 4). */
const HULL: UnitTypeJson = {
  id: 'k_hull', role: 'apc', hull: { hp: 3000, armor: { front: 300, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 }, sensors: { optics: 1, sight_tiles: 8, signature: 1 }, weapons: [],
};

const HOUSE = { id: 'k_house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 };
/** Unarmed, so nothing shoots the drone down and the only question is what the drone does. */
const GARRISONED_MAN: UnitTypeJson = {
  id: 'k_man', role: 'infantry', hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 }, sensors: { optics: 1, sight_tiles: 10, signature: 0.6 }, abilities: ['garrison'],
  weapons: [],
};

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

describe('a loitering munition delivers its warhead once (GH-867)', () => {
  it('one drone diving a hull: exactly one impact, one penetration roll, no ordinary round, 40 seeds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new Sim({ seed, width: 40, height: 24, capacity: 8 });
      const hull = sim.spawn(sim.addUnitType(HULL), 1, fx.from(20.5), fx.from(12.5), 32768);
      const drone = sim.spawn(sim.addUnitType(MUNITION), 0, fx.from(20.5), fx.from(6.5), 16384);
      sim.identifyTo(0, hull);
      const evs = run(sim, 20 * 12);
      const mine = (e: SimEvent): boolean => 'shooter' in e && e.shooter === drone;
      expect(evs.filter((e) => e.kind === 'fire' && mine(e)), `seed ${seed}: fire events`).toHaveLength(0);
      const impacts = evs.filter((e) => e.kind === 'impact' && mine(e));
      expect(impacts, `seed ${seed}: impacts`).toHaveLength(1);
      const dead = evs.find((e) => e.kind === 'destroyed' && e.entity === drone);
      expect(dead, `seed ${seed}: the drone is spent`).toBeDefined();
      // The one impact is the strike itself: it lands on the tick the drone is destroyed.
      expect(impacts[0].tick).toBe(dead?.tick);
      expect(sim.state.alive[drone]).toBe(0);
    }
  });

  it('the one penetration alone does not kill a sound hull', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new Sim({ seed, width: 40, height: 24, capacity: 8 });
      const hull = sim.spawn(sim.addUnitType(HULL), 1, fx.from(20.5), fx.from(12.5), 32768);
      sim.spawn(sim.addUnitType(MUNITION), 0, fx.from(20.5), fx.from(6.5), 16384);
      sim.identifyTo(0, hull);
      run(sim, 20 * 12);
      expect(sim.state.alive[hull], `seed ${seed}`).toBe(1);
    }
  });

  it('a drone over a garrisoned house does not shell the house (the structure path leaks the same way)', () => {
    const sim = new Sim({ seed: 3, width: 48, height: 32, capacity: 8 });
    const house = sim.addStructure(sim.addStructureType(HOUSE), [14 * 48 + 20, 14 * 48 + 21, 15 * 48 + 20, 15 * 48 + 21]);
    const man = sim.spawn(sim.addUnitType(GARRISONED_MAN), 1, fx.from(17.5), fx.from(14.5));
    sim.queueCommand({ kind: 'garrison', ids: [man], structure: house });
    run(sim, 200);
    expect(sim.state.garrisonedIn[man]).toBe(house);
    const drone = sim.spawn(sim.addUnitType(MUNITION), 0, fx.from(19.9), fx.from(13.9), 16384);
    sim.identifyTo(0, man);
    const evs = run(sim, 100);
    expect(evs.filter((e) => e.kind === 'fire' && e.shooter === drone)).toHaveLength(0);
    expect(sim.state.alive[drone]).toBe(1); // it does not dive at the man inside, and it does not spend itself on the wall
  });
});
