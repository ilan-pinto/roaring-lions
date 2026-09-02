import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  decorFamilyOf,
  isTexturedDecorKey,
  TEXTURED_DECOR_FAMILIES,
  texturedDecorMaterial,
} from './textured-decor';

describe('the textured-decor opt-out is a named list', () => {
  it('covers exactly the ditch', () => {
    // If this grows, the growth should be a decision someone made, not
    // something that arrived with an asset.
    expect([...TEXTURED_DECOR_FAMILIES].sort()).toEqual(['ditch']);
  });

  // Drift between the two sides is the failure this exists to stop: listed
  // here but not there and the gate rejects a GLB the runtime requires;
  // listed there but not here and the runtime throws on a GLB the gate waved
  // straight past.
  it('agrees with TEXTURED_DECOR_EXEMPT in tools/validate_mesh_assets.py', () => {
    const py = readFileSync(
      fileURLToPath(new URL('../../../../../tools/validate_mesh_assets.py', import.meta.url)),
      'utf8'
    );
    const block = /TEXTURED_DECOR_EXEMPT\s*=\s*\{([^}]*)\}/.exec(py);
    expect(block, 'TEXTURED_DECOR_EXEMPT not found in tools/validate_mesh_assets.py').not.toBeNull();
    const ids = [...(block as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(ids).toEqual([...TEXTURED_DECOR_FAMILIES].sort());
  });

  it('keys on the family, so every variant of a listed family is covered', () => {
    expect(decorFamilyOf('ditch_0')).toBe('ditch');
    expect(decorFamilyOf('boulder_2')).toBe('boulder');
    expect(isTexturedDecorKey('ditch_0')).toBe(true);
    expect(isTexturedDecorKey('ditch_7')).toBe(true);
    expect(isTexturedDecorKey('boulder_0')).toBe(false);
    expect(isTexturedDecorKey('rock_1')).toBe(false);
  });
});

describe('texturedDecorMaterial', () => {
  it('samples the bake with NoColorSpace', () => {
    // The silent failure. GLTFLoader stamps SRGBColorSpace on a baseColor
    // texture, three turns that into an sRGB internal format at upload, and
    // this renderer's output is pass-through with no matching encode -- so
    // the whole ditch comes out darker than the source bake and still looks
    // exactly like a ditch. Nothing but this notices.
    const map = new THREE.Texture();
    map.colorSpace = THREE.SRGBColorSpace;
    const mat = texturedDecorMaterial(map);
    expect((mat.uniforms.uMap.value as THREE.Texture).colorSpace).toBe(THREE.NoColorSpace);
  });

  it('draws through the bake rather than a palette ramp', () => {
    const mat = texturedDecorMaterial(new THREE.Texture());
    expect(mat.uniforms.uMap).toBeDefined();
    expect(mat.uniforms.uRamp).toBeUndefined();
  });

  it('applies instanceMatrix in the vertex shader', () => {
    // The bug this test exists for, found by driving the UI and invisible to
    // every other test in this file: decor draws through an InstancedMesh,
    // three.js sets USE_INSTANCING and declares `attribute mat4
    // instanceMatrix`, but it does NOT rewrite a hand-written ShaderMaterial
    // to use them. Delegating to `texturedBuildingMaterial` (written for a
    // plain Mesh, which needs none of this) drew all 44 segments of a 44-tile
    // ditch stacked at the map's north-west corner while the CPU-side
    // instance matrices -- the only thing decor-textured-mesh.test.ts can
    // read back -- stayed perfectly correct.
    const vs = texturedDecorMaterial(new THREE.Texture()).vertexShader;
    expect(vs).toMatch(/USE_INSTANCING/);
    expect(vs).toMatch(/instanceMatrix \* rlPos/);
    // The normal is transformed too, not just the position: the shade band is
    // computed from it, so an instance rotated a quarter turn would otherwise
    // be lit as though it still ran east-west.
    expect(vs).toMatch(/rlInst \* rlNormal/);
  });
});
