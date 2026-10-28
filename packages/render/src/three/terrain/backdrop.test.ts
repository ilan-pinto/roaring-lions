/**
 * The valley backdrop's floor and its assembly (GH-161): the floor meets the
 * map's rim without a step and settles to the rim's mean, it is deterministic,
 * the objects `buildBackdrop` makes are the ones the renderer relies on (the
 * kit outside the AO pre-pass, nothing casting a shadow), and `placeKit` -- the
 * call the lozenge test drives -- is the call `buildBackdrop` draws from.
 *
 * Geometry here needs no WebGL: `THREE.DataTexture` and `BufferGeometry` build
 * fine under node. The cap itself (a vertex above the camera's line to the map)
 * is checked on the shipped kit over the real map in
 * `tools/src/backdrop_lozenge.test.ts`; the oracle's numbers there are literals.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildBackdrop,
  disposeBackdrop,
  floorGrid,
  floorHeight,
  NEAR_CAP_SLOPE,
  NEAR_HARD_SLOPE,
  nearCap,
  OLIVE_SHARE_AT_MIN_ZOOM,
  FADE_TO,
  placeKit,
  type BackdropSpec,
  type LoadedBackdropKit,
} from './backdrop';
import { readKitFixture } from './backdrop-kit-fixture';
import { isAoOccluder } from '../post-chain';

const W = 48;
const H = 48;
const kitSource = readKitFixture();
const SPEC: BackdropSpec = {
  valley: 'ns',
  crest: 48,
  seed: 7,
  kit: 'wadi_halam_kit',
  pieces: [
    { id: 'bd_wall_far_a', at: [0, 8], rot: 0 },
    { id: 'bd_terrace_a', at: [-0.52, 20], rot: 0 },
    { id: 'bd_slope_near_a', at: [W, 8], rot: 180 },
  ],
};

/** A rim that climbs 3 world units across the map, with a step so the mean is not the corner's. */
const RIM = (x: number, z: number): number => 0.03 * x + 0.03 * z + (x > 30 ? 0.4 : 0);

function loaded(): LoadedBackdropKit {
  const map = new THREE.Texture();
  const olive = new THREE.BufferGeometry();
  const o = kitSource.pieces.get('bd_olive');
  if (o === undefined) throw new Error('fixture has no olive');
  olive.setAttribute('position', new THREE.BufferAttribute(o.positions, 3));
  olive.setAttribute('normal', new THREE.BufferAttribute(o.normals, 3));
  olive.setAttribute('uv', new THREE.BufferAttribute(o.uvs, 2));
  olive.setIndex(new THREE.BufferAttribute(Uint32Array.from(o.index), 1));
  return { source: kitSource, map, olive };
}

describe('floorHeight', () => {
  const field = floorHeight(SPEC, RIM, W, H);

  it('meets the rim without a step along every edge', () => {
    for (let t = 0; t <= W; t += 0.5) {
      expect(field(t, 0)).toBeCloseTo(RIM(t, 0), 6);
      expect(field(t, H)).toBeCloseTo(RIM(t, H), 6);
      expect(field(0, t)).toBeCloseTo(RIM(0, t), 6);
      expect(field(W, t)).toBeCloseTo(RIM(W, t), 6);
    }
  });

  it('settles to the rim mean within 10 tiles, plus its bounded swell', () => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i <= W; i++) {
      sum += RIM(i, 0) + RIM(i, H) + RIM(0, i) + RIM(W, i);
      n += 4;
    }
    const mean = sum / n;
    for (const [x, z] of [[-12, 20], [-30, 30], [20, -15], [60, 60]]) {
      expect(Math.abs(field(x, z) - mean)).toBeLessThan(0.31); // the swell is 0.3 at most
    }
  });

  it('is deterministic, and the seed matters', () => {
    expect(floorHeight(SPEC, RIM, W, H)(-20, 17.3)).toBe(field(-20, 17.3));
    expect(floorHeight({ seed: 8 }, RIM, W, H)(-20, 17.3)).not.toBe(field(-20, 17.3));
  });
});

describe('nearCap', () => {
  it('is the rim at the entry point plus 0.45 per tile out, and absent on the far sides', () => {
    expect(nearCap(() => 2, W, H, 10, 10)).toBe(Infinity); // inside
    expect(nearCap(() => 2, W, H, -5, 10)).toBe(Infinity); // far side
    expect(nearCap(() => 2, W, H, W + 10, 20)).toBeCloseTo(2 + 0.45 * 10, 9);
    expect(nearCap(() => 2, W, H, W + 10, H + 10)).toBeCloseTo(2 + 0.45 * 10, 9);
    // a ray that passes more than 6 tiles beside the map is no occlusion at all
    expect(nearCap(() => 2, W, H, W + 30, -20)).toBe(Infinity);
    // the literals the camera's geometry gives: sqrt2 * tan(30 deg) = 0.8165, and the design line is 55% of it
    expect(NEAR_HARD_SLOPE).toBeCloseTo(0.8165, 4);
    expect(NEAR_CAP_SLOPE / NEAR_HARD_SLOPE).toBeCloseTo(0.55, 2);
  });
});

describe('buildBackdrop', () => {
  const kit = loaded();
  const b = buildBackdrop(SPEC, kit, RIM, W, H, '#1a1a1a');

  it('draws the floor, the kit (full and LOD1), the olives and the houses', () => {
    expect(b.group.children.map((c) => c.name)).toEqual(['backdrop-ground', 'backdrop-kit', 'backdrop-kit-lod1', 'backdrop-olives', 'backdrop-houses']);
    expect(b.stats.pieces).toBe(3);
    expect(b.stats.olives).toBeGreaterThan(10);
    expect(b.stats.houses).toBeGreaterThan(0);
    expect(b.stats.triangles).toBeGreaterThan(10_000);
  });

  it('casts and takes no shadow, and is never frustum-culled away', () => {
    for (const c of b.group.children) {
      expect(c.castShadow, c.name).toBe(false);
      expect(c.receiveShadow, c.name).toBe(false);
      expect(c.frustumCulled, c.name).toBe(false);
    }
  });

  it('keeps the kit out of the AO pre-pass and the floor in it', () => {
    const [ground, kitMesh, kitLod1, olives, houses] = b.group.children;
    expect(isAoOccluder(ground)).toBe(true);
    expect(isAoOccluder(kitMesh)).toBe(false);
    expect(isAoOccluder(kitLod1)).toBe(false);
    expect(isAoOccluder(olives)).toBe(false);
    expect(isAoOccluder(houses)).toBe(false);
  });

  it('swaps to the LOD1 twin below zoom 0.6 and back, one kit mesh drawn at a time', () => {
    const [, full, low] = b.group.children;
    for (const [zoom, lod1] of [[0.35, true], [0.59, true], [0.6, false], [1, false], [2.5, false]] as const) {
      b.setZoom(zoom);
      expect([full.visible, low.visible], `zoom ${zoom}`).toEqual([!lod1, lod1]);
    }
    b.setZoom(1);
    // the point of the twin: far fewer triangles at the zoom where all of them are on screen
    const kitMesh = full as THREE.Mesh;
    const lowMesh = low as THREE.Mesh;
    const tris = (m: THREE.Mesh): number => (m.geometry.getIndex()?.count ?? 0) / 3;
    expect(tris(lowMesh)).toBeLessThan(0.4 * tris(kitMesh));
    const olivesDropped = b.stats.olives - Math.ceil(b.stats.olives * OLIVE_SHARE_AT_MIN_ZOOM);
    expect(b.stats.triangles - b.stats.trianglesLod1).toBe(tris(kitMesh) - tris(lowMesh) + olivesDropped * 62);
  });

  it('draws half the olives at minimum zoom, an even half, and all of them above it', () => {
    const olives = b.group.children.find((c) => c.name === 'backdrop-olives') as THREE.InstancedMesh;
    b.setZoom(1);
    expect(olives.count).toBe(b.stats.olives);
    b.setZoom(0.35);
    expect(olives.count).toBe(Math.ceil(b.stats.olives * OLIVE_SHARE_AT_MIN_ZOOM));
    // the surviving half spans the same ground as the whole: its x and z ranges match to within a few tiles
    const xs = (n: number): number[] => Array.from({ length: n }, (_, k) => olives.instanceMatrix.array[k * 16 + 12]);
    const half = xs(olives.count);
    const all = xs(b.stats.olives);
    expect(Math.min(...half) - Math.min(...all)).toBeLessThan(3);
    expect(Math.max(...all) - Math.max(...half)).toBeLessThan(3);
    b.setZoom(1);
  });

  it('draws no floor cell beyond the fade, where the frame is the background', () => {
    const pos = (b.group.children[0] as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute;
    const idx = (b.group.children[0] as THREE.Mesh).geometry.getIndex() as THREE.BufferAttribute;
    let worst = 0;
    for (let t = 0; t < idx.count; t++) {
      const x = pos.getX(idx.getX(t));
      const z = pos.getZ(idx.getX(t));
      worst = Math.max(worst, Math.hypot(Math.max(0, -x, x - W), Math.max(0, -z, z - H)));
    }
    expect(worst).toBeGreaterThan(30); // the floor really does reach out toward the fade...
    expect(worst).toBeLessThanOrEqual(48 * FADE_TO + 2); // ...and stops there, not at the 48-tile margin
  });

  it('shares one atlas between the kit mesh and the olives', () => {
    const [, kitMesh, kitLod1, olives] = b.group.children as THREE.Mesh[];
    expect((kitMesh.material as THREE.MeshStandardMaterial).map).toBe(kit.map);
    expect(kitLod1.material).toBe(kitMesh.material);
    expect((olives.material as THREE.MeshStandardMaterial).map).toBe(kit.map);
  });

  it('disposes what it made and leaves the loader-owned kit alone', () => {
    let atlasDisposed = false;
    kit.map.addEventListener('dispose', () => (atlasDisposed = true));
    let oliveDisposed = false;
    kit.olive?.addEventListener('dispose', () => (oliveDisposed = true));
    let floorTexDisposed = false;
    const floorMat = (b.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    floorMat.map?.addEventListener('dispose', () => (floorTexDisposed = true));
    disposeBackdrop(b);
    expect(floorTexDisposed).toBe(true);
    expect(atlasDisposed).toBe(false);
    expect(oliveDisposed).toBe(false);
  });
});

describe('placeKit is what buildBackdrop draws', () => {
  it('builds the kit mesh from the same arrays', () => {
    const { placed } = placeKit(SPEC, kitSource, RIM, W, H);
    const b = buildBackdrop(SPEC, loaded(), RIM, W, H, '#1a1a1a');
    const kitGeo = (b.group.children[1] as THREE.Mesh).geometry;
    expect(Array.from((kitGeo.getAttribute('position') as THREE.BufferAttribute).array.slice(0, 300))).toEqual(Array.from(placed.positions.slice(0, 300)));
    expect(kitGeo.getIndex()?.count).toBe(placed.indices.length);
    disposeBackdrop(b);
  });

  it('floorGrid puts the floor a hair under the rim on the map boundary only', () => {
    const g = floorGrid(SPEC, RIM, W, H);
    const at = (x: number, z: number): number => g.heights[(z - g.z0) * g.nx + (x - g.x0)];
    expect(at(20, 0)).toBeCloseTo(RIM(20, 0) - 0.01, 5);
    expect(at(-1, 0)).toBeGreaterThan(RIM(-1, 0) - 1); // outside the rectangle: the field itself, no epsilon
    expect(g.nx).toBe(W + 2 * 48 + 1);
  });
});
