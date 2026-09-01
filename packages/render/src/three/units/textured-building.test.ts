import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TEXTURED_BUILDING_TYPES,
  TEXTURED_SHADE,
  TEXTURED_SHADE_STEPS,
  prepareTexturedMap,
  texturedBuildingMaterial,
} from './textured-building';
import { buildBuildingMeshTemplate, disposeBuildingMeshTemplate } from './mesh-building';

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

describe('prepareTexturedMap', () => {
  // The one that fails silently. GLTFLoader stamps `SRGBColorSpace` on a
  // baseColorTexture, three.js turns that into an sRGB internal format at
  // upload, and the GPU then decodes sRGB->linear on every sample -- with no
  // matching encode on output, because `applyPalettePipeline` sets
  // `outputColorSpace = LinearSRGBColorSpace` deliberately. The building
  // comes out dark and flat, and still looks like a building, which is why
  // nothing but an assertion catches it.
  it('strips the sRGB colour space GLTFLoader stamps on a base_color map', () => {
    const map = texture();
    map.colorSpace = THREE.SRGBColorSpace;
    prepareTexturedMap(map);
    expect(map.colorSpace).toBe(THREE.NoColorSpace);
  });

  it('mipmaps, because a 2048 map is drawn at ~40px at zoom 0.35', () => {
    const map = prepareTexturedMap(texture());
    expect(map.generateMipmaps).toBe(true);
    expect(map.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  });
});

describe('texturedBuildingMaterial', () => {
  it('samples the supplied map and reads no palette ramp at all', () => {
    const map = texture();
    const mat = texturedBuildingMaterial(map);
    expect(mat.uniforms.uMap.value).toBe(map);
    // The palette path's own uniform. Its ABSENCE is the assertion: this
    // material must not be able to substitute a palette colour even by
    // accident, which is the lead's whole instruction.
    expect(mat.uniforms.uRamp).toBeUndefined();
    expect(mat.fragmentShader).toContain('texture2D(uMap, vUv)');
  });

  it('leaves the brightest band as the source bake, byte for byte', () => {
    // shade = 1 - uShade * (band / (steps-1)); band 0 -> 1.0. The lit face of
    // a textured building is the photograph and nothing else.
    const brightest = 1 - TEXTURED_SHADE * (0 / (TEXTURED_SHADE_STEPS - 1));
    expect(brightest).toBe(1);
  });

  it('registers for muzzle flash like every other material in this backend', () => {
    const mat = texturedBuildingMaterial(texture());
    for (const u of ['uFlashPos', 'uFlashRadius', 'uFlashShift']) {
      expect(mat.uniforms[u]).toBeDefined();
    }
  });
});

describe('the textured opt-out is a named list', () => {
  it('covers exactly the three supplied Meshy buildings', () => {
    expect([...TEXTURED_BUILDING_TYPES].sort()).toEqual(['apartment', 'house', 'warehouse']);
  });

  // Drift between the two sides is the failure this exists to stop: adding a
  // type here but not there silently un-gates a palette check; adding it
  // there but not here makes the runtime throw on a GLB the gate waved past.
  it('agrees with TEXTURED_MESH_EXEMPT in tools/validate_mesh_assets.py', () => {
    const py = readFileSync(
      fileURLToPath(new URL('../../../../../tools/validate_mesh_assets.py', import.meta.url)),
      'utf8'
    );
    const block = /TEXTURED_MESH_EXEMPT\s*=\s*\{([^}]*)\}/.exec(py);
    expect(block, 'TEXTURED_MESH_EXEMPT not found in tools/validate_mesh_assets.py').not.toBeNull();
    const ids = [...(block as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(ids).toEqual([...TEXTURED_BUILDING_TYPES].sort());
  });
});

describe('buildBuildingMeshTemplate, textured path', () => {
  it('draws a mapped mesh through the texture, not rampForBuildingRole', () => {
    const template = buildBuildingMeshTemplate(
      sceneOf([{ role: 'wall', map: texture() }]),
      'limestone.3',
      'brick',
      true
    );
    const mat = template.materials[0] as THREE.ShaderMaterial;
    expect(mat.uniforms.uMap).toBeDefined();
    expect(mat.uniforms.uRamp).toBeUndefined();
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
    const [wall, metal] = template.materials as THREE.ShaderMaterial[];
    expect(wall.uniforms.uMap).toBeDefined();
    expect(metal.uniforms.uRamp).toBeDefined();
    expect(metal.uniforms.uMap).toBeUndefined();
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
