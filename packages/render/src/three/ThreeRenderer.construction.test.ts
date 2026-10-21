/**
 * #277 Task 13: an unfinished field work draws its construction mesh under a
 * clip plane at `progress x height`, swaps to the standing mesh at ONE, and a
 * cancelled / destroyed site is torn down with its material clones disposed.
 * Armed directly with headless stand-ins, as the per-tile-facing suite is.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ONE, Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { BuildingMeshTemplate } from './units/mesh-building';

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

function boxTemplate(): BuildingMeshTemplate {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const geometry = new THREE.BoxGeometry(1, 4, 1);
  geometry.translate(0, 2, 0); // standing on y = 0, 4 tall
  root.add(new THREE.Mesh(geometry, material));
  return { root, materials: [material], geometries: [geometry] };
}

interface Priv {
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshConstructionTemplates: Map<string, BuildingMeshTemplate>;
  buildingConstructionHeight: Map<string, number>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  buildingConstruction: Map<number, { root: THREE.Object3D; clip: { plane: THREE.Plane; materials: THREE.Material[] } }>;
  buildingMeshSwapHold: Map<number, number>;
  updateBuildingMeshes(): void;
}

function build(): { sim: Sim; priv: Priv; s: number } {
  const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 1 });
  const t = sim.addStructureType({ id: 'kdf_outpost', hp_per_tile: 400, height_px: 6, color: 'dust.3' });
  const s = sim.addStructure(t, [2 + 2 * sim.width]);
  const priv = new ThreeRenderer(sim, makeOpts()) as unknown as Priv;
  priv.buildingMeshIdleTemplates.set('kdf_outpost', boxTemplate());
  priv.buildingMeshConstructionTemplates.set('kdf_outpost', boxTemplate());
  priv.buildingConstructionHeight.set('kdf_outpost', 4);
  return { sim, priv, s };
}

describe('ThreeRenderer construction state (#277 Task 13)', () => {
  it('clips at 0.3 x height at progress 0.3 and draws no standing clone', () => {
    const { sim, priv, s } = build();
    sim.structures.progress[s] = Math.round(0.3 * ONE);
    priv.updateBuildingMeshes();
    const site = priv.buildingConstruction.get(s);
    expect(site).toBeDefined();
    expect(site!.clip.plane.constant).toBeCloseTo(1.2, 3);
    expect(priv.buildingMeshIdleEntities.has(s)).toBe(false);
  });

  it('rises with progress, then swaps to the standing mesh with no clip at ONE', () => {
    const { sim, priv, s } = build();
    sim.structures.progress[s] = Math.round(0.3 * ONE);
    priv.updateBuildingMeshes();
    const clones = priv.buildingConstruction.get(s)!.clip.materials;
    sim.structures.progress[s] = Math.round(0.6 * ONE);
    priv.updateBuildingMeshes();
    expect(priv.buildingConstruction.get(s)!.clip.plane.constant).toBeCloseTo(2.4, 3);
    sim.structures.progress[s] = ONE;
    priv.updateBuildingMeshes();
    expect(priv.buildingConstruction.has(s)).toBe(false);
    expect(priv.buildingMeshIdleEntities.has(s)).toBe(true);
    const mat = (priv.buildingMeshIdleEntities.get(s)!.children[0] as THREE.Mesh).material as THREE.Material;
    expect(mat.clippingPlanes).toBeNull();
    expect(clones.length).toBe(1);
  });

  it('tears a cancelled site down, disposes its clones and draws no wreck', () => {
    const { sim, priv, s } = build();
    sim.structures.progress[s] = Math.round(0.3 * ONE);
    priv.updateBuildingMeshes();
    const clones = priv.buildingConstruction.get(s)!.clip.materials;
    let disposed = 0;
    for (const m of clones) m.addEventListener('dispose', () => disposed++);
    sim.removeStructure(s);
    priv.updateBuildingMeshes();
    expect(priv.buildingConstruction.size).toBe(0);
    expect(disposed).toBe(1);
    expect(priv.buildingMeshIdleEntities.size).toBe(0);
  });

  it('a site destroyed during the swap-hold stays until the hold ends, then goes, with no wreck', () => {
    const { sim, priv, s } = build();
    sim.structures.progress[s] = Math.round(0.3 * ONE);
    priv.updateBuildingMeshes();
    priv.buildingMeshSwapHold.set(s, 500);
    sim.removeStructure(s);
    priv.updateBuildingMeshes();
    expect(priv.buildingConstruction.has(s)).toBe(true);
    priv.buildingMeshSwapHold.delete(s);
    priv.updateBuildingMeshes();
    expect(priv.buildingConstruction.has(s)).toBe(false);
    expect(priv.buildingMeshIdleEntities.size).toBe(0);
  });
});
