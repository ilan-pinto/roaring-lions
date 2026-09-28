/**
 * Unit footprints for the A4 selection ring (GH-186, Task 1).
 *
 * Reads each shipped unit GLB's JSON chunk straight off disk (no three), takes
 * every mesh primitive's `POSITION` accessor `min`/`max`, carries the eight box
 * corners through the node hierarchy, and reports the half-diagonal of the
 * ground-plane (X, Z) extent in TILES -- world metres times `MESH_SCALE`, which
 * is imported rather than retyped. `readability.ts` clears its ring radii
 * against this table: `radius >= 1.15 x footprint` per class.
 *
 * Run: `cd tools && npx tsx src/perf/unit-footprints.ts`
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { units } from '../../../packages/data/src/index';
import { unitTypeFromJson, type UnitTypeJson } from '../../../packages/sim/src/sim';
import { MESH_SCALE } from '../../../packages/render/src/three/units/mesh-anim';
import { RIGGED_UNIT_MESHES, VEHICLE_UNIT_MESHES } from '../../../packages/app/src/mesh-catalogue';
import { ringClassOf, type RingClass } from '../../../packages/render/src/three/units/readability';

interface GltfNode {
  name?: string;
  skin?: number;
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfJson {
  accessors?: { min?: number[]; max?: number[] }[];
  meshes?: { primitives: { attributes: { POSITION?: number } }[] }[];
  nodes?: GltfNode[];
  scene?: number;
  scenes?: { nodes?: number[] }[];
}

/** Parses a GLB's JSON chunk. */
export function readGlbJson(bytes: ArrayBuffer | Uint8Array): GltfJson {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const len = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  return JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + len))) as GltfJson;
}

type Mat = number[]; // column-major 4x4
const identity: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const DEAD_NODE = /^WRECK_|death/i;

function mul(a: Mat, b: Mat): Mat {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function local(n: GltfNode): Mat {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export interface Footprint {
  /** Ground-plane extent in glTF metres, node transforms applied. */
  readonly extentX: number;
  readonly extentZ: number;
  /** Half-diagonal of that extent, in metres. */
  readonly halfDiagonalM: number;
  /** The same, in tiles (x MESH_SCALE). */
  readonly halfDiagonalTiles: number;
}

/** Footprint of everything reachable from the default scene. */
export function footprintOf(gltf: GltfJson): Footprint {
  const nodes = gltf.nodes ?? [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const visit = (i: number, parent: Mat): void => {
    const n = nodes[i];
    const m = mul(parent, local(n));
    // Per the glTF spec a SKINNED mesh node's own transform is ignored (its
    // vertices are already placed by the skin), so those use the identity.
    const mm = n.skin !== undefined ? identity : m;
    // `WRECK_*` / `death*` nodes are hidden while the unit lives, so they
    // do not set the footprint of a standing unit.
    if (n.mesh !== undefined && !DEAD_NODE.test(n.name ?? '')) {
      for (const prim of gltf.meshes?.[n.mesh]?.primitives ?? []) {
        const acc = gltf.accessors?.[prim.attributes.POSITION ?? -1];
        if (!acc?.min || !acc.max) continue;
        for (let c = 0; c < 8; c++) {
          const p = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
          const wx = mm[0] * p[0] + mm[4] * p[1] + mm[8] * p[2] + mm[12];
          const wz = mm[2] * p[0] + mm[6] * p[1] + mm[10] * p[2] + mm[14];
          minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
          minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  for (const r of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) visit(r, identity);
  if (!Number.isFinite(minX)) throw new Error('no POSITION min/max found');
  const extentX = maxX - minX;
  const extentZ = maxZ - minZ;
  const halfDiagonalM = Math.hypot(extentX / 2, extentZ / 2);
  return { extentX, extentZ, halfDiagonalM, halfDiagonalTiles: halfDiagonalM * MESH_SCALE };
}

export interface FootprintRow {
  readonly unit: string;
  readonly ringClass: RingClass;
  /** Every variant file's half-diagonal in tiles; the row carries the largest. */
  readonly halfDiagonalTiles: number | null;
  readonly file: string | null;
}

const ART = resolve(dirname(fileURLToPath(import.meta.url)), '../../../art/meshes');

export function unitFootprintTable(): FootprintRow[] {
  const rows: FootprintRow[] = [];
  for (const [id, json] of Object.entries(units)) {
    const t = unitTypeFromJson(json as unknown as UnitTypeJson);
    const ringClass = ringClassOf(t);
    const files = RIGGED_UNIT_MESHES[id]?.files ?? (VEHICLE_UNIT_MESHES[id] ? [VEHICLE_UNIT_MESHES[id]] : []);
    let best: number | null = null;
    let bestFile: string | null = null;
    for (const f of files) {
      const fp = footprintOf(readGlbJson(readFileSync(resolve(ART, f)))).halfDiagonalTiles;
      if (best === null || fp > best) { best = fp; bestFile = f; }
    }
    rows.push({ unit: id, ringClass, halfDiagonalTiles: best, file: bestFile });
  }
  return rows;
}

/**
 * Units left out of their class's maximum, with the reason. `dozer_d9` is a
 * TRACKED VEHICLE the sim classes `foot`: its role is `engineer`, which is in
 * the sim's FOOT_ROLES, and `mobility.wheeled` is not authored on it, so
 * `ringClassOf` returns 'foot'. Its 1.26-tile hull would drive the whole foot
 * ring to 1.45 tiles -- three times a rifleman -- so it is reported, not
 * counted. Fixing it means authoring `wheeled: true` on the D9, which moves
 * its pathing domain (sim data) and is not this plan's call.
 */
export const CLASS_MAX_EXCLUDED: Readonly<Record<string, string>> = {
  dozer_d9: 'tracked vehicle classed foot by the sim (engineer role, wheeled unauthored)',
};

/** Largest measured half-diagonal per class, in tiles (0 when a class has no GLB). */
export function maxPerClass(
  rows: readonly FootprintRow[],
  excluded: Readonly<Record<string, string>> = CLASS_MAX_EXCLUDED
): Record<RingClass, { tiles: number; unit: string | null }> {
  const out: Record<RingClass, { tiles: number; unit: string | null }> = {
    foot: { tiles: 0, unit: null }, light: { tiles: 0, unit: null }, armour: { tiles: 0, unit: null }, air: { tiles: 0, unit: null },
  };
  for (const r of rows) {
    if (excluded[r.unit] !== undefined) continue;
    if (r.halfDiagonalTiles !== null && r.halfDiagonalTiles > out[r.ringClass].tiles) out[r.ringClass] = { tiles: r.halfDiagonalTiles, unit: r.unit };
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = unitFootprintTable();
  for (const r of [...rows].sort((a, b) => a.ringClass.localeCompare(b.ringClass) || a.unit.localeCompare(b.unit)))
    console.log(`${r.ringClass.padEnd(7)} ${r.unit.padEnd(16)} ${r.halfDiagonalTiles === null ? '(no GLB)' : r.halfDiagonalTiles.toFixed(3)}  ${r.file ?? ''}`);
  for (const [c, v] of Object.entries(maxPerClass(rows))) console.log(`max ${c.padEnd(7)} ${v.tiles.toFixed(3)} tiles  ${v.unit ?? ''}  x1.15 = ${(v.tiles * 1.15).toFixed(3)}`);
}
