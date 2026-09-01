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
 * ## Animation, and the "no clips" case that is still every shipped asset
 *
 * This module ALSO builds an `AnimationMixer` now, which it did not
 * originally -- the header used to read "no `AnimationMixer`, no clips",
 * and that was a statement about the ENGINE, not just about the assets.
 * Infantry had a mixer, an actions map and clip switching from the day
 * `mesh-unit.ts` shipped; vehicles never got one, so a tank's tracks could
 * not move and a dozer's blade could not lift even if a GLB authored the
 * motion. The engine half is now here.
 *
 * The asset half has NOT changed: every shipped `art/meshes/vehicles/*.glb`
 * still declares zero `animations` and zero skins. That case is the one
 * this module is most careful about, because it is the case that must look
 * identical to before: a template built from a clipless GLB carries an
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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ClipName } from '../../sheet';
import { toonRampMaterial } from '../palette-material';
import { isVehicleMeshRole, rampForVehicleRole } from './vehicle-mesh-role';
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
 */
const ROTOR_PIVOT_NODE_NAME = 'rotor_pivot';
const ROTOR_PIVOT_ROLE = 'rotor';

/** `{part}_` prefix -> the render-order band its meshes draw at, per the
 *  contract: "Render order is per-mesh... hull parts at HULL_RENDER_ORDER,
 *  turret parts at TURRET_RENDER_ORDER, keyed off the `{part}_` prefix."
 *  A mesh whose name has neither prefix (not reachable by any shipped GLB --
 *  every part observed is `hull_*` or `turret_*`) is left at HULL_RENDER_ORDER,
 *  the safer of the two bands: it loses a render-order tie to a turret rather
 *  than winning one it has no claim to. */
function renderOrderForPart(meshName: string): number {
  if (meshName.startsWith('turret_')) return TURRET_RENDER_ORDER;
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
   * **Empty for every shipped vehicle today** -- all nine
   * `art/meshes/vehicles/*.glb` declare zero `animations` -- and an empty
   * map is the load-bearing case, not a degenerate one: it is what tells
   * `instantiateVehicleMesh` to allocate no mixer at all. See this module's
   * own top comment.
   */
  readonly clips: ReadonlyMap<ClipName, THREE.AnimationClip>;
  readonly materials: readonly THREE.Material[];
  readonly geometries: readonly THREE.BufferGeometry[];
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
 */
export function buildVehicleMeshTemplate(
  gltf: Pick<GLTF, 'scene'> & Partial<Pick<GLTF, 'animations'>>,
  vehicleId: string
): VehicleMeshTemplate {
  const root = gltf.scene;
  root.scale.setScalar(MESH_SCALE);

  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const unmapped = new Set<string>();
  let pivotNode: THREE.Object3D | null = null;
  let rotorPivotNode: THREE.Object3D | null = null;

  root.traverse((o) => {
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
    const extrasRole = (mesh.userData as { rl_role?: unknown }).rl_role;
    const role = typeof extrasRole === 'string' && extrasRole.length > 0 ? extrasRole : mesh.name;
    if (!isVehicleMeshRole(role)) {
      unmapped.add(role || '(unnamed mesh)');
      return;
    }
    // Cel specular ON: a vehicle hull is exactly the "reads as a hard
    // surface" case `palette-material.ts`'s own "Cel specular" doc comment
    // names first -- see it for why this is opt-in per material rather than
    // always on, and `units/mesh-building.ts`'s own call site for the one
    // that deliberately leaves it off.
    const mat = toonRampMaterial(rampForVehicleRole(vehicleId, role), { specular: true });
    mesh.material = mat;
    mesh.renderOrder = renderOrderForPart(mesh.name);
    materials.push(mat);
    geometries.push(mesh.geometry);
  });

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
    hasTurretPivot: pivotNode !== null,
    hasRotorPivot: rotorPivotNode !== null,
  };
}

/** Fetches and parses `glbUrl`, then builds a `VehicleMeshTemplate` --
 *  mirrors `mesh-unit.ts`'s `loadMeshUnitTemplate` exactly, minus the
 *  faction parameter (vehicles have none, see this module's top comment). */
export async function loadVehicleMeshTemplate(glbUrl: string, vehicleId: string): Promise<VehicleMeshTemplate> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  return buildVehicleMeshTemplate(gltf, vehicleId);
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
   * which is every shipped vehicle today, and the case that must cost
   * nothing. `null` is not "not yet built": it is final for this entity's
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

  return { typeId, root, mixer, actions, currentClip: null, turretPivot, turretPivotBase, rotorPivot };
}

/**
 * Releases everything a `VehicleMeshEntity` owns for itself -- its mixer's
 * actions, and the mixer's binding to this clone's nodes. Its `root`'s
 * meshes share the TEMPLATE's geometries/materials (see
 * `VehicleMeshTemplate`'s own doc comment) and must not be disposed here;
 * only `disposeVehicleMeshTemplate` (below) owns those. Mirrors
 * `mesh-unit.ts`'s `disposeMeshUnitEntity` exactly.
 *
 * A safe no-op for a clipless entity, which is every shipped vehicle: there
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
