/**
 * GH-943 P2 (T6): the node foliage twin is dated off the SIM clock, read AT THE TWIN (`ThreeRenderer.wind-clock.test.ts` proves it
 * for the legacy record; this proves the twin reads that record and nothing frame-built).
 *
 * A node renderer (the backend mocked, as in `ThreeRenderer.material-seam.test.ts`) with the REAL `foliage` factory: every frame's
 * `render` runs the census and then each twin uniform's render update with a three-shaped frame (`deltaTime` the frame's wall
 * seconds), as three's NodeFrame does. Then:
 *  - `frame(a, 0)`, `frame(a, 16)`, `frame(a, 5000)` and a zero-time repaint at one tick leave every value the twin holds
 *    bit-identical, and a paused loop changes none;
 *  - a tick moves the twin's clock (anti-vacuity), to `presentationSimMs / 1000`;
 *  - the `wind` layer reaches the twin (`uSwayAmp` 0 and back), and reduced motion (`mode` 0).
 *
 * Falsify (by hand, commit message): drive the twin's `uSwayTime` from accumulated frame time (`n.value += frame.deltaTime` in its
 * render update instead of re-reading the record).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import { QUALITY_PRESETS } from '../quality';
import type { RendererOptions, TerrainTones } from '../api';
import type { MaterialKit, RenderBackend } from './backend/backend';
import { nodeFoliageBindings, type FoliageBindings } from './terrain/decor-mesh.node';
import { ThreeRenderer } from './ThreeRenderer';
import { NULL_P3_SLOTS } from './node-material-adoption';

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

/** The frame's wall seconds, set by the spec before each `frame()`: what three's NodeFrame would hand a render update. */
const seam = vi.hoisted(() => ({ kit: null as MaterialKit | null, wallDt: 0 }));

vi.mock('./backend/node-backend', async () => {
  const { censusUnported: census } = await vi.importActual<typeof import('./backend/unported')>('./backend/unported');
  const { nodeFoliageBindings: bindingsOf } = await vi.importActual<typeof import('./terrain/decor-mesh.node')>('./terrain/decor-mesh.node');
  /** Each twin uniform's render update, once per render, as three runs `updateType: RENDER` nodes. */
  const runUpdates = (scene: THREE.Object3D): void => {
    const done = new Set<unknown>();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      const list = m === undefined ? [] : Array.isArray(m) ? m : [m];
      for (const mat of list) {
        const b = bindingsOf(mat);
        if (b === null || done.has(b)) continue;
        done.add(b);
        for (const n of Object.values(b)) (n as unknown as { update(frame: unknown): void }).update({ deltaTime: seam.wallDt / 1000 });
      }
    });
  };
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
          runUpdates(scene);
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
  quality: QUALITY_PRESETS.low,
  environmentLight: false,
  gpu: 'webgl2',
};

interface Private {
  decorGroup: THREE.Group | null;
  decorSet: { parts: Map<string, { role: string; geometry: THREE.BufferGeometry }[]> };
  sway: { time: { value: number }; amp: { value: number } };
  windU: { mode: { value: number } };
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;
const SIZE = 32;

async function boot(): Promise<{ r: ThreeRenderer; sim: Sim; priv: Private }> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const { createFoliageTwinFactory } = await import('./terrain/decor-mesh.node');
  const { MATERIAL_MATHS } = await import('./material-maths');
  seam.kit = { ...NULL_P3_SLOTS, ground: null, ring: null, foliage: createFoliageTwinFactory({ W, TSL, maths: MATERIAL_MATHS.foliage }) };
  const sim = new Sim({ seed: 1, width: SIZE, height: SIZE, capacity: 4 });
  for (let y = 0; y < SIZE; y += 3) for (let x = 0; x < SIZE; x += 3) sim.cover[y * SIZE + x] = 1;
  const r = new ThreeRenderer(sim, OPTS);
  const priv = r as unknown as Private;
  const tri = (): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setIndex([0, 1, 2]);
    return g;
  };
  for (const family of ['grass', 'bush', 'tree', 'desert_tree']) {
    for (let v = 0; v < 3; v++) priv.decorSet.parts.set(`${family}_${v}`, [{ role: 'foliage', geometry: tri() }, { role: 'trunk', geometry: tri() }]);
  }
  await r.init(HOST);
  r.camera.x = SIZE / 2;
  r.camera.y = SIZE / 2;
  frameAt(r, 1, 0);
  return { r, sim, priv };
}

/** One frame with `dtMs` of wall time: the twin's render updates see it as three's `deltaTime`. */
function frameAt(r: ThreeRenderer, alpha: number, dtMs: number): void {
  seam.wallDt = dtMs;
  r.frame(alpha, dtMs);
}

/** The twins on the decor batches, and their bindings. */
function twins(priv: Private): FoliageBindings[] {
  const out: FoliageBindings[] = [];
  for (const b of (priv.decorGroup as THREE.Group).children as THREE.Mesh[]) {
    const bound = nodeFoliageBindings(b.material as THREE.Material);
    if (bound !== null) out.push(bound);
  }
  return out;
}

/** Every value every twin holds, as exact bits (a text of the doubles, so -0 differs too). */
function twinBits(priv: Private): string {
  return JSON.stringify(
    twins(priv).map((b) =>
      Object.entries(b).map(([k, n]) => {
        const v = (n as unknown as { value: unknown }).value;
        if (v instanceof THREE.Vector2) return [k, v.x, v.y];
        return [k, Object.is(v, -0) ? '-0' : v];
      })
    )
  );
}

const tickTo = (r: ThreeRenderer, sim: Sim, t: number): void => {
  while (sim.tickCount < t) {
    sim.tick();
    r.snapshot();
  }
};

beforeEach(() => {
  seam.kit = null;
  seam.wallDt = 0;
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

describe('the node foliage twin reads the sim clock, at the twin', () => {
  it('the decor batches draw the real twins (foliage and trunk), so the values compared below are the twin\'s own', async () => {
    const { r, priv } = await boot();
    const names = ((priv.decorGroup as THREE.Group).children as THREE.Mesh[]).map((b) => [b.name, (b.material as THREE.Material).name]).sort();
    expect(names).toEqual([
      ['decor-foliage', 'rl-node-material-foliage-sway'],
      ['decor-trunk', 'rl-node-material-trunk-sway'],
    ]);
    expect(twins(priv).length).toBe(2);
    // The twin brings its world-space lean back through `modelWorldMatrixInverse`; on every shipped decor batch that is the
    // identity (the batches sit in a frozen `decor` group at the origin), so the node lean IS the legacy one.
    for (const b of (priv.decorGroup as THREE.Group).children) {
      b.updateWorldMatrix(true, false);
      expect(b.matrixWorld.equals(new THREE.Matrix4()), b.name).toBe(true);
    }
    r.dispose();
  });

  it('frame(a,0), frame(a,16), frame(a,5000) and a zero-time repaint at one tick leave every twin value bit-identical', async () => {
    const { r, sim, priv } = await boot();
    tickTo(r, sim, 137);
    frameAt(r, 0.4, 0);
    const base = twinBits(priv);
    frameAt(r, 0.4, 16);
    expect(twinBits(priv)).toBe(base);
    frameAt(r, 0.4, 5000);
    expect(twinBits(priv)).toBe(base);
    frameAt(r, 0.4, 0);
    expect(twinBits(priv)).toBe(base);
    r.dispose();
  });

  it('a paused loop (ten frames, no tick, wall time passing) changes none', async () => {
    const { r, sim, priv } = await boot();
    tickTo(r, sim, 60);
    frameAt(r, 0, 0);
    const base = twinBits(priv);
    for (let i = 0; i < 10; i++) frameAt(r, 0, 16 + i * 1000);
    expect(twinBits(priv)).toBe(base);
    r.dispose();
  });

  it('a tick moves the twin\'s clock to presentationSimMs / 1000 (anti-vacuity: the census is not comparing constants)', async () => {
    const { r, sim, priv } = await boot();
    tickTo(r, sim, 100);
    frameAt(r, 0, 0);
    const before = twinBits(priv);
    tickTo(r, sim, 101);
    frameAt(r, 0, 16);
    expect(twinBits(priv)).not.toBe(before);
    for (const b of twins(priv)) expect((b.uSwayTime as unknown as { value: number }).value).toBeCloseTo(100 * 0.05, 9);
    r.dispose();
  });

  it('the wind layer and reduced motion reach the twin through the record', async () => {
    const { r, priv } = await boot();
    expect(r.setDebugLayerVisible('wind', false)).toBe(1);
    frameAt(r, 1, 0);
    for (const b of twins(priv)) expect((b.uSwayAmp as unknown as { value: number }).value).toBe(0);
    expect(r.setDebugLayerVisible('wind', true)).toBe(1);
    frameAt(r, 1, 0);
    for (const b of twins(priv)) expect((b.uSwayAmp as unknown as { value: number }).value).toBe(1);
    // The mode is the record's, whatever frame() wrote into it.
    for (const b of twins(priv)) expect((b.uWindMode as unknown as { value: number }).value).toBe(priv.windU.mode.value);
    r.dispose();
  });
});
