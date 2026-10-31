/**
 * The rain lift on KDF figures (GH-871 P4 S-L2 ruling 3), as the template
 * builders apply it: `emissive = overcast.1 x 0.4` on a KDF figure's role
 * materials under the wet table, and NOTHING anywhere else.
 *
 * The pure half (the clone, its cache key, the debug toggle) is in
 * `unit-surface.test.ts`; the calibration is `tools/src/wet-unit-lift.test.ts`.
 * This file pins which template builds the lift reaches, with literals:
 * overcast.1 is `#9FA9B5`, linear (0.34670, 0.39676, 0.46207), times 0.4 is
 * (0.13868, 0.15870, 0.18483). The oracle is NOT read from the palette or the
 * table.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildMeshUnitTemplate } from './mesh-unit';
import { buildVehicleMeshTemplate } from './mesh-vehicle';
import { SURFACE_PARAMS, WET_SURFACE_PARAMS, surfaceTableFor } from './unit-surface';

const LIFT = [0.13868, 0.1587, 0.18483] as const;

/** A `GLTFLoader`-shaped result, one mesh per part (the `textured-infantry.test.ts` shape). */
function sceneOf(parts: { role: string; map?: THREE.Texture; name?: string }[]): {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
} {
  const scene = new THREE.Group();
  for (const part of parts) {
    const material = new THREE.MeshStandardMaterial({ color: 0x336699 });
    if (part.map) material.map = part.map;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = part.name ?? part.role;
    mesh.userData = { rl_role: part.role };
    scene.add(mesh);
  }
  return { scene, animations: [] };
}

const emissiveOf = (m: THREE.Material): number[] => (m as THREE.MeshStandardMaterial).emissive.toArray();
const expectLift = (m: THREE.Material): void => {
  const e = emissiveOf(m);
  for (let i = 0; i < 3; i++) expect(e[i]).toBeCloseTo(LIFT[i], 4);
};
const expectDark = (m: THREE.Material): void => expect(emissiveOf(m)).toEqual([0, 0, 0]);
const PARTS = [{ role: 'uniform' }, { role: 'boot' }, { role: 'weapon' }, { role: 'webbing' }];

describe('which template builds carry the rain lift', () => {
  it('a KDF figure on the wet table: every classified role material takes the sky lift (ramp roles)', () => {
    const t = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'x.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
    expect(t.materials).toHaveLength(4);
    for (const m of t.materials) expectLift(m);
  });

  it('a KDF figure with a baked texture (the Meshy camouflage path) takes it too, and the loader`s own material stays dark', () => {
    const map = new THREE.Texture();
    const gltf = sceneOf([{ role: 'uniform', map }, { role: 'boot', map }, { role: 'weapon' }]);
    const loadedMaterials: THREE.Material[] = [];
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshStandardMaterial).map) loadedMaterials.push(m.material as THREE.Material);
    });
    expect(loadedMaterials).toHaveLength(2);
    const t = buildMeshUnitTemplate(gltf, 'kdf', 'inf_squad.glb', true, undefined, undefined, WET_SURFACE_PARAMS);
    // Two loader bases, their two role clones, and the weapon's ramp material.
    expect(t.materials).toHaveLength(5);
    const lifted = t.materials.filter((m) => !loadedMaterials.includes(m));
    expect(lifted).toHaveLength(3);
    for (const m of lifted) expectLift(m);
    expect(lifted.filter((m) => (m as THREE.MeshStandardMaterial).map === map)).toHaveLength(2);
    for (const m of loadedMaterials) expectDark(m);
  });

  it('an enemy and a civilian figure on the wet table are NOT lifted (the ruling is KDF infantry)', () => {
    for (const faction of ['enemy', 'civilian'] as const) {
      const t = buildMeshUnitTemplate(sceneOf(PARTS), faction, 'x.glb', false, undefined, undefined, WET_SURFACE_PARAMS);
      for (const m of t.materials) expectDark(m);
      // ...but they DO take the wet roughness: the table reached them.
      expect((t.materials[0] as THREE.MeshStandardMaterial).roughness).toBe(0.8);
    }
  });

  it('a KDF figure on the shipped table, or the default, or surfaceTableFor(clear), is built exactly as today', () => {
    for (const table of [undefined, SURFACE_PARAMS, surfaceTableFor('clear'), surfaceTableFor(undefined)]) {
      const t = buildMeshUnitTemplate(sceneOf(PARTS), 'kdf', 'x.glb', false, undefined, undefined, table);
      for (const m of t.materials) {
        const std = m as THREE.MeshStandardMaterial;
        expectDark(std);
        expect(std.emissiveIntensity).toBe(1);
        expect(std.emissiveMap).toBeNull();
        expect(std.userData).toEqual({});
      }
      const byRole = new Map(t.materials.map((m, i) => [PARTS[i].role, m as THREE.MeshStandardMaterial]));
      // today's literals: cloth 0.92, leather 0.7, gunmetal 0.42 / 0.45, gear 0.8
      expect(byRole.get('uniform')!.roughness).toBe(0.92);
      expect(byRole.get('boot')!.roughness).toBe(0.7);
      expect(byRole.get('weapon')!.roughness).toBe(0.42);
      expect(byRole.get('weapon')!.metalness).toBe(0.45);
      expect(byRole.get('webbing')!.roughness).toBe(0.8);
    }
  });

  it('a vehicle on the wet table is NOT lifted (it takes the wet roughness only)', () => {
    const gltf = sceneOf([
      { role: 'hull', name: 'hull_hull' },
      { role: 'metal', name: 'turret_metal' },
    ]);
    const t = buildVehicleMeshTemplate(gltf, 'mbt_lavi', false, undefined, WET_SURFACE_PARAMS);
    expect(t.materials.length).toBeGreaterThan(0);
    for (const m of t.materials) expectDark(m);
    expect(
      t.materials.some((m) => (m as THREE.MeshStandardMaterial).roughness === 0.52),
      'the wet armour roughness reached the hull'
    ).toBe(true);
  });
});
