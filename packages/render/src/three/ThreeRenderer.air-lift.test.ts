/**
 * Mobility kills (#706) Task 2, spec §3.5: every air type's lift and lift
 * shadow go through `airLiftFrac`, not only the air carrier's (GH-698). A
 * gunship the sim has forced down (`airState` LANDING/LANDED, written by the
 * sim's own forced landing -- driven here through the real component roll) is
 * drawn settling onto the ground with its gap shadow fading out; one that
 * never lands is drawn at exactly the height and shadow alpha it always was.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, ONE, AIR_LAND_TICKS, type Fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { AIR_LIFT_PX } from './units/frame-state';
import { WORLD_Y_PER_LIFT_PIXEL } from '../project';
import type { OverlayBatch } from './units/overlays';

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

/** A hard, seatless aircraft: `isAir` and NOT `isAirCarrier`. */
const GUNSHIP: UnitTypeJson = {
  id: 'al_gunship',
  role: 'gunship',
  hull: { hp: 3000, armor: { front: 300, side: 200, rear: 100 } },
  mobility: { speed_tiles_s: 1, domain: 'air' },
  sensors: { optics: 1, sight_tiles: 10, signature: 1 },
};

/** hi = 32768: (32768 * 100) >>> 16 = 50, inside [45, 65): mobility_kill. */
const U_MOBILITY = 0x80000000;

interface Privates {
  overlayBatch: OverlayBatch;
  airLiftY(i: number, alpha: number): number;
  updateOverlays(alpha: number): void;
}

function setUp() {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const id = sim.spawn(sim.addUnitType(GUNSHIP), 0, fx.from(9.5), fx.from(11.5));
  expect(sim.unitTypes[sim.state.typeIdx[id]].isAirCarrier).toBe(false);
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Privates;
  renderer.snapshot();
  renderer.snapshot();
  return { sim, id, renderer, priv };
}

/** The sim's own forced landing: one stubbed component roll, then a tick. */
function mobilityKill(sim: Sim, id: number): void {
  const rng = sim.rng as unknown as { nextU32(e: number): number };
  const real = rng.nextU32;
  rng.nextU32 = () => U_MOBILITY;
  try {
    (sim as unknown as { rollComponent(t: number, s: number, z: Fx): void }).rollComponent(id, id, ONE);
  } finally {
    rng.nextU32 = real;
  }
  sim.tick();
}

/** The alpha the lift shadow is drawn with this frame (the one ellipseFan of a lone, unselected unit). */
function shadowAlpha(priv: Privates): number {
  const spy = vi.spyOn(priv.overlayBatch, 'ellipseFan');
  priv.updateOverlays(1);
  expect(spy).toHaveBeenCalledTimes(1);
  const a = spy.mock.calls[0][4];
  spy.mockRestore();
  return a;
}

describe('air lift for a non-carrier aircraft (#706 §3.5)', () => {
  it('never landed: the same height and shadow alpha, bit for bit', () => {
    const { priv } = setUp();
    expect(priv.airLiftY(0, 1)).toBe(AIR_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL);
    expect(priv.airLiftY(0, 0.37)).toBe(AIR_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL);
    expect(shadowAlpha(priv)).toBe(0.28);
  });

  it('forced down: settles over the landing and sits on the ground, its gap shadow gone', () => {
    const { sim, id, renderer, priv } = setUp();
    mobilityKill(sim, id);
    renderer.snapshot();
    const full = AIR_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL;
    for (let t = 0; t < AIR_LAND_TICKS / 2; t++) sim.tick();
    renderer.snapshot();
    const half = priv.airLiftY(id, 1);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
    for (let t = 0; t < AIR_LAND_TICKS; t++) sim.tick();
    renderer.snapshot();
    expect(priv.airLiftY(id, 1)).toBe(0);
    expect(shadowAlpha(priv)).toBe(0);
  });
});
