/**
 * Does a mesh unit's `move` clip actually WALK, or does it slide?
 *
 * Issue #145: `mortar_team` drew a Meshy asset whose rig had thirteen joints
 * and no leg bones at all, so `move` was a torso bob while the unit crossed
 * 1.30 m of ground per cycle. Nothing in the test suite could see that --
 * `validate:meshes` checks palette, silhouette and the role vocabulary, and
 * `mesh-unit.test.ts` checks the loader against a hand-authored fixture. Both
 * pass on a legless rig. This module is the missing instrument: it reads a
 * shipped `art/meshes/*.glb`, skins its `boot` mesh with its own animated
 * joints, and reports how far the boots actually travel in one `move` cycle.
 *
 * ## Why the `boot` role and not the root
 *
 * A root bob is exactly what a slide looks like from the root. The boots are
 * the only geometry whose motion the eye reads as a gait, and they are the
 * one role every infantry GLB in this tree carries.
 *
 * ## What "travel" means here, precisely
 *
 * Per vertex, over `SAMPLES` evenly spaced instants of the clip: the
 * per-axis range (max - min), taken as a vector, then its norm. Reported as
 * the MAX over the mesh's vertices (the leading foot) and the MEDIAN (the
 * whole mesh, so one stray vertex cannot carry a claim). The frame is the
 * model's own -- the renderer translates the root across the world, so a
 * walking foot moves BACKWARD in this frame during stance and forward during
 * swing, and one full gait cycle displaces it by the ground the unit covers.
 * That is why the target below is the ground distance itself and not some
 * fraction of it.
 *
 * No three.js here on purpose. `GLTFLoader` wants a DOM-ish environment and
 * `SkinnedMesh` skins on the GPU; this reads the bytes and does the four-
 * influence blend in TypeScript, which is both testable in `environment:
 * 'node'` and independent of the runtime it is meant to catch bugs in.
 */
import { readFileSync } from 'node:fs';

/** Sim ticks are 20 Hz and the clip is real time; both numbers below come
 *  from the shipped data rather than from this file. */
export const MESH_UNITS_PER_TILE = 3.0;

/** How many instants of the clip are sampled. Two per exported frame at the
 *  16-frame `move` length every team in this tree uses. */
export const SAMPLES = 40;

type Gltf = {
  nodes?: { name?: string; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number; skin?: number }[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number> }[] }[];
  skins?: { joints: number[]; inverseBindMatrices?: number }[];
  animations?: { name?: string; channels: { sampler: number; target: { node?: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  materials?: unknown[];
};

export interface GlbFile {
  readonly json: Gltf;
  readonly bin: Uint8Array;
}

/** Splits a `.glb` into its JSON chunk and its binary chunk. */
export function readGlb(path: string): GlbFile {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let off = 12;
  let json: Gltf | null = null;
  let bin: Uint8Array | null = null;
  while (off + 8 <= buf.byteLength) {
    const len = dv.getUint32(off, true);
    const kind = dv.getUint32(off + 4, true);
    const body = new Uint8Array(buf.buffer, buf.byteOffset + off + 8, len);
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body)) as Gltf;
    else if (kind === 0x004e4942) bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json || !bin) throw new Error(`${path}: missing JSON or BIN chunk`);
  return { json, bin };
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** One accessor, flattened to a `Float64Array` of `count * components`.
 *  Integer component types come back unnormalised, which is what joint
 *  indices want; weights in this tree are always FLOAT. */
export function readAccessor(glb: GlbFile, index: number): { data: Float64Array; components: number; count: number } {
  const acc = glb.json.accessors?.[index];
  if (!acc) throw new Error(`accessor ${index} missing`);
  const comps = TYPE_COUNT[acc.type];
  const size = COMPONENT_SIZE[acc.componentType];
  const out = new Float64Array(acc.count * comps);
  if (acc.bufferView === undefined) return { data: out, components: comps, count: acc.count };
  const bv = glb.json.bufferViews?.[acc.bufferView];
  if (!bv) throw new Error(`bufferView ${acc.bufferView} missing`);
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? size * comps;
  const dv = new DataView(glb.bin.buffer, glb.bin.byteOffset, glb.bin.byteLength);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < comps; c++) {
      const at = base + i * stride + c * size;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = dv.getFloat32(at, true); break;
        case 5125: v = dv.getUint32(at, true); break;
        case 5123: v = dv.getUint16(at, true); break;
        case 5122: v = dv.getInt16(at, true); break;
        case 5121: v = dv.getUint8(at); break;
        default: v = dv.getInt8(at); break;
      }
      out[i * comps + c] = v;
    }
  }
  return { data: out, components: comps, count: acc.count };
}

type Mat4 = Float64Array;

/** Column-major, glTF's own convention, so a `matrix` array can be used raw. */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function compose(t: number[], q: number[], s: number[]): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * s[0]; m[1] = (xy + wz) * s[0]; m[2] = (xz - wy) * s[0];
  m[4] = (xy - wz) * s[1]; m[5] = (1 - (xx + zz)) * s[1]; m[6] = (yz + wx) * s[1];
  m[8] = (xz + wy) * s[2]; m[9] = (yz - wx) * s[2]; m[10] = (1 - (xx + yy)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}

function slerp(a: number[], b: number[], t: number): number[] {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { bb = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if (d > 0.9995) {
    const o = [a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t];
    const n = Math.hypot(o[0], o[1], o[2], o[3]) || 1;
    return [o[0] / n, o[1] / n, o[2] / n, o[3] / n];
  }
  const th = Math.acos(d);
  const s0 = Math.sin((1 - t) * th) / Math.sin(th);
  const s1 = Math.sin(t * th) / Math.sin(th);
  return [a[0] * s0 + bb[0] * s1, a[1] * s0 + bb[1] * s1, a[2] * s0 + bb[2] * s1, a[3] * s0 + bb[3] * s1];
}

interface Track {
  readonly times: Float64Array;
  readonly values: Float64Array;
  readonly components: number;
  readonly step: boolean;
}

/** Every animated node property of one clip, keyed `${node}:${path}`. */
function readClip(glb: GlbFile, name: string): { tracks: Map<string, Track>; start: number; end: number } {
  const anim = glb.json.animations?.find((a) => a.name === name);
  if (!anim) throw new Error(`clip "${name}" not in file`);
  const tracks = new Map<string, Track>();
  let start = Infinity;
  let end = -Infinity;
  for (const ch of anim.channels) {
    if (ch.target.node === undefined) continue;
    const s = anim.samplers[ch.sampler];
    const input = readAccessor(glb, s.input);
    const output = readAccessor(glb, s.output);
    start = Math.min(start, input.data[0]);
    end = Math.max(end, input.data[input.count - 1]);
    tracks.set(`${ch.target.node}:${ch.target.path}`, {
      times: input.data,
      values: output.data,
      components: output.components,
      step: s.interpolation === 'STEP',
    });
  }
  return { tracks, start, end };
}

function sampleTrack(tr: Track, t: number): number[] {
  const n = tr.times.length;
  let i = 0;
  while (i < n - 1 && tr.times[i + 1] < t) i++;
  const j = Math.min(i + 1, n - 1);
  const t0 = tr.times[i];
  const t1 = tr.times[j];
  const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  const c = tr.components;
  const a: number[] = [];
  const b: number[] = [];
  for (let k = 0; k < c; k++) { a.push(tr.values[i * c + k]); b.push(tr.values[j * c + k]); }
  if (tr.step || u === 0) return a;
  if (c === 4) return slerp(a, b, u);
  return a.map((v, k) => v + (b[k] - v) * u);
}

/** World matrix per node at clip time `t`, resolved through the whole
 *  hierarchy (a joint's parent may itself be animated -- reading a joint's
 *  own channel alone is the classic way to under-report a limb). */
function nodeWorlds(glb: GlbFile, tracks: Map<string, Track>, t: number): Mat4[] {
  const nodes = glb.json.nodes ?? [];
  const local: Mat4[] = nodes.map((n, i) => {
    if (n.matrix && !tracks.has(`${i}:translation`) && !tracks.has(`${i}:rotation`) && !tracks.has(`${i}:scale`)) {
      return Float64Array.from(n.matrix);
    }
    const tr = tracks.get(`${i}:translation`);
    const rt = tracks.get(`${i}:rotation`);
    const sc = tracks.get(`${i}:scale`);
    const T = tr ? sampleTrack(tr, t) : (n.translation ?? [0, 0, 0]);
    const R = rt ? sampleTrack(rt, t) : (n.rotation ?? [0, 0, 0, 1]);
    const S = sc ? sampleTrack(sc, t) : (n.scale ?? [1, 1, 1]);
    return compose(T, R, S);
  });
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => { for (const c of n.children ?? []) parent[c] = i; });
  const world: (Mat4 | null)[] = nodes.map(() => null);
  const resolve = (i: number): Mat4 => {
    const cached = world[i];
    if (cached) return cached;
    const p = parent[i];
    const m = p < 0 ? local[i] : multiply(resolve(p), local[i]);
    world[i] = m;
    return m;
  };
  return nodes.map((_, i) => resolve(i));
}

type Accessor = ReturnType<typeof readAccessor>;

/**
 * World * inverse-bind per skin joint, in the skin's own joint order.
 * Shared by every skinning consumer in this file (`measureRoleTravel`'s
 * travel measurement and `measureFacing`'s per-figure centroid) so this
 * step has exactly one implementation.
 */
function computeSkinMats(skin: { joints: number[] }, worlds: Mat4[], ibm: Accessor | null): Mat4[] {
  return skin.joints.map((jointNode, skinIndex) => {
    const w = worlds[jointNode];
    if (!ibm) return w;
    const inv = new Float64Array(16);
    for (let k = 0; k < 16; k++) inv[k] = ibm.data[skinIndex * 16 + k];
    return multiply(w, inv);
  });
}

/**
 * The four-influence skinning blend for one vertex, against skin matrices
 * already resolved by `computeSkinMats`. Shared for the same reason as
 * `computeSkinMats` above -- see the module docstring's "no three.js here"
 * note for why this is hand-rolled at all. A second copy of this blend is
 * the exact failure mode this project has been bitten by before: behaviour
 * in two places, so neither copy can be broken alone.
 */
function skinPoint(pos: Accessor, joints: Accessor, weights: Accessor, v: number, skinMats: Mat4[]): [number, number, number] {
  const px = pos.data[v * 3], py = pos.data[v * 3 + 1], pz = pos.data[v * 3 + 2];
  let ox = 0, oy = 0, oz = 0;
  for (let k = 0; k < 4; k++) {
    const w = weights.data[v * 4 + k];
    if (w === 0) continue;
    const m = skinMats[joints.data[v * 4 + k]];
    ox += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
    oy += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
    oz += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
  }
  return [ox, oy, oz];
}

export interface GaitMeasurement {
  /** Metres the mesh's own boots travel, peak to peak, worst vertex. */
  readonly maxTravelM: number;
  /** The same, at the median vertex. */
  readonly medianTravelM: number;
  /** Clip length in seconds, read from the file's own sampler times. */
  readonly clipSeconds: number;
  readonly vertexCount: number;
}

/**
 * Skins the mesh node named `role` with the clip's own animated joints and
 * measures how far its vertices move. Throws when the file has no such role
 * or no such clip -- an absent `boot` mesh is a contract failure, not a
 * measurement of zero.
 */
export function measureRoleTravel(path: string, role: string, clip: string): GaitMeasurement {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const meshes = glb.json.meshes ?? [];
  const nodeIndex = nodes.findIndex((n) => n.mesh !== undefined && (n.name === role || meshes[n.mesh]?.name === role));
  if (nodeIndex < 0) throw new Error(`${path}: no mesh node named "${role}"`);
  const node = nodes[nodeIndex];
  const prim = meshes[node.mesh as number].primitives[0];
  const pos = readAccessor(glb, prim.attributes.POSITION);
  const joints = readAccessor(glb, prim.attributes.JOINTS_0);
  const weights = readAccessor(glb, prim.attributes.WEIGHTS_0);
  const skin = glb.json.skins?.[node.skin as number];
  if (!skin) throw new Error(`${path}: mesh "${role}" is not skinned`);
  const ibmAcc = skin.inverseBindMatrices;
  const ibm = ibmAcc === undefined ? null : readAccessor(glb, ibmAcc);

  const { tracks, start, end } = readClip(glb, clip);
  const n = pos.count;
  const lo = new Float64Array(n * 3).fill(Infinity);
  const hi = new Float64Array(n * 3).fill(-Infinity);

  for (let s = 0; s < SAMPLES; s++) {
    const t = start + ((end - start) * s) / SAMPLES;
    const worlds = nodeWorlds(glb, tracks, t);
    const skinMats = computeSkinMats(skin, worlds, ibm);
    for (let v = 0; v < n; v++) {
      const o = skinPoint(pos, joints, weights, v, skinMats);
      for (let a = 0; a < 3; a++) {
        if (o[a] < lo[v * 3 + a]) lo[v * 3 + a] = o[a];
        if (o[a] > hi[v * 3 + a]) hi[v * 3 + a] = o[a];
      }
    }
  }

  const travel = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    travel[v] = Math.hypot(hi[v * 3] - lo[v * 3], hi[v * 3 + 1] - lo[v * 3 + 1], hi[v * 3 + 2] - lo[v * 3 + 2]);
  }
  const sorted = Array.from(travel).sort((a, b) => a - b);
  return {
    maxTravelM: sorted[sorted.length - 1],
    medianTravelM: sorted[Math.floor(sorted.length / 2)],
    clipSeconds: end - start,
    vertexCount: n,
  };
}

export interface FigureFacing {
  /** The head joint's own node name, e.g. `mil0_head` or `f0_Head`. */
  readonly joint: string;
  readonly meanDeg: number;
  readonly minDeg: number;
  readonly maxDeg: number;
}

/** `kit.py` rigs suffix a head bone `_head`; the Meshy rigs suffix `_Head`.
 *  Both pipelines are in this tree and this instrument must read both. */
const HEAD_JOINT_RE = /_(head|Head)$/;

/**
 * Which way does each figure in `path` face during `clip`, in degrees of
 * ground-plane bearing?
 *
 * ## Method
 *
 * For each head joint on the rig (matched by `HEAD_JOINT_RE`, above), take
 * the `face` role mesh's own vertices whose dominant skin influence --
 * `JOINTS_0` equal to that joint's index WITHIN THE SKIN'S OWN `joints`
 * array, `WEIGHTS_0 > 0.5` -- is that joint. Skin those vertices through the
 * live clip exactly the way `measureRoleTravel` skins the `boot` mesh (same
 * `computeSkinMats`/`skinPoint` blend, same `SAMPLES`-instant sampling), and
 * centroid them per instant. The bearing at that instant is `atan2(dz, dx)`
 * of (centroid − the head joint's own world position), read in the GLB's own
 * frame where the mesh-unit contract's forward is `+X` -- so `0` means
 * "facing forward" and positive is the figure's LEFT. `meanDeg`/`minDeg`/
 * `maxDeg` are that bearing's mean/min/max across the sampled instants, so a
 * clip that sweeps (an `idle` turning in place) is visible as a wide
 * min-max spread and not just averaged away.
 *
 * ## Why this is a per-figure head-joint reading and not a whole-mesh one
 *
 * The obvious rig-agnostic alternative -- the `face` mesh's own centroid
 * against the `uniform` mesh's own centroid, needing no bone names at all --
 * was implemented and measured, and it does NOT measure facing. It is
 * dominated by pack, keffiyeh and weapon-side asymmetry: it reports
 * `inf_squad`'s CORRECT `move` at **−86°** against its true **−5°**, and
 * `sarim_rifles`'s `moveFire` at **+148°** against its true **+42°**
 * (`docs/superpowers/specs/2026-09-15-infantry-gait-design.md` §3.5). Do not
 * re-derive that negative result -- it is recorded here so the next reader
 * does not pay for it twice.
 *
 * Throws when `path` has no `face` mesh or no clip named `clip` -- a rig
 * missing the role or clip this instrument reads is a contract failure, not
 * a facing of zero.
 */
export function measureFacing(path: string, clip: string): FigureFacing[] {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const meshes = glb.json.meshes ?? [];
  const role = 'face';
  const nodeIndex = nodes.findIndex((n) => n.mesh !== undefined && (n.name === role || meshes[n.mesh]?.name === role));
  if (nodeIndex < 0) throw new Error(`${path}: no mesh node named "${role}" -- measureFacing needs it`);
  const node = nodes[nodeIndex];
  const prim = meshes[node.mesh as number].primitives[0];
  const pos = readAccessor(glb, prim.attributes.POSITION);
  const joints = readAccessor(glb, prim.attributes.JOINTS_0);
  const weights = readAccessor(glb, prim.attributes.WEIGHTS_0);
  const skin = glb.json.skins?.[node.skin as number];
  if (!skin) throw new Error(`${path}: mesh "${role}" is not skinned`);
  const ibmAcc = skin.inverseBindMatrices;
  const ibm = ibmAcc === undefined ? null : readAccessor(glb, ibmAcc);

  let clipData: { tracks: Map<string, Track>; start: number; end: number };
  try {
    clipData = readClip(glb, clip);
  } catch {
    throw new Error(`${path}: no clip "${clip}" -- measureFacing needs it`);
  }
  const { tracks, start, end } = clipData;

  const headJoints = skin.joints
    .map((jointNode, skinIndex) => ({ jointNode, skinIndex, name: nodes[jointNode]?.name ?? '' }))
    .filter((j) => HEAD_JOINT_RE.test(j.name));

  const vertsForSkinIndex = new Map<number, number[]>();
  for (const { skinIndex } of headJoints) vertsForSkinIndex.set(skinIndex, []);
  for (let v = 0; v < pos.count; v++) {
    for (let k = 0; k < 4; k++) {
      if (weights.data[v * 4 + k] <= 0.5) continue;
      vertsForSkinIndex.get(joints.data[v * 4 + k])?.push(v);
    }
  }

  const results: FigureFacing[] = [];
  for (const { jointNode, skinIndex, name } of headJoints) {
    const verts = vertsForSkinIndex.get(skinIndex) ?? [];
    if (verts.length === 0) continue;
    const bearings: number[] = [];
    for (let s = 0; s < SAMPLES; s++) {
      const t = start + ((end - start) * s) / SAMPLES;
      const worlds = nodeWorlds(glb, tracks, t);
      const skinMats = computeSkinMats(skin, worlds, ibm);
      // Ground-plane centroid: y (height) plays no part in a bearing.
      let cx = 0, cz = 0;
      for (const v of verts) {
        const [ox, , oz] = skinPoint(pos, joints, weights, v, skinMats);
        cx += ox; cz += oz;
      }
      cx /= verts.length; cz /= verts.length;
      const headWorld = worlds[jointNode];
      const dx = cx - headWorld[12];
      const dz = cz - headWorld[14];
      bearings.push((Math.atan2(dz, dx) * 180) / Math.PI);
    }
    results.push({
      joint: name,
      meanDeg: bearings.reduce((a, b) => a + b, 0) / bearings.length,
      minDeg: Math.min(...bearings),
      maxDeg: Math.max(...bearings),
    });
  }
  return results;
}

/**
 * Metres of ground a unit covers in one `move` cycle: its own
 * `mobility.speed_tiles_s` times the clip's own measured length times
 * `MESH_UNITS_PER_TILE`. Both inputs are read, never assumed -- the whole
 * point of the gate is that a walk is measured against the ground the sim
 * actually moves the unit over.
 */
export function groundPerCycleM(speedTilesPerSecond: number, clipSeconds: number): number {
  return speedTilesPerSecond * clipSeconds * MESH_UNITS_PER_TILE;
}
