/**
 * GH-943 L5, option (b): the WebGPU trial. A SPIKE: never merged, never shipped, never the default.
 *
 * What it is: after `ThreeRenderer.init` has built the whole WebGL scene exactly as always, this module
 * adds a second canvas carrying a `WebGPURenderer`, and from then on `ThreeRenderer.frame` hands its own
 * SCENE and CAMERA to `render()` here instead of to the composer. So both arms draw the same scene graph
 * from the same sim state; the only thing that differs is the renderer behind it. Nothing here reads or
 * writes the sim, and nothing outside `?sandbox=` and `&gpu=webgpu` reaches it.
 *
 * What it ports (the sheet's list): stock `MeshStandardMaterial`s (three converts them to node materials
 * itself), skinned figures, `InstancedMesh`, `BatchedMesh` decor (its `onBeforeRender` cull is JS and runs
 * unchanged), the sun's shadow map, and a node post chain: GTAO, bloom, tone map + sRGB, SMAA.
 *
 * What it does NOT port, and says so (`censusUnported`, one `console.warn` per hook, see
 * `webgpu-trial-gate.ts`): every `onBeforeCompile` splice and every `ShaderMaterial`. Fog of war, decals,
 * VFX, rain, the L1 sky environment, the vignette and the L2 grade are out of the trial by the sheet's own
 * scope. The post chain also has no equivalent of `WorldGTAOPass`'s occluder filter (only opaque,
 * depth-writing, non-`rlAoExempt` objects): the node GTAO reads the pass depth of EVERYTHING, so its AO
 * work is not like for like with the WebGL arm and the results table says so.
 *
 * Fallback: `createWebGpuTrial` returns `null` with a reason when there is no `navigator.gpu`, no adapter,
 * or when WebGPURenderer ended up on its own WebGL2 backend. The caller then keeps the unchanged WebGL2
 * path.
 */
import * as THREE from 'three';
import type { WebGPURenderer, RenderPipeline } from 'three/webgpu';
import { AO_RADIUS_TILES, AO_RESOLUTION_SCALE, AO_SCALE } from '../post-chain';
import { BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD } from '../bloom';
import { setImageReleaseEnabled } from '../units/gltf-loader';
import { censusUnported, probeWebGpu, unportedWarnings, type GpuNavigatorLike, type UnportedHook } from './webgpu-trial-gate';

/** How often (frames) the scene is re-walked for new GLSL-only materials: units spawn mid-run. */
const CENSUS_EVERY_FRAMES = 60;

export interface WebGpuTrialOptions {
  readonly background: string;
  /** Post chain on (GTAO + bloom + output + SMAA), or the bare scene pass with the output transform only. */
  readonly post?: boolean;
  /** Test seam: the navigator to probe. The page's own by default. */
  readonly navigator?: GpuNavigatorLike;
  readonly warn?: (msg: string) => void;
}

export interface WebGpuTrial {
  readonly canvas: HTMLCanvasElement;
  /** Adapter description from `GPUAdapter.info`, for the capture conditions. */
  readonly adapter: string;
  /** Every hook the trial could not port, cumulative. */
  unported(): readonly UnportedHook[];
  /** Re-walks the scene now (units spawned since the last census). */
  recensus(scene: THREE.Scene): void;
  /** Turns the node post chain on or off (off: scene pass + tone map + sRGB only). */
  setPost(on: boolean): void;
  isPost(): boolean;
  /** Draws one frame. `cssWidth`/`cssHeight`/`pixelRatio` follow the WebGL renderer's. */
  render(scene: THREE.Scene, camera: THREE.Camera, cssWidth: number, cssHeight: number, pixelRatio: number): void;
  /** Resolves when the GPU has finished every submitted command: the WebGPU analogue of a 1x1 readPixels. */
  syncGpu(): Promise<void>;
  /** Draw calls and triangles of the last frame, from the renderer's own counters. */
  info(): { calls: number; triangles: number };
  dispose(): void;
}

interface DeviceLike {
  queue: { onSubmittedWorkDone(): Promise<void> };
}
interface BackendLike {
  isWebGPUBackend?: boolean;
  device?: DeviceLike;
}

export async function createWebGpuTrial(opts: WebGpuTrialOptions): Promise<{ trial: WebGpuTrial } | { reason: string }> {
  const warn = opts.warn ?? ((m: string): void => console.warn(m));
  const probe = await probeWebGpu(opts.navigator ?? (globalThis.navigator as unknown as GpuNavigatorLike | undefined));
  if (!probe.ok) return { reason: probe.reason };

  // The loader's bitmap release is WebGL-only (WebGPU uploads twice): off for the trial, said loudly.
  setImageReleaseEnabled(false);
  warn('[webgpu-trial] UNPORTED image-release "gltf-loader releaseImageAfterUpload": the load-time bitmap release is WebGL-only (WebGPU uploads a texture twice): DISABLED for the trial');
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const { ao } = await import('three/addons/tsl/display/GTAONode.js');
  const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
  const { smaa } = await import('three/addons/tsl/display/SMAANode.js');

  const renderer: WebGPURenderer = new W.WebGPURenderer({ antialias: false, alpha: false, forceWebGL: false });
  try {
    await renderer.init();
  } catch (e) {
    renderer.dispose();
    return { reason: `WebGPURenderer.init() failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const backend = (renderer as unknown as { backend: BackendLike }).backend;
  if (backend.isWebGPUBackend !== true || !backend.device) {
    // WebGPURenderer silently falls back to its own WebGL2 backend. That is not the thing being trialled.
    renderer.dispose();
    return { reason: 'WebGPURenderer chose its WebGL2 fallback backend, not WebGPU' };
  }
  const device = backend.device;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(new THREE.Color(opts.background));
  const canvas = renderer.domElement;

  let post = opts.post !== false;
  let pipeline: RenderPipeline | null = null;
  let builtFor: { scene: THREE.Scene; camera: THREE.Camera; post: boolean } | null = null;
  const seen = new Set<string>();
  const hooks = new Map<string, UnportedHook>();
  let frames = 0;
  let builds = 0;
  let size = { w: 0, h: 0, pr: 0 };

  const runCensus = (scene: THREE.Scene): void => {
    const found = censusUnported(scene);
    for (const h of found) hooks.set(`${h.kind}|${h.key}`, h);
    for (const line of unportedWarnings(found, seen)) warn(line);
  };

  const build = (scene: THREE.Scene, camera: THREE.Camera): void => {
    pipeline?.dispose();
    console.info(`[webgpu-trial] pipeline build #${++builds} (post ${post})`);
    const { pass, mrt, output, normalView, renderOutput } = TSL;
    const scenePass = pass(scene, camera);
    let node;
    if (post) {
      scenePass.setMRT(mrt({ output, normal: normalView }));
      const color = scenePass.getTextureNode('output');
      const depth = scenePass.getTextureNode('depth');
      const normal = scenePass.getTextureNode('normal');
      const aoNode = ao(depth, normal, camera);
      aoNode.radius.value = AO_RADIUS_TILES;
      aoNode.scale.value = AO_SCALE;
      aoNode.distanceExponent.value = 1;
      aoNode.thickness.value = 1;
      aoNode.distanceFallOff.value = 1;
      aoNode.resolutionScale = AO_RESOLUTION_SCALE;
      const lit = color.mul(aoNode.getTextureNode());
      const glow = bloom(lit, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
      const display = renderOutput(lit.add(glow), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
      node = smaa(display);
    } else {
      node = renderOutput(scenePass.getTextureNode('output'), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
    }
    pipeline = new W.RenderPipeline(renderer, node);
    pipeline.outputColorTransform = false;
    builtFor = { scene, camera, post };
  };

  const trial: WebGpuTrial = {
    canvas,
    adapter: probe.adapter + (probe.fallbackAdapter ? ' (fallback adapter)' : ''),
    unported: () => [...hooks.values()],
    setPost(on) {
      post = on;
    },
    isPost: () => post,
    recensus: runCensus,
    render(scene, camera, cssWidth, cssHeight, pixelRatio) {
      if (size.w !== cssWidth || size.h !== cssHeight || size.pr !== pixelRatio) {
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(cssWidth, cssHeight);
        size = { w: cssWidth, h: cssHeight, pr: pixelRatio };
      }
      if (frames % CENSUS_EVERY_FRAMES === 0) runCensus(scene);
      frames++;
      if (!pipeline || !builtFor || builtFor.scene !== scene || builtFor.camera !== camera || builtFor.post !== post) build(scene, camera);
      pipeline?.render();
    },
    syncGpu: () => device.queue.onSubmittedWorkDone(),
    info: () => ({ calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles }),
    dispose() {
      pipeline?.dispose();
      pipeline = null;
      renderer.dispose();
      canvas.remove();
    },
  };
  return { trial };
}
