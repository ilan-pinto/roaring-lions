/**
 * GH-1167 S5: the 3D grass field's node-branch build in `ThreeRenderer` (design 2026-11-11, sections 3.1-3.5, slice S5). A NODE
 * renderer (the backend mocked, as in `ThreeRenderer.foliage-twin-clock.test.ts`) whose backend carries the REAL builder
 * (`createGrassFieldKit`), on a 48x48 open map whose tones carry `grassField`:
 *  - the field is built: one `rl-grass-field` root, at most 108 instanced meshes and none casting a shadow, all in
 *    `GRASS_RENDER_ORDER`, holding every clump `planGrassField` placed;
 *  - the sward strokes and the Meshy tufts are gone on that boot (`swardMarks: false`, the `grass` filter), and nothing else moved;
 *  - `low` builds no field and draws today's sward and tufts; `medium` draws the LOD bands x 1.2 coarser;
 *  - the LOD follows the zoom with its hysteresis, and swaps geometry only;
 *  - the `grass-field` layer is a flag the frame consults (a repaint does not undo it);
 *  - a collapse re-places only the cells it touched (every other mesh is the same object);
 *  - `dispose()` releases it (material, geometries, meshes), and a full rebuild retires the old field after the next draw.
 *
 * Falsified by (run red, then put back; in the commit message): `grassFieldTones` returning the tones on a `low` boot; the frame
 * not calling `stepGrassField` (LOD and layer); `syncGrassField` rebuilding the whole field on a splice; the field's `dispose`
 * left out of `ThreeRenderer.dispose`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import type { RendererOptions, TerrainTones } from '../api';
import type { MaterialKit, RenderBackend } from './backend/backend';
import { ThreeRenderer } from './ThreeRenderer';
import { NULL_P3_SLOTS } from './node-material-adoption';
import { GRASS_RENDER_ORDER } from './units/render-order';
import type { GrassFieldHandle, GrassFieldKit } from './terrain/grass-field.node';
import { planGrassField } from './terrain/grass-field-cells';
import { buildTerrainSurface } from './terrain/surface';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    shadowMap = { enabled: false, type: actual.PCFShadowMap };
    info = { reset(): void {}, render: { calls: 0, triangles: 0 }, autoReset: true };
    setClearColor(): void {}
    setPixelRatio(): void {}
    getPixelRatio(): number {
      return 1;
    }
    setSize(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const seam = vi.hoisted(() => ({ kit: null as MaterialKit | null, grass: null as GrassFieldKit | null }));

vi.mock('./backend/node-backend', async () => {
  const { censusUnported: census } = await vi.importActual<typeof import('./backend/unported')>('./backend/unported');
  return {
    createNodeBackend: async (): Promise<{ backend: RenderBackend }> => {
      const kit = seam.kit;
      if (kit === null) throw new Error('spec: no kit');
      const backend = {
        kind: 'node-webgl2',
        adapter: 'webgl2',
        domElement: {} as HTMLCanvasElement,
        setPixelRatio(): void {},
        getPixelRatio: () => 1,
        setSize(): void {},
        kit: { fog: null, ao: null, bloom: null },
        materials: kit,
        ...(seam.grass !== null ? { grassField: seam.grass } : {}),
        setFog(): void {},
        setOutputMaths(): void {},
        bloom: { setEnabled: () => false, setFade(): void {}, strength: 0, built: false, readPreBloom: async () => null },
        pmrem: {},
        ao: null,
        configure(): void {},
        post: null,
        async prepare(scene: THREE.Scene): Promise<void> {
          census(scene);
        },
        render(scene: THREE.Scene): void {
          census(scene);
        },
        photographGround: async () => null,
        captureView: async () => null,
        whenSubmitted: async () => {},
        unported: () => [],
        stats: () => ({ calls: 0, triangles: 0 }),
        dispose(): void {},
      };
      return { backend: backend as unknown as RenderBackend };
    },
  };
});

const GRASS_TONES = { root: '#3f5a2a', tip3: '#5d7a35', tip2: '#6f8c3f', tip1: '#86a04e', strawRoot: '#8c7a55', strawTip: '#c8b993' };

const TONES: TerrainTones = {
  open: '#6f8c3f', cover: ['#3f5a2a', '#4E5433', '#333821'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#86a04e', bladeShade: '#3f5a2a', spoil: '#6E7449',
  crownRatio: 1.5, scatter: 'sward', groveFamily: 'tree',
  haze: '#E0B87A',
  grassField: GRASS_TONES,
};

const OPTS: RendererOptions = {
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
  quality: QUALITY_PRESETS.high,
  environmentLight: false,
  gpu: 'webgl2',
};

interface Private {
  scene: THREE.Scene;
  grassField: GrassFieldHandle | null;
  decorGroup: THREE.Group | null;
  scatterMesh: THREE.Object3D | null;
  decorSet: { parts: Map<string, { role: string; geometry: THREE.BufferGeometry }[]> };
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;
const SIZE = 48;

interface Booted {
  readonly r: ThreeRenderer;
  readonly sim: Sim;
  readonly priv: Private;
  readonly structure: number;
}

async function boot(quality: RenderQuality, opts: { grassKit?: boolean } = {}): Promise<Booted> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const { createGrassFieldKit } = await import('./terrain/grass-field.node');
  const { MATERIAL_MATHS } = await import('./material-maths');
  seam.kit = { ...NULL_P3_SLOTS, ground: null, ring: null, foliage: null };
  seam.grass = opts.grassKit === false ? null : createGrassFieldKit({ W, TSL, maths: MATERIAL_MATHS.grassField });
  const sim = new Sim({ seed: 1, width: SIZE, height: SIZE, capacity: 4 });
  // A 2x2 shanty in cell 0 (tiles 3..4), and a cover tile far from it.
  const type = sim.addStructureType({ id: 'shanty', hp_per_tile: 50, height_px: 11, color: 'dust.1' });
  const structure = sim.addStructure(type, [3 * SIZE + 3, 3 * SIZE + 4, 4 * SIZE + 3, 4 * SIZE + 4]);
  sim.cover[30 * SIZE + 30] = 1;
  const r = new ThreeRenderer(sim, { ...OPTS, quality });
  const priv = r as unknown as Private;
  const tri = (): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setIndex([0, 1, 2]);
    return g;
  };
  for (const family of ['grass', 'sand', 'bush', 'tree', 'desert_tree']) {
    for (let v = 0; v < 3; v++) priv.decorSet.parts.set(`${family}_${v}`, [{ role: 'foliage', geometry: tri() }]);
  }
  await r.init(HOST);
  r.camera.x = SIZE / 2;
  r.camera.y = SIZE / 2;
  r.camera.zoom = 1;
  r.frame(1, 0);
  return { r, sim, priv, structure };
}

const foliageCount = (priv: Private): number =>
  ((priv.decorGroup?.children ?? []).find((c) => c.name === 'decor-foliage') as THREE.BatchedMesh | undefined)?.instanceCount ?? 0;
const scatterVerts = (priv: Private): number => {
  let n = 0;
  priv.scatterMesh?.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g?.attributes.position !== undefined) n += g.attributes.position.count;
  });
  return n;
};

let live: ThreeRenderer[] = [];
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  for (const r of live) r.dispose();
  live = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function booted(quality: RenderQuality, opts?: { grassKit?: boolean }): Promise<Booted> {
  const b = await boot(quality, opts);
  live.push(b.r);
  return b;
}

describe('GH-1167 S5: the 3D grass field on a node boot', () => {
  it('builds one rl-grass-field root of at most 108 instanced meshes, none casting a shadow, holding every placed clump', async () => {
    const { priv, sim } = await booted(QUALITY_PRESETS.high);
    const field = priv.grassField;
    expect(field).not.toBeNull();
    if (field === null) return;
    expect(field.root.parent).toBe(priv.scene);
    expect(priv.scene.children.filter((o) => o.name === 'rl-grass-field')).toHaveLength(1);
    const meshes = field.root.children as THREE.InstancedMesh[];
    expect(meshes.length).toBeGreaterThan(80);
    expect(meshes.length).toBeLessThanOrEqual(108);
    let casters = 0;
    let clumps = 0;
    field.root.traverse((o) => {
      if (o.castShadow) casters++;
    });
    for (const m of meshes) {
      expect(m).toBeInstanceOf(THREE.InstancedMesh);
      expect(m.name.startsWith('rl-grass-field-c')).toBe(true);
      expect(m.renderOrder).toBe(GRASS_RENDER_ORDER);
      expect(m.receiveShadow).toBe(true);
      expect(m.material).toBe(field.material);
      clumps += m.count;
    }
    expect(casters).toBe(0);
    // Every clump the headless plan places for this world (the renderer's draw mask: the shanty is blocked).
    const input = { width: SIZE, height: SIZE, decor: null, elevation: null, blocked: sim.blocked, cover: sim.cover };
    const plan = planGrassField(input, buildTerrainSurface(input), 256);
    expect(clumps).toBe(plan.meshes.reduce((n, m) => n + m.count, 0));
    expect(clumps).toBeGreaterThan(15000);
  });

  it('replaces the sward strokes and the Meshy tufts, and nothing else (low draws them, with no field)', async () => {
    const node = await booted(QUALITY_PRESETS.high);
    const low = await booted(QUALITY_PRESETS.low);
    expect(low.priv.grassField).toBeNull();
    expect(low.priv.scene.children.some((o) => o.name.startsWith('rl-grass-field'))).toBe(false);
    // The tufts: the `grass` placements are gone from the foliage batch; the sand and the rest stay.
    expect(foliageCount(node.priv)).toBeGreaterThan(0);
    expect(foliageCount(low.priv) - foliageCount(node.priv)).toBeGreaterThan(100);
    // The sward strokes: fewer scatter vertices on the field's boot.
    expect(scatterVerts(low.priv) - scatterVerts(node.priv)).toBeGreaterThan(10000);
  });

  it('a backend with no builder (a test double) builds no field and keeps today\'s sward', async () => {
    const { priv } = await booted(QUALITY_PRESETS.high, { grassKit: false });
    expect(priv.grassField).toBeNull();
    const low = await booted(QUALITY_PRESETS.low);
    expect(scatterVerts(priv)).toBe(scatterVerts(low.priv));
    expect(foliageCount(priv)).toBe(foliageCount(low.priv));
  });

  it('follows the zoom with its hysteresis (high), swapping geometry only; medium is x 1.2 coarser', async () => {
    const { r, priv } = await booted(QUALITY_PRESETS.high);
    const field = priv.grassField as GrassFieldHandle;
    const mesh = field.root.children[0] as THREE.InstancedMesh;
    const matrices = mesh.instanceMatrix;
    expect(field.lod()).toBe(1);
    const lodAt = (z: number): number => {
      r.camera.zoom = z;
      r.frame(1, 0);
      return field.lod();
    };
    expect(lodAt(1.52)).toBe(1); // inside the hysteresis above 1.5
    expect(lodAt(1.56)).toBe(0);
    const lod0 = mesh.geometry;
    expect(lodAt(1.47)).toBe(0); // inside the hysteresis below 1.5
    expect(lodAt(1.44)).toBe(1);
    expect(mesh.geometry).not.toBe(lod0);
    expect(lodAt(0.5)).toBe(2);
    expect(lodAt(2.5)).toBe(0); // two bands in one frame
    expect(mesh.instanceMatrix).toBe(matrices);
    const med = await booted(QUALITY_PRESETS.medium);
    const mf = med.priv.grassField as GrassFieldHandle;
    expect(mf).not.toBeNull();
    // Zoom 1: LOD1 on high, LOD2 on medium (its LOD1 band starts at 1.08).
    expect(mf.lod()).toBe(2);
    med.r.camera.zoom = 1.7;
    med.r.frame(1, 0);
    expect(mf.lod()).toBe(1);
  });

  it('the grass-field layer is a flag the frame consults: a repaint does not undo it', async () => {
    const { r, priv } = await booted(QUALITY_PRESETS.high);
    const field = priv.grassField as GrassFieldHandle;
    expect(r.setDebugLayerVisible('grass-field', false)).toBe(1);
    expect(r.setDebugLayerVisible('grass-field', false)).toBe(0);
    r.camera.zoom = 2;
    r.frame(1, 16);
    expect(field.root.visible).toBe(false);
    field.root.visible = true; // a writer that re-shows it between frames
    r.frame(1, 16);
    expect(field.root.visible).toBe(false);
    expect(r.setDebugLayerVisible('grass-field', true)).toBe(1);
    r.frame(1, 16);
    expect(field.root.visible).toBe(true);
  });

  it('a collapse re-places only the cells it touched; every other mesh is the same object', async () => {
    const { r, sim, priv, structure } = await booted(QUALITY_PRESETS.high);
    const field = priv.grassField as GrassFieldHandle;
    const before = new Map((field.root.children as THREE.InstancedMesh[]).map((m) => [m.name, m]));
    const cell0Before = [...before.values()].filter((m) => m.userData.rlGrassCell === 0).reduce((n, m) => n + m.count, 0);
    sim.debugDestroyStructure(structure);
    r.applyStructureDestroyed(structure);
    r.frame(1, 0);
    expect(priv.grassField).toBe(field); // spliced, not rebuilt
    const after = field.root.children as THREE.InstancedMesh[];
    let same = 0;
    let fresh = 0;
    for (const m of after) {
      if (m.userData.rlGrassCell === 0) {
        expect(before.get(m.name)).not.toBe(m);
        fresh++;
      } else {
        expect(before.get(m.name)).toBe(m);
        same++;
      }
    }
    expect(fresh).toBeGreaterThan(0);
    expect(same).toBe(before.size - [...before.values()].filter((m) => m.userData.rlGrassCell === 0).length);
    // The felled shanty leaves rubble (cover), where no clump grows; the cell's own bytes against a full plan are
    // `packages/app/src/grass-field-cells.test.ts`'s claim.
    expect(after.filter((m) => m.userData.rlGrassCell === 0).reduce((n, m) => n + m.count, 0)).toBeGreaterThan(cell0Before / 2);
  });

  it('dispose() releases the field: out of the scene, its material, geometries and meshes disposed', async () => {
    const b = await boot(QUALITY_PRESETS.high);
    const field = b.priv.grassField as GrassFieldHandle;
    const material = vi.spyOn(field.material, 'dispose');
    const mesh = field.root.children[0] as THREE.InstancedMesh;
    const geometry = vi.spyOn(mesh.geometry, 'dispose');
    const meshDispose = vi.spyOn(mesh, 'dispose');
    b.r.dispose();
    expect(field.root.parent).toBeNull();
    expect(material).toHaveBeenCalled();
    expect(geometry).toHaveBeenCalled();
    expect(meshDispose).toHaveBeenCalled();
    expect(b.priv.grassField).toBeNull();
  });
});
