import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEXTURED_VEHICLE_TYPES } from './textured-vehicle';
import { buildVehicleMeshTemplate } from './mesh-vehicle';

/** A `GLTFLoader`-shaped result: a scene holding one mesh per part -- mirrors
 *  `textured-building.test.ts`'s own `sceneOf` exactly, for the identical
 *  reason: the point of these tests is the MATERIAL a GLB carries. */
function sceneOf(parts: { name: string; role: string; map: THREE.Texture | null }[]): {
  scene: THREE.Group;
} {
  const scene = new THREE.Group();
  for (const part of parts) {
    const material = new THREE.MeshStandardMaterial();
    if (part.map) material.map = part.map;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = part.name;
    mesh.userData = { rl_role: part.role };
    scene.add(mesh);
  }
  return { scene };
}

const texture = () => new THREE.Texture();

describe('the textured vehicle opt-out is a named list', () => {
  it('covers exactly the six supplied Meshy vehicles', () => {
    expect([...TEXTURED_VEHICLE_TYPES].sort()).toEqual([
      'heli_peten',
      'ifv_namer',
      'mbt_lavi',
      'paramotor',
      'rocket_battery',
      'technical',
    ]);
  });

  // Drift between the two sides is the failure this exists to stop, exactly
  // as `textured-building.test.ts`'s own pinning test guards its list.
  it('agrees with TEXTURED_VEHICLE_EXEMPT in tools/validate_mesh_assets.py', () => {
    const py = readFileSync(
      fileURLToPath(new URL('../../../../../tools/validate_mesh_assets.py', import.meta.url)),
      'utf8'
    );
    const block = /TEXTURED_VEHICLE_EXEMPT\s*=\s*\{([^}]*)\}/.exec(py);
    expect(block, 'TEXTURED_VEHICLE_EXEMPT not found in tools/validate_mesh_assets.py').not.toBeNull();
    const ids = [...(block as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(ids).toEqual([...TEXTURED_VEHICLE_TYPES].sort());
  });
});

describe('buildVehicleMeshTemplate, textured path', () => {
  it('draws a mapped mesh through the texture, not rampForVehicleRole', () => {
    const template = buildVehicleMeshTemplate(
      sceneOf([{ name: 'hull_hull', role: 'hull', map: texture() }]),
      'mbt_lavi',
      true
    );
    const mat = template.materials[0] as THREE.ShaderMaterial;
    expect(mat.uniforms.uMap).toBeDefined();
    expect(mat.uniforms.uRamp).toBeUndefined();
  });

  it('refuses a texture from a vehicle outside the named list', () => {
    expect(() =>
      buildVehicleMeshTemplate(
        sceneOf([{ name: 'hull_hull', role: 'hull', map: texture() }]),
        'apc_eitan',
        false
      )
    ).toThrow(/not in TEXTURED_VEHICLE_TYPES/);
  });

  it('a textured mesh needs no entry in the vehicle role table', () => {
    // `rl_role` outside `VEHICLE_MESH_ROLES` throws on the palette path, and
    // must not here: there is no ramp to look up.
    expect(() =>
      buildVehicleMeshTemplate(
        sceneOf([{ name: 'hull_shell', role: 'shell', map: texture() }]),
        'mbt_lavi',
        true
      )
    ).not.toThrow();
  });

  it('still resolves the turret_pivot node and render order alongside a texture', () => {
    const scene = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: texture() }));
    hull.name = 'hull_hull';
    hull.userData = { rl_role: 'hull' };
    scene.add(hull);
    const turret = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: texture() }));
    turret.name = 'turret_hull';
    turret.userData = { rl_role: 'hull' };
    const pivot = new THREE.Object3D();
    pivot.name = 'turret_pivot';
    pivot.add(turret);
    scene.add(pivot);

    const template = buildVehicleMeshTemplate({ scene }, 'mbt_lavi', true);
    expect(template.hasTurretPivot).toBe(true);
    expect(turret.renderOrder).toBeGreaterThan(hull.renderOrder);
  });
});
