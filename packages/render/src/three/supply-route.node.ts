/**
 * GH-943 WebGPU P3 (T8): the NODE twin of the world supply route's material (`supply-route.ts`, `createSupplyRouteMaterial`): the
 * ribbon along side 0's supply routes, drawn on demand, as one `MeshBasicNodeMaterial`.
 *
 *   `colorNode   = aCut > 0.5 ? uCut : uOpen`
 *   `opacityNode = SUPPLY_ROUTE_ALPHA`
 *   `maskNode    = dashOps(aDist, aCut) > 0.5`        the cut stretch dashes; the open line is solid
 *
 * The dash is `dashOps`, written ONCE against `Ops<T>` in `supply-route-maths.ts` and handed here as a value
 * (`material-maths.ts`'s `supplyRoute` slot), with the line's alpha.
 *
 * **The colours stay a record.** `SupplyRouteMesh.setColors` writes the legacy material's `uniforms.uOpen` / `uCut` vectors IN PLACE
 * every frame (a colour-vision switch reaches a route already drawn). The twin binds those same vector objects by reference, so a
 * write reaches the next render with nothing to re-read; copying them at build would freeze the colours the route had at adoption.
 *
 * The state (normal blend, depth-tested, not depth-writing, the decal polygon offset, `DoubleSide`) is the legacy material's, copied
 * by adoption (`copyRenderState`). Attributes `aDist` and `aCut` (floats). No `normal`: the AO pre-pass skips it.
 *
 * ADDON-FREE. TSL arrives injected; nothing here imports `three/webgpu` or `three/tsl` at runtime.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import { tslOps, type N } from './fog-pass.node';
import type { Ops } from './fog-ops';
import type { dashOps } from './supply-route-maths';
import { NODE_MATERIAL_PREFIX, type BatchTwinDeps } from './units/overlays.node';

/** The shared dash maths and the line's opacity, INJECTED (`material-maths.ts`'s `supplyRoute` slot). */
export interface SupplyRouteMaths {
  readonly dashOps: typeof dashOps;
  readonly alpha: number;
}

export interface SupplyRouteTwinDeps extends BatchTwinDeps {
  readonly maths: SupplyRouteMaths;
}

/** The slice of the legacy uniform record the twin binds (the legacy material owns it; `setColors` writes it in place). */
export interface SupplyRouteUniformRecord {
  readonly uOpen: { value: THREE.Vector3 };
  readonly uCut: { value: THREE.Vector3 };
}

/** What a test may read back: the bound colour uniforms. */
export interface SupplyRouteTwinBound {
  readonly uOpen: N;
  readonly uCut: N;
}

export const NODE_SUPPLY_ROUTE_MATERIAL_NAME = `${NODE_MATERIAL_PREFIX}supply-route`;
/** `SupplyRouteTwinBound` rides on `userData` so the vitest can reach the nodes. */
export const SUPPLY_ROUTE_BOUND_KEY = 'rlSupplyRouteBound';

export function createNodeSupplyRouteMaterial(deps: SupplyRouteTwinDeps, rec: SupplyRouteUniformRecord): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL, maths } = deps;
  const o = tslOps(TSL) as Ops<N>;
  // The vectors are shared BY REFERENCE: `setColors` writes them in place.
  const uOpen = TSL.uniform(rec.uOpen.value);
  const uCut = TSL.uniform(rec.uCut.value);
  const aDist = TSL.attribute('aDist', 'float');
  const aCut = TSL.attribute('aCut', 'float');
  const keep = maths.dashOps(o, aDist, aCut);
  const m = new W.MeshBasicNodeMaterial();
  m.name = NODE_SUPPLY_ROUTE_MATERIAL_NAME;
  m.colorNode = TSL.select(aCut.greaterThan(0.5), uCut, uOpen) as never;
  m.opacityNode = TSL.float(maths.alpha) as never;
  // A dashed-out fragment is discarded, as the legacy shader's `discard`.
  m.maskNode = keep.greaterThan(0.5) as never;
  m.fog = false;
  m.toneMapped = false;
  const bound: SupplyRouteTwinBound = { uOpen, uCut };
  m.userData[SUPPLY_ROUTE_BOUND_KEY] = bound;
  return m;
}
