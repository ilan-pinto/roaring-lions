/**
 * @vitest-environment jsdom
 *
 * jsdom for the same reason as `post-chain.test.ts`: the legacy `SMAAPass` and the node `SMAANode` both build their lookup
 * textures from `new Image()` with a base64 `src`.
 *
 * GH-943 P1 (T2) gates. Each has a one-line falsification, run by hand and listed in the commit message.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { createPostChain, POST_CHAIN_ORDER } from './post-chain';
import { createNodePostChain, NODE_POST_MARKER, type NodePostChain, type NodePostDeps } from './post-chain.node';
import type { PostKit } from './backend/backend';
import { QUALITY_PRESETS } from '../quality';
import { bloomPassFor } from './bloom';
import { OUTPUT_MATHS } from './output-maths';

async function deps(): Promise<NodePostDeps> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const { smaa } = await import('three/addons/tsl/display/SMAANode.js');
  return { W, TSL, smaa: smaa as never, outputMaths: OUTPUT_MATHS };
}

/** The composer needs only these members of a renderer at construction (as `post-chain.test.ts`). */
function fakeGlRenderer(): THREE.WebGLRenderer {
  const size = new THREE.Vector2(800, 600);
  return {
    getSize: (v: THREE.Vector2) => v.copy(size),
    getPixelRatio: () => 1,
    setRenderTarget: () => undefined,
    getRenderTarget: () => null,
    getContext: () => ({}),
  } as unknown as THREE.WebGLRenderer;
}
function stubPass(name: string): Pass {
  return { name, render() {}, setSize() {}, dispose() {}, needsSwap: true, enabled: true, clear: false, renderToScreen: false } as unknown as Pass;
}
/** A `RenderPipeline` stores its renderer and does nothing with it until `render`. */
const fakeNodeRenderer = {} as never;

/** Stand-in stage factories (identity nodes), so the ORDER of a full chain can be pinned before T4/T5/T7 land the real stages. */
const fullKit = (): PostKit => ({
  fog: (c) => ({ node: c.input }),
  ao: (c) => ({ node: c.input }),
  bloom: (c) => ({ node: c.input }),
});

const EXPECTED: Record<'high' | 'medium' | 'low', string[]> = {
  high: ['RenderPass', 'FogOfWarPass', 'GTAOPass', 'QuarterBloomPass', 'OutputPass', 'SMAAPass'],
  medium: ['RenderPass', 'FogOfWarPass', 'OutputPass', 'SMAAPass'],
  low: ['RenderPass', 'FogOfWarPass', 'OutputPass'],
};

describe('passNames per quality preset, legacy and node', () => {
  for (const preset of ['high', 'medium', 'low'] as const) {
    it(`${preset}: the legacy chain keeps its exact order, and the node chain reports the same names`, async () => {
      const quality = QUALITY_PRESETS[preset];
      // Legacy, built the way `ThreeRenderer.init` builds it. Falsify (legacy side): move `composer.addPass(outputPass)` below
      // the SMAA add in `rebuild`, or swap OutputPass and SMAAPass in POST_CHAIN_ORDER.
      const legacy = createPostChain(fakeGlRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 1, quality);
      legacy.setFogPass(stubPass('FogOfWarPass'));
      if (quality.ao) legacy.setAoPass(stubPass('GTAOPass'));
      const bloom = bloomPassFor(quality, 800, 600, 1);
      if (bloom) legacy.setBloomPass(bloom);
      expect(legacy.passNames).toEqual(EXPECTED[preset]);

      // Node. Falsify: build the SMAA block before the `OutputPass` block in `createNodePostChain` ("SMAA before output").
      const node = createNodePostChain(await deps(), fakeNodeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), quality, fullKit());
      expect(node.passNames).toEqual(EXPECTED[preset]);
      expect(node.passNames).toEqual(legacy.passNames);
      // ...and both are the shared constant, filtered by the preset: one source for the order.
      expect(node.passNames).toEqual(POST_CHAIN_ORDER.filter((n) => EXPECTED[preset].includes(n)));
      bloom?.dispose();
      legacy.dispose();
      node.dispose();
    });
  }

  it('a null factory is a stage the node chain does not have (T2 ships the kit empty): scene pass, output, SMAA', async () => {
    const empty: PostKit = { fog: null, ao: null, bloom: null };
    const node = createNodePostChain(await deps(), fakeNodeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), QUALITY_PRESETS.high, empty);
    expect(node.passNames).toEqual(['RenderPass', 'OutputPass', 'SMAAPass']);
    node.dispose();
  });
});

describe('the node scene pass and the SMAA input', () => {
  const build = async (): Promise<NodePostChain> =>
    createNodePostChain(await deps(), fakeNodeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), QUALITY_PRESETS.high, fullKit());

  it('the scene pass is HalfFloat colour with a depth24plus-stencil8 depth texture, single-sampled', async () => {
    // Falsify: `type: THREE.HalfFloatType` -> `THREE.UnsignedByteType` in the `TSL.pass` options.
    const chain = await build();
    const rt = chain.scenePass.renderTarget;
    expect(rt.texture.type).toBe(THREE.HalfFloatType);
    expect(rt.stencilBuffer).toBe(true);
    expect(rt.depthBuffer).toBe(true);
    expect(rt.samples).toBe(0);
    // three's WebGPU backend maps exactly (DepthStencilFormat, UnsignedInt248Type) to 'depth24plus-stencil8'
    // (WebGPUTextureUtils: `case UnsignedInt248Type: formatGPU = GPUTextureFormat.Depth24PlusStencil8`).
    expect(rt.depthTexture?.format).toBe(THREE.DepthStencilFormat);
    expect(rt.depthTexture?.type).toBe(THREE.UnsignedInt248Type);
    expect(chain.scenePass.name).toBe(NODE_POST_MARKER);
    chain.dispose();
  });

  it('SMAA reads a HalfFloat render-to-texture, and the pipeline does not apply the output transform a second time', async () => {
    // Falsify: drop the `{ type: THREE.HalfFloatType }` and set `type: THREE.UnsignedByteType` on the rtt, or delete
    // `pipeline.outputColorTransform = false`.
    const chain = await build();
    expect(chain.smaaInput?.renderTarget.texture.type).toBe(THREE.HalfFloatType);
    expect(chain.pipeline.outputColorTransform).toBe(false);
    chain.dispose();
  });

  it('GH-1270: resize() brings SMAA\'s targets to the drawing buffer between frames and rebuilds the output quad\'s bindings', async () => {
    // Falsify: make `resize()` an empty body (targets stay 1x1, so `SMAANode.updateBefore` would dispose them mid-frame), or delete
    // `pipeline.needsUpdate = true` (the quad keeps the bind group that holds the destroyed blend texture).
    const buffer = { width: 2000, height: 1200 };
    const renderer = { getDrawingBufferSize: (v: THREE.Vector2) => v.set(buffer.width, buffer.height) } as never;
    const chain = createNodePostChain(await deps(), renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), QUALITY_PRESETS.high, fullKit());
    const smaa = chain.pipeline.outputNode as unknown as { _renderTargetBlend: THREE.RenderTarget; _renderTargetEdges: THREE.RenderTarget };
    expect(smaa._renderTargetBlend.width).toBe(1);
    chain.pipeline.needsUpdate = false;
    chain.resize();
    for (const rt of [smaa._renderTargetBlend, smaa._renderTargetEdges]) expect([rt.width, rt.height]).toEqual([2000, 1200]);
    expect(chain.pipeline.needsUpdate).toBe(true);
    // A second resize to the SAME size must not touch the targets again (the node's own per-frame call is then a no-op).
    let disposed = 0;
    smaa._renderTargetBlend.addEventListener('dispose', () => disposed++);
    chain.resize();
    expect(disposed).toBe(0);
    buffer.width = 1280;
    chain.resize();
    expect(smaa._renderTargetBlend.width).toBe(1280);
    chain.dispose();
  });

  it('GH-1270: resize() on a preset with no SMAA does nothing and does not read the renderer', async () => {
    const chain = createNodePostChain(await deps(), fakeNodeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), QUALITY_PRESETS.low, fullKit());
    expect(() => chain.resize()).not.toThrow();
    chain.dispose();
  });

  it('a preset without SMAA builds no SMAA input at all', async () => {
    const chain = createNodePostChain(await deps(), fakeNodeRenderer, new THREE.Scene(), new THREE.PerspectiveCamera(), QUALITY_PRESETS.low, fullKit());
    expect(chain.smaaInput).toBeNull();
    chain.dispose();
  });
});
