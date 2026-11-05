// Rujm Sawda ("the black cairn"), REDONE (GH-974): the 80x80 network map with a plan in it. STAGED, NOT OFFERED.
//
//   node tools/maps/rujm_sawda_redo/build.mjs          writes docs/campaign/staged_maps/rujm_sawda_redo/map.json
//                                                       and .../versus.json
//   node tools/maps/rujm_sawda_redo/build.mjs --check  writes nothing, exits 1 if either staged
//                                                       file differs from what this builds
//   node tools/maps/rujm_sawda_redo/build.mjs --print  draws the map (--print-elev: its relief)
//
// The lead's feedback of 3 Nov (GH-974): few obstacles, houses and roads forced a strategy, so most matches were an all-in
// fight. The design is _coord/versus-maps-design/design.md; Rujm Sawda is the second map built on it (Milh Flats (large),
// PR 996, was the first). This file keeps the shipped map's SKELETON and redraws the rest:
//
//   KEPT (same places, same names): the seats (12,12) and (67,67) on the main diagonal, 77.8 tiles apart; the NW home shelf and
//   its rock ridge; the boulder flanks; the two walled wells of each seat; the two tells and the two mesas; the sheepfolds, the
//   cistern and the black cairn; the S-curve of the wadi with its three fords (v = x - y at 0 and +-27); the economy (eleven
//   income zones, 360 a minute, three tunnel routes an end), because a KDF v Sarim room reads it.
//
//   CHANGED, one line of the design each:
//   1. THE WADI IS A LANE. Its bed is five tiles of scree (`b`: foot only, open to sight, no cover) at level 0 on a plain at
//      level 2, so every bank is a 2-LEVEL CLIFF and a rifleman in the bed is hidden from the plain (the shipped bed was a
//      one-level dip with an open floor, hiding nothing). Vehicles cross at the three fords and over the two mesas.
//   2. THE TOWN. Bir Sawda is four walled yards, two on each bank, set back from the main road and leaning on the ford: a
//      one-floor shed or two and a pump house in the yards on one side of the road, a two-floor house on the lip over the
//      ford in the other (the only two houses on the map that are not a farm's). The shipped hamlet was three sheds.
//   3. THE TELLS. A tell is a stepped hill with BARE slopes (one level a tile on a 45-degree line, so no 2x2 staircase) and a
//      crown of rock ringed by twelve tiles of knoll; the shipped tell was a field of cover-2 knoll blocks.
//   4. THE MESAS are octagons on the same plan (a plateau, a skirt, a scree ring that closes on both map edges, two ramps).
//   5. COVER BELTS on the foot routes (scrub and acacia along the cliff lip and the approaches), never cover 3; the armour
//      lanes (the diagonal road, the ford tracks) are bare.
//   6. EVERYTHING IS COUNTED IN TRIANGLES (tools/src/map_triangles.ts). PR 1001 showed the cost of a town is triangles, not
//      draw calls: a wall tile is 3,087, a house 39,016, each drawn in three passes. The plan is drawn to fit the budget from
//      the start: no ditch (38,240 a tile), no concrete, one house a bank in the town, one-floor sheds in the wells, and the
//      centre window (48x48 tiles) holds fewer triangles than the 48x48 control map's whole map. large_map_verify.ts holds
//      the bill (`LargeMapSpec.triangles`).
//
// The map is point-symmetric about (39.5, 39.5): every feature is written with its half-turn image (`both`), so symmetry is by
// construction. tools/src/large_map_verify.ts checks it from the JSON.
//
// What the generator will not do is decide fairness. B4 (versus:probe, KDF v KDF) reads it once on seeds 0-191 and 4000-4287.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { halfTurnOf, hash, runCli, serialise, sortedByKey } from '../lib/common.mjs';
import { ringTiles, scatterPatches, stampChain } from '../lib/shapes.mjs';

export { serialise };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

export const ID = 'rujm_sawda';
export const NAME = 'Rujm Sawda — The Black Cairn';
export const SIZE = 80;

export const STAGED = join(ROOT, 'docs', 'campaign', 'staged_maps', 'rujm_sawda_redo');
export const MAP_PATH = join(STAGED, 'map.json');
export const VERSUS_PATH = join(STAGED, 'versus.json');

const { mirror, mirrorRect } = halfTurnOf(SIZE);

/** The level of the open plain (the shipped map's was 1: a one-level dip into the bed hides nothing). */
export const PLAIN = 2;
/** The level of the home shelf, where x + y <= SHELF_REACH (seat 0's corner; seat 1's is its half-turn). */
export const SHELF = 3;
export const SHELF_REACH = 41;

// --- the wadi -----------------------------------------------------------------------------------------------------------
export const WADI = {
  /** The S-curve's amplitude (tiles) and period along v = x - y: the shipped map's. */
  amp: 3.2,
  period: 104,
  /** The fords as v = x - y: the centre one and the inner pair; each is a gap of five v-values. */
  fords: [0, 27, -27],
  fordHalf: 2,
  /** The bed is `2 * bedHalf + 1` tiles across a row; |v| stops here (the mesa ring closes it sooner). */
  bedHalf: 2,
  vMax: 56,
};

/** The offset s0 of the bed's centre line from x + y = 79 at a given v, a whole number of tiles. */
export const bedCentre = (v) => Math.round(WADI.amp * Math.sin((2 * Math.PI * v) / WADI.period));

// --- the mesas and the tells ---------------------------------------------------------------------------------------------
/** A crown is a rectangle of rock; everything round it is read by the Manhattan distance from that rectangle. */
export const MESA = { crown: [70, 8, 4, 2], plateau: 3, skirt: 6, ring: [7, 8] };
export const TELL = { crown: [46, 24, 4, 2], hill: 3 };
const dist = ([x0, y0, w, h], x, y) => Math.max(x0 - x, 0, x - (x0 + w - 1)) + Math.max(y0 - y, 0, y - (y0 + h - 1));

// --- the town ------------------------------------------------------------------------------------------------------------
/**
 * Bir Sawda: four walled yards round the centre ford. A and B are seat 0's (A north-east of the road, B south-west, the
 * transpose of A's footprint); A' and B' are their half-turns. Every yard is a six-tile ring with two two-tile gates facing
 * the road. A holds the two-floor house, on the lip over the ford, and a shed; B a shed and a pump house.
 */
export const YARDS = {
  A: { x0: 37, y0: 27, gates: [[38, 32], [39, 32], [37, 30], [37, 31]], house: [40, 30], sheds: [[38, 28, 2, 1]], pump: null },
  B: { x0: 27, y0: 37, gates: [[32, 38], [32, 39], [30, 37], [31, 37]], house: null, sheds: [[28, 38, 1, 2]], pump: [30, 40] },
};
/** The zone the visibility gate holds to a town's share (85%) and a building share (25%): all four yards. */
export const TOWN_ZONE = [27, 27, 26, 26];

// --- cover ---------------------------------------------------------------------------------------------------------------
/** Scrub patches (a centre tile of cover 2) on the foot routes, top-half member of each pair; the twins are the half-turn. */
const PATCHES = [
  [20, 35], [28, 31], [36, 21], [44, 13], [52, 12], [24, 26], [58, 30], [66, 25], [56, 37], [64, 35], [73, 31], [75, 22], [47, 4], [30, 15],
  // the approaches to the cliff lip, either side of the town and ahead of each tell
  [33, 22], [42, 17], [55, 20], [17, 33], [30, 36], [62, 38],
  // belts for the foot lanes: between the shelf's lip and the cliff, either side of the main road and the funnel
  [30, 19], [24, 30], [36, 22], [46, 17], [26, 13], [38, 15], [19, 21], [33, 25], [50, 34], [44, 8], [58, 6], [14, 36], [16, 26], [66, 34],
];
const KNOLLS = [[[41, 30], [42, 30], [41, 31]], [[60, 21], [61, 21], [60, 22]]];
const ACACIA = [[17, 30], [50, 18], [70, 28], [62, 38]];

/** The boulder strips beside the main road: |x - y| in `core` (and one fringe tile either side) for x + y in [from, to]. */
export const FUNNEL = { core: [7, 8], from: 42, to: 60 };

/** The two sheepfolds of the top half, [x0, y0, w, h, gaps]: a five-by-four ring with a gap in each long side. */
const FOLDS_WITH_GAPS = [[22, 32, 5, 4, [[24, 32], [24, 35]]], [64, 29, 5, 4, [[66, 29], [66, 32]]]];
const FOLDS = FOLDS_WITH_GAPS.map(([x, y, w, h]) => [x, y, w, h]);

const inFord = (v, r) => WADI.fords.some((f) => Math.abs(v - f) <= r);

export function tileMap() {
  const T = SIZE;
  const t = Array.from({ length: T }, () => Array(T).fill('.'));
  const el = Array.from({ length: T }, () => Array(T).fill(PLAIN));
  const inMap = (x, y) => x >= 0 && y >= 0 && x < T && y < T;
  /** Write a tile and its half-turn twin. */
  const both = (x, y, c, e) => {
    for (const [px, py] of [[x, y], [T - 1 - x, T - 1 - y]]) {
      if (!inMap(px, py)) continue;
      if (c !== undefined) t[py][px] = c;
      if (e !== undefined) el[py][px] = e;
    }
  };
  const block = (x0, y0, w, h, c, e) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) both(x, y, c, e);
  };

  // 1. the relief that is not a feature: the home shelf, one step above the plain
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (x + y <= SHELF_REACH) both(x, y, undefined, SHELF);

  // 2. the rock ridge behind the seat, and the boulder flanks of the shelf
  for (let i = 0; i < 18; i++) {
    for (const [x, y] of [[i, 0], [i, 1], [0, i], [1, i]]) both(x, y, '^', 4);
  }
  // ... and the wedge of rock where the two arms of the ridge meet, a 45-degree edge (one tile a row): the shipped map's was
  // three 2x2 blocks, which is the 2x2 staircase the relief census refuses
  for (let y = 2; y <= 5; y++) for (let x = 2; x <= 7 - y; x++) both(x, y, '^', 4);
  for (const [cx, cy] of [[13, 1], [14, 1], [14, 2], [1, 13], [1, 14], [2, 14], [12, 2], [2, 12]]) block(2 * cx, 2 * cy, 2, 2, 'b');
  // the shelf lip: six cover knolls looking down the bank, one level over the plain
  for (const [cx, cy] of [[10, 12], [12, 10], [9, 13], [13, 9], [15, 7], [7, 15]]) block(2 * cx, 2 * cy, 2, 2, 'n', 3);

  // 2b. the funnel: two jagged strips of boulder (a wall to wheels and tracks, open ground to a man on foot: no cover, no
  // sight-blocking) run beside the main road either side, from the shelf's lip to the town. The core two tiles are unbroken;
  // the fringe is a hash. Armour on the centre road is committed to the gauntlet; infantry walk over the strips.
  for (let y = 0; y < T / 2; y++) {
    for (let x = 0; x < T; x++) {
      const v = Math.abs(x - y);
      const sum = x + y;
      if (sum < FUNNEL.from || sum > FUNNEL.to || FOLDS.some(([fx, fy, fw, fh]) => x >= fx - 1 && x <= fx + fw && y >= fy - 1 && y <= fy + fh)) continue;
      if (v === FUNNEL.core[0] || v === FUNNEL.core[1] || ((v === FUNNEL.core[0] - 1 || v === FUNNEL.core[1] + 1) && hash(x, y, 11) % 3 === 0)) both(x, y, 'b');
    }
  }

  // 3. the tells: a hill of bare slopes, a crown of rock and a ring of knoll
  {
    const [x0, y0, w, h] = TELL.crown;
    for (let y = y0 - TELL.hill; y < y0 + h + TELL.hill; y++) {
      for (let x = x0 - TELL.hill; x < x0 + w + TELL.hill; x++) {
        const d = dist(TELL.crown, x, y);
        if (d > TELL.hill) continue;
        // 5 on the crown, 4 on the ring of knoll, 3 on the next two steps, then the plain (2)
        both(x, y, d === 0 ? '^' : d === 1 ? 'n' : '.', d === 0 ? 5 : Math.max(PLAIN + 1, 5 - d));
      }
    }
  }

  // 4. the mesas: a plateau of knoll, a skirt, a scree ring that runs off both map edges, and two ramps
  const [mx, my, , mh] = MESA.crown;
  const ramps = [
    // west ramp: along the crown's rows; south ramp: down the crown's columns
    (x, y) => y >= my && y < my + mh && x < mx,
    (x, y) => x >= mx + 1 && x < mx + 3 && y > my + mh - 1,
  ];
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const d = dist(MESA.crown, x, y);
      if (d > MESA.ring[1]) continue;
      const ramp = ramps.some((r) => r(x, y));
      if (d === 0) both(x, y, '^', 6);
      else if (d <= MESA.plateau) both(x, y, (x + y) % 3 === 0 ? 'n' : '.', 5);
      else if (d <= MESA.skirt) both(x, y, '.', 4);
      else both(x, y, ramp ? '.' : 'b', 3);
    }
  }

  // 5. the wadi: a scree bed at level 0, a gap and a one-level ramp tile each side at the three fords
  const ringOf = (x, y) => Math.min(dist(MESA.crown, x, y), dist(MESA.crown, T - 1 - x, T - 1 - y));
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const v = x - y;
      const s = x + y - (T - 1);
      if (Math.abs(v) > WADI.vMax || ringOf(x, y) <= MESA.ring[1]) continue;
      const off = Math.abs(s - bedCentre(v));
      const ford = inFord(v, WADI.fordHalf);
      if (off <= WADI.bedHalf) both(x, y, ford ? '.' : 'b', 0);
      else if (off === WADI.bedHalf + 1 && ford) both(x, y, '.', 1);
    }
  }

  // 6. roads, one tile wide: the main diagonal, a spur to each well, a track over each inner ford
  const road = [];
  for (let k = 10; k < 40; k++) road.push([k, k]);
  for (let k = 1; k < 6; k++) road.push([12 + k, 12 - k]);
  for (let x = 18; x < 34; x++) road.push([x, 7]);
  for (let k = 1; k < 6; k++) road.push([12 - k, 12 + k]);
  for (let y = 18; y < 28; y++) road.push([7, y]);
  const FORD_NE = [54, 27];
  for (let k = -3; k < 7; k++) road.push([FORD_NE[0] + k, FORD_NE[1] + k]);

  // 7. the wells (walled yards with one shed, gated west and south / north and east) and the town's four yards
  const yard = (x0, y0, size, gates) => {
    for (const [x, y] of ringTiles(x0, y0, size, size)) both(x, y, '=');
    for (let y = y0 + 1; y < y0 + size - 1; y++) for (let x = x0 + 1; x < x0 + size - 1; x++) both(x, y, '.');
    for (const [gx, gy] of gates) both(gx, gy, '.');
  };
  yard(34, 4, 8, [[34, 6], [34, 7], [36, 11], [37, 11]]);
  block(38, 6, 2, 2, 's');
  yard(4, 28, 8, [[6, 28], [7, 28], [11, 30], [11, 31]]);
  block(6, 32, 2, 2, 's');
  for (const y of Object.values(YARDS)) {
    yard(y.x0, y.y0, 6, y.gates);
    if (y.house) block(y.house[0], y.house[1], 2, 2, 'h');
    for (const [x, yy, w, h] of y.sheds) block(x, yy, w, h, 's');
    if (y.pump) block(y.pump[0], y.pump[1], 2, 2, 'p');
  }

  // 8. landmarks, all low: two sheepfolds, a cistern, the black cairn
  const fold = (x0, y0, w, h, gaps) => {
    for (const [x, y] of ringTiles(x0, y0, w, h)) if (!gaps.some(([gx, gy]) => gx === x && gy === y)) both(x, y, '=');
  };
  for (const [x0, y0, w, h, gaps] of FOLDS_WITH_GAPS) fold(x0, y0, w, h, gaps);
  block(16, 37, 2, 2, 'p');
  {
    const cairn = [[57, 16], [58, 16], [57, 17], [58, 17]];
    const lv = PLAIN + 1;
    for (const [x, y] of cairn) both(x, y, '^', lv);
    for (const [cx, cy] of cairn) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = cx + dx;
          const qy = cy + dy;
          if (cairn.some(([a, b]) => a === qx && b === qy)) continue;
          both(qx, qy, hash(qx, qy, 9) % 2 ? 'n' : '1', lv);
        }
      }
    }
  }
  // the roads go down last-but-cover: they refuse to land on a wall or a rock
  stampChain(t, road.flatMap(([x, y]) => (inMap(x, y) ? [[x, y]] : [])), 'r', '.1', 'road');
  for (const [x, y] of road) if (inMap(x, y)) both(x, y, 'r');

  // 9. cover: acacia along the cliff lip, scrub patches on the approaches, knoll outcrops, lone acacia
  const markers = markerTable();
  const zones = zoneTable();
  const tunnelPoints = ROUTES_FRIENDLY.flatMap((r) => r.points.flatMap((p) => [p, mirror(p)]));
  const seat = markers.versus_0;
  const form = { x0: seat[0] - 5, x1: seat[0] + 3, y0: seat[1] - 10, y1: seat[1] + 10 };
  const inRect = ([rx, ry, rw, rh], x, y) => x >= rx - 1 && x < rx + rw + 1 && y >= ry - 1 && y < ry + rh + 1;
  const yards = Object.values(YARDS).flatMap((y) => [[y.x0, y.y0], mirror([y.x0 + 5, y.y0 + 5])]);
  const clear = (x, y) => {
    // the inside of a town yard is the yard's: its shed, house or pump, and nothing grown
    if (yards.some(([yx, yy]) => x >= yx && x < yx + 6 && y >= yy && y < yy + 6)) return false;
    for (const [fx0, fx1, fy0, fy1] of [[form.x0 - 1, form.x1 + 1, form.y0 - 1, form.y1 + 1]]) {
      if (x >= fx0 && x <= fx1 && y >= fy0 && y <= fy1) return false;
    }
    for (const [rx, ry] of road) if (Math.max(Math.abs(rx - x), Math.abs(ry - y)) <= 1) return false;
    for (const [mx2, my2] of Object.values(markers)) if (Math.max(Math.abs(mx2 - x), Math.abs(my2 - y)) <= 1) return false;
    for (const [tx, ty] of tunnelPoints) if (Math.max(Math.abs(tx - x), Math.abs(ty - y)) <= 2) return false;
    for (const f of ['ford_ne', 'ford_sw', 'centre']) {
      const [fx, fy] = markers[f];
      if (Math.max(Math.abs(fx - x), Math.abs(fy - y)) <= 4) return false;
    }
    for (const z of KEEP_CLEAR_ZONES) if (inRect(zones[z], x, y)) return false;
    return true;
  };
  const put = (x, y, c, e, need = '.') => {
    if (!need.includes(t[y][x]) || !clear(x, y)) return false;
    both(x, y, c, e);
    return true;
  };
  // the cliff lip: acacia on the plain tiles beside the bed (not at a ford), a third of them
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const v = x - y;
      const s = x + y - (T - 1);
      if (Math.abs(v) > WADI.vMax - 8 || inFord(v, 5) || y >= T / 2) continue;
      const off = Math.abs(s - bedCentre(v));
      if (off >= WADI.bedHalf + 2 && off <= WADI.bedHalf + 3 && hash(x, y, 3) % 3 === 0) put(x, y, 'o');
    }
  }
  scatterPatches(
    (x, y, c) => {
      if (inMap(x, y)) put(x, y, c);
    },
    hash,
    PATCHES,
    { radius: 2.6, salt: 5, rows: T / 2, symbol: '1', centreSymbol: '2' },
  );
  for (const k of KNOLLS) for (const [x, y] of k) put(x, y, 'n', PLAIN + 1, '.12');
  for (const [x, y] of ACACIA) put(x, y, 'o', undefined, '.12');
  return { t, el, road };
}

// --- markers, zones, rules -----------------------------------------------------------------------------------------------
/** [name, tile, twin's name]. A twin's name is its own: well_n_0 faces well_s_1. */
const MARKER_PAIRS = [
  ['versus_0', [12, 12], 'versus_1'],
  ['ford_ne', [54, 27], 'ford_sw'],
  ['tell_ne', [47, 26], 'tell_sw'],
  ['mesa_ne', [70, 11], 'mesa_sw'],
  ['ramp_ne_w', [62, 9], 'ramp_sw_e'],
  ['ramp_ne_s', [71, 16], 'ramp_sw_n'],
  ['well_n_0', [37, 8], 'well_s_1'],
  ['well_w_0', [7, 31], 'well_e_1'],
  ['bir_sawda', [35, 35], 'bir_sawda_1'],
];
/** [name, rect, twin's name]; a null twin is its own twin. */
const ZONE_PAIRS = [
  ['home_0', [6, 6, 12, 12], 'home_1'],
  ['well_n_0', [34, 4, 8, 8], 'well_s_1'],
  ['well_w_0', [4, 28, 8, 8], 'well_e_1'],
  ['tell_ne', [42, 20, 10, 10], 'tell_sw'],
  ['mesa_ne', [62, 0, 16, 16], 'mesa_sw'],
  ['centre', [34, 34, 12, 12], null],
  ['town', TOWN_ZONE, null],
];
/** Zones the cover scatter keeps clear (the old look stage's list). */
const KEEP_CLEAR_ZONES = ['well_n_0', 'well_w_0', 'well_s_1', 'well_e_1', 'mesa_ne', 'mesa_sw', 'tell_ne', 'tell_sw', 'home_0', 'home_1'];

function markerTable() {
  const markers = { centre: [39, 39] };
  for (const [a, p, b] of MARKER_PAIRS) {
    markers[a] = p;
    markers[b] = mirror(p);
  }
  return markers;
}
function zoneTable() {
  const zones = {};
  for (const [a, r, b] of ZONE_PAIRS) {
    zones[a] = r;
    if (b !== null) zones[b] = mirrorRect(r);
  }
  return zones;
}

/** Income a minute: 360 in all, the shipped map's. The town pays nothing. */
const RATES = {
  home_0: 20, home_1: 20,
  well_n_0: 30, well_w_0: 30, well_s_1: 30, well_e_1: 30,
  tell_ne: 30, tell_sw: 30,
  mesa_ne: 40, mesa_sw: 40,
  centre: 60,
};

/** Seat 0's three routes (mouth first, vent last); seat 1's are their half-turn images. The shipped map's. */
const ROUTES_FRIENDLY = [
  { id: 'rs_f_well', points: [[19, 10], [27, 9], [32, 8]], capacity: 2 },
  { id: 'rs_f_tell', points: [[20, 21], [31, 23], [41, 24]], capacity: 2 },
  { id: 'rs_f_centre', points: [[21, 17], [28, 26], [34, 31]], capacity: 2 },
];

export function build() {
  const { t, el } = tileMap();
  const map = {
    id: ID,
    name: NAME,
    width: SIZE,
    height: SIZE,
    terrain: 'arid',
    markers: sortedByKey(markerTable()),
    zones: sortedByKey(zoneTable()),
    rows: t.map((r) => r.join('')),
    elevation: el.map((r) => r.join('')),
  };
  const versus = {
    id: ID,
    map: ID,
    // GH-913 L3: the large map's room holds 512 entities (design section 2.6).
    capacity: 512,
    // GH-913 L8: a 35-minute match cap (design section 4); the Worker's command-log cap scales with it.
    cap_minutes: 35,
    ends: {
      // GH-976: authored exits; the friendly one is the sim's NW scan, the hostile one its point mirror.
      friendly: { camp: { at: [8, 8], size: [2, 2], exit: [7, 7] } },
      hostile: { camp: { at: mirrorRect([8, 8, 2, 2]).slice(0, 2), size: [2, 2], exit: mirror([7, 7]) } },
    },
    tunnels: {
      friendly: ROUTES_FRIENDLY.map((r) => ({ ...r })),
      hostile: ROUTES_FRIENDLY.map((r) => ({
        id: r.id.replace('_f_', '_h_'),
        points: r.points.map(mirror),
        capacity: r.capacity,
      })),
    },
    income_zones: Object.entries(RATES).map(([zone, rate_per_min]) => ({ zone, rate_per_min })),
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
    runCli(process.argv, [[MAP_PATH, serialise(map)], [VERSUS_PATH, serialise(versus)]], 'tools/maps/rujm_sawda_redo/build.mjs');
  }
}
