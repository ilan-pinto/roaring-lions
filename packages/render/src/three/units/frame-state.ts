/**
 * Task B3.3: the per-entity frame decision -- everything Pixi's `frame()`
 * unit loop (`renderer.ts:1919` onward) decides about one living unit that
 * is NOT a draw call. Where it is this frame, how high the ground is under
 * it, which clip it should be playing, which frame of that clip, which
 * facing, how opaque. `ThreeRenderer` (a later task) assembles
 * `EntityFrameInput` from `Sim` and calls this once per living entity; the
 * instancing layer that turns the result into GPU attributes is a different
 * file again.
 *
 * Deterministic given its inputs, with caller-owned phase state passed in
 * and mutated in place (`entityAnimFrame`/`animSeeded` below) -- no `Sim`,
 * no three.js, no DOM -- because `ThreeRenderer` constructs a
 * `WebGLRenderer` and cannot be exercised under `environment: 'node'`.
 * Everything decided here has to be testable outside it, the same
 * discipline Phase B2's terrain builders already follow. The mutable-array
 * shape mirrors Pixi's own per-entity fields exactly (`entityAnimFrame`,
 * `animSeeded`, `renderer.ts:399-405`) rather than allocating a fresh object
 * per entity per frame, which the repo's struct-of-arrays convention (and a
 * 300-unit-per-frame target) argues against -- and it is genuinely exercised
 * by reading the mutated array back out, not merely asserted (see the
 * "frame advance is time-based" tests below).
 *
 * Reuses `resolveClip`/`clipOrFallback`/`cadenceScale` (`clip.ts`),
 * `walkFps`/`phaseOffset`/`advancePhase` (`anim.ts`) and `groundWorldY`
 * (`ground-height.ts`) rather than reimplementing any of them -- they are
 * already the (backend-agnostic, already-tested) animation model, and a
 * second clip resolver that "looks right" is exactly how the two backends
 * would silently diverge on posture.
 *
 * ## `clearZ` is deliberately not ported
 *
 * Pixi sorts display objects on `x + y` (`depthZ`) and patches the two cases
 * that breaks: a garrisoned unit needs to draw past its own building's roof
 * sprite, and a demolisher working a building's far face needs to draw past
 * the wall between it and the camera. Both patches compute a `clearZ` --  a
 * depth override one past the building's own sort key -- and apply it
 * instead of the unit's natural `depthZ(x, y)`.
 *
 * Neither exists here. In three.js depth comes from the depth buffer, not a
 * sort key:
 *
 *  - **Garrison**: `terrain/buildings.ts` genuinely DOES extrude a box above
 *    the ground -- `roofY = topY + b.heightPx * WORLD_Y_PER_LIFT_PIXEL`
 *    (`buildings.ts:324`), with south/east walls and a roof quad filling
 *    that span. An earlier draft of this comment claimed no geometry stands
 *    above the footprint's terrain height; that was wrong, and it would have
 *    mattered: a roof occupant whose `worldY` sat at ground level with only
 *    a *screen-pixel* `roofDy` nudge on top would depth-test at the
 *    building's floor, lose to its own walls and roof, and draw hidden
 *    inside it -- `clearZ`'s exact failure, reborn, because a post-projection
 *    screen offset moves a sprite without moving its depth.
 *    The fix is not `clearZ` -- it is giving the occupant the SAME real
 *    height the roof geometry itself has. `roofPx` (already the sheet's
 *    `roofTopPx`/`badgeTopPx`/`heightPx` fallback, in the same screen-pixel
 *    convention `buildings.ts` reads `heightPx` in) is converted through
 *    `WORLD_Y_PER_LIFT_PIXEL` -- the exact multiplier `buildings.ts:324`
 *    itself uses -- and added to `worldY`, not carried as `roofDy`. `roofDy`
 *    is 0 unconditionally now; only `roofDx` (lateral spread between two
 *    occupants) remains a screen-space nudge, because two figures standing
 *    side by side is a presentation choice with no physical roof-plane
 *    position the sim tracks, unlike height, which the roof geometry itself
 *    defines. With that in place, a roof occupant's `worldY` sits at the
 *    same height as the roof quad it is standing on, genuinely above the
 *    wall geometry below it, and the depth buffer resolves it correctly
 *    with no sort key at all -- which is what this argument claimed all
 *    along, now actually true of what the code computes rather than merely
 *    of what the geometry happens to allow.
 *  - **Demolisher**: Pixi's own comment says the quiet part -- a demolisher
 *    working a building's north or west face, sorted by `x + y` alone,
 *    draws *behind* the wall it is destroying, "which reads as the
 *    demolition being broken rather than merely hidden." `clearZ` exists
 *    only to paper over that 2D sorting artefact. In three.js there is no
 *    artefact to paper over: a demolisher at the north face genuinely sits
 *    behind the building from the camera's dimetric angle, so occluding it
 *    is *correct* -- and it is the far side's dust and impact VFX (not
 *    scoped to this task, but drawn in world space like everything else)
 *    that reads, exactly as it would for a real observer standing where the
 *    camera stands. Forcing the demolisher to draw in front would be the
 *    new bug, not the fix for one.
 *
 * If a real case ever needs an override (Ruling 3's escape hatch), three.js
 * has `renderOrder` for it -- but nothing in this task, or in the two ported
 * cases above, demonstrates a failure that needs it.
 */
import { fx, type Fx } from '@lions/sim';
import { resolveClip, resolveTurretClip, cadenceScale, type UnitAnimInput } from '../../clip';
import { walkFps, phaseOffset, advancePhase } from '../../anim';
import { clipOrFallback, type ClipName, type SheetSpec } from '../../sheet';
import { WORLD_Y_PER_LIFT_PIXEL } from '../../project';
import { groundWorldY, type ElevationSource } from '../ground-height';
import { screenOffsetToWorld } from '../terrain/shared';

/**
 * Recoil/flinch travel, in SCREEN pixels -- redeclared from `renderer.ts`'s
 * own `RECOIL_PX_VEHICLE`/`RECOIL_PX_SOFT`/`FLINCH_PX` (private, unexported)
 * rather than imported, the same reason `ROOF_SLOTS`/`ROOF_SPREAD_PX` above
 * are redeclared: importing anything from `renderer.ts` would pull pixi.js
 * into this module's graph. `RECOIL_SECONDS`/`FLINCH_SECONDS` (the DECAY
 * durations) are NOT redeclared here -- draining `recoilT`/`flinchT` toward
 * 0 is a once-a-frame, cross-entity operation (`ThreeRenderer.frame()`'s own
 * top-of-frame drain, mirroring `PixiRenderer.frame()`'s), not a per-entity
 * decision, so it belongs with the array it drains, not here.
 */
export const RECOIL_PX_VEHICLE = 3;
export const RECOIL_PX_SOFT = 1;
export const FLINCH_PX = 2.5;

/**
 * How far an `isAir` unit stands above its own ground tile. Redeclared from
 * `renderer.ts`'s own `AIR_LIFT_PX` (private, value 14, `renderer.ts:77`)
 * for the same reason everything else in this file is redeclared rather
 * than imported -- see this file's own header, and `RECOIL_PX_VEHICLE`
 * above.
 *
 * Applied differently from Pixi on purpose, and this is the one constant in
 * this file where "differently" needs its own justification rather than
 * silent parity. Pixi has no z-buffer: `AIR_LIFT_PX` there is a POST-
 * PROJECTION screen-pixel nudge (`sprite.position`), applied after the
 * dimetric transform, with nothing underneath it but a separately-drawn
 * shadow ellipse standing in for "this thing is actually somewhere else."
 * This backend has a real depth buffer and a real `groundWorldY` (this
 * module's own "`clearZ` is deliberately not ported" section already made
 * the identical argument for garrison roof placement: a screen-space nudge
 * moves a sprite without moving its DEPTH, and a real height does not).
 * Converting `AIR_LIFT_PX` through `WORLD_Y_PER_LIFT_PIXEL` -- the same
 * conversion `roofLiftWorld` below already applies to `roofPx` -- gives an
 * `isAir` unit a genuine world-Y position above the ground, not merely a
 * sprite drawn higher on screen: it billboards correctly as the camera's
 * fixed dimetric angle would actually show something flying (foreshortened
 * exactly like a roof occupant is), and it is real geometry a future terrain
 * occluder could correctly hide behind a ridge, rather than a screen offset
 * that terrain would have no depth relationship to at all.
 */
export const AIR_LIFT_PX = 14;

/**
 * How many of a building's occupants get a roof slot. Mirrors `ROOF_SLOTS`
 * in `renderer.ts` (private, value 2) -- redeclared rather than imported for
 * the same reason `terrain/shared.ts` redeclares `TERRAIN_DECOR`: importing
 * anything from `renderer.ts` would pull pixi.js into this module's module
 * graph, and this module must stay backend-agnostic (`three/**` may import
 * three.js, but this file needs neither it nor Pixi).
 */
export const ROOF_SLOTS = 2;
/** Lateral spacing between roof figures, in screen px. Mirrors
 *  `ROOF_SPREAD_PX` in `renderer.ts` (private, value 13); same reason. */
export const ROOF_SPREAD_PX = 13;

/**
 * Task B3.6: turret traverse spring constants. Redeclared from
 * `renderer.ts`'s own `TURRET_STIFFNESS`/`TURRET_DAMPING` (private,
 * unexported, values 90/13, `renderer.ts:80-81`) for the same reason
 * everything else in this file is redeclared rather than imported --
 * importing anything from `renderer.ts` would pull pixi.js into this
 * module's graph. A damped spring, not a linear lerp, so traverse
 * overshoots slightly and settles -- Pixi's own comment: "A turret has
 * mass; the old lerp read as a servo snapping to its setpoint."
 */
export const TURRET_STIFFNESS = 90;
export const TURRET_DAMPING = 13;

/**
 * The three.js draw-ready state of one living unit for one rendered frame.
 * Everything downstream (the instanced-mesh attribute writer) reads this and
 * nothing else -- it never reaches back into `Sim`.
 */
export interface EntityFrame {
  /** three.js world position: game (x, y) -> (x, groundY + lift, y). */
  wx: number;
  wy: number;
  worldY: number;
  clip: ClipName;
  /** Index into the clip's frames, already advanced by elapsed time. */
  frame: number;
  facing: number;
  alpha: number;
  /** Screen-pixel offset for a garrisoned unit standing on a roof. */
  roofDx: number;
  roofDy: number;
  visible: boolean;
  /**
   * `EntityFrameInput.side`, carried through unchanged -- 0 is the player's
   * own, 2 is civilians, anything else is hostile.
   *
   * Nothing in the BODY path reads it (`bodyAlpha` above already consumed
   * it, and a unit's art is the same art whoever fields it). It is here for
   * the occlusion silhouette, which is flat team colour by definition and
   * therefore needs the one fact the art does not carry: whose unit this is.
   * Carried on the frame rather than looked up again downstream so the
   * silhouette's colour comes from the SAME per-entity read the body's own
   * contact-level fade does, not a second one that could disagree at a
   * `side` this function was never given.
   */
  side: number;
  /**
   * Task B3.6: the turret's own facing (0..1 turns), sprung toward a live
   * target and returning to `facing` (the hull's) once there is none --
   * `renderer.ts:2111-2170`. Equals `facing` verbatim whenever this entity's
   * type has no turret sheet (`EntityFrameInput.turretSheet` was `null`):
   * meaningless to draw in that case (there is no turret mesh to draw it
   * with), but still a well-defined number rather than a sentinel, so a
   * caller reading it before checking for turret art gets the hull's own
   * heading rather than 0 or NaN.
   */
  turretFacing: number;
  /**
   * Resolved via `resolveTurretClip` (`clip.ts`) -- `idle` whenever this
   * entity has no turret sheet, the turret's own firing signal
   * (`EntityFrameInput.turretFiring`) is not set, or the turret sheet does
   * not declare `fire`. See this module's top comment for why this is
   * resolved from an INDEPENDENT firing signal rather than the hull's own
   * `clip` above.
   */
  turretClip: ClipName;
  /** Frame index into `turretClip`, clamped to the turret's own declared
   *  frame count for it -- NOT the same clamp as the hull's `frame` above,
   *  since a turret sheet's frame count for a given clip need not match the
   *  hull's. Always 0 when there is no turret sheet. */
  turretFrame: number;
}

/**
 * Everything `entityFrame` needs for one entity, for one frame. Plain
 * arrays and numbers -- no `Sim` -- so `ThreeRenderer` (which does have a
 * `Sim`) is the only thing that has to know how to build one.
 */
export interface EntityFrameInput {
  /** Index this entity's persisted animation-phase state
   *  (`entityAnimFrame`/`animSeeded` below) lives at. */
  entityId: number;

  // --- interpolation: renderer.ts:1930-1931 ---
  prevX: number;
  prevY: number;
  curX: number;
  curY: number;
  alpha: number;

  // --- ground lift: renderer.ts:1977 (`groundOffset`) ---
  elevation: ElevationSource;
  mapWidth: number;
  mapHeight: number;

  // --- contact-level body alpha: renderer.ts:1984-1988 ---
  side: number;
  /** `sim.contactLevel(0, entityId)` -- 0, 1 or 2. Ignored when `side` is 0
   *  (the player's own units are always drawn at full opacity). */
  contactLevel: number;

  // --- air lift: renderer.ts:2079-2090 (`AIR_LIFT_PX`) ---
  /** This entity's unit type's `isAir` flag (`UnitType.isAir`, `@lions/sim`).
   *  See `AIR_LIFT_PX`'s own doc comment for why this becomes a real
   *  world-Y offset here rather than Pixi's post-projection screen nudge. */
  isAir: boolean;

  // --- garrison roof placement: renderer.ts:1936-1956 (`roofPlacement`) ---
  /**
   * This entity's slot on its building's roof this frame, or -1 when it is
   * not garrisoned. The output of `assignRoofSlots` below, sliced to one
   * entity -- a per-frame, cross-entity assignment that (like Pixi's own
   * pre-pass, `renderer.ts:1899-1911`) has to run once over every entity
   * before any single one can be decided, so it cannot live inside this
   * per-entity function. A slot `>= ROOF_SLOTS` is a legal input: it is
   * exactly the over-the-cap case `visible` reports `false` for below,
   * mirroring Pixi's `if (!place) continue`.
   */
  roofSlot: number;
  /**
   * `roofTopPx ?? badgeTopPx ?? heightPx` of the structure this entity is
   * garrisoned in (renderer.ts:1946-1950), in screen pixels -- already
   * resolved by the caller, which owns the structure-sheet lookup this
   * needs (backend- and atlas-specific, out of scope here). Ignored when
   * `roofSlot` is -1.
   *
   * Unlike Pixi, this is NOT applied as a screen-pixel `roofDy` nudge: it is
   * converted through `WORLD_Y_PER_LIFT_PIXEL` and added to `worldY`, the
   * same conversion `terrain/buildings.ts:324` applies to a structure's own
   * `heightPx` to place its roof quad. See this module's top comment
   * (`clearZ` is deliberately not ported) for why that distinction is
   * load-bearing, not stylistic.
   */
  roofPx: number;

  // --- clip resolution + frame advance: renderer.ts:1990-2024 ---
  sheet: SheetSpec;
  anim: UnitAnimInput;
  /** Elapsed real time this frame represents, already clamped by the
   *  caller the way `renderer.ts`'s own `frame()` clamps `dtMs` to 100ms. */
  dtSeconds: number;
  /**
   * Per-entity fractional walk-cycle phase, in frames, and whether it has
   * been given its de-sync offset yet -- exactly Pixi's own
   * `entityAnimFrame`/`animSeeded` (`renderer.ts:399-405`). Owned and
   * persisted by the caller across frames; mutated in place here. A
   * one-frame clip (`down`, `wreck`, or any clip whose sheet declares one
   * frame) leaves both untouched, matching Pixi's `if (nFrames > 1)` guard
   * exactly: a static posture has nothing to advance, and must not disturb
   * a phase a later multi-frame clip will resume from.
   */
  entityAnimFrame: Float64Array;
  animSeeded: Uint8Array;

  // --- facing: renderer.ts:1990 (`const facingNorm = fx.toNumber(...)`) ---
  /** Raw Q16.16 facing (sim units). `fx.toNumber` is applied inside
   *  `entityFrame`, not by the caller, matching the brief. */
  facing: Fx;

  // --- recoil / flinch: renderer.ts:2048-2063, Task B3.14 ---
  /**
   * 1 at the instant this entity fires, decaying to 0 over `RECOIL_SECONDS`
   * -- `PixiRenderer.recoilT`'s own per-entity value, already drained for
   * this frame by the caller before `EntityFrameInput` is assembled (Task
   * B3.5's `entityAnimFrame`/`animSeeded` are owned and mutated the same
   * way; `recoilT`/`flinchT` below are owned and only READ here, since
   * decay is a once-a-frame, cross-entity operation, not a per-entity one).
   */
  recoilT: number;
  /** Normalised (0..1 turns) bearing the shot was fired along -- the recoil
   *  kicks the entity back opposite this bearing. */
  recoilDir: number;
  /** 0..1, `firePower(weapon)` at the moment of the shot that is still
   *  decaying -- interpolates the kick between `RECOIL_PX_SOFT` (a rifle,
   *  barely a nudge) and `RECOIL_PX_VEHICLE` (a main gun, a real shove). */
  recoilPower: number;
  /** 1 at a penetrating hit, decaying to 0 over `FLINCH_SECONDS`. */
  flinchT: number;
  /** Normalised (0..1 turns) bearing FROM the shooter TO this entity -- the
   *  flinch jolts it further along this same bearing, away from the hit. */
  flinchDir: number;

  // --- turret facing: Task B3.6, renderer.ts:2111-2170 ---
  /**
   * This entity's unit type's turret sheet, or `null` when it has none --
   * most unit types (only vehicles with a `turretPath` in `main.ts`'s
   * `SPRITE_MAP` have one). Doubles as the "has a turret" gate: there is
   * nothing to gate WITH a turret sheet and nothing FOR without one, so a
   * separate boolean would only be able to disagree with this by mistake.
   */
  turretSheet: SheetSpec | null;
  /**
   * World position to aim the turret at this frame, or `null` when there is
   * no live target -- the turret returns to the hull's own heading
   * (renderer.ts:2116-2117, "With no target the turret returns to the
   * hull's heading"). Resolved by the caller from `curTarget`/`curStructure`
   * (needs `Sim`, which this module deliberately does not import, per its
   * own top comment) -- `entityFrame` itself only ever reads these two
   * numbers, exactly like Pixi's own `ax`/`ay` (renderer.ts:2119-2120).
   */
  turretTargetX: number | null;
  turretTargetY: number | null;
  /**
   * Whether the TURRET itself just fired -- a signal INDEPENDENT of the
   * hull's own `anim.firing`, and deliberately so: every shipped hull sheet
   * with turret art (TNK/EITAN/NAMER/GUNTRUCK/TECH) declares NO `fire` clip
   * of its own (verified against every one of their manifests), so
   * `anim.firing` -- latched from the HULL's fire-clip duration -- never
   * becomes true for a turreted vehicle at all. Reusing it here would leave
   * `resolveTurretClip` forever called with something other than `'fire'`,
   * which is exactly how the gun truck's 16 recoil-frame turret pose stayed
   * dead art even after the loadSprites fix that made every turret clip
   * LOADABLE (`renderer.ts`'s own `loadSprites` comment) -- loadable is not
   * the same as reachable if nothing ever asks for it. Owned and latched by
   * the caller (`ThreeRenderer.onFire`, off the TURRET sheet's own fire
   * clip duration), exactly like `anim.firing`/`firingTimer` is for the hull.
   */
  turretFiring: boolean;
  /**
   * Persisted per-entity turret facing (0..1 turns) and angular velocity
   * (turns/s), mutated in place -- owned by the caller across frames,
   * exactly like `entityAnimFrame`/`animSeeded` above. Mirrors Pixi's own
   * `turretFacing`/`turretVel` (renderer.ts:421-425) field-for-field.
   * `turretSeeded` is this pair's own `animSeeded`: the spring's very first
   * update for an entity must start FROM the hull's current facing
   * (mirroring Pixi's "seed turret facing to hull facing on first
   * snapshot", renderer.ts:748-750), or a freshly spawned turret would
   * visibly whip from angle 0 (Float64Array's zero-fill) to wherever it is
   * actually aiming the instant it first acquires a target -- seeded here,
   * per-entity on ITS OWN first `entityFrame` call, rather than Pixi's
   * single `frameN === 0` gate, so a reinforcement that spawns mid-mission
   * is seeded on its own first frame too, not left frozen at 0 until then.
   */
  turretFacing: Float64Array;
  turretVel: Float64Array;
  turretSeeded: Uint8Array;
}

/**
 * Everything `stepTurretFacing` needs, extracted verbatim from `entityFrame`'s
 * own turret-spring block (Task B3.6, renderer.ts:2111-2170) so a caller that
 * has no `SheetSpec`/clip to resolve -- a mesh vehicle, which has no billboard
 * turret sheet at all -- can still drive the identical spring, off the SAME
 * persisted per-entity state (`turretFacing`/`turretVel`/`turretSeeded`), the
 * SAME seeding rule, and the SAME `TURRET_STIFFNESS`/`TURRET_DAMPING`
 * constants a turreted billboard vehicle already uses.
 *
 * This is the mesh-unit-contract's own "Turret bearing... already comes from
 * sim state on the billboard path... reuse that source; do not invent a
 * second one" requirement, made literal: `entityFrame` below and
 * `ThreeRenderer.updateVehicleMeshes` both call this SAME function, so a
 * type's turret bearing is computed in exactly one place regardless of which
 * path draws it.
 */
export interface TurretSpringInput {
  /** Index into the persisted `turretFacing`/`turretVel`/`turretSeeded`
   *  arrays -- the sim entity id, exactly like `EntityFrameInput.entityId`. */
  entityId: number;
  /** The hull's own facing, 0..1 turns -- `fx.toNumber(facing)`, already
   *  crossed out of Q16.16 by the caller. */
  facingNorm: number;
  /** The shooter's own last-tick EXACT position (`curX`/`curY`, never the
   *  frame-interpolated `wx`/`wy`) -- see this function's own body comment,
   *  ported verbatim from `entityFrame`, for why. */
  curX: number;
  curY: number;
  /** World position to aim at, or `null` for "no live target -- spring back
   *  to the hull's own heading". */
  targetX: number | null;
  targetY: number | null;
  dtSeconds: number;
  /** Persisted per-entity turret facing (0..1 turns) and angular velocity
   *  (turns/s), mutated in place -- owned by the caller across frames, the
   *  identical arrays `EntityFrameInput.turretFacing`/`turretVel` name. */
  turretFacing: Float64Array;
  turretVel: Float64Array;
  turretSeeded: Uint8Array;
}

/**
 * Advances one entity's turret-traverse spring by one frame and returns its
 * new facing (0..1 turns) -- extracted from `entityFrame`'s own turret block
 * with NO behavioural change; `entityFrame` below calls this directly, so the
 * billboard turret's own bearing is unaffected by this extraction (pinned by
 * this file's own existing tests, which exercise `entityFrame` end to end).
 */
export function stepTurretFacing(input: TurretSpringInput): number {
  const { entityId, facingNorm, curX, curY, targetX, targetY, dtSeconds, turretFacing, turretVel, turretSeeded } =
    input;

  if (turretSeeded[entityId] === 0) {
    // Seed to the hull's CURRENT facing the first time this entity is ever
    // decided with turret art loaded -- mirrors Pixi's own "seed turret
    // facing to hull facing on first snapshot" (renderer.ts:748-750), but
    // keyed per-entity (`turretSeeded`) rather than Pixi's single
    // `frameN === 0` gate, so a reinforcement that spawns mid-mission is
    // seeded on ITS OWN first frame rather than left frozen at 0
    // (Float64Array's zero-fill) until something gives it a target.
    turretFacing[entityId] = facingNorm;
    turretSeeded[entityId] = 1;
  }

  // With no target the turret returns to the hull's heading
  // (renderer.ts:2116-2117). `curX`/`curY`, not the interpolated `wx`/`wy`
  // -- Pixi's own goal-angle math reads `this.curX[i]`/`this.curY[i]`
  // (the shooter) against `this.curX[target]`/`this.curY[target]` (or the
  // structure's centre), both last-tick exact positions, never the
  // frame-interpolated ones (renderer.ts:2119-2123).
  let goalTurn = facingNorm;
  if (targetX !== null && targetY !== null) {
    const dx = targetX - curX;
    const dy = targetY - curY;
    goalTurn = (((Math.atan2(dy, dx) / (Math.PI * 2)) % 1) + 1) % 1;
  }

  // Damped spring, not a linear lerp -- traverse overshoots slightly and
  // settles (renderer.ts:2125-2138). See TURRET_STIFFNESS/TURRET_DAMPING's
  // own doc comment.
  let delta = goalTurn - turretFacing[entityId];
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  // Bounded integration step -- explicit Euler diverges once damping * dt
  // exceeds 1, which a 100ms frame hitch would reach, so the spring
  // integrates on a bounded step even when the frame took longer
  // (renderer.ts:2131-2134).
  const sdt = Math.min(dtSeconds, 1 / 30);
  const accel = delta * TURRET_STIFFNESS - turretVel[entityId] * TURRET_DAMPING;
  turretVel[entityId] += accel * sdt;
  turretFacing[entityId] += turretVel[entityId] * sdt;
  turretFacing[entityId] = ((turretFacing[entityId] % 1) + 1) % 1;
  return turretFacing[entityId];
}

/**
 * Which roof slot (0..ROOF_SLOTS-1, or higher if over the cap) each
 * garrisoned, living entity gets this frame, or -1 if not garrisoned.
 *
 * Assigned once per frame in ascending entity-id order, mirroring Pixi's own
 * pre-pass (`renderer.ts:1897-1911`) exactly -- "so the spread is stable
 * rather than flickering between frames" (that comment's own words). Not a
 * per-entity decision: it has to see every entity garrisoned in the same
 * building before any one of them can be told which slot it has, which is
 * why it is a separate function rather than folded into `entityFrame`.
 */
export function assignRoofSlots(
  garrisonedIn: Int32Array,
  alive: Uint8Array,
  entityCount: number
): Int8Array {
  const slots = new Int8Array(entityCount).fill(-1);
  const seen = new Map<number, number>();
  for (let i = 0; i < entityCount; i++) {
    if (alive[i] === 0) continue;
    const inside = garrisonedIn[i];
    if (inside < 0) continue;
    const n = seen.get(inside) ?? 0;
    seen.set(inside, n + 1);
    slots[i] = n;
  }
  return slots;
}

/**
 * Lateral screen-pixel spread for a roof occupant, or `null` past the cap.
 * Mirrors the `dx` half of `PixiRenderer.roofPlacement`
 * (`renderer.ts:377-384`) exactly -- the `dy` half (`-roofPx`) is NOT
 * mirrored here: that was a screen-space stand-in for real height, which
 * three.js does not need. See this module's top comment for why the
 * vertical component is folded into `worldY` instead.
 */
function roofSpreadPx(slot: number): number | null {
  if (slot < 0 || slot >= ROOF_SLOTS) return null;
  return (slot - (ROOF_SLOTS - 1) / 2) * ROOF_SPREAD_PX;
}

/**
 * The full per-entity decision, ported from `renderer.ts`'s `frame()` unit
 * loop (see this module's own top comment for exactly which lines, and for
 * why `clearZ` is not among them).
 */
export function entityFrame(input: EntityFrameInput): EntityFrame {
  const {
    entityId,
    prevX,
    prevY,
    curX,
    curY,
    alpha,
    elevation,
    mapWidth,
    mapHeight,
    side,
    contactLevel,
    isAir,
    roofSlot,
    roofPx,
    sheet,
    anim,
    dtSeconds,
    entityAnimFrame,
    animSeeded,
    facing,
    recoilT,
    recoilDir,
    recoilPower,
    flinchT,
    flinchDir,
    turretSheet,
    turretTargetX,
    turretTargetY,
    turretFiring,
    turretFacing,
    turretVel,
    turretSeeded,
  } = input;

  // Interpolation between the last two sim ticks (renderer.ts:1930-1931).
  // `let`, not `const`: recoil/flinch (below) offset these in place, AFTER
  // `worldY` has already sampled ground height at the un-offset position --
  // matching Pixi exactly, which computes `lift = groundOffset(x, y)`
  // (renderer.ts:1977) before applying its own screen-space `ox`/`oy`
  // nudges (renderer.ts:2048-2063). Recoil/flinch travel at most a few
  // world-hundredths of a tile, so this ordering is not merely parity with
  // Pixi -- re-sampling ground height from the offset position could only
  // ever matter exactly at a terrace edge, and Pixi never attempts it there
  // either.
  let wx = prevX + (curX - prevX) * alpha;
  let wy = prevY + (curY - prevY) * alpha;

  // Garrison roof placement (renderer.ts:1936-1956). Only the LATERAL spread
  // between two occupants stays screen-space (`roofDx`, always paired with
  // `roofDy: 0` below); the vertical lift is real world height, folded into
  // `worldY` below rather than carried as a `roofDy` nudge -- see this
  // module's top comment for why that distinction is load-bearing.
  let roofDx = 0;
  let roofLiftWorld = 0;
  let visible = true;
  if (roofSlot >= 0) {
    const spread = roofSpreadPx(roofSlot);
    if (spread === null) {
      // Over the cap: Pixi's `continue` here (renderer.ts:1952) exits the
      // rest of the loop body for this entity outright -- no body alpha, no
      // clip resolution, no frame advance. The one piece of that skip with
      // an actual observable effect is the frame-advance mutation below,
      // guarded on `visible` rather than re-checked there: an occupant that
      // will never draw must never silently advance -- or seed -- its own
      // persisted animation phase, or it would visibly jump the moment a
      // roof slot frees up and it becomes visible again. Every other value
      // computed below (`worldY`, `bodyAlpha`, `clip`, `facing`) is pure and
      // discarded when `visible` is false, so computing them anyway costs
      // nothing and diverges from Pixi in no observable way.
      visible = false;
    } else {
      roofDx = spread;
      // Same conversion `terrain/buildings.ts:324` applies to a structure's
      // own `heightPx` to place its roof quad -- `roofPx` is in the
      // identical screen-pixel convention.
      roofLiftWorld = roofPx * WORLD_Y_PER_LIFT_PIXEL;
    }
  }

  // Air lift (renderer.ts:2079-2090): a real world-Y offset, not a
  // screen-pixel nudge -- see `AIR_LIFT_PX`'s own doc comment for why. Mutually
  // exclusive with `roofLiftWorld` in practice (an `isAir` type is never
  // `garrisonedIn`), but summed rather than branched regardless, the same
  // "just add it" shape `roofLiftWorld` itself already uses alongside the
  // base ground height.
  const airLiftWorld = isAir ? AIR_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL : 0;

  // Ground lift for this unit's own tile (renderer.ts:1977), plus the roof
  // lift above when garrisoned, plus the air lift above when airborne.
  // `groundWorldY` is the B3.2 adapter over the same `levelAt`/
  // `WORLD_PER_LEVEL` B2's terraced mesh itself uses, so a unit standing on
  // a tile lands exactly on that tile's own top face; a roof occupant lands
  // exactly on the roof quad standing above it; an airborne unit stands the
  // equivalent of `AIR_LIFT_PX` screen pixels above whichever of the two it
  // would otherwise be standing on.
  const worldY = groundWorldY(elevation, mapWidth, mapHeight, wx, wy) + roofLiftWorld + airLiftWorld;

  // Recoil/flinch (renderer.ts:2044-2063): SCREEN-space nudges in Pixi,
  // applied there directly to `sprite.position` post-projection. There is
  // no post-projection position here to nudge -- `wx`/`wy` are pre-
  // projection world coordinates -- so the same screen-pixel deltas are
  // converted through `screenOffsetToWorld`, the identical conversion
  // `roofDx` above is carried through by `writeUnitInstances`
  // (`instances.ts`), generalised to the full 2D vector: unlike `roofDx`
  // (a lateral-only nudge, `dy` always 0), recoil and flinch both carry a
  // vertical SCREEN component too (`oy`, at half amplitude -- Pixi's own
  // dimetric foreshortening), so the one-axis `right.dx` multiply `roofDx`
  // uses is not enough; both components of `screenOffsetToWorld`'s output
  // are needed. Applied directly to `wx`/`wy` rather than exported as a
  // third nudge field: nothing downstream needs to tell "moved by
  // interpolation" apart from "moved by recoil", unlike `roofDx`, which
  // `instances.ts` must convert through ITS OWN copy of the `right` axis
  // because it varies per unit-type geometry in a way recoil/flinch do not.
  let recoilOx = 0;
  let recoilOy = 0;
  if (recoilT > 0) {
    // Ease-out: hardest at the shot, settling back (renderer.ts:2048-2056).
    // Recoil tracks the WEAPON, not the chassis -- a tank's coax nudges, its
    // main gun shoves -- via `recoilPower` (0..1, `firePower` at the shot).
    const k = recoilT * recoilT;
    const px = RECOIL_PX_SOFT + (RECOIL_PX_VEHICLE - RECOIL_PX_SOFT) * recoilPower;
    const a = recoilDir * Math.PI * 2;
    recoilOx -= Math.cos(a) * px * k;
    recoilOy -= Math.sin(a) * px * k * 0.5;
  }
  if (flinchT > 0) {
    // renderer.ts:2058-2063.
    const k = flinchT * flinchT;
    const a = flinchDir * Math.PI * 2;
    recoilOx += Math.cos(a) * FLINCH_PX * k;
    recoilOy += Math.sin(a) * FLINCH_PX * k * 0.5;
  }
  if (recoilOx !== 0 || recoilOy !== 0) {
    const offset = screenOffsetToWorld(recoilOx, recoilOy);
    wx += offset.dx;
    wy += offset.dy;
  }

  // Contact-level body alpha (renderer.ts:1984-1988). The player's own units
  // (side 0) are always full alpha; only what is observed through contact
  // fades in.
  let bodyAlpha = 1;
  if (side !== 0) {
    bodyAlpha = contactLevel === 2 ? 1 : contactLevel === 1 ? 0.65 : 0.35;
  }

  // Clip resolution (renderer.ts:2010) -- `resolveClip` reads posture from
  // sim state (GDD 5.8), `clipOrFallback` degrades to idle when this sheet
  // never authored the requested clip.
  const clip = clipOrFallback(sheet, resolveClip(anim));
  const spec = sheet.clips[clip];
  const nFrames = spec?.frames ?? 1;

  // Frame advance (renderer.ts:2013-2024): time-based, never call-count- or
  // rendered-frame-based, so playback is independent of display refresh
  // rate. A one-frame clip has nothing to advance, and must not touch the
  // persisted phase -- matching Pixi's own `if (nFrames > 1)` guard. `&&
  // visible` matches the over-the-cap `continue` above: see that branch's
  // own comment for why this is the one piece of it that has to be matched.
  let frame = 0;
  if (nFrames > 1 && visible) {
    if (animSeeded[entityId] === 0) {
      entityAnimFrame[entityId] = phaseOffset(entityId, nFrames);
      animSeeded[entityId] = 1;
    }
    // Locomotion is paced by measured ground speed, so feet track the
    // terrain at any speed; every other multi-frame clip runs on its own
    // declared fps.
    const fps =
      clip === 'move' ? walkFps(anim.speed, nFrames) * cadenceScale(anim) : (spec?.fps ?? 0);
    entityAnimFrame[entityId] = advancePhase(entityAnimFrame[entityId], fps, dtSeconds, nFrames);
    frame = Math.min(nFrames - 1, Math.floor(entityAnimFrame[entityId]));
  }

  // Facing (renderer.ts:1990). The only float boundary for a Q16.16 value in
  // this whole function, exactly as Pixi crosses it.
  const facingNorm = fx.toNumber(facing);

  // Turret facing (Task B3.6, renderer.ts:2111-2170). A unit type with no
  // turret sheet has nothing to spring toward and no second mesh to draw --
  // `turretFacingOut` stays the hull's own heading (see `EntityFrame.
  // turretFacing`'s own doc comment for why that is still a well-defined
  // number rather than a sentinel).
  let turretFacingOut = facingNorm;
  let turretClip: ClipName = 'idle';
  let turretFrame = 0;
  if (turretSheet) {
    // Seeding, goal-angle resolution and the damped spring itself now live in
    // `stepTurretFacing` (this module, above) -- extracted, not reimplemented,
    // so a mesh vehicle's turret pivot springs through the identical function
    // a turreted billboard's turret sprite does. Behaviourally unchanged: see
    // that function's own doc comment.
    turretFacingOut = stepTurretFacing({
      entityId,
      facingNorm,
      curX,
      curY,
      targetX: turretTargetX,
      targetY: turretTargetY,
      dtSeconds,
      turretFacing,
      turretVel,
      turretSeeded,
    });

    // Turret clip: resolved from an INDEPENDENT firing signal
    // (`turretFiring`), not the hull's own `anim.firing` -- see
    // `EntityFrameInput.turretFiring`'s own doc comment for why reusing the
    // hull's signal would leave every shipped turret's `fire` clip
    // unreachable (no hull sheet with turret art declares one itself).
    // Everything else about this entity's posture (alive/routed/pinned/
    // working) still applies -- a dead, pinned, routed or tunnel-working
    // unit's turret does not recoil-flash either, matching `resolveClip`'s
    // own precedence for the hull.
    const turretAnim: UnitAnimInput = { ...anim, firing: turretFiring };
    turretClip = resolveTurretClip(resolveClip(turretAnim), turretSheet.clips);
    const turretSpec = turretSheet.clips[turretClip];
    const turretFrameCount = turretSpec?.frames ?? 1;
    // Reuses the HULL's own resolved `frame` index, clamped to the turret's
    // own frame count for its clip -- exactly Pixi's `tframes[Math.min(frame,
    // tframes.length - 1)]` (renderer.ts:2155). Every shipped turret clip
    // has exactly one frame per facing (the gun truck's "16 frames" are 16
    // FACINGS of one recoiled pose, not a 16-frame animation), so this
    // clamp is what makes that pose reachable regardless of the hull's own
    // frame count, not merely a defensive bound.
    turretFrame = Math.min(turretFrameCount - 1, frame);
  }

  return {
    wx,
    wy,
    worldY,
    clip,
    frame,
    facing: facingNorm,
    alpha: bodyAlpha,
    roofDx,
    // Always 0 -- the vertical roof lift lives in `worldY` above, not here.
    // See this module's top comment for why.
    roofDy: 0,
    visible,
    side,
    turretFacing: turretFacingOut,
    turretClip,
    turretFrame,
  };
}
