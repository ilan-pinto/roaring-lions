// Tile-stage drawing helpers shared by the large-map generators (GH-920 B1), lifted unchanged from
// tools/maps/rujm_sawda/build.mjs. They write into the `t` (symbol) and `el` (elevation) grids a
// generator keeps as arrays of arrays, and they know nothing about a particular map.

/** A walled farm: a one-tile wall on the edge of an 8x8 box, two-tile gates, a 2-floor house. */
export function farmAt(t, x0, y0, house, gates) {
  for (let y = y0; y < y0 + 8; y++) {
    for (let x = x0; x < x0 + 8; x++) {
      const edge = x === x0 || x === x0 + 7 || y === y0 || y === y0 + 7;
      t[y][x] = edge ? '=' : '.';
    }
  }
  for (const [gx, gy] of gates) t[gy][gx] = '.';
  for (let y = house[1]; y < house[1] + 2; y++) for (let x = house[0]; x < house[0] + 2; x++) t[y][x] = 'h';
}

/** The tiles on the edge of a w x h rectangle at (x0, y0), row by row. */
export function ringTiles(x0, y0, w, h) {
  const ring = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) if (x === x0 || x === x0 + w - 1 || y === y0 || y === y0 + h - 1) ring.push([x, y]);
  }
  return ring;
}

/**
 * Stamp `symbol` on each of `tiles`. A tile that is not on one of the `allowed` symbols is an authoring
 * error and throws, so a road never lands silently on a wall or a rock. A one-tile chain is what the
 * renderer's road graph draws as one line, so callers pass chains (corner-touching on diagonals).
 */
export function stampChain(t, tiles, symbol, allowed, label = 'road') {
  for (const [x, y] of tiles) {
    if (!allowed.includes(t[y][x])) throw new Error(`look stage: ${label} tile ${x},${y} lands on ${t[y][x]}`);
    t[y][x] = symbol;
  }
}

/**
 * The shelf stair, one tile a step: for every tile with x + y <= `reach` whose symbol is not in `skip`,
 * the elevation is that of the first band whose limit it is within, else `rest`. `bands` is
 * [[limit, level], ...] in ascending limit order. One tile per level is what keeps a diagonal contour
 * straight under the renderer's Catmull-Rom (0.15 tile of wander against 0.94 for a 2x2 staircase).
 */
export function shelfSteps(t, el, rows, cols, { reach, bands, rest, skip }) {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (x + y > reach || skip.includes(t[y][x])) continue;
      const band = bands.find(([limit]) => x + y <= limit);
      el[y][x] = band ? band[1] : rest;
    }
  }
}

/**
 * Scrub patches: for each [cx, cy] every tile within `radius` whose hash is even is offered to
 * `put(x, y, symbol)`, the centre tile as `centreSymbol`. `put` decides what is clear.
 */
export function scatterPatches(put, hash, patches, { radius, salt, rows, symbol, centreSymbol }) {
  for (const [cx, cy] of patches) {
    const r = Math.ceil(radius);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (y >= 0 && y < rows && Math.hypot(x - cx, y - cy) <= radius && hash(x, y, salt) % 2 === 0) {
          put(x, y, x === cx && y === cy ? centreSymbol : symbol);
        }
      }
    }
  }
}
