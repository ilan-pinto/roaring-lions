/**
 * A pooled, MODELLED muzzle flash -- `art/meshes/vfx/muzzle_flash.glb`,
 * three concentric zone meshes (`./muzzle-flash-role.ts`) cut from a single
 * AI-generated (Meshy) blob, disclosed per CONTRIBUTING.md. Replaces the
 * hot-core PARTICLE layer a `weapon_fire` emitter can mark with the new
 * `mesh_flash` field (`ParticleSpec.mesh_flash`, `../../vfx/emitters.ts`) --
 * see `data/vfx/fire_apfsds.json` for the one shipped layer that opts in,
 * and this file's own "What this replaces" section below for why only that
 * one layer, not the whole emitter.
 *
 * ## Why a mesh at all: the palette constraint particles could not clear
 *
 * `units/fx.ts`'s own "hotCore" doc comment (`createParticleMaterial`) is
 * the precedent this whole file leans on: real `THREE.AdditiveBlending`
 * (`ONE, ONE`) was tried for a bright muzzle core and REJECTED, because the
 * GPU blend stage runs after the fragment shader and sums two on-palette
 * colours into a third the palette does not name (`#FFFFFF` has zero hits
 * in `data/palette.json`). The fix that shipped there pins every hotCore
 * fragment's alpha to 1 -- an opaque overwrite, not a sum -- which keeps
 * every fragment on-palette but has a real, acknowledged ceiling: "no
 * arrangement of hotCore particles can look brighter than vfx.white_hot
 * itself... a cluster of overlapping particles reads as a solid patch...
 * not a blown-out white beyond it" AND, separately, a shape ceiling: small
 * discs read as small discs, however many of them overlap. `fire_apfsds`
 * turning its `soft_dot` sizes down to `size_px: [8, 14]` so the gradient
 * "emerges from spatial arrangement instead" is exactly this second limit
 * showing -- a cluster of circles cannot draw a flash SILHOUETTE, only a
 * blob of circles.
 *
 * A modelled flash sidesteps the question a different way: its shape lives
 * in GEOMETRY, not in how fragments blend. Each of the three zone meshes
 * below uses the IDENTICAL "opaque overwrite" recipe `createParticleMaterial`
 * already proved safe (`NormalBlending`, alpha pinned to 1.0, so
 * `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` degenerates to `dst = src` and every
 * fragment is EXACTLY one resolved `reserved.vfx` entry) -- nothing here
 * reaches for real additive blending at all, so the whole "sums to an
 * off-palette colour" failure mode this module could have reintroduced
 * simply does not arise. What is new is not the blend recipe, it is that
 * three DIFFERENT flat colours now sit next to each other in one coherent
 * silhouette instead of one colour repeated across many small discs.
 *
 * ## The export: re-origin, then split by 3D radius
 *
 * The supplied `.blend` (`art/blend/Muzzle flush/
 * Meshy_AI_tank_muzzle_flash_low_0830151349_texture.blend`) is one mesh,
 * `output_unwrapped`, 839 verts / 1673 tris / one material, dims
 * 1.87 x 1.59 x 1.26 -- its OWN object origin sits at its bounding-box
 * centre (measured: local X in [-0.9318, +0.9335]), not at either end, and
 * the vertex/face centroid sits at local X +0.27..+0.274 -- the geometric
 * mass leans toward +X. A 12-bin radial profile along local X (mean/max
 * cross-section radius `sqrt(y^2+z^2)` per bin) confirmed why: the -X
 * extreme is a near-point (bin0 mean radius 0.035) that widens
 * monotonically toward +X, peaking around x in [+0.31, +0.62] (mean radius
 * up to ~0.51, max up to ~0.79) before a slight re-taper at the very tip --
 * the classic "tight at the muzzle, flares outward" blast silhouette, not
 * an arbitrary elongation. So -X is the barrel-adjacent end and +X is the
 * direction the blast travels, matching `mesh-anim.ts`'s "Forward is +X"
 * contract every other mesh asset in this pipeline already builds to
 * (`meshYawFromFacing`'s own doc comment) -- confirmed by measurement here,
 * per this task's own "do not eyeball it" instruction, THEN verified live
 * (fire a tank, confirm the flare extends away from the barrel) -- see this
 * task's report for what that render showed.
 *
 * The export shifts the mesh by -x_min along X ONLY (Y/Z untouched -- the
 * narrow end already sits close to the local X axis) so local (0,0,0)
 * becomes the muzzle attachment point and the whole mesh extends into +X
 * from there, with nothing poking backward through the barrel. Faces are
 * then partitioned by their OWN centroid's 3D distance from that new
 * origin against two FIXED FRACTIONS of the mesh's own max radius (0.40,
 * 0.70) -- literal concentric shells, matching the brief's "concentric role
 * zones by RADIUS from the origin" literally, not a percentile-of-face-
 * count split that would produce irregular, non-concentric bands. Every
 * one of the source's 1673 triangles lands in exactly one zone (199 core /
 * 626 mid / 848 outer) -- an exhaustive partition, nothing left over,
 * nothing duplicated. `art/meshes/vfx/muzzle_flash.glb` carries zero
 * materials (`export_materials="NONE"`, matching every GLB in this
 * pipeline) -- colour comes from `./muzzle-flash-role.ts` at runtime, the
 * same "role name in, ramp/key out" contract `vehicle-mesh-role.ts` and
 * `mesh-role.ts` already use.
 *
 * ## What this replaces, and what it does not
 *
 * `fire_apfsds.json` has five particle layers, plus `light` and
 * `screen_shake`. Both `soft_dot` layers -- the tight, short-lived,
 * single-colour point-blank core (`cone_deg: 14`, `lifetime_ms: [40, 70]`,
 * `color_over_life: ["vfx.white_hot"]`) and the wider, faster three-colour
 * spray around it (`cone_deg: 30`, `speed_tiles_s: [5.0, 10.0]`,
 * `color_over_life: ["vfx.white_hot", "vfx.fire", "vfx.ember"]`) -- are
 * together what this file's own top section means by "the hot core";
 * BOTH now carry `mesh_flash: true` and are superseded as a pair, since
 * they were always two particle layers building ONE visual concept a
 * single modelled shape now carries directly. The remaining three layers
 * are untouched: `ring` (a flat, expanding, fading `dust.3` annulus -- no
 * silhouette a rigid mesh would improve on), the wide-angle `smoke_puff`
 * (`cone_deg: 170`, `dust.2`->`dust.3`->`dust.4`, the ground-hugging dust
 * wash a shell's own muzzle blast kicks up), and the narrower, longer-lived
 * `smoke_puff` (`cone_deg: 70`, up to 1050ms, `dust.3`->`dust.2`-
 * >`gunmetal.3`, the smoke that drifts and cools). All three are still
 * doing work particles are good at -- inherently soft, translucent, and
 * randomly drifting (`alpha_over_life` fading toward 0), exactly the case
 * `units/fx.ts`'s own particle doc comment argues for. `light` (the
 * ramp-shift "muzzle light") and `screen_shake` are unrelated to either
 * particles or this mesh and are untouched.
 *
 * ## Orientation, capacity, animation -- see this file's own exported
 * symbols for the numbers and their citations: `MUZZLE_FLASH_CAPACITY`,
 * `muzzleFlashPowerScale`, `muzzleFlashEnvelope`, `MUZZLE_FLASH_BASE_SCALE`.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { paletteColorNoConvert } from '../palette-material';
import { meshYawFromFacing } from './mesh-anim';
import {
  MUZZLE_FLASH_ROLES,
  isMuzzleFlashRole,
  muzzleFlashPaletteKey,
  type MuzzleFlashRole,
} from './muzzle-flash-role';
import { FX_RENDER_ORDER_ABOVE_ADDITIVE } from './render-order';
import { createVfxMeshMaterial } from './vfx-mesh-material';

// ---------------------------------------------------------------------------
// Pure: geometry/matrix arithmetic and the GLTF -> role-keyed-geometry
// extraction. THREE.Matrix4/Vector3/Quaternion/Color construction is fine
// here -- units/fx.ts's own top comment: it "needs no WebGL/DOM", only
// Material/InstancedMesh/GLTFLoader.loadAsync do (the GPU-facing half below
// the divider).
// ---------------------------------------------------------------------------

/**
 * Simultaneously-live modelled flashes this backend will draw, GLOBALLY
 * (shared across every shooter and every `mesh_flash`-marked layer, the
 * same "one pool, not one per emitter" shape `FlashLightManager`'s own
 * `FLASH_CAPACITY` and `units/fx.ts`'s `PARTICLE_CAPACITY`/`TRACER_CAPACITY`
 * already use).
 *
 * Sized far smaller than either of those, deliberately: `mesh_flash` is
 * wired to exactly one emitter today (`fire_apfsds`), and `apfsds` is fired
 * by exactly one unit type on the current roster (`mbt_lavi` -- `grep -rl
 * apfsds data/units/` finds nothing else). Even a full company of eight
 * `mbt_lavi` all firing within the same ~170ms decay window (`fire_apfsds
 * .json`'s own `light.decay_ms`, the duration this pool's own instances
 * live for -- see `MuzzleFlashManager.spawn`'s doc comment) would need only
 * 8 concurrent slots; 16 is double that already-generous edge case. Cheap
 * to be generous here unlike `FLASH_CAPACITY` (bounded by a PER-FRAGMENT
 * terrain-shader loop) or `PARTICLE_CAPACITY`/`TRACER_CAPACITY` (bounded by
 * real measured concurrency in the hundreds): a pooled `InstancedMesh`
 * instance costs one 4x4 matrix (64 bytes) per zone per slot, so even 16
 * slots x 3 zones is 3KB, not a real budget line. Unmeasured against an
 * actual multi-tank browser session, the same honestly-flagged gap
 * `FLASH_CAPACITY`'s own doc comment carries for its own number. Overflow
 * drops the OLDEST active flash, the identical "keep what the player is
 * looking at" rule `FlashLightManager.spawn`/`writeTracerInstances` already
 * use.
 */
export const MUZZLE_FLASH_CAPACITY = 16;

/**
 * `firePower`'s 0..1 output -> a size multiplier, so `coax_mg` (measured
 * 0.19) does not flash like `gun_120` (measured 0.99997). NOT a new
 * formula: `0.75 + magnitude * 1.25` is `vfx/particles.ts`'s own established
 * law for scaling a spawned effect by weapon magnitude
 * (`particles.ts:174`'s `const scale = 0.75 + magnitude * 1.25`, the size
 * half of the two knobs that function turns `magnitude` into, the other
 * being particle COUNT which has no meaning for one rigid mesh). Reusing it
 * rather than inventing a second size-by-power law means a `coax_mg`-class
 * shot on a future `mesh_flash` emitter reads exactly as "weak" relative to
 * a `gun_120`-class one as every other magnitude-scaled effect in this
 * renderer already does, not a bespoke curve nobody could compare against
 * the rest.
 */
export function muzzleFlashPowerScale(power: number): number {
  return 0.75 + power * 1.25;
}

/**
 * Grow-fast-shrink-out envelope for a flash's own scale over its life --
 * `progress` is `ageMs / durationMs`, clamped to [0, 1] here so a caller
 * that lets a flash run one frame past its own duration (a `step()` racing
 * `spawn()` at the boundary) still gets a sane 0, not `sin` of something
 * past PI. `sin(progress * PI)`: 0 at spawn, peaks at exactly the flash's
 * own midlife, back to 0 at death -- the identical curve
 * `FlashLightManager.step` already uses for the ramp-shift "light" this
 * mesh is spawned alongside (`palette-material.ts`'s own doc comment,
 * "grow fast, shrink out" -- restated verbatim there), reused rather than
 * a second curve invented for the mesh side of the same event.
 */
export function muzzleFlashEnvelope(progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return Math.sin(p * Math.PI);
}

/**
 * World-space (tile-unit) scale a flash draws at when `muzzleFlashPowerScale`
 * and `muzzleFlashEnvelope` both read 1 -- i.e. `gun_120`-class power, at
 * the exact mid-life instant. Not derived from `mesh-anim.ts`'s
 * `MESH_UNITS_PER_TILE`: that constant exists because vehicle/infantry GLBs
 * are built at real, MEASURED metres (kit.py builds a hull to its own
 * measured wheelbase), and a Meshy-generated blast has no equivalent
 * real-world measurement to carry -- `vehicle-mesh-role.ts`'s own top
 * comment already draws this line for colour ("no sprite-rig script of its
 * own... a judgement call, not a sourced fact"); the same applies here to
 * SCALE, one level earlier, since there is no sprite of this effect to
 * compare against at all.
 *
 * 0.3 is a judgement call, calibrated by eye against a real gameplay-zoom
 * (~3) browser render of `mbt_lavi` firing, against `mbt_lavi.glb`'s own
 * measured world span (6.32 local units long before `MESH_SCALE`, i.e.
 * ~2.11 tiles once scaled) as a size reference -- see this task's report
 * for the render it was judged against. Flagged, per CLAUDE.md's own
 * "Approve art numbers before rendering" rule, as unapproved beyond that
 * single judgement pass.
 */
export const MUZZLE_FLASH_BASE_SCALE = 0.3;

/** `emitter.light?.decay_ms` is the duration a spawned flash's own mesh
 *  instance lives for (`MuzzleFlashManager.spawn`'s doc comment) -- this is
 *  the fallback for the (currently unreachable, since `fire_apfsds.json`
 *  declares `light`) case of a future `mesh_flash`-marked layer on an
 *  emitter with none. Matches `palette-material.ts`'s own documented
 *  "130ms median" across the eight shipped `light` declarations, rounded. */
export const MUZZLE_FLASH_DEFAULT_DURATION_MS = 130;

/** One loaded `art/meshes/vfx/muzzle_flash.glb`, kept as the source
 *  geometry every pooled `InstancedMesh` instance below draws through --
 *  mirrors `VehicleMeshTemplate`'s own "kept as a clone source" shape,
 *  except nothing is ever cloned here: an `InstancedMesh` shares ONE
 *  geometry across every instance by construction, so there is no
 *  per-entity `Object3D.clone(true)` step the way a vehicle hull needs. */
export interface MuzzleFlashTemplate {
  readonly geometries: Readonly<Record<MuzzleFlashRole, THREE.BufferGeometry>>;
}

/**
 * Assembles a `MuzzleFlashTemplate` from an already-parsed `GLTF` result --
 * decoupled from `GLTFLoader` itself, the identical split `mesh-vehicle.ts`'s
 * `buildVehicleMeshTemplate` makes and for the same reason: exercisable
 * against a hand-authored fixture with no network and no `WebGLRenderer`.
 *
 * Throws loudly, never silently, on either failure mode the closed
 * three-role vocabulary admits: a mesh whose role (extras `rl_role`,
 * falling back to its own name -- the identical lookup order
 * `buildVehicleMeshTemplate` uses) is not `core`/`mid`/`outer`, or a role
 * this GLB never declares at all. Matches the contract's own rule, applied
 * identically here: "a role outside the set must be a loud failure... never
 * a default colour" (or, here, a silently-missing zone).
 */
export function buildMuzzleFlashTemplate(gltf: Pick<GLTF, 'scene'>): MuzzleFlashTemplate {
  const found: Partial<Record<MuzzleFlashRole, THREE.BufferGeometry>> = {};
  const unmapped = new Set<string>();

  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const extrasRole = (mesh.userData as { rl_role?: unknown }).rl_role;
    const role = typeof extrasRole === 'string' && extrasRole.length > 0 ? extrasRole : mesh.name;
    if (!isMuzzleFlashRole(role)) {
      unmapped.add(role || '(unnamed mesh)');
      return;
    }
    found[role] = mesh.geometry;
  });

  if (unmapped.size > 0) {
    throw new Error(`muzzle-flash: no role for mesh(es) ${[...unmapped].join(', ')} -- not in the closed muzzle-flash role vocabulary`);
  }
  for (const role of MUZZLE_FLASH_ROLES) {
    if (!found[role]) throw new Error(`muzzle-flash: GLB is missing the "${role}" zone mesh`);
  }
  return { geometries: found as Record<MuzzleFlashRole, THREE.BufferGeometry> };
}

/** Fetches and parses `glbUrl`, then builds a `MuzzleFlashTemplate` --
 *  mirrors `mesh-vehicle.ts`'s `loadVehicleMeshTemplate` exactly. */
export async function loadMuzzleFlashTemplate(glbUrl: string): Promise<MuzzleFlashTemplate> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  return buildMuzzleFlashTemplate(gltf);
}

/** One active, pooled flash instance -- `x`/`y`/`z` are real three.js WORLD
 *  coordinates (already mapped from game tile-space by the caller, exactly
 *  once, at `spawn()`), not game (x, y): this module has no reason to know
 *  about tile-space at all once its caller has done that conversion, unlike
 *  `units/fx.ts`'s particles, which stay in tile-space until draw time
 *  because they also need a live per-frame ground-height re-sample as they
 *  move (`writeParticleInstances`'s own "Elevation lift, round 2"). A
 *  muzzle flash never moves during its life, so there is nothing to
 *  re-sample and no reason to defer the conversion. */
interface ActiveMuzzleFlash {
  x: number;
  y: number;
  z: number;
  /** Sim `facing`, in 0..1 TURNS -- `meshYawFromFacing`'s own input unit,
   *  reused unmodified rather than converting to/from radians a second
   *  time (the caller, `ThreeRenderer.onFire`, already has this exact value
   *  as `dirTurns`). */
  facingTurns: number;
  power: number;
  ageMs: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// GPU-facing.
// ---------------------------------------------------------------------------

/** Shared rotation axis for `MuzzleFlashManager.step`'s per-instance yaw --
 *  one module-level `THREE.Vector3`, not reallocated per active flash per
 *  frame, mirroring `scratchMatrix`/`scratchQuat`/etc.'s own "reused, not
 *  allocated in the hot loop" reasoning below. */
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * One flat, unlit, forced-opaque colour per zone -- see this file's own top
 * comment ("Why a mesh at all") for the full palette argument, and
 * `./vfx-mesh-material.ts`'s own top comment for the material recipe
 * itself (extracted there once `explosion-burst.ts` needed the byte-
 * identical recipe -- this file's own callers and doc citations of
 * "createMuzzleFlashMaterial" are unaffected; only the implementation moved).
 */
const createMuzzleFlashMaterial = createVfxMeshMaterial;

/**
 * Owns the three pooled `InstancedMesh` zones (`core`/`mid`/`outer`) and the
 * active-flash bookkeeping that drives them -- the mesh counterpart of
 * `FlashLightManager`, sharing its "bounded pool, oldest-evicted, one
 * `step()` a frame" shape, plus `ParticleInstancer`'s "one `InstancedMesh`
 * per draw tier" shape for the GPU half, since a flash is three tiers
 * (zones) at once rather than one.
 *
 * Two-phase construction, deliberately: `setColors` (needs only `resolve`,
 * available synchronously from `ThreeRenderer.useEmitters`) and `load`
 * (needs the async GLB fetch) can complete in EITHER order with no
 * coordination between them, because both mutate state that already exists
 * from construction: `setColors` copies into each material's own
 * pre-allocated `uColor` uniform (built in the constructor, before any GLB
 * has loaded), and `load` builds the three `InstancedMesh`es around
 * whatever colour those uniforms currently hold -- if `load` finishes
 * first, the meshes simply start out coloured black (`createMuzzleFlashMaterial`'s
 * own default) until `setColors` corrects them in place, same object,
 * same uniform, no rebuild. Mirrors `FlashLightManager.posArray`'s own
 * "shared by reference... mutating these in place updates every material
 * with no per-material write loop" reasoning, one level up.
 */
export class MuzzleFlashManager {
  private readonly capacity: number;
  private readonly materials: Readonly<Record<MuzzleFlashRole, THREE.ShaderMaterial>>;
  private meshes: Readonly<Record<MuzzleFlashRole, THREE.InstancedMesh>> | null = null;
  private readonly active: ActiveMuzzleFlash[] = [];
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();

  constructor(capacity = MUZZLE_FLASH_CAPACITY) {
    this.capacity = capacity;
    this.materials = {
      core: createMuzzleFlashMaterial(),
      mid: createMuzzleFlashMaterial(),
      outer: createMuzzleFlashMaterial(),
    };
  }

  /** True once `load()` has resolved -- `ThreeRenderer.onFire` reads this to
   *  decide whether a `mesh_flash`-marked particle layer is superseded yet
   *  (`&mesh` off, or the GLB still loading, both fall back to the
   *  authored particle exactly as before this feature existed). */
  get ready(): boolean {
    return this.meshes !== null;
  }

  /** Resolves this manager's three fixed palette keys through `resolve`
   *  (the same callback `ThreeRenderer.useEmitters` already receives) and
   *  copies the result into each zone's own `uColor` uniform, in place --
   *  see this class's own doc comment for why this needs no coordination
   *  with `load()`. */
  setColors(resolve: (key: string) => string): void {
    for (const role of MUZZLE_FLASH_ROLES) {
      const color = paletteColorNoConvert(resolve(muzzleFlashPaletteKey(role)));
      (this.materials[role].uniforms.uColor.value as THREE.Color).copy(color);
    }
  }

  /**
   * Loads `art/meshes/vfx/muzzle_flash.glb`, builds the three pooled
   * `InstancedMesh` zones around it (capacity fixed at construction,
   * `mesh.count = 0` until the first `step()` has something to draw,
   * `frustumCulled = false` -- a flash can spawn anywhere on the map, the
   * same reasoning every other FX/unit instancer in this backend already
   * gives its own `frustumCulled = false`), and returns them so the caller
   * can add them to its own scene graph -- mirrors `ParticleInstancer.mesh`
   * being added once, at `ThreeRenderer`'s own construction, except this
   * happens lazily (the geometry does not exist until the async load
   * below resolves), the same "always present, draws nothing until fed"
   * shape reached one call later.
   */
  async load(glbUrl: string): Promise<THREE.Object3D[]> {
    const template = await loadMuzzleFlashTemplate(glbUrl);
    const partial: Partial<Record<MuzzleFlashRole, THREE.InstancedMesh>> = {};
    for (const role of MUZZLE_FLASH_ROLES) {
      const mesh = new THREE.InstancedMesh(template.geometries[role], this.materials[role], this.capacity);
      mesh.count = 0;
      mesh.renderOrder = FX_RENDER_ORDER_ABOVE_ADDITIVE;
      mesh.frustumCulled = false;
      partial[role] = mesh;
    }
    const meshes = partial as Record<MuzzleFlashRole, THREE.InstancedMesh>;
    this.meshes = meshes;
    return MUZZLE_FLASH_ROLES.map((role) => meshes[role]);
  }

  /**
   * Spawns one flash at world `(x, y, z)`, facing `facingTurns` (0..1
   * turns), sized by `power` (`firePower`'s own 0..1 output) and living for
   * `durationMs` -- a no-op below zero duration, matching
   * `FlashLightManager.spawn`'s identical guard. Over capacity, drops the
   * OLDEST active flash first, the same eviction rule that class and
   * `writeTracerInstances` both already use.
   *
   * Silently does nothing useful if `!ready` (`meshes` still null) beyond
   * queuing bookkeeping `step()` will drain with nothing to draw --
   * `ThreeRenderer.onFire` is expected to check `ready` itself before
   * calling this (skipping the particle it would otherwise spawn), so this
   * guard is a defensive backstop, not the primary gate.
   */
  spawn(x: number, y: number, z: number, facingTurns: number, power: number, durationMs: number): void {
    if (durationMs <= 0) return;
    if (this.active.length >= this.capacity) this.active.shift();
    this.active.push({ x, y, z, facingTurns, power, ageMs: 0, durationMs });
  }

  /**
   * Ages every active flash by `dtMs`, retires any past its own
   * `durationMs`, and rewrites all three `InstancedMesh`es' instance
   * matrices from what remains -- called once a frame, presentation-only
   * timing exactly like `FlashLightManager.step`.
   *
   * The SAME transform (position, `meshYawFromFacing` yaw, uniform scale)
   * applies to all three zone meshes at a given active-flash's slot index --
   * they are three pieces of one rigid object and must move together, so
   * the matrix is computed once per active flash, not once per zone.
   */
  step(dtMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      f.ageMs += dtMs;
      if (f.ageMs >= f.durationMs) this.active.splice(i, 1);
    }
    if (!this.meshes) return;
    const meshes = this.meshes;
    for (const role of MUZZLE_FLASH_ROLES) meshes[role].count = this.active.length;
    for (let i = 0; i < this.active.length; i++) {
      const f = this.active[i];
      const progress = f.ageMs / f.durationMs;
      const scale = MUZZLE_FLASH_BASE_SCALE * muzzleFlashPowerScale(f.power) * muzzleFlashEnvelope(progress);
      this.scratchPos.set(f.x, f.y, f.z);
      this.scratchQuat.setFromAxisAngle(Y_AXIS, meshYawFromFacing(f.facingTurns));
      this.scratchScale.set(scale, scale, scale);
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      for (const role of MUZZLE_FLASH_ROLES) meshes[role].setMatrixAt(i, this.scratchMatrix);
    }
    for (const role of MUZZLE_FLASH_ROLES) meshes[role].instanceMatrix.needsUpdate = true;
  }

  /** Releases every zone's own material; geometry is released too, but only
   *  once loaded (`meshes` non-null) -- mirrors `disposeVehicleMeshTemplate`'s
   *  "template owns it" split, except here the manager owns both halves
   *  itself rather than splitting template-owned from entity-owned, since
   *  nothing ever clones this geometry. */
  dispose(): void {
    if (this.meshes) {
      for (const role of MUZZLE_FLASH_ROLES) this.meshes[role].geometry.dispose();
    }
    for (const role of MUZZLE_FLASH_ROLES) this.materials[role].dispose();
  }

  /** Test/debug hook: how many flashes are currently alive. */
  get liveCount(): number {
    return this.active.length;
  }
}
