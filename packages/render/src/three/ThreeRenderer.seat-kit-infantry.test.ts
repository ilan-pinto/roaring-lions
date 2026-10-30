// Per-seat INFANTRY kit (GH-826): `loadMeshUnit` files a SECOND template set,
// keyed `${id}#s1`, when a versus room's two seats field different kit on the
// same infantry type id, and only then -- and only while the shipped switch
// (`INFANTRY_KIT_ENABLED`) is on. PR 891 gated the second set on that switch;
// this pins that it is back, through the REAL `inf_squad.glb` and the REAL
// `buildMeshUnitTemplate` (only the GLB fetch is replaced, so the template that
// comes back wears exactly the kit the renderer asked for).
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Sim, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { INFANTRY_KIT_ENABLED } from './units/infantry-kit';
import type { MeshUnitTemplate } from './units/mesh-unit';
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

const GLB = readFileSync(new URL('../../../../art/meshes/inf_squad.glb', import.meta.url));

const stub = vi.hoisted(() => ({
  /** Every tiers table the loader was asked to build with, in call order. */
  calls: [] as (Readonly<Record<string, number>> | undefined)[],
  /** The `kitEnabled` argument it passed (undefined = the shipped switch). */
  forced: undefined as boolean | undefined,
  made: [] as MeshUnitTemplate[],
}));

vi.mock('./units/mesh-unit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./units/mesh-unit')>();
  return {
    ...actual,
    loadMeshUnitTemplate: async (
      url: string,
      faction: Parameters<typeof actual.buildMeshUnitTemplate>[1],
      allowTextured = false,
      _cold?: boolean,
      tiers?: Readonly<Record<string, number>>
    ) => {
      stub.calls.push(tiers);
      const { parseGlbHeadless: parse } = await import('./units/headless-gltf');
      const gltf = await parse(GLB);
      const t =
        stub.forced === undefined
          ? actual.buildMeshUnitTemplate(gltf, faction, url, allowTextured, tiers)
          : actual.buildMeshUnitTemplate(gltf, faction, url, allowTextured, tiers, stub.forced);
      stub.made.push(t);
      return t;
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

const SQUAD: UnitTypeJson = {
  id: 'inf_squad',
  role: 'rifle',
  hull: { hp: 100, armor: { front: 0, side: 0, rear: 0 } },
  mobility: { speed_tiles_s: 1.5 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
};

interface Privates {
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
}

const DIFFERING: KitTiersBySide = [{ inf_squad: { armour: 1 } }, { inf_squad: { armour: 3, sensors: 3, firepower: 3 } }];
const EQUAL: KitTiersBySide = [{ inf_squad: { armour: 1 } }, { inf_squad: { armour: 1, sensors: 0 } }];

function rig(bySide?: KitTiersBySide): { renderer: ThreeRenderer; priv: Privates } {
  const sim = new Sim({ seed: 1, width: 16, height: 16, capacity: 4 });
  sim.addUnitType(SQUAD);
  const renderer = new ThreeRenderer(sim, makeOpts(bySide));
  return { renderer, priv: renderer as unknown as Privates };
}

const tris = (t: MeshUnitTemplate, role: string): number => {
  let n = 0;
  t.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.name === role) n = (m.geometry.index?.count ?? 0) / 3;
  });
  return n;
};

beforeEach(() => {
  stub.calls = [];
  stub.forced = undefined;
  stub.made = [];
});

describe('loadMeshUnit files a template set per seat only where the infantry kits differ', () => {
  it('the shipped switch is on, which is what these tests rely on', () => {
    expect(INFANTRY_KIT_ENABLED).toBe(true);
  });

  it('differing tiers: files `id` and `id#s1`, each built with its own side\'s tiers and wearing its own kit', async () => {
    const { renderer, priv } = rig(DIFFERING);
    await renderer.loadMeshUnit('inf_squad', 'inf_squad.glb', 'kdf');

    expect(stub.calls).toEqual([{ armour: 1 }, { armour: 3, sensors: 3, firepower: 3 }]);
    const [t0, t1] = stub.made;
    expect(priv.meshUnitTemplates.get('inf_squad')).toEqual([t0]);
    expect(priv.meshUnitTemplates.get('inf_squad#s1')).toEqual([t1]);
    // Literals: armour 1 alone, and the full kit (infantry-kit-shipped.test.ts).
    expect(tris(t0, 'uniform')).toBe(7818);
    expect(tris(t0, 'weapon')).toBe(945);
    expect(tris(t1, 'uniform')).toBe(8982);
    expect(tris(t1, 'weapon')).toBe(2353);
    renderer.dispose();
  });

  it('kits that agree (zero tiers dropped): only `id` is filed', async () => {
    const { renderer, priv } = rig(EQUAL);
    await renderer.loadMeshUnit('inf_squad', 'inf_squad.glb', 'kdf');
    expect(stub.calls).toEqual([{ armour: 1 }]);
    expect([...priv.meshUnitTemplates.keys()]).toEqual(['inf_squad']);
    renderer.dispose();
  });

  it('no `bySide` (single-player): only `id` is filed, built with `unitKitTiers`', async () => {
    const { renderer, priv } = rig();
    (renderer as unknown as { opts: RendererOptions }).opts = { ...makeOpts(), unitKitTiers: { inf_squad: { armour: 2 } } };
    await renderer.loadMeshUnit('inf_squad', 'inf_squad.glb', 'kdf');
    expect(stub.calls).toEqual([{ armour: 2 }]);
    expect([...priv.meshUnitTemplates.keys()]).toEqual(['inf_squad']);
    expect(tris(priv.meshUnitTemplates.get('inf_squad')![0], 'uniform')).toBe(8106);
    renderer.dispose();
  });

  it('a reload whose kits now agree drops the `#s1` set', async () => {
    const { renderer, priv } = rig(DIFFERING);
    await renderer.loadMeshUnit('inf_squad', 'inf_squad.glb', 'kdf');
    expect(priv.meshUnitTemplates.has('inf_squad#s1')).toBe(true);
    (renderer as unknown as { opts: RendererOptions }).opts = makeOpts(EQUAL);
    await renderer.loadMeshUnit('inf_squad', 'inf_squad.glb', 'kdf');
    expect(priv.meshUnitTemplates.has('inf_squad#s1')).toBe(false);
    renderer.dispose();
  });
});
