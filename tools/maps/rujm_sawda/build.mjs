// Rujm Sawda ("the black cairn"): the large 80x80 network map of GH-913 (work package L4).
//
//   node tools/maps/rujm_sawda/build.mjs          writes data/maps/rujm_sawda.json
//                                                  and data/versus/rujm_sawda.json
//   node tools/maps/rujm_sawda/build.mjs --check  writes nothing, exits 1 if either shipped
//                                                  file differs from what this builds
//
// The layout is the lead-approved 40x40 sketch (_coord/net-large-map/sketch.py, 1 character =
// 2x2 tiles), ported cell for cell and then drawn at tile resolution. `cellSketch()` is that port
// and nothing else: tools/src/rujm_sawda.test.ts holds it to sketch.py's own output (kept in
// tools/maps/rujm_sawda/sketch.out), so a drifting port is red rather than a different map.
//
// The LOOK STAGE (GH-913, _coord/rujm-sawda-look/plan.md) then redraws the wadi, the roads and
// the shelf lips PER TILE, on top of the cell upscale. It does not move what they are (the same
// S-curve, three fords, two mesa crossings and shelves); it changes how they are drawn:
//   - the wadi channel is `b`, a cobble and boulder line, not `d` (a dug ditch draws timber trench
//     frames). `b` is mechanically `d` to the byte (blocked 0, boulder 1, cover 0), so nothing in
//     the sim moves with the symbol. There is no `d` on this map any more.
//   - the shelf lips and the wadi banks step ONE TILE per elevation level, where the cell sketch
//     steps 2x2 along a 45-degree line; the renderer's Catmull-Rom turned that staircase into a
//     scalloped contour (0.94 tile of wander against 0.15) and the relief read drew every scallop.
//   - every road is a one-tile chain (corner-touching), which road-graph.ts draws as one line.
//   - landmarks (two sheepfolds, a cistern, the black cairn), scrub patches, knoll outcrops and
//     lone acacia, all drawn on the top half and mirrored with the rest, so fairness is by
//     construction. Every symbol is one the map already used or the map legend already ships.
//
// The map is point-symmetric about (39.5, 39.5): every tile, elevation digit, marker, zone,
// building and tunnel route is the half-turn image (x, y) -> (79 - x, 79 - y) of one on the
// other half. The generator DRAWS the top half (rows 0..39) and writes the bottom half as its
// image, so symmetry is by construction. tools/src/rujm_sawda_verify.ts checks it from the JSON.
//
// What the generator will not do is decide fairness. Seats, purses, rates and tunnel capacities
// are provisional until L5 sweeps them at 96 seeds (docs: _coord/net-large-map/design.md 3.1).
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { halfTurn, halfTurnOf, hash, runCli, serialise, sortedByKey } from '../lib/common.mjs';
import { farmAt, ringTiles, scatterPatches, shelfSteps, stampChain } from '../lib/shapes.mjs';

// The helpers below this line's imports lived in this file until GH-920 B1 (the large-map library,
// tools/maps/lib/). `node tools/maps/rujm_sawda/build.mjs --check` is the witness that moving them
// changed no byte of the shipped map.
export { serialise };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

export const ID = 'rujm_sawda';
export const NAME = 'Rujm Sawda — The Black Cairn';
export const SIZE = 80;
const N = 40; // the sketch's side, in cells

// --- stage 1: the sketch, cell for cell --------------------------------------------------------
// Legend: S seat, C camp, . open, 1 scrub, n knoll, o acacia, r track, d wadi channel (a ditch:
// foot only), b scree (foot only), ^ rock, = low wall, h farmhouse, s shanty, p pump house.
// (`d`, `r` and the sketch's acacia are redrawn by the look stage below; the sketch keeps them.)

/**
 * sketch.py, line for line. `walledFarms: false` leaves the two farms to the tile stage (their
 * walls are one tile thick there, where a cell is two), and `thickRoad: false` is the sketch's
 * own corner-connected diagonal road.
 */
export function cellSketch({ walledFarms = true, thickRoad = false } = {}) {
  const g = Array.from({ length: N }, () => Array(N).fill('.'));
  const e = Array.from({ length: N }, () => Array(N).fill(1));
  const put = (x, y, c, h) => {
    if (x >= 0 && x < N && y >= 0 && y < N) {
      g[y][x] = c;
      if (h !== undefined) e[y][x] = h;
    }
  };
  // the wadi: a meander along the anti-diagonal, channel 'd', bed elevation 0
  const hoff = (x) => Math.round(1.6 * Math.sin((2 * Math.PI * (x - 19.5)) / 26));
  const chan = new Set();
  const key = (x, y) => `${x},${y}`;
  for (let x = 7; x < 33; x++) {
    const y = 39 - x + hoff(x);
    chan.add(key(x, y));
    const y2 = x + 1 < 33 ? 39 - (x + 1) + hoff(x + 1) : null;
    if (y2 !== null) {
      for (let yy = Math.min(y, y2) + 1; yy < Math.max(y, y2); yy++) chan.add(key(x, yy)); // keep it 4-connected
      if (y2 === y + 1 || y2 === y) chan.add(key(x + 1, y)); // a corner-only step: thicken
    }
  }
  const chanCells = [...chan].map((s) => s.split(',').map(Number));
  for (const [x, y] of chanCells) put(x, y, 'd', 0);
  // fords (vehicle crossings): the centre one (road), the inner pair
  const FORDS = [[0, 'r'], [14, '.'], [-14, '.']];
  for (const [x, y] of chanCells) {
    for (const [fu, sym] of FORDS) if (Math.abs(x - y - fu) <= 1) put(x, y, sym, 0);
  }
  // bed margins: low ground either side of the channel, with acacia cover
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (g[y][x] !== '.') continue;
      let dmin = Infinity;
      for (const [cx, cy] of chanCells) dmin = Math.min(dmin, Math.abs(x - cx) + Math.abs(y - cy));
      if (dmin === 1) e[y][x] = 0;
      if (dmin === 1 && (x * 7 + y * 3) % 11 === 0) g[y][x] = 'o';
    }
  }
  // the home shelf (seat 0's corner, NW): elevation 3, rear ridge and boulder flanks
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (x + y <= 20 && g[y][x] === '.') e[y][x] = 3;
      else if (x + y <= 24 && g[y][x] === '.') e[y][x] = 2;
    }
  }
  for (let i = 0; i < 9; i++) {
    put(i, 0, '^', 4);
    put(0, i, '^', 4);
  }
  for (const [x, y] of [[1, 1], [2, 1], [1, 2]]) put(x, y, '^', 4);
  for (const [x, y] of [[13, 1], [14, 1], [14, 2], [1, 13], [1, 14], [2, 14], [12, 2], [2, 12]]) put(x, y, 'b');
  // shelf lip: cover knolls looking down the bank
  for (const [x, y] of [[10, 12], [12, 10], [9, 13], [13, 9], [15, 7], [7, 15]]) put(x, y, 'n', 3);
  // seat, camp
  put(6, 6, 'S');
  put(4, 4, 'C');
  // road: camp -> centre ford along the diagonal, and tracks to the two wells
  for (let t = 5; t < 20; t++) if ('.o'.includes(g[t][t])) put(t, t, 'r');
  for (let x = 7; x < 17; x++) if (g[3][x] === '.') put(x, 3, 'r');
  for (let y = 7; y < 14; y++) if (g[y][3] === '.') put(3, y, 'r');
  // the wells: a walled farm, one house, on its own bank
  const farm = (x0, y0, hx, hy, gates) => {
    for (let x = x0; x < x0 + 4; x++) {
      put(x, y0, '=');
      put(x, y0 + 3, '=');
    }
    for (let y = y0; y < y0 + 4; y++) {
      put(x0, y, '=');
      put(x0 + 3, y, '=');
    }
    for (let x = x0 + 1; x < x0 + 3; x++) for (let y = y0 + 1; y < y0 + 3; y++) put(x, y, '.');
    for (const [gx, gy] of gates) put(gx, gy, '.');
    put(hx, hy, 'h');
  };
  if (walledFarms) {
    farm(17, 2, 19, 3, [[17, 3], [18, 5]]); // north well (seat 0's), toward the NE mesa
    farm(2, 14, 3, 16, [[3, 14], [5, 15]]); // west well (seat 0's), toward the SW mesa
  }
  // the NE mesa (contested flank, on the wadi's NE end): elevation 5, scree faces, two ramps
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x - 35, y - 4);
      if (r <= 3.2 && '.o'.includes(g[y][x])) {
        e[y][x] = 5;
        if ((x + y) % 3 === 0) put(x, y, 'n', 5);
      } else if (r <= 4.9 && '.o'.includes(g[y][x])) {
        e[y][x] = 3;
        put(x, y, 'b', 3); // scree: a wall to wheels
      }
    }
  }
  for (const [x, y] of [[31, 4], [31, 5], [32, 5], [35, 8], [34, 8], [34, 7]]) put(x, y, '.', 4);
  put(35, 4, '^', 6);
  put(36, 4, '^', 6); // the crown
  // the inner tells (contested, near the inner fords): a small crown in a knoll field
  for (const [x, y] of [[23, 12], [24, 12]]) put(x, y, '^', 4);
  for (const [x, y] of [[22, 11], [25, 11], [22, 13], [25, 13], [23, 10], [24, 14]]) if (g[y][x] === '.') put(x, y, 'n', 3);
  // the hamlet at the centre ford (Bir Sawda): single-storey only
  for (const [x, y, c] of [[17, 18, 's'], [16, 17, 's'], [18, 16, 'p']]) put(x, y, c, 1);
  // open plain scrub
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] === '.' && (x * 13 + y * 7) % 23 === 0) put(x, y, '1');
  if (thickRoad) {
    // the diagonal road joined edge to edge, so it reads as a track and not a chain of squares
    for (let t = 5; t < 20; t++) if ('.o'.includes(g[t][t + 1])) put(t + 1, t, 'r');
  }
  // the half-turn: the bottom half is the image of the top half
  for (let y = 20; y < N; y++) {
    for (let x = 0; x < N; x++) {
      g[y][x] = g[39 - y][39 - x];
      e[y][x] = e[39 - y][39 - x];
    }
  }
  return { g, e };
}

// --- stage 2: tiles ----------------------------------------------------------------------------

/** Each seat's opening formation, in tiles: x from -4 to +2, y from -9 to +9 round the seat (see
 *  packages/app/src/net/versus-force.ts), padded by one so nothing is dropped beside it. */
const SEAT0 = [12, 12];
const formationRect = ([sx, sy]) => ({ x0: sx - 5, x1: sx + 3, y0: sy - 10, y1: sy + 10 });

// --- stage 2b: the look stage, per tile ---------------------------------------------------------
// plan.md section 2; proto/look.py is the reference. It works on rows 0..39 and the half-turn
// writes the rest. Two measures: s = x + y - 79 runs across the wadi, v = x - y along it.

const WADI_AMP = 3.2; // tiles; the sketch's S-curve (1.6 cells)
const WADI_PERIOD = 104; // tiles along v
const FORD_V = [0, 27, -27]; // the centre ford and the inner pair, as v = x - y
const WADI_VMAX = 54; // the bed is drawn only where |v| <= this
/** The low-flow line. `b` (a cobble and boulder line) is the lead's ruling D2; set 'd' to get the
 *  timber frames back on the new geometry. They are the same mechanic. */
const CHANNEL = 'b';
const CHANNEL_HALF = 1.0; // at <= 1.0 every channel tile has an orthogonal channel neighbour

/** Across-wadi offset from the centreline, the floor's half-width there, and the along measure. */
function wadiAt(x, y) {
  const s = x + y - 79;
  const v = x - y;
  const c = WADI_AMP * Math.sin((2 * Math.PI * v) / WADI_PERIOD);
  const av = Math.abs(v);
  const w = av <= 34 ? 5.5 : Math.max(2.0, 5.5 - ((av - 34) * 3.5) / 16);
  return { d: s - c, w, v };
}
const inFord = (v, r = 2) => FORD_V.some((f) => Math.abs(v - f) <= r);

/** Every marker and zone the look stage keeps clear, with their twins, as the build will write them. */
function lookKeepClear() {
  const markers = { centre: [39, 39] };
  for (const [a, p, b] of MARKER_PAIRS) {
    markers[a] = p;
    markers[b] = mirror(p);
  }
  const zones = {};
  for (const [a, r, b] of ZONE_PAIRS) {
    zones[a] = r;
    if (b !== null) zones[b] = mirrorRect(r);
  }
  const tunnelPoints = ROUTES_FRIENDLY.flatMap((r) => r.points.flatMap((p) => [p, mirror(p)]));
  return { markers, zones, tunnelPoints };
}

const LOOK_KEEP_ZONES = [
  'well_n_0', 'well_w_0', 'well_s_1', 'well_e_1', 'mesa_ne', 'mesa_sw', 'tell_ne', 'tell_sw', 'home_0', 'home_1',
];

function lookStage(t, el) {
  const T = SIZE;
  const TOP = 40;
  const { markers, zones, tunnelPoints } = lookKeepClear();
  // 1. clear the old wadi, the old roads and the four sketch acacia; the bed floor is level 1 for now
  for (let y = 0; y < TOP; y++) {
    for (let x = 0; x < T; x++) {
      if ('dro'.includes(t[y][x])) t[y][x] = '.';
      if (el[y][x] === 0) el[y][x] = 1;
    }
  }
  // 2. the shelves, one tile a step: 3 to x+y 41, 2 to 49, then 1; never under rock or a knoll
  shelfSteps(t, el, TOP, T, { reach: 52, bands: [[41, 3], [49, 2]], rest: 1, skip: '^n' });
  // 3. the wadi: the floor at level 0, the low-flow line, and a five-tile gap at each ford
  for (let y = 0; y < TOP; y++) {
    for (let x = 0; x < T; x++) {
      const { d, w, v } = wadiAt(x, y);
      if (!'.1'.includes(t[y][x]) || el[y][x] > 1 || Math.abs(v) > WADI_VMAX) continue;
      if (Math.abs(d) <= w) el[y][x] = 0;
      if (Math.abs(d) <= CHANNEL_HALF && !inFord(v)) t[y][x] = CHANNEL;
    }
  }
  // 4. roads, all one tile wide: the main diagonal, a spur to each well, a track over each inner ford
  const road = [];
  for (let k = 10; k < 40; k++) road.push([k, k]);
  for (let k = 1; k < 6; k++) road.push([12 + k, 12 - k]);
  for (let x = 18; x < 34; x++) road.push([x, 7]);
  for (let k = 1; k < 6; k++) road.push([12 - k, 12 + k]);
  for (let y = 18; y < 28; y++) road.push([7, y]);
  const [fx, fy] = markers.ford_ne;
  for (let k = -3; k < 7; k++) road.push([fx + k, fy + k]);
  stampChain(t, road, 'r', '.1');
  // keep-clear for everything drawn below
  const [sx, sy] = markers.versus_0;
  const form = formationRect([sx, sy]);
  const inRect = ([rx, ry, rw, rh], x, y) => x >= rx - 1 && x < rx + rw + 1 && y >= ry - 1 && y < ry + rh + 1;
  const clear = (x, y) => {
    if (x >= form.x0 - 1 && x <= form.x1 + 1 && y >= form.y0 - 1 && y <= form.y1 + 1) return false;
    for (const [rx, ry] of road) if (Math.max(Math.abs(rx - x), Math.abs(ry - y)) <= 1) return false;
    for (const [mx, my] of Object.values(markers)) if (Math.max(Math.abs(mx - x), Math.abs(my - y)) <= 1) return false;
    for (const [tx, ty] of tunnelPoints) if (Math.max(Math.abs(tx - x), Math.abs(ty - y)) <= 2) return false;
    for (const f of ['ford_ne', 'ford_sw', 'centre']) {
      const [mx, my] = markers[f];
      if (Math.max(Math.abs(mx - x), Math.abs(my - y)) <= 4) return false;
    }
    for (const z of LOOK_KEEP_ZONES) if (inRect(zones[z], x, y)) return false;
    return true;
  };
  const put = (x, y, c, e, need = '.') => {
    if (!need.includes(t[y][x]) || !clear(x, y)) return false;
    t[y][x] = c;
    if (e !== undefined) el[y][x] = e;
    return true;
  };
  // 5. the wadi dressed: acacia along the bank lip, scrub on the floor
  for (let y = 0; y < TOP; y++) {
    for (let x = 0; x < T; x++) {
      const { d, w, v } = wadiAt(x, y);
      if (Math.abs(v) > 46 || inFord(v, 4)) continue;
      const ad = Math.abs(d);
      if (ad > w - 0.5 && ad <= w + 1.0 && hash(x, y, 3) % 3 === 0) put(x, y, 'o');
      else if (ad > 1.25 && ad <= w - 0.5 && hash(x, y, 4) % 9 === 0) put(x, y, '1');
    }
  }
  // 6. landmarks, all low, each with a twin: two sheepfolds, a cistern, the black cairn
  const fold = (x0, y0, w, h, gaps) => {
    const ring = ringTiles(x0, y0, w, h);
    if (!ring.every(([x, y]) => '.12'.includes(t[y][x]) && clear(x, y))) throw new Error(`look stage: sheepfold ${x0},${y0} blocked`);
    for (const [x, y] of ring) if (!gaps.some(([gx, gy]) => gx === x && gy === y)) t[y][x] = '=';
  };
  fold(22, 32, 5, 4, [[24, 32], [24, 35]]);
  fold(64, 29, 5, 4, [[66, 29], [66, 32]]);
  for (const [x0, y0] of [[16, 37]]) {
    const tiles = [[x0, y0], [x0 + 1, y0], [x0, y0 + 1], [x0 + 1, y0 + 1]];
    if (!tiles.every(([x, y]) => '.12'.includes(t[y][x]) && clear(x, y))) throw new Error(`look stage: cistern ${x0},${y0} blocked`);
    for (const [x, y] of tiles) t[y][x] = 'p';
  }
  {
    // the black cairn: a 2x2 rock crown on a shoulder of knoll and scrub one tile wide. 2x2 and
    // not 2x1 so the shape is symmetric about the seat axis and does not skew the relief census.
    const cairn = [[57, 16], [58, 16], [57, 17], [58, 17]];
    if (!cairn.every(([x, y]) => '.12'.includes(t[y][x]) && clear(x, y))) throw new Error('look stage: the cairn is blocked');
    const lv = Math.max(...cairn.map(([x, y]) => el[y][x])) + 1;
    for (const [x, y] of cairn) {
      t[y][x] = '^';
      el[y][x] = lv;
    }
    const isCairn = (x, y) => cairn.some(([cx, cy]) => cx === x && cy === y);
    for (const [cx, cy] of cairn) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = cx + dx;
          const qy = cy + dy;
          if (!'.12'.includes(t[qy][qx]) || isCairn(qx, qy)) continue;
          t[qy][qx] = hash(qx, qy, 9) % 2 ? 'n' : '1';
          el[qy][qx] = lv;
        }
      }
    }
  }
  // 7. the plain: scrub patches (the centre tile is cover 2), knoll outcrops, lone acacia
  const PATCHES = [
    [20, 35], [28, 31], [36, 21], [44, 13], [52, 12], [24, 26], [58, 30],
    [66, 25], [56, 37], [64, 35], [73, 31], [75, 22], [47, 4], [30, 15],
  ];
  scatterPatches(put, hash, PATCHES, { radius: 2.6, salt: 5, rows: TOP, symbol: '1', centreSymbol: '2' });
  const KNOLLS = [[[41, 30], [42, 30], [41, 31]], [[60, 21], [61, 21], [60, 22]]]; // L shapes, symmetric under transpose
  for (const k of KNOLLS) for (const [x, y] of k) put(x, y, 'n', 2, '.12');
  for (const [x, y] of [[33, 27], [17, 30], [50, 18], [70, 28], [62, 38]]) put(x, y, 'o', undefined, '.12');
}

export function tileMap() {
  const { g, e } = cellSketch({ walledFarms: false, thickRoad: true });
  const T = SIZE;
  const t = Array.from({ length: T }, () => Array(T).fill('.'));
  const el = Array.from({ length: T }, () => Array(T).fill(1));
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      const c = g[cy][cx];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) el[2 * cy + dy][2 * cx + dx] = e[cy][cx];
      if ('^bdnrsp'.includes(c)) {
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) t[2 * cy + dy][2 * cx + dx] = c;
      } else if (c === '1' || c === 'o') {
        // one tile of scrub or acacia somewhere in the cell, not a 2x2 block of it
        const h = hash(cx, cy, 1);
        t[2 * cy + (h & 1)][2 * cx + ((h >> 1) & 1)] = c;
      }
      // S, C, '.', and any wall or house the sketch drew: open ground here
    }
  }
  // the two walled wells of seat 0 (the other two are their half-turn images)
  farmAt(t, 34, 4, [38, 6], [[34, 6], [34, 7], [36, 11], [37, 11]]); // well_n_0, gate west and south
  farmAt(t, 4, 28, [6, 32], [[6, 28], [7, 28], [11, 30], [11, 31]]); // well_w_0, gate north and east
  // a little plain scrub on top of the sketch's, off the formation grounds and the road
  const keepClear = [formationRect(SEAT0)];
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < T; x++) {
      if (t[y][x] !== '.' || hash(x, y, 2) % 41 !== 0) continue;
      if (keepClear.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)) continue;
      if (el[y][x] === 0) continue;
      t[y][x] = '1';
    }
  }
  lookStage(t, el);
  // the half-turn, again, at tile resolution
  halfTurn(t, el, T);
  return { t, el };
}

// --- stage 3: markers, zones, rules ------------------------------------------------------------
const { mirror, mirrorRect } = halfTurnOf(SIZE);

/** [name, tile, twin's name]. A twin's name is its own: well_n_0 faces well_s_1.
 *  Three tiles differ from design.md 6.2, which put them on ground nothing can stand on: the
 *  well's marker was a farmhouse tile (38,7) and is now (37,8) inside the yard; the tell's was
 *  the crown rock (47,24) and is now (47,26) on its forward side; the mesa's was the crown rock
 *  (70,8) and is now (70,10) just south of it. rujm_sawda_verify.ts refuses a marker on a blocked tile. */
const MARKER_PAIRS = [
  ['versus_0', [12, 12], 'versus_1'],
  ['ford_ne', [54, 27], 'ford_sw'],
  ['tell_ne', [47, 26], 'tell_sw'],
  ['mesa_ne', [70, 10], 'mesa_sw'],
  ['ramp_ne_w', [62, 9], 'ramp_sw_e'],
  ['ramp_ne_s', [69, 15], 'ramp_sw_n'],
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
];
/** Income a minute: 360 in all. The values are provisional until L5's sweeps. */
const RATES = {
  home_0: 20, home_1: 20,
  well_n_0: 30, well_w_0: 30, well_s_1: 30, well_e_1: 30,
  tell_ne: 30, tell_sw: 30,
  mesa_ne: 40, mesa_sw: 40,
  centre: 60,
};

/** Seat 0's three routes (mouth first, vent last); seat 1's are their half-turn images. */
const ROUTES_FRIENDLY = [
  { id: 'rs_f_well', points: [[19, 10], [27, 9], [32, 8]], capacity: 2 },
  { id: 'rs_f_tell', points: [[20, 21], [31, 23], [41, 24]], capacity: 2 },
  { id: 'rs_f_centre', points: [[21, 17], [28, 26], [34, 31]], capacity: 2 },
];

export function build() {
  const { t, el } = tileMap();
  const markers = { centre: [39, 39] };
  for (const [a, p, b] of MARKER_PAIRS) {
    markers[a] = p;
    markers[b] = mirror(p);
  }
  const zones = {};
  for (const [a, r, b] of ZONE_PAIRS) {
    zones[a] = r;
    if (b !== null) zones[b] = mirrorRect(r);
  }
  const map = {
    id: ID,
    name: NAME,
    width: SIZE,
    height: SIZE,
    terrain: 'arid',
    // GH-1226: the node renderer's ground blend draws limestone, and the Black Desert is basalt (decision 2). Presentation only.
    ground_blend: false,
    markers: sortedByKey(markers),
    zones: sortedByKey(zones),
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

export const MAP_PATH = join(ROOT, 'data', 'maps', `${ID}.json`);
export const VERSUS_PATH = join(ROOT, 'data', 'versus', `${ID}.json`);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { map, versus } = build();
  runCli(process.argv, [[MAP_PATH, serialise(map)], [VERSUS_PATH, serialise(versus)]], 'tools/maps/rujm_sawda/build.mjs');
}
