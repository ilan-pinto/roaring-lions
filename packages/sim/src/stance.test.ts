import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type Command, type UnitTypeJson } from './sim';
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
  it('a carried unit is left as it is by hold AND by ambush (D2): still aboard, no ambush', () => {
    // carriers.test.ts's fixture: a jeep with two seats, boarded through the sim's own `load` command.
    const sim = new Sim({ seed: 6, width: 40, height: 20, capacity: 32 });
    const jeep = sim.addUnitType({
      id: 'c_jeep', role: 'technical', hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 2 },
      mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 }, sensors: { optics: 1, sight_tiles: 9, signature: 0.8 }, weapons: [],
    });
    const car = sim.spawn(jeep, 1, fx.from(6.5), fx.from(10.5));
    const u = sim.spawn(sim.addUnitType(RIFLES), 1, fx.from(5.5), fx.from(10.5));
    sim.queueCommand({ kind: 'load', ids: [u], carrier: car });
    for (let i = 0; i < 10 * TICKS_PER_SECOND && sim.state.carriedBy[u] < 0; i++) sim.tick();
    expect(sim.state.carriedBy[u]).toBe(car);
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'ambush' });
    sim.tick();
    expect([sim.state.carriedBy[u], sim.ambushRadiusSqOf(u)]).toEqual([car, 0]);
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'hold' });
    sim.tick();
    expect([sim.state.carriedBy[u], sim.ambushRadiusSqOf(u)]).toEqual([car, 0]);
  });
  it('a buried unit (in a tunnel) is unaffected by hold AND by ambush: the containment filter drops it', () => {
    const sim = new Sim({ seed: 9, width: 32, height: 16, capacity: 16 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    const u = sim.spawn(sim.addUnitType(RIFLES), 1, fx.from(8.5), fx.from(6.5));
    sim.putInTunnel(u, idx);
    expect(sim.state.tunnelIn[u]).toBe(idx);
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'ambush' });
    sim.tick();
    expect([sim.state.tunnelIn[u], sim.ambushRadiusSqOf(u)]).toEqual([idx, 0]);
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'hold' });
    sim.tick();
    expect(sim.state.tunnelIn[u]).toBe(idx);
  });
  it('the mission default radius is fx.from(3), the sim default', () => {
    expect(fx.from(3)).toBe(196608);
    expect(AMBUSH_RADIUS_DEFAULT).toBe(fx.from(3));
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

describe('setStance patrol (N3 Task 9, Q6)', () => {
  const P = (x: number, y: number): [number, number] => [fx.from(x), fx.from(y)];
  const tileOf = (sim: Sim, u: number): string => `${fx.toInt(sim.state.posX[u])},${fx.toInt(sim.state.posY[u])}`;
  const BEAT = [P(6.5, 8.5), P(14.5, 8.5), P(14.5, 3.5)];
  const BEAT_TILES = ['6,8', '14,8', '14,3'];

  /** The waypoint tiles a unit stands on, in the order it first reaches each (repeats collapsed). */
  function visits(sim: Sim, u: number, ticks: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < ticks; i++) {
      sim.tick();
      const t = tileOf(sim, u);
      if (BEAT_TILES.includes(t) && out[out.length - 1] !== t) out.push(t);
    }
    return out;
  }

  it('walks its beat in order and goes round again', () => {
    const { sim, rifles } = field();
    const u = sim.spawn(rifles, 1, fx.from(3.5), fx.from(8.5));
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'patrol', waypoints: BEAT });
    const seen = visits(sim, u, 60 * TICKS_PER_SECOND);
    expect(sim.isPatrolling(u)).toBe(true);
    expect(seen.slice(0, 7)).toEqual([...BEAT_TILES, ...BEAT_TILES, BEAT_TILES[0]]);
  });

  it('a move naming the unit ends it: it goes where it was sent and stays', () => {
    const { sim, rifles } = field();
    const u = sim.spawn(rifles, 1, fx.from(3.5), fx.from(8.5));
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'patrol', waypoints: BEAT });
    run(sim, 3 * TICKS_PER_SECOND);
    sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(25.5), y: fx.from(12.5) });
    run(sim, 1);
    expect(sim.isPatrolling(u)).toBe(false);
    run(sim, 40 * TICKS_PER_SECOND);
    expect([tileOf(sim, u), sim.state.moving[u]]).toEqual(['25,12', 0]);
  });

  it('every other order ends it too -- halt, hold, smoke, unload and an appended move -- but a refused attack does not', () => {
    const cases: Command[] = [];
    const { sim, rifles } = field();
    const ids: number[] = [];
    for (let k = 0; k < 6; k++) ids.push(sim.spawn(rifles, 1, fx.from(3.5), fx.from(2.5 + 2 * k)));
    const enemy = sim.spawn(rifles, 0, fx.from(30.5), fx.from(14.5)); // not identified: attack is refused
    cases.push({ kind: 'halt', ids: [ids[0]] });
    cases.push({ kind: 'setStance', ids: [ids[1]], stance: 'hold' });
    cases.push({ kind: 'smoke', ids: [ids[2]], x: fx.from(4.5), y: fx.from(6.5) });
    cases.push({ kind: 'unload', ids: [ids[3]] });
    cases.push({ kind: 'move', ids: [ids[4]], x: fx.from(20.5), y: fx.from(12.5), append: true });
    for (const id of ids) sim.queueCommand({ kind: 'setStance', ids: [id], stance: 'patrol', waypoints: BEAT });
    run(sim, 10);
    expect(ids.map((id) => sim.isPatrolling(id))).toEqual([true, true, true, true, true, true]);
    for (const c of cases) sim.queueCommand(c);
    sim.queueCommand({ kind: 'attack', ids: [ids[5]], target: enemy });
    run(sim, 1);
    expect(ids.map((id) => sim.isPatrolling(id))).toEqual([false, false, false, false, false, true]);
  });

  it('a dead, routed, garrisoned or carried id is not put on a patrol (what hold and ambush skip)', () => {
    const sim = new Sim({ seed: 9, width: 32, height: 16, capacity: 16 });
    const rifles = sim.addUnitType(RIFLES);
    const s = sim.addStructure(sim.addStructureType(HOUSE), [8 * 32 + 10, 8 * 32 + 11, 9 * 32 + 10, 9 * 32 + 11]);
    const g = sim.spawn(rifles, 1, fx.from(8.5), fx.from(8.5));
    const dead = sim.spawn(rifles, 1, fx.from(3.5), fx.from(3.5));
    sim.queueCommand({ kind: 'garrison', ids: [g], structure: s });
    for (let i = 0; i < 20 * TICKS_PER_SECOND && sim.state.garrisonedIn[g] < 0; i++) sim.tick();
    expect(sim.state.garrisonedIn[g]).toBe(s);
    sim.debugKill(dead);
    sim.queueCommand({ kind: 'setStance', ids: [g, dead], stance: 'patrol', waypoints: BEAT });
    run(sim, 30);
    expect([sim.isPatrolling(g), sim.isPatrolling(dead), sim.state.garrisonedIn[g]]).toEqual([false, false, s]);
  });

  it('a count outside 2..MAX_PATROL_WAYPOINTS is refused whole: the unit is not even halted', () => {
    const { sim, rifles } = field();
    const u = sim.spawn(rifles, 1, fx.from(3.5), fx.from(8.5));
    sim.queueCommand({ kind: 'move', ids: [u], x: fx.from(25.5), y: fx.from(8.5) });
    run(sim, 5);
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'patrol', waypoints: [P(6.5, 8.5)] });
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'patrol', waypoints: [...BEAT, P(1.5, 1.5), P(2.5, 2.5)] });
    run(sim, 1);
    expect([sim.isPatrolling(u), sim.state.moving[u], sim.goalOf(u)]).toEqual([false, 1, [fx.from(25.5), fx.from(8.5)]]);
  });

  it('a buried patroller holds its index, and its stance', () => {
    const sim = new Sim({ seed: 9, width: 32, height: 16, capacity: 16 });
    const idx = sim.addTunnel({ id: 'tn', points: [[4, 6], [12, 6]] as const, dig_tiles_per_s: 1 });
    const u = sim.spawn(sim.addUnitType(RIFLES), 1, fx.from(3.5), fx.from(8.5));
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'patrol', waypoints: BEAT });
    run(sim, 2);
    const at = sim.patrolIndexOf(u);
    expect(at).toBe(1); // leg 0 issued, the next leg is waypoint 1
    sim.putInTunnel(u, idx);
    run(sim, 30 * TICKS_PER_SECOND);
    expect([sim.state.tunnelIn[u], sim.isPatrolling(u), sim.patrolIndexOf(u)]).toEqual([idx, true, at]);
  });

  it('a routed patroller holds its index, and keeps its beat', () => {
    // Broken by suppression applied by hand, with no enemy anywhere: the rout then has nowhere to
    // run from and HOLDS (moving 0), which is the case the skip is for -- a fleeing unit is moving,
    // and the patrol leaves a moving unit alone anyway. Without the skip the patrol would advance
    // its index every tick against a move the sim refuses a routed unit.
    const { sim, rifles } = field();
    const u = sim.spawn(rifles, 1, fx.from(3.5), fx.from(8.5));
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'patrol', waypoints: BEAT });
    for (let i = 0; i < 60 * TICKS_PER_SECOND && sim.state.routed[u] !== 1; i++) {
      sim.debugSuppress(u, fx.from(0.2));
      sim.tick();
    }
    expect(sim.state.routed[u]).toBe(1);
    const at = sim.patrolIndexOf(u);
    expect(at).toBeGreaterThanOrEqual(0);
    const indices = new Set<number>();
    let stillTicks = 0;
    for (let k = 0; k < 120 * TICKS_PER_SECOND; k++) {
      sim.tick();
      if (sim.state.routed[u] !== 1) break;
      if (sim.state.moving[u] === 0) stillTicks++;
      indices.add(sim.patrolIndexOf(u));
    }
    expect(stillTicks).toBeGreaterThan(20);
    expect([...indices]).toEqual([at]);
    expect(sim.isPatrolling(u)).toBe(true);
  });

  it('a patroller that routs AWAY from a known enemy keeps its beat through the flight', () => {
    // rout.test.ts's shooter, with the suppression applied by hand: the target knows of it, so it flees.
    const sim = new Sim({ seed: 0x291, width: 32, height: 16, capacity: 8 });
    const shooter = sim.addUnitType({ ...RIFLES, id: 'r_shooter', abilities: [], sensors: { optics: 1, sight_tiles: 8, signature: 0.6 }, mobility: { speed_tiles_s: 0.9 }, weapons: [{ id: 'rifle', type: 'small_arms', range_tiles: 8, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 }] });
    const target = sim.addUnitType({ ...RIFLES, id: 'r_target', abilities: [], hull: { hp: 6000, armor: { front: 10, side: 10, rear: 10 } }, mobility: { speed_tiles_s: 0.9 } });
    sim.spawn(shooter, 1, fx.from(6.5), fx.from(8.5));
    const u = sim.spawn(target, 0, fx.from(12.5), fx.from(8.5));
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'patrol', waypoints: [P(12.5, 8.5), P(20.5, 8.5)] });
    for (let i = 0; i < 60 * TICKS_PER_SECOND && sim.state.routed[u] !== 1; i++) {
      sim.debugSuppress(u, fx.from(0.2));
      sim.tick();
    }
    expect([sim.state.routed[u], sim.state.moving[u], sim.isPatrolling(u)]).toEqual([1, 1, true]);
  });

  it('contact halts a patroller that halts to fire, keeps its leg, and it walks that leg once the target is gone', () => {
    const { sim, rifles } = field();
    const target = sim.addUnitType({ ...RIFLES, id: 'p_target', weapons: [], hull: { hp: 6000, armor: { front: 10, side: 10, rear: 10 } } });
    const u = sim.spawn(rifles, 1, fx.from(3.5), fx.from(8.5));
    sim.queueCommand({ kind: 'setStance', ids: [u], stance: 'patrol', waypoints: [P(26.5, 8.5), P(3.5, 8.5)] });
    run(sim, 2);
    expect([sim.state.moving[u], sim.patrolIndexOf(u)]).toEqual([1, 1]);
    // An enemy appears ahead of it, inside its rifle's reach of the path.
    const e = sim.spawn(target, 0, fx.from(14.5), fx.from(8.5));
    let i = 0;
    for (; i < 30 * TICKS_PER_SECOND && sim.state.curTarget[u] !== e; i++) sim.tick();
    expect(sim.state.curTarget[u]).toBe(e);
    run(sim, 2);
    // Halted to fight, still on its beat, its next leg the interrupted one (waypoint 0).
    expect([sim.state.moving[u], sim.isPatrolling(u), sim.patrolIndexOf(u), sim.state.curTarget[u]]).toEqual([0, true, 0, e]);
    const xHalted = sim.state.posX[u];
    run(sim, 3 * TICKS_PER_SECOND);
    expect(sim.state.posX[u]).toBe(xHalted); // it stands and fights
    sim.debugKill(e);
    run(sim, 3);
    expect([sim.state.moving[u], sim.goalOf(u)[0], sim.patrolIndexOf(u)]).toEqual([1, fx.from(26.5), 1]);
  });
});
