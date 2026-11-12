/**
 * GH-943 P3 (T13, GH-1152) G4, the renderer half: `RendererOptions.timestamps` is read ONLY on a node boot, where it is handed to
 * `createNodeBackend` (false unless it is exactly true). A legacy boot never reads it: the option is a getter that counts its reads.
 *
 * Falsification (run by hand, in the commit message): read the option on every boot (`void this.opts.timestamps;` as the first line of
 * `init`): the legacy spec goes red.
 *
 * Harness: `ThreeRenderer.material-seam.test.ts`'s faked `WebGLRenderer`, stubbed legacy post chain and a mocked node backend that
 * records the options it was built with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import { QUALITY_PRESETS } from '../quality';
import type { RendererOptions, TerrainTones } from '../api';
import type { RenderBackend } from './backend/backend';
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

const seen = vi.hoisted(() => ({ options: [] as { timestamps?: boolean; nodeDraw?: unknown }[] }));

vi.mock('./backend/node-backend', async () => ({
  createNodeBackend: async (o: { timestamps?: boolean; nodeDraw?: unknown }): Promise<{ backend: RenderBackend }> => {
    seen.options.push(o);
    const backend = {
      kind: 'node-webgl2',
      adapter: 'webgl2',
      domElement: {} as HTMLCanvasElement,
      setPixelRatio(): void {},
      getPixelRatio: () => 1,
      setSize(): void {},
      kit: { fog: null, ao: null, bloom: null },
      materials: { ...NULL_P3_SLOTS, ground: null, foliage: null, ring: null },
      setFog(): void {},
      setOutputMaths(): void {},
      bloom: { setEnabled: () => false, setFade(): void {}, strength: 0, built: false, readPreBloom: async () => null },
      pmrem: {},
      ao: null,
      configure(): void {},
      post: null,
      async prepare(): Promise<void> {},
      render(): void {},
      photographGround: async () => null,
      captureView: async () => null,
      whenSubmitted: async () => {},
      unported: () => [],
      stats: () => ({ calls: 0, triangles: 0, perPass: {}, censusMs: 0 }),
      gpuTimeMs: async () => null,
      dispose(): void {},
    };
    return { backend: backend as unknown as RenderBackend };
  },
}));

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

/** Options whose `timestamps` is a getter counting its reads (`value` is what it returns). */
function countingOpts(gpu: RendererOptions['gpu'], value: boolean | undefined): { opts: RendererOptions; reads: () => number } {
  let reads = 0;
  const opts = {
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
    ...(gpu !== undefined ? { gpu } : {}),
  } as RendererOptions;
  Object.defineProperty(opts, 'timestamps', {
    enumerable: true,
    get: () => {
      reads++;
      return value;
    },
  });
  return { opts, reads: () => reads };
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;

function boot(gpu: RendererOptions['gpu'], value: boolean | undefined): { r: ThreeRenderer; reads: () => number } {
  const sim = new Sim({ seed: 1, width: 48, height: 48, capacity: 4 });
  const { opts, reads } = countingOpts(gpu, value);
  return { r: new ThreeRenderer(sim, opts), reads };
}

beforeEach(() => {
  seen.options.length = 0;
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

describe('RendererOptions.timestamps (G4, the renderer half)', () => {
  it('a legacy boot never reads it', async () => {
    const { r, reads } = boot(undefined, true);
    await r.init(HOST);
    r.frame(1, 0);
    expect(r.backendInfo().kind).toBe('legacy-gl');
    expect(seen.options).toHaveLength(0);
    expect(reads()).toBe(0);
    r.dispose();
  });

  it('a node boot hands it to the backend: true when true', async () => {
    const { r, reads } = boot('webgl2', true);
    await r.init(HOST);
    expect(r.backendInfo().kind).toBe('node-webgl2');
    expect(seen.options.map((o) => o.timestamps)).toEqual([true]);
    expect(reads()).toBeGreaterThan(0);
    r.dispose();
  });

  it('a node boot hands it to the backend: false when absent', async () => {
    const { r } = boot('webgl2', undefined);
    await r.init(HOST);
    expect(seen.options.map((o) => o.timestamps)).toEqual([false]);
    r.dispose();
  });
});

/**
 * GH-943 P3 (T14b, GH-1152) G3: `RendererOptions.nodeDraw` (the F2 / F8 / 1205 switches) is read ONLY on a node boot, like
 * `timestamps`. Falsification (run by hand, in the commit message): `void this.opts.nodeDraw;` as the first line of
 * `ThreeRenderer.init`: the legacy spec goes red.
 */
function countingDraw(gpu: RendererOptions['gpu']): { opts: RendererOptions; reads: () => number } {
  const { opts } = countingOpts(gpu, undefined);
  let reads = 0;
  const value = { refreshPolicy: 'three', matrixWalk: 'every-pass' } as const;
  Object.defineProperty(opts, 'nodeDraw', {
    enumerable: true,
    get: () => {
      reads++;
      return value;
    },
  });
  return { opts, reads: () => reads };
}

describe('RendererOptions.nodeDraw (G3, T14b)', () => {
  it('a legacy boot never reads it', async () => {
    const { opts, reads } = countingDraw(undefined);
    const r = new ThreeRenderer(new Sim({ seed: 1, width: 48, height: 48, capacity: 4 }), opts);
    await r.init(HOST);
    r.frame(1, 0);
    expect(r.backendInfo().kind).toBe('legacy-gl');
    expect(reads()).toBe(0);
    r.dispose();
  });

  it('a node boot hands it to the backend as given; absent, the backend gets none (its defaults apply)', async () => {
    const { opts, reads } = countingDraw('webgl2');
    const r = new ThreeRenderer(new Sim({ seed: 1, width: 48, height: 48, capacity: 4 }), opts);
    await r.init(HOST);
    expect(seen.options.map((o) => o.nodeDraw)).toEqual([{ refreshPolicy: 'three', matrixWalk: 'every-pass' }]);
    expect(reads()).toBeGreaterThan(0);
    r.dispose();
    seen.options.length = 0;
    const plain = boot('webgl2', undefined);
    await plain.r.init(HOST);
    expect(seen.options.map((o) => o.nodeDraw)).toEqual([undefined]);
    plain.r.dispose();
  });
});

/**
 * GH-1152 (12 Nov): `nodeDraw.batchUploads` reaches the four fixed-capacity batches on a node boot only. Falsification (run by hand, in
 * the commit message): delete the `setUploads` loop in `ThreeRenderer.init`: the node spec goes red ('capacity').
 */
describe('RendererOptions.nodeDraw.batchUploads (GH-1152)', () => {
  type Batches = Record<'overlayBatch' | 'tracerBatch' | 'shellBatch' | 'boltBatch', { uploadsMode: string }>;
  const modes = (r: ThreeRenderer): string[] => {
    const b = r as unknown as Batches;
    return [b.overlayBatch.uploadsMode, b.tracerBatch.uploadsMode, b.shellBatch.uploadsMode, b.boltBatch.uploadsMode];
  };
  it('a legacy boot keeps capacity uploads', async () => {
    const { r } = boot(undefined, undefined);
    await r.init(HOST);
    expect(r.backendInfo().kind).toBe('legacy-gl');
    expect(modes(r)).toEqual(['capacity', 'capacity', 'capacity', 'capacity']);
    r.dispose();
  });
  it('a node boot uploads what was drawn by default, and capacity when asked', async () => {
    const { r } = boot('webgl2', undefined);
    await r.init(HOST);
    expect(r.backendInfo().kind).toBe('node-webgl2');
    expect(modes(r)).toEqual(['drawn', 'drawn', 'drawn', 'drawn']);
    r.dispose();
    const { opts } = countingOpts('webgl2', undefined);
    const off = new ThreeRenderer(new Sim({ seed: 1, width: 48, height: 48, capacity: 4 }), { ...opts, nodeDraw: { batchUploads: 'capacity' } });
    await off.init(HOST);
    expect(modes(off)).toEqual(['capacity', 'capacity', 'capacity', 'capacity']);
    off.dispose();
  });
});

// Keeps the THREE import live for the faked module (the mock factory reads `three`'s real exports).
void THREE;
