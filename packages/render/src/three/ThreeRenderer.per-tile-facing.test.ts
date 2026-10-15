/**
 * SW-5: the per-tile facing rule, wired. `units/run-direction.test.ts` pins
 * the pure table; what is proven HERE is that both `perTileYaw` call sites in
 * `updateBuildingMeshes` -- the standing mesh and its wreck -- consult it, so
 * two sandbag posts stacked north-south keep their authored facing (the
 * firing slot toward the camera corner) while a fence run beside them still
 * turns a quarter to read along its run.
 *
 * Reaches into private state the way `ThreeRenderer.collapse.test.ts` does:
 * there is no public seam for the mesh map `loadBuildingMesh` would populate
 * (a real GLB fetch), so it is armed directly with headless stand-ins.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { MESH_SCALE } from './units/mesh-anim';
import type { BuildingMeshTemplate } from './units/mesh-building';

// Identical stand-in to `ThreeRenderer.test.ts`'s own: `WebGLRenderer`
// cannot construct under this suite's headless `environment: 'node'`.
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

function fakeTemplate(): BuildingMeshTemplate {
  const root = new THREE.Group();
  root.scale.setScalar(MESH_SCALE);
  return { root, materials: [], geometries: [] };
}

interface BuildingMeshPrivate {
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshWreckTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  buildingMeshWreckEntities: Map<number, THREE.Object3D>;
  updateBuildingMeshes(): void;
}

/** An 8x8 sim with two posts at (1,2)/(1,3) and two fence tiles at
 *  (4,2)/(4,3): each pair a north-south run of its own type. */
function build(): { sim: Sim; priv: BuildingMeshPrivate; posts: number[]; fences: number[] } {
  const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 1 });
  const w = sim.width;
  const post = sim.addStructureType({ id: 'sandbag_post', hp_per_tile: 400, height_px: 6, color: 'dust.3', per_tile: true });
  const fence = sim.addStructureType({ id: 'fence', hp_per_tile: 60, height_px: 6, color: 'dust.3', per_tile: true });
  const posts = [sim.addStructure(post, [1 + 2 * w]), sim.addStructure(post, [1 + 3 * w])];
  const fences = [sim.addStructure(fence, [4 + 2 * w]), sim.addStructure(fence, [4 + 3 * w])];
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as BuildingMeshPrivate;
  for (const id of ['sandbag_post', 'fence']) {
    priv.buildingMeshIdleTemplates.set(id, fakeTemplate());
    priv.buildingMeshWreckTemplates.set(id, fakeTemplate());
  }
  return { sim, priv, posts, fences };
}

describe('ThreeRenderer per-tile facing (SW-5)', () => {
  it('keeps two north-south sandbag posts on their authored facing, and turns the fence run', () => {
    const { priv, posts, fences } = build();
    priv.updateBuildingMeshes();
    for (const s of posts) expect(priv.buildingMeshIdleEntities.get(s)!.rotation.y, `post ${s}`).toBe(0);
    for (const s of fences) expect(priv.buildingMeshIdleEntities.get(s)!.rotation.y, `fence ${s}`).toBeCloseTo(Math.PI / 2, 12);
  });

  it('gives a wreck its standing building facing', () => {
    // One tile of each run dies, so the wreck has a living neighbour; the
    // whole-run case, where none is left, is the describe below.
    const { sim, priv, posts, fences } = build();
    priv.updateBuildingMeshes();
    sim.structures.alive[posts[1]] = 0;
    sim.structures.alive[fences[1]] = 0;
    priv.updateBuildingMeshes();
    expect(priv.buildingMeshWreckEntities.get(posts[1])!.rotation.y, 'post wreck').toBe(0);
    expect(priv.buildingMeshWreckEntities.get(fences[1])!.rotation.y, 'fence wreck').toBeCloseTo(Math.PI / 2, 12);
  });
});

/** A run of `n` same-type tiles starting at (x, y), stepping by (dx, dy). */
function runOf(sim: Sim, typeIdx: number, x: number, y: number, dx: number, dy: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(sim.addStructure(typeIdx, [x + i * dx + (y + i * dy) * sim.width]));
  return out;
}

function buildRuns(): {
  sim: Sim; priv: BuildingMeshPrivate; ns: number[]; ew: number[]; posts: number[];
} {
  const sim = new Sim({ seed: 1, width: 10, height: 10, capacity: 1 });
  const post = sim.addStructureType({ id: 'sandbag_post', hp_per_tile: 400, height_px: 6, color: 'dust.3', per_tile: true });
  const fence = sim.addStructureType({ id: 'fence', hp_per_tile: 60, height_px: 6, color: 'dust.3', per_tile: true });
  const ns = runOf(sim, fence, 4, 2, 0, 1, 4);
  const ew = runOf(sim, fence, 1, 8, 1, 0, 4);
  const posts = runOf(sim, post, 8, 2, 0, 1, 3);
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as BuildingMeshPrivate;
  for (const id of ['sandbag_post', 'fence']) {
    priv.buildingMeshIdleTemplates.set(id, fakeTemplate());
    priv.buildingMeshWreckTemplates.set(id, fakeTemplate());
  }
  return { sim, priv, ns, ew, posts };
}

describe('ThreeRenderer per-tile facing: a wreck reads its AUTHORED run (SW-5)', () => {
  it('turns every wreck of a fully destroyed north-south run along it, last tile included', () => {
    const { sim, priv, ns } = buildRuns();
    priv.updateBuildingMeshes();
    // Top to bottom, a frame after each death: by the last, no tile of the
    // run is left standing for the wreck to read its direction from.
    for (const s of ns) {
      sim.structures.alive[s] = 0;
      priv.updateBuildingMeshes();
    }
    for (const s of ns) {
      expect(priv.buildingMeshWreckEntities.get(s)!.rotation.y, `fence wreck ${s}`).toBeCloseTo(Math.PI / 2, 12);
    }
  });

  it('turns the wrecks of a run that was already dead when the first update ran (a late-loading mesh)', () => {
    const { sim, priv, ns } = buildRuns();
    for (const s of ns) sim.structures.alive[s] = 0;
    priv.updateBuildingMeshes();
    for (const s of ns) {
      expect(priv.buildingMeshWreckEntities.get(s)!.rotation.y, `fence wreck ${s}`).toBeCloseTo(Math.PI / 2, 12);
    }
  });

  it('control: a fully destroyed east-west run keeps every wreck at yaw 0', () => {
    const { sim, priv, ew } = buildRuns();
    priv.updateBuildingMeshes();
    for (const s of ew) {
      sim.structures.alive[s] = 0;
      priv.updateBuildingMeshes();
    }
    for (const s of ew) expect(priv.buildingMeshWreckEntities.get(s)!.rotation.y, `fence wreck ${s}`).toBe(0);
  });

  it('control: sandbag posts stay at yaw 0 standing and as wrecks, however the run dies', () => {
    const { sim, priv, posts } = buildRuns();
    priv.updateBuildingMeshes();
    for (const s of posts) expect(priv.buildingMeshIdleEntities.get(s)!.rotation.y, `post ${s}`).toBe(0);
    for (const s of posts) {
      sim.structures.alive[s] = 0;
      priv.updateBuildingMeshes();
    }
    for (const s of posts) expect(priv.buildingMeshWreckEntities.get(s)!.rotation.y, `post wreck ${s}`).toBe(0);
  });

  it('a tile built after the first update joins the lookup (a mid-mission build)', () => {
    const { sim, priv, ns } = buildRuns();
    priv.updateBuildingMeshes();
    const fence = sim.structures.typeIdx[ns[0]];
    // Extend the north-south run by one tile, then destroy only the new tile
    // and the one above it: the lookup must have been rebuilt to see them.
    const extra = sim.addStructure(fence, [4 + 6 * sim.width]);
    priv.updateBuildingMeshes();
    for (const s of [ns[3], extra]) {
      sim.structures.alive[s] = 0;
      priv.updateBuildingMeshes();
    }
    expect(priv.buildingMeshWreckEntities.get(extra)!.rotation.y).toBeCloseTo(Math.PI / 2, 12);
  });
});
