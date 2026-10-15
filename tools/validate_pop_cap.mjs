// F3 (GH-183): `resources.pop_cap` is OFF in the campaign (lead, G3 Q4, 4 Oct; plan decision D4).
//
// A campaign mission is one with a `town` (the schema requires it); skirmish and co-op set the cap
// through the doctrine, not through a mission file. So any mission that has a town and also sets a
// cap is refused, whatever the value: a present key is a set cap.
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.

export function popCapFailures(mission, file) {
  if (mission?.town === undefined) return [];
  if (mission.resources === undefined || !('pop_cap' in mission.resources)) return [];
  return [
    `${file}: resources.pop_cap is set on a campaign mission (town "${mission.town}") -- ` +
      `the population cap is off in the campaign (lead, G3 Q4, 4 Oct); remove it`,
  ];
}
