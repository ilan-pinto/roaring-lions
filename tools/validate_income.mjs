// F2 (GH-183): the cross-checks for `resources.income_zones` and `resources.supply_entry`.
//
// Four rules, each refusing BY NAME (mission id plus the offending value):
//   - an income zone the mission's MAP does not declare;
//   - the same zone listed twice;
//   - `supply_corridor: true` with no `supply_entry`;
//   - a `supply_entry` the MAP does not declare as a marker.
//
// The schema cannot say any of these (a zone id is only a string until a map is in hand), and the
// runtime would fail them silently: a zone no one can hold pays nothing, and a convoy with no
// entry has no route to cut. Its own module because validate_data.mjs runs its whole sweep at
// import time and exits.

/**
 * @param {unknown} mission  a parsed mission
 * @param {unknown} map      the parsed map JSON the mission plays on
 * @param {string} file      for messages
 */
export function incomeFailures(mission, map, file) {
  const out = [];
  const id = mission?.id ?? file;
  const res = mission?.resources;
  const entry = res?.supply_entry;
  if (res === undefined) return out;

  const zones = new Set(Object.keys(map?.zones ?? {}));
  const markers = new Set(Object.keys(map?.markers ?? {}));

  const seen = new Set();
  for (const entry of res.income_zones ?? []) {
    const z = entry?.zone;
    if (!zones.has(z)) {
      out.push(`${file}: ${id} income_zones names zone "${z}", which map "${mission?.map?.file}" does not declare`);
    }
    if (seen.has(z)) {
      out.push(`${file}: ${id} income_zones lists zone "${z}" more than once`);
    }
    seen.add(z);
  }

  if (entry !== undefined && !markers.has(entry)) {
    out.push(`${file}: ${id} supply_entry "${entry}" is not a marker on map "${mission?.map?.file}"`);
  }
  if (res.supply_corridor === true && entry === undefined) {
    out.push(`${file}: ${id} sets supply_corridor but names no supply_entry -- the convoy has no entry to route from`);
  }
  return out;
}
