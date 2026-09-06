/**
 * The named exemption from the palette repaint, and the material a building
 * that takes it draws through.
 *
 * ## Why this exists at all
 *
 * Every other mesh in this backend is coloured by `toonRampMaterial`: a
 * `N·L` term quantized into bands, indexing a ramp slice out of
 * `data/palette.json`. That guarantee -- an off-palette pixel is
 * unrepresentable -- is the whole reason `palette-material.ts` exists, and
 * `rampForBuildingRole` is how a building's eight roles pick their slices.
 *
 * The project lead has overridden it for supplied, photo-textured Meshy
 * buildings, in as many words:
 *
 *     "i have provided a very detailed blender files and i want them to be
 *      used as is unless ill provide other instruction."
 *
 * What that buys, and what the palette path could not: the cracks in the
 * render, the weathering stains, the mortar lines between masonry courses,
 * the window shutters and the door. Measured on the comparable
 * `concrete.glb`, the `glass` role -- the only thing standing in for a
 * window on the palette path -- is 1.3% of visible pixels. On the textured
 * house the windows and door are part of the photograph.
 *
 * ## The exemption is a LIST, on purpose
 *
 * `TEXTURED_BUILDING_TYPES` below is the whole opt-out. It is a list rather
 * than "whatever the GLB happens to carry" so that a reader -- and
 * `tools/validate_mesh_assets.py`'s own `TEXTURED_MESH_EXEMPT`, which must
 * agree with it -- trips over the fact that these types are NOT palette-
 * checked. A silent capability ("textures work if you ship one") would mean
 * that a year from now nobody could say which buildings the palette gate
 * still covers.
 *
 * A type on this list is not obliged to be textured in every mesh, and this
 * is not a loophole -- it is the warehouse. Its source is a scan of an
 * open-topped building with no roof, so `export_meshy_warehouse.py`
 * SYNTHESISES a flat roof cap; that geometry has no UV layer and no honest
 * texel, and it keeps the palette. So the decision is per MESH, made from
 * the GLB's own evidence (does this mesh's material carry a map?), and the
 * list decides only whether a textured mesh is ALLOWED. A GLB outside the
 * list that ships a texture anyway is an error, not a silent upgrade.
 *
 * ## Colour space, which is where this fails silently if it fails at all
 *
 * This renderer does NOT use three.js's default colour management.
 * `applyPalettePipeline` sets `renderer.outputColorSpace =
 * LinearSRGBColorSpace` -- pass-through, no encode on the way out -- and
 * builds every palette colour with `setStyle(hex, LinearSRGBColorSpace)`, so
 * a palette hex reaches the framebuffer as its own literal bytes.
 *
 * A texture has to reach the framebuffer the same way, and by default it
 * does not. `GLTFLoader` sets `baseColorTexture.colorSpace =
 * SRGBColorSpace`, and three.js turns that into an sRGB INTERNAL FORMAT at
 * upload time (`WebGLTextures`' `getInternalFormat`), so the GPU converts
 * sRGB->linear on every sample. With no matching encode on output, the whole
 * building comes out markedly darker and flatter than the source bake --
 * wrong in the exact way that survives review, because a dim limestone wall
 * still looks like a limestone wall. `prepareTexturedMap` below forces
 * `NoColorSpace` so the texel bytes pass through untouched, which is the
 * same contract the palette already has. `textured-building.test.ts` pins
 * it, because nothing else would notice.
 *
 * ## Lighting: a shade term, not a repaint
 *
 * There is no PBR rig here -- no lights in the scene, one hard-coded
 * `uLightDir`, and the source's `metallic_roughness`/`normal` maps are
 * dropped at export because nothing could consume them
 * (`tools/buildings/textured.py`). A fully unlit building would still read
 * wrong: every unit, vehicle and other building around it is banded by
 * `N·L`, so an unlit box in the middle of them looks pasted on rather than
 * lit by the same sun.
 *
 * So the fragment colour is the texel MULTIPLIED by a quantized shade
 * factor, using the same `uLightDir` and the same band count the toon ramp
 * uses. This is emphatically not a repaint: no palette entry is read, no
 * colour is substituted, and at `uShade = 0` the output is the source bake
 * byte for byte. `TEXTURED_SHADE` is the one number that decides how much
 * facet separation the building gets, and it is a single uniform precisely
 * so the "is this still the lead's asset?" question has a one-line answer.
 */
import * as THREE from 'three';
import {
  defaultFlashUniforms,
  FLASH_UNIFORMS_GLSL,
  FLASH_SHIFT_GLSL,
} from '../palette-material';

/**
 * The building types whose GLBs may ship their own baked material instead of
 * being repainted from the palette. Every other type takes
 * `rampForBuildingRole` exactly as before.
 *
 * Must stay in step with `TEXTURED_MESH_EXEMPT` in
 * `tools/validate_mesh_assets.py` -- these types are skipped by the palette
 * and fill checks in `pnpm validate:meshes`, because a photograph of a
 * limestone wall is not a palette ramp and never will be. The silhouette IoU
 * check still runs on them.
 */
export const TEXTURED_BUILDING_TYPES: ReadonlySet<string> = new Set([
  'house',
  'apartment',
  'warehouse',
  'clinic',
]);

/**
 * How far the darkest shade band dims the source texel. 0 is fully unlit
 * (the bake, untouched); 1 would take the darkest band to black.
 *
 * 0.3 with `TEXTURED_SHADE_STEPS = 3` gives multipliers 1.00 / 0.85 / 0.70 --
 * enough that a wall facing away from `uLightDir` separates from one facing
 * it, and far short of anything that would restate the building's colour.
 */
export const TEXTURED_SHADE = 0.3;

/** Shade bands. Matches the toon ramp's own quantization in kind so a
 *  textured building's facets break at the same angles its neighbours' do. */
export const TEXTURED_SHADE_STEPS = 3;

/**
 * Makes a `base_color` map from `GLTFLoader` safe for this renderer's
 * colour pipeline, and returns it.
 *
 * `colorSpace = NoColorSpace` is the load-bearing line -- see this file's own
 * top comment, "Colour space". Everything else is ordinary hygiene:
 * mipmaps and a trilinear min filter (a building is drawn at anywhere from
 * ~40 px at zoom 0.35 to several hundred at 2.5, and an unmipmapped 2048
 * texture shimmers badly at the small end), and `flipY = false` left as
 * `GLTFLoader` sets it, since glTF's UV origin is already top-left.
 */
export function prepareTexturedMap(map: THREE.Texture): THREE.Texture {
  map.colorSpace = THREE.NoColorSpace;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

/**
 * The material a textured building mesh draws through: the source bake,
 * quantized-shade-multiplied, with the same muzzle-flash response every
 * other material in this backend has.
 *
 * `flashShiftSteps` returns a band SHIFT for the ramp materials; here the
 * same integer brightens the fragment by lifting it toward the unshaded
 * texel, so a wall next to a firing tank picks up the flash the way its
 * palette-painted neighbour does rather than staying inertly lit.
 */
export function texturedBuildingMaterial(map: THREE.Texture): THREE.ShaderMaterial {
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
        vNormal = normalize(normalMatrix * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
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
