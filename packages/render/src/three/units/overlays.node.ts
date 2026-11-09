/**
 * GH-943 WebGPU P3 (T8): the NODE twin of the overlay batch's material (`overlays.ts`, `createOverlayMaterial`): HP bars, ellipse
 * rings, chevrons, route lines, the whole over-everything tier, as one `MeshBasicNodeMaterial`.
 *
 *   `colorNode = aColor`, `opacityNode = aAlpha`           (the legacy fragment is `vec4(vColor, vAlpha)`)
 *
 * Normal blend, `depthTest: false`, `depthWrite: false`, `DoubleSide`: all of that is the legacy material's, copied onto the twin by
 * adoption (`copyRenderState`, `RENDER_STATE_KEYS`), so the twin cannot drift from it. The overlay is a faithful port of Pixi's
 * un-occluded unit layer, so `depthTest: false` is what makes it draw over everything (the gate pins it through adoption).
 *
 * Unlit and fog-blind: the vertex colours are linear, the scene pass is linear (the output stage tone-maps), exactly the legacy
 * material, which is a bare `ShaderMaterial` with neither. `renderOrder` lives on the mesh (`render-order.ts`) and is untouched.
 *
 * Attributes `aColor` (vec3) and `aAlpha` (float), by name; the batch rewrites them every frame. There is no uniform.
 *
 * ADDON-FREE. TSL arrives injected; nothing here imports `three/webgpu` or `three/tsl` at runtime.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as WEBGPU from 'three/webgpu';
import type { N, Tsl } from '../fog-pass.node';

/** What the P3 batch twins (overlay, zone band, supply route, trail) are handed. */
export interface BatchTwinDeps {
  readonly W: typeof WEBGPU;
  readonly TSL: Tsl & { attribute(name: string, type: string): N; readonly positionWorld: N };
}

/** The prefix every node twin's `name` carries (the ring's is `rl-node-material-selection-ring`). */
export const NODE_MATERIAL_PREFIX = 'rl-node-material-';
export const NODE_OVERLAY_MATERIAL_NAME = `${NODE_MATERIAL_PREFIX}overlay`;

export function createNodeOverlayMaterial(deps: BatchTwinDeps): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL } = deps;
  const m = new W.MeshBasicNodeMaterial();
  m.name = NODE_OVERLAY_MATERIAL_NAME;
  m.colorNode = TSL.attribute('aColor', 'vec3') as never;
  m.opacityNode = TSL.attribute('aAlpha', 'float') as never;
  m.fog = false;
  m.toneMapped = false;
  return m;
}
