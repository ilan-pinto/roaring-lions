/**
 * Regression test for GitHub #141: "the sandbox draws sprites, never
 * meshes, until the sim is stepped."
 *
 * The reported symptom was `vehicleMeshEntities.size === 0` (and
 * `meshUnitEntities.size === 0`) at `sim.tickCount === 0`, becoming 12/17
 * only after `__lions.step(1)`. Investigating live (`?sandbox=
 * beit_sahwan_outskirts&sur`, dev server, tab backgrounded so
 * `requestAnimationFrame` never fires) showed the true mechanism: calling
 * `renderer.frame()` ALONE, with `sim.tickCount` still 0 and no
 * `sim.tick()` ever having run, already populates both maps correctly
 * (`vehicleMeshEntities` 12, `meshUnitEntities` 17) -- entity creation was
 * never gated on a tick. The actual gap was that nothing had called
 * `frame()` at all yet: `main.ts`'s one call site lived inside the
 * `requestAnimationFrame` loop, and rAF is throttled to near-zero the
 * moment a tab is backgrounded -- exactly the state a browser driven for an
 * art check sits in. The fix (`main.ts`) primes one `frame()` call right
 * before the loop starts, independent of rAF ever firing, without calling
 * `sim.tick()` -- `tickCount` stays 0.
 *
 * `ThreeRenderer.mesh-death.test.ts` already pins the infantry half of this
 * contract for `updateMeshUnits`/`meshUnitEntities` (its own `setUp` never
 * calls `sim.tick()` either). This file is the missing vehicle half --
 * `updateVehicleMeshes`/`vehicleMeshEntities` is a wholly separate method
 * and map, and the bug report's FIRST number was this one.
 *
 * Harness follows `ThreeRenderer.mesh-death.test.ts` exactly: a real
 * `GLTFLoader`-parsed fixture installed directly into the private template
 * map (bypassing `loadVehicleMesh`'s network fetch), `renderer.snapshot()`
 * called twice with NO `sim.tick()` in between -- exactly what
 * `ThreeRenderer.init()` itself does ("prev == cur on the first frame")
 * before the app's rAF loop has run even once.
 *
 * Verified by mutation (per this project's own testing standard): gating
 * `updateVehicleMeshes`'s entity-creation loop on `if (this.sim.tickCount >
 * 0)` turns this file's first test red with `vehicleMeshEntities.size`
 * reading `0` instead of `1`; reverting turns it green again.
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

// A real id from `VEHICLE_ROLE_PALETTE` (`vehicle-mesh-role.ts`) --
// `buildVehicleMeshTemplate` throws loudly for an id outside that closed
// table (`mesh-vehicle.test.ts`'s own "throws loudly for an unknown vehicle
// id" pins it), so a synthetic id does not work here the way it does for
// `mesh-death.test.ts`'s infantry fixture. `dozer_d9` is the simplest entry:
// hull-only, no turret pivot.
const VEH: UnitTypeJson = {
  id: 'dozer_d9',
  role: 'vehicle',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

/** Reaches every private field/method this file needs -- there is no public
 *  accessor for any of them, matching `ThreeRenderer.mesh-death.test.ts`'s
 *  own identically-justified interface. */
interface ThreeRendererPrivates {
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
}

async function setUp() {
  const sim = new Sim({ seed: 1, width: 20, height: 20, capacity: 4 });
  const typeIdx = sim.addUnitType(VEH);
  const id = sim.spawn(typeIdx, 0, fx.from(9.5), fx.from(11.5));

  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ThreeRendererPrivates;

  const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
  const template = buildVehicleMeshTemplate(gltf, VEH.id);
  priv.vehicleMeshTemplates.set(VEH.id, template);

  // Exactly `ThreeRenderer.init()`'s own "prev == cur on the first frame"
  // double snapshot -- and, like `init()`, no `sim.tick()` anywhere in this
  // function. `sim.tickCount` stays 0 for the whole test.
  renderer.snapshot();
  renderer.snapshot();

  return { sim, renderer, priv, id };
}

describe('ThreeRenderer vehicle mesh entity creation (GitHub #141)', () => {
  it('instantiates a VehicleMeshEntity from a living entity with tickCount still 0', async () => {
    const { sim, priv, id } = await setUp();
    expect(sim.tickCount).toBe(0); // no tick ran -- this is the reported "tick 0" state

    priv.updateVehicleMeshes(1, 16);

    expect(priv.vehicleMeshEntities.size).toBe(1);
    expect(priv.vehicleMeshEntities.has(id)).toBe(true);
    expect(sim.tickCount).toBe(0); // still true after the call that creates it
  });

  it('positions the entity from the sim spawn tile, not the coordinate-buffer zero-fill', async () => {
    const { priv, id } = await setUp();
    priv.updateVehicleMeshes(1, 16);
    const root = priv.vehicleMeshEntities.get(id)!.root;
    // Spawned at (9.5, 11.5); world X/Z mirror game X/Y directly for this
    // backend (`EntityFrame`'s own top comment). Ground Y varies with flat
    // terrain elevation, so only X/Z are asserted.
    expect(root.position.x).toBeCloseTo(9.5, 5);
    expect(root.position.z).toBeCloseTo(11.5, 5);
  });

  it('does nothing when no living entity has a vehicle-mesh-enabled type', async () => {
    const sim = new Sim({ seed: 1, width: 10, height: 10, capacity: 4 });
    const typeIdx = sim.addUnitType({ ...VEH, id: 'unmapped_veh' });
    sim.spawn(typeIdx, 0, fx.from(2.5), fx.from(2.5));
    const renderer = new ThreeRenderer(sim, makeOpts());
    const priv = renderer as unknown as ThreeRendererPrivates;
    renderer.snapshot();
    renderer.snapshot();

    priv.updateVehicleMeshes(1, 16); // vehicleMeshTemplates is empty -- early return

    expect(priv.vehicleMeshEntities.size).toBe(0);
  });
});
