/**
 * Pure arithmetic a mesh unit needs each frame, kept above the `THREE.*` GPU
 * line so it is testable in `environment: 'node'` with no `WebGLRenderer` --
 * the same split `terrain/`, `units/instances.ts` and `units/structures.ts`
 * already draw between decision functions and GPU-facing construction.
 *
 * Clip SELECTION -- "which posture is this unit in" -- is `../../clip.ts`'s
 * `resolveClip`, reused unchanged (the task brief: "no new sim coupling
 * appears"). What is genuinely new here is clip RESOLUTION against a
 * particular loaded GLB's clip set, mirroring `sheet.ts`'s `clipOrFallback`
 * for sprite sheets, plus the scale and yaw arithmetic a sprite billboard
 * never needed (a billboard never turns off-axis; a mesh unit's whole body
 * does).
 */
import type { ClipName } from '../../sheet';

/**
 * The `ClipName` union, restated as a runtime value -- `sheet.ts` exports
 * only the type, and clip-name validation (`isMeshClipName` below) needs a
 * value to check against.
 *
 * Written as a `Record<ClipName, true>` rather than a bare array literal so
 * TypeScript itself catches drift: adding or removing a member of the
 * `ClipName` union without updating this object is a compile error (a
 * missing or excess property), not a silent gap discovered at runtime.
 */
const CLIP_NAME_SET: { readonly [K in ClipName]: true } = {
  idle: true,
  move: true,
  fire: true,
  down: true,
  wreck: true,
  work: true,
  moveFire: true,
  wreckAlt: true,
};

/** Every `ClipName`, for iteration and validation. */
export const CLIP_NAMES = Object.keys(CLIP_NAME_SET) as ClipName[];

/** True for any of the six canonical clip names. Used to validate a loaded
 *  GLB's animation names against the contract: "a clip present under any
 *  other name is a failure" (mesh-unit-contract.md). */
export function isMeshClipName(name: string): name is ClipName {
  return Object.prototype.hasOwnProperty.call(CLIP_NAME_SET, name);
}

/**
 * Requested clip, or `idle` when this GLB never authored it -- mirrors
 * `sheet.ts`'s `clipOrFallback` line for line, for the identical reason: "a
 * sheet with no `fire` yet simply keeps standing there", now true of a mesh
 * unit's GLB instead of a sprite sheet's manifest. `available` is the set of
 * clip names a loaded `MeshUnitTemplate` actually carries an
 * `AnimationClip` for.
 */
export function meshClipOrFallback(available: ReadonlySet<ClipName>, clip: ClipName): ClipName {
  return available.has(clip) ? clip : 'idle';
}

/**
 * `tools/dimetric.py`'s `UNITS_PER_TILE`: Blender builds at real metres,
 * three.js draws one world unit per tile, so a mesh unit's root needs
 * `1 / MESH_UNITS_PER_TILE` -- see `mesh-unit-contract.md`'s "Units and
 * orientation" and the spike's own `spike/rig-scene.ts` top comment, "The
 * scale chain, which is easy to get wrong in two places."
 */
export const MESH_UNITS_PER_TILE = 3.0;

/** The uniform scale every mesh unit's cloned root is set to, once, at
 *  instantiation -- applied to the shared template root so every future
 *  clone inherits it for free (`SkeletonUtils.clone` copies `.scale`). */
export const MESH_SCALE = 1 / MESH_UNITS_PER_TILE;

/**
 * World-space yaw (radians, for `Object3D.rotation.y`) for a sim `facing` in
 * 0..1 turns, where 0 means "facing world +x" -- the same convention
 * `frame-state.ts`'s turret spring already uses (`Math.atan2(dy, dx) / (2π)`
 * against GAME `x`/`y`, and `EntityFrame`'s own top comment: "three.js world
 * position: game (x, y) -> (x, groundY + lift, y)", i.e. game x is world X
 * and game y is world Z).
 *
 * The contract builds a mesh unit's rest pose facing LOCAL +X
 * (mesh-unit-contract.md, "Forward is +X"). `THREE.Matrix4.makeRotationY`
 * sends local +X to world `(cos θ, 0, -sin θ)` (three.js's own convention --
 * see `Matrix4.js`'s `makeRotationY`, row `[c, 0, s; 0,1,0; -s,0,c]` applied
 * to a column vector). We want that to equal world `(cos 2πf, 0, sin 2πf)`
 * (facing `f` turns, mapped through the same game-x -> world-X, game-y ->
 * world-Z convention `EntityFrame` uses): matching components gives
 * `cos θ = cos 2πf` and `-sin θ = sin 2πf`, so `θ = -2πf`.
 *
 * Untested against a real GLB at the time this was written (the exporter is
 * being built in parallel and no shipped mesh existed yet) -- verified only
 * by the derivation above and by the unit tests alongside this file, which
 * pin the four axis-aligned facings this reasoning predicts. Flagged as a
 * genuine open risk in this task's report: the sign convention here has not
 * been confirmed against a browser render of an actual turning figure.
 */
export function meshYawFromFacing(facingTurns: number): number {
  return -2 * Math.PI * facingTurns;
}

/**
 * Override `resolveClip`'s output when a unit is BOTH moving and has fired
 * recently, so a mesh with the `moveFire` clip shows a real walking gait
 * with the rifle raised instead of `fire`'s legs-frozen recoil pose.
 *
 * `resolveClip` (`../../clip.ts`) already outranks `moving` with `firing` in
 * its own precedence chain — a moving unit that just fired is handed `fire`,
 * not `move` — so `desired === 'fire'` here IS "moving and fired recently"
 * once combined with the `moving` flag this function also takes: `firing`
 * (the sim signal `resolveClip` read to arrive at `'fire'`) is itself
 * "`firingTimer[i] > 0`", latched to this type's own mesh fire-clip duration
 * by `ThreeRenderer.fireLatchSeconds` (0.5 s measured for `sarim_rifles`) —
 * no new sim coupling, no new timer, the exact signal the brief said to
 * reuse.
 *
 * `hasMoveFire` is a plain boolean (`entity.actions.has('moveFire')`)
 * rather than a `ReadonlySet`/`ReadonlyMap` — the call site already has the
 * one bit this function needs and there is no reason to make it build or
 * pass a collection just to ask one question of it.
 *
 * Returns `desired` UNCHANGED whenever the override does not apply —
 * deliberately never routing back through `meshClipOrFallback` itself,
 * because that function degrades ANY clip absent from `available` to
 * `idle`, which is wrong here: a GLB with no `moveFire` (all fifteen other
 * infantry teams, today) must keep showing exactly what `resolveClip`
 * already asked for (`fire`, then `applyMeshClip`'s own existing fallback
 * chain from there) — "untouched" by this feature, not silently frozen to
 * idle by it.
 */
export function resolveMeshMotionClip(
  desired: ClipName,
  moving: boolean,
  hasMoveFire: boolean
): ClipName {
  return desired === 'fire' && moving && hasMoveFire ? 'moveFire' : desired;
}

/**
 * A cheap, render-only integer hash of an entity id — never `Math.random`,
 * never a sim RNG stream (invariant 3 is sim machinery for sim OUTCOMES;
 * which of two equally-valid corpse poses an already-dead entity's mesh
 * shows changes nothing the sim can observe, so pulling from a seeded
 * per-entity stream for it would be exactly the sim/render coupling
 * invariant 4 forbids). Knuth's multiplicative hash — deterministic, and the
 * same entity id always produces the same bit, which is the whole point:
 * the same replay must show the same fall every time.
 */
export function hashEntityId(id: number): number {
  return Math.imul(id ^ 0x9e3779b9, 2654435761) >>> 0;
}

/**
 * Which wreck clip entity `entityId` should play. `wreckAlt` is free visual
 * variation on the same corpse state, not a fallback and not a preference —
 * see `import_meshy_soldier_irregular.py`'s module docstring for why the
 * second fall was rejected for the PRIMARY `wreck` slot but is a perfectly
 * good SECOND one. `hasWreckAlt` is `entity.actions.has('wreckAlt')`, the
 * same "one bit, pass it directly" shape `resolveMeshMotionClip` uses above.
 *
 * Only ever called once the caller has already confirmed `wreck` itself is
 * available (`stepMeshDeath`'s existing `entity.actions.has('wreck')` gate,
 * unchanged) — a team with no `wreckAlt` simply always gets `'wreck'` back,
 * exactly today's behaviour.
 */
export function pickDeathClip(entityId: number, hasWreckAlt: boolean): ClipName {
  return hasWreckAlt && hashEntityId(entityId) % 2 === 1 ? 'wreckAlt' : 'wreck';
}
