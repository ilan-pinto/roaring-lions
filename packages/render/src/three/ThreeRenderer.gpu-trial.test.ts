/**
 * L5 (GH-943): the WebGPU trial is gated and falls back. GL-free, over the same `WebGLRenderer` stand-in the other
 * `ThreeRenderer*.test.ts` files use. Node has no `navigator.gpu`, which is exactly the "no WebGPU here" case.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';

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
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function make(extra: Partial<RendererOptions>): ThreeRenderer {
  const opts: RendererOptions = {
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
  return new ThreeRenderer(new Sim({ seed: 1, width: 4, height: 4, capacity: 1 }), opts);
}

type Trialable = { startGpuTrial(host: unknown): Promise<void> };

afterEach(() => vi.restoreAllMocks());

describe('the WebGPU trial gate (GH-943 L5)', () => {
  it('is off by default: no trial, no handle', () => {
    const r = make({});
    expect(r.gpuTrialState).toBe('off');
    expect(r.gpuTrialHandle()).toBeNull();
    r.dispose();
  });
  it('asked for with no WebGPU in the browser: falls back to WebGL2 and warns, loudly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = make({ gpuTrial: 'webgpu' });
    await (r as unknown as Trialable).startGpuTrial({ appendChild() {} });
    expect(r.gpuTrialState).toBe('fallback');
    expect(r.gpuTrialReason).toMatch(/navigator\.gpu is absent|no adapter/);
    expect(r.gpuTrialHandle()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/\[webgpu-trial\] FALLBACK to WebGL2/));
    r.dispose();
  });
});
