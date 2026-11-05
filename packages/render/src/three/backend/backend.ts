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
import type { UnportedHook } from './unported';

export interface RenderBackend {
  /** `node-webgpu` or `node-webgl2`, ASSERTED after init (the renderer's own fallback is never trusted). */
  readonly kind: Exclude<BackendKind, 'legacy-gl'>;
  readonly adapter: string;
  readonly domElement: HTMLCanvasElement;
  setPixelRatio(ratio: number): void;
  getPixelRatio(): number;
  setSize(cssWidth: number, cssHeight: number): void;
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
