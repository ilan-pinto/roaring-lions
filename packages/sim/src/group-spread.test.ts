import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';

// GH-972 (lead, 3 Nov 2026): a big selection ordered to LOAD spreads across the carriers it selected, and one
// ordered into a house spreads across the houses in reach, when it is ordered with `spread` / `carriers`.
// The assignment lives in the sim, so both seats of a versus room resolve it alike (see the ledger in
// docs/agent-notes/sim-and-orders.md). Absent the opt-in, the order is today's, bit for bit.

const SMALL = { id: 'sp_small', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 };
const BIG = { id: 'sp_big', name: 'Big house', hp_per_tile: 260, garrison_slots: 4, rubble_cover: 2 };
const SHED = { id: 'sp_shed', name: 'Shed', hp_per_tile: 120, garrison_slots: 1, rubble_cover: 1 };

const RIFLES: UnitTypeJson = {
  id: 'sp_rifles', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [],
};
const APC3: UnitTypeJson = {
  id: 'sp_apc3', role: 'technical',
  hull: { hp: 900, armor: { front: 20, side: 15, rear: 10 }, transport_slots: 3 },
  mobility: { speed_tiles_s: 2.5, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};
const APC2: UnitTypeJson = { ...APC3, id: 'sp_apc2', hull: { ...APC3.hull, transport_slots: 2 } };
const APC1: UnitTypeJson = { ...APC3, id: 'sp_apc1', hull: { ...APC3.hull, transport_slots: 1 } };

function world(seed = 5) {
  const sim = new Sim({ seed, width: 48, height: 32, capacity: 64 });
  const t = { small: sim.addStructureType(SMALL), big: sim.addStructureType(BIG), shed: sim.addStructureType(SHED) };
  const u = { rifles: sim.addUnitType(RIFLES), apc3: sim.addUnitType(APC3), apc2: sim.addUnitType(APC2), apc1: sim.addUnitType(APC1) };
  return { sim, t, u };
}

function rect(sim: Sim, typeIdx: number, x: number, y: number, w = 2, h = 2): number {
  const tiles: number[] = [];
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) tiles.push(ty * sim.width + tx);
  return sim.addStructure(typeIdx, tiles);
}

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

/** How many of `ids` ended up inside each of `houses`, in order. */
function counts(sim: Sim, ids: number[], houses: number[]): number[] {
  return houses.map((h) => ids.filter((i) => sim.state.garrisonedIn[i] === h).length);
}

function squads(sim: Sim, type: number, n: number, x: number, y0: number, side = 0): number[] {
  return Array.from({ length: n }, (_, k) => sim.spawn(type, side, fx.from(x), fx.from(y0 + k)));
}

describe('a group load shares the riders across the carriers it names (GH-972)', () => {
  it('9 squads and 3 carriers of 3 seats: three aboard each, every squad on the carrier nearest it', () => {
    const { sim, u } = world();
    const cars = [8, 16, 24].map((y) => sim.spawn(u.apc3, 0, fx.from(14.5), fx.from(y + 0.5)));
    // Three squads stood by each carrier, 3 tiles west of it.
    const riders = [8, 16, 24].flatMap((y) => squads(sim, u.rifles, 3, 10.5, y));
    sim.queueCommand({ kind: 'load', ids: riders, carrier: cars[0], carriers: cars });
    run(sim, 20 * 20);
    expect(cars.map((c) => sim.passengerCount(c))).toEqual([3, 3, 3]);
    for (let k = 0; k < 3; k++) {
      for (const r of riders.slice(k * 3, k * 3 + 3)) expect(sim.state.carriedBy[r], `squad ${r}`).toBe(cars[k]);
    }
  });

  it('control: the same order without the list piles everyone on the named carrier, and only its seats fill', () => {
    const { sim, u } = world();
    const cars = [8, 16, 24].map((y) => sim.spawn(u.apc3, 0, fx.from(14.5), fx.from(y + 0.5)));
    const riders = [8, 16, 24].flatMap((y) => squads(sim, u.rifles, 3, 10.5, y));
    sim.queueCommand({ kind: 'load', ids: riders, carrier: cars[0] });
    run(sim, 20 * 20);
    expect(cars.map((c) => sim.passengerCount(c))).toEqual([3, 0, 0]);
  });

  it('shares by free seats, nearest rider first: a 2-seat and a 3-seat carrier take 5 of 7, the rest keep the named one', () => {
    const { sim, u } = world();
    const small = sim.spawn(u.apc2, 0, fx.from(14.5), fx.from(8.5));
    const large = sim.spawn(u.apc3, 0, fx.from(14.5), fx.from(24.5));
    // Four squads up by the small carrier, three down by the large one.
    const north = squads(sim, u.rifles, 4, 10.5, 6);
    const south = squads(sim, u.rifles, 3, 10.5, 24);
    sim.queueCommand({ kind: 'load', ids: [...north, ...south], carrier: small, carriers: [small, large] });
    run(sim, 20 * 20);
    expect(sim.passengerCount(small)).toBe(2);
    expect(sim.passengerCount(large)).toBe(3);
    // The southern squads are the ones nearest the large carrier, so they all took its seats.
    for (const r of south) expect(sim.state.carriedBy[r]).toBe(large);
    // Two northern squads are left over with today's order: still bound for the named carrier.
    const left = north.filter((r) => sim.state.carriedBy[r] === -1);
    expect(left).toHaveLength(2);
  });

  it('a carrier\'s seats are a cap: 4 squads stood by the 3-seat carrier, the 4th walks on to the 1-seat one', () => {
    const { sim, u } = world();
    const large = sim.spawn(u.apc3, 0, fx.from(14.5), fx.from(8.5));
    const tiny = sim.spawn(u.apc1, 0, fx.from(14.5), fx.from(20.5)); // 12 tiles further on
    const riders = squads(sim, u.rifles, 4, 10.5, 7);
    sim.queueCommand({ kind: 'load', ids: riders, carrier: large, carriers: [large, tiny] });
    run(sim, 20 * 25);
    expect(sim.passengerCount(large)).toBe(3);
    expect(sim.passengerCount(tiny)).toBe(1);
    expect(riders.every((r) => sim.state.carriedBy[r] >= 0)).toBe(true);
  });

  it('a carrier already carrying or already spoken for does not count its taken seats as free', () => {
    const { sim, u } = world();
    const a = sim.spawn(u.apc3, 0, fx.from(14.5), fx.from(8.5));
    const b = sim.spawn(u.apc3, 0, fx.from(14.5), fx.from(12.5));
    const first = squads(sim, u.rifles, 2, 12.5, 8);
    sim.queueCommand({ kind: 'load', ids: first, carrier: a });
    run(sim, 20 * 6);
    expect(sim.passengerCount(a)).toBe(2);
    const more = squads(sim, u.rifles, 3, 10.5, 9);
    sim.queueCommand({ kind: 'load', ids: more, carrier: a, carriers: [a, b] });
    run(sim, 20 * 20);
    // One seat left in a, three in b: the nearest squad to a takes its last seat, the rest go to b.
    expect(sim.passengerCount(a)).toBe(3);
    expect(sim.passengerCount(b)).toBe(2);
  });
});

describe('a group garrison shares the units across the houses in reach (GH-972)', () => {
  it('8 squads, two houses of 2 and a farther house of 4: 2, 2 and 4, nearest first', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.small, 20, 10);
    const b = rect(sim, t.small, 20, 14);
    const c = rect(sim, t.big, 20, 18); // farther from the named house than b is
    const ids = squads(sim, u.rifles, 8, 14.5, 10);
    sim.queueCommand({ kind: 'garrison', ids, structure: a, spread: true });
    run(sim, 20 * 30);
    expect(counts(sim, ids, [a, b, c])).toEqual([2, 2, 4]);
  });

  it('is EVEN, not fill-one-then-the-next: 6 squads, two houses of 4, three each', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.big, 20, 10);
    const b = rect(sim, t.big, 20, 16);
    const ids = squads(sim, u.rifles, 6, 14.5, 10);
    sim.queueCommand({ kind: 'garrison', ids, structure: a, spread: true });
    run(sim, 20 * 30);
    expect(counts(sim, ids, [a, b])).toEqual([3, 3]);
  });

  it('a group that fits the named house all goes there; no other house is touched', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.big, 20, 10);
    const b = rect(sim, t.big, 20, 16);
    const ids = squads(sim, u.rifles, 4, 14.5, 10);
    sim.queueCommand({ kind: 'garrison', ids, structure: a, spread: true });
    run(sim, 20 * 30);
    expect(counts(sim, ids, [a, b])).toEqual([4, 0]);
  });

  it('each house takes the squads nearest to it', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.small, 20, 4); // named, north
    const b = rect(sim, t.small, 20, 24); // south, 20 tiles away: out of reach, see the next test
    const b2 = rect(sim, t.small, 28, 4); // east of the named house, in reach
    // Two squads sit by the named house and two by the eastern one, ordered as one group.
    const nearA = squads(sim, u.rifles, 2, 17.5, 4);
    const nearB = squads(sim, u.rifles, 2, 33.5, 4);
    sim.queueCommand({ kind: 'garrison', ids: [...nearB, ...nearA], structure: a, spread: true });
    run(sim, 20 * 30);
    expect(counts(sim, nearA, [a])).toEqual([2]);
    expect(counts(sim, nearB, [b2])).toEqual([2]);
    expect(counts(sim, [...nearA, ...nearB], [b])).toEqual([0]);
  });

  it('a house out of reach is never a spill target: the overflow waits at the door, as today', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.small, 6, 4);
    const far = rect(sim, t.small, 36, 4); // 30 tiles away
    const ids = squads(sim, u.rifles, 3, 6.5, 8);
    sim.queueCommand({ kind: 'garrison', ids, structure: a, spread: true });
    run(sim, 20 * 30);
    expect(counts(sim, ids, [a, far])).toEqual([2, 0]);
    const out = ids.find((i) => sim.state.garrisonedIn[i] !== a) ?? -1;
    expect(out).toBeGreaterThanOrEqual(0);
    expect(sim.state.moving[out]).toBe(0); // stopped at the door with its order kept
  });

  it('a house the enemy holds is not a spill target', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.small, 20, 10);
    const b = rect(sim, t.small, 20, 16);
    const foe = sim.spawn(u.rifles, 1, fx.from(20.5), fx.from(16.5));
    sim.queueCommand({ kind: 'garrison', ids: [foe], structure: b });
    run(sim, 20 * 10);
    expect(sim.state.garrisonedIn[foe]).toBe(b);
    const ids = squads(sim, u.rifles, 3, 14.5, 10);
    sim.queueCommand({ kind: 'garrison', ids, structure: a, spread: true });
    run(sim, 20 * 30);
    expect(counts(sim, ids, [a, b])).toEqual([2, 0]);
  });

  it('a shed does not hold what a house holds: capacity is read from the building, 1 seat here', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.shed, 20, 10, 1, 1);
    const b = rect(sim, t.shed, 20, 14, 1, 1);
    const ids = squads(sim, u.rifles, 3, 14.5, 10);
    sim.queueCommand({ kind: 'garrison', ids, structure: a, spread: true });
    run(sim, 20 * 30);
    expect(counts(sim, ids, [a, b])).toEqual([1, 1]);
  });

  it('equal distances go to the lower entity id, whatever order the command lists them in', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.shed, 20, 10, 1, 1); // centre (20.5, 10.5)
    const b = rect(sim, t.shed, 20, 14, 1, 1);
    const low = sim.spawn(u.rifles, 0, fx.from(14.5), fx.from(9.5));
    const high = sim.spawn(u.rifles, 0, fx.from(14.5), fx.from(11.5)); // the same distance from a's centre
    sim.queueCommand({ kind: 'garrison', ids: [high, low], structure: a, spread: true });
    run(sim, 20 * 30);
    expect(sim.state.garrisonedIn[low]).toBe(a);
    expect(sim.state.garrisonedIn[high]).toBe(b);
  });

  it('absent `spread` the order is today\'s: everyone walks to the named house and the overflow waits', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.small, 20, 10);
    const b = rect(sim, t.small, 20, 16);
    const ids = squads(sim, u.rifles, 4, 14.5, 10);
    sim.queueCommand({ kind: 'garrison', ids, structure: a });
    run(sim, 20 * 30);
    expect(counts(sim, ids, [a, b])).toEqual([2, 0]);
  });
});

describe('a house that fills while the squads are walking (GH-972)', () => {
  it('the squads bound for it turn to the nearest house with room, counting those already bound for it', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.small, 24, 10);
    const b = rect(sim, t.small, 24, 14);
    const c = rect(sim, t.small, 24, 18); // farther than b
    const group = squads(sim, u.rifles, 4, 4.5, 10); // far away: ~20 tiles to walk
    sim.queueCommand({ kind: 'garrison', ids: group, structure: a, spread: true });
    run(sim, 1);
    // The plan: two to a, two to b.
    const bound = (h: number): number => group.filter((i) => sim.state.garrisonGoal[i] === h).length;
    expect([bound(a), bound(b), bound(c)]).toEqual([2, 2, 0]);
    // Meanwhile two squads that were stood at the door are ordered in, and take a before the group arrives.
    const locals = squads(sim, u.rifles, 2, 22.5, 11);
    sim.queueCommand({ kind: 'garrison', ids: locals, structure: a });
    // Each unit looks once in eight ticks, staggered by id, so they turn a few ticks apart.
    let redirected = -1;
    for (let k = 0; k < 20 * 30 && redirected < 0; k++) {
      sim.tick();
      if (bound(a) === 0) redirected = k;
    }
    expect(redirected, 'both turned from a').toBeGreaterThanOrEqual(0);
    // They turned while still far from the door: it was the building that was full, not the queue at it.
    for (const i of group) expect(fx.toNumber(sim.state.posX[i])).toBeLessThan(20);
    // Both that were bound for a went to c, not to b, which its own two are already bound for.
    expect([bound(a), bound(b), bound(c)]).toEqual([0, 2, 2]);
    run(sim, 20 * 40);
    expect(counts(sim, group, [a, b, c])).toEqual([0, 2, 2]);
    expect(counts(sim, locals, [a])).toEqual([2]);
  });

  it('a plain order after a spread one does not inherit the flag: that unit waits at a full door', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.small, 20, 10);
    const b = rect(sim, t.small, 20, 14);
    const pair = squads(sim, u.rifles, 2, 14.5, 12);
    sim.queueCommand({ kind: 'garrison', ids: pair, structure: b, spread: true });
    run(sim, 5);
    const full = squads(sim, u.rifles, 2, 18.5, 10);
    sim.queueCommand({ kind: 'garrison', ids: full, structure: a });
    // The first of the pair is told, plainly, to go to the house the other two are filling.
    sim.queueCommand({ kind: 'garrison', ids: [pair[0]], structure: a });
    run(sim, 20 * 30);
    expect(counts(sim, full, [a])).toEqual([2]);
    expect(sim.state.garrisonedIn[pair[0]]).toBe(-1);
    expect(sim.state.garrisonGoal[pair[0]]).toBe(a);
    expect(sim.state.moving[pair[0]]).toBe(0);
  });

  it('a unit with nowhere to go keeps today\'s order: it stops at the door and fights from there', () => {
    const { sim, t, u } = world();
    const a = rect(sim, t.shed, 20, 10, 1, 1);
    const ids = squads(sim, u.rifles, 3, 14.5, 10);
    sim.queueCommand({ kind: 'garrison', ids, structure: a, spread: true });
    run(sim, 20 * 30);
    const out = ids.filter((i) => sim.state.garrisonedIn[i] !== a);
    expect(out).toHaveLength(2);
    for (const i of out) {
      expect(sim.state.moving[i]).toBe(0);
      expect(sim.state.garrisonGoal[i]).toBe(a);
    }
    // And a seat that opens up is taken by one of them, as before.
    sim.debugKill(ids.find((i) => sim.state.garrisonedIn[i] === a) ?? -1);
    run(sim, 20 * 5);
    expect(out.filter((i) => sim.state.garrisonedIn[i] === a)).toHaveLength(1);
  });
});

describe('versus: both seats resolve the same order alike (GH-972)', () => {
  /** One machine of a versus room: both seats' orders, then the same ticks. */
  function room(): { sim: Sim; mine: number[]; theirs: number[]; houses: number[] } {
    const { sim, t, u } = world(11);
    const h = [rect(sim, t.small, 12, 10), rect(sim, t.small, 12, 15), rect(sim, t.small, 34, 10), rect(sim, t.small, 34, 15)];
    const mine = squads(sim, u.rifles, 5, 6.5, 10, 0);
    const theirs = squads(sim, u.rifles, 5, 42.5, 10, 1);
    sim.queueCommand({ kind: 'garrison', ids: mine, structure: h[0], spread: true });
    sim.queueCommand({ kind: 'garrison', ids: theirs, structure: h[2], spread: true });
    return { sim, mine, theirs, houses: h };
  }

  it('two machines fed the same frames agree on every tick\'s hash and on who stands where', () => {
    const a = room();
    const b = room();
    for (let k = 0; k < 20 * 30; k++) {
      a.sim.tick();
      b.sim.tick();
      expect(a.sim.hash(), `tick ${k}`).toBe(b.sim.hash());
    }
    for (const id of [...a.mine, ...a.theirs]) expect(a.sim.state.garrisonedIn[id]).toBe(b.sim.state.garrisonedIn[id]);
  });

  it('each seat spreads over its own side of the map and never into the other seat\'s houses', () => {
    const r = room();
    run(r.sim, 20 * 30);
    // The west pair of houses take the west seat's five (2 + 2, one waits: 2 houses of 2), the east pair the east seat's.
    expect(counts(r.sim, r.mine, r.houses)).toEqual([2, 2, 0, 0]);
    expect(counts(r.sim, r.theirs, r.houses)).toEqual([0, 0, 2, 2]);
  });
});
