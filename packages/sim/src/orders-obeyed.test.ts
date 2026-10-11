import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from './sim';

// A unit does what it was told and then STAYS told (the lead's ruling,
// 2026-10-11). Two holes, both measured before they were fixed
// (bug-move-obey census): a HALTED attack-mover was restarted by stepSweep the
// very next tick, and an attack-mover that had ARRIVED walked off to the
// nearest contact its side remembered, at any distance -- 18 of 19 KDF types
// stood 8-28 tiles from the clicked tile ten seconds after arriving.
//
// The sweep is not deleted: it is what keeps an AI wave or a scripted commit
// from parking in a staring contest (sweep.test.ts). It is DATA on the order
// now -- `sweep: true` on an attack-move -- and the sim never asks who sent it.

const RIFLES: UnitTypeJson = {
  id: 'o_inf',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 7, effective_range_tiles: 5.5, accuracy: 0.6, penetration: 8, damage: 20, suppression: 40, rof_per_min: 300 },
  ],
};

const TANK: UnitTypeJson = {
  id: 'o_tank',
  hull: { hp: 3000, armor: { front: 700, side: 300, rear: 150 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 1, sight_tiles: 12, signature: 1 },
  weapons: [{ id: 'gun', type: 'apfsds', range_tiles: 12, accuracy: 0.85, penetration: 1300, damage: 520, rof_per_min: 9 }],
};

const dist = (sim: Sim, id: number, x: number, y: number): number =>
  Math.hypot(fx.toNumber(sim.state.posX[id]) - x, fx.toNumber(sim.state.posY[id]) - y);

/** A unit on an empty field, and an enemy far out of sight that its side
 *  identified once and still remembers -- the contact that used to pull it
 *  away. */
function field(type: UnitTypeJson) {
  const sim = new Sim({ seed: 7, width: 48, height: 48, capacity: 16 });
  const t = sim.addUnitType(type);
  const me = sim.spawn(t, 0, fx.from(10.5), fx.from(24.5), 0);
  const foe = sim.spawn(t, 1, fx.from(42.5), fx.from(44.5), 0);
  for (let k = 0; k < 2 * TICKS_PER_SECOND; k++) sim.tick();
  sim.identifyTo(0, foe);
  return { sim, me, foe };
}

describe('a halted unit stays halted', () => {
  for (const type of [RIFLES, TANK]) {
    it(`${type.id}: halt mid attack-move holds for 10 s with a remembered contact`, () => {
      const { sim, me } = field(type);
      sim.queueCommand({ kind: 'attackMove', ids: [me], x: fx.from(30.5), y: fx.from(24.5), sweep: true });
      for (let k = 0; k < 3 * TICKS_PER_SECOND; k++) sim.tick();
      sim.queueCommand({ kind: 'halt', ids: [me] });
      sim.tick();
      const hx = fx.toNumber(sim.state.posX[me]);
      const hy = fx.toNumber(sim.state.posY[me]);
      expect(hx).toBeGreaterThan(11); // it was under way when halted
      for (let k = 0; k < 10 * TICKS_PER_SECOND; k++) sim.tick();
      expect(dist(sim, me, hx, hy)).toBeLessThan(0.05);
      expect(sim.state.moving[me]).toBe(0);
    });
  }
});

describe("an attack-move without `sweep` stops where it was sent", () => {
  for (const type of [RIFLES, TANK]) {
    it(`${type.id}: arrives and holds for 10 s with a remembered contact 25 tiles off`, () => {
      const { sim, me } = field(type);
      sim.queueCommand({ kind: 'attackMove', ids: [me], x: fx.from(20.5), y: fx.from(24.5) });
      let arrived = -1;
      for (let k = 0; k < 30 * TICKS_PER_SECOND && arrived < 0; k++) {
        sim.tick();
        if (sim.state.moving[me] === 0) arrived = k;
      }
      expect(arrived).toBeGreaterThan(0);
      expect(dist(sim, me, 20.5, 24.5)).toBeLessThan(0.05);
      for (let k = 0; k < 10 * TICKS_PER_SECOND; k++) sim.tick();
      expect(dist(sim, me, 20.5, 24.5)).toBeLessThan(0.05);
      expect(sim.state.moving[me]).toBe(0);
    });
  }

  it('a group holds its formation slots, not one tile', () => {
    const sim = new Sim({ seed: 7, width: 48, height: 48, capacity: 16 });
    const t = sim.addUnitType(RIFLES);
    const ids = [0, 1, 2].map((k) => sim.spawn(t, 0, fx.from(10.5), fx.from(22.5 + k), 0));
    const foe = sim.spawn(t, 1, fx.from(42.5), fx.from(44.5), 0);
    for (let k = 0; k < 2 * TICKS_PER_SECOND; k++) sim.tick();
    sim.identifyTo(0, foe);
    sim.queueCommand({ kind: 'attackMove', ids, x: fx.from(20.5), y: fx.from(24.5) });
    for (let k = 0; k < 30 * TICKS_PER_SECOND; k++) sim.tick();
    const slots = ids.map((id) => [fx.toNumber(sim.state.posX[id]), fx.toNumber(sim.state.posY[id])]);
    for (const id of ids) expect(sim.state.moving[id]).toBe(0);
    for (let k = 0; k < 10 * TICKS_PER_SECOND; k++) sim.tick();
    ids.forEach((id, k) => expect(dist(sim, id, slots[k][0], slots[k][1])).toBeLessThan(0.05));
    // ...and those slots are around the clicked tile, not somewhere else.
    for (const [x, y] of slots) expect(Math.hypot(x - 20.5, y - 24.5)).toBeLessThan(2.5);
  });

  it('an appended leg without `sweep` holds at its own point too', () => {
    const { sim, me } = field(RIFLES);
    sim.queueCommand({ kind: 'attackMove', ids: [me], x: fx.from(14.5), y: fx.from(24.5) });
    sim.tick();
    sim.queueCommand({ kind: 'attackMove', ids: [me], x: fx.from(18.5), y: fx.from(20.5), append: true });
    for (let k = 0; k < 30 * TICKS_PER_SECOND; k++) sim.tick();
    expect(dist(sim, me, 18.5, 20.5)).toBeLessThan(0.05);
  });
});

describe('an attack-move WITH `sweep` still hunts (AI waves, scripted commits)', () => {
  it('walks on from its goal to the remembered contact', () => {
    const { sim, me } = field(RIFLES);
    sim.queueCommand({ kind: 'attackMove', ids: [me], x: fx.from(20.5), y: fx.from(24.5), sweep: true });
    for (let k = 0; k < 40 * TICKS_PER_SECOND; k++) sim.tick();
    // Left the ordered point and closed on the memory at (42.5, 44.5).
    expect(dist(sim, me, 20.5, 24.5)).toBeGreaterThan(8);
    expect(dist(sim, me, 42.5, 44.5)).toBeLessThan(dist(sim, me, 20.5, 24.5));
  });

  it('a sweeping leg queued behind a holding one carries its own flag', () => {
    const { sim, me } = field(RIFLES);
    sim.queueCommand({ kind: 'attackMove', ids: [me], x: fx.from(14.5), y: fx.from(24.5) });
    sim.tick();
    sim.queueCommand({ kind: 'attackMove', ids: [me], x: fx.from(18.5), y: fx.from(24.5), append: true, sweep: true });
    for (let k = 0; k < 40 * TICKS_PER_SECOND; k++) sim.tick();
    expect(dist(sim, me, 18.5, 24.5)).toBeGreaterThan(8);
  });
});
