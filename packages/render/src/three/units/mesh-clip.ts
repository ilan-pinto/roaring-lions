/**
 * Clip switching for anything that owns a `THREE.AnimationMixer` -- the one
 * shared implementation behind BOTH mesh classes that animate.
 *
 * Extracted from `mesh-unit.ts`, where this lived while infantry was the
 * only animated class. It moved when vehicles gained a mixer of their own:
 * a `SkinnedMesh` figure and a rigid hull animate through the identical
 * three.js machinery (`AnimationAction.stop`/`reset`/`play`, `setLoop`,
 * `clampWhenFinished`), and a second copy of that machinery is exactly the
 * shape this project has already been bitten by -- behaviour living in two
 * places, so neither copy can be broken alone and no test on either is
 * falsifiable. One function, two callers.
 *
 * Deliberately typed against `ClipPlayer` rather than `MeshUnitEntity`: this
 * code touches `actions` and `currentClip` and NOTHING else -- not the
 * mixer, not the root, not a skeleton. Narrowing the parameter to what is
 * actually read is what lets a `VehicleMeshEntity` (no skin, no bones,
 * possibly no mixer at all) pass through unchanged.
 */
import * as THREE from 'three';
import type { ClipName } from '../../sheet';
import { meshClipOrFallback } from './mesh-anim';

/**
 * The animation state `applyMeshClip` reads and writes. `MeshUnitEntity`
 * (infantry) and `VehicleMeshEntity` both satisfy it structurally.
 *
 * An EMPTY `actions` map is a legitimate, expected state, not a broken one:
 * every shipped `art/meshes/vehicles/*.glb` declares zero animations today,
 * so a vehicle entity carries no actions and no mixer. `applyMeshClip`
 * leaves such a player completely untouched -- see its `!next` guard.
 */
export interface ClipPlayer {
  readonly actions: ReadonlyMap<ClipName, THREE.AnimationAction>;
  currentClip: ClipName | null;
}

/**
 * Switches `player` to `desired`, falling back to `idle` through
 * `meshClipOrFallback` exactly as `sheet.ts`'s `clipOrFallback` does for
 * sprite sheets. A no-op when the resolved clip is already playing -- so a
 * unit holding `idle` for seconds does not `reset().play()` itself every
 * single frame, which would restart its own loop constantly. Stops every
 * OTHER action rather than crossfading: a simple, deterministic switch,
 * matching the spike's own `applyClip` (`spike/rig-scene.ts`).
 *
 * `opts.once`, added for `units/mesh-death.ts`: `idle`/`move`/`fire`/`work`
 * are never passed it and keep three.js's own default -- `LoopRepeat`,
 * looping forever, exactly as before this option existed. `false`/omitted
 * still sets that default EXPLICITLY (`setLoop(LoopRepeat, Infinity)`,
 * `clampWhenFinished = false`) rather than merely leaving whatever the
 * action already had, so a clip that was ONCE played with `once: true` and
 * is later re-selected without it (not exercised by any caller today, but
 * not ruled out either) cannot inherit a stale one-shot setting.
 *
 * `once: true` is `THREE.LoopOnce` + `clampWhenFinished = true`: the action
 * plays exactly once and then HOLDS its own last frame, driven entirely by
 * three.js's own mixer -- no caller has to guess a duration or freeze
 * anything by hand. This exists because of a real, previously-unfixed
 * limitation the death-fade work surfaced: without it, EVERY clip played
 * through this function loops forever, so an authored one-way transition
 * (stand -> collapse, or a real animated collapse -> wreck pose) would
 * replay from its start every time it reached its end -- a visible
 * flip-flop, not a hold. `art/meshes/*.glb`'s `down`/`wreck` clips ship
 * static today specifically to route around that gap (their own root/
 * death_root bone-scale swap is constant across the clip, so looping it is
 * harmless by accident, not by design) -- `once: true` removes the
 * constraint for good, so a future animated collapse clip is safe to author
 * without this function changing again.
 */
export function applyMeshClip(player: ClipPlayer, desired: ClipName, opts?: { once?: boolean }): void {
  const available = new Set(player.actions.keys());
  const resolved = meshClipOrFallback(available, desired);
  if (player.currentClip === resolved) return;
  const next = player.actions.get(resolved);
  if (!next) return; // No idle clip either -- nothing to play. Matches the
  // "no mesh units" leniency ThreeRenderer already applies to a billboard
  // type with no loaded sheet: draw nothing rather than fabricate a pose.
  // This is ALSO the whole no-clips path for vehicles: an entity built from
  // a GLB with zero animations has an empty `actions` map, so every call
  // lands here and `currentClip` never leaves `null`.
  for (const [name, action] of player.actions) {
    if (name !== resolved) action.stop();
  }
  if (opts?.once) {
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
  } else {
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
  }
  next.reset().play();
  player.currentClip = resolved;
}
