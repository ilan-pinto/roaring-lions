// Milh Flats (large): the 96x96 twin of Milh Flats (GH-920 work package B3).
//
//   node tools/maps/milh_flats_l/build.mjs          writes data/maps/milh_flats_l.json
//                                                    and data/versus/milh_flats_l.json
//   node tools/maps/milh_flats_l/build.mjs --check  writes nothing, exits 1 if either shipped
//                                                    file differs from what this builds
//
// The cell sketch is the shipped 48x48 map, data/maps/milh_flats.json, read as a 48-cell sketch
// (design: _coord/bigger-maps/design.md 3), exactly as tools/maps/wadi_tarfan_l/build.mjs reads Wadi
// Tarfan. Areas (rock, boulder fields, knolls) copy as 2x2 blocks; every line feature is redrawn one
// tile per step by tools/maps/lib/upscale.mjs:
//   elevation  the 9/3/3/1 rule, every 2x2 staircase straightened;
//   roads      one-tile chains between the anchors of neighbouring cells (corner-touching diagonals);
//   walls      one tile thick;
//   the ditch  thinned on the sketch and drawn as a one-tile chain;
//   buildings  re-placed at their native footprint, on twice the source centre;
//   zones      at landmark size (the same w x h about twice the centre); the deploy grounds double;
//   markers    the top-half member of a twin pair is drawn at twice its tile, its twin is the half-turn.
// The bottom half is then written as the half-turn of the top, so symmetry is by construction.
// tools/src/large_map_verify.ts checks it from the JSON.
//
// What differs from Wadi Tarfan (large):
//   - the seats stand on the ANTI-diagonal (x + y = 95), as Milh Flats' do, and 77.8 tiles apart as
//     Rujm Sawda's and Wadi Tarfan (large)'s are (the lead's ruling of 2 Nov): (20,75) and (75,20).
//     Doubling the original's (9,38) and (38,9) would put them 82.0 apart;
//   - Milh Flats is a MIRROR-ONLY map and its original has no rules file at all, so there are no
//     tunnel routes; the rules file carries the capacity, the cap and a camp and an income table that
//     a mirror room never reads (it is there so the file validates, as Rujm Sawda's is);
//   - the sketch has a lone centre marker (23,23), one of the four tiles round the true centre
//     (23.5, 23.5): it is carried to (47,47), the same tile of the same four;
//   - the sketch has no ford and no pump house, so there is no ditch to keep whole and no plinth.
// B4 (GH-920) measures the fairness; nothing here claims it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { halfTurn, halfTurnOf, hash, runCli, serialise, sortedByKey } from '../lib/common.mjs';
import { stampChain } from '../lib/shapes.mjs';
import { barrierChain, components, interpElevation, placeShape, rescaleRect, roadChain, straightenStairs, thinSimple, topHalfMarkers, topHalfRects } from '../lib/upscale.mjs';

export { serialise };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

export const ID = 'milh_flats_l';
export const NAME = 'Milh Flats (large) — Bir Milh';
export const SOURCE_ID = 'milh_flats';
export const N = 48; // the sketch's side, in cells
export const SIZE = 2 * N;

const SOURCE_PATH = join(ROOT, 'data', 'maps', `${SOURCE_ID}.json`);
export const MAP_PATH = join(ROOT, 'data', 'maps', `${ID}.json`);
export const VERSUS_PATH = join(ROOT, 'data', 'versus', `${ID}.json`);

const { mirrorRect } = halfTurnOf(SIZE);

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

const cellsOf = (rows, symbols) => {
  const out = [];
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) if (symbols.includes(rows[y][x])) out.push([x, y]);
  return out;
};

/** The symbols that are copied as 2x2 blocks: areas, not lines. */
const BLOCK = 'bn';
/** The rock crown of a tell. Its cells become knoll (a 2x2 block each, like the rest of the tell) and the rock itself
 *  is re-placed at its NATIVE footprint, centred on twice the source centre (step 1b). */
const ROCK = '^';
/** Structures, re-placed at their native footprint. */
const BUILDING = 'hs#';

/**
 * Where the hash picks the cell's cover tiles: 3 of 4 for the scrub `1`, 2 of 4 for the acacia `o` and the
 * cover-2 `2`. (The sketch draws each as a whole cell; 4 tiles of cover per cell would double the cover share
 * past Rujm's band, and a patch with holes is the look the other large maps have.)
 */
function coverTiles(cx, cy, symbol) {
  const quad = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const h = hash(cx, cy, 1);
  if (symbol === '1') return quad.filter((_, i) => i !== h % 4);
  const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  return pairs[h % 6].map((i) => quad[i]);
}

export function tileMap() {
  const { rows, elev } = loadSketch();
  const T = SIZE;
  const t = Array.from({ length: T }, () => Array(T).fill('.'));
  // 9/3/3/1, then every 2x2 staircase of the result straightened to one tile a step (straightenStairs says why).
  // Wadi Tarfan (large) also keeps a step of two levels between cells a cliff (its B4 `keepCliffs`); this sketch has
  // none (every neighbouring pair of cells, diagonals included, differs by at most one level), so the rule would
  // change no tile and is not here.
  const el = straightenStairs(interpElevation(elev));
  const cellLevel = (x, y) => elev[y >> 1][x >> 1];
  const pinned = []; // tiles that stand at their own cell's level: rock, buildings, walls

  // 1. areas: rock, boulder fields and knolls copy as 2x2 blocks
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      const c = rows[cy][cx];
      if (!BLOCK.includes(c)) continue;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          t[2 * cy + dy][2 * cx + dx] = c;
        }
      }
    }
  }
  // 1b. the rock crown of each tell, at its native footprint on a knoll. A 2x2-block copy would be a 16-tile rock, past
  //     CROWN_MAX_TILES (12): the renderer would not read it as a crown, and the original's two crowned tells would
  //     lose their crowns. The knoll is the ring of the 4x4 block the rock does not fill.
  for (const [cx, cy] of cellsOf(rows, ROCK)) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) t[2 * cy + dy][2 * cx + dx] = 'n';
  }
  for (const b of components(rows.map((r) => r.join('')), ROCK)) {
    for (const [x, y] of placeShape(b.cells, N)) {
      t[y][x] = '^';
      pinned.push([x, y, elev[b.cells[0][1]][b.cells[0][0]]]);
    }
  }
  // 2. scrub, acacia and cover-2 ground: some of the cell's four tiles, never the block
  for (const [cx, cy] of cellsOf(rows, '12o')) {
    for (const [dx, dy] of coverTiles(cx, cy, rows[cy][cx])) t[2 * cy + dy][2 * cx + dx] = rows[cy][cx];
  }
  // 3. buildings at their native footprint, on twice the source centre
  for (const b of components(rows.map((r) => r.join('')), BUILDING)) {
    for (const [x, y] of placeShape(b.cells, N)) {
      if (!'.12o'.includes(t[y][x])) throw new Error(`building ${b.sym} at ${b.cells[0]} lands on ${t[y][x]} at ${x},${y}`);
      t[y][x] = b.sym;
      pinned.push([x, y, elev[b.cells[0][1]][b.cells[0][0]]]);
    }
  }
  // 4. walls, one tile thick
  for (const [x, y] of roadChain(cellsOf(rows, '='), N, { diag: true })) {
    if (!'.12o'.includes(t[y][x])) throw new Error(`wall tile ${x},${y} lands on ${t[y][x]}`);
    t[y][x] = '=';
    pinned.push([x, y, cellLevel(x, y)]);
  }
  // 5. the ditch: thinned on the sketch (a leaf one cell wide stays), then a one-tile chain
  {
    const mask = new Uint8Array(N * N);
    const fixed = new Uint8Array(N * N);
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        if (rows[cy][cx] === 'd') mask[cy * N + cx] = 1;
        if ('^b'.includes(rows[cy][cx])) fixed[cy * N + cx] = 1;
      }
    }
    const thin = thinSimple(mask, N, N, fixed, null);
    const cells = [];
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) if (thin[cy * N + cx]) cells.push([cx, cy]);
    for (const [x, y] of barrierChain(cells, cellsOf(rows, '^b'), N)) {
      if (t[y][x] === '^' || t[y][x] === 'b') continue; // already the barrier
      t[y][x] = 'd';
    }
  }
  // 6. roads, all one tile wide
  stampChain(t, roadChain(cellsOf(rows, 'r'), N, { diag: true }), 'r', '.12on=');
  for (const [x, y, lv] of pinned) el[y][x] = lv;
  return { t, el, rows, elev };
}

/** Ground a marker, a camp or a tunnel mouth may stand on (validate_versus_rules.mjs OPEN_SYMBOLS). */
const OPEN = '.123ron';

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
const AREA_ZONES = new Set(['deploy_0', 'deploy_1']);

/**
 * The seats, in the top-half member of the pair (seat 1) and its half-turn (seat 0): on the anti-diagonal
 * x + y = 95, 77.8 tiles apart (the lead's ruling of 2 Nov: Rujm Sawda's distance), where doubling the
 * original's (9,38) and (38,9) would give 82.0.
 */
export const SEAT_1 = [75, 20];
export const SEAT_0 = [SIZE - 1 - SEAT_1[0], SIZE - 1 - SEAT_1[1]];

/** The lone centre marker of the sketch (23,23), carried to the same one of the four tiles round the centre. */
const CENTRE = [2 * 23 + 1, 2 * 23 + 1];

export function layout(t) {
  const src = loadSketch().json;
  const paired = Object.fromEntries(Object.entries(src.markers).filter(([name]) => name !== 'centre'));
  const markers = topHalfMarkers(paired, N, (p) => nearestOpen(t, [2 * p[0], 2 * p[1]], 'marker'));
  markers.versus_1 = [...SEAT_1];
  markers.versus_0 = [...SEAT_0];
  markers.centre = nearestOpen(t, CENTRE, 'centre');
  const zones = topHalfRects(src.zones, N, (name, r) => rescaleRect(r, AREA_ZONES.has(name) ? 'area' : 'landmark'));
  return { markers, zones };
}

/** Income zones the rules file lists (a mirror room never reads them): the hamlet, the two tells, the four holds. */
const INCOME = [
  ['bir_milh', 60],
  ['tell_nw', 40],
  ['tell_se', 40],
  ['knoll_0', 20],
  ['knoll_1', 20],
  ['haven_0', 20],
  ['haven_1', 20],
];

export function build() {
  const { t, el } = tileMap();
  const lay = layout(t);
  halfTurn(t, el, SIZE);
  const { markers, zones } = lay;
  const map = {
    id: ID,
    name: NAME,
    width: SIZE,
    height: SIZE,
    terrain: 'arid',
    markers: sortedByKey(markers),
    zones: sortedByKey(zones),
    rows: t.map((r) => r.join('')),
    elevation: el.map((r) => r.join('')),
  };
  // the camp: two tiles west of the seat's formation (x 16..22), inside CAMP_REACH of the seat
  const camp = [14, 75, 2, 2];
  const versus = {
    id: ID,
    map: ID,
    // GH-920 B3: a 96x96 room holds 512 entities and plays to 35 minutes, as Rujm Sawda's does.
    capacity: 512,
    cap_minutes: 35,
    ends: {
      friendly: { camp: { at: camp.slice(0, 2), size: [2, 2] } },
      hostile: { camp: { at: mirrorRect(camp).slice(0, 2), size: [2, 2] } },
    },
    income_zones: INCOME.map(([zone, rate]) => ({ zone, rate_per_min: rate })),
  };
  return { map, versus };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { map, versus } = build();
  if (process.argv.includes('--print')) {
    for (let y = 0; y < SIZE; y++) console.log(String(y).padStart(2, '0'), map.rows[y], map.elevation[y]);
  } else {
    runCli(process.argv, [[MAP_PATH, serialise(map)], [VERSUS_PATH, serialise(versus)]], 'tools/maps/milh_flats_l/build.mjs');
  }
}
