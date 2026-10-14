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

/** B2: every placement with a garrison stance, anywhere in the mission, names a unit that can
 *  garrison. The runtime's `garrison` command silently skips a unit without the ability, so the
 *  body stands where it spawned -- on the building's own blocked tile, three times in eight. */
export function garrisonStanceFailures(mission, unitsById, file) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
    } else if (node && typeof node === 'object') {
      if (typeof node.unit === 'string' && node.stance?.kind === 'garrison') {
        if (!(unitsById.get(node.unit)?.abilities ?? []).includes('garrison')) {
          out.push(
            `${file}: "${node.unit}" has a garrison stance and no garrison ability -- the order is ` +
              `silently refused and the unit stands where it spawned`
          );
        }
      }
      for (const v of Object.values(node)) walk(v);
    }
  };
  walk(mission);
  return out;
}
