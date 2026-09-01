/**
 * Departure for a `MeshUnitEntity` -- what a civilian does when she is
 * RESCUED, as opposed to killed.
 *
 * ## The bug this module exists for
 *
 * `MissionRuntime.stepObjectives` writes `alive[civ] = 0` for a civilian who
 * reaches the evacuation zone, which is the exact same write `Sim` makes for
 * a civilian who is shot. `alive` is the only record either outcome leaves,
 * so `resolveClip` (`../../clip.ts`, `if (u.alive === 0) return 'down'`) and
 * `ThreeRenderer.updateMeshUnits`' prune loop could not tell them apart: a
 * civilian you walked to safety dropped to the crawl pose and faded exactly
 * like a corpse. Saving someone looked identical to killing them -- which,
 * on a mission scored by `roe.civilian_casualty_penalty`, is the single worst
 * thing this renderer could get wrong.
 *
 * It has always been true. It only became VISIBLE when civilians started
 * drawing at all (`a2ba357`, `2ed7e7c` -- four figures, GH-149); before that
 * they were invisible entities and the pose they played reached nobody.
 *
 * ## Why a mission event, and not a renderer inference
 *
 * Invariant 4: commands in -> sim -> state + events out. The renderer may not
 * mutate sim state, and it must not reconstruct a sim conclusion from
 * geometry either -- "she was inside the refuge rectangle when she vanished"
 * is a second, independently-drifting copy of `evacuate_before`'s own zone
 * test, and it would be wrong the moment a mission's refuge marker and its
 * evacuation zone disagree (which `mission.ts` explicitly tolerates and
 * `stepCivilians` has a whole comment about). The runtime already knows;
 * `MissionEvent`'s `evacuated` kind is it saying so. This module is only what
 * the renderer does having been told.
 *
 * ## What it looks like, and how it differs from death
 *
 * `mesh-death.ts` does three things: plays `down` (the held crawl frame),
 * sinks the body `p * 3` pixels, and fades to HALF opacity before either
 * persisting a wreck or removing the entity. A departure does NONE of those.
 * It leaves the clip alone -- whatever `applyMeshClip` last set on its final
 * living frame keeps playing and keeps looping, which for a civilian who
 * walked into the zone is `move` -- holds the body at its own ground height,
 * and fades all the way to ZERO before removing it. Upright, still walking,
 * gone. There is deliberately no wreck: nothing died.
 *
 * The fade window is longer than death's `0.4` on purpose (see
 * `MESH_EVAC_SECONDS`), so the two outcomes differ in tempo as well as in
 * pose -- a difference that survives being watched at gameplay zoom, where
 * the pose difference on a 25px figure is the part you cannot rely on.
 *
 * ## Reuse
 *
 * The material machinery (`beginMeshDeathFade` / `setMeshDeathOpacity` /
 * `endMeshDeathFade`) is imported from `mesh-death.ts` rather than copied.
 * Those three are named for the caller that needed them first, but they are
 * the generic "swap in a per-entity clone, write `uOpacity`, restore and
 * dispose" mechanism, and every reason their doc comments give (never touch
 * the shared template material; dedupe clones by material identity; restore
 * before disposal) applies here unchanged. A second copy would be a second
 * place for a leak to hide.
 */
import * as THREE from 'three';
import {
  beginMeshDeathFade,
  endMeshDeathFade,
  setMeshDeathOpacity,
  type MeshFadeSwap,
} from './mesh-death';
import { disposeMeshUnitEntity, type MeshUnitEntity } from './mesh-unit';

/**
 * Seconds an evacuated unit fades before it is removed.
 *
 * Twice `MESH_DEATH_SECONDS` (0.4), and the factor is the point rather than
 * the number: the two outcomes have to read apart at gameplay zoom, where a
 * civilian is a couple of dozen pixels tall and the pose difference (upright
 * vs. crawling) is the half a player is least likely to catch. A departure
 * that is visibly UNHURRIED next to a death that snaps is the half that
 * survives the zoom. Long enough to see, short enough that a family walking
 * out does not linger over the ground the player still has to fight on.
 */
export const MESH_EVAC_SECONDS = 0.8;

/**
 * Fades to ZERO, not to half.
 *
 * This is the one curve difference that matters mechanically rather than
 * aesthetically. `meshDeathOpacity` stops at 0.5 because a corpse either
 * becomes a wreck (drawn at full opacity from there) or is removed on the
 * same frame, so nothing ever SEES the half-faded end state resolve. An
 * evacuated civilian has no wreck to become, so if this stopped at 0.5 she
 * would pop out of existence at half brightness instead of leaving.
 */
export function meshEvacOpacity(t: number, evacSeconds: number = MESH_EVAC_SECONDS): number {
  return 1 - Math.min(1, t / evacSeconds);
}

/**
 * One entity mid-departure.
 *
 * Deliberately smaller than `DyingMeshUnit`: no `baseWorldY` (nothing sinks,
 * so there is no fixed point to subtract from), no `settling`/`wreckAction`
 * (there is no wreck phase to enter). Like its sibling it retains no
 * x/y/facing/typeId -- `entity.root` already holds its own transform, and the
 * id it departed under was deleted from `ThreeRenderer.meshUnitEntities` in
 * the same step this was constructed, so a later spawn reusing that id can
 * never alias it.
 */
export interface DepartingMeshUnit {
  readonly entity: MeshUnitEntity;
  t: number;
  readonly swaps: readonly MeshFadeSwap[];
}

/**
 * Starts a departure fade for `entity` -- call once, on the frame the entity
 * is first seen not alive AND the mission runtime has said it was evacuated
 * rather than killed.
 *
 * Note what this does NOT do, since every line of it is the fix: no
 * `applyMeshClip(entity, 'down')`. `beginMeshDeath`'s first statement is
 * exactly that call, and it is what put a rescued civilian into the crawl
 * pose. Leaving the clip untouched means the mixer keeps looping whatever
 * `updateMeshUnits` last resolved for her while she was alive -- `move` for
 * a civilian who walked into the zone, `idle` for one already standing in it
 * when a soldier arrived. Both are upright, which is the whole requirement;
 * neither is `down`.
 */
export function beginMeshEvac(entity: MeshUnitEntity): DepartingMeshUnit {
  return { entity, t: 0, swaps: beginMeshDeathFade(entity.root) };
}

/**
 * Advances one departing entity by `dtSeconds`. One phase, unlike
 * `stepMeshDeath`'s two: fade, then remove.
 *
 * `mixer.update` runs every frame so the walk cycle keeps playing while she
 * fades -- a figure frozen mid-stride for 0.8 seconds reads as a glitch, not
 * as leaving. Position is left exactly where the last living frame put it:
 * she is not in the sim any more, so there is nothing left to interpolate
 * toward, and holding still at the refuge is what "she got there" looks like.
 *
 * Returns `'removed'` on the frame the fade closes, which is bookkeeping for
 * the caller: drop this `DepartingMeshUnit` from whatever list it came from.
 * Unlike `stepMeshDeath` there is no third outcome -- no `MeshWreck` is ever
 * produced, and that omission is the design, not a gap. `endMeshDeathFade`
 * restores the shared template material and disposes the per-entity clone
 * BEFORE `disposeMeshUnitEntity`, the same order the death path uses, so the
 * clone cannot be leaked by a teardown that never looks at it.
 */
export function stepMeshEvac(
  d: DepartingMeshUnit,
  dtSeconds: number,
  scene: THREE.Scene
): 'fading' | 'removed' {
  d.t += dtSeconds;
  setMeshDeathOpacity(d.swaps, meshEvacOpacity(d.t));
  d.entity.mixer.update(dtSeconds);

  if (d.t < MESH_EVAC_SECONDS) return 'fading';

  endMeshDeathFade(d.swaps);
  scene.remove(d.entity.root);
  disposeMeshUnitEntity(d.entity);
  return 'removed';
}
