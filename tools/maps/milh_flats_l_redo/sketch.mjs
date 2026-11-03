// Milh Flats (large): the 48-cell sketch of the REDO (GH-974).
//
// The first build (GH-920 B3) read the shipped 48x48 map, data/maps/milh_flats.json, whole, and redrew its lines one tile
// per step. The redo keeps that map's SKELETON and nothing more, so the offered 48x48 never moves (design decision 1):
//   - the two corner boulder masses (north-west and, by the half-turn, south-east);
//   - the two tells: the rock crown (re-placed at its native four tiles by the generator) and the relief of the hill
//     (levels 3 to 5), now with OPEN slopes (the `n` cover-2 field of the original is dropped, the design's principle 6:
//     a tell's slopes are bare and cost climb, its crown splits its view);
//   - the seat plateau (level 3, where each seat stands);
//   - the original's scrub, acacia and cover-2 cells where the redo does not draw over them.
// Everything else is dropped here and drawn by the generator, one tile at a time: the old hamlet, its walls, ditch, roads
// and the mid-map boulder fields (replaced by the wadis, the town and the roads), and the shallow depressions (the level
// is 2 everywhere but under the tells and the plateau; the wadi beds are cut to 0 by the generator).
//
// Only the top half of the sketch (cell rows 0..23) matters: the generator writes the bottom half as the half-turn.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCE_ID = 'milh_flats';
export const SOURCE_PATH = join(HERE, '..', '..', '..', 'data', 'maps', `${SOURCE_ID}.json`);
export const N = 48; // the sketch's side, in cells

/** Cell boxes [x0, y0, x1, y1] (inclusive) whose relief the redo keeps: the north-west tell hill and the north-east seat
 *  plateau. The bottom half is their half-turn. Every other cell is level 2. */
export const KEPT_RELIEF = [
  [6, 5, 16, 16], // the tell: cells 7..15 by 6..15 carry levels 3 to 5, with the interpolation's one-cell skirt
  [31, 3, 43, 14], // the plateau under the north-east seat
];
/** The level of every cell outside KEPT_RELIEF, and the level the wadi beds are cut from. */
export const PLAIN = 2;

export function loadSource() {
  const json = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
  if (json.width !== N || json.height !== N) throw new Error(`${SOURCE_ID} is ${json.width}x${json.height}, not ${N}x${N}`);
  return json;
}

/** The cells of the `b` masses that touch the north-west or the south-east corner cell: the corner boulder fields. */
function cornerBoulders(rows) {
  const keep = new Uint8Array(N * N);
  for (const [sx, sy] of [[0, 0], [N - 1, N - 1]]) {
    const st = [[sx, sy]];
    if (rows[sy][sx] !== 'b') continue;
    keep[sy * N + sx] = 1;
    while (st.length) {
      const [x, y] = st.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || keep[ny * N + nx] || rows[ny][nx] !== 'b') continue;
        keep[ny * N + nx] = 1;
        st.push([nx, ny]);
      }
    }
  }
  return keep;
}

/** The sketch: { json, rows, elev } with rows as arrays of characters and elev as numbers, 48 by 48. */
export function sketch() {
  const json = loadSource();
  const rows = json.rows.map((r) => [...r]);
  const elev = json.elevation.map((r) => [...r].map(Number));
  const corner = cornerBoulders(rows);
  const inRelief = (x, y) => KEPT_RELIEF.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = rows[y][x];
      if ('hs#=dr'.includes(c)) rows[y][x] = '.'; // the hamlet, its walls, its ditch and the old roads
      else if (c === 'b' && !corner[y * N + x]) rows[y][x] = '.'; // the mid-map boulder fields
      else if (c === 'n') rows[y][x] = '.'; // a tell's slope is bare; the crown ring is the generator's
      // the relief: the tell and the plateau stay, everything else is plain
      if (!inRelief(x, y) && !inRelief(N - 1 - x, N - 1 - y)) elev[y][x] = PLAIN;
    }
  }
  return { json, rows, elev };
}
