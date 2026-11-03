/**
 * GH-954 W1: `Renderer.setViewer(0 | 1 | 'all')`, through the REAL renderer (the faked WebGLRenderer of
 * `ThreeRenderer.versus-leaks.test.ts`). A spectator chooses whose eyes to draw with:
 * - `'all'`: both sides, no veil and no draw gate -- every tile on the map is in sight, off the map is not;
 * - `0` / `1`: exactly what a seat of that side draws. The proof is a reference renderer built with that
 *   `viewerSide` from the start: its fog grid, its sight answers and its pick gate (`pickable`) are
 *   compared with the spectator's, tile by tile and unit by unit, on the same sim.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
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

function makeOpts(room: Pick<RendererOptions, 'viewerSide' | 'versus'>): RendererOptions {
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

const SCOUT: UnitTypeJson = {
  id: 't_scout',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 6 },
  weapons: [],
};

interface Privates { fog: Uint8Array; pickable(i: number): boolean; recomputeFog(): void }
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;
const W = 48;

/** Side 0 stands at (6, 6) and (10, 6); side 1 at (40, 40): far outside both sights. */
function world(): { sim: Sim; units: { id: number; side: 0 | 1 }[] } {
  const sim = new Sim({ seed: 3, width: W, height: W, capacity: 8 });
  const t = sim.addUnitType(SCOUT);
  const units = [
    { id: sim.spawn(t, 0, fx.from(6), fx.from(6)), side: 0 as const },
    { id: sim.spawn(t, 0, fx.from(10), fx.from(6)), side: 0 as const },
    { id: sim.spawn(t, 1, fx.from(40), fx.from(40)), side: 1 as const },
  ];
  return { sim, units };
}
const sightMap = (r: ThreeRenderer): boolean[] => Array.from({ length: W * W }, (_, i) => r.isVisible((i % W) + 0.5, Math.floor(i / W) + 0.5));

describe('Renderer.setViewer (GH-954 W1)', () => {
  it("'all' puts every tile on the map in sight and nothing off it, and every unit is pickable", () => {
    const { sim, units } = world();
    const r = new ThreeRenderer(sim, makeOpts({ viewerSide: 0, versus: true }));
    r.snapshot();
    // Before: side 0's eyes. Its own tile is seen, side 1's far corner is not, and the hostile is not pickable.
    expect(r.isVisible(6.5, 6.5)).toBe(true);
    expect(r.isVisible(40.5, 40.5)).toBe(false);
    expect(priv(r).pickable(units[2].id)).toBe(false);
    r.setViewer('all');
    expect(sightMap(r).every(Boolean)).toBe(true);
    expect(r.isVisible(-0.5, 3)).toBe(false);
    expect(r.isVisible(3, W + 0.5)).toBe(false);
    for (const u of units) expect(priv(r).pickable(u.id), `unit ${u.id}`).toBe(true);
    r.dispose();
  });

  it('0 and 1 are exactly what a seat of that side draws: the same fog grid, the same sight, the same pick gate', () => {
    const { sim, units } = world();
    const spectator = new ThreeRenderer(sim, makeOpts({ viewerSide: 0, versus: true }));
    spectator.snapshot();
    const refs = {
      0: new ThreeRenderer(sim, makeOpts({ viewerSide: 0, versus: true })),
      1: new ThreeRenderer(sim, makeOpts({ viewerSide: 1, versus: true })),
    };
    for (const r of Object.values(refs)) r.snapshot();
    for (const side of [1, 0, 'all', 1, 0] as const) {
      spectator.setViewer(side);
      if (side === 'all') continue;
      expect(Array.from(priv(spectator).fog), `fog ${side}`).toEqual(Array.from(priv(refs[side]).fog));
      expect(sightMap(spectator), `sight ${side}`).toEqual(sightMap(refs[side]));
      for (const u of units) expect(priv(spectator).pickable(u.id), `pick ${side}/${u.id}`).toBe(priv(refs[side]).pickable(u.id));
    }
    // And the two views differ on this map, so the comparison above is not vacuous.
    expect(sightMap(refs[0])).not.toEqual(sightMap(refs[1]));
    expect(refs[1].isVisible(40.5, 40.5)).toBe(true);
    expect(refs[0].isVisible(40.5, 40.5)).toBe(false);
    spectator.dispose();
    for (const r of Object.values(refs)) r.dispose();
  });

  it("leaving 'all' for a side restores that side's veil at once, with no memory of what 'all' showed", () => {
    const { sim } = world();
    const r = new ThreeRenderer(sim, makeOpts({ viewerSide: 0, versus: true }));
    r.snapshot();
    r.setViewer('all');
    r.setViewer(0);
    expect(r.isVisible(40.5, 40.5)).toBe(false);
    expect(r.isVisible(6.5, 6.5)).toBe(true);
    r.dispose();
  });
});
