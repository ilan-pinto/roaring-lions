/**
 * A pooled, MODELLED smoke plume -- `art/meshes/vfx/smoke_plume.glb`, three
 * stacked-slab zone meshes (`./smoke-plume-role.ts`) cut from a single
 * AI-generated (Meshy) column, disclosed per CONTRIBUTING.md. The THIRD
 * asset built on the shared "one supplied mesh, re-origined, split into
 * three zones, drawn through a pooled `InstancedMesh` per zone" recipe
 * `muzzle-flash.ts` established and `explosion-burst.ts` reused -- see this
 * task's report ("smoke-plume-report.md") for the full "what was reused vs
 * genuinely differs" account. This file states only what differs; where it
 * does not say otherwise, assume the burst's own reasoning applies
 * unchanged (both doc comments are written to be read side by side).
 *
 * ## The burst is the moment; this is the aftermath -- and that drives
 * every number below
 *
 * `explosion-burst.ts` lives for 450ms and grows-then-shrinks symmetrically
 * (`muzzleFlashEnvelope`, `sin(progress*PI)`) -- right for a detonation
 * that flashes and is gone inside half a second. A plume is not that: it
 * rises and PERSISTS, reading over SECONDS, not a fraction of one. Three
 * concrete consequences, none of which is a straight reuse of the burst's
 * own numbers:
 *
 *   - **Lifetime**: `SMOKE_PLUME_DEFAULT_DURATION_MS` is ~9x the burst's
 *     450ms -- see that constant's own doc comment for exactly where the
 *     number comes from (the same "authored particle layer's own
 *     `lifetime_ms` midpoint" pattern `EXPLOSION_BURST_DEFAULT_DURATION_MS`
 *     already established, applied to a NEW layer authored for this task).
 *   - **Envelope**: `smokePlumeRiseEnvelope` is a THREE-phase rise/hold/fade
 *     trapezoid, not the burst's one-phase symmetric arc -- see its own doc
 *     comment. A symmetric sin curve reused unmodified here would have the
 *     column already shrinking by the time it is half-risen, which reads as
 *     "collapsing," not "persisting."
 *   - **Capacity**: `SMOKE_PLUME_CAPACITY` is sized for how many plumes can
 *     be alive AT ONCE across a multi-SECOND window, not a multi-hundred-
 *     millisecond one -- see that constant's own doc comment for why this
 *     is a genuinely different budget question from the burst's, not a
 *     scaled copy of it.
 *
 * ## Splitting along the rise, not from a point
 *
 * The muzzle flash and the explosion burst both split their zones by 3D
 * DISTANCE from a point (`core`/`mid`/`outer`, concentric shells) -- correct
 * for a roughly blob-shaped effect, radially symmetric enough that "hottest
 * in the middle, cooler outward in every direction" is a coherent read. A
 * rising column is not that shape: there is no single point a plume
 * radiates from evenly in 3D. This asset splits along its own RISE axis
 * instead -- `base`/`mid`/`top`, three horizontal SLABS stacked by height,
 * built by `tools/export_mesh_vfx.py`'s `_height_split` (the axial sibling
 * of `_radial_split`, added for this task) rather than forcing a fourth
 * radial split through geometry that does not have a natural centre.
 *
 * The supplied `.blend` (`art/blend/smoke plume/
 * Meshy_AI_smoke_plume_0830172426_image-to-3d-texture.blend`) is one mesh,
 * `Mesh_0`, 3490 verts / 7002 tris / one material, local dims (X, Y, Z) =
 * (1.092, 0.317, 1.9061). Its own object origin already sits at its
 * bounding-box centre on all three axes (bbox min/max are exact negatives
 * of each other on X, Y AND Z) -- there was nothing to re-centre before
 * measuring an axis.
 *
 * ## Verifying the up-axis, per this task's own "do not assume" brief
 *
 * "A vertical plume may be exempt about its own axis but still needs its
 * up-axis confirmed. Verify, do not assume" -- so before anything else, a
 * 12-bin profile was run along EACH of local X, Y and Z (mean and max
 * cross-section radius per bin; this task's report has the full table).
 * Only Z shows the one-directional taper a rising column should have: mean
 * radius starts near a POINT at one extreme (bin0, mean r=0.025, the
 * smallest value in the entire table), grows through a bulge around 65-75%
 * of the way up (peak mean r=0.293 around local Z in [+0.318, +0.477]),
 * then narrows again toward the other extreme (bin11, mean r=0.133 -- still
 * ~5x the base, matching how real smoke fans out and fades rather than
 * converging back to a point at the top). X and Y both show a
 * NON-monotonic, roughly symmetric "cross-section" pattern instead (a dip
 * in the middle, a rise, a dip again) -- the shape a HORIZONTAL slice
 * through an irregular column produces, not a rise axis. Z's own span
 * (1.9061) also dwarfs X's (1.092) and Y's (0.317), matching "a column
 * reads much taller than it is wide" independent of the profile shape.
 * Conclusion, from measurement: local Z unambiguously the rise axis, and
 * since glTF export runs with `export_yup=True` (Blender Z -> three.js Y),
 * it is ALREADY the correct up axis. **No baked rotation was needed** --
 * but for a different reason than the explosion burst's own "no rotation
 * needed" finding. That asset's horizontal footprint is near-circular
 * (X/Y ratio 1.012), so no yaw orientation could read as "wrong" even in
 * principle. This asset's horizontal footprint is NOT circular (X/Y ratio
 * ~3.44:1 -- a genuinely elongated cross-section) -- what this asset was
 * exempt from is the UP-axis correction specifically, because Z already
 * measured out as the rise axis; a per-spawn cosmetic yaw (see
 * `ActiveSmokePlume.yawTurns`, mirroring the burst's own) still varies the
 * elongated footprint's horizontal orientation from spawn to spawn, so
 * repeated plumes do not all show the identical silhouette.
 *
 * The re-origin ANCHOR reuses `explosion_burst`'s own `"min_z"` strategy
 * unchanged (shift by `-bbox_min_z` along Z only, X/Y untouched) -- a
 * column plants at ground level and rises away from it, the identical
 * "where does this effect's local (0,0,0) belong" question the burst's own
 * top comment already answered the same way, for the same reason. Bottom
 * third of the re-origined height (Z in `[0, 0.6336)` of max Z 1.9008) is
 * `base`, middle third `mid`, top third `top` -- see `VfxMeshSpec.core_frac`'s
 * own doc comment in `export_mesh_vfx.py` for why EVEN thirds were chosen
 * over fractions tuned to the mesh's own geometric bulge (colour here reads
 * by HEIGHT, not by volume). Verified non-degenerate before export
 * (`--dry-run`): 1407/3039/2556 of 7002 triangles (20.1% / 43.4% / 36.5%)
 * -- every zone substantially populated, nothing near-empty the way the
 * muzzle flash's first attempted split at explosion-burst's geometry was.
 *
 * `art/meshes/vfx/smoke_plume.glb` carries zero materials
 * (`export_materials="NONE"`, matching every GLB in this pipeline) --
 * colour comes from `./smoke-plume-role.ts` at runtime, the same contract
 * every other VFX mesh in this backend uses.
 *
 * ## It shipped OPAQUE, and that was the whole defect
 *
 * Everything above describes the asset and is unchanged. What changed
 * (2026-09-02) is how it is SHADED and how it moves, and the reason is
 * worth stating plainly because the original choice looks reasonable in the
 * source and is wrong on screen. This class borrowed
 * `createVfxMeshMaterial` from the muzzle flash and the explosion burst --
 * the natural move, it is the shared recipe for "modelled, palette-shaded
 * VFX mesh" -- and that recipe pins every fragment's alpha to a literal
 * 1.0, on purpose, because a flash and a fireball EMIT light and an opaque
 * overwrite is what keeps them exactly on a `reserved.vfx` palette entry.
 * Smoke emits nothing. Photographed on `beit_sahwan_outskirts` at zoom 1.6,
 * a plume was a solid three-tone cardboard cutout with knife-edge zone
 * boundaries, drawn `depthTest: false` straight over the face of the
 * building it had just risen from, and it left by SHRINKING back into the
 * ground because opaque geometry has no other way to leave. See
 * `createSmokePlumeMaterial` and `smokePlumeRiseEnvelope` for the two
 * halves of the fix, and `.superpowers/queue/smoke-animation-report.md`
 * for the before/after frames.
 *
 * ## There IS one dense smoke effect, and it is deliberately not this one
 *
 * `SMOKE_PLUME_DENSITY` (0.62) is a ceiling on AMBIENT smoke and must stay
 * one: a plume lives four seconds over a wreck a player has to keep fighting
 * around, and the whole defect above was that it hid the building. But a
 * building's own moment of COLLAPSE does want opacity, because the
 * standing-mesh -> wreck-mesh swap is a hard cut that has to happen hidden.
 * That is `./collapse-shroud.ts` -- a separate, brief, locally opaque cloud
 * over one footprint, with its own material, its own palette family
 * (`ramps.dust`, not `ramps.gunmetal`) and its own pool. It touches nothing
 * in this file, and the two are spawned from the same event and play
 * together: the shroud covers the swap and clears inside 2.4 s, and this
 * column is what is still standing over the ruin afterwards.
 *
 * So if a plume ever looks too thin somewhere, check whether what is wanted
 * is a shroud before raising anything here.
 *
 * ## Colour runs the other way -- and does not use the `vfx` reserved band
 *
 * Fire grades white-hot -> fire -> ember: hottest at ignition, cooling
 * outward. Smoke has no hot core to grade FROM -- it should read as
 * densest (darkest) at its own base, nearest the fire or wreck it rises
 * from, THINNING (lightening) as it climbs and disperses. That is the
 * opposite direction, and it means a different palette family entirely:
 * `reserved.vfx` (`white_hot`/`fire`/`ember`/`interceptor`/`tracer`) is,
 * by its own `role` text in `data/palette.json`, "reserved so explosions
 * and tracers POP against desaturated terrain" -- saturated colour for a
 * MOMENTARY effect that wants to grab the eye. A plume is the opposite: an
 * ambient, lingering haze that should read as PART of a desaturated scene,
 * not compete with it. `./smoke-plume-role.ts` resolves every zone to a
 * `ramps.gunmetal` entry instead (`base` the ramp's own darkest, `top` its
 * lightest) -- see that file's own doc comment for the full argument,
 * including why `gunmetal` and not `shadow` (the other dark/neutral ramp),
 * and the existing `vehicle_exhaust.json` precedent for reading gunmetal as
 * vehicle smoke in this codebase already.
 *
 * ## Where this attaches, and how it pairs with the burst
 *
 * `structure_collapse.json` gained a new `smoke_puff`-sprite particle layer
 * for this task, marked `mesh_plume: true` (the `mesh_burst`/`mesh_flash`
 * pattern's third sibling) -- superseded by this mesh once loaded exactly
 * like those two, falling back to the authored particle otherwise (Pixi,
 * or three with the mesh not yet loaded). `spawnCollapseFx` spawns both the
 * burst AND the plume from the SAME `structureDestroyed` event -- checked
 * live (this task's report) that stacking the two reads as one coherent
 * detonation-then-smoke sequence rather than fighting: the plume's own
 * `SMOKE_PLUME_RISE_FRACTION` ramp means it is barely visible for the first
 * fraction of a second, so the burst's own near-instant flash is what
 * actually catches the eye first, with the column visibly climbing past it
 * as the fireball fades -- an emergent sequencing from each effect's own
 * envelope shape, not an explicit spawn-time delay (this backend has no
 * "delayed spawn" mechanism anywhere, and adding one for this alone was
 * judged not worth the machinery once the un-delayed pairing read
 * correctly on screen).
 *
 * A vehicle's own death (`ThreeRenderer.onEvents`' `destroyed` case, a
 * separate task layered onto this one) spawns the SAME pooled managers at
 * the killed entity's own position -- see that call site's own comment for
 * the hard-target gate and the power-from-max-HP scaling; nothing about
 * either manager itself changed to support a second call site, matching
 * this recipe's own "one pool, not one per trigger" shape.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { paletteColorNoConvert } from '../palette-material';
import {
  SMOKE_PLUME_ROLES,
  isSmokePlumeRole,
  smokePlumePaletteKey,
  type SmokePlumeRole,
} from './smoke-plume-role';
import { muzzleFlashPowerScale } from './muzzle-flash';
import { FX_RENDER_ORDER_ABOVE_ADDITIVE } from './render-order';

// ---------------------------------------------------------------------------
// Pure: geometry/matrix arithmetic, envelope maths, and the GLTF -> role-
// keyed-geometry extraction. Mirrors muzzle-flash.ts's and explosion-
// burst.ts's own top divider exactly, for the identical reason.
// ---------------------------------------------------------------------------

/**
 * Simultaneously-live modelled plumes this backend will draw, GLOBALLY --
 * the same "one pool, not one per trigger" shape every other VFX-mesh
 * manager in this backend uses.
 *
 * A genuinely different budget question from `EXPLOSION_BURST_CAPACITY`
 * (8), not a scaled copy of it: that number bounds concurrency across a
 * ~450ms WINDOW (how many buildings can finish collapsing within under
 * half a second of each other), which is why 8 -- "four times the largest
 * measured simultaneous-collapse count" -- was already generous. This
 * asset lives ~9x longer (`SMOKE_PLUME_DEFAULT_DURATION_MS`), so its own
 * concurrency bound is "how many vehicles or buildings can die within a
 * multi-SECOND window" -- a materially larger number in any real
 * engagement, and this asset now has TWO trigger sites (`structure_collapse`
 * and a vehicle's own death) rather than the burst's one. 16 -- matching
 * `MUZZLE_FLASH_CAPACITY`'s own "eight-tank company" scale rather than the
 * burst's narrower "at most two buildings" one -- comfortably covers a full
 * company's worth of near-simultaneous kills with real headroom. Cheap to
 * be generous regardless: one pooled `InstancedMesh` instance costs one 4x4
 * matrix (64 bytes) per zone per slot, so even 16 slots x 3 zones is 3KB,
 * the identical order of magnitude `MUZZLE_FLASH_CAPACITY`'s own doc
 * comment already accepts as immaterial. Unmeasured against an actual
 * multi-vehicle browser battle, the same honestly-flagged gap every other
 * capacity constant in this backend carries for its own number.
 */
export const SMOKE_PLUME_CAPACITY = 16;

/**
 * World-space (tile-unit) scale a plume's HEIGHT axis draws at when
 * `muzzleFlashPowerScale` and `smokePlumeRiseEnvelope` both read 1 -- i.e.
 * the largest scaling input (the biggest structure footprint, or a
 * `mbt_lavi`-class max-HP vehicle) at the exact peak of the hold phase.
 * Reused from the SAME "no sprite of this effect to size-match against, a
 * judgement call" honesty `MUZZLE_FLASH_BASE_SCALE`'s and
 * `EXPLOSION_BURST_BASE_SCALE`'s own doc comments already carry -- this is
 * a third instance of that same gap, not a new one.
 *
 * 0.8 is calibrated so a full-power plume reads roughly 3 tiles tall at
 * peak (`0.8 * muzzleFlashPowerScale(1) * 1.9061 = 0.8 * 2.0 * 1.9061 ≈
 * 3.05` tiles), comparable to but a little taller than
 * `EXPLOSION_BURST_BASE_SCALE`'s own ~3.4-tile-WIDE burst at peak --
 * appropriate for an effect that should visibly tower over the wreck it
 * rises from rather than merely matching the burst's own footprint.
 * Flagged, per CLAUDE.md's own "Approve art numbers before rendering" rule,
 * as unapproved beyond that arithmetic and the browser render this task's
 * report describes.
 */
export const SMOKE_PLUME_BASE_SCALE = 0.8;

/**
 * `structure_collapse.json`'s own new `mesh_plume: true` layer declares
 * `lifetime_ms: [3200, 4800]` -- this is that range's own midpoint, the
 * SAME "authored particle layer anchors the mesh's own fixed duration"
 * pattern `EXPLOSION_BURST_DEFAULT_DURATION_MS` already established
 * (see that constant's own doc comment). ~9x the burst's 450ms, which is
 * the point: "it rises and persists... reads over seconds," not a scaled
 * detonation.
 */
export const SMOKE_PLUME_DEFAULT_DURATION_MS = 4000;

/**
 * Fraction of a plume's own life spent RISING from nothing to its nominal
 * full height -- `smokePlumeRiseEnvelope`'s own first phase. Fast on
 * purpose: 15% of `SMOKE_PLUME_DEFAULT_DURATION_MS` is 600ms, well under a
 * second, so "it rises" reads as smoke visibly climbing rather than the
 * column popping in fully formed the way a symmetric burst-style envelope
 * would if reused here unmodified.
 */
export const SMOKE_PLUME_RISE_FRACTION = 0.15;

/**
 * Fraction of a plume's own life spent FADING OUT at the end --
 * `smokePlumeOpacity`'s own third phase, NOT a height ramp any more. See
 * that function's own doc comment for the change: a column that leaves by
 * shrinking is a column being sucked back into the ground, and that is
 * what the shipped envelope did. Deliberately much longer than
 * `SMOKE_PLUME_RISE_FRACTION` (35% vs 15%): real smoke billows up quickly
 * and then thins slowly, an asymmetric shape, not a mirror image of its own
 * rise.
 */
export const SMOKE_PLUME_FADE_FRACTION = 0.35;

/**
 * Extra height, as a fraction of the nominal full height, a plume gains
 * across the whole of the rest of its life once it has finished its initial
 * rise. Smoke does not reach a ceiling and stop; it keeps climbing while it
 * thins, so a flat hold at exactly 1 reads as a frozen prop the moment the
 * eye has anything else moving to compare it against. 0.35 is small enough
 * that the column never dwarfs the wreck it came from and large enough to
 * be unmistakable over the ~3.4 s the hold phase now lasts -- roughly one
 * extra tile of height on a full-power plume.
 */
export const SMOKE_PLUME_CLIMB = 0.35;

/**
 * FOOTPRINT (X/Z) scale at the instant a plume is born -- see
 * `smokePlumeSpread`, which ramps from here to `SMOKE_PLUME_SPREAD_MAX`
 * monotonically across the whole life. A real plume's cross-section does
 * not shrink toward zero the way its own height does at the very start, so
 * a bare `0..1` footprint would read as a column that vanishes to a literal
 * line rather than one that simply has not risen far yet.
 */
export const SMOKE_PLUME_FOOTPRINT_MIN = 0.4;

/**
 * FOOTPRINT (X/Z) scale at the end of life. Greater than 1 on purpose:
 * smoke DISPERSES, so the one thing its cross-section certainly does not do
 * is narrow back toward its birth width, which is exactly what the shipped
 * `smokePlumeFootprintScale(riseEnvelope)` did (it mirrored the height
 * envelope, so the last 25% of life ran the whole shape backwards). A
 * monotone widen paired with `smokePlumeOpacity`'s fade is the "thins and
 * spreads" read; the old pair was "shrinks and retracts".
 */
export const SMOKE_PLUME_SPREAD_MAX = 1.55;

/**
 * How far, in tiles, the TOP of a plume has leant downwind by the end of its
 * life (`smokePlumeLeanTiles`). Applied per zone through
 * `SMOKE_PLUME_ZONE_LEAN`, so the base stays planted on the wreck and the
 * column shears rather than sliding off it. 0.9 of a tile over four seconds
 * is a light breeze -- enough that the silhouette is visibly not the same
 * shape it was a second ago, nowhere near enough to read as a gale.
 */
export const SMOKE_PLUME_LEAN_TILES = 0.9;

/**
 * Which way "downwind" is, as a world `(x, z)` unit vector. NOT a new
 * choice: `terrain/mesh.ts`'s `groveMaterial` already leans every tree
 * along `(+wind, 0, -wind)`, "the SAME `(dx, -dx)` shape
 * `screenOffsetToWorld(dx, 0)` produces for a pure camera-right screen
 * offset". Smoke drifting the same way the trees lean reads as weather;
 * smoke drifting some other way reads as a bug in one of the two. Shared as
 * ONE bearing across every live plume for the same reason -- two columns a
 * few tiles apart leaning opposite ways is not variety, it is noise.
 */
export const SMOKE_PLUME_LEAN_DIR: readonly [number, number] = [Math.SQRT1_2, -Math.SQRT1_2];

/**
 * Per-zone share of `smokePlumeLeanTiles`' downwind offset. The base is
 * pinned at 0 -- it sits on the rubble and must not slide off it -- and the
 * top takes the whole of it, so the three stacked slabs describe a stepped
 * SHEAR rather than a rigid translation. This is the one thing the
 * three-zone split buys that a single-mesh plume could not have without a
 * vertex shader: each zone is already its own `InstancedMesh` with its own
 * `setMatrixAt`, so a per-zone offset is free.
 *
 * `mid` at 0.45 rather than the geometric 0.5: the mid slab spans local Z
 * [0.63, 1.28] of a 1.91-tall column and its VISUAL mass sits low in that
 * span (it is the widest zone, 43% of the triangles), so weighting it by
 * its own centroid rather than its midpoint keeps the shear reading as a
 * smooth curve instead of a kink.
 */
export const SMOKE_PLUME_ZONE_LEAN: Readonly<Record<SmokePlumeRole, number>> = {
  base: 0,
  mid: 0.45,
  top: 1,
};

/**
 * How far a plume turns about its own rise axis, in turns, across a full
 * life. The mesh's horizontal cross-section is genuinely elongated (X/Z
 * ~3.44:1, this file's own top comment), so a FIXED yaw makes the column a
 * cardboard cutout: the silhouette you see at t=0 is the silhouette you see
 * at t=4s, on a camera that never orbits. An eighth of a turn is enough for
 * the outline to visibly reshape without the column ever appearing to
 * spin.
 */
export const SMOKE_PLUME_YAW_DRIFT_TURNS = 0.125;

/**
 * A plume's HEIGHT (Y) scale over its life -- `progress` is
 * `ageMs / durationMs`, clamped to [0, 1] for the identical boundary-safety
 * reason `muzzleFlashEnvelope` clamps it.
 *
 *   - `progress < SMOKE_PLUME_RISE_FRACTION`: linear ramp 0 -> 1 (rising).
 *   - afterwards: keeps climbing, linearly, to `1 + SMOKE_PLUME_CLIMB` at
 *     the exact end of life.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WRONG. The shipped version was a
 * rise/hold/fade trapezoid whose third phase ramped the HEIGHT back to 0
 * over the last 25% of life. On screen that is not a plume dispersing, it
 * is a plume being pulled back down into the ground it came out of --
 * photographed on `beit_sahwan_outskirts` (this task's report), the column
 * visibly retracts, and because the same value also drove the footprint
 * (`smokePlumeFootprintScale`) the whole shape ran backwards at once. Smoke
 * leaves by thinning, so leaving is now `smokePlumeOpacity`'s job and this
 * function is monotone non-decreasing for its whole domain.
 */
export function smokePlumeRiseEnvelope(progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  if (p < SMOKE_PLUME_RISE_FRACTION) return p / SMOKE_PLUME_RISE_FRACTION;
  return 1 + SMOKE_PLUME_CLIMB * ((p - SMOKE_PLUME_RISE_FRACTION) / (1 - SMOKE_PLUME_RISE_FRACTION));
}

/**
 * A plume's own opacity multiplier over its life, `[0, 1]` -- fades IN
 * across the same window the rise uses (so the column is not stamped onto
 * the frame at full density on the frame the building dies), holds, then
 * dissolves smoothly to exactly 0 across `SMOKE_PLUME_FADE_FRACTION`.
 *
 * This is what makes a plume LEAVE, and it is new: before it, the mesh was
 * drawn through `createVfxMeshMaterial`, whose fragment shader pins alpha
 * to a literal 1.0. Nothing in the shipped plume could be partly
 * transparent at any point in its life, so the only disappearance mechanism
 * available was shrinking the geometry -- see `smokePlumeRiseEnvelope`'s own
 * doc comment for what that looked like.
 *
 * The fade is smoothstepped rather than linear so the last visible frames
 * thin out instead of stepping off; the rise is linear so it matches the
 * height ramp exactly and the two cannot disagree about when "risen" is.
 */
export function smokePlumeOpacity(progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  if (p < SMOKE_PLUME_RISE_FRACTION) return p / SMOKE_PLUME_RISE_FRACTION;
  const fadeStart = 1 - SMOKE_PLUME_FADE_FRACTION;
  if (p <= fadeStart) return 1;
  const t = (1 - p) / SMOKE_PLUME_FADE_FRACTION;
  return t * t * (3 - 2 * t);
}

/**
 * A plume's FOOTPRINT (X/Z) scale over its life -- a monotone widen from
 * `SMOKE_PLUME_FOOTPRINT_MIN` at birth to `SMOKE_PLUME_SPREAD_MAX` at
 * death. Takes `progress` directly rather than the height envelope's own
 * output (as `smokePlumeFootprintScale` did), because the two curves no
 * longer have the same shape and deriving one from the other is exactly how
 * the footprint ended up running backwards for the last quarter of every
 * plume's life.
 */
export function smokePlumeSpread(progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return SMOKE_PLUME_FOOTPRINT_MIN + p * (SMOKE_PLUME_SPREAD_MAX - SMOKE_PLUME_FOOTPRINT_MIN);
}

/**
 * How far downwind (in tiles) a plume's TOP has drifted at `progress` --
 * linear, because a parcel of smoke in a steady breeze keeps moving at the
 * breeze's speed rather than easing to a halt. Multiplied by
 * `SMOKE_PLUME_ZONE_LEAN[role]` and `SMOKE_PLUME_LEAN_DIR` at the call
 * site.
 */
export function smokePlumeLeanTiles(progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return SMOKE_PLUME_LEAN_TILES * p;
}

/**
 * One zone's world `(dx, dz)` downwind offset at `progress` -- its share of
 * `smokePlumeLeanTiles` along `SMOKE_PLUME_LEAN_DIR`. Split out of `step()`
 * so the shear is a pure function a test can walk without a
 * `WebGLRenderer`; the manager does nothing with the result but add it to
 * the plume's own anchor.
 */
export function smokePlumeZoneOffset(role: SmokePlumeRole, progress: number): readonly [number, number] {
  const share = SMOKE_PLUME_ZONE_LEAN[role] * smokePlumeLeanTiles(progress);
  return [SMOKE_PLUME_LEAN_DIR[0] * share, SMOKE_PLUME_LEAN_DIR[1] * share];
}

/**
 * A plume's yaw in turns at `progress`: its own per-spawn cosmetic seed
 * (`ActiveSmokePlume.yawTurns`) plus a slow drift so the elongated
 * cross-section keeps presenting a changing outline. Returns turns, not
 * radians -- the caller multiplies by 2*PI, matching `ActiveSmokePlume
 * .yawTurns`' own unit.
 */
export function smokePlumeYawTurns(seedTurns: number, progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return seedTurns + SMOKE_PLUME_YAW_DRIFT_TURNS * p;
}

/** One loaded `art/meshes/vfx/smoke_plume.glb`, kept as the source geometry
 *  every pooled `InstancedMesh` instance below draws through -- mirrors
 *  `ExplosionBurstTemplate` exactly. */
export interface SmokePlumeTemplate {
  readonly geometries: Readonly<Record<SmokePlumeRole, THREE.BufferGeometry>>;
}

/**
 * Assembles a `SmokePlumeTemplate` from an already-parsed `GLTF` result --
 * mirrors `buildExplosionBurstTemplate` exactly, including its own
 * loud-failure contract on an unrecognised or missing zone; see that
 * function's own doc comment for the full argument (unchanged here, this is
 * the identical shape applied to the smoke-plume's own closed role
 * vocabulary).
 */
export function buildSmokePlumeTemplate(gltf: Pick<GLTF, 'scene'>): SmokePlumeTemplate {
  const found: Partial<Record<SmokePlumeRole, THREE.BufferGeometry>> = {};
  const unmapped = new Set<string>();

  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const extrasRole = (mesh.userData as { rl_role?: unknown }).rl_role;
    const role = typeof extrasRole === 'string' && extrasRole.length > 0 ? extrasRole : mesh.name;
    if (!isSmokePlumeRole(role)) {
      unmapped.add(role || '(unnamed mesh)');
      return;
    }
    found[role] = mesh.geometry;
  });

  if (unmapped.size > 0) {
    throw new Error(`smoke-plume: no role for mesh(es) ${[...unmapped].join(', ')} -- not in the closed smoke-plume role vocabulary`);
  }
  for (const role of SMOKE_PLUME_ROLES) {
    if (!found[role]) throw new Error(`smoke-plume: GLB is missing the "${role}" zone mesh`);
  }
  return { geometries: found as Record<SmokePlumeRole, THREE.BufferGeometry> };
}

/** Fetches and parses `glbUrl`, then builds a `SmokePlumeTemplate` --
 *  mirrors `loadExplosionBurstTemplate` exactly. */
export async function loadSmokePlumeTemplate(glbUrl: string): Promise<SmokePlumeTemplate> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  return buildSmokePlumeTemplate(gltf);
}

/** One active, pooled plume instance -- `x`/`y`/`z` are real three.js WORLD
 *  coordinates, exactly like `ActiveExplosionBurst`. `yawTurns` is cosmetic
 *  only, the identical reasoning that file gives -- UNLIKE the burst
 *  (near-circular footprint, so yaw is invisible either way), this mesh's
 *  own footprint genuinely IS elongated (X/Z aspect ~3.44:1, see this
 *  file's own top comment), so `yawTurns` here visibly varies which way the
 *  column's own long axis points from spawn to spawn -- still never
 *  sim-derived, the caller is expected to derive it from the presentation
 *  PRNG/hash exactly like every other scatter effect in this renderer. */
interface ActiveSmokePlume {
  x: number;
  y: number;
  z: number;
  yawTurns: number;
  power: number;
  ageMs: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// GPU-facing.
// ---------------------------------------------------------------------------

/** Shared rotation axis for `SmokePlumeManager.step`'s per-instance yaw --
 *  mirrors `explosion-burst.ts`'s own module-level `Y_AXIS`. */
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Peak alpha of the densest fragment of a plume -- the base zone, seen
 * face-on, at the height of the hold phase. Well under 1 on purpose: this
 * is the whole of the defect this task was sent to chase.
 *
 * `createVfxMeshMaterial` (`./vfx-mesh-material.ts`), which this mesh used
 * to draw through, writes `gl_FragColor = vec4(uColor, 1.0)` -- a flat,
 * unlit, forced-OPAQUE fill. That recipe is right for what it was written
 * for: a muzzle flash and an explosion fireball are things that EMIT light,
 * and an opaque overwrite is what keeps every one of their fragments
 * exactly on a `reserved.vfx` palette entry. Smoke emits nothing. Drawn
 * through the same recipe, with `depthTest: false` on top of it, a plume is
 * a solid three-tone cardboard cutout stamped over whatever is behind it --
 * photographed on `beit_sahwan_outskirts` at zoom 1.6, it hides the
 * building it rose from completely, and its three zones meet at knife
 * edges. 0.62 is a judgement call in the same sense
 * `SMOKE_PLUME_BASE_SCALE` is, but it is anchored: `SMOKE_ALPHA_MAX`
 * (`../smoke-mesh.ts`) is 0.72 for the sim's own smoke screen, which is
 * denser than a dispersing plume should be and is the ceiling this stays
 * under.
 */
export const SMOKE_PLUME_DENSITY = 0.62;

/**
 * How much of the `|N.V|` range the silhouette fade spends going from fully
 * transparent to fully dense. Fragments whose normal is perpendicular to
 * the view (`|N.V| -> 0`) are the mesh's own OUTLINE, and a hull's outline
 * is exactly where a real volume of smoke is thinnest -- you are looking
 * through the least of it there. Fading them out is what turns a solid hull
 * into something that reads as a volume; it is the same geometric fact
 * `units/silhouette.ts` exploits from the other direction (that file WIDENS
 * the grazing band to draw an outline; this one erases it).
 *
 * `camera.ts`'s `dimetricCamera` is an `OrthographicCamera`, so the view
 * direction is the constant view-space +Z for every fragment on screen and
 * `abs(viewNormal.z)` IS `|N.V|` with no per-vertex view vector to compute.
 * That is not a shortcut taken on a perspective camera and hoped for; it is
 * exact for this one, and it is the reason the vertex stage below is three
 * lines rather than six.
 *
 * 0.55 is broad -- more than half the range is fade -- because the plume is
 * a lumpy AI-generated hull with a lot of near-grazing area, and a narrow
 * band (0.15, tried first) left a hard-edged core with a thin halo, which
 * is a cutout with a fringe rather than a volume.
 */
export const SMOKE_PLUME_EDGE_SOFTNESS = 0.55;

/**
 * Density multiplier at the very TOP of the column relative to its base --
 * smoke thins as it climbs and disperses. Applied continuously from the
 * mesh's own object-space height, so it grades ACROSS the base/mid/top zone
 * boundaries rather than stepping at them: the three zones each carry one
 * flat palette entry (`smoke-plume-role.ts` -- colour must stay quantised,
 * so it cannot be interpolated), and without this the boundary between two
 * of those flat bands is a visible horizontal line across the column.
 * Alpha is not palette-quantised and can grade freely, so it is what
 * dissolves the seam.
 */
export const SMOKE_PLUME_TOP_DENSITY = 0.4;

/**
 * The soft, translucent material every plume zone draws through -- a
 * deliberate fork of `createVfxMeshMaterial` rather than a parameter added
 * to it, because the two recipes now disagree about the one thing that
 * recipe exists to guarantee (an opaque, exactly-on-palette overwrite). See
 * `SMOKE_PLUME_DENSITY` for the measured reason.
 *
 * Three channels multiply into the fragment's alpha, and each answers a
 * different question:
 *
 *   - `vFacing` (silhouette fade): how much smoke is this pixel looking
 *     through? See `SMOKE_PLUME_EDGE_SOFTNESS`.
 *   - `vHeight` (dispersal fade): how far up the column is this pixel? See
 *     `SMOKE_PLUME_TOP_DENSITY`.
 *   - `aOpacity` (life fade): how far through its life is this plume? See
 *     `smokePlumeOpacity`. Per INSTANCE, so one pooled `InstancedMesh` can
 *     hold plumes of different ages, which is the whole point of the pool.
 *
 * `uColor` is still one flat `data/palette.json` entry per zone, resolved
 * by `setColors` exactly as before -- nothing about the palette contract
 * changes here. What changes is that the fragment is now allowed to be
 * partly transparent, so what lands on screen is a BLEND of that entry with
 * whatever is behind it. That is the same latitude `../smoke-mesh.ts`
 * already takes for the sim's own smoke screen at `SMOKE_ALPHA_MAX` 0.72
 * and every `alpha_over_life` particle takes for its own fade: the palette
 * rule governs where a colour comes from, not whether it may be composited.
 *
 * The instance normal correction is exact rather than approximate and needs
 * to be: `step()` composes a NON-UNIFORM scale (footprint and height run on
 * different curves), and `mat3(instanceMatrix) * normal` under a
 * non-uniform scale points somewhere the surface does not face -- which
 * would make the silhouette fade land in the wrong place and read as
 * blotches. For `M = R*S` with `S` diagonal, the correct normal transform
 * is `R*S^-1`, and since `R = M*S^-1` that is `M * (n / s^2)` with `s` the
 * per-column length of `mat3(M)` -- three lines, no `inverse()` (which
 * WebGL1 does not have), no extra attribute.
 */
export function createSmokePlumeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0, 0, 0) },
      /** Object-space height of the WHOLE column (all three zones), so
       *  `vHeight` is continuous across the zone boundaries rather than
       *  restarting at 0 in each slab. Set by `SmokePlumeManager.load`
       *  from the loaded geometry, never guessed. */
      uHeight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aOpacity;
      uniform float uHeight;
      varying float vFacing;
      varying float vHeight;
      varying float vOpacity;
      void main() {
        mat3 im = mat3(instanceMatrix);
        vec3 s = vec3(length(im[0]), length(im[1]), length(im[2]));
        vec3 worldNormal = im * (normal / max(s * s, vec3(1e-6)));
        vec3 viewNormal = normalize(mat3(modelViewMatrix) * worldNormal);
        // Orthographic camera: the view direction is a constant view-space
        // +Z, so |N.V| is exactly abs(viewNormal.z).
        vFacing = abs(viewNormal.z);
        vHeight = clamp(position.y / uHeight, 0.0, 1.0);
        vOpacity = aOpacity;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vFacing;
      varying float vHeight;
      varying float vOpacity;
      void main() {
        float rim = smoothstep(0.0, ${SMOKE_PLUME_EDGE_SOFTNESS.toFixed(2)}, vFacing);
        float thin = mix(1.0, ${SMOKE_PLUME_TOP_DENSITY.toFixed(2)}, vHeight);
        float a = ${SMOKE_PLUME_DENSITY.toFixed(2)} * vOpacity * rim * thin;
        if (a <= 0.0) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    // Unchanged from the recipe this forks: an `above_units`, additive-tier
    // effect is an unconditional pass, never hidden behind a unit or
    // terrain (`FX_RENDER_ORDER_ABOVE_ADDITIVE`'s own row in
    // `render-order.ts`). It matters far less now than it did -- an opaque
    // pass over a building is a decal, a 0.62-alpha pass over one is smoke
    // in front of it.
    depthTest: false,
    depthWrite: false,
    // FrontSide, as before. The three zones are open shells cut out of one
    // hull by triangle assignment (`_height_split`, no caps are generated),
    // so there is no interior surface for a back face to reveal, and
    // culling them halves the blended fragment count.
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
  });
}

/** Object-space height of the whole column: the largest local Y any zone
 *  reaches. Measured off the loaded geometry rather than hardcoded from the
 *  `.blend` (1.9061) so a re-export that changes the mesh's proportions
 *  cannot silently leave the dispersal fade calibrated to the old one. */
export function smokePlumeMeshHeight(
  geometries: Readonly<Record<SmokePlumeRole, THREE.BufferGeometry>>
): number {
  let maxY = 0;
  for (const role of SMOKE_PLUME_ROLES) {
    const geo = geometries[role];
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (box && box.max.y > maxY) maxY = box.max.y;
  }
  return maxY > 0 ? maxY : 1;
}

/**
 * Owns the three pooled `InstancedMesh` zones (`base`/`mid`/`top`) and the
 * active-plume bookkeeping that drives them -- mirrors `ExplosionBurstManager`
 * in SHAPE (two-phase construction, oldest-evicted bounded pool, one
 * `step()` a frame; see that class's own doc comment for the full
 * reasoning, which applies here unchanged) but NOT in its per-instance
 * transform: `step()` below composes a NON-UNIFORM scale (height and
 * footprint driven by related but different curves, see
 * `smokePlumeRiseEnvelope`/`smokePlumeFootprintScale`), where the burst and
 * the muzzle flash both use one uniform scalar. This class states only
 * what differs; its own capacity/scale/duration/envelope constants above
 * have the full reasoning.
 */
export class SmokePlumeManager {
  private readonly capacity: number;
  private readonly materials: Readonly<Record<SmokePlumeRole, THREE.ShaderMaterial>>;
  private meshes: Readonly<Record<SmokePlumeRole, THREE.InstancedMesh>> | null = null;
  /** `createSmokePlumeMaterial`'s `aOpacity`, one attribute per zone --
   *  every zone of one plume shares the same value (it is a property of the
   *  plume's age, not of the slab), but an `InstancedBufferAttribute`
   *  belongs to a geometry and each zone has its own. */
  private opacityAttrs: Readonly<Record<SmokePlumeRole, THREE.InstancedBufferAttribute>> | null = null;
  private readonly active: ActiveSmokePlume[] = [];
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();

  constructor(capacity = SMOKE_PLUME_CAPACITY) {
    this.capacity = capacity;
    this.materials = {
      base: createSmokePlumeMaterial(),
      mid: createSmokePlumeMaterial(),
      top: createSmokePlumeMaterial(),
    };
  }

  /** True once `load()` has resolved -- mirrors `ExplosionBurstManager.ready`. */
  get ready(): boolean {
    return this.meshes !== null;
  }

  /** Resolves this manager's three fixed palette keys through `resolve` and
   *  copies the result into each zone's own `uColor` uniform, in place --
   *  mirrors `ExplosionBurstManager.setColors` exactly. */
  setColors(resolve: (key: string) => string): void {
    for (const role of SMOKE_PLUME_ROLES) {
      const color = paletteColorNoConvert(resolve(smokePlumePaletteKey(role)));
      (this.materials[role].uniforms.uColor.value as THREE.Color).copy(color);
    }
  }

  /**
   * Loads `art/meshes/vfx/smoke_plume.glb`, builds the three pooled
   * `InstancedMesh` zones around it, and returns them so the caller can add
   * them to its own scene graph -- mirrors `ExplosionBurstManager.load`
   * exactly.
   */
  async load(glbUrl: string): Promise<THREE.Object3D[]> {
    const template = await loadSmokePlumeTemplate(glbUrl);
    // One height for all three zones, measured off the loaded geometry --
    // see `smokePlumeMeshHeight`.
    const height = smokePlumeMeshHeight(template.geometries);
    const partial: Partial<Record<SmokePlumeRole, THREE.InstancedMesh>> = {};
    const attrs: Partial<Record<SmokePlumeRole, THREE.InstancedBufferAttribute>> = {};
    for (const role of SMOKE_PLUME_ROLES) {
      const geometry = template.geometries[role];
      const opacity = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
      geometry.setAttribute('aOpacity', opacity);
      attrs[role] = opacity;
      this.materials[role].uniforms.uHeight.value = height;
      const mesh = new THREE.InstancedMesh(geometry, this.materials[role], this.capacity);
      mesh.count = 0;
      mesh.renderOrder = FX_RENDER_ORDER_ABOVE_ADDITIVE;
      mesh.frustumCulled = false;
      partial[role] = mesh;
    }
    const meshes = partial as Record<SmokePlumeRole, THREE.InstancedMesh>;
    this.meshes = meshes;
    this.opacityAttrs = attrs as Record<SmokePlumeRole, THREE.InstancedBufferAttribute>;
    return SMOKE_PLUME_ROLES.map((role) => meshes[role]);
  }

  /**
   * Spawns one plume at world `(x, y, z)`, sized by `power` (0..1, fed
   * through the SAME `muzzleFlashPowerScale` law the burst and the muzzle
   * flash both use -- reused, not reinvented, since only the ENVELOPE
   * shape genuinely differs for this asset, not the "magnitude -> size
   * multiplier" law itself) and living for `durationMs`. `yawTurns` is
   * cosmetic only -- see `ActiveSmokePlume`'s own doc comment. A no-op
   * below zero duration, matching every other manager's identical guard.
   * Over capacity, drops the OLDEST active plume first, the same eviction
   * rule every other pooled manager in this backend uses.
   */
  spawn(x: number, y: number, z: number, yawTurns: number, power: number, durationMs: number): void {
    if (durationMs <= 0) return;
    if (this.active.length >= this.capacity) this.active.shift();
    this.active.push({ x, y, z, yawTurns, power, ageMs: 0, durationMs });
  }

  /**
   * Ages every active plume by `dtMs`, retires any past its own
   * `durationMs`, and rewrites all three `InstancedMesh`es' instance
   * matrices from what remains -- mirrors `ExplosionBurstManager.step` in
   * shape, but composes a NON-UNIFORM scale: height (`Y`) from
   * `smokePlumeRiseEnvelope` directly, footprint (`X`/`Z`) from
   * `smokePlumeFootprintScale` of that SAME envelope value (one curve
   * computed once per active plume per frame, remapped two different ways
   * -- not two independent curves). The burst and the muzzle flash both
   * scale all three axes identically because growing/shrinking a roughly
   * spherical blob uniformly is the physically sensible read; a column
   * growing TALLER is not the same event as a column growing WIDER, so
   * this asset needed the split its own top comment already argues for.
   *
   * Each zone now gets its OWN matrix rather than the same one three times:
   * `SMOKE_PLUME_ZONE_LEAN` shears the column downwind with age, base
   * pinned, top carrying the whole offset. That is the one thing the
   * three-zone split buys here that a single mesh could not have had
   * without a vertex shader, and it costs one `Vector3.set` per zone per
   * plume per frame.
   */
  step(dtMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.ageMs += dtMs;
      if (p.ageMs >= p.durationMs) this.active.splice(i, 1);
    }
    if (!this.meshes || !this.opacityAttrs) return;
    const meshes = this.meshes;
    const opacityAttrs = this.opacityAttrs;
    for (const role of SMOKE_PLUME_ROLES) meshes[role].count = this.active.length;
    for (let i = 0; i < this.active.length; i++) {
      const p = this.active[i];
      const progress = p.ageMs / p.durationMs;
      const magnitude = SMOKE_PLUME_BASE_SCALE * muzzleFlashPowerScale(p.power);
      const heightScale = magnitude * smokePlumeRiseEnvelope(progress);
      const footprintScale = magnitude * smokePlumeSpread(progress);
      const opacity = smokePlumeOpacity(progress);
      this.scratchQuat.setFromAxisAngle(Y_AXIS, smokePlumeYawTurns(p.yawTurns, progress) * Math.PI * 2);
      this.scratchScale.set(footprintScale, heightScale, footprintScale);
      for (const role of SMOKE_PLUME_ROLES) {
        const [dx, dz] = smokePlumeZoneOffset(role, progress);
        this.scratchPos.set(p.x + dx, p.y, p.z + dz);
        this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
        meshes[role].setMatrixAt(i, this.scratchMatrix);
        (opacityAttrs[role].array as Float32Array)[i] = opacity;
      }
    }
    for (const role of SMOKE_PLUME_ROLES) {
      meshes[role].instanceMatrix.needsUpdate = true;
      opacityAttrs[role].needsUpdate = true;
    }
  }

  /** Releases every zone's own material; geometry is released too, but only
   *  once loaded -- mirrors `ExplosionBurstManager.dispose` exactly. */
  dispose(): void {
    if (this.meshes) {
      for (const role of SMOKE_PLUME_ROLES) this.meshes[role].geometry.dispose();
    }
    for (const role of SMOKE_PLUME_ROLES) this.materials[role].dispose();
  }

  /** Test/debug hook: how many plumes are currently alive. */
  get liveCount(): number {
    return this.active.length;
  }
}
