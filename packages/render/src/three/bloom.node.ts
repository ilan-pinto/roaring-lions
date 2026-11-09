/**
 * GH-943 WebGPU-primary P1 (T5): the NODE twin of `bloom.ts`. `BloomNode` (three's stock TSL bloom) in place of
 * `QuarterBloomPass`, with the same ruled numbers (`bloom-spec.ts`): strength 0.5, radius 0.35, threshold 1.0, smoothWidth 0.01,
 * and a quarter-resolution internal chain (`setResolutionScale(0.25)`).
 *
 * **Selective by luminance, not by object.** The high-pass is `smoothstep(1.0, 1.01, L)`, so a pixel at or under 1.0 writes exactly
 * 0 into every mip and the composite adds exactly +0. Nothing is tagged "bloom me", and `hdr-gains.ts` (which decides what exceeds
 * 1.0) is untouched: bloom still affects only effects an HDR gain pushed past 1.
 *
 * **Where it sits** (`post-chain.node.ts`'s `run('QuarterBloomPass', kit.bloom)`): after fog and AO, before `renderOutput`. The
 * stage input is the scene-referred HalfFloat colour; the stage output is `input.rgb + bloom.rgb` with the input's alpha. The
 * legacy blend is additive too.
 *
 * **The toggle has no skip.** Legacy turns the pass `enabled = false`; a node graph is compiled once, so the layer toggle and the
 * zoom fade write the strength UNIFORM (`bloomStrengthFor`), and 0 adds exactly nothing. The program is never rebuilt.
 *
 * ADDON-FREE: imports TYPES from `three/webgpu` and `bloom-spec.ts` only. The `bloom` node factory (`three/addons/tsl/display/
 * BloomNode.js`, a TSL node, not a postprocessing pass) is injected by `backend/node-backend.ts`, which loads it with its own
 * dynamic import, so this file adds no runtime `three/webgpu` or `three/addons` import to any chunk.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import * as THREE from 'three';
import type { Node as TslNode, WebGPURenderer } from 'three/webgpu';
import type { PostStage, PostStageContext, PostStageFactory } from './backend/backend';
import type {
  BLOOM_RADIUS,
  BLOOM_RESOLUTION_SCALE,
  BLOOM_SMOOTH_WIDTH,
  BLOOM_STRENGTH,
  BLOOM_THRESHOLD,
  bloomStrengthFor,
  tightHalfRgba,
  BloomControl,
} from './bloom-spec';

/**
 * `bloom-spec.ts`'s constants and helpers, INJECTED rather than imported: legacy `bloom.ts` re-exports that module, so the bundler hoists
 * it into the ThreeRenderer chunk, and a value import here would make the node-backend chunk load that chunk (and the legacy composer in
 * it); the bundle census (`pnpm --filter @lions/tools webgpu:bundle`) fails on exactly that. Built by `output-maths.ts`.
 */
export interface BloomMaths {
  readonly strength: typeof BLOOM_STRENGTH;
  readonly radius: typeof BLOOM_RADIUS;
  readonly threshold: typeof BLOOM_THRESHOLD;
  readonly resolutionScale: typeof BLOOM_RESOLUTION_SCALE;
  readonly smoothWidth: typeof BLOOM_SMOOTH_WIDTH;
  readonly strengthFor: typeof bloomStrengthFor;
  readonly tightHalfRgba: typeof tightHalfRgba;
}

/** The slice of `BloomNode` this file touches (the node is a TempNode; it is also a graph node). */
export interface BloomNodeLike {
  readonly strength: { value: number };
  readonly radius: { value: number };
  readonly threshold: { value: number };
  readonly smoothWidth: { value: number };
  setResolutionScale(scale: number): unknown;
  dispose(): void;
}
/** `bloom` from `three/addons/tsl/display/BloomNode.js`. */
export type BloomFactory = (node: TslNode, strength: number, radius: number, threshold: number) => TslNode & BloomNodeLike;

export interface NodeBloomDeps {
  readonly bloom: BloomFactory;
  /** For `readPreBloom` only (the debug read): the runtime classes and the renderer. */
  readonly W: typeof import('three/webgpu');
  readonly renderer: WebGPURenderer;
  readonly maths: BloomMaths;
}

export interface NodeBloom {
  readonly factory: PostStageFactory;
  readonly control: BloomControl;
}

export function createNodeBloom(deps: NodeBloomDeps): NodeBloom {
  let node: (TslNode & BloomNodeLike) | null = null;
  let input: TslNode | null = null;
  let enabled = true;
  let fade = 1;
  const strength = (): number => deps.maths.strengthFor(enabled, fade);
  const apply = (): void => {
    if (node) node.strength.value = strength();
  };

  const factory: PostStageFactory = (ctx: PostStageContext): PostStage => {
    const built = deps.bloom(ctx.input, deps.maths.strength, deps.maths.radius, deps.maths.threshold);
    built.smoothWidth.value = deps.maths.smoothWidth;
    built.setResolutionScale(deps.maths.resolutionScale);
    node = built;
    input = ctx.input;
    apply();
    const { TSL } = ctx;
    const colour = ctx.input as unknown as { rgb: TslNode; a: TslNode };
    const glow = built as unknown as { rgb: TslNode };
    const sum = (colour.rgb as unknown as { add(n: TslNode): TslNode }).add(glow.rgb);
    return {
      node: (TSL.vec4 as unknown as (rgb: TslNode, a: TslNode) => TslNode)(sum, colour.a),
      dispose() {
        if (node === built) {
          node = null;
          input = null;
        }
        built.dispose();
      },
    };
  };

  const control: BloomControl = {
    setEnabled(visible) {
      const changed = enabled !== visible;
      enabled = visible;
      apply();
      return changed;
    },
    setFade(w) {
      fade = w;
      apply();
    },
    get strength() {
      return strength();
    },
    get built() {
      return node !== null;
    },
    async readPreBloom() {
      const source = input;
      if (source === null) return null;
      const { W, renderer } = deps;
      const size = renderer.getDrawingBufferSize(new W.Vector2());
      const width = Math.max(1, Math.floor(size.width));
      const height = Math.max(1, Math.floor(size.height));
      // The stage's own input node, drawn by a full-screen quad into a HalfFloat target nothing else reads. Evaluating the node
      // updates the passes it depends on (scene, fog, AO), so this is the buffer the high-pass thresholds. No tone map, no encode.
      const target = new W.RenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false });
      const material = new W.NodeMaterial();
      material.fragmentNode = source;
      material.toneMapped = false;
      const quad = new W.QuadMesh(material);
      const was = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        quad.render(renderer);
        renderer.setRenderTarget(was);
        const raw = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)) as unknown as Uint16Array;
        return { data: deps.maths.tightHalfRgba(raw, width, height), width, height };
      } finally {
        renderer.setRenderTarget(was);
        quad.geometry.dispose();
        material.dispose();
        target.dispose();
      }
    },
  };
  return { factory, control };
}
