// The lane probe's own checks (GH-974). It is report-only, so what must not pass quietly is the probe: an
// instrument that cannot tell left from right, or west from east, reads "equal from both seats" for any map.
// Each test was seen red under the one-line mutation named beside it (the commit message lists them).
import { describe, expect, it, vi } from 'vitest';
import { fx } from '@lions/sim';
import { versusSpawns } from '../../../packages/app/src/net/versus-force';
import { versusAnchors } from '../../../packages/app/src/net/versus-seats';
import { SEAT_GAP_MAX_POINTS, gapZ, groupOf, laneFor, lanesOf, meanOf, playLane, seatGapOk, shareOf, splitOrders, type LaneRead, type Point, type Splitter } from './lane-probe';
import { humanHeldOf, layoutOf, world, type Arrangement } from './versus-probe';

// Rujm Sawda's seats and the two fords either side of its centre, as the STAGED redo has them
// (docs/campaign/staged_maps/rujm_sawda_redo/map.json). They are literals for the pure left/right tests, and the
// world tests below run on whichever map data/ holds: they are self-consistent only, not a reading of the shipped
// map's markers (the shipped map's differ only in the mesas' markers, not the seats or fords).
const WEST: Point = [12, 12];
const EAST: Point = [67, 67];
const FORD_NE: Point = [54, 27];
const FORD_SW: Point = [25, 52];

describe('lanesOf: left is the left of the seat looking at the other seat', () => {
  it('the west seat looks south-east: north-east is on its left', () => {
    // mutation: `side(a) >= side(b)` -> `side(a) <= side(b)` swaps both rows
    expect(lanesOf(WEST, EAST, FORD_NE, FORD_SW)).toEqual({ left: FORD_NE, right: FORD_SW });
  });
  it('the east seat looks north-west: south-west is on its left', () => {
    expect(lanesOf(EAST, WEST, FORD_NE, FORD_SW)).toEqual({ left: FORD_SW, right: FORD_NE });
  });
  it('does not depend on the order the markers are named in', () => {
    expect(lanesOf(WEST, EAST, FORD_SW, FORD_NE)).toEqual({ left: FORD_NE, right: FORD_SW });
  });
  it('looking east, north (smaller y) is left', () => {
    // mutation: the normal (fy, -fx) -> (-fy, fx) reads this the other way
    expect(lanesOf([0, 10], [20, 10], [10, 0], [10, 20])).toEqual({ left: [10, 0], right: [10, 20] });
  });
});

describe('laneFor', () => {
  it('armour left puts armour on the left marker and infantry on the right, and the swap reverses both', () => {
    // mutation: `armourLeft ?` -> `true ?` leaves the swap cell playing the same lanes as the first
    expect(laneFor(true, FORD_NE, FORD_SW)).toEqual({ armour: FORD_NE, foot: FORD_SW });
    expect(laneFor(false, FORD_NE, FORD_SW)).toEqual({ armour: FORD_SW, foot: FORD_NE });
  });
});

describe('the bar', () => {
  const read = (wins: number, losses: number): LaneRead => ({ wins, losses, draws: 0 });
  it('shareOf is wins over decided games, draws nobody\'s', () => {
    expect(shareOf({ wins: 3, losses: 1, draws: 4 })).toBe(75);
    expect(shareOf({ wins: 0, losses: 0, draws: 5 })).toBe(0);
  });
  it('a 10-point gap passes and an 11-point one fails, in either direction', () => {
    // mutation: SEAT_GAP_MAX_POINTS 10 -> 5 turns the first red; Math.abs removed turns the third red
    expect(SEAT_GAP_MAX_POINTS).toBe(10);
    expect(seatGapOk(read(60, 40), read(50, 50))).toBe(true);
    expect(seatGapOk(read(61, 39), read(50, 50))).toBe(false);
    expect(seatGapOk(read(50, 50), read(61, 39))).toBe(false);
  });
  it('gapZ is signed west minus east and zero for equal reads', () => {
    expect(gapZ(read(50, 50), read(50, 50))).toBe(0);
    expect(gapZ(read(70, 30), read(50, 50))).toBeGreaterThan(2);
    expect(gapZ(read(50, 50), read(70, 30))).toBeLessThan(-2);
  });
});

describe('splitOrders on a real Rujm Sawda world', () => {
  const arr: Arrangement = ['kdf', 'kdf'];
  const build = () => {
    const w = world('rujm_sawda', 1, humanHeldOf('room', 'rujm_sawda', arr, 1));
    const { sideOfEnd, factions, ends } = layoutOf(arr);
    const force = versusSpawns(w.sim, w.typeOf, versusAnchors(w.map), factions, ends);
    return { ...w, force, side: sideOfEnd[0] };
  };
  const target: [number, number] = [fx.from(67), fx.from(67)];
  const fresh = (): Splitter => ({ lane: { armour: FORD_NE, foot: FORD_SW }, passed: { armour: false, foot: false } });

  it('has armour, infantry and aircraft to split (the premise)', () => {
    const { sim, force, side } = build();
    const groups = new Set(force.bySide[side].map((id) => groupOf(sim, id)));
    expect([...groups].sort()).toEqual(['air', 'armour', 'foot']);
  });

  it('sends armour to its lane and infantry to theirs until they have arrived, aircraft at the target', () => {
    const { sim, force, side } = build();
    const q = vi.spyOn(sim, 'queueCommand');
    splitOrders(sim, force.bySide[side], fresh(), target);
    const sent = q.mock.calls.map((c) => c[0] as { ids: number[]; x: number; y: number });
    expect(sent).toHaveLength(3);
    const at = (g: string) => sent.find((c) => groupOf(sim, c.ids[0]) === g) as { ids: number[]; x: number; y: number };
    expect([at('armour').x, at('armour').y]).toEqual([fx.from(54.5), fx.from(27.5)]);
    expect([at('foot').x, at('foot').y]).toEqual([fx.from(25.5), fx.from(52.5)]);
    expect([at('air').x, at('air').y]).toEqual(target);
    // every unit is in exactly one order
    expect(sent.flatMap((c) => c.ids).sort((a, b) => a - b)).toEqual([...force.bySide[side]].sort((a, b) => a - b));
  });

  it('a group that has reached its lane is sent on to the target, and stays sent on', () => {
    const { sim, force, side } = build();
    const armour = force.bySide[side].filter((id) => groupOf(sim, id) === 'armour');
    for (const id of armour) { sim.state.posX[id] = fx.from(54); sim.state.posY[id] = fx.from(27); }
    expect(meanOf(sim, armour)).toEqual([54, 27]);
    const s = fresh();
    splitOrders(sim, force.bySide[side], s, target);
    expect(s.passed).toEqual({ armour: true, foot: false });
    for (const id of armour) { sim.state.posX[id] = fx.from(12); sim.state.posY[id] = fx.from(12); }
    const q = vi.spyOn(sim, 'queueCommand');
    splitOrders(sim, force.bySide[side], s, target);
    const a = q.mock.calls.map((c) => c[0] as { ids: number[]; x: number; y: number }).find((c) => groupOf(sim, c.ids[0]) === 'armour');
    expect([a?.x, a?.y]).toEqual(target); // mutation: `s.passed[g] ?` -> `false ?` sends it back to the lane
  });
  it('two half-turn mirrored groups at mirrored distances are marked passed on the same order, from either seat', () => {
    // mutation: measure to `lane[0], lane[1]` (the tile corner) and only the west group passes
    const { sim, force } = build();
    const { sideOfEnd } = layoutOf(arr);
    const ground = (side: number) => force.bySide[side].filter((id) => groupOf(sim, id) === 'armour');
    const west = ground(sideOfEnd[0]);
    const east = ground(sideOfEnd[1]);
    // 5.4 tiles short of the marker's tile centre along the diagonal the group arrives on: 7.64 from the centre,
    // 6.93 from the NW corner (west, coming from the NW) and 8.34 from it (east, coming from the SE)
    const stand = (ids: number[], x: number, y: number) => { for (const id of ids) { sim.state.posX[id] = fx.from(x); sim.state.posY[id] = fx.from(y); } };
    stand(west, FORD_NE[0] + 0.5 - 5.4, FORD_NE[1] + 0.5 - 5.4);
    stand(east, FORD_SW[0] + 0.5 + 5.4, FORD_SW[1] + 0.5 + 5.4);
    const w: Splitter = { lane: { armour: FORD_NE, foot: FORD_SW }, passed: { armour: false, foot: false } };
    const e: Splitter = { lane: { armour: FORD_SW, foot: FORD_NE }, passed: { armour: false, foot: false } };
    splitOrders(sim, force.bySide[sideOfEnd[0]], w, target);
    splitOrders(sim, force.bySide[sideOfEnd[1]], e, target);
    expect([w.passed.armour, e.passed.armour]).toEqual([true, true]);
  });

});

describe('playLane', () => {
  it('runs the loop to the cap it is given and reads the splitter\'s END (seed 6000, both seats, 1,000 ticks)', () => {
    const lanes: [Point, Point] = [FORD_NE, FORD_SW];
    const cap = 1000; // 50 s of game: two order rounds, far short of a result, so the cap rule decides
    for (const splitEnd of [0, 1] as const) {
      const g = playLane('rujm_sawda', 47515000, { splitEnd, armourLeft: true }, lanes, cap);
      // mutation: `t < capTicks` -> `t < 1` in playLane stops at tick 1 and reads red here
      expect(g.ticks).toBe(cap);
      expect([0, 1, null]).toContain(g.winner);
    }
  }, 60_000);
});
