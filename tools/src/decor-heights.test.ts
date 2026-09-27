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
