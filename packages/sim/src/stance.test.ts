import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from './sim';
import { AMBUSH_RADIUS_DEFAULT } from './tuning';

const RIFLES: UnitTypeJson = {
  id: 'b_inf',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 },
  ],
};
const HOUSE = { id: 'house', name: 'House', hp_per_tile: 200, garrison_slots: 4, rubble_cover: 2 };

function field() {
  const sim = new Sim({ seed: 9, width: 32, height: 16, capacity: 16 });
  const rifles = sim.addUnitType(RIFLES);
  return { sim, rifles };
}
const run = (sim: Sim, ticks: number): void => { for (let i = 0; i < ticks; i++) sim.tick(); };
const sq = (r: number): number => fx.mul(r, r);

describe('setStance (N2, L3)', () => {
  it('ambush halts the unit and arms the trap at the given radius', () => {
    const { sim, rifles } = field();
    const u = sim.spawn(rifles, 1, fx.from(4.5), fx.from(8.5));
    sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(20.5), y: fx.from(8.5) });
    run(sim, 10);
    expect(sim.state.moving[u]).toBe(1);
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'ambush', radius: fx.from(5) });
    run(sim, 1);
    expect(sim.state.moving[u]).toBe(0);
    expect(sim.ambushRadiusSqOf(u)).toBe(sq(fx.from(5)));
  });
  it('ambush with no radius uses the mission default, 3 tiles', () => {
    const { sim, rifles } = field();
    const u = sim.spawn(rifles, 1, fx.from(4.5), fx.from(8.5));
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'ambush' });
    run(sim, 1);
    expect(AMBUSH_RADIUS_DEFAULT).toBe(196608);
    expect(sim.ambushRadiusSqOf(u)).toBe(sq(196608));
  });
  it('hold drops an ambush and stops the walk', () => {
    const { sim, rifles } = field();
    const u = sim.spawn(rifles, 1, fx.from(4.5), fx.from(8.5));
    sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(20.5), y: fx.from(8.5) });
    run(sim, 5);
    sim.setAmbush(u, fx.from(3)); // ambushing while still walking, as a mission could leave it
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'hold' });
    run(sim, 1);
    expect([sim.ambushRadiusSqOf(u), sim.state.moving[u]]).toEqual([0, 0]);
  });
  it('a garrisoned unit is left as it is by hold AND by ambush (D2): still inside, no ambush', () => {
    const sim = new Sim({ seed: 9, width: 32, height: 16, capacity: 16 });
    const s = sim.addStructure(sim.addStructureType(HOUSE), [8 * 32 + 10, 8 * 32 + 11, 9 * 32 + 10, 9 * 32 + 11]);
    const u = sim.spawn(sim.addUnitType(RIFLES), 1, fx.from(8.5), fx.from(8.5));
    sim.queueCommand({ kind: 'garrison', ids: [u], structure: s });
    for (let i = 0; i < 20 * TICKS_PER_SECOND && sim.state.garrisonedIn[u] < 0; i++) sim.tick();
    expect(sim.state.garrisonedIn[u]).toBe(s);
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'hold' });
    sim.tick();
    expect(sim.state.garrisonedIn[u]).toBe(s);
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'ambush' });
    sim.tick();
    expect([sim.state.garrisonedIn[u], sim.ambushRadiusSqOf(u)]).toEqual([s, 0]);
  });
  it('ambush skips a dead id and still applies to the living one beside it', () => {
    const { sim, rifles } = field();
    const a = sim.spawn(rifles, 1, fx.from(4.5), fx.from(8.5));
    const b = sim.spawn(rifles, 1, fx.from(4.5), fx.from(10.5));
    sim.debugKill(b);
    sim.queueCommand({ kind: 'setStance', ids: [a, b], stance: 'ambush' });
    run(sim, 1);
    expect([sim.ambushRadiusSqOf(a), sim.ambushRadiusSqOf(b)]).toEqual([sq(196608), 0]);
  });
  it('ambush skips a routed id', () => {
    // rout.test.ts's fixture: an outranged, blind target eight tiles from a rifle is pinned until it routs.
    const sim = new Sim({ seed: 0x291, width: 32, height: 16, capacity: 8 });
    const shooter = sim.addUnitType({ ...RIFLES, id: 'r_shooter', abilities: [], sensors: { optics: 1, sight_tiles: 8, signature: 0.6 }, mobility: { speed_tiles_s: 0.9 }, weapons: [{ id: 'rifle', type: 'small_arms', range_tiles: 8, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 }] });
    const target = sim.addUnitType({ ...RIFLES, id: 'r_target', abilities: [], hull: { hp: 6000, armor: { front: 10, side: 10, rear: 10 } }, sensors: { optics: 1, sight_tiles: 7, signature: 0.6 }, mobility: { speed_tiles_s: 0.9 } });
    sim.spawn(shooter, 1, fx.from(4.5), fx.from(8.5));
    const u = sim.spawn(target, 0, fx.from(12.5), fx.from(8.5));
    for (let i = 0; i < 60 * TICKS_PER_SECOND && sim.state.routed[u] !== 1; i++) sim.tick();
    expect(sim.state.routed[u]).toBe(1);
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'ambush' });
    run(sim, 1);
    expect(sim.ambushRadiusSqOf(u)).toBe(0);
  });
  it('releases an attack focus, as every order but attack does', () => {
    const { sim, rifles } = field();
    const me = sim.spawn(rifles, 1, fx.from(4.5), fx.from(8.5));
    const them = sim.spawn(rifles, 0, fx.from(9.5), fx.from(8.5));
    sim.identifyTo(1, them); // focus.test.ts's fixture: canFocus wants the target identified to the attacker's side
    sim.queueCommand({ kind: 'attack', ids: [me], target: them });
    run(sim, 1);
    expect(sim.state.focusTarget[me]).toBe(them);
    sim.queueCommand({ kind: 'setStance', ids: [me], stance: 'hold' });
    run(sim, 1);
    expect(sim.state.focusTarget[me]).toBe(-1);
  });
});
