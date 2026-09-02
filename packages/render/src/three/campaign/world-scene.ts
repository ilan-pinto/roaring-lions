/**
 * Reading a campaign world GLB's scene graph into the three things the
 * campaign screen actually asks it for: which ground belongs to which
 * region, which ground belongs to nobody, and where the towns are.
 *
 * ## Everything is looked up by extras, never by index or order
 *
 * `sahar_basin.glb` happens to list its nodes alphabetically -- markers
 * first, then `marj_region`, `naharin_region`, `outland_scenery`,
 * `sur_region`, `wall_scenery`. That order is Blender's, not a contract, and
 * a re-export that renamed one object or added a sixth mass would reshuffle
 * it silently. So nothing below counts nodes, indexes them, or matches their
 * NAMES: the region a mesh belongs to is `extras.rl_region` and the town a
 * marker is is `extras.rl_town`, both written by
 * `tools/campaign/export_meshy_world.py` and both re-read from the shipped
 * bytes by `textured-world.test.ts`. `GLTFLoader` copies a node's `extras`
 * into its `userData` verbatim, which is the same door
 * `units/mesh-building.ts` reads `rl_role` through.
 *
 * ## Why a mesh with no map is an ERROR here
 *
 * The whole asset is one exemption from the palette repaint
 * (`textured-world.ts`'s top comment), so there is no ramp to fall back to:
 * a campaign mesh that lost its bake would draw as an untextured white
 * slab -- which reads as a lighting bug rather than as a missing texture,
 * and would take a while to chase. `mesh-building.ts` throws by name for
 * the mirror-image case (a texture where the palette was expected); this
 * throws for the same reason in the same shape.
 *
 * ## Why the bounds come from here
 *
 * The camera frames the board by fitting its bounding box (`world-camera.ts`),
 * and the box has to be the one the SCREEN will show -- regions and scenery
 * together, marker nodes excluded. A marker is an empty at a town's surface
 * point, so including them would change nothing today and would silently
 * start mattering the first time a marker was authored off the mesh.
 */
import * as THREE from 'three';

import { CAMPAIGN_MAP_ROLES, townOfNode, type CampaignMapRole } from './textured-world';

/** What a campaign region looks like right now, derived by `app` from the
 *  ledger. Mirrors `campaign.ts`'s `RegionStatus` -- restated rather than
 *  imported because `@lions/render` may not import `@lions/app`. */
export type CampaignRegionStatus = 'live' | 'complete' | 'locked' | 'empty';

export interface WorldScene {
  /** The GLB's own root, unmoved. The view parents it to a pivot. */
  readonly root: THREE.Object3D;
  /** Region ground, by `extras.rl_region`. A region may own several meshes;
   *  on `sahar_basin` each owns exactly one. */
  readonly regions: ReadonlyMap<string, readonly THREE.Mesh[]>;
  /** Ground no region owns. NEVER tinted as a region -- `outland_scenery`
   *  carries the diorama's whole underside and rim, so a region tint applied
   *  to it lights up the bottom of the world. */
  readonly scenery: readonly THREE.Mesh[];
  /** Town marker empties, by `extras.rl_town`. Kept as nodes rather than as
   *  positions so the pivot's rotation reaches them for free. */
  readonly towns: ReadonlyMap<string, THREE.Object3D>;
  /** The union of every region and scenery mesh, in the root's own space. */
  readonly bounds: THREE.Box3;
  /** The one shared `base_color`, for disposal. */
  readonly map: THREE.Texture;
}

const roleOf = (o: THREE.Object3D): CampaignMapRole | null => {
  const role = (o.userData as { rl_map_role?: unknown }).rl_map_role;
  return (CAMPAIGN_MAP_ROLES as readonly string[]).includes(role as string)
    ? (role as CampaignMapRole)
    : null;
};

const regionOf = (o: THREE.Object3D): string | null => {
  const id = (o.userData as { rl_region?: unknown }).rl_region;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

/**
 * Split a loaded campaign world into regions, scenery and town markers.
 *
 * Pure over the scene graph: no WebGL, no loader, no DOM -- which is what
 * lets `world-scene.test.ts` run it in `environment: 'node'` over a tree
 * rebuilt from the shipped GLB's own glTF JSON chunk.
 *
 * @param root the `gltf.scene` from `GLTFLoader`
 * @param materialFor builds the material each mesh will draw through, given
 *        the `base_color` the GLB shipped. Injected rather than called
 *        directly so this stays testable without compiling a shader.
 */
export function readWorldScene(
  root: THREE.Object3D,
  materialFor: (map: THREE.Texture) => THREE.Material
): WorldScene {
  const regions = new Map<string, THREE.Mesh[]>();
  const scenery: THREE.Mesh[] = [];
  const towns = new Map<string, THREE.Object3D>();
  const bounds = new THREE.Box3();
  const unroled: string[] = [];
  const bare: string[] = [];
  const anonymous: string[] = [];
  let map: THREE.Texture | null = null;

  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const town = townOfNode(o.userData as Record<string, unknown>);
    if (town !== null) {
      towns.set(town, o);
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;

    const name = mesh.name || '(unnamed mesh)';
    const role = roleOf(mesh);
    if (role === null) {
      unroled.push(name);
      return;
    }
    const loaded = mesh.material as THREE.Material | undefined;
    const loadedMap =
      loaded && 'map' in loaded ? ((loaded as { map?: THREE.Texture | null }).map ?? null) : null;
    if (!loadedMap) {
      bare.push(name);
      return;
    }
    map ??= loadedMap;

    // One material per MESH, sharing the one texture: the tint that says
    // "locked" is a uniform, and a shared material would mean locking one
    // region locked all five.
    mesh.material = materialFor(loadedMap);
    loaded?.dispose();

    if (role === 'region') {
      const id = regionOf(mesh);
      if (id === null) {
        anonymous.push(name);
        return;
      }
      const list = regions.get(id);
      if (list) list.push(mesh);
      else regions.set(id, [mesh]);
    } else {
      scenery.push(mesh);
    }
    bounds.expandByObject(mesh);
  });

  if (unroled.length > 0) {
    throw new Error(
      `campaign world: ${unroled.join(', ')} carries no known extras.rl_map_role ` +
        `(expected one of ${CAMPAIGN_MAP_ROLES.join(', ')}). Re-export with ` +
        `tools/campaign/export_meshy_world.py.`
    );
  }
  if (bare.length > 0) {
    throw new Error(
      `campaign world: ${bare.join(', ')} ships no base_color map. A campaign world is the ` +
        `named exemption from the palette repaint (three/campaign/textured-world.ts), so there ` +
        `is no ramp to fall back to and it would draw untextured.`
    );
  }
  if (anonymous.length > 0) {
    throw new Error(
      `campaign world: ${anonymous.join(', ')} has rl_map_role "region" and no extras.rl_region — ` +
        `nothing can join it to data/campaign/world.json.`
    );
  }
  if (map === null) throw new Error('campaign world: no mesh nodes at all');

  return { root, regions, scenery, towns, bounds, map };
}
