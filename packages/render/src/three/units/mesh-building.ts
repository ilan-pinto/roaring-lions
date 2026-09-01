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
import { isBuildingMeshRole, rampForBuildingRole, type WallSurface } from './building-mesh-role';
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
 *
 * `wallSurface` is the same shape of decision: what the wall is MADE of
 * (`wallSurfaceForBuilding`, keyed by structure type id), which decides
 * whether the wall material generates coursing and of which kind. Required,
 * not defaulted to `'flat'`, for the identical reason `wallColorKey` is
 * required -- a default would quietly mean "whatever the caller forgot to
 * look up", and its failure mode (a flat wall) is indistinguishable from
 * the bug this parameter exists to fix.
 */
export function buildBuildingMeshTemplate(
  gltf: Pick<GLTF, 'scene'>,
  wallColorKey: string,
  wallSurface: WallSurface
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
    // Cel specular deliberately left OFF here (default `false`) -- the ask
    // (`palette-material.ts`'s own "Cel specular" doc comment) is metal/
    // glass/vehicle-hull surfaces, and a building wall's own ramp is a
    // plaster/concrete tone (`rampForBuildingRole`), not a hard one. See
    // `units/mesh-vehicle.ts`'s own call site for the one that opts in.
    //
    // Coursing is `wall`-only and surface-gated. Not because the other
    // seven roles could not carry a pattern, but because none of them is a
    // laid material: `roof` is a packed-earth deck, `dome`/`trim` are
    // rendered plaster, `metal`/`glass`/`rust`/`wood` name themselves.
    // `render_building.py` draws the identical line -- its brick material
    // reaches `WALL_ROLE` and nothing else -- and its `smooth_parts` list
    // (domes, finials, drums stay flat, "coursing a curved surface reads as
    // scaffolding, not stonework") needs no counterpart here: on every
    // shipped GLB those parts already carry their own `dome`/`trim` role,
    // so the curved geometry is outside `wall` by construction rather than
    // by a name-fragment match.
    const mat = toonRampMaterial(rampForBuildingRole(role, wallColorKey), {
      ...(role === 'wall' && wallSurface !== 'flat' ? { coursing: wallSurface } : {}),
    });
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
export async function loadBuildingMeshTemplate(
  glbUrl: string,
  wallColorKey: string,
  wallSurface: WallSurface
): Promise<BuildingMeshTemplate> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  return buildBuildingMeshTemplate(gltf, wallColorKey, wallSurface);
}

/** One placed structure's mesh instance -- a plain clone with no per-entity
 *  state of its own (no mixer, no pivot), unlike `VehicleMeshEntity`/
 *  `MeshUnitEntity`: a building never animates and never turns, so nothing
 *  beyond its own transform needs tracking per instance. */
export function instantiateBuildingMesh(template: BuildingMeshTemplate): THREE.Object3D {
  return template.root.clone(true);
}

/**
 * GH #143 follow-up: a building mesh's idle -> wreck swap
 * (`ThreeRenderer.updateBuildingMeshes`) is otherwise instant -- the wreck
 * clone appears at full height the same frame the sim marks the structure
 * dead, with no transition bridging the pop (the double-fire the billboard
 * collapse used to layer on top of it, fixed separately, was never that
 * transition -- it was a second, unrelated bug). `spawnCollapseFx
 * ('structure_collapse', ...)` already throws a dust bloom / explosion burst
 * at the footprint for every `structureDestroyed` event, mesh or billboard
 * alike (`ThreeRenderer.ts`'s own `onEvents` case) -- this is a second,
 * cheap, code-only transition to pair with it: the newly-appeared wreck root
 * grows in on its own Y axis from a visibly squashed pile up to its real
 * height over `BUILDING_SETTLE_SECONDS`, so the burst's flash and dust have
 * something to cover besides a flat cut.
 *
 * Starts from `BUILDING_SETTLE_START`, not 0 -- a wreck root growing from
 * nothing reads as MATERIALISING, not settling; starting already
 * substantially formed and easing the rest of the way in reads as debris
 * finishing its fall a beat late, which is the honest story here (the fall
 * itself already happened, off-model, in the instant the sim tick killed the
 * structure).
 *
 * Pure timing only -- no `THREE.Object3D`, no `ThreeRenderer` state -- so it
 * is provable in `environment: 'node'` with nothing else stood up, the same
 * split every other collapse/death curve in this backend already keeps
 * (`collapseFrame`, `structures.ts`; `stepMeshDeath`, `mesh-death.ts`).
 */
export const BUILDING_SETTLE_SECONDS = 0.35;
const BUILDING_SETTLE_START = 0.4;

/** The eased scale factor (multiply a wreck root's own baseline Y scale by
 *  this) at `tSeconds` into its settle, and whether the settle has finished.
 *  Ease-out quadratic (`1 - (1-p)^2`): fast at the start, slowing into its
 *  final height -- clamped at `tSeconds >= BUILDING_SETTLE_SECONDS` so a
 *  caller that steps past the duration in one frame (a stalled tab resuming,
 *  say) lands on exactly `1`, never an overshoot. */
export function buildingSettleScale(tSeconds: number): { scaleFactor: number; done: boolean } {
  if (tSeconds >= BUILDING_SETTLE_SECONDS) return { scaleFactor: 1, done: true };
  const p = Math.max(0, tSeconds) / BUILDING_SETTLE_SECONDS;
  const eased = 1 - (1 - p) * (1 - p);
  return { scaleFactor: BUILDING_SETTLE_START + (1 - BUILDING_SETTLE_START) * eased, done: false };
}

/** Releases a template's own owned resources -- mirrors
 *  `disposeMeshUnitTemplate`/`disposeVehicleMeshTemplate` exactly; every
 *  clone made from this template must already be removed from the scene
 *  first, since they share these exact objects by reference. */
export function disposeBuildingMeshTemplate(template: BuildingMeshTemplate): void {
  for (const material of template.materials) material.dispose();
  for (const geometry of template.geometries) geometry.dispose();
}
