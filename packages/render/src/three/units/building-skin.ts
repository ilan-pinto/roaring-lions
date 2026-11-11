/**
 * GH-1225 L7 (accepted: "one twin, one hook"): the ONE place a clone-drawn building's drawn material is composed from its
 * band material, its P4 holes (GH-1197) and its roof cut. A building both holed and cut draws one clone carrying both hooks
 * (the cut wraps the holed clone, whose hook it chains), so neither feature can overwrite the other on a band change, a new
 * hole or the cut opening and closing. Either one keeps the full art: the LOD1 twin has neither.
 */
import type * as THREE from 'three';
import type { BuildingCutMaterials } from './cut-material';
import type { BuildingHoleMaterials } from './holed-material';

/** The material building meshes draw over band material `band`: holed first, then cut. */
export function buildingSkin(band: THREE.Material, holes: BuildingHoleMaterials | null, cut: BuildingCutMaterials | null): THREE.Material {
  const holed = holes === null ? band : holes.materialFor(band);
  return cut === null ? holed : cut.materialFor(holed);
}

/** Does a building with these effects keep its full art (no LOD1 twin)? Holed or cut: yes. */
export function keepsFullArt(holed: boolean, cut: boolean): boolean {
  return holed || cut;
}
