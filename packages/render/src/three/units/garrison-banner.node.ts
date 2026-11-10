/**
 * GH-943 WebGPU P3 (T6): the NODE twin of the garrison banner's material (`garrison-banner.ts`, `rl-garrison-banner`): the cloth and
 * its rod as a `MeshStandardNodeMaterial` whose `positionNode` swings the cloth, whose colour is the team's, and whose emissive floor
 * keeps the cloth readable in shade. Built by the node backend's `banner` factory from the legacy object alone (it carries its record,
 * `rlBanner`); `ThreeRenderer.adoptNodeMaterials` swaps it in for the one banner batch.
 *
 * What it mirrors, in the order the legacy chunks run:
 *   1. the instance MATRIX: three r186 applies `instancedMesh(object)` BEFORE `positionNode` (`NodeMaterial.setupPosition`, pinned by
 *      the spec), so `positionLocal` is already instanced and the swing, which the legacy chunk adds to `transformed` BEFORE the
 *      instance matrix, has to be carried through that matrix's linear part. The twin reads the matrix from the `instanceMatrix`
 *      buffer by `instanceIndex` (the same `buffer(array, 'mat4', count).element(instanceIndex)` three builds, so it follows the same
 *      upload): its column 3 is the origin the gust and the per-banner phase read, its upper 3x3 turns the cloth-frame swing into
 *      the object frame (the cloth is scaled to its wall and yawed to its face);
 *   2. the swing, `bannerSwayOps` (`garrison-banner.ts`), the one body the number tests run, on TSL nodes: out from the wall (never
 *      into it), a touch sideways, growing with `aHem` squared; mode 1 the travelling wind, mode 0 reduced motion's periodic gust;
 *   3. the colour, `mix(vertexColor, instanceColor, aTeam)`: the steel keeps its own vertex colour, the cloth and sleeve take the
 *      instance's team colour. The stock node material multiplies `instanceColor` onto the colour of the whole mesh, so the twin
 *      writes the MIX into the `vInstanceColor` varying (in its own vertex program only) and answers `false` to `vertexColors`
 *      (three would otherwise multiply the vertex colour in a second time). The varying is read from the `instanceColor` buffer
 *      every frame, so a viewer swap (`setViewer`, which `GarrisonBannerBatch.update` writes into that buffer) recolours the cloth
 *      with no call here;
 *   4. the emissive floor, `diffuse * uBannerGlow * aTeam`: cloth only, never the steel.
 *
 * **The rest pose outside the colour pass**, as on legacy (R-11): the shadow pass draws `castShadowPositionNode`, the rest position;
 * and a `PassNode` override material (the node AO pre-pass's normal material, `post-chain.node.ts`) is handed THIS material's
 * `positionNode` by three r186, which has no hook to stop it, so the `positionNode` itself returns the rest position when the program
 * being built is not this twin's own (and not a shadow pass's, which the hook above owns). Copied from the foliage twin
 * (`terrain/decor-mesh.node.ts`).
 *
 * **The uniforms stay a record** (`legacy.rlBanner`): the sim clock the crowns' sway shares (`time`), the debug amplitude, the glow
 * and the wind set, each re-read every render (`onRenderUpdate`), so a debug write and the reduced-motion preference reach the graph
 * with no call-site change. Nothing here reads a frame delta, `performance.now` or `Date.now`.
 *
 * Imports the backend's own addon-free modules and TYPES of the legacy files: the maths arrives as a value (`BannerMaths`), or the
 * node chunk would statically load the ThreeRenderer chunk (`MATERIAL_MATHS_MARKER`, `tools/src/perf/bundle-census.ts`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type { Material } from 'three';
import { tslIntOps, tslOps, type N, type Tsl } from '../fog-pass.node';
import type { bannerSwayOps, BannerRecord } from './garrison-banner';

/** The banner twin's shared maths, injected (`material-maths.ts`'s `MATERIAL_MATHS.banner`). */
export interface BannerMaths {
  readonly bannerSwayOps: typeof bannerSwayOps;
}

export interface NodeBannerDeps {
  readonly W: typeof import('three/webgpu');
  readonly TSL: typeof import('three/tsl');
  readonly maths: BannerMaths;
}

/** The twin's `name` (`NODE_MATERIAL_MARKER`, `tools/src/perf/bundle-census.ts`): the prefix, then the legacy key without its `rl-`. */
export const NODE_BANNER_MATERIAL_NAME = 'rl-node-material-garrison-banner';

/** The slice of the node builder the position graph reads at build time. */
interface BuilderLike {
  readonly material: (Material & { isShadowPassMaterial?: boolean }) | null;
  readonly object: (THREE.Object3D & { instanceMatrix?: THREE.InstancedBufferAttribute }) | null;
  getUniformBufferLimit?(): number;
}

/** The TSL members this file uses beyond `Tsl` (`fog-pass.node.ts`), as a structural handle, cast once. */
interface BannerTsl {
  Fn(body: (builder: BuilderLike) => N): () => N;
  attribute(name: string, type: string): N;
  buffer(array: unknown, type: string, count: number): N;
  float(a: N | number): N;
  vec3(...a: Array<N | number>): N;
  mat3(m: N): N;
  mix(a: N, b: N, t: N): N;
  uniform(v: unknown): N;
  vertexColor(): N;
  readonly instanceIndex: N;
  readonly instanceColor: N;
  readonly positionLocal: N;
  readonly diffuseColor: N;
}

/** The per-vertex attributes `stamp` writes (`garrison-banner.ts`): 1 on the cloth and sleeve, 0 on the steel; 0 at the rod, 1 at the hem. */
const TEAM_ATTRIBUTE = 'aTeam';
const HEM_ATTRIBUTE = 'aHem';

/** `N` plus the element access of a matrix or buffer node. */
interface NE extends N {
  element(i: N | number): NE;
  toVar(): NE;
}

/** The record's values as the twin holds them (re-read every render). Exposed for the record gates. */
export interface BannerBindings {
  readonly uBannerTime: N;
  readonly uBannerAmp: N;
  readonly uBannerGlow: N;
  readonly uWindMode: N;
  readonly uWindStrength: N;
  readonly uWindDir: N;
}

const BINDINGS = new WeakMap<Material, BannerBindings>();

/** The uniform nodes a banner twin reads (null for any other material). */
export function nodeBannerBindings(twin: Material): BannerBindings | null {
  return BINDINGS.get(twin) ?? null;
}

/**
 * The twin of the legacy banner material. `banner` is its record (`legacy.rlBanner`): the very objects the legacy splice binds.
 */
export function createNodeBannerMaterial(deps: NodeBannerDeps, legacy: THREE.MeshStandardMaterial, banner: BannerRecord): THREE.Material {
  const { W, maths } = deps;
  const T = deps.TSL as unknown as BannerTsl;
  const o = tslOps(deps.TSL as unknown as Tsl);
  const io = tslIntOps(deps.TSL as unknown as Tsl);

  const twin = new W.MeshStandardNodeMaterial();
  twin.name = NODE_BANNER_MATERIAL_NAME;
  // The ramp material's look, field by field (`NodeMaterial.copy` would read node slots a stock material does not have).
  twin.color = legacy.color;
  twin.roughness = legacy.roughness;
  twin.metalness = legacy.metalness;
  twin.emissive.copy(legacy.emissive);
  twin.emissiveIntensity = legacy.emissiveIntensity;
  twin.flatShading = legacy.flatShading;
  twin.side = legacy.side;
  twin.shadowSide = legacy.shadowSide;
  twin.transparent = legacy.transparent;
  twin.opacity = legacy.opacity;
  twin.alphaTest = legacy.alphaTest;
  twin.depthTest = legacy.depthTest;
  twin.depthWrite = legacy.depthWrite;
  twin.fog = legacy.fog;
  twin.envMapIntensity = legacy.envMapIntensity;
  twin.userData = { ...(legacy.userData as Record<string, unknown>) };
  // Adoption copies `RENDER_STATE_KEYS` onto every P3 twin, `vertexColors` among them. The twin mixes the vertex colour itself (the
  // varying below), so three must not multiply it in again: the field answers false, and the copy is a no-op.
  Object.defineProperty(twin, 'vertexColors', { get: () => false, set: () => undefined, configurable: true, enumerable: true });

  // The record, by reference: each value re-read every render.
  const bind = (rec: { readonly value: unknown }): N => {
    const n = T.uniform(rec.value);
    n.onRenderUpdate(() => {
      n.value = rec.value;
    });
    return n;
  };
  const bound: BannerBindings = {
    uBannerTime: bind(banner.time),
    uBannerAmp: bind(banner.amp),
    uBannerGlow: bind(banner.glow),
    uWindMode: bind(banner.wind.mode),
    uWindStrength: bind(banner.wind.strength),
    uWindDir: bind(banner.wind.dir),
  };
  BINDINGS.set(twin, bound);

  const position = T.Fn((builder) => {
    const mat = builder.material;
    // Not this twin's own colour program, and not the shadow pass (which draws `castShadowPositionNode` below): an override pass
    // that three handed this `positionNode` to. Rest pose, as every legacy override material draws.
    if (mat !== twin && mat?.isShadowPassMaterial !== true) return T.positionLocal;
    const matrices = builder.object?.instanceMatrix;
    if (matrices === undefined) throw new Error('createNodeBannerMaterial: the banner draws as an InstancedMesh with an instanceMatrix');
    const bytes = matrices.count * 16 * 4;
    const limit = builder.getUniformBufferLimit?.() ?? Infinity;
    // three's own instance matrix is a `buffer` node up to this limit (an interleaved attribute beyond it, which this twin does not read).
    if (bytes > limit) throw new Error(`createNodeBannerMaterial: ${matrices.count} banners (${bytes} bytes) exceed the uniform buffer limit ${limit}`);
    // This instance's matrix, by `instanceIndex`: the buffer three's `instancedMesh(object)` has already applied to `positionLocal`.
    const instanceMatrix = (T.buffer(matrices.array, 'mat4', matrices.count) as NE).element(T.instanceIndex).toVar();
    const origin = (instanceMatrix as NE).element(3);
    const aTeam = T.attribute(TEAM_ATTRIBUTE, 'float');
    if (mat === twin) {
      // The colour: the steel keeps its vertex colour, the cloth takes the instance colour (read live from the buffer).
      T.instanceColor.assign(T.mix(T.vertexColor().rgb, T.instanceColor, aTeam));
    }
    const swing = maths.bannerSwayOps(o, io, {
      t: bound.uBannerTime,
      amp: bound.uBannerAmp,
      ox: origin.x,
      oz: origin.z,
      hem: T.attribute(HEM_ATTRIBUTE, 'float'),
      mode: bound.uWindMode,
      strength: bound.uWindStrength,
      dirX: bound.uWindDir.x,
      dirZ: bound.uWindDir.y,
    });
    // The swing is in the cloth's own frame, before the instance matrix: through its linear part into the object frame.
    return T.positionLocal.add(T.mat3(instanceMatrix).mul(T.vec3(swing.dx, 0, swing.dz)));
  });
  twin.positionNode = position() as never;
  // The shadow keeps the rest pose, as on legacy (R-11).
  twin.castShadowPositionNode = T.positionLocal as never;
  // The self-lit floor: cloth only.
  twin.emissiveNode = T.diffuseColor.rgb.mul(bound.uBannerGlow.mul(T.attribute(TEAM_ATTRIBUTE, 'float'))) as never;
  return twin;
}
