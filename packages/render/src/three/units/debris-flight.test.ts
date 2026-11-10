/**
 * GH-1197 P2: the closed-form debris flight. Oracles are the design's literals (§3, the 155 table) or the
 * plan's own physics restated independently (a parabola's apex is v^2 / 2g), never `debris-flight.ts`'s helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  DEBRIS_FADE_MS,
  DEBRIS_FADE_START_MS,
  debrisFadeAt,
  debrisPositionAt,
  debrisSpinAt,
  debrisThrowFor,
  planDebris,
  restingPlan,
  type DebrisPlan,
} from './debris-flight';

const flat = (): number => 0;
const slope = (x: number, z: number): number => 0.1 * x - 0.05 * z;
/** The 155's row at its own splash: 36 clods + 18 chunks, thrown 2.4 t, apex 3.0 t (the design's 155 table). */
const T155 = debrisThrowFor({ clods: 36, chunks: 18, throw_tiles: 2.4, apex_tiles: 3.0 }, 2.4, 2.4);

function all(x: number, z: number, ground: (x: number, z: number) => number = flat): DebrisPlan[] {
  const out: DebrisPlan[] = [];
  for (let k = 0; k < T155.clods + T155.chunks; k++) out.push(planDebris(x, ground(x, z), z, k, k < T155.clods, T155, ground));
  return out;
}

describe('the class row scales by (S / ref)^2', () => {
  it('the 155 throws 36 clods and 18 chunks; a DPICM bomblet about 4 clods; the Grad more', () => {
    expect(T155).toEqual({ clods: 36, chunks: 18, throwTiles: 2.4, apexTiles: 3 });
    expect(debrisThrowFor({ clods: 8, chunks: 0, throw_tiles: 1.2, apex_tiles: 0.6 }, 0.8, 1.2).clods).toBe(4);
    const grad = debrisThrowFor({ clods: 36, chunks: 18, throw_tiles: 2.4, apex_tiles: 3.0 }, 3, 2.4);
    expect(grad.clods).toBe(56);
    expect(grad.throwTiles).toBeCloseTo(3, 9);
  });
});

describe('the rest pose is closed-form and reproducible', () => {
  it('the same landing plans every piece bit-identically, whatever was planned before it', () => {
    const a = all(12.3, 7.9, slope);
    all(3, 3); // an unrelated landing between the two captures
    const b = all(12.3, 7.9, slope);
    expect(b).toEqual(a);
  });

  it('flies continuously through both touchdowns and comes to rest exactly at the rest pose', () => {
    for (const p of all(10, 10, slope)) {
      const near = (u: number[], v: number[]): void => u.forEach((c, i) => expect(Math.abs(c - v[i])).toBeLessThan(1e-6));
      near(debrisPositionAt(p, p.t1 - 1e-6), debrisPositionAt(p, p.t1));
      near(debrisPositionAt(p, p.t2 - 1e-6), debrisPositionAt(p, p.t2));
      near(debrisPositionAt(p, p.t3 - 1e-6), [...p.rest]);
      expect(debrisPositionAt(p, p.t3 + 60_000)).toEqual([...p.rest]);
      expect(debrisSpinAt(p, p.t2)).toBe(0);
    }
  });

  it('climbs no higher than the apex, lands within the throw (plus its bounce and slide)', () => {
    for (const p of all(0, 0)) {
      const apex = (p.v0[1] * p.v0[1]) / (2 * 9.8);
      expect(apex).toBeLessThanOrEqual(3.0 + 1e-9);
      const d = Math.hypot(p.rest[0], p.rest[2]);
      expect(d).toBeLessThanOrEqual(2.4 * 1.5);
      expect(Math.hypot(p.p1[0], p.p1[2])).toBeLessThanOrEqual(2.4 + 1e-9);
    }
  });

  it('a 155 flies about 1.5 s at most (2.4 t at a 3.0 t apex, the design)', () => {
    const longest = Math.max(...all(0, 0).map((p) => p.t1));
    expect(longest).toBeGreaterThan(1200);
    expect(longest).toBeLessThan(1700);
  });
});

describe('the caps that keep the fight visible (the design §3)', () => {
  it('no piece is larger than 0.35 t, and none at rest stands taller than 0.12 t', () => {
    for (const p of all(5, 5, slope)) {
      expect(p.size).toBeLessThanOrEqual(0.35);
      expect(p.size * 0.34).toBeLessThanOrEqual(0.12);
    }
  });

  it('rests ON the ground the renderer draws: half its height above it, never under it', () => {
    for (const p of all(5, 5, slope)) {
      const half = (p.size * 0.34) / 2;
      expect(p.rest[1] - slope(p.rest[0], p.rest[2])).toBeCloseTo(half, 9);
      // The first touchdown is solved onto the slope in four fixed steps: within a ten-thousandth.
      expect(Math.abs(p.p1[1] - slope(p.p1[0], p.p1[2]) - half)).toBeLessThan(1e-4);
    }
  });
});

describe('a catch-up places the debris at rest', () => {
  it('a resting plan is at its rest pose from its first frame, with no spin', () => {
    const p = restingPlan(all(4, 4)[0]);
    expect(debrisPositionAt(p, 0)).toEqual([...p.rest]);
    expect(debrisSpinAt(p, 0)).toBe(0);
  });
});

describe('settled debris fades into the ground at 90 s, on the sim clock', () => {
  it('whole until 90 s, gone by 91.5 s', () => {
    expect(debrisFadeAt(0)).toBe(1);
    expect(debrisFadeAt(89_999)).toBe(1);
    expect(DEBRIS_FADE_START_MS).toBe(90_000);
    expect(DEBRIS_FADE_MS).toBe(1_500);
    expect(debrisFadeAt(90_750)).toBeCloseTo(0.5, 9);
    expect(debrisFadeAt(91_500)).toBe(0);
  });
});
