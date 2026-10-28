/**
 * The runtime half of kitted infantry (GH-826): `applyInfantryKit`, and its
 * call from `buildMeshUnitTemplate`.
 *
 * The fixture is a scene graph in the shape `GLTFLoader` hands back for a
 * kitted team GLB: role meshes (`uniform`, `weapon`) as SkinnedMeshes on one
 * skeleton, and one packed `kit_<host>` SkinnedMesh per host beside each, with
 * the host's parent, local transform, material, skeleton and attribute set
 * plus `_rl_kit`. Built in memory because every property under test is a
 * scene-graph identity; the transport half is `infantry-kit-pass.ts`, gated in
 * `tools/src/meshes/infantry-kit-pass.test.ts`, and the real file is read by
 * `infantry-kit-shipped.test.ts`.
 *
 * Every vertex carries its part's marker in `position.x` (100 + part id), so a
 * test can tell which part a merged vertex came from, and in what order.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  INFANTRY_KIT_TAG_ATTR,
  applyInfantryKit,
  infantryKitTag,
  keptKitGeometry,
  keptPartIds,
  type InfantryKitPart,
} from './infantry-kit';
import { buildMeshUnitTemplate } from './mesh-unit';
import { KIT_BASE_COUNT_KEY } from './vehicle-kit';

type PartSpec = Omit<InfantryKitPart, 'id'>;

/** The uniform kit: three armour tiers with a shoulder slot per side, one sensors part. */
const UNIFORM_PARTS: PartSpec[] = [
  { track: 'armour', tier: 1, figure: 'f0', part: 'helmet_cover' }, // 0
  { track: 'armour', tier: 2, figure: 'f0', part: 'shoulder', slot: 'shoulder', side: 'L' }, // 1
  { track: 'armour', tier: 3, figure: 'f0', part: 'upperarm_guard', slot: 'shoulder', side: 'L' }, // 2
  { track: 'armour', tier: 3, figure: 'f0', part: 'upperarm_guard', slot: 'shoulder', side: 'R' }, // 3
  { track: 'armour', tier: 2, figure: 'f0', part: 'shoulder', slot: 'shoulder', side: 'R' }, // 4
  { track: 'sensors', tier: 1, figure: 'f0', part: 'nvg_mount' }, // 5
  { track: 'armour', tier: 1, figure: 'f1', part: 'helmet_cover' }, // 6
];
/** The weapon kit: a red dot that gives way to a magnified optic, and a suppressor. */
const WEAPON_PARTS: PartSpec[] = [
  { track: 'firepower', tier: 1, figure: 'f0', part: 'optic_dot', slot: 'optic' }, // 0
  { track: 'firepower', tier: 2, figure: 'f0', part: 'optic_mag', slot: 'optic' }, // 1
  { track: 'firepower', tier: 3, figure: 'f0', part: 'suppressor' }, // 2
];

/** Triangles per part, all different so a vertex count names its parts. */
const UNIFORM_TRIS = [2, 3, 4, 5, 6, 7, 8];
const WEAPON_TRIS = [2, 3, 4];
const HOST_TRIS = { uniform: 9, weapon: 5 };

/** `tris` triangles, every vertex at x = `marker`, indexed. */
function packed(tags: readonly number[], trisPerTag: readonly number[], withTag: boolean): THREE.BufferGeometry {
  const verts: number[] = [];
  const ids: number[] = [];
  tags.forEach((tag, i) => {
    for (let t = 0; t < trisPerTag[i] * 3; t++) {
      verts.push(100 + tag);
      ids.push(tag);
    }
  });
  return geometry(verts, withTag ? ids : null);
}

function geometry(xs: readonly number[], ids: readonly number[] | null): THREE.BufferGeometry {
  const n = xs.length;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const si = new Uint8Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    pos[v * 3] = xs[v];
    pos[v * 3 + 1] = v;
    nor[v * 3 + 1] = 1;
    sw[v * 4] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(0.25), 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (ids) g.setAttribute(INFANTRY_KIT_TAG_ATTR, new THREE.BufferAttribute(Uint8Array.from(ids), 1));
  g.setIndex([...Array(n).keys()]);
  return g;
}

interface Fixture {
  root: THREE.Group;
  hosts: Record<'uniform' | 'weapon', THREE.SkinnedMesh>;
  kits: Record<'uniform' | 'weapon', THREE.SkinnedMesh>;
  hostGeometry: Record<'uniform' | 'weapon', THREE.BufferGeometry>;
  materials: Record<'uniform' | 'weapon', THREE.MeshStandardMaterial>;
}

function skinned(name: string, g: THREE.BufferGeometry, m: THREE.Material, skeleton: THREE.Skeleton): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(g, m);
  mesh.name = name;
  mesh.bind(skeleton);
  return mesh;
}

function fixture(): Fixture {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'f0_root';
  const weaponBone = new THREE.Bone();
  weaponBone.name = 'f0_weapon';
  bone.add(weaponBone);
  root.add(bone);
  const skeleton = new THREE.Skeleton([bone, weaponBone]);
  const materials = { uniform: new THREE.MeshStandardMaterial(), weapon: new THREE.MeshStandardMaterial() };
  const hostGeometry = {
    uniform: geometry(Array<number>(HOST_TRIS.uniform * 3).fill(0), null),
    weapon: geometry(Array<number>(HOST_TRIS.weapon * 3).fill(0), null),
  };
  const kitUniform = packed([0, 1, 2, 3, 4, 5, 6], UNIFORM_TRIS, true);
  const kitWeapon = packed([0, 1, 2], WEAPON_TRIS, true);
  const hosts = {
    uniform: skinned('uniform', hostGeometry.uniform, materials.uniform, skeleton),
    weapon: skinned('weapon', hostGeometry.weapon, materials.weapon, skeleton),
  };
  const kits = {
    uniform: skinned('kit_uniform', kitUniform, materials.uniform, skeleton),
    weapon: skinned('kit_weapon', kitWeapon, materials.weapon, skeleton),
  };
  kits.uniform.userData.rl_kit = { host: 'uniform', parts: UNIFORM_PARTS };
  kits.weapon.userData.rl_kit = { host: 'weapon', parts: WEAPON_PARTS };
  root.add(hosts.uniform, hosts.weapon, kits.uniform, kits.weapon);
  return { root, hosts, kits, hostGeometry, materials };
}

/** The distinct part markers present in a merged geometry, in order of first appearance. */
function markers(g: THREE.BufferGeometry): number[] {
  const x = g.getAttribute('position');
  const out: number[] = [];
  for (let i = 0; i < x.count; i++) {
    const m = x.getX(i);
    if (m >= 100 && out[out.length - 1] !== m - 100) out.push(m - 100);
  }
  return out;
}

const triangles = (g: THREE.BufferGeometry): number => (g.index?.count ?? 0) / 3;

describe('keptPartIds', () => {
  const parts = UNIFORM_PARTS.map((p, id) => ({ id, ...p }));
  const kept = (tiers: Record<string, number> | undefined): number[] => [...keptPartIds(parts, tiers)].sort((a, b) => a - b);

  it('keeps nothing with no tiers and with every tier 0', () => {
    expect(kept(undefined)).toEqual([]);
    expect(kept({ armour: 0, sensors: 0, firepower: 0 })).toEqual([]);
  });

  it('is cumulative within a track and names no other track', () => {
    expect(kept({ armour: 1 })).toEqual([0, 6]);
    expect(kept({ sensors: 1 })).toEqual([5]);
    expect(kept({ armour: 2 })).toEqual([0, 1, 4, 6]);
  });

  it('keeps only the highest bought tier in a slot, per side and per figure', () => {
    // armour 3: the guards replace the shoulders, side by side
    expect(kept({ armour: 3 })).toEqual([0, 2, 3, 6]);
  });

  it('supersedes within what is BOUGHT: a tier not bought never hides a lower one', () => {
    // armour 2: the tier-3 guards are not bought, so the tier-2 shoulders stay
    expect(kept({ armour: 2 })).toContain(1);
    expect(kept({ armour: 2 })).not.toContain(2);
  });

  it('supersedes per side: a tier 3 guard on the left leaves the right side\'s own tier 2 pad alone', () => {
    const uneven: InfantryKitPart[] = [
      { id: 0, track: 'armour', tier: 2, figure: 'f0', part: 'shoulder', slot: 'shoulder', side: 'L' },
      { id: 1, track: 'armour', tier: 3, figure: 'f0', part: 'upperarm_guard', slot: 'shoulder', side: 'L' },
      { id: 2, track: 'armour', tier: 2, figure: 'f0', part: 'shoulder', slot: 'shoulder', side: 'R' },
    ];
    expect([...keptPartIds(uneven, { armour: 3 })].sort()).toEqual([1, 2]);
  });

  it('does not let a slot on one figure supersede the same slot on another', () => {
    const two: InfantryKitPart[] = [
      { id: 0, track: 'firepower', tier: 1, figure: 'f0', part: 'optic_dot', slot: 'optic' },
      { id: 1, track: 'firepower', tier: 2, figure: 'f1', part: 'optic_mag', slot: 'optic' },
    ];
    expect([...keptPartIds(two, { firepower: 2 })].sort()).toEqual([0, 1]);
  });
});

describe('infantryKitTag', () => {
  it('reads a well-formed tag and numbers the parts by their position', () => {
    const f = fixture();
    const tag = infantryKitTag(f.kits.uniform);
    expect(tag.host).toBe('uniform');
    expect(tag.parts.map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(tag.parts[1]).toMatchObject({ track: 'armour', tier: 2, slot: 'shoulder', side: 'L' });
  });

  it('refuses a node with no rl_kit, no host, no parts or a tier below 1', () => {
    const mk = (rl: unknown): THREE.Object3D => {
      const o = new THREE.Object3D();
      o.name = 'kit_uniform';
      if (rl !== undefined) o.userData.rl_kit = rl;
      return o;
    };
    expect(() => infantryKitTag(mk(undefined))).toThrow(/no extras.rl_kit/);
    expect(() => infantryKitTag(mk({ parts: [] }))).toThrow(/no host/);
    expect(() => infantryKitTag(mk({ host: 'uniform', parts: [] }))).toThrow(/no parts/);
    expect(() => infantryKitTag(mk({ host: 'uniform', parts: [{ track: 'armour', tier: 0, figure: 'f0', part: 'x' }] }))).toThrow(/tier 0/);
  });
});

describe('keptKitGeometry', () => {
  it('cuts the kept parts out, compacts the vertices and drops the part-id attribute', () => {
    const g = packed([0, 1, 2], [2, 3, 4], true);
    const cut = keptKitGeometry(g, new Set([1]), 'kit_x');
    expect(cut?.triangles).toBe(3);
    expect(cut?.geometry.getAttribute('position').count).toBe(9);
    expect(cut?.geometry.getAttribute(INFANTRY_KIT_TAG_ATTR)).toBeUndefined();
    expect(markers(cut!.geometry)).toEqual([1]);
    expect(Array.from(cut!.geometry.index!.array)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('reads an INTERLEAVED attribute through its accessor, not its raw array', () => {
    // GLTFLoader hands back interleaved attributes for a file written with strides; `.array` is then
    // the whole block, and a cut that copied it put another vertex's bytes on every kit vertex.
    const g = packed([0, 1], [1, 1], true);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const stride = 5; // x y z + two pad floats
    const block = new Float32Array(pos.count * stride).fill(-7);
    for (let v = 0; v < pos.count; v++) for (let k = 0; k < 3; k++) block[v * stride + k] = pos.getComponent(v, k);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(block, stride), 3, 0));
    const cut = keptKitGeometry(g, new Set([1]), 'kit_x')!;
    const p = cut.geometry.getAttribute('position');
    expect(p.count).toBe(3);
    for (let v = 0; v < 3; v++) expect(p.getX(v)).toBe(101);
    expect(p.getY(0)).toBe(3); // the vertex that was fourth in the source
  });

  it('returns null when nothing is kept', () => {
    expect(keptKitGeometry(packed([0], [2], true), new Set(), 'kit_x')).toBeNull();
  });

  it('refuses a triangle whose vertices belong to two parts', () => {
    const g = packed([0, 1], [1, 1], true);
    (g.getAttribute(INFANTRY_KIT_TAG_ATTR) as THREE.BufferAttribute).setX(1, 1);
    expect(() => keptKitGeometry(g, new Set([0]), 'kit_x')).toThrow(/spans two parts/);
  });
});

describe('applyInfantryKit', () => {
  it('leaves a scene with no kit nodes alone', () => {
    const f = fixture();
    f.root.remove(f.kits.uniform, f.kits.weapon);
    const r = applyInfantryKit(f.root, { armour: 3 });
    expect(r).toEqual({ unused: [], kitted: false, keptTris: 0 });
    expect(f.hosts.uniform.geometry).toBe(f.hostGeometry.uniform);
  });

  it.each([
    ['no tiers', undefined],
    ['every tier 0', { armour: 0, sensors: 0, firepower: 0 }],
  ])('with %s the template is the shipped one: every host keeps its own geometry object', (_n, tiers) => {
    const f = fixture();
    const r = applyInfantryKit(f.root, tiers);
    expect(f.hosts.uniform.geometry).toBe(f.hostGeometry.uniform);
    expect(f.hosts.weapon.geometry).toBe(f.hostGeometry.weapon);
    expect(r.kitted).toBe(true);
    expect(r.keptTris).toBe(0);
    // the kit nodes are gone and their geometry is handed back for disposal
    expect(f.root.getObjectByName('kit_uniform')).toBeUndefined();
    expect(f.root.getObjectByName('kit_weapon')).toBeUndefined();
    expect(r.unused).toContain(f.kits.uniform.geometry);
    expect(r.unused).not.toContain(f.hostGeometry.uniform);
  });

  it('merges the bought parts into their host, host first, and records the base count', () => {
    const f = fixture();
    const r = applyInfantryKit(f.root, { armour: 1, firepower: 3 });
    // uniform: host 9 + helmet_cover f0 (2) + helmet_cover f1 (8); weapon: host 5 + dot superseded by... mag (3) + suppressor (4)
    expect(triangles(f.hosts.uniform.geometry)).toBe(HOST_TRIS.uniform + 2 + 8);
    expect(triangles(f.hosts.weapon.geometry)).toBe(HOST_TRIS.weapon + 3 + 4);
    expect(r.keptTris).toBe(2 + 8 + 3 + 4);
    expect(f.hosts.uniform.geometry.userData[KIT_BASE_COUNT_KEY]).toBe(HOST_TRIS.uniform * 3);
    // host first: its own triangles keep their indices, so `setDrawRange(0, base)` hides exactly the kit
    const x = f.hosts.uniform.geometry.getAttribute('position');
    for (let i = 0; i < HOST_TRIS.uniform * 3; i++) expect(x.getX(i)).toBe(0);
    expect(markers(f.hosts.uniform.geometry)).toEqual([0, 6]);
    expect(markers(f.hosts.weapon.geometry)).toEqual([1, 2]);
    // the merged geometry has the host's attribute set: no part-id attribute leaks onto it
    expect(f.hosts.uniform.geometry.getAttribute(INFANTRY_KIT_TAG_ATTR)).toBeUndefined();
    expect(Object.keys(f.hosts.uniform.geometry.attributes).sort()).toEqual(['normal', 'position', 'skinIndex', 'skinWeight', 'uv']);
    // the old host geometry is released
    expect(r.unused).toContain(f.hostGeometry.uniform);
  });

  it('replaces the shoulder pads with the arm guards at armour 3, each side on its own', () => {
    const f = fixture();
    applyInfantryKit(f.root, { armour: 3 });
    expect(markers(f.hosts.uniform.geometry)).toEqual([0, 2, 3, 6]);
    f.root.remove(f.hosts.uniform);
    const g = fixture();
    applyInfantryKit(g.root, { armour: 2 });
    expect(markers(g.hosts.uniform.geometry)).toEqual([0, 1, 4, 6]);
  });

  it('a track the unit does not name draws nothing', () => {
    const f = fixture();
    applyInfantryKit(f.root, { sensors: 1 });
    expect(markers(f.hosts.uniform.geometry)).toEqual([5]);
    expect(f.hosts.weapon.geometry).toBe(f.hostGeometry.weapon);
  });

  it('is deterministic: two loads of one scene build identical buffers', () => {
    const a = fixture();
    const b = fixture();
    applyInfantryKit(a.root, { armour: 3, sensors: 2, firepower: 2 });
    applyInfantryKit(b.root, { armour: 3, sensors: 2, firepower: 2 });
    for (const k of ['uniform', 'weapon'] as const) {
      expect(Array.from(a.hosts[k].geometry.getAttribute('position').array)).toEqual(
        Array.from(b.hosts[k].geometry.getAttribute('position').array)
      );
      expect(Array.from(a.hosts[k].geometry.index!.array)).toEqual(Array.from(b.hosts[k].geometry.index!.array));
    }
  });

  it('adds no object to the scene and removes only the kit nodes', () => {
    const f = fixture();
    const before = new Set<THREE.Object3D>();
    f.root.traverse((o) => before.add(o));
    applyInfantryKit(f.root, { armour: 3, sensors: 3, firepower: 3 });
    const after = new Set<THREE.Object3D>();
    f.root.traverse((o) => after.add(o));
    expect([...after].every((o) => before.has(o))).toBe(true);
    expect([...before].filter((o) => !after.has(o)).map((o) => o.name).sort()).toEqual(['kit_uniform', 'kit_weapon']);
  });

  describe('refuses a kit that breaks the contract, naming the node', () => {
    it('a host no skinned mesh carries', () => {
      const f = fixture();
      f.kits.uniform.userData.rl_kit = { host: 'torso', parts: UNIFORM_PARTS };
      expect(() => applyInfantryKit(f.root, {})).toThrow(/kit_uniform.*names host "torso"/);
    });

    it('another material than its host (that would be +1 draw call)', () => {
      const f = fixture();
      f.kits.uniform.material = new THREE.MeshStandardMaterial();
      expect(() => applyInfantryKit(f.root, { armour: 1 })).toThrow(/must use its host "uniform"'s material/);
    });

    it('another parent than its host', () => {
      const f = fixture();
      const other = new THREE.Group();
      f.root.add(other);
      other.add(f.kits.weapon);
      expect(() => applyInfantryKit(f.root, {})).toThrow(/must share its host "weapon"'s parent/);
    });

    it('another local transform than its host', () => {
      const f = fixture();
      f.kits.weapon.position.set(0, 1, 0);
      expect(() => applyInfantryKit(f.root, {})).toThrow(/local transform/);
    });

    it('an attribute its host lacks, or one it is missing', () => {
      const f = fixture();
      f.kits.uniform.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(f.kits.uniform.geometry.getAttribute('position').count * 3), 3));
      expect(() => applyInfantryKit(f.root, {})).toThrow(/they must match/);
      const g = fixture();
      g.kits.weapon.geometry.deleteAttribute('uv');
      expect(() => applyInfantryKit(g.root, {})).toThrow(/they must match/);
    });

    it('a kit that is not a skinned mesh', () => {
      const f = fixture();
      const plain = new THREE.Mesh(f.kits.uniform.geometry, f.materials.uniform);
      plain.name = 'kit_uniform';
      plain.userData.rl_kit = { host: 'uniform', parts: UNIFORM_PARTS };
      f.root.remove(f.kits.uniform);
      f.root.add(plain);
      expect(() => applyInfantryKit(f.root, {})).toThrow(/not a skinned mesh/);
    });

    it('a kit on another skeleton than its host', () => {
      const f = fixture();
      const b = new THREE.Bone();
      b.name = 'someone_else';
      f.kits.uniform.bind(new THREE.Skeleton([b]));
      expect(() => applyInfantryKit(f.root, {})).toThrow(/not bound to its host/);
    });

    it('is checked at tier 0 too: a malformed kit must not wait for a brigade to buy it', () => {
      const f = fixture();
      f.kits.weapon.userData.rl_kit = { host: 'weapon' };
      expect(() => applyInfantryKit(f.root, undefined)).toThrow(/lists no parts/);
    });
  });
});

describe('buildMeshUnitTemplate carries the kit', () => {
  /** A team scene with the two role meshes `buildMeshUnitTemplate` maps to a ramp. */
  function team(): Fixture {
    const f = fixture();
    f.hosts.uniform.userData.rl_role = 'uniform';
    f.hosts.weapon.userData.rl_role = 'weapon';
    return f;
  }
  const gltf = (f: Fixture) => ({ scene: f.root, animations: [] as THREE.AnimationClip[] });

  it('builds with the kit nodes in the file (a kit node is not an unmapped role) and marks the template', () => {
    const f = team();
    const t = buildMeshUnitTemplate(gltf(f), 'kdf', 'team.glb', false, { armour: 1 });
    expect(t.kitted).toBe(true);
    expect(triangles(f.hosts.uniform.geometry)).toBeGreaterThan(HOST_TRIS.uniform);
  });

  it('a team with no kit nodes is not marked', () => {
    const f = team();
    f.root.remove(f.kits.uniform, f.kits.weapon);
    expect(buildMeshUnitTemplate(gltf(f), 'kdf', 'team.glb', false, { armour: 3 }).kitted).toBeUndefined();
  });

  it('at tier 0 the template draws exactly the shipped geometry', () => {
    const f = team();
    const t = buildMeshUnitTemplate(gltf(f), 'kdf', 'team.glb', false);
    expect(f.hosts.uniform.geometry).toBe(f.hostGeometry.uniform);
    expect(t.geometries).toContain(f.hostGeometry.uniform);
    expect(t.geometries).toHaveLength(2);
  });

  it('registers the MERGED geometries for disposal, not the discarded ones', () => {
    const f = team();
    const t = buildMeshUnitTemplate(gltf(f), 'kdf', 'team.glb', false, { armour: 3, firepower: 3 });
    expect(t.geometries).toContain(f.hosts.uniform.geometry);
    expect(t.geometries).not.toContain(f.hostGeometry.uniform);
    expect(t.geometries).not.toContain(f.kits.uniform.geometry);
  });
});
