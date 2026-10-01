// The region -> biome cross-check for the data gate (GH-322).
//
// A map states its own biome (`terrain` in map.schema.json) because the
// renderer boots from the map alone: a sandbox has no mission, and a mission
// names its map by file. So nothing at runtime ties a map to the REGION its
// missions are fought in, and a new Sur map authored without the key would
// draw the Marj desert on the northern front with every gate green. This is
// that tie, as a lint rather than a runtime lookup: every map a region's
// missions use must declare the region's biome.
//
// Extracted from validate_data.mjs for the reason validate_map_grid.mjs was:
// the gate runs its whole sweep at import time and exits, so a test cannot
// import it, and a check that has never rejected anything is not a check.

/** The biome each region's maps must declare. A region absent here is not
 *  checked -- the Marj and Naharin maps are authored per map, as before. */
export const REGION_BIOME = { sur: 'highland' };

/**
 * @param world the parsed data/campaign/world.json
 * @param missionsById Map of mission id -> parsed mission JSON
 * @param mapsById Map of map id -> parsed map JSON
 * @returns one failure string per map that a region's mission uses and that
 *   does not declare the region's biome (a map absent from `mapsById` is
 *   left to the mission cross-check, which already names it)
 */
export function regionBiomeFailures(world, missionsById, mapsById) {
  const out = [];
  const seen = new Set();
  for (const region of world.regions ?? []) {
    const want = REGION_BIOME[region.id];
    if (want === undefined) continue;
    for (const town of region.towns ?? []) {
      for (const missionId of town.missions ?? []) {
        const mapId = missionsById.get(missionId)?.map?.file;
        if (typeof mapId !== 'string' || seen.has(mapId)) continue;
        seen.add(mapId);
        const map = mapsById.get(mapId);
        if (map === undefined) continue;
        const got = map.terrain ?? 'arid';
        if (got !== want) {
          out.push(
            `data/maps/${mapId}.json: terrain "${got}", but mission "${missionId}" is in region "${region.id}", ` +
              `whose maps must declare "${want}"`
          );
        }
      }
    }
  }
  return out;
}
