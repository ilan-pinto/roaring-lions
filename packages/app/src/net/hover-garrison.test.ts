import { describe, it, expect } from 'vitest';
import { garrisonRoomShown, structureInSight, type StructureSight } from './hover-garrison';

/** Structure 0: an L of tiles (2,2), (3,2), (2,3) in a 2x2 box whose fourth
 *  tile (3,3) is open ground; two slots, `occupants` of them taken.
 *  Structure 1: a 0-slot wall at (6,6). */
function world(occupants: number): StructureSight {
  const tiles = new Map<string, number>([['2,2', 0], ['3,2', 0], ['2,3', 0], ['6,6', 1]]);
  return {
    structures: {
      occupants: [occupants, 0],
      typeIdx: [0, 1],
      minX: [2, 6], minY: [2, 6], maxX: [3, 6], maxY: [3, 6],
    },
    structureTypes: [{ garrisonSlots: 2 }, { garrisonSlots: 0 }],
    structureAt: (x, y) => tiles.get(`${x},${y}`) ?? -1,
  };
}
const sees = (...seen: [number, number][]) => (wx: number, wy: number): boolean =>
  seen.some(([x, y]) => Math.floor(wx) === x && Math.floor(wy) === y);

describe('structureInSight', () => {
  it('is true when one of its own tiles is in sight', () => {
    expect(structureInSight(world(0), 0, sees([2, 3]))).toBe(true);
  });
  it('is false when only a box tile that is not its own is in sight', () => {
    expect(structureInSight(world(0), 0, sees([3, 3]))).toBe(false);
  });
});

describe('garrisonRoomShown (N1a final review)', () => {
  it('single-player reads free slots through fog, as main does', () => {
    expect(garrisonRoomShown(world(1), 0, false, sees())).toBe(true);
    expect(garrisonRoomShown(world(2), 0, false, sees())).toBe(false);
  });
  it('a versus seat reads free slots on a building it can see', () => {
    expect(garrisonRoomShown(world(1), 0, true, sees([2, 2]))).toBe(true);
    expect(garrisonRoomShown(world(2), 0, true, sees([2, 2]))).toBe(false);
  });
  it('a versus seat reads a full building it cannot see as it reads an empty one', () => {
    expect(garrisonRoomShown(world(2), 0, true, sees())).toBe(garrisonRoomShown(world(0), 0, true, sees()));
    expect(garrisonRoomShown(world(2), 0, true, sees())).toBe(true);
  });
  it('a type with no slots never shows room, seen or not', () => {
    expect(garrisonRoomShown(world(0), 1, true, sees())).toBe(false);
    expect(garrisonRoomShown(world(0), 1, false, sees())).toBe(false);
  });
});
