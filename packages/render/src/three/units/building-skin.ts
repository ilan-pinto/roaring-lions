/**
 * GH-1225 L7 (accepted: "one twin, one hook"): the ONE place a clone-drawn building's drawn material is composed from its
 * band material, its P4 holes (GH-1197) and its roof cut. A building both holed and cut draws one clone carrying both hooks
 * (the cut wraps the holed clone, whose hook it chains), so neither feature can overwrite the other on a band change, a new
 * hole or the cut opening and closing. Either one keeps the full art: the LOD1 twin has neither.
 *
 * `buildingMask` is the same composition for the shadow's depth material and the AO G-buffer's material: whatever the colour
 * clone discards, they discard (`building-mask.ts`).
 */
import type * as THREE from 'three';
import type { BuildingCutMaterials, CutMaskMaterials } from './cut-material';
import type { BuildingHoleMaterials } from './holed-material';

/** The material building meshes draw over band material `band`: holed first, then cut. */
export function buildingSkin(band: THREE.Material, holes: BuildingHoleMaterials | null, cut: BuildingCutMaterials | null): THREE.Material {
  const holed = holes === null ? band : holes.materialFor(band);
  return cut === null ? holed : cut.materialFor(holed);
}

/** What a building's meshes cast and occlude through: `customDepthMaterial` and the AO pre-pass's `userData.rlCutAo`. */
export interface BuildingMask {
  readonly depth: THREE.Material | undefined;
  readonly ao: THREE.Material | undefined;
}

/**
 * The ONE mask matching `buildingSkin(band, holes, cut)`:
 * - holed and cut: the building's own pair, discarding on a hole OR the cut (`cut.maskWith(holes)`);
 * - cut alone: the shared cut pair `shared` (slice 2, unchanged);
 * - holed alone: the holes' depth material and no AO mask (P4, unchanged: the AO sees the wall whole, accepted there).
 * `shared` is the renderer's cut pair, minted with the first volume; a cut clone never exists without it.
 */
export function buildingMask(holes: BuildingHoleMaterials | null, cut: BuildingCutMaterials | null, shared: CutMaskMaterials | null): BuildingMask {
  if (cut !== null && holes !== null) return cut.maskWith(holes);
  if (cut !== null && shared !== null) return shared;
  return { depth: holes?.depth, ao: undefined };
}

/** Does a building with these effects keep its full art (no LOD1 twin)? Holed or cut: yes. */
export function keepsFullArt(holed: boolean, cut: boolean): boolean {
  return holed || cut;
}
