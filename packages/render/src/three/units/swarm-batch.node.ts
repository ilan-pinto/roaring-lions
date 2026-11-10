/**
 * GH-943 WebGPU P3 (T11): the NODE twin of the drone swarm's ROTOR BLUR material (`swarm-batch.ts`). The swarm's bodies and wrecks are
 * stock `MeshStandardMaterial`s that already draw on node; only the blur disc carried a hand-written shader.
 *
 *   `spin    = rotorSpinOps(aPhase, aHub)`                   the vertex stage: neighbouring hubs turn opposite ways
 *   `alpha   = rotorBlurOps({aDisc, spin}).alpha`            two-blade streak `pow(|cos(2 (ang - spin))|, 18)`, hub guard `r < 1e-4 -> ang 0`
 *   `colorNode = uColor`, discarded where `r > 1`
 *
 * **The clock.** `aPhase` is written by the batch on the SIM clock (`SwarmBatch`'s frame env); the twin reads the attribute and has
 * no clock or uniform of its own, so a zero-time repaint moves nothing.
 *
 * `uColor` (the shadow tone) is shared by reference with the legacy material.
 *
 * ADDON-FREE. TSL arrives injected.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N } from '../fog-pass.node';
import type { Ops } from '../fog-ops';
import type { rotorBlurOps, rotorSpinOps } from './swarm-batch';
import { finishFxTwin, type FxTwinDeps, type HasUniforms, type NX } from './fx.node';

/** The rotor maths, INJECTED. */
export interface RotorMaths {
  readonly blurOps: typeof rotorBlurOps;
  readonly spinOps: typeof rotorSpinOps;
}

export const NODE_ROTOR_NAME = 'rl-node-material-swarm-rotors';

export function createNodeRotorMaterial(deps: FxTwinDeps<RotorMaths>, legacy: HasUniforms): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL, maths } = deps;
  const o = tslOps(TSL) as Ops<N>;
  const rec = legacy.uniforms.uColor;
  if (rec === undefined) throw new Error('node rotor twin: the legacy material has no uColor uniform');
  const uColor = TSL.uniform(rec.value);
  const aDisc = TSL.attribute('aDisc', 'vec2');
  const aHub = TSL.attribute('aHub', 'float');
  const aPhase = TSL.attribute('aPhase', 'float');
  // The spin is a vertex-stage value, as the legacy shader's `vSpin`.
  const spin = TSL.varying(maths.spinOps(o, aPhase, aHub));
  const blur = maths.blurOps(o, { discX: aDisc.x, discY: aDisc.y, spin });
  const m = new W.MeshBasicNodeMaterial();
  m.colorNode = TSL.vec3(uColor) as never;
  m.opacityNode = blur.alpha as never;
  m.maskNode = (blur.r as NX).lessThanEqual(1) as never;
  finishFxTwin(m, NODE_ROTOR_NAME, { uColor });
  return m;
}
