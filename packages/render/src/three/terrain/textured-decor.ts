/**
 * The named exemption that lets ONE decor family ship its own baked texture
 * instead of being repainted from the palette.
 *
 * ## Why an exemption exists at all
 *
 * Every other decor mesh draws through `toonRampMaterial`, indexing a ramp
 * slice out of `data/palette.json` by `N·L` (`decor-role.ts`). That is right
 * for a rock, a bush or a boulder: objects that sit ON the ground, whose
 * colour genuinely belongs to the palette, and whose rounded forms give the
 * normal-indexed ramp several bands to work with.
 *
 * The anti-tank ditch is not that kind of object. Its job is to REPLACE a
 * patch of ground -- the terrain is an extruded heightfield and there is no
 * way to cut a hole in it, so an asset that brings its own ground is the only
 * shape that can express a trench at all. And the ground it brings is a flat
 * apron: ONE NORMAL, therefore ONE FLAT COLOUR under a ramp indexed by
 * normal, by construction rather than by bad luck. Dropped onto terrain that
 * carries its own grain and scatter, a uniformly-coloured slab does not read
 * as ground with a ditch in it. It reads as a plaque with a ditch printed on
 * it.
 *
 * So the palette path does not merely look worse here; it cannot express the
 * asset. The project lead's standing instruction for supplied Meshy sources
 * ("used as is unless ill provide other instruction") points the same way,
 * and the same override already exists one directory over for three
 * buildings -- but the argument above is the one that decides it.
 *
 * ## The exemption is a LIST, on purpose -- the same shape as the buildings'
 *
 * `TEXTURED_DECOR_FAMILIES` below is the whole opt-out, and it must stay in
 * step with `TEXTURED_DECOR_EXEMPT` in `tools/validate_mesh_assets.py`.
 * `textured-decor.test.ts` parses the Python set and fails if the two drift.
 *
 * Two locks, deliberately, mirroring `TEXTURED_BUILDING_TYPES`:
 *
 *  1. The GLB says what it is. A textured decor mesh carries
 *     `extras.rl_textured = true` instead of an `rl_role` -- it has no
 *     palette ramp to name -- so the runtime reads the fact rather than
 *     inferring it.
 *  2. The list says who is ALLOWED to. A decor GLB outside this list that
 *     ships a texture (or sets that flag) fails `pnpm validate:meshes`
 *     rather than being silently upgraded. The gate is not weakened for
 *     everything in order to admit one asset.
 *
 * ## Why not just add a fifth decor ROLE
 *
 * Because a role IS a palette ramp -- `rampForDecorRole` maps one to the
 * other and throws on anything else. A textured mesh has no ramp, so a
 * `ditch` role would be a role that means "not a role", and every reader of
 * `DECOR_MESH_ROLES` would have to learn the exception anyway. Keying on the
 * family (which the loader already has, as the `<family>_<variant>` GLB key)
 * leaves the closed role vocabulary genuinely closed.
 *
 * ## Colour space, which is where this fails silently if it fails at all
 *
 * Identical to the buildings' problem and solved by the same call.
 * `GLTFLoader` stamps `SRGBColorSpace` on a baseColorTexture; this renderer's
 * output is pass-through (`LinearSRGBColorSpace`, no encode), so an sRGB
 * internal format means the GPU decodes on every sample with nothing to
 * re-encode it -- and the ditch comes out markedly darker than the bake while
 * still looking like a ditch. `prepareTexturedMap` forces `NoColorSpace`.
 * `textured-decor.test.ts` pins it, because nothing else would notice.
 */
import * as THREE from 'three';
import {
  defaultFlashUniforms,
  FLASH_SHIFT_GLSL,
  FLASH_UNIFORMS_GLSL,
} from '../palette-material';
import {
  prepareTexturedMap,
  TEXTURED_SHADE,
  TEXTURED_SHADE_STEPS,
} from '../units/textured-building';

/**
 * The decor families whose GLBs may ship their own baked material. Every
 * other family takes `rampForDecorRole` exactly as before.
 *
 * Must stay in step with `TEXTURED_DECOR_EXEMPT` in
 * `tools/validate_mesh_assets.py`.
 */
export const TEXTURED_DECOR_FAMILIES: ReadonlySet<string> = new Set(['ditch']);

/**
 * The `<family>` half of a `<family>_<variant>` decor GLB key.
 *
 * `ditch_0` -> `ditch`. Splits on the LAST underscore, so a future
 * two-word family name survives.
 */
export function decorFamilyOf(key: string): string {
  const cut = key.lastIndexOf('_');
  return cut === -1 ? key : key.slice(0, cut);
}

/** Whether this `<family>_<variant>` key is allowed to ship a texture. */
export function isTexturedDecorKey(key: string): boolean {
  return TEXTURED_DECOR_FAMILIES.has(decorFamilyOf(key));
}

/**
 * The material a textured decor mesh draws through.
 *
 * ## Why this is NOT `texturedBuildingMaterial`, which it otherwise would be
 *
 * It started as a one-line delegation to it, on the reasoning that nothing
 * that function does is building-specific: same `NoColorSpace` sampling, same
 * quantized `N·L` shade term, same muzzle-flash response, and one shader
 * rather than two places to get the colour space wrong. Every unit test
 * passed. **On screen, all 44 ditch segments of a 44-tile run drew stacked on
 * top of each other at the map's north-west corner**, in fog, forty tiles from
 * the ground they were supposed to be cut into. Photographed.
 *
 * The cause is that decor draws through an `InstancedMesh` and buildings do
 * not. three.js sets `#define USE_INSTANCING` and declares `attribute mat4
 * instanceMatrix` for an instanced draw, but it does NOT rewrite a
 * hand-written `ShaderMaterial` vertex shader to use them -- the shader has to
 * apply the per-instance transform itself, and `texturedBuildingMaterial`'s
 * (correctly, for a plain `Mesh`) does not. So every instance collapsed onto
 * the model origin and the CPU-side `instanceMatrix` array, which is what the
 * unit tests read back, stayed perfectly correct the whole time.
 *
 * `toonRampMaterial` in `../palette-material.ts` already carries the same
 * lesson for `USE_BATCHING`, with its own `#ifdef` and a comment explaining
 * that it reproduces three's chunks by hand. This is that pattern for
 * `USE_INSTANCING`, and the normal transform is handled the same way -- the
 * inverse-square divide is what keeps a non-uniformly scaled instance's
 * normal perpendicular to its surface, and it matters here because the shade
 * band is computed from that normal.
 *
 * What IS still shared is every part that could silently go wrong twice:
 * `prepareTexturedMap` (the colour-space line), `TEXTURED_SHADE` and
 * `TEXTURED_SHADE_STEPS` (how far the bake may be dimmed), and the flash GLSL.
 * Only the vertex transform is restated, because only the vertex transform
 * genuinely differs.
 */
export function texturedDecorMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: prepareTexturedMap(map) },
      uLightDir: { value: new THREE.Vector3(0.5, 1, 0.3).normalize() },
      uShade: { value: TEXTURED_SHADE },
      uSteps: { value: TEXTURED_SHADE_STEPS },
      ...defaultFlashUniforms(),
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec3 rlNormal = normal;
        vec4 rlPos = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          // The whole reason this shader is not shared with the building one.
          // Mirrors <defaultnormal_vertex>/<project_vertex>'s own USE_INSTANCING
          // handling, exactly as toonRampMaterial mirrors their USE_BATCHING
          // handling a directory over.
          mat3 rlInst = mat3(instanceMatrix);
          rlNormal /= vec3(
            dot(rlInst[0], rlInst[0]),
            dot(rlInst[1], rlInst[1]),
            dot(rlInst[2], rlInst[2])
          );
          rlNormal = rlInst * rlNormal;
          rlPos = instanceMatrix * rlPos;
        #endif
        vNormal = normalize(normalMatrix * rlNormal);
        vec4 world = modelMatrix * rlPos;
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uLightDir;
      uniform float uShade;
      uniform int uSteps;
      ${FLASH_UNIFORMS_GLSL}
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      ${FLASH_SHIFT_GLSL}

      void main() {
        // The source bake, untouched. Nothing below substitutes a colour --
        // the only operation applied is a scalar multiply.
        vec3 texel = texture2D(uMap, vUv).rgb;

        float nl = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
        int band = int(floor((1.0 - nl) * float(uSteps)));
        band = min(band, uSteps - 1);
        band = max(0, band - flashShiftSteps(vWorldPos));

        float shade = 1.0 - uShade * (float(band) / float(uSteps - 1));
        gl_FragColor = vec4(texel * shade, 1.0);
      }
    `,
  });
}
