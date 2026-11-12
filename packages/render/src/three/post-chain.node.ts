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
 *    backend maps to `depth24plus-stencil8`. P2 decals and the P3 outline need the half-float target and the stencil. The fog stage
 *    SAMPLES that depth, which WebGPU allows only through a depth-only view: three 0.186.1 asked for `aspect: 'all'` and the bind
 *    group was invalid (G drew black on Metal). The fix is three r187's own line, carried as `patches/three@0.186.1.patch` and pinned
 *    by `backend/depth-aspect.node.test.ts`;
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
import type { AoControl, PostKit, PostStage, PostStageFactory } from './backend/backend';
import type { PostChainLike, PostQuality, PostStageName } from './post-chain-shared';
import { NodeOutputGrade, type GradeMaths } from './output-grade.node';
import { NodeOutputVignette, type VignetteMaths } from './vignette-pass.node';
import type { AO_RADIUS_TILES, AO_RESOLUTION_SCALE, AO_SCALE, isAoOccluder, seededAoNoiseTexture } from './ao-occluder';

/**
 * `ao-occluder.ts`'s constants and helpers, INJECTED rather than imported: legacy `post-chain.ts` imports the same module, so the bundler
 * hoists it into the ThreeRenderer chunk and a value import here would make the node-backend chunk load that chunk (and the legacy
 * composer in it); the bundle census (`pnpm --filter @lions/tools webgpu:bundle`) fails on exactly that. Built by `output-maths.ts`.
 */
export interface AoMaths {
  readonly radiusTiles: typeof AO_RADIUS_TILES;
  readonly resolutionScale: typeof AO_RESOLUTION_SCALE;
  readonly scale: typeof AO_SCALE;
  readonly isOccluder: typeof isAoOccluder;
  readonly seededNoiseTexture: typeof seededAoNoiseTexture;
}

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
  /**
   * GH-1270: bring SMAA's three render targets to the renderer's drawing-buffer size NOW. Call it right after the renderer's
   * `setSize` / `setPixelRatio`, between frames. `SMAANode.updateBefore` otherwise does it itself, in the middle of the frame that
   * first sees the new size: `RenderTarget.setSize` disposes the target, the blend texture is destroyed under the frame's
   * already-recorded work, and the queue submit raises "Destroyed texture SMAANode.blend used in a submit" once per resize.
   * With the targets already at size, the node's own call is a no-op. A no-op for a preset with no SMAA.
   */
  resize(): void;
}

/**
 * GH-1227 slice 3 (the soft-particles design, section 5, W1): the WebGPU feature that makes the scene pass's depth aspect copyable.
 * three requests every feature the adapter has, so `renderer.hasFeature` says whether the device carries it (Apple GPUs do).
 */
export const SOFT_DEPTH_FEATURE = 'depth32float-stencil8';

/**
 * The ONE predicate for the node soft-particle copy: the preset asks for soft particles AND the backend can copy the depth (a
 * WebGPU device with `SOFT_DEPTH_FEATURE`). The node backend reads it to pick the scene pass's depth type, and `ThreeRenderer.init`
 * (through `RenderBackend.softDepthOn`) to build the copy, so the two can never disagree. Off: today's pass, no copy.
 */
export function nodeSoftDepthOn(quality: PostQuality, copyable: boolean): boolean {
  return quality.softParticles === true && copyable;
}

/** The scene pass's depth type: `UnsignedInt248Type` (depth24plus-stencil8, today's) unless the soft copy is on, then `FloatType`
 *  (depth32float-stencil8, whose depth aspect a texture copy may read; `soft-depth.ts`'s `NodeSoftDepthCopy` matches it). */
export function nodeSceneDepthType(softDepth: boolean): THREE.TextureDataType {
  return softDepth ? THREE.FloatType : THREE.UnsignedInt248Type;
}

function depthStencilTexture(type: THREE.TextureDataType): THREE.DepthTexture {
  const t = new THREE.DepthTexture(1, 1, type);
  t.format = THREE.DepthStencilFormat;
  return t;
}

export function createNodePostChain(
  deps: NodePostDeps,
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: PostQuality,
  kit: PostKit,
  softDepthCopyable = false
): NodePostChain {
  const { W, TSL } = deps;
  const names: PostStageName[] = [];
  const owned: Array<{ dispose(): void }> = [];

  // 1. The scene pass: HalfFloat colour, single-sampled, depth24plus-stencil8 (a DepthStencilFormat / UnsignedInt248 depth texture).
  // GH-1227 slice 3: depth32float-stencil8 instead (FloatType) only while the soft-particle copy is on (`nodeSoftDepthOn`).
  const depthTexture = depthStencilTexture(nodeSceneDepthType(nodeSoftDepthOn(quality, softDepthCopyable)));
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
    const stage = (factory as (c: unknown) => PostStage)({ input: colour, scenePass, TSL, scene, camera, quality });
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
  let smaaNode: { setSize(w: number, h: number): void } | null = null;
  if (quality.smaa) {
    const input = TSL.rtt(colour, null, null, { type: THREE.HalfFloatType });
    smaaInput = input as unknown as NodePostChain['smaaInput'];
    colour = deps.smaa(input);
    smaaNode = colour as unknown as { setSize(w: number, h: number): void };
    owned.push({ dispose: () => (colour as unknown as { dispose?: () => void }).dispose?.() });
    names.push('SMAAPass');
  }

  const pipeline = new W.RenderPipeline(renderer, colour);
  pipeline.outputColorTransform = false;

  return {
    scenePass,
    pipeline,
    smaaInput,
    resize() {
      if (smaaNode === null) return;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      smaaNode.setSize(size.width, size.height);
      // `Bindings._update` re-reads a sampled texture's `generation` only when the node binding reports a change of texture
      // OBJECT, and the blend target is the same object before and after `RenderTarget.setSize`: the output quad would keep the
      // bind group that holds the destroyed GPU texture. A fresh quad program state builds a fresh bind group.
      pipeline.needsUpdate = true;
    },
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

// ---------------------------------------------------------------------------------------------------------------------------------
// GH-943 P1 (T7): ambient occlusion. Mirrors `WorldGTAOPass` (post-chain.ts): the opaque world re-drawn into a normal + depth
// pre-pass at a fraction of the frame, GTAO over it, a Poisson denoise, then a MULTIPLY onto the chain's colour.
// ---------------------------------------------------------------------------------------------------------------------------------

/** Names only this module carries, for the bundle census and the tests. */
export const NODE_AO_PREPASS_NAME = 'rl-node-ao-prepass';
/** GH-1248: the name of a cut building's AO mask material (one per TSL twin, `createNodeAoStage`'s `cutAoFor`). */
export const NODE_AO_CUT_MATERIAL_NAME = 'rl-node-ao-normal-cut';

/**
 * Runs `draw` with only the AO occluders visible and the sun's shadow map frozen, then puts everything back (in `finally`: a throw in
 * the pre-pass must not leave the billboards, decals, overlays and outline hulls invisible for the rest of the session).
 *
 * Exactly `WorldGTAOPass.render`'s wrapper. Two honest differences from the legacy one, both read in three 0.186.1:
 *  - the legacy freeze is `renderer.shadowMap.autoUpdate`; the node renderer does not read that field (a `ShadowNode` updates when
 *    its LIGHT's `shadow.autoUpdate` or `needsUpdate` is set, at most once per camera per frame). So the freeze here is on each
 *    light's `shadow.autoUpdate`, which is the flag the node path consults;
 *  - only the meshes THIS call hid are restored, so a mesh that was already invisible (the unported-GLSL census hides some) stays so.
 *
 * GH-1248, the legacy pass's cut swap (`post-chain.ts`, `userData.rlCutAo`) on the node backend: a cut building's mesh occludes
 * through `cutAoFor(mesh)`, its TSL twin's AO mask material (`createNodeAoStage`), put back in `finally` like the hidden set. A
 * mesh carrying the legacy mask with no node mask yet (its twin is adopted on the next frame) is left out of the G-buffer rather
 * than drawn whole over the units inside, as before. Off the cut path no mesh carries `rlCutAo`: unchanged.
 */
export function withAoOccludersOnly<T>(
  scene: THREE.Scene,
  isOccluder: AoMaths['isOccluder'],
  draw: () => T,
  cutAoFor?: (mesh: THREE.Mesh) => THREE.Material | undefined
): T {
  const hidden: THREE.Object3D[] = [];
  const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  const frozen: THREE.LightShadow[] = [];
  scene.traverse((object) => {
    const cutAo = (object.userData as { rlCutAo?: unknown }).rlCutAo !== undefined;
    if (object.visible) {
      const mesh = object as THREE.Mesh;
      const mask = cutAo && cutAoFor !== undefined && mesh.isMesh && isOccluder(object) ? cutAoFor(mesh) : undefined;
      if (mask !== undefined) {
        swapped.push([mesh, mesh.material]);
        mesh.material = mask;
      } else if (cutAo || !isOccluder(object)) {
        object.visible = false;
        hidden.push(object);
      }
    }
    const shadow = (object as { shadow?: THREE.LightShadow }).shadow;
    if (shadow !== undefined && shadow.autoUpdate) {
      shadow.autoUpdate = false;
      frozen.push(shadow);
    }
  });
  try {
    return draw();
  } finally {
    for (const object of hidden) object.visible = true;
    for (const [mesh, material] of swapped) mesh.material = material;
    for (const shadow of frozen) shadow.autoUpdate = true;
  }
}

/** The structural slice of `GTAONode` / `DenoiseNode` (r186) this module touches; both arrive through `NodeAoDeps`, loaded by the backend. */
export interface GtaoNodeLike {
  radius: { value: number };
  scale: { value: number };
  thickness: { value: number };
  distanceExponent: { value: number };
  distanceFallOff: { value: number };
  resolutionScale: number;
  useTemporalFiltering: boolean;
  getTextureNode(): TslNode;
  dispose(): void;
}
export interface DenoiseNodeLike extends TslNode {
  noiseNode: { value: THREE.Texture };
  _noiseTexture: THREE.Texture;
  lumaPhi: { value: number };
  depthPhi: { value: number };
  normalPhi: { value: number };
  radius: { value: number };
  dispose(): void;
}
export interface NodeAoDeps {
  readonly W: typeof import('three/webgpu');
  readonly TSL: typeof import('three/tsl');
  /** `ao` from `three/addons/tsl/display/GTAONode.js` (a TSL node, not a postprocessing pass). */
  readonly ao: (depth: TslNode, normal: TslNode, camera: THREE.Camera) => GtaoNodeLike;
  /** `denoise` from `three/addons/tsl/display/DenoiseNode.js`. */
  readonly denoise: (texture: TslNode, depth: TslNode, normal: TslNode, camera: THREE.Camera) => DenoiseNodeLike;
  readonly maths: AoMaths;
}

/** The swizzles `Node` carries at runtime and `three/webgpu`'s types leave off. */
interface Swizzled extends TslNode {
  readonly r: TslNode;
  readonly a: TslNode;
  readonly rgb: TslNode & { mul(factor: TslNode): TslNode };
}

export interface NodeAoStage {
  readonly factory: PostStageFactory;
  readonly control: AoControl;
  /** What the multiply reads: 0 when the layer is off, else the zoom-fade weight. */
  readonly blendUniform: { readonly value: number };
  /**
   * GH-1248: the AO mask material a cut mesh draws the pre-pass through (`withAoOccludersOnly`), or undefined when its material
   * carries no node mask. One per twin, minted on first use and disposed with it: the normal material's output behind a discard on
   * the twin's own `maskNode`, the very node its colour and shadow discard on (so the maths is `MATERIAL_MATHS.building` and the
   * uniforms are the legacy records, by reference). Double-sided, no blending and `allowOverride` false, as the legacy mask.
   */
  readonly cutAoFor: (mesh: THREE.Mesh) => THREE.Material | undefined;
  /** The pieces of the LAST chain the factory built (null before any), for the tests that pin their settings. */
  parts(): { readonly prePass: PassNode; readonly gtao: GtaoNodeLike; readonly denoise: DenoiseNodeLike } | null;
}

/** The PassNode subclass: skips its scene render while the gate says the AO contributes nothing, and draws only the occluders. */
function aoPrePassClass(W: NodeAoDeps['W'], isOccluder: AoMaths['isOccluder'], cutAoFor: NodeAoStage['cutAoFor']) {
  return class AoPrePass extends W.PassNode {
    /** True while the AO is in the picture (blend above 0 and the layer on). */
    gate: () => boolean = () => true;

    override updateBefore(frame: Parameters<PassNode['updateBefore']>[0]): boolean | undefined {
      if (!this.gate()) return undefined;
      return withAoOccludersOnly(this.scene as THREE.Scene, isOccluder, () => super.updateBefore(frame), cutAoFor);
    }
  };
}

/**
 * Builds the AO stage factory and the control the renderer drives it with. The control outlives any one chain (the quality preset
 * rebuilds the chain, the zoom fade does not), so it owns the blend uniform and the factory only wires it in.
 *
 * Pinned values (the legacy `createAoPass` / `GTAOPass`): radius `AO_RADIUS_TILES` (world units, `screenSpaceRadius` false),
 * scale `AO_SCALE`, thickness 1, distance exponent 1, falloff 1, blend 1, denoise luma/depth/normal phi 10/2/3 and radius 8, the
 * pre-pass and the AO at `aoScale` of the frame (high: 0.25, GH-777). GTAO runs with temporal filtering off.
 */
export function createNodeAoStage(deps: NodeAoDeps): NodeAoStage {
  const { W, TSL } = deps;
  const blendUniform = TSL.uniform(1);
  let weight = 1;
  let on = true;
  const push = (): void => {
    blendUniform.value = on ? weight : 0;
  };
  const control: AoControl = {
    setBlend(w) {
      weight = w;
      push();
    },
    setEnabled(v) {
      on = v;
      push();
    },
    get blend() {
      return weight;
    },
    get enabled() {
      return on;
    },
  };

  // Writes the view-space normal as it is (HalfFloat holds the negatives), so GTAO's `normalNode.sample(uv).rgb.normalize()` needs
  // no decode. A plain NodeMaterial with a fragmentNode: no lights, no fog, no tone map, and the instancing / batching / skinning
  // of the object it replaces come through `setupPosition`.
  const normalMaterial = new W.NodeMaterial();
  normalMaterial.name = 'rl-node-ao-normal';
  const normalOut = TSL.vec4(TSL.normalView, 1);
  normalMaterial.fragmentNode = normalOut;
  normalMaterial.fog = false;
  normalMaterial.toneMapped = false;

  // GH-1248: a cut building's AO mask (see `NodeAoStage.cutAoFor`). A `fragmentNode` material skips `maskNode` (r186's
  // `NodeMaterial.setup` runs the mask only in `setupDiffuseColor`), so the discard is written into the fragment itself.
  const cutMasks = new WeakMap<THREE.Material, THREE.Material>();
  const cutAoFor = (mesh: THREE.Mesh): THREE.Material | undefined => {
    const twin = mesh.material;
    if (Array.isArray(twin)) return undefined;
    const keep = (twin as { maskNode?: TslNode | null }).maskNode;
    if (keep === undefined || keep === null) return undefined;
    let mask = cutMasks.get(twin);
    if (mask === undefined) {
      const m = new W.NodeMaterial();
      m.name = NODE_AO_CUT_MATERIAL_NAME;
      m.fragmentNode = TSL.Fn(() => {
        TSL.bool(keep as never).not().discard();
        return normalOut;
      })() as never;
      m.fog = false;
      m.toneMapped = false;
      m.side = THREE.DoubleSide;
      m.blending = THREE.NoBlending;
      m.allowOverride = false;
      twin.addEventListener('dispose', () => m.dispose());
      cutMasks.set(twin, m);
      mask = m;
    }
    return mask;
  };
  const AoPrePass = aoPrePassClass(W, deps.maths.isOccluder, cutAoFor);

  let last: ReturnType<NodeAoStage['parts']> = null;
  const factory: PostStageFactory = (ctx) => {
    const scale = ctx.quality.aoScale ?? deps.maths.resolutionScale;
    const prePass = new AoPrePass(W.PassNode.COLOR, ctx.scene, ctx.camera, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      samples: 0,
    });
    prePass.name = NODE_AO_PREPASS_NAME;
    prePass.overrideMaterial = normalMaterial;
    // Opaque only: the occluder filter already hides every transparent mesh, this keeps the transparent list from being walked.
    prePass.transparent = false;
    prePass.setResolutionScale(scale);
    prePass.gate = () => on && weight > 0;
    const normal = prePass.getTextureNode('output');
    const depth = prePass.getTextureNode('depth');

    const gtao = deps.ao(depth, normal, ctx.camera);
    gtao.resolutionScale = scale;
    gtao.useTemporalFiltering = false;
    gtao.radius.value = deps.maths.radiusTiles;
    gtao.scale.value = deps.maths.scale;
    gtao.thickness.value = 1;
    gtao.distanceExponent.value = 1;
    gtao.distanceFallOff.value = 1;

    const den = deps.denoise(gtao.getTextureNode(), depth, normal, ctx.camera);
    den.lumaPhi.value = 10;
    den.depthPhi.value = 2;
    den.normalPhi.value = 3;
    den.radius.value = 8;
    // DenoiseNode builds its noise from `new SimplexNoise()`, whose random source is `Math`: a different texture in every process
    // (the drift `AO_NOISE_SEED` exists to stop on the legacy path). GTAONode's own noise is a magic square and already stable.
    den._noiseTexture.dispose();
    const seeded = deps.maths.seededNoiseTexture();
    den._noiseTexture = seeded;
    den.noiseNode.value = seeded;

    last = { prePass, gtao, denoise: den };

    // The multiply, as the legacy blend material: colour * mix(1, ao, intensity). The AO is a float in the red channel.
    const aoTerm = (den as unknown as Swizzled).r;
    const factor = TSL.mix(TSL.float(1), aoTerm as never, blendUniform);
    const input = ctx.input as unknown as Swizzled;
    const node = TSL.vec4(input.rgb.mul(factor as never) as never, input.a as never);
    return {
      node,
      dispose() {
        den.dispose();
        gtao.dispose();
        prePass.dispose();
      },
    };
  };
  return { factory, control, blendUniform, cutAoFor, parts: () => last };
}
