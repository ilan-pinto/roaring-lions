import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  campaignWorldMaterial,
  HOVER_BRIGHT,
  REGION_VISUALS,
  SCENERY_VISUAL,
  WORLD_SHADE,
} from './world-material';
import type { CampaignRegionStatus } from './world-scene';

const ALL: CampaignRegionStatus[] = ['live', 'complete', 'locked', 'empty'];

/** GLSL with `//` comments removed. A `toContain` that matches a COMMENT
 *  naming the thing it is looking for is a test that cannot fail, and this
 *  repository has shipped one. */
const code = (glsl: string): string => glsl.replace(/\/\/[^\n]*/g, '');

describe('region state is drained, never faded', () => {
  it('names every status, so a new one cannot draw as undefined', () => {
    expect(Object.keys(REGION_VISUALS).sort()).toEqual([...ALL].sort());
  });

  it('shows a live front as the artist made it', () => {
    expect(REGION_VISUALS.live).toEqual({ sat: 1, bright: 1 });
  });

  it('drains locked harder than complete on BOTH axes', () => {
    // The two states are otherwise easy to confuse and only one of them is a
    // dead end. One axis apart is not enough to tell them at a glance on a
    // board that may be edge-on.
    expect(REGION_VISUALS.locked.sat).toBeLessThan(REGION_VISUALS.complete.sat);
    expect(REGION_VISUALS.locked.bright).toBeLessThan(REGION_VISUALS.complete.bright);
  });

  it('orders the four states by how much they drain', () => {
    expect(REGION_VISUALS.live.sat).toBeGreaterThan(REGION_VISUALS.empty.sat);
    expect(REGION_VISUALS.empty.sat).toBeGreaterThan(REGION_VISUALS.complete.sat);
    expect(REGION_VISUALS.complete.sat).toBeGreaterThan(REGION_VISUALS.locked.sat);
  });

  it('never takes a region to black — dimming is not fading toward the page', () => {
    // `theme.css`'s own comment: the ground here is near-black, so anything
    // that composites a region toward it is indistinguishable from painting
    // it black, and the labels inside it go with it.
    for (const s of ALL) {
      expect(REGION_VISUALS[s].bright, `${s} brightness`).toBeGreaterThan(0.4);
    }
  });

  it('quiets scenery below every region but a locked one', () => {
    // Not the bake untouched, and not a region state either. Photographed at
    // 1440x900, an untouched `outland_scenery` made the eastern desert the
    // loudest thing on the board -- brighter than the one front a fresh
    // campaign can play. Below `empty` and above `locked` is where context
    // belongs: quieter than anything you can act on, louder than the thing
    // you cannot.
    expect(SCENERY_VISUAL.sat).toBeLessThan(REGION_VISUALS.empty.sat);
    expect(SCENERY_VISUAL.bright).toBeLessThan(REGION_VISUALS.empty.bright);
    expect(SCENERY_VISUAL.bright).toBeGreaterThan(REGION_VISUALS.locked.bright);
    expect(SCENERY_VISUAL.sat).toBeGreaterThan(REGION_VISUALS.locked.sat);
  });

  it('lifts a hovered region rather than dropping the others', () => {
    expect(HOVER_BRIGHT).toBeGreaterThan(1);
  });
});

describe('campaignWorldMaterial', () => {
  const make = (visual = REGION_VISUALS.live): { m: THREE.ShaderMaterial; map: THREE.Texture } => {
    const map = new THREE.Texture();
    // What GLTFLoader stamps on a baseColorTexture, which is the whole
    // hazard: this renderer's output is pass-through, so an sRGB internal
    // format decodes on every sample with nothing to re-encode it.
    map.colorSpace = THREE.SRGBColorSpace;
    return { m: campaignWorldMaterial(map, visual), map };
  };

  it('forces NoColorSpace on the bake', () => {
    const { m, map } = make();
    expect(map.colorSpace).toBe(THREE.NoColorSpace);
    expect(m.uniforms.uMap.value).toBe(map);
  });

  it('mipmaps the 4096 bake — it is drawn at every board size', () => {
    const { map } = make();
    expect(map.generateMipmaps).toBe(true);
    expect(map.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  });

  it('carries the state it was built with into its uniforms', () => {
    const { m } = make(REGION_VISUALS.locked);
    expect(m.uniforms.uSat.value).toBe(REGION_VISUALS.locked.sat);
    expect(m.uniforms.uBright.value).toBe(REGION_VISUALS.locked.bright);
  });

  it('gives each material its own light vector, not a shared one', () => {
    // A shared THREE.Vector3 across five materials is one `.set()` away from
    // relighting the whole board by accident.
    const a = make().m;
    const b = make().m;
    expect(a.uniforms.uLightDir.value).not.toBe(b.uniforms.uLightDir.value);
    expect(a.uniforms.uShade.value).toBe(WORLD_SHADE);
  });

  it('actually reads uSat and uBright in the fragment shader', () => {
    const frag = code(make().m.fragmentShader);
    expect(frag).toMatch(/mix\s*\(\s*vec3\s*\(\s*grey\s*\)\s*,\s*lit\s*,\s*uSat\s*\)/);
    expect(frag).toMatch(/\*\s*uBright/);
  });

  it('lights from a WORLD normal, so turning the board changes the lit side', () => {
    // The alternative -- `normalMatrix * normal`, which every other material
    // in this backend uses -- is view space, and nails the shading to the
    // screen. The board then reads as a texture sliding over a shape that is
    // not moving.
    const vert = code(make().m.vertexShader);
    expect(vert).toMatch(/mat3\s*\(\s*modelMatrix\s*\)\s*\*\s*normal/);
    expect(vert).not.toMatch(/normalMatrix/);
  });

  it('does not band the shade — this is terrain, not a building facet', () => {
    // `texturedBuildingMaterial` quantizes into TEXTURED_SHADE_STEPS because
    // a building's facets break on real edges. The same banding across a
    // hillside draws contour terraces that are not in the source.
    const frag = code(make().m.fragmentShader);
    expect(frag).not.toMatch(/floor\s*\(/);
    expect(frag).toMatch(/1\.0\s*-\s*uShade\s*\*\s*\(\s*1\.0\s*-\s*nl\s*\)/);
  });
});
