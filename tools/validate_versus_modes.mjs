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
    if (JSON.stringify(doc).includes('"seconds"')) out.push(`${file}: a mode objective has no \`seconds\`: the match cap is its clock`);

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
