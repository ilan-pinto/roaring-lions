import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from './sim';

// Attack-move must not end in a staring contest. When a unit has no current
// contact it advances on the last place the enemy was seen, the way troops
// actually clear ground — instead of parking while a hidden defender waits
// out the mission clock.

const RIFLES: UnitTypeJson = {
  id: 'w_inf',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 20, suppression: 40, rof_per_min: 300 },
  ],
};

const HOUSE = { id: 'w_house', name: 'House', hp_per_tile: 400, garrison_slots: 2, rubble_cover: 2 };

function wall(sim: Sim, x: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) sim.setBlocked(x, y, true);
}

describe('sweeping toward the last known contact', () => {
  it('advances on the last seen position instead of parking', () => {
    const sim = new Sim({ seed: 3, width: 40, height: 16, capacity: 16 });
    const inf = sim.addUnitType(RIFLES);
    const hunter = sim.spawn(inf, 0, fx.from(4.5), fx.from(8.5));
    // A quarry that is seen, then steps out of sight behind a wall.
    const quarry = sim.spawn(inf, 1, fx.from(11.5), fx.from(8.5));
    sim.queueCommand({ kind: 'attackMove', ids: [hunter], x: fx.from(6.5), y: fx.from(8.5) });
    for (let t = 0; t < 6 * TICKS_PER_SECOND; t++) sim.tick(); // acquire contact

    // The quarry withdraws far away; the hunter has arrived at its goal.
    sim.teleport(quarry, fx.from(34.5), fx.from(2.5));
    const before = fx.toNumber(sim.state.posX[hunter]);
    for (let t = 0; t < 30 * TICKS_PER_SECOND; t++) sim.tick();
    const after = fx.toNumber(sim.state.posX[hunter]);

    // It should have moved onto where the enemy was last seen (x ≈ 11.5),
    // not sat at its original objective.
    expect(after).toBeGreaterThan(before + 2);
    expect(after).toBeGreaterThan(9);
  });

  it('gives up once its memories are exhausted rather than wandering forever', () => {
    const sim = new Sim({ seed: 4, width: 40, height: 16, capacity: 16 });
    const inf = sim.addUnitType(RIFLES);
    const hunter = sim.spawn(inf, 0, fx.from(4.5), fx.from(8.5));
    const quarry = sim.spawn(inf, 1, fx.from(10.5), fx.from(8.5));
    sim.queueCommand({ kind: 'attackMove', ids: [hunter], x: fx.from(6.5), y: fx.from(8.5) });
    for (let t = 0; t < 6 * TICKS_PER_SECOND; t++) sim.tick();
    sim.debugKill(quarry); // contact remembered, enemy gone

    for (let t = 0; t < 60 * TICKS_PER_SECOND; t++) sim.tick();
    const restX = fx.toNumber(sim.state.posX[hunter]);
    const restY = fx.toNumber(sim.state.posY[hunter]);
    for (let t = 0; t < 20 * TICKS_PER_SECOND; t++) sim.tick();
    // Settled: no endless pacing between stale memories.
    expect(Math.abs(fx.toNumber(sim.state.posX[hunter]) - restX)).toBeLessThan(0.5);
    expect(Math.abs(fx.toNumber(sim.state.posY[hunter]) - restY)).toBeLessThan(0.5);
    expect(sim.state.moving[hunter]).toBe(0);
  });

  it('re-acquires a defender who breaks contact, instead of standing still', () => {
    // The shape of the measured bug: the assault trades fire, the last
    // defender pulls back out of sight, and both sides stop — attackers
    // parked on their objective, defender waiting out the clock.
    const sim = new Sim({ seed: 11, width: 40, height: 20, capacity: 32 });
    const inf = sim.addUnitType(RIFLES);
    const house = sim.addStructureType(HOUSE);
    const tiles: number[] = [];
    for (let y = 8; y < 10; y++) for (let x = 26; x < 28; x++) tiles.push(y * 40 + x);
    sim.addStructure(house, tiles);

    const force: number[] = [];
    for (let k = 0; k < 2; k++) force.push(sim.spawn(inf, 0, fx.from(3.5), fx.from(8.5 + k)));
    const holdout = sim.spawn(inf, 1, fx.from(25.5), fx.from(9.5));
    sim.queueCommand({ kind: 'attackMove', ids: force, x: fx.from(20.5), y: fx.from(9.5) });

    // Contact is made at range, then the defender breaks off behind the
    // building before the volume of fire tells.
    for (let t = 0; t < 11 * TICKS_PER_SECOND; t++) sim.tick();
    expect(sim.state.alive[holdout]).toBe(1);
    sim.queueCommand({ kind: 'move', ids: [holdout], x: fx.from(30.5), y: fx.from(13.5) });

    let endedAt = -1;
    for (let t = 0; t < 180 * TICKS_PER_SECOND && endedAt < 0; t++) {
      sim.tick();
      if (sim.state.alive[holdout] === 0) endedAt = t;
    }
    expect(endedAt).toBeGreaterThan(0);
    expect(endedAt).toBeLessThan(150 * TICKS_PER_SECOND);
  });

  it('stays deterministic while sweeping', () => {
    const build = (): number => {
      const sim = new Sim({ seed: 909, width: 40, height: 20, capacity: 32 });
      const inf = sim.addUnitType(RIFLES);
      wall(sim, 18, 0, 8);
      const force: number[] = [];
      for (let k = 0; k < 4; k++) force.push(sim.spawn(inf, 0, fx.from(3.5), fx.from(6.5 + k)));
      sim.spawn(inf, 1, fx.from(28.5), fx.from(5.5));
      sim.spawn(inf, 1, fx.from(30.5), fx.from(14.5));
      sim.queueCommand({ kind: 'attackMove', ids: force, x: fx.from(26.5), y: fx.from(10.5) });
      for (let t = 0; t < 1200; t++) sim.tick();
      return sim.hash();
    };
    expect(build()).toBe(build());
  });
});
