/**
 * GH-1226 follow-up (S5 + S6 together): in SHIPPED boot order the decal pools' node twin is sealed by init's `adoptNodeMaterials(scene)`,
 * so the height-blend record must already be on `decalMaterial` by then. A node renderer (backend mocked as in
 * `ThreeRenderer.ground-blend.test.ts`) with the REAL decal and ground factories, checked right after `init()` and before any frame:
 *  - the decal factory saw the record, and it is the ground's record (one object);
 *  - the ADOPTED pool material is the twin, built with the record bound: a `heightField` tap on the record's field and the record's tone
 *    uniforms bound by reference. A twin built before the install has `heightField` null and no tone uniforms, and the install then throws.
 *
 * Falsified by (commit message): `installGroundBlend()` moved after `adoptNodeMaterials(this.scene)` in init; that init call deleted
 * (only `rebuildTerrain` installs); the `installHeightBlend(this.decalMaterial, record)` line dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import { QUALITY_PRESETS } from '../quality';
import type { RendererOptions, TerrainTones } from '../api';
import type { MaterialKit, RenderBackend } from './backend/backend';
import { ThreeRenderer } from './ThreeRenderer';
import { NULL_P3_SLOTS } from './node-material-adoption';
import { createNodeGroundMaterial } from './terrain/mesh.node';
import { buildNodeDecal, type NodeDecal } from './decal-pool.node';
import { MATERIAL_MATHS } from './material-maths';
import { heightBlendOf, HEIGHT_BLEND_BUILT_KEY, type HeightBlendRecord } from './terrain/height-blend-record';
import { isTwin, legacyOf } from './twin-identity';
import type { DecalPool } from './decal-pool';

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

const seam = vi.hoisted(() => ({ kit: null as MaterialKit | null }));

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

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
  heightBlend: { rock: '#FF8000', joint: '#0080FF', hollow: '#80FF00', aR: 0.75, aJ: 0.6, aH: 0.45, kH: 0.4 },
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
  groundMat: THREE.Material;
  decalMaterial: THREE.Material & { userData: Record<string, unknown> };
  decalsPersistent: DecalPool;
  decalsFading: DecalPool;
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;

let live: ThreeRenderer[] = [];

async function boot(): Promise<{ priv: Private; seen: { record: HeightBlendRecord | undefined; built: NodeDecal[] } }> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const seen = { record: undefined as HeightBlendRecord | undefined, built: [] as NodeDecal[] };
  seam.kit = {
    ...NULL_P3_SLOTS,
    ground: (legacy) => createNodeGroundMaterial({ W, TSL, maths: MATERIAL_MATHS.ground }, legacy),
    decal: (legacy) => {
      seen.record = heightBlendOf(legacy);
      const n = buildNodeDecal({ W, TSL, maths: MATERIAL_MATHS.decal }, legacy);
      seen.built.push(n);
      return n.material;
    },
    foliage: null,
    ring: null,
  };
  const sim = new Sim({ seed: 1, width: 48, height: 48, capacity: 4 });
  const r = new ThreeRenderer(sim, OPTS);
  live.push(r);
  await r.init(HOST);
  // Deliberately NO frame: the first frame's `rebuildTerrain` installs the record too, which would hide a late init install.
  return { priv: r as unknown as Private, seen };
}

beforeEach(() => {
  seam.kit = null;
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

describe('GH-1226: the decal twin is sealed with the ground\'s record already installed (shipped boot order)', () => {
  it('the decal factory sees the ground\'s own record at the moment init seals the twin', async () => {
    const { priv, seen } = await boot();
    const record = heightBlendOf(priv.groundMat);
    expect(record, 'init installed a record on the ground').toBeDefined();
    expect(seen.built, 'one twin for the one decal material').toHaveLength(1);
    expect(seen.record, 'the twin was built before the record was installed').toBe(record);
    expect(heightBlendOf(priv.decalMaterial)).toBe(record);
    expect(priv.decalMaterial.userData[HEIGHT_BLEND_BUILT_KEY], 'sealed').toBe(true);
  });

  it('both adopted pools draw that twin, and it bound the record: a field tap and the record\'s tones by reference', async () => {
    const { priv, seen } = await boot();
    const record = heightBlendOf(priv.groundMat) as HeightBlendRecord;
    const twin = seen.built[0] as NodeDecal;
    for (const pool of [priv.decalsPersistent, priv.decalsFading]) {
      const m = pool.mesh.material as THREE.Material;
      expect(isTwin(m), 'drawn by the twin').toBe(true);
      expect(m).toBe(twin.material);
      expect(legacyOf(m)).toBe(priv.decalMaterial);
    }
    expect(twin.heightField, 'a height-field tap exists in the compiled twin').not.toBeNull();
    expect((twin.heightField as unknown as { value: unknown }).value, 'it samples the record\'s field').toBe(record.field);
    expect(twin.numbers.uHeightBlendRockTone?.value, 'bound, not copied').toBe(record.rockTone);
    expect(twin.numbers.uHeightBlendHollowTone?.value).toBe(record.hollowTone);
  });
});
