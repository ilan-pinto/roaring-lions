import { describe, it, expect } from 'vitest';
import { heldBuilding, heldBuildings, heldShown, structureInSight, type HeldView } from './held-building';

/**
 * Two 2x2 buildings on a 10x10 map: structure 0 at (1,1)-(2,2), structure 1
 * at (6,6)-(7,7). Entities: 0 and 1 inside structure 0 (side 0), 2 inside
 * structure 1 (side 1), 3 outside.
 */
function world(): HeldView & { structureAt(x: number, y: number): number } {
  const tiles = new Int16Array(100).fill(-1);
  for (const [s, x0, y0] of [
    [0, 1, 1],
    [1, 6, 6],
  ] as const) {
    for (let y = y0; y <= y0 + 1; y++) for (let x = x0; x <= x0 + 1; x++) tiles[y * 10 + x] = s;
  }
  return {
    structureCount: 2,
    structures: {
      alive: Uint8Array.from([1, 1]),
      occupants: Uint8Array.from([2, 1]),
      typeIdx: Uint8Array.from([0, 1]),
      minX: Int16Array.from([1, 6]),
      minY: Int16Array.from([1, 6]),
      maxX: Int16Array.from([2, 7]),
      maxY: Int16Array.from([2, 7]),
    },
    structureTypes: [{ garrisonSlots: 2 }, { garrisonSlots: 4 }],
    state: {
      alive: Uint8Array.from([1, 1, 1, 1]),
      side: Uint8Array.from([0, 0, 1, 0]),
      garrisonedIn: Int16Array.from([0, 0, 1, -1]),
    },
    structureAt: (x, y) => (x < 0 || y < 0 || x >= 10 || y >= 10 ? -1 : tiles[y * 10 + x]),
  };
}

const nothingSeen = (): boolean => false;
const tileSeen = (tx: number, ty: number) => (wx: number, wy: number) => Math.floor(wx) === tx && Math.floor(wy) === ty;

describe('heldBuildings', () => {
  it('names every building with a living unit inside, and that unit side', () => {
    expect(heldBuildings(world(), 4)).toEqual([
      { s: 0, holder: 0, occupants: 2, slots: 2 },
      { s: 1, holder: 1, occupants: 1, slots: 4 },
    ]);
  });

  it('a count with nobody alive inside is not held (debugKill leaves the count)', () => {
    const w = world();
    (w.state.alive as Uint8Array)[2] = 0;
    expect(heldBuildings(w, 4).map((b) => b.s)).toEqual([0]);
    expect(heldBuilding(w, 1, 4)).toBeNull();
  });

  it('a fallen building holds nobody', () => {
    const w = world();
    (w.structures.alive as Uint8Array)[0] = 0;
    expect(heldBuildings(w, 4).map((b) => b.s)).toEqual([1]);
  });

  it('reads only the entities the caller has snapshotted', () => {
    expect(heldBuildings(world(), 2).map((b) => b.s)).toEqual([0]);
  });

  it('heldBuilding answers one structure the same way', () => {
    expect(heldBuilding(world(), 1, 4)).toEqual({ s: 1, holder: 1, occupants: 1, slots: 4 });
    expect(heldBuilding(world(), 5, 4)).toBeNull();
  });
});

describe('heldShown: the fog rule, single-player and versus alike', () => {
  it('a building held by the viewer always shows, seen or not', () => {
    const w = world();
    const [own] = heldBuildings(w, 4);
    expect(heldShown(w, own, 0, nothingSeen)).toBe(true);
  });

  it('one held by anyone else shows only while a tile of it is in sight', () => {
    const w = world();
    const hostile = heldBuildings(w, 4)[1];
    expect(heldShown(w, hostile, 0, nothingSeen)).toBe(false);
    expect(heldShown(w, hostile, 0, tileSeen(7, 6))).toBe(true);
    // A tile beside it is not a tile of it.
    expect(heldShown(w, hostile, 0, tileSeen(8, 6))).toBe(false);
  });

  it('is relative to the seat: side 1 sees its own and not side 0', () => {
    const w = world();
    const [a, b] = heldBuildings(w, 4);
    expect(heldShown(w, a, 1, nothingSeen)).toBe(false);
    expect(heldShown(w, b, 1, nothingSeen)).toBe(true);
  });

  it('structureInSight checks the structure own tiles, not its box', () => {
    const w = world();
    const at = (x: number, y: number): number => (x === 2 && y === 2 ? -1 : w.structureAt(x, y));
    expect(structureInSight({ ...w, structureAt: at }, 0, tileSeen(2, 2))).toBe(false);
    expect(structureInSight(w, 0, tileSeen(2, 2))).toBe(true);
  });
});
