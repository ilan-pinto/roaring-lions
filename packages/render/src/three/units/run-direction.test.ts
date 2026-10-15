import { describe, expect, it } from 'vitest';
import structuresJson from '../../../../../data/structures.json';
import { PER_TILE_FACING, perTileRunYaw, perTileYawFor } from './run-direction';

const at = (...tiles: [number, number][]) => (dx: number, dy: number) =>
  tiles.some(([x, y]) => x === dx && y === dy);

describe('perTileRunYaw', () => {
  it('keeps the authored facing along an east-west run', () => {
    expect(perTileRunYaw(at([-1, 0], [1, 0]))).toBe(0);
    expect(perTileRunYaw(at([1, 0]))).toBe(0);
  });
  it('turns a quarter along a north-south run -- the fence read edge-on there', () => {
    expect(perTileRunYaw(at([0, -1], [0, 1]))).toBeCloseTo(Math.PI / 2, 12);
    expect(perTileRunYaw(at([0, 1]))).toBeCloseTo(Math.PI / 2, 12);
  });
  it('keeps x at a corner and on an isolated post', () => {
    expect(perTileRunYaw(at([1, 0], [0, 1]))).toBe(0);
    expect(perTileRunYaw(at())).toBe(0);
  });
});

describe('perTileYawFor (SW-5)', () => {
  const ns = at([0, -1], [0, 1]);
  it('keeps the sandbag post on its authored facing beside north-south neighbours', () => {
    expect(perTileYawFor('sandbag_post', ns)).toBe(0);
    expect(perTileYawFor('sandbag_post', at([0, 1]))).toBe(0);
    expect(perTileYawFor('sandbag_post', at([-1, 0], [1, 0]))).toBe(0);
  });
  it('still turns every run type a quarter along a north-south run', () => {
    for (const id of ['wall', 'fence', 't_wall', 'sandbag_wall', 'hesco']) {
      expect(perTileYawFor(id, ns), id).toBeCloseTo(Math.PI / 2, 12);
      expect(perTileYawFor(id, at([-1, 0], [1, 0])), id).toBe(0);
    }
  });
});

describe('PER_TILE_FACING is exhaustive over data/structures.json', () => {
  // Read off the data file rather than a list retyped here: a new per-tile
  // type must choose 'run' or 'authored', not inherit a turn by default.
  const types = Object.values((structuresJson as { types: Record<string, { id: string; per_tile?: boolean }> }).types);
  const perTile = types.filter((t) => t.per_tile === true).map((t) => t.id).sort();
  it('names every per_tile type', () => {
    expect(perTile.length).toBeGreaterThan(0);
    expect(Object.keys(PER_TILE_FACING).sort()).toEqual(perTile);
  });
  it('names no type that is not per_tile', () => {
    const notPerTile = new Set(types.filter((t) => t.per_tile !== true).map((t) => t.id));
    for (const id of Object.keys(PER_TILE_FACING)) expect(notPerTile.has(id), id).toBe(false);
  });
});
