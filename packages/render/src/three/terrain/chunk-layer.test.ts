/**
 * `ChunkedMeshLayer`: the scene-graph half of the ground's chunks (`chunks.ts` says what a chunk is; the
 * byte-level claims against real maps are `packages/app/src/terrain-chunks.test.ts`).
 *
 * What is pinned here is the layer's own behaviour: a map that stays whole is ONE mesh built from the
 * whole build, a chunked one is a mesh per chunk, and an update that names the re-emitted tiles replaces
 * ONLY the chunks holding one -- the others keep the very mesh and geometry (and so the GPU buffers) they
 * had. The tiled mesh is synthetic: one quad per tile, whose x position says which tile it is.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChunkedMeshLayer } from './chunk-layer';
import { chunkGridFor } from './chunks';
import { toGeometry } from './mesh';
import { buildTiledMesh, spliceTiledMesh, type TileSink, type TiledMeshData } from './tiled-mesh';

/** A quad per tile at (x, 0, y) .. (x + 1, 0, y + 1), raised by `lift(x, y)`. */
function quadMesh(w: number, h: number, lift: (x: number, y: number) => number = () => 0): TiledMeshData {
  return buildTiledMesh(w, h, [], (sink: TileSink, x: number, y: number) => {
    const base = sink.positions.length / 3;
    const l = lift(x, y);
    sink.positions.push(x, l, y, x + 1, l, y, x + 1, l, y + 1, x, l, y + 1);
    for (let i = 0; i < 4; i++) sink.colors.push(0.5, 0.5, 0.5);
    sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
}

const material = new THREE.MeshBasicMaterial();
const scene = new THREE.Scene();
const layer = (edge: number | null) =>
  new ChunkedMeshLayer(scene, 'test', material, true, (d) => toGeometry(d), (w, h) => (edge === null ? null : chunkGridFor(w, h, 'ground', edge, 0)));

describe('ChunkedMeshLayer', () => {
  it('a map left whole is one mesh, built from the whole-map data', () => {
    const l = layer(null);
    const tiled = quadMesh(10, 10);
    expect(l.update(tiled, null)).toBe(1);
    expect(l.meshCount).toBe(1);
    const mesh = l.chunkMeshes[0];
    expect(mesh.geometry.getIndex()?.count).toBe(10 * 10 * 6);
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.matrixAutoUpdate, 'frozen static, like every terrain layer').toBe(false);
    // straight into the scene, no group between: the scene-graph census of every shipped map depends on it
    expect(l.root).toBe(mesh);
    expect(mesh.parent).toBe(scene);
  });

  it('a chunked map is one mesh per chunk, each bounded by its own tiles', () => {
    const l = layer(4);
    expect(l.update(quadMesh(10, 10), null)).toBe(9);
    expect(l.meshCount).toBe(9);
    expect(l.root?.type).toBe('Group');
    expect(l.root?.parent).toBe(scene);
    let indices = 0;
    for (const m of l.chunkMeshes) {
      indices += m.geometry.getIndex()?.count ?? 0;
      m.geometry.computeBoundingSphere();
      // a 4x4 chunk's sphere reaches 2.83 tiles, never the whole map's 7.07
      expect((m.geometry.boundingSphere as THREE.Sphere).radius).toBeLessThan(3.2);
    }
    expect(indices).toBe(10 * 10 * 6);
  });

  it('an update that names the dirty tiles replaces only the chunks holding one', () => {
    const l = layer(4);
    const first = quadMesh(10, 10);
    l.update(first, null);
    const before = new Map(l.chunkMeshes.map((m) => [m, m.geometry]));

    // Re-emit tile (5, 1) (chunk column 1, row 0) one unit higher, as a splice would.
    const dirty = new Uint8Array(100);
    dirty[1 * 10 + 5] = 1;
    const second = spliceTiledMesh(first, dirty, (sink, x, y) => {
      const base = sink.positions.length / 3;
      sink.positions.push(x, 1, y, x + 1, 1, y, x + 1, 1, y + 1, x, 1, y + 1);
      for (let i = 0; i < 4; i++) sink.colors.push(0.5, 0.5, 0.5);
      sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    expect(l.update(second, dirty)).toBe(1);
    expect(l.meshCount).toBe(9);

    const now = l.chunkMeshes;
    const kept = now.filter((m) => before.has(m));
    expect(kept.length, 'eight of nine chunks keep their mesh').toBe(8);
    for (const m of kept) expect(m.geometry, 'and its geometry, so its GPU buffers').toBe(before.get(m));
    const fresh = now.find((m) => !before.has(m)) as THREE.Mesh;
    const ys = Array.from(fresh.geometry.getAttribute('position').array).filter((_, i) => i % 3 === 1);
    expect(ys.includes(1), 'the replaced chunk carries the new height').toBe(true);
  });

  it('a map that changes between whole and chunked swaps the scene object cleanly', () => {
    const l = layer(4);
    l.update(quadMesh(10, 10), null);
    const group = l.root as THREE.Object3D;
    // The same layer given a map the grid rule leaves whole (edge null is the rule's answer for it).
    const flip = new ChunkedMeshLayer(scene, 'flip', material, true, (d) => toGeometry(d), (w) => (w > 6 ? chunkGridFor(w, w, 'ground', 4, 0) : null));
    flip.update(quadMesh(10, 10), null);
    expect(flip.root?.type).toBe('Group');
    flip.update(quadMesh(5, 5), null);
    expect(flip.root?.type).toBe('Mesh');
    expect(flip.root?.parent).toBe(scene);
    expect(scene.children.filter((c) => c.name === 'flip').length, 'the old group is gone').toBe(0);
    expect(group.parent).toBe(scene);
  });

  it('a full update, or a different map size, rebuilds every chunk', () => {
    const l = layer(4);
    l.update(quadMesh(10, 10), null);
    const old = new Set(l.chunkMeshes);
    expect(l.update(quadMesh(10, 10), null)).toBe(9);
    expect(l.chunkMeshes.some((m) => old.has(m))).toBe(false);
    const dirty = new Uint8Array(144);
    dirty[0] = 1;
    expect(l.update(quadMesh(12, 12), dirty), 'a dirty mask for another size is not a splice').toBe(9);
    expect(l.meshCount).toBe(9);
  });

  it('a dispose empties the group', () => {
    const l = layer(4);
    l.update(quadMesh(10, 10), null);
    const root = l.root as THREE.Object3D;
    l.dispose();
    expect(root.children.length).toBe(0);
    expect(root.parent, 'and the group leaves the scene').toBeNull();
    expect(l.meshCount).toBe(0);
    const whole = layer(null);
    whole.update(quadMesh(10, 10), null);
    const mesh = whole.root as THREE.Object3D;
    whole.dispose();
    expect(mesh.parent, 'a whole map\'s mesh leaves the scene too').toBeNull();
  });
});
