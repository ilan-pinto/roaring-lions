/**
 * GH-1223 slice 1: the WASM is fetched only when a preset asks for ragdolls. Every shipped preset asks for none
 * (shipped dark, L4), so `low` -- and today `medium` and `high` too -- never load it; a cap above zero loads it once.
 */
import { describe, expect, it, vi } from 'vitest';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import { ThreeRenderer } from './ThreeRenderer';

const loads = vi.hoisted(() => ({ n: 0 }));
vi.mock('./physics/rapier', () => ({
  loadRapier: () => {
    loads.n++;
    return new Promise(() => {});
  },
  rapierRequests: () => loads.n,
}));

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

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree', haze: '#E0B87A',
};

function opts(quality: RenderQuality | undefined): RendererOptions {
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
    ...(quality ? { quality } : {}),
  };
}

function boot(quality: RenderQuality | undefined): void {
  const r = new ThreeRenderer(new Sim({ seed: 1, width: 8, height: 8, capacity: 2 }), opts(quality));
  r.snapshot();
  r.frame(1, 16);
  r.dispose();
}

describe('the WASM loads only when a preset asks for ragdolls', () => {
  it('every shipped preset is 0 (shipped dark)', () => {
    for (const q of Object.values(QUALITY_PRESETS)) expect(q.physics).toEqual({ ragdolls: 0 });
  });

  it('low, medium, high and no preset at all never request it', () => {
    loads.n = 0;
    boot(QUALITY_PRESETS.low);
    boot(QUALITY_PRESETS.medium);
    boot(QUALITY_PRESETS.high);
    boot(undefined);
    expect(loads.n).toBe(0);
  });

  it('a cap above zero (the `&ragdoll` sandbox flag) requests it', () => {
    loads.n = 0;
    boot({ ...QUALITY_PRESETS.low, physics: { ragdolls: 16 } });
    expect(loads.n).toBe(1);
  });
});
