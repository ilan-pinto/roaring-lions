/**
 * Ground plan 2, Task 1 (G8), N-4: grass must never stand tall enough to
 * hide the infantry it decorates. The shipped GLBs are the ground truth --
 * `GRASS_SCALE_MAX` (decor-place.ts) is checked against their actual baked
 * height, not against an assumed model height, so a re-export that changes
 * the model is caught here rather than only on screen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRASS_SCALE_MAX } from '../../packages/render/src/three/terrain/decor-place';
import { MESH_SCALE } from '../../packages/render/src/three/units/mesh-anim';

const DECOR = join(__dirname, '../../art/meshes/decor');

interface GlbAccessor { count: number; min?: number[]; max?: number[] }
interface GlbJson {
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: GlbAccessor[];
}
/** The JSON chunk of a .glb: 12-byte header, then chunk 0 is JSON. */
export function glbJson(path: string): GlbJson {
  const b = readFileSync(path);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as GlbJson;
}
export function glbHeight(j: GlbJson): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of j.meshes) for (const p of m.primitives) {
    const a = j.accessors[p.attributes.POSITION];
    if (!a.min || !a.max) throw new Error('POSITION accessor without min/max');
    lo = Math.min(lo, a.min[1]);
    hi = Math.max(hi, a.max[1]);
  }
  return hi - lo;
}
export function glbTris(j: GlbJson): number {
  let n = 0;
  for (const m of j.meshes) for (const p of m.primitives) {
    n += (p.indices !== undefined ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count) / 3;
  }
  return n;
}

describe('grass never hides infantry (N-4)', () => {
  it.each([0, 1, 2])('grass_%i at GRASS_SCALE_MAX stands at most 0.12 world units', (v) => {
    const h = glbHeight(glbJson(join(DECOR, `grass_${v}.glb`)));
    // grass_0/2 bake to exactly 0.4 model units, which glTF's float32 POSITION
    // accessor stores as 0.4000000059604645 -- the nearest representable
    // float32, not a design error. That excess (1.8e-9 of the 0.12 budget)
    // would fail a bit-exact `<= 0.12` for a model that is, by design,
    // exactly at the limit; EPSILON absorbs float32 rounding only, not a
    // real height violation (falsified below by GRASS_SCALE_MAX = 1.2).
    const EPSILON = 1e-6;
    expect(h * MESH_SCALE * GRASS_SCALE_MAX).toBeLessThanOrEqual(0.12 + EPSILON);
  });
});

/** Horizontal extents of every primitive on nodes tagged `role`. */
function roleExtent(j: GlbJson & { nodes: { mesh?: number; extras?: { rl_role?: string } }[] }, role: string): { w: number; d: number } {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const n of j.nodes) {
    if (n.mesh === undefined || n.extras?.rl_role !== role) continue;
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      if (!a.min || !a.max) throw new Error('POSITION accessor without min/max');
      x0 = Math.min(x0, a.min[0]); x1 = Math.max(x1, a.max[0]);
      z0 = Math.min(z0, a.min[2]); z1 = Math.max(z1, a.max[2]);
    }
  }
  return { w: x1 - x0, d: z1 - z0 };
}

describe('the olive LOD (D8, N-15)', () => {
  it.each([0, 1, 2])('tree_%i is 2,000-3,000 triangles, still 3.40 m tall, trunk and foliage both', (v) => {
    const j = glbJson(join(DECOR, `tree_${v}.glb`)) as Parameters<typeof roleExtent>[0];
    expect(glbTris(j)).toBeLessThanOrEqual(3000);
    expect(glbTris(j)).toBeGreaterThanOrEqual(2000); // a quarter, not a stub
    expect(glbHeight(j)).toBeCloseTo(3.4, 2);
    const roles = new Set(j.nodes.map((n) => n.extras?.rl_role));
    expect(roles.has('trunk') && roles.has('foliage')).toBe(true);
  });
  // The silhouette must survive. CORRECTION (Task 6, D8): the brief's own
  // comment here said "3.01 x 1.01 and 2.85 x 1.15", but that does not match
  // the shipped bytes -- measured directly from the pre-task
  // `art/meshes/decor/tree_{0,1}.glb` (the only commit ever to touch them,
  // `a34bca75`), the real footprints are 3.01 x 0.90 and 2.85 x 0.74. `tree_0`'s
  // width and `tree_1`'s width both matched the brief exactly; only the two
  // DEPTH ('d') figures were off (0.905 read as 1.01, a difference already
  // outside this test's own 10% band; 0.7356 read as 1.15, 56% off and
  // unreachable by any decimation of this source). Corrected to the measured
  // originals so this test still does what its own name says -- catch a
  // silhouette drift from today's real shape -- rather than gating on a
  // number today's shape never had.
  it.each([
    [0, 3.01, 0.90],
    [1, 2.85, 0.74],
  ])('tree_%i keeps its footprint within 10%%', (v, w, d) => {
    const e = roleExtent(glbJson(join(DECOR, `tree_${v}.glb`)) as Parameters<typeof roleExtent>[0], 'foliage');
    expect(Math.abs(e.w / w - 1)).toBeLessThan(0.1);
    expect(Math.abs(e.d / d - 1)).toBeLessThan(0.1);
  });
});

describe('the desert crown (N-13, N-14)', () => {
  it.each([
    [0, 2.0, 2.6],
    [1, 1.15, 1.5],
    [2, 1.0, 1.3],
  ])('desert_tree_%i: 1,200-1,800 tris, crown %f-%f m across in both axes, 2.90 m tall', (v, lo, hi) => {
    const j = glbJson(join(DECOR, `desert_tree_${v}.glb`)) as Parameters<typeof roleExtent>[0];
    expect(glbTris(j)).toBeGreaterThanOrEqual(1200);
    expect(glbTris(j)).toBeLessThanOrEqual(1800);
    expect(glbHeight(j)).toBeCloseTo(2.9, 2);
    const e = roleExtent(j, 'foliage');
    for (const span of [e.w, e.d]) {
      expect(span).toBeGreaterThanOrEqual(lo);
      expect(span).toBeLessThanOrEqual(hi);
    }
  });
});
