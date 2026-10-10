/**
 * GH-391: the main-rotor angle is a function of SIM time, through the real
 * `updateVehicleMeshes`. It used to accumulate the clamped frame delta, so a
 * frozen frame carried the sum of every wall-clock frame since boot and two
 * captures of one commit photographed different blade angles (the visual
 * gate's `vehicle` scenario read 100-316 px against a 300 px budget).
 * Harness as `ThreeRenderer.vehicle-mesh-anim.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildVehicleMeshTemplate, type VehicleMeshTemplate, type VehicleMeshEntity } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';

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

const DOZER: UnitTypeJson = {
  id: 'dozer_d9',
  role: 'engineer',
  abilities: ['demolish'],
  demolition_time_s: 4,
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

interface Privates {
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
}

async function setUp() {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const id = sim.spawn(sim.addUnitType(DOZER), 0, fx.from(9.5), fx.from(11.5));
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Privates;
  const gltf = await parseRigidFixture({
    parts: [
      { nodeName: 'hull_hull', extrasRole: 'hull' },
      { nodeName: 'rotor_blade', extrasRole: 'hull' },
    ],
    pivot: { pivotName: 'rotor_pivot', pivotChildren: [1] },
  });
  priv.vehicleMeshTemplates.set(DOZER.id, buildVehicleMeshTemplate(gltf, DOZER.id));
  renderer.snapshot();
  renderer.snapshot();
  const angle = (): number => {
    const e = priv.vehicleMeshEntities.get(id);
    if (!e?.rotorPivot) throw new Error('fixture has no rotor pivot');
    return e.rotorPivot.rotation.y;
  };
  return { sim, renderer, priv, angle };
}

describe('rotor spin clock', () => {
  it('reads the same angle at the same sim time whatever the frame deltas were', async () => {
    const a = await setUp();
    for (let i = 0; i < 7; i++) a.priv.updateVehicleMeshes(1, 100);
    a.priv.updateVehicleMeshes(1, 16);

    const b = await setUp();
    b.priv.updateVehicleMeshes(1, 33);
    b.priv.updateVehicleMeshes(1, 5);
    b.priv.updateVehicleMeshes(1, 16);

    expect(a.angle()).toBe(b.angle());
  });

  it('is not frozen: a sim tick moves it', async () => {
    const { sim, renderer, priv, angle } = await setUp();
    priv.updateVehicleMeshes(1, 16);
    const before = angle();
    for (let t = 0; t < 3; t++) sim.tick();
    renderer.snapshot();
    priv.updateVehicleMeshes(1, 16);
    expect(angle()).not.toBe(before);
  });
});
