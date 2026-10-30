/**
 * The wet ground, wired into the renderer (GH-871 P4 Task 4).
 *
 * `terrain/mesh.test.ts` pins the GLSL and `terrain/wet-shading.test.ts` its
 * TS mirror; this file pins what only the renderer does:
 *
 *  - the ground material is the WET program under `weather: 'rain'` and today's
 *    under every other weather (the class field became a constructor line);
 *  - control C is baked, bound and KEPT: after the first build, across a
 *    redundant rebuild (no second bake), and across a collapse that splices
 *    (the bound bytes equal a full wet build). The surface goes to all five
 *    control-map calls, and dropping it from any one is red here;
 *  - `uWetSky` and `uWetRim` are the palette's linear colours, as literals;
 *  - the ripples run on the SIM clock: two `frame(1, 0)` at one tick read the
 *    same `uRippleTimeSec`, wall-clock time passing moves nothing, a tick does;
 *  - the three debug layers (`wet`, `marsh`, `ripples`), the `ripples` one
 *    behind a flag the per-frame write consults;
 *  - `debugSetWetTuning` writes the two reflectances, on the class only.
 *
 * Harness: a faked `WebGLRenderer`, a real `Sim`, `frame()` driving the rebuild
 * the way the app does (`ThreeRenderer.ground-control.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { GroundMaterial } from './terrain/mesh';
import { DECOR_MARSH, DECOR_ROAD } from './terrain/shared';
import { buildControlMap } from './terrain/control-map';
import type { TerrainInput } from './terrain/types';
import type { TerrainSurface } from './terrain/surface';
import type { ControlMap } from './terrain/control-map';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const builds = vi.hoisted(() => ({ control: 0, graph: 0 }));
vi.mock('./terrain/control-map', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./terrain/control-map')>();
  return {
    ...actual,
    buildControlMap: (...args: Parameters<typeof actual.buildControlMap>) => {
      builds.control++;
      return actual.buildControlMap(...args);
    },
  };
});

vi.mock('./terrain/road-graph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./terrain/road-graph')>();
  return {
    ...actual,
    buildRoadGraph: (...args: Parameters<typeof actual.buildRoadGraph>) => {
      builds.graph++;
      return actual.buildRoadGraph(...args);
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
  groundMat: GroundMaterial;
  controlMap: ControlMap | null;
  controlTex: { a: THREE.DataTexture; b: THREE.DataTexture; c: THREE.DataTexture | null } | null;
  terrainState: { surface: TerrainSurface } | null;
  decalGround: { input: TerrainInput } | null;
  terrainDirty: boolean;
}
const priv = (r: ThreeRenderer): Private => r as unknown as Private;

const MAP = 24;
/** A flat tile off the road and the water: a collapse there SPLICES (a pad
 *  becoming rubble), and moves no byte of C on a flat map. */
const FLAT_HUT = 5 * MAP + 5;
/**
 * The relief map: three terraces rising with x (levels 0, 1/2, 3). A hut at
 * tile (12, 3) stands on a step; its collapse reflows the smoothing field and
 * moves 12 bytes of C, and still splices (a scan of the candidates, in the T4
 * report, found 5 to 14 bytes at x = 12, 15 and 16). On the flat map a collapse
 * moves none, which would make a splice test vacuous.
 */
const RELIEF_HUT = 3 * MAP + 12;
const reliefLevels = (): Uint8Array => {
  const e = new Uint8Array(MAP * MAP);
  for (let z = 0; z < MAP; z++) for (let x = 0; x < MAP; x++) e[z * MAP + x] = x < 8 ? 0 : x < 16 ? 1 + ((x - 8) >> 2) : 3;
  return e;
};

/** A 24x24 map with a road across row 12, a marsh block of 8x8 tiles and a
 *  hut on `hut` -- so there is a road, water and a structure to collapse. */
function setUp(
  extra: Partial<RendererOptions> = {},
  world: { hut?: number; relief?: boolean } = {}
): { r: ThreeRenderer; sim: Sim } {
  const sim = new Sim({ seed: 1, width: MAP, height: MAP, capacity: 4 });
  const hut = sim.addStructureType({ id: 'hut', hp_per_tile: 80, height_px: 14, color: 'dust.1' });
  sim.addStructure(hut, [world.hut ?? FLAT_HUT]);
  const r = new ThreeRenderer(sim, makeOpts(extra));
  const decor = new Uint8Array(MAP * MAP);
  for (let x = 0; x < MAP; x++) decor[12 * MAP + x] = DECOR_ROAD;
  for (let z = 15; z < 23; z++) for (let x = 14; x < 22; x++) decor[z * MAP + x] = DECOR_MARSH;
  r.setDecor(decor);
  if (world.relief === true) r.setElevation(reliefLevels());
  r.frame(1, 0);
  return { r, sim };
}

const RAIN = { weather: 'rain' } as const;

function bytesDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

describe('the ground material is the wet program under rain, and today`s elsewhere', () => {
  it.each([[undefined], [{ weather: 'clear' as const }]])('is the dry program for %j', (extra) => {
    const { r } = setUp(extra ?? {});
    const g = priv(r).groundMat;
    expect(g.wet).toBe(false);
    expect(g.customProgramCacheKey()).toBe('rl-ground');
    expect(g.defines).toEqual({ STANDARD: '' });
    expect(g.uniforms.uControlC).toBeUndefined();
    // No control C is baked or bound on a dry map, and it rebuilt through the same calls.
    expect(priv(r).controlMap?.c).toBeNull();
    expect(priv(r).controlTex?.c).toBeNull();
    r.dispose();
  });
  it('is the wet program for weather: rain', () => {
    const { r } = setUp(RAIN);
    const g = priv(r).groundMat;
    expect(g.wet).toBe(true);
    expect(g.customProgramCacheKey()).toBe('rl-ground-wet');
    expect(g.defines).toEqual({ STANDARD: '', THEME_WET: '' });
    expect(g.uniforms.uControlC).toBeDefined();
    r.dispose();
  });
});

describe('control C is baked, bound and kept (the surface reaches all five control-map calls)', () => {
  it('binds the baked C after the first build, with water and puddles in it', () => {
    builds.control = 0;
    const { r } = setUp(RAIN);
    const p = priv(r);
    expect(builds.control).toBe(1);
    expect(p.controlMap?.c).not.toBeNull();
    const bound = p.groundMat.uniforms.uControlC.value as THREE.DataTexture;
    expect(bound).toBe(p.controlTex?.c);
    expect(bound.image.width).toBe(MAP * 8);
    expect(bound.image.height).toBe(MAP * 8);
    // The very bytes of the map: the texture was made over them.
    expect(bound.image.data).toEqual(p.controlMap!.c);
    const c = p.controlMap!.c as Uint8Array;
    let marsh = 0;
    let puddle = 0;
    for (let i = 0; i < c.length; i += 4) {
      if (c[i] >= 128) marsh++;
      if (c[i + 1] >= 128) puddle++;
    }
    expect(marsh, 'the marsh has water texels').toBeGreaterThan(300);
    expect(puddle, 'the road has puddle texels').toBeGreaterThan(30);
    // And it is what a full wet bake of the same world says.
    const fresh = buildControlMap(p.decalGround!.input, p.terrainState!.surface);
    expect(p.decalGround!.input.wet).toBe(true);
    expect(bytesDiff(c, fresh.c as Uint8Array)).toBe(0);
    r.dispose();
  });

  it('does not bake it a second time for a rebuild that changes none of its inputs', () => {
    builds.control = 0;
    const { r } = setUp(RAIN);
    expect(builds.control).toBe(1);
    const p = priv(r);
    const bound = p.groundMat.uniforms.uControlC.value;
    const graphs = builds.graph;
    expect(graphs).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) {
      p.terrainDirty = true;
      r.frame(1, 0);
    }
    // `controlInputsMatch` and `snapshotControlInputs` were given the surface:
    // a wet snapshot compared against a surface-less match would never agree,
    // and the rebuild would run (the road graph is the visible cost: a reused
    // control map reuses its graph too).
    expect(builds.control).toBe(1);
    expect(builds.graph).toBe(graphs);
    expect(p.groundMat.uniforms.uControlC.value).toBe(bound);
    r.dispose();
  });

  /** Collapses structure 0 and reports what the rebuild did to the bound C. */
  function collapse(world: { hut: number; relief?: boolean }): {
    full: boolean;
    texels: number;
    sameTexture: boolean;
    uploaded: boolean;
    builds: number;
    wrongBytes: number;
    movedBytes: number;
  } {
    builds.control = 0;
    const { r, sim } = setUp(RAIN, world);
    const p = priv(r);
    const bound = p.groundMat.uniforms.uControlC.value as THREE.DataTexture;
    const versionBefore = bound.version;
    const before = (p.controlMap!.c as Uint8Array).slice();
    sim.debugDestroyStructure(0);
    r.applyStructureDestroyed(0);
    r.frame(1, 0);
    const { texels, full } = r.debugTerrainRebuild();
    const bakes = builds.control; // before the oracle's own full build below counts
    const after = p.controlMap!.c as Uint8Array;
    const fresh = buildControlMap(p.decalGround!.input, p.terrainState!.surface);
    const out = {
      full,
      texels,
      sameTexture: p.groundMat.uniforms.uControlC.value === bound,
      uploaded: bound.version > versionBefore,
      builds: bakes,
      wrongBytes: bytesDiff(after, fresh.c as Uint8Array),
      movedBytes: bytesDiff(after, before),
    };
    r.dispose();
    return out;
  }

  it('a collapse on a flat map splices C (no second bake), in the texture already bound, to the full build`s bytes', () => {
    const c = collapse({ hut: FLAT_HUT });
    // A splice, not a second bake: the hut's tile and a margin, nowhere else.
    expect(c.full).toBe(false);
    expect(c.texels).toBeGreaterThan(0);
    expect(c.texels).toBeLessThan(MAP * MAP * 64);
    expect(c.builds).toBe(1);
    // The same texture, flagged for upload, over bytes that equal a full build of the new world.
    expect(c.sameTexture).toBe(true);
    expect(c.uploaded).toBe(true);
    expect(c.wrongBytes).toBe(0);
  });

  it('a collapse that reflows the relief rewrites C around it: the spliced bytes are the full build`s, and they MOVED', () => {
    const c = collapse({ hut: RELIEF_HUT, relief: true });
    expect(c.full).toBe(false);
    expect(c.builds).toBe(1);
    expect(c.sameTexture).toBe(true);
    expect(c.uploaded).toBe(true);
    expect(c.wrongBytes).toBe(0);
    // Non-vacuous: the collapse changed C, so equal-to-full is a claim about the splice.
    expect(c.movedBytes).toBeGreaterThan(0);
  });
});

describe('the water`s palette colours, linear', () => {
  it('uWetSky is overcast.0 x the rain hazeRadiance, uWetRim is mud.3 -- literals worked by hand', () => {
    const { r } = setUp(RAIN);
    const u = priv(r).groundMat.uniforms;
    // overcast.0 #C4C8C9 linear = (0.552011, 0.577580, 0.584078); hazeRadiance of the
    // rain lights = (2.6 x 0.46 x 0.818823 + 0.9 x 1.5) / pi = 0.741443.
    const sky = (u.uWetSky.value as THREE.Vector3).toArray();
    expect(sky[0]).toBeCloseTo(0.409285, 5);
    expect(sky[1]).toBeCloseTo(0.428243, 5);
    expect(sky[2]).toBeCloseTo(0.433061, 5);
    // mud.3 #413327 linear.
    const rim = (u.uWetRim.value as THREE.Vector3).toArray();
    expect(rim[0]).toBeCloseTo(0.052861, 5);
    expect(rim[1]).toBeCloseTo(0.033105, 5);
    expect(rim[2]).toBeCloseTo(0.020289, 5);
    r.dispose();
  });
});

describe('the ripples run on the SIM clock', () => {
  it('two frame(1, 0) at one tick read the same time, wall-clock passing moves nothing, a tick does', () => {
    const { r, sim } = setUp(RAIN);
    const u = priv(r).groundMat.uniforms;
    for (let k = 0; k < 10; k++) sim.tick();
    r.frame(1, 0);
    const at = u.uRippleTimeSec.value as number;
    // presentationSimMs(10, 1) = 10 x 50 ms.
    expect(at).toBeCloseTo(0.5, 12);
    // Let real time pass: a clock read from performance.now() would move.
    const t0 = performance.now();
    while (performance.now() - t0 < 3) {
      /* spin: wall-clock time must pass between the two repaints */
    }
    r.frame(1, 0);
    expect(u.uRippleTimeSec.value).toBe(at);
    r.frame(1, 5000);
    expect(u.uRippleTimeSec.value).toBe(at);
    sim.tick();
    r.frame(1, 0);
    expect(u.uRippleTimeSec.value).toBeCloseTo(at + 0.05, 12);
    r.dispose();
  });
  it('is up by default, and off when the preset says ripples: false (quality.rain, Task 8)', () => {
    const on = setUp(RAIN);
    expect(priv(on.r).groundMat.uniforms.uRippleAmp.value).toBe(1);
    on.r.dispose();
    const quality = { colorVision: 'default', rain: { drops: 1500, ripples: false, openPuddles: true } } as unknown as RendererOptions['quality'];
    const off = setUp({ ...RAIN, quality });
    off.r.frame(1, 0);
    expect(priv(off.r).groundMat.uniforms.uRippleAmp.value).toBe(0);
    off.r.dispose();
  });
});

describe('the wet, marsh and ripples debug layers', () => {
  it('wet and marsh: stash 0 and back, idempotent, and a repaint does not undo them', () => {
    const { r } = setUp(RAIN);
    const u = priv(r).groundMat.uniforms;
    expect(r.setDebugLayerVisible('wet', false)).toBe(1);
    expect(u.uWetAmp.value).toBe(0);
    expect(r.setDebugLayerVisible('wet', false)).toBe(0);
    r.frame(1, 0);
    expect(u.uWetAmp.value).toBe(0);
    expect(r.setDebugLayerVisible('wet', true)).toBe(1);
    expect(u.uWetAmp.value).toBe(1);
    expect(r.setDebugLayerVisible('marsh', false)).toBe(1);
    expect(u.uMarshAmp.value).toBe(0);
    expect(u.uWetAmp.value, 'marsh leaves the puddles').toBe(1);
    expect(r.setDebugLayerVisible('marsh', false)).toBe(0);
    r.frame(1, 0);
    expect(u.uMarshAmp.value).toBe(0);
    expect(r.setDebugLayerVisible('marsh', true)).toBe(1);
    expect(u.uMarshAmp.value).toBe(1);
    r.dispose();
  });
  it('ripples: a FLAG the per-frame write consults, so the hide holds across the repaint', () => {
    const { r } = setUp(RAIN);
    const u = priv(r).groundMat.uniforms;
    expect(u.uRippleAmp.value).toBe(1);
    expect(r.setDebugLayerVisible('ripples', false)).toBe(1);
    expect(u.uRippleAmp.value).toBe(0);
    expect(r.setDebugLayerVisible('ripples', false)).toBe(0);
    // The frame re-derives the amplitude every frame: a bare uniform write would be undone here.
    r.frame(1, 0);
    r.frame(1, 16);
    expect(u.uRippleAmp.value).toBe(0);
    expect(r.setDebugLayerVisible('ripples', true)).toBe(1);
    expect(u.uRippleAmp.value).toBe(1);
    r.frame(1, 0);
    expect(u.uRippleAmp.value).toBe(1);
    expect(r.setDebugLayerVisible('ripples', true)).toBe(0);
    r.dispose();
  });
  it('all three report 0 on a map that does not rain, and throw nothing', () => {
    const { r } = setUp();
    for (const layer of ['wet', 'marsh', 'ripples']) {
      expect(r.setDebugLayerVisible(layer, false), layer).toBe(0);
      expect(r.setDebugLayerVisible(layer, true), layer).toBe(0);
    }
    r.dispose();
  });
});

describe('debugSetWetTuning (R-12: the concrete class only)', () => {
  it('writes the two reflectances, one at a time or together', () => {
    const { r } = setUp(RAIN);
    const u = priv(r).groundMat.uniforms;
    expect(u.uPuddleReflect.value).toBe(0.25);
    expect(u.uMarshReflect.value).toBe(0.25);
    r.debugSetWetTuning({ puddle: 0.2, marsh: 0.35 });
    expect(u.uPuddleReflect.value).toBe(0.2);
    expect(u.uMarshReflect.value).toBe(0.35);
    r.debugSetWetTuning({ marsh: 0.25 });
    expect(u.uPuddleReflect.value).toBe(0.2);
    expect(u.uMarshReflect.value).toBe(0.25);
    r.dispose();
  });
  it('refuses a number that is not a reflectance, and is a no-op on a dry map', () => {
    const { r } = setUp(RAIN);
    expect(() => r.debugSetWetTuning({ puddle: 1.5 })).toThrow(/reflectance/);
    expect(() => r.debugSetWetTuning({ marsh: -0.1 })).toThrow(/reflectance/);
    expect(() => r.debugSetWetTuning({ marsh: Number.NaN })).toThrow(/reflectance/);
    r.dispose();
    const dry = setUp();
    expect(() => dry.r.debugSetWetTuning({ puddle: 0.2, marsh: 0.2 })).not.toThrow();
    dry.r.dispose();
  });
  it('is on ThreeRenderer and nowhere in the Renderer interface or api.ts', () => {
    const api = readFileSync(fileURLToPath(new URL('../api.ts', import.meta.url)), 'utf8');
    expect(api).not.toContain('debugSetWetTuning');
    expect(api).not.toContain('WetTuning');
    expect(typeof ThreeRenderer.prototype.debugSetWetTuning).toBe('function');
  });
});
