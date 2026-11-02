/**
 * L1 (GH-943): what `RendererOptions.environmentLight` changes in a constructed
 * `ThreeRenderer`, and (the half that matters on main) what it does NOT change
 * with the flag off. GL-free, over the same `WebGLRenderer` stand-in the other
 * `ThreeRenderer*.test.ts` files use: the sky itself needs a context and is the
 * mock capture's (`tools/src/perf/look-l1-captures.ts`).
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { SURFACE_PARAMS, WET_SURFACE_PARAMS, type SurfaceTable } from './units/unit-surface';
import { ENV_HEMISPHERE_INTENSITY, ENV_METAL_CAP } from './environment-classes';
import { TIME_OF_DAY_PRESETS } from './time-of-day';
import { withEnvironmentFill, DAY_LIGHTS } from './lighting';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    // `ThreeRenderer.dispose` loses the context last (`context-release.ts`).
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
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

function makeOpts(): RendererOptions {
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
  };
}

function make(extra: Partial<RendererOptions> = {}): ThreeRenderer {
  return new ThreeRenderer(new Sim({ seed: 1, width: 4, height: 4, capacity: 1 }), { ...makeOpts(), ...extra });
}

interface Internals {
  environment: { currentPreset: string } | null;
  surfaceTable: SurfaceTable;
  sceneLights: { hemisphere: THREE.HemisphereLight };
  resolvedLights: { hemiIntensity: number };
  adoptEnvironment(m: readonly THREE.Material[], c: string): void;
}
const inner = (r: ThreeRenderer): Internals => r as unknown as Internals;

describe('environmentLight OFF (the default): main is unchanged', () => {
  it('builds no registry, keeps the shipped hemisphere and the shipped surface table by identity', () => {
    for (const tod of ['dawn', 'day', 'dusk'] as const) {
      const r = make({ timeOfDay: tod });
      expect(inner(r).environment, tod).toBeNull();
      expect(inner(r).sceneLights.hemisphere.intensity, tod).toBe(TIME_OF_DAY_PRESETS[tod].hemiIntensity);
      expect(inner(r).surfaceTable, tod).toBe(SURFACE_PARAMS);
      r.dispose();
    }
    const wet = make({ weather: 'rain' });
    expect(inner(wet).surfaceTable).toBe(WET_SURFACE_PARAMS);
    wet.dispose();
  });

  it('an explicit false is the same as absent', () => {
    const r = make({ environmentLight: false });
    expect(inner(r).environment).toBeNull();
    expect(inner(r).sceneLights.hemisphere.intensity).toBe(0.9);
    r.dispose();
  });

  it('adopting a template and the environment layer are inert (the layer reads 0: there is no environment)', () => {
    const r = make();
    const m = new THREE.MeshStandardMaterial();
    inner(r).adoptEnvironment([m], 'unitMetal');
    expect(m.envMap).toBeNull();
    expect(r.setDebugLayerVisible('environment', false)).toBe(0);
    expect(r.setDebugLayerVisible('environment', true)).toBe(0);
    r.dispose();
  });
});

describe('environmentLight ON', () => {
  it('lowers the hemisphere to the per-preset value and lifts the metal cap to 0.7', () => {
    for (const tod of ['dawn', 'day', 'dusk'] as const) {
      const r = make({ timeOfDay: tod, environmentLight: true });
      expect(inner(r).environment?.currentPreset, tod).toBe(tod);
      expect(inner(r).sceneLights.hemisphere.intensity, tod).toBeCloseTo(ENV_HEMISPHERE_INTENSITY[tod], 12);
      expect(inner(r).sceneLights.hemisphere.intensity, tod).toBeLessThan(TIME_OF_DAY_PRESETS[tod].hemiIntensity);
      expect(inner(r).surfaceTable.gunmetal.metalness, tod).toBe(ENV_METAL_CAP);
      expect(inner(r).surfaceTable.cloth.metalness, tod).toBe(0);
      r.dispose();
    }
  });

  it('scales a mission\'s map.light.fill by the same factor, so a lifted dawn stays lifted by the same ratio', () => {
    const r = make({ timeOfDay: 'dawn', environmentLight: true, lightOverride: { fill: 1.2 } });
    expect(inner(r).sceneLights.hemisphere.intensity).toBeCloseTo(1.2 * (ENV_HEMISPHERE_INTENSITY.dawn / 0.75), 12);
    r.dispose();
  });

  it('keeps the sun exactly as shipped: this is ambient, not a new sun', () => {
    const on = make({ environmentLight: true });
    const off = make();
    const sun = (r: ThreeRenderer) => (r as unknown as { sceneLights: { sun: THREE.DirectionalLight } }).sceneLights.sun;
    expect(sun(on).intensity).toBe(sun(off).intensity);
    expect(sun(on).position.toArray()).toEqual(sun(off).position.toArray());
    on.dispose();
    off.dispose();
  });

  it('the wet surface table keeps its rim switch and its roughness, and only the metal cap moves', () => {
    const r = make({ weather: 'rain', environmentLight: true });
    const t = inner(r).surfaceTable;
    expect(t.gunmetal).toEqual({ roughness: WET_SURFACE_PARAMS.gunmetal.roughness, metalness: ENV_METAL_CAP });
    expect(t.kdfRim).toBe(true);
    expect(t.cloth).toBe(WET_SURFACE_PARAMS.cloth);
    r.dispose();
  });
});

describe('withEnvironmentFill', () => {
  it('day with no override is exactly the preset value, and the other lights are the same object\'s', () => {
    const l = withEnvironmentFill(DAY_LIGHTS, 'day');
    expect(l.hemiIntensity).toBeCloseTo(ENV_HEMISPHERE_INTENSITY.day, 12);
    expect(l.sunIntensity).toBe(DAY_LIGHTS.sunIntensity);
    expect(l.direction).toBe(DAY_LIGHTS.direction);
  });
});
