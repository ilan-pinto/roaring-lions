/**
 * GH-1225 slice 1: the roof cutaway's selected-unit trigger, wired through `ThreeRenderer` (design
 * `2026-11-11-roof-cutaway-design.md`, "Gates and falsifiers").
 *
 * The `ThreeRenderer.building-damage.test.ts` fixture: no `fetch`, no GLB, a hand-built template with a real box mesh (so its
 * drawn roof is measurable) and a real `MeshStandardMaterial`, driven through the private `updateBuildingMeshes` and
 * `updateCutaway` the frame calls. The real `Sim` places the house and the units.
 *
 * The first block is the "no trigger, no change" gate: with nothing selected, no building is cut, no clone, program key or
 * uniform is minted, and every mesh still draws its template's own material. That is what keeps the golden baselines still.
 * Falsify: cut every building as it stands up (`updateBuildingMeshes`) and it goes red.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { MESH_SCALE } from './units/mesh-anim';
import type { BuildingMeshTemplate } from './units/mesh-building';
import { CUT_PROGRAM_KEY, type CutUniforms } from './units/cut-material';

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
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree', haze: '#E0B87A',
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

const RIFLES: UnitTypeJson = {
  id: 'cut_rifles',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};

/** A 2 x 2 house standing on tiles (5..6, 5..6): its footprint is [5, 7] x [5, 7]. */
const W = 16;

/** A template with two meshes over ONE shared material: a 6 m (2 t) box, so the drawn roof is at 2 t. */
function template(): { template: BuildingMeshTemplate; base: THREE.MeshStandardMaterial } {
  const root = new THREE.Group();
  root.scale.setScalar(MESH_SCALE);
  const base = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  for (const name of ['wall', 'roof']) {
    const geo = new THREE.BoxGeometry(6, 6, 6).translate(0, 3, 0);
    const mesh = new THREE.Mesh(geo, base);
    mesh.name = name;
    root.add(mesh);
  }
  return { template: { root, materials: [base], geometries: [] }, base };
}

interface Private {
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  buildingMeshLod1Templates: Map<string, BuildingMeshTemplate>;
  buildingMeshLod1Entities: Map<number, THREE.Object3D>;
  camera: { zoom: number };
  buildingDamageBand: Map<number, number>;
  cutUniforms: CutUniforms | null;
  updateBuildingMeshes(): void;
  updateCutaway(alpha: number, dtMs: number): void;
  hideForGroundPhoto(): () => void;
}

function materialsOf(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push((o as THREE.Mesh).material as THREE.Material);
  });
  return out;
}

/** The house, and selectable riflemen at the given tile positions (side 0, the viewer's own; side 1 for `hostile`). */
function arm(at: readonly [number, number][], hostile: readonly [number, number][] = [], lod1 = false) {
  const sim = new Sim({ seed: 1, width: W, height: W, capacity: 32 });
  const rifles = sim.addUnitType(RIFLES);
  const type = sim.addStructureType({ id: 'house', hp_per_tile: 200, height_px: 22, color: 'limestone.3' });
  const s = sim.addStructure(type, [5 * W + 5, 5 * W + 6, 6 * W + 5, 6 * W + 6]);
  const units = at.map(([x, y]) => sim.spawn(rifles, 0, fx.from(x), fx.from(y)));
  const hostiles = hostile.map(([x, y]) => sim.spawn(rifles, 1, fx.from(x), fx.from(y)));
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Private;
  renderer.snapshot();
  renderer.snapshot();
  const t = template();
  priv.buildingMeshIdleTemplates.set('house', t.template);
  if (lod1) {
    // The LOD1 twin, and a zoom inside its band (below 2.0), so the house stands as its twin.
    priv.buildingMeshLod1Templates.set('house', template().template);
    priv.camera.zoom = 1;
  }
  priv.updateBuildingMeshes();
  const root = priv.buildingMeshIdleEntities.get(s)!;
  /** `n` frames of `dtMs` each, at alpha 1. */
  const frames = (n: number, dtMs = 10): void => {
    for (let i = 0; i < n; i++) priv.updateCutaway(1, dtMs);
  };
  return { sim, s, priv, base: t.base, renderer, root, units, hostiles, frames };
}

const isCut = (m: THREE.Material): boolean => (m.userData as { rlCut?: boolean }).rlCut === true;

describe('roof cutaway: no trigger, no change (the gate that keeps the baselines still)', () => {
  it('with nothing selected, no building is cut, and nothing is minted: no clone, no program key, no uniform', () => {
    const { priv, base, renderer, root, frames } = arm([[8, 6]]);
    expect(renderer.selection).toEqual([]);
    const uncut = (): void => {
      expect(renderer.cutawayCount()).toBe(0);
      expect(priv.cutUniforms).toBeNull();
      for (const m of materialsOf(root)) {
        expect(m).toBe(base);
        expect(m.customProgramCacheKey()).not.toContain(CUT_PROGRAM_KEY);
      }
    };
    // As the house stands up, and after 2 s of frames.
    uncut();
    frames(200);
    uncut();
  });

  it('a unit selected far from any building cuts nothing', () => {
    const { priv, base, renderer, root, units, frames } = arm([[13, 13]]);
    renderer.selection = [units[0]];
    frames(50);
    expect(renderer.cutawayCount()).toBe(0);
    expect(priv.cutUniforms).toBeNull();
    for (const m of materialsOf(root)) expect(m).toBe(base);
  });

  it('a hostile selected under the fog cuts nothing: fog stays fog', () => {
    const { renderer, hostiles, frames } = arm([], [[8, 6]]);
    renderer.selection = [hostiles[0]];
    frames(50);
    expect(renderer.cutawayCount()).toBe(0);
  });
});

describe('roof cutaway: the selected-unit trigger', () => {
  it('a selected unit beside the house cuts it: every mesh on a cut clone of its band material, one volume written', () => {
    // (8, 6) is 1.0 t from the footprint's east edge: inside R = 1.25.
    const { priv, base, renderer, root, units, frames } = arm([[8, 6]]);
    renderer.selection = [units[0]];
    // The iris opens FROM the unit: its first 10 ms frame (reach 0.14 t) has not reached the wall 1.0 t away yet.
    frames(1);
    expect(priv.cutUniforms!.uRlCutN.value).toBe(1);
    expect(renderer.cutawayCount()).toBe(0);
    for (const m of materialsOf(root)) expect(m).toBe(base);
    frames(9);
    expect(renderer.cutawayCount()).toBe(1);
    const mats = materialsOf(root);
    expect(mats).toHaveLength(2);
    expect(mats[0]).toBe(mats[1]);
    expect(isCut(mats[0])).toBe(true);
    expect(mats[0].customProgramCacheKey()).toMatch(/\|rl-cut$/);
    expect(mats[0].side).toBe(THREE.DoubleSide);
    expect(base.side).toBe(THREE.FrontSide);
    expect(priv.cutUniforms!.uRlCutN.value).toBe(1);
    // After the iris: the full R and W, centred on the unit, the cut 0.4 t over the ground, the roof the box's 2 t.
    frames(30);
    const v = Array.from(priv.cutUniforms!.uRlCutV.value.slice(0, 8));
    expect(v[0]).toBeCloseTo(8, 5);
    expect(v[1]).toBeCloseTo(6, 5);
    expect(v[2]).toBe(1.25);
    expect(v[3]).toBe(0.5);
    expect(v[4]).toBeCloseTo(0.4, 5);
    expect(v[5]).toBeCloseTo(2, 5);
  });

  it('is released 1.0 s + 400 ms after the selection clears: the band material back, the clone disposed', () => {
    const { priv, base, renderer, root, units, frames } = arm([[8, 6]]);
    renderer.selection = [units[0]];
    frames(30);
    const clone = materialsOf(root)[0];
    let disposed = 0;
    clone.addEventListener('dispose', () => disposed++);
    renderer.selection = [];
    // The hold: still cut, on the same clone, two frames past the 1.0 s edge.
    frames(102);
    expect(renderer.cutawayCount()).toBe(1);
    expect(materialsOf(root)[0]).toBe(clone);
    // The close shrinks the iris back to the unit: the house is released once the reach no longer meets it, and the
    // volume is gone at 1.4 s.
    frames(38);
    expect(renderer.cutawayCount()).toBe(0);
    for (const m of materialsOf(root)) expect(m).toBe(base);
    expect(disposed).toBe(1);
    expect(priv.cutUniforms!.uRlCutN.value).toBe(0);
  });

  it('at most 8 volumes: nine selected units beside the house write eight', () => {
    const spots: [number, number][] = [[8, 5.2], [8, 5.6], [8, 6], [8, 6.4], [8, 6.8], [4, 5.5], [4, 6], [4, 6.5], [6, 8]];
    const { priv, renderer, units, frames } = arm(spots);
    renderer.selection = [...units];
    frames(30);
    expect(priv.cutUniforms!.uRlCutN.value).toBe(8);
    expect(renderer.cutawayCount()).toBe(1);
  });

  it('a band change while cut keeps the building cut, on the new band material', () => {
    const { sim, s, priv, base, renderer, root, units, frames } = arm([[8, 6]]);
    renderer.selection = [units[0]];
    frames(30);
    sim.debugDamageStructure(s, 3);
    renderer.onEvents(sim.tick());
    expect(priv.buildingDamageBand.get(s)).toBe(3);
    const m = materialsOf(root)[0] as THREE.MeshStandardMaterial;
    expect(isCut(m)).toBe(true);
    expect(m.color.getHex()).not.toBe(base.color.getHex());
  });

  // Review of PR 1232: the twin has no cut, so a cut building must draw its full model at LOD1 zoom. Falsify: delete
  // `&& !this.buildingCuts.has(s)` from `stepLod1`'s `showTwin` and this goes red.
  it('a cut building at LOD1 zoom shows its full model, not the twin, and the twin again once released', () => {
    const { s, priv, renderer, root, units, frames } = arm([[8, 6]], [], true);
    const twin = priv.buildingMeshLod1Entities.get(s)!;
    expect(twin).toBeDefined();
    expect([twin.visible, root.visible]).toEqual([true, false]);
    renderer.selection = [units[0]];
    frames(30);
    expect(renderer.cutawayCount()).toBe(1);
    // The next frame's LOD pass, as `frame()` runs it.
    priv.updateBuildingMeshes();
    expect([twin.visible, root.visible]).toEqual([false, true]);
    renderer.selection = [];
    frames(140);
    expect(renderer.cutawayCount()).toBe(0);
    priv.updateBuildingMeshes();
    expect([twin.visible, root.visible]).toEqual([true, false]);
  });

  it('the minimap photograph sees the uncut footprint: the volume count is 0 for it and restored after', () => {
    const { priv, renderer, units, frames } = arm([[8, 6]]);
    renderer.selection = [units[0]];
    frames(30);
    const restore = priv.hideForGroundPhoto();
    expect(priv.cutUniforms!.uRlCutN.value).toBe(0);
    restore();
    expect(priv.cutUniforms!.uRlCutN.value).toBe(1);
  });
});
