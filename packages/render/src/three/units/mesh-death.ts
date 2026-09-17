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
 * ## The fade is no longer the whole death (D4)
 *
 * The paragraph above still describes the ENTIRE death for a GLB with no
 * `fall`/`fallAlt` clip -- the third branch of `beginMeshDeath`, kept
 * verbatim (`down` once, then this file's fade, then the wreck) so the
 * module ships correctly before Task 5's generic topple replaces that
 * branch. It is no longer the whole story for a GLB that ships a fall: D4
 * says a body with an authored collapse never fades at all -- the fall IS
 * the death's visible motion, and it ends lying in exactly the pose its
 * paired wreck clip holds (D3's `pickDeathClips`, which picks the fall and
 * the wreck as one unit so a body never falls one way and wakes up posed
 * another). `DyingMeshUnit.phase` (`falling` / `toppling` / `fading` /
 * `settling`) is what replaced the old `settling: boolean` to say which of
 * these three shapes a given corpse is currently in -- see that type's own
 * doc comment and `stepMeshDeath`'s.
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

/** Task 5 fills this in; declared here so the phase union is complete. */
export interface ToppleState {
  readonly totalSeconds: number;
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
 *   3. Neither: Task 5 replaces this branch with the generic topple. Until
 *      then, the OLD path verbatim -- `down` once, Pixi's fade, then the
 *      wreck if the GLB has one -- so this module ships correctly on its
 *      own before Task 5 lands.
 *
 *  `entityId` defaults to 0 so every existing call site (test fixtures with
 *  no sim entity id to give) keeps compiling with unchanged, deterministic
 *  behaviour; `ThreeRenderer`'s own real call site passes the actual id,
 *  which is what makes the per-entity fall/wreck pick (`pickDeathClips`)
 *  vary entity to entity rather than picking the same corpse for every body
 *  in a mission. `killer` is threaded through for Task 5's topple direction
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
  if (
    available.has('wreck') &&
    entity.currentClip !== null &&
    entity.clipScale.get(entity.currentClip) === entity.clipScale.get(pick.wreck)
  ) {
    const d: DyingMeshUnit = { ...base, phase: 'settling', fallAction: null };
    startWreck(d, false);
    return d;
  }

  // Everything else: Task 5 replaces this with the topple. Until then the
  // old path -- `down`, Pixi's fade, then the wreck -- verbatim.
  applyMeshClip(entity, 'down', { once: true });
  return { ...base, phase: 'fading', swaps: beginMeshDeathFade(entity.root), fallAction: null };
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
 *  2. **Toppling** (D5, Task 5): not yet entered by `beginMeshDeath` --
 *     reserved here as a no-op that returns `'fading'` so the phase union
 *     is complete and exhaustive before that task lands.
 *  3. **Fading**: Pixi's curve, verbatim and unchanged from before this
 *     task -- opacity and sink advance, the mixer keeps running. Reached
 *     ONLY by a body with no fall and no already-down match (`beginMeshDeath`'s
 *     third branch, `down` then this phase) -- a body that falls into its
 *     wreck never pays for a fade clone it will not use (D4). Once the
 *     window closes: an entity with no `wreck` clip is removed and fully
 *     disposed here, returning `'removed'`; one WITH a `wreck` clip starts
 *     it (blending, matching this phase's own pre-D3 behaviour) and moves
 *     into the settle phase, still returning `'fading'` this same call --
 *     the wreck action gets its first real `mixer.update` on the NEXT call
 *     rather than this one, a one-frame deferral with no visible effect
 *     (the action's own `.time` is 0 either way at this point).
 *  4. **Settling**: advances ONLY the wreck action's own mixer time until
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
    if (!action || !action.paused) return 'fading';

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
    // Task 5.
    return 'fading';
  }

  // 'fading' -- Pixi's curve, verbatim.
  d.t += dtSeconds;
  setMeshDeathOpacity(d.swaps, meshDeathOpacity(d.t));
  d.entity.root.position.y = d.baseWorldY - meshDeathSinkPx(d.t) * WORLD_Y_PER_LIFT_PIXEL;
  advanceMeshClipFades(d.entity, dtSeconds);
  d.entity.mixer.update(dtSeconds);
  if (d.t < MESH_DEATH_SECONDS) return 'fading';

  endMeshDeathFade(d.swaps);
  d.swaps = [];
  if (!d.entity.actions.has('wreck')) {
    env.scene.remove(d.entity.root);
    disposeMeshUnitEntity(d.entity);
    return 'removed';
  }
  startWreck(d, false);
  return 'fading';
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
