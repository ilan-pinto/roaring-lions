/**
 * The wet units, foliage, decals and the mud spray, wired into the renderer
 * (GH-871 P4 Task 5).
 *
 * The pure halves are pinned where they live (`unit-surface.test.ts`,
 * `terrain/sway.test.ts`, `terrain/decor-mesh.test.ts`, `decal-pool.test.ts`).
 * This file pins what only the renderer does, every one of them rain-only:
 *
 *  - the decor batch is built with the wet flag (the theme-identity harness
 *    loads no decor GLBs, so its `scene` digest cannot see this call site);
 *  - both mesh template loaders are handed the renderer's own surface table;
 *  - the decal palette resolves tread and tyre to `mud.3`, and the decal
 *    program carries `DECAL_WET` with the GROUND's own `uWetSky` and
 *    `uPuddleReflect` objects, so `debugSetWetTuning` moves the crater water;
 *  - the moving-vehicle emitter is `vehicle_mud` under rain, BY NAME, and a
 *    dust-only library throws nothing on a wet map.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { SURFACE_PARAMS, WET_SURFACE_PARAMS } from './units/unit-surface';
import { hexToLinear } from './terrain/shared';
import vehicleDust from '../../../../data/vfx/vehicle_dust.json';
import vehicleMud from '../../../../data/vfx/vehicle_mud.json';
import palette from '../../../../data/palette.json';
import type { EmitterSpec } from '../vfx/emitters';

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

const calls = vi.hoisted(() => ({
  decor: [] as unknown[][],
  unit: [] as unknown[][],
  vehicle: [] as unknown[][],
}));
vi.mock('./terrain/decor-mesh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./terrain/decor-mesh')>();
  return {
    ...actual,
    buildDecorMesh: (...args: Parameters<typeof actual.buildDecorMesh>) => {
      calls.decor.push(args);
      return actual.buildDecorMesh(...args);
    },
  };
});
vi.mock('./units/mesh-unit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./units/mesh-unit')>();
  return {
    ...actual,
    loadMeshUnitTemplate: (...args: unknown[]) => {
      calls.unit.push(args);
      return Promise.reject(new Error('stop after capture'));
    },
  };
});
vi.mock('./units/mesh-vehicle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./units/mesh-vehicle')>();
  return {
    ...actual,
    loadVehicleMeshTemplate: (...args: unknown[]) => {
      calls.vehicle.push(args);
      return Promise.reject(new Error('stop after capture'));
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

const TANK: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'armor',
  hull: { hp: 1200, armor: { front: 60, side: 40, rear: 25 } },
  mobility: { speed_tiles_s: 1.1 },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};

interface Private {
  surfaceTable: unknown;
  decalMaterial: import('three').ShaderMaterial;
  groundMat: { uniforms: Record<string, { value: unknown }> };
  vehicleMoveEmitterName(): string;
  buildVehicleTemplate(id: string, url: string, textured: boolean, tiers: undefined, cold: boolean): Promise<unknown>;
  updateVehicleAmbientFx(dtMs: number): void;
  particleSystem: { spawn(...args: unknown[]): void } | null;
  entitySpeed: Float64Array;
}
const priv = (r: ThreeRenderer): Private => r as unknown as Private;

const RAIN = { weather: 'rain' } as const;
const CASES: ReadonlyArray<readonly [string, Partial<RendererOptions>, boolean]> = [
  ['rain', RAIN, true],
  ['clear', { weather: 'clear' }, false],
  ['absent', {}, false],
];

function setUp(extra: Partial<RendererOptions> = {}): { r: ThreeRenderer; sim: Sim; id: number } {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const typeIdx = sim.addUnitType(TANK);
  const id = sim.spawn(typeIdx, 0, fx.from(9.5), fx.from(11.5));
  const r = new ThreeRenderer(sim, makeOpts(extra));
  r.frame(1, 0);
  return { r, sim, id };
}

describe('the decor batch is built with the wet flag under rain only', () => {
  it.each(CASES)('weather %s', (_name, extra, wet) => {
    calls.decor.length = 0;
    const { r } = setUp(extra);
    expect(calls.decor.length, 'the decor batch was built').toBeGreaterThan(0);
    for (const args of calls.decor) expect(args[4]).toBe(wet);
    r.dispose();
  });
});

describe('both mesh loaders get the renderer`s own surface table', () => {
  it.each(CASES)('weather %s', async (_name, extra, wet) => {
    const { r } = setUp(extra);
    const want = wet ? WET_SURFACE_PARAMS : SURFACE_PARAMS;
    expect(priv(r).surfaceTable).toBe(want);
    calls.vehicle.length = 0;
    calls.unit.length = 0;
    await expect(priv(r).buildVehicleTemplate('mbt_lavi', 'x.glb', false, undefined, false)).rejects.toThrow();
    await expect(r.loadMeshUnit('mesh_inf', 'x.glb', 'kdf')).rejects.toThrow();
    expect(calls.vehicle).toHaveLength(1);
    expect(calls.unit).toHaveLength(1);
    expect(calls.vehicle[0][5]).toBe(want);
    expect(calls.unit[0][6]).toBe(want);
    r.dispose();
  });
});

describe('the decal material', () => {
  const ramps = palette.ramps as unknown as Record<string, { colors: string[] }>;
  it('resolves tread and tyre to mud.3 under rain, and every other colour as shipped', () => {
    const { r } = setUp(RAIN);
    const c = (priv(r).decalMaterial.uniforms.uColors.value as { toArray(): number[] }[]).map((v) => v.toArray());
    expect(ramps.mud.colors[3]).toBe('#413327');
    expect(c[6]).toEqual(hexToLinear('#413327'));
    expect(c[7]).toEqual(hexToLinear('#413327'));
    expect(c[0]).toEqual(hexToLinear(ramps.shadow.colors[0]));
    expect(c[1]).toEqual(hexToLinear(ramps.limestone.colors[1]));
    expect(c[4]).toEqual(hexToLinear(ramps.limestone.colors[5]));
    r.dispose();
  });

  it('keeps tread at dust.5 and tyre at limestone.6 on a map that does not rain, with no define', () => {
    for (const extra of [{}, { weather: 'clear' as const }]) {
      const { r } = setUp(extra);
      const m = priv(r).decalMaterial;
      const c = (m.uniforms.uColors.value as { toArray(): number[] }[]).map((v) => v.toArray());
      expect(c[6]).toEqual(hexToLinear(ramps.dust.colors[5]));
      expect(c[7]).toEqual(hexToLinear(ramps.limestone.colors[6]));
      expect(m.defines).toEqual({});
      expect(m.uniforms.uWetSky).toBeUndefined();
      r.dispose();
    }
  });

  it('carries DECAL_WET with the ground`s own uniform objects, so the A/B tuning moves it', () => {
    const { r } = setUp(RAIN);
    const m = priv(r).decalMaterial;
    const g = priv(r).groundMat.uniforms;
    expect(m.defines).toEqual({ DECAL_WET: '' });
    expect(m.uniforms.uWetSky).toBe(g.uWetSky);
    expect(m.uniforms.uPuddleReflect).toBe(g.uPuddleReflect);
    // The sky the water mixes toward is the one `applyWetUniforms` wrote, not white.
    const sky = (m.uniforms.uWetSky.value as { toArray(): number[] }).toArray();
    expect(sky).not.toEqual([1, 1, 1]);
    expect(m.uniforms.uPuddleReflect.value).toBe(0.35);
    r.debugSetWetTuning({ puddle: 0.2 });
    expect(m.uniforms.uPuddleReflect.value).toBe(0.2);
    // The marsh reflectance is the marsh's alone.
    r.debugSetWetTuning({ marsh: 0.3 });
    expect(m.uniforms.uPuddleReflect.value).toBe(0.2);
    r.dispose();
  });
});

describe('the moving-vehicle spray', () => {
  it.each(CASES)('is chosen by name: weather %s', (_name, extra, wet) => {
    const { r } = setUp(extra);
    expect(priv(r).vehicleMoveEmitterName()).toBe(wet ? 'vehicle_mud' : 'vehicle_dust');
    r.dispose();
  });

  /** Drives the moving-vehicle path and returns the first colour of every spawned layer. */
  function sprayColours(extra: Partial<RendererOptions>, library: object[]): string[] {
    const { r, id } = setUp(extra);
    r.useEmitters(library as unknown as EmitterSpec[], () => '#8E9491');
    r.snapshot();
    r.snapshot();
    const out: string[] = [];
    const system = priv(r).particleSystem!;
    const inner = system.spawn.bind(system);
    system.spawn = (...args: unknown[]): void => {
      out.push((args[0] as { color_over_life: string[] }).color_over_life[0]);
      inner(...args);
    };
    priv(r).entitySpeed[id] = 1.5;
    for (let i = 0; i < 20; i++) priv(r).updateVehicleAmbientFx(16.67);
    r.dispose();
    return out;
  }

  it('throws mud under rain, and only mud', () => {
    const colours = sprayColours(RAIN, [vehicleDust, vehicleMud]);
    expect(colours.length).toBeGreaterThan(0);
    expect(new Set(colours)).toEqual(new Set(['mud.2']));
  });
  it('throws dust, and only dust, on a map that does not rain', () => {
    const colours = sprayColours({}, [vehicleDust, vehicleMud]);
    expect(colours.length).toBeGreaterThan(0);
    expect(new Set(colours)).toEqual(new Set(['dust.2']));
  });
  it('a second emitter with the same trigger fires nothing by itself: dust alone throws nothing under rain', () => {
    expect(sprayColours(RAIN, [vehicleDust])).toEqual([]);
  });
});
