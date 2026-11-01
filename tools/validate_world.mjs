// The town-level unlock gate's cross-file rules (GH-912 G1). Its own module because
// validate_data.mjs runs its whole sweep at import time and exits, so a test cannot import it.
//
// A region's `unlock.after_mission` may name an unauthored mission (the campaign is written
// front to back), but a TOWN's gate is stricter: the mission it names must be listed by some
// town, because a town gated on a mission nothing can start is locked forever.

/**
 * "Listed" means listed by a town of this world, which is what `owner` below is built from; a
 * mission file on disk that no town lists does not count (it can never be started).
 *
 * @param world the parsed data/campaign/world.json
 * @returns     failure strings; [] when every town gate can open
 */
export function townGateFailures(world) {
  const out = [];
  // mission id -> { region index, region id, town }
  const owner = new Map();
  world.regions.forEach((region, ri) => {
    for (const town of region.towns) {
      for (const m of town.missions) owner.set(m, { ri, region: region.id, town });
    }
  });
  const gateOf = (town) => town.unlock?.after_mission;

  world.regions.forEach((region, ri) => {
    for (const town of region.towns) {
      const after = gateOf(town);
      if (after === undefined) continue;
      const where = `data/campaign/world.json: town "${town.id}" unlocks after "${after}"`;
      const o = owner.get(after);
      if (o === undefined) {
        // (a) no town lists it: a town gated on an unlisted mission is locked forever, even if a file exists.
        out.push(`${where}, which no town lists -- the town could never open`);
        continue;
      }
      if (o.town.id === town.id) {
        // (b) its own mission
        out.push(`${where}, a mission of the same town -- it could never open`);
        continue;
      }
      if (o.ri > ri) {
        // (c) a later region
        out.push(`${where}, which is in "${o.region}" -- that region is not earlier, so the progression cannot advance`);
        continue;
      }
      // (d) a cycle: walk gating mission -> its town -> that town's gate; refuse if this town comes back.
      // `seen` only bounds the walk (a cycle that does not pass through this town is reported at its own town).
      const seen = new Set([town.id]);
      let cur = o.town;
      while (cur !== undefined) {
        if (cur.id === town.id) {
          out.push(`${where}, which closes a cycle of town gates back to "${town.id}" -- none of them could open`);
          break;
        }
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        const next = gateOf(cur);
        cur = next === undefined ? undefined : owner.get(next)?.town;
      }
    }
  });
  return out;
}
