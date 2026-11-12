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
import type { PerPass } from './pass-counter';
import type { RefreshMode } from './refresh-policy';
import type { MatrixWalk as MatrixWalkMode, UploadsMode } from './node-draw-options';
import type { FogUniformTable } from '../fog-spec';
import type { FogMaths } from '../fog-pass.node';
import type { OutputMaths } from '../post-chain.node';
import type { BloomControl } from '../bloom-spec';
import type { NodePmremHost } from '../environment';
import type { RawPixels } from '../capture-view.node';
import type { GroundMaterial } from '../terrain/mesh';
import type { GroundMaths } from '../terrain/mesh.node';
import type { FoliageMaths } from '../terrain/decor-mesh.node';
import type { RingMaths } from '../units/selection-ring.node';
import type { BannerMaths } from '../units/garrison-banner.node';
import type { ParticleMaths } from '../units/fx.node';
import type { RimFadeMaths } from '../units/rim-fade.node';
import type { FlipbookMaths } from '../units/flipbook-fx.node';
import type { SmokeScreenMaths } from '../smoke-mesh.node';
import type { BeamMaths } from '../units/beam-batch.node';
import type { RotorMaths } from '../units/swarm-batch.node';
import type { BackdropMaths } from '../terrain/backdrop.node';
import type { UnitMaths } from '../units/unit-material.node';
import type { OutlineMaths } from '../units/silhouette.node';
import type { ZoneBandMaths } from '../units/zone-band.node';
import type { SupplyRouteMaths } from '../supply-route.node';
import type { XrayMaths } from '../tunnel-xray.node';
import type { DecalMaths } from '../decal-pool.node';
import type { GrassFieldKit, GrassFieldMaths } from '../terrain/grass-field.node';
import type { BuildingCutMaths } from '../units/building-cut.node';

/**
 * GH-943 P2 (T1): the material seam, the `PostKit` shape for scene materials. Each factory takes a LEGACY material (the object
 * that keeps owning the uniform record and the debug setters, so no toggle code changes) and returns its node twin, which reads
 * that record. `ThreeRenderer.adoptNodeMaterials` swaps `mesh.material` legacy -> twin through an identity cache, so one legacy
 * object gets one twin. A `null` factory is a material with no twin yet: the census still hides or names the legacy one.
 * T3 lands `ground` (`GroundMaterial`, every ground chunk), T5 `ring` (the selection, team and wound ring batches' material), T6
 * `foliage` (the swaying foliage and trunk batches). A legacy boot never reaches the kit.
 */
export type MaterialTwinFactory<L extends THREE.Material> = (legacy: L) => THREE.Material;
/**
 * GH-943 P3 (T1): a slot per P3 material family, each `null` until its task lands (the brief's owners in brackets). A `ShaderMaterial`
 * slot is recognised by the legacy material's `name` (`../material-names.ts`, `P3_MATERIAL_NAMES`); `unit` by its hook segments
 * (all in `UNIT_HOOK_SEGMENTS`), and memoised SHARED by base, segments and pipeline state; `outline`, `banner` and `backdrop` by their
 * one-segment program keys. Every factory marks its twin (`../twin-identity.ts`, `markTwin`); adoption copies `RENDER_STATE_KEYS`
 * onto every P3 twin.
 */
export interface MaterialKit {
  ground: MaterialTwinFactory<GroundMaterial> | null;
  foliage: MaterialTwinFactory<THREE.MeshStandardMaterial> | null;
  ring: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  /** Team mark, running gear, rain rim, wounded floor, soot (T3, T4). */
  unit: MaterialTwinFactory<THREE.MeshStandardMaterial> | null;
  /** The occlusion outline, `rl-silhouette-outline` (T5). */
  outline: MaterialTwinFactory<THREE.MeshBasicMaterial> | null;
  /** The garrison banner, `rl-garrison-banner` (T6). */
  banner: MaterialTwinFactory<THREE.MeshStandardMaterial> | null;
  /** The valley backdrop's fade, `rl-backdrop-fade` (T10). */
  backdrop: MaterialTwinFactory<THREE.MeshStandardMaterial> | null;
  /** Decals and crater rims, `rl-decal` (T7). */
  decal: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  /** The overlay batch, zone band, supply route and tunnel trail (T8). */
  overlay: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  zoneBand: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  supplyRoute: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  trail: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  /** The tunnel x-ray tube, collar, figure and beam (T9). */
  xray: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  /** Particles, tracers, flat-colour FX meshes, the plume/shroud rim fade, the beam and the rotor blur (T11). */
  particle: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  tracer: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  vfxMesh: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  rimFade: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  beam: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  rotor: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  /** The flipbook smoke and fire, and the smoke screen (T12). */
  flipbook: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  smokeScreen: MaterialTwinFactory<THREE.ShaderMaterial> | null;
  /** GH-1225 slice 3 (L7): a clone-drawn building's holed and/or cut colour clone, `rl-holes` / `rl-cut`. */
  building: MaterialTwinFactory<THREE.MeshStandardMaterial> | null;
}
/**
 * GH-943 P2 (T1): the values bundle the material twins receive (`../material-maths.ts`'s `MATERIAL_MATHS`, the `OutputMaths`
 * pattern): shared maths written against `Ops<T>`, handed over as VALUES, because a value import of a module the legacy materials
 * also import would make the node chunk statically load the ThreeRenderer chunk. Every slot is `null` until its task fills it
 * (T3 `ground`, T5 `ring`, T6 `foliage`), each with the type its twin declares. `marker` is the bundle census's handle on the
 * module (`tools/src/perf/bundle-census.ts`, `MATERIAL_MATHS_MARKER`).
 */
export interface MaterialMaths {
  readonly marker: 'rl-material-maths';
  /** T3: the ground blend (`terrain/mesh.node.ts`). */
  readonly ground: GroundMaths;
  readonly foliage: FoliageMaths;
  readonly ring: RingMaths;
  /** GH-943 P3 (T3): the unit twin's terms (team mark, running gear, soot; T4 the rim and the floor). */
  readonly unit: UnitMaths;
  /** GH-943 P3 (T1): one slot per `MaterialKit` P3 slot, each `null` until its task gives it the type its twin declares. */
  /** T5: the occlusion and smoke outline (`units/silhouette.node.ts`). */
  readonly outline: OutlineMaths;
  /** T6: the garrison banner's sway (`units/garrison-banner.node.ts`). */
  readonly banner: BannerMaths;
  readonly backdrop: BackdropMaths;
  /** T7: the decal kinds, the road under them, the albedo ratio and the crater rim. */
  readonly decal: DecalMaths;
  readonly overlay: null;
  /** T8: the overlay batch and the trail are passthroughs (no shared maths); the zone band's hatch and the route's dash are values. */
  readonly zoneBand: ZoneBandMaths;
  readonly supplyRoute: SupplyRouteMaths;
  readonly trail: null;
  /** T11: the particle disc's coverage and `HDR_GAINS.sparks` (`units/fx.node.ts`). The tracer and flat-colour FX mesh need no maths. */
  readonly particle: ParticleMaths;
  /** T9: the x-ray's four styles share one body of maths (`tunnel-xray.ts`). */
  readonly xray: XrayMaths;
  readonly tracer: null;
  readonly vfxMesh: null;
  /** T11: the plume's and the shroud's rim fade (`units/rim-fade.node.ts`). */
  readonly rimFade: RimFadeMaths;
  /** T11: the beam's kind-branch alpha (`units/beam-batch.node.ts`). */
  readonly beam: BeamMaths;
  /** T11: the rotor blur's coverage and spin (`units/swarm-batch.node.ts`). */
  readonly rotor: RotorMaths;
  /** T12: the flipbook's motion, cover and shade (`units/flipbook-fx.node.ts`), and the smoke screen's (`smoke-mesh.node.ts`). */
  readonly flipbook: FlipbookMaths;
  readonly smokeScreen: SmokeScreenMaths;
  /** GH-1167 S5: the 3D grass field's maths (`terrain/grass-field.node.ts`): the foliage slot's, the flutter, the width floor. Not a
   *  twin: the field has no legacy material, so it has no `MaterialKit` slot; `RenderBackend.grassField` builds it. */
  readonly grassField: GrassFieldMaths;
  /** GH-1225 slice 3 (L7): the holes and the roof cut (`units/building-cut.node.ts`). */
  readonly building: BuildingCutMaths;
}

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
  /** The preset the chain was built for (T7: the AO reads `aoScale`). */
  readonly quality: PostQuality;
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
/**
 * GH-943 P1 (T7): the handle the renderer drives the node AO through. The legacy path writes `aoPass.blendIntensity` and
 * `aoPass.enabled` (zoom fade, the `ao` debug layer); the node path writes the same two facts here. Presentation only.
 */
export interface AoControl {
  /** The zoom-fade weight, 0..1 (`zoom-fade.ts`). */
  setBlend(weight: number): void;
  /** The `ao` debug layer's switch. Off draws nothing and skips the pre-pass. */
  setEnabled(on: boolean): void;
  readonly blend: number;
  readonly enabled: boolean;
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
  /** GH-943 P2 (T1): the material twin factories (`MaterialKit`), read by `ThreeRenderer.adoptNodeMaterials`. */
  readonly materials: MaterialKit;
  /**
   * GH-943 P1 (T4): hands the backend the fog uniform table (`FogUniforms.uniforms`, the same record the legacy pass exposes) and
   * the compile-time `hazeLow` and the shared haze/shimmer maths (injected, see `FogMaths`); the fog stage reads them. Call BEFORE `configure`, which builds the chain from the kit.
   */
  setFog(table: FogUniformTable, hazeLow: number, maths: FogMaths): void;
  /** GH-943 P1 (T3): hands the backend the shared grade and vignette maths (injected, see `GradeMaths`). Call BEFORE `configure`. */
  setOutputMaths(maths: OutputMaths): void;
  /** GH-943 P1 (T5): the bloom stage's switch (layer toggle, zoom fade) and its debug read. Always present on a node backend; `built` is
   *  false until the chain holds a bloom stage. */
  readonly bloom: BloomControl;
  /** GH-943 P1 (T6): what `EnvironmentRegistry.attach` takes on this backend (the node PMREM bake). */
  readonly pmrem: NodePmremHost;
  /** The node AO's control (T7); null when the addon-backed stage is not built. */
  readonly ao: AoControl | null;
  /** Builds the node post chain for this scene, camera and quality preset; `render` rebuilds it if it is called with another pair. */
  configure(config: PostConfig): void;
  /** The node post chain (null before `configure`). Same `PostChainLike` the legacy `PostChain` extends. */
  readonly post: PostChainLike | null;
  /**
   * GH-1227 slice 3: whether this backend builds the soft-particle depth copy for `quality` (`post-chain.node.ts`'s
   * `nodeSoftDepthOn`: the flag AND a WebGPU device with `depth32float-stencil8`). The SAME predicate picks the scene pass's depth
   * format, so the copy and the format cannot disagree. Absent reads as false (soft particles inert on that backend).
   */
  softDepthOn?(quality: PostQuality): boolean;
  /** Compiles every program the scene needs now (`compileAsync`), so the first photographed frame is not a cold one. */
  prepare(scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
  /** Draws one frame. Synchronous, like `WebGLRenderer.render`; never installs an animation loop of its own. */
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  /**
   * GH-943 P1 (T8): ONE direct render of `scene` from `camera` into a `size` x `size` target of its own (never through the
   * pipeline), tone mapped and sRGB-encoded, read back ASYNC as tight RGBA8 with rows BOTTOM-UP. The caller has hidden what must
   * not be seen. Null before the renderer can draw.
   */
  photographGround(scene: THREE.Scene, camera: THREE.Camera, size: number): Promise<RawPixels | null>;
  /** GH-943 P1 (T8): the player's view through the whole pipeline, at most `maxWidth` wide, same pixel layout. Null with no chain built. */
  captureView(maxWidth: number): Promise<RawPixels | null>;
  /** Resolves when the GPU has finished every submitted command (the `onSubmittedWorkDone` of the capture protocol). */
  whenSubmitted(): Promise<void>;
  /** Every GLSL-only hook the last census found, cumulative. */
  unported(): readonly UnportedHook[];
  /**
   * Draw calls and triangles of the last frame, from the renderer's own counters. GH-943 P3 (T13, GH-1152): `perPass` splits the calls
   * by pass (`pass-counter.ts`; they sum to `calls`), and `censusMs` is what the unported-hook census cost inside that frame's `render`
   * (0 on the 59 frames in 60 it does not run), so a timing can leave the census out.
   */
  stats(): { calls: number; triangles: number; perPass: PerPass; censusMs: number };
  /** GH-943 P3 (T13): the GPU time (ms) of everything rendered since the last call, from timestamp queries; null unless the backend was
   *  built with `timestamps` and the adapter offers `timestamp-query`. */
  gpuTimeMs(): Promise<number | null>;
  /**
   * GH-943 P3 (T14b, GH-1152): the draw-submission switches at RUN time (the probe page's H7-H9 variants flip them on one page), and
   * their counts since the last `takeCounts`. Optional: only the node backend has them (the test doubles leave them out).
   */
  readonly drawSwitches?: DrawSwitches;
  /**
   * GH-1167 S5: the 3D grass field's builder (`terrain/grass-field.node.ts`), the only maker of a grass scene object, so that file is
   * reached only through this chunk (bundle pin P1). `ThreeRenderer.rebuildTerrain` calls it on a node boot of a map whose tones
   * carry `grassField`. Optional: the test doubles leave it out, and then no field is built.
   */
  readonly grassField?: GrassFieldKit;
  dispose(): void;
}

/** GH-943 P3 (T14b): the node backend's run-time draw switches (`RenderBackend.drawSwitches`). */
export interface DrawSwitches {
  get(): { refreshPolicy: RefreshMode; matrixWalk: MatrixWalkMode; uploads: UploadsMode };
  setRefresh(m: RefreshMode): void;
  setMatrixWalk(w: MatrixWalkMode): void;
  /** FULL refreshes three asked for, those F2 turned into SHARED, scene walks done and skipped, since the last call. */
  takeCounts(): { full: number; downgraded: number; walks: number; walksSkipped: number };
  /** The `type:name` update nodes that kept a program from being downgraded (the G2c census), cumulative. */
  undeclared(): readonly string[];
}
