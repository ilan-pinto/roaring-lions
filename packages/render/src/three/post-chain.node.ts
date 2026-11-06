/**
 * GH-943 WebGPU-primary P1 (T2): the NODE twin of `post-chain.ts`. A TSL graph in a `RenderPipeline` instead of an
 * `EffectComposer`; same stages, same order, same pass names.
 *
 * Legacy order, from the code (design section 3 has it wrong; see `post-chain-shared.ts`):
 *   HalfFloat RenderPass -> fog -> GTAO -> bloom -> OutputPass (ACES 1.0, sRGB, then T3's grade LUT, vignette and dither) -> SMAA.
 * Stages whose factory is `null` on the `PostKit` are absent, and so are the quality-gated ones, exactly as on the legacy side
 * (`ThreeRenderer.init` builds AO only for `quality.ao`, bloom only for `bloom: 'quarter'`, SMAA only for `quality.smaa`).
 *
 * What is pinned here (each has a test and a falsification, see the commit message):
 *  - the scene pass is HalfFloat colour with a `DepthStencilFormat` / `UnsignedInt248Type` depth texture, which three's WebGPU
 *    backend maps to `depth24plus-stencil8`. P2 decals and the P3 outline need the half-float target and the stencil;
 *  - SMAA reads a HalfFloat render-to-texture of the display-referred colour, not an 8-bit one;
 *  - the output transform is `renderOutput` with `outputColorTransform = false` on the pipeline, so the tone map and the encode
 *    happen exactly once, in the graph.
 *
 * ADDON-FREE: imports `three` and TYPES from `three/webgpu`. Nothing from `three/addons/postprocessing`, and no runtime
 * `three/webgpu` / `three/tsl` import: those arrive through `NodePostDeps`, injected by `backend/node-backend.ts`, which loads them
 * with its own dynamic imports (the bundle census checks that the node backend chunk is what pulls `three/webgpu`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import * as THREE from 'three';
import type { Node as TslNode, PassNode, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import type { PostKit, PostStage } from './backend/backend';
import type { PostChainLike, PostQuality, PostStageName } from './post-chain-shared';
import { NodeOutputGrade, type GradeMaths } from './output-grade.node';
import { NodeOutputVignette, type VignetteMaths } from './vignette-pass.node';

/** A string only this module carries: the bundle census looks for it, so it can prove no `.node.ts` reached the shared or legacy chunk. */
export const NODE_POST_MARKER = 'rl-node-post-scene';

/** The shared (legacy-and-node) output-stage maths, injected: see `GradeMaths`. Built once by `output-maths.ts`. */
export interface OutputMaths {
  readonly grade: GradeMaths;
  readonly vignette: VignetteMaths;
}

export interface NodePostDeps {
  readonly W: typeof import('three/webgpu');
  readonly TSL: typeof import('three/tsl');
  /** `smaa` from `three/addons/tsl/display/SMAANode.js` (loaded by the backend; the file is a TSL node, not a postprocessing pass). */
  readonly smaa: (node: TslNode) => TslNode;
  readonly outputMaths: OutputMaths;
}

export interface NodePostChain extends PostChainLike {
  readonly grade: NodeOutputGrade;
  readonly vignette: NodeOutputVignette;
  /** The scene pass, for the stages that read its depth (T4 fog, T7 AO) and for the tests that pin its target. */
  readonly scenePass: PassNode;
  readonly pipeline: RenderPipeline;
  /** The HalfFloat render-to-texture SMAA reads (null when the preset has no SMAA). */
  readonly smaaInput: { readonly renderTarget: THREE.RenderTarget } | null;
}

function depthStencilTexture(): THREE.DepthTexture {
  const t = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type);
  t.format = THREE.DepthStencilFormat;
  return t;
}

export function createNodePostChain(
  deps: NodePostDeps,
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: PostQuality,
  kit: PostKit
): NodePostChain {
  const { W, TSL } = deps;
  const names: PostStageName[] = [];
  const owned: Array<{ dispose(): void }> = [];

  // 1. The scene pass: HalfFloat colour, single-sampled, depth24plus-stencil8 (a DepthStencilFormat / UnsignedInt248 depth texture).
  const depthTexture = depthStencilTexture();
  const scenePass = TSL.pass(scene, camera, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: true,
    depthTexture,
    samples: 0,
  });
  scenePass.name = NODE_POST_MARKER;
  names.push('RenderPass');
  let colour: TslNode = scenePass.getTextureNode('output');

  const run = (name: PostStageName, factory: ((c: never) => PostStage) | null): void => {
    if (factory === null) return;
    const stage = (factory as (c: unknown) => PostStage)({ input: colour, scenePass, TSL, scene, camera });
    colour = stage.node;
    if (stage.dispose) owned.push({ dispose: stage.dispose.bind(stage) });
    names.push(name);
  };
  // 2-4. fog, AO, bloom: scene-referred, before the output transform.
  run('FogOfWarPass', kit.fog);
  if (quality.ao) run('GTAOPass', kit.ao);
  if (quality.bloom === 'quarter') run('QuarterBloomPass', kit.bloom);

  // 5. The output transform, once: ACES at exposure 1.0 then the sRGB encode (the pipeline's own is switched off below). Then, on the
  // display-referred colour and in the legacy fragment order (T3): grade LUT, roundTripHalf x vignette, dither. A fixed graph: both
  // handles are uniforms, so a grade or a vignette switch never rebuilds a program.
  const grade = new NodeOutputGrade(TSL, deps.outputMaths.grade);
  const vignette = new NodeOutputVignette(TSL, deps.outputMaths.vignette);
  colour = TSL.renderOutput(colour, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
  {
    const encoded = colour as unknown as { rgb: TslNode; a: TslNode };
    const rgb = grade.dither(vignette.apply(grade.lookup(encoded.rgb)));
    colour = TSL.vec4(rgb as never, encoded.a as never) as unknown as TslNode;
  }
  names.push('OutputPass');

  // 6. SMAA, last, on display-referred colour. Its input is a HalfFloat render-to-texture.
  let smaaInput: NodePostChain['smaaInput'] = null;
  if (quality.smaa) {
    const input = TSL.rtt(colour, null, null, { type: THREE.HalfFloatType });
    smaaInput = input as unknown as NodePostChain['smaaInput'];
    colour = deps.smaa(input);
    owned.push({ dispose: () => (colour as unknown as { dispose?: () => void }).dispose?.() });
    names.push('SMAAPass');
  }

  const pipeline = new W.RenderPipeline(renderer, colour);
  pipeline.outputColorTransform = false;

  return {
    scenePass,
    pipeline,
    smaaInput,
    grade,
    vignette,
    passNames: names,
    render() {
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
      grade.dispose();
      for (const o of owned) o.dispose();
      scenePass.dispose();
      depthTexture.dispose();
    },
  };
}
