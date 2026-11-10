/**
 * GH-943 WebGPU P3 (T11): the NODE twin of the two rim-fade materials, the smoke plume (`smoke-plume.ts`) and the collapse shroud
 * (`collapse-shroud.ts`). One recipe, three options:
 *
 *   `alpha = density * aOpacity * smoothstep(0, softness, |viewNormal.z|) * thin`, discarded where it is <= 0
 *
 *   - `thin`: the plume's dispersal fade `mix(1, topDensity, vHeight)`, with `vHeight = clamp(position.y / uHeight, 0, 1)`;
 *   - `colourBy`: `'uniform'` is the plume's flat `uColor`; `'shade'` is the shroud's three-entry table (`uDeep`, `uBody`, `uCrown`),
 *     picked per instance by `aShade` at the legacy thresholds (resolved in the vertex stage, as the legacy shader does);
 *   - `side`: the legacy material's face culling (adoption copies it; the plume is `FrontSide`, the shroud `BackSide`).
 *
 * **The normal.** `|N.V|` is `abs(viewNormal.z)` because the camera is orthographic. three's own instancing step transforms the local
 * normal by `mat3(M) * (n / |column|^2)`, which IS the plume's exact non-uniform-scale correction (the legacy shader spells it
 * out), and for the shroud's uniform scale differs from `mat3(M) * n` only by a positive factor the `normalize` removes. So both
 * read `normalLocal` after the instance step, and `rim-fade.node.test.ts` pins the program text.
 *
 * **Clocks.** None of its own: the manager writes `aOpacity` on the FRAME clock. A zero-time repaint moves nothing.
 *
 * **The uniforms stay a record.** `uColor` / `uDeep` / `uBody` / `uCrown` are `Color`s shared by reference (the manager's
 * `setColors` copies into them in place), `uHeight` a number re-read every render. The managers hold their legacy materials apart
 * (`SmokePlumeManager.materials`, `CollapseShroudManager.material`), never through `mesh.material`, which is the twin once adopted.
 *
 * ADDON-FREE. TSL arrives injected.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N } from '../fog-pass.node';
import type { Ops } from '../fog-ops';
import type { COLLAPSE_SHROUD_SHADE_BREAKS } from './collapse-shroud';
import type { rimFadeOps } from './smoke-plume';
import { finishFxTwin, recordNumber, type FxTwinDeps, type FxTwinBound, type HasUniforms, type NX } from './fx.node';

/** The rim-fade maths and constants, INJECTED (`material-maths.ts`'s `rimFade` slot). */
export interface RimFadeMaths {
  readonly ops: typeof rimFadeOps;
  readonly plume: { readonly softness: number; readonly density: number; readonly topDensity: number };
  readonly shroud: { readonly softness: number; readonly density: number; readonly shadeBreaks: typeof COLLAPSE_SHROUD_SHADE_BREAKS };
}

export interface RimFadeOptions {
  /** The legacy material's face culling (`THREE.FrontSide` / `BackSide`). */
  readonly side: THREE.Side;
  /** The plume's dispersal fade. */
  readonly thin: boolean;
  /** `'uniform'`: one `uColor`. `'shade'`: the shroud's three-entry table by `aShade`. */
  readonly colourBy: 'uniform' | 'shade';
}

export const NODE_RIM_FADE_NAME = 'rl-node-material-rim-fade';

/** The plume's options and the shroud's, as the node backend picks them from the legacy material's name. */
export function rimFadeOptionsFor(W: { FrontSide: THREE.Side; BackSide: THREE.Side }, legacyName: string): RimFadeOptions {
  return legacyName === 'rl-collapse-shroud'
    ? { side: W.BackSide, thin: false, colourBy: 'shade' }
    : { side: W.FrontSide, thin: true, colourBy: 'uniform' };
}

export function createNodeRimFadeMaterial(deps: FxTwinDeps<RimFadeMaths>, legacy: HasUniforms, opts: RimFadeOptions): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL, maths } = deps;
  const o = tslOps(TSL) as Ops<N>;
  const u = legacy.uniforms;
  const cfg = opts.colourBy === 'shade' ? maths.shroud : maths.plume;

  // |N.V|: the view-space z of the instance-transformed normal (orthographic camera), resolved in the vertex stage.
  const viewNormal = TSL.normalize(TSL.mat3(TSL.modelViewMatrix).mul(TSL.normalLocal));
  const facing = TSL.varying(TSL.abs(viewNormal.z));
  const aOpacity = TSL.attribute('aOpacity', 'float');

  const bound: FxTwinBound = {};
  const rec = (key: string): unknown => {
    const r = u[key];
    if (r === undefined) throw new Error(`node rim-fade twin: the legacy material has no ${key} uniform`);
    return r.value;
  };
  let height: N | undefined;
  if (opts.thin) {
    const uHeight = recordNumber(TSL, { get value(): number { return rec('uHeight') as number; } });
    bound.uHeight = uHeight;
    height = TSL.varying(TSL.clamp(TSL.positionGeometry.y.div(uHeight), 0, 1));
  }
  const a = maths.ops(o, { facing, opacity: aOpacity, softness: cfg.softness, density: cfg.density, height, topDensity: opts.thin ? maths.plume.topDensity : undefined });

  let colour: N;
  if (opts.colourBy === 'shade') {
    const aShade = TSL.attribute('aShade', 'float');
    const uDeep = TSL.uniform(rec('uDeep'));
    const uBody = TSL.uniform(rec('uBody'));
    const uCrown = TSL.uniform(rec('uCrown'));
    bound.uDeep = uDeep;
    bound.uBody = uBody;
    bound.uCrown = uCrown;
    const [b0, b1] = maths.shroud.shadeBreaks;
    colour = TSL.varying(TSL.select(aShade.lessThan(b0), uDeep, TSL.select(aShade.lessThan(b1), uBody, uCrown)));
  } else {
    const uColor = TSL.uniform(rec('uColor'));
    bound.uColor = uColor;
    colour = uColor;
  }

  const m = new W.MeshBasicNodeMaterial();
  m.colorNode = TSL.vec3(colour) as never;
  m.opacityNode = a.alpha as never;
  // `a <= 0` is discarded, as the legacy shader's `discard`.
  m.maskNode = (a.alpha as NX).greaterThan(0) as never;
  m.side = opts.side;
  finishFxTwin(m, NODE_RIM_FADE_NAME, bound);
  return m;
}
