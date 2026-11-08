/**
 * GH-943 WebGPU P2 (T6): the NODE twin of the swaying foliage and trunk material (`decor-mesh.ts`'s `swayingFoliageMaterial`): the
 * ramp material as a `MeshStandardNodeMaterial` whose `positionNode` adds the wind (GH-984 N1). Built by the node backend's `foliage`
 * factory from the legacy object alone; `ThreeRenderer.adoptNodeMaterials` swaps it in for every `rl-foliage-sway*` /
 * `rl-trunk-sway*` batch material.
 *
 * What it mirrors, in the order the legacy vertex chunk (`windVertexChunk`) runs:
 *   1. the instance ORIGIN: the batching matrix's translation, read with the same matrices-texture fetch three's own `batch()`
 *      (`nodes/accessors/Batch.js`, `createBatchingMatrixNode`) uses, at the indirect index `batch()` has already written
 *      (`batchIndirectIndex`). Only column 3 is fetched. Pinned against three 0.186.1 by `decor-mesh.node.test.ts`;
 *   2. the vertex's height over that origin, in WORLD space, from the BATCHED `positionLocal`: three r186's
 *      `NodeMaterial.setupPosition` runs `batch(object)` before `positionNode` (pinned too);
 *   3. the lean, `foliageLeanOps` (`wind.ts`), the one body the number tests run, on TSL nodes: mode 1 the wind, mode 0 the
 *      reduced-motion sway, `wet` and `trunk` as JS graph choices (the legacy material's compile-time variants);
 *   4. the world-space lean brought back to the object frame through `modelWorldMatrixInverse` (decor batches carry an identity
 *      `matrixWorld`, so this is the identity there; it keeps the twin right if a batch ever moves).
 *
 * **The rest pose outside the colour pass**, as on legacy, where the splice lives only in the material's own program (R-11,
 * `terrain-rendering.md`):
 *   - the shadow pass draws `castShadowPositionNode`, the rest position (three's own hook for it);
 *   - a `PassNode` override material (the node AO pre-pass's normal material, `post-chain.node.ts`) is handed THIS material's
 *     `positionNode` by three r186 (`Renderer.js`, "if ( material.positionNode && material.positionNode.isNode )
 *     overrideMaterial.positionNode = material.positionNode"), and three has no hook to stop it. So the `positionNode` itself returns
 *     the rest position when the program being built is not this twin's own (and not a shadow pass's, which the hook above owns).
 *
 * **The uniforms stay a record.** The legacy material carries `rlSway` (`SwayRecord`): the very objects its splice binds. Every value
 * is re-read each render (`onRenderUpdate`), numbers and the heading vector alike, so a debug write (`sway.amp`), the sim clock
 * (`sway.time`), the reduced-motion preference (`wind.mode`) and the map's wind reach the graph with no call-site change.
 *
 * **The disturbers (GH-984 N2 vehicles, N3 rotor wash) are not drawn yet** (T7): the twin declares the term in
 * `userData.rlUnportedTerms`, so the census names it. T7 adds them as a `FoliageTerm`, a world-space displacement computed from the
 * same `FoliageVertex` (rest position, origin, nature, clock), summed with the wind before the frame change, as the legacy chunk adds
 * both to `mvPosition`.
 *
 * Imports the backend's own addon-free modules and TYPES of the legacy files: the maths arrives as values (`FoliageMaths`), or the
 * node chunk would statically load the ThreeRenderer chunk (`MATERIAL_MATHS_MARKER`, `tools/src/perf/bundle-census.ts`).
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type { Material } from 'three';
import { tslIntOps, tslOps, type N, type Tsl } from '../fog-pass.node';
import { UNPORTED_TERMS_KEY } from '../backend/unported';
import type { MaterialTwinFactory } from '../backend/backend';
import type { NATURE_ATTRIBUTE, SwayRecord, SwayingFoliageMaterial } from './decor-mesh';
import type { foliageLeanOps } from './wind';

/** The foliage twin's shared maths, injected (`material-maths.ts`'s `MATERIAL_MATHS.foliage`). */
export interface FoliageMaths {
  readonly foliageLeanOps: typeof foliageLeanOps;
  readonly natureAttribute: typeof NATURE_ATTRIBUTE;
}

export interface NodeFoliageDeps {
  readonly W: typeof import('three/webgpu');
  readonly TSL: typeof import('three/tsl');
  readonly maths: FoliageMaths;
}

/** The twin's `name` prefix (`NODE_MATERIAL_MARKER`, `tools/src/perf/bundle-census.ts`), then the legacy key without its `rl-`. */
const NAME_PREFIX = 'rl-node-material-';

/** The partial term the twin declares until T7 ports the disturbers. */
export const FOLIAGE_UNPORTED_TERMS: readonly string[] = ['rl-foliage-sway: disturb'];

/** The slice of the node builder the position graph reads at build time. */
interface BuilderLike {
  readonly material: (Material & { isShadowPassMaterial?: boolean }) | null;
  readonly object: (THREE.Object3D & { isBatchedMesh?: boolean; _matricesTexture?: THREE.DataTexture }) | null;
}

/** The TSL members this file uses beyond `Tsl` (`fog-pass.node.ts`), as a structural handle, cast once. */
interface FoliageTsl {
  Fn(body: (builder: BuilderLike) => N): () => N;
  attribute(name: string, type: string): N;
  textureLoad(tex: unknown, uv?: N): N;
  textureSize(tex: N, level: number): N;
  float(a: N | number): N;
  int(a: N | number): N;
  ivec2(a: N, b: N): N;
  vec3(...a: Array<N | number>): N;
  vec4(...a: Array<N | number>): N;
  mat3(m: N): N;
  uniform(v: unknown): N;
  readonly positionLocal: N;
  readonly modelWorldMatrix: N;
  readonly modelWorldMatrixInverse: N;
  readonly batchIndirectIndex: N;
}

/** `N` plus the integer ops the origin fetch uses. */
interface NI extends N {
  mod(b: N): N;
  toInt(): N;
  readonly xz: N;
}

/** What a foliage term reads at one vertex: everything in WORLD space, from the REST position. */
export interface FoliageVertex {
  readonly TSL: typeof import('three/tsl');
  /** The vertex at rest (the batched `positionLocal`), world space. */
  readonly restWorld: N;
  /** The instance origin, world space. */
  readonly originWorld: N;
  /** `rlNature` (`.x` height in the family box, `.y` class). */
  readonly nature: N;
  /** `uSwayTime`, SIM seconds, bound to the record. */
  readonly time: N;
}

/** A world-space displacement (a `vec3` node) added to the wind's lean. T7's disturbers are one. */
export type FoliageTerm = (v: FoliageVertex) => N;

/** The record's values as the twin holds them (re-read every render). Exposed for the record gates. */
export interface FoliageBindings {
  readonly uSwayTime: N;
  readonly uSwayAmp: N;
  readonly uWindMode: N;
  readonly uWindStrength: N;
  readonly uWindDir: N;
}

const BINDINGS = new WeakMap<Material, FoliageBindings>();

/** The uniform nodes a foliage twin reads (null for any other material). */
export function nodeFoliageBindings(twin: Material): FoliageBindings | null {
  return BINDINGS.get(twin) ?? null;
}

/**
 * Three's batching-matrix fetch (`Batch.js`, `createBatchingMatrixNode`) for the TRANSLATION column only: texel `4 * id + 3` of the
 * matrices texture, laid out row-major in `size`-wide rows, at the indirect id `batch()` has already resolved.
 */
function batchOriginLocal(T: FoliageTsl, matrices: THREE.DataTexture): N {
  const size = T.int(T.textureSize(T.textureLoad(matrices), 0).x);
  const j = (T.float(T.batchIndirectIndex).mul(4) as NI).toInt() as NI;
  const x = j.mod(size);
  const y = j.div(size);
  return T.textureLoad(matrices, T.ivec2(x.add(3), y)).xyz;
}

/** The record a legacy swaying material carries; a material without one is not a foliage material, and adoption is a bug. */
function recordOf(legacy: THREE.MeshStandardMaterial): SwayRecord {
  const rec = (legacy as Partial<SwayingFoliageMaterial>).rlSway;
  if (rec === undefined) throw new Error('createNodeFoliageMaterial: the legacy material carries no rlSway record (not a swayingFoliageMaterial)');
  return rec;
}

/**
 * The twin of one legacy swaying material. `sway` is its record (`legacy.rlSway`); `variant` its two compile-time choices.
 * `terms` are further world-space displacements (T7), summed with the wind's.
 */
export function createNodeFoliageMaterial(
  deps: NodeFoliageDeps,
  legacy: THREE.MeshStandardMaterial,
  sway: SwayRecord,
  variant: { readonly wet: boolean; readonly trunk: boolean },
  terms: readonly FoliageTerm[] = []
): THREE.Material {
  const { W, maths } = deps;
  const T = deps.TSL as unknown as FoliageTsl;
  const o = tslOps(deps.TSL as unknown as Tsl);
  const io = tslIntOps(deps.TSL as unknown as Tsl);

  const twin = new W.MeshStandardNodeMaterial();
  twin.name = `${NAME_PREFIX}${sway.key.replace(/^rl-/, '')}`;
  // The ramp material's look, field by field (`NodeMaterial.copy` would read node slots a stock material does not have). The
  // colour is SHARED (a tinted batch's white is written before adoption; anything later writes the same object).
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
  // A fresh object: the env class tag travels, the twin's own terms never land on the legacy material.
  twin.userData = { ...(legacy.userData as Record<string, unknown>), [UNPORTED_TERMS_KEY]: [...FOLIAGE_UNPORTED_TERMS] };

  // The record, by reference: each value re-read every render.
  const bind = (rec: { readonly value: unknown }): N => {
    const n = T.uniform(rec.value);
    n.onRenderUpdate(() => {
      n.value = rec.value;
    });
    return n;
  };
  const bound: FoliageBindings = {
    uSwayTime: bind(sway.time),
    uSwayAmp: bind(sway.amp),
    uWindMode: bind(sway.wind.mode),
    uWindStrength: bind(sway.wind.strength),
    uWindDir: bind(sway.wind.dir),
  };
  BINDINGS.set(twin, bound);

  const wind: FoliageTerm = (v) => {
    const lean = maths.foliageLeanOps(
      o,
      io,
      {
        // `int(rlNature.y + 0.5)` in the legacy chunk; the class table's selects round at the same half-integers.
        cls: v.nature.y,
        hN: v.nature.x,
        worldH: v.restWorld.y.sub(v.originWorld.y),
        t: v.time,
        ox: v.originWorld.x,
        oz: v.originWorld.z,
        dirX: bound.uWindDir.x,
        dirZ: bound.uWindDir.y,
        strength: bound.uWindStrength,
        mode: bound.uWindMode,
        amp: bound.uSwayAmp,
      },
      variant.wet,
      variant.trunk
    );
    return T.vec3(lean.dx, 0, lean.dz);
  };

  const position = T.Fn((builder) => {
    const mat = builder.material;
    // Not this twin's own colour program, and not the shadow pass (which draws `castShadowPositionNode` below): an override pass
    // that three handed this `positionNode` to. Rest pose, as every legacy override material draws.
    if (mat !== twin && mat?.isShadowPassMaterial !== true) return T.positionLocal;
    const obj = builder.object;
    const matrices = obj?.isBatchedMesh === true ? obj._matricesTexture : undefined;
    const originLocal = matrices !== undefined ? batchOriginLocal(T, matrices) : T.vec3(0, 0, 0);
    // Vars, so each is fetched and transformed once however many terms (and select branches) read it.
    const v: FoliageVertex = {
      TSL: deps.TSL,
      restWorld: T.modelWorldMatrix.mul(T.vec4(T.positionLocal, 1)).xyz.toVar(),
      originWorld: T.modelWorldMatrix.mul(T.vec4(originLocal, 1)).xyz.toVar(),
      nature: T.attribute(maths.natureAttribute, 'vec2').toVar(),
      time: bound.uSwayTime,
    };
    let lean = wind(v);
    for (const term of terms) lean = lean.add(term(v));
    return T.positionLocal.add(T.mat3(T.modelWorldMatrixInverse).mul(lean));
  });
  twin.positionNode = position() as never;
  // The shadow keeps the rest pose, as on legacy (R-11).
  twin.castShadowPositionNode = T.positionLocal as never;
  return twin;
}

/** The backend's `foliage` factory: the twin of a legacy swaying material, from its own record. */
export function createFoliageTwinFactory(deps: NodeFoliageDeps): MaterialTwinFactory<THREE.MeshStandardMaterial> {
  return (legacy) => {
    const sway = recordOf(legacy);
    return createNodeFoliageMaterial(deps, legacy, sway, { wet: sway.wet, trunk: sway.trunk });
  };
}
