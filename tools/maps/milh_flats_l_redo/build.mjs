// Milh Flats (large), REDONE (GH-974): the 96x96 mirror-only map with a plan in it. STAGED, NOT OFFERED.
//
//   node tools/maps/milh_flats_l_redo/build.mjs          writes docs/campaign/staged_maps/milh_flats_l_redo/map.json
//                                                         and .../versus.json
//   node tools/maps/milh_flats_l_redo/build.mjs --check  writes nothing, exits 1 if either staged
//                                                         file differs from what this builds
//   node tools/maps/milh_flats_l_redo/build.mjs --print  draws the map (--print-elev: its relief)
//
// WHY STAGED. B4 passed (KDF v KDF 54.4% west over 480 seeds: 56.3% on 0-191, 53.1% on the held-out 4000-4287), but the render
// and memory budget did not: against the 48x48 the town's walls and houses cost the frame +3.85 ms at the centre (high, z1; the
// first build +0.75, the bar +0.5), and the sandbox's JS heap reads 154.3 MiB against its 153 MiB ceiling. Design decision 7 says
// to instance per-tile structures above +1 ms: that is renderer work, not this PR's, and the rule for a failed budget is that
// the PR must not change what is offered. So data/maps/milh_flats_l.json is still the first build
// (tools/maps/milh_flats_l/build.mjs), and this one waits here, byte for byte what B4 and the budget measured. Its JSON carries
// the id `milh_flats_l`, so opening it is a file copy plus the pin list in docs/agent-notes/maps-and-terrain-design.md.
//
// The lead's feedback of 3 Nov (GH-974): few obstacles, houses and roads forced a strategy, so most matches were an all-in
// fight. The design is _coord/versus-maps-design/design.md; its principles, as built here:
//   1. THREE LANES. Open armour ground; a built-up centre (Bir Milh); a covered infantry lane in each seat's wadi.
//   2. THE WADIS. Each seat's wadi (wadi_1 for the north-east seat, wadi_0 its half-turn) runs from beside that seat's flag
//      to a ford: a four-tile bed of scree (`b`: foot only, open to sight, no cover) cut two levels down (bed level 0, plain
//      level 2), so its banks are 2-level cliffs that hide a man in the bed from the plain. Vehicles cross only at the fords.
//   3. THE TOWN. Bir Milh is a 24x24 walled enclosure on the centre of the map. Its ring is a ditch belt (north and south)
//      and wall (east and west), closed to wheels but for TWO gates, a 4-tile street each, which meet in the khan court.
//      Inside: six walled yards (houses and sheds), two concrete blocks and two pump houses round the court, walls that
//      give cover 2 and hide nothing.
//   4. THE SEAL. The wadi_1 bed, the ford, the town's north-west corner, the town (through its gates), the south-east corner,
//      the ford of the other wadi and wadi_0 are ONE line from the top edge to the bottom edge, point-symmetric about the
//      centre. A vehicle crosses it at the left ford, the right ford or through the town and nowhere else:
//      tools/src/large_map_verify.ts cuts it three ways.
//   5. ROADS are the wheels' network (no speed bonus, the lead's ruling): a flank road through each ford and a street
//      road through the town.
//   6. HIGH GROUND. The tells keep their 12-tile knoll ring and crown rock, but their slopes are open; the seats stand on a
//      level-3 plateau as before.
//   7. COVER belts on the foot routes (scrub and acacia), never cover 3.
// The bottom half is written as the half-turn of the top, so symmetry is by construction.
//
// What stays from the first build (GH-920 B3): the seats (20,75) and (75,20) on the anti-diagonal, 77.8 tiles apart;
// capacity 512 and a 35-minute cap; the two tell rocks at their native four tiles; no tunnels (a mirror room has no economy).
// What changed: sketch.mjs keeps only the 48x48 original's skeleton, and this file draws the rest at tile level.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { halfTurn, halfTurnOf, hash, runCli, serialise, sortedByKey } from '../lib/common.mjs';
import { farmAt, scatterPatches, stampChain } from '../lib/shapes.mjs';
import { chainPath, components, interpElevation, placeShape, straightenStairs } from '../lib/upscale.mjs';
import { N, sketch } from './sketch.mjs';

export { serialise };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

export const ID = 'milh_flats_l';
export const NAME = 'Milh Flats (large) — Bir Milh';
export const SOURCE_ID = 'milh_flats';
export { N };
export const SIZE = 2 * N;

export const STAGED = join(ROOT, 'docs', 'campaign', 'staged_maps', 'milh_flats_l_redo');
export const MAP_PATH = join(STAGED, 'map.json');
export const VERSUS_PATH = join(STAGED, 'versus.json');

const { mirror, mirrorRect } = halfTurnOf(SIZE);

/** The sketch (json of the 48x48 original, rows, elev), under the name the first build used. */
export function loadSketch() {
  return sketch();
}

const cellsOf = (rows, symbols) => {
  const out = [];
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) if (symbols.includes(rows[y][x])) out.push([x, y]);
  return out;
};

/** Areas that copy as 2x2 blocks: the corner boulder fields. */
const BLOCK = 'b';
/** The rock crown of a tell: re-placed at its NATIVE footprint (a 16-tile block would be past CROWN_MAX_TILES, 12). */
const ROCK = '^';

/** Where the hash picks the cell's cover tiles: 3 of 4 for the scrub `1`, 2 of 4 for the acacia `o` and the cover-2 `2`. */
function coverTiles(cx, cy, symbol) {
  const quad = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const h = hash(cx, cy, 1);
  if (symbol === '1') return quad.filter((_, i) => i !== h % 4);
  const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  return pairs[h % 6].map((i) => quad[i]);
}

// --- the wadi ----------------------------------------------------------------------------------------------------------
/**
 * The north-east seat's wadi, wadi_1: a four-tile bed. From the top edge it runs south-west at 45 degrees (four tiles,
 * x + y in [diagC - 1, diagC + 2], on every row, so every contour steps one tile a row and the relief census has no 2x2
 * staircase to find) to row diagEnd, then straight south on the columns bedX..bedX + 3 to row bedEnd, which meets the
 * town's north-west corner. The FORD is the gap in the scree on rows fordRows: bed floor (level 0) with a level-1 ramp tile
 * on each bank. Wadi_0 is its half-turn.
 */
export const WADI = { diagC: 60, diagEnd: 27, bedX: 32, bedEnd: 36, fordRows: [29, 32], width: 4 };

function wadiTiles() {
  const out = [];
  for (let y = 0; y <= WADI.diagEnd; y++) for (let x = WADI.diagC - 1 - y; x <= WADI.diagC + 2 - y; x++) out.push([x, y]);
  for (let y = WADI.diagEnd + 1; y <= WADI.bedEnd; y++) for (let x = WADI.bedX; x < WADI.bedX + WADI.width; x++) out.push([x, y]);
  return out;
}

// --- the town ----------------------------------------------------------------------------------------------------------
/** Bir Milh is a 24x24 enclosure whose north-west corner tile is (x0, y0). It is symmetric about the map centre. */
export const TOWN = { x0: 36, y0: 36, n: 24 };

/**
 * The top half (rows 0..11) of the town, as a grid of symbols; the bottom half is the half-turn, which `halfTurn` writes.
 *
 *  - the ring: a ditch belt on row 0 but for the gate (columns 10..13, a four-tile street), walls on columns 0 and 23, and a
 *    two-tile FOOT gate (a ditch in the wall) where the east-west street meets each wall;
 *  - the plus of streets: columns 10..13 and rows 10..13, four tiles wide, meeting in the khan court;
 *  - four blocks of yards of 10 by 9, the north-east one split in two: walled, with gates onto the streets.
 *    Three houses and seven sheds in this half, so six and fourteen in all; two of the six stand at corners of the ring.
 */
export function townTop() {
  const n = TOWN.n;
  const T = Array.from({ length: n / 2 }, () => Array(n).fill('.'));
  const put = (x, y, c) => {
    T[y][x] = c;
  };
  const wallLine = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, '=');
  };
  // the ring
  for (let x = 0; x < n; x++) if (x < 10 || x > 13) put(x, 0, 'd');
  wallLine(0, 1, 0, 11);
  wallLine(23, 1, 23, 11);
  put(0, 11, 'd');
  put(23, 11, 'd');
  // north-west yard (0..9 by 1..9): walls on its edge, a gate onto the north-south street and one onto the east-west one
  wallLine(0, 1, 9, 1);
  wallLine(0, 9, 9, 9);
  wallLine(9, 1, 9, 9);
  for (const [x, y] of [[9, 4], [9, 5], [3, 9], [4, 9]]) put(x, y, '.');
  // north-east block (14..23 by 1..9): two yards sharing the wall on column 18
  wallLine(14, 1, 23, 1);
  wallLine(14, 9, 23, 9);
  wallLine(14, 1, 14, 9);
  wallLine(18, 1, 18, 9);
  for (const [x, y] of [[14, 4], [14, 5], [15, 9], [16, 9], [20, 9], [21, 9], [18, 5], [18, 6]]) put(x, y, '.');
  // buildings. Houses 2x2 (two floors), sheds one tile, a concrete block 2x2 at the court's corner, a pump house in the court.
  const block = (x, y, w, h, c) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(i, j, c);
  };
  // north-west yard: a corner house, a second house and three sheds (a shed is a one-floor shanty of two tiles)
  block(2, 3, 2, 2, 'h');
  block(5, 6, 2, 2, 'h');
  for (const [x, y, w, h] of [[6, 3, 2, 1], [1, 6, 1, 2], [3, 7, 2, 1]]) block(x, y, w, h, 's');
  block(8, 8, 2, 2, '#');
  // north-east block: the west yard holds sheds, the east yard the corner house and two more
  for (const [x, y, w, h] of [[16, 3, 2, 1], [15, 7, 2, 1], [19, 6, 1, 2], [22, 6, 1, 2]]) block(x, y, w, h, 's');
  block(20, 3, 2, 2, 'h');
  put(10, 10, 'p'); // the court's pump houses (the second is its half-turn)
  return T;
}

// --- the roads ----------------------------------------------------------------------------------------------------------
/** Waypoints of the top half's roads; each pair is joined by a one-tile chain (diagonal steps first). */
export const ROADS = {
  // seat 1's west road: through the left ford and down the west flank to the seam, where it meets the half-turn of the east road
  west: [[72, 27], [46, 27], [39, 30], [31, 30], [27, 34], [23, 38], [22, 42], [22, 47]],
  // seat 1's east road: down the east flank to the seam
  east: [[72, 27], [74, 29], [74, 40], [73, 47]],
  // the seat's own spur
  spur: [[75, 21], [73, 25], [72, 27]],
  // the street road: from the west road, through the north gate and down the town's north-south street to the seam
  street: [[47, 27], [47, 47]],
};

function roadTiles(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) out.push(...chainPath(points[i - 1], points[i]));
  return out;
}

// --- cover -------------------------------------------------------------------------------------------------------------
/**
 * Cover belts (scrub `1`, an acacia `o` at each centre) on the foot routes: either bank of each ford, the west flank, the
 * east flank, and the north approach to the town. Never cover 3 (design principle 4). Top half only.
 */
export const COVER_PATCHES = [
  // the west flank, beside the road and the town's west wall
  [28, 34], [24, 35], [25, 40], [30, 39], [33, 41], [21, 45], [27, 46], [29, 43],
  // either bank of the left ford
  [28, 27], [40, 26], [41, 34], [38, 31],
  // the north approach to the town gate
  [52, 31], [60, 33], [64, 29], [58, 26], [54, 22], [47, 16], [40, 18], [56, 16], [62, 22], [50, 26],
  // above and below the wadi's diagonal bank
  [55, 10], [48, 17], [60, 5], [50, 6], [43, 13], [36, 20],
  // the east flank and the farm
  [70, 36], [78, 46], [68, 45], [76, 33], [90, 40], [70, 41], [66, 34], [82, 46],
];
const COVER_RADIUS = 2.6;

// --- the tile map -------------------------------------------------------------------------------------------------------
export function tileMap() {
  const { rows, elev } = sketch();
  const T = SIZE;
  const t = Array.from({ length: T }, () => Array(T).fill('.'));
  // 9/3/3/1, then every 2x2 staircase of the result straightened to one tile a step: the sketch is level 2 but for the
  // two tell hills and the seat plateau
  const el = straightenStairs(interpElevation(elev));

  // 1. areas: the corner boulder fields copy as 2x2 blocks
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      if (!BLOCK.includes(rows[cy][cx])) continue;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) t[2 * cy + dy][2 * cx + dx] = rows[cy][cx];
    }
  }
  // 1b. the rock crown of each tell, at its native footprint on a knoll ring
  for (const [cx, cy] of cellsOf(rows, ROCK)) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) t[2 * cy + dy][2 * cx + dx] = 'n';
  }
  const rocks = [];
  for (const b of components(rows.map((r) => r.join('')), ROCK)) {
    for (const [x, y] of placeShape(b.cells, N)) {
      t[y][x] = '^';
      rocks.push([x, y, elev[b.cells[0][1]][b.cells[0][0]]]);
    }
  }
  // 2. the sketch's scrub, acacia and cover-2 ground: some of the cell's four tiles, never the block
  for (const [cx, cy] of cellsOf(rows, '12o')) {
    for (const [dx, dy] of coverTiles(cx, cy, rows[cy][cx])) {
      if (t[2 * cy + dy][2 * cx + dx] === '.') t[2 * cy + dy][2 * cx + dx] = rows[cy][cx];
    }
  }
  // 2b. cover belts on the foot routes
  scatterPatches(
    (x, y, c) => {
      if (t[y][x] === '.') t[y][x] = c;
    },
    hash,
    COVER_PATCHES,
    { radius: COVER_RADIUS, salt: 7, rows: N, symbol: '1', centreSymbol: 'o' },
  );

  // 3. the wadi: scree bed cut to level 0, the ford a gap in it with a level-1 ramp tile on each bank
  const [f0, f1] = WADI.fordRows;
  for (const [x, y] of wadiTiles()) {
    const ford = y >= f0 && y <= f1 && y > WADI.diagEnd;
    t[y][x] = ford ? '.' : 'b';
    el[y][x] = 0;
  }
  for (let y = f0; y <= f1; y++) {
    for (const x of [WADI.bedX - 1, WADI.bedX + WADI.width]) {
      el[y][x] = 1;
      t[y][x] = '.'; // a ramp is bare ground, not scrub
    }
  }

  // 4. the town, top half. The court and the streets are cleared of the sketch's cover, the yards of everything.
  const top = townTop();
  for (let y = 0; y < TOWN.n / 2; y++) for (let x = 0; x < TOWN.n; x++) t[TOWN.y0 + y][TOWN.x0 + x] = top[y][x];

  // 5. the home farm (the half-turn is the other): a walled 8x8 with two gates and a two-floor house
  farmAt(t, 80, 36, [84, 39], [[80, 39], [80, 40], [83, 36], [84, 36]]);
  // ... whose farmhouse is a one-floor shanty, not a house: the versus gate keeps houses to 40% of the building tiles
  for (let y = 39; y < 41; y++) for (let x = 84; x < 86; x++) t[y][x] = 's';

  // 6. roads, all one tile wide
  for (const pts of Object.values(ROADS)) stampChain(t, roadTiles(pts), 'r', '.12onr');
  for (const [x, y, lv] of rocks) el[y][x] = lv;
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

/**
 * The seats, in the top-half member of the pair (seat 1) and its half-turn (seat 0): on the anti-diagonal x + y = 95,
 * 77.8 tiles apart (the lead's ruling of 2 Nov: Rujm Sawda's distance).
 */
export const SEAT_1 = [75, 20];
export const SEAT_0 = [SIZE - 1 - SEAT_1[0], SIZE - 1 - SEAT_1[1]];

/** The lone centre marker: one of the four tiles round the true centre (47.5, 47.5), on the street road. */
const CENTRE = [47, 47];

/** Zones, top-half member first (the other is its half-turn rectangle), [x, y, w, h]. */
const ZONES_TOP = {
  tell_nw: [17, 17, 10, 10],
  ford_nw: [WADI.bedX, WADI.fordRows[0], WADI.width, WADI.fordRows[1] - WADI.fordRows[0] + 1],
  farm_1: [80, 36, 8, 8],
  deploy_1: [66, 8, 24, 24],
  camp_yard_1: [78, 17, 8, 8],
};
const TWIN = { tell_nw: 'tell_se', ford_nw: 'ford_se', farm_1: 'farm_0', deploy_1: 'deploy_0', camp_yard_1: 'camp_yard_0' };

export function layout(t) {
  const markers = {
    versus_1: [...SEAT_1],
    versus_0: [...SEAT_0],
    centre: nearestOpen(t, CENTRE, 'centre'),
  };
  // [top-half tile, mirror name]: the mirror is the half-turn of the placed top-half marker
  const pairs = {
    tell_nw: [[24, 24], 'tell_se'],
    tell_nw_crown: [[22, 18], 'tell_se_crown'],
    wadi_mouth_1: [[61, 1], 'wadi_mouth_0'],
    flag_1: [[69, 5], 'flag_0'],
    // the town's two gates: gate_1 is the north one, on the north-east seat's side of the seal, gate_0 the south one
    gate_1: [[47, 36], 'gate_0'],
  };
  for (const [name, [p, twin]] of Object.entries(pairs)) {
    markers[name] = nearestOpen(t, p, name);
    markers[twin] = mirror(markers[name]);
  }
  const zones = {};
  for (const [name, r] of Object.entries(ZONES_TOP)) {
    zones[name] = [...r];
    zones[TWIN[name]] = mirrorRect(r);
  }
  zones.bir_milh = [44, 44, 8, 8]; // the khan court
  zones.town = [TOWN.x0, TOWN.y0, TOWN.n, TOWN.n]; // the whole enclosure: the visibility cap's town and the cut check's third crossing
  return { markers, zones };
}

/** Income zones the rules file lists (a mirror room never reads them): the town, the two tells, the two fords, the two farms. */
const INCOME = [
  ['bir_milh', 60],
  ['tell_nw', 40],
  ['tell_se', 40],
  ['ford_nw', 20],
  ['ford_se', 20],
  ['farm_0', 20],
  ['farm_1', 20],
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
    console.log('   ' + [...Array(SIZE).keys()].map((i) => String(Math.floor(i / 10) % 10)).join(''));
    console.log('   ' + [...Array(SIZE).keys()].map((i) => String(i % 10)).join(''));
    for (let y = 0; y < SIZE; y++) console.log(String(y).padStart(2, '0'), map.rows[y]);
  } else if (process.argv.includes('--print-elev')) {
    for (let y = 0; y < SIZE; y++) console.log(String(y).padStart(2, '0'), map.elevation[y]);
  } else {
    runCli(process.argv, [[MAP_PATH, serialise(map)], [VERSUS_PATH, serialise(versus)]], 'tools/maps/milh_flats_l_redo/build.mjs');
  }
}
