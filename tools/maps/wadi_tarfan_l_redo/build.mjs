// Wadi Tarfan (large), REDONE (GH-974): the 96x96 faction map with a plan in it. STAGED, NOT OFFERED.
//
//   node tools/maps/wadi_tarfan_l_redo/build.mjs          writes docs/campaign/staged_maps/wadi_tarfan_l_redo/map.json
//                                                          and .../versus.json
//   node tools/maps/wadi_tarfan_l_redo/build.mjs --check  writes nothing, exits 1 if either staged
//                                                          file differs from what this builds
//   node tools/maps/wadi_tarfan_l_redo/build.mjs --print  draws the map (--print-elev: its relief)
//
// The lead's feedback of 3 Nov (GH-974): few obstacles, houses and roads forced a strategy, so most matches were an all-in
// fight. The design is _coord/versus-maps-design/design.md; this is the third map built on it (Milh Flats (large), PR 996,
// and Rujm Sawda, PR 1010, came first), and the one the design singles out: here the income makes a town pay, and it has the
// most fairness to lose (PRs 949, 953 and 957 found it chaotic per tile). The shipped map is a 2x upscale of Wadi Tarfan; this
// one is drawn on the 96x96 grid, as the Rujm Sawda redo is, and it keeps the shipped map's SKELETON:
//
//   KEPT (same places, same names): the seats (20,20) and (75,75) on the main diagonal, 77.8 tiles apart; the camps; the wadi
//   along the anti-diagonal x + y = 95 with the centre ford and the NE and SW fords; the bluffs and the farms of each bank; the
//   economy (eleven income zones, 300 a minute, two tunnel routes an end, capacity 3, the shipped vents) because a KDF v Sarim
//   room reads it.
//
//   CHANGED, one line of the design each:
//   1. THE WADI IS A LANE. Its bed is five tiles of scree (`b`: foot only, open to sight, no cover) at level 0 on a plain at
//      level 2, so every bank is a 2-LEVEL CLIFF and a rifleman in the bed is hidden from the plain (the shipped bed was a
//      gentle dip with a ditch in it, and the ditch is 38,240 triangles a tile). It runs from the top edge to the bottom edge, so the
//      three fords are the only way across for anything on wheels and there is no mesa to close it.
//   2. THE TOWN. Tarfan is four walled yards round the centre ford, two on each bank, set back from the main road and leaning
//      on the ford: a shed and a two-floor house in the yard on one side of the road, a shed and a pump house on the other.
//      The shipped centre ford had two pump houses and a ditch.
//   3. THE TOWN PAYS. The centre ford is the income zone that holds the town's court, and it pays the most: 80 a minute, where
//      each of the two outer fords pays 30 (the shipped map paid 60 and 40 and 40). The total is still 300.
//   4. THE BLUFFS are stepped hills with BARE slopes (one level a tile on a 45-degree line, so no 2x2 staircase) and a crown of
//      rock ringed by knoll: a tell that looks over the near ford and into the enemy wadi. The shipped bluffs were fields of
//      boulder with a knoll fringe.
//   5. THE FARMS are walled yards with one one-floor shed (the shipped farms had two houses and read 90% visible against the
//      92% scoring cap); the far farms stand three tiles further from the wadi, off its lip, and the near one two tiles off the scree.
//   6. COVER BELTS on the foot routes (scrub and acacia along the cliff lip and the flanks), never cover 3; the armour lane (the
//      main road and the ford tracks, with a boulder funnel either side) is bare.
//   7. EVERYTHING IS COUNTED IN TRIANGLES (tools/src/map_triangles.ts). PR 1001 showed the cost of a town is triangles, not draw
//      calls: a wall tile is 3,087, a house 39,016, each drawn in three passes, a ditch tile 38,240. The plan is drawn to fit
//      the budget from the start: no ditch, no concrete, two houses in the whole map, one-floor sheds in the farms.
//      large_map_verify.ts holds the bill (`LargeMapSpec.triangles`): no 48x48 window draws more structure triangles in a pass
//      than the whole of the 48x48 control map.
//
// The map is point-symmetric about (47.5, 47.5): every feature is written with its half-turn image (`both`), so symmetry is by
// construction. tools/src/large_map_verify.ts checks it from the JSON.
//
// What the generator will not do is decide fairness. B4 (versus:probe, mirror, KDF v Sarim, economy, tunnels) reads it once.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { halfTurnOf, hash, runCli, serialise, sortedByKey } from '../lib/common.mjs';
import { ringTiles, scatterPatches, stampChain } from '../lib/shapes.mjs';

export { serialise };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

export const ID = 'wadi_tarfan_l';
export const NAME = 'Wadi Tarfan (large) — The Three Fords';
export const SIZE = 96;

export const STAGED = join(ROOT, 'docs', 'campaign', 'staged_maps', 'wadi_tarfan_l_redo');
export const MAP_PATH = join(STAGED, 'map.json');
export const VERSUS_PATH = join(STAGED, 'versus.json');

const { mirror, mirrorRect } = halfTurnOf(SIZE);

/** The level of the open plain (the shipped map's bed sat in a gentle dip: a one-level dip hides nothing). */
export const PLAIN = 2;
/** The level of the home shelf, where x + y <= SHELF_REACH (seat 0's corner; seat 1's is its half-turn). */
export const SHELF = 3;
export const SHELF_REACH = 58;

// --- the wadi -----------------------------------------------------------------------------------------------------------
export const WADI = {
  /** The S-curve's amplitude (tiles) and period along v = x - y. */
  amp: 3.8,
  period: 124,
  /** The fords as v = x - y: the centre one and the two outer ones; each is a gap of five v-values. */
  fords: [0, 42, -42],
  fordHalf: 2,
  /** The bed is `2 * bedHalf + 1` tiles across a row. It runs from the top edge to the bottom edge. */
  bedHalf: 2,
};

/** The offset s of the bed's centre line from x + y = 95 at a given v, a whole number of tiles. */
export const bedCentre = (v) => Math.round(WADI.amp * Math.sin((2 * Math.PI * v) / WADI.period));

// --- the bluffs ----------------------------------------------------------------------------------------------------------
/**
 * A crown is a rectangle of rock; everything round it is read by the Manhattan distance from that rectangle. The top-half
 * member of each pair: `bluff_far_0` over the NE ford, `bluff_near_0` on the west flank. Each crown stands one row above its
 * marker, which is therefore on the ring of knoll that faces the enemy.
 */
export const BLUFF = { hill: 3, crowns: { bluff_far_0: [62, 12, 4, 2], bluff_near_0: [26, 42, 4, 2] } };
const dist = ([x0, y0, w, h], x, y) => Math.max(x0 - x, 0, x - (x0 + w - 1)) + Math.max(y0 - y, 0, y - (y0 + h - 1));

// --- the town and the farms ----------------------------------------------------------------------------------------------
/**
 * Tarfan: four walled yards round the centre ford. A and B are seat 0's (A north-east of the road, B south-west, the transpose
 * of A's footprint); A' and B' are their half-turns. Every yard is a six-tile ring with two two-tile gates facing the road. A
 * holds the two-floor house, on the lip over the ford, and a shed; B a shed and a pump house.
 */
export const YARDS = {
  A: { x0: 45, y0: 35, gates: [[46, 40], [47, 40], [45, 38], [45, 39]], house: [48, 38], sheds: [[46, 36, 2, 1]], pump: null },
  B: { x0: 35, y0: 45, gates: [[40, 46], [40, 47], [38, 45], [39, 45]], house: null, sheds: [[36, 46, 1, 2]], pump: [38, 48] },
};
/** The zone the visibility gate holds to a town's share (85%) and a building share (25%): all four yards. */
export const TOWN_ZONE = [35, 35, 26, 26];

/**
 * The farms of the top half: a six-tile walled yard, two two-tile gates, one one-floor shed. `farm_near_0` is seat 0's, on its
 * NE road side; `farm_far_1` is seat 1's, in the NE corner beyond the wadi (its twin `farm_far_0`, seat 0's, is in the SW
 * corner). Each holds its marker inside, and its walls stand two tiles off the bed's scree at least.
 */
export const FARMS = {
  farm_near_0: { x0: 53, y0: 30, gates: [[53, 32], [53, 33], [55, 35], [56, 35]], shed: [54, 31, 2, 1] },
  farm_far_1: { x0: 82, y0: 18, gates: [[83, 23], [84, 23], [87, 20], [87, 21]], shed: [83, 19, 2, 1] },
};

/**
 * The sheepfolds of the top half, [x0, y0, w, h, gaps]: a five-by-four ring with a gap in each long side. Low walls (cover 2 for a
 * man hugging one, no sight blocked) on the foot lanes of each flank, ahead of the bluff. The second is the first's transpose.
 */
export const FOLDS = [
  [46, 22, 5, 4, [[48, 22], [48, 25]]],
  [22, 46, 4, 5, [[22, 48], [25, 48]]],
];

/** The boulder strips beside the main road: |x - y| in `core` (and one fringe tile either side) for x + y in [from, to]. */
export const FUNNEL = { core: [7, 8], from: 59, to: 76 };

// --- cover ---------------------------------------------------------------------------------------------------------------
/** The lattice of the scrub belts (top half; the twins are the half-turn): a patch every STEP tiles, jittered by the hash. */
export const BELTS = { stepX: 8, stepY: 8, x0: 4, y0: 4, jitter: 5, minOpen: 12 };
/** The armour lane: no cover where |x - y| is under this and the ground is past the shelf. */
export const LANE_HALF = 11;
const KNOLLS = [[[60, 29], [61, 29], [60, 30]], [[78, 40], [79, 40], [78, 41]]];
const ACACIA = [[22, 42], [66, 6], [84, 36], [31, 52]];

const inFord = (v, r) => WADI.fords.some((f) => Math.abs(v - f) <= r);

/** Seat 0's two tunnel routes (mouth first, vent last); seat 1's are their half-turn images. The shipped map's. */
const ROUTES_FRIENDLY = [
  { id: 'wtl_f_north', points: [[25, 23], [32, 28], [45, 43]], capacity: 3 },
  { id: 'wtl_f_west', points: [[23, 25], [26, 31], [42, 45]], capacity: 3 },
];

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

  // 2. the funnel: two jagged strips of boulder (a wall to wheels and tracks, open ground to a man on foot: no cover, no
  // sight-blocking) run beside the main road either side, from the shelf's lip to the town. The core two tiles are unbroken;
  // the fringe is a hash. Armour on the centre road is committed to the gauntlet; infantry walk over the strips.
  for (let y = 0; y < T / 2; y++) {
    for (let x = 0; x < T; x++) {
      const v = Math.abs(x - y);
      const sum = x + y;
      if (sum < FUNNEL.from || sum > FUNNEL.to) continue;
      if (v === FUNNEL.core[0] || v === FUNNEL.core[1] || ((v === FUNNEL.core[0] - 1 || v === FUNNEL.core[1] + 1) && hash(x, y, 11) % 3 === 0)) both(x, y, 'b');
    }
  }

  // 3. the bluffs: a hill of bare slopes, a crown of rock and a ring of knoll
  for (const crown of Object.values(BLUFF.crowns)) {
    const [x0, y0, w, h] = crown;
    for (let y = y0 - BLUFF.hill; y < y0 + h + BLUFF.hill; y++) {
      for (let x = x0 - BLUFF.hill; x < x0 + w + BLUFF.hill; x++) {
        const d = dist(crown, x, y);
        if (d > BLUFF.hill) continue;
        // 5 on the crown, 4 on the ring of knoll, 3 on the next two steps, then the plain (2)
        both(x, y, d === 0 ? '^' : d === 1 ? 'n' : '.', d === 0 ? 5 : Math.max(PLAIN + 1, 5 - d));
      }
    }
  }

  // 4. the wadi: a scree bed at level 0 from edge to edge, a gap and a one-level ramp tile each side at the three fords
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const v = x - y;
      const s = x + y - (T - 1);
      const off = Math.abs(s - bedCentre(v));
      const ford = inFord(v, WADI.fordHalf);
      if (off <= WADI.bedHalf) both(x, y, ford ? '.' : 'b', 0);
      else if (off === WADI.bedHalf + 1 && ford) both(x, y, '.', 1);
    }
  }

  // 5. roads, one tile wide: the main diagonal from the camp across the town and the centre ford, and a track over each outer ford
  const road = [];
  for (let k = 18; k < 48; k++) road.push([k, k]);
  const bedAt = (v) => (T - 1 + bedCentre(v) + v) / 2; // x of the bed's centre line on the diagonal v
  for (const f of WADI.fords.filter((f) => f > 0)) {
    // the track runs along the ford's own v, through the bed's centre, 8 tiles either side
    const x = Math.round(bedAt(f));
    for (let k = -8; k <= 8; k++) road.push([x + k, x + k - f]);
  }

  // 6. the town's four yards and the farms (walled yards with one shed)
  const yard = (x0, y0, size, gates) => {
    for (const [x, y] of ringTiles(x0, y0, size, size)) both(x, y, '=');
    for (let y = y0 + 1; y < y0 + size - 1; y++) for (let x = x0 + 1; x < x0 + size - 1; x++) both(x, y, '.');
    for (const [gx, gy] of gates) both(gx, gy, '.');
  };
  for (const y of Object.values(YARDS)) {
    yard(y.x0, y.y0, 6, y.gates);
    if (y.house) block(y.house[0], y.house[1], 2, 2, 'h');
    for (const [x, yy, w, h] of y.sheds) block(x, yy, w, h, 's');
    if (y.pump) block(y.pump[0], y.pump[1], 2, 2, 'p');
  }
  for (const f of Object.values(FARMS)) {
    yard(f.x0, f.y0, 6, f.gates);
    block(f.shed[0], f.shed[1], f.shed[2], f.shed[3], 's');
  }
  // 6b. landmarks, all low: the sheepfolds
  for (const [x0, y0, w, h, gaps] of FOLDS) {
    for (const [x, y] of ringTiles(x0, y0, w, h)) if (!gaps.some(([gx, gy]) => gx === x && gy === y)) both(x, y, '=');
  }
  // the roads go down last-but-cover: they refuse to land on a wall or a rock
  stampChain(t, road.flatMap(([x, y]) => (inMap(x, y) ? [[x, y]] : [])), 'r', '.1', 'road');
  for (const [x, y] of road) if (inMap(x, y)) both(x, y, 'r');

  // 7. cover: acacia along the cliff lip, scrub patches on the flanks, knoll outcrops, lone acacia
  const markers = markerTable();
  const zones = zoneTable();
  const tunnelPoints = ROUTES_FRIENDLY.flatMap((r) => r.points.flatMap((p) => [p, mirror(p)]));
  const seat = markers.versus_0;
  const form = { x0: seat[0] - 5, x1: seat[0] + 3, y0: seat[1] - 10, y1: seat[1] + 10 };
  const yards = [
    ...Object.values(YARDS).flatMap((y) => [[y.x0, y.y0], mirror([y.x0 + 5, y.y0 + 5])]),
    ...Object.values(FARMS).flatMap((f) => [[f.x0, f.y0], mirror([f.x0 + 5, f.y0 + 5])]),
  ];
  const folds = FOLDS.flatMap(([x, y, w, h]) => [[x, y, w, h], [...mirror([x + w - 1, y + h - 1]), w, h]]);
  const slopes = Object.values(BLUFF.crowns).flatMap(([x, y, w, h]) => {
    const r = [x - BLUFF.hill - 1, y - BLUFF.hill - 1, w + 2 * BLUFF.hill + 2, h + 2 * BLUFF.hill + 2];
    return [r, mirrorRect(r)];
  });
  const clear = (x, y) => {
    // the inside of a yard is the yard's: its shed, house or pump, and nothing grown
    if (yards.some(([yx, yy]) => x >= yx && x < yx + 6 && y >= yy && y < yy + 6)) return false;
    if (folds.some(([fx, fy, fw, fh]) => x >= fx && x < fx + fw && y >= fy && y < fy + fh)) return false;
    if (x >= form.x0 - 1 && x <= form.x1 + 1 && y >= form.y0 - 1 && y <= form.y1 + 1) return false;
    for (const [rx, ry] of road) if (Math.max(Math.abs(rx - x), Math.abs(ry - y)) <= 1) return false;
    for (const [mx2, my2] of Object.values(markers)) if (Math.max(Math.abs(mx2 - x), Math.abs(my2 - y)) <= 1) return false;
    for (const [tx, ty] of tunnelPoints) if (Math.max(Math.abs(tx - x), Math.abs(ty - y)) <= 2) return false;
    for (const f of ['ne_ford', 'sw_ford', 'centre', 'centre_ford']) {
      const [fx, fy] = markers[f];
      if (Math.max(Math.abs(fx - x), Math.abs(fy - y)) <= 4) return false;
    }
    for (const [rx, ry, rw, rh] of slopes) if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) return false;
    for (const z of KEEP_CLEAR_ZONES) {
      const [rx, ry, rw, rh] = zones[z];
      if (x >= rx - 1 && x < rx + rw + 1 && y >= ry - 1 && y < ry + rh + 1) return false;
    }
    // the armour lane is bare: the road's corridor from the shelf's lip to the lip of its twin
    if (Math.abs(x - y) < LANE_HALF && x + y > SHELF_REACH && x + y < 2 * (T - 1) - SHELF_REACH) return false;
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
      if (inFord(v, 5) || y >= T / 2) continue;
      const off = Math.abs(s - bedCentre(v));
      if (off >= WADI.bedHalf + 2 && off <= WADI.bedHalf + 3 && hash(x, y, 3) % 3 === 0) put(x, y, 'o');
    }
  }
  // scrub belts on a jittered lattice, where the ground is open
  const patches = [];
  for (let gy = BELTS.y0; gy < T / 2; gy += BELTS.stepY) {
    for (let gx = BELTS.x0; gx < T - 2; gx += BELTS.stepX) {
      const cx = gx + (hash(gx, gy, 6) % BELTS.jitter) - 2;
      const cy = gy + (hash(gx, gy, 7) % BELTS.jitter) - 2;
      let open = 0;
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) if (inMap(x, y) && t[y][x] === '.' && clear(x, y)) open++;
      if (open >= BELTS.minOpen) patches.push([cx, cy]);
    }
  }
  scatterPatches(
    (x, y, c) => {
      if (inMap(x, y)) put(x, y, c);
    },
    hash,
    patches,
    { radius: 2.6, salt: 5, rows: T / 2, symbol: '1', centreSymbol: '2' },
  );
  for (const k of KNOLLS) for (const [x, y] of k) put(x, y, 'n', PLAIN + 1, '.12');
  for (const [x, y] of ACACIA) put(x, y, 'o', undefined, '.12');
  return { t, el, road, patches };
}

// --- markers, zones, rules -----------------------------------------------------------------------------------------------
/** [name, tile, twin's name]. A twin's name is its own: bluff_near_0 faces bluff_near_1. */
const MARKER_PAIRS = [
  ['versus_0', [20, 20], 'versus_1'],
  ['centre', [46, 46], 'centre_ford'],
  ['ne_ford', [68, 26], 'sw_ford'],
  ['bluff_near_0', [28, 44], 'bluff_near_1'],
  ['bluff_far_0', [64, 14], 'bluff_far_1'],
  ['farm_near_0', [54, 34], 'farm_near_1'],
  ['farm_far_1', [85, 21], 'farm_far_0'],
];
/** [name, rect, twin's name]; a null twin is its own twin. */
const ZONE_PAIRS = [
  ['camp_0', [10, 2, 20, 38], 'camp_1'],
  ['centre_ford', [44, 44, 8, 8], null],
  ['ne_ford', [65, 23, 7, 7], 'sw_ford'],
  ['bluff_near_0', [25, 41, 7, 7], 'bluff_near_1'],
  ['bluff_far_0', [61, 11, 7, 7], 'bluff_far_1'],
  ['farm_near_0', [53, 30, 7, 7], 'farm_near_1'],
  ['farm_far_1', [82, 18, 7, 7], 'farm_far_0'],
  ['town', TOWN_ZONE, null],
];
/** Zones the cover scatter keeps clear: the farms, the bluffs and the camps (the town is kept clear by its yards). */
const KEEP_CLEAR_ZONES = ['farm_near_0', 'farm_near_1', 'farm_far_0', 'farm_far_1', 'bluff_near_0', 'bluff_near_1', 'bluff_far_0', 'bluff_far_1'];

function markerTable() {
  const markers = {};
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

/** Income a minute: 300 in all, as the shipped map. The town's court pays the most (80), each outer ford 30 (was 60 / 40 / 40). */
export const RATES = {
  centre_ford: 80,
  ne_ford: 30,
  sw_ford: 30,
  bluff_near_0: 20, bluff_near_1: 20, bluff_far_0: 20, bluff_far_1: 20,
  farm_near_0: 20, farm_near_1: 20, farm_far_0: 20, farm_far_1: 20,
};

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

export function build() {
  const { t, el } = tileMap();
  const friendly = ROUTES_FRIENDLY.map((r) => ({
    ...r,
    points: r.points.map((p, i) => (i === 0 || i === r.points.length - 1 ? nearestOpen(t, p, `route ${r.id}`) : p)),
  }));
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
  const camp = [17, 17];
  const versus = {
    id: ID,
    map: ID,
    // GH-920 B3: a 96x96 room holds 512 entities and plays to 35 minutes, as Rujm Sawda's does.
    capacity: 512,
    cap_minutes: 35,
    ends: {
      friendly: { camp: { at: camp, size: [2, 2] } },
      hostile: { camp: { at: mirrorRect([...camp, 2, 2]).slice(0, 2), size: [2, 2] } },
    },
    tunnels: {
      friendly,
      hostile: friendly.map((r) => ({ id: r.id.replace('_f_', '_h_'), points: r.points.map(mirror), capacity: r.capacity })),
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
    runCli(process.argv, [[MAP_PATH, serialise(map)], [VERSUS_PATH, serialise(versus)]], 'tools/maps/wadi_tarfan_l_redo/build.mjs');
  }
}
