/**
 * Reduced motion and pause for the wet air (GH-871 P4 Task 9; R-9, R-10).
 *
 * `ThreeRenderer.rain.test.ts` and `ThreeRenderer.wet-ground.test.ts` pin the batch and the ground;
 * this file pins what happens when the player asks for no motion, and when the sim is paused:
 *
 *  - `reducedMotion: () => true`: no rain drawn, ripple amplitude 0; the wet ground (uWetAmp), the
 *    puddle and water control map, the marsh weight and the light are exactly what a motion-on
 *    renderer has. Foliage sway is the shipped rule and is not touched here;
 *  - the answer is asked LIVE, once a frame: flipped between frames, the next frame follows, both ways;
 *  - the debug layers `rain` and `ripples` still hide and show with reduced motion on, and showing
 *    never turns the motion back on (the flag and the preference are ANDed);
 *  - pause: with the sim not ticking, ten frames at alpha 0 read the same drop and ripple uniforms
 *    (the sim-clock rule: the rain freezes mid-air), wall-clock and `dtMs` passing; a tick moves them.
 *
 * Harness: a faked `WebGLRenderer`, a real `Sim`, `frame()` driving the build the way the app does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { GroundMaterial } from './terrain/mesh';
import { DECOR_MARSH, DECOR_ROAD } from './terrain/shared';
import type { RainBatch } from './units/rain-batch';

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
    render(): void {}
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
    weather: 'rain',
    ...extra,
  };
}

interface Private {
  rain: RainBatch | null;
  groundMat: GroundMaterial;
  scene: THREE.Scene;
  controlTex: { c: THREE.DataTexture | null } | null;
}
const priv = (r: ThreeRenderer): Private => r as unknown as Private;

const MAP = 24;

/** A 24x24 map with a road across row 12 and a marsh block, so there is wet ground to keep. */
function setUp(reduced: () => boolean): { r: ThreeRenderer; sim: Sim } {
  const sim = new Sim({ seed: 1, width: MAP, height: MAP, capacity: 4 });
  const r = new ThreeRenderer(sim, makeOpts({ reducedMotion: reduced }));
  const decor = new Uint8Array(MAP * MAP);
  for (let x = 0; x < MAP; x++) decor[12 * MAP + x] = DECOR_ROAD;
  for (let z = 15; z < 23; z++) for (let x = 14; x < 22; x++) decor[z * MAP + x] = DECOR_MARSH;
  r.setDecor(decor);
  r.frame(1, 0);
  return { r, sim };
}

const rainVisible = (r: ThreeRenderer): boolean => priv(r).rain!.mesh.visible;
const rippleAmp = (r: ThreeRenderer): number => priv(r).groundMat.uniforms.uRippleAmp.value as number;
const rainUniform = (r: ThreeRenderer, name: string): unknown => priv(r).rain!.mesh.material.uniforms[name].value;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reduced motion on: the rain and the ripples are still, the wet stays (R-9)', () => {
  it('draws no rain and zeroes the ripple amplitude, from the very first frame', () => {
    const { r } = setUp(() => true);
    expect(priv(r).rain, 'the batch exists (it is hidden, not unbuilt)').not.toBeNull();
    expect(rainVisible(r)).toBe(false);
    expect(rippleAmp(r)).toBe(0);
    r.frame(1, 0);
    r.frame(1, 16);
    expect(rainVisible(r)).toBe(false);
    expect(rippleAmp(r)).toBe(0);
    r.dispose();
  });

  it('and motion off (the default) draws both, so the zeros above are the preference`s doing', () => {
    const { r } = setUp(() => false);
    expect(rainVisible(r)).toBe(true);
    expect(rippleAmp(r)).toBe(1);
    r.dispose();
  });

  it('a renderer with no reducedMotion option at all is motion on', () => {
    const sim = new Sim({ seed: 1, width: MAP, height: MAP, capacity: 4 });
    const r = new ThreeRenderer(sim, makeOpts());
    r.setDecor(new Uint8Array(MAP * MAP));
    r.frame(1, 0);
    expect(rainVisible(r)).toBe(true);
    expect(rippleAmp(r)).toBe(1);
    r.dispose();
  });

  it('keeps the wet ground: the wet program, control C, the puddle and marsh weights, the water colours', () => {
    const still = setUp(() => true);
    const moving = setUp(() => false);
    const a = priv(still.r).groundMat;
    const b = priv(moving.r).groundMat;
    expect(a.wet, 'the wet program is compiled').toBe(true);
    expect(a.customProgramCacheKey()).toBe('rl-ground-wet');
    expect(a.defines).toEqual({ STANDARD: '', THEME_WET: '' });
    expect(a.uniforms.uWetAmp.value, 'puddles and water at full weight').toBe(1);
    expect(a.uniforms.uMarshAmp.value).toBe(1);
    expect(priv(still.r).controlTex?.c, 'control C is bound').not.toBeNull();
    expect(a.uniforms.uControlC.value).toBe(priv(still.r).controlTex?.c);
    // Water and puddle colours are what the motion-on renderer has.
    for (const name of ['uWetSky', 'uWetRim', 'uPuddleReflect', 'uMarshReflect']) {
      expect(a.uniforms[name].value, name).toEqual(b.uniforms[name].value);
    }
    // And control C holds real water and puddle bytes (a bare texture would pass the lines above vacuously).
    const c = priv(still.r).controlTex!.c!.image.data as Uint8Array;
    let water = 0;
    let puddle = 0;
    for (let i = 0; i < c.length; i += 4) {
      if (c[i] > 0) water++;
      if (c[i + 1] > 0) puddle++;
    }
    expect(water, 'marsh water texels').toBeGreaterThan(0);
    expect(puddle, 'puddle texels').toBeGreaterThan(0);
    still.r.dispose();
    moving.r.dispose();
  });

  it('leaves the light exactly as the motion-on renderer has it', () => {
    const lights = (r: ThreeRenderer): { type: string; intensity: number; color: number[] }[] => {
      const out: { type: string; intensity: number; color: number[] }[] = [];
      priv(r).scene.traverse((o) => {
        const l = o as THREE.Light;
        if (l.isLight) out.push({ type: l.type, intensity: l.intensity, color: l.color.toArray() });
      });
      return out;
    };
    const still = setUp(() => true);
    const moving = setUp(() => false);
    const a = lights(still.r);
    expect(a.length, 'the scene is lit (an empty list would be equal vacuously)').toBeGreaterThanOrEqual(2);
    expect(a.some((l) => l.intensity > 0)).toBe(true);
    expect(a).toEqual(lights(moving.r));
    still.r.dispose();
    moving.r.dispose();
  });
});

describe('the answer is asked live, once a frame (R-9)', () => {
  it('flipped between frames: the next frame follows it, both ways', () => {
    let reduced = false;
    const spy = vi.fn(() => reduced);
    const { r } = setUp(spy);
    expect(rainVisible(r)).toBe(true);
    expect(rippleAmp(r)).toBe(1);
    reduced = true;
    r.frame(1, 0);
    expect(rainVisible(r), 'reduced on: rain gone the very next frame').toBe(false);
    expect(rippleAmp(r)).toBe(0);
    reduced = false;
    r.frame(1, 0);
    expect(rainVisible(r), 'reduced off: rain back').toBe(true);
    expect(rippleAmp(r)).toBe(1);
    reduced = true;
    r.frame(1, 0);
    expect(rainVisible(r)).toBe(false);
    expect(rippleAmp(r)).toBe(0);
    r.dispose();
  });

  it('is asked exactly once per frame, shared by the rain and the ripple writes', () => {
    const spy = vi.fn(() => false);
    const { r } = setUp(spy);
    const before = spy.mock.calls.length;
    r.frame(1, 0);
    // The renderer`s other readers (the wound ring, the flinch) ask too; the wet writes add ONE.
    const perFrame = spy.mock.calls.length - before;
    expect(perFrame, 'the wet writes share a single ask').toBeGreaterThanOrEqual(1);
    const wetAsks = perFrame - 1; // the wound ring asks once a frame on its own
    expect(wetAsks, `calls per frame ${perFrame}: one more than the pre-T9 baseline of one`).toBe(1);
    r.dispose();
  });
});

describe('the debug layers with reduced motion on: a show never turns the motion back on', () => {
  it('rain: hide and show report as usual, and the rain stays off after each', () => {
    const { r } = setUp(() => true);
    expect(r.setDebugLayerVisible('rain', false)).toBe(1);
    expect(rainVisible(r)).toBe(false);
    expect(r.setDebugLayerVisible('rain', false)).toBe(0);
    r.frame(1, 0);
    expect(rainVisible(r)).toBe(false);
    expect(r.setDebugLayerVisible('rain', true), 'the flag flips').toBe(1);
    expect(rainVisible(r), 'a show with reduced motion on does not draw the rain').toBe(false);
    r.frame(1, 0);
    expect(rainVisible(r), 'nor does the next frame').toBe(false);
    expect(r.setDebugLayerVisible('rain', true)).toBe(0);
    r.dispose();
  });

  it('ripples: hide and show report as usual, and the amplitude stays 0 after each', () => {
    const { r } = setUp(() => true);
    expect(r.setDebugLayerVisible('ripples', false)).toBe(1);
    expect(rippleAmp(r)).toBe(0);
    expect(r.setDebugLayerVisible('ripples', false)).toBe(0);
    r.frame(1, 0);
    expect(rippleAmp(r)).toBe(0);
    expect(r.setDebugLayerVisible('ripples', true), 'the flag flips').toBe(1);
    expect(rippleAmp(r), 'a show with reduced motion on does not ring the water').toBe(0);
    r.frame(1, 0);
    expect(rippleAmp(r)).toBe(0);
    r.dispose();
  });

  it('the flag and the preference are ANDed: reduced motion off afterwards, a hidden layer is still hidden', () => {
    let reduced = true;
    const { r } = setUp(() => reduced);
    r.setDebugLayerVisible('rain', false);
    r.setDebugLayerVisible('ripples', false);
    reduced = false;
    r.frame(1, 0);
    expect(rainVisible(r), 'hidden by the layer').toBe(false);
    expect(rippleAmp(r)).toBe(0);
    r.setDebugLayerVisible('rain', true);
    r.setDebugLayerVisible('ripples', true);
    r.frame(1, 0);
    expect(rainVisible(r), 'shown by the layer and motion on').toBe(true);
    expect(rippleAmp(r)).toBe(1);
    reduced = true;
    r.frame(1, 0);
    expect(rainVisible(r)).toBe(false);
    expect(rippleAmp(r)).toBe(0);
    r.dispose();
  });

  it('the wet and marsh layers are not touched by reduced motion', () => {
    const { r } = setUp(() => true);
    const u = priv(r).groundMat.uniforms;
    expect(r.setDebugLayerVisible('wet', false)).toBe(1);
    expect(u.uWetAmp.value).toBe(0);
    expect(r.setDebugLayerVisible('wet', true)).toBe(1);
    expect(u.uWetAmp.value).toBe(1);
    r.frame(1, 0);
    expect(u.uWetAmp.value).toBe(1);
    r.dispose();
  });
});

describe('pause: with the sim not ticking the rain and the ripples hang mid-air (sim-clock rule)', () => {
  const rainRead = (r: ThreeRenderer): unknown => ({
    fall: rainUniform(r, 'uFall'),
    low: (rainUniform(r, 'uLow') as THREE.Vector2).toArray(),
    period: rainUniform(r, 'uPeriod'),
    width: rainUniform(r, 'uStreakHalfWidth'),
    rippleTime: priv(r).groundMat.uniforms.uRippleTimeSec.value,
    rippleAmp: rippleAmp(r),
  });

  it.each([[0], [37]])('ten frames at alpha 0, %i ticks in, wall clock and dtMs advancing, read identical uniforms', (ticks) => {
    const { r, sim } = setUp(() => false);
    for (let k = 0; k < ticks; k++) sim.tick();
    r.frame(1, 0);
    r.frame(0, 0);
    const first = rainRead(r);
    // The fall is a literal at this tick: presentationSimMs(37, 0) = 36 x 50 ms = 1.8 s, 4 wu/s mod 6 = 1.2.
    if (ticks === 37) expect((first as { fall: number }).fall).toBeCloseTo(1.2, 9);
    expect((first as { rippleTime: number }).rippleTime).toBeCloseTo(ticks === 37 ? 1.8 : 0, 12);
    const t0 = performance.now();
    for (let k = 1; k <= 10; k++) {
      vi.spyOn(performance, 'now').mockReturnValue(t0 + k * 16_000);
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + k * 16_000);
      r.frame(0, k * 16);
      expect(rainRead(r), `frame ${k} (sim not ticking)`).toEqual(first);
    }
    // Non-vacuous: the same renderer moves once the sim ticks again.
    // (Two ticks: the sim clock is `(tickCount - 1 + alpha) x 50 ms`, so the first tick still reads 0.)
    sim.tick();
    sim.tick();
    r.frame(0, 16);
    expect((rainRead(r) as { fall: number }).fall).not.toBe((first as { fall: number }).fall);
    expect((rainRead(r) as { rippleTime: number }).rippleTime).toBeGreaterThan((first as { rippleTime: number }).rippleTime);
    r.dispose();
  });

  it('a paused reduced-motion renderer stays still too (no rain, no ripples, nothing moving)', () => {
    const { r, sim } = setUp(() => true);
    for (let k = 0; k < 10; k++) sim.tick();
    r.frame(0, 0);
    const first = rainRead(r);
    for (let k = 1; k <= 10; k++) {
      r.frame(0, k * 16);
      expect(rainRead(r)).toEqual(first);
      expect(rainVisible(r)).toBe(false);
    }
    r.dispose();
  });
});
