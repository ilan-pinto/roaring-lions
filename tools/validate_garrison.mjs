// The garrison rules that validate_data.mjs checks and the runtime would otherwise swallow
// (garrison overhaul, lead rulings 2026-10-14). Its own module because validate_data.mjs runs its
// whole sweep at import time and exits, so a test cannot import it.

/** Weapon types that fire indirect (the sim's INDIRECT_MASK classes). */
const INDIRECT_TYPES = new Set(['mortar', 'rocket']);

/** G4: an indirect weapon on a unit that can garrison must say it holds fire inside. */
export function garrisonWeaponFailures(unit, file) {
  if (!(unit?.abilities ?? []).includes('garrison')) return [];
  const out = [];
  for (const w of unit.weapons ?? []) {
    if (INDIRECT_TYPES.has(w.type) && w.fires_from_building !== false) {
      out.push(
        `${file}: ${unit.id} can garrison and its ${w.type} weapon "${w.id}" does not declare ` +
          `"fires_from_building": false -- indirect fire does not go out of a window (G4)`
      );
    }
  }
  return out;
}
