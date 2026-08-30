/**
 * The three.js backend. Phase B1 got it on screen with nothing but the clear
 * colour; Phase B2.4 adds the first drawn geometry -- terrain, built lazily
 * from `buildGround` (see `rebuildTerrain` below) and uploaded once per
 * change via `toGeometry`/`terrainMaterial`. Phase B3.5 adds the second:
 * living units, one `THREE.InstancedMesh` per loaded unit type
 * (`units/instances.ts`), fed a fresh `EntityFrame` per living entity every
 * frame (`units/frame-state.ts`) from real per-entity position tracking this
 * class now owns (`prevX`/`curX`/etc. below, populated by `snapshot`).
 *
 * Three kinds of not-yet-implemented member, and the line between them is the
 * whole discipline of this phase: *inventing an answer* is forbidden;
 * *reporting the current state truthfully* is not.
 *
 *  - **Data pushed in** *retains* its argument and returns:  `setElevation`,
 *    `loadStructureSprite`, and `setTutorialFocus`/
 *    `clearTutorialFocus` (a focus ring is state, not a one-shot). The data
 *    has arrived and is correct; it simply is not drawn until B4 (structure
 *    sprites) or is presentation-only Phase C state (`setTutorialFocus`).
 *    `setDecor` and `loadSprites` graduated out of this bucket in B2.6 and
 *    B3.5 respectively -- both now draw what they are given, immediately or
 *    on the next `frame()`. `useEmitters` graduated fully in Task B3.14: it
 *    wires its `EmitterSpec[]` into a real `EmitterLibrary` and constructs a
 *    real `ParticleSystem` from `resolve`, and (since B3.14) `onEvents`
 *    actually SPAWNS into both -- see the next bullet.
 *  - **Truthful no-ops**, where "nothing to do" is the honest answer rather
 *    than a dodge: empty as of Phase C. `addOrderMarker` graduated out of it
 *    there -- it now pushes into `this.orderMarkers`, drawn (and expired) by
 *    `updateOverlays` every `frame()`, the same one-shot-with-a-fade shape
 *    `PixiRenderer`'s own `orderMarkers` array already has. `isVisible`
 *    graduated out of it in Task B4.2: it now queries real fog-of-war state
 *    (`./fog`'s
 *    `isFogVisible`, ported pure from Pixi's own `updateFog`/`hasSight` by
 *    Task B4.1), recomputed at Pixi's own 5 Hz cadence (`recomputeFog`,
 *    called from `snapshot`) -- see that method's own doc comment for the
 *    cadence and `updateUnits`'s own top comment for what changed the moment
 *    a real answer replaced the unconditional `true`: a non-player unit now
 *    draws only while actually observed, the same as Pixi's frame loop.
 *    `snapshot` graduated out of this bucket in B3.5: it now latches
 *    per-entity position and measures ground speed, the same job Pixi's own
 *    `snapshot` does, because `frame()` needs both to draw a single moving
 *    unit. `onEvents` graduated out of this
 *    bucket in Task B3.14: it now wires seven of Pixi's nine event kinds --
 *    `fire`, `impact`, `nearMiss`, `aps`, `strike`, `destroyed`,
 *    `tunnelCollapsed` -- muzzle flashes, tracers, impact effects, the death
 *    fade, and the recoil/flinch latches `drainTimers` decays. Task B3.10
 *    wired the remaining two: `structureHit`/`structureDestroyed` now call
 *    `applyStructureHit`/`applyStructureDestroyed` below (built by Task
 *    B3.9, an O(footprint) per-structure rebuild instead of an O(map area)
 *    one, tested at the pure-function layer they call into and measured in
 *    that task's own report) -- see `onEvents`'s own doc comment for the
 *    cost that made building the incremental path a prerequisite before
 *    this wiring, not merely a nice-to-have.
 *  - **Throws**: this bucket is now empty. `pickUnit` and `unitsInScreenRect`
 *    were the only two members that would have had to *fabricate* -- `-1`
 *    and `[]` both mean "you clicked empty ground", the player acts on that,
 *    and it would be believed -- so they threw rather than invent an answer.
 *    Task B3.8 implements both for real, ported from `PixiRenderer`'s own
 *    members into pure functions (`units/pick.ts`) this class merely calls.
 *    The ruling that sent it: `pickUnit` is NOT a projection question --
 *    Pixi's version is a nearest-entity search over `curX`/`curY` in WORLD
 *    coordinates, with no projection inside it at all; only
 *    `unitsInScreenRect` genuinely projects. Neither needs a GPU or a
 *    raycast, so both are tested in `environment: 'node'` exactly like
 *    `frame-state.ts`'s own `entityFrame`.
 *
 * The rule that catches these: any member reached from the 60 Hz frame loop,
 * the 20 Hz tick loop, or a block whose tail matters must not throw unless
 * fabricating is the only alternative. Two rounds of review found members that
 * broke it -- `isVisible` in the frame loop, the tutorial focus pair in the
 * tick loop -- so weigh that before adding a `notYet` to anything new.
 *
 * ## What B3.5 deliberately does not draw, and what Task B3.14 added to it
 *
 * `units/frame-state.ts`'s landed `EntityFrame` carries what B3.3 decided a
 * unit needs: position, ground/roof lift, clip, frame, facing, body alpha.
 * Task B3.14 EXTENDS `EntityFrameInput` (frame-state.ts was explicitly not
 * barred for this task, unlike B3.5) with `recoilT`/`recoilDir`/
 * `recoilPower`/`flinchT`/`flinchDir` -- both `firing`'s one-shot pose
 * (latched here, from `onEvents`'s `fire` case) and the recoil/flinch
 * screen-space nudges Pixi's own unit loop applies (`renderer.ts:2044-2063`)
 * are drawn now, event-fed exactly like Pixi.
 *
 * Everything ELSE Pixi's unit loop draws beyond what `EntityFrame` carries
 * is still out of scope: pinned TREMBLE and footfall BOB (both continuous,
 * driven every frame off `Sim` state or clip phase directly, not by an
 * event -- this task's brief scopes it to "the recoil and flinch decay
 * timers `frame()` drains", not every screen-space nudge Pixi's unit loop
 * ever applies), air-lift for `isAir` types (the sim's own `UnitType` doc
 * comment calls this "presentation" and names the renderer as the thing
 * that lifts it -- `frame-state.ts` does not), and the procedural-primitive
 * fallback for a unit type with no loaded sheet.
 *
 * Turret sprites (Task B3.6) DID land, closing the one item in this list
 * that B3.14 could not: every shot's muzzle/recoil bearing now reads turret
 * facing, not hull facing, for a unit type with turret art loaded
 * (`onFire` below, and `frame-state.ts`'s own `EntityFrame.turretFacing`).
 * Everything else in this paragraph is unaffected.
 *
 * A unit type with no loaded sheet simply is not drawn: "no mesh
 * units" (the B3 brief's own scope line) rules out inventing a placeholder
 * shape for it the way Pixi's circle fallback does -- and the same rule now
 * also governs a DYING unit with no loaded sheet (`stepDeaths`, Task
 * B3.14): it is silently skipped, not drawn as a placeholder either.
 */
import * as THREE from 'three';
import { fx, WEAPON_CLASS, type Fx, type Sim, type SimEvent } from '@lions/sim';
import type { Renderer, RendererOptions, TerrainTones } from '../api'; // both, after Step 2
import { WORLD_Y_PER_LIFT_PIXEL, TILE_W, TILE_H, type Camera } from '../project';
import { EmitterLibrary, ParticleSystem, firePower, type EmitterSpec, type ParticleSpec } from '../vfx';
import { SIM_HZ } from '../anim';
import { parseManifest, parseStructureManifest, clipOrFallback, type SheetSpec } from '../sheet';
import { resolveClip, type UnitAnimInput } from '../clip';
import { dimetricCamera, worldToScreenThree, screenToWorldThree } from './camera';
import { applyPalettePipeline } from './palette-material';
import { FlashLightManager } from './flash-light';
import { buildGround } from './terrain/ground';
import { buildScatter } from './terrain/scatter';
import { buildGroves } from './terrain/grove';
import { buildBuildings, type StructureFootprint } from './terrain/buildings';
import { toGeometry, terrainMaterial } from './terrain/mesh';
import type { TerrainInput, MeshData } from './terrain/types';
import { dirtyForStructureHit, dirtyForStructureDestroyed } from './terrain/dirty';
import { isGrindingHit } from '../grind';
import { packSheet, buildUnitTexture } from './units/atlas';
import { entityFrame, assignRoofSlots, type EntityFrameInput, type EntityFrame } from './units/frame-state';
import { UnitInstancer, TURRET_RENDER_ORDER } from './units/instances';
import { pickUnit as pickUnitPure, unitsInScreenRect as unitsInScreenRectPure } from './units/pick';
import { stepTracers, spawnTracer, type TracerModel } from './units/tracers';
import { ParticleInstancer, TracerBatch, PARTICLE_CAPACITY, TRACER_CAPACITY } from './units/fx';
import { nextVehicleMoving, vehicleDustMagnitude, vehicleFxAnchor } from './units/vehicle-fx';
import {
  StructureInstancer,
  loadStructureFrame,
  structureBillboardGeometry,
  collapseBillboardGeometry,
  createCollapseMaterial,
  collapseFrame,
  liveStructurePlacements,
  deadStructurePlacements,
  footprintCentre,
  structureAliveAlpha,
  resolveRoofPx,
} from './units/structures';
import { STRUCTURE_RENDER_ORDER } from './units/render-order';
import {
  loadMeshUnitTemplate,
  instantiateMeshUnit,
  applyMeshClip,
  disposeMeshUnitEntity,
  disposeMeshUnitTemplate,
  type MeshUnitTemplate,
  type MeshUnitEntity,
} from './units/mesh-unit';
import { meshYawFromFacing, MESH_UNITS_PER_TILE } from './units/mesh-anim';
import { stepTurretFacing } from './units/frame-state';
import {
  loadVehicleMeshTemplate,
  instantiateVehicleMesh,
  disposeVehicleMeshTemplate,
  type VehicleMeshTemplate,
  type VehicleMeshEntity,
} from './units/mesh-vehicle';
import {
  loadBuildingMeshTemplate,
  instantiateBuildingMesh,
  disposeBuildingMeshTemplate,
  type BuildingMeshTemplate,
} from './units/mesh-building';
import {
  beginMeshDeath,
  stepMeshDeath,
  pushMeshWreck,
  updateMeshWrecks,
  endMeshDeathFade,
  type DyingMeshUnit,
  type MeshWreck,
  type MeshDeathEnv,
} from './units/mesh-death';
import type { MeshFaction } from './units/mesh-role';
/** Re-exported so `app` can name the side a mesh unit fights for without
 *  importing anything under `three/units/` directly. TYPE ONLY: it is erased
 *  at compile time, so it cannot pull three.js back into the main chunk --
 *  the regression this entry point exists to prevent. */
export type { MeshFaction } from './units/mesh-role';
import { groundWorldY } from './ground-height';
import { tileHash } from '../tile-hash';
import { computeFog, isFogVisible, type FogInput } from './fog';
import { FogMesh } from './fog-mesh';
import { SmokeMesh } from './smoke-mesh';
import { TrailMesh, collapsedRouteLevel, type TrailInstanceInput } from './trail-mesh';
import { VehicleTrackMesh, trackKindFor, stepTrackAccum, TRACK_POOL_CAPACITY } from './vehicle-tracks';
import { billboardPoint, objectiveZoneCorners } from './units/overlay-geometry';
import {
  OverlayBatch,
  NumeralBatch,
  unitOverlayRadiusPx,
  hpBarColorKey,
  orderMarkerSize,
  ORDER_MARKER_TTL,
  HP_BG_COLOR_KEY,
  SUPPRESSION_COLOR_KEY,
  OVERLAY_ACCENT_COLOR_KEY,
  BADGE_TEXT_COLOR_KEY,
  objectiveZoneColorKey,
  objectiveZoneFallbackColor,
  objectiveZonePulse,
  OBJECTIVE_ZONE_STROKE_INSET_TILES,
  AIR_SHADOW_COLOR_KEY,
  WRECK_MARKER_COLOR_KEY,
  MOBILITY_KILL_COLOR_KEY,
  FIREPOWER_KILL_COLOR_KEY,
  FIREPOWER_KILL_FALLBACK_COLOR,
  buildingIntegrityColorKey,
  CHARGE_RING_TRACK_COLOR_KEY,
  CHARGE_RING_FILL_COLOR_KEY,
  CHARGE_RING_FILL_FALLBACK_COLOR,
  tileRadiusToEllipsePx,
} from './units/overlays';

/** Where a unit type's sheets live, as the app named them. */
interface SpriteSheetRequest {
  basePath: string;
  turretPath?: string;
}

/** One unit mid-death-fade -- ThreeRenderer.stepDeaths' own tracking,
 *  mirroring PixiRenderer's identically-shaped `dying` entry (renderer.ts,
 *  `stepDeaths`'s own doc comment). Position, facing and typeId are captured
 *  at the moment of death, not read live off `Sim`, because the entity slot
 *  may be reused by a later spawn before the fade finishes. */
interface DyingUnit {
  x: number;
  y: number;
  facing: number;
  typeId: string;
  t: number;
}

/**
 * One permanent BILLBOARD-path unit wreck -- the counterpart of Pixi's own
 * `wrecks` entry (`renderer.ts:485-487`, `{ x, y, spr, shown }`) and of
 * `mesh-death.ts`'s `MeshWreck` for the mesh path. Pushed unconditionally
 * once a dying unit's fade finishes (`ThreeRenderer.addWreck`), whether or
 * not this type's sheet declares a real `wreck` clip -- `stepDeaths`'s own
 * per-frame draw loop resolves that per entry (real art through the SAME
 * `UnitInstancer` a living unit of that type draws through, or Pixi's own
 * grey cross-marker fallback via `updateOverlays`), the identical split
 * Pixi's own nullable `spr` field encodes. `facing`/`typeId` are captured at
 * the moment of death, not read live off `Sim`, for the same reason
 * `DyingUnit` above already gives.
 */
interface UnitWreck {
  x: number;
  y: number;
  facing: number;
  typeId: string;
  /** Sticky reveal: latches true once the tile has ever been explored, and
   *  never back to false -- `renderer.ts:1200`'s "Never goes back to false",
   *  identical to `mesh-death.ts`'s own `MeshWreck.shown`. */
  shown: boolean;
}

/** Recoil/flinch decay durations, seconds -- redeclared from `renderer.ts`'s
 *  own `RECOIL_SECONDS`/`FLINCH_SECONDS` (private, unexported) rather than
 *  imported, the same reason everything else redeclared from `renderer.ts`
 *  in this backend is: importing from it would pull pixi.js into this
 *  module's graph. Owned here rather than `frame-state.ts` because draining
 *  `recoilT`/`flinchT` toward 0 is a once-a-frame, cross-entity operation
 *  (`drainTimers` below, mirroring `PixiRenderer.frame()`'s own
 *  top-of-frame drain, `renderer.ts:1882-1888`), not the per-entity decision
 *  `entityFrame` makes with the already-drained value. */
const RECOIL_SECONDS = 0.15;
const FLINCH_SECONDS = 0.18;

/**
 * Mesh-vehicle recoil, a genuine 3D shove -- distinct from the billboard
 * path's screen-pixel `RECOIL_PX_VEHICLE`/`RECOIL_PX_SOFT` (`frame-state.ts`),
 * which exists to nudge a flat sprite a few pixels because Pixi has no real
 * depth. A mesh vehicle has real geometry and a real camera distance, so
 * these are authored in WORLD TILE UNITS -- they read as a consistent shove
 * at any zoom, the same reason `AIR_LIFT_PX` was converted to a real world-Y
 * offset instead of staying a screen nudge (`frame-state.ts`'s own doc
 * comment on `AIR_LIFT_PX`). Judgement calls, not measured: eyeballed at
 * gameplay zoom (2-4) against a firing `mbt_lavi`.
 *
 * Both the hull shove and the turret's own independent kick scale by
 * `recoilPower` (0..1, `firePower(weapon)` at the shot) -- `gun_120`
 * (`apfsds`, penetration 1300 + damage 520) resolves to ~0.98, effectively
 * the maximum below; `coax_mg` (`hmg`, penetration 20 + damage 35, weight 55
 * under `firePower`'s own 100 floor) resolves to EXACTLY 0, so a coax burst
 * still advances `recoilT`/`recoilDir` (fired) but produces zero hull shove
 * and zero turret kick -- not "a smaller shove", none at all. That is not a
 * clamp bug: a coax MG is an internal mechanism with no meaningful external
 * recoil on a 60-tonne hull, so "the coax MG does not shove the tank like
 * the main gun does" is satisfied at its natural, unclamped extreme.
 */
const MESH_HULL_RECOIL_TILES = 0.16;
/** Hull nose-up pitch at full `recoilPower`, radians (~3.4 deg) -- the tank
 *  visibly rocks back onto its rear road wheels under the main gun, not just
 *  translates. Applied to `root.rotation.x`, which three.js's default 'XYZ'
 *  Euler order evaluates in the object's OWN local frame before `rotation.y`
 *  (yaw) is composed -- so this reads as a local pitch regardless of which
 *  way the hull is currently facing, not a world-axis tilt that would look
 *  like a roll from some headings. */
const MESH_HULL_PITCH_RAD = 0.06;
/** The turret's own kick, independent of the hull -- the barrel visibly
 *  recedes into the mantlet along whatever bearing it is CURRENTLY aimed
 *  along (not necessarily the hull's own facing), in ROOT-LOCAL units
 *  (`MESH_UNITS_PER_TILE` per tile, the space `turretPivot.position` lives
 *  in) -- see `updateVehicleMeshes`'s own turret-kick block for the axis
 *  derivation. Smaller than the hull shove: the barrel is the part that
 *  actually recoils on a real gun, but a shove this size on top of the
 *  hull's own translation would read as the turret flying off its mount
 *  rather than kicking.
 */
const MESH_TURRET_RECOIL_TILES = 0.11;
/**
 * Barrel-tip distance BEYOND a mesh vehicle's own `turret_pivot`, tiles --
 * `onFire` uses this to anchor the muzzle flash/tracer origin at the
 * turret's own current world position plus this much further along its
 * bearing, rather than at the hull centre plus a flat guess
 * (`barrelLen`, `onFire`'s own local, still used for a unit type with no
 * mesh turret pivot). `turret_pivot` sits at the mantlet/turret-ring, not
 * the muzzle -- a real gun tube extends visibly beyond it -- but no export
 * pipeline (`tools/export_mesh_vehicle.py` et al.) tags a muzzle point
 * specifically, so this is an estimate, not read from authored data: smaller
 * than the pre-existing 0.8-tile hull-centre guess, since the pivot itself
 * is already offset forward from the hull's own origin.
 */
const MESH_TURRET_MUZZLE_TILES = 0.5;
/** Seconds a dying unit spends fading before it is dropped -- mirrors
 *  `PixiRenderer.DEATH_SECONDS` (renderer.ts:1209). See `stepDeaths`'s own
 *  doc comment for what happens once that fade ends (a permanent
 *  `UnitWreck` is pushed, `addWreck` below). */
const DEATH_SECONDS = 0.4;
/** Permanent billboard-path wreckage needs a ceiling the same way
 *  `PixiRenderer.MAX_WRECKS` (`renderer.ts:1211`) and `mesh-death.ts`'s own
 *  `MAX_MESH_WRECKS` do -- oldest evicted first (`addWreck`). Kept at the
 *  identical value: nothing about which draw path a corpse takes changes
 *  how many are expected to litter a long mission. */
const MAX_UNIT_WRECKS = 256;

/**
 * Particle draw layers -- mirrors `renderer.ts`'s own private
 * `FX_LAYER_BELOW`/`FX_LAYER_ABOVE`/`fxLayerIndex` (redeclared for the same
 * pixi.js-import reason as everything else redeclared from `renderer.ts`).
 * `FX_LAYER_BELOW` routes to `particleInstancerBelow` (real occlusion
 * against units/terrain); `FX_LAYER_ABOVE` routes to `particleInstancerAbove`
 * (unconditional, matching Pixi's own `fxAboveG`) -- see `units/fx.ts`'s own
 * top comment, "The `above_units` split (B3.14)", for the full reasoning.
 *
 * Widened from two values to four for `additive` (the dead-schema-field
 * fix -- see `units/fx.ts`'s `createParticleMaterial`'s own doc comment for
 * the full reasoning, INCLUDING why this is a fragment-alpha-pinned opaque
 * "hot core" rather than a GPU `AdditiveBlending`/summing pass -- the
 * mechanism is not literally additive despite the field's name): blending
 * (and, here, alpha handling) is a whole-material state, so an additive
 * particle layer needs its OWN `ParticleInstancer`/draw call, not merely a
 * flag `writeParticleInstances` could carry per-instance. `layerIdx` here
 * is `ParticleSystem`'s own per-particle routing key (`Uint8Array`, plenty
 * of headroom past 4) -- entirely independent of `Object3D.renderOrder`
 * (`render-order.ts`), which is a different number space for a different
 * purpose; the two axes are combined only at each `ParticleInstancer`'s own
 * construction (`particleInstancerBelow`/`Above`/`BelowAdditive`/
 * `AboveAdditive` below).
 */
const FX_LAYER_BELOW = 0;
const FX_LAYER_ABOVE = 1;
const FX_LAYER_BELOW_ADDITIVE = 2;
const FX_LAYER_ABOVE_ADDITIVE = 3;
/** `additive` is read per PARTICLE LAYER (`ParticleSpec.additive`), not per
 *  emitter -- `fire_apfsds`'s own hot core/flare are additive while its
 *  shockwave ring, dust wash and drifting smoke are not, all under one
 *  `above_units` emitter. Callers already have both the emitter's `layer`
 *  string and the specific `ParticleSpec` layer in hand at every spawn call
 *  site, so this takes both rather than either alone. */
function fxLayerIndex(layer: string | undefined, additive: boolean): number {
  const above = layer === 'above_units' || layer === 'sky';
  if (additive) return above ? FX_LAYER_ABOVE_ADDITIVE : FX_LAYER_BELOW_ADDITIVE;
  return above ? FX_LAYER_ABOVE : FX_LAYER_BELOW;
}

/**
 * The `magnitude` value that makes `ParticleSystem.spawn`'s internal size
 * scale (`0.75 + magnitude * 1.25`) equal exactly 1 -- so `spawnFlatFx`
 * below can pass a `size_px` that becomes the drawn radius directly, rather
 * than one pre-divided by an arbitrary scale factor. See `spawnFlatFx`'s own
 * doc comment for the rest of the reasoning.
 */
const FLAT_FX_MAGNITUDE = 0.2;

/**
 * How far behind the hull, in tiles, `updateVehicleAmbientFx` anchors each
 * effect -- see `vehicleFxAnchor`'s (`units/vehicle-fx.ts`) own doc comment
 * for why the anchor moves at all. Dust sits further back than exhaust: it
 * is kicked up by the rear road wheels/tracks reaching the ground behind the
 * hull, where exhaust vents from the engine deck, closer to the hull itself.
 */
const VEHICLE_DUST_OFFSET_TILES = 0.55;
const VEHICLE_EXHAUST_OFFSET_TILES = 0.35;

/**
 * How often (in ms) `updateVehicleAmbientFx` calls `particleSystem.spawn`
 * for a single moving/idling vehicle, one accumulator per entity
 * (`vehicleDustAccumMs`/`vehicleExhaustAccumMs`). Each spawn's own
 * `emit_over_ms` (`vehicle_dust.json`/`vehicle_exhaust.json`) is set to
 * MATCH the interval it is called on, so successive spawn windows tile
 * back-to-back with no gap and no overlap -- a continuously trickling cloud
 * built from repeated bursts, not a visibly popping one. Exhaust's interval
 * is longer than dust's on purpose: "thinner, slower" per the brief this
 * effect was built against, not merely a smaller particle count.
 */
const VEHICLE_DUST_INTERVAL_MS = 250;
const VEHICLE_EXHAUST_INTERVAL_MS = 500;

/**
 * Fixed `magnitude` for `vehicle_exhaust`'s `spawn()` call -- unlike dust,
 * which scales with ground speed (`vehicleDustMagnitude`), idle exhaust has
 * no speed to scale against (`nextVehicleMoving` only reaches this branch
 * once speed has settled near 0) and reads as a steady, thin plume rather
 * than one that pulses. 0.4 keeps it visibly present without competing with
 * `FLAT_FX_MAGNITUDE`'s "just big enough to read as one puff" tier below.
 */
const VEHICLE_EXHAUST_MAGNITUDE = 0.4;

/**
 * Phase C: vertex budget for `OverlayBatch`, the shared overlay tier
 * (`units/overlays.ts`'s own top comment). Sized off `sim.capacity` at
 * construction (`ThreeRenderer`'s own field init below), not a bare
 * constant -- every living entity can draw an HP bar (2 rects = 12
 * vertices) and a suppression bar (1 rect = 6) unconditionally, plus a
 * selection ring (`OVERLAY_RING_SEGMENTS` * 6 = 96) or a badge fan
 * (`OVERLAY_RING_SEGMENTS` * 3 = 48) when selected/grouped. 200 vertices per
 * entity is comfortable headroom over that worst case (12 + 6 + 96 = 114)
 * with room left for order markers, the tutorial ring and the hover
 * highlight, which are few and singular rather than per-entity. Past this,
 * `OverlayBatch` silently drops the newest pushes rather than growing --
 * the same trade `PARTICLE_CAPACITY`/`TRACER_CAPACITY` already accept.
 */
const OVERLAY_VERTICES_PER_ENTITY = 200;

export class ThreeRenderer implements Renderer {
  readonly camera: Camera = { x: 24, y: 24, zoom: 1 };
  selection: number[] = [];
  readonly unitGroup: Uint8Array;
  hoverEntity = -1;
  hoverStructure = -1;
  hoverCanGarrison = false;
  objectiveZone: readonly number[] | null = null;
  objectiveZoneState: 'held' | 'unheld' | 'contested' = 'held';

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /**
   * World data the app has already handed over, some of which is now drawn.
   *
   * One bag rather than several fields on purpose: it keeps what B2/B3/B4
   * inherit visible at a glance. Terrain (`decor`, `elevation`) is read by
   * `rebuildTerrain` below whenever `terrainDirty` is set; the tutorial focus
   * ring is still B3's own retained-only state. `unitSheets` stays
   * retained-only too (`loadSprites` builds its `UnitInstancer` straight from
   * its own arguments, never reads this map back). `structureSheets`
   * graduated out of "retained only" in Task B3.7: `loadStructureSprite` now
   * builds real `StructureInstancer`s from it (`structureIdle`/
   * `structureWreck` below); the map itself survives only as the bookkeeping
   * `loadStructureSprite` already kept before that task, unread by anything
   * new.
   *
   * The emitter list and its palette resolver used to live here too
   * (`emitters`, `resolveColor`), retained-only, until B3.13 wired them into
   * `emitterLibrary`/`particleSystem` below -- objects that actually consume
   * them (indexing by weapon class, sampling colour curves) rather than a
   * copy of the raw arguments nothing read back. Keeping both would have
   * been two sources of the same state agreeing only by construction.
   */
  private readonly retained = {
    decor: null as Uint8Array | null,
    elevation: null as Uint8Array | null,
    unitSheets: new Map<string, SpriteSheetRequest>(),
    structureSheets: new Map<string, string>(),
    tutorialFocus: null as { x: number; y: number; radius: number } | null,
  };

  /**
   * Set by `setElevation`/`setDecor`, cleared by `rebuildTerrain`. Starts
   * `true` so a map that arrives with elevation/decor already retained (or
   * with neither -- an all-flat, decor-less map is still valid input to
   * `buildGround`) still gets a first build on the first `frame()`.
   *
   * Deliberately not built inside the setters themselves: both are called
   * during boot, in an order this class does not control (`main.ts` calls
   * `setDecor` then `setElevation`, but nothing enforces that), so building
   * on the first one to fire would build from half the data -- silently,
   * since a mesh built from a null elevation is valid, just flat.
   */
  private terrainDirty = true;
  private terrainMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null;
  /** The grain -- flecks, blades, bushes, cover rubble, knolls, ridges,
   *  ruts, slope-face dressing -- as a second mesh sharing the ground's own
   *  material and rebuild path, not a modification of the ground mesh
   *  itself (`buildGround` and `buildScatter` are two independent builders
   *  over the same `TerrainInput`). */
  private scatterMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null;
  /** Olive groves -- trunk and crown, standing above the ground rather than
   *  lying on it -- as a third mesh sharing the same material and rebuild
   *  path. `buildGroves` is a third independent builder over the identical
   *  `TerrainInput`, exactly like `buildScatter`. */
  private groveMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null;
  /**
   * Task B3.9: buildings stopped being one fourth mesh. A blocked,
   * non-ridge tile with no live structure at all (the fallback case
   * `buildBuildings`'s own `FALLBACK_HEIGHT_PX` doc comment says is never
   * reached on any shipped map, but is still tested and still handled) is
   * the only thing this mesh draws now -- every REAL, un-arted structure
   * gets its own entry in `structureBoxes` below instead, which is what
   * lets a `structureHit` recompute one box without re-walking the map. See
   * `composeTerrain`'s own doc comment for the full split.
   */
  private residualMesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> | null = null;
  /**
   * Task B3.9: one small mesh per LIVE, un-arted structure -- keyed by the
   * structure's own index into `sim.structures`, the same index a
   * `structureHit`/`structureDestroyed` event's `structure` field carries.
   * Rebuilt wholesale by `rebuildTerrain` (full rebuild: boot, elevation/
   * decor change, or a structure's death); rebuilt ONE ENTRY AT A TIME by
   * `applyStructureHit`, which is the whole point -- `buildBuildings`'s
   * `tiles` restriction (this task) turns that into an O(footprint) call
   * instead of an O(map area) one. An arted structure never gets an entry
   * here at all: `StructureInstancer` (`structureIdle`/`structureWreck`
   * above) draws it instead, reading live `Sim` state every frame already
   * (`updateStructures`), which is why it needs no invalidation of its own.
   */
  private readonly structureBoxes = new Map<number, THREE.Mesh<THREE.BufferGeometry, THREE.Material>>();
  /**
   * Task B3.9: each live, un-arted structure's own footprint tiles, cached
   * from the last full rebuild -- structures are never added or moved after
   * boot (`main.ts` calls `sim.addStructure` exactly once, at load), so this
   * stays valid for a structure's whole life without re-walking the map on
   * every hit. `applyStructureDestroyed` deletes an entry when its structure
   * dies; `structureAt` would already report -1 for those tiles by the time
   * a `structureDestroyed` event is processed (`destroyStructure` unblocks
   * the whole footprint synchronously, before the event is pushed), which is
   * exactly why this cache has to be taken BEFORE that happens, not
   * re-derived after.
   */
  private readonly structureFootprintTiles = new Map<number, readonly number[]>();
  /**
   * Task B3.9: the renderer-side counterpart of `PixiRenderer`'s own
   * `structureWear` (`renderer.ts:1792`'s `bumpStructureWear`) -- one
   * eight-step wear band per structure, lazily grown to `sim.structureCount`
   * exactly like Pixi's own field, so `applyStructureHit` can tell a hit
   * that crossed a visible step from one that did not
   * (`dirty.ts`'s `dirtyForStructureHit`) without a second copy of that
   * comparison living in this class.
   */
  private structureWear: Uint8Array | null = null;
  /**
   * Task B4.3: the renderer-side counterpart of `PixiRenderer`'s own
   * `structPuffTick` (`renderer.ts:458`) -- the last tick a blade's grind
   * dust was thrown at a given structure, so a demolisher landing a hit
   * every tick still only spawns one puff every four (`onEvents`'s
   * `structureHit` case). Keyed by structure index, exactly like
   * `structureWear` above.
   */
  private readonly structPuffTick = new Map<number, number>();
  /**
   * Task B4.4: a CONTINUOUS alpha cache, one float per
   * structure, lazily grown to `sim.structureCount` exactly like
   * `structureWear` above but holding the real `structureAliveAlpha` value
   * this backend last actually drew for that structure, refreshed every
   * frame by `cacheStructureAlpha` (called from `updateStructures`) for
   * every LIVE, arted structure. `-1` is the "never cached" sentinel
   * (`structureAliveAlpha`'s own range is `[0.55, 1]`, so `-1` cannot be a
   * real value), read by `beginCollapse` as "assume full" -- the identical
   * default Pixi's own `structureWear` uses for a structure that never took
   * a `structureHit` event (`renderer.ts:298`, `0xff` clamped to the
   * maximum band).
   *
   * This is a continuous cache rather than Pixi's own eight-step quantised
   * one because `updateStructures` already recomputes an arted structure's
   * displayed alpha from live `Sim` state EVERY frame, unconditionally (see
   * that method's own doc comment) -- unlike Pixi, which only redraws a
   * structure's sprite on a `terrainDirty` rebuild, so quantising into eight
   * bands there is what keeps a rifle plinking a wall from redrawing every
   * round. Nothing here redraws on account of this cache; it exists purely
   * so `beginCollapse` can read back "what was on screen a moment ago"
   * instead of `hp`/`maxHp`, which `Sim.destroyStructure` has already
   * zeroed by the time a `structureDestroyed` event reaches this class
   * (`packages/sim/src/sim.ts:4092-4095`).
   *
   * This is a DELIBERATE divergence from what Pixi actually ships, not
   * merely this backend's own path to the identical result --
   * `structureAliveAlpha`'s own doc comment has the full reasoning: Pixi's
   * `bumpStructureWear` also reads live (already-zeroed) `hp` for a combat
   * kill's own `structureHit` event, so Pixi's `alpha0` is `0.55` -- fully
   * battered -- for every combat kill, gradual or one-shot alike. This
   * cache instead captures true pre-kill integrity, so a building felled by
   * a single overwhelming hit from near-full health starts its fall near
   * `1` here, where Pixi's event-ordering floors it to `0.55` regardless.
   */
  private structureLastAlpha: Float32Array | null = null;
  /**
   * Task B4.4: the manifest facts `collapseBillboardGeometry` needs to
   * rebuild a BASE-anchored quad matching the live idle sprite's own size --
   * captured once at `loadStructureSprite` time (`spec.scale`, the decoded
   * idle frame's own pixel dimensions), the identical facts
   * `structureBillboardGeometry` was already called with for the live,
   * CENTRED quad that draws every frame. Absent for a structure type with no
   * loaded sheet, exactly like `structureIdle` itself -- `beginCollapse`
   * checks both together.
   */
  private readonly structureCollapseArt = new Map<
    string,
    { scale: number; textureWidth: number; textureHeight: number }
  >();
  /**
   * Buildings on their way down -- the three.js counterpart to
   * `PixiRenderer`'s own `collapsing` field (`renderer.ts:459-478`). Each
   * entry owns a real, individually-positioned `THREE.Mesh` (never a member
   * of `structureIdle`/`structureWreck`'s instancers, and never added to
   * `structureBoxes`), added to `scene` directly by `beginCollapse` and
   * removed only by `stepCollapses` once its own fall finishes -- see
   * `beginCollapse`'s own doc comment for why `updateStructures`' per-frame
   * idle/wreck swap cannot delete it out from under the animation.
   */
  private readonly collapsing: {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    /** Seconds elapsed since the fall began. */
    t: number;
    /** Alpha the building was last actually drawn at, so the fall continues
     *  from what the player is already looking at rather than flashing back
     *  to full -- mirrors Pixi's own `alpha0` field exactly. */
    alpha0: number;
  }[] = [];
  /** Reused across rebuilds -- one unlit, vertex-coloured material carries no
   *  per-terrain state, so there is nothing a fresh instance would buy. */
  private readonly terrainMat: THREE.Material = terrainMaterial();
  /**
   * Owns the muzzle-flash ramp-shift pool (`./palette-material.ts`'s own
   * "The muzzle-flash 'light'" doc comment) -- one instance for the whole
   * renderer, since the effect is deliberately GLOBAL: every registered
   * toon-ramp material (vehicle hull/turret, building, rigged infantry) and
   * the terrain material all sample the SAME uniform arrays, differentiated
   * only by each fragment's own world position, not by which entity fired.
   * `register()` is called once per material, at `terrainMat`'s own
   * construction (below, in the constructor body) and at every
   * `loadMeshUnit`/`loadVehicleMesh`/`loadBuildingMesh` template load; `step()`
   * runs once a frame from `frame()`, after which every registered material
   * is current with no further per-material write (`FlashLightManager`'s own
   * doc comment on `register`).
   */
  private readonly flashLights = new FlashLightManager();
  /** Reused across `onFire` calls so reading a mesh vehicle's turret-pivot
   *  world position (`getWorldPosition`) does not allocate a `THREE.Vector3`
   *  per shot. */
  private readonly scratchMuzzleWorld = new THREE.Vector3();

  /**
   * Per-entity position tracking for interpolation, mirroring
   * `PixiRenderer`'s own `prevX`/`prevY`/`curX`/`curY`/`entitySpeed`
   * (`renderer.ts:244-247,407`) exactly -- `frame()` needs the last two sim
   * ticks to lerp between, and `entityFrame` needs a *measured* ground speed
   * (from the tick delta, not the unit's data speed) so cover slowdowns,
   * pinning and mobility kills pace the gait for free, same as Pixi. All
   * sized to `sim.capacity`, populated by `snapshot()`, indexed by entity id.
   */
  private readonly prevX: Float64Array;
  private readonly prevY: Float64Array;
  private readonly curX: Float64Array;
  private readonly curY: Float64Array;
  private readonly entitySpeed: Float64Array;
  /** Persisted per-entity animation phase state `entityFrame` mutates in
   *  place -- `frame-state.ts`'s own `EntityFrameInput.entityAnimFrame`/
   *  `animSeeded` doc comment: "owned and persisted by the caller across
   *  frames." Mirrors Pixi's identically-named fields. */
  private readonly entityAnimFrame: Float64Array;
  private readonly animSeeded: Uint8Array;
  /**
   * Task B3.14: event-driven presentation timers, one-shot latches set from
   * `onEvents` and drained toward 0 by `drainTimers` at the top of every
   * `frame()` -- mirrors `PixiRenderer`'s identically-named private fields
   * (`renderer.ts:412-419`) exactly, including their shapes: `firingTimer`
   * counts down its own remaining seconds; `recoilT`/`flinchT` count down
   * 1..0 and are read alongside their paired `*Dir`/`recoilPower` by
   * `entityFrame` (`frame-state.ts`) to place the screen-space kick.
   */
  private readonly firingTimer: Float64Array;
  private readonly recoilT: Float64Array;
  private readonly recoilDir: Float64Array;
  private readonly recoilPower: Float64Array;
  private readonly flinchT: Float64Array;
  private readonly flinchDir: Float64Array;
  /**
   * Task B3.6: per-entity turret traverse state, mirroring Pixi's own
   * `turretFacing`/`turretVel` (`renderer.ts:421-425`) field-for-field --
   * owned here, mutated in place by `entityFrame` (`frame-state.ts`'s own
   * `EntityFrameInput.turretFacing`/`turretVel`/`turretSeeded` doc comment),
   * exactly like `entityAnimFrame`/`animSeeded` above. Meaningless (and
   * never mutated) for an entity whose unit type has no turret sheet.
   */
  private readonly turretFacing: Float64Array;
  private readonly turretVel: Float64Array;
  private readonly turretSeeded: Uint8Array;
  /**
   * Task B3.6: the TURRET's own one-shot firing latch -- deliberately a
   * SEPARATE timer from `firingTimer` above, not a second read of it. Every
   * shipped hull sheet with turret art (TNK/EITAN/NAMER/GUNTRUCK/TECH)
   * declares no `fire` clip of its own, so `firingTimer` (latched from the
   * HULL's fire-clip duration in `onFire` below) never fires for a turreted
   * vehicle at all -- reusing it here would leave every turret's own `fire`
   * clip permanently unreachable, exactly the "16 recoil frames stay dead
   * art" failure this task exists to close, just moved one layer past the
   * loadSprites fix that made them loadable. Latched off the TURRET sheet's
   * OWN fire-clip duration instead, independent of what the hull has.
   */
  private readonly turretFiringTimer: Float64Array;
  /**
   * Vehicle-only ambient FX state -- `updateVehicleAmbientFx`'s own doc
   * comment has the full account. `vehicleMoving` is the hysteresis latch
   * `nextVehicleMoving` (`units/vehicle-fx.ts`) reads and writes each frame;
   * `vehicleDustAccumMs`/`vehicleExhaustAccumMs` are per-entity clocks that
   * decide when the next dust/exhaust `spawn()` call is due, mirroring the
   * shape `firingTimer`/`recoilT` above already use for a one-shot latch --
   * these instead accumulate UP toward a fixed interval rather than
   * counting down from one, since the effect they gate is sustained, not a
   * one-shot reaction to an event. Never read for a soft (infantry) entity;
   * see that method's own `!type.isSoft` gate.
   */
  private readonly vehicleMoving: Uint8Array;
  private readonly vehicleDustAccumMs: Float64Array;
  private readonly vehicleExhaustAccumMs: Float64Array;
  /** Units mid-death-fade -- see `stepDeaths`'s own doc comment. */
  private readonly dying: DyingUnit[] = [];
  /** Permanent billboard-path wreckage -- the counterpart of `renderer.ts`'s
   *  `wrecks`/`wreckLayer` for a unit type NOT drawn through the mesh path
   *  (see `UnitWreck`'s own doc comment for the full picture, and this
   *  file's `meshWrecks` field for the mesh-path sibling). Bounded by
   *  `MAX_UNIT_WRECKS`, oldest evicted first (`addWreck`). */
  private readonly wrecks: UnitWreck[] = [];

  /** One `UnitInstancer` per unit type with a loaded sheet, keyed by the
   *  unit type id `loadSprites` was called with. */
  private readonly unitInstancers = new Map<string, UnitInstancer>();
  /**
   * Task B3.6: one SECOND `UnitInstancer` per unit type whose `loadSprites`
   * call carried a `turretPath` -- composited above its hull instancer's
   * own mesh, updated via `UnitInstancer.updateTurret` rather than `update`.
   * Absent entries mean "this type has no turret art", the same "doubles as
   * the has-a-turret gate" shape `EntityFrameInput.turretSheet` uses.
   */
  private readonly turretInstancers = new Map<string, UnitInstancer>();

  /**
   * Mesh units (task: "the runtime that draws mesh units"). One
   * `MeshUnitTemplate` per unit type `loadMeshUnit` was called with -- empty
   * until something calls it, which nothing does yet (the flag: additive,
   * off by construction). A type present here is drawn through
   * `updateMeshUnits` INSTEAD of a billboard, never both -- see the
   * `meshUnitTemplates.has(type.id)` guard in `updateUnits`.
   */
  private readonly meshUnitTemplates = new Map<string, MeshUnitTemplate>();
  /** One `MeshUnitEntity` per living entity of a mesh-enabled type, keyed by
   *  entity id -- pooled across frames. Once `Sim` reports the entity no
   *  longer alive, its id is deleted from this map in the SAME step that
   *  hands the `MeshUnitEntity` off to `meshDying` (`updateMeshUnits`'s own
   *  prune loop) -- so an id never appears in both collections at once, and
   *  a later spawn reusing the id can never alias the dying entity. */
  private readonly meshUnitEntities = new Map<number, MeshUnitEntity>();
  /** Mesh units mid-death-fade, not keyed by entity id -- see
   *  `meshUnitEntities`'s own doc comment for why an id-keyed collection
   *  would be the wrong shape once an id can be reused mid-fade.
   *  `units/mesh-death.ts`'s own top comment is the full account of what
   *  this array is for. */
  private readonly meshDying: DyingMeshUnit[] = [];
  /** Permanent mesh wreckage -- the mesh-path counterpart of `renderer.ts`'s
   *  `wrecks`/`wreckLayer`, populated only for a unit type whose GLB
   *  carries a `wreck` `AnimationClip` (`mesh-death.ts`'s own "Wreck
   *  persistence" section). Bounded by `MAX_MESH_WRECKS`, oldest evicted
   *  first (`pushMeshWreck`). */
  private readonly meshWrecks: MeshWreck[] = [];

  /**
   * Vehicle meshes (mesh-unit-contract v2). One `VehicleMeshTemplate` per
   * unit type `loadVehicleMesh` was called with -- the rigid,
   * hull-plus-pivot-turret counterpart of `meshUnitTemplates` above, kept in
   * its OWN map rather than folded into that one: `updateVehicleMeshes`
   * drives a plain `Object3D.clone`/turret-pivot rotation, never a mixer or a
   * clip, so sharing one map (and thus one draw-time branch) would force
   * `updateMeshUnits`' loop to guess which shape each entry needs.
   */
  private readonly vehicleMeshTemplates = new Map<string, VehicleMeshTemplate>();
  /** One `VehicleMeshEntity` per living entity of a vehicle-mesh-enabled
   *  type, keyed by entity id -- pooled across frames like `meshUnitEntities`,
   *  but torn down and removed IMMEDIATELY on death rather than handed to a
   *  fade sequence: every shipped `art/meshes/vehicles/*.glb` carries zero
   *  `down`/`wreck` clips (there is no animation at all), so there is no
   *  pose for a vehicle fade to hold, unlike infantry's `meshDying`/
   *  `meshWrecks`. See this task's own report for why that gap is left open
   *  rather than closed here. */
  private readonly vehicleMeshEntities = new Map<number, VehicleMeshEntity>();

  /**
   * Building meshes (mesh-unit-contract v2). One `BuildingMeshTemplate` per
   * structure TYPE's IDLE file, keyed the same way `structureIdle` is --
   * presence here means "this type draws a mesh instead of a billboard",
   * mirroring `meshUnitTemplates.has(type.id)`'s "mesh wins" rule for units.
   */
  private readonly buildingMeshIdleTemplates = new Map<string, BuildingMeshTemplate>();
  /** The WRECK sibling -- absent for a type whose `loadBuildingMesh` call
   *  carried no wreck URL. */
  private readonly buildingMeshWreckTemplates = new Map<string, BuildingMeshTemplate>();
  /** One clone per LIVING structure of a mesh-enabled type, keyed by
   *  structure index (`Sim.structures`' own row index, stable for a
   *  structure's whole lifetime -- unlike an entity id, a structure index is
   *  never reused mid-mission). A building never moves and never turns, so
   *  unlike `vehicleMeshEntities` this clone is positioned exactly once, at
   *  creation, not every frame. */
  private readonly buildingMeshIdleEntities = new Map<number, THREE.Object3D>();
  /** The WRECK sibling -- one clone per DEAD structure of a mesh-enabled
   *  type whose wreck template loaded. */
  private readonly buildingMeshWreckEntities = new Map<number, THREE.Object3D>();

  /**
   * Task B3.7: one `StructureInstancer` per structure TYPE with a loaded
   * idle sheet, keyed by the structure type id `loadStructureSprite` was
   * called with -- the same key `structureAtlas.has(stype.id)` gates on in
   * Pixi (`renderer.ts:1488`). Presence in this map is exactly "does this
   * type have art" for every purpose that question matters here:
   * `composeTerrain`'s `hasArt` callback (skip that structure's own box
   * entirely, Task B3.9 -- previously a `maskArtedStructures` call inside
   * `rebuildTerrain` itself, before buildings stopped being one merged
   * mesh), and `updateStructures` below (draw the billboard instead).
   */
  private readonly structureIdle = new Map<string, StructureInstancer>();
  /**
   * A SECOND `StructureInstancer` per structure type whose sheet declared a
   * `wreckFile` -- absent for a type with none (`BLD_WALL` today), matching
   * Pixi's own `if (!art?.wreckTexture) continue` in `drawWreckedStructures`.
   * Drawn from live `Sim` state every frame by `updateStructures`, not from
   * the `terrainDirty`-gated terrain mesh -- see that method's own doc
   * comment for why this stays true even after Task B3.10 wired
   * `structureDestroyed` into `onEvents`: `applyStructureDestroyed` (Task
   * B3.9) only ever touches `structureBoxes`/`structureFootprintTiles`,
   * which an ARTED structure -- the only kind this map draws -- never has
   * an entry in (`composeTerrain`'s `hasArt` skip). So the call is a true
   * no-op for every structure this map cares about, and this per-frame path
   * remains the only thing that ever tells one of ITS wrecks to appear.
   */
  private readonly structureWreck = new Map<string, StructureInstancer>();
  /**
   * `roofTopPx`/`badgeTopPx` per structure type with a loaded idle sheet --
   * what `updateUnits`'s garrison `roofPx` now prefers over the type's own,
   * squatter `heightPx`, closing the gap B3.3's review measured (see
   * `resolveRoofPx`'s own doc comment in `units/structures.ts`). A type with
   * no entry here falls back to `heightPx` exactly as it did before this
   * task -- `resolveRoofPx(undefined, heightPx)`.
   */
  private readonly structureRoofArt = new Map<string, { roofTopPx: number | null; badgeTopPx: number | null }>();

  /** Reused across frames (`.length = 0` each `frame()`, not reallocated) --
   *  every living entity's `EntityFrame` this tick, grouped by its unit
   *  type id, the shape `UnitInstancer.update` consumes. `stepDeaths` also
   *  appends a synthetic `EntityFrame` per still-fading dying unit into the
   *  same per-type arrays, for the same instancers to draw. */
  private readonly framesByType = new Map<string, EntityFrame[]>();
  /**
   * Task B3.6: the LIVING-ONLY subset of `framesByType`, for unit types with
   * a turret instancer -- populated in the same per-entity loop that builds
   * `framesByType`, but never appended to by `stepDeaths`. A dying unit's
   * synthetic `EntityFrame` (`stepDeaths`'s own doc comment) still draws its
   * hull's death-fade pose, but Pixi's own `stepDeaths` never draws a turret
   * sprite for one at all (`turretSprites[i].visible` stays `false` for the
   * whole fade, since dying entities never re-enter the main per-entity
   * loop that would show one) -- matched here by simply never handing a
   * dying frame to a turret instancer, rather than by a per-frame flag
   * `writeTurretInstances` would have to additionally check.
   */
  private readonly turretFramesByType = new Map<string, EntityFrame[]>();

  /**
   * Task B3.13/B3.14: combat feedback's draw path. `emitterLibrary` and
   * `particleSystem` are wired by `useEmitters` below -- `particleSystem`
   * stays `null` until then, exactly like `PixiRenderer.particles`, since a
   * `ParticleSystem` needs the app's `resolve` callback to construct.
   * `tracers` starts empty and is populated by `onEvents`'s own `fire` case
   * (Task B3.14), mirroring `PixiRenderer.tracers`.
   *
   * Two `ParticleInstancer`s, not one: Task B3.14 splits B3.13's single
   * merged mesh back into a below/above pair on the `depthTest` axis -- see
   * `units/fx.ts`'s own top comment, "The `above_units` split (B3.14)", for
   * the full reasoning and cost. `particleInstancerBelow`/`particleInstancerAbove`/
   * `tracerBatch` all exist unconditionally from construction, independent
   * of whether `useEmitters` has run yet or any tracer has ever spawned, so
   * `frame()` always has something to call `.update()` on.
   */
  private readonly emitterLibrary = new EmitterLibrary();
  private particleSystem: ParticleSystem | null = null;
  private tracers: TracerModel[] = [];
  private readonly particleInstancerBelow = new ParticleInstancer(PARTICLE_CAPACITY, FX_LAYER_BELOW, true, false);
  private readonly particleInstancerAbove = new ParticleInstancer(PARTICLE_CAPACITY, FX_LAYER_ABOVE, false, false);
  /**
   * Additive siblings of the two instancers above -- see `FX_LAYER_BELOW`'s
   * own doc comment and `units/fx.ts`'s `createParticleMaterial` for the
   * full reasoning. Exist unconditionally from construction, same as their
   * normal siblings, so `frame()` always has something to call `.update()`
   * on regardless of whether any emitter has spawned an additive particle
   * yet.
   */
  private readonly particleInstancerBelowAdditive = new ParticleInstancer(
    PARTICLE_CAPACITY,
    FX_LAYER_BELOW_ADDITIVE,
    true,
    true
  );
  private readonly particleInstancerAboveAdditive = new ParticleInstancer(
    PARTICLE_CAPACITY,
    FX_LAYER_ABOVE_ADDITIVE,
    false,
    true
  );
  private readonly tracerBatch = new TracerBatch(TRACER_CAPACITY);

  /**
   * Phase C: the unit overlay tier -- see `units/overlays.ts`'s own top
   * comment for why this is two batches, not one. Both sized off `sim
   * .capacity` (`OVERLAY_VERTICES_PER_ENTITY`'s own doc comment), which is
   * not known until the constructor body runs (a class field initializer
   * like `tracerBatch` above executes before `sim`/`opts`'s constructor-
   * parameter assignment does, so neither can be a bare field initializer
   * the way every fixed-capacity FX batch above is) -- assigned in the
   * constructor body instead, from the `sim`/`opts` PARAMETERS directly,
   * the same pattern `this.unitGroup`/`this.prevX`/etc. already use just
   * below.
   */
  private readonly overlayBatch: OverlayBatch;
  private readonly numeralBatch: NumeralBatch;
  /** Frame counter Pixi's own pulsing overlays (`Math.sin(this.frameN *
   *  k)`) are keyed off -- `PixiRenderer.frameN` (`renderer.ts:1881`,
   *  `this.frameN++`), incremented once per `frame()` call (display refresh
   *  rate, NOT the sim's fixed 20 Hz tick, matching Pixi's own cadence
   *  exactly since this is presentation-only animation, invariant 1 is
   *  about simulation, not this). */
  private frameN = 0;
  /** A fading move/attack order crosshair per recent command -- the three.js
   *  counterpart of `PixiRenderer.orderMarkers` (`renderer.ts:488`). */
  private orderMarkers: { x: number; y: number; ttl: number }[] = [];

  /**
   * Task B4.2: fog of war. Per tile: 0 never seen, 1 explored but not
   * currently observed, 2 in sight right now -- the three.js counterpart of
   * `PixiRenderer.fog` (`renderer.ts:198`), owned here and reassigned (not
   * mutated) each recompute, matching `./fog.ts`'s `computeFog` returning a
   * fresh array rather than writing through `prev` -- see that module's own
   * doc comment.
   */
  private fog: Uint8Array;
  /** Counts `snapshot()` calls -- `recomputeFog` runs on every FOURTH one,
   *  mirroring Pixi's own `this.fogTick++ % 4 === 0` (`renderer.ts:733`): 5
   *  Hz at the sim's 20 Hz tick. Fog only needs to keep up with movement, not
   *  the tick rate. */
  private fogTick = 0;
  /** Set whenever `recomputeFog` produces new fog data; cleared once
   *  `frame()` has rebuilt `fogMesh` from it. Mirrors Pixi's own `fogDirty`
   *  (`renderer.ts:200`) -- avoids rebuilding the fog mesh's instance buffers
   *  on every 60 Hz `frame()` when the underlying data only changes at 5 Hz. */
  private fogMeshDirty = true;
  /**
   * Sight radius in tiles, indexed by unit TYPE index (not per entity) --
   * `./fog.ts`'s own `FogInput.sightByType` doc comment names this as an
   * efficiency-only deviation from Pixi's per-entity `fx.toNumber(type
   * .sight)` lookup, behaviourally identical because sight is a property of
   * the TYPE, identical for every living entity of it. Built ONCE, in the
   * constructor, not per frame: `main.ts` finishes every `sim.addUnitType`
   * call (line 438) before constructing this renderer (line 517), so
   * `sim.unitTypes` is already complete and never grows afterward -- the
   * same precondition `unitInstancers`/`turretInstancers` already rely on
   * implicitly (a unit type discovered only via `loadSprites`, never via a
   * NEW `sim.unitTypes` entry appearing later).
   */
  private readonly sightByType: Float64Array;
  private readonly fogMesh: FogMesh;
  /**
   * Phase D readiness fix: `sim.smoke` on screen -- see `smoke-mesh.ts`'s own
   * top comment for the full port account. Unlike `fogMesh`, there is no
   * dirty flag gating this one: Pixi's own smoke loop (`renderer.ts:2576`)
   * runs unconditionally every `frame()` call, not behind `fogDirty`, so
   * `smokeMesh.update` is called the same way, every `frame()`, below.
   */
  private readonly smokeMesh: SmokeMesh;
  /**
   * Phase C: tunnel trails, the three.js counterpart of `PixiRenderer
   * .drawTrail` (`renderer.ts:1121-1167`) -- see `./trail-mesh.ts`'s own top
   * comment for the full port account, including why its `renderOrder`/depth
   * recipe deliberately diverges from `fogMesh`'s.
   */
  private readonly trailMesh: TrailMesh;
  /** Set on the SAME `fogTick` cadence as `fogMeshDirty` -- Pixi's own
   *  `snapshot()` refreshes fog and trail off one shared `refresh` gate
   *  (`renderer.ts:733-735`, "the trail rides the same cadence, since its
   *  stamp/decay clock is slower still"), so this backend reuses `fogTick`
   *  rather than a second, independently-ticking counter that could drift
   *  out of step with it. */
  private trailMeshDirty = true;

  /**
   * Vehicle track marks (tread ruts, tyre prints) -- see `./vehicle-tracks
   * .ts`'s own top comment for the full design account. `vehicleTrackAccumTiles`
   * is the per-entity distance-since-last-stamp accumulator `stepTrackAccum`
   * carries forward; `vehicleTrackSeeded` mirrors `turretSeeded`/
   * `animSeeded`'s own pattern -- an entity's first tick only records its
   * position, so a freshly spawned or reinforced vehicle does not stamp a
   * phantom line from `(0, 0)` (the `Float64Array` zero-fill) to its actual
   * spawn tile. `trackClockMs` is this class's own accumulated `dtMs` total
   * (never `Date.now()`), the "now" both the stamp TTL and the expiry sweep
   * read -- see `Renderer.frame`'s own documented contract for why a
   * backend must not read its own clock.
   */
  private readonly vehicleTrackMesh: VehicleTrackMesh;
  private readonly vehicleTrackAccumTiles: Float64Array;
  private readonly vehicleTrackSeeded: Uint8Array;
  private trackClockMs = 0;

  constructor(
    private readonly sim: Sim,
    private readonly opts: RendererOptions
  ) {
    this.unitGroup = new Uint8Array(sim.capacity);
    const n = sim.capacity;
    this.prevX = new Float64Array(n);
    this.prevY = new Float64Array(n);
    this.curX = new Float64Array(n);
    this.curY = new Float64Array(n);
    this.entitySpeed = new Float64Array(n);
    this.entityAnimFrame = new Float64Array(n);
    this.animSeeded = new Uint8Array(n);
    this.firingTimer = new Float64Array(n);
    this.recoilT = new Float64Array(n);
    this.recoilDir = new Float64Array(n);
    this.recoilPower = new Float64Array(n);
    this.flinchT = new Float64Array(n);
    this.flinchDir = new Float64Array(n);
    this.turretFacing = new Float64Array(n);
    this.turretVel = new Float64Array(n);
    this.turretSeeded = new Uint8Array(n);
    this.turretFiringTimer = new Float64Array(n);
    this.vehicleMoving = new Uint8Array(n);
    this.vehicleDustAccumMs = new Float64Array(n);
    this.vehicleExhaustAccumMs = new Float64Array(n);
    this.vehicleTrackAccumTiles = new Float64Array(n);
    this.vehicleTrackSeeded = new Uint8Array(n);
    this.fog = new Uint8Array(sim.width * sim.height);
    this.sightByType = new Float64Array(sim.unitTypes.length);
    for (let t = 0; t < sim.unitTypes.length; t++) this.sightByType[t] = fx.toNumber(sim.unitTypes[t].sight);
    this.fogMesh = new FogMesh(sim.width, sim.height);
    this.smokeMesh = new SmokeMesh(sim.width, sim.height);
    // Colour baked once from opts.terrainTones.spoil, matching every other
    // per-map tone this backend reads once at construction rather than
    // re-resolving per frame -- see trail-mesh.ts's own top comment for why
    // one uniform colour serves the whole mesh.
    this.trailMesh = new TrailMesh(sim.width, sim.height, opts.terrainTones.spoil);
    // Same "resolve the palette-key colour once, at construction" pattern
    // as trailMesh just above -- opts.terrainTones.rut is the SAME resolved
    // hex the static rut painting already uses (`renderer.ts`'s own `rut`
    // stroke), so a driven-over tile and a hand-painted one read as the
    // same material. See vehicle-tracks.ts's own top comment for the full
    // palette/fog/pool-sizing account.
    this.vehicleTrackMesh = new VehicleTrackMesh(TRACK_POOL_CAPACITY, opts.terrainTones.rut);
    // Phase C: sized off sim.capacity, not a bare constant -- see
    // OVERLAY_VERTICES_PER_ENTITY's own doc comment for the per-entity
    // budget this multiplies, and the "+ 8192" headroom for the handful of
    // singular overlays (order markers, the tutorial ring, the garrison
    // hover highlight) that scale with neither entity nor selection count.
    this.overlayBatch = new OverlayBatch(sim.capacity * OVERLAY_VERTICES_PER_ENTITY + 8192);
    // Badge text fill: Pixi's own literal is '#14150F' with no resolveColor
    // call at that exact site (renderer.ts's Text style) -- resolved here
    // anyway ("colour is looked up, never computed" is this task's own
    // constraint, stricter than what renderer.ts happens to do), with that
    // literal only as the fallback for a caller that built this backend
    // with no resolver at all (ThreeRenderer.test.ts's own makeOpts()).
    this.numeralBatch = new NumeralBatch(
      sim.capacity,
      opts.resolveColor ? opts.resolveColor(BADGE_TEXT_COLOR_KEY) : '#14150F'
    );
    // antialias stays off deliberately (Phase 0 verdict, "Antialiasing must
    // be off, or accounted for"): a blended edge pixel is by definition not
    // a palette colour, and this backend's sprite/toon pipeline quantizes
    // rather than blends. Do not re-enable it without accounting for edges.
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    // outputColorSpace and the clear colour, in the one order that is
    // correct -- see palette-material.ts's module doc comment for why
    // three.js reads outputColorSpace synchronously inside setClearColor(),
    // which is exactly why this is a single call rather than two lines a
    // future edit could reorder.
    applyPalettePipeline(this.renderer, this.opts.background);
    // Terrain is a single shared material for the whole map (ground, scatter,
    // grove, residual, building-decor boxes alike) -- one registration here
    // covers all of it, unlike the mesh-unit/vehicle/building materials
    // below, which are registered per template as each loads.
    this.flashLights.register(this.terrainMat as THREE.ShaderMaterial);
    // Added unconditionally, not lazily on first useEmitters/spawn -- all
    // three meshes start at count/drawRange 0 (nothing live yet) and simply
    // stay that way until there is something to draw, the same "always
    // present, draws nothing until fed" shape terrain's own meshes have
    // before the first rebuildTerrain.
    this.scene.add(
      this.particleInstancerBelow.mesh,
      this.particleInstancerAbove.mesh,
      this.particleInstancerBelowAdditive.mesh,
      this.particleInstancerAboveAdditive.mesh,
      this.tracerBatch.mesh
    );
    // Same "always present, draws nothing until fed" shape as the FX meshes
    // just above -- both start at drawRange 0 (`beginFrame`/`endFrame`
    // haven't run yet) and stay that way until `updateOverlays`'s first
    // call, from `frame()`.
    this.scene.add(this.overlayBatch.mesh, this.numeralBatch.mesh);
    // Pixi's own `trailG` is `world`'s SECOND child (`renderer.ts:539`,
    // below fxG/wreckLayer/spriteLayer alike) -- but per trail-mesh.ts's own
    // top comment, scene-graph position carries no draw-order meaning in
    // this backend the way it does not for fogMesh either; `trailMesh.mesh
    // .renderOrder` (`TRAIL_RENDER_ORDER`) plus real depth-buffer arbitration
    // is what actually places it. Added here, not last, only so a reader
    // scanning this constructor sees ground-plane geometry grouped before
    // the always-on-top fog mesh below it.
    this.scene.add(this.trailMesh.mesh);
    // Same ground-band placement as trailMesh just above, for the same
    // "scene-graph position is cosmetic here, renderOrder plus real depth
    // does the real work" reason -- see vehicle-tracks.ts's own top comment.
    this.scene.add(this.vehicleTrackMesh.mesh);
    // `SMOKE_RENDER_ORDER` sits above the overlay tier and below fog -- see
    // `smoke-mesh.ts`'s own top comment. Scene-graph position is cosmetic
    // here for the identical reason it is for `fogMesh`/`trailMesh` (three.js
    // does not order draws by child order); added before `fogMesh` only so a
    // reader scanning constructor order sees smoke grouped with the other
    // ground-relative overlay meshes, fog last.
    this.scene.add(this.smokeMesh.mesh);
    // Added LAST, matching Pixi's own `world.addChild(this.fogG)` being the
    // final call in its constructor (`renderer.ts:551`, "above terrain AND
    // units") -- three.js does not order draws by scene-graph child order
    // the way Pixi does, so this placement is cosmetic here; `fogMesh.mesh
    // .renderOrder` (`FOG_RENDER_ORDER`) is what actually enforces it. Kept
    // last anyway so a reader scanning constructor order sees the same story
    // both backends tell.
    this.scene.add(this.fogMesh.mesh);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
  get width(): number {
    return this.renderer.domElement.width;
  }
  get height(): number {
    return this.renderer.domElement.height;
  }

  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    this.renderer.setPixelRatio(1);
    this.fitToHost();
    host.appendChild(this.renderer.domElement);
    // PixiRenderer gets this from `resizeTo: host` (renderer.ts). Without an
    // equivalent the three canvas would stay at boot size while `width`/
    // `height` -- which `worldToScreen`/`screenToWorld` both read off the
    // canvas -- kept reporting it, so the two backends would disagree by
    // exactly the resize delta and every pointer read would land on the
    // wrong tile.
    //
    // A ResizeObserver on the host rather than a window `resize` listener:
    // it covers the window case and also the ones a window listener misses
    // (a sidebar opening, the host's own layout changing, devtools docking),
    // and it is scoped to the element this renderer actually fills.
    this.resizeObserver = new ResizeObserver(() => {
      this.fitToHost();
    });
    this.resizeObserver.observe(host);
    // Seeds prevX/prevY == curX/curY from the sim's actual starting
    // positions before the first `frame()` -- exactly Pixi's own
    // `PixiRenderer.init()` ("this.snapshot(); this.snapshot(); // prev ==
    // cur on the first frame", `renderer.ts:557-558`). `main.ts`'s own
    // fixed-tick loop calls `renderer.snapshot()` only from inside
    // `runTick()`, which does not run until after the first `sim.tick()` --
    // so without this, every unit would render at world (0, 0) (the
    // Float64Array zero-fill) for however many animation frames elapse
    // before that first tick lands.
    this.snapshot();
    this.snapshot();
    await Promise.resolve();
  }

  /**
   * Release the GPU context and stop observing the host.
   *
   * Nothing calls this today: `main()` has no shutdown path -- see the `void
   * rafId` note at the end of it -- so there is no sensible place to hang
   * teardown off. It exists so the observer has a documented owner rather
   * than being a listener with no way to remove it, and so a future teardown
   * has one call to make instead of having to learn this class's internals.
   *
   * Disposes every terrain geometry and the shared material. B2.4 left this
   * out for the ground mesh alone -- harmless while `WebGLRenderer.dispose()`
   * forces context loss regardless and nothing called `dispose()` at all --
   * but B2.5 added a second geometry sharing the same material, and B2.6 a
   * third; letting that omission grow rather than fixing it here would be
   * the wrong direction to take it in.
   */
  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.terrainMesh?.geometry.dispose();
    this.scatterMesh?.geometry.dispose();
    this.groveMesh?.geometry.dispose();
    this.residualMesh?.geometry.dispose();
    for (const mesh of this.structureBoxes.values()) mesh.geometry.dispose();
    this.structureBoxes.clear();
    this.terrainMat.dispose();
    for (const instancer of this.unitInstancers.values()) instancer.dispose();
    this.unitInstancers.clear();
    for (const instancer of this.turretInstancers.values()) instancer.dispose();
    this.turretInstancers.clear();
    // Mesh units: unlike the instancers above (added once, left for the
    // life of the renderer), every `MeshUnitEntity` is added and removed
    // dynamically across a mission (`updateMeshUnits`), so -- like
    // `collapsing` below -- each one needs an explicit `scene.remove` here,
    // not just a `.dispose()` relying on `renderer.dispose()`'s context
    // loss. Entities first (they share the templates' geometries/materials
    // by reference -- `MeshUnitTemplate`'s own doc comment -- so disposing a
    // template before its entities are torn down would be fine here, since
    // nothing renders again after this method returns, but entities-then-
    // templates is the order `loadMeshUnit`'s own reload path already uses,
    // and matching it means there is only one ordering to reason about).
    for (const entity of this.meshUnitEntities.values()) {
      this.scene.remove(entity.root);
      disposeMeshUnitEntity(entity);
    }
    this.meshUnitEntities.clear();
    // Mesh units mid-death-fade own a per-entity material clone
    // (`beginMeshDeathFade`) that nothing else disposes -- `endMeshDeathFade`
    // restores the shared template material first (harmless here, since
    // nothing renders again after this method returns, but it is the same
    // call `stepMeshDeath` itself makes, so there is only one restore path
    // to reason about) and disposes the clone.
    for (const d of this.meshDying) {
      endMeshDeathFade(d.swaps);
      this.scene.remove(d.entity.root);
      disposeMeshUnitEntity(d.entity);
    }
    this.meshDying.length = 0;
    // Permanent wrecks share the template's geometry/material by reference
    // (like every living `MeshUnitEntity` does -- `MeshUnitTemplate`'s own
    // doc comment), so only `scene.remove` is needed; the shared resources
    // themselves are disposed once, below, by `disposeMeshUnitTemplate`.
    for (const w of this.meshWrecks) this.scene.remove(w.root);
    this.meshWrecks.length = 0;
    for (const template of this.meshUnitTemplates.values()) disposeMeshUnitTemplate(template);
    this.meshUnitTemplates.clear();
    // Vehicle meshes: entities first, then templates -- the identical
    // "clones share the template's geometry/material by reference" ordering
    // `meshUnitEntities`/`meshUnitTemplates` just above already follow.
    // `VehicleMeshEntity` owns nothing of its own to dispose (no mixer, no
    // per-entity material clone -- `mesh-vehicle.ts`'s own top comment), so
    // `scene.remove` is the whole story for each one.
    for (const entity of this.vehicleMeshEntities.values()) this.scene.remove(entity.root);
    this.vehicleMeshEntities.clear();
    for (const template of this.vehicleMeshTemplates.values()) disposeVehicleMeshTemplate(template);
    this.vehicleMeshTemplates.clear();
    // Building meshes: same shape again -- every clone removed from the
    // scene first (nothing of its own to dispose, matching vehicles), then
    // each template's shared geometry/material released exactly once.
    for (const root of this.buildingMeshIdleEntities.values()) this.scene.remove(root);
    this.buildingMeshIdleEntities.clear();
    for (const root of this.buildingMeshWreckEntities.values()) this.scene.remove(root);
    this.buildingMeshWreckEntities.clear();
    for (const template of this.buildingMeshIdleTemplates.values()) disposeBuildingMeshTemplate(template);
    this.buildingMeshIdleTemplates.clear();
    for (const template of this.buildingMeshWreckTemplates.values()) disposeBuildingMeshTemplate(template);
    this.buildingMeshWreckTemplates.clear();
    for (const instancer of this.structureIdle.values()) instancer.dispose();
    this.structureIdle.clear();
    for (const instancer of this.structureWreck.values()) instancer.dispose();
    this.structureWreck.clear();
    // Task B4.4: each collapse owns its own geometry/material (the texture
    // is borrowed from `structureIdle`, disposed above -- not here, see
    // `StructureInstancer.spriteTexture`'s own doc comment).
    for (const c of this.collapsing) {
      this.scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh.material.dispose();
    }
    this.collapsing.length = 0;
    this.particleInstancerBelow.dispose();
    this.particleInstancerAbove.dispose();
    this.particleInstancerBelowAdditive.dispose();
    this.particleInstancerAboveAdditive.dispose();
    this.tracerBatch.dispose();
    // Phase C: same "added once in the constructor, no scene.remove needed"
    // shape as the FX batches just above -- see this file's own comment on
    // the `fogMesh.dispose()` fix a few lines down for why that omission
    // used to be a real leak elsewhere, guarded against here from the start.
    this.overlayBatch.dispose();
    this.numeralBatch.dispose();
    // Final-review fix: FogMesh owns a full-map `InstancedMesh` (geometry,
    // material, instance buffers) and this call was missing entirely --
    // `FogMesh.dispose()` existed but nothing called it. No `scene.remove`
    // needed, matching every other "added once in the constructor, left for
    // the life of the renderer" mesh above (terrain, particles, tracers):
    // this dispose() sequence never removes those from `scene` either,
    // relying on `renderer.dispose()` forcing context loss below. Only the
    // `collapsing` loop above calls `scene.remove`, because those meshes are
    // dynamically added and removed one at a time outside of dispose().
    this.fogMesh.dispose();
    // Same full-map `InstancedMesh` shape as `fogMesh`, same "added once in
    // the constructor, no scene.remove needed" reasoning -- guarded against
    // the identical leak from the start rather than repeating fogMesh's own
    // omit-then-fix history.
    this.smokeMesh.dispose();
    // Phase C: same full-map `InstancedMesh` shape as `fogMesh`, same
    // "added once in the constructor, no scene.remove needed" reasoning
    // just above -- guarded against the identical leak from the start
    // rather than repeating fogMesh's own omit-then-fix history.
    this.trailMesh.dispose();
    // Same "added once in the constructor, no scene.remove needed" shape as
    // trailMesh just above.
    this.vehicleTrackMesh.dispose();
    this.renderer.dispose();
    this.host = null;
  }

  /** Size the drawing buffer to the host element, exactly as Pixi's
   *  `resizeTo` does: `clientWidth`/`clientHeight`, at resolution 1. No clamp
   *  to a minimum -- a zero-sized host produces a zero-sized canvas on both
   *  backends, and inventing a 1x1 floor here would make them disagree. */
  private fitToHost(): void {
    if (!this.host) return;
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight);
  }

  /** `alpha` (interpolation) and `dtMs` (presentation animation -- frame
   *  advance) now feed every living unit's `EntityFrame` via `updateUnits`,
   *  and (Task B3.13) every live particle/tracer via `updateFx`. Terrain
   *  still reads neither: it has no per-frame presentation state.
   *
   *  Task B4.4: `stepCollapses` runs right after `updateStructures` -- the
   *  two are independent, additive layers (see `beginCollapse`'s own doc
   *  comment), so the order between them does not matter causally; placed
   *  here simply because it is the other structure-presentation update this
   *  frame does.
   *
   *  `drainTimers` runs FIRST, before anything reads `firingTimer`/`recoilT`/
   *  `flinchT` -- mirroring `PixiRenderer.frame()`'s own top-of-frame drain
   *  (`renderer.ts:1882-1888`) exactly, including the ordering: the decay
   *  has to land before `updateUnits` builds this frame's `EntityFrameInput`
   *  from the just-drained values, or every latch would read one frame
   *  stale.
   *
   *  Task B4.2: the fog MESH (GPU instance buffers) rebuilds only when
   *  `fogMeshDirty` -- set by `recomputeFog`, which runs at 5 Hz from
   *  `snapshot`, not every 60 Hz `frame()` -- mirroring Pixi's own
   *  `fogDirty`-gated `drawFog` (`renderer.ts:2574`). `isVisible`'s
   *  correctness for THIS frame's `updateUnits` call does not depend on this
   *  gate at all: it reads `this.fog` (the plain data `recomputeFog` last
   *  wrote) directly via `isFogVisible`, never through `fogMesh` -- the mesh
   *  rebuild below is purely what appears on screen, decoupled from what the
   *  living-unit skip decides.
   *
   *  Phase C: `trailMesh` rebuilds on the identical `trailMeshDirty` gate,
   *  set by `snapshot()` on the same 5 Hz tick `fogMeshDirty` uses -- unlike
   *  fog, there is no intermediate "recompute" step producing owned data:
   *  Pixi's own `drawTrail` reads `Sim.trail`/`tunnelContactLevel`/etc.
   *  live at draw time with nothing cached in between, and `buildTrailInput`
   *  below does the same, so this gate governs only the GPU rebuild, not a
   *  separate computation. */
  frame(alpha: number, dtMs: number): void {
    this.drainTimers(this.frameDtSeconds(dtMs));
    if (this.terrainDirty) {
      this.rebuildTerrain();
      this.terrainDirty = false;
    }
    this.updateUnits(alpha, dtMs);
    this.updateMeshUnits(alpha, dtMs);
    this.updateVehicleMeshes(alpha, dtMs);
    this.updateVehicleAmbientFx(dtMs);
    this.updateStructures();
    this.updateBuildingMeshes();
    this.stepCollapses(this.frameDtSeconds(dtMs));
    this.updateFx(dtMs);
    // Ages every active muzzle-flash and rewrites the shared uFlash* arrays
    // every registered toon-ramp/terrain material already points at -- see
    // `FlashLightManager.step`'s own doc comment. Presentation-only timing
    // (`dtMs`, not a sim tick), the same footing `updateFx`'s own particle/
    // tracer stepping already stands on.
    this.flashLights.step(dtMs);
    this.updateOverlays(alpha);
    if (this.fogMeshDirty) {
      this.fogMesh.update(this.fog, this.retained.elevation, this.sim.width, this.sim.height);
      this.fogMeshDirty = false;
    }
    // No dirty gate -- Pixi's own smoke loop redraws every `frame()` call,
    // not behind `fogDirty` (`smokeMesh`'s own doc comment above).
    this.smokeMesh.update(this.sim.smoke, this.retained.elevation, this.sim.width, this.sim.height);
    if (this.trailMeshDirty) {
      this.trailMesh.update(this.buildTrailInput());
      this.trailMeshDirty = false;
    }
    // No dirty gate, matching smokeMesh's own "runs every frame()" above --
    // the sweep is a flat, bounded (TRACK_POOL_CAPACITY) scan, cheap enough
    // to just always run; see sweepExpiredTrackSlots's own doc comment.
    // trackClockMs is this backend's own accumulated dtMs total, never a
    // direct clock read -- see the field's own doc comment.
    this.trackClockMs += dtMs;
    this.vehicleTrackMesh.update(this.trackClockMs);
    this.renderer.render(this.scene, this.threeCamera());
  }

  /**
   * Assembles `./trail-mesh.ts`'s `TrailInstanceInput` from `this.sim` --
   * the three.js counterpart of `PixiRenderer.drawTrail`'s own direct `Sim`
   * reads (`renderer.ts:1132-1155`). `routeLevel` reproduces that method's
   * collapse downgrade verbatim: "a collapsed route keeps drawing its
   * residual spoil... but never the identified line." Side hardcoded to 0 at
   * every callback, matching Pixi exactly -- trails are what the PLAYER has
   * found, never the AI's own contact state.
   */
  private buildTrailInput(): TrailInstanceInput {
    const sim = this.sim;
    return {
      width: sim.width,
      height: sim.height,
      elevation: this.retained.elevation,
      trail: sim.trail,
      routeCount: sim.tunnelCount,
      routeLevel: (r) => collapsedRouteLevel(sim.tnAlive[r] !== 0, sim.tunnelContactLevel(0, r)),
      tunnelUnderTile: (r, x, y) => sim.tunnelUnderTile(r, x, y),
      seenByAnyone: (x, y) => sim.sideSeesTile(0, x, y),
      seenByCarrier: (x, y) => sim.markerSeesTile(0, x, y),
    };
  }

  /**
   * Drains the one-shot firing/recoil/flinch latches -- ported verbatim from
   * `PixiRenderer.frame()`'s own top-of-frame drain (`renderer.ts:1882-1888`,
   * "Drain the one-shot latches before anything reads them. Recoil and
   * flinch decay over their own durations, framerate-independently.").
   * Not gated on `alive[i]`, matching Pixi exactly: a unit killed mid-recoil
   * still has its timer drained (harmlessly -- nothing reads a dead entity's
   * recoil, since `updateUnits`'s living-entity loop skips it and
   * `stepDeaths` builds its own synthetic frame from captured state instead).
   */
  private drainTimers(dtSeconds: number): void {
    const n = this.sim.entityCount;
    for (let i = 0; i < n; i++) {
      if (this.firingTimer[i] > 0) this.firingTimer[i] = Math.max(0, this.firingTimer[i] - dtSeconds);
      // Task B3.6: same shape as firingTimer -- counts down its own
      // remaining seconds, not a normalised 0..1 decay.
      if (this.turretFiringTimer[i] > 0) {
        this.turretFiringTimer[i] = Math.max(0, this.turretFiringTimer[i] - dtSeconds);
      }
      if (this.recoilT[i] > 0) this.recoilT[i] = Math.max(0, this.recoilT[i] - dtSeconds / RECOIL_SECONDS);
      if (this.flinchT[i] > 0) this.flinchT[i] = Math.max(0, this.flinchT[i] - dtSeconds / FLINCH_SECONDS);
    }
  }

  /**
   * Copy positions after every sim tick; `frame()` lerps between the
   * copies -- the three.js counterpart to `PixiRenderer.snapshot()`
   * (`renderer.ts:729-751`). Ground speed is measured from the tick delta
   * rather than read off the unit type, matching Pixi exactly, so cover
   * slowdowns, pinning and mobility kills pace the gait for free.
   *
   * Task B4.2 ports the fog half of Pixi's own refresh: `this.fogTick++ % 4
   * === 0` gating `recomputeFog` at 5 Hz, exactly Pixi's own cadence
   * (`renderer.ts:733`). Phase C's trail port reuses the SAME gate for
   * `trailMeshDirty` -- Pixi's own `snapshot()` refreshes both off one
   * shared `refresh` local (`renderer.ts:733-735`, "the trail rides the same
   * cadence, since its stamp/decay clock is slower still"), so this backend
   * does not grow a second, independently-ticking counter for it.
   *
   * Turret facing is NOT seeded here, unlike Pixi's own `snapshot()`
   * (`renderer.ts:748-750`, gated on `this.frameN === 0`): Task B3.6 seeds
   * it per-entity, in `entityFrame` itself (`turretSeeded`, `frame-state.ts`),
   * on that entity's own first decided frame rather than a single
   * tick-loop gate tied to the very first rendered frame. That also seeds a
   * reinforcement correctly on ITS OWN first frame, which Pixi's single
   * `frameN === 0` gate does not (a unit spawned after the first frame has
   * rendered is never seeded there at all, and springs from a frozen 0
   * until it first acquires a target).
   */
  snapshot(): void {
    // Fog only needs to keep up with movement, not the tick rate -- same
    // cadence Pixi uses (renderer.ts:733): every fourth snapshot() call, 5
    // Hz at the sim's 20 Hz tick.
    if (this.fogTick++ % 4 === 0) {
      this.recomputeFog();
      this.trailMeshDirty = true;
    }
    this.prevX.set(this.curX);
    this.prevY.set(this.curY);
    const st = this.sim.state;
    for (let i = 0; i < this.sim.entityCount; i++) {
      this.curX[i] = fx.toNumber(st.posX[i]);
      this.curY[i] = fx.toNumber(st.posY[i]);
      const dx = this.curX[i] - this.prevX[i];
      const dy = this.curY[i] - this.prevY[i];
      this.entitySpeed[i] = Math.hypot(dx, dy) * SIM_HZ;

      // Vehicle track marks: tick-driven (not frame-driven), matching this
      // tick's own exact dx/dy rather than a re-derived speed*dt -- see
      // ./vehicle-tracks.ts's own top comment for the full design account.
      // `type.isAir` is checked explicitly (no roster air unit is in
      // trackKindFor's table today, but heli_peten is armoured and would
      // have slipped an isSoft-only gate); membership in trackKindFor's own
      // closed table is what actually excludes every foot/crew-served unit.
      if (st.alive[i] !== 0) {
        const type = this.sim.unitTypes[st.typeIdx[i]];
        if (!type.isAir) {
          const kind = trackKindFor(type.id);
          if (kind) {
            // First tick after spawn/reinforcement only seeds -- avoids a
            // phantom straight-line stamp from the Float64Array zero-fill
            // to this entity's real spawn tile, mirroring turretSeeded/
            // animSeeded's own established pattern above.
            if (this.vehicleTrackSeeded[i] === 1 && (dx !== 0 || dy !== 0)) {
              const r = stepTrackAccum(this.vehicleTrackAccumTiles[i], dx, dy);
              this.vehicleTrackAccumTiles[i] = r.accumTiles;
              if (r.stamps > 0) {
                const facingNorm = fx.toNumber(st.facing[i]);
                for (let s = 0; s < r.stamps; s++) {
                  this.vehicleTrackMesh.stamp(
                    this.curX[i],
                    this.curY[i],
                    facingNorm,
                    kind,
                    this.retained.elevation,
                    this.sim.width,
                    this.sim.height,
                    this.trackClockMs
                  );
                }
              }
            }
            this.vehicleTrackSeeded[i] = 1;
          }
        }
      }
    }
  }

  /**
   * Task B4.2: one tick of fog-of-war -- assembles `./fog.ts`'s `FogInput`
   * from `Sim` and this class's own `sightByType`, and reassigns `this.fog`
   * to `computeFog`'s fresh result (pure function, never mutates `prev` in
   * place -- see that module's own doc comment). Sets `fogMeshDirty` so
   * `frame()` rebuilds the GPU mesh from the new data on its next call.
   */
  private recomputeFog(): void {
    const st = this.sim.state;
    const input: FogInput = {
      width: this.sim.width,
      height: this.sim.height,
      entityCount: this.sim.entityCount,
      alive: st.alive,
      side: st.side,
      typeIdx: st.typeIdx,
      posX: st.posX,
      posY: st.posY,
      sightByType: this.sightByType,
      blocked: this.sim.blocked,
      isLowProfile: (x, y) => this.isLowProfileTile(x, y),
    };
    this.fog = computeFog(this.fog, input);
    this.fogMeshDirty = true;
  }

  /** A chest-high wall casts no fog shadow, because the sim lets sight and
   *  fire cross it -- ported verbatim from `PixiRenderer.isLowProfile`
   *  (`renderer.ts:1083-1087`); see `./fog.ts`'s `hasSight` doc comment for
   *  why this exemption exists (without it the compound's own garrison would
   *  be shooting at men the fog swears they cannot see). */
  private isLowProfileTile(x: number, y: number): boolean {
    const s = this.sim.structureAt(x, y);
    if (s < 0) return false;
    return this.sim.structureTypes[this.sim.structures.typeIdx[s]].lowProfile;
  }

  /**
   * Task B3.14: the presentation half of `onEvents`, ported from
   * `renderer.ts:756` onward (`PixiRenderer.onEvents`). Wires seven of the
   * nine event kinds Pixi handles there -- `fire`, `impact`, `nearMiss`,
   * `aps`, `strike`, `destroyed`, `tunnelCollapsed` -- muzzle flash position
   * and direction, tracer spawn, impact effects, the death fade
   * (`stepDeaths`), and the recoil/flinch latches `drainTimers` decays.
   *
   * `structureHit` and `structureDestroyed` are wired by Task B3.10, the
   * last two of the nine kinds Pixi handles at `renderer.ts:756` onward.
   * Both mark terrain dirty in Pixi (`renderer.ts:853,881`), and Pixi fires
   * `structureHit` on EVERY damage event -- a full `rebuildTerrain` here
   * costs 114-179ms (this class's own `rebuildTerrain` doc comment), so
   * wiring either directly to that full rebuild would make a siege
   * unplayable rather than merely visually stale. Task B3.9 built the fix
   * first, deliberately ahead of this wiring: `applyStructureHit`/
   * `applyStructureDestroyed`, both public below, an O(footprint)
   * per-structure rebuild instead of an O(map area) one, tested at the
   * pure-function layer they call into (`terrain/dirty.ts`) and measured in
   * that task's own report at 0.52% of a full rebuild worst case. This
   * task's own job is exactly the one-line call each: `applyStructureHit`
   * already contains the eight-step wear quantisation (via
   * `dirtyForStructureHit`) that makes firing it on every `structureHit`
   * survivable, so this method does not -- and must not -- add a second
   * filter of its own on top.
   *
   * Task B3.6 closed the turret gap this comment used to describe: `onFire`
   * below now reads the shooter's TURRET facing for muzzle position/
   * direction and recoil bearing whenever this backend has turret art
   * loaded for that unit type (`this.turretInstancers`), and only falls
   * back to hull facing for a unit type with none -- see `onFire`'s own
   * comment for the one deliberate way this differs from Pixi's `usesTurret`
   * condition (`renderer.ts:778-781`), and why.
   */
  onEvents(events: SimEvent[]): void {
    const st = this.sim.state;
    for (const e of events) {
      if (e.kind === 'fire') this.onFire(e);
      else if (e.kind === 'nearMiss') {
        this.spawnFlatFx(fx.toNumber(e.x), fx.toNumber(e.y), this.opts.nearMissColor, 7, 14);
      } else if (e.kind === 'aps' && e.intercepted) {
        this.spawnFlatFx(this.curX[e.target], this.curY[e.target], this.opts.interceptColor, 10, 12);
      } else if (e.kind === 'impact' && e.penetrated) {
        this.spawnFlatFx(this.curX[e.target], this.curY[e.target], this.opts.flashColor, 8, 10);
        // Jolt the target away from the shooter, so a penetrating hit lands
        // on the unit rather than only in the roll feed (renderer.ts:825-832).
        const dx = this.curX[e.target] - this.curX[e.shooter];
        const dy = this.curY[e.target] - this.curY[e.shooter];
        if (dx !== 0 || dy !== 0) {
          this.flinchT[e.target] = 1;
          this.flinchDir[e.target] = (((Math.atan2(dy, dx) / (Math.PI * 2)) % 1) + 1) % 1;
        }
      } else if (e.kind === 'strike') {
        this.onStrike(e.x, e.y, e.tick);
      } else if (e.kind === 'tunnelCollapsed') {
        this.onTunnelCollapsed(e.tunnel, e.tick);
      } else if (e.kind === 'destroyed') {
        this.dying.push({
          x: this.curX[e.entity],
          y: this.curY[e.entity],
          facing: fx.toNumber(st.facing[e.entity]),
          typeId: this.sim.unitTypes[st.typeIdx[e.entity]].id,
          t: 0,
        });
      } else if (e.kind === 'structureHit') {
        // Task B3.10: the quantisation that makes this survivable at
        // Pixi's per-round event volume lives inside `applyStructureHit`
        // itself (`dirtyForStructureHit`) -- see this method's own doc
        // comment. Do not add a second filter here.
        this.applyStructureHit(e.structure);
        // Task B4.3, ported from `renderer.ts:858-878`. A blade throws dust
        // where it is cutting; a shell throws it off the roof -- `isGrindingHit`
        // is the shared, sim-only predicate that tells the two apart (see its
        // own doc comment in `grind.ts`), same as the debug overlay uses.
        const hitStruct = e.structure;
        if (!isGrindingHit(this.sim, e.by, hitStruct)) {
          this.spawnFlatFx(
            fx.toNumber(this.sim.structures.cx[hitStruct]),
            fx.toNumber(this.sim.structures.cy[hitStruct]),
            this.opts.nearMissColor,
            9,
            12
          );
        } else if (e.tick - (this.structPuffTick.get(hitStruct) ?? -99) >= 4) {
          // A blade lands a hit every tick; one puff in four is plenty, and it
          // is counted per structure so two dozers do not double the dust.
          this.structPuffTick.set(hitStruct, e.tick);
          const a = tileHash(e.tick, hitStruct);
          const b = tileHash(hitStruct, e.tick);
          this.spawnFlatFx(
            this.curX[e.by] + (a - 0.5) * 0.35,
            this.curY[e.by] + (b - 0.5) * 0.35,
            this.opts.nearMissColor,
            7,
            14
          );
        }
      } else if (e.kind === 'structureDestroyed') {
        // Task B3.10: one-shot per structure's whole life, so the full
        // `rebuildTerrain()` this schedules (see `applyStructureDestroyed`'s
        // own doc comment) is the deliberate asymmetry with `structureHit`
        // above, not an oversight.
        this.applyStructureDestroyed(e.structure);
        // Task B4.4, ported from `renderer.ts:272-303`. Starts the falling
        // sprite -- a separate, one-off mesh from the idle/wreck instancers
        // `updateStructures` already swaps every frame -- see
        // `beginCollapse`'s own doc comment for the ordering argument
        // against that swap.
        this.beginCollapse(e.structure);
        // Task B4.3, ported from `renderer.ts:880-901`. Masonry and a dust
        // bloom, authored in `data/vfx/structure_collapse.json`; falls back to
        // flat puffs when no emitter set is loaded, exactly like
        // `onTunnelCollapsed` already does for `tunnel_collapse`.
        const deadStruct = e.structure;
        this.structPuffTick.delete(deadStruct);
        const bx = fx.toNumber(this.sim.structures.cx[deadStruct]);
        const by = fx.toNumber(this.sim.structures.cy[deadStruct]);
        if (!this.spawnCollapseFx('structure_collapse', bx, by)) {
          for (let k = 0; k < 14; k++) {
            const a = tileHash(k * 7 + deadStruct, k * 13 + deadStruct);
            const b = tileHash(k * 31 + deadStruct, k * 3 + deadStruct);
            this.spawnFlatFx(bx + (a - 0.5) * 3, by + (b - 0.5) * 3, this.opts.nearMissColor, 10 + a * 10, 26 + Math.floor(a * 16));
          }
        }
      }
    }
  }

  /**
   * The `fire` case, ported from `renderer.ts:758-818`. Split out of
   * `onEvents` itself only because it is by far the longest of the seven --
   * the branch structure otherwise matches Pixi's exactly, kind for kind.
   */
  private onFire(e: Extract<SimEvent, { kind: 'fire' }>): void {
    const st = this.sim.state;
    // Shots at buildings carry target -1: aim the tracer at the building
    // (renderer.ts:759-762).
    const atStruct = e.target < 0 && e.structure !== undefined;
    const tx = atStruct ? fx.toNumber(this.sim.structures.cx[e.structure as number]) : this.curX[e.target];
    const ty = atStruct ? fx.toNumber(this.sim.structures.cy[e.structure as number]) : this.curY[e.target];
    this.tracers.push(spawnTracer(this.curX[e.shooter], this.curY[e.shooter], tx, ty, st.side[e.shooter]));

    const type = this.sim.unitTypes[st.typeIdx[e.shooter]];
    // Latch the fire clip for its own declared duration (renderer.ts:772-777).
    const fireClip = this.unitInstancers.get(type.id)?.sheet.clips.fire;
    if (fireClip && fireClip.fps > 0) {
      this.firingTimer[e.shooter] = fireClip.frames / fireClip.fps;
    }

    // Task B3.6: the turret's OWN fire-clip duration, latched independently
    // of the hull's `firingTimer` above -- see `turretFiringTimer`'s own
    // field doc comment for why reusing `firingTimer` would leave every
    // shipped turret's `fire` clip unreachable (no hull sheet with turret
    // art declares one of its own).
    const turretInstancer = this.turretInstancers.get(type.id);
    const turretFireClip = turretInstancer?.sheet.clips.fire;
    if (turretFireClip && turretFireClip.fps > 0) {
      this.turretFiringTimer[e.shooter] = turretFireClip.frames / turretFireClip.fps;
    }

    // Turret facing when this unit type has turret art loaded -- BILLBOARD
    // art (`turretInstancer`) or a mesh vehicle's own `turret_pivot`
    // (`meshTurretPivot`) -- hull facing otherwise. `this.turretFacing
    // [e.shooter]` is the SAME array either way (`updateVehicleMeshes`'s own
    // doc comment: "reuse that source; do not invent a second one"), holding
    // whatever the last `entityFrame`/`updateVehicleMeshes` call sprung it
    // to, matching Pixi's own `usesTurret` read of
    // `this.turretFacing[e.shooter]` (renderer.ts:778-781). Gated on ACTUAL
    // turret art rather than Pixi's `!type.isSoft` -- a deliberate, narrower
    // condition: Pixi's turret-facing spring only ever runs for a unit type
    // with turret art loaded (`if (atlas.turretTextures)`,
    // renderer.ts:2112), so a non-soft vehicle with NO turret sheet (the
    // jeep, the D9, the Apache) has its `turretFacing` seeded once at
    // mission start and then left frozen forever in Pixi -- reading it there
    // would be reading a stale value, not a turret-aware one. Reading hull
    // facing for that case instead (this backend's own pre-B3.6 behaviour)
    // is strictly more correct, not merely different, and only matters for a
    // unit type that never draws a turret (sprite OR mesh) in either
    // backend.
    const meshVehicle = this.vehicleMeshEntities.get(e.shooter);
    const meshTurretPivot = meshVehicle?.turretPivot ?? null;
    const facingRad = turretInstancer || meshTurretPivot
      ? this.turretFacing[e.shooter] * Math.PI * 2
      : fx.toNumber(st.facing[e.shooter]) * Math.PI * 2;
    const barrelLen = type.isSoft ? 0.4 : 0.8;
    let mzX: number;
    let mzY: number;
    if (meshTurretPivot) {
      // Anchor at the mesh vehicle's own turret pivot -- its REAL, per-entity
      // world position (position/rotation set by the last `updateVehicleMeshes`
      // call, `matrixWorld` refreshed by the render pass that call's own
      // `frame()` invocation ends with, so this reads at most one frame
      // stale) -- plus a residual barrel-tip extension along the turret's
      // current bearing (`MESH_TURRET_MUZZLE_TILES`'s own doc comment). This
      // replaces the flat hull-centre-plus-`barrelLen` guess below for any
      // unit type whose mesh actually carries a `turret_pivot` node; that
      // guess remains the fallback for every billboard-turret and no-turret
      // type, unchanged.
      meshTurretPivot.getWorldPosition(this.scratchMuzzleWorld);
      mzX = this.scratchMuzzleWorld.x + Math.cos(facingRad) * MESH_TURRET_MUZZLE_TILES;
      mzY = this.scratchMuzzleWorld.z + Math.sin(facingRad) * MESH_TURRET_MUZZLE_TILES;
    } else {
      mzX = this.curX[e.shooter] + Math.cos(facingRad) * barrelLen;
      mzY = this.curY[e.shooter] + Math.sin(facingRad) * barrelLen;
    }

    // Which weapon fired decides the signature, not whether the shooter is
    // soft (renderer.ts:785-791).
    const wp = type.weapons.find((w) => w.id === e.weaponId);
    const cls = wp?.cls ?? WEAPON_CLASS.small_arms;
    const emitter = this.emitterLibrary.fireEmitterFor(cls);
    const power = wp ? firePower(wp) : 0;
    // Muzzle-flash ramp shift (`./palette-material.ts`'s own "The
    // muzzle-flash 'light'" doc comment) -- a no-op when this emitter
    // declares no `light` (`FlashLightManager.spawn` itself no-ops on a
    // missing/zero `decay_ms`, which an absent `light` object also produces
    // via the `?.` below). `light.color` is deliberately NOT read here: the
    // chosen mechanism shifts a surface toward ITS OWN ramp's lighter step,
    // not toward the flash's own hue -- tinting every nearby surface toward
    // `vfx.white_hot` would reintroduce the exact off-palette RGB-summation
    // problem `additive` (`units/fx.ts`) was already rejected for.
    if (emitter?.light) this.flashLights.spawn(mzX, mzY, emitter.light);

    // Kick the shooter back along its own bearing (renderer.ts:792-800).
    // Demolition charges are placed, not fired -- a satchel charge must not
    // make the squad lurch.
    if (cls !== WEAPON_CLASS.demolition) {
      this.recoilT[e.shooter] = 1;
      this.recoilDir[e.shooter] = facingRad / (Math.PI * 2);
      this.recoilPower[e.shooter] = power;
    }

    if (emitter && this.particleSystem) {
      const dirTurns = facingRad / (Math.PI * 2);
      const prio = emitter.budget_priority ?? 5;
      for (const layer of emitter.particles) {
        const offset = (layer.direction_offset_deg ?? 0) / 360;
        // additive is a per-PARTICLE-LAYER field (`fire_apfsds`'s own hot
        // core is additive; its dust wash and drifting smoke are not, all
        // under the same `above_units` emitter) -- so the draw-layer lookup
        // has to happen per layer, not once for the whole emitter the way
        // `fxLayer` used to be hoisted above this loop.
        const fxLayer = fxLayerIndex(emitter.layer, layer.additive ?? false);
        this.particleSystem.spawn(layer, mzX, mzY, dirTurns + offset, power, prio, fxLayer);
      }
    } else {
      // No emitter authored for this weapon class yet: the flat-colour
      // fallback Pixi's own `puffs` stand in with (renderer.ts:811-818),
      // reproduced through the SAME ParticleSystem pool real emitters use
      // rather than a second FX mechanism -- see spawnFlatFx's own doc
      // comment.
      if (type.isSoft) {
        this.spawnFlatFx(mzX, mzY, this.opts.flashColor, 5, 7);
      } else {
        this.spawnFlatFx(mzX, mzY, this.opts.flashColor, 14, 4);
        this.spawnFlatFx(mzX, mzY, this.opts.flashColor, 10, 8);
        this.spawnFlatFx(mzX, mzY, '#6B6355', 7, 18);
      }
    }
  }

  /**
   * The `strike` case, ported from `renderer.ts:833-846`: a scatter of 18
   * puffs around the impact point, positioned by the SAME deterministic
   * per-sample hash Pixi uses (`PixiRenderer.h2`, which `renderer.ts`'s own
   * doc comment says IS `tileHash` -- imported directly here rather than
   * reimplemented, so the two backends scatter identically for the same
   * tick/strike, not merely similarly).
   */
  private onStrike(ex: Fx, ey: Fx, tick: number): void {
    const sx = fx.toNumber(ex);
    const sy = fx.toNumber(ey);
    for (let k = 0; k < 18; k++) {
      const a = tileHash(k * 11 + tick, k * 17 + tick);
      const b = tileHash(k * 23 + tick, k * 5 + tick);
      this.spawnFlatFx(
        sx + (a - 0.5) * 4,
        sy + (b - 0.5) * 4,
        k % 3 === 0 ? this.opts.flashColor : this.opts.nearMissColor,
        10 + a * 14,
        20 + Math.floor(a * 20)
      );
    }
  }

  /**
   * The `tunnelCollapsed` case, ported from `renderer.ts:903-935`: a handful
   * of sample points along the route's length, each spawning the
   * `tunnel_collapse` emitter set (`spawnCollapseFx`) or, if no emitter set
   * is loaded, the same flat-puff fallback structure/tunnel collapse share
   * in Pixi.
   */
  private onTunnelCollapsed(tunnel: number, tick: number): void {
    const len = fx.toNumber(this.sim.tnLength[tunnel]);
    const samples = Math.max(2, Math.min(6, 1 + Math.round(len / 2.5)));
    for (let s = 0; s < samples; s++) {
      const d = fx.from((len * s) / (samples - 1));
      const [px, py] = this.sim.tunnelPointAt(tunnel, d);
      const tx = fx.toNumber(px) + 0.5;
      const ty = fx.toNumber(py) + 0.5;
      if (!this.spawnCollapseFx('tunnel_collapse', tx, ty)) {
        for (let k = 0; k < 4; k++) {
          const a = tileHash(k * 7 + tunnel + s * 5, k * 13 + tick);
          const b = tileHash(k * 31 + tick + s * 17, k * 3 + tunnel);
          this.spawnFlatFx(tx + (a - 0.5) * 2, ty + (b - 0.5) * 2, this.opts.nearMissColor, 8 + a * 8, 22 + Math.floor(a * 12));
        }
      }
    }
  }

  /**
   * A collapse's debris and dust bloom -- `structure_collapse` for a
   * building, `tunnel_collapse` for a route's vent. Invoked from
   * `onTunnelCollapsed` for the latter, and (Task B4.3) directly from
   * `onEvents`'s `structureDestroyed` case for the former -- see that
   * branch's own comment; a destroyed building now throws the same burst
   * a route's vent does, with the same flat-puff fallback. Ported from
   * `renderer.ts:330-342` (`PixiRenderer.spawnCollapseFx`). Returns false
   * when no emitter set is loaded, exactly like Pixi, so the caller can
   * fall back to flat puffs.
   */
  private spawnCollapseFx(id: string, bx: number, by: number): boolean {
    if (!this.particleSystem) return false;
    const em = this.emitterLibrary.byName(id);
    if (!em) return false;
    const prio = em.budget_priority ?? 1;
    for (const layer of em.particles) {
      const fxLayer = fxLayerIndex(em.layer, layer.additive ?? false);
      // Straight up from the footprint centre; the spec's 360-degree cone
      // and the presentation PRNG inside spawn() do the scattering.
      this.particleSystem.spawn(layer, bx, by, 0.25, 1, prio, fxLayer);
    }
    return true;
  }

  /**
   * A single-colour, non-authored puff, routed through the SAME
   * `ParticleSystem` pool and draw path every real emitter uses -- not a
   * second FX mechanism. Pixi's equivalent (`renderer.ts`'s `Puff`
   * interface/array, `this.puffs`) is a flat, FRAME-counted circle drawn
   * directly on a `Graphics`, with its own growth formula (`r * (1.4 -
   * ttl/14)`, `renderer.ts:2605`) that has no equivalent in
   * `ParticleSystem`'s 0..1-normalised, TIME-based curve model.
   * `size_over_life`/`alpha_over_life` below reproduce the SHAPE of that
   * effect (a small puff that grows while it fades) rather than its exact
   * numbers -- an approximation, not a pixel-identical port; see this
   * task's report for why an exact port was not attempted (the two curve
   * models are not commensurable without either changing `ParticleSystem`,
   * which is barred this task, or adding a second, incompatible FX
   * mechanism just for these fallback cases).
   *
   * `lifetimeFrames` matches Pixi's own `ttl` values directly ("frames at a
   * nominal 60Hz", the same convention `tracers.ts`'s own
   * `TRACER_LIFETIME_S` documents) so every call site above can reuse
   * Pixi's literal numbers unchanged rather than re-deriving them.
   *
   * `magnitude` is fixed at `FLAT_FX_MAGNITUDE` so `radiusPx` becomes the
   * drawn radius directly (see that constant's own doc comment); `priority`
   * is `0`, the LOWEST possible -- `ParticleSystem.freeSlot`
   * (`vfx/particles.ts:88-103`) recycles the LOWEST-priority live particle
   * first when the pool is full, so `0` is the one value that guarantees a
   * fallback puff is always the first thing evicted under pool pressure,
   * never an authored emitter's own particle (every shipped emitter's
   * `budget_priority` is >= 1, `fire_small_arms.json`'s own floor). A
   * non-zero priority here would have the OPPOSITE effect from what it
   * reads as: `fire_small_arms` (1) and `fire_hmg` (2) -- the two commonest
   * weapon classes in a firefight -- and both cigarette emitters (1) would
   * all rank BELOW it and be evicted in ITS favour instead. Always spawns
   * on `FX_LAYER_BELOW`, matching Pixi's `puffs` -- they draw on `fxG` (the
   * below layer) unconditionally, never `fxAboveG`.
   */
  private spawnFlatFx(x: number, y: number, color: string, radiusPx: number, lifetimeFrames: number): void {
    if (!this.particleSystem) return;
    const spec: ParticleSpec = {
      count: 1,
      lifetime_ms: (lifetimeFrames / 60) * 1000,
      size_px: radiusPx,
      size_over_life: [0.5, 1.2],
      alpha_over_life: [0.85, 0],
      color_over_life: [color],
    };
    this.particleSystem.spawn(spec, x, y, 0, FLAT_FX_MAGNITUDE, 0, FX_LAYER_BELOW);
  }

  /**
   * Vehicle-only ambient VFX: dust while moving, thin engine exhaust while
   * idle. Three-only, by design -- see `units/vehicle-fx.ts`'s top comment
   * for the full "no Pixi counterpart owed" reasoning, and `vfx/emitters.ts`
   * `byName`'s own doc comment for why an ambient effect like this is
   * dispatched from the renderer's own per-frame read rather than a sim
   * event: idling (and moving) is not an event and must not become one.
   *
   * Called once a frame, straight from `frame()`, over every LIVING entity
   * -- not folded into `updateUnits`/`updateVehicleMeshes` the way a
   * per-draw-path effect might be, because a vehicle's speed and facing
   * (`entitySpeed`, `curX`/`curY`, `state.facing`) are the SAME regardless
   * of which of those two paths currently draws it, and this way there is
   * exactly one place that decides "is this vehicle moving", not one copy
   * per draw path that could disagree. `curX`/`curY` (last-tick exact
   * position), not the frame-interpolated position `updateUnits` computes
   * for its own billboard placement -- matching `TurretSpringInput`'s own
   * documented preference for the same reason: this is a presentation
   * decision that only needs to update once per SIM tick's worth of motion,
   * not resmoothed every render frame.
   *
   * `!type.isSoft` is this file's own established vehicle test (see
   * `onFire`'s "rather than Pixi's `!type.isSoft`" comment above, and
   * `unitOverlayRadiusPx(type.isSoft)` in `updateOverlays`) -- true for
   * every rifle squad, team and demo squad, false for every tank/APC/
   * technical/dozer, so infantry never reaches either spawn call below.
   *
   * Reads only `Sim.state.alive`/`typeIdx`/`facing` (read-only, per
   * invariant 4) plus this class's own presentation arrays. Writes nothing
   * back to `Sim`.
   */
  private updateVehicleAmbientFx(dtMs: number): void {
    if (!this.particleSystem) return;
    const dust = this.emitterLibrary.byName('vehicle_dust');
    const exhaust = this.emitterLibrary.byName('vehicle_exhaust');
    if (!dust && !exhaust) return;

    const st = this.sim.state;
    const n = this.sim.entityCount;

    for (let i = 0; i < n; i++) {
      if (st.alive[i] === 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      if (type.isSoft) continue;

      const speed = this.entitySpeed[i];
      const moving = nextVehicleMoving(this.vehicleMoving[i] === 1, speed);
      this.vehicleMoving[i] = moving ? 1 : 0;
      const facingNorm = fx.toNumber(st.facing[i]);

      if (moving) {
        // Entering (or continuing) motion cancels any exhaust already owed
        // -- the hysteresis in nextVehicleMoving guarantees this branch and
        // the one below are mutually exclusive per entity per frame, so
        // this is strictly resetting a clock the idle branch will not run
        // this frame, not racing it.
        this.vehicleExhaustAccumMs[i] = 0;
        if (!dust) continue;
        this.vehicleDustAccumMs[i] += dtMs;
        if (this.vehicleDustAccumMs[i] < VEHICLE_DUST_INTERVAL_MS) continue;
        this.vehicleDustAccumMs[i] -= VEHICLE_DUST_INTERVAL_MS;

        const anchor = vehicleFxAnchor(this.curX[i], this.curY[i], facingNorm, VEHICLE_DUST_OFFSET_TILES);
        const magnitude = vehicleDustMagnitude(speed);
        const prio = dust.budget_priority ?? 2;
        for (const layer of dust.particles) {
          const fxLayer = fxLayerIndex(dust.layer, layer.additive ?? false);
          this.particleSystem.spawn(layer, anchor.x, anchor.y, anchor.dirTurns, magnitude, prio, fxLayer);
        }
      } else {
        this.vehicleDustAccumMs[i] = 0;
        if (!exhaust) continue;
        this.vehicleExhaustAccumMs[i] += dtMs;
        if (this.vehicleExhaustAccumMs[i] < VEHICLE_EXHAUST_INTERVAL_MS) continue;
        this.vehicleExhaustAccumMs[i] -= VEHICLE_EXHAUST_INTERVAL_MS;

        const anchor = vehicleFxAnchor(this.curX[i], this.curY[i], facingNorm, VEHICLE_EXHAUST_OFFSET_TILES);
        const prio = exhaust.budget_priority ?? 1;
        for (const layer of exhaust.particles) {
          const fxLayer = fxLayerIndex(exhaust.layer, layer.additive ?? false);
          this.particleSystem.spawn(
            layer,
            anchor.x,
            anchor.y,
            anchor.dirTurns,
            VEHICLE_EXHAUST_MAGNITUDE,
            prio,
            fxLayer
          );
        }
      }
    }
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return worldToScreenThree(wx, wy, this.camera, { width: this.width, height: this.height });
  }
  /**
   * Bugfix: `screenToWorldThree` now carries the same elevation correction
   * `PixiRenderer.screenToWorld` has always had (`renderer.ts:951-971`) --
   * this is where that correction's inputs actually come from, exactly the
   * way `unitsInScreenRect` below already threads `this.retained.elevation`/
   * `sim.width`/`sim.height` through for the opposite (world-to-screen)
   * direction. `Renderer.screenToWorld(px, py)`'s own signature is
   * unchanged -- no `lift` parameter reaches this seam, per Phase B2's
   * outcome doc -- the correction lives entirely below it, inside
   * `screenToWorldThree` itself, using data this class already retains.
   */
  screenToWorld(px: number, py: number): { x: number; y: number } {
    return screenToWorldThree(
      px,
      py,
      this.camera,
      { width: this.width, height: this.height },
      this.retained.elevation,
      this.sim.width,
      this.sim.height
    );
  }

  // --- queries. The line is between *inventing* an answer and *reporting the
  //     current state truthfully*, not between "implemented" and "not".
  /**
   * Nearest living, surfaced unit within `radiusTiles` of a world point, or
   * -1. `wx`/`wy` are already world coordinates -- the caller
   * (`main.ts:928`) converts screen to world via `screenToWorld` first, so
   * this is plain arithmetic over `curX`/`curY`, not a projection. See
   * `units/pick.ts`'s own doc comment for the full ruling.
   */
  pickUnit(wx: number, wy: number, radiusTiles = 1.2): number {
    return pickUnitPure(
      wx,
      wy,
      this.curX,
      this.curY,
      this.sim.state.alive,
      this.sim.state.tunnelIn,
      this.sim.entityCount,
      radiusTiles
    );
  }
  /**
   * Task B4.2: a real visibility query, replacing the unconditional `true`
   * B2/B3 shipped ("fog is B4," this class's own top comment used to say).
   * `./fog.ts`'s `isFogVisible` reads `this.fog` -- last written by
   * `recomputeFog`, at Pixi's own 5 Hz cadence -- and returns true only for
   * fog level exactly 2 (in sight right now), matching
   * `PixiRenderer.isVisible` (`renderer.ts:1193-1197`) bit for bit.
   *
   * It matters that this does not throw: `updateHover()` calls it once per
   * living hostile every rAF iteration, so a throw here was a 60 Hz stream of
   * expected errors -- which drowns the diagnostics this backend needs and
   * trains everyone to stop reading the console. `isFogVisible` itself never
   * throws (an off-map query is bounds-checked to `false`), so that
   * guarantee still holds with a real answer behind it.
   */
  isVisible(wx: number, wy: number): boolean {
    return isFogVisible(this.fog, this.sim.width, this.sim.height, wx, wy);
  }
  /**
   * Living units whose projected FEET fall inside a screen-space rect --
   * box-select's answer. A genuine projection question, unlike `pickUnit`
   * above, so it goes through `worldToScreenThree` (via `units/pick.ts`) at
   * each unit's own tile height rather than assuming flat ground. See
   * `units/pick.ts`'s own doc comment for the parity argument against
   * `PixiRenderer.unitsInScreenRect`.
   */
  unitsInScreenRect(x0: number, y0: number, x1: number, y1: number): number[] {
    return unitsInScreenRectPure(
      x0,
      y0,
      x1,
      y1,
      this.curX,
      this.curY,
      this.sim.state.alive,
      this.sim.entityCount,
      this.retained.elevation,
      this.sim.width,
      this.sim.height,
      this.camera,
      { width: this.width, height: this.height }
    );
  }

  // --- world data pushed in. Decor/elevation/emitters are now drawn (or,
  //     for emitters, consumed by objects `updateFx` draws from -- see
  //     `onEvents`'s own doc comment for what still has to happen before a
  //     particle actually appears); the sheet maps and tutorial focus stay
  //     retained only, for B3/B4.
  setElevation(elevation: Uint8Array): void {
    this.retained.elevation = elevation;
    this.terrainDirty = true;
  }
  setDecor(decor: Uint8Array): void {
    this.retained.decor = decor;
    this.terrainDirty = true;
  }
  /**
   * Wires weapon-fire emitters into a real `EmitterLibrary` (indexed by
   * weapon class, mirroring `PixiRenderer.useEmitters`) and constructs a
   * real `ParticleSystem` from the app's `resolve` callback, at the SAME
   * `PARTICLE_CAPACITY` (2048) Pixi's own `ParticleSystem` uses
   * (`renderer.ts:644`) -- one pool, matched, not two independently-guessed
   * ceilings. Both are actually read from now: `emitterLibrary.
   * fireEmitterFor`/`byName` and `particleSystem.spawn` are wired from
   * `onEvents` (Task B3.14), and `particleSystem.step`/both
   * `ParticleInstancer.update` calls already run every frame regardless,
   * from `updateFx` below.
   *
   * `resolve` is wrapped, not passed straight through: `spawnFlatFx` (Task
   * B3.14) feeds ALREADY-RESOLVED hex strings (`this.opts.flashColor` et
   * al., resolved once at `RendererOptions` construction time in `main.ts`)
   * through `ParticleSpec.color_over_life`, and `ParticleSystem.spawn`
   * unconditionally calls `resolve` on every entry of that array
   * (`vfx/particles.ts:125`). The app's real `resolve` (`paletteColor`,
   * `packages/data/src/index.ts`) treats anything that is not a recognised
   * `band.index`/`band.name` palette key as unknown and returns magenta
   * (`#FF00FF`) -- a hex string has no `.` in it and is not a real palette
   * key, so passing one through unwrapped would silently turn every
   * `spawnFlatFx` puff (every fallback muzzle flash, every impact/near-miss/
   * intercept/strike effect) magenta. Hex strings pass straight through
   * here instead; anything else still resolves through the real palette
   * exactly as before -- authored emitters' own `color_over_life` entries
   * (palette keys like `"vfx.fire"`) are unaffected.
   */
  useEmitters(list: EmitterSpec[], resolve: (key: string) => string): void {
    this.emitterLibrary.useEmitters(list);
    const passthroughResolve = (key: string): string => (key.startsWith('#') ? key : resolve(key));
    this.particleSystem = new ParticleSystem(PARTICLE_CAPACITY, passthroughResolve);
  }
  /**
   * Load a unit type's sprite sheet and build the `THREE.InstancedMesh`
   * (`UnitInstancer`) it draws through -- one draw call for however many of
   * this type end up alive, per Ruling 1.
   *
   * Task B3.6: `opts.turretPath`, when given, is now ALSO loaded and built
   * into a second `UnitInstancer` (`turretInstancers`), the same generic
   * `packSheet`/`buildUnitTexture`/`UnitInstancer` pipeline the hull sheet
   * goes through -- a turret sheet is shaped exactly like a hull sheet
   * (`SheetSpec`), so nothing here is turret-specific except which map the
   * result lands in and which mesh the caller (`updateUnits`) later calls
   * `updateTurret` rather than `update` on. `packSheet`/`buildUnitTexture`
   * already pack and load EVERY clip a sheet declares (not merely `idle`),
   * so the gun truck's 16 recoil-frame `fire` clip is loaded here exactly
   * like `idle` is -- there is no separate "load every clip" step to add,
   * unlike the bug `renderer.ts`'s own `loadSprites` comment records
   * needing a fix for.
   *
   * Errors propagate rather than being swallowed: `main.ts` already wraps
   * every `loadSprites` call in its own `.catch` per unit type (so one
   * missing sheet does not stop the rest of the roster from loading), which
   * is exactly Pixi's own failure mode for the identical call. A turret
   * sheet that fails to load fails the WHOLE call (hull included), matching
   * Pixi: `PixiRenderer.loadSprites` `await`s its own turret load inline,
   * with nothing to catch a rejection there either.
   */
  async loadSprites(
    unitTypeId: string,
    basePath: string,
    opts?: { turretPath?: string }
  ): Promise<void> {
    this.retained.unitSheets.set(unitTypeId, { basePath, turretPath: opts?.turretPath });
    const res = await fetch(`${basePath}manifest.json`);
    if (!res.ok) throw new Error(`sheet manifest ${res.status} at ${basePath}`);
    const sheet: SheetSpec = parseManifest(await res.json());
    const packing = packSheet(sheet);
    const texture = await buildUnitTexture(basePath, sheet, packing);
    const instancer = new UnitInstancer(sheet, texture, packing, this.sim.capacity);
    // A re-load (unlikely, but `loadSprites` carries no such guarantee
    // against it) must not leak the mesh/material/texture it replaces.
    const previous = this.unitInstancers.get(unitTypeId);
    if (previous) {
      this.scene.remove(previous.mesh);
      previous.dispose();
    }
    this.unitInstancers.set(unitTypeId, instancer);
    this.scene.add(instancer.mesh);

    if (opts?.turretPath) {
      const turretRes = await fetch(`${opts.turretPath}manifest.json`);
      if (!turretRes.ok) throw new Error(`turret sheet manifest ${turretRes.status} at ${opts.turretPath}`);
      const turretSheet: SheetSpec = parseManifest(await turretRes.json());
      const turretPacking = packSheet(turretSheet);
      const turretTexture = await buildUnitTexture(opts.turretPath, turretSheet, turretPacking);
      const turretInstancer = new UnitInstancer(
        turretSheet,
        turretTexture,
        turretPacking,
        this.sim.capacity,
        // Explicit, tested render-order split (instances.ts's own doc
        // comment) -- draws above its hull at every co-located, identical-
        // depth instance, not merely by construction-order accident.
        TURRET_RENDER_ORDER
      );
      const previousTurret = this.turretInstancers.get(unitTypeId);
      if (previousTurret) {
        this.scene.remove(previousTurret.mesh);
        previousTurret.dispose();
      }
      this.turretInstancers.set(unitTypeId, turretInstancer);
      this.scene.add(turretInstancer.mesh);
    } else {
      // A re-load that DROPS a previously-declared turretPath (not exercised
      // by any real caller today -- `main.ts`'s SPRITE_MAP is static -- but
      // `loadSprites` carries no guarantee against it) must not leave a
      // stale turret mesh drawing for a hull that no longer declares one.
      const stale = this.turretInstancers.get(unitTypeId);
      if (stale) {
        this.scene.remove(stale.mesh);
        stale.dispose();
        this.turretInstancers.delete(unitTypeId);
      }
    }
  }

  /**
   * The mesh-unit flag itself: loads `glbUrl` (`art/meshes/<team_id>.glb`
   * per `mesh-unit-contract.md`), builds a `MeshUnitTemplate`
   * (`units/mesh-unit.ts`), and files it under `unitTypeId`. Additive --
   * nothing calls this today, so unless and until something does, every
   * existing billboard type keeps drawing exactly as before (see
   * `updateUnits`'s own `meshUnitTemplates.has(type.id)` guard).
   *
   * Once loaded, `unitTypeId` draws through `updateMeshUnits` instead of a
   * billboard, regardless of whether `loadSprites` was ALSO called for it --
   * mesh wins. A reload (`loadMeshUnit` called twice for the same type, not
   * exercised by any caller today) disposes the old template's own
   * materials/geometries and tears down every live clone of it first, the
   * same "must not leak the thing it replaces" guarantee `loadSprites`
   * itself gives.
   *
   * Errors propagate rather than being swallowed, matching `loadSprites` and
   * `loadStructureSprite`: a missing or malformed GLB fails loudly, for the
   * one caller (`main.ts`, when something wires this up) to decide how to
   * report it -- exactly the precedent those two methods' own doc comments
   * already set.
   */
  async loadMeshUnit(
    unitTypeId: string,
    glbUrl: string,
    faction: MeshFaction
  ): Promise<void> {
    const template = await loadMeshUnitTemplate(glbUrl, faction);

    const previous = this.meshUnitTemplates.get(unitTypeId);
    if (previous) {
      for (const [id, entity] of this.meshUnitEntities) {
        if (entity.typeId !== unitTypeId) continue;
        this.scene.remove(entity.root);
        disposeMeshUnitEntity(entity);
        this.meshUnitEntities.delete(id);
      }
      disposeMeshUnitTemplate(previous);
    }
    this.meshUnitTemplates.set(unitTypeId, template);
    // Muzzle-flash ramp shift: every material this template's meshes draw
    // through gets pointed at the shared flash-uniform arrays -- see
    // `flashLights`'s own field doc comment. Clones share these materials BY
    // REFERENCE (this file's own doc comment on `MeshUnitTemplate`), so one
    // registration per template covers every living/future clone of it.
    for (const material of template.materials) {
      this.flashLights.register(material as THREE.ShaderMaterial);
    }
  }

  /**
   * Vehicle meshes (mesh-unit-contract v2): loads
   * `art/meshes/vehicles/<id>.glb`, builds a `VehicleMeshTemplate`, and
   * files it under `unitTypeId` -- the rigid counterpart of `loadMeshUnit`
   * above. No `faction` parameter: see `vehicle-mesh-role.ts`'s top comment
   * for why a vehicle GLB is faction-specific by construction and the ramp
   * choice already lives at "which vehicle", not "which side".
   *
   * `unitTypeId` doubles as both the map key AND the vehicle id
   * `vehicle-mesh-role.ts`'s ramp table is keyed by -- the same "team id ==
   * file basename" convention `main.ts`'s own `MESH_TEAMS` comment names for
   * infantry, restated here because a mismatch would resolve a real ramp for
   * the WRONG vehicle rather than failing at all.
   *
   * Once loaded, `unitTypeId` draws through `updateVehicleMeshes` instead of
   * a billboard -- see that method's own doc comment and `updateUnits`'s
   * `vehicleMeshTemplates.has(type.id)` guard for the "mesh wins" rule this
   * shares with `loadMeshUnit`.
   */
  async loadVehicleMesh(unitTypeId: string, glbUrl: string): Promise<void> {
    const template = await loadVehicleMeshTemplate(glbUrl, unitTypeId);

    const previous = this.vehicleMeshTemplates.get(unitTypeId);
    if (previous) {
      for (const [id, entity] of this.vehicleMeshEntities) {
        if (entity.typeId !== unitTypeId) continue;
        this.scene.remove(entity.root);
        this.vehicleMeshEntities.delete(id);
      }
      disposeVehicleMeshTemplate(previous);
    }
    this.vehicleMeshTemplates.set(unitTypeId, template);
    // Muzzle-flash ramp shift -- see `loadMeshUnit`'s identical comment just
    // above; the reasoning is unchanged, only the template kind differs.
    for (const material of template.materials) {
      this.flashLights.register(material as THREE.ShaderMaterial);
    }
  }

  /**
   * Building meshes (mesh-unit-contract v2): loads
   * `art/meshes/buildings/<type>.glb` (and, when `wreckUrl` is given,
   * `<type>_wreck.glb`), builds one or two `BuildingMeshTemplate`s, and
   * files them under `structureId` -- the mesh counterpart of
   * `loadStructureSprite`.
   *
   * `wallColorKey` is looked up here, once, from `Sim.structureTypes` --
   * never from `@lions/data` (this package must not import it) -- and
   * threaded into BOTH templates: idle and wreck share the same building's
   * wall colour (`building-mesh-role.ts`'s own top comment explains why a
   * wrecked wall still wants its own type's stone, not a generic rubble
   * tone). Throws if `structureId` names no known structure type -- there is
   * no wall colour to build a template with, matching every other member in
   * this class that fails loudly rather than fabricating one (this file's
   * own top comment, "Three kinds of not-yet-implemented member").
   *
   * `terrainDirty = true` for the identical reason `loadStructureSprite`
   * sets it: `composeTerrain`'s `hasArt` callback (below, `rebuildTerrain`)
   * must stop drawing this type's procedural box the instant its mesh art
   * is available.
   */
  async loadBuildingMesh(structureId: string, idleUrl: string, wreckUrl: string | null): Promise<void> {
    const structureType = this.sim.structureTypes.find((t) => t.id === structureId);
    if (!structureType) {
      throw new Error(`loadBuildingMesh: unknown structure type "${structureId}"`);
    }
    const wallColorKey = structureType.color;

    const idleTemplate = await loadBuildingMeshTemplate(idleUrl, wallColorKey);
    const previousIdle = this.buildingMeshIdleTemplates.get(structureId);
    if (previousIdle) {
      // `buildingMeshIdleEntities` is keyed by STRUCTURE INDEX, not type --
      // every OTHER mesh-enabled type's clones live in this same map, so a
      // reload must tear down only the entries belonging to THIS type
      // (`sim.structures.typeIdx[s]` resolved back to its own id), not the
      // whole map. Not exercised by any real caller today (`main.ts`'s
      // `MESH_BUILDINGS` is static, loaded once), same caveat
      // `loadMeshUnit`/`loadVehicleMesh` already carry for their own reload
      // paths -- but wrong is wrong whether or not it is reachable yet.
      const st = this.sim.structures;
      for (const [s, root] of this.buildingMeshIdleEntities) {
        if (this.sim.structureTypes[st.typeIdx[s]].id !== structureId) continue;
        this.scene.remove(root);
        this.buildingMeshIdleEntities.delete(s);
      }
      disposeBuildingMeshTemplate(previousIdle);
    }
    this.buildingMeshIdleTemplates.set(structureId, idleTemplate);
    // Muzzle-flash ramp shift -- see `loadMeshUnit`'s identical comment.
    for (const material of idleTemplate.materials) {
      this.flashLights.register(material as THREE.ShaderMaterial);
    }

    if (wreckUrl) {
      const wreckTemplate = await loadBuildingMeshTemplate(wreckUrl, wallColorKey);
      const previousWreck = this.buildingMeshWreckTemplates.get(structureId);
      if (previousWreck) {
        const st = this.sim.structures;
        for (const [s, root] of this.buildingMeshWreckEntities) {
          if (this.sim.structureTypes[st.typeIdx[s]].id !== structureId) continue;
          this.scene.remove(root);
          this.buildingMeshWreckEntities.delete(s);
        }
        disposeBuildingMeshTemplate(previousWreck);
      }
      this.buildingMeshWreckTemplates.set(structureId, wreckTemplate);
      // Muzzle-flash ramp shift -- see `loadMeshUnit`'s identical comment. A
      // wreck can still sit near a live firefight, so it registers too.
      for (const material of wreckTemplate.materials) {
        this.flashLights.register(material as THREE.ShaderMaterial);
      }
    }

    this.terrainDirty = true;
  }

  /**
   * Task C5: how many structures of ONE type -- alive or dead -- the sim
   * holds, right now. `loadStructureSprite` uses this as its capacity bound
   * for that type's `StructureInstancer`(s), rather than `sim.structureCount`
   * (every structure of every type): sizing each of the seven shipped
   * structure types' instancers to the map's TOTAL structure count wasted
   * six types' worth of unused `Float32Array` slots on every type that is
   * not the single most common one. Just as no living-plus-dead unit count
   * of ONE unit type can ever exceed `sim.capacity` (the bound
   * `UnitInstancer` already gets for free), no living-plus-dead structure
   * count of ONE structure type can ever exceed this type's own count --
   * but `Sim` has no per-type structure count to read directly the way it
   * does for units, so this counts by a linear walk instead. Called once per
   * structure type at load time (at most seven times today, per `main.ts`'s
   * `STRUCTURE_SPRITES`), never per frame, so an O(structureCount) scan here
   * costs nothing worth avoiding.
   */
  private structureTypeCapacity(structureId: string): number {
    const st = this.sim.structures;
    let count = 0;
    for (let s = 0; s < this.sim.structureCount; s++) {
      if (this.sim.structureTypes[st.typeIdx[s]].id === structureId) count++;
    }
    return count;
  }

  /**
   * Task B3.7: load a structure type's idle sprite (and its wreck sprite,
   * when the sheet declares one) and build the `StructureInstancer`(s) they
   * draw through. Mirrors `PixiRenderer.loadStructureSprite` (`renderer.ts:
   * 654-668`) in what it fetches and what it derives from the manifest, but
   * builds real GPU objects rather than a single `structureAtlas` entry --
   * `structureIdle`/`structureWreck` (one `InstancedMesh` each) are this
   * backend's equivalent, per Ruling 1 (one draw call per type).
   *
   * `terrainDirty = true` at the end matters here in a way it does not for
   * `loadSprites`: `rebuildTerrain`'s own `composeTerrain` call reads its
   * `hasArt` callback (`this.structureIdle.has(id)`) to decide which
   * structures' tiles `buildBuildings` should skip, so a structure's FIRST
   * successful art load has to trigger a rebuild or its footprint would keep
   * drawing a box underneath (or beside) the sprite this method just added
   * to the scene. A LATER re-load (not exercised by any real caller --
   * `main.ts`'s `STRUCTURE_SPRITES` is static, same as `loadSprites`'s own
   * `SPRITE_MAP`) sets it again harmlessly: `hasArt` would evaluate to the
   * identical result.
   *
   * Errors propagate rather than being swallowed, matching `loadSprites`:
   * `main.ts` already wraps every `loadStructureSprite` call in its own
   * `.catch` per structure type, and a type whose art fails to load simply
   * never gains an entry in `structureIdle` -- `composeTerrain`'s `hasArt`
   * predicate (`this.structureIdle.has(id)`) is exactly "art actually
   * loaded", not "art was attempted", so a failed load correctly keeps the
   * procedural box for that type rather than silently drawing neither a box
   * nor a sprite.
   */
  async loadStructureSprite(structureId: string, basePath: string): Promise<void> {
    this.retained.structureSheets.set(structureId, basePath);
    const res = await fetch(`${basePath}manifest.json`);
    if (!res.ok) throw new Error(`structure manifest ${res.status} at ${basePath}`);
    const spec = parseStructureManifest(await res.json());

    const idleFrame = await loadStructureFrame(basePath, spec.file);
    const idleGeometry = structureBillboardGeometry(spec.scale, idleFrame.width, idleFrame.height);
    // Every structure of THIS TYPE, alive or dead, is a safe capacity bound
    // for either instancer -- `sim.structureCount` (every structure of every
    // type) is already final by now (`main.ts` adds every map structure
    // before kicking off any art load), the same bound reasoning
    // `UnitInstancer` uses for `sim.capacity`. Sized per-type rather than to
    // the flat `sim.structureCount`: seven shipped structure types (Task
    // C5) each allocating the map's TOTAL structure count would waste six
    // types' worth of `Float32Array` slots on every type that is not the
    // single most common one.
    const capacity = this.structureTypeCapacity(structureId);
    const idleInstancer = new StructureInstancer(idleFrame.texture, idleGeometry, capacity);
    const previousIdle = this.structureIdle.get(structureId);
    if (previousIdle) {
      this.scene.remove(previousIdle.mesh);
      previousIdle.dispose();
    }
    this.structureIdle.set(structureId, idleInstancer);
    this.scene.add(idleInstancer.mesh);

    if (spec.wreckFile) {
      const wreckFrame = await loadStructureFrame(basePath, spec.wreckFile);
      const wreckGeometry = structureBillboardGeometry(spec.scale, wreckFrame.width, wreckFrame.height);
      const wreckInstancer = new StructureInstancer(wreckFrame.texture, wreckGeometry, capacity);
      const previousWreck = this.structureWreck.get(structureId);
      if (previousWreck) {
        this.scene.remove(previousWreck.mesh);
        previousWreck.dispose();
      }
      this.structureWreck.set(structureId, wreckInstancer);
      this.scene.add(wreckInstancer.mesh);
    } else {
      // A re-load that DROPS a previously-declared wreckFile (not exercised
      // by any real caller today) must not leave a stale wreck mesh drawing
      // for a type that no longer declares one -- same guard `loadSprites`
      // applies to a dropped `turretPath`.
      const staleWreck = this.structureWreck.get(structureId);
      if (staleWreck) {
        this.scene.remove(staleWreck.mesh);
        staleWreck.dispose();
        this.structureWreck.delete(structureId);
      }
    }

    this.structureRoofArt.set(structureId, { roofTopPx: spec.roofTopPx, badgeTopPx: spec.badgeTopPx });
    // Task B4.4: the exact inputs `collapseBillboardGeometry` needs to build
    // a base-anchored quad matching `idleGeometry` above -- captured once
    // here rather than re-derived at collapse time, since neither `spec` nor
    // `idleFrame` survive past this method.
    this.structureCollapseArt.set(structureId, {
      scale: spec.scale,
      textureWidth: idleFrame.width,
      textureHeight: idleFrame.height,
    });
    this.terrainDirty = true;
  }

  /**
   * A one-shot: a marker blooms at the ordered point and fades -- Pixi's own
   * `this.orderMarkers.push({ x, y, ttl: 80 })` (`renderer.ts`'s
   * `addOrderMarker`). Phase C: `this.orderMarkers` graduates out of the
   * "truthful no-op" bucket this class's own top comment describes --
   * `updateOverlays` (`frame()`) decrements every entry's `ttl` once per
   * call and draws it as a fading crosshair (`orderMarkerSize`, `units/
   * overlays.ts`) until it expires, the identical shape `PixiRenderer.frame`
   * ()`'s own trailing pass uses.
   *
   * Reached from the pointer handler, never from a loop -- but at `main.ts:962`
   * it is NOT the last statement: a throw there skipped `production.setArmed`
   * and left the drag box stuck on screen.
   */
  addOrderMarker(x: number, y: number): void {
    this.orderMarkers.push({ x, y, ttl: ORDER_MARKER_TTL });
  }

  /**
   * The tutorial focus ring is *state*, not a one-shot: set it and it stands
   * until cleared. So it retains, like its siblings above, rather than no-ops.
   *
   * Both halves run inside the 20 Hz tick loop (`main.ts:1233`/`:1238`)
   * whenever a tutorial is active -- which is every fresh-`localStorage` boot
   * of the first mission. Throwing there was the `updateHover` failure again:
   * 20 errors a second, and the tail of that block -- `tut.done`, the
   * completion flag, `runtime.completeObjective` -- never ran, so the tutorial
   * could not finish.
   *
   * Phase C: `updateOverlays` (`frame()`) now reads `this.retained
   * .tutorialFocus` every frame and draws the pulsing ring `renderer.ts`'s
   * own tutorial-focus block does (`g.poly(ringPts, true).stroke(...)`) --
   * the state this method retains was always correct, only nothing consumed
   * it until now.
   */
  setTutorialFocus(x: number, y: number, radius: number): void {
    this.retained.tutorialFocus = { x, y, radius };
  }
  clearTutorialFocus(): void {
    this.retained.tutorialFocus = null;
  }

  private threeCamera(): THREE.OrthographicCamera {
    return dimetricCamera(this.camera, { width: this.width, height: this.height });
  }

  /** Wall-clock seconds since the previous frame, clamped exactly the way
   *  `PixiRenderer.frame()` clamps its own `dtSeconds` (`renderer.ts:1880`):
   *  a 100 ms ceiling so a tab returning from the background catches up in
   *  one bounded step instead of a huge stride. Shared by `updateUnits`
   *  (animation phase advance) and `updateFx` (particle/tracer ageing) so
   *  the two cannot silently clamp differently. */
  private frameDtSeconds(dtMs: number): number {
    return Math.min(dtMs, 100) / 1000;
  }

  /**
   * `curTarget`/`curStructure` -> a world aim point, or `null` for "no live
   * target" -- ported from `renderer.ts:2113-2123`, extracted out of
   * `updateUnits`'s own per-entity loop (Task B3.6) so `updateVehicleMeshes`
   * can resolve the IDENTICAL target for a mesh vehicle's own turret pivot,
   * off the same `curTarget`/`curStructure` read and the same last-tick
   * `curX`/`curY` snapshot -- one implementation, two callers, exactly the
   * "reuse that source, do not invent a second one" the mesh-unit contract's
   * own turret-bearing section asks for.
   */
  private resolveTurretTarget(i: number): { x: number | null; y: number | null } {
    const st = this.sim.state;
    const target = st.curTarget[i];
    const struct = st.curStructure[i];
    const aimAtStructure = target < 0 && struct >= 0 && this.sim.structures.alive[struct] === 1;
    if (target >= 0 && st.alive[target] !== 0) {
      return { x: this.curX[target], y: this.curY[target] };
    }
    if (aimAtStructure) {
      return { x: fx.toNumber(this.sim.structures.cx[struct]), y: fx.toNumber(this.sim.structures.cy[struct]) };
    }
    return { x: null, y: null };
  }

  /**
   * Builds this frame's `EntityFrame` for every living entity whose unit
   * type has a loaded `UnitInstancer`, grouped by type, and hands each
   * group to its instancer's `update`. The per-entity work ported from
   * Pixi's own unit loop (`renderer.ts:1919` onward) is exactly what
   * `entityFrame` (`frame-state.ts`) already decides -- this method's own
   * job is assembling its input from `Sim` and this class's own tracking
   * arrays, nothing more.
   *
   * `assignRoofSlots` runs once, over every entity, before any single one is
   * decided -- `frame-state.ts`'s own doc comment on why: it is a
   * cross-entity pre-pass, not a per-entity decision, "so the spread is
   * stable rather than flickering only because of that ordering."
   *
   * A unit type with no loaded `UnitInstancer` (a sheet still loading, or
   * one that never will) is silently skipped, matching this class's own
   * "no mesh units, no placeholder shape" scope line -- see the class-level
   * doc comment's "What B3.5 deliberately does not draw" section.
   *
   * Task B4.2: a non-player unit is now skipped entirely unless
   * `isVisible()` says the player currently observes its own (interpolated)
   * position -- mirroring `PixiRenderer`'s own unit loop (`renderer.ts:1930-
   * 1934`, "Anyone who isn't ours is only drawn while actually observed --
   * fog hides them, and losing sight loses the contact") for the first time.
   * Before this task `isVisible()` was an unconditional `true`, so this
   * branch was dead code with a guaranteed-true condition; it is live now
   * that `./fog.ts` backs it with real data.
   */
  private updateUnits(alpha: number, dtMs: number): void {
    if (this.unitInstancers.size === 0) return;

    const dtSeconds = this.frameDtSeconds(dtMs);
    const st = this.sim.state;
    const n = this.sim.entityCount;
    const roofSlots = assignRoofSlots(st.garrisonedIn, st.alive, n);

    for (const frames of this.framesByType.values()) frames.length = 0;
    for (const frames of this.turretFramesByType.values()) frames.length = 0;

    for (let i = 0; i < n; i++) {
      if (st.alive[i] === 0) continue;
      const side = st.side[i];
      if (side !== 0) {
        // The INTERPOLATED position -- this frame's actual screen position,
        // not last tick's raw curX/curY -- matching exactly what Pixi's own
        // check tests (`renderer.ts:1930-1934` computes `x`/`y` this same
        // way, from `prevX`/`curX`/`alpha`, before its own `isVisible` call).
        const ix = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
        const iy = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
        if (!this.isVisible(ix, iy)) continue;
      }
      const type = this.sim.unitTypes[st.typeIdx[i]];
      // A type drawn through the mesh-unit path (`updateMeshUnits`, called
      // separately from `frame()`) must not ALSO build a billboard frame for
      // it -- "mesh wins" whenever a GLB is loaded for a type, whether it is
      // the skinned infantry path (`meshUnitTemplates`) or the rigid vehicle
      // one (`vehicleMeshTemplates`, `updateVehicleMeshes`). A type present
      // in neither takes this `continue` never, exactly the "additive,
      // billboard unaffected until something loads a GLB for it" contract
      // both paths share.
      if (this.meshUnitTemplates.has(type.id) || this.vehicleMeshTemplates.has(type.id)) continue;
      const instancer = this.unitInstancers.get(type.id);
      if (!instancer) continue;
      // Task B3.6: absent when this type has no turret art -- doubles as
      // the has-a-turret gate `EntityFrameInput.turretSheet` documents.
      const turretInstancer = this.turretInstancers.get(type.id);

      // Contact-level fade only applies to what is observed through
      // contact; the player's own units (side 0) are always full alpha, and
      // `entityFrame` ignores `contactLevel` for them regardless -- no need
      // to pay for the query.
      const contactLevel = side !== 0 ? this.sim.contactLevel(0, i) : 0;

      const inside = st.garrisonedIn[i];
      let roofPx = 0;
      if (inside >= 0) {
        // Task B3.7: the roof plane, not the top of the art -- and now the
        // sheet's own `roofTopPx`/`badgeTopPx` when this structure type has
        // loaded art, exactly like Pixi's `sArt?.roofTopPx ?? sArt?.badgeTopPx
        // ?? stype.heightPx` (`renderer.ts:1948-1950`). `structureRoofArt` has
        // no entry for a type with no loaded sheet (or one that failed to
        // load), so `resolveRoofPx` falls back to `terrain/buildings.ts`'s
        // own extrusion height, `heightPx`, exactly as this backend's only
        // answer used to be unconditionally. Closes the gap B3.3's review
        // measured (house +2.81, apartment +3.92, mosque +1.79, warehouse
        // +0.94, wall +0.43 world units of unwanted lift) -- see
        // `resolveRoofPx`'s own doc comment in `units/structures.ts`.
        const sType = this.sim.structureTypes[this.sim.structures.typeIdx[inside]];
        roofPx = resolveRoofPx(this.structureRoofArt.get(sType.id), sType.heightPx);
      }

      // Task B3.6: turret aim target -- only computed when this type
      // actually has turret art, the same "no need to pay for the query"
      // precedent `contactLevel` above already follows. `null` means "no
      // live target", and `entityFrame` reads that as "spring back to the
      // hull's own heading" (`EntityFrameInput.turretTargetX`/`turretTargetY`'s
      // own doc comment). Extracted to `resolveTurretTarget` so
      // `updateVehicleMeshes` can resolve the identical target for a mesh
      // vehicle's own turret pivot, off the SAME `curTarget`/`curStructure`
      // read -- one implementation, two callers.
      const turretTarget = turretInstancer ? this.resolveTurretTarget(i) : { x: null, y: null };
      const turretTargetX = turretTarget.x;
      const turretTargetY = turretTarget.y;

      const anim: UnitAnimInput = {
        alive: st.alive[i],
        routed: st.routed[i],
        pinned: st.pinned[i],
        speed: this.entitySpeed[i],
        // Latched by onEvents' `fire` case (Task B3.14), drained once a
        // frame by drainTimers -- mirrors Pixi's own `this.firingTimer[i] >
        // 0` exactly (renderer.ts:2004).
        firing: this.firingTimer[i] > 0,
        working: this.sim.tunnelChargeProgress(i) > 0,
      };

      const input: EntityFrameInput = {
        entityId: i,
        prevX: this.prevX[i],
        prevY: this.prevY[i],
        curX: this.curX[i],
        curY: this.curY[i],
        alpha,
        elevation: this.retained.elevation,
        mapWidth: this.sim.width,
        mapHeight: this.sim.height,
        side,
        contactLevel,
        isAir: type.isAir,
        roofSlot: inside >= 0 ? roofSlots[i] : -1,
        roofPx,
        sheet: instancer.sheet,
        anim,
        dtSeconds,
        entityAnimFrame: this.entityAnimFrame,
        animSeeded: this.animSeeded,
        facing: st.facing[i],
        recoilT: this.recoilT[i],
        recoilDir: this.recoilDir[i],
        recoilPower: this.recoilPower[i],
        flinchT: this.flinchT[i],
        flinchDir: this.flinchDir[i],
        turretSheet: turretInstancer?.sheet ?? null,
        turretTargetX,
        turretTargetY,
        // Latched by onEvents' `fire` case (Task B3.6), independent of the
        // hull's own `firingTimer` above -- see `turretFiringTimer`'s own
        // doc comment for why the two cannot be the same signal.
        turretFiring: this.turretFiringTimer[i] > 0,
        turretFacing: this.turretFacing,
        turretVel: this.turretVel,
        turretSeeded: this.turretSeeded,
      };

      let list = this.framesByType.get(type.id);
      if (!list) {
        list = [];
        this.framesByType.set(type.id, list);
      }
      const frame = entityFrame(input);
      list.push(frame);

      if (turretInstancer) {
        // LIVING only -- `turretFramesByType` deliberately never receives a
        // `stepDeaths` synthetic frame; see this class's own field doc
        // comment on `turretFramesByType` for why.
        let turretList = this.turretFramesByType.get(type.id);
        if (!turretList) {
          turretList = [];
          this.turretFramesByType.set(type.id, turretList);
        }
        turretList.push(frame);
      }
    }

    this.stepDeaths(dtSeconds);

    for (const [typeId, instancer] of this.unitInstancers) {
      instancer.update(this.framesByType.get(typeId) ?? []);
      const turretInstancer = this.turretInstancers.get(typeId);
      if (turretInstancer) {
        turretInstancer.updateTurret(this.turretFramesByType.get(typeId) ?? [], instancer.sheet);
      }
    }
  }

  /**
   * Mesh units: called separately from `frame()`, right after `updateUnits`.
   * A SEPARATE per-entity loop rather than folded into `updateUnits` itself
   * -- `updateUnits` has no headless test coverage of its own (this class's
   * top comment: "`ThreeRenderer` itself has no test file"), and keeping
   * this new, first-cut path in its own method means a bug in it cannot
   * corrupt the billboard loop's own state, and reading either method never
   * requires reading both.
   *
   * Unlike a billboard, whose `EntityFrame` is only computed for a VISIBLE
   * entity (`updateUnits`'s own `isVisible` `continue`, so an out-of-fog
   * hostile is simply never added to that frame's instance buffer), this
   * loop updates position/clip for every LIVING entity of a mesh-enabled
   * type regardless of current fog state, and gates only `root.visible` on
   * it. Skipping the update entirely while fogged would leave the clone
   * frozen at its last-SEEN position; if that stale tile later comes back
   * into view (the player re-scouts it) while the unit itself has moved on,
   * the frozen clone would render as a ghost at a position fog is no longer
   * covering -- a real information leak, not merely a cosmetic gap. Always
   * updating position and gating only visibility avoids that by
   * construction, at the cost of a `Vector3`/`Euler` write for a unit
   * nobody can currently see, which is cheap next to the JS-side skinning
   * `AnimationMixer.update` already does for it every frame regardless.
   *
   * `mixer.update` runs even while `!visible`, deliberately: it keeps the
   * clip's phase advancing so a unit that re-enters fog resumes mid-stride
   * rather than snapping back to frame zero, and three.js's own render
   * traversal already skips an invisible object's draw call for free, so
   * this costs nothing beyond the CPU-side interpolation already paid.
   */
  private updateMeshUnits(alpha: number, dtMs: number): void {
    if (this.meshUnitTemplates.size === 0) return;

    const dtSeconds = this.frameDtSeconds(dtMs);
    const st = this.sim.state;
    const n = this.sim.entityCount;

    for (let i = 0; i < n; i++) {
      if (st.alive[i] === 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      const template = this.meshUnitTemplates.get(type.id);
      if (!template) continue;

      let entity = this.meshUnitEntities.get(i);
      if (!entity) {
        entity = instantiateMeshUnit(template, type.id);
        this.meshUnitEntities.set(i, entity);
        this.scene.add(entity.root);
      }

      const wx = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      const wy = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
      const worldY = groundWorldY(this.retained.elevation, this.sim.width, this.sim.height, wx, wy);
      entity.root.position.set(wx, worldY, wy);
      entity.root.rotation.y = meshYawFromFacing(fx.toNumber(st.facing[i]));
      // Side 0 (the player's own) is always drawn, matching `entityFrame`'s
      // own `contactLevel` short-circuit for it -- everything else defers to
      // real fog-of-war, exactly like `updateUnits`'s own `isVisible` gate.
      entity.root.visible = st.side[i] === 0 || this.isVisible(wx, wy);

      const anim: UnitAnimInput = {
        alive: st.alive[i],
        routed: st.routed[i],
        pinned: st.pinned[i],
        speed: this.entitySpeed[i],
        firing: this.firingTimer[i] > 0,
        working: this.sim.tunnelChargeProgress(i) > 0,
      };
      applyMeshClip(entity, resolveClip(anim));
      entity.mixer.update(dtSeconds);
    }

    // Hand off entities no longer alive to the death sequence instead of
    // tearing them down on the spot -- `units/mesh-death.ts`'s own top
    // comment is the full account of what that buys (a fade, a `down` pose,
    // and wreck persistence where a GLB has one). Not gated on
    // `seen`/visibility this frame -- see this method's own top comment on
    // why a fogged unit stays instantiated (and simply invisible) rather
    // than being torn down and rebuilt on every fog flicker; the same
    // applies to a unit that dies while fogged, which still gets its full
    // fade (`beginMeshDeath` reads `entity.root.position.y` as-is, whatever
    // it last was). `meshUnitEntities.delete(id)` runs in the SAME step as
    // `beginMeshDeath`, before the entity is reachable any other way, so a
    // later spawn reusing this id can never alias the dying entity --
    // `beginMeshDeath`'s own doc comment spells out why that makes this
    // safe with no captured x/y/facing/typeId at all, unlike Pixi's
    // `DyingUnit`.
    for (const [id, entity] of this.meshUnitEntities) {
      if (id < n && st.alive[id] !== 0) continue;
      this.meshUnitEntities.delete(id);
      this.meshDying.push(beginMeshDeath(entity));
    }
    this.stepMeshDeaths(dtSeconds);
  }

  /**
   * Vehicle meshes: called separately from `frame()`, alongside
   * `updateMeshUnits` -- its own separate method for the identical reason
   * that one is its own method rather than folded into `updateUnits`
   * (`updateMeshUnits`'s own doc comment: no headless test coverage of
   * `updateUnits` itself, and a bug here must not be able to corrupt the
   * billboard loop's state).
   *
   * Position and hull yaw are set every frame for every LIVING entity of a
   * vehicle-mesh-enabled type, gated only on `root.visible` -- the identical
   * "never freeze a fogged unit's position, or a later re-scout reads as a
   * ghost" reasoning `updateMeshUnits`'s own top comment gives for infantry,
   * unchanged here.
   *
   * Turret bearing is the payoff this method exists for: `stepTurretFacing`
   * (`frame-state.ts`) is the SAME function, driven off the SAME persisted
   * `turretFacing`/`turretVel`/`turretSeeded` arrays, a turreted BILLBOARD
   * vehicle's own `entityFrame` call already uses -- see that function's own
   * doc comment, "reuse that source; do not invent a second one." Because
   * `updateUnits` skips a vehicle-mesh-enabled type entirely (the "mesh
   * wins" guard), this method is the only place the spring advances for such
   * an entity; `resolveTurretTarget` is the identical target-resolution
   * `updateUnits` itself calls, so a mesh vehicle's turret tracks exactly
   * what a billboard one would have.
   *
   * A vehicle with no `turretPivot` (`dozer_d9` today) simply never reads
   * `turretFacing` at all -- there is no pivot node to rotate.
   *
   * Death: immediate removal, no fade. Every shipped vehicle GLB carries
   * zero animations, so there is no `down`/`wreck` pose for a fade to hold
   * -- seen and accepted as a known gap in this task's own report, not
   * silently dropped.
   */
  private updateVehicleMeshes(alpha: number, dtMs: number): void {
    if (this.vehicleMeshTemplates.size === 0) return;

    const dtSeconds = this.frameDtSeconds(dtMs);
    const st = this.sim.state;
    const n = this.sim.entityCount;

    for (let i = 0; i < n; i++) {
      if (st.alive[i] === 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      const template = this.vehicleMeshTemplates.get(type.id);
      if (!template) continue;

      let entity = this.vehicleMeshEntities.get(i);
      if (!entity) {
        entity = instantiateVehicleMesh(template, type.id);
        this.vehicleMeshEntities.set(i, entity);
        this.scene.add(entity.root);
      }

      let wx = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      let wy = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
      // Ground height is sampled from the un-recoiled position, exactly like
      // `entityFrame`'s own recoil block on the billboard path -- recoil
      // travels at most a few hundredths of a tile, so re-sampling terrain
      // height from the offset position could only ever matter exactly at a
      // terrace edge, and neither path attempts it there.
      const worldY = groundWorldY(this.retained.elevation, this.sim.width, this.sim.height, wx, wy);
      const facingNorm = fx.toNumber(st.facing[i]);

      // Hull recoil: a genuine world-space shove opposite the bearing the
      // shot was fired along, easing out over `RECOIL_SECONDS` -- see
      // `MESH_HULL_RECOIL_TILES`'s own doc comment for units and scaling.
      // `recoilT`/`recoilDir`/`recoilPower` are drained/latched once a frame
      // by `drainTimers`/`onFire`, identically to the billboard path; this is
      // simply the first reader of them for a mesh-enabled type.
      let hullPitch = 0;
      if (this.recoilT[i] > 0) {
        const k = this.recoilT[i] * this.recoilT[i]; // ease-out: hardest at the shot
        const power = this.recoilPower[i];
        const kick = MESH_HULL_RECOIL_TILES * power * k;
        const a = this.recoilDir[i] * Math.PI * 2;
        // Game (x, y) maps directly onto world (X, Z) for this backend
        // (`EntityFrame`'s own top comment) -- no `screenOffsetToWorld`
        // detour needed, unlike the billboard path, which only ever had a
        // screen-space nudge to offset.
        wx -= Math.cos(a) * kick;
        wy -= Math.sin(a) * kick;
        hullPitch = MESH_HULL_PITCH_RAD * power * k;
      }
      entity.root.position.set(wx, worldY, wy);
      // XYZ Euler order composes local X (pitch) before Y (yaw) -- see
      // `MESH_HULL_PITCH_RAD`'s own doc comment for why that makes this a
      // local-frame pitch rather than a world-axis tilt.
      entity.root.rotation.x = hullPitch;
      entity.root.rotation.y = meshYawFromFacing(facingNorm);
      entity.root.visible = st.side[i] === 0 || this.isVisible(wx, wy);

      if (entity.turretPivot) {
        const target = this.resolveTurretTarget(i);
        const turretFacingOut = stepTurretFacing({
          entityId: i,
          facingNorm,
          curX: this.curX[i],
          curY: this.curY[i],
          targetX: target.x,
          targetY: target.y,
          dtSeconds,
          turretFacing: this.turretFacing,
          turretVel: this.turretVel,
          turretSeeded: this.turretSeeded,
        });
        // The pivot is a CHILD of `entity.root` (a scene-root sibling of the
        // hull meshes, per `mesh-vehicle.ts`'s own top comment), so
        // `entity.root.rotation.y` already carries the hull's own yaw --
        // this local rotation only has to cover the DELTA between the
        // turret's absolute bearing and the hull's, exactly like
        // `meshYawFromFacing`'s own derivation applied to that delta turn.
        const deltaYaw = meshYawFromFacing(turretFacingOut) - meshYawFromFacing(facingNorm);
        entity.turretPivot.rotation.y = deltaYaw;

        // Turret kick: the barrel recedes along whatever bearing it is
        // CURRENTLY aimed at (`deltaYaw`, root-local), independent of the
        // hull's own shove above -- this is what actually sells a main gun
        // firing, per this task's own brief ("You have a real turret pivot
        // to work with too... which is what actually sells it"). Offset from
        // `turretPivotBase` (the pivot's own AUTHORED rest position),
        // never overwritten outright -- see that field's own doc comment.
        if (entity.turretPivotBase) {
          if (this.recoilT[i] > 0) {
            const k = this.recoilT[i] * this.recoilT[i];
            const kickLocal = MESH_TURRET_RECOIL_TILES * MESH_UNITS_PER_TILE * this.recoilPower[i] * k;
            // Rest pose faces local +X (mesh-unit-contract.md), rotated by
            // this pivot's own current `deltaYaw` -- the identical
            // `makeRotationY` derivation `meshYawFromFacing`'s own doc
            // comment already works out: local +X -> (cos θ, 0, -sin θ).
            // "Backward" is the negation of that.
            entity.turretPivot.position.set(
              entity.turretPivotBase.x - Math.cos(deltaYaw) * kickLocal,
              entity.turretPivotBase.y,
              entity.turretPivotBase.z + Math.sin(deltaYaw) * kickLocal
            );
          } else {
            entity.turretPivot.position.copy(entity.turretPivotBase);
          }
        }
      }
    }

    // Immediate removal on death -- see this method's own doc comment for
    // why there is no fade/wreck sequence to hand off to, unlike
    // `updateMeshUnits`'s `beginMeshDeath`.
    for (const [id, entity] of this.vehicleMeshEntities) {
      if (id < n && st.alive[id] !== 0) continue;
      this.scene.remove(entity.root);
      this.vehicleMeshEntities.delete(id);
    }
  }

  /**
   * Building meshes: called separately from `frame()`, alongside
   * `updateStructures`. Unlike every unit path above, a building mesh clone
   * is positioned exactly ONCE, at creation -- a structure's footprint never
   * moves and a building never turns (mesh-unit-contract.md: "rigid and
   * never turns... no pivot"), so there is no per-frame transform to redo.
   * What this method actually does every frame is the idle<->wreck SWAP,
   * mirroring `updateStructures`'s own per-frame poll of live `Sim` state
   * for the identical reason that method's own doc comment gives: structure
   * death is not (yet) wired through `onEvents` the way unit death is, so
   * polling `st.alive` is still the source of truth for "did this one just
   * die".
   *
   * One pass over `sim.structureCount`, not one pass per mesh-enabled type
   * (`updateStructures`'s own O(types x structureCount) shape) -- there is
   * no per-type instance BUFFER to write here, only a plain `Map` lookup per
   * structure, so folding every type into a single scan costs nothing extra.
   */
  private updateBuildingMeshes(): void {
    if (this.buildingMeshIdleTemplates.size === 0) return;
    const st = this.sim.structures;
    const elevation = this.retained.elevation;

    for (let s = 0; s < this.sim.structureCount; s++) {
      const type = this.sim.structureTypes[st.typeIdx[s]];
      const idleTemplate = this.buildingMeshIdleTemplates.get(type.id);
      if (!idleTemplate) continue; // this structure type has no mesh loaded

      const alive = st.alive[s] === 1;
      if (alive) {
        if (!this.buildingMeshIdleEntities.has(s)) {
          const root = instantiateBuildingMesh(idleTemplate);
          const { fx: cx, fy: cy } = footprintCentre(this.sim, s);
          const worldY = groundWorldY(elevation, this.sim.width, this.sim.height, cx, cy);
          root.position.set(cx, worldY, cy);
          this.buildingMeshIdleEntities.set(s, root);
          this.scene.add(root);
        }
        // A structure that somehow re-gains `alive` after being wrecked is
        // not a real case today (structures never heal), but tearing down a
        // stale wreck clone here keeps this method correct if that changes.
        const staleWreck = this.buildingMeshWreckEntities.get(s);
        if (staleWreck) {
          this.scene.remove(staleWreck);
          this.buildingMeshWreckEntities.delete(s);
        }
        continue;
      }

      // Dead: drop the idle clone, and stand up the wreck one if this type
      // loaded a wreck template.
      const idleEntity = this.buildingMeshIdleEntities.get(s);
      if (idleEntity) {
        this.scene.remove(idleEntity);
        this.buildingMeshIdleEntities.delete(s);
      }
      const wreckTemplate = this.buildingMeshWreckTemplates.get(type.id);
      if (wreckTemplate && !this.buildingMeshWreckEntities.has(s)) {
        const root = instantiateBuildingMesh(wreckTemplate);
        const { fx: cx, fy: cy } = footprintCentre(this.sim, s);
        const worldY = groundWorldY(elevation, this.sim.width, this.sim.height, cx, cy);
        root.position.set(cx, worldY, cy);
        this.buildingMeshWreckEntities.set(s, root);
        this.scene.add(root);
      }
    }
  }

  /**
   * Advances every mesh unit mid-death-fade (`units/mesh-death.ts`'s own
   * `stepMeshDeath`) and reveals any newly-explored permanent wreck
   * (`updateMeshWrecks`). All GPU-facing state lives in `mesh-death.ts`,
   * exercisable with a real `THREE.Scene` and no `WebGLRenderer` -- this
   * method is the thin, `ThreeRenderer`-private glue: three bookkeeping
   * arrays (`meshDying`, `meshWrecks`) and the `isExplored` fog query
   * neither can reach on its own.
   */
  private stepMeshDeaths(dtSeconds: number): void {
    const env: MeshDeathEnv = {
      scene: this.scene,
      elevation: this.retained.elevation,
      width: this.sim.width,
      height: this.sim.height,
      isExplored: (x, y) => this.isExplored(x, y),
    };
    for (let k = this.meshDying.length - 1; k >= 0; k--) {
      const result = stepMeshDeath(this.meshDying[k], dtSeconds, env);
      if (result === 'fading') continue;
      this.meshDying.splice(k, 1);
      if (result !== 'removed') pushMeshWreck(this.meshWrecks, result, this.scene);
    }
    updateMeshWrecks(this.meshWrecks, (x, y) => this.isExplored(x, y));
  }

  /**
   * "Ever seen", not "currently seen" -- `PixiRenderer.isExplored`
   * (`renderer.ts:1200-1206`)'s own distinction, level >= 1 rather than
   * `isVisible`'s level === 2. A small, deliberate duplicate of
   * `isVisible`'s bounds check (`./fog.ts`'s `isFogVisible` only exposes
   * the `=== 2` threshold, and the mesh-death task's own file ownership did
   * not extend to `fog.ts`) rather than a shared helper -- the two thresholds differ
   * by one comparison operator. Originally named `isMeshTileExplored`
   * (`mesh-wreck` fog-gating was its only caller) and generalised here: the
   * billboard-path permanent wreck (`UnitWreck`/`addWreck`/`stepDeaths`)
   * needs the identical "ever seen" reading Pixi's own `isExplored`
   * (`renderer.ts:1200-1206`) gates its `wrecks`/`wreckLayer` on, and
   * duplicating this method a second time for that caller would be the
   * exact "two sources of the same state agreeing only by construction"
   * this backend's own doc comments elsewhere warn against.
   */
  private isExplored(wx: number, wy: number): boolean {
    const x = wx | 0;
    const y = wy | 0;
    if (x < 0 || y < 0 || x >= this.sim.width || y >= this.sim.height) return false;
    return this.fog[y * this.sim.width + x] >= 1;
  }

  /**
   * Advances every unit mid-death-fade and, while still fading, appends a
   * synthetic `EntityFrame` for it into `framesByType` -- so the SAME
   * `UnitInstancer` a living unit of that type draws through also draws its
   * corpse, no separate mesh needed. Ported from Pixi's `stepDeaths`
   * (`renderer.ts:1230-1275`), NOW INCLUDING the permanent-wreckage half
   * (`unitWreckMissingInThree`, `tools/src/golden-diff/expected-differences.ts`
   * -- catalogued as a real defect, not a deliberate divergence, since this
   * method's own doc comment used to name the gap outright).
   *
   * Facing and `typeId` are captured at the moment of death (`onEvents`'s
   * `destroyed` case), not read live off `Sim` here, because the entity slot
   * may be reused by a later spawn before the fade finishes -- Pixi's own
   * comment on its `dying.push`, ported verbatim in spirit.
   *
   * One thing Pixi does that this method still deliberately does NOT:
   * **rotation and squash** (`spr.rotation = p * 0.14`, the scale-Y settle).
   * `writeUnitInstances`/`UnitInstancer` (out of bounds for this task, same
   * as the fade's own) only ever TRANSLATE an instance -- there is no
   * rotation or non-uniform-scale attribute to write into, and adding one
   * would mean editing a forbidden file. The fade keeps the alpha dim and a
   * small downward `worldY` settle (below) but the body does not tip over.
   *
   * **Permanent wreckage, ported now**: once a fade closes (`d.t >=
   * DEATH_SECONDS`), `addWreck` below pushes a `UnitWreck` -- Pixi's own
   * `addWreck`/`wreckLayer`/`MAX_WRECKS` (`renderer.ts:1211`,
   * `:1277-1295`). The loop at the TOP of this method (before the fade loop,
   * mirroring Pixi's own ordering: `stepDeaths`'s wreck-reveal pass runs
   * before its fade pass in `renderer.ts` too) does two things per wreck,
   * per frame: (1) latches `shown` true once `isExplored` says yes -- "you
   * never witness a kill you did not observe, but a burnt-out position you
   * HAVE seen stays on the map after the fog closes over it"
   * (`renderer.ts:1224-1228`), and (2) for a `shown` wreck whose type has a
   * REAL `wreck` clip (`clipOrFallback(sheet, 'wreck') === 'wreck'`, not a
   * fallback to idle), appends a second synthetic `EntityFrame` -- alpha 1,
   * clip `'wreck'` -- into the SAME `framesByType` list the fade above
   * already writes into, so it draws through the identical `UnitInstancer`.
   * A `shown` wreck whose type has NO real `wreck` clip (`mbt_lavi`'s
   * `TNK_HULL`/`TNK_TURR` among them -- see `UnitWreck`'s own doc comment)
   * draws NOTHING here: `updateOverlays`'s own fallback covers it instead,
   * Pixi's identical split (`!wk.spr` -> the grey cross-marker, drawn into
   * `unitsG` rather than `wreckLayer` -- `renderer.ts:1236-1242`).
   *
   * A unit type with no loaded `UnitInstancer` is silently skipped for BOTH
   * the fade and the wreck, matching this class's own "no mesh units" scope
   * line -- and, since that also governs `updateUnits`'s own early return, a
   * dying entry's timer only advances while at least one sheet is loaded; a
   * mission where every unit dies before any sheet finishes loading is the
   * one case that stalls it, and it stalls harmlessly (nothing would have
   * been visible to fade or wreck regardless).
   */
  private stepDeaths(dtSeconds: number): void {
    // Permanent wreckage: reveal, then draw real art where this type has
    // any -- see this method's own top comment for the fog-gate and the
    // real-art-vs-cross-marker split. A mesh-enabled type (`&mesh`) is
    // skipped here entirely: `addWreck` below never pushes one, because
    // `mesh-death.ts`'s own `MeshWreck` already owns that type's wreckage
    // end to end, and every unit type's billboard sheet is ALSO loaded
    // unconditionally (`main.ts`'s `SPRITE_MAP` loop has no `&mesh` branch),
    // so without that exclusion a mesh unit with a billboard `wreck` clip
    // (`inf_squad`'s `INF_SQUAD` sheet among them) would draw a second,
    // redundant wreck underneath its own mesh one.
    for (const wk of this.wrecks) {
      if (!wk.shown && this.isExplored(wk.x, wk.y)) wk.shown = true;
      if (!wk.shown) continue;
      const instancer = this.unitInstancers.get(wk.typeId);
      if (!instancer || clipOrFallback(instancer.sheet, 'wreck') !== 'wreck') continue;
      const worldY = groundWorldY(this.retained.elevation, this.sim.width, this.sim.height, wk.x, wk.y);
      const frame: EntityFrame = {
        wx: wk.x,
        wy: wk.y,
        worldY,
        clip: 'wreck',
        frame: 0,
        facing: wk.facing,
        // Wreckage draws at full opacity, matching Pixi's own `addWreck`,
        // which never touches `spr.alpha` (`renderer.ts:1283`).
        alpha: 1,
        roofDx: 0,
        roofDy: 0,
        visible: true,
        turretFacing: wk.facing,
        turretClip: 'idle',
        turretFrame: 0,
      };
      let wreckList = this.framesByType.get(wk.typeId);
      if (!wreckList) {
        wreckList = [];
        this.framesByType.set(wk.typeId, wreckList);
      }
      wreckList.push(frame);
    }

    for (let k = this.dying.length - 1; k >= 0; k--) {
      const d = this.dying[k];
      d.t += dtSeconds;
      const p = Math.min(1, d.t / DEATH_SECONDS);
      const instancer = this.unitInstancers.get(d.typeId);
      if (instancer) {
        const clip = clipOrFallback(instancer.sheet, 'down');
        // Sink slightly as it settles -- Pixi's own `isoY(...) + p * 3`
        // (renderer.ts:1263), reproduced as a small downward WORLD-height
        // settle rather than a screen-space nudge, since there is no
        // post-projection position here to nudge (the same reasoning
        // `frame-state.ts`'s recoil/flinch doc comment gives, in reverse:
        // there it is a screen delta converted to world; here Pixi's own
        // "sink into the ground" reads most naturally as a real height
        // change, not a lateral one).
        const worldY =
          groundWorldY(this.retained.elevation, this.sim.width, this.sim.height, d.x, d.y) -
          p * 3 * WORLD_Y_PER_LIFT_PIXEL;
        const frame: EntityFrame = {
          wx: d.x,
          wy: d.y,
          worldY,
          clip,
          frame: 0,
          facing: d.facing,
          // Fades toward half, never to nothing -- matches Pixi's own
          // `1 - p * 0.5` (renderer.ts:1264) exactly.
          alpha: 1 - p * 0.5,
          roofDx: 0,
          roofDy: 0,
          visible: true,
          // Task B3.6: never drawn -- this synthetic frame only ever
          // reaches `framesByType` (the hull mesh), never
          // `turretFramesByType`, matching Pixi's own `stepDeaths`, which
          // draws no turret sprite for a dying unit at all (see
          // `turretFramesByType`'s own field doc comment). Still a
          // well-defined value rather than a sentinel, per `EntityFrame
          // .turretFacing`'s own contract.
          turretFacing: d.facing,
          turretClip: 'idle',
          turretFrame: 0,
        };
        let list = this.framesByType.get(d.typeId);
        if (!list) {
          list = [];
          this.framesByType.set(d.typeId, list);
        }
        list.push(frame);
      }
      if (d.t >= DEATH_SECONDS) {
        this.dying.splice(k, 1);
        this.addWreck(d.x, d.y, d.facing, d.typeId);
      }
    }
  }

  /**
   * Pushes a permanent `UnitWreck` once a dying unit's fade finishes --
   * Pixi's own `addWreck` (`renderer.ts:1278-1295`). Pushed unconditionally,
   * whether or not this type's sheet declares a real `wreck` clip: which
   * draw path (if any) the entry takes is resolved every frame by
   * `stepDeaths`'s own wreck loop, not at push time -- the identical split
   * Pixi's own nullable `spr` field encodes (see `UnitWreck`'s own doc
   * comment).
   *
   * Skips a mesh-enabled type entirely (`meshUnitTemplates.has(typeId)`):
   * `mesh-death.ts`'s own `MeshWreck` system already owns that type's
   * permanent wreckage end to end (`stepMeshDeaths` above), and every unit
   * type's billboard sheet is loaded unconditionally regardless of `&mesh`
   * (`main.ts`'s `SPRITE_MAP` loop) -- without this exclusion a mesh unit
   * whose billboard sheet ALSO declares a `wreck` clip would draw a second,
   * redundant wreck underneath its own mesh one. Pixi has no such case to
   * exclude: it has no mesh path at all, so every destroyed entity there is
   * a billboard one by construction.
   */
  private addWreck(x: number, y: number, facing: number, typeId: string): void {
    if (this.meshUnitTemplates.has(typeId)) return;
    this.wrecks.push({ x, y, facing, typeId, shown: this.isExplored(x, y) });
    while (this.wrecks.length > MAX_UNIT_WRECKS) this.wrecks.shift();
  }

  /**
   * Task B3.13/B3.14: ages and draws every live particle and tracer, every
   * frame, unconditionally -- mirrors `PixiRenderer.frame()`'s own `if
   * (this.particles) this.particles.step(dtSeconds)` (`renderer.ts:1902`)
   * plus its end-of-frame tracer step+draw (`renderer.ts:2597-2613`). Pixi's
   * `puffs` fallback path is NOT missing here -- Task B3.14's `spawnFlatFx`
   * (called from `onEvents`, above) routes the equivalent flat-colour
   * effects through this SAME `particleSystem`, so `updateFx` ages and draws
   * them exactly like any authored emitter's particles, with no separate
   * step of its own.
   *
   * `particleSystem` is `null` until `useEmitters` runs -- both
   * `ParticleInstancer.update` calls already handle that truthfully (see
   * their own doc comment), so there is nothing to guard here. `tracers`
   * needs no such guard: `stepTracers` (`units/tracers.ts`) is total over an
   * empty array.
   *
   * Called after `updateUnits`, but the ORDER between the two calls does not
   * matter for what ends up on screen -- NOT because three.js sorts by true
   * proximity (an earlier version of this comment claimed that; it does not:
   * every mesh here sits at its own untransformed origin, so three.js's
   * transparent-list sort ties on `z` for all of them and falls through to
   * `renderOrder` then insertion `id`). It does not matter because
   * `units/fx.ts`'s three FX meshes (Task B3.14 split the former two-mesh
   * pair into three -- see its own top comment, "The `above_units` split")
   * are each given an explicit `renderOrder` strictly above every unit
   * mesh -- hull AND turret alike, per the band table in `units/
   * render-order.ts` -- a declared choice ("FX draws after every unit"), not
   * a rediscovery of depth. `units/fx.ts`'s own top comment has the full
   * account, including the fix this replaced: without that explicit
   * `renderOrder`, FX-vs-unit draw order was an ACCIDENT of which class's
   * constructor three.js happened to run first, not a design. Occlusion
   * against terrain/buildings, for the below-tier particle mesh and for
   * tracers, is unaffected by any of this -- that still comes from real
   * `depthTest` against opaque, depth-writing geometry, independent of
   * `renderOrder` or of FX's own `depthWrite` (`false` for every FX
   * material, unlike units' `true`). The above-tier particle mesh
   * deliberately skips `depthTest` altogether -- see `units/fx.ts` for the
   * full reasoning on both counts.
   */
  private updateFx(dtMs: number): void {
    const dtSeconds = this.frameDtSeconds(dtMs);
    this.particleSystem?.step(dtSeconds);
    const elevation = this.retained.elevation;
    this.particleInstancerBelow.update(this.particleSystem, elevation, this.sim.width, this.sim.height);
    this.particleInstancerAbove.update(this.particleSystem, elevation, this.sim.width, this.sim.height);
    this.particleInstancerBelowAdditive.update(this.particleSystem, elevation, this.sim.width, this.sim.height);
    this.particleInstancerAboveAdditive.update(this.particleSystem, elevation, this.sim.width, this.sim.height);
    this.tracers = stepTracers(this.tracers, dtSeconds);
    this.tracerBatch.update(this.tracers, this.opts.tracerColors, elevation, this.sim.width, this.sim.height);
  }

  /** `this.opts.resolveColor(key)` if the app supplied one, `fallback`
   *  otherwise -- the identical optional-resolver shape `renderer.ts`'s own
   *  handful of `resolveColor`-through-a-ring-colour call sites already use
   *  (e.g. its tutorial-focus-ring block, `this.opts.resolveColor ? this
   *  .opts.resolveColor('vfx.tracer') : '#B8FF5A'`), not a new pattern. */
  private overlayColor(key: string, fallback: string): string {
    return this.opts.resolveColor ? this.opts.resolveColor(key) : fallback;
  }

  /**
   * Phase C: every unit overlay named in the task brief's own "Scope" list
   * -- selection rings, HP bars, suppression bars, control-group badges,
   * the garrison hover highlight, order markers, and the tutorial focus
   * ring. Ported from `renderer.ts`'s single per-entity unit loop
   * (`renderer.ts:1898` onward) and its trailing per-frame passes, in the
   * same relative order those appear there, so a reader diffing the two can
   * follow along section by section.
   *
   * A SEPARATE per-entity loop from `updateUnits`, deliberately, rather than
   * folded into it: `updateUnits` skips a mesh-unit-typed entity outright
   * (`meshUnitTemplates.has(type.id)` `continue`, before it ever builds an
   * `EntityFrame`) because that type draws through `updateMeshUnits`
   * instead -- but Pixi draws an HP bar/selection ring for EVERY alive,
   * visible unit regardless of which draw path its body takes, and so does
   * this method. Folding overlay computation into `updateUnits`'s own loop
   * would silently drop overlays for exactly the units `?sandbox&mesh`
   * exists to exercise.
   *
   * `frameN` increments once per call, mirroring `PixiRenderer.frameN`
   * (`renderer.ts`'s own `this.frameN++`, top of `frame()`) -- every pulsing
   * overlay below (`Math.sin(this.frameN * k)`) reads it exactly the way
   * Pixi's own do.
   */
  private updateOverlays(alpha: number): void {
    this.frameN++;
    this.overlayBatch.beginFrame();
    this.numeralBatch.beginFrame();

    const st = this.sim.state;
    const n = this.sim.entityCount;
    const elevation = this.retained.elevation;
    const width = this.sim.width;
    const height = this.sim.height;

    for (let i = 0; i < n; i++) {
      if (st.alive[i] === 0) continue;
      const side = st.side[i];
      const ix = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      const iy = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
      // Anyone who isn't ours draws only while actually observed -- the
      // identical fog gate `updateUnits`'s own per-entity loop applies
      // (that method's own top comment, "Task B4.2: a non-player unit is
      // now skipped..."), ported here separately because this loop is
      // separate (see this method's own top comment for why).
      if (side !== 0 && !this.isVisible(ix, iy)) continue;

      const type = this.sim.unitTypes[st.typeIdx[i]];
      const r = unitOverlayRadiusPx(type.isSoft);

      // Ground/garrison lift: the same two facts `updateUnits` folds into
      // `EntityFrameInput`'s `roofPx` (`resolveRoofPx`, that method's own
      // "garrison roof placement" section) -- recomputed here rather than
      // read back from `EntityFrame` because that struct carries no entity
      // id to re-associate it with (`frame-state.ts`'s own `EntityFrame`
      // has no `entityId` field), and because a mesh-unit-typed entity, per
      // this method's own top comment, never gets one built at all.
      let groundY = groundWorldY(elevation, width, height, ix, iy);
      const inside = st.garrisonedIn[i];
      if (inside >= 0) {
        const sType = this.sim.structureTypes[this.sim.structures.typeIdx[inside]];
        const roofPx = resolveRoofPx(this.structureRoofArt.get(sType.id), sType.heightPx);
        groundY += roofPx * WORLD_Y_PER_LIFT_PIXEL;
      }
      const anchor: [number, number, number] = [ix, groundY, iy];

      // Air-lift shadow -- renderer.ts's own comment: "An airborne unit gets
      // a shadow on the tile it actually occupies. Without it the lift...
      // just reads as a sprite drawn in the wrong place; with it, the gap is
      // the altitude and the shadow says which tile the sim is really
      // using." Drawn at GROUND level (`anchor`, before `updateUnits`'
      // separate world-Y air lift is applied to the body itself -- see
      // `frame-state.ts`'s own `isAir` doc comment for why that lift is a
      // real world-Y offset here, not a screen-pixel one), a few pixels
      // below the unit's own feet, exactly like Pixi's `sy + 3`.
      if (type.isAir) {
        // Pixi's own `bodyAlpha`: full for the player's own units, faded by
        // contact level otherwise (`renderer.ts:1984-1988`). Recomputed here
        // rather than shared with `updateUnits`' identical value -- this is
        // a separate per-entity loop (this method's own top comment) with no
        // `EntityFrame` to read it back from.
        let bodyAlpha = 1;
        if (side !== 0) {
          const lvl = this.sim.contactLevel(0, i);
          bodyAlpha = lvl === 2 ? 1 : lvl === 1 ? 0.65 : 0.35;
        }
        const shadowR = r * 0.7 + 2;
        this.overlayBatch.ellipseFan(
          billboardPoint(anchor, 0, -3),
          shadowR,
          shadowR / 2,
          this.overlayColor(AIR_SHADOW_COLOR_KEY, '#0A0A08'),
          0.28 * bodyAlpha
        );
      }

      // HP bar -- renderer.ts: `g.rect(sx - 12, sy - r - 10, 24, 3).fill(...)`
      // (background) then the same rect, width scaled by `hpRatio` (fill).
      const hpRatio = Math.max(0, fx.toNumber(st.hp[i]) / fx.toNumber(type.hp));
      this.overlayBatch.rect(anchor, -12, -(r + 10), 12, -(r + 7), this.overlayColor(HP_BG_COLOR_KEY, '#14150F'), 0.8);
      if (hpRatio > 0) {
        this.overlayBatch.rect(
          anchor,
          -12,
          -(r + 10),
          -12 + 24 * hpRatio,
          -(r + 7),
          this.overlayColor(hpBarColorKey(hpRatio), '#6B8A4A'),
          1
        );
      }

      // Suppression bar -- renderer.ts: `g.rect(sx - 12, sy - r - 6, 24 *
      // supp, 3).fill('#FFB43C')`, only once supp clears the same 0.02 floor
      // Pixi uses (a bar 0-2% full is not worth a draw call).
      const supp = Math.min(1, fx.toNumber(st.suppression[i]));
      if (supp > 0.02) {
        this.overlayBatch.rect(
          anchor,
          -12,
          -(r + 6),
          -12 + 24 * supp,
          -(r + 3),
          this.overlayColor(SUPPRESSION_COLOR_KEY, '#FFB43C'),
          1
        );
      }

      // Kill-state pips: mobility (gray) and firepower (dark red) --
      // renderer.ts: `if (st.mobilityKilled[i] === 1) g.circle(sx - r, sy +
      // r - 2, 3).fill('#8E9491')` and the firepower twin at `sx + r`. A
      // vehicle that lost its engine but can still shoot, or lost its gun
      // but can still drive, reads identically to a fully healthy one
      // without these -- the HP bar alone does not carry that distinction.
      if (st.mobilityKilled[i] === 1) {
        this.overlayBatch.ellipseFan(
          billboardPoint(anchor, -r, -(r - 2)),
          3,
          3,
          this.overlayColor(MOBILITY_KILL_COLOR_KEY, '#8E9491'),
          1
        );
      }
      if (st.firepowerKilled[i] === 1) {
        this.overlayBatch.ellipseFan(
          billboardPoint(anchor, r, -(r - 2)),
          3,
          3,
          this.overlayColor(FIREPOWER_KILL_COLOR_KEY, FIREPOWER_KILL_FALLBACK_COLOR),
          1
        );
      }

      // Control-group colour -- shared by the badge and the selection ring,
      // exactly as renderer.ts's own comment says: "so a group reads as one
      // formation instead of as a loose selection."
      const grp = this.unitGroup[i];
      const groupColor =
        grp > 0 && this.opts.groupColors.length > 0 ? this.opts.groupColors[(grp - 1) % this.opts.groupColors.length] : '';
      const accentDefault = this.overlayColor(OVERLAY_ACCENT_COLOR_KEY, '#B8FF5A');

      // Selection ring -- renderer.ts: `g.ellipse(sx, sy + 2, r + 7, (r + 7)
      // / 2).stroke({ width: 2, color: groupColor || '#B8FF5A' })`.
      if (this.selection.includes(i)) {
        const ringCenter = billboardPoint(anchor, 0, -2);
        this.overlayBatch.ellipseRing(ringCenter, r + 7, (r + 7) / 2, 2, groupColor || accentDefault, 1);
      }

      // Control-group badge -- renderer.ts: a filled circle (`g.circle(sx -
      // r - 4, sy - r - 4, 7).fill({ color: groupColor || '#B8FF5A', alpha:
      // 0.95 })`) plus a numeral Text at the same point. Two batches, not
      // one -- see units/overlays.ts's own top comment for why.
      if (grp > 0) {
        const badgeCenter = billboardPoint(anchor, -(r + 4), r + 4);
        this.overlayBatch.ellipseFan(badgeCenter, 7, 7, groupColor || accentDefault, 0.95);
        this.numeralBatch.push(badgeCenter, 0, 0, 10, 12, grp);
      }
    }

    // Building status: an integrity bar once a building has been hit, and a
    // pip per man inside -- renderer.ts's own comment: "you should be able
    // to see that a house is held and how close it is to coming down."
    // `footprintCentre` (already this file's own choice for the garrison
    // hover affordance below) anchors both the bar and the badge -- the
    // SAME point Pixi's `fx.toNumber(str.cx[s])`/`cy[s]` resolves to for a
    // rectangular footprint (that function's own doc comment has the
    // algebra), chosen over reading `str.cx`/`cy` directly so this loop's
    // anchor and the hover affordance's anchor for the SAME structure never
    // disagree.
    {
      const str = this.sim.structures;
      for (let s = 0; s < this.sim.structureCount; s++) {
        if (str.alive[s] === 0) continue;
        const stype = this.sim.structureTypes[str.typeIdx[s]];
        const { fx: scx, fy: scy } = footprintCentre(this.sim, s);
        const groundYs = groundWorldY(elevation, width, height, scx, scy);
        const structAnchor: [number, number, number] = [scx, groundYs, scy];
        // renderer.ts: `art?.badgeTopPx ?? stype.heightPx` -- the mosque's
        // own comment there: `heightPx` (the procedural extrusion's height)
        // is right only for a structure with no sprite; `badgeTopPx` is the
        // topmost opaque row of its real art.
        const badgeTopPx = this.structureRoofArt.get(stype.id)?.badgeTopPx ?? stype.heightPx;
        const topUp = badgeTopPx + 12; // Pixi's `top = by - badgeTopPx - 12`

        // Integrity bar -- renderer.ts: `g.rect(bx - 16, top, 32, 4)` (bg)
        // then the same rect scaled by `ratio` (fill), only once damaged.
        const ratio = str.maxHp[s] > 0 ? str.hp[s] / str.maxHp[s] : 1;
        if (ratio < 0.999) {
          this.overlayBatch.rect(
            structAnchor,
            -16,
            -topUp,
            16,
            -topUp + 4,
            this.overlayColor(HP_BG_COLOR_KEY, '#14150F'),
            0.85
          );
          this.overlayBatch.rect(
            structAnchor,
            -16,
            -topUp,
            -16 + 32 * Math.max(0, ratio),
            -topUp + 4,
            this.overlayColor(buildingIntegrityColorKey(ratio), '#8E9491'),
            1
          );
        }

        // Held building: a house badge in the holder's colour, one pip per
        // man inside -- renderer.ts's own comment: "who is in there and how
        // many reads at a glance." `this.opts.teamColors` is an
        // ALREADY-RESOLVED hex per side (the app's own job), the identical
        // source every other team-coloured overlay already reads from --
        // not a palette-key lookup at this call site.
        const occ = str.occupants[s];
        if (occ > 0) {
          let side = 1;
          for (let i = 0; i < n; i++) {
            if (st.alive[i] === 1 && st.garrisonedIn[i] === s) {
              side = st.side[i];
              break;
            }
          }
          const col = this.opts.teamColors[side];
          const by2Rel = -(topUp + 16); // Pixi's `by2 = top - 16`
          this.overlayBatch.triangle(
            structAnchor,
            [[-7, by2Rel], [0, by2Rel - 6], [7, by2Rel]],
            col,
            1
          ); // roof
          this.overlayBatch.rect(structAnchor, -5, by2Rel, 5, by2Rel + 8, col, 1); // walls
          this.overlayBatch.rect(
            structAnchor,
            -1.5,
            by2Rel + 3,
            1.5,
            by2Rel + 8,
            this.overlayColor(HP_BG_COLOR_KEY, '#14150F'),
            1
          ); // doorway
          for (let k = 0; k < occ; k++) {
            const pipRightPx = -(occ - 1) * 3 + k * 6;
            this.overlayBatch.ellipseFan(billboardPoint(structAnchor, pipRightPx, -(by2Rel + 12)), 2, 2, col, 1);
          }
        }
      }
    }

    // Charges being set -- demolition against a building, a tunnel charge
    // against a route: a ring that grows as the timer runs. renderer.ts's
    // own comment: "eight seconds standing still in the open is exactly
    // when the player wants to know how long is LEFT." Demolition reads
    // first, matching Pixi's own priority (no production unit carries both
    // abilities today). Anchored at `this.curX[i]`/`curY[i]` DIRECTLY, not
    // the interpolated `ix`/`iy` every neighbouring overlay in this method
    // uses -- renderer.ts's own charge-ring block reads `this.curX[i]`,
    // `this.curY[i]` verbatim, unlike the blocks immediately above and
    // below it; a faithful port, not a judgement call (a charging unit is
    // required to stand still, so the two are visually indistinguishable in
    // practice, but this is what Pixi's own source says).
    {
      const ringTrack = this.overlayColor(CHARGE_RING_TRACK_COLOR_KEY, '#5C625F');
      const ringFill = this.overlayColor(CHARGE_RING_FILL_COLOR_KEY, CHARGE_RING_FILL_FALLBACK_COLOR);
      for (let i = 0; i < n; i++) {
        if (st.alive[i] === 0) continue;
        const demo = this.sim.demolitionProgress(i);
        const prog = demo > 0 ? demo : this.sim.tunnelChargeProgress(i);
        if (prog <= 0) continue;
        const groundYc = groundWorldY(elevation, width, height, this.curX[i], this.curY[i]);
        const chargeAnchor: [number, number, number] = [this.curX[i], groundYc, this.curY[i]];
        this.overlayBatch.ellipseRing(chargeAnchor, 20, 10, 2, ringTrack, 0.5);
        this.overlayBatch.ellipseRing(chargeAnchor, 20 * prog, 10 * prog, 3, ringFill, 0.9);
      }
    }

    // Weapon envelopes for the selection (GDD S5.8): solid ring at
    // effective range where accuracy holds up, faint ring at maximum reach,
    // and an inner ring for weapons with a minimum range (mortars can't
    // shoot close). `tileRadiusToEllipsePx` (units/overlays.ts) is Pixi's
    // own `ring()` closure -- `tiles * TILE_W * ISO_K, tiles * TILE_H *
    // ISO_K` -- pulled out once so this, the shepherd radius below, and the
    // tutorial focus ring above all share the identical formula.
    for (const i of this.selection) {
      if (st.alive[i] === 0) continue;
      const type = this.sim.unitTypes[st.typeIdx[i]];
      if (type.weapons.length === 0) continue;
      const ux = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      const uy = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
      const groundYe = groundWorldY(elevation, width, height, ux, uy);
      const envelopeAnchor: [number, number, number] = [ux, groundYe, uy];
      const ring = (tiles: number, colorHex: string, widthPx: number, a: number): void => {
        if (tiles <= 0) return;
        const { rightR, upR } = tileRadiusToEllipsePx(tiles, TILE_W, TILE_H);
        this.overlayBatch.ellipseRing(envelopeAnchor, rightR, upR, widthPx, colorHex, a);
      };
      const w0 = type.weapons[0];
      const teamColor = this.opts.teamColors[st.side[i]];
      ring(fx.toNumber(w0.range), teamColor, 1, 0.28);
      ring(fx.toNumber(w0.effectiveRange), teamColor, 1.5, 0.5);
      ring(Math.sqrt(fx.toNumber(w0.minRangeSq)), this.overlayColor('team.hostile', '#D93A2B'), 1, 0.35);
    }

    // Shepherd radius: when a player unit is selected, highlight nearby
    // civilians that can still be evacuated -- renderer.ts's own comment:
    // "a pulsing ring on each civilian tells the player 'drive here to
    // rescue them.'" Ties directly to `evacuate_before`: without this a
    // player has no way to see how close an escort must stay.
    const SHEPHERD_TILES = 4;
    if (this.selection.length > 0) {
      const shepherdColor = this.overlayColor(OVERLAY_ACCENT_COLOR_KEY, '#B8FF5A');
      for (let ci = 0; ci < n; ci++) {
        if (st.alive[ci] === 0 || st.side[ci] !== 2) continue;
        const ctype = this.sim.unitTypes[st.typeIdx[ci]];
        if (ctype.weapons.length > 0) continue;
        if (st.moving[ci] === 1) continue;
        const cx = this.prevX[ci] + (this.curX[ci] - this.prevX[ci]) * alpha;
        const cy = this.prevY[ci] + (this.curY[ci] - this.prevY[ci]) * alpha;
        const groundYc2 = groundWorldY(elevation, width, height, cx, cy);
        const shepherdAnchor: [number, number, number] = [cx, groundYc2, cy];
        const pulse = 0.35 + 0.2 * Math.sin(this.frameN * 0.12);
        const { rightR, upR } = tileRadiusToEllipsePx(SHEPHERD_TILES, TILE_W, TILE_H);
        this.overlayBatch.ellipseRing(shepherdAnchor, rightR, upR, 1.5, shepherdColor, pulse * 0.4);
      }
    }

    // Engagement reticles: brackets on whatever the selected units are
    // shooting at, with a faint line so the duel is readable at a glance.
    // The duel line is the one overlay in this method connecting two
    // INDEPENDENT world anchors (shooter, target) rather than small pixel
    // offsets from one -- `OverlayBatch.lineWorld`'s own doc comment (and
    // `pushLineWorld`'s, `units/overlay-geometry.ts`) has the full reasoning
    // for why that needs its own primitive.
    for (const i of this.selection) {
      if (st.alive[i] === 0 || st.side[i] !== 0) continue;
      const t = st.curTarget[i];
      if (t < 0 || st.alive[t] === 0) continue;
      const tx = this.prevX[t] + (this.curX[t] - this.prevX[t]) * alpha;
      const ty = this.prevY[t] + (this.curY[t] - this.prevY[t]) * alpha;
      const groundYt2 = groundWorldY(elevation, width, height, tx, ty);
      const targetAnchor: [number, number, number] = [tx, groundYt2, ty];
      const R = 15;
      const c = this.opts.teamColors[1];
      for (const [mx, my] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        this.overlayBatch.line(targetAnchor, mx * R, my * (R / 2) - my * 4, mx * R, my * (R / 2), 2, c, 1);
        this.overlayBatch.line(targetAnchor, mx * R, my * (R / 2), mx * R - mx * 7, my * (R / 2), 2, c, 1);
      }
      const shx = this.prevX[i] + (this.curX[i] - this.prevX[i]) * alpha;
      const shy = this.prevY[i] + (this.curY[i] - this.prevY[i]) * alpha;
      const groundYs2 = groundWorldY(elevation, width, height, shx, shy);
      const shooterAnchor: [number, number, number] = [shx, groundYs2, shy];
      this.overlayBatch.lineWorld(shooterAnchor, targetAnchor, 1, c, 0.35);
    }

    // Permanent-wreck fallback: a unit type with no real `wreck` clip
    // (`clipOrFallback(sheet, 'wreck') !== 'wreck'`, `mbt_lavi`'s
    // `TNK_HULL`/`TNK_TURR` among them) or no loaded `UnitInstancer` at all
    // gets Pixi's own grey X cross-marker instead of real art
    // (`renderer.ts:1236-1242`, drawn into `unitsG` -- the identical overlay
    // tier this method already builds, not `wreckLayer`). `stepDeaths`'s own
    // wreck loop already drew every wreck WITH real art through
    // `framesByType`/`UnitInstancer` this same frame -- this pass only
    // covers what that one deliberately skipped, so a wreck never gets both.
    if (this.wrecks.length > 0) {
      const wreckMarkerColor = this.overlayColor(WRECK_MARKER_COLOR_KEY, '#5C625F');
      for (const wk of this.wrecks) {
        if (!wk.shown) continue;
        const instancer = this.unitInstancers.get(wk.typeId);
        if (instancer && clipOrFallback(instancer.sheet, 'wreck') === 'wreck') continue;
        const wreckGroundY = groundWorldY(elevation, width, height, wk.x, wk.y);
        const wreckAnchor: [number, number, number] = [wk.x, wreckGroundY, wk.y];
        // Two crossing strokes, Pixi's own literal geometry verbatim:
        // `g.moveTo(sx-7,sy-5).lineTo(sx+7,sy+5)` and
        // `g.moveTo(sx-7,sy+5).lineTo(sx+7,sy-5)`, both `stroke({width: 3})`.
        this.overlayBatch.line(wreckAnchor, -7, -5, 7, 5, 3, wreckMarkerColor, 1);
        this.overlayBatch.line(wreckAnchor, -7, 5, 7, -5, 3, wreckMarkerColor, 1);
      }
    }

    // Order markers -- renderer.ts's own trailing pass: `this.orderMarkers
    // = this.orderMarkers.filter((m) => --m.ttl > 0)`, then a crosshair plus
    // a fading ring per survivor.
    this.orderMarkers = this.orderMarkers.filter((m) => --m.ttl > 0);
    if (this.orderMarkers.length > 0) {
      const markerColor = this.overlayColor(OVERLAY_ACCENT_COLOR_KEY, '#B8FF5A');
      for (const m of this.orderMarkers) {
        const groundYm = groundWorldY(elevation, width, height, m.x, m.y);
        const manchor: [number, number, number] = [m.x, groundYm, m.y];
        const a = m.ttl / ORDER_MARKER_TTL;
        const s = orderMarkerSize(a);
        this.overlayBatch.rect(manchor, -s, -1, -4, 1, markerColor, a);
        this.overlayBatch.rect(manchor, 4, -1, s, 1, markerColor, a);
        this.overlayBatch.rect(manchor, -1, -s / 2, 1, -2, markerColor, a);
        this.overlayBatch.rect(manchor, -1, 2, 1, s / 2, markerColor, a);
        this.overlayBatch.ellipseRing(manchor, s + 4, (s + 4) / 2, 1.5, markerColor, a * 0.6);
      }
    }

    // Objective zone -- renderer.ts's own comment: "the ground the mission
    // is actually about. Without this the player is told to 'hold the
    // western approach' and has to guess where that is." `objectiveZone`/
    // `objectiveZoneState` are `Renderer`-interface members, already written
    // every 5 ticks by `main.ts`'s tick loop -- until this port, nothing in
    // this backend ever read them (Phase D readiness audit, "the only two
    // genuine interface stubs of 28"). The colour is not decoration: it is
    // the hold-state readout itself (held/unheld/contested), exactly like
    // every other palette-key overlay in this tier.
    if (this.objectiveZone) {
      const [zx, zy, zw, zh] = this.objectiveZone;
      const corners = objectiveZoneCorners(zx, zy, zw, zh, (cx, cy) =>
        groundWorldY(elevation, width, height, cx, cy)
      );
      const colorKey = objectiveZoneColorKey(this.objectiveZoneState);
      const color = this.overlayColor(colorKey, objectiveZoneFallbackColor(this.objectiveZoneState));
      const pulse = objectiveZonePulse(this.objectiveZoneState, this.frameN);
      // renderer.ts: `.stroke({width: 2, color, alpha: pulse + 0.25})` then
      // `.fill({color, alpha: 0.05})` -- same two calls, same two alphas.
      this.overlayBatch.polygonStrokeWorld(corners, OBJECTIVE_ZONE_STROKE_INSET_TILES, color, pulse + 0.25);
      this.overlayBatch.polygonFillWorld(corners, color, 0.05);
    }

    // Tutorial focus ring -- renderer.ts's own manual 24-point loop, a
    // WORLD-TILE-radius circle (not a screen-pixel one), which for a flat
    // map is algebraically the identical ellipse the weapon-envelope `ring
    // ()` helper draws (`tiles * TILE_W * ISO_K`, `tiles * TILE_H * ISO_K`)
    // -- see units/overlay-geometry.ts's own top comment for the derivation.
    // Sampled at the CENTRE's own ground height only, not per ring vertex
    // (Pixi samples `groundOffset` at every one of its 24 points): every
    // shipped map the tutorial actually runs on today is flat (CLAUDE.md's
    // own "every shipped map is flat" note), so the two are identical in
    // practice; documented here as the simplification it is rather than
    // silently matched only by accident.
    const tut = this.retained.tutorialFocus;
    if (tut) {
      const groundYt = groundWorldY(elevation, width, height, tut.x, tut.y);
      const tanchor: [number, number, number] = [tut.x, groundYt, tut.y];
      const pulse = 0.35 + 0.25 * Math.sin(this.frameN * 0.09);
      const color = this.overlayColor(OVERLAY_ACCENT_COLOR_KEY, '#B8FF5A');
      // `tileRadiusToEllipsePx` (units/overlays.ts) is this same `tiles *
      // TILE_W * ISO_K, tiles * TILE_H * ISO_K` formula, pulled out once now
      // that the weapon-envelope ring below actually exists and shares it.
      const { rightR: rPx, upR: rPxUp } = tileRadiusToEllipsePx(tut.radius, TILE_W, TILE_H);
      this.overlayBatch.ellipseRing(tanchor, rPx, rPxUp, 2, color, pulse + 0.25, 24);
    }

    // Garrison hover highlight -- renderer.ts's own doorway-arrow affordance,
    // shown only while the current selection could actually garrison the
    // hovered building. Structure-anchored, not unit-anchored: `top` there
    // is a SCREEN point (`by - badgeTopPx - 12`), reproduced here as a
    // derived world anchor the same `billboardPoint` convention every other
    // overlay in this method uses.
    if (
      this.hoverStructure >= 0 &&
      this.hoverCanGarrison &&
      this.hoverStructure < this.sim.structureCount &&
      this.sim.structures.alive[this.hoverStructure] === 1
    ) {
      const s = this.hoverStructure;
      const stype = this.sim.structureTypes[this.sim.structures.typeIdx[s]];
      const { fx: cxTile, fy: cyTile } = footprintCentre(this.sim, s);
      const groundYs = groundWorldY(elevation, width, height, cxTile, cyTile);
      const structAnchor: [number, number, number] = [cxTile, groundYs, cyTile];
      // renderer.ts: `art?.badgeTopPx ?? stype.heightPx` -- NOT
      // resolveRoofPx's roofTopPx-preferring chain above (that one answers
      // "how tall does a garrisoned occupant stand", a different question
      // from "where does this building's own badge/affordance UI hang").
      const badgeTopPx = this.structureRoofArt.get(stype.id)?.badgeTopPx ?? stype.heightPx;
      const hyUp = badgeTopPx + 12 + 34; // top = anchor_up(badgeTopPx + 12); hy = top - 34 (Pixi y-down)
      const hAnchor = billboardPoint(structAnchor, 0, hyUp);
      const pulse = 0.55 + 0.45 * Math.sin(this.frameN * 0.12);
      const color = this.overlayColor(OVERLAY_ACCENT_COLOR_KEY, '#B8FF5A');
      // Door outline + jamb: renderer.ts's `g.rect(bx + 2, hy - 9, 11, 18)
      // .stroke(...)` and `g.rect(bx + 2, hy - 9, 3, 18).fill(...)`.
      this.overlayBatch.rectStroke(hAnchor, 2, -9, 13, 9, 2, color, pulse);
      this.overlayBatch.rect(hAnchor, 2, -9, 5, 9, color, pulse);
      // Arrow shaft + head: renderer.ts's `moveTo(bx - 14, hy).lineTo(bx -
      // 2, hy).stroke({ width: 2.5, ... })` and `g.poly([bx - 2, hy - 5, bx
      // + 4, hy, bx - 2, hy + 5]).fill(...)`.
      this.overlayBatch.rect(hAnchor, -14, -1.25, -2, 1.25, color, pulse);
      this.overlayBatch.triangle(hAnchor, [[-2, -5], [4, 0], [-2, 5]], color, pulse);
    }

    this.overlayBatch.endFrame();
    this.numeralBatch.endFrame();
  }

  /**
   * (Re)builds the ground mesh, its scatter (grain) mesh, its grove (olive
   * trunk/crown) mesh, the residual (fallback-only) buildings mesh, and one
   * small mesh per LIVE, un-arted structure, from the sim's static layout
   * (`width`, `height`, `blocked`, `cover`, `structures`) plus whatever
   * `setElevation`/`setDecor` have retained -- via `composeTerrain` below,
   * the pure function this method's own body used to be before Task B3.9
   * split it out (see that function's own doc comment for why, and for the
   * per-structure building split this method now wires into the scene).
   *
   * Only ever called from `frame()`, guarded by `terrainDirty` -- see that
   * field's doc comment for why building here, and not inside the setters,
   * is load-bearing rather than a style choice. Task B3.9 adds a second
   * trigger for this same full rebuild: `applyStructureDestroyed` sets
   * `terrainDirty = true` too, since a structure's death is the one event
   * that changes the ground/scatter/grove tone under its own footprint
   * (open ground where a building's box used to stand), and those three
   * layers have no per-structure invalidation of their own -- see
   * `applyStructureDestroyed`'s own doc comment for the measured reasoning.
   *
   * Disposes each outgoing geometry before dropping the reference to it: a
   * rebuilt terrain that leaks its predecessor is invisible until a mission
   * rebuilds terrain a few hundred times, and then it is a memory bug nobody
   * can attribute. The material is not disposed -- `terrainMat` is reused
   * across rebuilds, not replaced (every mesh this method builds shares it,
   * `structureBoxes` included).
   *
   * What this closes: a destroyed, un-arted structure's box now disappears
   * and its ground tone reverts to open the next time THIS method runs --
   * which `applyStructureDestroyed` triggers directly, closing the gap
   * B2.7/B3.7's own doc comments here used to describe as open. Task B3.10
   * wired `onEvents` to call `applyStructureHit`/`applyStructureDestroyed`
   * for real `structureHit`/`structureDestroyed` events, so that staleness
   * is now closed in PRACTICE too, not merely in principle -- see
   * `onEvents`'s own doc comment on those two kinds.
   */
  private rebuildTerrain(): void {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
    }
    if (this.scatterMesh) {
      this.scene.remove(this.scatterMesh);
      this.scatterMesh.geometry.dispose();
    }
    if (this.groveMesh) {
      this.scene.remove(this.groveMesh);
      this.groveMesh.geometry.dispose();
    }
    if (this.residualMesh) {
      this.scene.remove(this.residualMesh);
      this.residualMesh.geometry.dispose();
    }
    for (const mesh of this.structureBoxes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.structureBoxes.clear();
    this.structureFootprintTiles.clear();

    const composed = composeTerrain(
      this.sim,
      this.retained.decor,
      this.retained.elevation,
      (id) => this.structureIdle.has(id) || this.buildingMeshIdleTemplates.has(id),
      this.opts.terrainTones,
      this.opts.resolveColor,
      this.opts.background
    );

    this.terrainMesh = new THREE.Mesh(toGeometry(composed.ground), this.terrainMat);
    this.scene.add(this.terrainMesh);

    this.scatterMesh = new THREE.Mesh(toGeometry(composed.scatter), this.terrainMat);
    this.scene.add(this.scatterMesh);

    this.groveMesh = new THREE.Mesh(toGeometry(composed.groves), this.terrainMat);
    this.scene.add(this.groveMesh);

    this.residualMesh = new THREE.Mesh(toGeometry(composed.residual), this.terrainMat);
    this.scene.add(this.residualMesh);

    for (const box of composed.buildings) {
      const mesh = new THREE.Mesh(toGeometry(box.mesh), this.terrainMat);
      this.structureBoxes.set(box.structureIndex, mesh);
      this.structureFootprintTiles.set(box.structureIndex, box.tiles);
      this.scene.add(mesh);
    }
  }

  /**
   * Task B3.9: the renderer-side counterpart of `PixiRenderer.
   * bumpStructureWear`'s lazy grow (`renderer.ts:1792-1799`) -- returns the
   * per-structure wear-step array, growing it (and copying whatever it
   * already held) the first time `sim.structureCount` outgrows it. Returns
   * the array rather than relying on the caller re-reading `this.
   * structureWear` afterward so nothing here needs a non-null assertion to
   * use what it just assigned.
   */
  private ensureStructureWear(): Uint8Array {
    const current = this.structureWear;
    if (current && current.length >= this.sim.structureCount) return current;
    const next = new Uint8Array(this.sim.structureCount);
    next.fill(0xff); // never a real structureWearStep() output (range 0..8)
    if (current) next.set(current);
    this.structureWear = next;
    return next;
  }

  /**
   * Task B4.4: the lazy-grow counterpart of `ensureStructureWear` above, for
   * `structureLastAlpha` -- same shape, `-1` as the "never cached" sentinel
   * instead of `0xff` (see that field's own doc comment for why a float
   * cache rather than a wear-step one).
   */
  private ensureStructureLastAlpha(): Float32Array {
    const current = this.structureLastAlpha;
    if (current && current.length >= this.sim.structureCount) return current;
    const next = new Float32Array(this.sim.structureCount);
    next.fill(-1);
    if (current) next.set(current);
    this.structureLastAlpha = next;
    return next;
  }

  /**
   * Task B3.9: the incremental half of `structureHit` -- recomputes ONLY
   * the hit structure's own box geometry, and only when `dirty.ts`'s
   * eight-step wear quantisation says the hit actually crossed a visible
   * step. Called from `onEvents` since Task B3.10 (that wiring is a single
   * call, exactly as this method was built to make it -- see `onEvents`'s
   * own doc comment on `structureHit`).
   *
   * A structure with no tracked footprint (arted -- drawn by
   * `StructureInstancer` instead, see `structureBoxes`'s own doc comment --
   * or simply unknown) is a silent no-op, matching this class's own
   * "truthful no-op, not a fabricated answer" discipline for input this
   * backend has nothing to draw for.
   */
  applyStructureHit(structure: number): void {
    const tiles = this.structureFootprintTiles.get(structure);
    if (!tiles) return;
    const wear = this.ensureStructureWear();
    const st = this.sim.structures;
    const result = dirtyForStructureHit(tiles, wear[structure], st.hp[structure], st.maxHp[structure]);
    wear[structure] = result.wearStep;
    if (!result.dirty) return;

    const type = this.sim.structureTypes[st.typeIdx[structure]];
    const footprint: StructureFootprint = {
      tiles,
      heightPx: type.heightPx,
      colorKey: type.color,
      hp: st.hp[structure],
      maxHp: st.maxHp[structure],
    };
    const input: TerrainInput = {
      width: this.sim.width,
      height: this.sim.height,
      decor: this.retained.decor,
      elevation: this.retained.elevation,
      blocked: this.sim.blocked,
      cover: this.sim.cover,
    };
    const data = buildBuildings(input, [footprint], this.opts.terrainTones, this.opts.resolveColor, this.opts.background, tiles);

    const previous = this.structureBoxes.get(structure);
    if (previous) {
      this.scene.remove(previous);
      previous.geometry.dispose();
    }
    const mesh = new THREE.Mesh(toGeometry(data), this.terrainMat);
    this.structureBoxes.set(structure, mesh);
    this.scene.add(mesh);
  }

  /**
   * Task B3.9: the incremental half of `structureDestroyed`. Removes the
   * dead structure's own box mesh directly (O(1) -- no rebuild needed to
   * make a box disappear, only to make one appear correctly shaped
   * elsewhere) when this structure had one (un-arted only, see
   * `structureBoxes`'s own doc comment), then flags a full `rebuildTerrain`
   * for the ground/scatter/grove retessellation ANY structure's death owes:
   * those three layers read every LIVE structure's raw `blocked` state
   * UNCONDITIONALLY, arted or not (`composeTerrain`'s own comment; the
   * `underBuilding` ground wash and scatter/grove's own "skip blocked
   * tiles" branches all read `sim.blocked` directly, never `structureBoxes`
   * or `structureFootprintTiles`), and have no per-structure invalidation
   * of their own (see this module's own `dirty.ts` top comment). Death is a
   * one-shot event per structure, not a several-times-a-second one --
   * unlike `structureHit`, there is no quantisation to defeat here, so a
   * full rebuild's cost is paid once per structure's whole life, not once
   * per round fired at it. See this task's report for the measured
   * reasoning and the numbers that back this choice over a second
   * per-tile splice mechanism for those three layers.
   *
   * Called from `onEvents` since Task B3.10, same as `applyStructureHit`.
   * That wiring's own review caught a real defect this method shipped with:
   * `terrainDirty` used to be set only inside the `tiles` branch below, so
   * an ARTED structure's death -- no tracked footprint, hence no `tiles` --
   * fell through as a silent no-op that never flagged the ground beneath
   * it. Every shipped structure type has art (`main.ts`'s
   * `STRUCTURE_SPRITES`), so that was the ONLY path any real mission ever
   * took: the wreck sprite would swap in (`updateStructures`'s own
   * per-frame path, unaffected) while the ground stayed permanently
   * blocked-looking underneath it, on every map, for every building. Fixed
   * by setting the flag unconditionally -- `tiles` still gates the box
   * removal and the `dirtyForStructureDestroyed` call (meaningless without
   * a tracked footprint), but not the flag itself.
   */
  applyStructureDestroyed(structure: number): void {
    const mesh = this.structureBoxes.get(structure);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.structureBoxes.delete(structure);
    }
    const tiles = this.structureFootprintTiles.get(structure);
    this.structureFootprintTiles.delete(structure);
    if (tiles) {
      const dirty = dirtyForStructureDestroyed(tiles);
      if (dirty.kind === 'unblocked') this.terrainDirty = true;
      return;
    }
    this.terrainDirty = true;
  }

  /**
   * Task B3.7: per-frame idle/wreck billboard placement for every structure
   * type with a loaded sheet -- the sprite counterpart to `updateUnits`, and
   * deliberately driven off LIVE `Sim` state every frame rather than the
   * `terrainDirty`-gated box/ground mesh `rebuildTerrain` owns.
   *
   * That is load-bearing, not merely convenient: even now that `onEvents`
   * calls `applyStructureHit`/`applyStructureDestroyed` for real
   * `structureHit`/`structureDestroyed` events (Task B3.10), neither ever
   * touches an ARTED structure -- the only kind this method draws --
   * because both key off `structureBoxes`/`structureFootprintTiles`, which
   * `composeTerrain`'s `hasArt` skip never populates for one (see
   * `structureWreck`'s own field doc comment for the same point made about
   * that map specifically). If a structure's wreck sprite only ever
   * refreshed on `terrainDirty`, it would never appear at all during a real
   * mission -- nothing sets `terrainDirty` for an arted structure, wired
   * events included. Reading `Sim` fresh here instead means a living
   * structure's battle-damage alpha darkens in real time and its wreck
   * appears the instant `Sim` marks it dead, without touching the terrain
   * mesh at all -- and it is, in this one respect, MORE responsive than
   * Pixi, which only refreshes either at the same `terrainDirty`-style
   * granularity (`drawTerrain` calls `drawWreckedStructures` itself, at the
   * very end).
   *
   * Task B3.9's own review flagged this method by name and asked whether it
   * still composes with the new incremental invalidation, rather than
   * quietly duplicating it. It does compose, and stays exactly as written:
   * this path draws ARTED structures only (`structureIdle`/`structureWreck`,
   * keyed by structure TYPE); `applyStructureHit`/`applyStructureDestroyed`
   * touch `structureBoxes`, keyed by structure INDEX, and only for UN-ARTED
   * structures (`composeTerrain`'s `hasArt` skip) -- two disjoint sets, never
   * the same structure twice. Now that Task B3.10 has wired `onEvents`, this
   * scan is the ONLY thing still doing per-frame, per-structure work for its
   * own set (idempotent, and already known-cheap at today's counts -- an O(types x
   * structureCount) live-state pull each frame, up to 13 scans and one
   * object per structure per type today; ~4,000 probes / 18,000 objects a
   * second at the GDD's 300-structure target, GC-visible but not wired to
   * anything expensive downstream). Made redundant in the narrow sense that
   * an EVENT-DRIVEN update for arted structures would no longer strictly
   * need to poll every frame, but not wrong, and folding it into
   * event-driven invalidation is explicitly not this task's job -- the
   * right time is when detection's own O(N^2) staggering lands (`CLAUDE.md`'s
   * "Known scaling debts"), which already needs to touch per-frame structure
   * scanning for the same reason.
   *
   * Called unconditionally, like `updateUnits`/`updateFx` -- both maps start
   * empty and simply have nothing to iterate before any sheet has loaded.
   */
  private updateStructures(): void {
    if (this.structureIdle.size === 0 && this.structureWreck.size === 0) return;
    const elevation = this.retained.elevation;
    for (const [id, instancer] of this.structureIdle) {
      // "Mesh wins": a structure type with a loaded building mesh
      // (`updateBuildingMeshes`) must not ALSO draw its billboard --
      // matching `updateUnits`'s own `vehicleMeshTemplates.has(type.id)`
      // guard. Forced to an EMPTY placement list rather than skipped
      // outright, so `mesh.count` is actively zeroed even if a mesh loads
      // for a type whose billboard previously had a non-zero count.
      instancer.update(this.buildingMeshIdleTemplates.has(id) ? [] : liveStructurePlacements(this.sim, id, elevation));
    }
    for (const [id, instancer] of this.structureWreck) {
      instancer.update(
        this.buildingMeshWreckTemplates.has(id) ? [] : deadStructurePlacements(this.sim, id, elevation)
      );
    }
    this.cacheStructureAlpha();
  }

  /**
   * Task B4.4: snapshot every LIVE, arted structure's current billboard
   * alpha into `structureLastAlpha` -- see that field's own doc comment for
   * why `beginCollapse` needs a cache rather than a live read at the moment
   * of death. A plain O(structureCount) scan, cheaper than the O(types x
   * structureCount) work `updateStructures` already pays above (that
   * method's own doc comment already accepts that shape at the GDD's
   * 300-structure target).
   */
  private cacheStructureAlpha(): void {
    const st = this.sim.structures;
    const cache = this.ensureStructureLastAlpha();
    for (let s = 0; s < this.sim.structureCount; s++) {
      if (st.alive[s] !== 1) continue;
      const type = this.sim.structureTypes[st.typeIdx[s]];
      if (!this.structureIdle.has(type.id)) continue; // un-arted: structureBoxes' concern, not this cache's
      cache[s] = structureAliveAlpha(st.hp[s], st.maxHp[s]);
    }
  }

  /**
   * Task B4.4: start a building falling -- the three.js counterpart to
   * `PixiRenderer.beginCollapse` (`renderer.ts:272-303`).
   *
   * `updateStructures` swaps the idle billboard for the wreck one the
   * instant `sim.alive` flips, every frame (see that method's own doc
   * comment for why it has to poll live state rather than wait for a
   * `terrainDirty` rebuild) -- this method adds a SEPARATE, one-off
   * `THREE.Mesh` on top of that swap, exactly the way `structureBoxes`
   * already gives an un-arted structure its own per-structure mesh outside
   * the bulk-rebuilt terrain mesh. `updateStructures` cannot delete this
   * mesh out from under the fall because it never touches it: that method
   * only ever writes into `structureIdle`/`structureWreck`'s OWN instance
   * buffers, keyed by structure TYPE, and this mesh is not a member of
   * either -- it is tracked solely by `this.collapsing`, added to `scene`
   * directly, and removed only by `stepCollapses` once its own fall
   * finishes. The wreck billboard is therefore already sitting underneath,
   * visible the instant `sim.alive` flips, exactly as Pixi's own comment on
   * `beginCollapse` describes ("The wreck is already going down underneath
   * on this rebuild, so all this adds is the intact sprite on top").
   *
   * Bails silently for a structure type with no loaded idle sheet -- the
   * un-arted, procedurally-extruded case (`structureBoxes`) has no
   * billboard to fell, matching Pixi's own `if (!art) return`
   * (`renderer.ts:277`). Every shipped structure type has art today
   * (`main.ts`'s `STRUCTURE_SPRITES`), so this branch is not reachable on
   * any real mission, same as Pixi's.
   *
   * Anchored at the BASE, not the footprint's centred ground point every
   * OTHER structure billboard uses -- `collapseBillboardGeometry` builds
   * that separately; see its own doc comment for why a base anchor is what
   * makes shrinking `mesh.scale.y` bring the roof down while the footprint
   * stays exactly where it was, and for the `worldY - halfHeight`
   * translation below.
   *
   * `alpha0` continues from `structureLastAlpha`'s cache rather than
   * recomputing from `hp`/`maxHp` fresh -- see that field's own doc comment
   * for why a fresh read at this exact moment would always answer "fully
   * battered" (`0.55`), and for why that is a deliberate departure from
   * what Pixi itself actually shows for a combat kill, not merely a
   * different route to the same number.
   */
  private beginCollapse(structure: number): void {
    const st = this.sim.structures;
    const type = this.sim.structureTypes[st.typeIdx[structure]];
    const idle = this.structureIdle.get(type.id);
    const art = this.structureCollapseArt.get(type.id);
    if (!idle || !art) return;

    const { fx: footX, fy: footY } = footprintCentre(this.sim, structure);
    const worldY = groundWorldY(this.retained.elevation, this.sim.width, this.sim.height, footX, footY);
    const cache = this.structureLastAlpha;
    const cached = cache && structure < cache.length ? cache[structure] : -1;
    const alpha0 = cached >= 0 ? cached : 1;

    const geometry = collapseBillboardGeometry(art.scale, art.textureWidth, art.textureHeight);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(geometry.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(geometry.indices, 1));

    const material = createCollapseMaterial(idle.spriteTexture, alpha0);
    const mesh = new THREE.Mesh(geo, material);
    // Base-anchored: local up runs 0..drawHeightPx (collapseBillboardGeometry),
    // so translating to worldY - halfHeight lands the mesh's own local origin
    // at the exact world point the CENTRED idle sprite's own bottom edge
    // already sat at -- the fall begins with no visible pop, "covering the
    // same ground the centred sprite did."
    const halfHeightWorld = (geometry.drawHeightPx / 2) * WORLD_Y_PER_LIFT_PIXEL;
    mesh.position.set(footX, worldY - halfHeightWorld, footY);
    mesh.renderOrder = STRUCTURE_RENDER_ORDER;

    this.scene.add(mesh);
    this.collapsing.push({ mesh, t: 0, alpha0 });
  }

  /**
   * Bring the falling buildings down one frame -- the three.js counterpart
   * to `PixiRenderer.stepCollapses` (`renderer.ts:311-325`), identical
   * squared easing via `collapseFrame` (see that function's own doc
   * comment). `scale.y` needs no `scaleY0` multiplier the way Pixi's own
   * sprite does: `collapseBillboardGeometry`'s quad is already sized to its
   * final world extent (the same convention every other billboard in this
   * backend uses), so three.js's rest scale is simply `1` -- `collapseFrame`
   * already returns that ratio directly.
   */
  private stepCollapses(dtSeconds: number): void {
    for (let i = this.collapsing.length - 1; i >= 0; i--) {
      const c = this.collapsing[i];
      c.t += dtSeconds;
      const result = collapseFrame(c.t, c.alpha0);
      c.mesh.scale.y = result.scaleY;
      c.mesh.material.opacity = result.alpha;
      if (result.done) {
        this.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mesh.material.dispose();
        this.collapsing.splice(i, 1);
      }
    }
  }
}

/** `StructureFootprint` plus the one fact `buildBuildings` itself does not
 *  need but `composeTerrain`'s own per-structure split does: which structure
 *  TYPE this is, so it can be asked of `hasArt`. */
interface IndexedStructureFootprint extends StructureFootprint {
  readonly structureTypeId: string;
}

/**
 * Every LIVING structure, as the plain-array snapshot `buildBuildings`
 * needs -- the pure builder must stay ignorant of `Sim`, so this is where
 * that boundary is actually crossed. Walks every tile once (same cost
 * `rebuildTerrain`'s own `TerrainInput` assembly already pays elsewhere)
 * asking `structureAt`, rather than trusting `structures.minX/maxX/minY/
 * maxY` as a solid rectangle -- a `per_tile` structure (a fence, a wall
 * run) is NOT a filled rectangle, and `structureAt` is the one query that
 * already gets this right for every structure shape the sim has.
 *
 * Keyed by structure INDEX (`sim.structures`' own array index -- the same
 * index a `structureHit`/`structureDestroyed` event's `structure` field
 * carries), not merely collected into an array: `structureFootprintsFor` and
 * `composeTerrain` both need that index for their own reasons (the former to
 * preserve its own pre-B3.9 array-order contract, the latter to key
 * `ComposedBuildingBox` so `ThreeRenderer` can cache tiles per structure for
 * O(footprint) incremental updates) -- one walk, two consumers, rather than
 * two copies of the same `structureAt` scan.
 *
 * A demolished structure never appears: `structureAt` returns -1 the moment
 * `alive` drops to 0 (and `destroyStructure` unblocks its whole footprint
 * besides), so this walk simply never visits its tiles.
 */
function walkStructureFootprints(sim: Sim): Map<number, IndexedStructureFootprint> {
  const { width, height, structures: st, structureTypes } = sim;
  const tilesByStructure = new Map<number, number[]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sIdx = sim.structureAt(x, y);
      if (sIdx < 0) continue;
      const tiles = tilesByStructure.get(sIdx);
      if (tiles) tiles.push(y * width + x);
      else tilesByStructure.set(sIdx, [y * width + x]);
    }
  }
  const result = new Map<number, IndexedStructureFootprint>();
  for (const [sIdx, tiles] of tilesByStructure) {
    const type = structureTypes[st.typeIdx[sIdx]];
    result.set(sIdx, {
      tiles,
      heightPx: type.heightPx,
      colorKey: type.color,
      hp: st.hp[sIdx],
      maxHp: st.maxHp[sIdx],
      structureTypeId: type.id,
    });
  }
  return result;
}

/**
 * Still draws no distinction between a structure with sprite art and one
 * without, even after Task B3.7 gave `ThreeRenderer` its own art atlas
 * (`structureIdle`): this function's own JOB is "every living structure,
 * unconditionally" -- `packages/app/src/terrain-parity.test.ts` relies on
 * exactly that neutrality to prove `buildBuildings` boxes EVERY structure
 * when handed an unfiltered snapshot, independent of whatever a real
 * `ThreeRenderer` instance has or has not loaded. `composeTerrain` (below)
 * is where art-aware filtering actually happens now, via `walkStructureFootprints`
 * directly -- this function stays the neutral, whole-map snapshot it always
 * was, just sharing that walk instead of repeating it.
 *
 * Module-level (not a private method) and exported so
 * `packages/app/src/terrain-parity.test.ts` can build the same
 * `StructureFootprint[]` snapshot from its own `Sim` without maintaining a
 * second copy of this walk -- Task B2.8 duplicated it there verbatim
 * because this method was both private and, at the time, in a file B2's
 * later tasks were barred from editing. Task B3.1 lifts that bar: this is
 * now the one copy, reached from `ThreeRenderer` internally and from the
 * test (a `*.test.ts` file, exempt from the bundle-rule lint that would
 * otherwise stop `packages/app` from statically importing `@lions/render/
 * three`) via `@lions/render/three`.
 */
export function structureFootprintsFor(sim: Sim): StructureFootprint[] {
  return Array.from(walkStructureFootprints(sim).values());
}

/** `composeTerrain`'s per-structure output: which structure (by index into
 *  `sim.structures`), which tiles it occupies (cached by the caller for
 *  later O(footprint) incremental rebuilds), and its box geometry. */
export interface ComposedBuildingBox {
  readonly structureIndex: number;
  readonly tiles: readonly number[];
  readonly mesh: MeshData;
}

/** `composeTerrain`'s full result -- one entry per terrain layer
 *  `rebuildTerrain` used to build inline before Task B3.9 lifted this out. */
export interface ComposedTerrain {
  readonly ground: MeshData;
  readonly scatter: MeshData;
  readonly groves: MeshData;
  /** The fallback-only layer: a blocked, non-ridge tile that belongs to no
   *  live structure at all (`buildBuildings`'s own `FALLBACK_HEIGHT_PX`
   *  case, "never reached on any shipped map" per that file's own doc
   *  comment, but still correct and still tested). Every LIVE structure's
   *  own tiles are excluded from this layer's input regardless of whether
   *  it has art -- see `withoutLiveStructures` below -- so it can never
   *  double-draw a box a `ComposedBuildingBox` entry, or a
   *  `StructureInstancer` sprite, already covers. */
  readonly residual: MeshData;
  /** One entry per LIVE, un-arted structure. */
  readonly buildings: readonly ComposedBuildingBox[];
}

/** `sim.blocked`, with every currently-live structure's own tiles zeroed
 *  out -- what the RESIDUAL layer's input needs so its tile walk only ever
 *  reaches the fallback case (a blocked tile no structure claims at all),
 *  never a REAL structure's tiles, whether or not that structure has art.
 *  Deliberately broader than the old `maskArtedStructures` this replaces
 *  (Task B3.9): that function only masked ARTED structures, because the
 *  merged `buildBuildings` call still needed every un-arted structure's
 *  tiles left `blocked` so its own single pass could box them. Now that
 *  every un-arted structure gets its own `ComposedBuildingBox` instead, the
 *  residual layer needs NO live structure's tiles at all -- masking only
 *  arted ones would leave every un-arted structure double-drawn, once by
 *  its own box and once by the residual layer's fallback branch. */
function withoutLiveStructures(sim: Sim, footprints: ReadonlyMap<number, IndexedStructureFootprint>): Uint8Array {
  const masked = Uint8Array.from(sim.blocked);
  for (const footprint of footprints.values()) {
    for (const ti of footprint.tiles) masked[ti] = 0;
  }
  return masked;
}

/**
 * Task B3.9: `rebuildTerrain`'s own body, lifted into a pure function so the
 * WIRING it performs -- ground/scatter/grove read the sim's raw `blocked`
 * unconditionally, regardless of `hasArt`; a structure's own box is skipped
 * entirely when `hasArt` says so, rather than drawn and hidden -- is
 * testable under `environment: 'node'` the same way `structureFootprintsFor`
 * already is (`packages/app/src/terrain-parity.test.ts` constructs a real
 * `Sim` there; `ThreeRenderer` itself is the only thing in this file that
 * cannot exist under node, because it constructs a real
 * `THREE.WebGLRenderer`). A review of the task before this one named the
 * missing case directly: nothing previously caught a break that fed
 * `buildGround` the ART-MASKED blocked array instead of the raw one, which
 * would make an arted structure's own ground tile read as open instead of
 * `underBuilding`-washed the moment its sheet finished loading -- this
 * function's own shape (ground/scatter/groves built from the untouched
 * `input`, buildings alone built from a filtered view) is what a test can
 * now assert directly against a real `Sim` with `hasArt` both true and
 * false for the same structure.
 *
 * Buildings split three ways here, not built as one merged pass: `residual`
 * (the always-near-empty fallback layer, `withoutLiveStructures`'s own doc
 * comment), and one `ComposedBuildingBox` per live, un-arted structure --
 * each built by restricting `buildBuildings`'s walk to exactly that
 * structure's own tiles (`buildings.ts`'s own `tiles` parameter, this same
 * task). That split is what lets `ThreeRenderer.applyStructureHit` recompute
 * a SINGLE structure's box in O(its own footprint) rather than re-walking
 * the whole map -- see this task's report for the measured fraction.
 */
export function composeTerrain(
  sim: Sim,
  decor: Uint8Array | null,
  elevation: Uint8Array | null,
  hasArt: (structureId: string) => boolean,
  tones: TerrainTones,
  resolveColor: ((key: string) => string) | undefined,
  background: string
): ComposedTerrain {
  const input: TerrainInput = {
    width: sim.width,
    height: sim.height,
    decor,
    elevation,
    blocked: sim.blocked,
    cover: sim.cover,
  };
  const ground = buildGround(input, tones, background);
  const scatter = buildScatter(input, tones, background);
  const groves = buildGroves(input, tones, background);

  const footprints = walkStructureFootprints(sim);
  const residualInput: TerrainInput = { ...input, blocked: withoutLiveStructures(sim, footprints) };
  const residual = buildBuildings(residualInput, [], tones, resolveColor, background);

  const buildings: ComposedBuildingBox[] = [];
  for (const [structureIndex, footprint] of footprints) {
    if (hasArt(footprint.structureTypeId)) continue;
    buildings.push({
      structureIndex,
      tiles: footprint.tiles,
      mesh: buildBuildings(input, [footprint], tones, resolveColor, background, footprint.tiles),
    });
  }

  return { ground, scatter, groves, residual, buildings };
}
