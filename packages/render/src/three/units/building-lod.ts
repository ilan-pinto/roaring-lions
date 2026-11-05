/**
 * GH-974: the LOD1 twin of a CLONE-drawn building (the two-storey house, `house_lod1`). The compound wall's twin
 * lives in `structure-instances.ts` because a wall is instanced per tile; a house is a handful of clones, so its twin
 * is a second clone of the same placement and the frame decides which of the two is visible.
 *
 * The twin ships zero materials and a UV0 into the house's bake: each of its meshes is drawn with the material of the
 * standing mesh of the same `rl_role`. Below `STRUCTURE_LOD1_BELOW_ZOOM` (2.0, held to 2.05: `lod1Active`) a CLEAN
 * building shows the twin. A scarred one keeps its full geometry (the scar materials are per full mesh), as does a
 * wreck, which is a different clone altogether.
 */
import * as THREE from 'three';
import { scarMixForBand } from './building-damage';

const roleOf = (o: THREE.Object3D): string | undefined => (o.userData as { rl_role?: string }).rl_role;

/**
 * Gives every mesh of `twin` the material of the mesh of `full` with the same `rl_role`, so the twin is drawn with the
 * standing building's own bake. Returns false (touching nothing) if a twin mesh has no partner, or the twin has none.
 * Shared, not cloned: nothing here owns a material.
 */
export function pairLod1Materials(twin: THREE.Object3D, full: THREE.Object3D): boolean {
  const partners = new Map<string, THREE.Material | THREE.Material[]>();
  full.traverse((o) => {
    const m = o as THREE.Mesh;
    const r = roleOf(o);
    if (m.isMesh && r !== undefined && !partners.has(r)) partners.set(r, m.material);
  });
  const mine: THREE.Mesh[] = [];
  let ok = true;
  twin.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const r = roleOf(o);
    if (r === undefined || !partners.has(r)) ok = false;
    else mine.push(m);
  });
  if (!ok || mine.length === 0) return false;
  for (const m of mine) m.material = partners.get(roleOf(m) as string) as THREE.Material | THREE.Material[];
  return true;
}

/** Is the twin the art drawn for a building in damage band `band` (undefined: never hit), given the zoom state? */
export function lod1Shown(lodOn: boolean, band: number | undefined): boolean {
  return lodOn && (band === undefined || (band > 0 && scarMixForBand(band) === 0));
}
