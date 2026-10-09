// GH-469 saving 2: a COLD template (textures still encoded) is never drawn.
// A building's wreck is held standing, under its collapse cloud, until its
// textures decode, and the first hit on the type starts that decode; a unit
// type is not instantiated until warm, and an ORDER warms it before it exists.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { MESH_SCALE } from './units/mesh-anim';
import type { BuildingMeshTemplate } from './units/mesh-building';
import { buildVehicleMeshTemplate, type VehicleMeshTemplate, type VehicleMeshEntity } from './units/mesh-vehicle';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import { buildMeshUnitTemplate, type MeshUnitTemplate, type MeshUnitEntity } from './units/mesh-unit';
import { parseFixture } from './units/mesh-fixture';
import { isColdTexture, markColdTexture } from './units/gltf-loader';

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


const BITMAP = { width: 4, height: 4 } as ImageBitmap;

/** A template whose one mesh carries a cold texture. */
function coldTemplate(): { template: BuildingMeshTemplate; tex: THREE.Texture } {
  const tex = new THREE.Texture();
  markColdTexture(tex, new Blob(['png']));
  const root = new THREE.Group();
  root.scale.setScalar(MESH_SCALE);
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: tex })));
  return { template: { root, materials: [], geometries: [] }, tex };
}

interface ColdPrivates {
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshWreckTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  buildingMeshWreckEntities: Map<number, THREE.Object3D>;
  coldWreckTypes: Set<string>;
  coldUnitTypes: Set<string>;
  imageDecoder: ((b: Blob) => Promise<ImageBitmap>) | undefined;
  updateBuildingMeshes(): void;
  refreshBuildingDamage(s: number): void;
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  updateMeshUnits(alpha: number, dtMs: number): void;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function wreckRig() {
  const sim = new Sim({ seed: 1, width: 4, height: 4, capacity: 1 });
  const type = sim.addStructureType({ id: 'shanty', hp_per_tile: 50, height_px: 11, color: 'dust.1' });
  const s = sim.addStructure(type, [0]);
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ColdPrivates;
  const decode = vi.fn(async () => BITMAP);
  priv.imageDecoder = decode;
  priv.buildingMeshIdleTemplates.set('shanty', { root: new THREE.Group(), materials: [], geometries: [] });
  const cold = coldTemplate();
  priv.buildingMeshWreckTemplates.set('shanty', cold.template);
  priv.coldWreckTypes.add('shanty'); // what `loadBuildingWreckMesh` records
  priv.updateBuildingMeshes(); // the standing clone
  return { sim, s, priv, decode, tex: cold.tex };
}

describe('cold wreck templates', () => {
  it('keeps the standing building until the wreck textures decode, then swaps', async () => {
    const { sim, s, priv, tex } = wreckRig();
    sim.structures.alive[s] = 0; // killed outright: no hit ever warmed it
    priv.updateBuildingMeshes();
    expect(priv.buildingMeshWreckEntities.has(s)).toBe(false);
    expect(priv.buildingMeshIdleEntities.has(s)).toBe(true);
    await flush();
    priv.updateBuildingMeshes();
    expect(isColdTexture(tex)).toBe(false);
    expect(tex.source.data).toBe(BITMAP);
    expect(priv.buildingMeshWreckEntities.has(s)).toBe(true);
  });

  it('starts decoding on the FIRST hit, long before a collapse', async () => {
    const { sim, s, priv, decode } = wreckRig();
    sim.structures.hp[s] = sim.structures.maxHp[s] - 1;
    priv.refreshBuildingDamage(s);
    expect(decode).toHaveBeenCalledTimes(1);
    await flush();
    expect(priv.coldWreckTypes.has('shanty')).toBe(false);
  });
});

const VEH: UnitTypeJson = {
  id: 'dozer_d9',
  role: 'vehicle',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

async function unitRig() {
  const sim = new Sim({ seed: 1, width: 20, height: 20, capacity: 4 });
  const typeIdx = sim.addUnitType(VEH);
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ColdPrivates;
  priv.imageDecoder = vi.fn(async () => BITMAP);
  const gltf = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
  const template = buildVehicleMeshTemplate(gltf, VEH.id);
  const tex = new THREE.Texture();
  markColdTexture(tex, new Blob(['png']));
  template.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) (m.material as THREE.MeshStandardMaterial).map = tex;
  });
  priv.vehicleMeshTemplates.set(VEH.id, template);
  priv.coldUnitTypes.add(VEH.id); // what `loadVehicleMesh(..., { cold: true })` records
  return { sim, typeIdx, renderer, priv };
}

describe('cold unit templates', () => {
  it('does not instantiate a unit of a cold type, says why, and draws it once warm', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sim, typeIdx, renderer, priv } = await unitRig();
    sim.spawn(typeIdx, 0, fx.from(9.5), fx.from(11.5));
    renderer.snapshot();
    renderer.snapshot();
    priv.updateVehicleMeshes(1, 16);
    expect(priv.vehicleMeshEntities.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dozer_d9 reached the field before its textures were warmed'));
    await flush();
    priv.updateVehicleMeshes(1, 16);
    expect(priv.vehicleMeshEntities.size).toBe(1);
    warn.mockRestore();
  });

  it('an ORDER warms the type before the unit exists, so it draws on its first frame', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sim, typeIdx, renderer, priv } = await unitRig();
    renderer.warmUnitMesh(VEH.id); // the build is queued
    await flush();
    sim.spawn(typeIdx, 0, fx.from(9.5), fx.from(11.5)); // ...and done
    renderer.snapshot();
    renderer.snapshot();
    priv.updateVehicleMeshes(1, 16);
    expect(priv.vehicleMeshEntities.size).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

const INF: UnitTypeJson = {
  id: 'mesh_test_inf',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};

describe('cold infantry templates', () => {
  it('does not instantiate a cold infantry type until it is warm', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sim = new Sim({ seed: 1, width: 10, height: 10, capacity: 4 });
    const typeIdx = sim.addUnitType(INF);
    sim.spawn(typeIdx, 0, fx.from(4.5), fx.from(6.5));
    const renderer = new ThreeRenderer(sim, makeOpts());
    const priv = renderer as unknown as ColdPrivates;
    priv.imageDecoder = vi.fn(async () => BITMAP);
    const template = buildMeshUnitTemplate(await parseFixture({ roleName: 'uniform', clipName: 'idle' }), 'kdf');
    const tex = new THREE.Texture();
    markColdTexture(tex, new Blob(['png']));
    template.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.MeshStandardMaterial).map = tex;
    });
    priv.meshUnitTemplates.set(INF.id, [template]);
    priv.coldUnitTypes.add(INF.id);
    renderer.snapshot();
    renderer.snapshot();
    priv.updateMeshUnits(1, 16);
    expect(priv.meshUnitEntities.size).toBe(0);
    await flush();
    priv.updateMeshUnits(1, 16);
    expect(priv.meshUnitEntities.size).toBe(1);
    warn.mockRestore();
  });
});
