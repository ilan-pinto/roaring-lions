/**
 * GH-34 acceptance 3 (the lead approved the L-5 mock on 12 Nov 2026): the range ring of a selected GARRISONED unit is the
 * building-extended envelope, not the open-ground reach. Drives the real `updateOverlays` on a real `Sim` and reads the two radii
 * the renderer hands the overlay batch (the effective-range arc and the maximum-range hoop). Literal tile counts: a rifle squad
 * with a 6.4 tile effective and 8 tile maximum range, in the open and in a house (the default one tile) and a block that authors 2.
 * The golden baselines cannot move: every capture asserts an empty selection and no range preview
 * (`capture-protocol.ts`), and a ring is only drawn for a selected unit.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { OverlayBatch } from './units/overlays';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
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

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#2F6FD9', '#D93A2B', '#E8C33A'],
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

const SQUAD: UnitTypeJson = {
  id: 'gr_squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 },
  ],
};
const HOUSE = { id: 'gr_house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 };
const BLOCK = { id: 'gr_block', name: 'Block', hp_per_tile: 400, garrison_slots: 4, rubble_cover: 2, garrison_range_bonus: 2 };

interface Priv {
  overlayBatch: OverlayBatch;
  updateOverlays(alpha: number): void;
}

/** Unit 0 in a house (bonus 1), unit 1 in a block (bonus 2), unit 2 in the open. */
function setUp() {
  const sim = new Sim({ seed: 9, width: 48, height: 32, capacity: 16 });
  const house = sim.addStructureType(HOUSE);
  const block = sim.addStructureType(BLOCK);
  const squad = sim.addUnitType(SQUAD);
  const inHouse = sim.addStructure(house, [14 * 48 + 20, 14 * 48 + 21]);
  const inBlock = sim.addStructure(block, [14 * 48 + 30, 14 * 48 + 31]);
  const a = sim.spawn(squad, 0, fx.from(19.5), fx.from(14.5));
  const b = sim.spawn(squad, 0, fx.from(29.5), fx.from(14.5));
  const c = sim.spawn(squad, 0, fx.from(10.5), fx.from(22.5));
  sim.queueCommand({ kind: 'garrison', ids: [a], structure: inHouse });
  sim.queueCommand({ kind: 'garrison', ids: [b], structure: inBlock });
  for (let k = 0; k < 400 && (sim.state.garrisonedIn[a] < 0 || sim.state.garrisonedIn[b] < 0); k++) sim.tick();
  expect([sim.state.garrisonedIn[a] >= 0, sim.state.garrisonedIn[b] >= 0, sim.state.garrisonedIn[c]]).toEqual([true, true, -1]);
  const renderer = new ThreeRenderer(sim, makeOpts());
  renderer.snapshot();
  renderer.snapshot();
  const priv = renderer as unknown as Priv;
  const annulus = vi.spyOn(priv.overlayBatch, 'ellipseAnnulusFill');
  const ring = vi.spyOn(priv.overlayBatch, 'ellipseRing');
  /** Selects `id`, draws one frame, and returns the horizontal pixel radii of its effective arc (the fill's outer edge) and of
   *  its maximum-range hoop (the 1 px ring). */
  const radii = (id: number): { effective: number; max: number } => {
    renderer.selection = [id];
    annulus.mockClear();
    ring.mockClear();
    priv.updateOverlays(1);
    expect(annulus).toHaveBeenCalledTimes(1);
    const effective = annulus.mock.calls[0][3];
    const hoops = ring.mock.calls.filter((call) => call[3] === 1);
    expect(hoops).toHaveLength(1);
    return { effective, max: hoops[0][1] };
  };
  return { radii, a, b, c };
}

describe('the range ring of a selected garrisoned unit (GH-34 acceptance 3)', () => {
  it('draws the building-extended envelope: the ring grows by the building\'s bonus on both radii', () => {
    const w = setUp();
    const open = w.radii(w.c);
    const house = w.radii(w.a);
    const block = w.radii(w.b);
    // The ring is linear in tiles (to Q16.16 precision), so the ratios are the tile ratios: 6.4 -> 7.4 -> 8.4 effective and 8 -> 9 -> 10 maximum.
    expect(house.effective / open.effective).toBeCloseTo(7.4 / 6.4, 4);
    expect(house.max / open.max).toBeCloseTo(9 / 8, 4);
    expect(block.effective / open.effective).toBeCloseTo(8.4 / 6.4, 4);
    expect(block.max / open.max).toBeCloseTo(10 / 8, 4);
  });
  it('a unit in the open draws today\'s ring: the 8 tile hoop over the 6.4 tile arc', () => {
    const w = setUp();
    const open = w.radii(w.c);
    expect(open.max / open.effective).toBeCloseTo(8 / 6.4, 4);
  });
});
