/**
 * GH-943 P0: the `RenderBackend` seam inside `ThreeRenderer` (design section 1).
 *
 * Two implementations draw the one scene graph:
 *  - `legacy-gl`: `WebGLRenderer` plus `EffectComposer`, today's code. It stays INLINE in `ThreeRenderer` (it is the shipping
 *    path and P0 does not touch its behaviour), and is described here only by `BackendInfo.kind === 'legacy-gl'`.
 *  - `node`: `WebGPURenderer` plus a `RenderPipeline`, in `./node-backend.ts`, loaded by its OWN dynamic import so a legacy boot
 *    never downloads `three/webgpu` and a node boot never downloads the composer's passes. On `node-webgpu` it uses the WebGPU
 *    backend; on `node-webgl2` (`forceWebGL: true`) three's own WebGL2 backend.
 *
 * Never two renderers over one scene graph (d75c79faa: `light.shadow.map` is shared). A node boot therefore never constructs
 * the `WebGLRenderer` at all; `ThreeRenderer` builds it lazily and only for the legacy path.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type { BackendKind } from '../../gpu';
import type { Node as TslNode, PassNode } from 'three/webgpu';
import type { PostChainLike, PostQuality } from '../post-chain-shared';
import type { UnportedHook } from './unported';
import type { FogUniformTable } from '../fog-spec';

/**
 * GH-943 P1 (T2): what a post-chain stage factory is handed, and what it gives back. A stage reads `input` (the previous
 * stage's colour, SCENE-REFERRED linear HalfFloat for fog, AO and bloom) and returns the node that replaces it. `scenePass` is the
 * chain's own scene pass, for the stages that need its depth or a second output (fog and AO read depth).
 *
 * The factories live on a `PostKit` so `ThreeRenderer` builds every stage through one seam on both backends, each factory
 * `null` until its task lands (T4 fog, T5 bloom, T7 AO): a `null` factory is a stage the chain does not have, and
 * `passNames` omits it.
 */
export interface PostStageContext {
  readonly input: TslNode;
  readonly scenePass: PassNode;
  readonly TSL: typeof import('three/tsl');
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
}
export interface PostStage {
  readonly node: TslNode;
  dispose?(): void;
}
export type PostStageFactory = (ctx: PostStageContext) => PostStage;
export interface PostKit {
  fog: PostStageFactory | null;
  ao: PostStageFactory | null;
  bloom: PostStageFactory | null;
}
export interface PostConfig {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly quality: PostQuality;
}

export interface RenderBackend {
  /** `node-webgpu` or `node-webgl2`, ASSERTED after init (the renderer's own fallback is never trusted). */
  readonly kind: Exclude<BackendKind, 'legacy-gl'>;
  readonly adapter: string;
  readonly domElement: HTMLCanvasElement;
  setPixelRatio(ratio: number): void;
  getPixelRatio(): number;
  setSize(cssWidth: number, cssHeight: number): void;
  /** The stage factories the chain is built from. Read when `configure` (or the first `render`) builds the chain. */
  readonly kit: PostKit;
  /**
   * GH-943 P1 (T4): hands the backend the fog uniform table (`FogUniforms.uniforms`, the same record the legacy pass exposes) and
   * the compile-time `hazeLow`; the fog stage reads it. Call BEFORE `configure`, which builds the chain from the kit.
   */
  setFog(table: FogUniformTable, hazeLow: number): void;
  /** Builds the node post chain for this scene, camera and quality preset; `render` rebuilds it if it is called with another pair. */
  configure(config: PostConfig): void;
  /** The node post chain (null before `configure`). Same `PostChainLike` the legacy `PostChain` extends. */
  readonly post: PostChainLike | null;
  /** Compiles every program the scene needs now (`compileAsync`), so the first photographed frame is not a cold one. */
  prepare(scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
  /** Draws one frame. Synchronous, like `WebGLRenderer.render`; never installs an animation loop of its own. */
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  /** Resolves when the GPU has finished every submitted command (the `onSubmittedWorkDone` of the capture protocol). */
  whenSubmitted(): Promise<void>;
  /** Every GLSL-only hook the last census found, cumulative. */
  unported(): readonly UnportedHook[];
  /** Draw calls and triangles of the last frame, from the renderer's own counters. */
  stats(): { calls: number; triangles: number };
  dispose(): void;
}
