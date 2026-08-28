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
 * ## The palette tension, and where it is actually resolved
 *
 * A dying unit needs to look faded, and `mesh-material.ts`'s toon-ramp
 * material had no notion of partial opacity before this task -- see that
 * file's own "uOpacity, added for the death fade" section for the full
 * argument. The short version: RGB is never touched, only alpha, and only
 * ever on a per-entity CLONE this module makes for the fade window
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
 * mesh-enabled unit type today, `?sandbox&renderer=three&mesh`) DOES declare
 * a `wreck` clip, so Pixi genuinely persists a wreck sprite for infantry --
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
import { groundWorldY } from '../ground-height';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { applyMeshClip, disposeMeshUnitEntity, type MeshUnitEntity } from './mesh-unit';

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
  readonly fade: THREE.ShaderMaterial;
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
 * `setMeshDeathOpacity` writing one clone's uniform once per distinct
 * material, however many meshes reference it.
 */
export function beginMeshDeathFade(root: THREE.Object3D): MeshFadeSwap[] {
  const swaps: MeshFadeSwap[] = [];
  const cloned = new Map<THREE.Material, THREE.ShaderMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material as THREE.Material;
    let fade = cloned.get(original);
    if (!fade) {
      fade = (original as THREE.ShaderMaterial).clone();
      fade.transparent = true;
      cloned.set(original, fade);
    }
    mesh.material = fade;
    swaps.push({ mesh, original, fade });
  });
  return swaps;
}

/** Writes this frame's opacity into every distinct fade clone `swaps`
 *  covers -- deduplicated the same way `beginMeshDeathFade` built them, so a
 *  material shared by two meshes is written once, not twice (harmless
 *  either way; avoided because it is free to avoid). */
export function setMeshDeathOpacity(swaps: readonly MeshFadeSwap[], opacity: number): void {
  const written = new Set<THREE.ShaderMaterial>();
  for (const s of swaps) {
    if (written.has(s.fade)) continue;
    written.add(s.fade);
    (s.fade.uniforms.uOpacity as { value: number }).value = opacity;
  }
}

/** Restores every mesh's ORIGINAL (shared, template-owned) material and
 *  disposes the fade clones -- called exactly once per dying entity, at the
 *  moment its fade window ends, regardless of which of the two paths
 *  (`stepMeshDeath` below) follows: becoming a wreck needs the un-faded,
 *  full-opacity material back (a wreck draws at full opacity, matching
 *  Pixi's own `addWreck`, which never touches `spr.alpha`); being torn down
 *  needs the clones disposed so they do not leak. */
export function endMeshDeathFade(swaps: readonly MeshFadeSwap[]): void {
  const disposed = new Set<THREE.ShaderMaterial>();
  for (const s of swaps) {
    s.mesh.material = s.original;
    if (disposed.has(s.fade)) continue;
    disposed.add(s.fade);
    s.fade.dispose();
  }
}

/** One entity mid-death-fade. `t` advances every frame in `stepMeshDeath`;
 *  `baseWorldY` is `entity.root.position.y` at the moment of death, the
 *  fixed point the sink subtracts from (so repeated calls do not compound
 *  the sink onto an already-sunk value) -- unlike Pixi's `dying`/
 *  `DyingUnit`, this needs no captured x/y/facing/typeId at all: `entity`
 *  IS the real, already-positioned `Object3D` (this module never rebuilds
 *  position from tile coordinates the way a 2D sprite's `isoX`/`isoY` must),
 *  and the entity id it died under is never touched again -- it was already
 *  removed from `ThreeRenderer.meshUnitEntities` by the caller before this
 *  was constructed, so a later spawn reusing that id can never alias it. */
export interface DyingMeshUnit {
  readonly entity: MeshUnitEntity;
  t: number;
  readonly baseWorldY: number;
  readonly swaps: readonly MeshFadeSwap[];
  /** False while fading (the first `MESH_DEATH_SECONDS`); true once the
   *  fade has closed and the wreck clip's own one-shot playback has begun.
   *  See `stepMeshDeath`'s own doc comment for the two-phase shape this
   *  drives -- an entity with no `wreck` clip never sets this; it is
   *  removed the instant the fade closes instead. */
  settling: boolean;
  /** The `wreck` `AnimationAction`, captured once `settling` goes true so
   *  the settle phase never has to look it up again -- null until then,
   *  and always non-null once `settling` is true. */
  wreckAction: THREE.AnimationAction | null;
}

/** Starts a death fade for `entity` -- call once, the instant `Sim` reports
 *  it no longer alive, and only once (the caller owns not calling this
 *  twice for the same entity; `ThreeRenderer.updateMeshUnits`'s prune loop
 *  deletes the id from `meshUnitEntities` in the same step it calls this,
 *  so there is nothing left to find it under a second time). Plays `down`
 *  through the EXISTING fallback (`applyMeshClip` -> `meshClipOrFallback`)
 *  rather than a second clip-resolution path -- a GLB with no `down` simply
 *  keeps whatever it was already playing, exactly like a sheet with no
 *  `down` clip does on the billboard side. `{ once: true }` -- see
 *  `applyMeshClip`'s own doc comment for why: without it, an authored
 *  collapse clip SHORTER than the fade window would loop back to its own
 *  start and replay while the corpse is still fading, a visible flip-flop
 *  `down`'s own static shipped pose happens not to expose today, but a
 *  future animated one would. */
export function beginMeshDeath(entity: MeshUnitEntity): DyingMeshUnit {
  applyMeshClip(entity, 'down', { once: true });
  return {
    entity,
    t: 0,
    baseWorldY: entity.root.position.y,
    swaps: beginMeshDeathFade(entity.root),
    settling: false,
    wreckAction: null,
  };
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
  readonly elevation: Uint8Array | null;
  readonly width: number;
  readonly height: number;
  readonly isExplored: (x: number, y: number) => boolean;
}

/**
 * Advances one dying entity by `dtSeconds`. Two phases:
 *
 *  1. **Fading** (`!d.settling`): the first `MESH_DEATH_SECONDS`, exactly as
 *     before -- opacity and sink advance, `down`'s mixer keeps running.
 *     Once the window closes: an entity with no `wreck` clip is removed and
 *     fully disposed here, returning `'removed'`; one WITH a `wreck` clip
 *     starts it (`applyMeshClip(..., 'wreck', { once: true })`) and moves
 *     into the settle phase, still returning `'fading'` this same call --
 *     the wreck action gets its first real `mixer.update` on the NEXT call
 *     rather than this one, a one-frame deferral with no visible effect
 *     (the action's own `.time` is 0 either way at this point).
 *  2. **Settling** (`d.settling`): advances ONLY the wreck action's own
 *     mixer time until it reports `.paused` -- `THREE.LoopOnce` +
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
  if (d.settling) {
    const action = d.wreckAction;
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

  d.t += dtSeconds;
  setMeshDeathOpacity(d.swaps, meshDeathOpacity(d.t));
  d.entity.root.position.y = d.baseWorldY - meshDeathSinkPx(d.t) * WORLD_Y_PER_LIFT_PIXEL;
  d.entity.mixer.update(dtSeconds);

  if (d.t < MESH_DEATH_SECONDS) return 'fading';

  endMeshDeathFade(d.swaps);

  if (!d.entity.actions.has('wreck')) {
    env.scene.remove(d.entity.root);
    disposeMeshUnitEntity(d.entity);
    return 'removed';
  }

  applyMeshClip(d.entity, 'wreck', { once: true });
  d.wreckAction = d.entity.actions.get('wreck') ?? null;
  d.settling = true;
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
