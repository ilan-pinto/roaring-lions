/**
 * The rotor wash on vegetation (GH-984 N3), through the real renderer, on the SIM clock.
 *
 *  - a hovering helicopter takes an `air` slot of the shared disturber array: a disc, strength the wash, kind 1;
 *  - the SHIPPED drones (`attack_drone`, soft) take none: they still throw no wash;
 *  - the clock census: `frame(a, 0)`, `frame(a, 16)` and `frame(a, 5000)` at one tick leave every disturber uniform
 *    bit-identical, a paused loop changes none, and two frame histories reaching one tick agree (the falsifier: write the
 *    wash from a frame delta);
 *  - the `wash` debug layer takes the helicopters away and holds across a repaint, the vehicles' `disturb` staying;
 *  - reduced motion: `spring` 0, so the thrash is dropped and the flatten is static, while the slot stays;
 *  - the dust ring's puff speed follows the strength.
 */
import { describe, expect, it, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { DisturbUniformSet } from './terrain/disturb-uniforms';
import { DISTURB_B_STRIDE, DISTURB_REACH, DISTURB_SLOT_WASH } from './terrain/disturb';
import attackDroneJson from '../../../../data/units/kdf/attack_drone.json';
import helicopterJson from '../../../../data/units/kdf/heli_peten.json';
import rotorWash from '../../../../data/vfx/rotor_wash.json';
import type { EmitterSpec } from '../vfx/emitters';

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

const HELI = helicopterJson as unknown as UnitTypeJson;
const DRONE = attackDroneJson as unknown as UnitTypeJson;
const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};

interface Private {
  disturbU: DisturbUniformSet;
  sway: { time: { value: number } };
  particleSystem: { forEachLive(layer: number, cb: (x: number, y: number, c: string, a: number, r: number) => void): void } | null;
  updateRotorWash(alpha: number): void;
}
const priv = (r: ThreeRenderer): Private => r as unknown as Private;

interface World {
  r: ThreeRenderer;
  sim: Sim;
  heli: number;
  tick(n?: number): void;
}

/** A helicopter hovering at (12.5, 12.5) under a camera looking at it; `fly` sends it across the map; `extra` adds a drone and a tank. */
function setUp(extra: Partial<RendererOptions> = {}, opts: { fly?: boolean; drone?: boolean; tank?: boolean } = {}): World {
  const sim = new Sim({ seed: 1, width: 40, height: 24, capacity: 8 });
  const heli = sim.spawn(sim.addUnitType(HELI), 0, fx.from(12.5), fx.from(12.5));
  if (opts.drone) sim.spawn(sim.addUnitType(DRONE), 0, fx.from(13.5), fx.from(12.5));
  if (opts.tank) sim.spawn(sim.addUnitType(TANK), 0, fx.from(10.5), fx.from(14.5));
  const r = new ThreeRenderer(sim, makeOpts(extra));
  r.setDecor(new Uint8Array(40 * 24));
  r.camera.x = 12;
  r.camera.y = 12;
  r.snapshot();
  r.frame(1, 0);
  if (opts.fly) sim.queueCommand({ kind: 'move', ids: [heli], x: fx.from(16.5), y: fx.from(12.5) });
  return {
    r,
    sim,
    heli,
    tick(n = 1): void {
      for (let i = 0; i < n; i++) {
        sim.tick();
        r.snapshot();
      }
    },
  };
}

/** Every disturbance number a shader reads, as exact bits. */
function bits(r: ThreeRenderer): string {
  const u = priv(r).disturbU;
  return JSON.stringify([
    Array.from(u.a.value), Array.from(u.b.value), Array.from(u.box.value.toArray()), u.n.value, u.amp.value, u.spring.value,
    priv(r).sway.time.value,
  ]);
}
const slotKind = (r: ThreeRenderer, k: number): number => priv(r).disturbU.b.value[DISTURB_B_STRIDE * k + 2];
const slotStrength = (r: ThreeRenderer, k: number): number => priv(r).disturbU.b.value[DISTURB_B_STRIDE * k + 1];
const slotReach = (r: ThreeRenderer, k: number): number => priv(r).disturbU.b.value[DISTURB_B_STRIDE * k] * DISTURB_REACH;

describe('a hovering helicopter takes a wash slot (GH-984 N3)', () => {
  it('a disc at the hull, strength the hover wash (0.76), reach R0 x (1.5 + hNorm) = 2 x 1.738 tiles, kind 1', () => {
    const w = setUp();
    w.tick(20);
    w.r.frame(0.5, 16);
    const u = priv(w.r).disturbU;
    expect(u.n.value).toBe(1);
    expect(slotKind(w.r, 0)).toBe(DISTURB_SLOT_WASH);
    // Literals: the drawn hover lift is 0.357 wu, the none-height 1.5: strength 1 - 0.357/1.5, hNorm 0.238.
    expect(slotStrength(w.r, 0)).toBeCloseTo(0.762, 2);
    expect(slotReach(w.r, 0)).toBeCloseTo(2 * (1.5 + 0.238), 2);
    const a = Array.from(u.a.value).slice(0, 4);
    expect(a[0]).toBeCloseTo(12.5, 3);
    expect(a[0]).toBe(a[2]);
    expect(a[1]).toBe(a[3]);
    w.r.dispose();
  });

  it('a drone throws no wash: the shipped attack_drone is soft, so only the helicopter and a tank take slots', () => {
    const w = setUp({}, { drone: true, tank: true });
    w.tick(20);
    w.r.frame(0.5, 16);
    expect(priv(w.r).disturbU.n.value).toBe(2);
    const kinds = [slotKind(w.r, 0), slotKind(w.r, 1)].sort();
    expect(kinds).toEqual([0, 1]);
    w.r.dispose();
  });

  it('the wash follows the aircraft across the map, tick-exact speed thinning it', () => {
    const w = setUp({}, { fly: true });
    w.tick(2);
    w.r.frame(1, 16);
    const x0 = priv(w.r).disturbU.a.value[0];
    w.tick(12);
    w.r.frame(1, 16);
    expect(priv(w.r).disturbU.a.value[0]).toBeGreaterThan(x0 + 1.5);
    // Forward flight carries the downwash aft: weaker than the hover's 0.762.
    expect(slotStrength(w.r, 0)).toBeLessThan(0.7);
    expect(slotStrength(w.r, 0)).toBeGreaterThan(0.38);
    w.r.dispose();
  });
});

describe('the clock census covers the air disturbers (GH-984 N3)', () => {
  it('frame(a,0), frame(a,16) and frame(a,5000) at one tick leave the uniforms bit-identical, a paused loop changes none', () => {
    const w = setUp({}, { fly: true });
    w.tick(12);
    w.r.frame(0.4, 0);
    const base = bits(w.r);
    expect(JSON.parse(base)[3], 'the wash is live, so the bits compared are not an empty array').toBeGreaterThanOrEqual(1);
    expect(slotKind(w.r, 0)).toBe(DISTURB_SLOT_WASH);
    w.r.frame(0.4, 16);
    expect(bits(w.r)).toBe(base);
    w.r.frame(0.4, 5000);
    expect(bits(w.r)).toBe(base);
    for (let i = 0; i < 10; i++) w.r.frame(0.4, 16 + i * 1000);
    expect(bits(w.r)).toBe(base);
    w.r.dispose();
  });

  it('two frame histories that reach one tick agree, and a tick moves it (anti-vacuity)', () => {
    const a = setUp({}, { fly: true });
    const b = setUp({}, { fly: true });
    for (let t = 0; t < 12; t++) {
      a.tick();
      for (const alpha of [0.2, 0.6, 0.95]) a.r.frame(alpha, 16 + t);
    }
    b.tick(12);
    a.r.frame(0.3, 3);
    b.r.frame(0.3, 4000);
    expect(bits(a.r)).toBe(bits(b.r));
    const before = bits(b.r);
    b.tick(1);
    b.r.frame(0.3, 0);
    expect(bits(b.r)).not.toBe(before);
    a.r.dispose();
    b.r.dispose();
  });

  it('the thrash reads the sim clock: the shader\'s time is the wind\'s, written from presentationSimMs (no frame delta in it)', () => {
    const w = setUp();
    w.tick(30);
    w.r.frame(0.5, 16);
    const t = priv(w.r).sway.time.value;
    w.r.frame(0.5, 9000);
    expect(priv(w.r).sway.time.value).toBe(t);
    w.tick(1);
    w.r.frame(0.5, 16);
    expect(priv(w.r).sway.time.value).toBeCloseTo(t + 0.05, 9);
    w.r.dispose();
  });
});

describe('the wash layer and reduced motion', () => {
  it('the wash layer takes the helicopters away and gives them back, holds across a repaint, and leaves the vehicles', () => {
    const w = setUp({}, { tank: true });
    w.tick(20);
    w.r.frame(0.5, 16);
    expect(priv(w.r).disturbU.n.value).toBe(2);
    expect(w.r.setDebugLayerVisible('wash', false)).toBe(1);
    expect(w.r.setDebugLayerVisible('wash', false)).toBe(0);
    w.r.frame(1, 0);
    w.r.frame(1, 0);
    expect(priv(w.r).disturbU.n.value).toBe(1);
    expect(slotKind(w.r, 0)).toBe(0);
    expect(w.r.setDebugLayerVisible('wash', true)).toBe(1);
    w.r.frame(1, 0);
    expect(priv(w.r).disturbU.n.value).toBe(2);
    w.r.dispose();
  });

  it('reduced motion: spring 0 (no thrash, the flatten static) and the wash slot stays; back to 1 when asked again', () => {
    let reduced = false;
    const w = setUp({ reducedMotion: () => reduced });
    w.tick(10);
    w.r.frame(1, 16);
    expect(priv(w.r).disturbU.spring.value).toBe(1);
    reduced = true;
    w.r.frame(1, 16);
    expect(priv(w.r).disturbU.spring.value).toBe(0);
    expect(priv(w.r).disturbU.n.value).toBe(1);
    expect(slotStrength(w.r, 0)).toBeGreaterThan(0.7);
    reduced = false;
    w.r.frame(1, 16);
    expect(priv(w.r).disturbU.spring.value).toBe(1);
    w.r.dispose();
  });
});

describe('the dust ring follows the strength', () => {
  /** The speeds of the puffs `updateRotorWash` just threw (their distance from the hub after the first frames of life are speed x age). */
  function ringRadius(): number {
    const w = setUp();
    w.r.useEmitters([rotorWash as unknown as EmitterSpec], () => '#8E9491');
    w.tick(30);
    priv(w.r).updateRotorWash(1);
    let far = 0;
    let n = 0;
    for (let layer = 0; layer < 4; layer++) {
      priv(w.r).particleSystem?.forEachLive(layer, (x, y) => {
        far = Math.max(far, Math.hypot(x - 12.5, y - 12.5));
        n++;
      });
    }
    w.r.dispose();
    expect(n, 'puffs exist').toBeGreaterThan(0);
    return far;
  }
  it('throws a ring of a measurable radius (the speed multiplier acts on it: see the particle test)', () => {
    expect(ringRadius()).toBeGreaterThan(0.05);
  });
});
