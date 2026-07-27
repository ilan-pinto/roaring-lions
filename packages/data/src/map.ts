// Map format: a character grid plus named markers and zones. Maps are
// content (data/maps/*.json, validated against map.schema.json), authorable
// in a text editor — one character per tile:
//
//   .  open ground          1 2 3  cover levels (light / heavy / garrison)
//   #  blocked (building)
//
// Markers are named points missions reference (spawns, tunnel mouths, HVTs);
// zones are named rects (objective areas, trigger regions).

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
}

export interface ParsedMap {
  id: string;
  width: number;
  height: number;
  /** 1 = impassable building tile, row-major width*height. */
  blocked: Uint8Array;
  /** Cover level 0-3, row-major width*height. */
  cover: Uint8Array;
  markers: Record<string, [number, number]>;
  zones: Record<string, [number, number, number, number]>;
}

const LEGEND: Record<string, { blocked: number; cover: number }> = {
  '.': { blocked: 0, cover: 0 },
  '1': { blocked: 0, cover: 1 },
  '2': { blocked: 0, cover: 2 },
  '3': { blocked: 0, cover: 3 },
  '#': { blocked: 1, cover: 0 },
};

export function parseMap(json: MapJson): ParsedMap {
  const { width, height, rows } = json;
  if (rows.length !== height) {
    throw new Error(`map ${json.id}: ${rows.length} rows, declared height ${height}`);
  }
  const blocked = new Uint8Array(width * height);
  const cover = new Uint8Array(width * height);
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
  return { id: json.id, width, height, blocked, cover, markers, zones };
}
