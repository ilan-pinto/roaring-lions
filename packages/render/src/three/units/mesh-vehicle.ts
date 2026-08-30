/**
 * Vehicle meshes: rigid hull-plus-pivot-turret geometry, the mesh-unit
 * contract v2's second asset class. Shares almost nothing with
 * `mesh-unit.ts`'s infantry path by design -- the contract's own words:
 * "a skinned single-armature figure and a rigid hull-plus-pivot-turret share
 * nothing beyond 'walk the meshes, assign a material'." Concretely: no skin,
 * no `AnimationMixer`, no clips (every shipped `art/meshes/vehicles/*.glb`
 * declares zero `animations`), and geometry is joined by `{part}_{role}`
 * rather than by role alone -- `turret_metal` and `hull_metal` must stay two
 * separate meshes so the turret can rotate independently of the hull, where
 * infantry's `metal` role joins into ONE mesh across the whole figure.
 *
 * A `THREE.Object3D.clone(true)` (not `SkeletonUtils.clone`, which exists
 * for shared-skeleton problems this rigid tree does not have) gives one
 * instance its own transform tree while sharing every mesh's geometry and
 * material by reference with the template -- the identical sharing contract
 * `MeshUnitTemplate` documents, so disposal follows the same "template owns
 * it, entity never touches it" split.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { toonRampMaterial } from '../palette-material';
import { isVehicleMeshRole, rampForVehicleRole } from './vehicle-mesh-role';
import { MESH_SCALE } from './mesh-anim';
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
  readonly materials: readonly THREE.Material[];
  readonly geometries: readonly THREE.BufferGeometry[];
  /** True when this vehicle's GLB carries a `turret_pivot` node -- a dozer
   *  or a hull-only type legitimately has none (`dozer_d9.glb` today), and
   *  that is not an error: it simply means this vehicle's turret facing is
   *  never read. */
  readonly hasTurretPivot: boolean;
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
 */
export function buildVehicleMeshTemplate(
  gltf: Pick<GLTF, 'scene'>,
  vehicleId: string
): VehicleMeshTemplate {
  const root = gltf.scene;
  root.scale.setScalar(MESH_SCALE);

  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const unmapped = new Set<string>();
  let pivotNode: THREE.Object3D | null = null;

  root.traverse((o) => {
    if (o.name === PIVOT_NODE_NAME) {
      pivotNode = o;
      return;
    }
    const extrasPivot = (o.userData as { rl_pivot?: unknown }).rl_pivot;
    if (!pivotNode && extrasPivot === PIVOT_ROLE) {
      // Fallback path, per the contract: found by scanning `extras.rl_pivot`
      // rather than by the node's own name.
      pivotNode = o;
    }

    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const extrasRole = (mesh.userData as { rl_role?: unknown }).rl_role;
    const role = typeof extrasRole === 'string' && extrasRole.length > 0 ? extrasRole : mesh.name;
    if (!isVehicleMeshRole(role)) {
      unmapped.add(role || '(unnamed mesh)');
      return;
    }
    const mat = toonRampMaterial(rampForVehicleRole(vehicleId, role));
    mesh.material = mat;
    mesh.renderOrder = renderOrderForPart(mesh.name);
    materials.push(mat);
    geometries.push(mesh.geometry);
  });

  if (unmapped.size > 0) {
    throw new Error(`mesh-vehicle: no ramp for rl_role ${[...unmapped].join(', ')} (vehicle "${vehicleId}")`);
  }

  return { root, materials, geometries, hasTurretPivot: pivotNode !== null };
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
export interface VehicleMeshEntity {
  readonly typeId: string;
  readonly root: THREE.Object3D;
  readonly turretPivot: THREE.Object3D | null;
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
  return { typeId, root, turretPivot };
}

/** Releases a template's own owned resources -- every clone made from it
 *  must already be removed from the scene first, since they share these
 *  exact objects by reference (this module's own top comment). Mirrors
 *  `mesh-unit.ts`'s `disposeMeshUnitTemplate` exactly; there is no
 *  per-entity disposal function here at all, unlike infantry's
 *  `disposeMeshUnitEntity`, because a `VehicleMeshEntity` owns nothing of
 *  its own to release -- no mixer, no per-entity material clone. */
export function disposeVehicleMeshTemplate(template: VehicleMeshTemplate): void {
  for (const material of template.materials) material.dispose();
  for (const geometry of template.geometries) geometry.dispose();
}
