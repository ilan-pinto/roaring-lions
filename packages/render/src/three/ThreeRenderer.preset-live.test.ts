/**
 * GH-1400 (G2): the preset switches as the REAL `ThreeRenderer` reads them (`preset-live.ts`'s `PRESET_SWITCHES`, mocked
 * here so a test can turn them on; the shipped constants are off). With the ragdoll switch on, `medium` and `high` request
 * the Rapier WASM once each and `low` NEVER does; with the soft switch on, only `high` resolves `softParticles`, which is the
 * one field `init` (the legacy snapshot) and the node backend (`softDepthOn`) read. With the switches off nothing moves
 * (`ThreeRenderer.ragdoll-load.test.ts` pins that half). Each check was run red once by a one-line mutation (commit message).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import { ThreeRenderer } from './ThreeRenderer';

const loads = vi.hoisted(() => ({ n: 0 }));
const switches = vi.hoisted(() => ({ ragdolls: false, softParticles: false }));

vi.mock('./physics/rapier', () => ({
  loadRapier: () => {
    loads.n++;
    return new Promise(() => {});
  },
  rapierRequests: () => loads.n,
}));

vi.mock('./preset-live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./preset-live')>()),
  PRESET_SWITCHES: switches,
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

interface Seen {
  readonly cap: number;
  readonly quality: RenderQuality | undefined;
}

/** Boots a renderer, steps a frame, and reads back the cap its ragdolls hold and the quality every later read sees. */
function boot(quality: RenderQuality | undefined): Seen {
  const r = new ThreeRenderer(new Sim({ seed: 1, width: 8, height: 8, capacity: 2 }), opts(quality));
  r.snapshot();
  r.frame(1, 16);
  const inner = r as unknown as { ragdolls: { cap: number }; opts: RendererOptions };
  const seen = { cap: inner.ragdolls.cap, quality: inner.opts.quality };
  r.dispose();
  return seen;
}

beforeEach(() => {
  loads.n = 0;
  switches.ragdolls = false;
  switches.softParticles = false;
});

describe('GH-1400: the ragdoll switch ON, through the real renderer', () => {
  it('low never requests the WASM, even with the switch on', () => {
    // Falsify: `RAGDOLL_PRESET_CAPS[tier]` -> `RAGDOLL_PRESET_CAPS.high` in liveQuality (low then holds 16 and fetches).
    switches.ragdolls = true;
    switches.softParticles = true;
    const low = boot(QUALITY_PRESETS.low);
    expect(low.cap).toBe(0);
    expect(loads.n).toBe(0);
  });

  it('medium holds 8 figures and high 16, each requesting the WASM once', () => {
    // Falsify: skip `liveRendererOptions` in the constructor (`opts = this.opts = opts || ...`): both caps read 0, no request.
    switches.ragdolls = true;
    expect(boot(QUALITY_PRESETS.medium).cap).toBe(8);
    expect(loads.n).toBe(1);
    expect(boot(QUALITY_PRESETS.high).cap).toBe(16);
    expect(loads.n).toBe(2);
  });

  it('no quality at all (a test fake) keeps 0 and requests nothing', () => {
    switches.ragdolls = true;
    expect(boot(undefined).cap).toBe(0);
    expect(loads.n).toBe(0);
  });

  it('with the switches off the same three presets hold 0 and request nothing', () => {
    for (const q of [QUALITY_PRESETS.low, QUALITY_PRESETS.medium, QUALITY_PRESETS.high]) {
      const seen = boot(q);
      expect(seen.cap).toBe(0);
      expect(seen.quality).toBe(q);
    }
    expect(loads.n).toBe(0);
  });
});

describe('GH-1400: the soft-particle switch ON, through the real renderer', () => {
  it('only high resolves softParticles; medium and low keep the very preset object', () => {
    // Falsify: `medium: false` -> `medium: true` in SOFT_PARTICLES_PRESETS (medium resolves it too).
    switches.softParticles = true;
    expect(boot(QUALITY_PRESETS.high).quality?.softParticles).toBe(true);
    expect(boot(QUALITY_PRESETS.medium).quality).toBe(QUALITY_PRESETS.medium);
    expect(boot(QUALITY_PRESETS.low).quality).toBe(QUALITY_PRESETS.low);
    expect(loads.n).toBe(0);
  });
});
