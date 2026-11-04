/**
 * The wind is dated off the SIM clock, and reduced motion keeps today's sway (GH-984 N1; the
 * rotor-wash-clock pattern, `ThreeRenderer.rotor-wash-clock.test.ts`).
 *
 *  - the clock census: `frame(a, 0)`, `frame(a, 16)` and `frame(a, 5000)` at one tick leave every wind
 *    uniform bit-identical -- the foliage and trunk shader's, the banners' (the same objects) and the
 *    rain's (`uWind`, `uWindDir`) -- and a paused loop changes none. A tick moves the clock (anti-vacuity);
 *  - a source scan finds no `dtMs`, `performance.now`, `Date.now` or `Math.random` in the wind modules;
 *  - reduced motion: `mode` 0 (the legacy branch: today's amplitude, the old periodic gust, the fixed
 *    axis, crowns only), asked live once a frame, and strength, heading and clock are untouched by it.
 *  - `RendererOptions.wind` reaches the uniforms, and the sim never sees it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { RainBatch } from './units/rain-batch';
import type { WindUniformSet } from './terrain/wind-uniforms';
import type { DisturbUniformSet } from './terrain/disturb-uniforms';

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
    ...extra,
  };
}

interface Private {
  windU: WindUniformSet;
  disturbU: DisturbUniformSet;
  sway: { time: { value: number }; amp: { value: number }; wind?: WindUniformSet };
  garrisonBanners: { wind: WindUniformSet; time: { value: number } };
  rain: RainBatch | null;
}
const priv = (r: ThreeRenderer): Private => r as unknown as Private;

const MAP = 24;
/** GH-984 N2: a tank driving across the map, so the census compares live disturber uniforms and not an empty array. */
const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};
/** The renderer each sim feeds, so `tickTo` snapshots after every tick the way `main.ts`'s `runTick` does. */
const rendererOf = new WeakMap<Sim, ThreeRenderer>();
function setUp(extra: Partial<RendererOptions> = {}): { r: ThreeRenderer; sim: Sim } {
  const sim = new Sim({ seed: 1, width: MAP, height: MAP, capacity: 4 });
  const tank = sim.spawn(sim.addUnitType(TANK), 0, fx.from(3.5), fx.from(11.5));
  const r = new ThreeRenderer(sim, makeOpts(extra));
  r.setDecor(new Uint8Array(MAP * MAP));
  r.camera.x = 12;
  r.camera.y = 12;
  r.snapshot();
  r.frame(1, 0);
  rendererOf.set(sim, r);
  sim.queueCommand({ kind: 'move', ids: [tank], x: fx.from(21.5), y: fx.from(11.5) });
  return { r, sim };
}
const tickTo = (sim: Sim, t: number): void => {
  while (sim.tickCount < t) {
    sim.tick();
    rendererOf.get(sim)?.snapshot();
  }
};

/** Every wind number a shader reads, as exact bits (a text of the float64s, so -0 and NaN differ too). */
function windBits(r: ThreeRenderer): string {
  const p = priv(r);
  const w = p.windU;
  const rain = p.rain?.mesh.material.uniforms;
  return JSON.stringify([
    Object.is(p.sway.time.value, -0) ? '-0' : p.sway.time.value,
    p.sway.amp.value,
    w.mode.value,
    w.strength.value,
    w.dir.value.x,
    w.dir.value.y,
    rain ? [rain.uWind.value, rain.uWindDir.value.x, rain.uWindDir.value.y, rain.uFall.value] : null,
    // GH-984 N2: the disturbers' uniforms, on the same clock.
    [
      Array.from(p.disturbU.a.value), Array.from(p.disturbU.b.value), p.disturbU.box.value.toArray(),
      p.disturbU.n.value, p.disturbU.amp.value, p.disturbU.spring.value,
    ],
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the clock census (GH-984 N1)', () => {
  for (const weather of ['clear', 'rain'] as const) {
    it(`${weather}: frame(a,0), frame(a,16) and frame(a,5000) at one tick leave the wind uniforms bit-identical`, () => {
      const { r, sim } = setUp({ weather });
      tickTo(sim, 137);
      r.frame(0.4, 0);
      const base = windBits(r);
      r.frame(0.4, 16);
      expect(windBits(r)).toBe(base);
      r.frame(0.4, 5000);
      expect(windBits(r)).toBe(base);
      r.frame(0.4, 0);
      expect(windBits(r)).toBe(base);
      expect(priv(r).disturbU.n.value, 'a hull is moving, so the disturber uniforms compared are live').toBeGreaterThan(0);
      if (weather === 'rain') expect(priv(r).rain, 'the rain batch exists, so its uniforms were compared').not.toBeNull();
      r.dispose();
    });

    it(`${weather}: a paused loop (ten frames, no tick, wall-clock passing) changes none`, () => {
      const { r, sim } = setUp({ weather });
      tickTo(sim, 60);
      r.frame(0, 0);
      const base = windBits(r);
      for (let i = 0; i < 10; i++) r.frame(0, 16 + i * 1000);
      expect(windBits(r)).toBe(base);
      r.dispose();
    });

    it(`${weather}: the same sim time reached through different frame histories reads the same`, () => {
      const a = setUp({ weather });
      const b = setUp({ weather });
      tickTo(a.sim, 40);
      for (let i = 0; i < 12; i++) a.r.frame(0.1 * i, 100);
      tickTo(a.sim, 200);
      a.r.frame(0.25, 3);
      tickTo(b.sim, 200);
      b.r.frame(0.25, 4000);
      expect(windBits(a.r)).toBe(windBits(b.r));
      a.r.dispose();
      b.r.dispose();
    });

    it(`${weather}: a tick moves the clock (anti-vacuity: the census is not comparing constants)`, () => {
      const { r, sim } = setUp({ weather });
      tickTo(sim, 100);
      r.frame(0, 0);
      const before = windBits(r);
      tickTo(sim, 101);
      r.frame(0, 0);
      expect(windBits(r)).not.toBe(before);
      // presentationSimMs presents the tick BEFORE the one reached at alpha 0 (the sim interpolates toward it).
      expect(priv(r).sway.time.value).toBeCloseTo(100 * 0.05, 9);
      r.dispose();
    });
  }

  it('the crowns, the trunks and the banners read ONE wind: the same uniform objects', () => {
    const { r } = setUp();
    const p = priv(r);
    expect(p.sway.wind).toBe(p.windU);
    expect(p.garrisonBanners.wind).toBe(p.windU);
    expect(p.garrisonBanners.time).toBe(p.sway.time);
    r.dispose();
  });

  it('feeding dtMs into the clock would break the census (the falsifier is real): wall time is not sim time', () => {
    // The rule the scan below enforces, shown on the numbers: two frames at one tick and different dtMs
    // present the same time, so a clock that added dtMs could not.
    const { r, sim } = setUp();
    tickTo(sim, 20);
    r.frame(0.5, 16);
    const a = priv(r).sway.time.value;
    r.frame(0.5, 5000);
    expect(priv(r).sway.time.value).toBe(a);
    r.dispose();
  });
});

describe('no wall clock in the wind modules', () => {
  const root = join(__dirname);
  /** Strip comments and strings that merely name the banned things, so a doc comment does not trip the scan. */
  const code = (file: string): string =>
    readFileSync(join(root, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const file of ['terrain/wind.ts', 'terrain/wind-uniforms.ts', 'terrain/sway.ts', 'terrain/decor-mesh.ts', 'units/garrison-banner.ts', 'terrain/disturb.ts', 'terrain/disturb-uniforms.ts', 'units/ground-churn.ts']) {
    it(`${file} reads none of dtMs, performance.now, Date.now, Math.random`, () => {
      const src = code(file);
      for (const banned of ['dtMs', 'performance.now', 'Date.now', 'Math.random', 'requestAnimationFrame']) {
        expect(src, banned).not.toContain(banned);
      }
    });
  }
  it('and the scan can fail: it reads real code (the wind module names the clock it uses)', () => {
    expect(code('terrain/wind.ts')).toContain('tSec');
    expect(code('ThreeRenderer.ts')).toContain('dtMs'); // a file that does take a frame delta trips it
  });
  it('the renderer writes the wind clock from presentationSimMs on the line it is written', () => {
    const src = readFileSync(join(root, 'ThreeRenderer.ts'), 'utf8');
    expect(src).toMatch(/this\.sway\.time\.value = presentationSimMs\(this\.sim\.tickCount, alpha\) \/ 1000;/);
    expect(src).toMatch(/this\.windU\.mode\.value = reducedPref \? 0 : 1;/);
    // GH-984 N2: the disturbers are filled from the tick and alpha, never from a frame delta.
    expect(src).toMatch(/f\.tick = this\.sim\.tickCount;/);
    expect(src).toMatch(/this\.updateDisturbers\(alpha, reducedPref\);/);
  });
});

describe('reduced motion keeps today`s sway and adds nothing new (decision 6)', () => {
  it('plays mode 0 from the very first frame when the player asked for no motion, wet or dry', () => {
    for (const weather of ['clear', 'rain'] as const) {
      const { r } = setUp({ weather, reducedMotion: () => true });
      expect(priv(r).windU.mode.value).toBe(0);
      r.frame(1, 16);
      expect(priv(r).windU.mode.value).toBe(0);
      r.dispose();
    }
  });
  it('plays the wind (mode 1) otherwise, with or without a preference callback', () => {
    for (const reducedMotion of [undefined, () => false]) {
      const { r } = setUp({ reducedMotion });
      expect(priv(r).windU.mode.value).toBe(1);
      r.dispose();
    }
  });
  it('is asked live: flipped between frames, the next frame follows, both ways', () => {
    let reduced = false;
    const { r } = setUp({ reducedMotion: () => reduced });
    expect(priv(r).windU.mode.value).toBe(1);
    reduced = true;
    r.frame(1, 0);
    expect(priv(r).windU.mode.value).toBe(0);
    reduced = false;
    r.frame(1, 0);
    expect(priv(r).windU.mode.value).toBe(1);
    r.dispose();
  });
  it('touches nothing else: the clock, the strength, the heading and the amplitude are what a motion-on frame has', () => {
    const on = setUp({ wind: { strength: 1.7, side: 'west', skewDeg: 20 } });
    const off = setUp({ wind: { strength: 1.7, side: 'west', skewDeg: 20 }, reducedMotion: () => true });
    tickTo(on.sim, 90);
    tickTo(off.sim, 90);
    on.r.frame(0.3, 0);
    off.r.frame(0.3, 0);
    // The mode (index 2) and the disturbers' spring flag (the last number of the last entry) are what reduced motion changes.
    const bits = (r: ThreeRenderer): unknown[] =>
      JSON.parse(windBits(r))
        .filter((_: unknown, i: number) => i !== 2)
        .map((v: unknown, i: number, all: unknown[]) => (i === all.length - 1 ? (v as unknown[]).slice(0, -1) : v));
    expect(bits(off.r)).toEqual(bits(on.r));
    expect(priv(off.r).windU.mode.value).toBe(0);
    expect(priv(on.r).windU.mode.value).toBe(1);
    expect(priv(off.r).disturbU.spring.value).toBe(0);
    expect(priv(on.r).disturbU.spring.value).toBe(1);
    on.r.dispose();
    off.r.dispose();
  });
  it('the `wind` debug layer still owns the amplitude: hide zeroes it, in either mode', () => {
    const { r } = setUp({ reducedMotion: () => true });
    expect(r.setDebugLayerVisible('wind', false)).toBe(1);
    expect(priv(r).sway.amp.value).toBe(0);
    r.frame(1, 0);
    expect(priv(r).sway.amp.value).toBe(0);
    expect(r.setDebugLayerVisible('wind', true)).toBe(1);
    r.dispose();
  });
});

describe('RendererOptions.wind reaches the shader (and only the shader)', () => {
  it('defaults to strength 1 along the old sway axis', () => {
    const { r } = setUp();
    const w = priv(r).windU;
    expect(w.strength.value).toBe(1);
    expect(w.dir.value.x).toBeCloseTo(Math.SQRT1_2, 15);
    expect(w.dir.value.y).toBeCloseTo(-Math.SQRT1_2, 15);
    r.dispose();
  });
  it('takes the map`s strength and heading, clamped to 0..2 and +-30 degrees', () => {
    const { r } = setUp({ wind: { strength: 1.3, side: 'west', skewDeg: 0 } });
    const w = priv(r).windU;
    expect(w.strength.value).toBe(1.3);
    expect(w.dir.value.x).toBeCloseTo(-Math.SQRT1_2, 15);
    expect(w.dir.value.y).toBeCloseTo(Math.SQRT1_2, 15);
    r.dispose();
    const wild = setUp({ wind: { strength: 9, side: 'east', skewDeg: 80 } });
    const ww = priv(wild.r).windU;
    expect(ww.strength.value).toBe(2);
    const along = ww.dir.value.x * Math.SQRT1_2 + ww.dir.value.y * -Math.SQRT1_2;
    expect(Math.acos(along) * (180 / Math.PI)).toBeCloseTo(30, 6);
    wild.r.dispose();
  });
  it('does not touch the sim: same seed and ticks, same state hash with or without a wind', () => {
    const a = setUp({ wind: { strength: 2, side: 'west', skewDeg: 30 } });
    const b = setUp();
    tickTo(a.sim, 80);
    tickTo(b.sim, 80);
    a.r.frame(0.5, 0);
    b.r.frame(0.5, 0);
    expect(a.sim.hash()).toBe(b.sim.hash());
    a.r.dispose();
    b.r.dispose();
  });
  it('a wet map slants its rain along the map`s heading', () => {
    const { r, sim } = setUp({ weather: 'rain', wind: { strength: 1, side: 'west', skewDeg: 0 } });
    tickTo(sim, 5);
    r.frame(0, 0);
    const u = priv(r).rain!.mesh.material.uniforms;
    expect(u.uWindDir.value.x).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(u.uWindDir.value.y).toBeCloseTo(Math.SQRT1_2, 12);
    r.dispose();
  });
});
