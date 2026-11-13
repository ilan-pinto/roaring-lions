/**
 * GH-1226 S5: the renderer's node branch for the height and slope ground blend (design 2026-11-12, sections 3.3, 3.4 and 3.5). A NODE
 * renderer (the backend mocked, as in `ThreeRenderer.grass-field.test.ts`) whose ground kit is the REAL twin builder
 * (`createNodeGroundMaterial`), so the "built" seal is real. On a 48x48 map with a staircase of relief and a shanty on it:
 *  - the record is installed BEFORE the ground twin is built (the factory sees it), holds the tones as LINEAR literals, and a record
 *    installed afterwards throws;
 *  - the lazy bake swaps the baked field into the record (the bytes of `bakeHeightBlendField` on the renderer's own surface);
 *  - arid (no joint tone) installs `options.joints: false` and no joint uniforms; `low` compiles neither the texture edge nor the joints;
 *  - a tone set with no `heightBlend` (Rujm Sawda's `ground_blend: false`, a legacy-looking theme) installs nothing and loads nothing;
 *  - a collapse splices: the SAME texture, its version bumped, the bytes of a full bake of the new surface, and no whole bake;
 *  - `dispose()` releases the baked texture.
 *
 * Falsified by (run red, then put back; in the commit message): `installGroundBlend` called after the ground's adoption; the record
 * built with `joints: true` for arid; `bakeGroundBlend` baking whole on a collapse; `dispose` not releasing the texture; the install not
 * gated on the node backend (L3 and the legacy spec go red too).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import { QUALITY_PRESETS } from '../quality';
import type { HeightBlendTones, RendererOptions, TerrainTones } from '../api';
import type { MaterialKit, RenderBackend } from './backend/backend';
import { ThreeRenderer } from './ThreeRenderer';
import { NULL_P3_SLOTS } from './node-material-adoption';
import { createNodeGroundMaterial } from './terrain/mesh.node';
import { MATERIAL_MATHS } from './material-maths';
import { HEIGHT_BLEND_FIELD_MARKER } from './terrain/height-blend-field';
import { heightBlendOf, installHeightBlend, type HeightBlendRecord } from './terrain/height-blend-record';
import type { TerrainSurface } from './terrain/surface';

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

/** What the field module was asked for, across the file (reset per boot). The wrappers call through to the real functions. */
const seam = vi.hoisted(() => ({
  kit: null as MaterialKit | null,
  bakes: 0,
  splices: 0,
  /** Failures to inject: the texture module's load (the chunk fetch), and the bake itself (a throw inside the success callback). */
  failLoads: 0,
  throwBakes: 0,
}));

vi.mock('./terrain/height-blend-texture', async (importOriginal) => {
  if (seam.failLoads > 0) {
    seam.failLoads--;
    throw new Error('spec: the chunk failed to load');
  }
  return importOriginal();
});

vi.mock('./terrain/height-blend-field', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./terrain/height-blend-field')>();
  return {
    ...actual,
    bakeHeightBlendField: (...a: Parameters<typeof actual.bakeHeightBlendField>) => {
      if (seam.throwBakes > 0) {
        seam.throwBakes--;
        throw new Error('spec: the bake threw');
      }
      seam.bakes++;
      return actual.bakeHeightBlendField(...a);
    },
    spliceHeightBlendField: (...a: Parameters<typeof actual.spliceHeightBlendField>) => {
      seam.splices++;
      return actual.spliceHeightBlendField(...a);
    },
  };
});

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

/** Literal oracles: sRGB 0xFF -> 1, 0x80 -> 0.21586050011389926, 0x00 -> 0 (the EOTF, written out, not `hexToLinear` of the same string). */
const MID = 0.21586050011389926;

const TONES_HIGHLAND: HeightBlendTones = { rock: '#FF8000', joint: '#0080FF', hollow: '#80FF00', aR: 0.75, aJ: 0.6, aH: 0.45, kH: 0.4 };
const TONES_ARID: HeightBlendTones = { rock: '#FF8000', hollow: '#80FF00', aR: 0.7, aH: 0.6, kH: 0.5 };

function tones(heightBlend: HeightBlendTones | undefined): TerrainTones {
  return {
    open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
    blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
    rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
    trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
    leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
    crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
    haze: '#E0B87A',
    ...(heightBlend !== undefined ? { heightBlend } : {}),
  };
}

function options(t: TerrainTones, quality = QUALITY_PRESETS.high): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: t,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
    quality,
    environmentLight: false,
    gpu: 'webgl2',
  };
}

interface Private {
  groundMat: THREE.Material & { userData: Record<string, unknown> };
  decalMaterial: THREE.Material & { userData: Record<string, unknown> };
  terrainState: { surface: TerrainSurface };
  groundBlendState: unknown;
}

const HOST = { clientWidth: 320, clientHeight: 240, appendChild(): void {} } as unknown as HTMLElement;
const SIZE = 48;

interface Booted {
  readonly r: ThreeRenderer;
  readonly sim: Sim;
  readonly priv: Private;
  readonly structure: number;
  /** The record the ground twin's FACTORY saw at the moment it was called (undefined: none installed yet). */
  readonly seenByFactory: { record: HeightBlendRecord | undefined; calls: number };
}

const RELIEF = Uint8Array.from({ length: SIZE * SIZE }, (_, i) => Math.min(4, Math.floor((i % SIZE) / 6)));

async function boot(t: TerrainTones, quality = QUALITY_PRESETS.high, relief = true, inject?: () => void): Promise<Booted> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const seenByFactory = { record: undefined as HeightBlendRecord | undefined, calls: 0 };
  seam.kit = {
    ...NULL_P3_SLOTS,
    ground: (legacy) => {
      seenByFactory.calls++;
      seenByFactory.record = heightBlendOf(legacy);
      return createNodeGroundMaterial({ W, TSL, maths: MATERIAL_MATHS.ground }, legacy);
    },
    foliage: null,
    ring: null,
  };
  seam.bakes = 0;
  seam.splices = 0;
  seam.failLoads = 0;
  seam.throwBakes = 0;
  inject?.();
  const sim = new Sim({ seed: 1, width: SIZE, height: SIZE, capacity: 4 });
  // A 2x2 shanty on the staircase below (tiles 15..16), so felling it changes the terrace set inside relief.
  const type = sim.addStructureType({ id: 'shanty', hp_per_tile: 50, height_px: 11, color: 'dust.1' });
  const structure = sim.addStructure(type, [15 * SIZE + 15, 15 * SIZE + 16, 16 * SIZE + 15, 16 * SIZE + 16]);
  const r = new ThreeRenderer(sim, options(t, quality));
  const priv = r as unknown as Private;
  await r.init(HOST);
  // Relief: a staircase rising one level every 6 tiles, so the baked field is not the neutral 1x1 bytes.
  if (relief) r.setElevation(RELIEF);
  r.camera.x = SIZE / 2;
  r.camera.y = SIZE / 2;
  r.camera.zoom = 1;
  r.frame(1, 0);
  // The dynamic import of the field module resolves a tick later and bakes from the latest surface.
  await vi.dynamicImportSettled();
  return { r, sim, priv, structure, seenByFactory };
}

let live: ThreeRenderer[] = [];
async function booted(t: TerrainTones, quality = QUALITY_PRESETS.high, relief = true, inject?: () => void): Promise<Booted> {
  const b = await boot(t, quality, relief, inject);
  live.push(b.r);
  return b;
}

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

describe('GH-1226 S5: the node ground bakes and installs the height blend', () => {
  // FIRST in the file on purpose: the module registry caches the texture module after its first successful load, and this test needs
  // that first load to fail.
  it('a failed chunk load keeps the placeholder, logs, and the next rebuild tries again', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = await booted(tones(TONES_HIGHLAND), QUALITY_PRESETS.high, true, () => {
      seam.failLoads = 1;
    });
    const record = heightBlendOf(b.priv.groundMat) as HeightBlendRecord;
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/module failed to load/);
    expect((record.field as THREE.DataTexture).image.width).toBe(1);
    expect((b.priv.groundBlendState as { loading: boolean }).loading).toBe(false);
    b.r.setElevation(RELIEF.slice());
    b.r.frame(1, 0);
    await vi.dynamicImportSettled();
    expect((record.field as THREE.DataTexture).image.width).toBe(SIZE * 4);
    expect(seam.bakes).toBe(1);
  });

  it('installs the record BEFORE the ground twin is built, with the tones as linear literals and the full graph', async () => {
    const { priv, seenByFactory } = await booted(tones(TONES_HIGHLAND));
    const record = heightBlendOf(priv.groundMat);
    expect(record).toBeDefined();
    if (record === undefined) return;
    expect(seenByFactory.calls).toBe(1);
    expect(seenByFactory.record, 'the twin was built before the record was installed').toBe(record);
    expect(record.rockTone.toArray()).toEqual([1, expect.closeTo(MID, 6), 0]);
    expect(record.jointTone?.toArray()).toEqual([0, expect.closeTo(MID, 6), 1]);
    expect(record.hollowTone.toArray()).toEqual([expect.closeTo(MID, 6), 1, 0]);
    expect([record.aR, record.aJ, record.aH, record.kH, record.amp]).toEqual([0.75, 0.6, 0.45, 0.4, 1]);
    expect(record.options).toEqual({ textureEdge: true, joints: true });
  });

  it('the SAME record is on the ground and on the decal material, installed in init before the scene adoption seals the decal twin', async () => {
    const { priv } = await booted(tones(TONES_HIGHLAND));
    const record = heightBlendOf(priv.groundMat);
    expect(record).toBeDefined();
    expect(heightBlendOf(priv.decalMaterial)).toBe(record);
  });

  it('a record installed after the twin exists throws (the seal is the real one)', async () => {
    const { priv } = await booted(tones(TONES_HIGHLAND));
    const record = heightBlendOf(priv.groundMat) as HeightBlendRecord;
    expect(() => installHeightBlend(priv.groundMat, record)).toThrow(/already built/);
  });

  it('the lazy bake swaps the renderer\'s own baked field into the record', async () => {
    const { priv } = await booted(tones(TONES_HIGHLAND));
    const record = heightBlendOf(priv.groundMat) as HeightBlendRecord;
    expect(seam.bakes).toBe(1);
    const tex = record.field as THREE.DataTexture;
    expect(tex.name).toBe(HEIGHT_BLEND_FIELD_MARKER);
    expect([tex.image.width, tex.image.height]).toEqual([SIZE * 4, SIZE * 4]);
    const actual = await vi.importActual<typeof import('./terrain/height-blend-field')>('./terrain/height-blend-field');
    const s = priv.terrainState.surface;
    const full = actual.bakeHeightBlendField(s, s.width, s.height);
    expect(Buffer.from(tex.image.data as Uint8Array).equals(Buffer.from(full.data))).toBe(true);
    // Real relief: not the neutral field the placeholder stands for.
    expect(Math.max(...(tex.image.data as Uint8Array).filter((_, i) => i % 4 === 0))).toBeGreaterThan(0);
  });

  it('arid installs no joints: options.joints false and no joint tone', async () => {
    const { priv, seenByFactory } = await booted(tones(TONES_ARID));
    const record = heightBlendOf(priv.groundMat) as HeightBlendRecord;
    expect(record.options).toEqual({ textureEdge: true, joints: false });
    expect(record.jointTone).toBeUndefined();
    expect(record.aJ).toBeUndefined();
    expect(seenByFactory.record).toBe(record);
  });

  it('low is tone-only: neither the texture edge nor the joints, even where a joint tone exists', async () => {
    const { priv } = await booted(tones(TONES_HIGHLAND), QUALITY_PRESETS.low);
    const record = heightBlendOf(priv.groundMat) as HeightBlendRecord;
    expect(record.options).toEqual({ textureEdge: false, joints: false });
    expect(record.jointTone).toBeUndefined();
  });

  it('a theme with no heightBlend (an opted-out map) installs no record and loads no bake', async () => {
    const { priv, seenByFactory } = await booted(tones(undefined));
    expect(heightBlendOf(priv.groundMat)).toBeUndefined();
    expect(seenByFactory.record).toBeUndefined();
    expect(priv.groundBlendState).toBeNull();
    expect(seam.bakes).toBe(0);
  });

  it('a collapse splices the same texture in place: bumped version, a full bake\'s bytes, no whole bake', async () => {
    const { r, sim, priv, structure } = await booted(tones(TONES_HIGHLAND));
    const record = heightBlendOf(priv.groundMat) as HeightBlendRecord;
    const tex = record.field as THREE.DataTexture;
    const before = Uint8Array.from(tex.image.data as Uint8Array);
    const version = tex.version;
    expect([seam.bakes, seam.splices]).toEqual([1, 0]);
    sim.debugDestroyStructure(structure);
    r.applyStructureDestroyed(structure);
    r.frame(1, 0);
    await vi.dynamicImportSettled();
    expect(record.field, 'a collapse swapped the texture instead of splicing it').toBe(tex);
    expect(seam.bakes, 'a collapse baked the whole field').toBe(1);
    expect(seam.splices).toBe(1);
    expect(tex.version).toBeGreaterThan(version);
    const after = tex.image.data as Uint8Array;
    expect(Buffer.from(after).equals(Buffer.from(before)), 'the splice rewrote nothing').toBe(false);
    const actual = await vi.importActual<typeof import('./terrain/height-blend-field')>('./terrain/height-blend-field');
    const s = priv.terrainState.surface;
    expect(Buffer.from(after).equals(Buffer.from(actual.bakeHeightBlendField(s, s.width, s.height).data))).toBe(true);
  });

  it('dispose() releases the baked texture and the placeholder', async () => {
    const { r, priv } = await booted(tones(TONES_HIGHLAND));
    const record = heightBlendOf(priv.groundMat) as HeightBlendRecord;
    const placeholder = (priv.groundBlendState as { placeholder: THREE.Texture }).placeholder;
    const released: string[] = [];
    record.field.addEventListener('dispose', () => released.push('field'));
    placeholder.addEventListener('dispose', () => released.push('placeholder'));
    r.dispose();
    expect([...new Set(released)].sort()).toEqual(['field', 'placeholder']);
    expect(priv.groundBlendState).toBeNull();
  });

  it('a second FULL build that changes the ground swaps in a new texture and releases the old one', async () => {
    const { r, priv } = await booted(tones(TONES_HIGHLAND), QUALITY_PRESETS.high, false);
    const record = heightBlendOf(priv.groundMat) as HeightBlendRecord;
    const first = record.field as THREE.DataTexture;
    expect(first.name).toBe(HEIGHT_BLEND_FIELD_MARKER);
    const released: string[] = [];
    first.addEventListener('dispose', () => released.push('first'));
    expect(seam.bakes).toBe(1);
    // Flat to relief: a different flatness, which the splice cannot compare, so the field is baked whole again.
    r.setElevation(RELIEF);
    r.frame(1, 0);
    await vi.dynamicImportSettled();
    r.frame(1, 0);
    const second = record.field as THREE.DataTexture;
    expect(second, 'the second build kept the first texture').not.toBe(first);
    expect(seam.bakes).toBe(2);
    const actual = await vi.importActual<typeof import('./terrain/height-blend-field')>('./terrain/height-blend-field');
    const s = priv.terrainState.surface;
    expect(Buffer.from(second.image.data as Uint8Array).equals(Buffer.from(actual.bakeHeightBlendField(s, s.width, s.height).data))).toBe(true);
    expect(Buffer.from(second.image.data as Uint8Array).equals(Buffer.from(first.image.data as Uint8Array))).toBe(false);
    expect(released, 'the replaced texture was not released after the next draw').toEqual(['first']);
  });

  it('a rebuild that moved nothing (a late asset load) re-bakes nothing, swaps nothing and uploads nothing', async () => {
    const { r, priv } = await booted(tones(TONES_HIGHLAND));
    const record = heightBlendOf(priv.groundMat) as HeightBlendRecord;
    const tex = record.field as THREE.DataTexture;
    const version = tex.version;
    r.setElevation(RELIEF.slice());
    r.frame(1, 0);
    await vi.dynamicImportSettled();
    expect(seam.bakes).toBe(1);
    expect(record.field).toBe(tex);
    expect(tex.version).toBe(version);
  });

  it('a throw inside the success callback is logged, not an unhandled rejection; the placeholder stays and the next rebuild bakes', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = await booted(tones(TONES_HIGHLAND), QUALITY_PRESETS.high, true, () => {
      seam.throwBakes = 1;
    });
    const record = heightBlendOf(b.priv.groundMat) as HeightBlendRecord;
    expect(String(err.mock.calls[0]?.[0])).toMatch(/bake failed/);
    expect((record.field as THREE.DataTexture).image.width).toBe(1);
    b.r.setElevation(RELIEF.slice());
    b.r.frame(1, 0);
    await vi.dynamicImportSettled();
    expect((record.field as THREE.DataTexture).image.width).toBe(SIZE * 4);
  });
});
