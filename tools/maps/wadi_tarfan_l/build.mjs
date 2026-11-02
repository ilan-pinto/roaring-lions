// Wadi Tarfan (large): the 96x96 twin of Wadi Tarfan (GH-920 work package B3).
//
//   node tools/maps/wadi_tarfan_l/build.mjs          writes data/maps/wadi_tarfan_l.json
//                                                     and data/versus/wadi_tarfan_l.json
//   node tools/maps/wadi_tarfan_l/build.mjs --check  writes nothing, exits 1 if either shipped
//                                                     file differs from what this builds
//
// The cell sketch is the shipped 48x48 map, data/maps/wadi_tarfan.json, read as a 48-cell sketch
// (design: _coord/bigger-maps/design.md 3). Areas copy as 2x2 blocks; every line feature is redrawn
// one tile per step by tools/maps/lib/upscale.mjs:
//   elevation  the 9/3/3/1 rule, so a contour steps one tile per level and does not scallop;
//   roads      one-tile chains between the anchors of neighbouring cells (corner-touching diagonals);
//   walls      one tile thick;
//   the ditch  the 2x2 copy thinned to one tile with its topology kept, against the boulder fields;
//   buildings  re-placed at their native footprint, on twice the source centre;
//   zones      at landmark size (the same w x h about twice the centre), not four times the area;
//   markers    the top-half member of a twin pair is drawn at twice its tile, its twin is the half-turn.
// The bottom half is then written as the half-turn of the top, so symmetry is by construction.
// tools/src/large_map_verify.ts checks it from the JSON.
//
// Seats, camps, income zones and tunnel capacities are Wadi Tarfan's own at PR 947 (seats (10,10) and
// (37,37), capacity 3 on every route, 300 a minute), carried over at twice the tile: the seats sit
// 77.8 tiles apart, as Rujm Sawda's do. B4 (GH-920) measures the fairness; nothing here claims it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { halfTurn, halfTurnOf, hash, runCli, serialise, sortedByKey } from '../lib/common.mjs';
import { scatterPatches, stampChain } from '../lib/shapes.mjs';
import { barrierChain, components, interpElevation, placeShape, rescaleRect, roadChain, straightenStairs, thinSimple, topHalfMarkers, topHalfRects } from '../lib/upscale.mjs';

export { serialise };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

export const ID = 'wadi_tarfan_l';
export const NAME = 'Wadi Tarfan (large) — The Three Fords';
export const SOURCE_ID = 'wadi_tarfan';
export const N = 48; // the sketch's side, in cells
export const SIZE = 2 * N;
const TOP = N; // rows 0..TOP-1 are drawn; the rest is the half-turn

const SOURCE_PATH = join(ROOT, 'data', 'maps', `${SOURCE_ID}.json`);
export const MAP_PATH = join(ROOT, 'data', 'maps', `${ID}.json`);
export const VERSUS_PATH = join(ROOT, 'data', 'versus', `${ID}.json`);
const SOURCE_RULES_PATH = join(ROOT, 'data', 'versus', `${SOURCE_ID}.json`);

const { mirror, mirrorRect } = halfTurnOf(SIZE);

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

/** The sketch's ford zones: the ditch is left whole within a cell of each. */
const FORD_ZONES = ['ne_ford', 'sw_ford', 'centre_ford'];

/** The symbols that are copied as 2x2 blocks: areas, not lines. */
const BLOCK = '^bn';
/** Structures, re-placed at their native footprint. */
const BUILDING = 'hsp';

/** Where the hash picks the cell's scrub tiles: 3 of 4 for `1`, 2 of 4 for the acacia `o`. */
function scrubTiles(cx, cy, symbol) {
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
  // 9/3/3/1, then every 2x2 staircase of the result straightened to one tile a step: the rule alone leaves
  // a diagonal cell contour as the same 2x2 staircase the nearest copy makes (straightenStairs says why)
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
          if (c === '^') pinned.push([2 * cx + dx, 2 * cy + dy, elev[cy][cx]]);
        }
      }
    }
  }
  // 2. scrub and acacia: some of the cell's four tiles, never the block
  for (const [cx, cy] of cellsOf(rows, '1o')) {
    for (const [dx, dy] of scrubTiles(cx, cy, rows[cy][cx])) t[2 * cy + dy][2 * cx + dx] = rows[cy][cx];
  }
  // 3. buildings at their native footprint, on twice the source centre
  for (const b of components(rows.map((r) => r.join('')), BUILDING)) {
    for (const [x, y] of placeShape(b.cells, N)) {
      if (t[y][x] !== '.') throw new Error(`building ${b.sym} at ${b.cells[0]} lands on ${t[y][x]} at ${x},${y}`);
      t[y][x] = b.sym;
      pinned.push([x, y, elev[b.cells[0][1]][b.cells[0][0]]]);
    }
  }
  // 4. walls, one tile thick
  for (const [x, y] of roadChain(cellsOf(rows, '='), N, { diag: true })) {
    if (!'.1'.includes(t[y][x])) throw new Error(`wall tile ${x},${y} lands on ${t[y][x]}`);
    t[y][x] = '=';
    pinned.push([x, y, cellLevel(x, y)]);
  }
  // 5. the ditch: thinned to one cell on the sketch (a leaf one cell wide stays), then a one-tile chain.
  //    Within a cell of a ford the ditch is not thinned at all: a ford is a gap whose width is a fact of
  //    the map, and thinning erodes the ends either side of it.
  {
    const mask = new Uint8Array(N * N);
    const fixed = new Uint8Array(N * N);
    const keep = new Uint8Array(N * N);
    const fordZones = FORD_ZONES.map((z) => loadSketch().json.zones[z]);
    const nearFord = (x, y) => fordZones.some(([zx, zy, zw, zh]) => x >= zx - 1 && x <= zx + zw && y >= zy - 1 && y <= zy + zh);
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        if (rows[cy][cx] === 'd') {
          mask[cy * N + cx] = 1;
          if (nearFord(cx, cy)) keep[cy * N + cx] = 1;
        }
        if ('^b'.includes(rows[cy][cx])) fixed[cy * N + cx] = 1;
      }
    }
    const thin = thinSimple(mask, N, N, fixed, keep);
    const cells = [];
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) if (thin[cy * N + cx]) cells.push([cx, cy]);
    for (const [x, y] of barrierChain(cells, cellsOf(rows, '^b'), N)) {
      if (t[y][x] === '^' || t[y][x] === 'b') continue; // already the barrier
      t[y][x] = 'd';
    }
  }
  // 6. roads, all one tile wide
  stampChain(t, roadChain(cellsOf(rows, 'r'), N, { diag: true }), 'r', '.1on=');
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
const AREA_ZONES = new Set(['camp_0', 'camp_1']);

/**
 * Seat 0's tunnel routes (mouth first, vent last), as Wadi Tarfan lays them, re-laid for the large
 * map ALONG THE LINE OF ADVANCE (the seat-to-seat diagonal): with u = (x + y) / 2 along it and
 * v = (x - y) / 2 across it, a point goes to u' = 2u and v' = v. The distance from the seat doubles,
 * the lateral offset does not, so a vent stays a few tiles off the diagonal as it was, instead of
 * moving 7 or 8 (L5, Rujm Sawda: a vent 14 to 30 tiles off the line of advance cost the Sarim more
 * than the raids gave back). Seat 1's routes are the half-turn images.
 */
function relaid([x, y]) {
  const u = (x + y) / 2;
  const v = (x - y) / 2;
  return [Math.floor(2 * u + v), Math.floor(2 * u - v)];
}

export function layout(t) {
  const src = loadSketch().json;
  const rules = JSON.parse(readFileSync(SOURCE_RULES_PATH, 'utf8'));
  const markers = topHalfMarkers(src.markers, N, (p) => nearestOpen(t, [2 * p[0], 2 * p[1]], 'marker'));
  const zones = topHalfRects(src.zones, N, (name, r) => rescaleRect(r, AREA_ZONES.has(name) ? 'area' : 'landmark'));
  const friendly = rules.tunnels.friendly.map((r) => ({
    id: r.id.replace(/^wt_/, 'wtl_'),
    points: r.points.map((p, i) => (i === 0 || i === r.points.length - 1 ? nearestOpen(t, relaid(p), `route ${r.id} point ${i}`) : relaid(p))),
    capacity: r.capacity,
  }));
  const hostile = friendly.map((r) => ({ id: r.id.replace('_f_', '_h_'), points: r.points.map(mirror), capacity: r.capacity }));
  return { markers, zones, rules, tunnels: { friendly, hostile } };
}

/** Each seat's opening formation, in tiles (packages/app/src/net/versus-force.ts), padded by one. */
const formationRect = ([sx, sy]) => ({ x0: sx - 5, x1: sx + 3, y0: sy - 10, y1: sy + 10 });

/** The look stage's scatter: cover patches on a jittered lattice, clear of everything that matters. */
function dress(t, lay) {
  const { markers, tunnels } = lay;
  const form = formationRect(markers.versus_0);
  const tunnelPoints = tunnels.friendly.flatMap((r) => r.points);
  const road = [];
  for (let y = 0; y < TOP; y++) for (let x = 0; x < SIZE; x++) if (t[y][x] === 'r') road.push([x, y]);
  const near = (list, x, y, r) => list.some(([qx, qy]) => Math.max(Math.abs(qx - x), Math.abs(qy - y)) <= r);
  const fords = ['ne_ford', 'sw_ford', 'centre', 'centre_ford'].map((n) => markers[n]);
  const clear = (x, y) => {
    if (x >= form.x0 - 1 && x <= form.x1 + 1 && y >= form.y0 - 1 && y <= form.y1 + 1) return false;
    if (near(road, x, y, 1) || near(Object.values(markers), x, y, 1) || near(tunnelPoints, x, y, 2) || near(fords, x, y, 4)) return false;
    return true;
  };
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= TOP || t[y][x] !== '.' || !clear(x, y)) return false;
    t[y][x] = c;
    return true;
  };
  // cover patches: one per lattice cell of 11 x 10 tiles, jittered by the hash, where the ground is open
  const patches = [];
  for (let gy = 5; gy < TOP - 2; gy += 10) {
    for (let gx = 5; gx < SIZE - 2; gx += 11) {
      const cx = gx + (hash(gx, gy, 6) % 5) - 2;
      const cy = gy + (hash(gx, gy, 7) % 5) - 2;
      let open = 0;
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) if (t[y]?.[x] === '.' && clear(x, y)) open++;
      if (open >= 22) patches.push([cx, cy]);
    }
  }
  scatterPatches(put, hash, patches, { radius: 2.6, salt: 5, rows: TOP, symbol: '1', centreSymbol: '2' });
  return patches;
}

export function build() {
  const { t, el } = tileMap();
  const lay = layout(t);
  dress(t, lay);
  halfTurn(t, el, SIZE);
  const { markers, zones, rules, tunnels } = lay;
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
  const camp = [17, 17, 2, 2];
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
    runCli(process.argv, [[MAP_PATH, serialise(map)], [VERSUS_PATH, serialise(versus)]], 'tools/maps/wadi_tarfan_l/build.mjs');
  }
}
