/**
 * Building meshes: the mesh-unit contract v2's third asset class, and its
 * simplest -- "rigid and never turns... no armature, no skin, no clips, no
 * pivot." Two sibling files per type (`<type>.glb` standing,
 * `<type>_wreck.glb` destroyed); this module builds a template from either
 * one, identically -- the caller (`ThreeRenderer.loadBuildingMesh`) is what
 * knows which file is which and swaps between the two templates it builds.
 *
 * No render-order distinction between a building's own parts (unlike
 * vehicles' hull/turret split): every part draws at `WORLD_RENDER_ORDER`,
 * one band BELOW every unit. That band is not about compositing -- these
 * meshes are opaque and the depth buffer settles what covers what
 * regardless of submission order -- it is about `units/silhouette.ts`'s
 * stencil mask, which is only correct if a unit body is depth-tested
 * against a world that has already drawn. See `units/render-order.ts`'s
 * own table, band -1's row, for the measured incident (a tank behind an
 * apartment silhouetting as a few slivers) and for why three.js's opaque
 * sort otherwise leaves this to whichever GLB loaded first.
 *
 * The footprint anchor is the model's own world origin at z≈0 (the
 * contract's own words) -- so, unlike a vehicle or a billboard, a building
 * mesh needs no per-instance geometry offset at all: `ThreeRenderer`
 * translates the cloned root straight to the footprint's world position and
 * leaves rotation at identity for every building with a facade (a building
 * never turns; the one exception since 2026-09-06 is a per_tile RUN, which
 * `ThreeRenderer.updateBuildingMeshes` turns a quarter to follow its
 * neighbours -- see `units/run-direction.ts`; the sim tracks no
 * orientation for one).
 */
import * as THREE from 'three';
import { gltfLoader } from './gltf-loader';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { rampMaterial, texturedMaterial } from '../world-materials';
import { isBuildingMeshRole, rampForBuildingRole, type WallSurface } from './building-mesh-role';
import { MESH_SCALE } from './mesh-anim';
import { WORLD_RENDER_ORDER } from './render-order';

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
 * `wallSurface` (`_wallSurface` below) USED to decide whether the wall
 * material generated coursing and of which kind -- the toon ramp's
 * fragment-shader trick. The lit `rampMaterial` (`../world-materials.ts`)
 * has no coursing equivalent, so this parameter is unread in the body
 * (underscore-prefixed for `noUnusedParameters`); it stays in the signature
 * -- every caller still threads `wallSurfaceForBuilding(structureId)`
 * through it -- rather than rippling a signature change through
 * `loadBuildingMeshTemplate` and `ThreeRenderer`'s two call sites for a
 * removal this task did not ask for. A future lit-coursing mechanism has a
 * parameter already waiting for it.
 */
export function buildBuildingMeshTemplate(
  gltf: Pick<GLTF, 'scene'>,
  wallColorKey: string,
  _wallSurface: WallSurface,
  allowTextured = false
): BuildingMeshTemplate {
  const root = gltf.scene;
  root.scale.setScalar(MESH_SCALE);

  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const unmapped = new Set<string>();
  const smuggled = new Set<string>();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const extrasRole = (mesh.userData as { rl_role?: unknown }).rl_role;
    const role = typeof extrasRole === 'string' && extrasRole.length > 0 ? extrasRole : mesh.name;

    // The per-MESH textured opt-out. `allowTextured` is the caller's answer
    // to `TEXTURED_BUILDING_TYPES.has(structureId)` -- a NAMED list, so the
    // types outside the palette gate are enumerable rather than implicit
    // (see `textured-building.ts`'s own top comment). Whether THIS mesh
    // takes it is decided by the GLB's own evidence: a mesh whose material
    // carries a map has a photograph to draw, and one that does not (the
    // warehouse's synthesised roof cap, which has no UVs and no honest
    // texel) falls through to the palette below.
    //
    // Deliberately checked BEFORE `isBuildingMeshRole`: a textured mesh
    // needs no ramp, so it needs no role in the ramp table either. It still
    // has one on every shipped asset, and that is fine -- this simply does
    // not depend on it.
    const loaded = mesh.material as THREE.Material | undefined;
    const loadedMap =
      loaded && 'map' in loaded ? ((loaded as { map?: THREE.Texture | null }).map ?? null) : null;
    if (loadedMap) {
      if (!allowTextured) {
        // A GLB outside the named list shipping a texture anyway is an
        // error, never a silent upgrade -- the whole point of the list is
        // that nobody has to read GLB bytes to know which buildings the
        // palette gate still covers.
        smuggled.add(role || '(unnamed mesh)');
        return;
      }
      const textured = texturedMaterial(loaded as THREE.Material);
      mesh.material = textured;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = WORLD_RENDER_ORDER;
      materials.push(textured);
      geometries.push(mesh.geometry);
      return;
    }

    if (!isBuildingMeshRole(role)) {
      unmapped.add(role || '(unnamed mesh)');
      return;
    }
    // Every ramp asset takes its ramp's lit step as a flat albedo
    // (`rampMaterial`, `../world-materials.ts`) -- the toon shader's
    // per-material "Cel specular" opt-in and the brick/panel coursing this
    // wall role used to generate in its own fragment shader are both retired
    // along with it: a lit `MeshStandardMaterial` gets its facet separation
    // and its specular response from the scene's real sun and its shared
    // roughness/metalness instead of a hand-picked ramp step.
    const mat = rampMaterial(rampForBuildingRole(role, wallColorKey));
    mesh.material = mat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = WORLD_RENDER_ORDER;
    materials.push(mat);
    geometries.push(mesh.geometry);
  });

  if (smuggled.size > 0) {
    throw new Error(
      `mesh-building: ${[...smuggled].join(', ')} ships a texture, but this building type is not in ` +
        `TEXTURED_BUILDING_TYPES (textured-building.ts). Add it there and to TEXTURED_MESH_EXEMPT ` +
        `in tools/validate_mesh_assets.py, or export the GLB without materials.`
    );
  }
  if (unmapped.size > 0) {
    throw new Error(`mesh-building: no ramp for rl_role ${[...unmapped].join(', ')}`);
  }

  return { root, materials, geometries };
}

/** Fetches and parses `glbUrl`, then builds a `BuildingMeshTemplate` --
 *  mirrors `loadMeshUnitTemplate`/`loadVehicleMeshTemplate` exactly.
 *  `allowTextured` threads through unchanged; see
 *  `buildBuildingMeshTemplate` for what it gates. */
export async function loadBuildingMeshTemplate(
  glbUrl: string,
  wallColorKey: string,
  wallSurface: WallSurface,
  allowTextured = false
): Promise<BuildingMeshTemplate> {
  const gltf = await gltfLoader().loadAsync(glbUrl);
  return buildBuildingMeshTemplate(gltf, wallColorKey, wallSurface, allowTextured);
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
  for (const material of template.materials) {
    // A TEXTURED building's material owns a `base_color` map that no other
    // material in the scene references (each GLB carries its own bake), and
    // `Material.dispose()` does NOT release textures -- three.js leaves that
    // to the owner deliberately, since a map is routinely shared. Here it is
    // not shared, so this is the owner: 2048x2048 of GPU memory per building
    // type would otherwise leak on every template reload. A RAMP material
    // (`rampMaterial`) never carries a `map` at all, so this is a no-op for
    // seven of every eight roles on a typical building.
    const map = (material as THREE.MeshStandardMaterial).map;
    if (map instanceof THREE.Texture) map.dispose();
    material.dispose();
  }
  for (const geometry of template.geometries) geometry.dispose();
}
