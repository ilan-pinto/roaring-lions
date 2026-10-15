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
 * PENDING EXEMPTION (F2 C-R1): these two missions set `supply_corridor` and still name no
 * `supply_entry`, because the lead lands their mission-data commit (Task 8). The marker is
 * already on their maps. Delete an entry the moment its mission names an entry: the demotion
 * check below fails otherwise.
 */
export const CORRIDOR_ENTRY_EXEMPT = ['umm_zeitoun_2_buildup', 'umm_zeitoun_4_clearance'];

/**
 * @param {unknown} mission  a parsed mission
 * @param {unknown} map      the parsed map JSON the mission plays on
 * @param {string} file      for messages
 * @param {readonly string[]} [exempt]
 */
export function incomeFailures(mission, map, file, exempt = CORRIDOR_ENTRY_EXEMPT) {
  const out = [];
  const id = mission?.id ?? file;
  const res = mission?.resources;
  const exempted = exempt.includes(id);
  const entry = res?.supply_entry;
  // Demotion first, before anything can return early: an exemption that excuses nothing is
  // itself a failure, and that includes an exempt mission that lost its `resources` block.
  if (exempted && (entry !== undefined || res?.supply_corridor !== true)) {
    out.push(
      `${file}: ${id} is on the pending supply_entry exemption but ` +
        (entry !== undefined
          ? `now names supply_entry "${entry}"`
          : res === undefined
            ? 'no longer has a resources block'
            : 'no longer sets supply_corridor') +
        ' -- delete it from CORRIDOR_ENTRY_EXEMPT in tools/validate_income.mjs and its test' +
        ' (tools/src/validate_income.test.ts)'
    );
  }
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
  if (res.supply_corridor === true && entry === undefined && !exempted) {
    out.push(`${file}: ${id} sets supply_corridor but names no supply_entry -- the convoy has no entry to route from`);
  }
  return out;
}
