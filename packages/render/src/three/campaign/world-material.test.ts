import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  BRIGHT_GAMMA,
  campaignUniforms,
  campaignWorldMaterial,
  HOVER_BRIGHT,
  REGION_STATE_CHUNK,
  REGION_VISUALS,
  SCENERY_VISUAL,
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
  const make = (
    visual = REGION_VISUALS.live
  ): { m: THREE.MeshStandardMaterial; map: THREE.Texture; loaded: THREE.MeshStandardMaterial } => {
    const map = new THREE.Texture();
    // What GLTFLoader builds for a baseColorTexture: a standard material,
    // metallicFactor 1 (black with no environment), the map tagged sRGB.
    map.colorSpace = THREE.SRGBColorSpace;
    const loaded = new THREE.MeshStandardMaterial({ map, metalness: 1 });
    return { m: campaignWorldMaterial(loaded, visual), map, loaded };
  };

  /** Run the material's own `onBeforeCompile` over three's real standard
   *  shader source, as `WebGLRenderer` would, and hand back the result. */
  const compiled = (m: THREE.Material): { fragmentShader: string; uniforms: Record<string, THREE.IUniform> } => {
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    return shader;
  };

  it('is a lit standard material, like every textured world object in a mission', () => {
    const { m } = make();
    expect(m.isMeshStandardMaterial).toBe(true);
    // glTF's default metallicFactor 1 renders black with no env map.
    expect(m.metalness).toBe(0);
  });

  it('keeps the bake sRGB -- the output encodes, so the sample must decode', () => {
    // The OLD pairing was pass-through output + NoColorSpace. Since S3a the
    // renderer encodes sRGB (world-view.ts), so a NoColorSpace bake would
    // draw washed out. Both halves move together or neither does.
    const { map } = make();
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('mipmaps the 4096 bake — it is drawn at every board size', () => {
    const { map } = make();
    expect(map.generateMipmaps).toBe(true);
    expect(map.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  });

  it('clones the loaded material and shares the one bake', () => {
    // readWorldScene disposes the loaded material straight after; two meshes
    // sharing it would otherwise share their region state.
    const { m, map, loaded } = make();
    expect(m).not.toBe(loaded);
    expect(m.map).toBe(map);
  });

  it('carries the state it was built with into its uniforms', () => {
    const { m } = make(REGION_VISUALS.locked);
    expect(campaignUniforms(m).uSat.value).toBe(REGION_VISUALS.locked.sat);
    expect(campaignUniforms(m).uBright.value).toBe(REGION_VISUALS.locked.bright);
  });

  it('gives each material its own state, not a shared one', () => {
    const a = make().m;
    const b = make().m;
    expect(campaignUniforms(a).uSat).not.toBe(campaignUniforms(b).uSat);
  });

  it('wires the SAME uniform objects into the compiled shader', () => {
    // world-view.ts writes state after the program exists; a copy would
    // freeze every region at the state it compiled with.
    const { m } = make();
    const s = compiled(m);
    expect(s.uniforms.uSat).toBe(campaignUniforms(m).uSat);
    expect(s.uniforms.uBright).toBe(campaignUniforms(m).uBright);
  });

  it('actually injects the state chunk after the bake is sampled', () => {
    const frag = compiled(make().m).fragmentShader;
    expect(frag).toMatch(/uniform float uSat;/);
    expect(frag).toMatch(/uniform float uBright;/);
    const at = frag.indexOf('#include <map_fragment>');
    expect(at).toBeGreaterThan(-1);
    const after = code(frag.slice(at));
    expect(after.indexOf(code(REGION_STATE_CHUNK).trim())).toBeGreaterThan(-1);
    const chunk = code(REGION_STATE_CHUNK);
    expect(chunk).toMatch(/mix\s*\(\s*vec3\s*\(\s*rlGrey\s*\)\s*,\s*diffuseColor\.rgb\s*,\s*uSat\s*\)/);
    expect(chunk).toMatch(/pow\s*\(\s*uBright\s*,\s*2\.2\s*\)/);
    expect(BRIGHT_GAMMA).toBe(2.2);
  });

  it('shares one compiled program across every region', () => {
    const a = make().m;
    const b = make(REGION_VISUALS.locked).m;
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
  });
});
