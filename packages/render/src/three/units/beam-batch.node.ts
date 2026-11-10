/**
 * GH-943 WebGPU P3 (T11): the NODE twin of the laser beam batch's material (`beam-batch.ts`): the tracer ribbon plus the `aShape.z`
 * kind branch, written branch-free (`beamShapeOps`, handed in as a value).
 *
 *   `colorNode = aColor` (the batch has already multiplied each quad's HDR gain in)
 *   `opacityNode = beamShapeOps(aAlpha, aShape).alpha`
 *
 * The legacy disc `discard`s where `r > 1`; its alpha factor is already 0 there, so under normal blending the pixel is unchanged
 * and the twin carries no discard.
 *
 * **The clock.** The geometry is rebuilt every frame on the SIM clock (the batch's own `add` calls); the twin has no clock and no
 * uniform of its own. A zero-time repaint moves nothing. The batch re-derives `mesh.visible` every frame (`finish`); the twin does
 * not touch it, and the census no longer hides a mesh whose material has a twin.
 *
 * ADDON-FREE. TSL arrives injected.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N } from '../fog-pass.node';
import type { Ops } from '../fog-ops';
import type { beamShapeOps } from './beam-batch';
import { finishFxTwin, type FxTwinDeps } from './fx.node';

/** The beam maths, INJECTED. */
export interface BeamMaths {
  readonly shapeOps: typeof beamShapeOps;
}

export const NODE_BEAM_NAME = 'rl-node-material-beam';

export function createNodeBeamMaterial(deps: FxTwinDeps<BeamMaths>): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL, maths } = deps;
  const o = tslOps(TSL) as Ops<N>;
  const aColor = TSL.attribute('aColor', 'vec3');
  const aAlpha = TSL.attribute('aAlpha', 'float');
  const aShape = TSL.attribute('aShape', 'vec3');
  const shape = maths.shapeOps(o, { alpha: aAlpha, shapeX: aShape.x, shapeY: aShape.y, kind: aShape.z });
  const m = new W.MeshBasicNodeMaterial();
  m.colorNode = aColor as never;
  m.opacityNode = shape.alpha as never;
  finishFxTwin(m, NODE_BEAM_NAME, {});
  return m;
}
