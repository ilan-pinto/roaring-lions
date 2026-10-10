/**
 * The runtime half of kitted vehicles (GH-238): `applyVehicleKit` and its
 * call from `buildVehicleMeshTemplate`.
 *
 * The fixture is a scene graph in the shape `GLTFLoader` hands back for a
 * kitted, wreck-passed vehicle GLB: live part meshes, a `death_root` whose
 * `WRECK_` twins are SEPARATE `THREE.Mesh` objects over the SAME geometry
 * (the wreck pass shares the glTF mesh), and `kit_<track>_<tier>_<host>`
 * meshes beside their hosts with the host's parent, local transform,
 * material and attribute set. Built in memory rather than as a GLB because
 * every property under test is a scene-graph identity, and the contract's
 * transport half (the graft) is Task 2's `kit-pass.ts`, gated there.
 *
 * Every vertex carries its part's own marker in `position.x`, so a test can
 * tell which part a merged vertex came from and in what order.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyVehicleKit, KIT_BASE_COUNT_KEY, setKitDrawRange, type VehicleKitTiers } from './vehicle-kit';
import { buildVehicleMeshTemplate } from './mesh-vehicle';

/** `tris` triangles, every vertex at x = `marker`, indexed, with a `uv` iff
 *  `uv`. */
function partGeometry(marker: number, tris: number, uv: boolean): THREE.BufferGeometry {
  const n = tris * 3;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    pos[v * 3] = marker;
    pos[v * 3 + 1] = v;
    pos[v * 3 + 2] = v % 3;
    nor[v * 3 + 1] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(0.25), 2));
  g.setIndex([...Array(n).keys()]);
  return g;
}

/** Marker per part: the host is 0, the kit parts are distinct. */
const M = {
  turret: 0,
  armour1: 11,
  armour2: 12,
  armour3: 13,
  sensors1: 21,
  hull: 100,
  firepower1: 131,
} as const;

/** Triangle counts, all different so a vertex count names its parts. */
const T = { turret: 4, armour1: 1, armour2: 2, armour3: 5, sensors1: 3, hull: 6, firepower1: 7 } as const;

interface Fixture {
  root: THREE.Group;
  turret: THREE.Mesh;
  hull: THREE.Mesh;
  wreckTurret: THREE.Mesh;
  wreckHull: THREE.Mesh;
  kits: Map<string, THREE.Mesh>;
  turretGeometry: THREE.BufferGeometry;
  hullGeometry: THREE.BufferGeometry;
}

function kitMesh(
  name: string,
  host: THREE.Mesh,
  tag: { track: string; tier: number },
  marker: number,
  tris: number,
  uv: boolean
): THREE.Mesh {
  const m = new THREE.Mesh(partGeometry(marker, tris, uv), host.material);
  m.name = name;
  m.userData = { rl_role: host.userData.rl_role, rl_kit: { track: tag.track, tier: tag.tier, host: host.name } };
  m.position.copy(host.position);
  m.quaternion.copy(host.quaternion);
  m.scale.copy(host.scale);
  return m;
}

function fixture(): Fixture {
  const root = new THREE.Group();
  root.name = 'Scene';
  // A textured host (uv) under the turret pivot, off-origin and turned, so a
  // part that did NOT share its transform would be told apart.
  const turretMat = new THREE.MeshStandardMaterial();
  const pivot = new THREE.Group();
  pivot.name = 'turret_pivot';
  pivot.position.set(0, 1, 0);
  root.add(pivot);
  const turret = new THREE.Mesh(partGeometry(M.turret, T.turret, true), turretMat);
  turret.name = 'turret_hull';
  turret.userData = { rl_role: 'hull' };
  turret.position.set(0.2, 0.3, -0.1);
  turret.rotation.set(0, 0.4, 0);
  pivot.add(turret);
  // A palette host: no uv, no texture -- the Namer/Eitan/Kipod/Shachaf
  // weapon-station shape.
  const hullMat = new THREE.MeshStandardMaterial();
  const hull = new THREE.Mesh(partGeometry(M.hull, T.hull, false), hullMat);
  hull.name = 'hull_metal';
  hull.userData = { rl_role: 'metal' };
  root.add(hull);

  const kits = new Map<string, THREE.Mesh>();
  const addKit = (name: string, host: THREE.Mesh, track: string, tier: number, marker: number, tris: number): void => {
    const m = kitMesh(name, host, { track, tier }, marker, tris, host === turret);
    host.parent?.add(m);
    kits.set(name, m);
  };
  addKit('kit_armour_1_turret_hull', turret, 'armour', 1, M.armour1, T.armour1);
  addKit('kit_armour_2_turret_hull', turret, 'armour', 2, M.armour2, T.armour2);
  addKit('kit_armour_3_turret_hull', turret, 'armour', 3, M.armour3, T.armour3);
  addKit('kit_sensors_1_turret_hull', turret, 'sensors', 1, M.sensors1, T.sensors1);
  addKit('kit_firepower_1_hull_metal', hull, 'firepower', 1, M.firepower1, T.firepower1);

  // The wreck pass's shape: separate meshes, SAME geometry objects.
  const deathRoot = new THREE.Group();
  deathRoot.name = 'death_root';
  root.add(deathRoot);
  const wreckTurret = new THREE.Mesh(turret.geometry, turretMat);
  wreckTurret.name = 'WRECK_turret_hull';
  wreckTurret.userData = { rl_role: 'hull', rl_wreck: true };
  const wreckHull = new THREE.Mesh(hull.geometry, hullMat);
  wreckHull.name = 'WRECK_hull_metal';
  wreckHull.userData = { rl_role: 'metal', rl_wreck: true };
  deathRoot.add(wreckTurret, wreckHull);

  return {
    root,
    turret,
    hull,
    wreckTurret,
    wreckHull,
    kits,
    turretGeometry: turret.geometry,
    hullGeometry: hull.geometry,
  };
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

/** The markers of a geometry's vertices, in order, run-length collapsed. */
function markerRuns(g: THREE.BufferGeometry): number[] {
  const pos = g.getAttribute('position');
  const runs: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (runs[runs.length - 1] !== x) runs.push(x);
  }
  return runs;
}

const verts = (tris: number): number => tris * 3;

describe('applyVehicleKit', () => {
  it('keeps tiers 1..n of a bought track and nothing of an unbought one', () => {
    const f = fixture();
    applyVehicleKit(f.root, { armour: 2 });
    expect(markerRuns(f.turret.geometry)).toEqual([M.turret, M.armour1, M.armour2]);
    // The palette host's firepower part was not bought.
    expect(f.hull.geometry).toBe(f.hullGeometry);
  });

  it('merges host + kept parts exactly: vertex count, index count, and the host FIRST', () => {
    const f = fixture();
    applyVehicleKit(f.root, { armour: 3, sensors: 1 });
    const g = f.turret.geometry;
    expect(g.getAttribute('position').count).toBe(
      verts(T.turret) + verts(T.armour1) + verts(T.armour2) + verts(T.armour3) + verts(T.sensors1)
    );
    expect(markerRuns(g)).toEqual([M.turret, M.armour1, M.armour2, M.armour3, M.sensors1]);
    expect(g.userData[KIT_BASE_COUNT_KEY]).toBe(f.turretGeometry.index?.count);
    // The textured host keeps its uv across the merge.
    expect(g.getAttribute('uv').count).toBe(g.getAttribute('position').count);
  });

  it('swaps the merged geometry onto the WRECK_ twin too', () => {
    const f = fixture();
    applyVehicleKit(f.root, { armour: 1, firepower: 1 });
    expect(f.wreckTurret.geometry).toBe(f.turret.geometry);
    expect(f.wreckHull.geometry).toBe(f.hull.geometry);
    expect(f.turret.geometry).not.toBe(f.turretGeometry);
  });

  it('merges a palette host (no uv) and its part', () => {
    const f = fixture();
    applyVehicleKit(f.root, { firepower: 1 });
    expect(markerRuns(f.hull.geometry)).toEqual([M.hull, M.firepower1]);
    expect(f.hull.geometry.getAttribute('uv')).toBeUndefined();
    expect(f.hull.geometry.getAttribute('position').count).toBe(verts(T.hull) + verts(T.firepower1));
  });

  it('leaves the mesh count unchanged and removes every kit node, kept or not', () => {
    const f = fixture();
    const before = meshes(f.root).filter((m) => !m.name.startsWith('kit_')).length;
    applyVehicleKit(f.root, { armour: 2 });
    const after = meshes(f.root);
    expect(after).toHaveLength(before);
    expect(after.some((m) => m.name.startsWith('kit_'))).toBe(false);
    for (const k of f.kits.values()) expect(k.parent).toBeNull();
  });

  it('the draw range at rlKitBaseCount draws exactly the host, and Infinity draws everything', () => {
    const f = fixture();
    applyVehicleKit(f.root, { armour: 3, sensors: 1 });
    const g = f.turret.geometry;
    expect(setKitDrawRange([g, f.hull.geometry], true)).toBe(1);
    const index = g.index;
    if (index === null) throw new Error('merged geometry lost its index');
    const pos = g.getAttribute('position');
    const base = g.drawRange.count;
    expect(base).toBe(f.turretGeometry.index?.count);
    // Every index drawn is a host vertex; every index past it is a kit one.
    for (let i = 0; i < index.count; i++) {
      const marker = pos.getX(index.getX(i));
      if (i < base) expect(marker, `index ${i}`).toBe(M.turret);
      else expect(marker, `index ${i}`).not.toBe(M.turret);
    }
    // A geometry with no kit is untouched.
    expect(f.hull.geometry.drawRange.count).toBe(Infinity);
    expect(setKitDrawRange([g], false)).toBe(1);
    expect(g.drawRange.count).toBe(Infinity);
  });

  it('returns exactly the geometries nothing references any more', () => {
    const f = fixture();
    const unused = applyVehicleKit(f.root, { armour: 1 });
    const live = new Set(meshes(f.root).map((m) => m.geometry));
    for (const g of unused) expect(live.has(g)).toBe(false);
    expect(unused).toContain(f.turretGeometry);
    for (const k of f.kits.values()) expect(unused).toContain(k.geometry);
    expect(unused).toHaveLength(f.kits.size + 1);
  });

  it('with no tiers, or every tier 0, every mesh keeps its exact geometry object and the kit nodes go', () => {
    const cases: (VehicleKitTiers | undefined)[] = [undefined, {}, { armour: 0, sensors: 0, firepower: 0 }];
    for (const tiers of cases) {
      const f = fixture();
      const before = new Map(meshes(f.root).map((m) => [m, m.geometry]));
      const unused = applyVehicleKit(f.root, tiers);
      const after = meshes(f.root);
      expect(after.some((m) => m.name.startsWith('kit_'))).toBe(false);
      for (const m of after) expect(m.geometry).toBe(before.get(m));
      expect(new Set(unused)).toEqual(new Set([...f.kits.values()].map((k) => k.geometry)));
      expect(f.turret.geometry.userData[KIT_BASE_COUNT_KEY]).toBeUndefined();
    }
  });

  it('throws, naming the node, on a part whose local transform differs from its host', () => {
    const f = fixture();
    f.kits.get('kit_armour_2_turret_hull')?.position.setX(0.5);
    // Even unbought: a broken graft is broken at tier 0.
    expect(() => applyVehicleKit(f.root, {})).toThrow(/kit_armour_2_turret_hull.*local transform/);
  });

  it('throws on a part under a different parent from its host', () => {
    const f = fixture();
    const part = f.kits.get('kit_sensors_1_turret_hull');
    if (part === undefined) throw new Error('fixture');
    f.root.add(part);
    expect(() => applyVehicleKit(f.root, { sensors: 1 })).toThrow(/kit_sensors_1_turret_hull.*parent/);
  });

  it('throws on a part with no valid rl_kit, a missing host, or a different attribute set', () => {
    const a = fixture();
    const bad = a.kits.get('kit_armour_1_turret_hull');
    if (bad) bad.userData.rl_kit = { track: 'armour', tier: 0, host: 'turret_hull' };
    expect(() => applyVehicleKit(a.root, {})).toThrow(/kit_armour_1_turret_hull.*rl_kit/);

    const b = fixture();
    const orphan = b.kits.get('kit_armour_1_turret_hull');
    if (orphan) orphan.userData.rl_kit = { track: 'armour', tier: 1, host: 'turret_nope' };
    expect(() => applyVehicleKit(b.root, {})).toThrow(/turret_nope/);

    const c = fixture();
    c.kits.get('kit_armour_3_turret_hull')?.geometry.deleteAttribute('uv');
    expect(() => applyVehicleKit(c.root, { armour: 3 })).toThrow(/kit_armour_3_turret_hull.*attributes/);
  });
});

describe('buildVehicleMeshTemplate with kit tiers', () => {
  it('builds the same meshes, materials and geometry semantics as without, and owns only live geometry', () => {
    const plain = buildVehicleMeshTemplate({ scene: fixture().root }, 'mbt_lavi');
    const f = fixture();
    const disposed = new Set<THREE.BufferGeometry>();
    f.root.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      g?.addEventListener('dispose', () => disposed.add(g));
    });
    const kitted = buildVehicleMeshTemplate({ scene: f.root }, 'mbt_lavi', false, { armour: 3, firepower: 1 });

    expect(meshes(kitted.root)).toHaveLength(meshes(plain.root).length);
    expect(kitted.materials).toHaveLength(plain.materials.length);
    expect(kitted.geometries).toHaveLength(plain.geometries.length);
    const live = new Set(meshes(kitted.root).map((m) => m.geometry));
    // Every geometry the template will dispose is drawn, none twice, and none
    // already disposed: no double dispose, no leak of the old host buffers.
    expect(new Set(kitted.geometries)).toEqual(live);
    for (const g of kitted.geometries) expect(disposed.has(g)).toBe(false);
    expect(disposed.has(f.turretGeometry)).toBe(true);
    expect(disposed.has(f.hullGeometry)).toBe(true);
    for (const k of f.kits.values()) expect(disposed.has(k.geometry)).toBe(true);
    expect(markerRuns(f.turret.geometry)).toEqual([M.turret, M.armour1, M.armour2, M.armour3]);
  });

  it('with no tiers keeps the shipped geometry objects and disposes only the kit parts', () => {
    const f = fixture();
    const template = buildVehicleMeshTemplate({ scene: f.root }, 'mbt_lavi');
    expect(f.turret.geometry).toBe(f.turretGeometry);
    expect(f.hull.geometry).toBe(f.hullGeometry);
    expect(new Set(template.geometries)).toEqual(new Set([f.turretGeometry, f.hullGeometry]));
  });
});
