/**
 * Unit footprints for the A4 selection ring (GH-186, Task 1).
 *
 * Reads each shipped unit GLB's JSON chunk straight off disk (no three), takes
 * every mesh primitive's `POSITION` accessor `min`/`max` (static parts) or
 * skins the idle pose (figures), and reports the half-diagonal of the
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
import { RING_CLASS_OVERRIDE, ringClassOf, SELECTION_RING, type RingClass } from '../../../packages/render/src/three/units/readability';

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
interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  normalized?: boolean;
  count?: number;
  type?: string;
  min?: number[];
  max?: number[];
}
interface GltfJson {
  accessors?: GltfAccessor[];
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes?: { primitives: { attributes: { POSITION?: number; JOINTS_0?: number; WEIGHTS_0?: number } }[] }[];
  nodes?: GltfNode[];
  skins?: { joints: number[]; inverseBindMatrices?: number }[];
  animations?: {
    name?: string;
    samplers: { input: number; output: number }[];
    channels: { sampler: number; target: { node?: number; path: string } }[];
  }[];
  scene?: number;
  scenes?: { nodes?: number[] }[];
}

/** A GLB split into its JSON chunk and (when present) its BIN chunk. */
export function readGlb(bytes: ArrayBuffer | Uint8Array): { json: GltfJson; bin: Uint8Array | null } {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const len = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + len))) as GltfJson;
  const binAt = 20 + len;
  let bin: Uint8Array | null = null;
  if (binAt + 8 <= u8.byteLength && dv.getUint32(binAt + 4, true) === 0x004e4942) {
    bin = u8.subarray(binAt + 8, binAt + 8 + dv.getUint32(binAt, true));
  }
  return { json, bin };
}

/** Parses a GLB's JSON chunk. */
export function readGlbJson(bytes: ArrayBuffer | Uint8Array): GltfJson {
  return readGlb(bytes).json;
}

type Mat = number[]; // column-major 4x4
const identity: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** Nodes hidden while the unit lives (the death-swap geometry). */
const DEAD_NODE = /^WRECK_|death/i;

function mul(a: Mat, b: Mat): Mat {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function trs(t: number[], q: number[], sc: number[]): Mat {
  const [x, y, z, w] = q;
  const [sx, sy, sz] = sc;
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Reads an accessor as a flat float array (normalized integers are un-normalized). */
function readAccessor(json: GltfJson, bin: Uint8Array, index: number): Float64Array {
  const a = json.accessors?.[index];
  const bv = a?.bufferView === undefined ? undefined : json.bufferViews?.[a.bufferView];
  if (!a || !bv || a.count === undefined || a.type === undefined) throw new Error(`accessor ${index} unreadable`);
  const n = COMPONENTS[a.type];
  const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[a.componentType ?? 5126] ?? 4;
  const stride = bv.byteStride ?? size * n;
  const dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0));
  const out = new Float64Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < n; c++) {
      const at = i * stride + c * size;
      let v: number;
      switch (a.componentType ?? 5126) {
        case 5126: v = dv.getFloat32(at, true); break;
        case 5125: v = dv.getUint32(at, true); break;
        case 5123: v = dv.getUint16(at, true) / (a.normalized ? 65535 : 1); break;
        case 5121: v = dv.getUint8(at) / (a.normalized ? 255 : 1); break;
        case 5122: v = dv.getInt16(at, true) / (a.normalized ? 32767 : 1); break;
        default: v = dv.getInt8(at) / (a.normalized ? 127 : 1);
      }
      out[i * n + c] = v;
    }
  }
  return out;
}

export interface FootprintOptions {
  /** Clip whose FIRST keyframe poses skinned figures (default 'idle'). */
  readonly clip?: string;
  /** Static (unskinned) mesh nodes count only when their name matches. Default: all. */
  readonly include?: RegExp;
}

export interface Footprint {
  /** Ground-plane extent in glTF metres, node transforms applied. */
  readonly extentX: number;
  readonly extentZ: number;
  /** Half-diagonal of that extent, in metres. */
  readonly halfDiagonalM: number;
  /** The same, in tiles (x MESH_SCALE). */
  readonly halfDiagonalTiles: number;
  /** Static nodes left out by `include` (WRECK_/death nodes are always left out, unlisted). */
  readonly excluded: string[];
}

/**
 * Footprint of everything reachable from the default scene.
 *
 * Skinned meshes are posed at the first keyframe of `clip` (a standing figure,
 * not the T-pose the bind pose is) and skinned on the CPU; vertices the pose
 * scales to nothing (the death-swap geometry) are dropped. Static meshes use
 * their accessor box carried through the node chain.
 */
export function footprintOf(gltf: GltfJson, bin: Uint8Array | null = null, opts: FootprintOptions = {}): Footprint {
  const nodes = gltf.nodes ?? [];
  const excluded: string[] = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const grow = (x: number, z: number): void => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  };

  // Local TRS per node, overridden by the chosen clip's first keyframe.
  const trsOf = nodes.map((n) => ({
    t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1],
  }));
  const posed = new Set<number>();
  const anim = gltf.animations?.find((a) => a.name === (opts.clip ?? 'idle'));
  if (anim && bin) {
    for (const ch of anim.channels) {
      if (ch.target.node === undefined) continue;
      const out = readAccessor(gltf, bin, anim.samplers[ch.sampler].output);
      const dst = trsOf[ch.target.node];
      if (ch.target.path === 'translation') dst.t = [out[0], out[1], out[2]];
      else if (ch.target.path === 'rotation') dst.r = [out[0], out[1], out[2], out[3]];
      else if (ch.target.path === 'scale') dst.s = [out[0], out[1], out[2]];
      posed.add(ch.target.node);
    }
  }
  const localOf = (i: number): Mat => (nodes[i].matrix && !posed.has(i) ? nodes[i].matrix : trs(trsOf[i].t, trsOf[i].r, trsOf[i].s));

  const world: (Mat | undefined)[] = [];
  const walk = (i: number, parent: Mat): void => {
    world[i] = mul(parent, localOf(i));
    for (const c of nodes[i].children ?? []) walk(c, world[i] as Mat);
  };
  for (const r of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) walk(r, identity);

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const m = world[i];
    if (!m || n.mesh === undefined || DEAD_NODE.test(n.name ?? '')) continue;
    const skin = n.skin === undefined ? undefined : gltf.skins?.[n.skin];
    for (const prim of gltf.meshes?.[n.mesh]?.primitives ?? []) {
      const pos = prim.attributes.POSITION;
      if (skin && bin && prim.attributes.JOINTS_0 !== undefined && prim.attributes.WEIGHTS_0 !== undefined && pos !== undefined) {
        const p = readAccessor(gltf, bin, pos);
        const j = readAccessor(gltf, bin, prim.attributes.JOINTS_0);
        const w = readAccessor(gltf, bin, prim.attributes.WEIGHTS_0);
        const ibm = skin.inverseBindMatrices === undefined ? null : readAccessor(gltf, bin, skin.inverseBindMatrices);
        const jm = skin.joints.map((node, k) => mul(world[node] ?? identity, ibm ? Array.from(ibm.subarray(k * 16, k * 16 + 16)) : identity));
        for (let v = 0; v < p.length / 3; v++) {
          let x = 0, z = 0, sx = 0, sw = 0;
          for (let c = 0; c < 4; c++) {
            const wt = w[v * 4 + c];
            if (wt === 0) continue;
            const M = jm[j[v * 4 + c]];
            x += wt * (M[0] * p[v * 3] + M[4] * p[v * 3 + 1] + M[8] * p[v * 3 + 2] + M[12]);
            z += wt * (M[2] * p[v * 3] + M[6] * p[v * 3 + 1] + M[10] * p[v * 3 + 2] + M[14]);
            sx += wt * Math.hypot(M[0], M[1], M[2]);
            sw += wt;
          }
          if (sw > 0 && sx / sw > 1e-4) grow(x, z);
        }
        continue;
      }
      if (n.skin !== undefined) continue; // skinned but no readable skin data: nothing honest to add
      if (opts.include && !opts.include.test(n.name ?? '')) {
        if (!excluded.includes(n.name ?? '')) excluded.push(n.name ?? '');
        continue;
      }
      const acc = gltf.accessors?.[pos ?? -1];
      if (!acc?.min || !acc.max) continue;
      for (let c = 0; c < 8; c++) {
        const p = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
        grow(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]);
      }
    }
  }
  if (!Number.isFinite(minX)) throw new Error('no POSITION data found');
  const extentX = maxX - minX;
  const extentZ = maxZ - minZ;
  const halfDiagonalM = Math.hypot(extentX / 2, extentZ / 2);
  return { extentX, extentZ, halfDiagonalM, halfDiagonalTiles: halfDiagonalM * MESH_SCALE, excluded };
}

/**
 * Hull, not reach. Vehicle GLBs name their parts `hull_*` and `turret_*` (and
 * `rotor_*`); the turret parts carry the gun barrels and cannot be split from
 * them, and a turret sits inside the hull outline anyway, so a static vehicle
 * is measured from `hull_*` only. Rotor discs go the same way. Foot figures are
 * measured in their idle pose, so T-pose arms do not count.
 */
export const HULL_ONLY = /^hull_/;

/**
 * Types whose hull cannot be separated from the part that reaches: they fall
 * back to their class value and are flagged. The paramotor's `hull_hull` IS the
 * canopy and its rigging lines span it; there is no body part left to measure.
 */
export const HULL_INSEPARABLE: Readonly<Record<string, string>> = {
  paramotor: 'canopy is the hull_hull part and the rigging lines span it; fell back to the class value',
};

export interface FootprintRow {
  readonly unit: string;
  /** Class by the sim's flags, with `RING_CLASS_OVERRIDE` applied. */
  readonly ringClass: RingClass;
  /** Hull half-diagonal in tiles; null when there is no GLB or the hull is inseparable. */
  readonly halfDiagonalTiles: number | null;
  readonly file: string | null;
  /** Parts left out of the measurement, and why a null was returned. */
  readonly excluded: string[];
  readonly note: string | null;
}

const ART = resolve(dirname(fileURLToPath(import.meta.url)), '../../../art/meshes');

export function unitFootprintTable(): FootprintRow[] {
  const rows: FootprintRow[] = [];
  for (const [id, json] of Object.entries(units)) {
    const t = unitTypeFromJson(json as unknown as UnitTypeJson);
    const ringClass = RING_CLASS_OVERRIDE[id] ?? ringClassOf(t);
    const vehicleFile = VEHICLE_UNIT_MESHES[id];
    const files = RIGGED_UNIT_MESHES[id]?.files ?? (vehicleFile ? [vehicleFile] : []);
    let best: number | null = null;
    let bestFile: string | null = null;
    const excluded: string[] = [];
    for (const f of files) {
      const { json: gj, bin } = readGlb(readFileSync(resolve(ART, f)));
      const fp = footprintOf(gj, bin, { include: vehicleFile ? HULL_ONLY : undefined });
      for (const e of fp.excluded) if (!excluded.includes(e)) excluded.push(e);
      if (best === null || fp.halfDiagonalTiles > best) { best = fp.halfDiagonalTiles; bestFile = f; }
    }
    const note = HULL_INSEPARABLE[id] ?? null;
    rows.push({ unit: id, ringClass, halfDiagonalTiles: note ? null : best, file: bestFile, excluded, note });
  }
  return rows;
}

/** The per-type rule: max(class value, 1.15 x this type's own footprint), rounded UP to 0.01. */
export function radiusFor(row: FootprintRow, classRadii: Readonly<Record<RingClass, number>>): number {
  const classValue = classRadii[row.ringClass];
  if (row.halfDiagonalTiles === null) return classValue;
  return Math.max(classValue, Math.ceil(1.15 * row.halfDiagonalTiles * 100 - 1e-9) / 100);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = unitFootprintTable();
  const px = (r: number): number => r * 45.25;
  console.log('unit              class   footprint  radius  px@1   raised  excluded');
  for (const r of [...rows].sort((a, b) => a.ringClass.localeCompare(b.ringClass) || a.unit.localeCompare(b.unit))) {
    const rad = radiusFor(r, SELECTION_RING.radiusTiles);
    const raised = rad > SELECTION_RING.radiusTiles[r.ringClass];
    console.log(
      `${r.unit.padEnd(17)} ${r.ringClass.padEnd(7)} ${(r.halfDiagonalTiles === null ? '-' : r.halfDiagonalTiles.toFixed(3)).padStart(9)}  ${rad.toFixed(2).padStart(6)}  ${px(rad).toFixed(0).padStart(4)}   ${raised ? 'RAISED' : '      '}  ${r.file === null ? '(no GLB)' : r.excluded.join(',') || '-'}${r.note ? '  NOTE: ' + r.note : ''}`
    );
  }
  console.log('\nRADIUS_BY_TYPE = {');
  for (const r of rows) console.log(`  ${r.unit}: ${radiusFor(r, SELECTION_RING.radiusTiles).toFixed(2).replace(/0$/, '')},`);
  console.log('}');
}
