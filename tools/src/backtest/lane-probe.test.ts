// The lane probe's own checks (GH-974). It is report-only, so what must not pass quietly is the probe: an
// instrument that cannot tell left from right, or west from east, reads "equal from both seats" for any map.
// Each test was seen red under the one-line mutation named beside it (the commit message lists them).
import { describe, expect, it, vi } from 'vitest';
import { fx } from '@lions/sim';
import { versusSpawns } from '../../../packages/app/src/net/versus-force';
import { versusAnchors } from '../../../packages/app/src/net/versus-seats';
import { SEAT_GAP_MAX_POINTS, gapZ, groupOf, laneFor, lanesOf, meanOf, playLane, seatGapOk, shareOf, splitOrders, type LaneRead, type Point, type Splitter } from './lane-probe';
import { humanHeldOf, layoutOf, world, type Arrangement } from './versus-probe';

// Rujm Sawda's seats and the two fords either side of its centre (staged_maps/rujm_sawda_redo/map.json).
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
});

describe('playLane', () => {
  it('plays a game to a result and the seat that splits is the one read (seed 6000, both seats)', () => {
    const lanes: [Point, Point] = [FORD_NE, FORD_SW];
    const west = playLane('rujm_sawda', 47515000, { splitEnd: 0, armourLeft: true }, lanes, 2100 * 20);
    const east = playLane('rujm_sawda', 47515000, { splitEnd: 1, armourLeft: true }, lanes, 2100 * 20);
    expect(west.ticks).toBeGreaterThan(0);
    expect(east.ticks).toBeGreaterThan(0);
    // the two seats are different games: the same seed does not replay one as the other
    expect(`${west.winner}/${west.ticks}`).not.toBe(`${east.winner}/${east.ticks}`);
  }, 240_000);
});
