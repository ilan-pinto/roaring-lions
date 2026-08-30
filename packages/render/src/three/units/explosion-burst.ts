/**
 * A pooled, MODELLED explosion fireball -- `art/meshes/vfx/explosion_burst.glb`,
 * three concentric zone meshes (`./explosion-burst-role.ts`) cut from a
 * single AI-generated (Meshy) blob, disclosed per CONTRIBUTING.md. Reuses
 * `muzzle-flash.ts`'s own render path end to end (pooled `InstancedMesh`
 * zones, `core`/`mid`/`outer` palette roles, the opaque-overwrite material,
 * the grow-fast-shrink-out envelope, the `mesh_flash`-style particle-layer
 * supersession) rather than duplicating it -- see this task's report
 * ("explosion-burst-report.md") for the full "what was shared vs kept
 * separate" account. This file only states what genuinely differs.
 *
 * ## What this asset attaches to, and why NOT `catastrophic_kill`
 *
 * `data/vfx/catastrophic_kill.json` exists, has the right SHAPE (a
 * `soft_dot` hot core, `color_over_life: ["vfx.white_hot", "vfx.fire",
 * "vfx.ember"]`, `additive: true` -- the exact layer a modelled mesh would
 * supersede, mirroring `fire_apfsds.json`'s own hot-core layers), and is
 * the obvious-looking home for this asset. It is also NEVER DISPATCHED:
 * no `byName('catastrophic_kill')` call exists in either renderer, and the
 * sim's `destroyed` event (`{kind: 'destroyed', tick, entity, by}`,
 * `packages/sim/src/sim.ts:584`) carries no catastrophic-versus-ordinary
 * classification for one to key off -- there is no sim-side signal that
 * says "this kill was catastrophic" for a renderer to read. Wiring that
 * classification is OUT OF SCOPE for this task (it is sim work, not
 * render work) and is reported, not built, in this task's own report.
 *
 * This mesh attaches to `structure_collapse` instead -- a building's own
 * `structureDestroyed` event, which DOES fire today (`ThreeRenderer.onEvents`'
 * `structureDestroyed` case already calls `spawnCollapseFx('structure_collapse',
 * ...)` unconditionally, every time a building dies). `data/vfx/
 * structure_collapse.json` gained one new particle layer for this task --
 * a `soft_dot` hot core matching `catastrophic_kill.json`'s own shape,
 * marked `mesh_burst: true` -- superseded by this mesh once loaded
 * (`&mesh`), falling back to that authored particle exactly as declared
 * otherwise (Pixi, or three with the mesh not yet loaded), the identical
 * fallback contract `mesh_flash` already established for `fire_apfsds.json`.
 * `tunnel_collapse` was considered and rejected: it declares `"layer":
 * "below_units"` (an underground vent's dust column, meant to be covered by
 * standing units and by fog the way a below-tier particle already is),
 * while this mesh's material is `depthTest: false` -- an UNCONDITIONAL,
 * always-on-top pass by design (`vfx-mesh-material.ts`'s own top comment).
 * Drawing an unconditionally-on-top incandescent mesh for an event whose
 * own emitter deliberately sits BELOW units would fight that layer's own
 * purpose; `structure_collapse` already declares `"layer": "above_units"`,
 * matching the render band this mesh needs with no new band and no
 * contradiction.
 *
 * ## The export: re-origin to ground contact, split from the blast's OWN centre
 *
 * The supplied `.blend` (`art/blend/explosion burst /
 * Meshy_AI_explosion_fireball_lo_0830152530_texture.blend` -- the trailing
 * space in the directory name is real) is one mesh, `output_unwrapped`,
 * 1154 verts / 2304 tris / one material, dims 1.906 x 1.883 x 1.048 --
 * unlike the muzzle flash, its own object origin already sits almost
 * exactly at its bounding-box centre (measured: local bbox centre
 * (0, 0, -0.0064), i.e. already within 0.6% of true centre) and its
 * horizontal footprint is very nearly circular (local bbox X/Y size ratio
 * 1.012) -- a squat, roughly radially-symmetric blob, not an elongated
 * flare. Per this task's own brief ("Five of five supplied Meshy assets
 * have needed a baked rotation... verify rather than assume"): THIS asset
 * needed none, and the X/Y aspect ratio is exactly why -- with no
 * directional lean in the horizontal plane, no yaw orientation reads
 * differently from any other, so there is no "wrong way round" to correct.
 *
 * Two DIFFERENT points matter for this asset, unlike the muzzle flash where
 * one point served both roles:
 *
 *   - The PLACEMENT anchor (where local (0,0,0) ends up, `tools/
 *     export_mesh_vfx.py`'s `"min_z"` strategy): the mesh's own lower taper
 *     point, shifted to local Z=0 (X/Y untouched -- already centred). This
 *     is the ground-contact point a detonation anchors to, matching where
 *     `ThreeRenderer.spawnCollapseFx` already anchors the particle
 *     fallback (a structure's own footprint centre at ground height) --
 *     planting the mesh here means the whole blob rises away from the
 *     ground rather than clipping half its own volume through it.
 *   - The SPLIT origin (what `core`/`mid`/`outer` measure 3D distance
 *     from): the mesh's own bounding-box CENTRE, not the placement anchor.
 *     The first attempt used the SAME point for both (mirroring the muzzle
 *     flash exactly) and produced a technically-valid but visually wrong
 *     result: with the split measured from the ground-contact point, the
 *     `core` zone (79 of 2304 tris, 3.4%) formed a thin dome hugging that
 *     same low point -- OCCLUDED by the wider bulge above it from the
 *     game's own downward dimetric camera, confirmed by an actual render,
 *     not merely predicted (see the report). Splitting from the bbox
 *     centre instead (245/1096/963 of 2304, 10.6%/47.6%/41.8%, at fractions
 *     0.55/0.80 rather than the muzzle flash's 0.40/0.70 -- see the report
 *     for why 0.40/0.70 measured from the CENTRE of a hollow-shell blob is
 *     degenerate, putting zero triangles in `core`) puts the hottest zone
 *     at the blast's own volumetric middle, which read correctly in a
 *     second render: a pale core visible through the middle of the
 *     silhouette, a broad orange body, a red-orange outer skirt. Both
 *     renders are in the report.
 *
 * `art/meshes/vfx/explosion_burst.glb` carries zero materials
 * (`export_materials="NONE"`, matching every GLB in this pipeline) --
 * colour comes from `./explosion-burst-role.ts` at runtime, same contract
 * as the muzzle flash.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { paletteColorNoConvert } from '../palette-material';
import {
  EXPLOSION_BURST_ROLES,
  isExplosionBurstRole,
  explosionBurstPaletteKey,
  type ExplosionBurstRole,
} from './explosion-burst-role';
import { createVfxMeshMaterial } from './vfx-mesh-material';
import { muzzleFlashPowerScale, muzzleFlashEnvelope } from './muzzle-flash';
import { FX_RENDER_ORDER_ABOVE_ADDITIVE } from './render-order';

// ---------------------------------------------------------------------------
// Pure: geometry/matrix arithmetic and the GLTF -> role-keyed-geometry
// extraction. Mirrors muzzle-flash.ts's own top divider exactly, for the
// identical reason: THREE.Matrix4/Vector3/Quaternion/Color construction is
// fine here, only Material/InstancedMesh/GLTFLoader.loadAsync need the
// GPU-facing half below.
// ---------------------------------------------------------------------------

/**
 * Simultaneously-live modelled bursts this backend will draw, GLOBALLY --
 * the same "one pool, not one per structure" shape `MuzzleFlashManager`'s
 * own `MUZZLE_FLASH_CAPACITY` uses.
 *
 * Smaller than the muzzle flash's 16, deliberately: a `structureDestroyed`
 * event is a much rarer occurrence than a `fire` event -- every shipped map
 * today has at most two building footprints alive at once (`marj_perimeter`
 * and `wadi_halam_basin`, both measured by flood-filling their own `#`
 * tiles for this task's report), so two concurrent collapses is the largest
 * case any EXISTING mission can produce. 8 is four times that measured
 * ceiling, leaving real headroom for a future multi-building compound siege
 * without following the muzzle flash's own "match an eight-tank company"
 * reasoning literally -- there is no roster-wide equivalent for a building.
 * Cheap to be generous regardless: one pooled `InstancedMesh` instance costs
 * one 4x4 matrix (64 bytes) per zone per slot, so even 8 slots x 3 zones is
 * under 1.5KB.
 */
export const EXPLOSION_BURST_CAPACITY = 8;

/**
 * World-space (tile-unit) scale an explosion burst draws at when
 * `muzzleFlashPowerScale` and `muzzleFlashEnvelope` both read 1 -- i.e. the
 * largest footprint any shipped map's structure measures, at the exact
 * mid-life instant. Mirrors `MUZZLE_FLASH_BASE_SCALE`'s own reasoning one
 * level up: there is no sprite of this effect to size-match against
 * (`muzzle-flash.ts`'s own top comment already draws this line), so this is
 * a judgment call, not a measured fact.
 *
 * 0.9 is calibrated so a full-power burst (the largest measured footprint,
 * a 3x3 compound at `marj_perimeter`, 9 tiles) reads at roughly 3.5 tiles
 * across at its own peak -- comfortably covering, and slightly overshooting,
 * the footprint it destroyed, without swallowing half the screen. The
 * mesh's own native width (pre-scale) is ~1.9 units, so
 * `0.9 * muzzleFlashPowerScale(1) * 1.9 = 0.9 * 2.0 * 1.9 ≈ 3.42` tiles at
 * peak envelope. Flagged, per CLAUDE.md's own "Approve art numbers before
 * rendering" rule, as unapproved beyond that arithmetic and the single
 * browser render this task's report describes.
 */
export const EXPLOSION_BURST_BASE_SCALE = 0.9;

/**
 * `structure_collapse.json`'s own new hot-core layer (`mesh_burst: true`)
 * declares `lifetime_ms: [350, 550]` -- this is that range's own midpoint,
 * used as the mesh's fixed lifetime. Unlike `MUZZLE_FLASH_DEFAULT_DURATION_MS`
 * (which exists for a `light.decay_ms` this asset's own emitter simply does
 * not declare -- `structure_collapse.json` carries no `light` block, and
 * this task deliberately does not add one; see the report for why a dynamic
 * light pulse on building collapse is scope this task did not take on),
 * this is not a fallback for a rare case -- it is the ONLY duration this
 * mesh ever uses, so it is a plain constant rather than a `??`-chained
 * default.
 */
export const EXPLOSION_BURST_DEFAULT_DURATION_MS = 450;

/**
 * A structure's own footprint area (tiles), normalised into the 0..1
 * `power` this manager's `spawn()` expects -- the destroyed BUILDING's own
 * physical size standing in for "how big should this burst look", the same
 * category of judgement `onFire`'s own `firePower(wp)` already makes for a
 * WEAPON's magnitude. This is NOT the sim-side "catastrophic kill"
 * classification this file's own top comment says is out of scope -- it
 * reads geometry (`minX`/`minY`/`maxX`/`maxY`) `ThreeRenderer.beginCollapse`
 * already reads off the exact same structure, at the exact same moment, for
 * its own unrelated purpose, and answers a different question ("how big was
 * the building", not "was this kill catastrophic").
 *
 * `referenceTiles` defaults to 9 -- the largest footprint measured across
 * every shipped map at the time this was written (a 3x3 compound at
 * `marj_perimeter`; see this task's report). A structure at or above that
 * size reads as full power (1); anything smaller scales down linearly,
 * clamped to [0, 1] so a structure larger than the reference still reads as
 * full power rather than overshooting it (`muzzleFlashPowerScale`'s own
 * 0.75 floor already keeps the visual size from ever reading as literally
 * nothing at the low end).
 */
export function explosionBurstPowerFromFootprint(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  referenceTiles = 9
): number {
  const tiles = (maxX - minX + 1) * (maxY - minY + 1);
  const power = tiles / referenceTiles;
  return power < 0 ? 0 : power > 1 ? 1 : power;
}

/**
 * The sibling of `explosionBurstPowerFromFootprint`, for a KILLED UNIT
 * rather than a destroyed structure -- added when `ThreeRenderer.onEvents`'
 * `destroyed` case gained its own hard-target explosion burst (a second,
 * later task layered onto this file's own). A unit has no footprint the
 * way a structure does (`Sim.structures.minX`/etc. do not exist for
 * entities), so this reads the unit TYPE's own `hp` (`UnitType.hp`, already
 * converted to a plain number by the caller -- `fx.toNumber`, matching
 * every other Fx-to-render-number boundary in `ThreeRenderer`) instead --
 * the identical category of judgement as the footprint function: a
 * physical-size stand-in for "how big should this burst look", NOT the
 * sim-side "catastrophic kill" classification this file's own top comment
 * says is out of scope. Hull armour thickness was also a candidate (the
 * brief's own "hull size or max HP are the obvious candidates") but is not
 * exposed as a single scalar the way `hp` is -- `armorFront`/`armorSide`/
 * `armorRear` are three numbers with no one obvious combination, where
 * `hp` is already exactly the single "how much of this thing is there"
 * number the sim itself uses.
 *
 * `referenceHp` defaults to 3000 -- `mbt_lavi`'s own `hull.hp`, the largest
 * of any unit type on the roster at the time this was written (measured
 * directly from every `data/units/**\/*.json` file, not guessed; see this
 * task's report). A unit at or above that HP reads as full power (1);
 * anything smaller scales down linearly, clamped to [0, 1] -- the identical
 * shape `explosionBurstPowerFromFootprint` already uses, so a `moto_rpg`
 * (150 hp, power ~0.05) does not detonate like an `mbt_lavi` (3000 hp,
 * power 1), while `muzzleFlashPowerScale`'s own 0.75 floor still keeps even
 * the smallest reading from looking like literally nothing.
 */
export function explosionBurstPowerFromMaxHp(maxHp: number, referenceHp = 3000): number {
  const power = maxHp / referenceHp;
  return power < 0 ? 0 : power > 1 ? 1 : power;
}

/** One loaded `art/meshes/vfx/explosion_burst.glb`, kept as the source
 *  geometry every pooled `InstancedMesh` instance below draws through --
 *  mirrors `MuzzleFlashTemplate` exactly. */
export interface ExplosionBurstTemplate {
  readonly geometries: Readonly<Record<ExplosionBurstRole, THREE.BufferGeometry>>;
}

/**
 * Assembles an `ExplosionBurstTemplate` from an already-parsed `GLTF`
 * result -- mirrors `buildMuzzleFlashTemplate` exactly, including its own
 * loud-failure contract on an unrecognised or missing zone; see that
 * function's own doc comment for the full argument (unchanged here, this is
 * the identical shape applied to a different closed role vocabulary import).
 */
export function buildExplosionBurstTemplate(gltf: Pick<GLTF, 'scene'>): ExplosionBurstTemplate {
  const found: Partial<Record<ExplosionBurstRole, THREE.BufferGeometry>> = {};
  const unmapped = new Set<string>();

  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const extrasRole = (mesh.userData as { rl_role?: unknown }).rl_role;
    const role = typeof extrasRole === 'string' && extrasRole.length > 0 ? extrasRole : mesh.name;
    if (!isExplosionBurstRole(role)) {
      unmapped.add(role || '(unnamed mesh)');
      return;
    }
    found[role] = mesh.geometry;
  });

  if (unmapped.size > 0) {
    throw new Error(`explosion-burst: no role for mesh(es) ${[...unmapped].join(', ')} -- not in the closed explosion-burst role vocabulary`);
  }
  for (const role of EXPLOSION_BURST_ROLES) {
    if (!found[role]) throw new Error(`explosion-burst: GLB is missing the "${role}" zone mesh`);
  }
  return { geometries: found as Record<ExplosionBurstRole, THREE.BufferGeometry> };
}

/** Fetches and parses `glbUrl`, then builds an `ExplosionBurstTemplate` --
 *  mirrors `loadMuzzleFlashTemplate` exactly. */
export async function loadExplosionBurstTemplate(glbUrl: string): Promise<ExplosionBurstTemplate> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  return buildExplosionBurstTemplate(gltf);
}

/** One active, pooled burst instance -- `x`/`y`/`z` are real three.js WORLD
 *  coordinates, exactly like `ActiveMuzzleFlash`. `yawTurns` is NOT a real
 *  facing (an explosion has no barrel and no firing bearing) -- it is a
 *  purely cosmetic per-spawn rotation about the vertical axis, so repeated
 *  bursts do not all show the identical silhouette angle (the mesh's own
 *  irregular flame-lobe geometry is not perfectly radially symmetric, only
 *  close to it -- see this file's own top comment). The caller is expected
 *  to derive it from the presentation PRNG/hash, the same source every
 *  other scatter effect in this renderer already uses -- never from
 *  anything sim-derived, since there is nothing sim-derived to base it on. */
interface ActiveExplosionBurst {
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

/** Shared rotation axis for `ExplosionBurstManager.step`'s per-instance yaw
 *  -- mirrors `muzzle-flash.ts`'s own module-level `Y_AXIS`. */
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Owns the three pooled `InstancedMesh` zones (`core`/`mid`/`outer`) and the
 * active-burst bookkeeping that drives them -- mirrors `MuzzleFlashManager`
 * exactly in shape (two-phase construction, oldest-evicted bounded pool, one
 * `step()` a frame); see that class's own doc comment for the full
 * reasoning, which applies here unchanged. This class states only what
 * differs: no facing input (there is none to have), and its own capacity/
 * scale/duration constants above.
 */
export class ExplosionBurstManager {
  private readonly capacity: number;
  private readonly materials: Readonly<Record<ExplosionBurstRole, THREE.ShaderMaterial>>;
  private meshes: Readonly<Record<ExplosionBurstRole, THREE.InstancedMesh>> | null = null;
  private readonly active: ActiveExplosionBurst[] = [];
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();

  constructor(capacity = EXPLOSION_BURST_CAPACITY) {
    this.capacity = capacity;
    this.materials = {
      core: createVfxMeshMaterial(),
      mid: createVfxMeshMaterial(),
      outer: createVfxMeshMaterial(),
    };
  }

  /** True once `load()` has resolved -- mirrors `MuzzleFlashManager.ready`. */
  get ready(): boolean {
    return this.meshes !== null;
  }

  /** Resolves this manager's three fixed palette keys through `resolve` and
   *  copies the result into each zone's own `uColor` uniform, in place --
   *  mirrors `MuzzleFlashManager.setColors` exactly. */
  setColors(resolve: (key: string) => string): void {
    for (const role of EXPLOSION_BURST_ROLES) {
      const color = paletteColorNoConvert(resolve(explosionBurstPaletteKey(role)));
      (this.materials[role].uniforms.uColor.value as THREE.Color).copy(color);
    }
  }

  /**
   * Loads `art/meshes/vfx/explosion_burst.glb`, builds the three pooled
   * `InstancedMesh` zones around it, and returns them so the caller can add
   * them to its own scene graph -- mirrors `MuzzleFlashManager.load` exactly.
   */
  async load(glbUrl: string): Promise<THREE.Object3D[]> {
    const template = await loadExplosionBurstTemplate(glbUrl);
    const partial: Partial<Record<ExplosionBurstRole, THREE.InstancedMesh>> = {};
    for (const role of EXPLOSION_BURST_ROLES) {
      const mesh = new THREE.InstancedMesh(template.geometries[role], this.materials[role], this.capacity);
      mesh.count = 0;
      mesh.renderOrder = FX_RENDER_ORDER_ABOVE_ADDITIVE;
      mesh.frustumCulled = false;
      partial[role] = mesh;
    }
    const meshes = partial as Record<ExplosionBurstRole, THREE.InstancedMesh>;
    this.meshes = meshes;
    return EXPLOSION_BURST_ROLES.map((role) => meshes[role]);
  }

  /**
   * Spawns one burst at world `(x, y, z)`, sized by `power` (0..1, fed
   * through the SAME `muzzleFlashPowerScale` law the muzzle flash uses --
   * see `EXPLOSION_BURST_BASE_SCALE`'s own doc comment for how a caller is
   * expected to derive it: a structure's own footprint area, normalised) and
   * living for `durationMs`. `yawTurns` is cosmetic only -- see
   * `ActiveExplosionBurst`'s own doc comment. A no-op below zero duration,
   * matching `MuzzleFlashManager.spawn`'s identical guard. Over capacity,
   * drops the OLDEST active burst first, the same eviction rule that class
   * uses.
   */
  spawn(x: number, y: number, z: number, yawTurns: number, power: number, durationMs: number): void {
    if (durationMs <= 0) return;
    if (this.active.length >= this.capacity) this.active.shift();
    this.active.push({ x, y, z, yawTurns, power, ageMs: 0, durationMs });
  }

  /**
   * Ages every active burst by `dtMs`, retires any past its own
   * `durationMs`, and rewrites all three `InstancedMesh`es' instance
   * matrices from what remains -- mirrors `MuzzleFlashManager.step` exactly,
   * substituting `yawTurns` for `facingTurns` as the rotation input (the
   * SAME axis-angle composition; only the SOURCE of the angle differs, not
   * the maths).
   */
  step(dtMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.ageMs += dtMs;
      if (b.ageMs >= b.durationMs) this.active.splice(i, 1);
    }
    if (!this.meshes) return;
    const meshes = this.meshes;
    for (const role of EXPLOSION_BURST_ROLES) meshes[role].count = this.active.length;
    for (let i = 0; i < this.active.length; i++) {
      const b = this.active[i];
      const progress = b.ageMs / b.durationMs;
      const scale = EXPLOSION_BURST_BASE_SCALE * muzzleFlashPowerScale(b.power) * muzzleFlashEnvelope(progress);
      this.scratchPos.set(b.x, b.y, b.z);
      this.scratchQuat.setFromAxisAngle(Y_AXIS, b.yawTurns * Math.PI * 2);
      this.scratchScale.set(scale, scale, scale);
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      for (const role of EXPLOSION_BURST_ROLES) meshes[role].setMatrixAt(i, this.scratchMatrix);
    }
    for (const role of EXPLOSION_BURST_ROLES) meshes[role].instanceMatrix.needsUpdate = true;
  }

  /** Releases every zone's own material; geometry is released too, but only
   *  once loaded -- mirrors `MuzzleFlashManager.dispose` exactly. */
  dispose(): void {
    if (this.meshes) {
      for (const role of EXPLOSION_BURST_ROLES) this.meshes[role].geometry.dispose();
    }
    for (const role of EXPLOSION_BURST_ROLES) this.materials[role].dispose();
  }

  /** Test/debug hook: how many bursts are currently alive. */
  get liveCount(): number {
    return this.active.length;
  }
}
