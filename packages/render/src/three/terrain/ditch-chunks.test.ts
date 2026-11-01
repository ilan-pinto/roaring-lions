/**
 * The ditch of a CHUNKED map (`chunks.ts`): the same segments, filed by where they stand, one
 * `InstancedMesh` per chunk they pass through.
 *
 * Why only the ditch: it is 96% of a Rujm Sawda frame's triangles (one never-culled InstancedMesh,
 * ~38k triangles a segment), and cutting it was worth -2.1 to -4.0 ms. The decor BatchedMeshes were
 * chunked too, and measured: no gain, +0.2 to +1.8 ms, and a pan cull no lower (docs/agent-notes/
 * terrain-rendering.md, "Chunks"), so they are left whole -- `ThreeRenderer.chunks.test.ts` pins that.
 *
 * What is pinned: every segment is in exactly one chunk's mesh; a chunk is culled by its own sphere,
 * which is the entire point; the one material is shared; and a map left whole builds the one mesh it
 * always built (the old-versus-new byte comparison of that was run against origin/main's builder, in
 * the ledger, not kept: it needs both).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTexturedDecorMesh, type TexturedDecorSet } from './decor-textured-mesh';
import { chunkGridFor, type ChunkGrid } from './chunks';
import type { DecorPlacement } from './decor-place';


describe('buildTexturedDecorMesh on a chunked map', () => {
  const set: TexturedDecorSet = { parts: new Map([['ditch_0', { geometry: new THREE.BoxGeometry(1, 1, 1), map: new THREE.Texture() }]]) };
  // A ditch run along the diagonal of an 80x80 map.
  const run: DecorPlacement[] = Array.from({ length: 70 }, (_, i) => ({
    family: 'ditch' as const, variant: 0, x: i + 5.5, z: i + 5.5, y: 0, yawTurns: 0, scale: 1,
  }));
  const grid = chunkGridFor(80, 80, 'ditch') as ChunkGrid; // 10 x 10

  it('splits a ditch into one mesh per chunk it passes through, holding every segment once', () => {
    const whole = buildTexturedDecorMesh(run, set, null);
    const chunked = buildTexturedDecorMesh(run, set, grid);
    expect(whole.children.length).toBe(1);
    expect(chunked.children.length, 'a diagonal crosses ten 8-tile chunks').toBe(10);
    const total = (chunked.children as THREE.InstancedMesh[]).reduce((n, m) => n + m.count, 0);
    expect(total).toBe(70);
    for (const m of chunked.children as THREE.InstancedMesh[]) {
      m.computeBoundingSphere();
      expect((m.boundingSphere as THREE.Sphere).radius, 'each chunk is culled by its own sphere').toBeLessThan(15);
    }
  });

  it('a map left whole is the one mesh it always was, in placement order', () => {
    const whole = buildTexturedDecorMesh(run, set, null);
    expect(whole.children.length).toBe(1);
    const mesh = whole.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(70);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const i of [0, 35, 69]) {
      mesh.getMatrixAt(i, m);
      expect(p.setFromMatrixPosition(m).x).toBe(run[i].x);
    }
  });

  it('shares the one material across the chunks of a key', () => {
    const chunked = buildTexturedDecorMesh(run, set, grid);
    expect(new Set((chunked.children as THREE.InstancedMesh[]).map((m) => m.material)).size).toBe(1);
  });
});
