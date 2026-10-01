// What the garage's turnable model (GH-316) draws, resolved from the same
// tables a mission loads from -- so the bay can never show a different GLB
// from the one the unit fights as.
import { paletteColor } from '@lions/data';
import { RIGGED_UNIT_MESHES, VEHICLE_UNIT_MESHES, meshUrl } from './mesh-catalogue';
import { TERRAIN_GROUND_TEXTURE, TERRAIN_THEMES } from './terrain-themes';
import type { GarageColors, ModelSource } from './ui/garage-viewer';

/** The unit's GLB through the mission's own catalogue, or `null` for a type
 *  with none (it keeps its plate). A rigged type with several variants
 *  (`civilians`) shows its first. */
export function garageModelSource(typeId: string, url: (file: string) => string = meshUrl): ModelSource | null {
  const rigged = RIGGED_UNIT_MESHES[typeId];
  if (rigged !== undefined && rigged.files.length > 0) {
    return { kind: 'rigged', url: url(rigged.files[0]), faction: rigged.faction };
  }
  const vehicle = VEHICLE_UNIT_MESHES[typeId];
  if (vehicle !== undefined) return { kind: 'vehicle', url: url(vehicle) };
  return null;
}

/** The stage's colours, by palette key: the mission sun's own `limestone.0`
 *  for the key, the sky's `water.0` for the fill and the bounce's sky, the
 *  ground bounce's `dust.4`, and the arid map's open-ground tone for the
 *  sand -- the same keys `three/lighting.ts` and `TERRAIN_THEMES` name. */
export function garageColors(): GarageColors {
  return {
    key: paletteColor('limestone.0'),
    fill: paletteColor('water.0'),
    sky: paletteColor('water.0'),
    bounce: paletteColor('dust.4'),
    ground: TERRAIN_THEMES.arid.open,
  };
}

/** The sand under the model: the arid map's open-ground image. */
export function garageGroundTexture(base: string): string {
  return `${base}textures/${TERRAIN_GROUND_TEXTURE.arid}.jpg`;
}
