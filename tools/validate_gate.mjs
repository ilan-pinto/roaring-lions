// The compound-gate rules (GH-1438 E1, docs/campaign/civilian-drama.md section 2.2) that validate_data.mjs
// checks and the sim would otherwise accept. Its own module because validate_data.mjs runs its whole sweep at
// import time and exits, so a test cannot import it.
//
// A gate is a structure type with a `gate` block. Three rules:
//   G1  a gate type is one structure: `per_tile` is not true (a per-tile gate would open one leaf at a time);
//   G2  a gate's footprint is 2x1 or 1x2 tiles: in a map grid, every 4-connected run of its symbol is exactly two
//       tiles (any two 4-connected tiles are a 2x1 or a 1x2, and parseMap floods 4-connected); in a mission's
//       `structures[]`, its `size` (default [2, 2]) is [2, 1] or [1, 2];
//   G3  no gate on a map that has a versus rules file (`data/versus/<map>.json`): a gate opens for side 0 only,
//       which is unfair in a room. Both ways in are refused, the grid and a mission's `structures[]`.

const gateTypes = (catalogue) =>
  Object.entries(catalogue?.types ?? {}).filter(([, spec]) => spec?.gate !== undefined);

/**
 * Every gate-rule failure.
 * @param {object} catalogue  data/structures.json
 * @param {{ id: string, file: string, rows?: string[] }[]} maps  data/maps/*.json, with their repo-relative file
 * @param {{ file: string, mission: object }[]} missions  data/missions/**, with their repo-relative file
 * @param {Set<string>} versusMaps  the map ids a data/versus/*.json names
 * @returns {string[]}
 */
export function gateFailures(catalogue, maps, missions, versusMaps) {
  const out = [];
  const gates = gateTypes(catalogue);
  if (gates.length === 0) return out;
  const bySymbol = new Map();
  const ids = new Set();
  for (const [id, spec] of gates) {
    ids.add(id);
    if (typeof spec.symbol === 'string') bySymbol.set(spec.symbol, id);
    // G1
    if (spec.per_tile === true) out.push(`data/structures.json: gate "${id}" is per_tile -- a gate is one structure (its two leaves open together)`);
  }

  for (const m of maps) {
    const rows = (m.rows ?? []).filter((r) => typeof r === 'string');
    const h = rows.length;
    const seen = new Set();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const id = bySymbol.get(rows[y][x]);
        if (id === undefined || seen.has(`${x},${y}`)) continue;
        // G3, the grid.
        if (versusMaps.has(m.id)) {
          out.push(`${m.file}: row ${y} draws gate "${id}" at (${x}, ${y}) and the map has a versus rules file -- a gate opens for side 0 only`);
        }
        // G2, the grid: flood the 4-connected run of the same symbol.
        const sym = rows[y][x];
        const stack = [[x, y]];
        seen.add(`${x},${y}`);
        let n = 0;
        while (stack.length > 0) {
          const [cx, cy] = stack.pop();
          n++;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (ny < 0 || ny >= h || nx < 0 || nx >= rows[ny].length || rows[ny][nx] !== sym) continue;
            const k = `${nx},${ny}`;
            if (seen.has(k)) continue;
            seen.add(k);
            stack.push([nx, ny]);
          }
        }
        if (n !== 2) out.push(`${m.file}: gate "${id}" at (${x}, ${y}) is a run of ${n} tiles -- a gate is 2x1 or 1x2`);
      }
    }
  }

  for (const { file, mission } of missions) {
    for (const placed of mission?.structures ?? []) {
      if (!ids.has(placed?.type)) continue;
      const [w, h] = placed.size ?? [2, 2];
      // G2, a mission placement.
      if (!((w === 2 && h === 1) || (w === 1 && h === 2))) {
        out.push(`${file}: structures[] places gate "${placed.type}" at (${placed.at}) with size [${w}, ${h}] -- a gate is [2, 1] or [1, 2]`);
      }
      // G3, a mission placement.
      const mapId = mission?.map?.file;
      if (versusMaps.has(mapId)) {
        out.push(`${file}: structures[] places gate "${placed.type}" on "${mapId}", which has a versus rules file -- a gate opens for side 0 only`);
      }
    }
  }
  return out;
}
