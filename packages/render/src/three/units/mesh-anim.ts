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
  fall: true,
  fallAlt: true,
};

/** Every `ClipName`, for iteration and validation. */
export const CLIP_NAMES = Object.keys(CLIP_NAME_SET) as ClipName[];

/** True for any of the ten canonical clip names. Used to validate a loaded
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
 *
 * For death clips, implements the fallback chain: fallAlt → fall → down → idle,
 * so a death module never plays a missing name.
 */
export function meshClipOrFallback(available: ReadonlySet<ClipName>, clip: ClipName): ClipName {
  if (available.has(clip)) return clip;
  if (clip === 'fallAlt' && available.has('fall')) return 'fall';
  if ((clip === 'fall' || clip === 'fallAlt') && available.has('down')) return 'down';
  return 'idle';
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
 * The two clips whose playback rate is allowed to follow the ground a unit
 * crosses, and the ONLY two -- design sec 3.4: "Clips that are not
 * locomotion (`idle`, `fire`, `down`, `work`, `wreck`) are never
 * rate-scaled."
 *
 * This is not a convention the call site has to remember. `parseGaitExtras`
 * below refuses any other key, so `MeshUnitTemplate.gait` is keyed by
 * `LocomotionClip` and the compiler will not let a `ClipName` be looked up
 * in it without narrowing first. A gait for `fire` is therefore not merely
 * unused -- it is unrepresentable.
 *
 * `satisfies readonly ClipName[]` is what keeps the two lists honest: if
 * `moveFire` were ever removed from the `ClipName` union, this line stops
 * compiling instead of silently narrowing to nothing.
 */
export const LOCOMOTION_CLIPS = ['move', 'moveFire'] as const satisfies readonly ClipName[];

/** A clip that describes forward travel and therefore has a stride. */
export type LocomotionClip = (typeof LOCOMOTION_CLIPS)[number];

/** True for `move` and `moveFire`, false for every other clip name. */
export function isLocomotionClip(name: string): name is LocomotionClip {
  return (LOCOMOTION_CLIPS as readonly string[]).includes(name);
}

/**
 * What one locomotion clip's legs actually describe, as measured off the
 * GLB's own bytes and written into it by `pnpm gait:meshes`
 * (`tools/src/meshes/gait-pass.ts`, design sec 3.4).
 *
 * `strideM` is the FORWARD ground component of the leading boot's
 * peak-to-peak travel over one cycle, in METRES -- deliberately not the 3-D
 * hypotenuse, which folds in vertical lift and lateral swing and overstates
 * the ground covered by 1.47–17.70% depending on the rig (that was a real
 * defect, caught and fixed in Task 5's review; the bias is rig-dependent so no
 * constant downstream could have corrected for it).
 *
 * `cycleS` is the clip's own length in seconds, and the pass checks its own
 * assumption that one clip is exactly one gait cycle rather than trusting
 * it -- see `countTracePeaks` in `tools/src/mesh_gait.ts`.
 */
export interface GaitMetrics {
  readonly strideM: number;
  readonly cycleS: number;
}

/**
 * The ground speed, in TILES per second, that a clip's own legs describe:
 * `strideM / (cycleS * MESH_UNITS_PER_TILE)`.
 *
 * Both unit conversions in one place. `strideM` is metres because Blender
 * builds at metres; `entitySpeed` is tiles/s because the sim's positions
 * are, so one of the two has to move and this is where it moves. A ratio of
 * two speeds in the same unit is then dimensionless, which is what a
 * `timeScale` is.
 */
export function clipGroundSpeedTiles(gait: GaitMetrics): number {
  return gait.strideM / (gait.cycleS * MESH_UNITS_PER_TILE);
}

/**
 * Upper bound on a locomotion clip's playback rate.
 *
 * **A runtime guard, not the mechanism.** Shipped art is expected to sit
 * well under it, and a clamp that is doing real work on a shipped mesh means
 * that mesh's gait is wrong and should be reported rather than absorbed
 * (design sec 3.4; Task 7's gate is what keeps the residual near 1.0).
 *
 * Derived from the shipped declarations rather than chosen. Every rigged
 * mesh's multiplier at its own `mobility.speed_tiles_s`, measured
 * 2026-09-16 off `art/meshes/**`'s own `rl_gait` extras:
 *
 *     yahalom_squad   2.645   charge_squad    2.484   civilian_child  1.612
 *     inf_squad move  1.541   sarim_rifles    1.486   civilian_woman  1.315
 *     militia_cell    1.295   breach_team     1.295   rpg_team        1.227
 *     farm_worker     1.186   inf_squad mF    1.159   demo_squad      1.159
 *     office_worker   1.119   at_team         1.073   mortar_team     1.019
 *     sniper_team     0.914
 *
 * 4 is 1.51x the worst of those. `sniper_team` was **2.100** in this table
 * until its exporter was reconciled with `rig.py`'s gait (2026-09-16); it is
 * now the one entry BELOW 1.0, meaning the clip plays slower than authored
 * because its sculpted legs over-stride slightly. See
 * `mesh_gait.test.ts`'s `GAIT_MULTIPLIER_FLOOR` for why that is the right
 * outcome and not a second thing to correct. `mesh-anim.test.ts` restates
 * `yahalom_engineer.glb`'s own two numbers and asserts the result lands
 * strictly under this constant, so lowering it below the shipped worst case
 * goes red rather than quietly clipping a unit.
 *
 * What that test CANNOT see is the table above going stale: it holds
 * literals, not bytes. The sweep that reads every shipped GLB belongs to
 * Task 7's gate, whose residual band around 1.0 covers this by construction
 * -- a clamped mesh cannot have a post-rate-match residual of 1 -- PROVIDED
 * that gate computes the residual through `gaitTimeScale` rather than
 * through its own copy of the formula.
 *
 * **The brief for this task suggested 2.5 and that number is wrong**: it
 * clips `yahalom_squad` -- the unit with the single largest correction to
 * make -- and would have put its slide back while every test still passed.
 *
 * **The reachable range, for a unit whose own legs are on the ground, is
 * 0.914x to 2.645x** -- the table above is the whole of it, because
 * `Sim.stepMovement` never moves a unit further than `type.stepPerTick` in a
 * tick and `DIR_VX`/`DIR_VY` are unit vectors, so a diagonal is not faster.
 * Rout goes the other way (half speed times `ROUT_CADENCE` is 0.8x of a
 * type's own figure) and a short final step onto a goal goes further down
 * still. So this constant is a genuine backstop: nothing in normal play
 * approaches it, and a shipped mesh that DOES reach it has a gait fault,
 * which is the invariant Task 7's gate is built on.
 *
 * That last sentence is only true because `ThreeRenderer.applyGaitRate`
 * excludes a CARRIED unit, and this comment claimed otherwise until fix
 * round 1. `Sim.stepTransport` overwrites a passenger's `posX`/`posY` with
 * its carrier's every tick, so a passenger's `entitySpeed` is the VEHICLE's
 * speed: measured live, an `inf_squad` riding an `ifv_namer` read 1.3000
 * tiles/s and 2.2265x, and the worst reachable pairing -- every foot role has
 * `canEmbark` -- is a `sniper_team` in a `jeep_shoded` at 2.9 tiles/s, which
 * computes 13.53 and clamps hard. A man inside a hull has his legs off the
 * ground and no ground speed of his own, so that number is a fiction in both
 * directions and the fix is to not compute it at all.
 *
 * What the guard is left covering is a TELEPORT, which is a sim event and
 * not an art property: `entitySpeed` is `hypot(dx, dy) * SIM_HZ` over one
 * tick's raw position delta, so a unit surfacing from a tunnel, dismounting
 * a transport, or arriving as a reinforcement (its `prevX`/`prevY` still at
 * the array's zero-fill) reads as tens or hundreds of tiles per second for
 * exactly one tick. Unclamped, that is a clip playing some hundreds of times
 * over in 50 ms.
 */
export const GAIT_TIME_SCALE_MAX = 4;

/**
 * Lower bound on a locomotion clip's playback rate.
 *
 * Deliberately far BELOW anything either the art or the sim produces, for a
 * reason the upper bound does not share: a low time scale is the feature,
 * not a fault. "A unit slowed by terrain or crowding slows its legs" (design
 * sec 3.4) is the whole point, so a floor that binds during ordinary slow
 * movement would re-introduce exactly the sliding this change removes, on
 * exactly the units it is meant to help. The brief's example floor of 0.5
 * would do that.
 *
 * The slowest SUSTAINED ground speed a unit reaches while still resolving
 * `move` is a free-axis slide along a wall (`Sim.stepMovement` zeroes one
 * axis of a diagonal step), which is 0.707 of nominal -- 0.72x on the
 * lowest-multiplier shipped mesh. A unit actually halted reads `speed === 0`
 * and `resolveClip` gives it `idle`, not a frozen `move`.
 *
 * **The measured margin is 2x, not the order of magnitude this comment
 * claimed until fix round 1.** The TRANSIENT low is the short final step onto
 * a goal, `min(step, distance)` in `stepMovement`, and a live capture caught
 * an `inf_squad` at 0.0585 tiles/s playing at **0.1002** -- twice this floor
 * and closing. So the floor is close to being reached, deliberately: it is
 * set to be passed by ordinary slow movement rather than to bound it, and it
 * exists only so a degenerate input can never hand three.js a negative or
 * zero rate. If a future change makes it BIND on a unit that is genuinely
 * creeping, lower it rather than accepting the slide.
 */
export const GAIT_TIME_SCALE_MIN = 0.05;

/**
 * Playback rate for one locomotion clip: how fast to run the legs so they
 * cover the ground the unit is actually crossing.
 *
 *     clipGroundSpeed = strideM / (cycleS * MESH_UNITS_PER_TILE)   // tiles/s
 *     timeScale       = (entitySpeed / clipGroundSpeed) * cadence
 *
 * `entitySpeedTiles` is `ThreeRenderer.entitySpeed[i]` -- MEASURED ground
 * speed from the last tick's position delta, not the unit type's nominal
 * `speed_tiles_s` and not the move order. That is the whole reason a unit
 * slowed by terrain, by a wall slide, by a rout or by the short final step
 * onto its goal slows its legs to match, where today it marches at the
 * authored cadence whatever it does.
 *
 * `cadence` is `cadenceScale(anim)` from `../../clip` -- 1 normally and
 * `ROUT_CADENCE` for a broken unit. See `ThreeRenderer.updateMeshUnits`'s
 * call site for the full account of why rout multiplies rather than
 * replaces; the short version is that the BILLBOARD path has always done
 * exactly this (`frame-state.ts`'s `walkFps(anim.speed, n) *
 * cadenceScale(anim)`), so any other choice here would make a routed mesh
 * rifleman and a routed billboard beside it disagree in the same frame.
 *
 * A mesh that declares no gait returns exactly 1 -- today's behaviour, and
 * the right answer for `atgm_cell`, `mortar_crew` and `digger_crew` (whose
 * `move` keys no leg at all) and `moto_rpg` (a motorcycle). Cadence is not
 * applied in that case either: 1.6x of a clip with no legs in it is 1.6x of
 * nothing, and the design's "keeps `timeScale = 1`" is meant literally.
 */
export function gaitTimeScale(
  gait: GaitMetrics | undefined,
  entitySpeedTiles: number,
  cadence: number
): number {
  if (!gait) return 1;
  // A degenerate declaration (`parseGaitExtras` rejects these, so reaching
  // here means a caller built a `GaitMetrics` by hand) or a NaN position
  // falls back to today's behaviour rather than handing three.js a NaN
  // `timeScale`, which propagates into the mixer's own clock and freezes the
  // figure permanently. `clipGround` is checked SEPARATELY from the final
  // ratio and not folded into one `isFinite` at the end: a zero `cycleS`
  // gives an infinite clip speed and therefore a perfectly finite ratio of
  // ZERO, which the clamp would then round up to its floor and play as a
  // near-frozen figure -- a plausible-looking wrong answer, which is worse
  // than an obviously wrong one.
  const clipGround = clipGroundSpeedTiles(gait);
  if (!Number.isFinite(clipGround) || clipGround <= 0) return 1;
  const raw = (entitySpeedTiles / clipGround) * cadence;
  if (!Number.isFinite(raw)) return 1;
  return Math.min(GAIT_TIME_SCALE_MAX, Math.max(GAIT_TIME_SCALE_MIN, raw));
}

/** One `rl_gait` entry, validated. `null` for anything that is not a pair of
 *  finite positive numbers -- see `parseGaitExtras` for why this is a
 *  validation rather than a cast. */
function readGaitMetrics(value: unknown): GaitMetrics | null {
  if (typeof value !== 'object' || value === null) return null;
  const { strideM, cycleS } = value as { strideM?: unknown; cycleS?: unknown };
  if (typeof strideM !== 'number' || !Number.isFinite(strideM) || strideM <= 0) return null;
  if (typeof cycleS !== 'number' || !Number.isFinite(cycleS) || cycleS <= 0) return null;
  return { strideM, cycleS };
}

/**
 * Reads a scene's `rl_gait` extra into the map `MeshUnitTemplate` carries.
 *
 * Validated rather than trusted, and `label` (the GLB's URL) is in every
 * message: this data crosses a process boundary from a Python/`@gltf-transform`
 * build step into the renderer, so the failure mode worth designing for is a
 * file that is a build behind, not a file that is malicious. A malformed
 * entry is DROPPED with a warning naming the file and the key; it never
 * reaches the arithmetic, where a `NaN` stride would silently freeze a
 * figure.
 *
 * Returns `undefined` only when the file declares no `rl_gait` at all, which
 * is the legitimate state of four shipped rigs. A file that declares the key
 * and fills it with nothing gets an empty map AND a warning -- an empty
 * result is a silent one, not a weak one, and "the pass half-ran" must not
 * read the same as "this rig has no legs".
 */
export function parseGaitExtras(
  raw: unknown,
  label: string
): ReadonlyMap<LocomotionClip, GaitMetrics> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(`mesh-unit: ${label} declares rl_gait as ${typeof raw}, not an object -- ignored`);
    return undefined;
  }

  const out = new Map<LocomotionClip, GaitMetrics>();
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (!isLocomotionClip(key)) {
      console.warn(
        `mesh-unit: ${label} declares rl_gait."${key}", which is not a locomotion clip ` +
          `(${LOCOMOTION_CLIPS.join(', ')}) -- dropped; only a clip with a stride can be rate-matched`
      );
      continue;
    }
    const metrics = readGaitMetrics(value);
    if (!metrics) {
      console.warn(
        `mesh-unit: ${label} declares a malformed rl_gait."${key}" ` +
          `(want { strideM > 0, cycleS > 0 }) -- dropped; that clip keeps timeScale 1`
      );
      continue;
    }
    out.set(key, metrics);
  }

  if (out.size === 0) {
    console.warn(
      `mesh-unit: ${label} declares rl_gait with no usable entry -- ` +
        `every locomotion clip in it keeps timeScale 1. Re-run \`pnpm gait:meshes\`.`
    );
  }
  return out;
}

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
export function pickDeathClip(entityId: number, hasWreckAlt: boolean): 'wreck' | 'wreckAlt' {
  return hasWreckAlt && hashEntityId(entityId) % 2 === 1 ? 'wreckAlt' : 'wreck';
}

/** The fall a dying body plays and the corpse it becomes, as one pick. */
export interface DeathClipPick {
  readonly fall: 'fall' | 'fallAlt';
  readonly wreck: 'wreck' | 'wreckAlt';
}

/**
 * Design D3: the variant bit is decided ONCE per entity (`pickDeathClip`'s
 * own hash) and applied to both halves, so the fall a body plays always
 * ends in the pose the wreck holds. `fallAlt` is named only when the file
 * carries it -- a file with `wreckAlt` and no `fallAlt` (none shipped; the
 * gait gate forbids it on a file that has `fall`) plays the primary fall.
 */
export function pickDeathClips(entityId: number, available: ReadonlySet<ClipName>): DeathClipPick {
  const wreck = pickDeathClip(entityId, available.has('wreckAlt'));
  const fall = wreck === 'wreckAlt' && available.has('fallAlt') ? 'fallAlt' : 'fall';
  return { fall, wreck };
}
