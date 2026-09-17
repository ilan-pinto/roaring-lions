/**
 * Death for a `VehicleMeshEntity` -- the RIGID sibling of `mesh-death.ts`,
 * which owns the same sequence for skinned infantry.
 *
 * Until this module existed `updateVehicleMeshes`' prune loop tore a vehicle
 * down the instant `alive[i]` flipped to 0, and what the player actually saw
 * was three art styles in half a second (CLAUDE.md's own "Known scaling
 * debts" entry): the 3D mesh vanished, a flat sprite of the INTACT vehicle
 * faded in its place, and a 2D wreck sprite replaced that -- or, for
 * `mbt_lavi`, nothing at all, because `TNK_HULL`'s manifest declares no
 * `wreck` clip. The asset half of the fix is the wreck pass (spec §4.1-4.2);
 * this is the runtime half.
 *
 * ## A sibling, not a generalisation
 *
 * `mesh-death.ts`'s decision functions -- `MESH_DEATH_SECONDS`,
 * `meshDeathOpacity`, `meshDeathSinkPx`, the `MeshFadeSwap` machinery,
 * `MeshWreck`/`pushMeshWreck`/`updateMeshWrecks`, `MeshDeathEnv` -- are all
 * IMPORTED here, not re-derived: a vehicle fades on the identical curve, over
 * the identical window, and its wreck persists under the identical cap and
 * the identical fog rule. What is genuinely different is the two ends of the
 * sequence, and they are different enough that folding both into one function
 * would have meant a parameter for every line of it:
 *
 *  - **No `down` pose.** Infantry begins its fade by playing `down` (a crawl
 *    hold). The wreck pass authors a vehicle exactly two clips, `idle` and
 *    `wreck`, so `applyMeshClip(entity, 'down')` would resolve through
 *    `meshClipOrFallback` straight back to `idle` -- already playing, so a
 *    no-op. It is left out rather than called-and-ignored, so nobody goes
 *    looking for the vehicle `down` clip that does not exist.
 *  - **Visibility, not just scale.** Both asset classes express the live ->
 *    dead swap as a constant SCALE channel (1/0 for the living pose, 0/1 for
 *    the dead one), and for infantry that is the whole story because both
 *    poses are bones inside one `SkinnedMesh` -- one draw call either way.
 *    A vehicle's are separate NODES, and a scale-0 node is still SUBMITTED:
 *    three.js culls on a bounding sphere that collapses to a point at the
 *    vehicle's own position, which is in frustum. So the death root is
 *    `visible = false` for the whole of a vehicle's life (set on the
 *    template, `mesh-vehicle.ts`), revealed here at the moment `wreck`
 *    starts, and the live top-level nodes are hidden outright once it
 *    clamps.
 *
 * ## Why this path does not uncache its mixer either
 *
 * `mesh-death.ts:334-359` records, measured against the real
 * `art/meshes/inf_squad.glb`, that `mixer.stopAllAction()`/`uncacheRoot()` do
 * not merely stop writing: they call `PropertyMixer.restoreOriginalState()`
 * on every binding that drops to zero references, which snaps the pose back
 * to the value captured when the binding was made. For infantry that is bind
 * pose, where `root` AND `death_root` bones are both at scale 1 -- the
 * standing and prone geometry drawn on top of each other.
 *
 * **The rigid path has the identical hazard in the identical shape**, and
 * this was worth checking rather than assuming, because "it is only node
 * scales, not a skeleton" sounds like it should be safe. It is not: the
 * bindings here are the top-level live nodes' and the death root's own
 * `.scale`, captured at `clipAction` time from the authored file, where the
 * pass leaves every one of them at 1. Uncaching would therefore restore the
 * intact vehicle to full size on top of its own wreck -- the same picture,
 * one asset class over. `mesh-vehicle-death.test.ts` pins it.
 *
 * So `stepVehicleDeath` does not call `disposeVehicleMeshEntity` on the wreck
 * path, exactly as `stepMeshDeath` does not. The saving grace the infantry
 * path relies on holds here unchanged: `MeshWreck` retains only `root`, so
 * once the caller drops the `DyingVehicle` the mixer, its actions and its
 * cached bindings are unreachable and ordinary GC takes them -- none of it
 * wraps a GPU handle. (The explicit `visible = false` this module writes on
 * the live nodes WOULD survive a restore, so uncaching is not the disaster
 * here that it is for infantry; it is still pointless, and doing it would
 * mean two paths to reason about instead of one.)
 */
import * as THREE from 'three';
import { groundWorldY } from '../ground-height';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { advanceMeshClipFades, applyMeshClip } from './mesh-clip';
import { pickDeathClip } from './mesh-anim';
import {
  MESH_DEATH_SECONDS,
  beginMeshDeathFade,
  endMeshDeathFade,
  meshDeathOpacity,
  meshDeathSinkPx,
  setMeshDeathOpacity,
  type MeshDeathEnv,
  type MeshFadeSwap,
  type MeshWreck,
} from './mesh-death';
import { disposeVehicleMeshEntity, type VehicleMeshEntity, type VehicleMeshTemplate } from './mesh-vehicle';

/** One vehicle mid-death. The rigid twin of `DyingMeshUnit`, field for field
 *  bar the entity type -- see that interface's own doc comment for why
 *  `baseWorldY` is captured (so repeated sink writes do not compound) and why
 *  nothing here needs the tile coordinates a 2D `DyingUnit` must carry. */
export interface DyingVehicle {
  entityId: number;
  entity: VehicleMeshEntity;
  t: number;
  baseWorldY: number;
  swaps: MeshFadeSwap[];
  /** False while fading (the first `MESH_DEATH_SECONDS`); true once the
   *  `wreck` one-shot has been started. */
  settling: boolean;
  /** The `wreck` action, captured when `settling` goes true -- `null` until
   *  then. */
  wreckAction: THREE.AnimationAction | null;
}

/**
 * Starts a death fade for `entity` -- call once, the instant `Sim` reports it
 * no longer alive, and only once (the caller owns that; `ThreeRenderer`'s own
 * prune loop deletes the id from `vehicleMeshEntities` in the same step).
 *
 * Returns `null` when this entity cannot start a death at all, which the
 * caller must read as "remove and dispose it now" -- `ThreeRenderer`'s prune
 * loop already has that branch for every vehicle without the clip.
 *
 * `template` is the template `entity` was cloned from, and it is here to be
 * CHECKED rather than stored: `hasWreck` is the single gate the renderer's
 * whole hand-off turns on, and `actions.has('wreck')` is the same fact read
 * off the clone. If a template reload ever swapped one out from under a
 * living entity (`loadVehicleMesh`'s own reload path re-instantiates, but a
 * future caller might not), the two would disagree and this entity would
 * either hang in the settle phase forever waiting on an action that was never
 * started, or lose its wreck silently.
 *
 * That disagreement WARNS and returns `null`; it does not throw, and the
 * difference matters more than the unreachability suggests. The only caller
 * is `updateVehicleMeshes`, which runs inside `frame()`: an exception there
 * does not report a bad template, it kills the frame loop and the whole
 * screen stops. A warning plus the immediate-removal branch degrades to
 * exactly the behaviour every clipless vehicle already has -- the vehicle
 * disappears, which is a visible wrongness someone can act on, with the
 * reason named in the console.
 *
 * The whole clone is faded, death root included -- `beginMeshDeathFade`
 * traverses everything under the root, so the charred materials get fade
 * clones too. They are never drawn through (the death root is invisible for
 * the entire fade window) and `endMeshDeathFade` restores and disposes them
 * before it is revealed; taking the whole subtree keeps ONE dedup map and
 * one restore path, which is what `endMeshDeathFade` assumes.
 */
export function beginVehicleDeath(
  entity: VehicleMeshEntity,
  entityId: number,
  template: VehicleMeshTemplate
): DyingVehicle | null {
  if (template.hasWreck !== entity.actions.has('wreck')) {
    console.warn(
      `mesh-vehicle-death: template for "${entity.typeId}" reports hasWreck=${template.hasWreck} but the ` +
        `entity's own actions report ${entity.actions.has('wreck')} -- this entity was cloned from a different ` +
        `template, so it is removed without a death sequence`
    );
    return null;
  }
  return {
    entityId,
    entity,
    t: 0,
    baseWorldY: entity.root.position.y,
    swaps: beginMeshDeathFade(entity.root),
    settling: false,
    wreckAction: null,
  };
}

/**
 * Advances one dying vehicle by `dtSeconds`. Two phases, the same two
 * `stepMeshDeath` drives:
 *
 *  1. **Fading** (`!d.settling`): `MESH_DEATH_SECONDS` of `meshDeathOpacity`
 *     and `meshDeathSinkPx`, with `idle` still running. When the window
 *     closes, the fade clones are restored and disposed
 *     (`endMeshDeathFade`) and one of two things happens. A vehicle with no
 *     `wreck` action -- `&nomesh`'s billboard path never reaches here, but a
 *     GLB the pass has not run on does -- is removed and disposed, returning
 *     `'removed'`, which is today's behaviour minus the abruptness. A vehicle
 *     WITH one reveals its death root, starts `wreck` once
 *     (`clampWhenFinished` + `LoopOnce`, through `applyMeshClip`'s `once`
 *     option) and enters the settle phase, still returning `'fading'` this
 *     call: the action takes its first real `mixer.update` on the next one.
 *  2. **Settling** (`d.settling`): advances the mixer until the action
 *     reports `.paused`, three.js's own "played once, now holding the last
 *     frame". Then every top-level LIVE node is hidden -- the clip has
 *     already scaled them to zero and a scale-0 mesh is still submitted, so
 *     this is the draw call actually going away -- the root is dropped back
 *     to ground level (never the sunk death position, matching `addWreck`'s
 *     own "placed fresh from tile x/y"), and a `MeshWreck` is handed back for
 *     `pushMeshWreck`.
 *
 * Either non-`'fading'` result is bookkeeping for the caller: drop this
 * `DyingVehicle`, and keep the `MeshWreck` if one came back.
 */
export function stepVehicleDeath(
  d: DyingVehicle,
  dtSeconds: number,
  env: MeshDeathEnv
): 'fading' | 'removed' | MeshWreck {
  // Nullable by `VehicleMeshEntity`'s own contract (a clipless GLB gets no
  // mixer at all). Read once into a local rather than asserted non-null: a
  // clipless vehicle simply never leaves the fade path, and falls out of the
  // `'removed'` branch below.
  const mixer = d.entity.mixer;

  if (d.settling) {
    const action = d.wreckAction;
    advanceMeshClipFades(d.entity, dtSeconds);
    if (mixer) mixer.update(dtSeconds);
    // Ruling 10 (C1, mirrored for symmetry with `mesh-death.ts`'s settling
    // branch): also require every in-flight crossfade to have finished
    // before handing back a `MeshWreck`. Inert today -- a vehicle's death
    // always CUTS onto `wreck` (`stepVehicleDeath`'s own `applyMeshClip(...,
    // { once: true })` call below carries no `cut` option, but a fresh
    // entity's `currentClip` is always non-null by the time this runs, and
    // `mesh-anim.ts`'s exporters give every vehicle GLB an `idle` -> `wreck`
    // scale-signature change, which `transitionIsCut` already treats as a
    // cut, so `player.fades` is always empty here) -- but a future recipe
    // that blends a vehicle onto its wreck would hit the identical freeze
    // `mesh-death.ts` had, and this guard is the same one line cheaper than
    // re-discovering it.
    if (!action || !action.paused || d.entity.fades.size > 0) return 'fading';

    // The clip has clamped: every live node is at scale 0 and the death root
    // at 1. Hiding the live nodes is what actually removes them from the
    // draw -- see this module's own top comment.
    for (const node of d.entity.liveTop) node.visible = false;

    const x = d.entity.root.position.x;
    const y = d.entity.root.position.z;
    d.entity.root.position.y = groundWorldY(env.elevation, env.width, env.height, x, y);
    const shown = env.isExplored(x, y);
    d.entity.root.visible = shown;
    return { root: d.entity.root, x, y, shown };
  }

  d.t += dtSeconds;
  setMeshDeathOpacity(d.swaps, meshDeathOpacity(d.t));
  d.entity.root.position.y = d.baseWorldY - meshDeathSinkPx(d.t) * WORLD_Y_PER_LIFT_PIXEL;
  advanceMeshClipFades(d.entity, dtSeconds);
  if (mixer) mixer.update(dtSeconds);

  if (d.t < MESH_DEATH_SECONDS) return 'fading';

  endMeshDeathFade(d.swaps);

  const deathRoot = d.entity.deathRoot;
  if (!mixer || !deathRoot || !d.entity.actions.has('wreck')) {
    env.scene.remove(d.entity.root);
    disposeVehicleMeshEntity(d.entity);
    return 'removed';
  }

  deathRoot.visible = true;
  // `pickDeathClip` answers `'wreck'` for every vehicle today -- no vehicle
  // GLB authors a `wreckAlt`, and the recipe table has one pose per type.
  // Routed through it anyway, and under whichever name it actually resolved
  // to, for the reason `stepMeshDeath` spells out: capturing a hardcoded
  // `'wreck'` action that was never started leaves `.paused` false forever
  // and hangs this entity in the settle phase.
  const wreckClip = pickDeathClip(d.entityId, d.entity.actions.has('wreckAlt'));
  applyMeshClip(d.entity, wreckClip, { once: true });
  d.wreckAction = d.entity.actions.get(wreckClip) ?? null;
  d.settling = true;
  return 'fading';
}
