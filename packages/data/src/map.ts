// Map format: a character grid plus named markers, zones and tunnel routes.
// Maps are content (data/maps/*.json, validated against map.schema.json),
// authorable in a text editor — one character per tile:
//
//   .  open ground          1 2 3  cover levels (light / heavy / garrison)
//   r  dirt road            o  olive grove (cover 1)   n  rocky knoll (cover 2)
//   ^  rock ridge: impassable and blocks sight, the only non-building blocked tile
//   building symbols come from data/structures.json, NOT from this file
//
// Any building symbol makes a blocked tile; a contiguous run of the SAME
// symbol becomes one structure with its own HP, garrison and rubble — unless
// its type is `per_tile`, in which case every tile is its own structure. A
// fence is not one object forty tiles long: it is forty objects, so a breach
// is a one-tile hole rather than a vanished perimeter.
//
// Markers are named points missions reference (spawns, tunnel mouths, HVTs);
// zones are named rects (objective areas, trigger regions). Tunnel routes are
// underground polylines — mouth, optional waypoints, vent — that never mark
// the grid: the surface above a tunnel is whatever the characters say it is.
//
// `o` and `n` deliberately reuse cover levels 1 and 2 rather than inventing
// mechanics: the sim sees exactly what it always saw, and the only new thing is
// that a cover tile can now say what KIND of cover it is. That "kind" is the
// decor layer, which is presentation-only and never reaches the sim -- see DECOR.

import structureCatalogue from '../../../data/structures.json';

/**
 * Which palette and ground texture a map is drawn with.
 *
 * Presentation only, exactly like `decor`: the sim never sees it, because
 * whether a tile is grass or gravel changes no outcome. What it changes is the
 * tone bundle `main.ts` hands the renderer and the shape of the open-ground
 * scatter. Adding a theme is a renderer change; adding a MAP is not.
 */
export type TerrainTheme = 'arid' | 'green';

const TERRAIN_THEMES: ReadonlySet<string> = new Set<TerrainTheme>(['arid', 'green']);

export interface TunnelJson {
  id: string;
  mouth: readonly number[];
  waypoints?: readonly (readonly number[])[];
  vent: readonly number[];
  dig_tiles_per_s?: number;
  /** The route starts fully excavated: dig progress at full length, vent
   *  open. One of the two ways authored data opens a route -- the other is a
   *  mission placement whose `digs` names it, excavating live. */
  pre_dug?: boolean;
}

export interface MapJson {
  id: string;
  name: string;
  width: number;
  height: number;
  rows: string[];
  // JSON imports infer plain number[]; parseMap checks lengths and returns
  // strict tuples.
  markers?: Record<string, readonly number[]>;
  zones?: Record<string, readonly number[]>;
  /** Terrain theme. Absent means 'arid', which is every map authored before Naharin. */
  terrain?: string;
  /** Per-tile elevation, one digit 0-9 per tile, same dimensions as `rows`.
   *  Absent means every tile is height 0, which is every map authored before
   *  the elevation milestone. Orthogonal to the terrain symbol on purpose:
   *  deriving height from the symbol would give ridges and no valleys. */
  elevation?: string[];
  tunnels?: readonly TunnelJson[];
}

export interface ParsedStructure {
  /** Structure type id from data/structures.json. */
  type: string;
  /** Tile indices (row-major) making up the footprint. */
  tiles: number[];
}

/**
 * An authored underground route, flattened to a single polyline.
 *
 * Mouth and vent are separate fields in JSON because that is how an author
 * thinks about a tunnel — it starts somewhere and comes up somewhere — but
 * every consumer walks the whole line, so keeping three fields would mean
 * every consumer re-concatenating them.
 */
export interface ParsedTunnel {
  id: string;
  /** Mouth first, waypoints in order, vent last. Always at least 2 points. */
  points: [number, number][];
  digTilesPerS: number;
  /** Fully excavated at mission start: progress at length, vent open. */
  preDug: boolean;
}

/**
 * What a tile draws on top of its terrain. Presentation only.
 *
 * This never enters the sim. Whether a tile shows a tree or a rock changes no
 * outcome, so a `Sim` field would widen the state the determinism hash covers and
 * invite exactly the coupling invariant 4 exists to prevent. `main.ts` hands the
 * array to the renderer directly; the mechanical half of the same tile travels
 * the normal route, through `sim.setCover`.
 */
export const DECOR = { none: 0, road: 1, grove: 2, knoll: 3, ridge: 4 } as const;
export type DecorKind = (typeof DECOR)[keyof typeof DECOR];

export interface ParsedMap {
  id: string;
  width: number;
  height: number;
  /** Terrain theme. Presentation only -- never given to Sim. */
  terrain: TerrainTheme;
  /** 1 = impassable building tile, row-major width*height. */
  blocked: Uint8Array;
  /** Cover level 0-3, row-major width*height. */
  cover: Uint8Array;
  /** DECOR value per tile, row-major. Presentation only -- never given to Sim. */
  decor: Uint8Array;
  /** Elevation level 0-9 per tile, row-major. E1 stores and draws it; nothing
   *  reads it for line of sight, sight range or pathing yet. */
  elevation: Uint8Array;
  markers: Record<string, [number, number]>;
  zones: Record<string, [number, number, number, number]>;
  /** Buildings: one per contiguous run of identical building symbols, or one
   *  per tile for a `per_tile` type. */
  structures: ParsedStructure[];
  tunnels: ParsedTunnel[];
}

/**
 * Map symbol → structure type id, derived from the catalogue.
 *
 * This used to be a hardcoded duplicate of the `symbol` field every entry in
 * data/structures.json already declares -- a field nothing read. Adding a
 * structure type therefore meant editing engine code, which CLAUDE.md forbids:
 * "adding a unit means adding JSON, never engine code". Deriving it makes a new
 * building type pure data.
 *
 * The JSON is imported directly rather than through this package's index, which
 * re-exports `parseMap` and would make the import circular.
 */
export const STRUCTURE_SYMBOLS: Record<string, string> = Object.fromEntries(
  Object.entries(structureCatalogue.types).map(([id, spec]) => [spec.symbol, id])
);

/**
 * Symbols whose type is `per_tile`: every tile stands alone as its own structure.
 *
 * A `per_tile` type is one the author draws as a linear run of arbitrary length —
 * a wall, a fence — and length is exactly what makes footprint-wide HP wrong for
 * it. Flood-filled, a perimeter is a single object whose whole ring unblocks the
 * instant it dies, so an attacker who "breaches" it deletes the compound. Split,
 * each tile carries its own HP and a breach is the one-tile hole it should be.
 *
 * Derived from the catalogue for the same reason STRUCTURE_SYMBOLS is: a new
 * building type stays pure data. The cast is needed because `Object.values`
 * collapses the entries into a union and only some of them declare the field.
 */
export const PER_TILE_SYMBOLS: ReadonlySet<string> = new Set(
  Object.values(structureCatalogue.types)
    .filter((spec) => (spec as { per_tile?: boolean }).per_tile === true)
    .map((spec) => spec.symbol)
);

/** Terrain symbols, and the blocked/cover/decor triple each one means. */
export const TERRAIN_LEGEND: Record<
  string,
  { blocked: number; cover: number; decor: DecorKind }
> = {
  '.': { blocked: 0, cover: 0, decor: DECOR.none },
  '1': { blocked: 0, cover: 1, decor: DECOR.none },
  '2': { blocked: 0, cover: 2, decor: DECOR.none },
  '3': { blocked: 0, cover: 3, decor: DECOR.none },
  r: { blocked: 0, cover: 0, decor: DECOR.road },
  o: { blocked: 0, cover: 1, decor: DECOR.grove },
  n: { blocked: 0, cover: 2, decor: DECOR.knoll },
  '^': { blocked: 1, cover: 0, decor: DECOR.ridge },
};

const LEGEND: Record<string, { blocked: number; cover: number; decor: DecorKind }> = {
  ...TERRAIN_LEGEND,
};
for (const sym of Object.keys(STRUCTURE_SYMBOLS)) {
  LEGEND[sym] = { blocked: 1, cover: 0, decor: DECOR.none };
}

export function parseMap(json: MapJson): ParsedMap {
  const { width, height, rows } = json;
  const terrain = json.terrain ?? 'arid';
  if (!TERRAIN_THEMES.has(terrain)) {
    throw new Error(
      `map ${json.id}: unknown terrain theme "${terrain}" (known: arid, green)`
    );
  }
  if (rows.length !== height) {
    throw new Error(`map ${json.id}: ${rows.length} rows, declared height ${height}`);
  }
  const blocked = new Uint8Array(width * height);
  const cover = new Uint8Array(width * height);
  const decor = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    if (row.length !== width) {
      throw new Error(`map ${json.id}: row ${y} has ${row.length} tiles, declared width ${width}`);
    }
    for (let x = 0; x < width; x++) {
      const cell = LEGEND[row[x]];
      if (cell === undefined) {
        throw new Error(`map ${json.id}: unknown symbol "${row[x]}" at (${x},${y})`);
      }
      blocked[y * width + x] = cell.blocked;
      cover[y * width + x] = cell.cover;
      decor[y * width + x] = cell.decor;
    }
  }
  const elevation = new Uint8Array(width * height);
  if (json.elevation !== undefined) {
    if (json.elevation.length !== height) {
      throw new Error(
        `map ${json.id}: elevation has ${json.elevation.length} rows, declared height ${height}`
      );
    }
    for (let y = 0; y < height; y++) {
      const row = json.elevation[y];
      if (row.length !== width) {
        throw new Error(
          `map ${json.id}: elevation row ${y} has ${row.length} tiles, declared width ${width}`
        );
      }
      for (let x = 0; x < width; x++) {
        const ch = row[x];
        if (ch < '0' || ch > '9') {
          throw new Error(`map ${json.id}: unknown elevation "${ch}" at (${x},${y})`);
        }
        elevation[y * width + x] = ch.charCodeAt(0) - 48;
      }
    }
  }
  const markers: Record<string, [number, number]> = {};
  for (const [name, pt] of Object.entries(json.markers ?? {})) {
    const [x, y] = pt;
    if (pt.length !== 2 || x < 0 || y < 0 || x >= width || y >= height) {
      throw new Error(`map ${json.id}: marker "${name}" (${pt.join(',')}) is out of bounds`);
    }
    markers[name] = [x, y];
  }
  const zones: Record<string, [number, number, number, number]> = {};
  for (const [name, z] of Object.entries(json.zones ?? {})) {
    const [x, y, w, h] = z;
    if (z.length !== 4 || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width || y + h > height) {
      throw new Error(`map ${json.id}: zone "${name}" [${z.join(',')}] is out of bounds`);
    }
    zones[name] = [x, y, w, h];
  }
  const tunnels: ParsedTunnel[] = [];
  const tunnelIds = new Set<string>();
  for (const t of json.tunnels ?? []) {
    if (tunnelIds.has(t.id)) {
      throw new Error(`map ${json.id}: duplicate tunnel id "${t.id}"`);
    }
    tunnelIds.add(t.id);
    const raw = [t.mouth, ...(t.waypoints ?? []), t.vent];
    const points: [number, number][] = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      const [x, y] = p;
      if (p.length !== 2 || x < 0 || y < 0 || x >= width || y >= height) {
        throw new Error(
          `map ${json.id}: tunnel "${t.id}" point ${i} (${p.join(',')}) is out of bounds`
        );
      }
      points.push([x, y]);
    }
    tunnels.push({ id: t.id, points, digTilesPerS: t.dig_tiles_per_s ?? 0.15, preDug: t.pre_dug ?? false });
  }
  // Flood-fill contiguous same-symbol building tiles into structures, so an
  // author draws a town in ASCII and gets buildings with HP for free.
  const structures: ParsedStructure[] = [];
  const seen = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      const sym = rows[y][x];
      const typeId = STRUCTURE_SYMBOLS[sym];
      if (typeId === undefined || seen[t] === 1) continue;
      if (PER_TILE_SYMBOLS.has(sym)) {
        // No fill: this tile is the whole structure. The scan is row-major, so
        // these come out in ascending tile order without needing the sort below.
        seen[t] = 1;
        structures.push({ type: typeId, tiles: [t] });
        continue;
      }
      const tiles: number[] = [];
      const stack = [t];
      seen[t] = 1;
      while (stack.length > 0) {
        const cur = stack.pop() as number;
        tiles.push(cur);
        const cx = cur % width;
        const cy = (cur - cx) / width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (seen[n] === 1 || rows[ny][nx] !== sym) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      tiles.sort((a, b) => a - b); // deterministic order
      structures.push({ type: typeId, tiles });
    }
  }
  return { id: json.id, width, height, terrain: terrain as TerrainTheme, blocked, cover, decor, elevation, markers, zones, structures, tunnels };
}

/**
 * What `applyTerrain` writes into. Structural on purpose.
 *
 * `@lions/data` is a leaf and imports nothing, so it cannot name `Sim` — and it
 * does not need to. `Sim` satisfies this shape already, which is the entire
 * mechanism: the dependency direction holds and the duplication still dies.
 */
export interface TerrainSink {
  setBlocked(x: number, y: number, b: boolean): void;
  setCover(x: number, y: number, c: number): void;
}

/**
 * Hand a parsed map's mechanical layer to a sim.
 *
 * This existed three times before it existed once: main.ts, walk_world.ts and
 * backtest/playtest.ts each wrote their own cover loop, and none of them
 * consumed `blocked` at all -- so `parseMap` filled an array nobody read, and
 * rock terrain had nowhere to arrive.
 *
 * Three copies of one idea is how tunnel registration went missing from
 * playtest.ts: the harness died at Beit Sahwan II for two days with every test
 * green, because a tool had drifted from the app and nothing compared them.
 * One function is the fix, and the next terrain concept edits one file.
 *
 * Only ever sets blocked TRUE. Structure tiles are blocked in `map.blocked`
 * too, so this marks them as well -- harmless and idempotent, since
 * `addStructure` sets the same bit in the same array and `demolish` clears it.
 * Never unblocking means calling this after the structure loop cannot undo it.
 */
export function applyTerrain(map: ParsedMap, sink: TerrainSink): void {
  const { width, height, blocked, cover } = map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      if (blocked[t] !== 0) sink.setBlocked(x, y, true);
      if (cover[t] !== 0) sink.setCover(x, y, cover[t]);
    }
  }
}
