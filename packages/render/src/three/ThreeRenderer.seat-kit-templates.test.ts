// Per-seat kit (Task 6): `loadVehicleMesh` files a SECOND vehicle template,
// keyed `${id}#s1`, when a versus room's two seats field different kit on the
// same type id -- and only then. The filing is the part no picture witnesses
// (CI's visual job is single-player), so it is pinned here, headlessly: only
// the GLB FETCH is replaced (`loadVehicleMeshTemplate`, as
// `ThreeRenderer.blast.test.ts` does), and the template build, the bounds
// measure, the reload path and the disposal are the shipped ones.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Sim, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { buildVehicleMeshTemplate, vehicleShroudBounds, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import type { KitTiersBySide } from './units/kit-template-key';

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

/** What the stubbed fetch hands back: one template per call, by kit. */
const stub = vi.hoisted(() => ({
  /** Every (tiers) the loader was asked for, in call order. */
  calls: [] as (Readonly<Record<string, number>> | undefined)[],
  /** Tiers whose build should fail (compared as JSON). */
  failFor: null as string | null,
  /** The templates handed out, in call order. */
  made: [] as unknown[],
  disposed: [] as unknown[],
  build: null as null | (() => Promise<unknown>),
}));

vi.mock('./units/mesh-vehicle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./units/mesh-vehicle')>();
  return {
    ...actual,
    loadVehicleMeshTemplate: async (
      _url: string,
      _id: string,
      _textured: boolean,
      tiers?: Readonly<Record<string, number>>
    ) => {
      stub.calls.push(tiers);
      if (stub.failFor !== null && JSON.stringify(tiers ?? {}) === stub.failFor) throw new Error('side-1 GLB failed');
      const t = (await (stub.build as () => Promise<unknown>)()) as VehicleMeshTemplate;
      // Each template a different size, so a bounds map that measured the
      // wrong template cannot read equal by coincidence.
      t.root.scale.multiplyScalar(stub.made.length + 1);
      stub.made.push(t);
      return t;
    },
    disposeVehicleMeshTemplate: (t: VehicleMeshTemplate) => {
      stub.disposed.push(t);
      actual.disposeVehicleMeshTemplate(t);
    },
  };
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

function makeOpts(bySide?: KitTiersBySide): RendererOptions {
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
    ...(bySide ? { unitKitTiersBySide: bySide } : {}),
  };
}

const LAVI: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'mbt',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

interface Privates {
  opts: RendererOptions;
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshBounds: Map<string, THREE.Vector3>;
  vehicleScars: Map<string, { dispose(): void }>;
}

const DIFFERING: KitTiersBySide = [{ mbt_lavi: { armour: 1 } }, { mbt_lavi: { armour: 3, sensors: 1 } }];
const EQUAL: KitTiersBySide = [{ mbt_lavi: { armour: 1 } }, { mbt_lavi: { armour: 1, sensors: 0 } }];

function rig(bySide?: KitTiersBySide): { renderer: ThreeRenderer; priv: Privates } {
  const sim = new Sim({ seed: 1, width: 16, height: 16, capacity: 4 });
  sim.addUnitType(LAVI);
  const renderer = new ThreeRenderer(sim, makeOpts(bySide));
  return { renderer, priv: renderer as unknown as Privates };
}

beforeEach(() => {
  stub.calls = [];
  stub.failFor = null;
  stub.made = [];
  stub.disposed = [];
  stub.build = async () =>
    buildVehicleMeshTemplate(
      await parseRigidFixture({
        parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }],
        clipNames: ['idle', 'wreck'],
        deathRoot: { parts: ['hull_hull'] },
      }),
      'mbt_lavi'
    );
});

describe('loadVehicleMesh files a template per seat only where the kits differ', () => {
  it('differing tiers: files `id` and `id#s1`, each built with its own side\'s tiers and measured', async () => {
    const { renderer, priv } = rig(DIFFERING);
    await renderer.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');

    expect(stub.calls).toEqual([{ armour: 1 }, { armour: 3, sensors: 1 }]);
    const [t0, t1] = stub.made as VehicleMeshTemplate[];
    expect(priv.vehicleMeshTemplates.get('mbt_lavi')).toBe(t0);
    expect(priv.vehicleMeshTemplates.get('mbt_lavi#s1')).toBe(t1);
    expect(priv.vehicleMeshBounds.get('mbt_lavi')).toEqual(vehicleShroudBounds(t0.root));
    expect(priv.vehicleMeshBounds.get('mbt_lavi#s1')).toEqual(vehicleShroudBounds(t1.root));
    renderer.dispose();
  });

  it('a reload whose kits now agree drops `#s1`, its bounds and its scar memo', async () => {
    const { renderer, priv } = rig(DIFFERING);
    await renderer.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');
    const oldSide1 = priv.vehicleMeshTemplates.get('mbt_lavi#s1');
    const scar = { dispose: vi.fn() };
    priv.vehicleScars.set('mbt_lavi#s1', scar);

    priv.opts = { ...priv.opts, unitKitTiersBySide: EQUAL };
    await renderer.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');

    expect(priv.vehicleMeshTemplates.has('mbt_lavi#s1')).toBe(false);
    expect(priv.vehicleMeshBounds.has('mbt_lavi#s1')).toBe(false);
    expect(priv.vehicleScars.has('mbt_lavi#s1')).toBe(false);
    expect(scar.dispose).toHaveBeenCalledTimes(1);
    expect(stub.disposed).toContain(oldSide1);
    expect(priv.vehicleMeshTemplates.get('mbt_lavi')).toBe(stub.made[stub.made.length - 1]);
    renderer.dispose();
  });

  it('a side-1 build failure files neither key and disposes side 0\'s fresh template', async () => {
    const { renderer, priv } = rig(DIFFERING);
    stub.failFor = JSON.stringify({ armour: 3, sensors: 1 });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(renderer.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb')).rejects.toThrow(/side-1/);

    expect(priv.vehicleMeshTemplates.has('mbt_lavi')).toBe(false);
    expect(priv.vehicleMeshTemplates.has('mbt_lavi#s1')).toBe(false);
    expect(priv.vehicleMeshBounds.has('mbt_lavi')).toBe(false);
    expect(stub.made).toHaveLength(1);
    expect(stub.disposed).toContain(stub.made[0]);
    error.mockRestore();
    renderer.dispose();
  });

  it('no `bySide` (single-player): only `id` is filed, built with `unitKitTiers`', async () => {
    const { renderer, priv } = rig();
    priv.opts = { ...priv.opts, unitKitTiers: { mbt_lavi: { armour: 2 } } };
    await renderer.loadVehicleMesh('mbt_lavi', 'mbt_lavi.glb');

    expect(stub.calls).toEqual([{ armour: 2 }]);
    expect([...priv.vehicleMeshTemplates.keys()]).toEqual(['mbt_lavi']);
    expect([...priv.vehicleMeshBounds.keys()]).toEqual(['mbt_lavi']);
    renderer.dispose();
  });
});
