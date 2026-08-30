/**
 * Building meshes: the mesh-unit contract v2's third asset class, and its
 * simplest -- "rigid and never turns... no armature, no skin, no clips, no
 * pivot." Two sibling files per type (`<type>.glb` standing,
 * `<type>_wreck.glb` destroyed); this module builds a template from either
 * one, identically -- the caller (`ThreeRenderer.loadBuildingMesh`) is what
 * knows which file is which and swaps between the two templates it builds.
 *
 * No render-order distinction either (unlike vehicles' hull/turret split):
 * every building mesh part is left at `HULL_RENDER_ORDER`, three.js's own
 * default, exactly like `StructureInstancer`'s billboards -- see
 * `units/render-order.ts`'s own table, band 0's row, for why that is real
 * depth-tested world geometry rather than something needing an explicit
 * band.
 *
 * The footprint anchor is the model's own world origin at z≈0 (the
 * contract's own words) -- so, unlike a vehicle or a billboard, a building
 * mesh needs no per-instance geometry offset at all: `ThreeRenderer`
 * translates the cloned root straight to the footprint's world position and
 * leaves rotation at identity (a building never turns; the sim tracks no
 * orientation for one).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { toonRampMaterial } from '../palette-material';
import { isBuildingMeshRole, rampForBuildingRole } from './building-mesh-role';
import { MESH_SCALE } from './mesh-anim';
import { HULL_RENDER_ORDER } from './render-order';

/** One loaded `art/meshes/buildings/<type>.glb` or `<type>_wreck.glb`, kept
 *  as a clone source -- mirrors `MeshUnitTemplate`/`VehicleMeshTemplate`'s
 *  own doc comments on shared-by-reference `materials`/`geometries`. */
export interface BuildingMeshTemplate {
  readonly root: THREE.Object3D;
  readonly materials: readonly THREE.Material[];
  readonly geometries: readonly THREE.BufferGeometry[];
}

/**
 * Assembles a `BuildingMeshTemplate` from an already-parsed `GLTF` result,
 * decoupled from `GLTFLoader` itself -- the identical split
 * `mesh-unit.ts`/`mesh-vehicle.ts` make. `wallColorKey` is this building
 * TYPE's own colour (`Sim.structureTypes[...].color`, e.g. `"limestone.1"`
 * for the mosque) -- see `building-mesh-role.ts`'s top comment for why this
 * is a required parameter rather than a default, and why it is sourced from
 * `Sim` rather than `@lions/data` (this package must not import that).
 */
export function buildBuildingMeshTemplate(
  gltf: Pick<GLTF, 'scene'>,
  wallColorKey: string
): BuildingMeshTemplate {
  const root = gltf.scene;
  root.scale.setScalar(MESH_SCALE);

  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const unmapped = new Set<string>();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const extrasRole = (mesh.userData as { rl_role?: unknown }).rl_role;
    const role = typeof extrasRole === 'string' && extrasRole.length > 0 ? extrasRole : mesh.name;
    if (!isBuildingMeshRole(role)) {
      unmapped.add(role || '(unnamed mesh)');
      return;
    }
    const mat = toonRampMaterial(rampForBuildingRole(role, wallColorKey));
    mesh.material = mat;
    mesh.renderOrder = HULL_RENDER_ORDER;
    materials.push(mat);
    geometries.push(mesh.geometry);
  });

  if (unmapped.size > 0) {
    throw new Error(`mesh-building: no ramp for rl_role ${[...unmapped].join(', ')}`);
  }

  return { root, materials, geometries };
}

/** Fetches and parses `glbUrl`, then builds a `BuildingMeshTemplate` --
 *  mirrors `loadMeshUnitTemplate`/`loadVehicleMeshTemplate` exactly. */
export async function loadBuildingMeshTemplate(glbUrl: string, wallColorKey: string): Promise<BuildingMeshTemplate> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  return buildBuildingMeshTemplate(gltf, wallColorKey);
}

/** One placed structure's mesh instance -- a plain clone with no per-entity
 *  state of its own (no mixer, no pivot), unlike `VehicleMeshEntity`/
 *  `MeshUnitEntity`: a building never animates and never turns, so nothing
 *  beyond its own transform needs tracking per instance. */
export function instantiateBuildingMesh(template: BuildingMeshTemplate): THREE.Object3D {
  return template.root.clone(true);
}

/** Releases a template's own owned resources -- mirrors
 *  `disposeMeshUnitTemplate`/`disposeVehicleMeshTemplate` exactly; every
 *  clone made from this template must already be removed from the scene
 *  first, since they share these exact objects by reference. */
export function disposeBuildingMeshTemplate(template: BuildingMeshTemplate): void {
  for (const material of template.materials) material.dispose();
  for (const geometry of template.geometries) geometry.dispose();
}
