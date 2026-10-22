// N3 Task 1 (network lane): the cross-file rules for data/versus/*.json that
// versus_rules.schema.json cannot see. Its own module for the reason every validate_*.mjs is one:
// validate_data.mjs runs its whole sweep at import time and exits.
//
//   - `map` is one of the faction-matchup maps, `id` is the map, and each matchup map has exactly
//     one file;
//   - every camp tile is inside the map, on open ground (a row character in OPEN_SYMBOLS: not a
//     ridge `^`, not a boulder or ditch `b`/`d`, not any structure symbol), and within
//     CAMP_REACH tiles (Chebyshev) of its end's anchor; the two camps do not overlap;
//   - every income zone names a zone the map or this file declares, once, at 1..120 a minute;
//   - a zone this file declares is inside the map and does not reuse one of the map's names.
//
// The anchors are plain node's copy of `versusAnchors` (packages/app/src/net/versus-seats.ts):
// the measured VERSUS_SEATS table first, else the map's own `versus_0`/`versus_1` markers.
// tools/src/validate_versus_rules.test.ts holds the copy to the shipped function, and
// MATCHUP_MAPS to @lions/net's FACTION_MATCHUP_MAPS, the way validate_doctrine.test.ts holds
// the menus to VERSUS_SARIM.

/** @lions/net FACTION_MATCHUP_MAPS. */
export const MATCHUP_MAPS = ['tel_marum', 'wadi_tarfan'];

/** packages/app/src/net/versus-seats.ts VERSUS_SEATS. */
export const VERSUS_SEATS = {
  beit_sahwan_outskirts: { friendly: [4, 23], hostile: [40, 24] },
  tel_marum: { friendly: [24, 46], hostile: [28, 16] },
};

/** How far (Chebyshev, tiles, nearest camp tile) a camp may stand from its end's anchor. */
export const CAMP_REACH = 6;

/** Rows characters a camp may stand on: open ground and cover, roads, groves and knolls.
 *  (map.ts TERRAIN_LEGEND, `blocked` 0 and `boulder` 0; every other character is a ridge,
 *  a boulder, a ditch or a structure.) */
export const OPEN_SYMBOLS = new Set(['.', '1', '2', '3', 'r', 'o', 'n']);

export const MAX_RATE_PER_MIN = 120;

/** The two anchors of `map`, or null when it names none. */
export function anchorsOf(map) {
  if (Object.hasOwn(VERSUS_SEATS, map.id)) return VERSUS_SEATS[map.id];
  const f = map.markers?.versus_0;
  const h = map.markers?.versus_1;
  return f && h ? { friendly: f, hostile: h } : null;
}

/**
 * @param {{ file: string, doc: any }[]} rulesFiles every parsed data/versus file
 * @param {Map<string, any>} mapsById every parsed map JSON
 * @returns {string[]} one line per failure
 */
export function versusRulesFailures(rulesFiles, mapsById) {
  const out = [];
  const seen = new Map();
  for (const { file, doc } of rulesFiles) {
    if (!doc || typeof doc !== 'object') continue; // the schema check reports it
    if (doc.id !== doc.map) out.push(`${file}: id "${doc.id}" is not its map "${doc.map}" -- one file per map, named by it`);
    if (!MATCHUP_MAPS.includes(doc.map)) {
      out.push(`${file}: map "${doc.map}" is not a faction-matchup map (${MATCHUP_MAPS.join(', ')})`);
    }
    if (seen.has(doc.map)) out.push(`${file}: a second rules file for "${doc.map}" (after ${seen.get(doc.map)})`);
    else seen.set(doc.map, file);
    const map = mapsById.get(doc.map);
    if (!map) {
      out.push(`${file}: map "${doc.map}" is not a map in data/maps`);
      continue;
    }
    const anchors = anchorsOf(map);
    if (!anchors) out.push(`${file}: map "${doc.map}" names no seats (no VERSUS_SEATS entry, no versus_0/versus_1 marker)`);

    const camps = [];
    for (const end of ['friendly', 'hostile']) {
      const camp = doc.ends?.[end]?.camp;
      if (!camp || !Array.isArray(camp.at) || !Array.isArray(camp.size)) continue;
      const [ax, ay] = camp.at;
      const [w, h] = camp.size;
      let reach = Infinity;
      const tiles = [];
      for (let y = ay; y < ay + h; y++) {
        for (let x = ax; x < ax + w; x++) {
          tiles.push(`${x},${y}`);
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
            out.push(`${file}: ${end} camp tile (${x},${y}) is off the ${map.width}x${map.height} map`);
            continue;
          }
          const ch = map.rows[y][x];
          if (!OPEN_SYMBOLS.has(ch)) {
            out.push(`${file}: ${end} camp tile (${x},${y}) is "${ch}", not open ground (blocked, boulder, ditch or a building)`);
          }
          if (anchors) reach = Math.min(reach, Math.max(Math.abs(x - anchors[end][0]), Math.abs(y - anchors[end][1])));
        }
      }
      if (anchors && reach > CAMP_REACH) {
        out.push(
          `${file}: ${end} camp is ${reach} tiles (Chebyshev) from the ${end} anchor (${anchors[end].join(',')}); the most is ${CAMP_REACH}`
        );
      }
      camps.push({ end, tiles });
    }
    if (camps.length === 2 && camps[0].tiles.some((t) => camps[1].tiles.includes(t))) {
      out.push(`${file}: the two camps overlap`);
    }

    const mapZones = map.zones ?? {};
    const ownZones = doc.zones ?? {};
    for (const [name, z] of Object.entries(ownZones)) {
      if (Object.hasOwn(mapZones, name)) out.push(`${file}: zone "${name}" clashes with a zone the map "${doc.map}" already declares`);
      const [x, y, w, h] = z;
      if (x + w > map.width || y + h > map.height || w < 1 || h < 1) out.push(`${file}: zone "${name}" [${z.join(',')}] is out of bounds`);
    }
    const zoneSeen = new Set();
    for (const iz of doc.income_zones ?? []) {
      if (!Object.hasOwn(mapZones, iz.zone) && !Object.hasOwn(ownZones, iz.zone)) {
        out.push(`${file}: income zone "${iz.zone}" is declared by neither the map nor this file`);
      }
      if (zoneSeen.has(iz.zone)) out.push(`${file}: income zone "${iz.zone}" is listed twice`);
      zoneSeen.add(iz.zone);
      if (!Number.isInteger(iz.rate_per_min) || iz.rate_per_min < 1 || iz.rate_per_min > MAX_RATE_PER_MIN) {
        out.push(`${file}: income zone "${iz.zone}" rate_per_min ${iz.rate_per_min} is outside 1..${MAX_RATE_PER_MIN}`);
      }
    }
  }
  for (const m of MATCHUP_MAPS) {
    if (!seen.has(m)) out.push(`data/versus: no rules file for the faction-matchup map "${m}"`);
  }
  return out;
}
