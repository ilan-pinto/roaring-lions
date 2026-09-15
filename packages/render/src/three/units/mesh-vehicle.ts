/**
 * Vehicle meshes: rigid hull-plus-pivot-turret geometry, the mesh-unit
 * contract v2's second asset class. Shares little with `mesh-unit.ts`'s
 * infantry path by design -- the contract's own words: "a skinned
 * single-armature figure and a rigid hull-plus-pivot-turret share nothing
 * beyond 'walk the meshes, assign a material'." Concretely: no skin, and
 * geometry is joined by `{part}_{role}` rather than by role alone --
 * `turret_metal` and `hull_metal` must stay two separate meshes so the
 * turret can rotate independently of the hull, where infantry's `metal`
 * role joins into ONE mesh across the whole figure.
 *
 * ## Animation, and the "no clips" case that is now only the fixture and
 * `&nomesh` path
 *
 * This module ALSO builds an `AnimationMixer` now, which it did not
 * originally -- the header used to read "no `AnimationMixer`, no clips",
 * and that was a statement about the ENGINE, not just about the assets.
 * Infantry had a mixer, an actions map and clip switching from the day
 * `mesh-unit.ts` shipped; vehicles never got one, so a tank's tracks could
 * not move and a dozer's blade could not lift even if a GLB authored the
 * motion. The engine half is now here.
 *
 * The asset half HAS changed since (2026-09-15, the wreck pass): every
 * shipped `art/meshes/vehicles/*.glb` now declares exactly `idle` and
 * `wreck` -- two constant scale clips that swap the live body for the
 * `death_root` copy -- and still zero skins. The CLIPLESS case remains the
 * one this module is most careful about, because it is the case that must
 * look identical to before: a template built from a clipless GLB carries an
 * empty `clips` map, and `instantiateVehicleMesh` then allocates **no
 * mixer at all** (`mixer: null`, `actions` empty). No mixer means no
 * `mixer.update` per frame, no actions to switch, and nothing that can
 * touch the clone's transform tree -- the same object graph, and the same
 * per-frame cost, the clipless path had before clips existed.
 *
 * Clip SELECTION is `../../clip.ts`'s `resolveClip`, unchanged and shared
 * with infantry, and clip SWITCHING is `mesh-clip.ts`'s `applyMeshClip`,
 * likewise -- a `VehicleMeshEntity` satisfies its `ClipPlayer` shape
 * structurally. Neither is reimplemented here. What that buys is that a
 * vehicle reaches exactly the states a rifleman does, from exactly the same
 * sim reads: `work` for a dozer razing a building, `move` for a hull that
 * is actually rolling, `idle` otherwise.
 *
 * A `THREE.Object3D.clone(true)` (not `SkeletonUtils.clone`, which exists
 * for shared-skeleton problems this rigid tree does not have) gives one
 * instance its own transform tree while sharing every mesh's geometry and
 * material by reference with the template -- the identical sharing contract
 * `MeshUnitTemplate` documents, so disposal follows the same "template owns
 * it, entity never touches it" split. `clone(true)` deep-copies NODES,
 * which is what makes a per-clone mixer correct here: each clone's
 * animated nodes are its own, so two dozers can be mid-clip at different
 * phases without fighting over one transform (the rigid-tree counterpart of
 * the shared-skeleton hazard `mesh-unit.ts` uses `SkeletonUtils.clone` to
 * avoid).
 */
import * as THREE from 'three';
import { gltfLoader } from './gltf-loader';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ClipName } from '../../sheet';
import { charredTexturedMaterial, rampMaterial, texturedMaterial } from '../world-materials';
import { CHARRED_RAMP, isVehicleMeshRole, rampForVehicleRole } from './vehicle-mesh-role';
import { isMeshClipName, MESH_SCALE } from './mesh-anim';
import type { ClipPlayer } from './mesh-clip';
import { HULL_RENDER_ORDER, TURRET_RENDER_ORDER } from './render-order';

/** The pivot node's own name, per the contract: "The turret pivot is a node
 *  named `turret_pivot` carrying `extras.rl_pivot = "turret"` on that node
 *  and not its children." Looked up by name first (below), falling back to
 *  scanning for `extras.rl_pivot === PIVOT_ROLE` -- the contract's own
 *  fallback order, "so a future crane or dozer blade needs no new
 *  convention": a differently-NAMED pivot node still carries the extras key,
 *  even if some future export renames the node itself. */
const PIVOT_NODE_NAME = 'turret_pivot';
const PIVOT_ROLE = 'turret';

/**
 * The rotor pivot -- a SECOND, independent pivot kind alongside
 * `turret_pivot` above, added for `heli_peten` (the first mesh vehicle with
 * a spinning part that is not a weapon traverse). Same two-tier lookup
 * (name first, `extras.rl_pivot` fallback), same reasoning, kept as its own
 * pair of constants rather than generalised into a role-keyed pivot table:
 * exactly two pivot kinds exist today, and a vehicle either has a turret, a
 * rotor, both, or neither -- `tools/vehicles/export_meshy_apache.py`'s own
 * docstring ("ROTOR PIVOT") has the export-side half of this convention.
 * Unlike `turret_pivot`, a rotor spins at a constant rate with no target to
 * track (`ThreeRenderer.updateVehicleMeshes`'s own rotor-spin block), so it
 * needs no spring state to go with it.
 *
 * The spin is `rotation.y` on THIS node, i.e. about the pivot's own local
 * up -- which is world up only while every ancestor is at identity. Since
 * 2026-09-07 `heli_peten.glb` parents `rotor_pivot` under a `rotor_tilt`
 * empty whose local up is the disc's fitted normal (Meshy built the disc
 * pitched 3.26 degrees nose-down; spinning it about world up made every tip
 * bob 0.21 m per revolution), so the same one line of renderer code spins it
 * about the disc's own axis. Nothing here reads the parent: the two-tier
 * lookup finds the pivot anywhere under the root, and the tilt node is
 * skipped like any other non-mesh. A propeller could reuse the same pair
 * with the tilt node turned onto the thrust axis -- see
 * `tools/vehicles/export_meshy_apache.py` ("THE DISC IS TILTED").
 */
const ROTOR_PIVOT_NODE_NAME = 'rotor_pivot';
const ROTOR_PIVOT_ROLE = 'rotor';

/**
 * The wreck half of the vehicle asset contract (spec §4.1), written by
 * `tools/src/meshes/wreck-pass.ts`: ONE extra top-level node holding one
 * `WRECK_<name>` child per live mesh node, each referencing the SAME glTF
 * mesh its twin does and carrying that twin's extras plus `rl_wreck: true`.
 *
 * `GLTFLoader` gives two nodes that share a glTF mesh two distinct
 * `THREE.Mesh` objects over ONE `BufferGeometry` and, on a textured export,
 * ONE `THREE.Material` -- which is why `buildVehicleMeshTemplate` below
 * dedupes BOTH lists by object identity. What keeps a wreck's material
 * distinct from its twin's is not the absence of dedup (this comment claimed
 * that until the fix round, and it was wrong): it is that
 * `charredTexturedMaterial` returns a CLONE, so the two are different
 * objects and identity dedup keeps both.
 */
export const VEHICLE_DEATH_ROOT_NAME = 'death_root';
const WRECK_NODE_PREFIX = 'WRECK_';

/** `{part}_` prefix -> the render-order band its meshes draw at, per the
 *  contract: "Render order is per-mesh... hull parts at HULL_RENDER_ORDER,
 *  turret parts at TURRET_RENDER_ORDER, keyed off the `{part}_` prefix."
 *  A mesh whose name has neither prefix (not reachable by any shipped GLB --
 *  every part observed is `hull_*` or `turret_*`) is left at HULL_RENDER_ORDER,
 *  the safer of the two bands: it loses a render-order tie to a turret rather
 *  than winning one it has no claim to. */
function renderOrderForPart(meshName: string): number {
  // A wreck copy is the same PART as its twin, so it belongs in the same
  // band: `WRECK_turret_metal` is a turret. Stripping the prefix first is
  // what keeps that true -- without it every wreck mesh, turret included,
  // fell through to `HULL_RENDER_ORDER`.
  const part = meshName.startsWith(WRECK_NODE_PREFIX) ? meshName.slice(WRECK_NODE_PREFIX.length) : meshName;
  if (part.startsWith('turret_')) return TURRET_RENDER_ORDER;
  return HULL_RENDER_ORDER;
}

/** One loaded `art/meshes/vehicles/<id>.glb`, kept as a clone source --
 *  mirrors `MeshUnitTemplate`'s own doc comment on shared-by-reference
 *  `materials`/`geometries`, disposed exactly once, here, never per-clone. */
export interface VehicleMeshTemplate {
  readonly root: THREE.Object3D;
  /**
   * Every clip this GLB authored, keyed by its canonical `ClipName`.
   *
   * **Every shipped vehicle now carries exactly `idle` and `wreck`** (the
   * wreck pass, 2026-09-15) -- this said "empty for every shipped vehicle
   * today" until then. The EMPTY map is still the load-bearing case to keep
   * working, not a degenerate one: it is what tells `instantiateVehicleMesh`
   * to allocate no mixer at all, it is what `&nomesh` and any future
   * un-passed export land on, and it is what `hasWreck: false` means. See
   * this module's own top comment.
   */
  readonly clips: ReadonlyMap<ClipName, THREE.AnimationClip>;
  /**
   * Every material this template owns and disposes exactly once -- one per
   * DISTINCT OBJECT, deduped by identity, exactly like `geometries` below.
   *
   * Sharing here is real and arrives from TWO directions, and the list said
   * "one per MESH, never deduped" until 2026-09-15, which was false on every
   * shipped textured vehicle. `mbt_lavi.glb`'s four live meshes all reference
   * glTF material 0, so `GLTFLoader` builds ONE `THREE.Material` for all four
   * and `texturedMaterial` hands that same object straight back -- the live
   * path pushed it four times and `disposeVehicleMeshTemplate` disposed it
   * four times. (The palette path allocates a fresh `rampMaterial` per mesh,
   * which is why the fixture-driven tests could not see it.) The wreck half
   * shares the same way: `charredTexturedMaterial` is memoised per ORIGINAL
   * material inside `buildVehicleMeshTemplate`, so four wreck meshes over one
   * bake get ONE charred clone between them rather than four identical ones.
   *
   * What must never be deduped is a wreck material against its LIVE twin's:
   * they reference one glTF material and the whole point of the copy is that
   * one is charred and the other is not. Identity dedup gets that right for
   * free -- the charred clone is a different object. See
   * `VEHICLE_DEATH_ROOT_NAME`.
   */
  readonly materials: readonly THREE.Material[];
  /** Every DISTINCT `BufferGeometry` this template owns, deduped by object
   *  identity -- the same rule as `materials` above, for the same reason: a
   *  wreck copy shares its twin's geometry, and disposing one object twice
   *  is a real bug rather than a harmless repeat. */
  readonly geometries: readonly THREE.BufferGeometry[];
  /** True when this vehicle's GLB carries the `wreck` clip -- i.e. the wreck
   *  pass has run on it and there is a death pose to settle into. The ONE
   *  gate the renderer's whole death hand-off turns on: `addWreck` steps
   *  aside, the billboard death fade is skipped, and the prune loop hands
   *  the entity to `mesh-vehicle-death.ts` only for a type where this is
   *  true. A vehicle without it keeps the billboard path byte for byte
   *  (CLAUDE.md's own trap: excluding every vehicle template unconditionally
   *  deletes the sprite wreck and leaves nothing behind). */
  readonly hasWreck: boolean;
  /** True when this vehicle's GLB carries a `turret_pivot` node -- a dozer
   *  or a hull-only type legitimately has none (`dozer_d9.glb` today), and
   *  that is not an error: it simply means this vehicle's turret facing is
   *  never read. */
  readonly hasTurretPivot: boolean;
  /** True when this vehicle's GLB carries a `rotor_pivot` node -- every
   *  ground vehicle legitimately has none; `heli_peten` is the first with
   *  one. See `ROTOR_PIVOT_NODE_NAME`'s own doc comment. */
  readonly hasRotorPivot: boolean;
}

/**
 * Assembles a `VehicleMeshTemplate` from an already-parsed `GLTF` result --
 * decoupled from `GLTFLoader` itself (`loadVehicleMeshTemplate` below owns
 * the fetch), the identical split `mesh-unit.ts`'s `buildMeshUnitTemplate`
 * makes and for the same reason: exercisable against a hand-authored fixture
 * with no network and no `WebGLRenderer`.
 *
 * `vehicleId` selects BOTH the ramp table (`rampForVehicleRole`) and is
 * otherwise unused -- there is no faction parameter here at all (the
 * contract's own "No faction parameter for vehicles" section; see
 * `vehicle-mesh-role.ts`'s top comment for the full argument).
 *
 * `animations` is OPTIONAL in this signature, unlike
 * `buildMeshUnitTemplate`'s. A real `GLTFLoader` result always supplies the
 * key (as `[]` when the file declares none), so this is not about
 * production at all -- it keeps every existing hand-built fixture that
 * passes only `{ scene }` compiling unchanged, which is itself part of
 * proving the clipless path did not move. An unrecognised clip name fails
 * exactly the way `buildMeshUnitTemplate` fails it: "a clip present under
 * any other name is a failure" (`mesh-unit-contract.md`), loudly and at
 * load time, rather than silently never playing.
 *
 * `allowTextured` (default `false`, mirroring `buildBuildingMeshTemplate`'s
 * own default) is the caller's answer to
 * `TEXTURED_VEHICLE_TYPES.has(vehicleId)` -- see `units/textured-vehicle.ts`
 * for the named list. The material itself is `texturedMaterial`
 * (`../world-materials.ts`), the SAME function `mesh-building.ts` calls
 * rather than a vehicle-specific fork: it keeps and normalises whatever
 * material `GLTFLoader` already built for the mesh (sRGB map, dielectric
 * unless the GLB says otherwise) instead of building a private shader per
 * asset class. The toon shader's own "Cel specular" ramp trick a vehicle
 * hull used to opt into (`palette-material.ts`, `specular: true`) has no
 * counterpart here and needs none: a lit material's specular response comes
 * from `roughness`/`metalness` against the scene's real sun, not a
 * hand-picked ramp step.
 */
export function buildVehicleMeshTemplate(
  gltf: Pick<GLTF, 'scene'> & Partial<Pick<GLTF, 'animations'>>,
  vehicleId: string,
  allowTextured = false
): VehicleMeshTemplate {
  const root = gltf.scene;
  root.scale.setScalar(MESH_SCALE);

  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  // Deduped by IDENTITY, not by contents: a `WRECK_` node and its live twin
  // reference one glTF mesh, so `GLTFLoader` hands back two `THREE.Mesh`
  // objects over one `BufferGeometry`, and pushing it twice would have
  // `disposeVehicleMeshTemplate` dispose the same object twice.
  const seenGeometries = new Set<THREE.BufferGeometry>();
  const addGeometry = (g: THREE.BufferGeometry): void => {
    if (seenGeometries.has(g)) return;
    seenGeometries.add(g);
    geometries.push(g);
  };
  // Same rule for materials, and it is not merely defensive: every shipped
  // textured vehicle shares ONE `THREE.Material` across all of its live
  // meshes (one glTF material, four meshes on `mbt_lavi`), so an un-deduped
  // list disposes that object once per mesh. See `VehicleMeshTemplate.
  // materials`.
  const seenMaterials = new Set<THREE.Material>();
  const addMaterial = (m: THREE.Material): void => {
    if (seenMaterials.has(m)) return;
    seenMaterials.add(m);
    materials.push(m);
  };
  /**
   * The charred clone for one loaded bake, built at most once per template.
   *
   * Keyed on the ORIGINAL material rather than on the mesh, because that is
   * the thing that is actually shared: four `WRECK_` meshes over one glTF
   * material would otherwise get four byte-identical charred clones, each
   * its own GPU upload. Keyed on the original rather than on the NORMALISED
   * one only because they are the same object for every real bake
   * (`texturedMaterial` returns its argument when it is already a
   * `MeshStandardMaterial`, which is every `GLTFLoader` PBR material) -- and
   * where they are not, the memo simply misses and mints a second clone,
   * which is still correct because `addMaterial` records each distinct one.
   */
  const charredByOriginal = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  const charredFor = (loaded: THREE.Material): THREE.MeshStandardMaterial => {
    const existing = charredByOriginal.get(loaded);
    if (existing) return existing;
    const charred = charredTexturedMaterial(loaded);
    charredByOriginal.set(loaded, charred);
    return charred;
  };
  const unmapped = new Set<string>();
  const smuggled = new Set<string>();
  let pivotNode: THREE.Object3D | null = null;
  let rotorPivotNode: THREE.Object3D | null = null;

  root.traverse((o) => {
    if (o.name === VEHICLE_DEATH_ROOT_NAME) {
      // A living vehicle draws no wreck, and the clips alone are not enough
      // to say so: `idle` keys the death root's SCALE to 0, and a scale-0
      // mesh is still SUBMITTED -- three.js frustum-culls on a bounding
      // sphere that collapses to a point at the vehicle's own position,
      // which is in frustum, so every shipped vehicle would carry 4-8 draw
      // calls that rasterise nothing (Task 2's own report measured the
      // shape). `visible = false` is what three.js actually prunes on: it
      // skips the whole subtree in `projectObject` and never reaches a
      // child. Set on the TEMPLATE, so `clone(true)` (which copies
      // `.visible`) hands every future instance the same state for free;
      // `mesh-vehicle-death.ts` is the only thing that ever sets it back.
      o.visible = false;
      // NOT `return`-ing past the mesh branch below: `Object3D.traverse`
      // ignores what this callback returns and still walks the children, and
      // the children are exactly the wreck meshes that need charring.
    }
    if (o.name === PIVOT_NODE_NAME) {
      pivotNode = o;
      return;
    }
    if (o.name === ROTOR_PIVOT_NODE_NAME) {
      rotorPivotNode = o;
      return;
    }
    const extrasPivot = (o.userData as { rl_pivot?: unknown }).rl_pivot;
    if (!pivotNode && extrasPivot === PIVOT_ROLE) {
      // Fallback path, per the contract: found by scanning `extras.rl_pivot`
      // rather than by the node's own name.
      pivotNode = o;
    }
    if (!rotorPivotNode && extrasPivot === ROTOR_PIVOT_ROLE) {
      rotorPivotNode = o;
    }

    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // The wreck branch, and it is deliberately a MODIFIER on whichever
    // branch this mesh's twin takes rather than a branch of its own (spec
    // §4.3, as restated by the plan header for the lit renderer): a palette
    // wreck is `rampMaterial(CHARRED_RAMP)` and a textured one is a tinted
    // clone of the same normalised bake. Everything else about the mesh --
    // shadows, render-order band, the role validation below -- is exactly
    // what its live twin gets, because it IS its live twin's geometry.
    const isWreck = (mesh.userData as { rl_wreck?: unknown }).rl_wreck === true;
    const extrasRole = (mesh.userData as { rl_role?: unknown }).rl_role;
    // The name-only fallback strips `WRECK_` for the same reason
    // `renderOrderForPart` does: a wreck copy's ROLE is its twin's role, and
    // `WRECK_hull` is not in the vocabulary. The shipped files never reach
    // this (the wreck pass copies its twin's extras, `rl_role` included, and
    // `validate_mesh_assets.py` requires them), but a twin authored with a
    // name and no extras would otherwise fail on its wreck alone.
    const nameRole = isWreck && mesh.name.startsWith(WRECK_NODE_PREFIX)
      ? mesh.name.slice(WRECK_NODE_PREFIX.length)
      : mesh.name;
    const role = typeof extrasRole === 'string' && extrasRole.length > 0 ? extrasRole : nameRole;

    // The per-MESH textured opt-out -- see `units/mesh-building.ts`'s
    // identical block for the full reasoning, restated here only where it
    // differs. Checked BEFORE `isVehicleMeshRole`: a textured mesh needs no
    // ramp. Render order and the turret/rotor pivot lookup above are
    // unaffected either way -- both are decided from the node's own name/
    // extras, not from whether it draws through a ramp or a photograph.
    const loaded = mesh.material as THREE.Material | undefined;
    const loadedMap =
      loaded && 'map' in loaded ? ((loaded as { map?: THREE.Texture | null }).map ?? null) : null;
    if (loadedMap) {
      if (!allowTextured) {
        smuggled.add(role || '(unnamed mesh)');
        return;
      }
      const textured = isWreck
        ? charredFor(loaded as THREE.Material)
        : texturedMaterial(loaded as THREE.Material);
      mesh.material = textured;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = renderOrderForPart(mesh.name);
      addMaterial(textured);
      addGeometry(mesh.geometry);
      return;
    }

    if (!isVehicleMeshRole(role)) {
      unmapped.add(role || '(unnamed mesh)');
      return;
    }
    // Every ramp asset -- vehicle hull included -- takes its ramp's lit step
    // as a flat albedo (`rampMaterial`, `../world-materials.ts`); specular
    // response now comes from the shared `WORLD_ROUGHNESS`/metalness against
    // the scene's real sun, not a per-material opt-in.
    //
    // A wreck part takes `CHARRED_RAMP` whatever its role is -- see that
    // constant's own doc comment. The role is still validated above, because
    // a wreck copy whose role is outside this vehicle's own table means the
    // pass copied extras from a node this module could not have drawn either.
    const mat = rampMaterial(isWreck ? CHARRED_RAMP : rampForVehicleRole(vehicleId, role));
    mesh.material = mat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = renderOrderForPart(mesh.name);
    addMaterial(mat);
    addGeometry(mesh.geometry);
  });

  if (smuggled.size > 0) {
    throw new Error(
      `mesh-vehicle: ${[...smuggled].join(', ')} ships a texture, but vehicle "${vehicleId}" is not in ` +
        `TEXTURED_VEHICLE_TYPES (textured-vehicle.ts). Add it there and to TEXTURED_VEHICLE_EXEMPT ` +
        `in tools/validate_mesh_assets.py, or export the GLB without materials.`
    );
  }
  if (unmapped.size > 0) {
    throw new Error(`mesh-vehicle: no ramp for rl_role ${[...unmapped].join(', ')} (vehicle "${vehicleId}")`);
  }

  const clips = new Map<ClipName, THREE.AnimationClip>();
  for (const clip of gltf.animations ?? []) {
    if (!isMeshClipName(clip.name)) {
      throw new Error(
        `mesh-vehicle: animation "${clip.name}" is not a recognised clip name (mesh-unit-contract.md), vehicle "${vehicleId}"`
      );
    }
    clips.set(clip.name, clip);
  }

  return {
    root,
    clips,
    materials,
    geometries,
    hasWreck: clips.has('wreck'),
    hasTurretPivot: pivotNode !== null,
    hasRotorPivot: rotorPivotNode !== null,
  };
}

/** Fetches and parses `glbUrl`, then builds a `VehicleMeshTemplate` --
 *  mirrors `mesh-unit.ts`'s `loadMeshUnitTemplate` exactly, minus the
 *  faction parameter (vehicles have none, see this module's top comment).
 *  `allowTextured` threads through unchanged; see `buildVehicleMeshTemplate`
 *  for what it gates. */
export async function loadVehicleMeshTemplate(
  glbUrl: string,
  vehicleId: string,
  allowTextured = false
): Promise<VehicleMeshTemplate> {
  const gltf = await gltfLoader().loadAsync(glbUrl);
  return buildVehicleMeshTemplate(gltf, vehicleId, allowTextured);
}

/** One living entity's vehicle instance. `turretPivot`, if present, is
 *  THIS clone's own `turret_pivot` node (`Object3D.clone(true)` deep-clones
 *  the whole tree, so it is never the template's shared node) -- rotating it
 *  turns only this vehicle's turret. */
export interface VehicleMeshEntity extends ClipPlayer {
  readonly typeId: string;
  readonly root: THREE.Object3D;
  /**
   * This clone's own mixer, or `null` when its GLB authored no clips --
   * no longer any shipped vehicle (the wreck pass gives all eleven `idle`
   * and `wreck`), but still the case that must cost nothing when it occurs.
   * `null` is not "not yet built": it is final for this entity's
   * whole life, because clip presence is a property of the template it was
   * cloned from. Callers gate their whole per-frame animation block on it
   * (`ThreeRenderer.updateVehicleMeshes`) so a clipless vehicle never even
   * builds the `UnitAnimInput` object a clip decision would need.
   *
   * Nullable where `MeshUnitEntity.mixer` is not, and that asymmetry is
   * deliberate rather than an oversight: an infantry GLB without clips
   * would be a broken export (the contract requires the clip set), while a
   * vehicle without clips is the normal, shipped, correct state.
   */
  readonly mixer: THREE.AnimationMixer | null;
  readonly turretPivot: THREE.Object3D | null;
  /**
   * `turretPivot`'s own AUTHORED local position at clone time (root-local
   * units, i.e. `MESH_UNITS_PER_TILE` per tile, the same space the GLB
   * itself was built in) -- where on the hull the turret actually sits.
   * `null` exactly when `turretPivot` is `null`.
   *
   * Recorded once, here, rather than read back from `turretPivot.position`
   * every frame: a per-shot recoil kick (`ThreeRenderer.updateVehicleMeshes`)
   * has to OFFSET the pivot from its rest position and return to it as the
   * shot decays, not overwrite it outright -- overwriting would erase
   * whatever offset the export authored to seat the turret correctly on the
   * hull, snapping it to the origin the instant a single shell fires.
   */
  readonly turretPivotBase: THREE.Vector3 | null;
  /** THIS clone's own `rotor_pivot` node, same cloning reasoning as
   *  `turretPivot` above. Spun at a constant rate by
   *  `ThreeRenderer.updateVehicleMeshes` -- unlike the turret, a rotor
   *  tracks no target and needs no base/rest position to kick away from and
   *  return to, so there is no `rotorPivotBase` counterpart. */
  readonly rotorPivot: THREE.Object3D | null;
  /** THIS clone's own `death_root` node, or `null` for a GLB the wreck pass
   *  has not run on. Invisible for as long as the vehicle lives (set on the
   *  template, inherited by `clone(true)`); `mesh-vehicle-death.ts` is the
   *  one thing that ever reveals it. */
  readonly deathRoot: THREE.Object3D | null;
  /**
   * This clone's top-level LIVE nodes -- every scene-root child except
   * `deathRoot`.
   *
   * Captured here, at instantiation, rather than re-derived at death, and
   * that timing is the point: by the time a vehicle dies its root has picked
   * up a silhouette child per live mesh (`attachMeshSilhouette` adds them as
   * SIBLINGS), so a `children.filter(...)` taken then would answer a
   * different, larger set. These are the nodes the `wreck` clip scales to
   * zero, and the nodes the death path then hides outright -- a scale-0 mesh
   * is still submitted to the GPU.
   */
  readonly liveTop: readonly THREE.Object3D[];
}

/**
 * Clones `template.root` and re-locates ITS OWN `turret_pivot` node inside
 * the clone -- `Object3D.clone(true)` (three.js's own deep clone) rebuilds
 * every node with a new identity, so the template's `pivotNode` reference
 * would point at the WRONG tree if reused here; each clone is searched
 * independently, by the same name-then-extras rule `buildVehicleMeshTemplate`
 * uses, so a future rename stays consistent between the two lookups.
 */
export function instantiateVehicleMesh(template: VehicleMeshTemplate, typeId: string): VehicleMeshEntity {
  const root = template.root.clone(true);
  let turretPivot: THREE.Object3D | null = null;
  if (template.hasTurretPivot) {
    root.traverse((o) => {
      if (turretPivot) return;
      if (o.name === PIVOT_NODE_NAME) {
        turretPivot = o;
        return;
      }
      const extrasPivot = (o.userData as { rl_pivot?: unknown }).rl_pivot;
      if (extrasPivot === PIVOT_ROLE) turretPivot = o;
    });
  }
  const turretPivotBase: THREE.Vector3 | null = turretPivot ? (turretPivot as THREE.Object3D).position.clone() : null;
  let rotorPivot: THREE.Object3D | null = null;
  if (template.hasRotorPivot) {
    root.traverse((o) => {
      if (rotorPivot) return;
      if (o.name === ROTOR_PIVOT_NODE_NAME) {
        rotorPivot = o;
        return;
      }
      const extrasPivot = (o.userData as { rl_pivot?: unknown }).rl_pivot;
      if (extrasPivot === ROTOR_PIVOT_ROLE) rotorPivot = o;
    });
  }

  // The mixer, and ONLY when this template actually carries clips. A GLB
  // with none gets `null` here and an empty actions map -- see
  // `VehicleMeshEntity.mixer`'s own doc comment, and this module's top
  // comment, for why that specific shape is what keeps every shipped
  // vehicle byte-for-byte as it was.
  let mixer: THREE.AnimationMixer | null = null;
  const actions = new Map<ClipName, THREE.AnimationAction>();
  if (template.clips.size > 0) {
    mixer = new THREE.AnimationMixer(root);
    for (const [name, clip] of template.clips) {
      actions.set(name, mixer.clipAction(clip));
    }
  }

  // The live/dead split of the scene roots, taken BEFORE anything else can
  // add a child (see `VehicleMeshEntity.liveTop`). One pass over 4-8
  // children, not a `traverse`: the contract puts `death_root` at the top
  // level and nowhere else.
  let deathRoot: THREE.Object3D | null = null;
  const liveTop: THREE.Object3D[] = [];
  for (const child of root.children) {
    if (child.name === VEHICLE_DEATH_ROOT_NAME) deathRoot = child;
    else liveTop.push(child);
  }

  return {
    typeId,
    root,
    mixer,
    actions,
    currentClip: null,
    turretPivot,
    turretPivotBase,
    rotorPivot,
    deathRoot,
    liveTop,
  };
}

/**
 * Releases everything a `VehicleMeshEntity` owns for itself -- its mixer's
 * actions, and the mixer's binding to this clone's nodes. Its `root`'s
 * meshes share the TEMPLATE's geometries/materials (see
 * `VehicleMeshTemplate`'s own doc comment) and must not be disposed here;
 * only `disposeVehicleMeshTemplate` (below) owns those. Mirrors
 * `mesh-unit.ts`'s `disposeMeshUnitEntity` exactly.
 *
 * A safe no-op for a clipless entity -- no longer any shipped vehicle (the
 * 2026-09-15 wreck pass gave all eleven `idle` and `wreck`), but still the
 * state `&nomesh` and any un-passed re-export are in: there
 * is no mixer to stop, and there never was one to leak. This function did
 * not exist at all before vehicles could animate -- `mesh-vehicle.ts`'s own
 * header used to say so ("there is no per-entity disposal function here at
 * all... because a `VehicleMeshEntity` owns nothing of its own to
 * release"), which stopped being true the moment a mixer could exist.
 */
export function disposeVehicleMeshEntity(entity: VehicleMeshEntity): void {
  if (!entity.mixer) return;
  entity.mixer.stopAllAction();
  entity.mixer.uncacheRoot(entity.root);
}

/** Releases a template's own owned resources -- every clone made from it
 *  must already be torn down (`disposeVehicleMeshEntity`) and removed from
 *  the scene first, since they share these exact objects by reference (this
 *  module's own top comment). Mirrors `mesh-unit.ts`'s
 *  `disposeMeshUnitTemplate` exactly. */
export function disposeVehicleMeshTemplate(template: VehicleMeshTemplate): void {
  for (const material of template.materials) material.dispose();
  for (const geometry of template.geometries) geometry.dispose();
}
