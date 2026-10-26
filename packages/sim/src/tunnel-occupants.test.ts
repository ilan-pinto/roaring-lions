/**
 * Every way out of a slot releases it exactly once: a tunnel's occupancy
 * (`tnOccupants`) and a carrier's seat count (`passengers`). The garrison half
 * (`stOccupants`) is pinned in garrison.test.ts. Before this file, `destroy`
 * and `removeFromPlay` cleared `garrisonedIn` through `releaseSlot` but left a
 * buried unit's `tunnelIn` set and its route's count high, so a unit that died
 * or was taken off the board below ground held a phantom slot for the rest of
 * the match; and `destroy` of a rider left a ghost seat aboard its carrier.
 */
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';

const RIFLE: UnitTypeJson = {
  id: 'to_rifle',
  role: 'infantry',
  hull: { hp: 20000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [
    {
      id: 'to_rifle_w',
      type: 'small_arms',
      range_tiles: 8,
      effective_range_tiles: 6.4,
      accuracy: 0.6,
      penetration: 8,
      damage: 15,
      rof_per_min: 300,
    },
  ],
};
const JEEP: UnitTypeJson = {
  id: 'to_jeep',
  role: 'technical',
  hull: { hp: 500, armor: { front: 12, side: 8, rear: 8 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.8, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};

function world(capacity: number) {
  const sim = new Sim({ seed: 9, width: 30, height: 14, capacity: 16 /* unit slots */, humanHeld: [true, true] });
  const route = sim.addTunnel({
    id: 'to_a',
    points: [[4, 6], [14, 6]],
    dig_tiles_per_s: 1,
    pre_dug: true,
    side: 1,
    capacity,
  });
  const other = sim.addTunnel({
    id: 'to_b',
    points: [[4, 10], [14, 10]],
    dig_tiles_per_s: 1,
    pre_dug: true,
    side: 1,
    capacity,
  });
  const rifle = sim.addUnitType(RIFLE);
  const jeep = sim.addUnitType(JEEP);
  const units = [0, 1, 2].map((k) => sim.spawn(rifle, 1, fx.from(2.5), fx.from(5.5 + k * 0.25)));
  return { sim, route, other, rifle, jeep, units };
}

/** Order `ids` into route `r` and tick until all are below (bounded). */
function goBelow(w: ReturnType<typeof world>, ids: number[], r = w.route): void {
  w.sim.queueCommand({ kind: 'enterTunnel', ids, tunnel: r });
  for (let t = 0; t < 400 && ids.some((id) => w.sim.state.tunnelIn[id] < 0); t++) w.sim.tick();
}

describe('a tunnel slot is released on every exit path, exactly once', () => {
  for (const how of ['removeFromPlay', 'debugKill'] as const) {
    it(`${how} of a buried unit frees its slot, and the next unit is let in`, () => {
      const w = world(1);
      const [a, b] = w.units;
      goBelow(w, [a]);
      expect([w.sim.state.tunnelIn[a], w.sim.tnOccupants[w.route]]).toEqual([w.route, 1]);

      if (how === 'removeFromPlay') w.sim.removeFromPlay(a);
      else w.sim.debugKill(a);
      expect(w.sim.state.alive[a]).toBe(0);
      expect(w.sim.state.tunnelIn[a]).toBe(-1);
      expect(w.sim.tnOccupants[w.route]).toBe(0);

      // The route was full (capacity 1) and is not any more: the next man goes below.
      goBelow(w, [b]);
      expect([w.sim.state.tunnelIn[b], w.sim.tnOccupants[w.route]]).toEqual([w.route, 1]);
    });
  }

  it('a body already gone is not released again (guarded by alive; the other bodies keep their slots)', () => {
    const w = world(3);
    const [a, b] = w.units;
    goBelow(w, [a, b]);
    expect(w.sim.tnOccupants[w.route]).toBe(2);
    w.sim.removeFromPlay(a);
    w.sim.removeFromPlay(a);
    w.sim.debugKill(a);
    expect(w.sim.tnOccupants[w.route]).toBe(1); // b is still below
    w.sim.debugKill(b);
    w.sim.removeFromPlay(b);
    expect(w.sim.tnOccupants[w.route]).toBe(0);
  });

  it('the count is per route: a death on one route leaves the other alone', () => {
    const w = world(3);
    const [a, b] = w.units;
    goBelow(w, [a]);
    goBelow(w, [b], w.other);
    expect([w.sim.tnOccupants[w.route], w.sim.tnOccupants[w.other]]).toEqual([1, 1]);
    w.sim.removeFromPlay(a);
    expect([w.sim.tnOccupants[w.route], w.sim.tnOccupants[w.other]]).toEqual([0, 1]);
  });

  it('a collapse leaves the route at zero with its dead unburied (control: the zeroing hides a double release, so this cannot see one)', () => {
    const w = world(3);
    const [a, b] = w.units;
    goBelow(w, [a, b]);
    w.sim.debugCollapseTunnel(w.route);
    expect(w.sim.tnOccupants[w.route]).toBe(0);
    for (const id of [a, b]) expect([w.sim.state.alive[id], w.sim.state.tunnelIn[id]]).toEqual([0, -1]);
    w.sim.removeFromPlay(a);
    w.sim.debugKill(b);
    expect(w.sim.tnOccupants[w.route]).toBe(0);
  });

  it('surfacing for good (exit) frees the slot once, and a later death changes nothing', () => {
    const w = world(3);
    const [a, b] = w.units;
    goBelow(w, [a, b]);
    for (let t = 0; t < 420; t++) w.sim.tick(); // the crawl to the vent
    w.sim.queueCommand({ kind: 'vent', ids: [a], mode: 'exit' });
    w.sim.tick();
    expect([w.sim.state.tunnelIn[a], w.sim.tnOccupants[w.route]]).toEqual([-1, 1]);
    w.sim.removeFromPlay(a);
    expect(w.sim.tnOccupants[w.route]).toBe(1); // b is still below
  });

  it('moving a buried unit to another route gives up the first', () => {
    const w = world(3);
    const [a] = w.units;
    goBelow(w, [a]);
    w.sim.putInTunnel(a, w.other);
    expect([w.sim.tnOccupants[w.route], w.sim.tnOccupants[w.other]]).toEqual([0, 1]);
    w.sim.putInTunnel(a, w.other); // the same route again is a no-op
    expect(w.sim.tnOccupants[w.other]).toBe(1);
  });
});

describe('a carrier seat is released when its rider dies', () => {
  it('debugKill of a rider vacates the seat: no ghost aboard, and the seat can be taken', () => {
    const w = world(1);
    const car = w.sim.spawn(w.jeep, 1, fx.from(10.5), fx.from(10.5));
    const a = w.sim.spawn(w.rifle, 1, fx.from(20.5), fx.from(12.5));
    const b = w.sim.spawn(w.rifle, 1, fx.from(21.5), fx.from(12.5));
    const c = w.sim.spawn(w.rifle, 1, fx.from(22.5), fx.from(12.5));
    expect(w.sim.embarkAtSpawn(car, a)).toBe(true);
    expect(w.sim.embarkAtSpawn(car, b)).toBe(true);
    expect(w.sim.embarkAtSpawn(car, c)).toBe(false); // two seats, both taken

    w.sim.debugKill(a);
    expect([w.sim.state.alive[a], w.sim.state.carriedBy[a]]).toEqual([0, -1]);
    expect(w.sim.passengerCount(car)).toBe(1); // b only
    expect(w.sim.embarkAtSpawn(car, c)).toBe(true); // the dead man's seat is free
    expect(w.sim.passengerCount(car)).toBe(2);
  });
});
