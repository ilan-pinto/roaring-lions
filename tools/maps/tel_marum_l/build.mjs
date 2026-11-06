// Tel Marum (large): the 96x96 twin of Tel Marum (GH-920 work package B3).
//
//   node tools/maps/tel_marum_l/build.mjs          writes data/maps/tel_marum_l.json
//                                                   and data/versus/tel_marum_l.json
//   node tools/maps/tel_marum_l/build.mjs --check  writes nothing, exits 1 if either shipped
//                                                   file differs from what this builds
//
// The cell sketch is the shipped 48x48 map, data/maps/tel_marum.json, read as a 48-cell sketch
// (design: _coord/bigger-maps/design.md 3), on the same library as tools/maps/wadi_tarfan_l/build.mjs.
//
// WHAT DIFFERS FROM THE OTHER THREE LARGE MAPS: Tel Marum is not point-symmetric. It is a campaign map
// (a valley closed by rock walls, a wall band across it with a wide pass and a boulder corridor, a
// village behind), played in a versus room from two MEASURED seats (versus-seats.ts: (27,45) in the
// south valley and (29,17) in the bowl south of the pass). So this generator draws the whole map and
// writes NO half-turn: there is no top half, no twin marker, no twin zone, and large_map_verify.ts reads
// the map with `asymmetric: true`.
//
// Areas copy as 2x2 blocks; every line feature is redrawn by tools/maps/lib/upscale.mjs:
//   elevation  the 9/3/3/1 rule, every 2x2 staircase straightened, then a step of two levels or more is
//              kept a cliff (the same rule as Wadi Tarfan (large)'s `keepCliffs`, which this sketch
//              needs more than any other: the wall band, the pass, the 2-level berm across the valley);
//   rock       `^` block-copied and pinned at its own cell's level; so is the boulder corridor `b`, as a rule
//              (the 9/3/3/1 rounding happens to leave its floor at 3 beside walls of 4 today: pinning it
//              mutated away changes no tile, so this pin is a stated rule and not a measured need);
//   buildings  re-placed at their native footprint, on twice the source centre (the village's 3x2);
//   zones      at landmark size (the same w x h about twice the centre); the two grounds (`valley_floor`
//              and `muster_ground`) double, as a camp does;
//   markers    at twice the tile. There is no cover on the sketch and the twin adds none: the cover a
//              fight has here is the relief.
//
// SEATS, CAMPS, TUNNELS (rules, not a tune: none of this was chosen by reading a seed):
//   - the seats are the original's measured seats at twice the tile, (54,90) and (58,34), named by
//     `versus_0`/`versus_1` markers (the original names them in VERSUS_SEATS instead). They stand
//     56.1 tiles apart, not the 78 of the other large maps: that is what a twin of THIS map gives, the
//     pass being where the second seat is. The lead decides whether that is wanted;
//   - a camp keeps its tile offset from its seat (units walk the same tiles): (-6,+1) and (-4,-3);
//   - a tunnel MOUTH and its middle point double; a VENT keeps its tile offset from the fight. The fight
//     is at the approach whatever the size of the map (the lesson of Wadi Tarfan (large), PR 953: a
//     doubled vent sat 15-20 tiles from any line of fire and the tunnel cell failed), so
//     vent = approach_L + (vent - approach). B4 (GH-920) measures it; nothing here claims it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli, serialise, sortedByKey } from '../lib/common.mjs';
import { components, interpElevation, placeShape, rescaleRect, straightenStairs } from '../lib/upscale.mjs';

export { serialise };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

export const ID = 'tel_marum_l';
export const NAME = 'Tel Marum (large) — The Gateway';
export const SOURCE_ID = 'tel_marum';
export const N = 48; // the sketch's side, in cells
export const SIZE = 2 * N;

const SOURCE_PATH = join(ROOT, 'data', 'maps', `${SOURCE_ID}.json`);
const SOURCE_RULES_PATH = join(ROOT, 'data', 'versus', `${SOURCE_ID}.json`);
export const MAP_PATH = join(ROOT, 'data', 'maps', `${ID}.json`);
export const VERSUS_PATH = join(ROOT, 'data', 'versus', `${ID}.json`);

/** The original's measured seats (packages/app/src/net/versus-seats.ts VERSUS_SEATS.tel_marum), as the sketch has them. */
export const SOURCE_SEATS = { friendly: [27, 45], hostile: [29, 17] };
/**
 * This map's seats. The hostile seat is twice the source tile. The friendly seat is NOT: at twice the tile
 * (54, 90) it is 42 tiles from the approach to the hostile seat's 17, and the faction cells followed that
 * asymmetry (GH-920). (54, 64) is the screened fit of 6 Nov; see the GH-920 comment for the table.
 */
export const SEAT_0 = [54, 64];
export const SEAT_1 = SOURCE_SEATS.hostile.map((v) => 2 * v);
/** The friendly seat's move from twice its source tile: the route mouths at that end move with it. */
const SEAT_0_SHIFT = [SEAT_0[0] - 2 * SOURCE_SEATS.friendly[0], SEAT_0[1] - 2 * SOURCE_SEATS.friendly[1]];
/**
 * Where each end's tunnel vents sit, as a scale on the source vent's offset from the approach marker (k) and a
 * pull toward the end's own seat (home, 0 = none, 1 = the seat). At twice the offset the vents sat 1.4x to
 * 1.9x farther from each seat than in the original and the games dragged to the cap.
 */
const VENTS = { friendly: { k: 0.5, home: 0 }, hostile: { k: 1, home: 0.7 } };

/** The source map, as the generator reads it: symbols and levels by cell. */
export function loadSketch() {
  const json = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
  if (json.width !== N || json.height !== N) throw new Error(`${SOURCE_ID} is ${json.width}x${json.height}, not ${N}x${N}`);
  return {
    json,
    rows: json.rows.map((r) => [...r]),
    elev: json.elevation.map((r) => [...r].map(Number)),
  };
}

/** The symbols that are copied as 2x2 blocks: rock and the boulder corridor. */
const BLOCK = '^b';
/** Structures, re-placed at their native footprint. */
const BUILDING = '#';
/** Ground nothing is built or blocked on (a marker may stand here; a boulder is open on foot). */
const BLOCKING = '^#';
/** Ground a camp or a tunnel mouth or vent may stand on (validate_versus_rules.mjs OPEN_SYMBOLS). */
const OPEN = '.123ron';

/**
 * A step of two levels or more between neighbouring source cells stays a cliff (GH-920 B4, Wadi Tarfan
 * (large)): the 9/3/3/1 rule turns every step into a ramp of one level a tile, and a two-level step is
 * what hides ground troops from each other (maps-and-terrain-design.md). A tile whose cell differs by 2
 * or more from any of the three cells it leans toward takes its own cell's level. This is a copy of
 * tools/maps/wadi_tarfan_l/build.mjs `keepCliffs`; the two stay separate files, as Milh Flats (large) has
 * its own copy of the surrounding code.
 */
export function keepCliffs(el, elev) {
  const cell = (cx, cy) => elev[Math.max(0, Math.min(N - 1, cy))][Math.max(0, Math.min(N - 1, cx))];
  return el.map((row, y) => row.map((v, x) => {
    const cx = x >> 1;
    const cy = y >> 1;
    const nx = cx + (x & 1 ? 1 : -1);
    const ny = cy + (y & 1 ? 1 : -1);
    const me = cell(cx, cy);
    const cliff = Math.abs(me - cell(nx, cy)) >= 2 || Math.abs(me - cell(cx, ny)) >= 2 || Math.abs(me - cell(nx, ny)) >= 2;
    return cliff ? me : v;
  }));
}

export function tileMap() {
  const { rows, elev } = loadSketch();
  const T = SIZE;
  const t = Array.from({ length: T }, () => Array(T).fill('.'));
  // 9/3/3/1, every 2x2 staircase straightened to one tile a step, a two-level step kept a cliff, and straightened again
  const el = straightenStairs(keepCliffs(straightenStairs(interpElevation(elev)), elev));
  const pinned = []; // tiles that stand at their own cell's level: rock, the corridor, buildings

  // 1. areas: rock and the boulder corridor copy as 2x2 blocks
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      const c = rows[cy][cx];
      if (!BLOCK.includes(c)) continue;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          t[2 * cy + dy][2 * cx + dx] = c;
          pinned.push([2 * cx + dx, 2 * cy + dy, elev[cy][cx]]);
        }
      }
    }
  }
  // 2. buildings at their native footprint, on twice the source centre
  for (const b of components(rows.map((r) => r.join('')), BUILDING)) {
    for (const [x, y] of placeShape(b.cells, N)) {
      if (t[y][x] !== '.') throw new Error(`building ${b.sym} at ${b.cells[0]} lands on ${t[y][x]} at ${x},${y}`);
      t[y][x] = b.sym;
      pinned.push([x, y, elev[b.cells[0][1]][b.cells[0][0]]]);
    }
  }
  for (const [x, y, lv] of pinned) el[y][x] = lv;
  return { t, el, rows, elev };
}

/** The open tile nearest (x, y), searching outward in rings (Chebyshev), ties in raster order. */
function nearestOpen(t, [x, y], what) {
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const [qx, qy] = [x + dx, y + dy];
        if (qx >= 0 && qy >= 0 && qx < SIZE && qy < SIZE && OPEN.includes(t[qy][qx])) return [qx, qy];
      }
    }
  }
  throw new Error(`${what} at ${x},${y}: no open tile within 4`);
}

/** Zones that are a ground, not a landmark: they double in both sides. */
const AREA_ZONES = new Set(['valley_floor', 'muster_ground']);

/** A marker at twice its tile; one that lands on rock or a building (none does) is refused, not moved. */
function markerAt(t, name, [x, y]) {
  const [qx, qy] = [2 * x, 2 * y];
  if (BLOCKING.includes(t[qy][qx])) throw new Error(`marker ${name} at ${qx},${qy} lands on ${t[qy][qx]}`);
  return [qx, qy];
}

/**
 * Seat 0's tunnel routes (mouth first, vent last), as Tel Marum lays them, re-laid for the large map.
 * Mouth and middle point at twice the tile; the vent at its original tile offset from the approach (the
 * fight), taken from twice the approach marker (see the header).
 */
export function layout(t) {
  const src = loadSketch().json;
  const rules = JSON.parse(readFileSync(SOURCE_RULES_PATH, 'utf8'));
  const markers = Object.fromEntries(Object.entries(src.markers).map(([name, p]) => [name, markerAt(t, name, p)]));
  markers.versus_0 = SEAT_0;
  markers.versus_1 = SEAT_1;
  const zones = Object.fromEntries(Object.entries(src.zones).map(([name, r]) => [name, rescaleRect(r, AREA_ZONES.has(name) ? 'area' : 'landmark')]));
  const fight = src.markers.approach; // the sketch's centre of the fight
  const fightL = markers.approach;
  const relaid = (end) => (r) => ({
    id: r.id.replace(/^tm_/, 'tml_'),
    points: r.points.map((p, i) => {
      if (i === r.points.length - 1) {
        const { k, home } = VENTS[end];
        const seat = end === 'friendly' ? SEAT_0 : SEAT_1;
        const vx = fightL[0] + k * (p[0] - fight[0]);
        const vy = fightL[1] + k * (p[1] - fight[1]);
        return nearestOpen(t, [Math.round(vx + home * (seat[0] - vx)), Math.round(vy + home * (seat[1] - vy))], `route ${r.id} vent`);
      }
      const mv = i === 0 && end === 'friendly' ? SEAT_0_SHIFT : [0, 0];
      return nearestOpen(t, [2 * p[0] + mv[0], 2 * p[1] + mv[1]], `route ${r.id} point ${i}`);
    }),
    capacity: r.capacity,
  });
  const tunnels = { friendly: rules.tunnels.friendly.map(relaid('friendly')), hostile: rules.tunnels.hostile.map(relaid('hostile')) };
  // each camp keeps its tile offset from its seat
  const camp = (end) => {
    const c = rules.ends[end].camp.at;
    const s = SOURCE_SEATS[end];
    const seat = end === 'friendly' ? SEAT_0 : SEAT_1;
    return { at: [seat[0] + c[0] - s[0], seat[1] + c[1] - s[1]], size: rules.ends[end].camp.size };
  };
  return { markers, zones, rules, tunnels, camps: { friendly: camp('friendly'), hostile: camp('hostile') } };
}

export function build() {
  const { t, el } = tileMap();
  const lay = layout(t);
  const { markers, zones, rules, tunnels, camps } = lay;
  const map = {
    id: ID,
    name: NAME,
    width: SIZE,
    height: SIZE,
    terrain: 'highland',
    markers: sortedByKey(markers),
    zones: sortedByKey(zones),
    rows: t.map((r) => r.join('')),
    elevation: el.map((r) => r.join('')),
  };
  const versus = {
    id: ID,
    map: ID,
    // GH-920 B3: a 96x96 room holds 512 entities and plays to 35 minutes, as Rujm Sawda's does.
    capacity: 512,
    cap_minutes: 35,
    ends: {
      friendly: { camp: { at: camps.friendly.at, size: camps.friendly.size } },
      hostile: { camp: { at: camps.hostile.at, size: camps.hostile.size } },
    },
    tunnels,
    income_zones: rules.income_zones,
  };
  return { map, versus };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { map, versus } = build();
  if (process.argv.includes('--print')) {
    for (let y = 0; y < SIZE; y++) console.log(String(y).padStart(2, '0'), map.rows[y], map.elevation[y]);
  } else {
    runCli(process.argv, [[MAP_PATH, serialise(map)], [VERSUS_PATH, serialise(versus)]], 'tools/maps/tel_marum_l/build.mjs');
  }
}
