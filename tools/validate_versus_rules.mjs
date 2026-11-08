// N3 Task 1 (network lane): the cross-file rules for data/versus/*.json that
// versus_rules.schema.json cannot see. Its own module for the reason every validate_*.mjs is one:
// validate_data.mjs runs its whole sweep at import time and exits.
//
//   - `map` is one of the faction-matchup maps, one of the MIRROR_RULES_MAPS (a map offered for the
//     mirror only, whose rules file carries its camps, zones, routes and limits) or one of the
//     RULES_ONLY_MAPS (authored, offered by no room yet), `id` is the map, and each of them has
//     exactly one file;
//   - every camp tile is inside the map, on open ground (a row character in OPEN_SYMBOLS: not a
//     ridge `^`, not a boulder or ditch `b`/`d`, not any structure symbol), and within
//     CAMP_REACH tiles (Chebyshev) of its end's anchor; the two camps do not overlap;
//   - every income zone names a zone the map or this file declares, once, at 1..120 a minute;
//   - a zone this file declares is inside the map and does not reuse one of the map's names;
//   - every `tunnels` route (GH-681): each point inside the map, its mouth and vent on open ground,
//     the vent at least VENT_MIN_DIST tiles (Euclidean, to the tile centre) from the OPPOSING
//     end's anchor, capacity 1..8, ids unique within the file and not a map route's, and the
//     map's routes plus the larger end's count within MAX_TUNNELS (only one end is ever registered).
//
// The anchors are plain node's copy of `versusAnchors` (packages/app/src/net/versus-seats.ts):
// the measured VERSUS_SEATS table first, else the map's own `versus_0`/`versus_1` markers.
// tools/src/validate_versus_rules.test.ts holds the copy to the shipped function, and
// MATCHUP_MAPS to @lions/net's FACTION_MATCHUP_MAPS, the way validate_doctrine.test.ts holds
// the menus to VERSUS_SARIM.

/** @lions/net FACTION_MATCHUP_MAPS. */
export const MATCHUP_MAPS = ['tel_marum', 'wadi_tarfan', 'wadi_tarfan_l'];

/** Maps with a rules file that are NOT faction-matchup maps: offered for the MIRROR only (KDF v KDF,
 *  Sarim v Sarim), the large network map of GH-913 (opened by work package L8, the lead's ruling of
 *  1 Nov: its KDF-v-Sarim cells read KDF 66-74% and the tunnels cell about 96%). They are in @lions/net's
 *  VERSUS_FAIR_MAPS and not in its FACTION_MATCHUP_MAPS; tools/src/validate_versus_rules.test.ts pins
 *  that, and the `cap_minutes` twin table, for every entry. The large Milh Flats of GH-920 joined it at B7 (mirror
 *  only like its original: B4 read only the mirror cells, KDF v KDF 50.0% pooled over 480 seeds). */
export const MIRROR_RULES_MAPS = ['rujm_sawda', 'milh_flats_l'];

/** Maps with a rules file that no room offers yet: in neither of @lions/net's VERSUS_FAIR_MAPS and
 *  FACTION_MATCHUP_MAPS. The large Wadi Tarfan of GH-920 waited here until B7 opened it (it moved into MATCHUP_MAPS: B4 read
 *  both faction cells inside 60/40 at its seats); the large Milh Flats (B3) did the same at its B7, into
 *  MIRROR_RULES_MAPS (mirror only), so the list was EMPTY until the last large map, Tel Marum (large) (GH-920 B3), waited here.
 *  Opening one means moving it into MIRROR_RULES_MAPS (or MATCHUP_MAPS) in the same commit; tools/src/validate_versus_rules.test.ts pins this list against both net lists, so it is red the
 *  moment a map is offered without its rules file being reclassified. */
export const RULES_ONLY_MAPS = ['tel_marum_l'];

/** packages/app/src/net/versus-seats.ts VERSUS_SEATS. */
export const VERSUS_SEATS = {
  beit_sahwan_outskirts: { friendly: [4, 22], hostile: [40, 23] },
  tel_marum: { friendly: [26, 45], hostile: [29, 17] },
  wadi_tarfan: { friendly: [10, 10], hostile: [37, 37] },
};

/** How far (Chebyshev, tiles, nearest camp tile) a camp may stand from its end's anchor. */
export const CAMP_REACH = 6;

/** Rows characters a camp may stand on: open ground and cover, roads, groves and knolls.
 *  (map.ts TERRAIN_LEGEND, `blocked` 0 and `boulder` 0; every other character is a ridge,
 *  a boulder, a ditch or a structure.) */
export const OPEN_SYMBOLS = new Set(['.', '1', '2', '3', 'r', 'o', 'n']);

export const MAX_RATE_PER_MIN = 120;

/** A versus route's vent may not open nearer than this to the opposing anchor (spec 6.2, Q3). */
export const VENT_MIN_DIST = 18;
/** @lions/sim MAX_TUNNELS (sim.ts): held to it by tools/src/validate_versus_rules.test.ts. */
export const MAX_TUNNELS = 16;
export const MAX_CAPACITY = 8;

/** The two anchors of `map`, or null when it names none. */
export function anchorsOf(map) {
  if (Object.hasOwn(VERSUS_SEATS, map.id)) return VERSUS_SEATS[map.id];
  const f = map.markers?.versus_0;
  const h = map.markers?.versus_1;
  return f && h ? { friendly: f, hostile: h } : null;
}

/** The sim's exitTile as tile indices: the first open tile of the footprint box plus one, row-major. */
export function scanExit(map, camp) {
  const [ax, ay] = camp.at;
  const [w, h] = camp.size;
  for (let y = ay - 1; y <= ay + h; y++) {
    for (let x = ax - 1; x <= ax + w; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if (x >= ax && x < ax + w && y >= ay && y < ay + h) continue;
      if (OPEN_SYMBOLS.has(map.rows[y][x])) return [x, y];
    }
  }
  return null;
}

/** 0 differing tiles under (x,y) -> (W-1-x,H-1-y), in rows and in elevation. */
export function pointSymmetric(map) {
  const H = map.rows.length;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.rows[y][x] !== map.rows[H - 1 - y][map.width - 1 - x]) return false;
      if (map.elevation && map.elevation[y][x] !== map.elevation[H - 1 - y][map.width - 1 - x]) return false;
    }
  }
  return true;
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
    if (!MATCHUP_MAPS.includes(doc.map) && !MIRROR_RULES_MAPS.includes(doc.map) && !RULES_ONLY_MAPS.includes(doc.map)) {
      out.push(`${file}: map "${doc.map}" is not a faction-matchup map (${MATCHUP_MAPS.join(', ')}), a mirror-rules map (${MIRROR_RULES_MAPS.join(', ')}) or a rules-only map (${RULES_ONLY_MAPS.join(', ')})`);
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
      // GH-976: an authored exit (tile index) is an open ring tile of the footprint -- the set the sim's exitTile scans.
      if (camp.exit !== undefined) {
        const e = camp.exit;
        const onRing = Array.isArray(e) && e.length === 2 && Number.isInteger(e[0]) && Number.isInteger(e[1])
          && e[0] >= ax - 1 && e[0] <= ax + w && e[1] >= ay - 1 && e[1] <= ay + h
          && !(e[0] >= ax && e[0] < ax + w && e[1] >= ay && e[1] < ay + h);
        if (!onRing) out.push(`${file}: ${end} camp exit (${e}) is not a ring tile of its footprint`);
        else if (e[0] < 0 || e[1] < 0 || e[0] >= map.width || e[1] >= map.height || !OPEN_SYMBOLS.has(map.rows[e[1]][e[0]])) {
          out.push(`${file}: ${end} camp exit (${e}) is not open ground`);
        }
      }
    }
    // GH-976: on a point-symmetric map the two camps' exits (authored, else the sim's NW scan) are point mirrors.
    if (camps.length === 2 && pointSymmetric(map)) {
      const ex = (end) => doc.ends[end].camp.exit ?? scanExit(map, doc.ends[end].camp);
      const a = ex('friendly');
      const b = ex('hostile');
      if (a && b && (a[0] + b[0] !== map.width - 1 || a[1] + b[1] !== map.height - 1)) {
        out.push(`${file}: the camp exits (${a}) and (${b}) are not point mirrors on the point-symmetric map "${doc.map}": the end that faces the attack gets the shorter raid`);
      }
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

    tunnelFailures(file, doc, map, anchors, out);
  }
  for (const m of MATCHUP_MAPS) {
    if (!seen.has(m)) out.push(`data/versus: no rules file for the faction-matchup map "${m}"`);
  }
  return out;
}

/** The `tunnels` block of one rules file (GH-681). Pushes one line per failure onto `out`. */
function tunnelFailures(file, doc, map, anchors, out) {
  const block = doc.tunnels;
  if (!block || typeof block !== 'object') return;
  const mapIds = new Set((map.tunnels ?? []).map((t) => t.id));
  const ids = new Set();
  let most = 0;
  for (const end of ['friendly', 'hostile']) {
    const routes = block[end];
    if (!Array.isArray(routes)) continue;
    most = Math.max(most, routes.length);
    const opposing = end === 'friendly' ? 'hostile' : 'friendly';
    for (const r of routes) {
      const name = `${file}: ${end} route "${r?.id}"`;
      if (ids.has(r?.id)) out.push(`${name} repeats a route id of this file`);
      ids.add(r?.id);
      if (mapIds.has(r?.id)) out.push(`${name} reuses the id of a route map "${doc.map}" already declares`);
      if (!Number.isInteger(r?.capacity) || r.capacity < 1 || r.capacity > MAX_CAPACITY) {
        out.push(`${name} capacity ${r?.capacity} is outside 1..${MAX_CAPACITY}`);
      }
      const pts = Array.isArray(r?.points) ? r.points : [];
      let onMap = true;
      pts.forEach((p, i) => {
        const [x, y] = p;
        if (!(x >= 0 && y >= 0 && x < map.width && y < map.height)) {
          out.push(`${name} point ${i} (${x},${y}) is off the ${map.width}x${map.height} map`);
          onMap = false;
        }
      });
      if (!onMap || pts.length < 2) continue;
      for (const [label, p] of [['mouth', pts[0]], ['vent', pts[pts.length - 1]]]) {
        const ch = map.rows[p[1]][p[0]];
        if (!OPEN_SYMBOLS.has(ch)) out.push(`${name} ${label} (${p[0]},${p[1]}) is "${ch}", not open ground (blocked, boulder, ditch or a building)`);
      }
      if (anchors) {
        const vent = pts[pts.length - 1];
        const [ox, oy] = anchors[opposing];
        const d = Math.hypot(vent[0] + 0.5 - (ox + 0.5), vent[1] + 0.5 - (oy + 0.5));
        if (d < VENT_MIN_DIST) {
          out.push(`${name} vent (${vent[0]},${vent[1]}) is ${d.toFixed(1)} tiles from the ${opposing} anchor (${ox},${oy}); the least is ${VENT_MIN_DIST}`);
        }
      }
    }
  }
  const total = (map.tunnels ?? []).length + most;
  if (total > MAX_TUNNELS) out.push(`${file}: ${(map.tunnels ?? []).length} map route(s) plus ${most} versus route(s) is ${total}; the sim holds ${MAX_TUNNELS}`);
}
