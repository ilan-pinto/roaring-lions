/**
 * Death for a `MeshUnitEntity` -- the gap this task exists to close.
 * `ThreeRenderer.updateMeshUnits`'s own prune loop, before this module
 * existed, tore an entity down the instant `alive[i]` flipped to 0: no
 * fade, no death pose, nothing left behind. The billboard path Pixi ported
 * to (`renderer.ts`'s `stepDeaths`/`addWreck`) does three things a mesh unit
 * had none of -- fades, plays a down pose, and persists a wreck for a unit
 * type whose sheet has one -- and this module ports all three, verbatim in
 * timing and curve, onto the mesh path.
 *
 * Split like every other module in this directory: pure decision logic
 * (the fade curve, `meshDeathOpacity`/`meshDeathSinkPx`) above the
 * `THREE.*` line, GPU-facing state below it -- but unlike `mesh-unit.ts`,
 * even the "below the line" half here is built to be exercised with real
 * (non-GPU) `THREE.Scene`/`THREE.Object3D`/`THREE.Material` objects and no
 * `WebGLRenderer`, the same precedent `fog-mesh.ts` and `mesh-unit.ts`
 * themselves established: every function takes its scene/entity/environment
 * as plain arguments rather than reaching into `ThreeRenderer`'s private
 * fields, so `ThreeRenderer.ts`'s own job shrinks to bookkeeping three
 * arrays and calling in.
 *
 * ## The fade is no longer the whole death (D4/D5)
 *
 * The paragraph above described the ENTIRE death before D3/D5 landed. Three
 * shapes now share `beginMeshDeath`'s priority chain (see that function's own
 * doc comment): an authored `fall`/`fallAlt` plays through `falling` and,
 * per D4, never fades at all -- the fall IS the death's visible motion, and
 * it ends lying in exactly the pose its paired wreck clip holds (D3's
 * `pickDeathClips`, which picks the fall and the wreck as one unit so a body
 * never falls one way and wakes up posed another); a body already lying in
 * its wreck's own geometry (a prone sniper on overwatch) skips straight to
 * `settling`; and everything else enters `toppling` (D5) -- the generic
 * per-figure pitch this file's own "The generic topple" section below
 * describes -- which likewise never fades, only a body with NEITHER a fall
 * NOR a wreck clip ever reaches this file's fade curve at all (a civilian,
 * whose GLB carries `down` but no `wreck`). `DyingMeshUnit.phase` (`falling`
 * / `toppling` / `fading` / `settling`) is what replaced the old
 * `settling: boolean` to say which of these shapes a given corpse is
 * currently in -- see that type's own doc comment and `stepMeshDeath`'s.
 *
 * ## The generic topple (D5)
 *
 * A body with no authored fall and no already-down match does not simply
 * play a static `down` pose and fade (the pre-D5 behaviour) -- each
 * currently-live figure root (`liveFigureRoots`: a parentless bone at scale
 * 1 WITH a bone of its own riding on it -- Ruling 11, see that function's own
 * doc comment -- the kit/Meshy convention the scale-swap already relies on)
 * pitches 90
 * degrees over `TOPPLE_SECONDS`, about the horizontal line through the
 * ground point beneath ITS OWN origin -- never the entity root -- so a
 * figure's feet never move while its body falls. Multiple figures (a mortar
 * team, a squad) are staggered `TOPPLE_STAGGER_SECONDS` apart
 * (`beginTopple`'s own `delaySeconds`) rather than dropping in lockstep. The
 * direction is away from the killer's last known position, or straight back
 * from the entity's own facing when there is none (`toppleDirection`). Once
 * every figure has finished (`ToppleState.totalSeconds`), the swap onto the
 * wreck clip -- or, for a GLB with none, this file's own Pixi fade -- is
 * forced to a one-frame CUT (`startWreck(d, true)`): a blend would have the
 * mixer lay the wreck's pose under a figure still frozen 90 degrees over,
 * which reads as the corpse un-toppling itself. `yawCorpseRoots` then turns
 * the swapped-in corpse geometry -- bones that were NOT live at death and
 * just appeared -- to face the fall bearing, since the kit's authored prone
 * pose always faces local +X regardless of which way the body actually fell.
 *
 * ## The curve, read from the source rather than invented
 *
 * `PixiRenderer.stepDeaths` (`renderer.ts:1230-1275`): `DEATH_SECONDS =
 * 0.4`, `p = min(1, t / DEATH_SECONDS)`, `alpha = 1 - p * 0.5` (fades
 * toward HALF, never to nothing), and a `p * 3` pixel sink as the body
 * settles. `ThreeRenderer.stepDeaths` (this same file's sibling, the
 * billboard path, `ThreeRenderer.ts:2226-2278`) already ported that exact
 * curve once, verbatim, for the OTHER unit path -- `DEATH_SECONDS = 0.4`,
 * `alpha = 1 - p * 0.5`, the identical `p * 3` sink converted through
 * `WORLD_Y_PER_LIFT_PIXEL`. `MESH_DEATH_SECONDS` below is the same `0.4`
 * for the identical reason redeclared a third time (importing the
 * billboard path's private, unexported `DEATH_SECONDS` would mean importing
 * `ThreeRenderer.ts` into a module `ThreeRenderer.ts` itself imports --
 * `mesh-death.test.ts` pins the numeral against both sources directly
 * rather than trusting this comment alone). Two things Pixi's sequence does
 * that this module does NOT port, matching the choice `ThreeRenderer`'s own
 * billboard `stepDeaths` already made and for the same reasons stated there
 * (that method's own doc comment): rotation/tip-over (Pixi's `spr.rotation =
 * p * 0.14`) and squash. A mesh unit's `Object3D.rotation` has no attribute
 * limitation the way an `InstancedMesh` billboard's translate-only instance
 * buffer does, so tipping IS technically free here in a way it was not
 * there -- but the brief this module was built against asks to match the
 * read ALPHA CURVE, not to invent a new rotation curve nobody has read from
 * anywhere, so it is left out on purpose, not by oversight.
 *
 * ## Opacity, and where it lives now
 *
 * A dying unit needs to look faded. Every `THREE.Material` -- the lit
 * `MeshStandardMaterial` `rampMaterial`/`texturedMaterial` build
 * (`../world-materials.ts`) included -- already carries a built-in
 * `opacity` number and a `transparent` flag, so nothing here has to declare
 * its own notion of partial opacity the way the toon shader this module
 * originally faded had to (`mesh-material.ts`'s `uOpacity` uniform -- that
 * whole file went with the toon ramp on 2026-09-14 and there is nothing left
 * to point at). RGB is never touched, only `opacity`, and only ever on a
 * per-entity CLONE this module makes for the fade window
 * (`beginMeshDeathFade` below) -- the shared TEMPLATE material every other
 * living clone of the same type/role still draws through
 * (`MeshUnitTemplate`'s own doc comment) is never mutated, so a corpse
 * fading never dims a living squadmate standing next to it.
 *
 * ## Wreck persistence -- checked against Pixi, not assumed
 *
 * `renderer.ts` has both a `wreckLayer` (a container of permanent, static
 * `Sprite`s -- `addWreck`) and a `wreck` clip name (one of six a sheet MAY
 * define, `sheet.ts`'s `ClipName`). They are not the same thing: `addWreck`
 * only ever adds a wreck SPRITE when `clipOrFallback(atlas.sheet, 'wreck')
 * === 'wreck'` -- i.e. the sheet genuinely has wreck art, not merely a
 * fallback to idle. `assets/sprites/INF_SQUAD/manifest.json` (the only
 * mesh-enabled unit type when this was written, reached then through an
 * opt-in `&mesh` that is inert now -- meshes are the default on `three`
 * and `&nomesh` is the opt-out) DOES declare a `wreck` clip, so Pixi
 * genuinely persists a wreck sprite for infantry --
 * this is not a hypothetical the mesh path can skip. `stepMeshDeath` below
 * mirrors the same gate one level up: a `MeshUnitEntity` only becomes a
 * `MeshWreck` when `entity.actions.has('wreck')` is true, i.e. the loaded
 * GLB genuinely carries a `wreck` `AnimationClip` -- never a fallback.
 *
 * At the START of this task no shipped `art/meshes/*.glb` carried a `down`
 * or `wreck` clip at all (`mesh-unit-contract.md`'s "Open, owned by the
 * export side" section; CLAUDE.md's "Known scaling debts" entry on mesh
 * units), so this whole path was built and tested against a hand-authored
 * fixture (`./mesh-fixture.ts`) with no real content to smoke-test against.
 * That changed mid-task, in a commit from the parallel art stream this
 * module does not depend on but was re-verified against once it landed: all
 * twelve mesh teams now ship `down` and `wreck` (`digger_crew`,
 * `sniper_team` and `yahalom_squad` are new teams entirely). The poses ship
 * STATIC -- a second `{prefix}_death_root` bone the standing rig does not
 * use, with every clip's own root/death_root scale channel constant across
 * its duration (1/0 for a living pose, 0/1 for `down`/`wreck`) rather than
 * an authored stand -> collapse transition -- and the reason is a runtime
 * limitation in `applyMeshClip`, not an art preference: before `{ once:
 * true }` existed (see that function's own doc comment), every clip looped
 * forever, so an authored ONE-WAY collapse would have replayed from its own
 * start the moment it reached its end -- a visible flip-flop, worse than a
 * static hold. `applyMeshClip`'s new option removes that constraint (this
 * module's own `stepMeshDeath` uses it for both `down` and `wreck`), so a
 * future animated collapse is safe to author without any further runtime
 * change -- see `stepMeshDeath`'s own doc comment for exactly how the
 * settle phase plays one out to completion rather than assuming a duration
 * of zero.
 */
import * as THREE from 'three';
import { groundWorldY, type ElevationSource } from '../ground-height';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { advanceMeshClipFades, applyMeshClip } from './mesh-clip';
import { disposeMeshUnitEntity, type MeshUnitEntity } from './mesh-unit';
import { pickDeathClips } from './mesh-anim';

/** Seconds a dying mesh unit fades before it either becomes a wreck or is
 *  torn down -- see this file's own top comment, "The curve, read from the
 *  source rather than invented", for where this number comes from and the
 *  two other places it is independently pinned. */
export const MESH_DEATH_SECONDS = 0.4;

/** Permanent wreckage needs a ceiling the same way `PixiRenderer.
 *  MAX_WRECKS` (`renderer.ts:1211`) does -- oldest evicted first. Kept at
 *  the identical value: nothing about the mesh path changes how many
 *  corpses a mission is expected to leave lying around. */
export const MAX_MESH_WRECKS = 256;

/** `p = min(1, t / deathSeconds)`, `renderer.ts:1250`'s own `p`, the shared
 *  input both curves below are functions of. Not exported: callers want the
 *  two curves it feeds, not the raw progress fraction. */
function meshDeathProgress(t: number, deathSeconds: number): number {
  return Math.min(1, t / deathSeconds);
}

/** Fades toward HALF opacity, never to nothing -- `renderer.ts:1264`'s own
 *  `1 - p * 0.5`, ported verbatim (also re-derived independently by
 *  `ThreeRenderer.ts`'s own billboard `stepDeaths`, `:2254`, same formula). */
export function meshDeathOpacity(t: number, deathSeconds: number = MESH_DEATH_SECONDS): number {
  return 1 - meshDeathProgress(t, deathSeconds) * 0.5;
}

/** Pixels of downward sink as the body settles -- `renderer.ts:1263`'s own
 *  `p * 3`. Returned in PIXELS, not world units, matching Pixi's own units
 *  and `ThreeRenderer.ts`'s billboard `stepDeaths` (`:2244`): the caller
 *  converts through `WORLD_Y_PER_LIFT_PIXEL`, the one conversion this
 *  module does NOT own (kept in the caller so this function stays a pure
 *  number-to-number curve, matching its sibling above). */
export function meshDeathSinkPx(t: number, deathSeconds: number = MESH_DEATH_SECONDS): number {
  return meshDeathProgress(t, deathSeconds) * 3;
}

/** One mesh's material swapped out for the fade window: `original` is the
 *  shared template material (restored verbatim by `endMeshDeathFade`,
 *  whether the entity is about to become a wreck or simply be removed),
 *  `fade` is this entity's own clone, the only object `setMeshDeathOpacity`
 *  ever writes to. */
export interface MeshFadeSwap {
  readonly mesh: THREE.Mesh;
  readonly original: THREE.Material;
  readonly fade: THREE.Material;
}

/**
 * Clones every mesh's current material under `root` and installs the clone
 * with `transparent: true` -- the shared template material itself
 * (`original`) is read, never written. Materials are deduplicated by
 * IDENTITY (a `Map` keyed on the original `THREE.Material` object): the
 * mesh-unit contract joins geometry "by role, not by part" so one entity
 * normally has at most one mesh per material already, but two meshes
 * sharing one material object would otherwise get two independent fade
 * clones drifting out of sync with each other for no reason -- dedup keeps
 * every mesh that shares an original material pointing at the SAME clone.
 * `setMeshDeathOpacity` (below) does not itself dedup -- it writes `opacity`
 * to `s.fade` for every swap, which can mean writing the same clone more
 * than once per call -- but because the clone is shared, every one of those
 * writes lands on the one object the meshes actually draw through, so they
 * end up fading in lockstep regardless of how many times it is written.
 */
export function beginMeshDeathFade(root: THREE.Object3D): MeshFadeSwap[] {
  const swaps: MeshFadeSwap[] = [];
  const cloned = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material as THREE.Material;
    let fade = cloned.get(original);
    if (!fade) {
      fade = original.clone();
      fade.transparent = true;
      cloned.set(original, fade);
    }
    mesh.material = fade;
    swaps.push({ mesh, original, fade });
  });
  return swaps;
}

/** Writes this frame's opacity into every fade clone `swaps` covers.
 *  `swaps` can repeat the same clone (two meshes sharing one original
 *  material, per `beginMeshDeathFade`'s own dedup) -- writing a plain
 *  `Material.opacity` number twice is harmless, so this no longer bothers
 *  deduplicating the write itself the way the old `uOpacity` uniform write
 *  did. */
export function setMeshDeathOpacity(swaps: readonly MeshFadeSwap[], opacity: number): void {
  for (const s of swaps) s.fade.opacity = opacity;
}

/** Restores every mesh's ORIGINAL (shared, template-owned) material and
 *  disposes the fade clones -- called exactly once per dying entity, at the
 *  moment its fade window ends, regardless of which of the two paths
 *  (`stepMeshDeath` below) follows: becoming a wreck needs the un-faded,
 *  full-opacity material back (a wreck draws at full opacity, matching
 *  Pixi's own `addWreck`, which never touches `spr.alpha`); being torn down
 *  needs the clones disposed so they do not leak. */
export function endMeshDeathFade(swaps: readonly MeshFadeSwap[]): void {
  const disposed = new Set<THREE.Material>();
  for (const s of swaps) {
    s.mesh.material = s.original;
    if (disposed.has(s.fade)) continue;
    disposed.add(s.fade);
    s.fade.dispose();
  }
}

export type MeshDeathPhase = 'falling' | 'toppling' | 'fading' | 'settling';

/** Where the round that killed this entity came from, in tile coordinates
 *  -- `ThreeRenderer.killerX/killerY`, written from the `destroyed` event's
 *  `by`. `null` when nothing shot it (`debugKill`, a tunnel collapse). */
export interface KillerRef {
  readonly x: number;
  readonly y: number;
}

/** One entity mid-death. `phase` replaces the old `settling` boolean:
 *   - `falling`  -- playing `fall`/`fallAlt` once (D3); no fade clone exists
 *   - `toppling` -- the generic per-figure topple (D5, Task 5)
 *   - `fading`   -- Pixi's 0.4 s fade-to-half + sink; reached only by a
 *                   body that has nothing persistent to become (D4)
 *   - `settling` -- the wreck one-shot until it pauses, then `MeshWreck`
 *  `t` is seconds since the CURRENT phase began. `swaps` is empty until
 *  the fading phase starts. Unlike Pixi's `dying`/`DyingUnit`, this needs no
 *  captured x/y/facing/typeId at all: `entity` IS the real, already-
 *  positioned `Object3D` (this module never rebuilds position from tile
 *  coordinates the way a 2D sprite's `isoX`/`isoY` must), and the entity id
 *  it died under is never touched again except to hash a deterministic
 *  fall/wreck pick -- it was already removed from
 *  `ThreeRenderer.meshUnitEntities` by the caller before this was
 *  constructed, so a later spawn reusing that id can never alias it. */
export interface DyingMeshUnit {
  readonly entity: MeshUnitEntity;
  readonly entityId: number;
  t: number;
  readonly baseWorldY: number;
  swaps: readonly MeshFadeSwap[];
  phase: MeshDeathPhase;
  wreckAction: THREE.AnimationAction | null;
  readonly fallAction: THREE.AnimationAction | null;
  topple: ToppleState | null;
  readonly killer: KillerRef | null;
}

/** Design D5 -- one live figure root and the frame it topples in. */
export interface ToppleFigure {
  readonly bone: THREE.Bone;
  readonly restQuaternion: THREE.Quaternion;
  readonly restPosition: THREE.Vector3;
  /** Ground point beneath the bone's origin, in the bone's PARENT space. */
  readonly pivot: THREE.Vector3;
  /** `up x direction`, in the bone's parent space. */
  readonly axis: THREE.Vector3;
  readonly delaySeconds: number;
}

export interface ToppleState {
  readonly direction: THREE.Vector3;
  readonly figures: readonly ToppleFigure[];
  readonly totalSeconds: number;
  /** The roots that were live at death -- NOT yawed at the swap. */
  readonly liveRoots: ReadonlySet<THREE.Bone>;
  /** Signed angle from the entity's forward to `direction`, about up. */
  readonly corpseYaw: number;
}

export const TOPPLE_SECONDS = 0.5;
export const TOPPLE_STAGGER_SECONDS = 0.1;
const TOPPLE_ANGLE = Math.PI / 2;
const UP = new THREE.Vector3(0, 1, 0);
const LIVE_SCALE = 0.5;

/** `90 deg * p^2`, `p = t / TOPPLE_SECONDS`, clamped -- a body accelerates. */
export function toppleAngle(t: number): number {
  const p = Math.min(1, Math.max(0, t / TOPPLE_SECONDS));
  return TOPPLE_ANGLE * p * p;
}

/** World-space unit direction the body falls in: away from the killer,
 *  else straight back from its facing. `entity.root.position` is
 *  `(tileX, groundY, tileY)`, the same frame `killer` is in. */
export function toppleDirection(entity: MeshUnitEntity, killer: KillerRef | null): THREE.Vector3 {
  if (killer && Number.isFinite(killer.x) && Number.isFinite(killer.y)) {
    const d = new THREE.Vector3(entity.root.position.x - killer.x, 0, entity.root.position.z - killer.y);
    if (d.lengthSq() > 1e-9) return d.normalize();
  }
  return new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, entity.root.rotation.y).negate();
}

/** Every parentless bone currently at scale 1 WITH AT LEAST ONE BONE CHILD:
 *  a kit `{prefix}_root`, a Meshy `Hips`, `m_root` on the motorcycle. Sorted
 *  by name for a stable stagger order. Structural, not by name -- the
 *  contract forbids the runtime depending on bone names.
 *
 *  Ruling 11 (I1): "every parentless bone at scale 1" also matched things
 *  that are not figures at all -- `rig.py`'s `_prop_bone` (a deployed
 *  weapon/tripod/spoil-heap mount, parentless, scale 1 in every LIVING clip),
 *  `_digger_extras`' `ground` bone, and the Blender exporter's own
 *  auto-inserted `neutral_bone` (parentless, scale 1, keyed by no clip at
 *  all). Measured toppling every one of those on five shipped rigs
 *  (`demo_squad`, `at_team`, `atgm_cell`, `mortar_crew`, `digger_crew`): a
 *  spoil heap tipping 90 degrees and snapping back at the wreck swap, a
 *  deployed tube/tripod/charge falling with its crew then vanishing, and a
 *  `neutral_bone` never restored at all (half the corpse's vertices left
 *  pitched 90 degrees permanently). The fix is structural rather than a name
 *  denylist, matching the contract's own "never depend on bone names" rule:
 *  every one of those mounts is a LEAF (no bone rides on it), while every
 *  figure root the kit/Meshy convention builds has a spine -- at least one
 *  Bone child -- riding on it. Contract v4 states the rule this function
 *  implements.
 *
 *  Break check (verified by hand, then reverted): drop the `hasBoneChild`
 *  term. `mesh-team-death-shipped.test.ts`'s shipped-bytes sweep then finds
 *  `prop`/`ground`/`neutral_bone` among the returned names on the five files
 *  above and goes red. */
export function liveFigureRoots(root: THREE.Object3D): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  root.traverse((o) => {
    const b = o as THREE.Bone;
    if (!b.isBone) return;
    if ((b.parent as THREE.Bone | null)?.isBone) return;
    if (b.scale.x <= LIVE_SCALE) return;
    const hasBoneChild = b.children.some((c) => (c as THREE.Bone).isBone);
    if (!hasBoneChild) return;
    out.push(b);
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function beginTopple(entity: MeshUnitEntity, direction: THREE.Vector3): ToppleState {
  entity.root.updateWorldMatrix(true, true);
  const groundY = entity.root.position.y;
  const axisWorld = UP.clone().cross(direction).normalize();
  const roots = liveFigureRoots(entity.root);
  const figures = roots.map((bone, i) => {
    const parent = bone.parent ?? entity.root;
    const worldPos = bone.getWorldPosition(new THREE.Vector3());
    const pivot = parent.worldToLocal(new THREE.Vector3(worldPos.x, groundY, worldPos.z));
    const parentInverse = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    return {
      bone,
      restQuaternion: bone.quaternion.clone(),
      restPosition: bone.position.clone(),
      pivot,
      axis: axisWorld.clone().applyQuaternion(parentInverse).normalize(),
      delaySeconds: i * TOPPLE_STAGGER_SECONDS,
    };
  });
  const forward = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, entity.root.rotation.y);
  const corpseYaw = Math.atan2(forward.clone().cross(direction).dot(UP), forward.dot(direction));
  return {
    direction,
    figures,
    totalSeconds: TOPPLE_SECONDS + TOPPLE_STAGGER_SECONDS * Math.max(0, roots.length - 1),
    liveRoots: new Set(roots),
    corpseYaw,
  };
}

/** Writes every figure's pitch for time `t` since the topple began. */
export function applyTopple(state: ToppleState, t: number): void {
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  for (const f of state.figures) {
    q.setFromAxisAngle(f.axis, toppleAngle(t - f.delaySeconds));
    f.bone.quaternion.copy(q).multiply(f.restQuaternion);
    v.copy(f.restPosition).sub(f.pivot).applyQuaternion(q).add(f.pivot);
    f.bone.position.copy(v);
  }
}

/** After the swap: every parentless bone that is visible now and was NOT a
 *  live root at death is corpse geometry that just appeared; yaw it about
 *  its own origin so its head lies along the fall direction (the kit prone
 *  build has its head at local +X). Applied after each `mixer.update` in
 *  the settle phase, since the wreck clip re-keys the bone every update;
 *  once the wreck stops being updated the last write persists. An authored
 *  wreck POSE (no swap: the live root stays the live root) is untouched. */
export function yawCorpseRoots(entity: MeshUnitEntity, state: ToppleState): void {
  if (state.corpseYaw === 0) return;
  const q = new THREE.Quaternion();
  entity.root.traverse((o) => {
    const b = o as THREE.Bone;
    if (!b.isBone) return;
    if ((b.parent as THREE.Bone | null)?.isBone) return;
    if (state.liveRoots.has(b) || b.scale.x <= LIVE_SCALE) return;
    const parent = b.parent ?? entity.root;
    const upLocal = UP.clone().applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    q.setFromAxisAngle(upLocal, state.corpseYaw);
    b.quaternion.premultiply(q);
  });
}

/** Switches the entity onto its picked wreck clip and enters `settling`.
 *  `cut` forces a one-frame switch (the topple's swap, D5); otherwise D2
 *  decides. */
function startWreck(d: DyingMeshUnit, cut: boolean): void {
  const pick = pickDeathClips(d.entityId, new Set(d.entity.actions.keys()));
  applyMeshClip(d.entity, pick.wreck, { once: true, cut });
  d.wreckAction = d.entity.actions.get(pick.wreck) ?? null;
  d.phase = 'settling';
  d.t = 0;
}

/** Enters the Pixi fade for a body with no wreck: clones the materials now
 *  (not at `beginMeshDeath`), so a body that falls or topples into a wreck
 *  never pays for clones it will not use. */
function beginFadePhase(d: DyingMeshUnit): void {
  d.swaps = beginMeshDeathFade(d.entity.root);
  d.phase = 'fading';
  d.t = 0;
}

/** Starts a death for `entity` -- call once, the instant `Sim` reports it no
 *  longer alive, and only once (the caller owns not calling this twice for
 *  the same entity; `ThreeRenderer.updateMeshUnits`'s prune loop deletes the
 *  id from `meshUnitEntities` in the same step it calls this, so there is
 *  nothing left to find it under a second time).
 *
 *  Three shapes, in priority order (D3/D4):
 *   1. The GLB has a `fall`/`fallAlt` clip (`pickDeathClips`): play it once,
 *      through the ordinary crossfade -- `falling`. No fade clone is made;
 *      D4 says a body with an authored fall is never faded, only the
 *      no-fall path still is (see `beginFadePhase`'s own comment).
 *   2. "Already down": the currently-playing living clip keys the SAME
 *      scale signature as the picked wreck (D2's `clipScale`) -- the body is
 *      already lying in the wreck's own geometry (a prone sniper on
 *      overwatch, killed where it stood), so there is nothing to fall OR
 *      topple. Straight to `settling`.
 *   3. Neither: D5's generic topple. The pose freezes -- no clip is applied
 *      and the mixer is never advanced while toppling -- and each live
 *      figure root (`liveFigureRoots`) pitches 90 deg over `TOPPLE_SECONDS`,
 *      staggered `TOPPLE_STAGGER_SECONDS` apart, about the ground point
 *      beneath its own origin, away from `killer` (or straight back from
 *      the entity's own facing with none). Once every figure lands, the
 *      swap to the wreck (or, with none, the Pixi fade) is a one-frame
 *      CUT -- see `stepMeshDeath`'s `toppling` branch.
 *
 *  `entityId` defaults to 0 so every existing call site (test fixtures with
 *  no sim entity id to give) keeps compiling with unchanged, deterministic
 *  behaviour; `ThreeRenderer`'s own real call site passes the actual id,
 *  which is what makes the per-entity fall/wreck pick (`pickDeathClips`)
 *  vary entity to entity rather than picking the same corpse for every body
 *  in a mission. `killer` is threaded through for the topple direction (D5)
 *  and otherwise unused here. */
export function beginMeshDeath(entity: MeshUnitEntity, entityId: number = 0, killer: KillerRef | null = null): DyingMeshUnit {
  const available = new Set(entity.actions.keys());
  const pick = pickDeathClips(entityId, available);
  const base = {
    entity,
    entityId,
    t: 0,
    baseWorldY: entity.root.position.y,
    swaps: [] as readonly MeshFadeSwap[],
    wreckAction: null as THREE.AnimationAction | null,
    topple: null as ToppleState | null,
    killer,
  };

  // D3: the supplied fall, entered through the ordinary crossfade.
  if (available.has(pick.fall)) {
    applyMeshClip(entity, pick.fall, { once: true });
    return { ...base, phase: 'falling', fallAction: entity.actions.get(pick.fall) ?? null };
  }

  // "Already down": the living clip shows the corpse geometry (equal scale
  // signatures -- the sniper on overwatch). Nothing to topple; straight to
  // the wreck, blending or cutting by D2.
  //
  // M4: guard on `available.has(pick.wreck)`, not the literal `'wreck'` --
  // `startWreck` plays whichever of `wreck`/`wreckAlt` `pickDeathClips`
  // picked, so a file whose picked variant is `wreckAlt` (and which has no
  // plain `wreck` at all -- none shipped, but not excluded by the contract)
  // would otherwise read `available.has('wreck')` as false and fall through
  // to the topple for a body already lying in `wreckAlt`'s own pose.
  if (
    available.has(pick.wreck) &&
    entity.currentClip !== null &&
    entity.clipScale.get(entity.currentClip) === entity.clipScale.get(pick.wreck)
  ) {
    const d: DyingMeshUnit = { ...base, phase: 'settling', fallAction: null };
    startWreck(d, false);
    return d;
  }

  // D5: the generic topple. The pose freezes (no clip applied, mixer not
  // advanced); each live figure root pitches about its own feet.
  const topple = beginTopple(entity, toppleDirection(entity, killer));
  return { ...base, phase: 'toppling', fallAction: null, topple };
}

/** Persistent wreckage -- the mesh-path counterpart of `renderer.ts`'s
 *  `wrecks`/`wreckLayer`. `shown` starts at whatever `isExplored` says at
 *  the moment of creation and only ever flips false -> true afterwards
 *  (`updateMeshWrecks`) -- "Never goes back to false", `renderer.ts:1200`'s
 *  own comment on the identical rule. */
export interface MeshWreck {
  readonly root: THREE.Object3D;
  readonly x: number;
  readonly y: number;
  shown: boolean;
}

/** Everything `stepMeshDeath` needs from `ThreeRenderer` besides the dying
 *  entity itself -- passed in explicitly (rather than this module reaching
 *  into `ThreeRenderer`'s private fields) so it is exercisable against a
 *  real `THREE.Scene` and a hand-rolled `isExplored` with no
 *  `WebGLRenderer` anywhere in the call graph. */
export interface MeshDeathEnv {
  readonly scene: THREE.Scene;
  readonly elevation: ElevationSource;
  readonly width: number;
  readonly height: number;
  readonly isExplored: (x: number, y: number) => boolean;
}

/**
 * Advances one dying entity by `dtSeconds`. Four phases (`d.phase`,
 * `MeshDeathPhase`):
 *
 *  1. **Falling** (D3): the picked `fall`/`fallAlt` plays through the
 *     ordinary mixer, `advanceMeshClipFades` included -- no opacity write,
 *     no sink, because D4 says a body with an authored fall never fades:
 *     the fall itself IS the death's whole visible motion, and it ends
 *     lying in the exact pose its wreck clip holds. Once the action
 *     reports `.paused` (the same `LoopOnce` + `clampWhenFinished`
 *     mechanism the settle phase already relied on -- see point 4 below),
 *     it hands off: a GLB with a `wreck` clip starts it immediately
 *     (`startWreck(d, false)`, `cut = false` -- D2's own `clipScale`
 *     comparison decides blend vs cut from here, same as any other clip
 *     switch in this file; the fall and its paired wreck normally share a
 *     scale signature, so this is ordinarily a blend between two poses that
 *     already agree); one without is impossible by the mesh-unit contract
 *     (every team that ships `fall` ships `wreck`) but falls back to the
 *     fade (`beginFadePhase`) rather than assuming that can never happen.
 *  2. **Toppling** (D5): advances `d.t` and calls `applyTopple`, writing
 *     every live figure's pitch for this instant -- no clip is applied and
 *     the mixer is never advanced, so the pose the body died in freezes
 *     apart from the topple rotation itself. Once every figure's stagger
 *     delay plus its own `TOPPLE_SECONDS` has elapsed
 *     (`d.t >= topple.totalSeconds`), the swap onward is a forced CUT
 *     (`startWreck(d, true)` for a GLB with a `wreck` clip, else
 *     `beginFadePhase`) -- never a blend, since blending would lay the new
 *     pose under a figure still frozen 90 degrees over.
 *  3. **Fading**: Pixi's curve, verbatim and unchanged from before this
 *     module grew a topple -- opacity and sink advance, the mixer keeps
 *     running. Reached ONLY by a body with no fall, no already-down match
 *     and no `wreck` clip to topple into (a civilian's `down`-only GLB,
 *     via `beginFadePhase` at the end of the `toppling` branch) -- a body
 *     that falls or topples into a real wreck never pays for a fade clone
 *     it will not use (D4). Once the window closes: the entity is removed
 *     and fully disposed here, returning `'removed'` -- unconditionally,
 *     since only a body with no wreck ever reaches this phase at all (D4).
 *  4. **Settling**: advances ONLY the wreck action's own mixer time (and,
 *     mid-topple-swap, `yawCorpseRoots` -- see that function's own doc
 *     comment for why the corpse geometry needs turning to the fall
 *     bearing separately from the pitch `applyTopple` already wrote) until
 *     it reports `.paused` -- `THREE.LoopOnce` +
 *     `clampWhenFinished` (set by `applyMeshClip`) is what flips that,
 *     three.js's own mechanism for "play once, then hold the last frame",
 *     verified directly against `AnimationAction.js`'s source rather than
 *     assumed: `_updateTimeWithAction` clamps `time` to the clip's own
 *     `duration` and sets `this.paused = true`, and `_updateTimeScale`
 *     reads `this.paused ? 0 : timeScale` -- so every subsequent
 *     `mixer.update` re-evaluates the SAME clamped time, holding the pose
 *     forever with no special-casing needed here. Once paused, the
 *     `MeshWreck` is built and handed back -- WITHOUT calling
 *     `disposeMeshUnitEntity`. That omission is deliberate, and reverses an
 *     assumption this function's own first version made and got wrong (see
 *     below): `mixer.stopAllAction()`/`mixer.uncacheRoot()` do NOT merely
 *     stop writing to the bones, they call `PropertyMixer.
 *     restoreOriginalState()` on every binding whose reference count drops
 *     to zero -- which snaps the pose back to BIND POSE, not to whatever was
 *     last drawn. Measured directly against the REAL `art/meshes/
 *     inf_squad.glb` (a fixture with only one bone cannot expose this: its
 *     bind pose and its animated pose both move the same single joint, so a
 *     wrong reset still LOOKS like `something` moved) -- bind pose there
 *     shows every figure's `root` AND `death_root` bones both at scale 1,
 *     i.e. the standing AND prone geometry rendered on top of each other,
 *     which is worse than either pose alone. `MeshWreck` intentionally never
 *     retains `entity` (only `root`, `x`, `y`, `shown`) specifically so this
 *     is safe to skip: once this `DyingMeshUnit` is dropped by the caller
 *     (`ThreeRenderer.stepMeshDeaths`'s own splice), `entity` -- mixer,
 *     actions, cached bindings, all of it -- is unreachable and ordinary GC
 *     reclaims it with no special disposal, the same way any other
 *     unreferenced JS object would; none of it wraps a GPU handle
 *     (`geometry.dispose()`/`material.dispose()` exist for exactly the
 *     opposite reason -- WebGL buffers JS's own GC cannot see). And because
 *     nothing calls `.update()` on an abandoned wreck's mixer ever again
 *     (this module does not retain it to call on), the "static, costs
 *     nothing" property this file promises throughout holds regardless.
 *
 * This replaces an earlier version that evaluated `wreck` at its own t=0
 * and froze it there via `mixer.update(0)` then `disposeMeshUnitEntity`,
 * which assumed a `wreck` clip could only ever be a single static pose AND
 * (unverified at the time, and wrong) that disposal would not disturb it.
 * The static-pose assumption could not have been otherwise at the time:
 * `applyMeshClip` had no one-shot mode, so an authored ANIMATED collapse
 * would have looped forever rather than settling -- the art pipeline
 * shipped `down`/`wreck` as static poses specifically to route around that
 * gap (a runtime limitation, not an art decision), and named it as a
 * limitation worth removing once this task's own work made it reachable.
 * `THREE.LoopOnce`/`clampWhenFinished` is that removal: today's static
 * clips settle in one settle-phase frame regardless (a `duration`-0 or
 * already-constant clip clamps on its very first `mixer.update`), and a
 * future animated collapse plays out in full before the corpse freezes,
 * with no further change needed here.
 *
 * Either non-`'fading'` result is bookkeeping for the caller: drop this
 * `DyingMeshUnit` from whatever list it came from, and if a `MeshWreck`
 * came back, keep it somewhere (`pushMeshWreck` below).
 */
export function stepMeshDeath(d: DyingMeshUnit, dtSeconds: number, env: MeshDeathEnv): 'fading' | 'removed' | MeshWreck {
  if (d.phase === 'settling') {
    const action = d.wreckAction;
    advanceMeshClipFades(d.entity, dtSeconds);
    d.entity.mixer.update(dtSeconds);
    if (d.topple) yawCorpseRoots(d.entity, d.topple);
    // Ruling 10 (C1): `action.paused` alone flips true on the THIRD frame of
    // a blend-in, not at its end -- three.js's own `LoopOnce` +
    // `clampWhenFinished` clamps `.paused` off the wreck CLIP's own duration,
    // which for every kit-convention `wreck` (a two-frame hold, 0.0417 s)
    // elapses long before the 150 ms `MESH_CLIP_FADE_SECONDS` weight ramp
    // this same `startWreck(d, false)` call started (D2's blend-or-cut
    // choice for the wreck handoff). Returning the `MeshWreck` at that point
    // freezes the crossfade one third of the way through, permanently: the
    // `DyingMeshUnit` is dropped here and nothing ever calls
    // `advanceMeshClipFades`/`mixer.update` on this entity again, so the
    // wreck's own effective weight (and whatever it was fading in FROM,
    // still holding weight too) never reaches its intended value. Requiring
    // `d.entity.fades.size === 0` too keeps the blend (or cut, when D2 chose
    // one) running to genuine completion before the corpse is handed off --
    // a mortar team's 150 ms kneel-to-prone slump plays out in full instead
    // of freezing at idle=0.667/wreck=0.333 forever. Cut transitions never
    // populate `fades` at all (`applyMeshClip`'s `cut` branch calls
    // `player.fades.clear()`), so this is a no-op there and only ever delays
    // the already-topple-forced-cut settle path when some OTHER fade is
    // still live for an unrelated reason.
    //
    // Break check (verified by hand, then reverted): drop the
    // `|| d.entity.fades.size > 0` term. `mesh-death.test.ts`'s "the wreck
    // handoff blend completes before the MeshWreck is built" test then goes
    // red: the returned `MeshWreck` root's wreck action reads an
    // intermediate effective weight (~0.333) instead of exactly 1.
    if (!action || !action.paused || d.entity.fades.size > 0) return 'fading';

    // No `disposeMeshUnitEntity` here -- see this function's own doc
    // comment for why calling it would corrupt the very pose this branch
    // just settled into.
    const x = d.entity.root.position.x;
    const y = d.entity.root.position.z;
    // Ground level, not the sunk death position -- `addWreck`
    // (`renderer.ts:1284`) places its sprite fresh from tile x/y, never
    // inheriting the dying sprite's own settle offset.
    d.entity.root.position.y = groundWorldY(env.elevation, env.width, env.height, x, y);
    const shown = env.isExplored(x, y);
    d.entity.root.visible = shown;
    return { root: d.entity.root, x, y, shown };
  }

  if (d.phase === 'falling') {
    advanceMeshClipFades(d.entity, dtSeconds);
    d.entity.mixer.update(dtSeconds);
    d.t += dtSeconds;
    if (!d.fallAction || !d.fallAction.paused) return 'fading';
    // D4: the body is already lying in its final pose -- no fade, no sink.
    if (d.entity.actions.has('wreck')) startWreck(d, false);
    else beginFadePhase(d);
    return 'fading';
  }

  if (d.phase === 'toppling') {
    const topple = d.topple;
    if (!topple) throw new Error('mesh-death: toppling with no ToppleState');
    d.t += dtSeconds;
    applyTopple(topple, d.t);
    if (d.t < topple.totalSeconds) return 'fading';
    // The swap is always a cut: a blend would have the mixer lay the wreck
    // pose under a figure still pitched 90 deg (spec 3.3).
    if (d.entity.actions.has('wreck')) startWreck(d, true);
    else beginFadePhase(d);
    return 'fading';
  }

  // 'fading' -- Pixi's curve, verbatim. Only a body with no wreck ever
  // reaches this phase at all (D4): a fall or a topple with a `wreck` clip
  // to become goes straight from its own phase to `settling` instead.
  d.t += dtSeconds;
  setMeshDeathOpacity(d.swaps, meshDeathOpacity(d.t));
  d.entity.root.position.y = d.baseWorldY - meshDeathSinkPx(d.t) * WORLD_Y_PER_LIFT_PIXEL;
  advanceMeshClipFades(d.entity, dtSeconds);
  d.entity.mixer.update(dtSeconds);
  if (d.t < MESH_DEATH_SECONDS) return 'fading';

  endMeshDeathFade(d.swaps);
  d.swaps = [];
  env.scene.remove(d.entity.root);
  disposeMeshUnitEntity(d.entity);
  return 'removed';
}

/** Appends `wreck` to `wrecks`, evicting the OLDEST entry once `max` is
 *  exceeded -- `renderer.ts:1290-1294`'s own `while (this.wrecks.length >
 *  MAX_WRECKS) { const old = this.wrecks.shift(); ... }`, same eviction
 *  order, same reason: unbounded permanent wreckage over a long mission is
 *  the actual hazard, not a cap that occasionally drops the oldest corpse.
 *  An evicted wreck's `root` is removed from `scene` but its geometry and
 *  material are NOT disposed here -- they are the template's own shared
 *  resources (`MeshUnitTemplate`'s doc comment), the identical reasoning
 *  `disposeMeshUnitEntity` already relies on for a living entity's own
 *  teardown. */
export function pushMeshWreck(
  wrecks: MeshWreck[],
  wreck: MeshWreck,
  scene: THREE.Scene,
  max: number = MAX_MESH_WRECKS
): void {
  wrecks.push(wreck);
  while (wrecks.length > max) {
    const old = wrecks.shift();
    if (old) scene.remove(old.root);
  }
}

/** Sticky reveal: once `isExplored` says yes for a wreck's tile, `shown`
 *  latches true and stays true even if `isExplored` later says no again --
 *  `renderer.ts:1200`'s own comment on the identical rule, "Never goes back
 *  to false". Never re-hides an already-shown wreck, and never shows one
 *  whose tile has not been seen at all -- "you never witness a kill you did
 *  not observe, but a burnt-out position you HAVE seen stays on the map
 *  after the fog closes over it" (`renderer.ts:1224-1228`). */
export function updateMeshWrecks(wrecks: readonly MeshWreck[], isExplored: (x: number, y: number) => boolean): void {
  for (const w of wrecks) {
    if (!w.shown && isExplored(w.x, w.y)) {
      w.shown = true;
      w.root.visible = true;
    }
  }
}
