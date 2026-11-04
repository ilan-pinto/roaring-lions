// The triangle bill of a map's structures (GH-974).
//
// PR 996 (Milh Flats (large), redone) failed its render budget and PR 1001 found out why: the cost of a town is TRIANGLES, not
// draw calls. A wall tile is 3,087 triangles, a house 39,016, and every one is drawn in three passes (the shadow map, the colour
// pass and the AO normal pre-pass), at about 0.65 ns a triangle summed over the passes. So a map that is designed to fit the
// budget has to COUNT as it places: this is the counter.
//
//   cd tools && ./node_modules/.bin/tsx src/map_triangles.ts <map id | staged:<id> | path.json> ...
//
// What it counts (the structures the renderer clones, not the terrain):
//   - every non-per-tile structure is ONE mesh, whatever its footprint (a 2x2 house is one house, a two-tile shed one shanty);
//   - every per-tile structure (a wall) is one mesh a tile;
//   - a ditch tile (`d`) is one 38,240-triangle decor segment, never culled inside a chunk.
// It does NOT count the ground, the scatter, boulders (about 340 a tile) or trees (about 1,500), which are one to two orders
// cheaper than a structure and which the 48x48 control carries too.
//
// The mesh sizes are read from art/meshes/buildings/<type>.glb (the standing mesh, not the `_wreck` twin), summed over every
// primitive of every node that references a mesh. tools/src/map_triangles.test.ts holds them against a Python read of the same
// files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMap, structures as structureCatalogue, type MapJson, type ParsedMap } from '@lions/data';
import { ROOT } from './map_visibility';

/** The passes a structure is drawn in: shadow map, colour, AO pre-pass (PR 1001's analysis). */
export const PASSES = 3;
/** A ditch segment, art/meshes/decor/ditch_0.glb. */
export const DITCH_TRIANGLES = 38_240;
/** The cost of one triangle drawn in the three passes, ns (PR 1001: the whole Milh redo added 5.2 M for +3.4 ms). */
export const NS_PER_FRAME_TRIANGLE = 0.65;

interface Gltf {
  meshes?: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[];
  nodes?: { mesh?: number }[];
  accessors: { count: number }[];
}

/** The triangles of a GLB: every primitive of every node that references a mesh, indexed or not. */
export function glbTriangles(path: string): number {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  const jsonLength = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
  const perMesh = (j.meshes ?? []).map((m) =>
    m.primitives.reduce((a, p) => a + (p.indices !== undefined ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count) / 3, 0)
  );
  return (j.nodes ?? []).reduce((a, n) => a + (n.mesh !== undefined ? perMesh[n.mesh] : 0), 0);
}

const meshCache = new Map<string, number>();
/** The triangles of one standing mesh of a structure type. */
export function structureTriangles(type: string): number {
  let n = meshCache.get(type);
  if (n === undefined) {
    n = glbTriangles(join(ROOT, 'art', 'meshes', 'buildings', `${type}.glb`));
    meshCache.set(type, n);
  }
  return n;
}

const perTile = (type: string): boolean => (structureCatalogue as Record<string, { per_tile?: boolean } | undefined>)[type]?.per_tile === true;

export interface Mesh {
  type: string;
  /** Where it stands: the mean of its tiles, in tile coordinates. */
  x: number;
  y: number;
  triangles: number;
}

/** Every mesh the structures of a map put on screen, ditch segments included (type `ditch`). */
export function meshesOf(json: MapJson, map: ParsedMap = parseMap(json)): Mesh[] {
  const W = map.width;
  const out: Mesh[] = [];
  for (const s of map.structures) {
    const t = structureTriangles(s.type);
    if (perTile(s.type)) {
      for (const tile of s.tiles) out.push({ type: s.type, x: tile % W, y: Math.floor(tile / W), triangles: t });
    } else {
      const x = s.tiles.reduce((a, tile) => a + (tile % W), 0) / s.tiles.length;
      const y = s.tiles.reduce((a, tile) => a + Math.floor(tile / W), 0) / s.tiles.length;
      out.push({ type: s.type, x, y, triangles: t });
    }
  }
  json.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'd') out.push({ type: 'ditch', x, y, triangles: DITCH_TRIANGLES });
  });
  return out;
}

export interface Bill {
  /** By type: how many meshes and their triangles in ONE pass. */
  byType: Record<string, { meshes: number; triangles: number }>;
  /** One pass. */
  perPass: number;
  /** All three passes: the figure PR 1001 compares against a frame's triangle count. */
  frame: number;
}

export function billOf(meshes: readonly Mesh[]): Bill {
  const byType: Bill['byType'] = {};
  let perPass = 0;
  for (const m of meshes) {
    const e = (byType[m.type] ??= { meshes: 0, triangles: 0 });
    e.meshes++;
    e.triangles += m.triangles;
    perPass += m.triangles;
  }
  return { byType, perPass, frame: perPass * PASSES };
}

/** The bill of the meshes whose position is inside the square of `edge` tiles whose top-left tile is (x0, y0). */
export function windowBill(meshes: readonly Mesh[], x0: number, y0: number, edge: number): Bill {
  return billOf(meshes.filter((m) => m.x >= x0 && m.x < x0 + edge && m.y >= y0 && m.y < y0 + edge));
}

/** The window of `edge` tiles centred on the map's centre. */
export function centreBill(meshes: readonly Mesh[], size: number, edge: number): Bill {
  const o = Math.floor((size - edge) / 2);
  return windowBill(meshes, o, o, edge);
}

/** The densest window of `edge` tiles anywhere on a map of `size` (every offset), with its top-left tile. */
export function densestWindow(meshes: readonly Mesh[], size: number, edge: number): { bill: Bill; x0: number; y0: number } {
  let best: { bill: Bill; x0: number; y0: number } | null = null;
  for (let y0 = 0; y0 <= size - edge; y0++) {
    for (let x0 = 0; x0 <= size - edge; x0++) {
      const bill = windowBill(meshes, x0, y0, edge);
      if (best === null || bill.perPass > best.bill.perPass) best = { bill, x0, y0 };
    }
  }
  if (best === null) throw new Error(`a ${edge}-tile window does not fit a ${size}-tile map`);
  return best;
}

/** The frame cost the 0.65 ns a triangle predicts, ms. */
export const msOf = (frameTriangles: number): number => (frameTriangles * NS_PER_FRAME_TRIANGLE) / 1e6;

function load(arg: string): MapJson {
  if (arg.startsWith('staged:')) return JSON.parse(readFileSync(join(ROOT, 'docs', 'campaign', 'staged_maps', arg.slice(7), 'map.json'), 'utf8')) as MapJson;
  if (arg.endsWith('.json')) return JSON.parse(readFileSync(arg, 'utf8')) as MapJson;
  return JSON.parse(readFileSync(join(ROOT, 'data', 'maps', `${arg}.json`), 'utf8')) as MapJson;
}

if (process.argv[1] && process.argv[1].endsWith('map_triangles.ts')) {
  const edge = Number(process.argv.find((a) => a.startsWith('--window='))?.slice(9) ?? 48);
  for (const arg of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
    const json = load(arg);
    const ms = meshesOf(json);
    const whole = billOf(ms);
    const centre = centreBill(ms, json.width, Math.min(edge, json.width));
    const dense = densestWindow(ms, json.width, Math.min(edge, json.width));
    const k = (n: number) => `${(n / 1000).toFixed(0)}k`;
    console.log(`${arg}  (${json.width}x${json.height})`);
    console.log(
      `  whole map   ${k(whole.perPass).padStart(6)} a pass  ${(whole.frame / 1e6).toFixed(2)} M a frame  ` +
        Object.entries(whole.byType).map(([t, e]) => `${t} ${e.meshes}`).join(', ')
    );
    console.log(`  centre ${edge}   ${k(centre.perPass).padStart(6)} a pass  ${(centre.frame / 1e6).toFixed(2)} M a frame  ~${msOf(centre.frame).toFixed(2)} ms`);
    console.log(`  densest ${edge}  ${k(dense.bill.perPass).padStart(6)} a pass  ${(dense.bill.frame / 1e6).toFixed(2)} M a frame  ~${msOf(dense.bill.frame).toFixed(2)} ms  at (${dense.x0},${dense.y0})`);
  }
}
