import { describe, expect, it } from 'vitest';
import {
  assignFormation,
  INFANTRY_SPACING,
  MAX_LATERAL,
  SEARCH_RADIUS,
  VEHICLE_SPACING,
  VEHICLE_TO_INFANTRY_GAP,
  type FormationInput,
  type FormationUnit,
  type Slot,
} from './formation';

const FOOT = 0;
const VEHICLE = 1;
const W = 24;
const H = 24;

function open(): Uint8Array {
  return new Uint8Array(W * H);
}
/** A vertical street two tiles wide at x = 10..11, walls either side. */
function street(): Uint8Array {
  const m = open();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 10 || x > 11) m[y * W + x] = 1;
  return m;
}
function units(vehicles: number, infantry: number, firstId = 0): FormationUnit[] {
  const out: FormationUnit[] = [];
  let id = firstId;
  for (let i = 0; i < vehicles; i++) out.push({ id: id++, domain: VEHICLE, front: true });
  for (let i = 0; i < infantry; i++) out.push({ id: id++, domain: FOOT, front: false });
  return out;
}
function input(over: Partial<FormationInput>): FormationInput {
  const foot = open();
  return {
    width: W,
    height: H,
    masks: [foot, foot],
    origins: [
      [12, 12],
      [12, 12],
    ],
    clickX: 12,
    clickY: 12,
    fromX: 12,
    fromY: 20, // approaching from the south: forward is -y, ranks form toward +y
    units: units(4, 11),
    reserved: new Uint8Array(W * H),
    ...over,
  };
}
const key = (s: Slot): string => `${s.x},${s.y}`;
const byId = (slots: Slot[]): Map<number, Slot> => new Map(slots.map((s) => [s.id, s]));

describe('assignFormation on open ground', () => {
  it('puts three spaced vehicles on the clicked row, one two rows back, infantry behind', () => {
    const slots = assignFormation(input({}));
    expect(slots).toHaveLength(15);
    expect(new Set(slots.map(key)).size).toBe(15);
    const m = byId(slots);
    // Front rank: the click tile and ±VEHICLE_SPACING beside it, on the clicked row.
    expect([m.get(0), m.get(1), m.get(2)].map((s) => `${s?.x},${s?.y}`).sort()).toEqual(
      ['10,12', '12,12', '14,12'].sort()
    );
    // The fourth vehicle sits VEHICLE_SPACING rows behind (toward the group), at offset 0.
    expect(m.get(3)).toMatchObject({ x: 12, y: 12 + VEHICLE_SPACING });
    // Infantry starts one row behind the last vehicle rank and fills 7 wide, then 4.
    const infantryY = 12 + VEHICLE_SPACING + VEHICLE_TO_INFANTRY_GAP;
    const row1 = slots.filter((s) => s.id >= 4 && s.y === infantryY);
    const row2 = slots.filter((s) => s.id >= 4 && s.y === infantryY + INFANTRY_SPACING);
    expect(row1).toHaveLength(2 * MAX_LATERAL + 1);
    expect(row2).toHaveLength(4);
    expect(row1.map((s) => s.x).sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15]);
  });

  it('is the click tile for a single unit, and the nearest free tile when the click is reserved', () => {
    const one = assignFormation(input({ units: units(0, 1) }));
    expect(one).toEqual([{ id: 0, x: 12, y: 12 }]);
    const reserved = new Uint8Array(W * H);
    reserved[12 * W + 12] = 1;
    const beside = assignFormation(input({ units: units(0, 1), reserved }));
    expect(beside).toHaveLength(1);
    expect(key(beside[0])).not.toBe('12,12');
    expect(Math.abs(beside[0].x - 12) + Math.abs(beside[0].y - 12)).toBe(1);
  });

  it('rotates the grid for each approach direction, front rank on the click', () => {
    const fromWest = byId(assignFormation(input({ fromX: 2, fromY: 12 })));
    // Forward is +x, so the fourth vehicle sits VEHICLE_SPACING tiles WEST of the click.
    expect(fromWest.get(3)).toMatchObject({ x: 12 - VEHICLE_SPACING, y: 12 });
    const fromEast = byId(assignFormation(input({ fromX: 22, fromY: 12 })));
    expect(fromEast.get(3)).toMatchObject({ x: 12 + VEHICLE_SPACING, y: 12 });
    const fromNorth = byId(assignFormation(input({ fromX: 12, fromY: 2 })));
    expect(fromNorth.get(3)).toMatchObject({ x: 12, y: 12 - VEHICLE_SPACING });
    // The clicked tile is always offset 0 of the front rank.
    for (const m of [fromWest, fromEast, fromNorth]) expect(m.get(0)).toMatchObject({ x: 12, y: 12 });
  });

  it('gives the same tiles when the ids arrive shuffled', () => {
    const a = assignFormation(input({}));
    const shuffled = [...units(4, 11)].reverse();
    const b = assignFormation(input({ units: shuffled }));
    expect(byId(b)).toEqual(byId(a));
  });
});

describe('assignFormation in a street', () => {
  it('forms a column: vehicles at the head, infantry behind, nothing on a wall', () => {
    const s = street();
    const slots = assignFormation(
      input({ masks: [s, s], clickX: 10, clickY: 4, fromX: 10, fromY: 20, origins: [[10, 4], [10, 4]] })
    );
    expect(new Set(slots.map(key)).size).toBe(15);
    for (const sl of slots) expect(s[sl.y * W + sl.x]).toBe(0);
    const m = byId(slots);
    // The four vehicles hold the head of the column, one every two rows.
    expect([0, 1, 2, 3].map((id) => `${m.get(id)?.x},${m.get(id)?.y}`)).toEqual(['10,4', '10,6', '10,8', '10,10']);
    // Infantry fills the ranks behind and the gaps between the vehicles, and
    // overflow is behind-first: nothing stands ahead of the click, and nothing
    // wider than the street.
    for (const sl of slots) {
      expect(sl.y).toBeGreaterThanOrEqual(4);
      expect(sl.x === 10 || sl.x === 11).toBe(true);
    }
  });
});

describe('assignFormation with a boulder corridor', () => {
  it('puts infantry inside the field and vehicles at its mouth', () => {
    const foot = open();
    const vehicle = open();
    // Boulders on x = 8..15, y = 4..11: open to feet, a wall to vehicles.
    for (let y = 4; y <= 11; y++) for (let x = 8; x <= 15; x++) vehicle[y * W + x] = 1;
    const slots = assignFormation(
      input({
        masks: [foot, vehicle],
        clickX: 12,
        clickY: 8,
        fromX: 12,
        fromY: 20,
        origins: [
          [12, 8],
          [12, 12], // the vehicle click snapped south of the field
        ],
      })
    );
    const m = byId(slots);
    for (const id of [0, 1, 2, 3]) {
      const s = m.get(id);
      expect(s && vehicle[s.y * W + s.x]).toBe(0);
    }
    const inside = slots.filter((sl) => sl.id >= 4 && sl.y >= 4 && sl.y <= 11 && sl.x >= 8 && sl.x <= 15);
    expect(inside.length).toBeGreaterThan(0);
  });
});

describe('assignFormation reservation, air and overflow', () => {
  it('skips reserved tiles so two groups on one click get disjoint tiles', () => {
    const first = assignFormation(input({}));
    const reserved = new Uint8Array(W * H);
    for (const s of first) reserved[s.y * W + s.x] = 1;
    const second = assignFormation(input({ units: units(4, 11, 100), reserved }));
    const firstKeys = new Set(first.map(key));
    for (const s of second) expect(firstKeys.has(key(s))).toBe(false);
    expect(new Set(second.map(key)).size).toBe(15);
  });

  it('spaces an air unit like a vehicle in the front rank, on the foot mask', () => {
    const s = street();
    const vehicleMask = new Uint8Array(W * H).fill(1); // no vehicle can stand anywhere
    const air: FormationUnit = { id: 0, domain: FOOT, front: true };
    const slots = assignFormation(
      input({ masks: [s, vehicleMask], clickX: 10, clickY: 4, fromX: 10, fromY: 20, origins: [[10, 4], [10, 4]], units: [air, { id: 1, domain: FOOT, front: false }] })
    );
    const m = byId(slots);
    expect(m.get(0)).toMatchObject({ x: 10, y: 4 });
    // Infantry starts VEHICLE_TO_INFANTRY_GAP behind the front rank.
    expect(m.get(1)?.y).toBe(4 + VEHICLE_TO_INFANTRY_GAP);
  });

  it('overflows to the nearest free reachable tiles, then to the origin', () => {
    // Box the click into a 3×3 pocket: 9 free tiles for 12 infantry.
    const foot = open().fill(1);
    for (let y = 11; y <= 13; y++) for (let x = 11; x <= 13; x++) foot[y * W + x] = 0;
    const slots = assignFormation(input({ masks: [foot, foot], units: units(0, 12) }));
    const distinct = new Set(slots.map(key));
    expect(distinct.size).toBe(9);
    // The three that found nothing keep the origin.
    expect(slots.filter((s) => key(s) === '12,12')).toHaveLength(4);
  });

  it('never places a slot farther than SEARCH_RADIUS + MAX_LATERAL walking steps from the origin', () => {
    const slots = assignFormation(input({ units: units(6, 40) }));
    for (const s of slots) expect(Math.abs(s.x - 12) + Math.abs(s.y - 12)).toBeLessThanOrEqual(SEARCH_RADIUS + MAX_LATERAL);
  });
});
