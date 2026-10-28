/**
 * `inf_squad`'s kit (GH-826), run through the REAL loader on the SHIPPED file:
 * `art/meshes/inf_squad.glb` parsed by `GLTFLoader` and handed to
 * `buildMeshUnitTemplate` with each bought state.
 *
 * What only the real bytes prove:
 *  - the kit survives `GLTFLoader` (a packed node, a custom `_rl_kit`
 *    attribute, the team's own skin) and merges: `mergeGeometries` refuses any
 *    attribute mismatch, and `gpuType` was one nothing but this file found;
 *  - TIER 0 IS THE SHIPPED FIGURE: 8,604 triangles in 4 meshes, the host
 *    geometry untouched, exactly what main drew before the kit;
 *  - the kit adds NO mesh (+0 draw calls) at any tier;
 *  - the triangle counts of every state, as LITERALS measured from the file on
 *    28 Oct 2026 -- the oracle never recomputes them from the part table it is
 *    checking (the tier selection logic itself is `infantry-kit.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseGlbHeadless } from './headless-gltf';
import { buildMeshUnitTemplate } from './mesh-unit';
import { KIT_BASE_COUNT_KEY } from './vehicle-kit';

const GLB = readFileSync(new URL('../../../../../art/meshes/inf_squad.glb', import.meta.url));

/** The shipped figure before the kit: boot, face, uniform, weapon. */
const BASE = { boot: 546, face: 81, uniform: 7032, weapon: 945 };

/** [label, tiers, triangles per role mesh] */
const STATES: [string, Record<string, number>, Partial<typeof BASE>][] = [
  ['armour 1', { armour: 1 }, { uniform: 7602 }],
  ['armour 2', { armour: 2 }, { uniform: 8190 }],
  ['armour 3', { armour: 3 }, { uniform: 8322 }],
  ['sensors 1', { sensors: 1 }, { weapon: 1317 }],
  ['sensors 2', { sensors: 2 }, { uniform: 7220, weapon: 1415 }],
  ['sensors 3', { sensors: 3 }, { uniform: 7220, weapon: 1817 }],
  ['firepower 1', { firepower: 1 }, { weapon: 1245 }],
  ['firepower 2', { firepower: 2 }, { uniform: 7140, weapon: 1431 }],
  ['firepower 3', { firepower: 3 }, { uniform: 7404, weapon: 1641 }],
  ['full kit', { armour: 3, sensors: 3, firepower: 3 }, { uniform: 8882, weapon: 2513 }],
];

async function build(tiers?: Record<string, number>) {
  const gltf = await parseGlbHeadless(GLB);
  const t = buildMeshUnitTemplate(gltf, 'kdf', 'inf_squad.glb', true, tiers);
  const meshes: Record<string, THREE.SkinnedMesh> = {};
  t.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isMesh) meshes[m.name] = m;
  });
  return { t, meshes };
}

const tris = (m: THREE.Mesh): number => (m.geometry.index?.count ?? 0) / 3;

describe('inf_squad through the real loader', () => {
  it('tier 0 is the shipped figure: 8,604 triangles, four meshes, host geometry untouched', async () => {
    const none: (Record<string, number> | undefined)[] = [undefined, {}, { armour: 0, sensors: 0, firepower: 0 }];
    for (const tiers of none) {
      const { t, meshes } = await build(tiers);
      expect(Object.keys(meshes).sort()).toEqual(['boot', 'face', 'uniform', 'weapon']);
      for (const [name, n] of Object.entries(BASE)) expect(tris(meshes[name]), name).toBe(n);
      for (const m of Object.values(meshes)) expect(m.geometry.userData[KIT_BASE_COUNT_KEY]).toBeUndefined();
      expect(t.kitted).toBe(true);
    }
  });

  it.each(STATES)('%s: the role meshes carry exactly the bought parts, and there are still four of them', async (_l, tiers, want) => {
    const { meshes } = await build(tiers);
    expect(Object.keys(meshes).sort()).toEqual(['boot', 'face', 'uniform', 'weapon']);
    const expected = { ...BASE, ...want };
    for (const [name, n] of Object.entries(expected)) expect(tris(meshes[name]), `${name} at ${_l}`).toBe(n);
  });

  it('a tier only ever ADDS: every track grows with every tier it buys', async () => {
    const total = async (t: Record<string, number>): Promise<number> => Object.values((await build(t)).meshes).reduce((n, m) => n + tris(m), 0);
    for (const track of ['armour', 'sensors', 'firepower']) {
      const sizes = [await total({}), await total({ [track]: 1 }), await total({ [track]: 2 }), await total({ [track]: 3 })];
      for (let i = 1; i < sizes.length; i++) expect(sizes[i], `${track} tier ${i}`).toBeGreaterThan(sizes[i - 1]);
    }
  });

  it('full kit draws 3,418 kit triangles: 1,110 + 1,198 + 1,110 per figure, superseded parts dropped', async () => {
    const { meshes } = await build({ armour: 3, sensors: 3, firepower: 3 });
    const all = Object.values(meshes).reduce((n, m) => n + tris(m), 0);
    expect(all - 8604).toBe(1110 + 1198 + 1110);
  });

  it('the kit rides the team\'s bones: kit vertices are skinned at weight 1 to bones of the shared skeleton', async () => {
    const { meshes } = await build({ armour: 3, sensors: 3, firepower: 3 });
    const names = new Set(meshes.uniform.skeleton.bones.map((b) => b.name));
    for (const role of ['uniform', 'weapon'] as const) {
      const m = meshes[role];
      const base = (m.geometry.userData[KIT_BASE_COUNT_KEY] as number) ?? 0;
      expect(base).toBe(role === 'uniform' ? BASE.uniform * 3 : BASE.weapon * 3);
      const idx = m.geometry.index!;
      const si = m.geometry.getAttribute('skinIndex');
      const sw = m.geometry.getAttribute('skinWeight');
      const bones = m.skeleton.bones;
      for (let i = base; i < idx.count; i++) {
        const v = idx.getX(i);
        expect(sw.getX(v)).toBe(1);
        expect(names.has(bones[si.getX(v)].name)).toBe(true);
      }
    }
  });

  it('host first, bit for bit: a kitted role mesh begins with exactly the shipped vertices and indices', async () => {
    const bare = (await build()).meshes;
    const kitted = (await build({ armour: 3, sensors: 3, firepower: 3 })).meshes;
    for (const role of ['uniform', 'weapon'] as const) {
      const a = bare[role].geometry;
      const b = kitted[role].geometry;
      for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
        const x = a.getAttribute(name);
        const y = b.getAttribute(name);
        for (let v = 0; v < x.count; v++) for (let k = 0; k < x.itemSize; k++) if (x.getComponent(v, k) !== y.getComponent(v, k)) throw new Error(`${role}.${name}[${v}][${k}] moved`);
      }
      for (let i = 0; i < a.index!.count; i++) if (a.index!.getX(i) !== b.index!.getX(i)) throw new Error(`${role} index ${i} moved`);
    }
  });

  it('the kit mesh nodes are gone from the scene, whatever was bought', async () => {
    for (const tiers of [undefined, { armour: 3, sensors: 3, firepower: 3 }]) {
      const { t } = await build(tiers);
      let kit = 0;
      t.root.traverse((o) => {
        if (o.name.startsWith('kit_')) kit++;
      });
      expect(kit).toBe(0);
    }
  });
});
