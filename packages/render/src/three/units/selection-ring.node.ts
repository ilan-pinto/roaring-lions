/**
 * GH-943 WebGPU P2 (T5): the NODE twin of `selection-ring.ts`. The selection ring, the team ring and the wound ring (arc mode) as one
 * TSL material: an unlit, fog-blind `MeshBasicNodeMaterial`, premultiplied "over", exactly the legacy blend.
 *
 *   `colorNode   = vColor * ca + haloColor * ha * (1 - ca)`
 *   `opacityNode = ca + ha * (1 - ca)`            discarded where it is <= 0
 *
 * The coverage (`ca`, `ha`) is `ringFragmentOps`, written ONCE against `Ops<T>` in the legacy file and handed here as a value
 * (`material-maths.ts`): a value import would make the node chunk statically load the ThreeRenderer chunk, and the bundle census
 * fails on exactly that.
 *
 * **The uniforms stay a record.** The batch (`SelectionRingBatch`) writes `uPxPerTile`, `uHaloColor`, and in arc mode `uTimeSec` and
 * `uPulseOn` into the legacy material's `uniforms` table on both paths. The twin reads that table: the vector by reference, the
 * numbers re-read every render (`onRenderUpdate`), because `endFrame` replaces `.value` on a number. The pulse reads the SIM clock
 * through `uTimeSec` and nothing else, so a zero-time repaint moves nothing.
 *
 * Attributes `aOffset`, `aRingColor`, `aAxes` and (arc styles only) `aArc`. No `normal` attribute, so the ring stays out of the AO
 * pre-pass. `renderOrder` lives on the mesh (`render-order.ts`) and is untouched; the decal polygon offset and `DoubleSide` are the
 * legacy material's. Depth test on, depth write off.
 *
 * ADDON-FREE. TSL arrives injected; nothing here imports `three/webgpu` or `three/tsl` at runtime.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N, type Tsl } from '../fog-pass.node';
import type { Ops } from '../fog-ops';
import type { DECAL_POLYGON_OFFSET_FACTOR, DECAL_POLYGON_OFFSET_UNITS } from '../decal-pool';
import type { RingStyle, ringFragmentOps } from './selection-ring';

/** The shared ring maths, INJECTED (see the header): `material-maths.ts`'s `ring` slot. */
export interface RingMaths {
  readonly fragmentOps: typeof ringFragmentOps;
  readonly polygonOffsetFactor: typeof DECAL_POLYGON_OFFSET_FACTOR;
  readonly polygonOffsetUnits: typeof DECAL_POLYGON_OFFSET_UNITS;
  /** `SELECTION_RING.haloTiles + featherTiles`: the grid's half-extent beyond the semi-axes (the vertex shader's `HALO + F`). */
  readonly halfExtraTiles: number;
}

/** The slice of the legacy uniform record the twin reads (the legacy material owns it; the batch writes it). */
export interface RingUniformRecord {
  readonly uPxPerTile: { value: number };
  readonly uHaloColor: { value: THREE.Vector3 };
  readonly uTimeSec?: { value: number };
  readonly uPulseOn?: { value: number };
}

export interface RingTwinDeps {
  readonly W: typeof WEBGPU;
  readonly TSL: Tsl & { attribute(name: string, type: string): N };
  readonly maths: RingMaths;
}

/** What a test may read back: the bound number uniforms, by record key. */
export interface RingTwinBound {
  readonly uPxPerTile: N;
  readonly uTimeSec?: N;
  readonly uPulseOn?: N;
}

/** The `userData` key the legacy ring material carries its `RingStyle` under. A COPY of `selection-ring.ts`'s `RING_STYLE_KEY` (a value
 *  import would drag the legacy chunk in); `selection-ring.node.test.ts` pins the two equal. */
export const RING_STYLE_KEY = 'rlRingStyle';

export const NODE_RING_MATERIAL_NAME = 'rl-node-material-selection-ring';

/** `RingTwinBound` rides on `userData` so the vitest can reach the nodes it must `update()`. */
export const RING_BOUND_KEY = 'rlRingBound';

export function createNodeRingMaterial(deps: RingTwinDeps, style: RingStyle, uniforms: RingUniformRecord): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL, maths } = deps;
  const o = tslOps(TSL) as Ops<N>;
  const arc = style.arcThicken !== undefined;

  // Numbers are re-read from the record each render; the halo colour is shared by reference.
  const num = (rec: { value: number }): N => {
    const n = TSL.uniform(rec.value);
    n.onRenderUpdate(() => {
      n.value = rec.value;
    });
    return n;
  };
  const uPxPerTile = num(uniforms.uPxPerTile);
  const uHaloColor = TSL.uniform(uniforms.uHaloColor.value);

  const aOffset = TSL.attribute('aOffset', 'vec2');
  const aAxes = TSL.attribute('aAxes', 'vec2');
  const aRingColor = TSL.attribute('aRingColor', 'vec3');
  // vLocal: the fragment's position in the ring's own frame, tiles. The grid's half-extent is the semi-axes plus halo and feather.
  const local = aOffset.mul(aAxes.add(TSL.vec2(maths.halfExtraTiles, maths.halfExtraTiles)));

  let bound: RingTwinBound = { uPxPerTile };
  let arcInputs: { fraction: N; pulse: N; timeSec: N; pulseOn: N } | undefined;
  if (arc) {
    if (uniforms.uTimeSec === undefined || uniforms.uPulseOn === undefined) {
      throw new Error('node ring twin: an arc style needs uTimeSec and uPulseOn in the uniform record');
    }
    const uTimeSec = num(uniforms.uTimeSec);
    const uPulseOn = num(uniforms.uPulseOn);
    const aArc = TSL.attribute('aArc', 'vec2');
    arcInputs = { fraction: aArc.x, pulse: aArc.y, timeSec: uTimeSec, pulseOn: uPulseOn };
    bound = { uPxPerTile, uTimeSec, uPulseOn };
  }

  const cov = maths.fragmentOps(o, style, {
    localX: local.x,
    localZ: local.y,
    axA: aAxes.x,
    axB: aAxes.y,
    pxPerTile: uPxPerTile,
    arc: arcInputs,
  });
  const oneMinusCa = o.sub(o.lit(1), cov.ca);

  const m = new W.MeshBasicNodeMaterial();
  m.name = NODE_RING_MATERIAL_NAME;
  m.colorNode = aRingColor.mul(cov.ca).add(uHaloColor.mul(cov.ha).mul(oneMinusCa)) as never;
  m.opacityNode = cov.a as never;
  // `a <= 0` is discarded, as the legacy shader's `discard`.
  m.maskNode = cov.a.greaterThan(0) as never;
  m.transparent = true;
  m.blending = W.CustomBlending;
  m.blendEquation = W.AddEquation;
  m.blendSrc = W.OneFactor;
  m.blendDst = W.OneMinusSrcAlphaFactor;
  m.blendEquationAlpha = W.AddEquation;
  m.blendSrcAlpha = W.OneFactor;
  m.blendDstAlpha = W.OneMinusSrcAlphaFactor;
  m.depthTest = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = maths.polygonOffsetFactor;
  m.polygonOffsetUnits = maths.polygonOffsetUnits;
  m.side = W.DoubleSide;
  // Unlit and fog-blind: the ring is a flat mark, and the scene pass is linear (the output stage tone-maps).
  m.fog = false;
  m.toneMapped = false;
  m.userData[RING_BOUND_KEY] = bound;
  return m;
}
