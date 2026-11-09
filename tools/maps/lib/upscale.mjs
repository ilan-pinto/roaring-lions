// The 2x upscale stages of the large-map library (GH-920 B1; design: _coord/bigger-maps/design.md 3).
//
// A shipped 48x48 map is a 48-cell sketch, and 2x2 tiles per cell make 96x96. A naive nearest copy
// is what the lead rejected on sight for Rujm Sawda (wavy contours, a zig-zag road), and it is the
// census of design 2.2: buildings four times their footprint, walls two tiles thick, 2x2 staircases on
// every road and contour, and a half-turn that no longer maps a marker onto its twin. So the
// upscale keeps only the SKELETON (areas copy as 2x2 blocks) and redraws every LINE feature one tile
// per step:
//
//   interpElevation  contours by the 9/3/3/1 rule, so every contour steps one tile per level
//   anchorOf         the cell -> tile map every line feature hangs from (half-turn equivariant)
//   chainPath        a one-tile, 8-connected path between two tiles
//   roadChain        roads and walls as one-tile chains between the anchors of neighbouring cells
//   thinSimple       a ditch or channel thinned to one tile, topology kept (Bertrand's simple points)
//   components       a flood fill, for buildings, which are re-placed at their NATIVE footprint
//   placeShape       ... centred on twice the source centre
//   rescaleRect      zones at landmark size, not four times the area
//   topHalfPairs     markers: the top-half member of a twin pair is drawn, its twin is the half-turn
//
// Everything is integer arithmetic on the sketch; there is no random stream. A source map that is
// point-symmetric stays so: every rule here is equivariant under the half-turn (tile = n2 - 1 - tile),
// and the generators write the bottom half as the half-turn of the top anyway.

/**
 * The tile a cell's line features hang from, along one axis: `2c + 1` for the half of the map nearer
 * the low end, `2c` for the other, so the anchor is always the tile of the cell's 2x2 block that is
 * NEARER the centre. That is the half-turn image of itself: anchorOf(n - 1 - c) = 2n - 1 - anchorOf(c).
 * A road that crosses the centre line therefore stays joined, and two cells on either side of it
 * (23 and 24 on a 48-cell map) are one tile apart (47 and 48), not three.
 */
export const anchorOf = (c, n) => (c < n / 2 ? 2 * c + 1 : 2 * c);

/**
 * The 9/3/3/1 interpolation (design 3.2). The tile (x, y) lies in cell (x >> 1, y >> 1); the other
 * cell on each axis is the neighbour toward the tile's own side of the cell. The cell the tile is in
 * weighs 3 per axis and the other 1, so the four cells weigh 9, 3, 3 and 1 out of 16, rounded half
 * up. All integers. On an axis-aligned contour the step lands where nearest-neighbour would put a
 * two-tile one; on a diagonal contour it steps one tile per level. Edge cells are replicated.
 * @param {number[][]} E the cell grid, rows of numbers
 */
export function interpElevation(E) {
  const h = E.length;
  const w = E[0].length;
  const out = [];
  for (let y = 0; y < 2 * h; y++) {
    const row = [];
    const cy = y >> 1;
    const oy = Math.min(h - 1, Math.max(0, cy + (y & 1 ? 1 : -1)));
    for (let x = 0; x < 2 * w; x++) {
      const cx = x >> 1;
      const ox = Math.min(w - 1, Math.max(0, cx + (x & 1 ? 1 : -1)));
      const sum = 9 * E[cy][cx] + 3 * E[cy][ox] + 3 * E[oy][cx] + E[oy][ox];
      row.push((sum + 8) >> 4);
    }
    out.push(row);
  }
  return out;
}

/**
 * Straighten the 2x2 staircases of a relief (GH-920 B3). For every level L, the region
 * `level >= L` is scanned for three 2-tall steps in a row, each two columns on the same way (the
 * signature of a naive 2x copy of a diagonal cell contour, and what scallops under the renderer's
 * Catmull-Rom: PR 928, 0.94 tile of wander against 0.15). The first step's second row is moved one
 * column toward the second step, so transitions run c, c +- 1, c +- 2, ...: one tile a step. A stair of k
 * steps comes out with k - 2 one-tile steps and two coarse ones at the tail, which are not a window, so
 * the rule is idempotent. Regions are repaired to stay nested (R(L+1) inside R(L)) and the level of a tile
 * is again the number of regions it is in. Every other tile is untouched.
 *
 * Why the rule exists: the 9/3/3/1 interpolation does NOT do this. A cell contour x + y >= 3 upsamples
 * to the very 2x2 staircase the nearest copy makes (the weights keep every tile on its own cell's side:
 * 7/16 and 9/16 at the corners), and a 2x2 staircase is a fixed point of a 3x3 majority filter and of a
 * blur-and-threshold as well; measured, not argued, in tools/src/map_lib.test.ts.
 * @param {number[][]} el rows of levels
 * @returns {number[][]} a new grid
 */
export function straightenStairs(el) {
  const h = el.length;
  const w = el[0].length;
  let top = 0;
  for (const row of el) for (const v of row) top = Math.max(top, v);
  const regions = [];
  for (let l = 1; l <= top; l++) regions.push(el.map((row) => row.map((v) => v >= l)));
  for (const R of regions) {
    for (let pass = 0; pass < 16; pass++) {
      const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && R[y][x];
      const jump = (c, y, s) => {
        for (let r = y; r <= y + 1; r++) {
          const right = inside(c, r);
          const left = inside(c - 1, r);
          if (s === 1 ? !(right && !left) : !(left && !right)) return false;
        }
        return true;
      };
      const edits = [];
      for (const s of [1, -1]) {
        for (const d of [-2, 2]) {
          for (let y = 0; y + 5 < h; y++) {
            for (let c = 1; c < w - 1; c++) {
              if (!(jump(c, y, s) && jump(c + d, y + 2, s) && jump(c + 2 * d, y + 4, s))) continue;
              // the first step's second row moves halfway to the next step: the tile at its transition
              // joins the region (moving the transition outward) or leaves it
              const col = d < 0 ? (s === 1 ? c - 1 : c - 1) : s === 1 ? c : c;
              edits.push([col, y + 1, (d < 0) === (s === 1)]);
            }
          }
        }
      }
      if (edits.length === 0) break;
      for (const [x, y, to] of edits) R[y][x] = to;
    }
  }
  for (let l = 1; l < regions.length; l++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (regions[l][y][x] && !regions[l - 1][y][x]) regions[l][y][x] = false;
  }
  return el.map((row, y) => row.map((_, x) => regions.reduce((n, R) => n + (R[y][x] ? 1 : 0), 0)));
}

/** The tiles of a one-tile, 8-connected path from `a` to `b`, both included: diagonal steps first. */
export function chainPath([ax, ay], [bx, by]) {
  const out = [[ax, ay]];
  let x = ax;
  let y = ay;
  while (x !== bx || y !== by) {
    x += Math.sign(bx - x);
    y += Math.sign(by - y);
    out.push([x, y]);
  }
  return out;
}

/**
 * Roads and walls as one-tile chains. `cells` are [cx, cy] in a sketch of side `n`. Each cell becomes
 * its anchor tile, and each pair of orthogonal neighbours is joined by the tiles between their
 * anchors. With `diag`, a diagonal pair is joined too, unless either cell beside it is also in the
 * set (they are already joined by two orthogonal edges, and a third would make a 2x2 block). Walls
 * pass `diag: false`: a ring of wall cells stays a closed ring of single tiles.
 * @returns {[number, number][]} tile coordinates, unique, in no particular order
 */
export function roadChain(cells, n, { diag }) {
  const key = (x, y) => `${x},${y}`;
  const set = new Set(cells.map(([x, y]) => key(x, y)));
  const out = new Map();
  const add = ([x, y]) => out.set(key(x, y), [x, y]);
  const at = (x, y) => [anchorOf(x, n), anchorOf(y, n)];
  for (const [x, y] of cells) {
    add(at(x, y));
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (set.has(key(x + dx, y + dy))) chainPath(at(x, y), at(x + dx, y + dy)).forEach(add);
    }
    if (!diag) continue;
    for (const [dx, dy] of [[1, 1], [1, -1]]) {
      if (!set.has(key(x + dx, y + dy))) continue;
      if (set.has(key(x + dx, y)) || set.has(key(x, y + dy))) continue;
      chainPath(at(x, y), at(x + dx, y + dy)).forEach(add);
    }
  }
  return [...out.values()];
}

const N8 = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]; // clockwise from NW
const N4_AT = [1, 3, 5, 7]; // indexes of the orthogonal neighbours in N8

/**
 * Is the foreground tile (x, y) a simple point of an 8-connected foreground with a 4-connected
 * background (Bertrand)? Deleting it then changes no component and opens no hole: it is on the
 * boundary and its neighbours stay joined. `fg(x, y)` is the foreground predicate; outside the grid
 * is background.
 */
export function isSimplePoint(fg, x, y) {
  const f = N8.map(([dx, dy]) => fg(x + dx, y + dy));
  // foreground: the 8-connected components of the ring cells (two ring cells touch when they are one
  // step apart, corner included)
  const comp8 = (() => {
    const seen = Array(8).fill(false);
    let c = 0;
    for (let i = 0; i < 8; i++) {
      if (!f[i] || seen[i]) continue;
      c++;
      const st = [i];
      seen[i] = true;
      while (st.length) {
        const a = st.pop();
        for (let b = 0; b < 8; b++) {
          if (!f[b] || seen[b]) continue;
          if (Math.max(Math.abs(N8[a][0] - N8[b][0]), Math.abs(N8[a][1] - N8[b][1])) <= 1) {
            seen[b] = true;
            st.push(b);
          }
        }
      }
    }
    return c;
  })();
  if (comp8 !== 1) return false;
  // background: 4-connected components of the background ring cells that touch p orthogonally
  const seen = Array(8).fill(false);
  let c4 = 0;
  for (const i of N4_AT) {
    if (f[i] || seen[i]) continue;
    c4++;
    const st = [i];
    seen[i] = true;
    while (st.length) {
      const a = st.pop();
      for (let b = 0; b < 8; b++) {
        if (f[b] || seen[b]) continue;
        if (Math.abs(N8[a][0] - N8[b][0]) + Math.abs(N8[a][1] - N8[b][1]) === 1) {
          seen[b] = true;
          st.push(b);
        }
      }
    }
  }
  return c4 === 1;
}

/**
 * Thin `mask` (a Uint8Array of w x h; 1 = foreground to thin) to one tile, centred, with its
 * topology intact (the grid's edge counts as foreground). `fixed` (same shape, or null) is foreground that is never deleted but does count
 * as foreground: a ditch is thinned against the boulder fields and rocks it joins, and stays joined.
 * `keep` (same shape, or null) marks tiles OF the mask that are never deleted either: the ends of a barrier
 * either side of a ford, whose gap is a fact of the map and must not widen as the ends erode.
 * Four directional sub-passes (a tile is a candidate when its N, S, E or W neighbour is background),
 * each deleting simple points that are not end points, repeated until a full cycle deletes nothing.
 * One layer comes off every side per cycle, so a band thins to its centre line rather than to one
 * edge. Deterministic: raster order within a sub-pass.
 * @returns {Uint8Array} the thinned mask (a copy)
 */
export function thinSimple(mask, w, h, fixed = null, keep = null) {
  const m = Uint8Array.from(mask);
  // Outside the grid is foreground: the edge of the map is a wall to everything that moves, so a barrier
  // that runs into it is thinned against it as against any rock, and the seal it makes survives.
  const fg = (x, y) => x < 0 || y < 0 || x >= w || y >= h || m[y * w + x] !== 0 || (fixed !== null && fixed[y * w + x] !== 0);
  const sides = [[0, -1], [0, 1], [1, 0], [-1, 0]];
  for (let guard = 0; guard < 4 * Math.max(w, h); guard++) {
    let deleted = 0;
    for (const [sx, sy] of sides) {
      // The candidates are fixed at the start of the sub-pass: a tile exposed by a deletion in this very
      // pass waits for the next cycle, so one layer comes off each side per cycle and a stub is not
      // eroded to nothing in one sweep.
      const candidates = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x] !== 0 && !fg(x + sx, y + sy)) candidates.push([x, y]);
      for (const [x, y] of candidates) {
        if (keep !== null && keep[y * w + x] !== 0) continue;
        let neighbours = 0;
        for (const [dx, dy] of N8) if (fg(x + dx, y + dy)) neighbours++;
        if (neighbours < 2) continue; // an end point stays
        if (!isSimplePoint(fg, x, y)) continue;
        m[y * w + x] = 0;
        deleted++;
      }
    }
    if (deleted === 0) break;
  }
  return m;
}

/**
 * A barrier (a ditch) as a one-tile chain, from its thinned CELLS. The cells are thinned on the sketch
 * (`thinSimple` on the cell grid), where a one-cell-wide stub is a leaf that stays; thinning the 2x2
 * copy instead erodes a two-tile stub to nothing, and the ford beside it grows by as much (GH-920 B3,
 * where the cut sprang a leak). The chain is `roadChain` between anchors, plus, for every cell of
 * `fixedCells` (rock, boulders: the barrier's other material, copied as 2x2 blocks) that the cell
 * touches, the tiles from its anchor to the edge of its own block that faces it, so the chain still
 * meets the block it met. A diagonal touch is joined at the facing corner.
 * @returns {[number, number][]}
 */
export function barrierChain(cells, fixedCells, n) {
  const key = (x, y) => `${x},${y}`;
  const fixed = new Set(fixedCells.map(([x, y]) => key(x, y)));
  const out = new Map(roadChain(cells, n, { diag: true }).map(([x, y]) => [key(x, y), [x, y]]));
  for (const [cx, cy] of cells) {
    const a = [anchorOf(cx, n), anchorOf(cy, n)];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dy === 0) || !fixed.has(key(cx + dx, cy + dy))) continue;
        // the tile of this cell's block that faces the neighbour: its edge on each side the neighbour is on
        const edge = [dx === 0 ? a[0] : 2 * cx + (dx > 0 ? 1 : 0), dy === 0 ? a[1] : 2 * cy + (dy > 0 ? 1 : 0)];
        for (const [x, y] of chainPath(a, edge)) out.set(key(x, y), [x, y]);
      }
    }
  }
  return [...out.values()];
}

/**
 * The 4-connected runs of `symbols` in `rows` (strings), each as { sym, cells } with cells in raster
 * order. Used to find every building: a structure is flood-filled from its symbol run.
 */
export function components(rows, symbols) {
  const h = rows.length;
  const w = rows[0].length;
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (!symbols.includes(c) || seen[y * w + x]) continue;
      const cells = [];
      const st = [[x, y]];
      seen[y * w + x] = 1;
      while (st.length) {
        const [a, b] = st.pop();
        cells.push([a, b]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = a + dx;
          const ny = b + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || rows[ny][nx] !== c) continue;
          seen[ny * w + nx] = 1;
          st.push([nx, ny]);
        }
      }
      cells.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
      out.push({ sym: c, cells });
    }
  }
  return out;
}

/** The bounding box of a cell list: { x0, y0, w, h }. */
export function bboxOf(cells) {
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x0, y0, w: Math.max(...xs) - x0 + 1, h: Math.max(...ys) - y0 + 1 };
}

/**
 * A building re-placed at its NATIVE footprint (design 2.2): the same cells, one tile each, centred on
 * twice the source centre. In boundary coordinates the source box centre is x0 + w/2, so the tiles
 * start at 2(x0 + w/2) - w/2 = 2 x0 + w/2: whole when w is even. For an odd side the centre falls on
 * a tile edge, so the half-turn-equivariant rule applies (the tile nearer the map centre, as anchorOf);
 * `n` is the sketch side.
 * @returns {[number, number][]} the building's tiles
 */
export function placeShape(cells, n) {
  const b = bboxOf(cells);
  const start = (c0, size) => (size % 2 === 0 ? 2 * c0 + size / 2 : anchorOf(c0 + (size - 1) / 2, n) - (size - 1) / 2);
  const ox = start(b.x0, b.w);
  const oy = start(b.y0, b.h);
  return cells.map(([x, y]) => [ox + (x - b.x0), oy + (y - b.y0)]);
}

/**
 * A zone at LANDMARK size (design 3.1): the same w x h around twice the centre, not four times the area.
 * `mode: 'area'` doubles the sides instead (a camp or a deploy ground). The corner is floored; a zone's
 * twin is written as its rectangle's half-turn image, so a half-tile centre costs no symmetry.
 */
export function rescaleRect([x, y, w, h], mode = 'landmark') {
  if (mode === 'area') return [2 * x, 2 * y, 2 * w, 2 * h];
  return [2 * x + w - Math.ceil(w / 2), 2 * y + h - Math.ceil(h / 2), w, h];
}

/**
 * Markers by the half-turn rule (design 3.1, stage 4). Source markers come in twins: the tile (a, b)
 * and its source image (n - 1 - a, n - 1 - b). The member nearer the top (smaller y, then smaller x)
 * is drawn at twice its tile; the other is the half-turn image of that, 2(n - 1 - a) + 1 = 2n - 1 - 2a,
 * and NOT twice its own tile, which would break the twin. A marker with no twin tile must sit on the
 * centre of the map and is refused otherwise.
 * @param {Record<string, [number, number]>} markers by name
 * @param {number} n the sketch side
 * @param {(m: [number, number]) => [number, number]} place maps a top-half source tile to its large tile
 * @returns {Record<string, [number, number]>} large-map markers by name
 */
export function topHalfMarkers(markers, n, place = ([x, y]) => [2 * x, 2 * y]) {
  const size = 2 * n;
  const out = {};
  const twinTile = ([x, y]) => [n - 1 - x, n - 1 - y];
  const byTile = new Map(Object.entries(markers).map(([name, p]) => [p.join(','), name]));
  for (const [name, p] of Object.entries(markers)) {
    const twinName = byTile.get(twinTile(p).join(','));
    if (twinName === undefined) throw new Error(`marker ${name} (${p}) has no twin tile; every marker needs one`);
    const q = markers[twinName];
    const first = p[1] < q[1] || (p[1] === q[1] && p[0] <= q[0]);
    if (first) out[name] = place(p);
    else {
      const [x, y] = place(q);
      out[name] = [size - 1 - x, size - 1 - y];
    }
  }
  return out;
}

/**
 * Zones by the same rule as markers: the member of a twin pair nearer the top is rescaled, the other is
 * its rectangle's half-turn image. A zone that is its own twin (the centre) is rescaled and must come
 * out its own image again, which `rescaleRect` guarantees for a centred rectangle.
 * @param {Record<string, number[]>} zones by name, [x, y, w, h]
 * @param {number} n the sketch side
 * @param {(name: string, rect: number[]) => number[]} rescale
 */
export function topHalfRects(zones, n, rescale) {
  const size = 2 * n;
  const out = {};
  const byRect = new Map(Object.entries(zones).map(([name, r]) => [r.join(','), name]));
  for (const [name, r] of Object.entries(zones)) {
    const twinName = byRect.get([n - r[0] - r[2], n - r[1] - r[3], r[2], r[3]].join(','));
    if (twinName === undefined) throw new Error(`zone ${name} [${r}] has no twin rectangle`);
    const q = zones[twinName];
    const first = r[1] + r[3] / 2 < q[1] + q[3] / 2 || (r[1] === q[1] && r[0] <= q[0]);
    if (twinName === name || first) out[name] = rescale(name, r);
    else {
      const [x, y, w, h] = rescale(twinName, q);
      out[name] = [size - x - w, size - y - h, w, h];
    }
  }
  return out;
}
