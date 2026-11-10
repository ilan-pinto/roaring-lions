/**
 * GH-943 WebGPU P3 (T11): the NODE twins of the simple FX materials in `fx.ts` and `vfx-mesh-material.ts`: the particle disc and the
 * tracer ribbon (the flat-colour FX mesh is `vfx-mesh-material.node.ts`). Each is an unlit, fog-blind `MeshBasicNodeMaterial` that reads the legacy material's
 * own record and the batch's own attributes; the pipeline state (blend, depth, side) is the legacy material's, copied by adoption
 * (`copyRenderState`). `toneMapped = false` and `fog = false`: the legacy shaders write LINEAR colour straight into the HalfFloat
 * scene target.
 *
 *   particle   `colorNode = aColor (* sparks gain on the hot core)`, `opacityNode = softParticleOps(...).alpha`, discarded outside the disc
 *   tracer     `colorNode = aColor * uHdr`, `opacityNode = aAlpha`
 *
 * **The clocks.** None of these animates on a clock of its own: the batches write the attributes on the FRAME clock, and the twin
 * reads them. A zero-time repaint therefore moves nothing; `fx.node.test.ts` pins that the graph binds no uniform but the legacy
 * record's.
 *
 * **The uniforms stay a record.** `uHdr` (a number, re-read every render) belongs to the legacy
 * material; the twin reads them. The writers hold their legacy material apart (`MuzzleFlashManager.materials`,
 * `ShellBatch`'s local), never through `mesh.material`, which is the twin once adopted.
 *
 * The shared maths arrives as a VALUE (`material-maths.ts`): a value import of `fx.ts` would make the node chunk load the
 * ThreeRenderer chunk. `HDR_GAINS.sparks` is handed in the same way (never re-typed here).
 *
 * ADDON-FREE. TSL arrives injected.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N, type Tsl } from '../fog-pass.node';
import type { Ops } from '../fog-ops';
import type { softParticleOps } from './fx';

/** `N` plus the comparison the discard tests use. */
export type NX = N & { lessThanEqual(b: N | number): N };

/** The TSL slice the FX twins use: the base `Tsl` plus the attribute reader and the vertex-stage handles (rim-fade, rotor). */
export type FxTsl = Tsl & {
  attribute(name: string, type: string): N;
  varying(n: N): N;
  readonly positionGeometry: N;
  readonly normalLocal: N;
  readonly modelViewMatrix: N;
  mat3(n: N): N;
  normalize(n: N): N;
};

export interface FxTwinDeps<M> {
  readonly W: typeof WEBGPU;
  readonly TSL: FxTsl;
  readonly maths: M;
}

/** The particle maths, INJECTED: `softParticleOps` and `HDR_GAINS.sparks` as a value. */
export interface ParticleMaths {
  readonly softOps: typeof softParticleOps;
  readonly sparksGain: number;
}

/** The legacy material name of the hot-core sibling (`createParticleMaterial(_, true)`); `fx.node.test.ts` pins it to the legacy spelling. */
export const HOT_PARTICLE_NAME = 'rl-fx-particle-hot';

/** What a test may read back: the bound uniform nodes, by record key. */
export type FxTwinBound = Record<string, N>;

/** `userData` key a twin carries its `FxTwinBound` under (the vitest must `update()` these nodes). */
export const FX_BOUND_KEY = 'rlFxBound';

export const NODE_PARTICLE_NAME = 'rl-node-material-fx-particle';
export const NODE_PARTICLE_HOT_NAME = 'rl-node-material-fx-particle-hot';
export const NODE_TRACER_NAME = 'rl-node-material-fx-tracer';

/** A number uniform that re-reads its legacy record every render (`endFrame`-style writers replace `.value`). */
export function recordNumber(TSL: { uniform(v: unknown): N }, rec: { value: number }): N {
  const n = TSL.uniform(rec.value);
  n.onRenderUpdate(() => {
    n.value = rec.value;
  });
  return n;
}

/** The state every FX twin shares: linear into the HalfFloat target, no fog (the legacy shaders write `gl_FragColor` directly). */
export function finishFxTwin(m: WEBGPU.MeshBasicNodeMaterial, name: string, bound: FxTwinBound): void {
  m.name = name;
  m.fog = false;
  m.toneMapped = false;
  m.userData[FX_BOUND_KEY] = bound;
}

export function createNodeParticleMaterial(deps: FxTwinDeps<ParticleMaths>, legacy: THREE.Material): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL, maths } = deps;
  const o = tslOps(TSL) as Ops<N>;
  const hotCore = legacy.name === HOT_PARTICLE_NAME;

  const aLocal = TSL.attribute('aLocal', 'vec2');
  const aColor = TSL.attribute('aColor', 'vec3');
  const aAlpha = TSL.attribute('aAlpha', 'float');
  const aSoft = TSL.attribute('aSoft', 'float');
  const cov = maths.softOps(o, { localX: aLocal.x, localY: aLocal.y, alpha: aAlpha, soft: aSoft }, hotCore);

  const m = new W.MeshBasicNodeMaterial();
  m.colorNode = (hotCore ? aColor.mul(maths.sparksGain) : aColor) as never;
  m.opacityNode = cov.alpha as never;
  // The hard circle cutout: the fragment is discarded outside the unit disc.
  m.maskNode = (cov.r2 as NX).lessThanEqual(1) as never;
  finishFxTwin(m, hotCore ? NODE_PARTICLE_HOT_NAME : NODE_PARTICLE_NAME, {});
  return m;
}

/** A legacy material, structurally: the uniform record it owns (the twin never names the legacy class). */
export interface HasUniforms extends THREE.Material {
  readonly uniforms: Record<string, { value: unknown }>;
}

/** The legacy record the tracer reads. */
export interface TracerUniformRecord {
  readonly uHdr: { value: number };
}

export function createNodeTracerMaterial(deps: FxTwinDeps<null>, legacy: HasUniforms): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL } = deps;
  const uHdr = recordNumber(TSL, (legacy.uniforms as unknown as TracerUniformRecord).uHdr);
  const aColor = TSL.attribute('aColor', 'vec3');
  const aAlpha = TSL.attribute('aAlpha', 'float');
  const m = new W.MeshBasicNodeMaterial();
  m.colorNode = aColor.mul(uHdr) as never;
  m.opacityNode = aAlpha as never;
  finishFxTwin(m, NODE_TRACER_NAME, { uHdr });
  return m;
}
