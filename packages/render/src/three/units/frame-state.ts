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
 * Pure by construction -- no `Sim`, no three.js, no DOM -- because
 * `ThreeRenderer` constructs a `WebGLRenderer` and cannot be exercised under
 * `environment: 'node'`. Everything decided here has to be testable outside
 * it, the same discipline Phase B2's terrain builders already follow.
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
 *  - **Garrison**: a roof occupant's `worldY` is the ground height under the
 *    *building's* tile (see `roofDx`/`roofDy` below), and the building's own
 *    mesh top face sits at that same tile's terrain height -- never above
 *    it, since a building does not extrude past its footprint's roof plane
 *    in this renderer's terrain builders (`terrain/buildings.ts`). A
 *    billboard positioned at that height, camera-facing, occludes nothing
 *    behind it that a real figure standing on that roof would not also
 *    occlude, and the depth buffer resolves it correctly against the
 *    building geometry with no sort key at all. This is the case Pixi's own
 *    comment calls out as needing the override most ("figures placed there
 *    hovered above the dome") -- and it is precisely the case a Z-buffer
 *    was invented to make unnecessary: real height in a real 3D scene sorts
 *    itself.
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
import { resolveClip, cadenceScale, type UnitAnimInput } from '../../clip';
import { walkFps, phaseOffset, advancePhase } from '../../anim';
import { clipOrFallback, type ClipName, type SheetSpec } from '../../sheet';
import { groundWorldY } from '../ground-height';

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
  elevation: Uint8Array | null;
  mapWidth: number;
  mapHeight: number;

  // --- contact-level body alpha: renderer.ts:1984-1988 ---
  side: number;
  /** `sim.contactLevel(0, entityId)` -- 0, 1 or 2. Ignored when `side` is 0
   *  (the player's own units are always drawn at full opacity). */
  contactLevel: number;

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
   * garrisoned in (renderer.ts:1946-1950) -- already resolved by the
   * caller, which owns the structure-sheet lookup this needs (backend- and
   * atlas-specific, out of scope here). Ignored when `roofSlot` is -1.
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
 * Screen-pixel offset for a roof occupant, or `null` past the cap.
 * Mirrors `PixiRenderer.roofPlacement` (`renderer.ts:377-384`) exactly.
 */
function roofPlacementFor(slot: number, roofPx: number): { dx: number; dy: number } | null {
  if (slot < 0 || slot >= ROOF_SLOTS) return null;
  const spread = (slot - (ROOF_SLOTS - 1) / 2) * ROOF_SPREAD_PX;
  return { dx: spread, dy: -roofPx };
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
    roofSlot,
    roofPx,
    sheet,
    anim,
    dtSeconds,
    entityAnimFrame,
    animSeeded,
    facing,
  } = input;

  // Interpolation between the last two sim ticks (renderer.ts:1930-1931).
  const wx = prevX + (curX - prevX) * alpha;
  const wy = prevY + (curY - prevY) * alpha;

  // Ground lift for this unit's own tile (renderer.ts:1977). Applied through
  // `groundWorldY` -- the B3.2 adapter over the same `levelAt`/
  // `WORLD_PER_LEVEL` B2's terraced mesh itself uses -- so a unit standing on
  // a tile lands exactly on that tile's own top face.
  const worldY = groundWorldY(elevation, mapWidth, mapHeight, wx, wy);

  // Garrison roof placement (renderer.ts:1936-1956).
  let roofDx = 0;
  let roofDy = 0;
  let visible = true;
  if (roofSlot >= 0) {
    const place = roofPlacementFor(roofSlot, roofPx);
    if (!place) {
      // Over the cap: Pixi's `continue` -- the pips still report the true
      // count, this occupant simply is not drawn.
      visible = false;
    } else {
      roofDx = place.dx;
      roofDy = place.dy;
    }
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
  // persisted phase -- matching Pixi's own `if (nFrames > 1)` guard.
  let frame = 0;
  if (nFrames > 1) {
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

  return {
    wx,
    wy,
    worldY,
    clip,
    frame,
    facing: facingNorm,
    alpha: bodyAlpha,
    roofDx,
    roofDy,
    visible,
  };
}
