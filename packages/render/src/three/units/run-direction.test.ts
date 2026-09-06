import { describe, expect, it } from 'vitest';
import { perTileRunYaw } from './run-direction';

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
