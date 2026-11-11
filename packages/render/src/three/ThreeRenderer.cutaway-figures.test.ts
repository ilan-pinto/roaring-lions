/**
 * GH-1225 slice 2 (L6): where a garrisoned unit is DRAWN, through the real `updateMeshUnits` and a shipped GLB (the
 * `kneel-rise` fixture). Uncut, its root stands exactly at the interpolated sim position, so the no-garrison and the
 * fogged-garrison draw is unchanged; cut, at its station from `placeGarrisonStations`.
 * Falsify: read the station in `updateMeshUnits` whatever `garrisonStationAt` holds (e.g. always the footprint corner) and the
 * uncut row goes red; drop the station read and the cut row goes red.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { parseGlbHeadless } from './units/headless-gltf';
import { MESH_SCALE } from './units/mesh-anim';
import type { BuildingMeshTemplate } from './units/mesh-building';
import { buildMeshUnitTemplate, type MeshUnitEntity, type MeshUnitTemplate } from './units/mesh-unit';
import { TEXTURED_INFANTRY_TYPES } from './units/textured-infantry';

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

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree', haze: '#E0B87A',
};
const OPTS: RendererOptions = {
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

interface Private {
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  garrisonStationAt: Map<number, [number, number]>;
  fog: Uint8Array;
  updateBuildingMeshes(): void;
  updateCutaway(alpha: number, dtMs: number): void;
  updateMeshUnits(alpha: number, dtMs: number): void;
}

const W = 16;
const TEAM = 'demo_squad';

async function setUp(side: number) {
  const sim = new Sim({ seed: 1, width: W, height: W, capacity: 8 });
  const type: UnitTypeJson = {
    id: TEAM,
    role: 'infantry',
    hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
    mobility: { speed_tiles_s: 0.9 },
    sensors: { optics: 1, sight_tiles: 9, signature: 0.6 },
  };
  const house = sim.addStructureType({ id: 'house', hp_per_tile: 200, height_px: 22, color: 'limestone.3', garrison_slots: 4 });
  const s = sim.addStructure(house, [5 * W + 5, 5 * W + 6, 6 * W + 5, 6 * W + 6]);
  const id = sim.spawn(sim.addUnitType(type), side, fx.from(6), fx.from(6));
  sim.state.garrisonedIn[id] = s;
  sim.structures.occupants[s] = 1;
  const renderer = new ThreeRenderer(sim, OPTS);
  const priv = renderer as unknown as Private;
  const gltf = await parseGlbHeadless(readFileSync(`${REPO}art/meshes/${TEAM}.glb`));
  priv.meshUnitTemplates.set(TEAM, [buildMeshUnitTemplate(gltf, 'kdf', `${TEAM}.glb`, TEXTURED_INFANTRY_TYPES.has(TEAM))]);
  const root = new THREE.Group();
  root.scale.setScalar(MESH_SCALE);
  const base = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6).translate(0, 3, 0), base));
  priv.buildingMeshIdleTemplates.set('house', { root, materials: [base], geometries: [] });
  renderer.snapshot();
  renderer.snapshot();
  priv.updateBuildingMeshes();
  priv.fog.fill(0);
  const frames = (n: number): THREE.Vector3 => {
    for (let k = 0; k < n; k++) {
      priv.updateMeshUnits(1, 10);
      priv.updateCutaway(1, 10);
    }
    priv.updateMeshUnits(1, 10);
    return priv.meshUnitEntities.get(id)!.root.position;
  };
  return { renderer, priv, id, frames };
}

describe('roof cutaway slice 2: where a garrisoned figure is drawn', () => {
  it('uncut (a fogged enemy garrison): the root stands exactly at the sim position', async () => {
    const { renderer, frames } = await setUp(1);
    const p = frames(30);
    expect(renderer.cutawayCount()).toBe(0);
    expect([p.x, p.z]).toEqual([6, 6]);
  }, 60_000);

  it('fog reads the SIM position, not the station: a cut enemy garrison whose tile is fogged stays hidden, though its station is in sight', async () => {
    const { renderer, priv, id, frames } = await setUp(1);
    priv.fog[5 * W + 5] = 2; // one footprint tile in sight (the house is shown and cut); the garrison's own tile (6, 6) stays fogged
    frames(30);
    expect(renderer.cutawayCount(), 'the building is cut: its garrison is known').toBe(1);
    const station = priv.garrisonStationAt.get(id)!;
    expect(Math.floor(station[0]) + Math.floor(station[1]) * W, 'the station stands on the visible tile').toBe(5 * W + 5);
    expect(priv.meshUnitEntities.get(id)!.root.visible).toBe(false);
  }, 60_000);

  it('cut (the viewer\'s own garrison): the root stands at its station, inside the footprint and off the centre', async () => {
    const { renderer, priv, id, frames } = await setUp(0);
    const p = frames(30);
    expect(renderer.cutawayCount()).toBe(1);
    const station = priv.garrisonStationAt.get(id)!;
    expect([p.x, p.z]).toEqual(station);
    expect([p.x, p.z]).not.toEqual([6, 6]);
  }, 60_000);
});
