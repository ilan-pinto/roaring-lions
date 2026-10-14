/**
 * GH-31, the vehicle half: `units/vehicle-damage.ts` wired into
 * `ThreeRenderer` -- the one hook in `updateVehicleMeshes`, the band reaching
 * `updateDamageSmoke`'s wisp, and the death hand-off keeping a moved hull's
 * scar after `releaseRunningGear`. The module itself is proved in
 * `units/vehicle-damage.test.ts`. Harness from
 * `ThreeRenderer.vehicle-mesh-death.test.ts` and
 * `ThreeRenderer.versus-traces.test.ts` (fake `WebGLRenderer`, a real fixture
 * GLB through `buildVehicleMeshTemplate`).
 *
 * Every assertion below that matters was seen red by breaking the named line
 * in `ThreeRenderer.ts` by hand, then reverted.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildVehicleMeshTemplate, type VehicleMeshEntity, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import { bindRunningGear } from './units/running-gear-binding';
import { parseRunningGear } from './units/running-gear';
import { vehicleDrawnBand } from './units/vehicle-damage';
import type { DyingVehicle } from './units/mesh-vehicle-death';
import vehicleDamagedSmoke from '../../../../data/vfx/vehicle_damaged_smoke.json';
import type { EmitterSpec } from '../vfx/emitters';

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

const LAVI: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'tank',
  hull: { hp: 1800, armor: { front: 700, side: 300, rear: 120 } },
  mobility: { speed_tiles_s: 6, wheeled: false },
  sensors: { optics: 3, sight_tiles: 14, signature: 1 },
};
/** An aircraft. Whether it scars is decided by its TEMPLATE (a main rotor),
 *  so one type serves both the helicopter and the drone case. */
const AIR: UnitTypeJson = {
  id: 'heli_peten',
  role: 'gunship',
  hull: { hp: 400, armor: { front: 45, side: 28, rear: 20 } },
  mobility: { speed_tiles_s: 3, domain: 'air' },
  sensors: { optics: 2, sight_tiles: 14, signature: 1 },
};

interface Privates {
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  vehicleDying: DyingVehicle[];
  particleSystem: { spawn: (...a: unknown[]) => void } | null;
  fog: Uint8Array;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
  updateDamageSmoke(alpha: number): void;
}

async function setUp(type: UnitTypeJson, rotor = false) {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const id = sim.spawn(sim.addUnitType(type), 0, fx.from(9.5), fx.from(11.5));
  const renderer = new ThreeRenderer(sim, makeOpts());
  renderer.useEmitters([vehicleDamagedSmoke as unknown as EmitterSpec], () => '#8E9491');
  const priv = renderer as unknown as Privates;
  const gltf = await parseRigidFixture({
    parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
    clipNames: ['idle', 'wreck'],
    deathRoot: { parts: ['hull_hull'] },
  });
  const built = buildVehicleMeshTemplate(gltf, type.id);
  priv.vehicleMeshTemplates.set(type.id, rotor ? { ...built, hasRotorPivot: true } : built);
  renderer.snapshot();
  renderer.snapshot();
  priv.fog.fill(2);
  let spawns = 0;
  const system = priv.particleSystem;
  if (!system) throw new Error('no particle system');
  const inner = system.spawn.bind(system);
  system.spawn = (...args: unknown[]): void => {
    spawns++;
    inner(...args);
  };
  const toBand = (band: number): void => {
    const max = sim.unitTypes[sim.state.typeIdx[id]].hp;
    (sim.state.hp as Int32Array)[id] = band >= 8 ? max : Math.floor((max * band) / 8);
  };
  /** The live hull mesh (not the wreck twin, not the outline). */
  const hull = (): THREE.Mesh => {
    const e = priv.vehicleMeshEntities.get(id);
    if (!e) throw new Error('no entity');
    let found: THREE.Mesh | null = null;
    for (const top of e.liveTop) {
      top.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!found && m.isMesh && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) found = m;
      });
    }
    if (!found) throw new Error('no hull mesh');
    return found;
  };
  const wisps = (): number => {
    const before = spawns;
    priv.updateDamageSmoke(1);
    return spawns - before;
  };
  const ticksTo = (t: number): void => {
    while (sim.tickCount < t) sim.tick();
  };
  return { sim, renderer, priv, id, toBand, hull, wisps, ticksTo };
}

describe('the damage hook in updateVehicleMeshes', () => {
  it('leaves a full-hp hull on its template material, scars it when the band falls, and restores it on the way back', async () => {
    const h = await setUp(LAVI);
    h.priv.updateVehicleMeshes(1, 16);
    const template = h.hull().material;
    h.toBand(3);
    h.priv.updateVehicleMeshes(1, 16);
    // Break check: delete the hook's `applyVehicleDamageBand` call -> the
    // material stays the template and this goes red.
    const scarred = h.hull().material as THREE.MeshStandardMaterial;
    expect(scarred).not.toBe(template);
    expect(scarred.color.getHex()).not.toBe((template as THREE.MeshStandardMaterial).color.getHex());
    expect(vehicleDrawnBand(h.priv.vehicleMeshEntities.get(h.id) as VehicleMeshEntity)).toBe(3);
    h.toBand(8);
    h.priv.updateVehicleMeshes(1, 16);
    expect(h.hull().material).toBe(template);
    h.renderer.dispose();
  });

  it('scars a helicopter and leaves a rotorless aircraft clean', async () => {
    // Break check: pass `false` for `template.hasRotorPivot` in the hook ->
    // the helicopter row goes red; drop the `vehicleTakesDamageStates` gate ->
    // the drone row goes red.
    const heli = await setUp(AIR, true);
    heli.priv.updateVehicleMeshes(1, 16);
    const heliTemplate = heli.hull().material;
    heli.toBand(1);
    heli.priv.updateVehicleMeshes(1, 16);
    expect(heli.hull().material).not.toBe(heliTemplate);
    heli.renderer.dispose();

    const drone = await setUp(AIR, false);
    drone.priv.updateVehicleMeshes(1, 16);
    const droneTemplate = drone.hull().material;
    drone.toBand(1);
    drone.priv.updateVehicleMeshes(1, 16);
    expect(drone.hull().material).toBe(droneTemplate);
    drone.renderer.dispose();
  });
});

describe('the wisp reads the drawn band', () => {
  it('no wisp at band 3, the wisp at band 2 with no component kill', async () => {
    const h = await setUp(LAVI);
    h.ticksTo(120);
    h.toBand(3);
    h.priv.updateVehicleMeshes(1, 16);
    expect(h.wisps()).toBe(0);
    h.toBand(2);
    h.priv.updateVehicleMeshes(1, 16);
    // Break check: drop the `band` argument from `updateDamageSmoke`'s
    // `vehicleTrailsDamageSmoke` call -> 0 here.
    expect(h.wisps()).toBeGreaterThan(0);
    h.renderer.dispose();
  });

  it('a helicopter scars but never wisps (a ground wisp cannot reach its deck)', async () => {
    const h = await setUp(AIR, true);
    h.ticksTo(120);
    h.toBand(1);
    h.priv.updateVehicleMeshes(1, 16);
    expect(h.wisps()).toBe(0);
    h.renderer.dispose();
  });
});

describe('death after the hull has moved', () => {
  it('re-draws the last living band after releaseRunningGear, so the fade starts from the scar', async () => {
    const h = await setUp(LAVI);
    h.priv.updateVehicleMeshes(1, 16);
    const template = h.hull().material as THREE.MeshStandardMaterial;
    // Tag the hull as running gear and bind it, as the first frame of
    // movement does (the fixture GLB carries no wheels of its own).
    const g = h.hull().geometry;
    const n = g.getAttribute('position').count;
    g.setAttribute('_rl_wheel', new THREE.BufferAttribute(new Uint8Array(n).fill(1), 1));
    g.setAttribute('_rl_track', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));
    const spec = parseRunningGear(
      { rl_running_gear: { version: 1, wheels: [{ side: 'r', index: 0, centre: [1, 0.4, 0.9], radius: 0.4, cutRadius: 0.41, steer: false, maxSteerRad: 0 }], tracks: [] } },
      'fixture'
    );
    if (!spec) throw new Error('no spec');
    const e = h.priv.vehicleMeshEntities.get(h.id) as VehicleMeshEntity;
    bindRunningGear(e, spec); // bound CLEAN: release will hand back the template
    h.toBand(1);
    h.priv.updateVehicleMeshes(1, 16);
    const livingHex = (h.hull().material as THREE.MeshStandardMaterial).color.getHex();
    expect(livingHex).not.toBe(template.color.getHex());

    h.sim.debugKill(h.id);
    h.priv.updateVehicleMeshes(1, 16);
    expect(h.priv.vehicleDying).toHaveLength(1);
    // Break check: delete the re-apply after `releaseRunningGear` in the prune
    // loop -> the dying hull's (fade-cloned) colour is the template's again.
    let dyingHex = -1;
    for (const top of e.liveTop) {
      top.traverse((o) => {
        const m = o as THREE.Mesh;
        if (dyingHex < 0 && m.isMesh && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          dyingHex = (m.material as THREE.MeshStandardMaterial).color.getHex();
        }
      });
    }
    expect(dyingHex).toBe(livingHex);
    h.renderer.dispose();
  });
});
