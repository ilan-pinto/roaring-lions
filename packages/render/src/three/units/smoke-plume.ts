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
import { createVfxMeshMaterial } from './vfx-mesh-material';
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
 * Fraction of a plume's own life spent RISING from nothing to full height
 * -- `smokePlumeRiseEnvelope`'s own first phase. Fast on purpose: 15% of
 * `SMOKE_PLUME_DEFAULT_DURATION_MS` is 600ms, well under a second, so "it
 * rises" reads as smoke visibly climbing rather than the column popping in
 * fully formed the way a symmetric burst-style envelope would if reused
 * here unmodified.
 */
export const SMOKE_PLUME_RISE_FRACTION = 0.15;

/**
 * Fraction of a plume's own life spent FADING back down at the end --
 * `smokePlumeRiseEnvelope`'s own third phase. Deliberately LONGER than
 * `SMOKE_PLUME_RISE_FRACTION` (25% vs 15%): real smoke billows up quickly
 * and then drifts and thins slowly, an asymmetric shape, not a mirror image
 * of its own rise. The remaining 60% of life (`1 - RISE - FADE`) is held at
 * full height -- "it persists".
 */
export const SMOKE_PLUME_FADE_FRACTION = 0.25;

/**
 * Floor for the FOOTPRINT (X/Z) scale multiplier, as a fraction of the
 * height-axis envelope -- see `smokePlumeFootprintScale`'s own doc comment
 * for why the footprint is driven by the SAME envelope value as height but
 * remapped into a narrower range rather than a second, independent curve: a
 * real plume's cross-section does not shrink toward zero the way its own
 * height does at the very start/end of its life, so a bare `0..1` footprint
 * scale (mirroring height exactly) would read as a column that vanishes to
 * a literal line rather than one that simply has not risen far yet. 0.4
 * keeps SOME footprint visible throughout -- a judgement call, not a
 * measured fact, same honesty as this file's other authored constants.
 */
export const SMOKE_PLUME_FOOTPRINT_MIN = 0.4;

/**
 * Three-phase rise/hold/fade trapezoid for a plume's own HEIGHT (Y) scale
 * over its life -- `progress` is `ageMs / durationMs`, clamped to [0, 1]
 * for the identical boundary-safety reason `muzzleFlashEnvelope` clamps it.
 * NOT a reuse of that function: `muzzleFlashEnvelope`'s symmetric
 * `sin(progress*PI)` peaks at the exact midpoint and is already shrinking
 * by 50% life -- correct for a burst that detonates and dissipates within
 * half a second, wrong for a column meant to persist near full height for
 * MOST of a multi-second life. This file's own top comment ("The burst is
 * the moment; this is the aftermath") has the full argument for why this
 * needed its own shape rather than a retuned copy of the burst's.
 *
 *   - `progress < SMOKE_PLUME_RISE_FRACTION`: linear ramp 0 -> 1 (rising).
 *   - `progress > 1 - SMOKE_PLUME_FADE_FRACTION`: linear ramp 1 -> 0
 *     (fading, over a LONGER window than the rise -- see that constant's
 *     own doc comment).
 *   - otherwise: held at 1 (persisting).
 */
export function smokePlumeRiseEnvelope(progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  if (p < SMOKE_PLUME_RISE_FRACTION) return p / SMOKE_PLUME_RISE_FRACTION;
  const fadeStart = 1 - SMOKE_PLUME_FADE_FRACTION;
  if (p > fadeStart) return (1 - p) / SMOKE_PLUME_FADE_FRACTION;
  return 1;
}

/**
 * The height envelope's own value, remapped into `[SMOKE_PLUME_FOOTPRINT_MIN,
 * 1]` for the FOOTPRINT (X/Z) scale -- driven by the same rise/hold/fade
 * shape as height (so the footprint still grows as the column establishes
 * and settles as it fades) but never collapsing all the way to zero, unlike
 * height (which legitimately reads as "nothing has risen yet" at
 * `progress=0`). See `SMOKE_PLUME_FOOTPRINT_MIN`'s own doc comment for why
 * a bare `0..1` footprint would read wrong at the very start/end of life.
 */
export function smokePlumeFootprintScale(riseEnvelope: number): number {
  return SMOKE_PLUME_FOOTPRINT_MIN + riseEnvelope * (1 - SMOKE_PLUME_FOOTPRINT_MIN);
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
  private readonly active: ActiveSmokePlume[] = [];
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();

  constructor(capacity = SMOKE_PLUME_CAPACITY) {
    this.capacity = capacity;
    this.materials = {
      base: createVfxMeshMaterial(),
      mid: createVfxMeshMaterial(),
      top: createVfxMeshMaterial(),
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
    const partial: Partial<Record<SmokePlumeRole, THREE.InstancedMesh>> = {};
    for (const role of SMOKE_PLUME_ROLES) {
      const mesh = new THREE.InstancedMesh(template.geometries[role], this.materials[role], this.capacity);
      mesh.count = 0;
      mesh.renderOrder = FX_RENDER_ORDER_ABOVE_ADDITIVE;
      mesh.frustumCulled = false;
      partial[role] = mesh;
    }
    const meshes = partial as Record<SmokePlumeRole, THREE.InstancedMesh>;
    this.meshes = meshes;
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
   */
  step(dtMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.ageMs += dtMs;
      if (p.ageMs >= p.durationMs) this.active.splice(i, 1);
    }
    if (!this.meshes) return;
    const meshes = this.meshes;
    for (const role of SMOKE_PLUME_ROLES) meshes[role].count = this.active.length;
    for (let i = 0; i < this.active.length; i++) {
      const p = this.active[i];
      const progress = p.ageMs / p.durationMs;
      const magnitude = SMOKE_PLUME_BASE_SCALE * muzzleFlashPowerScale(p.power);
      const rise = smokePlumeRiseEnvelope(progress);
      const heightScale = magnitude * rise;
      const footprintScale = magnitude * smokePlumeFootprintScale(rise);
      this.scratchPos.set(p.x, p.y, p.z);
      this.scratchQuat.setFromAxisAngle(Y_AXIS, p.yawTurns * Math.PI * 2);
      this.scratchScale.set(footprintScale, heightScale, footprintScale);
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      for (const role of SMOKE_PLUME_ROLES) meshes[role].setMatrixAt(i, this.scratchMatrix);
    }
    for (const role of SMOKE_PLUME_ROLES) meshes[role].instanceMatrix.needsUpdate = true;
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
