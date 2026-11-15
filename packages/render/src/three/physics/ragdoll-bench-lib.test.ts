// GH-1400 Q1: the bench's own helpers. A bench whose statistics or whose figure is wrong measures the wrong thing quietly, so the
// numbers below are hand-computed, and the figure is checked against the rule `ragdoll-rig.ts` builds a rig.py figure by.
import { describe, expect, it } from 'vitest';
import {
  BODIES_PER_FIGURE,
  HINGES_PER_FIGURE,
  burstSchedule,
  groundPatch,
  percentile,
  squad,
  summarise,
  syntheticFigure,
} from './ragdoll-bench-lib';
import { POSE_STRIDE, RagdollIncident } from './ragdoll-world';
import { loadRapier } from './rapier';

describe('percentile and summarise (nearest rank, hand-computed)', () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  it('nearest rank: p50 of ten is the 5th, p95 the 10th, p90 the 9th, p100 the last, p1 the first', () => {
    expect(percentile(ten, 50)).toBe(5);
    expect(percentile(ten, 95)).toBe(10);
    expect(percentile(ten, 90)).toBe(9);
    expect(percentile(ten, 100)).toBe(10);
    expect(percentile(ten, 1)).toBe(1);
  });
  it('a sample of one is every percentile', () => {
    expect(summarise([7])).toEqual({ n: 1, min: 7, median: 7, p95: 7, p99: 7, max: 7, mean: 7 });
  });
  it('sorts its input and does not mutate it; the max is the worst value however late it sits', () => {
    const xs = [9, 1, 5, 3, 100, 2];
    const s = summarise(xs);
    expect(xs).toEqual([9, 1, 5, 3, 100, 2]);
    expect(s).toMatchObject({ n: 6, min: 1, max: 100, median: 3, p95: 100 });
    expect(s.mean).toBeCloseTo(120 / 6, 10);
  });
  it('refuses an empty sample (an empty run must not read as a fast one)', () => {
    expect(() => summarise([])).toThrow(/empty/);
    expect(() => percentile([], 50)).toThrow(/empty/);
  });
});

describe('the synthetic figure matches the rig.py topology `ragdoll-rig.ts` builds', () => {
  const fig = syntheticFigure(0, 0);
  it('is eleven bodies, four of them hinges, parents before children, one root', () => {
    expect(fig.bodies).toHaveLength(11);
    expect(BODIES_PER_FIGURE).toBe(11);
    expect(HINGES_PER_FIGURE).toBe(4);
    expect(fig.bodies.filter((b) => b.hinge !== null)).toHaveLength(4);
    expect(fig.bodies.filter((b) => b.parent < 0)).toHaveLength(1);
    fig.bodies.forEach((b, i) => expect(b.parent).toBeLessThan(i));
  });
  it("a hinge is a body that ends a chain whose parent has no other link child (the rig's rule): forearms and shins only", () => {
    const kids = (i: number): number => fig.bodies.filter((b) => b.parent === i).length;
    fig.bodies.forEach((b, i) => {
      const endsChain = kids(i) === 0;
      const rule = b.parent >= 0 && endsChain && kids(b.parent) === 1;
      expect(b.hinge !== null, `body ${i}`).toBe(rule);
    });
  });
  it('is human-sized and stands on the ground: capsules between 0 and 1.8 m, radii 4 to 15 cm', () => {
    for (const b of fig.bodies) {
      expect(b.capsule.radius).toBeGreaterThanOrEqual(0.04);
      expect(b.capsule.radius).toBeLessThanOrEqual(0.15);
      expect(b.capsule.centre[1] + b.capsule.halfHeight + b.capsule.radius).toBeLessThan(1.8);
      expect(b.capsule.centre[1] - b.capsule.halfHeight - b.capsule.radius).toBeGreaterThanOrEqual(-1e-9);
    }
  });
  it('a squad of n has n figures 0.8 m apart', () => {
    const s = squad(7);
    expect(s).toHaveLength(7);
    expect(s[1].bodies[0].at[0] - s[0].bodies[0].at[0]).toBeCloseTo(0.8, 10);
  });
});

describe('the burst schedule and the ground patch', () => {
  it('deals every figure exactly once, in entities of at most `perEntity`, over the ticks given', () => {
    const s = burstSchedule(16, 3, 4);
    expect(s.reduce((n, e) => n + e.figures, 0)).toBe(16);
    expect(Math.max(...s.map((e) => e.figures))).toBe(3);
    expect(new Set(s.map((e) => e.tick))).toEqual(new Set([0, 1, 2, 3]));
    expect(s[s.length - 1].figures).toBe(1);
  });
  it('a ground grid has cells^2 * 2 triangles, every index in range', () => {
    const g = groundPatch(48, 24);
    expect(g.indices.length / 3).toBe(24 * 24 * 2);
    expect(Math.max(...g.indices)).toBe(g.vertices.length / 3 - 1);
  });
});

describe('the figure steps in a real Rapier world', () => {
  it('falls and settles without a NaN: every pose value finite after 60 steps, the pelvis lower than it started', async () => {
    const R = await loadRapier();
    const inc = new RagdollIncident(R, { t0Ms: 0, figures: [syntheticFigure(0, 0)], ground: groundPatch(), boxes: [] });
    expect(inc.bodyCount).toBe(11);
    const start = inc.snapshot()[1];
    inc.advanceTo((60 * 50) / 3);
    const pose = inc.snapshot();
    expect(pose).toHaveLength(11 * POSE_STRIDE);
    expect(pose.every((v) => Number.isFinite(v))).toBe(true);
    expect(pose[1]).toBeLessThan(start);
    inc.dispose();
  }, 60_000);
});
