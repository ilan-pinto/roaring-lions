// Can the player SEE the fight? (GH-416, docs/campaign/ground-ladder.md "Keep the fight visible")
//
// The lead, 6 Oct: "Wadi Halam IV is too dense; I can't see the fight. Maps should be wide
// enough so the user can see the fight; most of it should not be eaten by a building."
//
// WHAT IS MEASURED. For every campaign map, the FIGHT TILES are the passable tiles a mission
// actually fights over: every tile within `NEAR_OBJECTIVE` of an objective's target (a zone's
// rectangle, a marker, or the placements an objective's tag names), plus a three-tile-wide
// corridor along every MAIN ROUTE -- the foot flow-field path from the player's start to each
// objective, and from each wave's spawn to where the wave is sent. A fight tile is HIDDEN when
// a building's drawn mesh covers more than half of a rifleman standing at its centre, as the
// default camera sees him. The share that is not hidden is the map's VISIBLE SHARE.
//
// WHY THE REAL MESH AND NOT THE FOOTPRINT. A building draws its shipped GLB at the footprint's
// centre at a FIXED size (`ThreeRenderer.updateBuildingMeshes`: `root.position.set(cx, y, cy)`,
// scale `MESH_SCALE`, nothing fitted to the footprint), so a house is 4.26 x 3.71 tiles in plan
// and 4.24 world units tall whatever its footprint says. On Wadi Halam IV's 3x3 house blocks
// with one-tile lanes between them, the lane is INSIDE the next house's mesh. A footprint
// model would call that lane open ground. So the occluders here are the shipped
// `art/meshes/buildings/<type>.glb` triangles, read with @gltf-transform, scaled by the
// renderer's own `MESH_SCALE`, and placed the way the renderer places them.
//
// WHY THE REAL CAMERA. The view direction is `camera.ts`'s `VIEW_DIRECTION`, imported, not
// re-derived. The camera is ORTHOGRAPHIC, so whether a point is hidden depends only on that
// direction and never on zoom or pan: "at default zoom" and "at any zoom" are the same answer.
//
// THE TEST. For each building, every triangle is projected onto the screen plane (right/up
// axes perpendicular to `VIEW_DIRECTION`) and rasterised at `RASTER_RES` world units, keeping
// the NEAREST depth per cell. A body point is hidden by that building when its own screen
// position falls in a covered cell whose nearest depth is in front of the point -- i.e. the ray
// from the point to the camera meets the mesh. This is the occlusion silhouette's question
// (`units/silhouette.ts` outlines a unit the depth buffer has covered) asked of a standing
// rifleman, without a browser.
//
// What it deliberately does NOT count: rock ridges (`^`), decor and props. The rule is about
// buildings; a ridge that hides a valley is the map's relief doing its job.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO, type Node as GltfNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

import { parseMap, type MapJson, type ParsedMap } from '../../packages/data/src/index';
import { FlowField, DIR_DX, DIR_DY, DIR_NONE } from '../../packages/sim/src/flowfield';
import { VIEW_DIRECTION } from '../../packages/render/src/three/camera';
import { MESH_SCALE } from '../../packages/render/src/three/units/mesh-anim';
import { groundWorldY, tileGroundWorldY } from '../../packages/render/src/three/ground-height';
import { campaignMissions } from './map_distinctness';

export const ROOT = join(import.meta.dirname, '..', '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/**
 * THE FLOOR. At least this share of a campaign map's fight tiles must be visible.
 *
 * Why 0.84, and not the 0.60-0.70 the brief opened with. The one human judgement on record is
 * the lead's: on Wadi Halam IV as it shipped before GH-416 he "can't see the fight". It reads
 * 0.741 here. A floor at or under 0.74 passes the very map that raised the issue, so the 60-70%
 * band cannot be the line: "most of it" has to mean more than a bare majority.
 *
 * Where above 0.74. Measured on main (62a7f3d3), the 26 campaign maps fall in two groups with an
 * empty gap between them: seven at 0.457-0.806 (each a town or a village: Beit Sahwan III, Khan
 * Rafid I and III, Deir Amun III, Wadi Halam IV and V, Qarn Hadid III) and nineteen at 0.873 and
 * above. The floor sits mid-gap, as map_distinctness.ts puts FEATURE_GATE between its two
 * populations. And it is the one value that does not depend on this instrument's free
 * parameters: re-run with NEAR_OBJECTIVE 3 or 5 and HIDDEN_BODY_SHARE 0.2 or 0.5 (four
 * settings), the worst open map reads 0.849-0.873 and the best dense one 0.747-0.806, so 0.84
 * gives every map the same verdict under all four. 0.85 does not (deir_amun reads 0.849 at
 * 3/0.2), and 0.80 does not (Wadi Halam V and Qarn Hadid III read 0.806 at 5/0.5 and 0.710-0.788
 * elsewhere). A floor whose verdict flips when a parameter moves is a fitted number.
 *
 * In words: no more than about one fight tile in six behind a building.
 */
export const VISIBLE_FLOOR = 0.84;

/** Tiles (Chebyshev) around an objective's target that count as where it is fought. */
export const NEAR_OBJECTIVE = 5;
/** Tiles either side of a main-route path that count as the route (a 3-wide corridor). */
export const ROUTE_HALF_WIDTH = 1;
/** A fight tile is hidden when MORE than this share of the rifleman's body samples are. */
export const HIDDEN_BODY_SHARE = 0.5;
/** Screen-plane raster cell, world units. A rifleman is ~0.25 wide, so 0.05 is 5 cells across. */
export const RASTER_RES = 0.05;

/**
 * The rifleman: 1.67 m on a 3 m tile (`MESH_UNITS_PER_TILE`) is 0.56 world units tall, and
 * about 0.25 across. Sampled 3 across x 5 up, in the screen's own right axis.
 */
const BODY_HEIGHTS = [0.08, 0.19, 0.3, 0.41, 0.52];
const BODY_LATERAL = [-0.1, 0, 0.1];

// --- screen basis --------------------------------------------------------------------------
// V points from the scene toward the camera. R and U complete an orthonormal basis of the
// screen plane; their signs do not matter, only that every projection uses the same ones.
const V: readonly [number, number, number] = [VIEW_DIRECTION.x, VIEW_DIRECTION.y, VIEW_DIRECTION.z];
const R: readonly [number, number, number] = (() => {
  // right = forward x worldUp, forward = -V
  const x = V[2];
  const z = -V[0];
  const n = Math.hypot(x, z);
  return [x / n, 0, z / n] as const;
})();
const U: readonly [number, number, number] = [
  V[1] * R[2] - V[2] * R[1],
  V[2] * R[0] - V[0] * R[2],
  V[0] * R[1] - V[1] * R[0],
];
const dot = (a: readonly number[], x: number, y: number, z: number) => a[0] * x + a[1] * y + a[2] * z;

/** One building type's silhouette on the screen plane, origin at the mesh's own origin. */
export interface Occluder {
  type: string;
  u0: number;
  v0: number;
  cols: number;
  rows: number;
  /** Nearest (largest toward-camera) depth per cell; -Infinity where the mesh is absent. */
  depth: Float32Array;
  /** The type's max depth anywhere, for a cheap reject. */
  dMax: number;
  /** Plan extent of the mesh along game x and game y, world units (= tiles). */
  planW: number;
  planD: number;
}

/** Triangles of a GLB's default scene in WORLD units (MESH_SCALE applied), flat xyz triples. */
async function readTriangles(path: string): Promise<Float32Array[]> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const out: Float32Array[] = [];
  const visit = (node: GltfNode) => {
    const mesh = node.getMesh();
    if (mesh) {
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const idx = prim.getIndices();
        const n = idx ? idx.getCount() : pos.getCount();
        const tri = new Float32Array(n * 3);
        const p = [0, 0, 0];
        for (let i = 0; i < n; i++) {
          pos.getElement(idx ? idx.getScalar(i) : i, p);
          const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
          const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
          const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
          tri[i * 3] = x * MESH_SCALE;
          tri[i * 3 + 1] = y * MESH_SCALE;
          tri[i * 3 + 2] = z * MESH_SCALE;
        }
        out.push(tri);
      }
    }
    for (const c of node.listChildren()) visit(c);
  };
  for (const n of scene.listChildren()) visit(n);
  return out;
}

/** Rasterise a set of world-space triangles onto the screen plane, nearest depth per cell. */
export function rasterise(type: string, tris: Float32Array[]): Occluder {
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, dMax = -Infinity;
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const t of tris)
    for (let i = 0; i < t.length; i += 3) {
      xMin = Math.min(xMin, t[i]);
      xMax = Math.max(xMax, t[i]);
      zMin = Math.min(zMin, t[i + 2]);
      zMax = Math.max(zMax, t[i + 2]);
      const u = dot(R, t[i], t[i + 1], t[i + 2]);
      const v = dot(U, t[i], t[i + 1], t[i + 2]);
      const d = dot(V, t[i], t[i + 1], t[i + 2]);
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
      if (d > dMax) dMax = d;
    }
  const cols = Math.max(1, Math.ceil((uMax - uMin) / RASTER_RES) + 1);
  const rows = Math.max(1, Math.ceil((vMax - vMin) / RASTER_RES) + 1);
  const depth = new Float32Array(cols * rows).fill(-Infinity);
  for (const t of tris)
    for (let i = 0; i < t.length; i += 9) {
      const pu = [0, 0, 0], pv = [0, 0, 0], pd = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const x = t[i + 3 * k], y = t[i + 3 * k + 1], z = t[i + 3 * k + 2];
        pu[k] = (dot(R, x, y, z) - uMin) / RASTER_RES;
        pv[k] = (dot(U, x, y, z) - vMin) / RASTER_RES;
        pd[k] = dot(V, x, y, z);
      }
      const area = (pu[1] - pu[0]) * (pv[2] - pv[0]) - (pu[2] - pu[0]) * (pv[1] - pv[0]);
      if (Math.abs(area) < 1e-9) continue;
      const c0 = Math.max(0, Math.floor(Math.min(pu[0], pu[1], pu[2])));
      const c1 = Math.min(cols - 1, Math.ceil(Math.max(pu[0], pu[1], pu[2])));
      const r0 = Math.max(0, Math.floor(Math.min(pv[0], pv[1], pv[2])));
      const r1 = Math.min(rows - 1, Math.ceil(Math.max(pv[0], pv[1], pv[2])));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          // cell centre in raster units
          const x = c, y = r;
          const w0 = ((pu[1] - x) * (pv[2] - y) - (pu[2] - x) * (pv[1] - y)) / area;
          const w1 = ((pu[2] - x) * (pv[0] - y) - (pu[0] - x) * (pv[2] - y)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const d = w0 * pd[0] + w1 * pd[1] + w2 * pd[2];
          const k = r * cols + c;
          if (d > depth[k]) depth[k] = d;
        }
    }
  return { type, u0: uMin, v0: vMin, cols, rows, depth, dMax, planW: xMax - xMin, planD: zMax - zMin };
}

const occluderCache = new Map<string, Occluder | null>();

/** The standing mesh of a structure type, or null for a type that ships no GLB. */
export async function occluderFor(type: string): Promise<Occluder | null> {
  if (occluderCache.has(type)) return occluderCache.get(type) ?? null;
  const path = join(ROOT, 'art/meshes/buildings', `${type}.glb`);
  let occ: Occluder | null = null;
  try {
    occ = rasterise(type, await readTriangles(path));
  } catch {
    occ = null;
  }
  occluderCache.set(type, occ);
  return occ;
}

/** One placed building: its type's silhouette, shifted to where the renderer stands it. */
interface Placed {
  occ: Occluder;
  ou: number;
  ov: number;
  od: number;
  uLo: number;
  uHi: number;
  vLo: number;
  vHi: number;
  /** Structure index in the parsed map. */
  s: number;
  /** Uniform scale about the mesh origin: 1 as shipped; below 1 only in the `fit` what-if. */
  k: number;
}


/** Every building as the renderer places it: footprint centre, ground height there, MESH_SCALE. */
export async function placeBuildings(map: ParsedMap, fit = false): Promise<Placed[]> {
  const out: Placed[] = [];
  for (let s = 0; s < map.structures.length; s++) {
    const st = map.structures[s];
    const occ = await occluderFor(st.type);
    if (!occ) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of st.tiles) {
      const x = t % map.width, y = Math.floor(t / map.width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    // footprintCentre (units/footprint.ts): (min + max + 1) / 2, max inclusive.
    const cx = (minX + maxX + 1) / 2;
    const cy = (minY + maxY + 1) / 2;
    const wy = groundWorldY(map.elevation, map.width, map.height, cx, cy);
    // per_tile runs (walls, fences) are turned a quarter by the renderer to follow their
    // neighbours; both are under 0.6 world units tall and nearly square in plan at the scale
    // that matters here, so the turn is not modelled.
    const ou = dot(R, cx, wy, cy);
    const ov = dot(U, cx, wy, cy);
    const od = dot(V, cx, wy, cy);
    // The `fit` what-if (NOT what ships): the mesh scaled down, uniformly, until its plan fits
    // the footprint -- the renderer change that would shrink every town at once.
    const k = fit ? Math.min(1, (maxX - minX + 1) / occ.planW, (maxY - minY + 1) / occ.planD) : 1;
    out.push({
      occ,
      ou,
      ov,
      od,
      uLo: ou + occ.u0 * k,
      uHi: ou + (occ.u0 + occ.cols * RASTER_RES) * k,
      vLo: ov + occ.v0 * k,
      vHi: ov + (occ.v0 + occ.rows * RASTER_RES) * k,
      s,
      k,
    });
  }
  return out;
}

function pointHidden(placed: readonly Placed[], x: number, y: number, z: number): boolean {
  const u = dot(R, x, y, z);
  const v = dot(U, x, y, z);
  const d = dot(V, x, y, z);
  for (const p of placed) {
    if (u < p.uLo || u >= p.uHi || v < p.vLo || v >= p.vHi) continue;
    if (p.od + p.occ.dMax * p.k <= d) continue;
    const c = Math.floor(((u - p.ou) / p.k - p.occ.u0) / RASTER_RES + 0.5);
    const r = Math.floor(((v - p.ov) / p.k - p.occ.v0) / RASTER_RES + 0.5);
    if (c < 0 || r < 0 || c >= p.occ.cols || r >= p.occ.rows) continue;
    if (p.od + p.occ.depth[r * p.occ.cols + c] * p.k > d + 1e-4) return true;
  }
  return false;
}

/** Every building that hides a point, by structure index (design tooling: lets a caller ask
 *  "what if this one were lower" without re-rasterising). */
export function occludersOf(placed: readonly Placed[], x: number, y: number, z: number): number[] {
  const u = dot(R, x, y, z);
  const v = dot(U, x, y, z);
  const d = dot(V, x, y, z);
  const out: number[] = [];
  for (const p of placed) {
    if (u < p.uLo || u >= p.uHi || v < p.vLo || v >= p.vHi) continue;
    if (p.od + p.occ.dMax * p.k <= d) continue;
    const c = Math.floor(((u - p.ou) / p.k - p.occ.u0) / RASTER_RES + 0.5);
    const r = Math.floor(((v - p.ov) / p.k - p.occ.v0) / RASTER_RES + 0.5);
    if (c < 0 || r < 0 || c >= p.occ.cols || r >= p.occ.rows) continue;
    if (p.od + p.occ.depth[r * p.occ.cols + c] * p.k > d + 1e-4) out.push(p.s);
  }
  return out;
}

/** The rifleman's body sample points at tile (tx, ty), world xyz triples. */
export function bodySamples(map: ParsedMap, tx: number, ty: number): [number, number, number][] {
  const cx = tx + 0.5, cz = ty + 0.5;
  const g = tileGroundWorldY(map.elevation, map.width, map.height, tx, ty);
  const out: [number, number, number][] = [];
  for (const h of BODY_HEIGHTS) for (const l of BODY_LATERAL) out.push([cx + R[0] * l, g + h, cz + R[2] * l]);
  return out;
}

/** Share of a rifleman standing at tile (tx, ty)'s centre that buildings hide, 0..1. */
export function bodyHiddenShare(map: ParsedMap, placed: readonly Placed[], tx: number, ty: number): number {
  const cx = tx + 0.5, cz = ty + 0.5;
  const g = tileGroundWorldY(map.elevation, map.width, map.height, tx, ty);
  let hidden = 0, n = 0;
  for (const h of BODY_HEIGHTS)
    for (const l of BODY_LATERAL) {
      n++;
      if (pointHidden(placed, cx + R[0] * l, g + h, cz + R[2] * l)) hidden++;
    }
  return hidden / n;
}

// --- the fight tiles ------------------------------------------------------------------------

interface Mission {
  id: string;
  map: { file: string; player_start?: readonly number[] };
  objectives?: readonly { id: string; type: string; target?: string }[];
  enemy?: {
    garrison?: readonly { tag?: string; at?: readonly number[]; marker?: string }[];
    waves?: readonly { to?: string; units?: readonly { from?: string }[] }[];
  };
  starting_force?: readonly { tag?: string; at?: readonly number[]; marker?: string }[];
}

type Rect = [number, number, number, number];

/** An objective's target as rectangles on the map (a point is a 1x1 rect). */
function targetRects(mission: Mission, map: ParsedMap, target: string): Rect[] {
  if (map.zones[target]) return [map.zones[target]];
  if (map.markers[target]) {
    const [x, y] = map.markers[target];
    return [[Math.floor(x), Math.floor(y), 1, 1]];
  }
  const out: Rect[] = [];
  const places = [...(mission.enemy?.garrison ?? []), ...(mission.starting_force ?? [])];
  for (const p of places) {
    if (p.tag !== target) continue;
    const at = p.at ?? (p.marker ? map.markers[p.marker] : undefined);
    if (at) out.push([Math.floor(at[0]), Math.floor(at[1]), 1, 1]);
  }
  return out;
}

function nearestOpen(map: ParsedMap, x: number, y: number): [number, number] | null {
  for (let r = 0; r < 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx, ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
        if (map.blocked[ty * map.width + tx] === 0) return [tx, ty];
      }
  return null;
}

/** The foot path a flow field gives from (sx, sy) to (gx, gy), tile indices, or [] if none. */
function footPath(map: ParsedMap, s: [number, number], g: [number, number]): number[] {
  const f = new FlowField(map.width, map.height);
  f.compute(map.blocked, map.elevation, g[0], g[1]);
  const out: number[] = [];
  let x = s[0], y = s[1];
  for (let i = 0; i < map.width * map.height; i++) {
    out.push(y * map.width + x);
    if (x === g[0] && y === g[1]) return out;
    const d = f.dirs[y * map.width + x];
    if (d === DIR_NONE) return [];
    x += DIR_DX[d];
    y += DIR_DY[d];
  }
  return [];
}

const rectCentre = (r: Rect): [number, number] => [
  Math.floor(r[0] + (r[2] - 1) / 2),
  Math.floor(r[1] + (r[3] - 1) / 2),
];

/** Passable tiles a set of missions fights over on one map: objectives' surroundings + routes. */
export function fightTiles(map: ParsedMap, missions: readonly Mission[]): Set<number> {
  const set = new Set<number>();
  const add = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const t = y * map.width + x;
    if (map.blocked[t] === 0) set.add(t);
  };
  const corridor = (path: readonly number[]) => {
    for (const t of path) {
      const x = t % map.width, y = Math.floor(t / map.width);
      for (let dy = -ROUTE_HALF_WIDTH; dy <= ROUTE_HALF_WIDTH; dy++)
        for (let dx = -ROUTE_HALF_WIDTH; dx <= ROUTE_HALF_WIDTH; dx++) add(x + dx, y + dy);
    }
  };
  for (const m of missions) {
    const start = m.map.player_start;
    const startTile = start ? nearestOpen(map, Math.floor(start[0]), Math.floor(start[1])) : null;
    for (const o of m.objectives ?? []) {
      if (!o.target) continue;
      for (const r of targetRects(m, map, o.target)) {
        for (let y = r[1] - NEAR_OBJECTIVE; y < r[1] + r[3] + NEAR_OBJECTIVE; y++)
          for (let x = r[0] - NEAR_OBJECTIVE; x < r[0] + r[2] + NEAR_OBJECTIVE; x++) add(x, y);
        const [gx, gy] = rectCentre(r);
        const goal = nearestOpen(map, gx, gy);
        if (startTile && goal) corridor(footPath(map, startTile, goal));
      }
    }
    for (const w of m.enemy?.waves ?? []) {
      const to = w.to ? map.markers[w.to] : undefined;
      if (!to) continue;
      const goal = nearestOpen(map, Math.floor(to[0]), Math.floor(to[1]));
      for (const u of w.units ?? []) {
        const from = u.from ? map.markers[u.from] : undefined;
        if (!from || !goal) continue;
        const s = nearestOpen(map, Math.floor(from[0]), Math.floor(from[1]));
        if (s) corridor(footPath(map, s, goal));
      }
    }
  }
  return set;
}

export interface MapVisibility {
  map: string;
  missions: string[];
  fightTiles: number;
  hiddenTiles: number;
  /** Visible share of the fight tiles. */
  visible: number;
  /** Visible share of every passable tile, for context. */
  visibleWholeMap: number;
  /** The hidden fight tiles, for drawing. */
  hidden: Set<number>;
  fight: Set<number>;
}

export function loadParsedMap(id: string): ParsedMap {
  return parseMap(readJson(`data/maps/${id}.json`) as MapJson);
}

/** Measure one map against the missions that play on it. */
export async function measureMap(
  mapId: string,
  missionIds: readonly string[],
  mapOverride?: ParsedMap,
  fit = false
): Promise<MapVisibility> {
  const map = mapOverride ?? loadParsedMap(mapId);
  const missions = missionIds.map((id) => readJson(`data/missions/${id}.json`) as Mission);
  const placed = await placeBuildings(map, fit);
  const fight = fightTiles(map, missions);
  const hidden = new Set<number>();
  let passable = 0, passableHidden = 0;
  for (let t = 0; t < map.width * map.height; t++) {
    if (map.blocked[t] !== 0) continue;
    passable++;
    const x = t % map.width, y = Math.floor(t / map.width);
    if (bodyHiddenShare(map, placed, x, y) > HIDDEN_BODY_SHARE) {
      passableHidden++;
      if (fight.has(t)) hidden.add(t);
    }
  }
  return {
    map: mapId,
    missions: [...missionIds],
    fightTiles: fight.size,
    hiddenTiles: hidden.size,
    visible: fight.size === 0 ? 1 : 1 - hidden.size / fight.size,
    visibleWholeMap: passable === 0 ? 1 : 1 - passableHidden / passable,
    hidden,
    fight,
  };
}

/** Every map a campaign mission plays on, with the missions that play there. */
export function campaignMaps(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of campaignMissions()) {
    const list = out.get(m.map) ?? [];
    list.push(m.mission);
    out.set(m.map, list);
  }
  return out;
}

/** ASCII picture of a map with its hidden fight tiles: X hidden, + visible fight, rows as authored. */
export function drawVisibility(mapId: string, v: MapVisibility): string {
  const raw = readJson(`data/maps/${mapId}.json`) as MapJson;
  return raw.rows
    .map((row, y) =>
      [...row]
        .map((ch, x) => {
          const t = y * raw.width + x;
          if (v.hidden.has(t)) return 'X';
          if (v.fight.has(t)) return ch === '.' ? '+' : ch;
          return ch === '.' ? ' ' : ch;
        })
        .join('')
    )
    .join('\n');
}

// CLI: npx tsx tools/src/map_visibility.ts [--draw=<map id>]
if (process.argv[1] && process.argv[1].endsWith('map_visibility.ts')) {
  const draw = process.argv.find((a) => a.startsWith('--draw='))?.slice(7);
  const fit = process.argv.includes('--fit');
  const rows: MapVisibility[] = [];
  for (const [mapId, missions] of campaignMaps()) rows.push(await measureMap(mapId, missions, undefined, fit));
  if (fit) console.log('WHAT-IF --fit: every mesh scaled to fit its footprint (not what ships)');
  rows.sort((a, b) => a.visible - b.visible);
  console.log(`floor ${VISIBLE_FLOOR}  (fight tiles = within ${NEAR_OBJECTIVE} of an objective + 3-wide main routes)`);
  console.log('map                       fight  hidden  visible  whole-map  missions');
  for (const r of rows)
    console.log(
      `${r.map.padEnd(24)} ${String(r.fightTiles).padStart(6)} ${String(r.hiddenTiles).padStart(7)}  ${(r.visible * 100).toFixed(1).padStart(6)}%  ${(r.visibleWholeMap * 100).toFixed(1).padStart(8)}%  ${r.visible < VISIBLE_FLOOR ? 'UNDER ' : ''}${r.missions.join(',')}`
    );
  if (draw) {
    const r = rows.find((x) => x.map === draw);
    if (r) console.log('\n' + drawVisibility(draw, r));
  }
}
