/**
 * The wiring of the chunked ground into `ThreeRenderer` (GH-913, GH-920): what `rebuildTerrain` builds
 * for a map above and below the 48 x 48 line, and that a collapse replaces only the chunk meshes the
 * splice touched. The byte-level claims are `packages/app/src/terrain-chunks.test.ts`, the layer's own
 * behaviour `terrain/chunk-layer.test.ts`; this is the one test that fails if `rebuildTerrain` stops
 * passing the grid or the splice's dirty tiles on.
 *
 * Harness copied from `ThreeRenderer.ground-control.test.ts`: a faked `WebGLRenderer`, a real `Sim`,
 * and `frame()` driving the rebuild the way the app does.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import { DECOR_DITCH } from './terrain/shared';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};


function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

interface Private {
  terrainMesh: THREE.Object3D | null;
  scatterMesh: THREE.Object3D | null;
  decorGroup: THREE.Group | null;
  texturedDecorGroup: THREE.Group | null;
  decorSet: { parts: Map<string, { role: string; geometry: THREE.BufferGeometry }[]> };
  texturedDecorSet: { parts: Map<string, { geometry: THREE.BufferGeometry; map: THREE.Texture }> };
}

/** A flat map with a one-tile hut at (hx, hy), booted and drawn once. */
function setUp(size: number, hx: number, hy: number): { r: ThreeRenderer; priv: Private; sim: Sim } {
  const sim = new Sim({ seed: 1, width: size, height: size, capacity: 4 });
  const hut = sim.addStructureType({ id: 'hut', hp_per_tile: 80, height_px: 14, color: 'dust.1' });
  sim.addStructure(hut, [hy * size + hx]);
  const r = new ThreeRenderer(sim, makeOpts());
  r.frame(1, 0);
  return { r, priv: r as unknown as Private, sim };
}

/** The chunk meshes of a layer root: its group's children, or the root itself when it is the one mesh of a whole map. */
const meshes = (root: THREE.Object3D | null): THREE.Mesh[] =>
  root === null ? [] : (root as THREE.Mesh).isMesh ? [root as THREE.Mesh] : root.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);

/** A map with scatter (cover tiles all over) and a diagonal ditch, with a stand-in decor geometry set loaded. */
function setUpWithDecor(size: number): { r: ThreeRenderer; priv: Private } {
  const sim = new Sim({ seed: 1, width: size, height: size, capacity: 4 });
  for (let y = 0; y < size; y += 3) for (let x = 0; x < size; x += 3) sim.cover[y * size + x] = 1;
  const r = new ThreeRenderer(sim, makeOpts());
  const priv = r as unknown as Private;
  const tri = (): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setIndex([0, 1, 2]);
    return g;
  };
  for (const family of ['grass', 'bush', 'rock', 'slab', 'boulder', 'tree', 'desert_tree', 'sand']) {
    for (let v = 0; v < 3; v++) priv.decorSet.parts.set(`${family}_${v}`, [{ role: family === 'rock' || family === 'slab' || family === 'boulder' ? 'rock' : family === 'sand' ? 'sand' : 'foliage', geometry: tri() }]);
  }
  priv.texturedDecorSet.parts.set('ditch_0', { geometry: new THREE.BoxGeometry(1, 1, 1), map: new THREE.Texture() });
  const decor = new Uint8Array(size * size);
  for (let i = 4; i < size - 4; i++) decor[i * size + i] = DECOR_DITCH;
  r.setDecor(decor);
  r.frame(1, 0);
  return { r, priv };
}

describe('rebuildTerrain chunks the ditch of a map above 48 x 48, and nothing else of the decor', () => {
  it('48 x 48: one batch per role, one ditch mesh', () => {
    const { r, priv } = setUpWithDecor(48);
    const batches = (priv.decorGroup as THREE.Group).children as THREE.BatchedMesh[];
    expect(batches.length).toBeGreaterThan(0);
    expect(new Set(batches.map((b) => b.name)).size, 'one batch per role').toBe(batches.length);
    for (const b of batches) expect(b.perObjectFrustumCulled).toBe(true);
    expect((priv.texturedDecorGroup as THREE.Group).children.length).toBe(1);
    r.dispose();
  });

  it('80 x 80: the ditch is split along its run, and the decor batches stay one a role, culling per instance', () => {
    const { r, priv } = setUpWithDecor(80);
    // Chunked decor was built, measured on Rujm Sawda (Metal, DPR 2) and taken out: +0.2 to +1.8 ms
    // for no lower a pan cull, because a draw is dear and a visible chunk still walks its instances.
    // Do not put it back without a measurement that says otherwise.
    const batches = (priv.decorGroup as THREE.Group).children as THREE.BatchedMesh[];
    expect(new Set(batches.map((b) => b.name)).size, 'one batch per role').toBe(batches.length);
    for (const b of batches) {
      expect(b.perObjectFrustumCulled).toBe(true);
      expect(b.sortObjects).toBe(true);
    }
    const ditch = (priv.texturedDecorGroup as THREE.Group).children;
    expect(ditch.length, 'a diagonal run through 8-tile chunks').toBe(10);
    r.dispose();
  });
});

describe('rebuildTerrain chunks a map above 48 x 48', () => {
  it('a 48 x 48 map keeps ONE ground mesh and ONE scatter mesh, as before', () => {
    const { r, priv } = setUp(48, 20, 20);
    expect(meshes(priv.terrainMesh).length).toBe(1);
    expect(meshes(priv.scatterMesh).length).toBe(1);
    // ...straight in the scene, no group between (the scene-graph census every shipped map pins).
    const scene = (r as unknown as { scene: THREE.Scene }).scene;
    expect((priv.terrainMesh as THREE.Mesh).isMesh).toBe(true);
    expect(priv.terrainMesh?.parent).toBe(scene);
    expect(priv.scatterMesh?.parent).toBe(scene);
    r.dispose();
  });

  it('an 80 x 80 map gets a ground mesh per 32-tile chunk, in the scene', () => {
    const { r, priv } = setUp(80, 20, 20);
    expect(meshes(priv.terrainMesh).length).toBe(9);
    expect(meshes(priv.scatterMesh).length).toBeGreaterThan(0);
    expect(meshes(priv.scatterMesh).length).toBeLessThanOrEqual(9);
    const scene = (r as unknown as { scene: THREE.Scene }).scene;
    expect(scene.children.includes(priv.terrainMesh as THREE.Object3D)).toBe(true);
    // Chunks cull by their own bounds: a 32-tile chunk's sphere is a fraction of the map's.
    for (const m of meshes(priv.terrainMesh)) {
      m.geometry.computeBoundingSphere();
      expect((m.geometry.boundingSphere as THREE.Sphere).radius).toBeLessThan(30);
    }
    r.dispose();
  });

  it('a collapse replaces only the chunk meshes its splice touched', () => {
    const { r, priv, sim } = setUp(80, 20, 20);
    const before = new Map(meshes(priv.terrainMesh).map((m) => [m, m.geometry]));
    sim.debugDestroyStructure(0);
    r.applyStructureDestroyed(0);
    r.frame(1, 0);
    expect(r.debugTerrainRebuild().full).toBe(false);
    const after = meshes(priv.terrainMesh);
    expect(after.length).toBe(9);
    const kept = after.filter((m) => before.get(m) === m.geometry);
    // (20, 20) is deep inside chunk (0, 0): the 5 x 5 splice square touches that chunk alone.
    expect(kept.length).toBe(8);
    r.dispose();
  });

  it('the scatter debug layer still hides every chunk with one flag', () => {
    const { r, priv } = setUp(80, 20, 20);
    r.setDebugLayerVisible('scatter', false);
    expect((priv.scatterMesh as THREE.Object3D).visible).toBe(false);
    r.setDebugLayerVisible('scatter', true);
    expect((priv.scatterMesh as THREE.Object3D).visible).toBe(true);
    r.dispose();
  });
});
