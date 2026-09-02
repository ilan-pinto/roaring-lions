/**
 * How a campaign region says what state it is in, without repainting it.
 *
 * ## Why not the toon ramp, and why not CSS
 *
 * The asset is the named exemption from the palette repaint: its subject is
 * BIOME, colour at a constant normal, and `toonRampMaterial` indexes colour
 * by `N·L` (see `textured-world.ts`'s top comment). So region state has to
 * be expressed as an operation ON the bake rather than as a substitution
 * for it.
 *
 * The flat PNG board answers the same question with a CSS `filter`
 * (`theme.css`: `grayscale(0.55) saturate(0.55)` for a finished country,
 * `grayscale(0.9) brightness(0.7)` for a locked one) and its comment records
 * why it is a filter and not `opacity` -- opacity composites the region
 * against a near-black page and is indistinguishable from painting it black.
 * A canvas has no per-object CSS filter, so the same two operations are done
 * here in the fragment shader, on the same reasoning and to the same
 * intent: **drain saturation and drop brightness; never fade toward the
 * ground.**
 *
 * ## The one number that is not the flat board's
 *
 * `uShade` is new here and has no counterpart on a PNG: the board turns, and
 * a bake with no directional term turns underneath a light that is nailed to
 * the screen. `uLightDir` is a fixed WORLD vector and the vertex shader
 * emits a WORLD normal (`mat3(modelMatrix) * normal`), so the lit side of
 * the board changes as it rotates -- which is what makes the rotation read
 * as an object turning rather than as a texture sliding.
 *
 * That is deliberately NOT `texturedBuildingMaterial`'s banded shade.
 * That material quantizes into `TEXTURED_SHADE_STEPS` bands so a building's
 * facets break at the same angles its toon-ramped neighbours' do; a
 * building is flat-faced and the banding lands on real edges. This board is
 * continuous terrain, where three hard bands would draw contour terraces
 * across every hillside that are not in the source. Smooth here, banded
 * there, for the same reason in both places: match the SHAPE of the thing
 * being lit.
 */
import * as THREE from 'three';

import { prepareTexturedMap } from '../units/textured-building';
import type { CampaignRegionStatus } from './world-scene';

/**
 * `prepareTexturedMap` under this screen's own name.
 *
 * Re-exported rather than left to be found in `../units/textured-building`:
 * the colour-space line is the one thing on this asset that fails silently,
 * and naming it here means a reader of this file does not have to already
 * know that a campaign world and a Meshy house share a hazard.
 */
export { prepareTexturedMap as prepareCampaignMap };

/** Saturation multiplier and brightness multiplier for one region state. */
export interface RegionVisual {
  /** 1 keeps the bake's own colour; 0 is fully grey. */
  sat: number;
  /** 1 keeps the bake's own value. */
  bright: number;
}

/**
 * What each region state looks like.
 *
 * Ordered by how much they drain, and that ordering is the contract
 * `world-material.test.ts` pins: a player has to be able to tell locked from
 * finished from live at a glance, on a board they may be seeing edge-on.
 *
 * `live` is the bake untouched -- a front you can act on is the only thing
 * on this board shown as the artist made it, so it wins the eye without
 * anything being added to it.
 */
export const REGION_VISUALS: Readonly<Record<CampaignRegionStatus, RegionVisual>> = {
  live: { sat: 1.0, bright: 1.0 },
  // Unlocked, nothing authored. Not spent and not barred: quiet, and only
  // just. `theme.css` makes the same distinction by giving an `empty`
  // country no live outline rather than by greying it.
  empty: { sat: 0.8, bright: 0.92 },
  // Finished. `theme.css`'s `grayscale(0.55) saturate(0.55)` composes to
  // roughly a quarter of the original chroma; 0.45 here is the same read on
  // a photographic bake, which starts more saturated than a flat map fill.
  complete: { sat: 0.45, bright: 0.88 },
  // Barred. Drains harder than `complete` on BOTH axes, because the two
  // states are otherwise easy to confuse and only one of them is a dead end.
  locked: { sat: 0.1, bright: 0.58 },
};

/**
 * Scenery -- the snow wall, the eastern plateau, and the diorama's whole
 * underside and rim.
 *
 * Drained a little, and NEVER given a region's state. The distinction is the
 * whole point: `outland_scenery` carries the board's base and rim, so tinting
 * it as a front would light up the bottom of the world. But leaving it at the
 * bake was measured wrong on screen too -- photographed at 1440x900, the
 * eastern desert plateau came out the brightest, most saturated thing on the
 * board, louder than the one region a fresh campaign can actually play. The
 * eye went to ground with no town, no card and nothing to click.
 *
 * So: one step below `empty`, which is the quietest thing that is still a
 * region, and well above `locked`, which must stay the darkest. Context,
 * not a front, and not a dead end either.
 */
export const SCENERY_VISUAL: RegionVisual = { sat: 0.72, bright: 0.86 };

/** What hovering a region you can actually open does. A multiplier ON the
 *  state's own brightness, so a hovered live region lifts and a hovered
 *  locked one — which is not a control and never gets this — could not. */
export const HOVER_BRIGHT = 1.16;

/**
 * How far the world sun dims a face turned fully away from it.
 *
 * Small, because the bake already carries the diorama's own lighting: this
 * is the term that makes rotation legible, not the term that lights the
 * scene. At 0 the board is a flat picture that spins; at 1 the far side goes
 * black and the bake stops being visible at all.
 */
export const WORLD_SHADE = 0.34;

/** The sun, in world space. `toonRampMaterial`'s own long-standing constant,
 *  so the board is lit from where the battlefield is lit from. */
export const WORLD_LIGHT_DIR = new THREE.Vector3(0.5, 1, 0.3).normalize();

/**
 * The material one campaign mesh draws through.
 *
 * One per MESH, sharing the single `base_color` the GLB ships -- the tint is
 * a uniform, so a shared material would mean locking one region locked every
 * region.
 *
 * `map` goes through `prepareTexturedMap` for `NoColorSpace`: `GLTFLoader`
 * stamps `SRGBColorSpace` on a baseColorTexture and this renderer's output
 * is pass-through (`applyPalettePipeline`), so an sRGB internal format
 * decodes on every sample with nothing to re-encode it. Measured elsewhere
 * in this tree, getting it wrong drops a lit wall from rgb 67 to 51 and
 * still looks like a building.
 */
export function campaignWorldMaterial(map: THREE.Texture, visual: RegionVisual): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: prepareTexturedMap(map) },
      uLightDir: { value: WORLD_LIGHT_DIR.clone() },
      uShade: { value: WORLD_SHADE },
      uSat: { value: visual.sat },
      uBright: { value: visual.bright },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        // WORLD normal, not the usual view-space one: the light is fixed in
        // the world and the board turns under it.
        vWorldNormal = mat3(modelMatrix) * normal;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uLightDir;
      uniform float uShade;
      uniform float uSat;
      uniform float uBright;
      varying vec2 vUv;
      varying vec3 vWorldNormal;

      void main() {
        vec3 texel = texture2D(uMap, vUv).rgb;
        float nl = max(dot(normalize(vWorldNormal), normalize(uLightDir)), 0.0);
        vec3 lit = texel * (1.0 - uShade * (1.0 - nl));
        // Rec. 709 luma, so draining chroma leaves the terrain's own value
        // structure standing -- a locked region still reads as mountains and
        // valleys rather than as one grey shape.
        float grey = dot(lit, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(mix(vec3(grey), lit, uSat) * uBright, 1.0);
      }
    `,
  });
}
