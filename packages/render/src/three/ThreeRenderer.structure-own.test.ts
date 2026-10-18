/**
 * F4 Task 7 (R-F4-9): `structureIsOwn` reads `sim.structureProducesFor(s)`, the placement's
 * `side` override, not the TYPE's `produces_for`. A `camp` TYPE produces for side 0; placed with
 * side 1 it is the enemy's, so it must not fill own-colour for a side-0 viewer.
 * Harness: the faked WebGLRenderer and options of ThreeRenderer.versus-leaks.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
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
  crownRatio: 0.52, scatter: 'stone',
  groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function makeOpts(room: Pick<RendererOptions, 'viewerSide' | 'versus'> = {}): RendererOptions {
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
    ...room,
  };
}


interface Privates {
  structureIsOwn(s: number, holder?: number): boolean;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

function world(viewerSide: 0 | 1, override: 0 | 1 | undefined) {
  const sim = new Sim({ seed: 1, width: 32, height: 32, capacity: 4 });
  const camp = sim.addStructureType({ id: 'camp', hp_per_tile: 300, produces_for: 0 });
  const s = sim.addStructure(camp, [10 * 32 + 10]);
  if (override !== undefined) sim.setStructureProducesFor(s, override);
  const r = new ThreeRenderer(sim, makeOpts({ viewerSide }));
  return { r, s };
}

describe('structureIsOwn follows the placement override (F4 Task 7)', () => {
  it('a camp with no override is side 0\'s: own for viewer 0, not for viewer 1', () => {
    const a = world(0, undefined);
    expect(priv(a.r).structureIsOwn(a.s, -1)).toBe(true);
    const b = world(1, undefined);
    expect(priv(b.r).structureIsOwn(b.s, -1)).toBe(false);
    a.r.dispose();
    b.r.dispose();
  });
  it('a camp placed with side 1 is not own for a side-0 viewer and is own for a side-1 viewer', () => {
    const a = world(0, 1);
    expect(priv(a.r).structureIsOwn(a.s, -1)).toBe(false);
    const b = world(1, 1);
    expect(priv(b.r).structureIsOwn(b.s, -1)).toBe(true);
    a.r.dispose();
    b.r.dispose();
  });
});
