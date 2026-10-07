/**
 * Which ambience bed a map plays (polish pass F, A11; docs/polish/audio-plan.md
 * section 7): one loop per kind of ground, never per map, read off the map's
 * own data so a new map needs no entry anywhere.
 *
 * - `ridge`: the map's theme is `highland` (the Sur front: Tel Marum, Qarn
 *   Hadid, Umm Zeitoun). The theme already says "mountain", whatever stands
 *   on it.
 * - `town`: otherwise, when buildings cover TOWN_BUILT_SHARE or more of the
 *   map's tiles. A building is any structure that is not `per_tile` in
 *   data/structures.json -- walls and fences are a perimeter, not a place
 *   anyone lives.
 * - `open`: everything else -- open desert, the river basin, the outskirts.
 *
 * 5% is not fitted to a target: it sits in the one wide gap the shipped
 * non-highland maps leave, between beit_sahwan_outskirts at 4.2% and
 * beit_sahwan_4 at 5.5% (`ambience.test.ts` pins every map's bed, and the gap).
 *
 * Presentation only: nothing here reaches the sim.
 */
import { structures, type ParsedMap } from '@lions/data';

/** The beds `data/audio.json`'s `ambience.beds` declares. */
export type AmbienceBed = 'open' | 'town' | 'ridge';
export const AMBIENCE_BEDS: readonly AmbienceBed[] = ['open', 'town', 'ridge'];

/** The built-up share at and above which a non-highland map is a town. */
export const TOWN_BUILT_SHARE = 0.05;

/** Is this structure type a building (a roof someone lives or works under),
 *  rather than a run of wall or fence? Unknown types count as buildings. */
function isBuilding(type: string): boolean {
  const spec = (structures as Record<string, { per_tile?: boolean } | undefined>)[type];
  return spec?.per_tile !== true;
}

/** The share of the map's tiles under a building, 0..1. */
export function builtShare(map: Pick<ParsedMap, 'width' | 'height' | 'structures'>): number {
  const area = map.width * map.height;
  if (area <= 0) return 0;
  let tiles = 0;
  for (const s of map.structures) if (isBuilding(s.type)) tiles += s.tiles.length;
  return tiles / area;
}

/** The bed a map plays. */
export function ambienceBedFor(map: Pick<ParsedMap, 'terrain' | 'width' | 'height' | 'structures'>): AmbienceBed {
  if (map.terrain === 'highland') return 'ridge';
  return builtShare(map) >= TOWN_BUILT_SHARE ? 'town' : 'open';
}
