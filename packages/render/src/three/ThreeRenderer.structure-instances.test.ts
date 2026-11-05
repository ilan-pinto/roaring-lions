/**
 * GH-974: per-tile structures draw INSTANCED, through `updateBuildingMeshes`.
 *
 * The oracle is the clone path itself: `debugPerTileInstancing(false)` makes
 * the SAME renderer stand the same tiles up as `template.root.clone(true)`
 * again, so each claim below is "the instance is where, and as, the clone was"
 * rather than a number typed in. Where a claim is about behaviour the clone
 * path never had (a hidden set, a destroyed tile gone from the standing set),
 * it reads the instanced meshes themselves.
 *
 * Reaches into private state the way `ThreeRenderer.per-tile-facing.test.ts`
 * does: there is no public seam for the template maps a GLB fetch would fill.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { MESH_SCALE } from './units/mesh-anim';
import type { BuildingMeshTemplate } from './units/mesh-building';
import { instanceableTemplate } from './units/structure-instances';
import { isAoOccluder } from './post-chain';
import { buildingSettleScale } from './units/mesh-building';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    // `ThreeRenderer.dispose` loses the context last (`context-release.ts`).
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

/** A two-mesh template over a shared material (the shape a textured wall GLB
 *  arrives in), at the root's own frame, scaled like a real one. */
function realTemplate(): BuildingMeshTemplate {
  const root = new THREE.Group();
  root.scale.setScalar(MESH_SCALE);
  const mat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.6 });
  const geos: THREE.BufferGeometry[] = [];
  for (const name of ['wall', 'roof']) {
    const geo = new THREE.BoxGeometry(2, 1, 0.5);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    root.add(mesh);
    geos.push(geo);
  }
  return { root, materials: [mat], geometries: geos };
}

interface Private {
  buildingMeshIdleTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshWreckTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshConstructionTemplates: Map<string, BuildingMeshTemplate>;
  buildingMeshIdleEntities: Map<number, THREE.Object3D>;
  buildingMeshWreckEntities: Map<number, THREE.Object3D>;
  buildingMeshSwapHold: Map<number, number>;
  buildingMeshBounds: Map<string, THREE.Vector3>;
  buildingDamageBand: Map<number, number>;
  structureInstances: {
    meshes(): THREE.InstancedMesh[];
    hasIdle(s: number): boolean;
    hasWreck(s: number): boolean;
    yawOf(s: number): number | undefined;
    stateOf(s: number): number | undefined;
    setIdleTemplate(id: string, t: BuildingMeshTemplate): void;
    setWreckTemplate(id: string, t: BuildingMeshTemplate): void;
    setIdleLod1(id: string, t: BuildingMeshTemplate): boolean;
  };
  scene: THREE.Scene;
  updateBuildingMeshes(): void;
  stepBuildingMeshSettle(dt: number): void;
  refreshBuildingDamage(s: number): void;
  beginCollapseShroud(s: number, cx: number, cy: number): void;
}

interface World {
  sim: Sim;
  r: ThreeRenderer;
  priv: Private;
  /** A north-south fence run of three, and a lone east-west pair. */
  ns: number[];
  ew: number[];
  posts: number[];
  shanty: number;
}

function build(register = true): World {
  const sim = new Sim({ seed: 1, width: 12, height: 12, capacity: 1 });
  const w = sim.width;
  const fence = sim.addStructureType({ id: 'fence', hp_per_tile: 80, height_px: 6, color: 'dust.3', per_tile: true });
  const post = sim.addStructureType({ id: 'sandbag_post', hp_per_tile: 80, height_px: 6, color: 'dust.3', per_tile: true });
  const shanty = sim.addStructureType({ id: 'shanty', hp_per_tile: 80, height_px: 11, color: 'dust.1' });
  const ns = [0, 1, 2].map((i) => sim.addStructure(fence, [3 + (2 + i) * w]));
  const ew = [0, 1].map((i) => sim.addStructure(fence, [6 + i + 8 * w]));
  const posts = [0, 1].map((i) => sim.addStructure(post, [9 + (2 + i) * w]));
  const sh = sim.addStructure(shanty, [1 + 9 * w]);
  const r = new ThreeRenderer(sim, makeOpts());
  const priv = r as unknown as Private;
  for (const id of ['fence', 'sandbag_post', 'shanty']) {
    priv.buildingMeshIdleTemplates.set(id, realTemplate());
    priv.buildingMeshWreckTemplates.set(id, realTemplate());
  }
  if (register) {
    for (const id of ['fence', 'sandbag_post']) {
      priv.structureInstances.setIdleTemplate(id, priv.buildingMeshIdleTemplates.get(id)!);
      priv.structureInstances.setWreckTemplate(id, priv.buildingMeshWreckTemplates.get(id)!);
    }
  }
  return { sim, r, priv, ns, ew, posts, shanty: sh };
}

function matrixOf(mesh: THREE.InstancedMesh, i: number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return m;
}

/** Every instance of every mesh whose geometry is `geo`, as matrices. */
function instancesOf(priv: Private, geo: THREE.BufferGeometry, material?: THREE.Material): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  for (const mesh of priv.structureInstances.meshes()) {
    if (mesh.geometry !== geo) continue;
    if (material && mesh.material !== material) continue;
    for (let i = 0; i < mesh.count; i++) out.push(matrixOf(mesh, i));
  }
  return out;
}

/** The world matrix a clone's child `name` has under structure `s`'s root. */
function cloneMatrix(priv: Private, s: number, name: string): THREE.Matrix4 {
  const root = priv.buildingMeshIdleEntities.get(s)!;
  root.updateMatrixWorld(true);
  return root.getObjectByName(name)!.matrixWorld.clone();
}

function close(a: THREE.Matrix4, b: THREE.Matrix4): void {
  for (let i = 0; i < 16; i++) expect(a.elements[i]).toBeCloseTo(b.elements[i], 5);
}

describe('ThreeRenderer instanced per-tile structures (GH-974)', () => {
  it('chunks walls 16 tiles on a 48x48 map and 32 above it, through the renderer\'s own constructor', () => {
    const meshesOn = (size: number): number => {
      const sim = new Sim({ seed: 1, width: size, height: size, capacity: 1 });
      const fence = sim.addStructureType({ id: 'fence', hp_per_tile: 80, height_px: 6, color: 'dust.3', per_tile: true });
      for (const x of [1, 20, 33]) sim.addStructure(fence, [x + 2 * size]);
      const r = new ThreeRenderer(sim, makeOpts());
      const priv = r as unknown as Private;
      priv.buildingMeshIdleTemplates.set('fence', realTemplate());
      priv.buildingMeshWreckTemplates.set('fence', realTemplate());
      priv.structureInstances.setIdleTemplate('fence', priv.buildingMeshIdleTemplates.get('fence')!);
      priv.structureInstances.setWreckTemplate('fence', priv.buildingMeshWreckTemplates.get('fence')!);
      priv.updateBuildingMeshes();
      return priv.structureInstances.meshes().length;
    };
    expect(meshesOn(48), 'x = 1, 20, 33 are three 16-tile chunks x 2 template meshes').toBe(6);
    expect(meshesOn(80), 'x = 1 and 20 share a 32-tile chunk, 33 is the next: two chunks x 2').toBe(4);
  });

  it('draws a per-tile run as ONE instanced mesh per template mesh, and every other building as a clone', () => {
    const { priv, ns, ew, posts, shanty } = build();
    priv.updateBuildingMeshes();
    // 2 template meshes x 2 types (fence, sandbag post): four sets, whatever the tile count.
    expect(priv.structureInstances.meshes().length).toBe(4);
    const fenceTiles = ns.length + ew.length;
    const fenceSets = priv.structureInstances.meshes().filter((m) => m.count === fenceTiles);
    expect(fenceSets.length).toBe(2);
    for (const s of [...ns, ...ew, ...posts]) {
      expect(priv.structureInstances.hasIdle(s), `tile ${s}`).toBe(true);
      expect(priv.buildingMeshIdleEntities.has(s), `tile ${s} must not also be a clone`).toBe(false);
    }
    // A building with no per_tile flag keeps its clone.
    expect(priv.buildingMeshIdleEntities.has(shanty)).toBe(true);
    expect(priv.structureInstances.hasIdle(shanty)).toBe(false);
  });

  it('places every instance exactly where the clone path stood the same tile, yaw and all', () => {
    const { r, priv, ns, ew, posts } = build();
    priv.updateBuildingMeshes();
    // Every instance of the `wall` mesh of both types (a post has its own template).
    const geoOf = (id: string): THREE.BufferGeometry => (priv.buildingMeshIdleTemplates.get(id)!.root.getObjectByName('wall') as THREE.Mesh).geometry;
    const mats = [...instancesOf(priv, geoOf('fence')), ...instancesOf(priv, geoOf('sandbag_post'))];
    expect(mats.length).toBe(ns.length + ew.length + posts.length);
    const all = [...ns, ...ew, ...posts];
    // Clones for the same tiles (the A/B switch is the oracle).
    r.debugPerTileInstancing(false);
    priv.updateBuildingMeshes();
    const instanced = new Map<number, THREE.Matrix4>();
    for (const s of all) {
      expect(priv.buildingMeshIdleEntities.has(s), `tile ${s} is a clone with the switch off`).toBe(true);
      const want = cloneMatrix(priv, s, 'wall');
      const got = mats.find((m) => [12, 13, 14].every((e) => Math.abs(m.elements[e] - want.elements[e]) < 1e-6));
      expect(got, `an instance at tile ${s}'s position`).toBeDefined();
      close(got!, want);
      instanced.set(s, got!);
    }
    // The north-south fence tiles are turned a quarter, the east-west ones and the posts are not.
    const yawOf = (m: THREE.Matrix4): number => new THREE.Euler().setFromRotationMatrix(m, 'YXZ').y;
    for (const s of ns) expect(Math.abs(yawOf(instanced.get(s)!))).toBeCloseTo(Math.PI / 2, 5);
    for (const s of [...ew, ...posts]) expect(yawOf(instanced.get(s)!)).toBeCloseTo(0, 5);
    // Back on: the clones leave and the instances return, nothing is drawn twice.
    r.debugPerTileInstancing(true);
    priv.updateBuildingMeshes();
    for (const s of all) {
      expect(priv.buildingMeshIdleEntities.has(s), `clone ${s} survived the switch back`).toBe(false);
      expect(priv.structureInstances.hasIdle(s)).toBe(true);
    }
    expect(instancesOf(priv, geoOf('fence')).length + instancesOf(priv, geoOf('sandbag_post')).length).toBe(all.length);
  });

  it('keeps the run facing as the structure instances report it', () => {
    const { priv, ns, ew, posts } = build();
    priv.updateBuildingMeshes();
    for (const s of ns) expect(priv.structureInstances.yawOf(s), `ns ${s}`).toBeCloseTo(Math.PI / 2, 12);
    for (const s of [...ew, ...posts]) expect(priv.structureInstances.yawOf(s), `other ${s}`).toBe(0);
  });

  it('a destroyed tile is gone from the standing set and drawn once in the wreck set, same place and facing', () => {
    const { sim, priv, ns } = build();
    priv.updateBuildingMeshes();
    const wall = (priv.buildingMeshIdleTemplates.get('fence')!.root.getObjectByName('wall') as THREE.Mesh).geometry;
    const idleMat = priv.buildingMeshIdleTemplates.get('fence')!.root.getObjectByName('wall') as THREE.Mesh;
    const before = instancesOf(priv, wall, idleMat.material as THREE.Material);
    expect(before.length).toBe(5);
    const victim = ns[1];
    sim.structures.alive[victim] = 0;
    priv.updateBuildingMeshes();
    expect(priv.structureInstances.hasIdle(victim)).toBe(false);
    expect(priv.structureInstances.hasWreck(victim)).toBe(true);
    // 4 standing tiles remain in the standing wall set; the wreck set holds the one that fell.
    const standing = instancesOf(priv, wall, idleMat.material as THREE.Material);
    const wreckMesh = priv.structureInstances.meshes().find((m) => m.count === 1 && m.material === (priv.buildingMeshWreckTemplates.get('fence')!.root.getObjectByName('wall') as THREE.Mesh).material);
    expect(wreckMesh).toBeDefined();
    expect(standing.length).toBe(4);
    // No standing instance sits where the wreck does.
    const wp = matrixOf(wreckMesh!, 0);
    for (const m of standing) {
      const same = Math.abs(m.elements[12] - wp.elements[12]) < 1e-6 && Math.abs(m.elements[14] - wp.elements[14]) < 1e-6;
      expect(same, 'a destroyed tile is still drawn standing').toBe(false);
    }
    // The wreck keeps the run's facing: a quarter turn, as its standing tile had.
    expect(priv.structureInstances.yawOf(victim)).toBeCloseTo(Math.PI / 2, 12);
    // Destroying it again changes nothing.
    priv.updateBuildingMeshes();
    expect(instancesOf(priv, wall, idleMat.material as THREE.Material).length).toBe(4);
  });

  it('grows the wreck in on Y over BUILDING_SETTLE_SECONDS and leaves x and z alone', () => {
    const { sim, priv, ns } = build();
    priv.updateBuildingMeshes();
    sim.structures.alive[ns[0]] = 0;
    priv.updateBuildingMeshes();
    const wreckWall = priv.buildingMeshWreckTemplates.get('fence')!.root.getObjectByName('wall') as THREE.Mesh;
    const set = priv.structureInstances.meshes().find((m) => m.count === 1 && m.material === wreckWall.material)!;
    const height = (): number => new THREE.Vector3().setFromMatrixColumn(matrixOf(set, 0), 1).length();
    const width = (): number => new THREE.Vector3().setFromMatrixColumn(matrixOf(set, 0), 0).length();
    const versionBefore = set.instanceMatrix.version;
    const first = buildingSettleScale(0).scaleFactor;
    expect(height()).toBeCloseTo(MESH_SCALE * first, 5);
    expect(first).toBeLessThan(1);
    const w0 = width();
    for (let i = 0; i < 7; i++) priv.stepBuildingMeshSettle(0.06);
    // The step's own flush uploads the new matrix: without it the pile would stay squashed on the GPU.
    expect(set.instanceMatrix.version).toBeGreaterThan(versionBefore);
    expect(height()).toBeCloseTo(MESH_SCALE, 5);
    expect(width()).toBeCloseTo(w0, 5);
  });

  it('moves a tile to a scarred set at its damage band, and a clean band draws no extra set', () => {
    const { sim, priv, ns } = build();
    priv.updateBuildingMeshes();
    const sets0 = priv.structureInstances.meshes().length;
    const hpMax = sim.structures.maxHp[ns[0]];
    // Band 7 is still clean: nothing is minted.
    sim.structures.hp[ns[0]] = Math.floor((hpMax * 7) / 8);
    priv.refreshBuildingDamage(ns[0]);
    expect(priv.structureInstances.stateOf(ns[0])).toBe(0);
    expect(priv.structureInstances.meshes().length).toBe(sets0);
    // Band 3 is scarred: a set of its own per template mesh, one tile each.
    sim.structures.hp[ns[0]] = Math.floor((hpMax * 3) / 8);
    priv.refreshBuildingDamage(ns[0]);
    expect(priv.buildingDamageBand.get(ns[0])).toBe(3);
    expect(priv.structureInstances.stateOf(ns[0])).toBe(3);
    const scarred = priv.structureInstances.meshes().filter((m) => m.count === 1 && m.material !== priv.buildingMeshIdleTemplates.get('fence')!.materials[0] && m.material !== priv.buildingMeshWreckTemplates.get('fence')!.materials[0]);
    expect(scarred.length).toBe(2);
    expect((scarred[0].material as THREE.MeshStandardMaterial).roughness).toBeGreaterThan(0.6);
    // The other fence tiles stayed where they were.
    const wall = (priv.buildingMeshIdleTemplates.get('fence')!.root.getObjectByName('wall') as THREE.Mesh);
    expect(instancesOf(priv, wall.geometry, wall.material as THREE.Material).length).toBe(4);
    // Back to a clean band (a repair): the tile returns to the clean set.
    sim.structures.hp[ns[0]] = hpMax;
    priv.refreshBuildingDamage(ns[0]);
    expect(priv.structureInstances.stateOf(ns[0])).toBe(0);
  });

  it('stays in the AO pre-pass, as the clones were (an opaque mesh with normals and no exemption)', () => {
    const { priv } = build();
    priv.updateBuildingMeshes();
    const sets = priv.structureInstances.meshes();
    expect(sets.length).toBeGreaterThan(0);
    for (const m of sets) expect(isAoOccluder(m)).toBe(true);
  });

  it('draws a tile damaged before it was re-stood as a clone at its scar band (the band is not stale)', () => {
    const { r, sim, priv, ns } = build();
    priv.updateBuildingMeshes();
    sim.structures.hp[ns[0]] = Math.floor((sim.structures.maxHp[ns[0]] * 3) / 8);
    priv.refreshBuildingDamage(ns[0]);
    expect(priv.buildingDamageBand.get(ns[0])).toBe(3);
    r.debugPerTileInstancing(false);
    priv.updateBuildingMeshes();
    const base = priv.buildingMeshIdleTemplates.get('fence')!.materials[0];
    const mats: THREE.Material[] = [];
    priv.buildingMeshIdleEntities.get(ns[0])!.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) mats.push((o as THREE.Mesh).material as THREE.Material);
    });
    expect(mats.length).toBeGreaterThan(0);
    for (const m of mats) expect(m, 'the clone stood up clean').not.toBe(base);
  });

  it('the buildings debug layer hides the instanced sets, and holds across updates', () => {
    const { r, priv } = build();
    priv.updateBuildingMeshes();
    const meshes = priv.structureInstances.meshes();
    expect(meshes.every((m) => m.visible)).toBe(true);
    const n = r.setDebugLayerVisible('buildings', false);
    expect(n).toBeGreaterThanOrEqual(meshes.length);
    expect(priv.structureInstances.meshes().every((m) => !m.visible)).toBe(true);
    priv.updateBuildingMeshes(); // a frame later: still hidden, because the flag holds
    expect(priv.structureInstances.meshes().every((m) => !m.visible)).toBe(true);
    r.setDebugLayerVisible('buildings', true);
    expect(priv.structureInstances.meshes().every((m) => m.visible)).toBe(true);
  });

  it('a killed tile holds its standing mesh under the collapse shroud, as a clone does', () => {
    const { priv, ns } = build();
    // The measured bounds a loaded type has: the shroud is sized from them and holds only where it can.
    priv.buildingMeshBounds.set('fence', new THREE.Vector3(1, 0.3, 0.2));
    priv.updateBuildingMeshes();
    priv.beginCollapseShroud(ns[0], 3.5, 2.5);
    expect(priv.buildingMeshSwapHold.has(ns[0])).toBe(true);
  });

  it('keeps the clone path for a type with a construction mesh (a clip plane cannot be instanced)', () => {
    const { priv, ns } = build();
    priv.buildingMeshConstructionTemplates.set('fence', realTemplate());
    // `perTileInstanced` consults the construction map: the type stands up as clones.
    priv.updateBuildingMeshes();
    // construction template present and progress is full (ONE): standing clone path.
    expect(priv.buildingMeshIdleEntities.has(ns[0])).toBe(true);
    expect(priv.structureInstances.hasIdle(ns[0])).toBe(false);
  });

  it('keeps the clone path when the template has no registered instanced sets (a part off the root frame)', () => {
    const w = build(false);
    // Never registered -> `handles` is false -> clones.
    w.priv.updateBuildingMeshes();
    expect(w.priv.buildingMeshIdleEntities.has(w.ns[0])).toBe(true);
    expect(w.priv.structureInstances.meshes().length).toBe(0);
    // And the guard that decides registration refuses an offset part.
    const off = realTemplate();
    off.root.children[1].position.set(0, 1, 0);
    expect(instanceableTemplate(off)).toBe(false);
  });

  it('a tile built after the first update joins its set, past the first capacity', () => {
    const { sim, priv, ns } = build();
    priv.updateBuildingMeshes();
    const fenceType = sim.structures.typeIdx[ns[0]];
    const added: number[] = [];
    for (let i = 0; i < 12; i++) added.push(sim.addStructure(fenceType, [i + 11 * sim.width]));
    priv.updateBuildingMeshes();
    for (const s of added) expect(priv.structureInstances.hasIdle(s), `tile ${s}`).toBe(true);
    const wall = (priv.buildingMeshIdleTemplates.get('fence')!.root.getObjectByName('wall') as THREE.Mesh);
    expect(instancesOf(priv, wall.geometry, wall.material as THREE.Material).length).toBe(5 + 12);
  });

  it('swaps a run to its LOD1 twin by the camera zoom, one draw per set, through updateBuildingMeshes (GH-974)', () => {
    const { r, priv, ns, ew } = build();
    // The twin: the fence's roles with their own, smaller geometry and no material of their own.
    const base = realTemplate();
    const geos: THREE.BufferGeometry[] = base.root.children.map((c) => {
      const g = new THREE.PlaneGeometry(1, 1);
      (c as THREE.Mesh).geometry = g;
      return g;
    });
    const lod: BuildingMeshTemplate = { root: base.root, materials: base.materials, geometries: geos };
    expect(priv.structureInstances.setIdleLod1('fence', lod)).toBe(true);
    const fenceGeos = new Set(priv.buildingMeshIdleTemplates.get('fence')!.geometries);
    const twinGeos = new Set(geos);
    const fenceDrawn = (): THREE.InstancedMesh[] =>
      priv.structureInstances.meshes().filter((m) => m.visible && (fenceGeos.has(m.geometry) || twinGeos.has(m.geometry)));
    const tiles = ns.length + ew.length;

    r.camera.zoom = 1.0;
    priv.updateBuildingMeshes();
    expect(fenceDrawn().length).toBe(2); // wall + roof: one draw each, not one per tile
    expect(fenceDrawn().every((m) => twinGeos.has(m.geometry) && m.count === tiles)).toBe(true);

    r.camera.zoom = 2.0; // the boundary, from below: the twin holds (hysteresis)
    priv.updateBuildingMeshes();
    expect(fenceDrawn().every((m) => twinGeos.has(m.geometry))).toBe(true);

    r.camera.zoom = 2.05;
    priv.updateBuildingMeshes();
    expect(fenceDrawn().length).toBe(2);
    expect(fenceDrawn().every((m) => fenceGeos.has(m.geometry) && m.count === tiles)).toBe(true);
  });

  it('dispose takes every instanced mesh out of the scene', () => {
    const { r, priv } = build();
    priv.updateBuildingMeshes();
    // Taken BEFORE dispose: the registry is empty afterwards, so reading it then would prove nothing.
    const sets = priv.structureInstances.meshes();
    expect(sets.length).toBeGreaterThan(0);
    for (const m of sets) expect(priv.scene.children.includes(m)).toBe(true);
    r.dispose();
    for (const m of sets) expect(priv.scene.children.includes(m), 'a set outlived dispose').toBe(false);
  });
});
