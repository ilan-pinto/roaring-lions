/**
 * GH-943 WebGPU P3 (T8): the NODE twin of the tunnel trail's material (`trail-mesh.ts`, `createTrailMaterial`): one flat-coloured
 * quad per marked tile, an `InstancedMesh`, as one `MeshBasicNodeMaterial`.
 *
 *   `colorNode   = uColor`          the spoil colour, linear
 *   `opacityNode = aAlpha`          a per-INSTANCE attribute (the trail ladder's alpha for that tile)
 *
 * **The colour stays a record.** The legacy material's `uniforms.uColor` vector is bound by reference. The instance transform
 * (`instanceMatrix`) is applied by three's node material for an `InstancedMesh`, the same product the legacy vertex shader writes.
 *
 * The state (normal blend, depth-tested, not depth-writing, `FrontSide`) is the legacy material's, copied by adoption
 * (`copyRenderState`). Unlit and fog-blind: the colour is linear and the scene pass is linear.
 *
 * ADDON-FREE. TSL arrives injected; nothing here imports `three/webgpu` or `three/tsl` at runtime.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import type * as THREE from 'three';
import type * as WEBGPU from 'three/webgpu';
import type { N } from './fog-pass.node';
import { NODE_MATERIAL_PREFIX, type BatchTwinDeps } from './units/overlays.node';

/** The slice of the legacy uniform record the twin binds. */
export interface TrailUniformRecord {
  readonly uColor: { value: THREE.Vector3 };
}

/** What a test may read back: the bound colour uniform. */
export interface TrailTwinBound {
  readonly uColor: N;
}

export const NODE_TRAIL_MATERIAL_NAME = `${NODE_MATERIAL_PREFIX}trail`;
/** `TrailTwinBound` rides on `userData` so the vitest can reach the node. */
export const TRAIL_BOUND_KEY = 'rlTrailBound';

export function createNodeTrailMaterial(deps: BatchTwinDeps, rec: TrailUniformRecord): WEBGPU.MeshBasicNodeMaterial {
  const { W, TSL } = deps;
  const uColor = TSL.uniform(rec.uColor.value);
  const m = new W.MeshBasicNodeMaterial();
  m.name = NODE_TRAIL_MATERIAL_NAME;
  m.colorNode = uColor as never;
  m.opacityNode = TSL.attribute('aAlpha', 'float') as never;
  m.fog = false;
  m.toneMapped = false;
  const bound: TrailTwinBound = { uColor };
  m.userData[TRAIL_BOUND_KEY] = bound;
  return m;
}
