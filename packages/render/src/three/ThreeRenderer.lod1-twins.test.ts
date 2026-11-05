/**
 * GH-974: the LOD1 twins of the clone-drawn house and of the ditch, driven through `updateBuildingMeshes` like the
 * wall's (`ThreeRenderer.structure-instances.test.ts`). Private state is reached the way that file reaches it.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { MESH_SCALE } from './units/mesh-anim';
import type { BuildingMeshTemplate } from './units/mesh-building';
import { pairLod1Materials } from './units/building-lod';
import { buildTexturedDecorMesh, type TexturedDecorSet } from './terrain/decor-textured-mesh';

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

const ROLES = ['wall', 'roof'];

function template(size: number): BuildingMeshTemplate {
  const root = new THREE.Group();
  root.scale.setScalar(MESH_SCALE);
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  for (const role of ROLES) {
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.rl_role = role;
    root.add(mesh);
    geos.push(geo);
    mats.push(mat);
  }
  return { root, materials: mats, geometries: geos };
}

interface Private {
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshLod1Templates: Map<string, { root: THREE.Object3D; geometries: THREE.BufferGeometry[] }>;
  buildingMeshLod1Entities: Map<number, THREE.Object3D>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  buildingDamageBand: Map<number, number>;
  texturedDecorGroup: THREE.Group | null;
  camera: { zoom: number };
  updateBuildingMeshes(): void;
}

function world(withTwin = true) {
  const sim = new Sim({ seed: 1, width: 12, height: 12, capacity: 1 });
  const house = sim.addStructureType({ id: 'house', hp_per_tile: 80, height_px: 11, color: 'dust.1' });
  const s = sim.addStructure(house, [5 + 5 * sim.width]);
  const r = new ThreeRenderer(sim, makeOpts());
  const priv = r as unknown as Private;
  const idle = template(1);
  priv.buildingMeshIdleTemplates.set('house', idle);
  if (withTwin) {
    const twin = template(0.5);
    expect(pairLod1Materials(twin.root, idle.root)).toBe(true);
    priv.buildingMeshLod1Templates.set('house', { root: twin.root, geometries: [...twin.geometries] });
  }
  const at = (zoom: number): { full: THREE.Object3D; twin: THREE.Object3D | undefined } => {
    priv.camera.zoom = zoom;
    priv.updateBuildingMeshes();
    return { full: priv.buildingMeshIdleEntities.get(s) as THREE.Object3D, twin: priv.buildingMeshLod1Entities.get(s) };
  };
  return { sim, r, priv, s, at, idle };
}

describe('the house twin (clone path)', () => {
  it('shows the twin below zoom 2.0 and the full house from 2.0, one or the other', () => {
    const w = world();
    let { full, twin } = w.at(1);
    expect(twin).toBeDefined();
    expect([twin!.visible, full.visible]).toEqual([true, false]);
    ({ full, twin } = w.at(1.99));
    expect([twin!.visible, full.visible]).toEqual([true, false]);
    ({ full, twin } = w.at(2.06));
    expect([twin!.visible, full.visible]).toEqual([false, true]);
    ({ full, twin } = w.at(1.5));
    expect([twin!.visible, full.visible]).toEqual([true, false]);
  });

  it('holds the twin to 2.05 once on (hysteresis) and not from above', () => {
    const w = world();
    w.at(1);
    let r = w.at(2.03);
    expect([r.twin!.visible, r.full.visible]).toEqual([true, false]);
    r = w.at(2.06);
    expect([r.twin!.visible, r.full.visible]).toEqual([false, true]);
    r = w.at(2.03); // coming down from above: still full until it is below 2.0
    expect([r.twin!.visible, r.full.visible]).toEqual([false, true]);
  });

  it('draws the twin at the placement of the full house, with the full house\'s own materials', () => {
    const w = world();
    const { full, twin } = w.at(1);
    expect(twin!.position.toArray()).toEqual(full.position.toArray());
    expect(twin!.scale.toArray()).toEqual(full.scale.toArray());
    const mats = (o: THREE.Object3D): Record<string, THREE.Material> => {
      const out: Record<string, THREE.Material> = {};
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) out[m.userData.rl_role as string] = (m as THREE.Mesh).material as THREE.Material;
      });
      return out;
    };
    expect(mats(twin!)).toEqual(mats(full));
    expect(Object.keys(mats(twin!)).sort()).toEqual(['roof', 'wall']);
  });

  it('keeps the full house while it is scarred', () => {
    const w = world();
    w.at(1);
    w.priv.buildingDamageBand.set(w.s, 4);
    const r = w.at(1);
    expect([r.twin!.visible, r.full.visible]).toEqual([false, true]);
  });

  it('A/B switch off draws the full house at every zoom', () => {
    const w = world();
    w.r.debugStructureLod1(false);
    const r = w.at(1);
    expect([r.twin!.visible, r.full.visible]).toEqual([false, true]);
  });

  it('the buildings debug layer hides both and the swap does not turn one back on', () => {
    const w = world();
    w.at(1);
    w.r.setDebugLayerVisible('buildings', false);
    const r = w.at(1);
    expect([r.twin!.visible, r.full.visible]).toEqual([false, false]);
  });

  it('removes the twin with the standing house', () => {
    const w = world();
    w.at(1);
    expect(w.priv.buildingMeshLod1Entities.size).toBe(1);
    w.sim.structures.alive[w.s] = 0;
    w.at(1);
    expect(w.priv.buildingMeshIdleEntities.size).toBe(0);
    expect(w.priv.buildingMeshLod1Entities.size).toBe(0);
  });

  it('a type with no twin draws exactly as before', () => {
    const w = world(false);
    const r = w.at(1);
    expect(r.twin).toBeUndefined();
    expect(r.full.visible).toBe(true);
  });
});

describe('the ditch twin (frame level)', () => {
  function ditchWorld() {
    const w = world(false);
    const set: TexturedDecorSet = {
      parts: new Map([
        ['ditch_0', { geometry: new THREE.BoxGeometry(1, 1, 1), map: new THREE.Texture() }],
        ['ditch_lod1', { geometry: new THREE.BoxGeometry(1, 0.5, 1), map: new THREE.Texture() }],
      ]),
    };
    w.priv.texturedDecorGroup = buildTexturedDecorMesh([{ family: 'ditch', variant: 0, x: 1.5, z: 2.5, y: 0, yawTurns: 0, scale: 1 }], set);
    const lod = (): [boolean, boolean] => {
      const kids = w.priv.texturedDecorGroup!.children;
      return [kids.find((k) => k.userData.lod1 === true)!.visible, kids.find((k) => k.userData.lod1 === false)!.visible];
    };
    return { ...w, lod };
  }

  it('swaps through the frame, with the wall\'s band, even with no building template loaded', () => {
    const w = ditchWorld();
    w.priv.buildingMeshIdleTemplates.clear();
    w.priv.camera.zoom = 1;
    w.priv.updateBuildingMeshes();
    expect(w.lod()).toEqual([true, false]);
    w.priv.camera.zoom = 2.0;
    w.priv.updateBuildingMeshes();
    expect(w.lod()).toEqual([true, false]); // held to 2.05 once on
    w.priv.camera.zoom = 2.06;
    w.priv.updateBuildingMeshes();
    expect(w.lod()).toEqual([false, true]);
  });

  it('the A/B switch draws the full ditch at every zoom', () => {
    const w = ditchWorld();
    w.r.debugStructureLod1(false);
    w.priv.camera.zoom = 1;
    w.priv.updateBuildingMeshes();
    expect(w.lod()).toEqual([false, true]);
  });
});
