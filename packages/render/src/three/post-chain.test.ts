/**
 * @vitest-environment jsdom
 *
 * jsdom, uniquely among this package's tests, because `SMAAPass` builds its
 * two lookup textures from `new Image()` with a base64 `src` -- a DOM global
 * the repo's default `environment: 'node'` does not have, so constructing
 * the real chain throws `ReferenceError: Image is not defined`. Stubbing the
 * pass instead would leave the one assertion that matters here -- that SMAA
 * is LAST, after the output transform -- testing a stand-in. jsdom never
 * fetches the data URI (no `resources: 'usable'`), so the cost is the
 * environment and nothing else.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPostChain, PIXEL_RATIO_CAP } from './post-chain';

/** The composer needs only these members of a renderer at construction. */
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

describe('createPostChain', () => {
  it('orders RenderPass, OutputPass, SMAAPass with a single-sampled HalfFloat target that carries depth+stencil', () => {
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 1440, 900, 1);
    expect(chain.passNames).toEqual(['RenderPass', 'OutputPass', 'SMAAPass']);
    const target = chain.composer.renderTarget1;
    expect(target.samples).toBe(0);
    expect(target.texture.type).toBe(THREE.HalfFloatType);
    expect(target.stencilBuffer).toBe(true);
    expect(target.depthTexture).not.toBeNull();
    expect(target.depthTexture?.format).toBe(THREE.DepthStencilFormat);
    expect(chain.composer.renderTarget2.depthTexture).not.toBeNull();
  });

  it('slots the fog pass after RenderPass and the AO pass after fog, OutputPass and SMAA last', () => {
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 1);
    const fog = { name: 'FogOfWarPass', render() {}, setSize() {}, dispose() {}, needsSwap: true, enabled: true, clear: false, renderToScreen: false } as unknown as import('three/addons/postprocessing/Pass.js').Pass;
    const ao = { ...fog, name: 'GTAOPass' } as unknown as import('three/addons/postprocessing/Pass.js').Pass;
    chain.setFogPass(fog);
    chain.setAoPass(ao);
    expect(chain.passNames).toEqual(['RenderPass', 'FogOfWarPass', 'GTAOPass', 'OutputPass', 'SMAAPass']);
    chain.setAoPass(null);
    expect(chain.passNames).toEqual(['RenderPass', 'FogOfWarPass', 'OutputPass', 'SMAAPass']);
  });

  it('sizes the target by css size times pixel ratio', () => {
    const chain = createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 2);
    expect(chain.composer.renderTarget1.width).toBe(1600);
    chain.setSize(400, 300, 2);
    expect(chain.composer.renderTarget1.width).toBe(800);
    expect(PIXEL_RATIO_CAP).toBe(2);
  });
});
