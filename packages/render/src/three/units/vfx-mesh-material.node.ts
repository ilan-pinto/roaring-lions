/**
 * GH-943 WebGPU P3 (T11): the NODE twin of the flat-colour FX mesh material (`vfx-mesh-material.ts`): the muzzle flash zones, the
 * explosion burst zones and the collapse flash zones (nine materials in a combat frame, one twin each).
 *
 *   `colorNode = uColor`, alpha 1
 *
 * `uColor` is one palette key times its HDR gain, applied CPU-side (`setColors`), and a `Color` shared BY REFERENCE: the manager copies
 * into it in place, so a recolour reaches the twin with no rebuild. The managers hold their legacy materials apart
 * (`MuzzleFlashManager.materials`), never through `mesh.material`, which is the twin once adopted. No clock, no other uniform: a
 * zero-time repaint moves nothing.
 *
 * ADDON-FREE. TSL arrives injected.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as WEBGPU from 'three/webgpu';
import { finishFxTwin, type FxTwinDeps, type HasUniforms } from './fx.node';

export const NODE_VFX_MESH_NAME = 'rl-node-material-fx-mesh';

export function createNodeVfxMeshMaterial(deps: FxTwinDeps<null>, legacy: HasUniforms): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL } = deps;
  const rec = legacy.uniforms.uColor;
  if (rec === undefined) throw new Error('node vfx-mesh twin: the legacy material has no uColor uniform');
  const uColor = TSL.uniform(rec.value);
  const m = new W.MeshBasicNodeMaterial();
  m.colorNode = TSL.vec3(uColor) as never;
  finishFxTwin(m, NODE_VFX_MESH_NAME, { uColor });
  return m;
}
