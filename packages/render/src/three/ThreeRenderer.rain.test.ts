/**
 * The falling rain, wired into the renderer (GH-871 P4 Task 8).
 *
 * `units/rain-maths.test.ts` pins the maths and `units/rain-batch.test.ts` the one draw and the
 * GLSL; this file pins what only the renderer does:
 *
 *  - the batch is built ONLY under `weather: 'rain'`, after the terrain exists, and nowhere else;
 *  - its instance count is the preset's: 6000 / 3500 / 1500, `high`'s when the quality has no
 *    opinion, none at all when a ladder step took the count to 0;
 *  - it runs on the SIM clock: two `frame(1, 0)` at one tick read the same uniforms, wall-clock time
 *    passing (`performance.now`, `Date.now`) moves nothing, a tick does;
 *  - `photographGround` hides it (the minimap shows the wet tones, no streaks) and puts back what it
 *    found;
 *  - the `rain` debug layer is a flag the per-frame visibility write consults;
 *  - its colour clears the bloom bar on dawn, day and dusk, with the day figure as a literal;
 *  - a terrain rebuild re-bakes the height texture from the new ground.
 *
 * Harness: a faked `WebGLRenderer` (the `ThreeRenderer.wet-ground.test.ts` shape), a real `Sim`,
 * `frame()` driving the build the way the app does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import { ThreeRenderer } from './ThreeRenderer';
import { groundWorldY } from './ground-height';
import { DECOR_ROAD } from './terrain/shared';
import type { TerrainSurface } from './terrain/surface';
import type { RainBatch } from './units/rain-batch';

let onRender: (() => void) | null = null;

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    toneMapping = actual.ACESFilmicToneMapping;
    toneMappingExposure = 1;
    domElement: unknown = {};
    shadowMap = { enabled: false, autoUpdate: true, type: 0 };
    private target: unknown = null;
    setClearColor(): void {}
    setRenderTarget(t: unknown): void {
      this.target = t;
    }
    getRenderTarget(): unknown {
      return this.target;
    }
    clear(): void {}
    render(): void {
      onRender?.();
    }
    readRenderTargetPixels(_t: unknown, _x: number, _y: number, w: number, h: number, buffer: Uint8Array): void {
      buffer.fill(255, 0, w * h * 4);
    }
    setPixelRatio(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

class ImageDataShim {
  readonly colorSpace: PredefinedColorSpace = 'srgb';
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number
  ) {}
}
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as { ImageData?: typeof ImageData }).ImageData = ImageDataShim as unknown as typeof ImageData;
}

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function makeOpts(extra: Partial<RendererOptions> = {}): RendererOptions {
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
    ...extra,
  };
}

interface Private {
  rain: RainBatch | null;
  scene: THREE.Scene;
  terrainDirty: boolean;
  retained: { elevation: TerrainSurface | null };
}
const priv = (r: ThreeRenderer): Private => r as unknown as Private;

const MAP = 24;
const RAIN = { weather: 'rain' } as const;

function setUp(extra: Partial<RendererOptions> = {}, relief = false): { r: ThreeRenderer; sim: Sim } {
  const sim = new Sim({ seed: 1, width: MAP, height: MAP, capacity: 4 });
  const r = new ThreeRenderer(sim, makeOpts(extra));
  const decor = new Uint8Array(MAP * MAP);
  for (let x = 0; x < MAP; x++) decor[12 * MAP + x] = DECOR_ROAD;
  r.setDecor(decor);
  if (relief) r.setElevation(reliefLevels());
  r.frame(1, 0);
  return { r, sim };
}

/** Three terraces rising with x (levels 0, 1..2, 3). */
function reliefLevels(): Uint8Array {
  const e = new Uint8Array(MAP * MAP);
  for (let z = 0; z < MAP; z++) for (let x = 0; x < MAP; x++) e[z * MAP + x] = x < 8 ? 0 : x < 16 ? 1 + ((x - 8) >> 2) : 3;
  return e;
}

function rainMeshes(r: ThreeRenderer): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  priv(r).scene.traverse((o) => {
    if (o.name === 'rain-batch') out.push(o);
  });
  return out;
}

const uniform = (r: ThreeRenderer, name: string): unknown => priv(r).rain!.mesh.material.uniforms[name].value;

afterEach(() => {
  vi.restoreAllMocks();
  onRender = null;
});

describe('built only under rain', () => {
  it.each([[undefined], [{ weather: 'clear' as const }]])('no rain mesh, no batch, for %j', (extra) => {
    const { r } = setUp(extra ?? {});
    expect(priv(r).rain).toBeNull();
    expect(rainMeshes(r)).toHaveLength(0);
    r.dispose();
  });

  it('exactly one rain mesh under weather: rain, in the scene, after the first frame', () => {
    const sim = new Sim({ seed: 1, width: MAP, height: MAP, capacity: 4 });
    const r = new ThreeRenderer(sim, makeOpts(RAIN));
    // Not at construction: it reads the drawn ground, which does not exist yet.
    expect(priv(r).rain).toBeNull();
    expect(rainMeshes(r)).toHaveLength(0);
    r.frame(1, 0);
    expect(priv(r).rain).not.toBeNull();
    expect(rainMeshes(r)).toHaveLength(1);
    expect(rainMeshes(r)[0].visible).toBe(true);
    r.frame(1, 0);
    expect(rainMeshes(r), 'a second frame builds no second batch').toHaveLength(1);
    r.dispose();
  });

  it('dispose takes it out of the scene', () => {
    const { r } = setUp(RAIN);
    const scene = priv(r).scene;
    const mesh = rainMeshes(r)[0];
    r.dispose();
    expect(scene.children).not.toContain(mesh);
    expect(priv(r).rain).toBeNull();
  });
});

describe('the instance count is the preset`s (R-8)', () => {
  const dropsOf = (r: ThreeRenderer): number => priv(r).rain!.mesh.geometry.instanceCount;
  it.each([
    ['high', 6000],
    ['medium', 3500],
    ['low', 1500],
  ] as const)('%s draws %i drops', (name, drops) => {
    const { r } = setUp({ ...RAIN, quality: QUALITY_PRESETS[name] });
    expect(dropsOf(r)).toBe(drops);
    r.dispose();
  });
  it('an absent quality and a quality with no rain field read high`s 6000', () => {
    const a = setUp(RAIN);
    expect(dropsOf(a.r)).toBe(6000);
    a.r.dispose();
    const noRain: Partial<RenderQuality> = { ...QUALITY_PRESETS.low };
    delete noRain.rain;
    const b = setUp({ ...RAIN, quality: noRain as RenderQuality });
    expect(dropsOf(b.r)).toBe(6000);
    b.r.dispose();
  });
  it('a ladder step to 0 drops builds no batch and no mesh (the wet ground stays)', () => {
    const { r } = setUp({ ...RAIN, quality: { ...QUALITY_PRESETS.low, rain: { drops: 0, ripples: false } } });
    expect(priv(r).rain).toBeNull();
    expect(rainMeshes(r)).toHaveLength(0);
    r.dispose();
  });
  it('a stepped count is honoured: low 900 (RAIN_LADDER x0.6)', () => {
    const { r } = setUp({ ...RAIN, quality: { ...QUALITY_PRESETS.low, rain: { drops: 900, ripples: false } } });
    expect(dropsOf(r)).toBe(900);
    r.dispose();
  });
});

describe('the sim clock (invariant: presentation reads presentationSimMs, never the wall)', () => {
  it('two frame(1, 0) at one tick read identical uniforms, whatever the wall clock does', () => {
    const { r } = setUp(RAIN);
    const read = () => ({
      fall: uniform(r, 'uFall') as number,
      low: (uniform(r, 'uLow') as THREE.Vector2).toArray(),
      period: uniform(r, 'uPeriod') as number,
      width: uniform(r, 'uStreakHalfWidth') as number,
    });
    r.frame(1, 0);
    const a = read();
    // The wall clock leaps ten seconds: a batch driven from it would move.
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + 10_000);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    r.frame(1, 0);
    r.frame(1, 16);
    expect(read()).toEqual(a);
    r.dispose();
  });

  it('a later tick moves the fall by 4 wu/s x 50 ms = 0.2 wu', () => {
    const { r, sim } = setUp(RAIN);
    r.frame(1, 0);
    const before = uniform(r, 'uFall') as number;
    sim.tick();
    r.frame(1, 0);
    const after = uniform(r, 'uFall') as number;
    expect(after).not.toBe(before);
    expect(((after - before + 6) % 6)).toBeCloseTo(0.2, 6);
    r.dispose();
  });
});

describe('the camera feeds the lattice (the focus is the window`s anchor)', () => {
  it('a pan of 3 tiles moves the window by 3 or leaves the period alone, never reshuffles inside a period', () => {
    const { r } = setUp(RAIN);
    r.camera.x = 20;
    r.camera.y = 20;
    r.frame(1, 0);
    const p1 = uniform(r, 'uPeriod') as number;
    const lo1 = (uniform(r, 'uLow') as THREE.Vector2).clone();
    r.camera.x = 23;
    r.frame(1, 0);
    expect(uniform(r, 'uPeriod')).toBe(p1);
    const lo2 = uniform(r, 'uLow') as THREE.Vector2;
    // The box is clipped to the map at this zoom, so the window need not move by exactly 3;
    // what a pan must never do is move it by more than the pan.
    expect(Math.abs(lo2.x - lo1.x)).toBeLessThanOrEqual(3 + 1e-9);
    expect(lo2.y).toBeCloseTo(lo1.y, 9);
    r.dispose();
  });
});

describe('the minimap photograph hides the rain and puts back what it found', () => {
  it('draws no rain during the capture, restores it visible', () => {
    const { r } = setUp(RAIN);
    const mesh = rainMeshes(r)[0];
    const seen: boolean[] = [];
    onRender = () => seen.push(mesh.visible);
    expect(r.captureGroundAlbedo(32)).not.toBeNull();
    expect(seen.length, 'the capture rendered the scene').toBeGreaterThanOrEqual(1);
    expect(seen.every((v) => v === false), `rain visibility during each render: ${seen.join(',')}`).toBe(true);
    expect(mesh.visible).toBe(true);
    r.dispose();
  });

  it('leaves a debug-hidden rain hidden (restored to what it WAS, not to true)', () => {
    const { r } = setUp(RAIN);
    const mesh = rainMeshes(r)[0];
    expect(r.setDebugLayerVisible('rain', false)).toBe(1);
    expect(r.captureGroundAlbedo(32)).not.toBeNull();
    expect(mesh.visible).toBe(false);
    r.dispose();
  });

  it('puts the rain back even when the render throws', () => {
    const { r } = setUp(RAIN);
    const mesh = rainMeshes(r)[0];
    onRender = () => {
      throw new Error('context lost');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(r.captureGroundAlbedo(32)).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(mesh.visible).toBe(true);
    r.dispose();
  });
});

describe('the rain debug layer: a flag the per-frame write consults', () => {
  it('hides and shows, idempotent both ways, holding across a repaint', () => {
    const { r } = setUp(RAIN);
    const mesh = rainMeshes(r)[0];
    expect(r.setDebugLayerVisible('rain', false)).toBe(1);
    expect(mesh.visible).toBe(false);
    expect(r.setDebugLayerVisible('rain', false)).toBe(0);
    r.frame(1, 0);
    expect(mesh.visible, 'the repaint must not undo the hide').toBe(false);
    expect(r.setDebugLayerVisible('rain', true)).toBe(1);
    expect(mesh.visible).toBe(true);
    expect(r.setDebugLayerVisible('rain', true)).toBe(0);
    r.dispose();
  });

  it('a hide before the batch exists holds when it is built', () => {
    const sim = new Sim({ seed: 1, width: MAP, height: MAP, capacity: 4 });
    const r = new ThreeRenderer(sim, makeOpts(RAIN));
    expect(r.setDebugLayerVisible('rain', false)).toBe(1);
    r.frame(1, 0);
    expect(rainMeshes(r)[0].visible).toBe(false);
    r.dispose();
  });

  it('reports 0 on a map that does not rain', () => {
    const { r } = setUp();
    expect(r.setDebugLayerVisible('rain', false)).toBe(0);
    expect(r.setDebugLayerVisible('rain', true)).toBe(0);
    expect(rainMeshes(r)).toHaveLength(0);
    r.dispose();
  });
});

describe('the colour never blooms (spec 9.2: the bloom literal)', () => {
  const colours = (r: ThreeRenderer): { streak: number[]; splash: number[] } => ({
    streak: (uniform(r, 'uStreakColor') as THREE.Vector3).toArray(),
    splash: (uniform(r, 'uSplashColor') as THREE.Vector3).toArray(),
  });

  it('day: overcast.0 linear (0.5522, 0.5776, 0.5841) x the rain light factor 0.7415 = (0.4095, 0.4283, 0.4331)', () => {
    const { r } = setUp(RAIN);
    const { streak } = colours(r);
    expect(streak[0]).toBeCloseTo(0.4095, 2);
    expect(streak[1]).toBeCloseTo(0.4283, 2);
    expect(streak[2]).toBeCloseTo(0.4331, 2);
    r.dispose();
  });

  it.each(['dawn', 'day', 'dusk'] as const)('%s: both colours are non-zero and their largest channel is below 0.9', (timeOfDay) => {
    const { r } = setUp({ ...RAIN, timeOfDay });
    const { streak, splash } = colours(r);
    for (const c of [streak, splash]) {
      expect(Math.max(...c), `${timeOfDay} ${c.join(',')}`).toBeLessThan(0.9);
      expect(Math.max(...c), 'a zero colour would pass vacuously').toBeGreaterThan(0.1);
    }
    r.dispose();
  });
});

describe('the height texture follows the ground', () => {
  it('bakes the drawn surface at the first build and RE-bakes it after a terrain rebuild', () => {
    const { r } = setUp(RAIN, true);
    const tex = uniform(r, 'uHeight') as THREE.DataTexture;
    const data = tex.image.data as Uint16Array;
    const w = MAP * 4;
    const surface = priv(r).retained.elevation;
    // texel (i, j) is world ((i + .5) / 4, (j + .5) / 4): x = 2.125 is level 0, x = 20.125 level 3.
    const at = (i: number, j: number): number => THREE.DataUtils.fromHalfFloat(data[j * w + i]);
    const truth = (i: number, j: number): number => groundWorldY(surface, MAP, MAP, (i + 0.5) / 4, (j + 0.5) / 4);
    expect(truth(80, 40), 'the relief is real').toBeGreaterThan(truth(8, 40) + 0.2);
    for (const [i, j] of [[8, 40], [80, 40], [50, 10], [95, 95]] as const) {
      expect(at(i, j), `texel ${i},${j}`).toBeCloseTo(truth(i, j), 2);
      expect(Math.abs(at(i, j) - truth(i, j))).toBeLessThan(1e-3);
    }
    // Change the ground and rebuild: the same texels now read the NEW ground.
    const flat = new Uint8Array(MAP * MAP);
    r.setElevation(flat);
    const versionBefore = tex.version;
    r.frame(1, 0);
    expect(tex.version, 'the texture was re-uploaded').toBeGreaterThan(versionBefore);
    expect(at(80, 40)).toBeCloseTo(0, 3);
    r.dispose();
  });

  it('does not re-bake on a frame that rebuilt nothing', () => {
    const { r } = setUp(RAIN, true);
    const tex = uniform(r, 'uHeight') as THREE.DataTexture;
    const v = tex.version;
    r.frame(1, 0);
    r.frame(1, 0);
    expect(tex.version).toBe(v);
    r.dispose();
  });
});
