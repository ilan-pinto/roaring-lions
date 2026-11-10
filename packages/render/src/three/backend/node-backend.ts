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
import type { AoControl, MaterialKit, MaterialMaths, PostConfig, PostKit, RenderBackend } from './backend';
import { createOrthoAwareGtao } from '../gtao-ortho.node';
import { createNodePostChain, createNodeAoStage, type NodePostChain, type OutputMaths, type AoMaths } from '../post-chain.node';
import { createFogStageFactory } from '../fog-pass.node';
import { createNodeBloom, type BloomMaths } from '../bloom.node';
import { createNodePmremHost, type NodePmremGeneratorCtor } from '../environment.node';
import { captureNodeView, photographNodeGround, type NodeCaptureDeps, type ReadbackMaths } from '../capture-view.node';
import { createNodeOverlayMaterial } from '../units/overlays.node';
import { createNodeZoneBandMaterial } from '../units/zone-band.node';
import { createNodeSupplyRouteMaterial, type SupplyRouteUniformRecord } from '../supply-route.node';
import { createNodeTrailMaterial, type TrailUniformRecord } from '../trail-mesh.node';
import { createNodeXrayMaterial, XRAY_STYLE_BY_NAME } from '../tunnel-xray.node';
import { createNodeDecalMaterial } from '../decal-pool.node';
import { createNodeRingMaterial, RING_STYLE_KEY, type RingUniformRecord } from '../units/selection-ring.node';
import { createNodeOutlineMaterial } from '../units/silhouette.node';
import type { RingStyle } from '../units/selection-ring';
import { censusUnadopted, censusUnported, unportedWarnings, type UnportedHook } from './unported';
import { createNodeGroundMaterial } from '../terrain/mesh.node';
import { createFoliageTwinFactory } from '../terrain/decor-mesh.node';
import { createNodeUnitMaterial } from '../units/unit-material.node';
import { markTwin } from '../twin-identity';
import { installPassCounter, type PassRendererLike, type RenderPassId } from './pass-counter';

/** How often (frames) the scene is re-walked for new GLSL-only materials: units spawn mid-run. */
const CENSUS_EVERY_FRAMES = 60;

export interface NodeBackendOptions {
  /** The scene's clear colour (`RendererOptions.background`). */
  readonly background: string;
  /** `true`: three's own WebGL2 backend (the F arm). `false`: WebGPU (the G arm). */
  readonly forceWebGL: boolean;
  /** The adapter name the probe found, for `node-webgpu`. */
  readonly adapter: string;
  /** The shared bloom constants and helpers, injected (see `BloomMaths`); `output-maths.ts`'s `BLOOM_MATHS`. */
  readonly bloomMaths: BloomMaths;
  /** The shared AO constants and helpers, injected (see `AoMaths`); `output-maths.ts`'s `AO_MATHS`. */
  readonly aoMaths: AoMaths;
  /** The shared readback layout and normaliser, injected (see `ReadbackMaths`); `output-maths.ts`'s `READBACK_MATHS`. */
  readonly readbackMaths: ReadbackMaths;
  /** GH-943 P2 (T1): the material twins' shared maths, injected (see `MaterialMaths`); `material-maths.ts`'s `MATERIAL_MATHS`.
   *  Read by the `materials` factories as each lands (T3, T5, T6). */
  readonly materialMaths: MaterialMaths;
  /**
   * GH-943 P3 (T1): the kit slot a LEGACY material belongs to (`legacyTwinSlot`, null for a twin or a material with no slot), handed
   * over by `ThreeRenderer` because the table reads legacy modules this chunk must not load. The census reports a material whose
   * slot HAS a factory but which is still on a mesh as `unadopted` (`[lions] UNADOPTED`): an adoption site is missing.
   */
  readonly twinSlotOf?: (m: THREE.Material) => keyof MaterialKit | null;
  /**
   * GH-943 P3 (T13, GH-1152): build the renderer with `trackTimestamp`, so `gpuTimeMs` reads the frame's GPU time from timestamp queries
   * (where the adapter offers `timestamp-query`). Default false, and false never passes `trackTimestamp` at all: the queries cost CPU
   * per pass, so only the probe page's GPU-time run turns them on (`RendererOptions.timestamps`).
   */
  readonly timestamps?: boolean;
  readonly warn?: (msg: string) => void;
}

interface BackendLike {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  device?: { queue: { onSubmittedWorkDone(): Promise<void> }; destroy?: () => void };
}

/**
 * The `WebGPURenderer` constructor's parameters (GH-943 P3 T13 G4). `trackTimestamp` appears only when `timestamps` is true: the
 * default build is the one every earlier phase measured.
 */
export function nodeRendererParameters(opts: Pick<NodeBackendOptions, 'forceWebGL' | 'timestamps'>): { antialias: false; alpha: false; forceWebGL: boolean; trackTimestamp?: true } {
  return { antialias: false, alpha: false, forceWebGL: opts.forceWebGL, ...(opts.timestamps === true ? { trackTimestamp: true as const } : {}) };
}

export async function createNodeBackend(opts: NodeBackendOptions): Promise<{ backend: RenderBackend } | { reason: string }> {
  const warn = opts.warn ?? ((m: string): void => console.warn(m));
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  // SMAA is a TSL node (`three/addons/tsl/display`), not a `three/addons/postprocessing` pass: loaded here, in the lazy chunk.
  const { smaa } = await import('three/addons/tsl/display/SMAANode.js');
  // BloomNode is a TSL node (`three/addons/tsl/display`), like SMAA: loaded here, in the lazy chunk.
  const { bloom } = await import('three/addons/tsl/display/BloomNode.js');
  // GTAO and its denoise (T7): also TSL nodes under `tsl/display`, not postprocessing passes.
  const gtaoModule = await import('three/addons/tsl/display/GTAONode.js');
  const gtao = createOrthoAwareGtao({ TSL, GTAONode: gtaoModule.default as never });
  const { denoise } = await import('three/addons/tsl/display/DenoiseNode.js');
  const renderer: WebGPURenderer = new W.WebGPURenderer(nodeRendererParameters(opts));
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
  /** Null factories until each task lands (T4 fog; T5 bloom and T7 AO are built just below). The chain reads them when it is built. */
  const kit: PostKit = { fog: null, ao: null, bloom: null };
  // T5: the bloom stage. Its control outlives chain rebuilds (the toggle state survives `build`).
  const nodeBloom = createNodeBloom({ bloom: bloom as never, W, renderer, maths: opts.bloomMaths });
  kit.bloom = nodeBloom.factory;
  const aoStage = createNodeAoStage({ W, TSL, ao: gtao as never, denoise: denoise as never, maths: opts.aoMaths });
  kit.ao = aoStage.factory;
  const aoControl: AoControl = aoStage.control;
  /** GH-943 P2 (T1): the material twins, null until each task lands (T3 ground, T5 ring, T6 foliage), each built from
   *  `opts.materialMaths`. A null factory leaves the legacy material in place, and this backend's census hides or names it. */
  const materials: MaterialKit = {
    ground: null,
    foliage: null,
    ring: null,
    // GH-943 P3 (T1): every P3 slot, null until its task lands (T3-T12).
    unit: null,
    outline: null,
    banner: null,
    backdrop: null,
    decal: null,
    overlay: null,
    zoneBand: null,
    supplyRoute: null,
    trail: null,
    xray: null,
    particle: null,
    tracer: null,
    vfxMesh: null,
    rimFade: null,
    beam: null,
    rotor: null,
    flipbook: null,
    smokeScreen: null,
  };
  // T3: the node ground (the dry blend, the macro and the road). P3 (T1): every twin names its legacy material.
  materials.ground = (legacy) => {
    const twin = createNodeGroundMaterial({ W, TSL, maths: opts.materialMaths.ground }, legacy);
    markTwin(twin, legacy);
    return twin;
  };
  // T6: the swaying foliage and trunk batches (the wind; the disturbers follow in T7). P3 (T1): every twin names its legacy material.
  const foliageTwin = createFoliageTwinFactory({ W, TSL, maths: opts.materialMaths.foliage });
  materials.foliage = (legacy) => {
    const twin = foliageTwin(legacy);
    markTwin(twin, legacy);
    return twin;
  };
  // GH-943 P2 (T5): the selection, team and wound rings. The legacy material keeps the uniform record the batch writes and carries its style.
  materials.ring = (legacy) => {
    const twin = createNodeRingMaterial({ W, TSL: TSL as never, maths: opts.materialMaths.ring }, legacy.userData[RING_STYLE_KEY] as RingStyle, legacy.uniforms as unknown as RingUniformRecord);
    markTwin(twin, legacy);
    return twin;
  };
  // GH-943 P3 (T3): every hooked unit material (team mark, running gear, soot; the rim and the floor are named partial terms until T4).
  // Adoption shares one twin per (base, segments, pipeline state) and copies the pipeline state onto it.
  materials.unit = (legacy) => {
    const twin = createNodeUnitMaterial({ W, TSL, maths: opts.materialMaths.unit }, legacy);
    markTwin(twin, legacy);
    return twin;
  };
  // GH-943 P3 (T5): the occlusion outline, the smoke outline and the hit flash's outline (every `rl-silhouette-outline` material). The
  // legacy material keeps its two uniform records (written once a frame by `setSilhouetteOutlineZoom`) and its colour object.
  materials.outline = (legacy) => {
    const twin = createNodeOutlineMaterial({ W, TSL: TSL as never, maths: opts.materialMaths.outline }, legacy);
    markTwin(twin, legacy);
    return twin;
  };
  // GH-943 P3 (T8): the overlay batch, the zone band, the supply route and the tunnel trail. Each legacy material keeps its record.
  const batchDeps = { W, TSL: TSL as never };
  materials.overlay = (legacy) => {
    const twin = createNodeOverlayMaterial(batchDeps);
    markTwin(twin, legacy);
    return twin;
  };
  materials.zoneBand = (legacy) => {
    const twin = createNodeZoneBandMaterial({ ...batchDeps, maths: opts.materialMaths.zoneBand });
    markTwin(twin, legacy);
    return twin;
  };
  materials.supplyRoute = (legacy) => {
    const twin = createNodeSupplyRouteMaterial({ ...batchDeps, maths: opts.materialMaths.supplyRoute }, legacy.uniforms as unknown as SupplyRouteUniformRecord);
    markTwin(twin, legacy);
    return twin;
  };
  materials.trail = (legacy) => {
    const twin = createNodeTrailMaterial(batchDeps, legacy.uniforms as unknown as TrailUniformRecord);
    markTwin(twin, legacy);
    return twin;
  };
  // GH-943 P3 (T9): the tunnel x-ray, one factory and four styles, chosen by the legacy material's name.
  materials.xray = (legacy) => {
    const style = XRAY_STYLE_BY_NAME[legacy.name];
    if (style === undefined) throw new Error(`node x-ray twin: no style for the legacy material "${legacy.name}"`);
    const twin = createNodeXrayMaterial({ W, TSL: TSL as never, maths: opts.materialMaths.xray }, legacy, style);
    markTwin(twin, legacy);
    return twin;
  };
  // GH-943 P3 (T7): the decal pools and the crater rim. The legacy material keeps its record, and carries its scene's light objects.
  materials.decal = (legacy) => {
    const twin = createNodeDecalMaterial({ W, TSL, maths: opts.materialMaths.decal }, legacy);
    markTwin(twin, legacy);
    return twin;
  };
  const DEFAULT_QUALITY = { ao: true, smaa: true, bloom: 'quarter' } as const;
  const seen = new Set<string>();
  const hooks = new Map<string, UnportedHook>();
  let frames = 0;

  const slotOf = opts.twinSlotOf;
  // P3 (T1): a legacy material is `unadopted` when its slot has a factory here and it is still on a mesh.
  const adoptable = (m: THREE.Material): boolean => {
    const slot = slotOf?.(m) ?? null;
    return slot !== null && materials[slot] !== null;
  };
  const runCensus = (scene: THREE.Scene): void => {
    const found = censusUnported(scene);
    if (slotOf !== undefined) found.push(...censusUnadopted(scene, adoptable));
    for (const h of found) hooks.set(`${h.kind}|${h.key}`, h);
    for (const line of unportedWarnings(found, seen)) warn(line);
  };

  const build = (config: PostConfig): void => {
    chain?.dispose();
    if (outputMaths === null) throw new Error('node backend: setOutputMaths must be called before the post chain is built');
    chain = createNodePostChain({ W, TSL, smaa: smaa as never, outputMaths }, renderer, config.scene, config.camera, config.quality, kit);
    builtFor = config;
  };

  const capture: NodeCaptureDeps = { W, TSL, renderer, kind, readback: opts.readbackMaths };

  // GH-943 P3 (T13, GH-1152): the frame's draw calls by pass (`stats().perPass`). The main scene drawn from another camera is the sun's
  // shadow map (`ShadowNode.renderShadow`); from the main camera it is the AO pre-pass when the AO pre-pass's target is bound, else the
  // scene pass; anything else (the pipeline's quads) is post.
  const classifyPass = (object: unknown, camera: unknown): RenderPassId => {
    if (builtFor === null || object !== builtFor.scene) return 'post';
    if (camera !== builtFor.camera) return 'shadow';
    const ao = aoStage.parts()?.prePass.renderTarget;
    return ao !== undefined && renderer.getRenderTarget() === ao ? 'ao' : 'scene';
  };
  const passes = installPassCounter(renderer as unknown as PassRendererLike, classifyPass);
  /** What the census walk cost inside the last `render` (0 on a frame it did not run), so a timing can leave it out (T13 H5). */
  let lastCensusMs = 0;

  const backend: RenderBackend = {
    kind,
    adapter: isGpu ? opts.adapter : 'webgl2',
    domElement: canvas,
    kit,
    materials,
    bloom: nodeBloom.control,
    pmrem: createNodePmremHost(W.PMREMGenerator as unknown as NodePmremGeneratorCtor, renderer),
    ao: aoControl,
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
      passes.beginFrame();
      lastCensusMs = 0;
      if (frames % CENSUS_EVERY_FRAMES === 0) {
        const t0 = performance.now();
        runCensus(scene);
        lastCensusMs = performance.now() - t0;
      }
      frames++;
      if (!chain || !builtFor || builtFor.scene !== scene || builtFor.camera !== camera) build({ scene, camera, quality: builtFor?.quality ?? DEFAULT_QUALITY });
      chain?.render();
    },
    photographGround: (scene, camera, size) => photographNodeGround(capture, scene, camera, size),
    captureView: async (maxWidth) => (chain ? captureNodeView(capture, chain.pipeline, maxWidth) : null),
    whenSubmitted: () => (be.device ? be.device.queue.onSubmittedWorkDone() : Promise.resolve()),
    unported: () => [...hooks.values()],
    stats: () => ({ calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles, perPass: passes.perPass(), censusMs: lastCensusMs }),
    // Null unless the renderer was built with timestamps AND the adapter kept them (`WebGPUBackend` drops `trackTimestamp` without
    // `timestamp-query`); otherwise the GPU time of every pass since the last call, in ms.
    gpuTimeMs: async () => {
      if (opts.timestamps !== true || (renderer as unknown as { backend: { trackTimestamp?: boolean } }).backend.trackTimestamp !== true) return null;
      const ms = (await renderer.resolveTimestampsAsync('render')) as number | undefined;
      return typeof ms === 'number' ? ms : null;
    },
    dispose() {
      passes.dispose();
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
