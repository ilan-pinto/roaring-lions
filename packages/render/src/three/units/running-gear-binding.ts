/**
 * Which meshes of one live vehicle draw through a running-gear material, and
 * the per-frame uniform write.
 *
 * A binding is made the first frame a vehicle moves or turns
 * (`RunningGearState.moved`), never before. A vehicle that has not moved
 * draws through exactly the material and program it always has, so a parked
 * force photographs byte-for-byte as it did before this package. That is
 * what keeps every gated golden scenario still: none of them moves a vehicle.
 *
 * Kept in a `WeakMap` by entity rather than in a renderer field, so the one
 * call every disposal path already makes (`disposeVehicleMeshEntity`) can
 * release it, and a path that forgets cannot leak a material. A dying
 * vehicle is released BEFORE its death fade starts (`ThreeRenderer`): the
 * fade clones every material under the root, and a wreck's wheels do not turn.
 */
import type * as THREE from 'three';
import type { VehicleMeshEntity } from './mesh-vehicle';
import { reapplyUnitRim } from './unit-surface';
import { hasRunningGear, runningGearMaterial, type RunningGearUniforms } from './running-gear-material';
import { wheelRotation, type RunningGearSpec, type RunningGearState } from './running-gear';

export interface RunningGearBinding {
  readonly spec: RunningGearSpec;
  readonly swaps: readonly { readonly mesh: THREE.Mesh; readonly original: THREE.Material }[];
  readonly materials: readonly THREE.Material[];
  readonly uniforms: readonly RunningGearUniforms[];
}

const bindings = new WeakMap<VehicleMeshEntity, RunningGearBinding>();

export function runningGearBinding(entity: VehicleMeshEntity): RunningGearBinding | undefined {
  return bindings.get(entity);
}

/**
 * Swap every live tagged mesh of `entity` onto a running-gear clone of its
 * material: one clone per distinct original (a vehicle's hull meshes share
 * one bake, so that is one clone). Idempotent. `null` when the entity has no
 * tagged mesh (a GLB the pass has not been run on).
 */
export function bindRunningGear(entity: VehicleMeshEntity, spec: RunningGearSpec): RunningGearBinding | null {
  const existing = bindings.get(entity);
  if (existing) return existing;
  const swaps: { mesh: THREE.Mesh; original: THREE.Material }[] = [];
  const clones = new Map<THREE.Material, { material: THREE.Material; uniforms: RunningGearUniforms }>();
  for (const top of entity.liveTop) {
    top.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material) || !hasRunningGear(mesh.geometry)) return;
      const original = mesh.material;
      let clone = clones.get(original);
      if (!clone) {
        clone = runningGearMaterial(original, spec);
        reapplyUnitRim(clone.material); // Defilade T6 prototype
        clones.set(original, clone);
      }
      swaps.push({ mesh, original });
      mesh.material = clone.material;
    });
  }
  if (swaps.length === 0) return null;
  const binding: RunningGearBinding = {
    spec,
    swaps,
    materials: [...clones.values()].map((c) => c.material),
    uniforms: [...clones.values()].map((c) => c.uniforms),
  };
  bindings.set(entity, binding);
  return binding;
}

/** Put the original materials back and dispose the clones. Safe to call on
 *  an entity that was never bound. */
export function releaseRunningGear(entity: VehicleMeshEntity): void {
  const binding = bindings.get(entity);
  if (!binding) return;
  for (const { mesh, original } of binding.swaps) mesh.material = original;
  for (const m of binding.materials) m.dispose();
  bindings.delete(entity);
}

const ROT: [number, number, number, number] = [1, 0, 1, 0];

/** This frame's uniforms from the entity's state. `hidden` (the
 *  `running-gear` debug layer) writes the rest pose and no tread, while the
 *  state keeps integrating underneath. */
export function writeRunningGearUniforms(
  binding: RunningGearBinding,
  state: RunningGearState,
  entityId: number,
  hidden: boolean
): void {
  const { spec } = binding;
  for (const u of binding.uniforms) {
    for (let k = 0; k < spec.wheels.length; k++) {
      wheelRotation(state, entityId, spec, k, hidden, ROT);
      u.uRgRot.value[k].set(ROT[0], ROT[1], ROT[2], ROT[3]);
    }
    u.uRgTrack.value.set(state.phase[entityId * 2], state.phase[entityId * 2 + 1], hidden ? 0 : state.amp[entityId], 0);
  }
}
