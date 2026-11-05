/**
 * GH-974: the LOD1 twin of a CLONE-drawn building (the two-storey house, `house_lod1`). The compound wall's twin
 * lives in `structure-instances.ts` because a wall is instanced per tile; a house is a handful of clones, so its twin
 * is a second clone of the same placement and the frame decides which of the two is visible.
 *
 * The twin ships its OWN 512 px bake of the house (lead ruling: patches of one texel a cell read as plaster), so it is
 * a textured building (`TEXTURED_BUILDING_TYPES` names `house_lod1`) with a material and a texture of its own. Below `STRUCTURE_LOD1_BELOW_ZOOM` (2.0, held to 2.05: `lod1Active`) a CLEAN
 * building shows the twin. A scarred one keeps its full geometry (the scar materials are per full mesh), as does a
 * wreck, which is a different clone altogether.
 */
import { scarMixForBand } from './building-damage';

/** Is the twin the art drawn for a building in damage band `band` (undefined: never hit), given the zoom state? */
export function lod1Shown(lodOn: boolean, band: number | undefined): boolean {
  return lodOn && (band === undefined || (band > 0 && scarMixForBand(band) === 0));
}
