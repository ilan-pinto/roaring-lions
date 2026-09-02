// The civilian flight rule, driven WITHOUT a mission.
//
// `mission.test.ts` already covers this through `MissionRuntime`, which is how
// every shipped mission reaches it. These cases exist because there is now a
// second caller that has no runtime at all -- `?sandbox=<map>&civ` -- and the
// whole point of extracting the rule was that the sandbox drives the same
// object rather than a copy. A test that could only reach it through a mission
// would not prove that.
import { describe, expect, it } from 'vitest';
import { CivilianFlight, CIV_FLEE_AT, SHEPHERD_RADIUS_SQ } from './civilians';
import { fx, HALF } from './fixed';
import { Sim, type UnitTypeJson } from './sim';

const CIVILIANS: UnitTypeJson = {
  id: 'x_civ',
  name: 'Civilians',
  role: 'support',
  hull: { hp: 200, armor: { front: 0, side: 0, rear: 0 }, crew: 6 },
  mobility: { speed_tiles_s: 0.8, turn_rate_deg_s: 360 },
  sensors: { optics: 0.5, sight_tiles: 4, signature: 0.7 },
  weapons: [],
};

const RIFLES: UnitTypeJson = {
  id: 'x_inf',
  name: 'Rifle Squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

const CARRIER: UnitTypeJson = {
  id: 'x_apc',
  name: 'APC',
  role: 'apc',
  hull: { hp: 900, armor: { front: 60, side: 40, rear: 30 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.0, turn_rate_deg_s: 180 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.9 },
  weapons: [],
};

/** A tile centre, the way `main.ts` and `markerPos` both build one. */
const at = (x: number, y: number): readonly [number, number] =>
  [fx.add(fx.fromInt(x), HALF), fx.add(fx.fromInt(y), HALF)] as const;

function world(): {
  sim: Sim;
  civ: (x: number, y: number) => number;
  soldier: (x: number, y: number) => number;
  apc: (x: number, y: number) => number;
} {
  const sim = new Sim({ seed: 11, width: 40, height: 40, capacity: 32 });
  const tCiv = sim.addUnitType(CIVILIANS);
  const tInf = sim.addUnitType(RIFLES);
  const tApc = sim.addUnitType(CARRIER);
  const spawn = (t: number, side: number) => (x: number, y: number) => {
    const [px, py] = at(x, y);
    return sim.spawn(t, side, px, py, 0);
  };
  return { sim, civ: spawn(tCiv, 2), soldier: spawn(tInf, 0), apc: spawn(tApc, 0) };
}

// The refuge the sandbox synthesises: a point, and the 4x4 box around it.
const REFUGE = at(30, 30);
const REFUGE_ZONE = [28, 28, 4, 4] as const;

describe('CivilianFlight without a mission', () => {
  it('leaves a civilian standing until something makes it leave', () => {
    // The default state is the one that matters: a sandbox crowd nobody has
    // walked up to must not wander off on its own.
    const { sim, civ } = world();
    const c = civ(10, 10);
    const flight = new CivilianFlight();
    for (let i = 0; i < 40; i++) {
      flight.step(sim, [c], [], REFUGE);
      sim.tick();
    }
    expect(flight.hasFled(c)).toBe(false);
    expect(sim.state.posX[c] >> 16).toBe(10);
    expect(sim.state.posY[c] >> 16).toBe(10);
  });

  it('breaks for the refuge when a soldier reaches it — the shepherd half', () => {
    // The only way to move a civilian in the sandbox: the player selects side
    // 0, so nothing else can order one.
    const { sim, civ, soldier } = world();
    const c = civ(10, 10);
    const p = soldier(11, 10);
    const flight = new CivilianFlight();
    flight.step(sim, [c], [p], REFUGE);
    expect(flight.hasFled(c)).toBe(true);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(sim.state.posX[c] >> 16).toBeGreaterThan(10);
  });

  it('does not break for a soldier standing outside the shepherd radius', () => {
    const { sim, civ, soldier } = world();
    const c = civ(10, 10);
    // SHEPHERD_RADIUS_SQ is 4 tiles squared in Q8.8; five tiles is outside it.
    const p = soldier(15, 10);
    expect(SHEPHERD_RADIUS_SQ).toBe(1048576);
    new CivilianFlight().step(sim, [c], [p], REFUGE);
    expect(sim.state.moving[c]).toBe(0);
  });

  it('breaks for the refuge under suppression alone — the fear half', () => {
    const { sim, civ } = world();
    const c = civ(10, 10);
    sim.state.suppression[c] = CIV_FLEE_AT + 1;
    const flight = new CivilianFlight();
    flight.step(sim, [c], [], REFUGE);
    expect(flight.hasFled(c)).toBe(true);
  });

  it('boards a transport standing beside it rather than walking', () => {
    const { sim, civ, apc } = world();
    const c = civ(10, 10);
    const v = apc(11, 10);
    new CivilianFlight().step(sim, [c], [v], REFUGE);
    sim.tick();
    expect(sim.state.carriedBy[c]).toBe(v);
  });

  it('counts a civilian standing in the refuge zone, clears alive, and names it', () => {
    // The whole reason the arrival half had to come with the flight half: a
    // sandbox cannot write `alive` itself (invariant 4), and the renderer
    // cannot tell a rescue from a killing without being handed the id.
    const { sim, civ } = world();
    const c = civ(30, 30);
    const flight = new CivilianFlight();
    expect(flight.collect(sim, [c], REFUGE_ZONE)).toEqual([c]);
    expect(sim.state.alive[c]).toBe(0);
    expect(flight.evacuatedCount).toBe(1);
  });

  it('names each civilian exactly once, however often it is asked', () => {
    // `main.ts` calls this every tick. A second report would fade a civilian
    // who is already gone and double the count.
    const { sim, civ } = world();
    const c = civ(30, 30);
    const flight = new CivilianFlight();
    expect(flight.collect(sim, [c], REFUGE_ZONE)).toEqual([c]);
    expect(flight.collect(sim, [c], REFUGE_ZONE)).toEqual([]);
    expect(flight.evacuatedCount).toBe(1);
  });

  it('never names a casualty', () => {
    // `alive = 0` is the record BOTH leave. Reporting a dead civilian as
    // evacuated would play the walk-out fade over a corpse.
    const { sim, civ } = world();
    const c = civ(30, 30);
    sim.state.alive[c] = 0;
    const flight = new CivilianFlight();
    expect(flight.collect(sim, [c], REFUGE_ZONE)).toEqual([]);
    expect(flight.evacuatedCount).toBe(0);
  });

  it('does not count someone standing outside the zone', () => {
    const { sim, civ } = world();
    const c = civ(27, 30); // one tile west of the box
    expect(new CivilianFlight().collect(sim, [c], REFUGE_ZONE)).toEqual([]);
  });

  it('re-orders one that stopped short, and stops once it is on the refuge', () => {
    // The dead-transport debt, reached from the sandbox: the latch is set
    // before the order is confirmed, so a civilian that ends up standing still
    // must be ordered again -- but NOT one already on the refuge, which would
    // queue a dead command every tick for the rest of the session.
    //
    // `arrived` stands TWO tiles off the refuge, not on it. On it, a re-order
    // moves nobody anywhere and the second assertion passes whether the guard
    // is there or not -- which is how it was written first, and it could not
    // fail. Two tiles is inside SHEPHERD_RADIUS_SQ (four) and far enough that
    // an order actually shows.
    const { sim, civ, soldier } = world();
    const stalled = civ(10, 10);
    const arrived = civ(32, 30);
    const far = soldier(11, 10);
    const near = soldier(33, 30);
    const flight = new CivilianFlight();
    flight.step(sim, [stalled, arrived], [far, near], REFUGE);
    sim.tick();
    expect(flight.hasFled(stalled) && flight.hasFled(arrived)).toBe(true);
    // Stop them both where they stand, as a dead carrier would.
    sim.queueCommand({ kind: 'halt', ids: [stalled, arrived] });
    sim.tick();
    flight.step(sim, [stalled, arrived], [far, near], REFUGE);
    sim.tick();
    expect(sim.state.moving[stalled]).toBe(1);
    expect(sim.state.moving[arrived]).toBe(0);
  });
});
