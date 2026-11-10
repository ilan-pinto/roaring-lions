/**
 * GH-943 P3 (T7): the decal twin on a NODE boot, and the legacy-matched arm beside it.
 *
 * A node renderer (the backend mocked, as in `ThreeRenderer.disturb-twin-clock.test.ts`, whose census is the node backend's own:
 * `censusUnported` with NO ported keys, every frame) with the REAL `decal` factory. Gates:
 *  - G5 (ruling R9): with the twin live, hiding and showing the `decals` layer on node leaves the census empty of `rl-decal`, and
 *    both pools are drawn by the ONE twin, visible again. On the legacy-matched arm (`portedKeys`), the pools stay visible and
 *    unreported through the same toggle.
 *    Falsify: drop `rl-decal` from `PORTED_MATERIAL_KEYS` (L-matched hides the pools: its legacy delta would read 0).
 *  - The light record is the scene's own lights: the one sun, the one hemisphere, no ambient light, the objects themselves.
 *    Falsify: drop the `setDecalLights` call in the constructor (the record is missing and the node factory refuses).
 *  - The twin reads the SIM clock the renderer writes into the legacy record (`uNowSec`), never a frame time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import { QUALITY_PRESETS } from '../quality';
import type { RendererOptions, TerrainTones } from '../api';
import type { MaterialKit, RenderBackend } from './backend/backend';
import { censusUnported, PORTED_MATERIAL_KEYS, type UnportedHook } from './backend/unported';
import { ThreeRenderer } from './ThreeRenderer';
import { NULL_P3_SLOTS } from './node-material-adoption';
import { isTwin, legacyOf } from './twin-identity';
import { DECAL_LIGHTS_KEY, type DecalLights, type DecalPool } from './decal-pool';
import { presentationSimMs } from './decal-maths';

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

vi.mock('./post-chain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./post-chain')>();
  return {
    ...actual,
    createPostChain: () => ({
      setFogPass(): void {},
      setAoPass(): void {},
      setBloomPass(): void {},
      setSize(): void {},
      render(): void {},
      dispose(): void {},
      vignette: { enabled: false },
      grade: { apply(): void {}, enabled: false },
    }),
  };
});

const seam = vi.hoisted(() => ({ kit: null as MaterialKit | null, census: [] as UnportedHook[] }));

vi.mock('./backend/node-backend', async () => {
  const { censusUnported: census } = await vi.importActual<typeof import('./backend/unported')>('./backend/unported');
  return {
    createNodeBackend: async (): Promise<{ backend: RenderBackend }> => {
      const kit = seam.kit;
      if (kit === null) throw new Error('spec: no kit');
      // The node backend's own census: no ported keys, so a legacy material still on a mesh is hidden and named.
      const run = (scene: THREE.Scene): void => {
        seam.census = census(scene);
      };
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
          run(scene);
        },
        render(scene: THREE.Scene): void {
          run(scene);
        },
        photographGround: async () => null,
        captureView: async () => null,
        whenSubmitted: async () => {},
        unported: () => seam.census,
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
};

interface Private {
  scene: THREE.Scene;
  decalMaterial: THREE.ShaderMaterial;
  decalsPersistent: DecalPool;
  decalsFading: DecalPool;
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;

async function boot(gpu: 'webgl2' | 'legacy'): Promise<{ r: ThreeRenderer; sim: Sim; priv: Private }> {
  const WG = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const { createNodeDecalMaterial } = await import('./decal-pool.node');
  const { MATERIAL_MATHS } = await import('./material-maths');
  seam.kit = {
    ...NULL_P3_SLOTS,
    ground: null,
    foliage: null,
    ring: null,
    decal: (legacy) => createNodeDecalMaterial({ W: WG, TSL, maths: MATERIAL_MATHS.decal }, legacy),
  };
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const r = new ThreeRenderer(sim, { ...OPTS, gpu });
  const priv = r as unknown as Private;
  if (gpu === 'webgl2') {
    await r.init(HOST);
    r.snapshot();
    r.frame(1, 0);
  }
  return { r, sim, priv };
}

const pools = (p: Private): THREE.Mesh[] => [p.decalsPersistent.mesh, p.decalsFading.mesh];
const decalEntries = (hooks: readonly UnportedHook[]): UnportedHook[] => hooks.filter((h) => h.key.startsWith('rl-decal'));

beforeEach(() => {
  seam.kit = null;
  seam.census = [];
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('G5: the decals toggle never re-shows a hidden object (R9)', () => {
  it('on node, both pools draw the ONE twin, and hiding then showing decals leaves the census empty of rl-decal', async () => {
    const { r, priv } = await boot('webgl2');
    const [a, b] = pools(priv);
    const check = (visible: boolean): void => {
      expect(decalEntries(seam.census), 'the node census names no decal material').toEqual([]);
      for (const m of [a, b] as THREE.Mesh[]) {
        expect(isTwin(m.material as THREE.Material), 'drawn by the twin').toBe(true);
        expect(m.visible).toBe(visible);
      }
      expect((a as THREE.Mesh).material).toBe((b as THREE.Mesh).material);
      expect(legacyOf((a as THREE.Mesh).material as THREE.Material)).toBe(priv.decalMaterial);
    };
    check(true);
    expect(r.setDebugLayerVisible('decals', false)).toBe(2);
    r.frame(1, 0);
    check(false);
    expect(r.setDebugLayerVisible('decals', true)).toBe(2);
    r.frame(1, 0);
    check(true);
    r.dispose();
  });

  it('on the legacy-matched arm, the pools stay visible and unreported through the same toggle', async () => {
    const { r, priv } = await boot('legacy');
    const matched = (): UnportedHook[] => decalEntries(censusUnported(priv.scene, { portedKeys: PORTED_MATERIAL_KEYS }));
    expect(matched()).toEqual([]);
    expect(pools(priv).map((m) => m.visible)).toEqual([true, true]);
    expect(r.setDebugLayerVisible('decals', false)).toBe(2);
    expect(r.setDebugLayerVisible('decals', true)).toBe(2);
    // Falsify: drop rl-decal from PORTED_MATERIAL_KEYS (the matched census hides both pools and names them).
    expect(matched()).toEqual([]);
    expect(pools(priv).map((m) => m.visible)).toEqual([true, true]);
    r.dispose();
  });
});

describe('the decal material carries the scene\'s own lights', () => {
  it('the record is the one sun, the one hemisphere and no ambient light: the objects in the scene', async () => {
    const { r, priv } = await boot('legacy');
    const rec = priv.decalMaterial.userData[DECAL_LIGHTS_KEY] as DecalLights | undefined;
    expect(rec, 'the constructor records the lights').toBeDefined();
    const found = { dir: [] as THREE.DirectionalLight[], hemi: [] as THREE.HemisphereLight[], ambient: [] as THREE.AmbientLight[] };
    priv.scene.traverse((o) => {
      if ((o as THREE.DirectionalLight).isDirectionalLight) found.dir.push(o as THREE.DirectionalLight);
      if ((o as THREE.HemisphereLight).isHemisphereLight) found.hemi.push(o as THREE.HemisphereLight);
      if ((o as THREE.AmbientLight).isAmbientLight) found.ambient.push(o as THREE.AmbientLight);
    });
    expect(found.dir).toEqual([rec?.sun]);
    expect(found.hemi).toEqual([rec?.hemisphere]);
    expect(found.ambient).toEqual([...(rec?.ambient ?? [])]);
    expect(rec?.sun?.castShadow).toBe(true);
    r.dispose();
  });

  it('on node, the twin reads the sim clock the renderer writes into the legacy record', async () => {
    const { r, sim, priv } = await boot('webgl2');
    for (let i = 0; i < 7; i++) sim.tick();
    r.snapshot();
    r.frame(0.25, 5000);
    expect(priv.decalMaterial.uniforms.uNowSec.value).toBeCloseTo(presentationSimMs(sim.tickCount, 0.25) / 1000, 12);
    r.dispose();
  });
});
