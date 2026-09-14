import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEXTURED_BUILDING_TYPES } from './textured-building';
import { buildBuildingMeshTemplate, disposeBuildingMeshTemplate } from './mesh-building';
import { liftTone } from '../world-materials';
import { rampForBuildingRole } from './building-mesh-role';

/** A `GLTFLoader`-shaped result: a scene holding one mesh per part, each with
 *  whatever material that part is supposed to arrive with. Hand-built rather
 *  than routed through `parseRigidFixture`, because the whole point of these
 *  tests is the MATERIAL a GLB carries and that helper ships none. */
function sceneOf(parts: { role: string; map: THREE.Texture | null }[]): { scene: THREE.Group } {
  const scene = new THREE.Group();
  for (const part of parts) {
    const material = new THREE.MeshStandardMaterial();
    if (part.map) material.map = part.map;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = part.role;
    mesh.userData = { rl_role: part.role };
    scene.add(mesh);
  }
  return { scene };
}

const texture = () => new THREE.Texture();

// `prepareTexturedMap`/`texturedBuildingMaterial` (this module's own toon-era
// ShaderMaterial) are no longer reachable from any production call site as of
// the lit-material switch (`mesh-building.ts`/`mesh-vehicle.ts` now build
// through `texturedMaterial`, `../world-materials.ts`, which keeps and
// normalises the loader's own `MeshStandardMaterial` instead). They stay in
// `textured-building.ts` until Task 7 deletes the old toon modules outright;
// this file keeps only what is still live: the named-list export below, and
// `buildBuildingMeshTemplate`'s own textured path (exercised further down
// against the CURRENT material shape).

describe('the textured opt-out is a named list', () => {
  it('covers exactly the six supplied Meshy buildings', () => {
    expect([...TEXTURED_BUILDING_TYPES].sort()).toEqual([
      'apartment',
      'clinic',
      'fence',
      'hall',
      'house',
      'warehouse',
    ]);
  });

  // Drift between the two sides is the failure this exists to stop: adding a
  // type here but not there silently un-gates a palette check; adding it
  // there but not here makes the runtime throw on a GLB the gate waved past.
  //
  // 2026-09-07: parses `TEXTURED_BUILDING_EXEMPT`, not `TEXTURED_MESH_EXEMPT`
  // -- the Python side split the one set into a building half and a vehicle
  // half (`TEXTURED_VEHICLE_EXEMPT`, pinned separately by
  // `textured-vehicle.test.ts`) once six vehicles got the same override,
  // precisely so THIS exact-match assertion never has to filter vehicle
  // names out of its own building-only list. `TEXTURED_MESH_EXEMPT` still
  // exists in that file as their union, for the one check that does not
  // care which asset class it is looking at.
  it('agrees with TEXTURED_BUILDING_EXEMPT in tools/validate_mesh_assets.py', () => {
    const py = readFileSync(
      fileURLToPath(new URL('../../../../../tools/validate_mesh_assets.py', import.meta.url)),
      'utf8'
    );
    const block = /TEXTURED_BUILDING_EXEMPT\s*=\s*\{([^}]*)\}/.exec(py);
    expect(block, 'TEXTURED_BUILDING_EXEMPT not found in tools/validate_mesh_assets.py').not.toBeNull();
    const ids = [...(block as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(ids).toEqual([...TEXTURED_BUILDING_TYPES].sort());
  });
});

describe('buildBuildingMeshTemplate, textured path', () => {
  it('draws a mapped mesh through the texture, keeping the loader\'s own material, not rampForBuildingRole', () => {
    const map = texture();
    const scene = sceneOf([{ role: 'wall', map }]);
    let loaded: THREE.Material | null = null;
    scene.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) loaded = m.material as THREE.Material;
    });

    const template = buildBuildingMeshTemplate(scene, 'limestone.3', 'brick', true);
    const mat = template.materials[0] as THREE.MeshStandardMaterial;
    expect(mat.isMeshStandardMaterial).toBe(true);
    expect(mat).toBe(loaded);
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  // The warehouse. Its Meshy source is an open-topped scan, so the exporter
  // synthesises a flat roof cap with `from_pydata`; that geometry has no UV
  // layer, no honest texel, and keeps the palette. One building, two material
  // paths, decided per mesh from the GLB's own evidence.
  it('leaves an unmapped role on the palette in the same GLB', () => {
    const template = buildBuildingMeshTemplate(
      sceneOf([
        { role: 'wall', map: texture() },
        { role: 'metal', map: null },
      ]),
      'gunmetal.1',
      'flat',
      true
    );
    expect(template.materials).toHaveLength(2);
    const [wall, metal] = template.materials as THREE.MeshStandardMaterial[];
    expect(wall.map).not.toBeNull();
    expect(metal.map).toBeNull();
    expect(metal.color.getHexString().toUpperCase()).toBe(
      liftTone(rampForBuildingRole('metal', 'gunmetal.1')).slice(1).toUpperCase()
    );
  });

  it('refuses a texture from a type outside the named list', () => {
    expect(() =>
      buildBuildingMeshTemplate(sceneOf([{ role: 'wall', map: texture() }]), 'limestone.1', 'flat', false)
    ).toThrow(/not in TEXTURED_BUILDING_TYPES/);
  });

  it('a textured mesh needs no entry in the ramp role table', () => {
    // `rl_role` outside `BUILDING_MESH_ROLES` throws on the palette path, and
    // must not here: there is no ramp to look up.
    expect(() =>
      buildBuildingMeshTemplate(sceneOf([{ role: 'shell', map: texture() }]), 'limestone.1', 'flat', true)
    ).not.toThrow();
  });

  it('disposes the base_color map, which Material.dispose() does not', () => {
    const map = texture();
    let disposed = false;
    map.addEventListener('dispose', () => {
      disposed = true;
    });
    const template = buildBuildingMeshTemplate(
      sceneOf([{ role: 'wall', map }]),
      'limestone.3',
      'flat',
      true
    );
    disposeBuildingMeshTemplate(template);
    expect(disposed).toBe(true);
  });
});
