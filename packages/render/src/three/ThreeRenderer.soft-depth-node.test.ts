/**
 * @vitest-environment jsdom
 *
 * GH-1227 slice 3: `ThreeRenderer.init`'s node-boot wiring of the soft-particle depth copy (`soft-depth.ts`'s `NodeSoftDepthCopy`).
 * The node backend is mocked (as `ThreeRenderer.decal-twin.test.ts`), with the REAL predicate (`nodeSoftDepthOn`) behind its
 * `softDepthOn` and the REAL FX twin factories, so a boot adopts the flipbook through the shipped path. Gates (each has a one-line
 * mutation, run red once and listed in the commit message):
 *  - W1: off (every preset; the flag without the device feature), the boot adds NOTHING: no sentinel, the flipbook smoke twin is
 *    the shipped one (no `uSoftDepth`);
 *  - W2: on, the sentinel is in the scene, the copy reads the node chain's scene pass target, and the smoke twin built at boot taps
 *    the copy's texture (so the copy must exist BEFORE adoption);
 *  - W3: the LIVE per-frame path (`frame` -> `updateFx` -> `sync`, the one the Metal read of 11 Nov caught copying 120/120 idle
 *    frames): with no smoke on screen the sentinel is hidden, so three never calls its `onBeforeRender` and no copy is taken. The
 *    band-2 dust instancer is in the scene, visible, at `count` 0 (as `ParticleInstancer` keeps it), and on the node path it is not
 *    a consumer at all (no node twin samples the copy for it), so live dust without smoke takes no copy either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import type { RendererOptions, TerrainTones } from '../api';
import type { MaterialKit, RenderBackend } from './backend/backend';
import type { PostQuality } from './post-chain-shared';
import { ThreeRenderer } from './ThreeRenderer';
import { NodeSoftDepthCopy, SoftDepthSnapshot } from './soft-depth';
import { VFX_TEXTURES_KEY, type LateTexture } from './units/flipbook-fx.node';
import type { FlipbookFx } from './units/flipbook-fx';
import { isTwin } from './twin-identity';

(globalThis as { ImageBitmap?: unknown }).ImageBitmap ??= class ImageBitmapStub {};

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

const seam = vi.hoisted(() => ({
  kit: null as MaterialKit | null,
  copyable: false,
  sceneTarget: null as unknown,
}));

vi.mock('./backend/node-backend', async () => {
  const { nodeSoftDepthOn } = await vi.importActual<typeof import('./post-chain.node')>('./post-chain.node');
  return {
    createNodeBackend: async (): Promise<{ backend: RenderBackend }> => {
      const kit = seam.kit;
      if (kit === null) throw new Error('spec: no kit');
      const backend = {
        kind: 'node-webgpu',
        adapter: 'spec',
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
        // The real backend's predicate, over the spec's device.
        softDepthOn: (q: PostQuality) => nodeSoftDepthOn(q, seam.copyable),
        get post() {
          return { passNames: [], render(): void {}, dispose(): void {}, vignette: { enabled: false }, grade: { apply(): void {}, enabled: false }, scenePass: { renderTarget: seam.sceneTarget } };
        },
        async prepare(): Promise<void> {},
        render(): void {},
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
  flipbook: FlipbookFx;
  softDepth: unknown;
  particleInstancerBelow: { mesh: THREE.InstancedMesh };
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;

function depthTarget(type: THREE.TextureDataType): THREE.RenderTarget {
  const d = new THREE.DepthTexture(8, 8, type);
  d.format = THREE.DepthStencilFormat;
  return new THREE.RenderTarget(8, 8, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, depthTexture: d });
}

async function boot(quality: RenderQuality, copyable: boolean): Promise<{ r: ThreeRenderer; priv: Private }> {
  const { fxKit } = await import('./units/fx-twin-test-kit');
  seam.kit = await fxKit();
  seam.copyable = copyable;
  seam.sceneTarget = depthTarget(THREE.FloatType);
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const r = new ThreeRenderer(sim, { ...OPTS, quality, gpu: 'webgl2' });
  await r.init(HOST);
  r.snapshot();
  r.frame(1, 0);
  return { r, priv: r as unknown as Private };
}

const sentinels = (scene: THREE.Scene): THREE.Object3D[] => {
  const found: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.name === 'soft-depth-sentinel') found.push(o);
  });
  return found;
};
const smokeTextures = (fx: FlipbookFx): Record<string, LateTexture> =>
  ((fx.mesh.material as THREE.Material).userData[VFX_TEXTURES_KEY] ?? {}) as Record<string, LateTexture>;

beforeEach(() => {
  seam.kit = null;
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

describe('W1: off, a node boot adds nothing', () => {
  const cases: Array<[string, RenderQuality, boolean]> = [
    ['high, copyable device', QUALITY_PRESETS.high, true],
    ['medium, copyable device', QUALITY_PRESETS.medium, true],
    ['low, copyable device', QUALITY_PRESETS.low, true],
    ['flag on, no feature', { ...QUALITY_PRESETS.high, softParticles: true }, false],
  ];
  for (const [label, quality, copyable] of cases) {
    it(`${label}: no sentinel, no copy, the shipped smoke twin`, async () => {
      const { r, priv } = await boot(quality, copyable);
      expect(r.backendInfo().kind).toBe('node-webgpu');
      expect(priv.softDepth).toBeNull();
      expect(sentinels(priv.scene)).toEqual([]);
      expect(priv.flipbook.softDepthOn).toBe(false);
      expect(isTwin(priv.flipbook.mesh.material as THREE.Material)).toBe(true);
      expect(Object.keys(smokeTextures(priv.flipbook))).not.toContain('uSoftDepth');
      r.dispose();
    });
  }
});

describe('W2: on, a node boot builds the copy before adoption', () => {
  it('the sentinel is in the scene, the copy reads the chain scene target, and the boot-built smoke twin taps its texture', async () => {
    const { r, priv } = await boot({ ...QUALITY_PRESETS.high, softParticles: true }, true);
    const copy = priv.softDepth;
    expect(copy).toBeInstanceOf(NodeSoftDepthCopy);
    expect(copy).not.toBeInstanceOf(SoftDepthSnapshot);
    const c = copy as NodeSoftDepthCopy;
    expect(sentinels(priv.scene)).toEqual([c.sentinel]);
    expect(isTwin(priv.flipbook.mesh.material as THREE.Material)).toBe(true);
    expect(smokeTextures(priv.flipbook).uSoftDepth?.taps[0]?.value).toBe(c.depthTexture);
    // The copy's source is the node chain's own scene pass target, read through the backend.
    const copied: THREE.Texture[] = [];
    const ok = c.capture({ getRenderTarget: () => seam.sceneTarget as THREE.RenderTarget, copyFramebufferToTexture: (t) => copied.push(t) });
    expect(ok).toBe(true);
    expect(copied).toEqual([c.depthTexture]);
    r.dispose();
    expect(sentinels(priv.scene)).toEqual([]);
  });
});

describe('W3: the live frame path, an idle frame takes no copy', () => {
  it('no smoke: the sentinel is hidden after every frame, though the dust instancer mesh is visible at count 0', async () => {
    const { r, priv } = await boot({ ...QUALITY_PRESETS.high, softParticles: true }, true);
    const c = priv.softDepth as NodeSoftDepthCopy;
    const dust = priv.particleInstancerBelow.mesh;
    for (let i = 0; i < 4; i++) {
      r.frame(1 + i * 16, 0);
      expect(priv.flipbook.mesh.visible, `frame ${i}: no smoke`).toBe(false);
      expect(dust.visible && dust.count === 0, `frame ${i}: the idle dust tier`).toBe(true);
      expect(c.sentinel.visible, `frame ${i}`).toBe(false);
    }
    r.dispose();
  });

  it('smoke on screen: the sentinel draws (the copy is still taken when a consumer is)', async () => {
    const { r, priv } = await boot({ ...QUALITY_PRESETS.high, softParticles: true }, true);
    const c = priv.softDepth as NodeSoftDepthCopy;
    const step = priv.flipbook.step.bind(priv.flipbook);
    priv.flipbook.step = (dt: number): void => {
      step(dt);
      priv.flipbook.mesh.visible = true;
    };
    r.frame(17, 0);
    expect(c.sentinel.visible).toBe(true);
    r.dispose();
  });

  it('dust live, no smoke: no copy on the node path (the dust tier is not a node consumer)', async () => {
    const { r, priv } = await boot({ ...QUALITY_PRESETS.high, softParticles: true }, true);
    const c = priv.softDepth as NodeSoftDepthCopy;
    const step = priv.flipbook.step.bind(priv.flipbook);
    priv.flipbook.step = (dt: number): void => {
      step(dt);
      priv.particleInstancerBelow.mesh.count = 3;
    };
    r.frame(17, 0);
    expect(priv.flipbook.mesh.visible).toBe(false);
    expect(c.sentinel.visible).toBe(false);
    r.dispose();
  });
});
