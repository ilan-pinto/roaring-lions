import { describe, expect, it } from 'vitest';
import {
  assignFormation,
  MAX_LATERAL,
  SEARCH_RADIUS,
  VEHICLE_RANK_DEPTH,
  type FormationInput,
  type FormationUnit,
  type Slot,
} from './formation';
import { fx } from './fixed';
import { RIFLES, TANK } from './golden-worlds.test-helper';
import { Sim, type UnitTypeJson } from './sim';

// GH-929. A big plain group order seats every unit in rank. Before, ranks stopped
// at SEARCH_RADIUS 8: Sarim's 26-unit versus force (8 wheeled, 18 foot) seated 14 of
// its 18 infantry and put the four highest ids at the click, among the gun trucks.
// The oracle here is arithmetic on the grid (count of ranks, lateral width), never
// a call back into the code under test.

const FOOT = 0;
const VEHICLE = 1;
const CLICK_X = 40;
const CLICK_Y = 4;

function mix(vehicles: number, infantry: number): FormationUnit[] {
  const out: FormationUnit[] = [];
  let id = 0;
  for (let i = 0; i < vehicles; i++) out.push({ id: id++, domain: VEHICLE, front: true });
  for (let i = 0; i < infantry; i++) out.push({ id: id++, domain: FOOT, front: false });
  return out;
}

/** A map `w` x `h`. `open` tiles are 0; everything else is a wall. Approach from the
 *  south (fromY = h - 1), so ranks form toward +y and depth = y - CLICK_Y. */
function run(w: number, h: number, mask: Uint8Array, units: FormationUnit[], clickX = CLICK_X, reserved?: Uint8Array): Slot[] {
  const input: FormationInput = {
    width: w,
    height: h,
    masks: [mask, mask],
    origins: [
      [clickX, CLICK_Y],
      [clickX, CLICK_Y],
    ],
    clickX,
    clickY: CLICK_Y,
    fromX: clickX,
    fromY: h - 1,
    units,
    reserved: reserved ?? new Uint8Array(w * h),
  };
  return assignFormation(input);
}

function openMap(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h);
}
/** A street `width` tiles wide, whose west wall is at x = CLICK_X - 1 (so the click, at CLICK_X, is its west lane). */
function streetMap(w: number, h: number, width: number): Uint8Array {
  const m = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) for (let x = CLICK_X; x < CLICK_X + width; x++) m[y * w + x] = 0;
  return m;
}

/** Every unit has exactly one slot, on open, distinct ground. */
function expectSeatedOnce(slots: Slot[], units: FormationUnit[], w: number, mask: Uint8Array): void {
  expect(slots).toHaveLength(units.length);
  expect(new Set(slots.map((s) => s.id))).toEqual(new Set(units.map((u) => u.id)));
  expect(new Set(slots.map((s) => `${s.x},${s.y}`)).size).toBe(units.length);
  for (const s of slots) expect(mask[s.y * w + s.x]).toBe(0);
}

/** The grid's own shape, no overflow: behind or on the click row, within MAX_LATERAL of its file,
 *  and infantry strictly behind the last vehicle rank. A unit parked at the click or ahead of it fails. */
function expectInRank(slots: Slot[], vehicles: number, clickX = CLICK_X): void {
  let lastVehicleDepth = -1;
  for (const s of slots) {
    expect(s.y - CLICK_Y).toBeGreaterThanOrEqual(0);
    expect(Math.abs(s.x - clickX)).toBeLessThanOrEqual(MAX_LATERAL);
    if (s.id < vehicles) lastVehicleDepth = Math.max(lastVehicleDepth, s.y - CLICK_Y);
  }
  for (const s of slots) if (s.id >= vehicles) expect(s.y - CLICK_Y).toBeGreaterThan(lastVehicleDepth);
}

describe('assignFormation seats every unit of a big order (GH-929)', () => {
  const W = 81;
  const H = 300;

  it('Sarim\'s versus force (8 wheeled, 18 foot): all 18 infantry in rank, none at the click', () => {
    const units = mix(8, 18);
    const slots = run(W, H, openMap(W, H), units);
    expectSeatedOnce(slots, units, W, openMap(W, H));
    expectInRank(slots, 8);
    // Oracle: vehicles 3 wide on ranks 0, 3, 6 (3 + 3 + 2); infantry starts at rank 7, 7 wide: 7 + 7 + 4.
    const rows = new Map<number, number>();
    for (const s of slots) if (s.id >= 8) rows.set(s.y - CLICK_Y, (rows.get(s.y - CLICK_Y) ?? 0) + 1);
    expect([...rows.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [7, 7],
      [8, 7],
      [9, 4],
    ]);
    // Nobody is at the click except the lead vehicle.
    expect(slots.filter((s) => s.x === CLICK_X && s.y === CLICK_Y).map((s) => s.id)).toEqual([0]);
  });

  for (const n of [18, 30, 60, 256]) {
    it(`open ground, ${n} infantry: every unit in rank, ceil(n / 7) ranks`, () => {
      const units = mix(0, n);
      const mask = openMap(W, H);
      const slots = run(W, H, mask, units);
      expectSeatedOnce(slots, units, W, mask);
      expectInRank(slots, 0);
      const deepest = Math.max(...slots.map((s) => s.y - CLICK_Y));
      expect(deepest).toBe(Math.ceil(n / (2 * MAX_LATERAL + 1)) - 1);
    });

    it(`open ground, ${n} units with 8 vehicles: every unit in rank`, () => {
      const units = mix(8, n - 8);
      const mask = openMap(W, H);
      const slots = run(W, H, mask, units);
      expectSeatedOnce(slots, units, W, mask);
      expectInRank(slots, 8);
    });

    it(`a 2-wide street, ${n} units with 8 vehicles: a column, every unit seated, none ahead of the click`, () => {
      const units = mix(8, n - 8);
      const mask = streetMap(W, H, 2);
      const slots = run(W, H, mask, units);
      expectSeatedOnce(slots, units, W, mask);
      for (const s of slots) expect(s.y).toBeGreaterThanOrEqual(CLICK_Y);
    });

    it(`a 1-wide lane, ${n} infantry: one per tile, in file`, () => {
      const units = mix(0, n);
      const mask = streetMap(W, H, 1);
      const slots = run(W, H, mask, units);
      expectSeatedOnce(slots, units, W, mask);
      // Oracle: one tile per rank, so rank k holds the k-th lowest id.
      const m = new Map(slots.map((s) => [s.id, s]));
      for (let i = 0; i < n; i++) expect(m.get(i)).toMatchObject({ x: CLICK_X, y: CLICK_Y + i });
    });
  }

  it('cramped: a walled yard 9 wide holds the 60 it is asked for, in rank order', () => {
    // 9 x 14 yard = 126 tiles; the click is on its north edge. The grid is 7 wide, so 60 infantry take 9 ranks
    // (> SEARCH_RADIUS 8 would be cut at 8 ranks = 56).
    const w = 81;
    const h = 40;
    const mask = new Uint8Array(w * h).fill(1);
    for (let y = CLICK_Y; y < CLICK_Y + 14; y++) for (let x = CLICK_X - 4; x <= CLICK_X + 4; x++) mask[y * w + x] = 0;
    const units = mix(0, 60);
    const slots = run(w, h, mask, units);
    expectSeatedOnce(slots, units, w, mask);
    expectInRank(slots, 0);
  });

  it('vehicles beyond SEARCH_RADIUS are seated in rank too (the front rank loop grows with the need)', () => {
    const units = mix(20, 0);
    const mask = openMap(W, H);
    const slots = run(W, H, mask, units);
    expectSeatedOnce(slots, units, W, mask);
    // 3 per rank, 7 ranks: rank k at depth 3k. Oracle arithmetic: ceil(20 / 3) - 1 = 6 ranks back.
    expect(Math.max(...slots.map((s) => s.y - CLICK_Y))).toBe(6 * VEHICLE_RANK_DEPTH);
    expect(Math.max(...slots.map((s) => s.y - CLICK_Y))).toBeGreaterThan(SEARCH_RADIUS);
  });

  it('respects reserved ground: a second big order beside a first seats everyone on disjoint tiles', () => {
    const mask = openMap(W, H);
    const first = run(W, H, mask, mix(8, 18));
    const reserved = new Uint8Array(W * H);
    for (const s of first) reserved[s.y * W + s.x] = 1;
    const units = mix(8, 18).map((u) => ({ ...u, id: u.id + 100 }));
    const second = run(W, H, mask, units, CLICK_X, reserved);
    expectSeatedOnce(second, units, W, mask);
    const taken = new Set(first.map((s) => `${s.x},${s.y}`));
    for (const s of second) expect(taken.has(`${s.x},${s.y}`)).toBe(false);
  });

  it('is deterministic: shuffled input gives the same tiles, and a repeat run is identical', () => {
    const units = mix(8, 52);
    const mask = openMap(W, H);
    const a = run(W, H, mask, units);
    const b = run(W, H, mask, [...units].reverse());
    const key = (ss: Slot[]): string[] => ss.map((s) => `${s.id}:${s.x},${s.y}`).sort();
    expect(key(b)).toEqual(key(a));
    expect(run(W, H, mask, units)).toEqual(a);
  });

  it('is unchanged for an order the first pass seats: 15 units fit at SEARCH_RADIUS exactly as before', () => {
    const units = mix(4, 11);
    const mask = openMap(W, H);
    const slots = run(W, H, mask, units);
    expectInRank(slots, 4);
    // Vehicles 3 on the click row, the fourth one VEHICLE_RANK_DEPTH back; infantry 7 + 4 from rank 4.
    const m = new Map(slots.map((s) => [s.id, s]));
    expect(m.get(3)).toMatchObject({ x: CLICK_X, y: CLICK_Y + VEHICLE_RANK_DEPTH });
    expect(Math.max(...slots.map((s) => s.y - CLICK_Y))).toBe(5);
  });

  it('when the ground really is full the rest still overflow, bounded, and no search runs away', () => {
    // 3 x 3 pocket, 12 infantry, on a map 81 wide: 9 tiles, the last three share the origin.
    const w = 81;
    const h = 40;
    const mask = new Uint8Array(w * h).fill(1);
    for (let y = CLICK_Y; y < CLICK_Y + 3; y++) for (let x = CLICK_X - 1; x <= CLICK_X + 1; x++) mask[y * w + x] = 0;
    const slots = run(w, h, mask, mix(0, 12));
    expect(new Set(slots.map((s) => `${s.x},${s.y}`)).size).toBe(9);
    expect(slots).toHaveLength(12);
  });
});

// The same through the Sim: the order the player gives, not the function alone. A plain `move` (no
// formation) of 26 units, 8 vehicles and 18 foot, to a click 24 tiles away across open ground.

describe('a plain group move seats every unit of a big order (GH-929, through the Sim)', () => {
  const TRUCK: UnitTypeJson = { ...TANK, id: 'go_truck', role: 'technical', mobility: { speed_tiles_s: 2, turn_rate_deg_s: 150 } };
  it('26 units: 8 trucks and 18 riflemen take 26 distinct goal tiles, none at the click but the lead truck', () => {
    const sim = new Sim({ seed: 929, width: 64, height: 64, capacity: 64 });
    const truck = sim.addUnitType(TRUCK);
    const inf = sim.addUnitType(RIFLES);
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) ids.push(sim.spawn(truck, 0, fx.from(8.5 + i), fx.from(8.5)));
    for (let i = 0; i < 18; i++) ids.push(sim.spawn(inf, 0, fx.from(8.5 + (i % 9)), fx.from(10.5 + (i - (i % 9)) / 9)));
    sim.queueCommand({ kind: 'move', ids, x: fx.from(40.5), y: fx.from(40.5) });
    sim.tick();
    const g = sim as unknown as { goalX: Int32Array; goalY: Int32Array };
    const tiles = ids.map((id) => `${g.goalX[id] >> 16},${g.goalY[id] >> 16}`);
    expect(new Set(tiles).size).toBe(26);
    // Oracle: the group starts near (12, 10) and the click is (40, 40), so |dy| > |dx| and the approach is +y:
    // ranks run back along -y from the click row 40, vehicles in ranks 0, 3, 6, the 18 foot units in ranks 7-9.
    const atClick = tiles.filter((t) => t === '40,40');
    expect(atClick).toHaveLength(1);
    for (const id of ids.slice(8)) expect(40 - (g.goalY[id] >> 16)).toBeGreaterThanOrEqual(7);
  });
});
