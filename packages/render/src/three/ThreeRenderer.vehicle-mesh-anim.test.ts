/**
 * The vehicle animation path, driven through the REAL frame loop.
 *
 * `units/mesh-vehicle.test.ts` pins the module half -- clips collected,
 * mixer built (or deliberately not built), actions switched. This file pins
 * the half that module cannot see: that `updateVehicleMeshes` actually
 * consults sim state, resolves a clip through `../clip.ts`'s `resolveClip`,
 * and advances the mixer on FRAME time. Without it, "art exists and does not
 * draw" is exactly the shape the gap would take -- a GLB carrying clips, a
 * mixer built for it, and nothing ever calling `applyMeshClip`.
 *
 * Harness copied from `ThreeRenderer.vehicle-mesh-priming.test.ts`: a real
 * `GLTFLoader`-parsed fixture installed straight into the private template
 * map (bypassing `loadVehicleMesh`'s fetch), a faked `WebGLRenderer`, and
 * `renderer.snapshot()` driving the interpolation buffers the way `frame()`
 * reads them.
 *
 * The unit type is `dozer_d9` because it is the state that motivates the
 * whole task: `role: engineer`, `demolition_time_s`, `abilities:
 * ['demolish']` -- a real sim state (`Sim.demolitionProgress`) that
 * `resolveClip` already answers `work` for, and which no vehicle could
 * previously play. Its id also has to be a real key in
 * `vehicle-mesh-role.ts`'s closed ramp table, which rules out a synthetic
 * one.
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
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

/** The D9, as `data/units/dozer_d9.json` declares it in the fields this path
 *  reads: it demolishes, and it moves. `demolition_method` is deliberately
 *  LEFT OFF (the shipped file says `blade`) so `demolitionProgress` reads the
 *  unit's own tick counter rather than its target's HP -- a blade's bar is 0
 *  until the building has actually taken a bite, which would make the first
 *  working tick indistinguishable from idle and this test's intent murky.
 *  Both branches return >0 while the dozer works; only the ramp differs. */
const DOZER: UnitTypeJson = {
  id: 'dozer_d9',
  role: 'engineer',
  abilities: ['demolish'],
  demolition_time_s: 4,
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

interface ThreeRendererPrivates {
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
}

async function setUp(clipNames?: readonly string[]) {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const typeIdx = sim.addUnitType(DOZER);
  const id = sim.spawn(typeIdx, 0, fx.from(9.5), fx.from(11.5));

  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ThreeRendererPrivates;

  const gltf = await parseRigidFixture({
    parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
    ...(clipNames ? { clipNames } : {}),
  });
  priv.vehicleMeshTemplates.set(DOZER.id, buildVehicleMeshTemplate(gltf, DOZER.id));

  renderer.snapshot();
  renderer.snapshot();
  return { sim, renderer, priv, id };
}

const ALL_CLIPS = ['idle', 'move', 'work'] as const;

describe('updateVehicleMeshes clip selection', () => {
  it('holds `idle` for a stationary vehicle', async () => {
    const { priv, id } = await setUp(ALL_CLIPS);
    priv.updateVehicleMeshes(1, 16);
    expect(priv.vehicleMeshEntities.get(id)?.currentClip).toBe('idle');
  });

  it('switches to `move` once the vehicle is actually rolling', async () => {
    const { sim, renderer, priv, id } = await setUp(ALL_CLIPS);
    priv.updateVehicleMeshes(1, 16);
    expect(priv.vehicleMeshEntities.get(id)?.currentClip).toBe('idle');

    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(18.5), y: fx.from(11.5) });
    for (let t = 0; t < 6; t++) {
      sim.tick();
      renderer.snapshot();
    }
    priv.updateVehicleMeshes(1, 16);

    expect(priv.vehicleMeshEntities.get(id)?.currentClip).toBe('move');
  });

  it('switches to `work` while the dozer is demolishing -- the state that had no vehicle clip', async () => {
    const { sim, renderer, priv, id } = await setUp(ALL_CLIPS);
    const shed = sim.addStructureType({ id: 'shed', hp_per_tile: 400 });
    // One tile east of the dozer's own (9, 11), well inside DEMO_RANGE.
    sim.addStructure(shed, [11 * 24 + 10]);

    sim.queueCommand({ kind: 'demolish', ids: [id], structure: 0 });
    for (let t = 0; t < 40; t++) {
      sim.tick();
      renderer.snapshot();
    }
    // Precondition, asserted rather than assumed: the SIM really is in the
    // working state. Without this the clip assertion below could pass for
    // the wrong reason (a stuck `idle` that never changed).
    expect(sim.demolitionProgress(id)).toBeGreaterThan(0);

    priv.updateVehicleMeshes(1, 16);
    expect(priv.vehicleMeshEntities.get(id)?.currentClip).toBe('work');
  });

  it('advances the mixer by the FRAME delta, with no sim tick involved', async () => {
    const { sim, priv, id } = await setUp(ALL_CLIPS);
    priv.updateVehicleMeshes(1, 16);
    const action = priv.vehicleMeshEntities.get(id)?.actions.get('idle');
    const t1 = action?.time ?? -1;
    expect(t1).toBeCloseTo(0.016, 5); // the first frame's own 16 ms

    // A second frame, ten times longer, with NO `sim.tick()` between: the
    // clip advances by the FRAME's delta. Anything driven off the 20 Hz sim
    // clock would step by a fixed 0.05 regardless of `dtMs` (invariant 1 --
    // animation is presentation and must never read sim time).
    const before = sim.tickCount;
    priv.updateVehicleMeshes(1, 100);
    expect((action?.time ?? -1) - t1).toBeCloseTo(0.1, 5);
    expect(sim.tickCount).toBe(before);
  });

  it('releases a dying vehicle\'s mixer instead of leaking it with the deleted entry', async () => {
    const { sim, priv, id } = await setUp(ALL_CLIPS);
    priv.updateVehicleMeshes(1, 16);
    const action = priv.vehicleMeshEntities.get(id)?.actions.get('idle');
    expect(action?.isRunning()).toBe(true);

    sim.debugKill(id);
    priv.updateVehicleMeshes(1, 16);

    expect(priv.vehicleMeshEntities.size).toBe(0);
    // The map entry is gone either way; what this pins is that the removal
    // loop actually calls `disposeVehicleMeshEntity`. Drop that call and the
    // entry vanishes while its mixer keeps its actions and its binding to a
    // clone nothing references any more.
    expect(action?.isRunning()).toBe(false);
  });

  it('releases every living vehicle mixer on renderer teardown', async () => {
    // The OTHER disposal site. `updateVehicleMeshes`'s death loop and
    // `dispose()` tear the same thing down by two different routes, and
    // dropping the call from either one leaks silently -- the entity map is
    // cleared regardless, so nothing else would notice.
    const { renderer, priv, id } = await setUp(ALL_CLIPS);
    priv.updateVehicleMeshes(1, 16);
    const action = priv.vehicleMeshEntities.get(id)?.actions.get('idle');
    expect(action?.isRunning()).toBe(true);

    renderer.dispose();

    expect(priv.vehicleMeshEntities.size).toBe(0);
    expect(action?.isRunning()).toBe(false);
  });

  it('falls back to `idle` for a clip this GLB never authored', async () => {
    const { sim, renderer, priv, id } = await setUp(['idle']);
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(18.5), y: fx.from(11.5) });
    for (let t = 0; t < 6; t++) {
      sim.tick();
      renderer.snapshot();
    }
    priv.updateVehicleMeshes(1, 16);
    expect(priv.vehicleMeshEntities.get(id)?.currentClip).toBe('idle');
  });
});

describe('updateVehicleMeshes with a clipless GLB -- every shipped vehicle today', () => {
  it('builds no mixer and latches no clip, however the vehicle is behaving', async () => {
    const { sim, renderer, priv, id } = await setUp();
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(18.5), y: fx.from(11.5) });
    for (let t = 0; t < 6; t++) {
      sim.tick();
      renderer.snapshot();
    }
    priv.updateVehicleMeshes(1, 16);
    const entity = priv.vehicleMeshEntities.get(id);
    expect(entity?.mixer).toBeNull();
    expect(entity?.currentClip).toBeNull();
  });

  it('leaves the clone`s transform tree exactly where the clipless path already put it', async () => {
    const { priv, id } = await setUp();
    priv.updateVehicleMeshes(1, 16);
    const node = priv.vehicleMeshEntities.get(id)?.root.getObjectByName('hull_hull');
    const q = node?.quaternion;
    // Identity: nothing in this path may touch a clipless vehicle's parts.
    expect(q?.x).toBeCloseTo(0, 6);
    expect(q?.y).toBeCloseTo(0, 6);
    expect(q?.z).toBeCloseTo(0, 6);
    expect(q?.w).toBeCloseTo(1, 6);
  });

  it('tears down without touching a mixer that was never allocated', async () => {
    const { sim, priv, id } = await setUp();
    priv.updateVehicleMeshes(1, 16);
    expect(priv.vehicleMeshEntities.size).toBe(1);
    sim.debugKill(id);
    expect(() => priv.updateVehicleMeshes(1, 16)).not.toThrow();
    expect(priv.vehicleMeshEntities.size).toBe(0);
  });
});
