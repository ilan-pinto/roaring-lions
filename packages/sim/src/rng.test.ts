import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { ONE } from './fixed';

describe('per-entity PRNG (invariant 3)', () => {
  it('produces a deterministic sequence for a given (seed, entity)', () => {
    const a = new Rng(1234, 64);
    const b = new Rng(1234, 64);
    for (let i = 0; i < 100; i++) {
      expect(a.nextU32(7)).toBe(b.nextU32(7));
    }
  });

  it('gives different streams to different entities and seeds', () => {
    const rng = new Rng(1234, 64);
    const s7 = Array.from({ length: 8 }, () => rng.nextU32(7));
    const s8 = Array.from({ length: 8 }, () => rng.nextU32(8));
    expect(s7).not.toEqual(s8);

    const other = new Rng(1235, 64);
    const o7 = Array.from({ length: 8 }, () => other.nextU32(7));
    expect(s7).not.toEqual(o7);
  });

  it("drawing for one entity never shifts another entity's stream", () => {
    // The reason streams are per-entity: mid-mission spawns/deaths must not
    // reshuffle everyone else's rolls.
    const a = new Rng(42, 64);
    const b = new Rng(42, 64);
    // a interleaves heavy traffic on entity 3; b never touches 3.
    const gotA: number[] = [];
    const gotB: number[] = [];
    for (let i = 0; i < 50; i++) {
      for (let j = 0; j < 5; j++) a.nextU32(3);
      gotA.push(a.nextU32(9));
      gotB.push(b.nextU32(9));
    }
    expect(gotA).toEqual(gotB);
  });

  it('chance(id, p) is exact at the extremes', () => {
    const rng = new Rng(7, 8);
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(1, 0)).toBe(false);
      expect(rng.chance(1, ONE)).toBe(true);
    }
  });

  it('chance(id, p) converges to p across many draws', () => {
    const rng = new Rng(99, 8);
    const p = Math.round(0.3 * ONE);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (rng.chance(2, p)) hits++;
    expect(hits / n).toBeGreaterThan(0.28);
    expect(hits / n).toBeLessThan(0.32);
  });

  it('u32 output looks uniform enough for combat rolls (bucket chi-ish check)', () => {
    const rng = new Rng(1, 8);
    const buckets = new Array(16).fill(0);
    const n = 32000;
    for (let i = 0; i < n; i++) buckets[rng.nextU32(0) >>> 28]++;
    for (const c of buckets) {
      expect(c).toBeGreaterThan(n / 16 - 400);
      expect(c).toBeLessThan(n / 16 + 400);
    }
  });
});
