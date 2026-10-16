// F4 (GH-183) Task 7: the cross-checks for `structures[].side` and `enemy.production`.
//
// Five rules, each refusing BY NAME (mission id plus the offending value):
//   - a menu unit that is not an enemy unit (data/units/enemy/: no mirrored tech trees, GH-109);
//   - a menu unit that costs intel (LD6 ask 2: side 1 has no intel purse);
//   - a `rally` the mission's MAP does not declare as a marker;
//   - `enemy.production` with no side-1 production structure in `structures` (a menu with
//     nowhere to build);
//   - more than MAX_PRODUCTION_LINES production structures for one side, map grid and
//     `structures` alike (R-F4-4; the runtime throws the same at start()).
//
// The schema cannot say any of these (it holds no map, catalogue or unit files). Its own module
// because validate_data.mjs runs its whole sweep at import time and exits.

/** Mirrors tuning.ts MAX_PRODUCTION_LINES; a test pins the two together. */
export const MAX_PRODUCTION_LINES = 4;

/**
 * 4-connected runs of one production symbol in the map grid, counted per side. A `per_tile` type
 * makes every tile its own structure (packages/data/src/map.ts).
 */
function gridProduction(map, catalogue) {
  const counts = [0, 0];
  const bySymbol = new Map();
  for (const spec of Object.values(catalogue?.types ?? {})) {
    if (spec.produces_for === 0 || spec.produces_for === 1) bySymbol.set(spec.symbol, spec);
  }
  const rows = map?.rows ?? [];
  const seen = new Set();
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      const spec = bySymbol.get(ch);
      if (spec === undefined || seen.has(`${x},${y}`)) continue;
      if (spec.per_tile === true) {
        counts[spec.produces_for]++;
        continue;
      }
      counts[spec.produces_for]++;
      const stack = [[x, y]];
      seen.add(`${x},${y}`);
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (rows[ny]?.[nx] !== ch || seen.has(`${nx},${ny}`)) continue;
          seen.add(`${nx},${ny}`);
          stack.push([nx, ny]);
        }
      }
    }
  }
  return counts;
}

/**
 * @param {unknown} mission    a parsed mission
 * @param {unknown} map        the parsed map JSON the mission plays on
 * @param {unknown} catalogue  parsed data/structures.json
 * @param {ReadonlyMap<string, unknown>} enemyUnits  unit id -> unit JSON, from data/units/enemy/ only
 * @param {string} file        for messages
 */
export function productionFailures(mission, map, catalogue, enemyUnits, file) {
  const out = [];
  const id = mission?.id ?? file;
  const types = catalogue?.types ?? {};
  const structures = mission?.structures ?? [];
  const production = mission?.enemy?.production;

  // Lines per side: the map grid plus this mission's own structures, side override first.
  const counts = gridProduction(map, catalogue);
  let sideOneCamps = 0;
  for (const spec of structures) {
    const t = types[spec?.type];
    const side = spec?.side ?? t?.produces_for;
    if (side !== 0 && side !== 1) continue;
    const n = t?.per_tile === true ? (spec.size?.[0] ?? 2) * (spec.size?.[1] ?? 2) : 1;
    counts[side] += n;
    if (side === 1) sideOneCamps += n;
  }
  for (const side of [0, 1]) {
    if (counts[side] > MAX_PRODUCTION_LINES) {
      out.push(`${file}: ${id} has ${counts[side]} production structures for side ${side}, at most ${MAX_PRODUCTION_LINES}`);
    }
  }

  if (production === undefined) return out;

  if (sideOneCamps === 0) {
    out.push(`${file}: ${id} enemy.production has no side-1 production structure in "structures" -- a menu with nowhere to build`);
  }
  for (const unit of production.menu ?? []) {
    const u = enemyUnits.get(unit);
    if (u === undefined) {
      out.push(`${file}: ${id} enemy.production menu unit "${unit}" is not an enemy unit (data/units/enemy/)`);
    } else if ((u?.cost?.intel ?? 0) > 0) {
      out.push(`${file}: ${id} enemy.production menu unit "${unit}" costs intel (${u.cost.intel}); side 1 has no intel purse`);
    }
  }
  if (production.rally !== undefined && !(production.rally in (map?.markers ?? {}))) {
    out.push(`${file}: ${id} enemy.production rally "${production.rally}" is not a marker on map "${mission?.map?.file}"`);
  }
  return out;
}
