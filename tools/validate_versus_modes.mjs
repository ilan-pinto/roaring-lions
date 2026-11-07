// GH-976 P1: the cross-file rules for data/versus/modes/*.json that versus_mode.schema.json cannot see. Its own
// module for the reason every validate_*.mjs is one: validate_data.mjs runs its whole sweep at import time.
//
//   - `id` is the map, each map has exactly one file, and the map is one a versus room is offered on
//     (OFFERED_MAPS, @lions/net's VERSUS_FAIR_MAPS; the test pins the copy);
//   - `modes` names only known modes (WIN_MODES), and `camps` is present exactly when the `camp` mode is,
//     `flags` exactly when the `flag` mode is (GH-976 P3);
//   - a flag zone is inside the map, every tile of it open ground (a raider has to be able to stand there), holds
//     NEITHER end's anchor (a seat that spawned on its flag would contest it from its first tick and a raid could
//     never begin), does not overlap the other flag or a camp, and is no zone of the map already (the loader adds
//     `flag_friendly` / `flag_hostile`, and the room refuses a name that is taken);
//   - every camp tile is inside the map, on open ground (OPEN_SYMBOLS, the rules files' own set), the camp
//     stands within MODE_CAMP_REACH tiles (Chebyshev) of its END's anchor, and the two camps do not overlap;
//   - a points zone names a zone the map declares, or (with `at` and `size`, GH-976 P4) declares its own ground, whose name
//     the map does not have and which is at least half open; either way it is listed once and contains NEITHER end's anchor:
//     a seat that held a scoring zone from its first tick would be paid for standing still;
//   - no `seconds` anywhere: a mode objective has no deadline, the match cap is its clock. (The schema forbids
//     extra keys already; this names the reason, because a primary `raze` in a MISSION must declare `seconds`
//     and an author copying that rule here would shorten the mode below the cap.)
//   - `flag_setup` (GH-976 v2, STAGED beside the shipped `flags`): only on a point-symmetric map that also has `modes.flag`; its
//     two flags obey R1 (open 5x5, G-ratio, G-depth, G-edge, no anchor, no overlap, point mirror) and the set-up rules S2-S4,
//     its kit is the lead's fixed kit and its set-up the fixed 180 seconds (its own `seconds` is the one allowed key of that name).
//
// The anchors come from `anchorsOf` of the rules validator (the measured seats first, else the map's own
// versus_0/versus_1 markers), which tools/src/validate_versus_rules.test.ts holds to the shipped function.
import { OPEN_SYMBOLS, anchorsOf, pointSymmetric, scanExit } from './validate_versus_rules.mjs';

/** How far a MODE camp may stand from its end's anchor (Chebyshev, nearest camp tile): 10 (GH-976, 5 Nov). The economy camps of
 *  data/versus/<map>.json keep CAMP_REACH 6 (validate_versus_rules.mjs): a mode camp is a raid target, not a production yard, and the
 *  forward camps that make "destroy the camp" fair stand 8 (wadi_tarfan) and 10 (wadi_tarfan_l) tiles out. milh_flats' (15,39) and
 *  (31,7) are within 6 and unchanged. A camp past 10 has not been read fair anywhere. */
export const MODE_CAMP_REACH = 10;

/** @lions/net WIN_MODES. */
export const WIN_MODES = ['camp', 'points', 'flag'];

/** @lions/net VERSUS_FAIR_MAPS: the maps a versus room may be hosted on. */
export const OFFERED_MAPS = ['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l'];

/** @lions/data SETUP_KIT, SETUP_SECONDS, SETUP_BAND_TILES_48 and SETUP_BAND_TILES_LARGE: the test pins every copy. */
export const SETUP_KIT = { hesco: 12, sandbag_post: 4, t_wall: 2 };
export const SETUP_SECONDS = 180;
export const SETUP_BAND_TILES_48 = 8;
export const SETUP_BAND_TILES_LARGE = 12;

/** The ground a man on foot may stand on: OPEN_SYMBOLS plus the boulder field `b`, the ditch `d` and the marsh `~`, which block
 *  only vehicles. Every other character (`#`, `^`, a structure symbol) blocks. A test holds this to `parseMap`'s own masks (R0.25). */
export const FOOT_OPEN = new Set([...OPEN_SYMBOLS, 'b', 'd', '~']);

/** Flag rules (R1, S2-S4). Tiles; Euclidean distances compare SQUARES, so everything here is an integer. */
export const FLAG_SIZE = 5;
export const FLAG_EDGE_TILES = 3;
export const FLAG_OWN_PATH_MIN = 6;
export const FLAG_OWN_PATH_MAX = 12;
export const FLAG_ENEMY_PATH_MIN_48 = 45;
export const FLAG_ENEMY_PATH_MIN_LARGE = 80;
/** S3: a flag tile stands at least this far (tile centres) from every tile of the enemy region. */
export const FLAG_ENEMY_REGION_TILES = 17;
/** S2: the apron round a flag (3 tiles each side of the 5x5) must lie in the owner's region. */
export const FLAG_APRON_TILES = 3;

/**
 * The set-up region of `map` (twin of @lions/data's `setupRegionOf`): -1 the band, 0 the region of `anchors.friendly`, 1 that of
 * `anchors.hostile`; row-major, as a plain Array. Exact integers in doubled coordinates, plain JS numbers (D^2 passes 2^31 on a
 * 96x96 map): no `|0`, no `Math.imul`, no Int32Array, no square root.
 */
export function setupRegion(map, anchors, band) {
  const [a, b] = [anchors.friendly, anchors.hostile];
  const ax = 2 * a[0] + 1;
  const ay = 2 * a[1] + 1;
  const bx = 2 * b[0] + 1;
  const by = 2 * b[1] + 1;
  const L = (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const bandSq = 4 * band * band * L;
  const out = new Array(map.width * map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cx = 2 * x + 1;
      const cy = 2 * y + 1;
      const D = (cx - bx) * (cx - bx) + (cy - by) * (cy - by) - ((cx - ax) * (cx - ax) + (cy - ay) * (cy - ay));
      out[y * map.width + x] = D * D >= bandSq ? (D > 0 ? 0 : 1) : -1;
    }
  }
  return out;
}

/** 4-neighbour BFS steps on the foot mask from tile `from` to the NEAREST tile of the rectangle `[x, y, w, h]`; Infinity if none. */
export function footPathTo(map, from, rect) {
  const { width: W, height: H } = map;
  const inRect = (x, y) => x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];
  const dist = new Int32Array(W * H).fill(-1);
  const queue = [from[1] * W + from[0]];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    const x = t % W;
    const y = (t - x) / W;
    if (inRect(x, y)) return dist[t];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (dist[n] >= 0 || !FOOT_OPEN.has(map.rows[ny][nx])) continue;
      dist[n] = dist[t] + 1;
      queue.push(n);
    }
  }
  return Infinity;
}

/** The failures of one file's `flag_setup`, given its map and anchors. */
function flagSetupFailures(file, doc, map, anchors) {
  const out = [];
  const fs = doc.flag_setup;
  const large = Math.max(map.width, map.height) > 48;
  if (!pointSymmetric(map)) out.push(`${file}: flag_setup is only for a point-symmetric map, and "${doc.map}" is not`);
  if (doc.modes?.flag === undefined) out.push(`${file}: flag_setup needs the flag mode (\`modes.flag\`) beside it`);
  const setup = fs.setup ?? {};
  const kit = setup.kit ?? {};
  for (const piece of Object.keys(SETUP_KIT)) {
    if (kit[piece] !== SETUP_KIT[piece]) out.push(`${file}: flag_setup kit ${piece} is ${kit[piece]}; the lead's kit is ${JSON.stringify(SETUP_KIT)} (a different number is a ruling, not data)`);
  }
  if (setup.seconds !== SETUP_SECONDS) out.push(`${file}: flag_setup seconds is ${setup.seconds}; the lead's set-up is ${SETUP_SECONDS} (a different number is a ruling, not data)`);
  const bandMin = large ? SETUP_BAND_TILES_LARGE : SETUP_BAND_TILES_48;
  if (setup.band_tiles < bandMin) out.push(`${file}: S4 band_tiles ${setup.band_tiles} is under ${bandMin}, the least on a ${map.width}x${map.height} map`);
  else if (setup.band_tiles !== bandMin) out.push(`${file}: band_tiles ${setup.band_tiles} is not ${bandMin}, the band of a ${map.width}x${map.height} map`);
  if (!anchors) return out;
  const region = setupRegion(map, anchors, Number.isInteger(setup.band_tiles) ? setup.band_tiles : bandMin);
  const campTiles = [];
  for (const end of ['friendly', 'hostile']) {
    const c = doc.camps?.[end];
    if (!c) continue;
    for (let y = c.at[1]; y < c.at[1] + c.size[1]; y++) for (let x = c.at[0]; x < c.at[0] + c.size[0]; x++) campTiles.push({ end, key: `${x},${y}` });
  }
  const rects = {};
  for (const end of ['friendly', 'hostile']) {
    const flag = fs.flags?.[end];
    if (!flag || !Array.isArray(flag.at) || !Array.isArray(flag.size)) continue;
    const other = end === 'friendly' ? 'hostile' : 'friendly';
    const [fx, fy] = flag.at;
    const [fw, fh] = flag.size;
    const tag = `${file}: flag_setup ${end} flag`;
    if (flag.exit !== undefined) out.push(`${tag} declares an exit; only a camp has one`);
    if (fw !== FLAG_SIZE || fh !== FLAG_SIZE) out.push(`${tag} is ${fw}x${fh}; a flag is ${FLAG_SIZE}x${FLAG_SIZE}`);
    rects[end] = [fx, fy, fw, fh];
    let inMap = true;
    for (let y = fy; y < fy + fh; y++) {
      for (let x = fx; x < fx + fw; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) { out.push(`${tag} tile (${x},${y}) is off the ${map.width}x${map.height} map`); inMap = false; continue; }
        const ch = map.rows[y][x];
        if (!OPEN_SYMBOLS.has(ch)) out.push(`${tag} tile (${x},${y}) is "${ch}", not open ground (blocked, boulder, ditch or a building)`);
      }
    }
    if (!inMap) continue;
    // G-edge: the zone stands at least FLAG_EDGE_TILES from every map edge.
    if (fx < FLAG_EDGE_TILES || fy < FLAG_EDGE_TILES || map.width - (fx + fw) < FLAG_EDGE_TILES || map.height - (fy + fh) < FLAG_EDGE_TILES) {
      out.push(`${tag} (${fx},${fy}) breaks G-edge: it stands under ${FLAG_EDGE_TILES} tiles from a map edge`);
    }
    for (const e2 of ['friendly', 'hostile']) {
      const [px, py] = anchors[e2];
      if (px >= fx && px < fx + fw && py >= fy && py < fy + fh) out.push(`${tag} holds the ${e2} anchor (${px},${py}): that seat would contest it from its first tick`);
    }
    for (const c of campTiles) {
      for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) if (c.key === `${x},${y}`) out.push(`${tag} overlaps the ${c.end} camp at (${x},${y})`);
    }
    // G-ratio and G-depth: paths from each seat to the NEAREST tile of the zone.
    const own = footPathTo(map, anchors[end], rects[end]);
    const enemy = footPathTo(map, anchors[other], rects[end]);
    if (own === Infinity || enemy === Infinity) out.push(`${tag} cannot be reached on foot from ${own === Infinity ? 'its own seat' : 'the enemy seat'}`);
    else {
      if (own * 2 > enemy) out.push(`${tag} breaks G-ratio: own path ${own}, enemy path ${enemy} (own must be at most half of the enemy's)`);
      if (own < FLAG_OWN_PATH_MIN || own > FLAG_OWN_PATH_MAX) out.push(`${tag} breaks G-depth: own path ${own} is not ${FLAG_OWN_PATH_MIN}-${FLAG_OWN_PATH_MAX}`);
      const enemyMin = large ? FLAG_ENEMY_PATH_MIN_LARGE : FLAG_ENEMY_PATH_MIN_48;
      if (enemy < enemyMin) out.push(`${tag} breaks G-depth: enemy path ${enemy} is under ${enemyMin}`);
    }
    // S2: the apron lies inside the owner's region. S3: every flag tile is far from every enemy-region tile.
    const mine = end === 'friendly' ? 0 : 1;
    let apronBad = 0;
    for (let y = fy - FLAG_APRON_TILES; y < fy + fh + FLAG_APRON_TILES; y++) {
      for (let x = fx - FLAG_APRON_TILES; x < fx + fw + FLAG_APRON_TILES; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height || region[y * map.width + x] !== mine) apronBad++;
      }
    }
    if (apronBad > 0) out.push(`${tag} breaks S2: ${apronBad} tiles of its ${fw + 2 * FLAG_APRON_TILES}x${fh + 2 * FLAG_APRON_TILES} apron lie outside its owner's region`);
    let nearest = Infinity;
    for (let ey = 0; ey < map.height; ey++) {
      for (let ex = 0; ex < map.width; ex++) {
        if (region[ey * map.width + ex] !== 1 - mine) continue;
        for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) nearest = Math.min(nearest, (x - ex) * (x - ex) + (y - ey) * (y - ey));
      }
    }
    if (nearest < FLAG_ENEMY_REGION_TILES * FLAG_ENEMY_REGION_TILES) out.push(`${tag} breaks S3: a flag tile is ${nearest} (squared) from the enemy region; the least is ${FLAG_ENEMY_REGION_TILES * FLAG_ENEMY_REGION_TILES}`);
  }
  if (rects.friendly && rects.hostile) {
    const [a, b] = [rects.friendly, rects.hostile];
    if (a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]) out.push(`${file}: flag_setup flags overlap`);
    if (a[2] !== b[2] || a[3] !== b[3] || a[0] + b[0] + b[2] !== map.width || a[1] + b[1] + b[3] !== map.height) {
      out.push(`${file}: flag_setup flags (${a[0]},${a[1]}) and (${b[0]},${b[1]}) are not point mirrors (top-left' = (W - x - w, H - y - h)) on "${doc.map}"`);
    }
  }
  return out;
}

/**
 * @param {{ file: string, doc: any }[]} files every parsed data/versus/modes file
 * @param {Map<string, any>} mapsById every parsed map JSON
 * @returns {string[]} one line per failure
 */
export function versusModeFailures(files, mapsById) {
  const out = [];
  const seen = new Map();
  for (const { file, doc } of files) {
    if (!doc || typeof doc !== 'object') continue; // the schema check reports it
    if (doc.id !== doc.map) out.push(`${file}: id "${doc.id}" is not its map "${doc.map}" -- one file per map, named by it`);
    if (!OFFERED_MAPS.includes(doc.map)) out.push(`${file}: map "${doc.map}" is not a map a versus room is offered on (${OFFERED_MAPS.join(', ')})`);
    if (seen.has(doc.map)) out.push(`${file}: a second mode file for "${doc.map}" (after ${seen.get(doc.map)})`);
    else seen.set(doc.map, file);
    const map = mapsById.get(doc.map);
    if (!map) {
      out.push(`${file}: map "${doc.map}" is not a map in data/maps`);
      continue;
    }
    const anchors = anchorsOf(map);
    if (!anchors) out.push(`${file}: map "${doc.map}" names no seats (no VERSUS_SEATS entry, no versus_0/versus_1 marker)`);
    const modes = doc.modes ?? {};
    for (const m of Object.keys(modes)) {
      if (!WIN_MODES.includes(m)) out.push(`${file}: mode "${m}" is not one of ${WIN_MODES.join(', ')}`);
    }
    if (modes.camp !== undefined && doc.camps === undefined) out.push(`${file}: the camp mode needs \`camps\``);
    if (modes.camp === undefined && doc.camps !== undefined) out.push(`${file}: \`camps\` is declared and no camp mode uses it`);
    if (modes.flag !== undefined && doc.flags === undefined) out.push(`${file}: the flag mode needs \`flags\``);
    if (modes.flag === undefined && doc.flags !== undefined) out.push(`${file}: \`flags\` is declared and no flag mode uses it`);
    if (JSON.stringify({ ...doc, flag_setup: undefined }).includes('"seconds"')) out.push(`${file}: a mode objective has no \`seconds\`: the match cap is its clock`);

    if (doc.flag_setup !== undefined) out.push(...flagSetupFailures(file, doc, map, anchors));

    const camps = [];
    for (const end of ['friendly', 'hostile']) {
      const camp = doc.camps?.[end];
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
          if (!OPEN_SYMBOLS.has(ch)) out.push(`${file}: ${end} camp tile (${x},${y}) is "${ch}", not open ground (blocked, boulder, ditch or a building)`);
          if (anchors) reach = Math.min(reach, Math.max(Math.abs(x - anchors[end][0]), Math.abs(y - anchors[end][1])));
        }
      }
      if (anchors && reach > MODE_CAMP_REACH) {
        out.push(`${file}: ${end} camp is ${reach} tiles (Chebyshev) from the ${end} anchor (${anchors[end].join(',')}); the most is ${MODE_CAMP_REACH}`);
      }
      camps.push({ end, tiles });
      // GH-976: the exit (tile index) is an open ring tile of the footprint -- the set the sim's exitTile scans.
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
    for (const end of ['friendly', 'hostile']) {
      if (doc.flags?.[end]?.exit !== undefined) out.push(`${file}: the ${end} flag declares an exit; only a camp has one`);
    }
    // GH-976: on a point-symmetric map the two camps' exits (authored, else the sim's NW scan) are point mirrors.
    if (camps.length === 2 && pointSymmetric(map)) {
      const ex = (end) => doc.camps[end].exit ?? scanExit(map, doc.camps[end]);
      const a = ex('friendly');
      const b = ex('hostile');
      if (a && b && (a[0] + b[0] !== map.width - 1 || a[1] + b[1] !== map.height - 1)) {
        out.push(`${file}: the camp exits (${a}) and (${b}) are not point mirrors on the point-symmetric map "${doc.map}": the end that faces the attack gets the shorter raid`);
      }
    }
    // GH-976: the footprints are point mirrors too (same size, and top-left + bottom-right = the far corner of the map). The
    // exits alone could mirror while one camp sits a tile nearer its end.
    if (camps.length === 2 && pointSymmetric(map)) {
      const f = doc.camps.friendly;
      const h = doc.camps.hostile;
      if (f.size[0] !== h.size[0] || f.size[1] !== h.size[1]
        || f.at[0] + h.at[0] + h.size[0] !== map.width || f.at[1] + h.at[1] + h.size[1] !== map.height) {
        out.push(`${file}: the camp footprints (${f.at} ${f.size}) and (${h.at} ${h.size}) are not point mirrors on the point-symmetric map "${doc.map}"`);
      }
    }
    if (doc.modes?.camp?.wipe !== undefined && !['ends', 'after_camp'].includes(doc.modes.camp.wipe)) out.push(`${file}: camp \`wipe\` "${doc.modes.camp.wipe}" is not ends or after_camp`);
    if (camps.length === 2 && camps[0].tiles.some((t) => camps[1].tiles.includes(t))) out.push(`${file}: the two camps overlap`);

    const mapZones = map.zones ?? {};
    const flagRects = [];
    for (const end of ['friendly', 'hostile']) {
      const flag = doc.flags?.[end];
      if (!flag || !Array.isArray(flag.at) || !Array.isArray(flag.size)) continue;
      const [fx, fy] = flag.at;
      const [fw, fh] = flag.size;
      if (Object.hasOwn(mapZones, `flag_${end}`)) out.push(`${file}: the map already has a zone "flag_${end}"`);
      const tiles = [];
      for (let y = fy; y < fy + fh; y++) {
        for (let x = fx; x < fx + fw; x++) {
          tiles.push(`${x},${y}`);
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
            out.push(`${file}: ${end} flag tile (${x},${y}) is off the ${map.width}x${map.height} map`);
            continue;
          }
          const ch = map.rows[y][x];
          if (!OPEN_SYMBOLS.has(ch)) out.push(`${file}: ${end} flag tile (${x},${y}) is "${ch}", not open ground (blocked, boulder, ditch or a building)`);
        }
      }
      if (anchors) {
        for (const e2 of ['friendly', 'hostile']) {
          const [px, py] = anchors[e2];
          if (px >= fx && px < fx + fw && py >= fy && py < fy + fh) out.push(`${file}: the ${end} flag holds the ${e2} anchor (${px},${py}): that seat would contest it from its first tick`);
        }
      }
      flagRects.push({ end, tiles });
    }
    if (flagRects.length === 2 && flagRects[0].tiles.some((t) => flagRects[1].tiles.includes(t))) out.push(`${file}: the two flags overlap`);
    for (const f of flagRects) for (const c of camps) if (f.tiles.some((t) => c.tiles.includes(t))) out.push(`${file}: the ${f.end} flag overlaps the ${c.end} camp`);
    const zoneSeen = new Set();
    for (const z of modes.points?.zones ?? []) {
      // A zone with `at` + `size` is a ground this file DECLARES (GH-976 P4); one without names a zone the map has.
      const declared = Array.isArray(z.at) && Array.isArray(z.size);
      if ((z.at === undefined) !== (z.size === undefined)) out.push(`${file}: points zone "${z.zone}" gives \`at\` or \`size\` without the other`);
      if (declared && Object.hasOwn(mapZones, z.zone)) out.push(`${file}: points zone "${z.zone}" declares its own ground, and the map already has a zone of that name`);
      if (declared && /^(flag|camp_yard)_/.test(z.zone)) out.push(`${file}: points zone "${z.zone}" takes a name the loader gives a flag or a camp`);
      const r = declared ? [z.at[0], z.at[1], z.size[0], z.size[1]] : mapZones[z.zone];
      if (r === undefined) {
        out.push(`${file}: points zone "${z.zone}" is not a zone of map "${doc.map}"`);
        continue;
      }
      if (declared) {
        let open = 0;
        for (let y = r[1]; y < r[1] + r[3]; y++) {
          for (let x = r[0]; x < r[0] + r[2]; x++) {
            if (x < 0 || y < 0 || x >= map.width || y >= map.height) { out.push(`${file}: points zone "${z.zone}" tile (${x},${y}) is off the ${map.width}x${map.height} map`); continue; }
            if (OPEN_SYMBOLS.has(map.rows[y][x])) open++;
          }
        }
        // A holder has to be able to stand in it: at least half of a declared ground is open.
        if (open * 2 < r[2] * r[3]) out.push(`${file}: points zone "${z.zone}" is ${open} open tiles of ${r[2] * r[3]}: a side could hardly stand in it`);
      }
      if (zoneSeen.has(z.zone)) out.push(`${file}: points zone "${z.zone}" is listed twice`);
      zoneSeen.add(z.zone);
      if (anchors) {
        for (const end of ['friendly', 'hostile']) {
          const [px, py] = anchors[end];
          if (px >= r[0] && px < r[0] + r[2] && py >= r[1] && py < r[1] + r[3]) {
            out.push(`${file}: points zone "${z.zone}" holds the ${end} anchor (${px},${py}): that seat would score from its first tick`);
          }
        }
      }
    }
  }
  return out;
}
