/**
 * GH-943 WebGPU P3 (T5): the NODE twin of `silhouette.ts`'s outline material. The occlusion outline (three team materials) and the smoke
 * outline (two more, built the same way with `depthTest: false`), and the hit flash's outline, as one TSL material: an unlit, fog-blind
 * `MeshBasicNodeMaterial` in the legacy material's own colour.
 *
 *   rigid    `positionNode = positionLocal + aExpand · uOutlineWidth`
 *   skinned  `positionNode = positionLocal + bindInverse · (Σ wᵢ · boneᵢ) · bind · aExpand · uOutlineWidth`
 *   both     `vertexNode   = cameraProjectionMatrix · vec4(positionView.xy, positionView.z + uSilhouetteDepthBias, 1)`
 *
 * **The expansion.** The legacy material adds the offset before skinning, so the bone that owns the vertex carries it. three r186 skins
 * BEFORE `positionNode` (`NodeMaterial.setupPosition`), so `positionLocal` here is already skinned, and the twin skins the expansion
 * DIRECTION itself: `outlineExpandOps` (`silhouette.ts`, written once against `Ops<T>`, handed here as a value, `material-maths.ts`).
 * It reads the same inputs the skinning node reads: `skinIndex`, `skinWeight`, `bindMatrix`, `bindMatrixInverse`, and the skeleton's
 * `boneMatrices` (the uniform buffer, or the bone texture when the skeleton outgrows the buffer limit, exactly the skinning node's rule).
 *
 * **The bias** is a view-space push toward the camera, `mvPosition.z += uSilhouetteDepthBias` in the legacy material, so it is added
 * to `positionView.z` BEFORE the projection, never as an NDC term (WebGPU's depth range is 0..1, WebGL's -1..1).
 *
 * **The uniforms stay a record.** The legacy material parks its two uniform objects on `userData` (`SILHOUETTE_OUTLINE_UNIFORM_KEY`,
 * `SILHOUETTE_DEPTH_BIAS_UNIFORM_KEY`), and `setSilhouetteOutlineZoom` writes `.value` once a frame. The twin re-reads both every
 * render. The colour is the legacy material's own `Color` object (shared, not copied), so `setTeamColors` and the smoke outline's
 * `color.copy` recolour the twin in place.
 *
 * **The state** (`GreaterDepth`, `BackSide`, `depthWrite: false`, the `NotEqual`/`Keep` stencil test; the smoke and flash outlines'
 * `depthTest: false`) is the legacy material's, carried by adoption's `copyRenderState`; the factory sets it too, so a twin built
 * outside adoption is not a blob. The body side of the mechanism (every unit body stamps the stencil, `markSilhouetteOccludee`) is the
 * unit materials' state, carried to their twins the same way.
 *
 * ADDON-FREE. TSL arrives injected; nothing here imports `three/webgpu` or `three/tsl` at runtime.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N, type Tsl } from '../fog-pass.node';
import type { Ops } from '../fog-ops';
import type {
  OutlineMat3,
  OutlineSkin,
  outlineExpandOps,
  SILHOUETTE_DEPTH_BIAS_UNIFORM_KEY,
  SILHOUETTE_EXPAND_ATTRIBUTE,
  SILHOUETTE_OUTLINE_UNIFORM_KEY,
} from './silhouette';

/** The shared outline maths and names, INJECTED (see the header): `material-maths.ts`'s `outline` slot. */
export interface OutlineMaths {
  readonly expandOps: typeof outlineExpandOps;
  readonly expandAttribute: typeof SILHOUETTE_EXPAND_ATTRIBUTE;
  readonly widthKey: typeof SILHOUETTE_OUTLINE_UNIFORM_KEY;
  readonly biasKey: typeof SILHOUETTE_DEPTH_BIAS_UNIFORM_KEY;
}

/** The slice of the node builder the position graph reads (the object it is building for, and the uniform-buffer limit). */
export interface OutlineBuilder {
  readonly object: THREE.Object3D;
  getUniformBufferLimit(): number;
}

/** The TSL surface this twin uses beyond `Tsl` (structural, cast once at the factory: see `fog-pass.node.ts`'s `N`). */
export interface OutlineTsl extends Omit<Tsl, 'Fn'> {
  attribute(name: string, type: string): N;
  reference(name: string, type: string): N;
  referenceBuffer(name: string, type: string, count: number): N;
  textureSize(t: N): N;
  ivec2(x: N, y: N): N;
  mat4(...cols: N[]): N;
  OnObjectUpdate(cb: (frame: { object: THREE.Object3D }) => void): void;
  Fn(body: (builder: OutlineBuilder) => N): () => N;
  readonly positionLocal: N;
  readonly positionView: N;
  readonly cameraProjectionMatrix: N;
}

export interface OutlineTwinDeps {
  readonly W: typeof WEBGPU;
  readonly TSL: OutlineTsl;
  readonly maths: OutlineMaths;
}

/** What a test may read back: the two bound number uniforms. */
export interface OutlineTwinBound {
  readonly uOutlineWidth: N;
  readonly uSilhouetteDepthBias: N;
}

export const NODE_OUTLINE_MATERIAL_NAME = 'rl-node-material-silhouette-outline';

/** `OutlineTwinBound` rides on `userData` so the vitest can reach the nodes it must `update()`. */
export const OUTLINE_BOUND_KEY = 'rlOutlineBound';

/** The skinning node's bone-matrix accessor for `object`'s skeleton: the uniform buffer, or the bone texture past the buffer limit. */
function boneMatrices(TSL: OutlineTsl, builder: OutlineBuilder): (i: N) => N {
  const skeleton = (builder.object as THREE.SkinnedMesh).skeleton;
  const count = skeleton.bones.length;
  if (count * 16 * 4 <= builder.getUniformBufferLimit()) {
    const buf = TSL.referenceBuffer('skeleton.boneMatrices', 'mat4', count);
    return (i) => buf.element(i as unknown as number);
  }
  if (skeleton.boneTexture === null) skeleton.computeBoneTexture();
  const tex = TSL.texture(skeleton.boneTexture);
  TSL.OnObjectUpdate(({ object }) => {
    const s = (object as THREE.SkinnedMesh).skeleton;
    if (s.boneTexture === null) s.computeBoneTexture();
    tex.value = s.boneTexture;
  });
  return (i) => {
    const size = TSL.int(TSL.textureSize(tex).x);
    const j = TSL.int(i).mul(4);
    const y = j.div(size);
    const x = j.sub(y.mul(size));
    const load = (dx: number): N => (tex as unknown as { load(uv: N): N }).load(TSL.ivec2(x.add(dx), y));
    return TSL.mat4(load(0), load(1), load(2), load(3));
  };
}

/** The linear 3x3 of a mat4 node, column-major (`m[c].x, m[c].y, m[c].z`). */
function linear(m: N): OutlineMat3<N> {
  const c = [0, 1, 2].map((k) => m.element(k));
  const [c0, c1, c2] = c as [N, N, N];
  return [c0.x, c0.y, c0.z, c1.x, c1.y, c1.z, c2.x, c2.y, c2.z];
}

/**
 * The skinning inputs of the vertex being built, as `outlineExpandOps` takes them, or null for a rigid mesh. Exported for the vitest:
 * `skinned` is `builder.object.isSkinnedMesh`, the one switch between the two expansions.
 */
export function outlineSkinOf(TSL: OutlineTsl, builder: OutlineBuilder): OutlineSkin<N> | null {
  if ((builder.object as THREE.SkinnedMesh).isSkinnedMesh !== true) return null;
  const skinIndex = TSL.attribute('skinIndex', 'uvec4');
  const skinWeight = TSL.attribute('skinWeight', 'vec4');
  const bone = boneMatrices(TSL, builder);
  return {
    weights: [skinWeight.x, skinWeight.y, skinWeight.z, skinWeight.w],
    bones: [linear(bone(skinIndex.x)), linear(bone(skinIndex.y)), linear(bone(skinIndex.z)), linear(bone(skinIndex.w))],
    bind: linear(TSL.reference('bindMatrix', 'mat4')),
    bindInverse: linear(TSL.reference('bindMatrixInverse', 'mat4')),
  };
}

export function createNodeOutlineMaterial(deps: OutlineTwinDeps, legacy: THREE.MeshBasicMaterial): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL, maths } = deps;
  const o = tslOps(TSL as unknown as Tsl) as Ops<N>;
  const data = legacy.userData as Record<string, unknown>;
  const record = (key: string): { value: number } => {
    const r = data[key] as { value: number } | undefined;
    if (r === undefined || typeof r.value !== 'number') throw new Error(`node outline twin: the legacy material has no ${key} uniform record`);
    return r;
  };
  // Numbers are re-read from the record every render: `setSilhouetteOutlineZoom` replaces `.value` once a frame.
  const num = (rec: { value: number }): N => {
    const n = TSL.uniform(rec.value);
    n.onRenderUpdate(() => {
      n.value = rec.value;
    });
    return n;
  };
  const uOutlineWidth = num(record(maths.widthKey));
  const uSilhouetteDepthBias = num(record(maths.biasKey));
  const aExpand = TSL.attribute(maths.expandAttribute, 'vec3');

  const m = new W.MeshBasicNodeMaterial();
  m.name = NODE_OUTLINE_MATERIAL_NAME;
  m.positionNode = TSL.Fn((builder) => {
    const off = maths.expandOps(o, [aExpand.x, aExpand.y, aExpand.z], uOutlineWidth, outlineSkinOf(TSL, builder));
    return TSL.positionLocal.add(TSL.vec3(...off));
  })() as never;
  const view = TSL.positionView;
  m.vertexNode = TSL.cameraProjectionMatrix.mul(TSL.vec4(view.x, view.y, view.z.add(uSilhouetteDepthBias), 1)) as never;
  // The legacy material's own Color object: recoloured in place (`setTeamColors`, the smoke outline's `copy`), never re-copied.
  m.color = legacy.color;
  m.opacity = legacy.opacity;
  m.transparent = legacy.transparent;
  m.depthTest = legacy.depthTest;
  m.depthWrite = legacy.depthWrite;
  m.depthFunc = legacy.depthFunc;
  m.side = legacy.side;
  m.stencilWrite = legacy.stencilWrite;
  m.stencilFunc = legacy.stencilFunc;
  m.stencilRef = legacy.stencilRef;
  m.stencilFuncMask = legacy.stencilFuncMask;
  m.stencilWriteMask = legacy.stencilWriteMask;
  m.stencilFail = legacy.stencilFail;
  m.stencilZFail = legacy.stencilZFail;
  m.stencilZPass = legacy.stencilZPass;
  m.visible = legacy.visible;
  // Unlit and fog-blind: a flat team colour into the linear scene target (the output stage tone-maps).
  m.fog = false;
  m.toneMapped = false;
  const bound: OutlineTwinBound = { uOutlineWidth, uSilhouetteDepthBias };
  m.userData[OUTLINE_BOUND_KEY] = bound;
  return m;
}
