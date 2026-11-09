/**
 * GH-943 WebGPU P3 (T8): the NODE twin of the zone band's material (`zone-band.ts`, `createZoneBandMaterial`): the hatched band an
 * objective zone draws inside its own edge, as one `MeshBasicNodeMaterial`.
 *
 *   `stripe      = zoneHatchOps(positionWorld.x, positionWorld.z)`    the soft diagonal stripe, `fract((x + z) / period)`
 *   `colorNode   = mix(1, aColor, aAlpha * stripe)`
 *   `opacityNode = 1`
 *
 * The stripe is `zoneHatchOps`, written ONCE against `Ops<T>` in the legacy file and handed here as a value (`material-maths.ts`): a
 * value import would make the node chunk statically load the ThreeRenderer chunk, and the bundle census fails on exactly that.
 *
 * The blend is the decal pool's multiply (`DstColor * Zero`, alpha kept), depth-tested, not depth-writing, with the decal polygon
 * offset: all the legacy material's, copied by adoption (`copyRenderState`). The mix is 1 (a no-op multiply) outside a stripe and the
 * zone colour inside, so the band takes the scene's light, shadow and fog instead of glowing. The hatch reads the WORLD position, so
 * it holds still on the ground as the camera pans; `renderOrder` stays on the mesh.
 *
 * Attributes `aColor` (vec3, linear) and `aAlpha` (float, the stripe's strength). No `normal`: the AO pre-pass skips it.
 *
 * ADDON-FREE. TSL arrives injected; nothing here imports `three/webgpu` or `three/tsl` at runtime.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N } from '../fog-pass.node';
import type { Ops } from '../fog-ops';
import type { zoneHatchOps } from './zone-band';
import { NODE_MATERIAL_PREFIX, type BatchTwinDeps } from './overlays.node';

/** The shared hatch maths, INJECTED (`material-maths.ts`'s `zoneBand` slot). */
export interface ZoneBandMaths {
  readonly hatchOps: typeof zoneHatchOps;
}

export interface ZoneBandTwinDeps extends BatchTwinDeps {
  readonly maths: ZoneBandMaths;
}

export const NODE_ZONE_BAND_MATERIAL_NAME = `${NODE_MATERIAL_PREFIX}zone-band`;

export function createNodeZoneBandMaterial(deps: ZoneBandTwinDeps): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL, maths } = deps;
  const o = tslOps(TSL) as Ops<N>;
  const world = TSL.positionWorld;
  const stripe = maths.hatchOps(o, world.x, world.z);
  const aColor = TSL.attribute('aColor', 'vec3');
  const aAlpha = TSL.attribute('aAlpha', 'float');
  const m = new W.MeshBasicNodeMaterial();
  m.name = NODE_ZONE_BAND_MATERIAL_NAME;
  m.colorNode = TSL.mix(TSL.vec3(1, 1, 1), aColor, aAlpha.mul(stripe)) as never;
  m.opacityNode = TSL.float(1) as never;
  m.fog = false;
  m.toneMapped = false;
  return m;
}
