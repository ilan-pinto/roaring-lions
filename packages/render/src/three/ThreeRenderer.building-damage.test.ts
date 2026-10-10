/**
 * GH-31 (A3.2 remainder): a MESH building shows its damage before it dies.
 *
 * Drives `ThreeRenderer`'s private surface the way
 * `ThreeRenderer.collapse.test.ts` does (no `fetch`, no GLB: a hand-built
 * template with real meshes and a real `MeshStandardMaterial`, so the
 * material swap is measured on the objects the renderer actually mutates).
 * The sim side is the real `Sim`, damaged through `debugDamageStructure` --
 * the same path a hit takes -- and the event is fed through the public
 * `onEvents`, so what is pinned is the wiring from a `structureHit` to the
 * clone's materials, not the band table (`units/building-damage.test.ts`).
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { MESH_SCALE } from './units/mesh-anim';
import type { BuildingMeshTemplate } from './units/mesh-building';
import {
  STRUCTURE_BURN_INTERVAL_MS,
  WRECK_BURN_SECONDS,
  scarredMaterial,
} from './units/building-damage';

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

function buildSim(): { sim: Sim; s: number } {
  const sim = new Sim({ seed: 1, width: 4, height: 4, capacity: 1 });
  const type = sim.addStructureType({ id: 'shanty', hp_per_tile: 200, height_px: 11, color: 'dust.1' });
  const s = sim.addStructure(type, [0, 1]);
  return { sim, s };
}

/** A template with two meshes over ONE shared material, the shape a real
 *  textured GLB arrives in (every role primitive references the one bake). */
function template(): { template: BuildingMeshTemplate; base: THREE.MeshStandardMaterial } {
  const root = new THREE.Group();
  root.scale.setScalar(MESH_SCALE);
  const base = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), color: 0xffffff, roughness: 0.6 });
  for (const name of ['wall', 'roof']) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), base);
    mesh.name = name;
    root.add(mesh);
  }
  return { template: { root, materials: [base], geometries: [] }, base };
}

interface Private {
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshWreckTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  buildingBurning: Map<number, { accumMs: number; remainingMs: number }>;
  buildingDamageBand: Map<number, number>;
  buildingScars: Map<string, { size: number }>;
  updateBuildingMeshes(): void;
  stepBuildingBurning(dtMs: number): void;
  spawnBurningFx(s: number, standing: boolean): void;
}

function materialsOf(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push((o as THREE.Mesh).material as THREE.Material);
  });
  return out;
}

function arm(): { sim: Sim; s: number; priv: Private; base: THREE.MeshStandardMaterial; renderer: ThreeRenderer } {
  const { sim, s } = buildSim();
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Private;
  const t = template();
  priv.buildingMeshIdleTemplates.set('shanty', t.template);
  priv.buildingMeshWreckTemplates.set('shanty', template().template);
  priv.updateBuildingMeshes();
  return { sim, s, priv, base: t.base, renderer };
}

describe('ThreeRenderer building damage states (GH-31)', () => {
  it('draws the untouched template at full HP -- band 8 mints nothing', () => {
    const { s, priv, base } = arm();
    const root = priv.buildingMeshIdleEntities.get(s)!;
    for (const m of materialsOf(root)) expect(m).toBe(base);
    expect(priv.buildingDamageBand.get(s)).toBe(8);
    expect(priv.buildingScars.get('shanty')?.size ?? 0).toBe(0);
    expect(priv.buildingBurning.size).toBe(0);
  });

  it('swaps every mesh to the band\'s scarred clone on the structureHit event, and not before', () => {
    const { sim, s, priv, base, renderer } = arm();
    sim.debugDamageStructure(s, 3);
    // Damaged in the sim, but the renderer has not seen the event yet.
    const root = priv.buildingMeshIdleEntities.get(s)!;
    for (const m of materialsOf(root)) expect(m).toBe(base);

    renderer.onEvents(sim.tick());

    const mats = materialsOf(root);
    expect(mats.length).toBe(2);
    expect(mats[0]).not.toBe(base);
    expect(mats[1]).toBe(mats[0]); // one clone per (base x band), shared across the clone's meshes
    expect((mats[0] as THREE.MeshStandardMaterial).color.getHex()).toBe(scarredMaterial(base, 3).color.getHex());
    expect(priv.buildingDamageBand.get(s)).toBe(3);
    expect(priv.buildingBurning.has(s)).toBe(false);
    // The template itself is untouched: every other shanty on the map
    // still draws clean.
    expect(base.color.getHex()).toBe(0xffffff);
  });

  it('lights the fire at band 2, primed to spawn on the next step, and throws one beat per interval', () => {
    const { sim, s, priv, renderer } = arm();
    const spawn = vi.spyOn(priv, 'spawnBurningFx').mockImplementation(() => {});
    sim.debugDamageStructure(s, 2);
    renderer.onEvents(sim.tick());
    expect(priv.buildingBurning.get(s)).toEqual({ accumMs: STRUCTURE_BURN_INTERVAL_MS, remainingMs: Infinity });

    priv.stepBuildingBurning(16);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenLastCalledWith(s, true);
    // The next interval arrives in real frames (every elapsed-time reader
    // in `frame()` clamps a frame to 100 ms, this one included): 16 ms are
    // banked past the first beat, so six 100 ms frames fall short and the
    // seventh lands it.
    for (let i = 0; i < 6; i++) priv.stepBuildingBurning(100);
    expect(spawn).toHaveBeenCalledTimes(1);
    priv.stepBuildingBurning(100);
    expect(spawn).toHaveBeenCalledTimes(2);
    // ...and a long frame cannot bank more than that ceiling.
    priv.stepBuildingBurning(5000);
    priv.stepBuildingBurning(5000);
    expect(spawn).toHaveBeenCalledTimes(2);
    // A zero-time repaint spawns nothing, whatever is banked (the visual
    // gate's repaint control).
    priv.stepBuildingBurning(0);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('hands the fire to the wreck for WRECK_BURN_SECONDS, then puts it out', () => {
    const { sim, s, priv, renderer } = arm();
    const spawn = vi.spyOn(priv, 'spawnBurningFx').mockImplementation(() => {});
    sim.debugDamageStructure(s, 1);
    renderer.onEvents(sim.tick());
    sim.debugDestroyStructure(s);
    renderer.onEvents(sim.tick());
    priv.updateBuildingMeshes();
    expect(priv.buildingMeshIdleEntities.has(s)).toBe(false);
    expect(priv.buildingDamageBand.has(s)).toBe(false);
    expect(priv.buildingBurning.get(s)?.remainingMs).toBe(WRECK_BURN_SECONDS * 1000);

    priv.stepBuildingBurning(16);
    expect(spawn).toHaveBeenLastCalledWith(s, false);
    // Burns down in frames, never past its allowance.
    let elapsed = 16;
    while (priv.buildingBurning.has(s) && elapsed < WRECK_BURN_SECONDS * 1000 + 1000) {
      priv.stepBuildingBurning(100);
      elapsed += 100;
    }
    expect(priv.buildingBurning.has(s)).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(WRECK_BURN_SECONDS * 1000);
    expect(elapsed).toBeLessThan(WRECK_BURN_SECONDS * 1000 + 200);
  });

  it('a building killed clean never lights -- the wreck gets no fire to inherit', () => {
    const { sim, s, priv, renderer } = arm();
    sim.debugDestroyStructure(s);
    renderer.onEvents(sim.tick());
    priv.updateBuildingMeshes();
    expect(priv.buildingBurning.size).toBe(0);
  });
});
