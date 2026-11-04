/**
 * Vehicles bend the vegetation (GH-984 N2) on the SIM clock, through the real renderer.
 *
 *  - the wake is built from the TICK ring: two frame cadences that reach the same tick leave the disturber
 *    uniforms bit-identical (the falsifier: record the ring from `frame()` instead of `snapshot()`);
 *  - the head is `lerp(prev, cur, alpha)` of the sim, not the drawn hull (the weight model's lag is per frame);
 *  - the preset sets the slot budget, wakes and foot; the `disturb` layer holds across a repaint;
 *  - reduced motion: the bend is a static displacement (no spring) and no clods;
 *  - churn and clods: a pivot and a launch stamp `churn` decals dated at their tick and spawn clods once,
 *    aged by sim time, none on a zero-time repaint, none under `fxDetail` 0.
 */
import { describe, expect, it, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { QUALITY_PRESETS } from '../quality';
import { ThreeRenderer } from './ThreeRenderer';
import type { DisturbUniformSet } from './terrain/disturb-uniforms';
import vehicleClods from '../../../../data/vfx/vehicle_clods.json';
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

const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};
const RIFLES: UnitTypeJson = {
  id: 'inf_squad',
  role: 'infantry',
  hull: { hp: 100, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 1.4 },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
};

interface Private {
  disturbU: DisturbUniformSet;
  disturbField: { count: number; ring: { seeded(e: number): boolean } };
  stampGroundDecal(s: { kind: string; simMs: number }): boolean;
  particleSystem: {
    forEachLive(layer: number, cb: (x: number, y: number, c: string, a: number, r: number) => void): void;
    spawn(...a: unknown[]): void;
  } | null;
}
const priv = (r: ThreeRenderer): Private => r as unknown as Private;

interface World {
  r: ThreeRenderer;
  sim: Sim;
  tank: number;
  men: number;
  /** One sim tick the way `main.ts` runs it: sim.tick(), then renderer.snapshot(). */
  tick(n?: number): void;
}

function setUp(extra: Partial<RendererOptions> = {}, opts: { go?: boolean; men?: number } = {}): World {
  const sim = new Sim({ seed: 1, width: 40, height: 24, capacity: 16 });
  const tank = sim.spawn(sim.addUnitType(TANK), 0, fx.from(5.5), fx.from(11.5));
  const manType = sim.addUnitType(RIFLES);
  let men = -1;
  for (let k = 0; k < (opts.men ?? 1); k++) men = sim.spawn(manType, 0, fx.from(8.5 + k), fx.from(12.5));
  const r = new ThreeRenderer(sim, makeOpts(extra));
  r.setDecor(new Uint8Array(40 * 24));
  r.camera.x = 12;
  r.camera.y = 12;
  r.snapshot();
  r.frame(1, 0);
  if (opts.go !== false) sim.queueCommand({ kind: 'move', ids: [tank], x: fx.from(34.5), y: fx.from(11.5) });
  return {
    r,
    sim,
    tank,
    men,
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
  ]);
}

describe('the wake is built from the tick ring (GH-984 N2)', () => {
  it('two frame cadences that reach one tick leave the disturber uniforms bit-identical', () => {
    const a = setUp();
    const b = setUp();
    // A: sixty-ish frames a second, uneven, every tick. B: one frame at the very end.
    for (let t = 0; t < 75; t++) {
      a.tick();
      for (const alpha of [0.2, 0.55, 0.9]) a.r.frame(alpha, 16 + t);
    }
    b.tick(75);
    a.r.frame(0.4, 3);
    b.r.frame(0.4, 5000);
    const wake = JSON.parse(bits(a.r)) as [number[], number[], number[], number];
    expect(bits(a.r)).toBe(bits(b.r));
    // Anti-vacuity: it is a moving hull's real wake, not an empty array.
    expect(wake[3]).toBeGreaterThanOrEqual(1);
    const [hx, hz, tx, tz] = wake[0];
    expect(Math.hypot(hx - tx, hz - tz)).toBeGreaterThan(1.2); // 1.5 s at 1.1 tiles/s = 1.65 tiles
    a.r.dispose();
    b.r.dispose();
  });

  it('the ring is written by snapshot() and by nothing a frame can reach', () => {
    const w = setUp();
    expect(priv(w.r).disturbField.ring.seeded(w.tank)).toBe(true);
    // A world that frames a lot but whose snapshot never runs has no wake: frames alone cannot build one.
    const sim = new Sim({ seed: 1, width: 40, height: 24, capacity: 4 });
    const t = sim.spawn(sim.addUnitType(TANK), 0, fx.from(5.5), fx.from(11.5));
    const r = new ThreeRenderer(sim, makeOpts());
    r.setDecor(new Uint8Array(40 * 24));
    r.camera.x = 12;
    r.camera.y = 12;
    sim.queueCommand({ kind: 'move', ids: [t], x: fx.from(34.5), y: fx.from(11.5) });
    for (let i = 0; i < 60; i++) {
      sim.tick();
      r.frame(1, 16);
    }
    expect(priv(r).disturbField.ring.seeded(t)).toBe(false);
    r.dispose();
    w.r.dispose();
  });

  it('the head is the sim`s interpolated position, lerp(prev, cur, alpha), at the moment of the frame', () => {
    const w = setUp();
    w.tick(40);
    const px = fx.toNumber(w.sim.state.posX[w.tank]);
    w.r.frame(1, 16);
    const at1 = Array.from(priv(w.r).disturbU.a.value).slice(0, 4);
    // alpha 1 is the sim's own position.
    expect(at1[0]).toBeCloseTo(px, 4);
    w.r.frame(0, 16);
    const at0 = Array.from(priv(w.r).disturbU.a.value).slice(0, 4);
    // One tick earlier at 1.1 tiles/s: 0.055 tile.
    expect(at1[0] - at0[0]).toBeCloseTo(1.1 / 20, 3);
    w.r.frame(0.5, 16);
    expect(priv(w.r).disturbU.a.value[0]).toBeCloseTo((at0[0] + at1[0]) / 2, 4);
    w.r.dispose();
  });

  it('a zero-time repaint, a long frame and a paused loop change nothing', () => {
    const w = setUp();
    w.tick(60);
    w.r.frame(0.5, 0);
    const base = bits(w.r);
    for (const dt of [0, 16, 5000]) {
      w.r.frame(0.5, dt);
      expect(bits(w.r)).toBe(base);
    }
    w.tick(1);
    w.r.frame(0.5, 0);
    expect(bits(w.r), 'a tick moves it (the census is not comparing constants)').not.toBe(base);
    w.r.dispose();
  });
});

describe('the budget by preset and the layer', () => {
  const slotsAfter = (quality: keyof typeof QUALITY_PRESETS): { n: number; box: number[]; tail: number[] } => {
    const w = setUp({ quality: QUALITY_PRESETS[quality] }, { men: 4 });
    w.tick(60);
    w.r.frame(0.5, 16);
    const u = priv(w.r).disturbU;
    const out = { n: u.n.value, box: Array.from(u.box.value.toArray()), tail: Array.from(u.a.value).slice(0, 4) };
    w.r.dispose();
    return out;
  };
  it('high: the hull and the men; medium: the hull alone, with its wake; low: the hull as a disc', () => {
    expect(slotsAfter('high').n).toBe(5);
    const med = slotsAfter('medium');
    expect(med.n).toBe(1);
    expect(Math.hypot(med.tail[0] - med.tail[2], med.tail[1] - med.tail[3])).toBeGreaterThan(1.2);
    const low = slotsAfter('low');
    expect(low.n).toBe(1);
    expect(low.tail[0]).toBe(low.tail[2]);
    expect(low.tail[1]).toBe(low.tail[3]);
  });
  it('a zero-slot preset loops over nothing', () => {
    const w = setUp({ quality: { ...QUALITY_PRESETS.high, nature: { slots: 0, wakes: true, foot: true } } });
    w.tick(30);
    w.r.frame(0.5, 16);
    expect(priv(w.r).disturbU.n.value).toBe(0);
    w.r.dispose();
  });
  it('the disturb layer drives the amplitude to 0 and back, holds across a repaint, and the frame skips its work meanwhile', () => {
    const w = setUp();
    w.tick(30);
    w.r.frame(0.5, 16);
    expect(priv(w.r).disturbU.n.value).toBeGreaterThan(0);
    expect(w.r.setDebugLayerVisible('disturb', false)).toBe(1);
    expect(priv(w.r).disturbU.amp.value).toBe(0);
    expect(w.r.setDebugLayerVisible('disturb', false)).toBe(0);
    w.r.frame(1, 0);
    expect(priv(w.r).disturbU.amp.value).toBe(0);
    expect(priv(w.r).disturbU.n.value).toBe(0);
    expect(w.r.setDebugLayerVisible('disturb', true)).toBe(1);
    w.r.frame(1, 0);
    expect(priv(w.r).disturbU.n.value).toBeGreaterThan(0);
    w.r.dispose();
  });
  it('hides a hull the viewer cannot see (a versus seat gets no bend from a hidden enemy)', () => {
    const w = setUp({ viewerSide: 1, versus: true });
    w.tick(30);
    w.r.frame(0.5, 16);
    // Side 0's tank is outside side 1's sight: no disturber for it.
    expect(priv(w.r).disturbU.n.value).toBe(0);
    w.r.dispose();
  });
});

describe('reduced motion: a static displacement and no clods', () => {
  it('spring is 1 in motion and 0 under reduced motion, asked live', () => {
    let reduced = false;
    const w = setUp({ reducedMotion: () => reduced });
    w.tick(10);
    w.r.frame(1, 16);
    expect(priv(w.r).disturbU.spring.value).toBe(1);
    reduced = true;
    w.r.frame(1, 16);
    expect(priv(w.r).disturbU.spring.value).toBe(0);
    // It still bends (the displacement stays), and it is the same wake.
    expect(priv(w.r).disturbU.n.value).toBeGreaterThan(0);
    reduced = false;
    w.r.frame(1, 16);
    expect(priv(w.r).disturbU.spring.value).toBe(1);
    w.r.dispose();
  });
});

describe('churn and clods', () => {
  /** A tank turning on the spot: stopped, its heading advancing 0.01 turn a tick (0.2 turn/s). */
  function pivotWorld(extra: Partial<RendererOptions> = {}) {
    const w = setUp(extra, { go: false });
    const stamps: { kind: string; simMs: number }[] = [];
    const p = priv(w.r);
    const orig = p.stampGroundDecal.bind(w.r);
    p.stampGroundDecal = (s) => {
      stamps.push({ kind: s.kind, simMs: s.simMs });
      return orig(s);
    };
    w.r.useEmitters([vehicleClods as unknown as EmitterSpec], () => '#8E9491');
    // Stand still for 8 ticks first, then turn.
    w.tick(8);
    let turns = 0;
    const turn = (n: number): void => {
      for (let i = 0; i < n; i++) {
        turns += 0.01;
        w.sim.state.facing[w.tank] = fx.from(turns % 1);
        w.r.snapshot();
        w.sim.tick(); // the sim leaves a stopped hull's heading alone with no order
        w.sim.state.facing[w.tank] = fx.from(turns % 1);
      }
    };
    return { w, stamps, turn, p };
  }
  /** The live particles with position LAST, sorted by what does not depend on position, so two histories pair off. */
  const liveRows = (r: ThreeRenderer): { key: string; x: number; y: number }[] => {
    const rows: { key: string; x: number; y: number }[] = [];
    const sys = priv(r).particleSystem;
    if (!sys) throw new Error('no particle system');
    for (let layer = 0; layer < 4; layer++) sys.forEachLive(layer, (x, y, c, a, rad) => rows.push({ key: [layer, c, a.toFixed(6), rad.toFixed(6)].join(','), x, y }));
    return rows.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  };
  const live = (r: ThreeRenderer): string => {
    const rows: string[] = [];
    const sys = priv(r).particleSystem;
    if (!sys) throw new Error('no particle system');
    for (let layer = 0; layer < 4; layer++) sys.forEachLive(layer, (x, y, c, a, rad) => rows.push([layer, x, y, c, a, rad].map((v) => (typeof v === 'number' ? v.toFixed(6) : v)).join(',')));
    return rows.sort().join('\n');
  };

  it('a pivot stamps churn into the fading pool, dated at its tick, two a scuff (one under each track)', () => {
    const { w, stamps, turn } = pivotWorld();
    turn(30);
    const churn = stamps.filter((s) => s.kind === 'churn');
    expect(churn.length, 'a pivot of 30 ticks: first at the 4th, then every 10th').toBeGreaterThanOrEqual(6);
    expect(churn.length % 2).toBe(0);
    for (const s of churn) expect(s.simMs % 50).toBe(0);
    w.r.dispose();
  });

  it('a hull that is not pivoting or launching stamps no churn', () => {
    const { w, stamps } = pivotWorld();
    w.tick(60); // standing still, no turn
    expect(stamps.filter((s) => s.kind === 'churn')).toHaveLength(0);
    w.r.dispose();
  });

  it('a launch from a halt stamps churn behind the hull, once', () => {
    const w = setUp({}, { go: false });
    const stamps: string[] = [];
    const p = priv(w.r);
    const orig = p.stampGroundDecal.bind(w.r);
    p.stampGroundDecal = (s) => {
      stamps.push(s.kind);
      return orig(s);
    };
    w.tick(10); // standing
    w.sim.queueCommand({ kind: 'move', ids: [w.tank], x: fx.from(34.5), y: fx.from(11.5) });
    w.tick(40);
    expect(stamps.filter((k) => k === 'churn').length).toBe(2);
    w.r.dispose();
  });

  it('clods spawn once per event, aged by sim time, and a zero-time repaint adds none', () => {
    const { w, turn } = pivotWorld();
    turn(8);
    w.r.frame(1, 16);
    const first = live(w.r);
    expect(first, 'the burst is in the particle pool').not.toBe('');
    w.r.frame(1, 0);
    w.r.frame(1, 0);
    expect(live(w.r)).toBe(first);
    w.r.dispose();
  });

  it('the same sim time reached by two frame histories leaves the same clods', () => {
    const a = pivotWorld();
    const b = pivotWorld();
    a.turn(14);
    b.turn(14);
    for (const alpha of [0.1, 0.4, 0.8, 1]) a.w.r.frame(alpha, 16);
    b.w.r.frame(1, 700);
    for (const alpha of [1]) {
      a.w.r.frame(alpha, 0);
      b.w.r.frame(alpha, 0);
    }
    const ra = liveRows(a.w.r);
    const rb = liveRows(b.w.r);
    expect(ra.length).toBeGreaterThan(0);
    // The particle integrator steps in 50 ms sub-steps whatever the frames were, so positions agree to a hair
    // (not to the bit, as they cannot for any emitter); the count, the colours, the alphas and the sizes are exact.
    expect(rb.map((p) => p.key)).toEqual(ra.map((p) => p.key));
    for (let i = 0; i < ra.length; i++) {
      expect(Math.abs(ra[i].x - rb[i].x)).toBeLessThan(0.01);
      expect(Math.abs(ra[i].y - rb[i].y)).toBeLessThan(0.01);
    }
    a.w.r.dispose();
    b.w.r.dispose();
  });

  it('reduced motion spawns no clods; the churn decal is still stamped', () => {
    const { w, stamps, turn } = pivotWorld({ reducedMotion: () => true });
    turn(14);
    w.r.frame(1, 16);
    expect(live(w.r)).toBe('');
    expect(stamps.filter((s) => s.kind === 'churn').length).toBeGreaterThan(0);
    w.r.dispose();
  });

  it('fxDetail 0 (low) spawns no clods', () => {
    const { w, turn } = pivotWorld({ quality: QUALITY_PRESETS.low });
    turn(14);
    w.r.frame(1, 16);
    expect(live(w.r)).toBe('');
    w.r.dispose();
  });

  it('an event a frame sees too late (a jump of ticks) spawns nothing, and is not replayed', () => {
    const { w, turn } = pivotWorld();
    turn(8);
    w.tick(80); // 4 s of ticks with no frame: the burst is long dead
    w.r.frame(1, 16);
    expect(live(w.r)).toBe('');
    w.r.dispose();
  });
});
