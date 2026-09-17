/**
 * @vitest-environment jsdom
 *
 * jsdom for the same single reason `post-chain.test.ts` needs it: `SMAAPass`
 * builds its two lookup textures from `new Image()`, which the repo's default
 * `environment: 'node'` does not have. The order assertion here is about
 * where the vignette sits relative to the REAL `OutputPass` and the REAL
 * `SMAAPass`, so stubbing either of them would leave the one thing this file
 * exists to pin testing a stand-in.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPostChain } from './post-chain';
import {
  VignettePass,
  VIGNETTE_RADIUS,
  VIGNETTE_SOFTNESS,
  VIGNETTE_STRENGTH,
} from './vignette-pass';

/** The composer needs only these members of a renderer at construction --
 *  copied from `post-chain.test.ts`'s own fake for the same reason. */
function fakeRenderer(): THREE.WebGLRenderer {
  const size = new THREE.Vector2(1440, 900);
  return {
    getSize: (v: THREE.Vector2) => v.copy(size),
    getPixelRatio: () => 1,
    setRenderTarget: () => undefined,
    getRenderTarget: () => null,
    getContext: () => ({}),
  } as unknown as THREE.WebGLRenderer;
}

/** The shader's own falloff, in JS, so the two numbers this file asserts
 *  about the picture (centre untouched, corner darkened) are read off the
 *  same expression the GPU evaluates rather than off a remembered result.
 *  `d` is 0 at the frame's centre and 1 at a corner. */
function vignetteMultiplierAt(d: number): number {
  const t = Math.min(1, Math.max(0, (d - VIGNETTE_RADIUS) / VIGNETTE_SOFTNESS));
  const v = t * t * (3 - 2 * t);
  return 1 - VIGNETTE_STRENGTH * v;
}

describe('VignettePass', () => {
  it('carries the spec uniforms and swaps buffers', () => {
    const pass = new VignettePass();
    expect(pass.uniforms.uStrength.value).toBe(0.55);
    expect(pass.uniforms.uRadius.value).toBe(0.62);
    expect(pass.uniforms.uSoftness.value).toBe(0.45);
    // The three constants have to reach the SHADER's uniform block, not
    // merely be exported at the right value -- a material built with a
    // freshly-made uniforms object would leave every assertion above green
    // while the GPU read three.js's own undefined defaults.
    expect(pass.material.uniforms.uStrength).toBe(pass.uniforms.uStrength);
    expect(pass.material.uniforms.uRadius).toBe(pass.uniforms.uRadius);
    expect(pass.material.uniforms.uSoftness).toBe(pass.uniforms.uSoftness);
    // It writes a whole frame into `writeBuffer`; without this the composer
    // hands the NEXT pass the un-vignetted buffer and the effect silently
    // does nothing.
    expect(pass.needsSwap).toBe(true);
    // A full-screen quad must not be depth-arbitrated against anything.
    expect(pass.material.depthTest).toBe(false);
    expect(pass.material.depthWrite).toBe(false);
    pass.dispose();
  });

  it('leaves the playable centre EXACTLY untouched and darkens a corner by about half', () => {
    // The task's own acceptance condition is that a mid-map sand pixel is
    // unchanged to within 2/255. It is not "small", it is zero: `smoothstep`
    // is identically 0 below `uRadius`, so every pixel inside 0.62 of the
    // half-diagonal is multiplied by exactly 1. Asserting the STRUCTURE
    // rather than a measured epsilon is what makes that a guarantee instead
    // of a reading.
    expect(vignetteMultiplierAt(0)).toBe(1);
    expect(vignetteMultiplierAt(VIGNETTE_RADIUS)).toBe(1);
    // ...and the falloff has actually started just past it, so the radius is
    // a real edge rather than a number the ramp never reaches.
    expect(vignetteMultiplierAt(VIGNETTE_RADIUS + 0.2)).toBeLessThan(0.95);
    // A corner: 1 - 0.55 * smoothstep(0.62, 1.07, 1.0) = 1 - 0.55 * 0.93494
    // = 0.48578 -- a corner pixel keeps 48.6% of its brightness.
    expect(vignetteMultiplierAt(1)).toBeCloseTo(0.48579, 5);
    // The ramp's top sits PAST the corner, so the gradient is still moving
    // where the frame runs out -- an outer band pinned at full strength
    // reads as a dark ring instead of a falloff.
    expect(VIGNETTE_RADIUS + VIGNETTE_SOFTNESS).toBeGreaterThan(1);
  });

  it('slots into the chain AFTER OutputPass and BEFORE SMAAPass', () => {
    const chain = createPostChain(
      fakeRenderer(),
      new THREE.Scene(),
      new THREE.OrthographicCamera(),
      800,
      600,
      1
    );
    const pass = new VignettePass();
    chain.setVignettePass(pass);
    // Display-referred: after the output transform, because darkening in
    // linear light before ACES rides the tone curve's shoulder instead of
    // the display ramp. And before SMAA, which edge-detects the final image.
    expect(chain.passNames).toEqual(['RenderPass', 'OutputPass', 'VignettePass', 'SMAAPass']);

    // With fog and AO in the chain too, it still sits between the output
    // transform and SMAA rather than joining the scene-referred stretch.
    const stub = {
      name: 'FogOfWarPass',
      render() {},
      setSize() {},
      dispose() {},
      needsSwap: true,
      enabled: true,
      clear: false,
      renderToScreen: false,
    } as unknown as import('three/addons/postprocessing/Pass.js').Pass;
    chain.setFogPass(stub);
    chain.setAoPass({ ...stub, name: 'GTAOPass' } as unknown as typeof stub);
    expect(chain.passNames).toEqual([
      'RenderPass',
      'FogOfWarPass',
      'GTAOPass',
      'OutputPass',
      'VignettePass',
      'SMAAPass',
    ]);

    chain.setVignettePass(null);
    expect(chain.passNames).toEqual([
      'RenderPass',
      'FogOfWarPass',
      'GTAOPass',
      'OutputPass',
      'SMAAPass',
    ]);
    pass.dispose();
    chain.dispose();
  });

  it('the chain does not dispose a pass it was merely handed', () => {
    // Same ownership contract `setFogPass`/`setAoPass` state: `dispose()`
    // frees the four passes the module built and nothing else, or
    // `setVignettePass(null); setVignettePass(same)` would be a
    // use-after-free and `ThreeRenderer.dispose()`'s own call would be a
    // double free.
    const chain = createPostChain(
      fakeRenderer(),
      new THREE.Scene(),
      new THREE.OrthographicCamera(),
      800,
      600,
      1
    );
    const pass = new VignettePass();
    let disposed = 0;
    pass.material.addEventListener('dispose', () => {
      disposed += 1;
    });
    chain.setVignettePass(pass);
    chain.dispose();
    expect(disposed).toBe(0);
    pass.dispose();
    expect(disposed).toBe(1);
  });
});
