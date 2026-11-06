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
import { chunkGridFor, sliceChunk } from './chunks';
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

describe('ChunkedMeshLayer colours (GH-920 B5: sliced straight into the linear array)', () => {
  /** Every tile its own colour, so a wrong tile range or a missed conversion shows. */
  const coloured = (w: number, h: number): TiledMeshData =>
    buildTiledMesh(w, h, [], (sink: TileSink, x: number, y: number) => {
      const base = sink.positions.length / 3;
      sink.positions.push(x, 0, y, x + 1, 0, y, x + 1, 0, y + 1, x, 0, y + 1);
      for (let i = 0; i < 4; i++) sink.colors.push((x + 1) / 255, (y + 1) / 255, ((x * 7 + y) % 256) / 255);
      sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });

  it('each chunk colour attribute is the sliced array itself, not a second copy, and equals the old two-step result', () => {
    const seen: { sameArray: boolean; colors: Float32Array }[] = [];
    const l = new ChunkedMeshLayer(
      scene,
      'colours',
      material,
      true,
      (d, o) => {
        const g = toGeometry(d, o);
        seen.push({ sameArray: g.getAttribute('color').array === d.colors, colors: g.getAttribute('color').array as Float32Array });
        return g;
      },
      (w, h) => chunkGridFor(w, h, 'ground', 4, 0)
    );
    const tiled = coloured(10, 10);
    l.update(tiled, null);
    expect(seen.length).toBe(9);
    expect(seen.every((s) => s.sameArray), 'no second colour array per chunk').toBe(true);
    // The old path: sRGB slice, then toGeometry's own conversion. Same bytes, every chunk.
    const grid = chunkGridFor(10, 10, 'ground', 4, 0);
    if (grid === null) throw new Error('no grid');
    let compared = 0;
    for (let c = 0; c < 9; c++) {
      const old = toGeometry(sliceChunk(tiled, grid, c) as NonNullable<ReturnType<typeof sliceChunk>>).getAttribute('color').array as Float32Array;
      expect(Array.from(seen[c].colors)).toEqual(Array.from(old));
      compared += old.length;
    }
    expect(compared).toBeGreaterThan(300); // not vacuous: every vertex of the map was compared
    // and the values are linear, not sRGB: byte 1/255 is 0.0003 linear, not 0.0039
    expect(seen[0].colors[0]).toBeLessThan(0.001);
  });

  it('a map left whole still takes the two-step path: toGeometry converts a copy and leaves the build untouched', () => {
    const tiled = coloured(6, 6);
    const before = Array.from(tiled.mesh.colors);
    const g = toGeometry(tiled.mesh);
    expect(g.getAttribute('color').array).not.toBe(tiled.mesh.colors);
    expect(Array.from(tiled.mesh.colors)).toEqual(before);
  });
});

describe('ChunkedMeshLayer.cullRows (row bands)', () => {
  // A 24 x 24 map of lifted quads in 12-tile chunks, seen by a top-down orthographic camera over a 6 x 6 window.
  const lift = (x: number, y: number) => ((x + y) % 5 === 0 ? 2 : 0);
  const camera = (cx: number, cz: number, half: number) => {
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 100);
    cam.position.set(cx, 50, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateMatrixWorld();
    return cam;
  };
  const build = () => {
    const l = new ChunkedMeshLayer(new THREE.Scene(), 'bands', material, true, (d) => toGeometry(d), (w, h) => chunkGridFor(w, h, 'ground', 12, 0));
    l.update(quadMesh(24, 24, lift), null);
    return l;
  };

  it('draws only the rows that reach the frustum, and no vertex of a dropped triangle is inside it', () => {
    const l = build();
    const total = 24 * 24 * 6;
    expect(l.drawnIndexCount).toBe(total);
    const cam = camera(12, 12, 3);
    l.cullRows(cam);
    const drawn = l.drawnIndexCount;
    expect(drawn, 'a 6 x 6 window drew a handful of rows, not the map').toBeLessThan(total * 0.4);
    expect(drawn).toBeGreaterThan(0);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let dropped = 0;
    let inside = 0;
    for (const m of l.chunkMeshes) {
      const pos = m.geometry.getAttribute('position');
      const idx = m.geometry.getIndex() as THREE.BufferAttribute;
      const { start, count } = m.geometry.drawRange;
      const p = new THREE.Vector3();
      for (let i = 0; i < idx.count; i++) {
        p.fromBufferAttribute(pos, idx.getX(i));
        const isDrawn = i >= start && i < start + count;
        if (!isDrawn) {
          dropped++;
          expect(frustum.containsPoint(p), 'a vertex of a dropped row is on screen').toBe(false);
        } else if (frustum.containsPoint(p)) inside++;
      }
    }
    expect(dropped, 'not vacuous: most indices were dropped').toBeGreaterThan(total * 0.5);
    expect(inside, 'not vacuous: the on-screen vertices are all in the drawn range').toBeGreaterThan(20);
  });

  it('moving the camera re-cuts, a window off the map draws nothing, and resetRows draws it all again', () => {
    const l = build();
    l.cullRows(camera(4, 4, 3));
    const a = l.drawnIndexCount;
    l.cullRows(camera(20, 20, 3));
    const b = l.drawnIndexCount;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    l.cullRows(camera(200, 200, 3));
    expect(l.drawnIndexCount).toBe(0);
    l.resetRows();
    expect(l.drawnIndexCount).toBe(24 * 24 * 6);
  });

  it('a map left whole is untouched', () => {
    const l = new ChunkedMeshLayer(new THREE.Scene(), 'whole', material, true, (d) => toGeometry(d), () => null);
    l.update(quadMesh(10, 10), null);
    l.cullRows(camera(200, 200, 3));
    expect(l.drawnIndexCount).toBe(10 * 10 * 6);
  });
});
