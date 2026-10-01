/**
 * How a campaign region says what state it is in, without repainting it.
 *
 * ## The board is on the lit pipeline (S3a, GH-180)
 *
 * Until 2026-10-01 this file carried its own `ShaderMaterial`: a private
 * `uLightDir`, a 34% smooth shade, and a pass-through output with the bake
 * tagged `NoColorSpace` -- the named exemption the lit renderer spec left
 * standing (§9). That made the diorama read differently from the same
 * assets in a mission. It is now what every textured world object in the
 * battlefield is: a `MeshStandardMaterial` over an sRGB bake
 * (`world-materials.ts`'s `texturedMaterial`, imported, not copied), lit by
 * `lighting.ts`'s one sun and one hemisphere bounce, encoded to sRGB through
 * ACES by the renderer (`world-view.ts`). Both colour-space halves moved in
 * one change, on purpose: either one alone renders the board too dark or too
 * pale and it still looks like a plausible diorama.
 *
 * The sun is a scene object outside the board's pivot, so it stays fixed in
 * WORLD space while the board turns under it -- the lit side changes as it
 * rotates, which is what the old world-normal shader existed to do. The
 * standard material's view-space lighting is correct here precisely because
 * the camera never moves. And the shade is smooth: a standard material has
 * no bands, which is right for continuous terrain.
 *
 * ## Why not the palette, and why not CSS
 *
 * The asset is the named exemption from the palette repaint: its subject is
 * BIOME, colour at a constant normal, unlike a kit-built asset's ramp
 * albedo, which is chosen by ROLE (see `textured-world.ts`'s top comment).
 * So region state has to be expressed as an operation ON the bake rather
 * than as a substitution for it.
 *
 * The flat PNG board answers the same question with a CSS `filter`
 * (`theme.css`: `grayscale(0.55) saturate(0.55)` for a finished country,
 * `grayscale(0.9) brightness(0.7)` for a locked one) and its comment records
 * why it is a filter and not `opacity` -- opacity composites the region
 * against a near-black page and is indistinguishable from painting it black.
 * A canvas has no per-object CSS filter, so the same two operations are done
 * here, injected into the standard material's fragment shader right after
 * the bake is sampled: **drain saturation and drop brightness; never fade
 * toward the ground.**
 *
 * ## The numbers are display-referred; the shader is not
 *
 * `REGION_VISUALS` keeps the values it was tuned with, which were tuned on a
 * pass-through screen where a multiplier landed on the screen value
 * directly. The albedo is LINEAR now, so `uBright` is applied as
 * `pow(uBright, 2.2)`: a locked region at 0.58 still reads at about 0.58 of
 * its own value after the sRGB encode, instead of at 0.78. Desaturation is a
 * luma mix in linear light, which drains to the same grey the eye expects.
 */
import * as THREE from 'three';

import { texturedMaterial } from '../world-materials';

import type { CampaignRegionStatus } from './world-scene';

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

/** The uniforms one campaign material carries, readable before its program
 *  compiles: `world-view.ts` writes state into these and the injected shader
 *  reads the same objects. */
export interface CampaignUniforms {
  readonly uSat: THREE.IUniform<number>;
  readonly uBright: THREE.IUniform<number>;
}

/** The display-to-linear exponent `uBright` goes through. 2.2 rather than
 *  the exact sRGB curve: a multiplier is not a colour, and the piecewise
 *  toe matters only below 0.04, where no region state lives. */
export const BRIGHT_GAMMA = 2.2;

/** The chunk injected after `<map_fragment>`. Exported so the test can
 *  assert on the code that ships rather than on a copy of it. */
export const REGION_STATE_CHUNK = /* glsl */ `
  // Rec. 709 luma, so draining chroma leaves the terrain's own value
  // structure standing -- a locked region still reads as mountains and
  // valleys rather than as one grey shape.
  float rlGrey = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(vec3(rlGrey), diffuseColor.rgb, uSat) * pow(uBright, ${BRIGHT_GAMMA.toFixed(1)});
`;

/**
 * The material one campaign mesh draws through: `texturedMaterial` over the
 * GLB's own loaded material, plus the region-state chunk.
 *
 * One per MESH: the state is a uniform, and a shared material would mean
 * locking one region locked every region. The texture IS shared -- one 4096
 * bake for the whole board -- and every material reuses one compiled
 * program through `customProgramCacheKey`.
 */
export function campaignWorldMaterial(
  loaded: THREE.Material,
  visual: RegionVisual
): THREE.MeshStandardMaterial {
  // A CLONE: `readWorldScene` disposes the loaded material straight after,
  // and two meshes may share one -- which would share their state. A clone
  // shares the texture by reference, so the board still holds one bake.
  const m = texturedMaterial(loaded.clone());
  const uniforms: CampaignUniforms = {
    uSat: { value: visual.sat },
    uBright: { value: visual.bright },
  };
  m.userData.campaign = uniforms;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSat = uniforms.uSat;
    shader.uniforms.uBright = uniforms.uBright;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uSat;\nuniform float uBright;\nvoid main() {')
      .replace('#include <map_fragment>', `#include <map_fragment>\n${REGION_STATE_CHUNK}`);
  };
  m.customProgramCacheKey = () => 'rl-campaign-region';
  return m;
}

/** The state uniforms of a material `campaignWorldMaterial` built. */
export function campaignUniforms(m: THREE.Material): CampaignUniforms {
  const u = (m.userData as { campaign?: CampaignUniforms }).campaign;
  if (!u) throw new Error('campaignUniforms: not a campaign world material');
  return u;
}
