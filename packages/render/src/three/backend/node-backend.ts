/**
 * GH-943 P0: the node `RenderBackend`. WebGPURenderer plus a `RenderPipeline`, behind its own dynamic import
 * (`import('./node-backend')` in `ThreeRenderer.init`), so `three/webgpu` and `three/tsl` never enter the main chunk or a legacy boot.
 *
 * P1 (T2) builds the node post chain (`../post-chain.node.ts`): scene pass, [fog, AO: null kit factories until T4/T7; bloom: T5], output (ACES 1.0, sRGB), SMAA. Every unported GLSL hook is
 * censused and named (`unported.ts`), and the rest of the chain (the real fog, AO, bloom, grade, vignette, the sky environment) arrives task by task through `kit`. What this proves is
 * the SEAM: one canvas, one renderer, a deterministic frame, an asserted backend kind, a native-rAF loop.
 *
 * `forceWebGL` is set EXPLICITLY on both arms and `isWebGPUBackend` is asserted after init, because WebGPURenderer otherwise
 * falls back to its own WebGL2 backend without saying so (the trial measured the wrong thing that way once).
 *
 * Never calls `setAnimationLoop`: the app's loop (and the harness) own the frame clock, so WebGPURenderer never schedules its own
 * `requestAnimationFrame`. Whether a stubbed global rAF changes anything here is the P0 hypothesis `tools/src/perf/raf-hypothesis.ts` tests.
 */
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { BackendKind } from '../../gpu';
import type { PostConfig, PostKit, RenderBackend } from './backend';
import { createNodePostChain, type NodePostChain, type OutputMaths } from '../post-chain.node';
import { createFogStageFactory } from '../fog-pass.node';
import { createNodeBloom } from '../bloom.node';
import { censusUnported, unportedWarnings, type UnportedHook } from './unported';

/** How often (frames) the scene is re-walked for new GLSL-only materials: units spawn mid-run. */
const CENSUS_EVERY_FRAMES = 60;

export interface NodeBackendOptions {
  /** The scene's clear colour (`RendererOptions.background`). */
  readonly background: string;
  /** `true`: three's own WebGL2 backend (the F arm). `false`: WebGPU (the G arm). */
  readonly forceWebGL: boolean;
  /** The adapter name the probe found, for `node-webgpu`. */
  readonly adapter: string;
  readonly warn?: (msg: string) => void;
}

interface BackendLike {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  device?: { queue: { onSubmittedWorkDone(): Promise<void> }; destroy?: () => void };
}

export async function createNodeBackend(opts: NodeBackendOptions): Promise<{ backend: RenderBackend } | { reason: string }> {
  const warn = opts.warn ?? ((m: string): void => console.warn(m));
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  // SMAA is a TSL node (`three/addons/tsl/display`), not a `three/addons/postprocessing` pass: loaded here, in the lazy chunk.
  const { smaa } = await import('three/addons/tsl/display/SMAANode.js');
  // BloomNode is a TSL node (`three/addons/tsl/display`), like SMAA: loaded here, in the lazy chunk.
  const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
  const renderer: WebGPURenderer = new W.WebGPURenderer({ antialias: false, alpha: false, forceWebGL: opts.forceWebGL });
  try {
    await renderer.init();
  } catch (e) {
    renderer.dispose();
    return { reason: `WebGPURenderer.init() failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const be = (renderer as unknown as { backend: BackendLike }).backend;
  const isGpu = be.isWebGPUBackend === true;
  // Asserted, never trusted: asked for WebGPU and got WebGL2 (or the reverse) is a different renderer from the one being measured.
  if (isGpu === opts.forceWebGL) {
    renderer.dispose();
    return { reason: `WebGPURenderer chose ${isGpu ? 'its WebGPU' : 'its WebGL2'} backend but forceWebGL was ${String(opts.forceWebGL)}` };
  }
  const kind: BackendKind = isGpu ? 'node-webgpu' : 'node-webgl2';
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(new THREE.Color(opts.background));
  const canvas = renderer.domElement;

  let chain: NodePostChain | null = null;
  let builtFor: PostConfig | null = null;
  let outputMaths: OutputMaths | null = null;
  /** Null factories until each task lands (T4 fog, T5 bloom, T7 AO). The chain reads them when it is built. */
  const kit: PostKit = { fog: null, ao: null, bloom: null };
  // T5: the bloom stage. Its control outlives chain rebuilds (the toggle state survives `build`).
  const nodeBloom = createNodeBloom({ bloom: bloom as never, W, renderer });
  kit.bloom = nodeBloom.factory;
  const DEFAULT_QUALITY = { ao: true, smaa: true, bloom: 'quarter' } as const;
  const seen = new Set<string>();
  const hooks = new Map<string, UnportedHook>();
  let frames = 0;

  const runCensus = (scene: THREE.Scene): void => {
    const found = censusUnported(scene);
    for (const h of found) hooks.set(`${h.kind}|${h.key}`, h);
    for (const line of unportedWarnings(found, seen)) warn(line);
  };

  const build = (config: PostConfig): void => {
    chain?.dispose();
    if (outputMaths === null) throw new Error('node backend: setOutputMaths must be called before the post chain is built');
    chain = createNodePostChain({ W, TSL, smaa: smaa as never, outputMaths }, renderer, config.scene, config.camera, config.quality, kit);
    builtFor = config;
  };

  const backend: RenderBackend = {
    kind,
    adapter: isGpu ? opts.adapter : 'webgl2',
    domElement: canvas,
    kit,
    bloom: nodeBloom.control,
    get post() {
      return chain;
    },
    setOutputMaths: (maths) => {
      outputMaths = maths;
    },
    setFog: (table, hazeLow, maths) => {
      kit.fog = createFogStageFactory(table, hazeLow, maths);
    },
    configure: (config) => build(config),
    setPixelRatio: (r) => renderer.setPixelRatio(r),
    getPixelRatio: () => renderer.getPixelRatio(),
    setSize: (w, h) => renderer.setSize(w, h),
    async prepare(scene, camera) {
      runCensus(scene);
      await renderer.compileAsync(scene, camera);
    },
    render(scene, camera) {
      if (frames % CENSUS_EVERY_FRAMES === 0) runCensus(scene);
      frames++;
      if (!chain || !builtFor || builtFor.scene !== scene || builtFor.camera !== camera) build({ scene, camera, quality: builtFor?.quality ?? DEFAULT_QUALITY });
      chain?.render();
    },
    whenSubmitted: () => (be.device ? be.device.queue.onSubmittedWorkDone() : Promise.resolve()),
    unported: () => [...hooks.values()],
    stats: () => ({ calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles }),
    dispose() {
      chain?.dispose();
      chain = null;
      // WebGPU path: renderer.dispose() then device.destroy() (design section 1). Never `loseContext()` ourselves.
      const device = be.device;
      renderer.dispose();
      if (isGpu) device?.destroy?.();
      canvas.remove();
    },
  };
  return { backend };
}
