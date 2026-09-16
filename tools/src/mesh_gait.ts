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

export interface RoleFootprint {
  /** Peak-to-peak travel of the worst vertex, split per axis: glTF
   *  `[x, y, z]` with **y up** and `+x` the contract's forward. */
  readonly axisTravelM: readonly [number, number, number];
  /** The highest the LOWEST *moving* vertex of the role ever gets, over the
   *  clip.
   *
   *  On a `boot` role this is the gait's FLOAT: a walker whose swing is
   *  longer than its hips can reach for has both feet off the ground at
   *  mid-stride, because a straight leg swung `theta` off vertical
   *  shortens its own reach to `L * cos(theta)` and nothing in this rig
   *  drops the hips to compensate. It is the one bound on stride growth
   *  that is a measurement rather than a matter of taste, which is why it
   *  is reported separately from `maxTravelM` rather than folded into it.
   *
   *  **"Moving" is load-bearing and was measured, not assumed.** Every rig
   *  in this tree that has a `down`/`wreck` clip carries a SECOND, prone
   *  copy of its boots in the same `boot` mesh, hidden during `move` by
   *  keying its own root's scale to zero (`rig.py`'s `death_root`,
   *  `import_meshy_mortar_team.py`'s two postures). Collapsed geometry is
   *  not absent geometry: it lands on its bone's own head, which on
   *  `rig.py`'s rigs is exactly z=0 and on the Meshy mortar team is
   *  -0.3875. Taken over ALL vertices this field therefore reads that
   *  collapsed point on every file and measures nothing at all. */
  readonly floatM: number;
  /** The lowest any moving vertex ever gets -- below 0 the role is under
   *  the ground plane. Same `activeFraction` filter as `floatM`. */
  readonly sinkM: number;
  /** How many of the role's vertices cleared the travel filter. */
  readonly activeVertexCount: number;
  readonly clipSeconds: number;
}

/** A vertex counts as part of the gait when its own peak-to-peak travel is
 *  at least this fraction of the worst vertex's. Hidden collapsed geometry
 *  travels exactly zero, so any positive threshold excludes it; half is
 *  chosen so that the planted sole -- which travels the full stride in the
 *  model frame and is the vertex the float question is actually about --
 *  cannot fall out of the set. */
export const ACTIVE_TRAVEL_FRACTION = 0.5;

/**
 * The same skinning pass `measureRoleTravel` makes, reported as geometry
 * rather than as one distance: where the role's travel actually goes (a
 * long step and a high heel kick are the same number to `maxTravelM`, and
 * they do not look the same), and how far off the ground it floats.
 *
 * Deliberately a second REPORT over the one skinning implementation, never
 * a second implementation -- see `skinPoint`'s own note.
 */
export function measureRoleFootprint(path: string, role: string, clip: string): RoleFootprint {
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
  const sampleAt = (s: number) => {
    const t = start + ((end - start) * s) / SAMPLES;
    return computeSkinMats(skin, nodeWorlds(glb, tracks, t), ibm);
  };

  for (let s = 0; s < SAMPLES; s++) {
    const skinMats = sampleAt(s);
    for (let v = 0; v < n; v++) {
      const o = skinPoint(pos, joints, weights, v, skinMats);
      for (let a = 0; a < 3; a++) {
        if (o[a] < lo[v * 3 + a]) lo[v * 3 + a] = o[a];
        if (o[a] > hi[v * 3 + a]) hi[v * 3 + a] = o[a];
      }
    }
  }

  const travel = new Float64Array(n);
  let best = 0;
  for (let v = 0; v < n; v++) {
    travel[v] = Math.hypot(hi[v * 3] - lo[v * 3], hi[v * 3 + 1] - lo[v * 3 + 1], hi[v * 3 + 2] - lo[v * 3 + 2]);
    if (travel[v] > travel[best]) best = v;
  }
  const gate = travel[best] * ACTIVE_TRAVEL_FRACTION;
  const active: number[] = [];
  for (let v = 0; v < n; v++) if (travel[v] >= gate) active.push(v);

  let floatM = -Infinity;
  let sinkM = Infinity;
  for (let s = 0; s < SAMPLES; s++) {
    const skinMats = sampleAt(s);
    let lowestNow = Infinity;
    for (const v of active) {
      const y = skinPoint(pos, joints, weights, v, skinMats)[1];
      if (y < lowestNow) lowestNow = y;
    }
    if (lowestNow > floatM) floatM = lowestNow;
    if (lowestNow < sinkM) sinkM = lowestNow;
  }

  return {
    axisTravelM: [hi[best * 3] - lo[best * 3], hi[best * 3 + 1] - lo[best * 3 + 1], hi[best * 3 + 2] - lo[best * 3 + 2]],
    floatM,
    sinkM,
    activeVertexCount: active.length,
    clipSeconds: end - start,
  };
}

export interface FigureFacing {
  /** The head joint's own node name, e.g. `mil0_head` or `f0_Head`. */
  readonly joint: string;
  /** Circular mean of the sampled bearings -- see `circularMeanDeg`. */
  readonly meanDeg: number;
  /** The sample with the smallest signed deviation from `meanDeg` (wrapped
   *  to (-180, 180], then added back), NOT the smallest raw bearing. */
  readonly minDeg: number;
  /** The sample with the largest signed deviation from `meanDeg`, by the
   *  same convention as `minDeg`. */
  readonly maxDeg: number;
  /** This joint's own world scale is zero for the WHOLE clip, so nothing it
   *  drives is on screen and `meanDeg` is a bearing of geometry the player
   *  never sees.
   *
   *  **Not a corner case -- it is how every two-posture rig in this tree
   *  works.** `rig.py` hides a figure's prone `death_root` during
   *  `idle`/`move`/`fire` and its living `root` during `down`/`wreck` by
   *  keying the other one's scale to 0, and
   *  `import_meshy_mortar_team.py` hides a whole kneeling tableau during
   *  `move` the same way. Collapsed is not absent: the joint still has a
   *  position, its vertices still skin to it, and this function still
   *  returns a confident-looking angle for it.
   *
   *  That is exactly what happened to `meshy_mortar_team.glb`. Its `move`
   *  posture is a SEPARATE standing rig whose bones are `f<N>_st_*` and
   *  which has no head bone at all (`STAND_CHAIN` is root/pelvis/chest plus
   *  the leg columns), so `HEAD_JOINT_RE` matches only the hidden KNEELING
   *  heads and the +84 degrees the gait design recorded for that clip is a
   *  reading of a rig scaled to nothing. Pinned by `mesh_gait.test.ts`. */
  readonly hiddenInClip: boolean;
}

/** `kit.py` rigs suffix a head bone `_head`; the Meshy TEAM rigs suffix
 *  `_Head` (`f0_`/`f1_`/`f2_`, one prefix per figure in the file). Both
 *  pipelines are in this tree and this instrument must read both.
 *
 *  The leading `(?:^|_)` is not cosmetic. A SINGLE-figure GLB carries no
 *  figure prefix at all -- `art/meshes/civilians/*.glb` name the bone plainly
 *  `Head` -- so a bare `/_(head|Head)$/` matched nothing there and
 *  `measureFacing` returned an EMPTY array for all four civilians rather than
 *  raising. Measured 2026-09-16 while taking Task 3's baseline: every civilian
 *  clip read as zero figures, and the `for (const f of figs)` shape every
 *  caller uses turns that into a silent pass. Hence the `headJoints.length`
 *  guard in `measureFacing` as well -- the regex fix alone would have left the
 *  next unprefixed rig failing the same silent way. */
const HEAD_JOINT_RE = /(?:^|_)(head|Head)$/;

/** Largest mean axis scale a joint may carry and still count as hidden. The
 *  two-posture rigs in this tree key the inactive side's root scale to a
 *  literal 0, so anything above a rounding error is live. */
const HIDDEN_SCALE = 1e-6;

/** Mean length of a world matrix's three basis vectors -- the joint's own
 *  scale, whatever rotation it carries. */
function jointScale(m: Mat4): number {
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  return (sx + sy + sz) / 3;
}

/** `deg` wrapped into `(-180, 180]`. Assumes `|deg| < 360`, which every
 *  caller here satisfies (a difference of two already-wrapped bearings). */
function wrapDeg(deg: number): number {
  if (deg > 180) return deg - 360;
  if (deg <= -180) return deg + 360;
  return deg;
}

/**
 * Circular mean of a list of bearings in degrees, plus a min/max that stays
 * meaningful across the +/-180 wrap.
 *
 * A plain arithmetic mean of angles is wrong at exactly the place this
 * instrument most needs to be right: two samples at +179 deg and -179 deg
 * -- two degrees apart on the circle -- average to 0 deg, which reads as
 * "facing forward" for a figure that is actually facing backward. The
 * defects `measureFacing` exists to catch (KDF rifleman firing at -156 deg,
 * a suppressed figure going to ground at -163 deg) cluster at exactly this
 * discontinuity, so a silent collapse to ~0 deg would be the one failure
 * mode that lets a broken clip through the very gate built to catch it.
 *
 * The fix is the standard one: treat each bearing as a unit vector
 * `(cos, sin)`, average the vectors, and `atan2` the result back to an
 * angle. `minDeg`/`maxDeg` cannot be a plain min/max of the wrapped degrees
 * either -- e.g. the pair above has a naive "min" of -179 and "max" of +179,
 * a reported 358 deg spread for two samples that are 2 deg apart. Instead
 * each sample is expressed as its signed deviation from the circular mean
 * (wrapped to `(-180, 180]` via `wrapDeg`), and `minDeg`/`maxDeg` are the
 * mean plus the smallest/largest of those deviations -- so the reported
 * range is always the true, compact window around the mean, and may read
 * outside `(-180, 180]` itself (e.g. a mean of 170 deg with a deviation of
 * +15 deg reports as 185 deg) rather than wrap a second time and hide the
 * spread again.
 */
export function circularMeanDeg(bearingsDeg: readonly number[]): {
  readonly meanDeg: number;
  readonly minDeg: number;
  readonly maxDeg: number;
} {
  if (bearingsDeg.length === 0) throw new Error('circularMeanDeg: no bearings');
  let sx = 0, sy = 0;
  for (const deg of bearingsDeg) {
    const rad = (deg * Math.PI) / 180;
    sx += Math.cos(rad);
    sy += Math.sin(rad);
  }
  const meanDeg = (Math.atan2(sy, sx) * 180) / Math.PI;
  let minDev = Infinity, maxDev = -Infinity;
  for (const deg of bearingsDeg) {
    const dev = wrapDeg(deg - meanDeg);
    if (dev < minDev) minDev = dev;
    if (dev > maxDev) maxDev = dev;
  }
  return { meanDeg, minDeg: meanDeg + minDev, maxDeg: meanDeg + maxDev };
}

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
 * `maxDeg` are `circularMeanDeg` of those sampled bearings (see its own doc
 * comment for why a plain arithmetic mean is wrong here), so a clip that
 * sweeps (an `idle` turning in place) is visible as a wide min-max spread
 * and not just averaged away.
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
 * Both of those numbers are of the clips as they stood when the comparison
 * was made, and re-measuring today will not reproduce the second one:
 * `sarim_rifles`'s `moveFire` was rebuilt on 2026-09-16 (it bound a 0.2 m/s
 * walk-and-shoot and is now the run's legs under the same firing upper body)
 * and its face reads **+15.5**. The negative result is about the METHOD and
 * stands regardless; the pair of numbers is a snapshot.
 *
 * ## `jointPattern`, and the rig this instrument could not read
 *
 * The default is `HEAD_JOINT_RE`, which is what every caller wants and what
 * every rig in this tree but one carries. `meshy_mortar_team.glb` is the
 * exception: its `move` posture is a SECOND, standing rig whose bones are
 * `f<N>_st_*` and which has no head bone at all, so the default matches only
 * that file's hidden KNEELING heads and returns a bearing of geometry the
 * player never sees. Pass `/_st_chest$/` to read the rig that is actually on
 * screen. `hiddenInClip` is what makes the difference visible rather than
 * having to be known.
 *
 * Throws when `path` has no `face` mesh, no clip named `clip`, or no joint
 * `jointPattern` recognises -- a rig missing the role, the clip or the
 * joint this instrument reads is a contract failure, not a facing of zero.
 * The third of those was added 2026-09-16: an unrecognised head joint used to
 * return `[]`, which every caller in this tree spells as a `for` loop over the
 * result and therefore reads as "measured, and fine".
 */
export function measureFacing(path: string, clip: string, jointPattern: RegExp = HEAD_JOINT_RE): FigureFacing[] {
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
    .filter((j) => jointPattern.test(j.name));
  if (headJoints.length === 0) {
    throw new Error(
      `${path}: no joint matching ${jointPattern} in the skin that drives "${role}" -- ` +
        `measureFacing needs one per figure (have ${skin.joints.length} joints)`
    );
  }

  const vertsForSkinIndex = new Map<number, number[]>();
  for (const { skinIndex } of headJoints) vertsForSkinIndex.set(skinIndex, []);
  for (let v = 0; v < pos.count; v++) {
    for (let k = 0; k < 4; k++) {
      if (weights.data[v * 4 + k] <= 0.5) continue;
      vertsForSkinIndex.get(joints.data[v * 4 + k])?.push(v);
    }
  }

  // The SECOND route to an empty return, and it has to be closed here rather
  // than left to the caller. The throw above catches a rig with no head JOINT;
  // this catches a rig whose head joint owns no dominant `face` VERTEX -- a
  // future rig that weights the face to `neck`, say. Skipping such a joint
  // silently and returning `[]` is the exact shape that made this function
  // blind to all four civilians while every caller's `for (const f of figs)`
  // passed in 0 ms. Measured across all 82 shipped GLBs: no head joint owns
  // zero dominant face vertices, so this is unreachable today and is here so
  // it stays that way.
  const empty = headJoints.filter((j) => (vertsForSkinIndex.get(j.skinIndex) ?? []).length === 0);
  if (empty.length === headJoints.length) {
    throw new Error(
      `${path}: every head joint (${empty.map((j) => j.name).join(', ')}) owns no "${role}" ` +
        `vertex weighted above 0.5 -- measureFacing cannot read a bearing without one`
    );
  }

  const results: FigureFacing[] = [];
  for (const { jointNode, skinIndex, name } of headJoints) {
    const verts = vertsForSkinIndex.get(skinIndex) ?? [];
    if (verts.length === 0) continue;
    const bearings: number[] = [];
    let hiddenInClip = true;
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
      if (hiddenInClip && jointScale(headWorld) > HIDDEN_SCALE) hiddenInClip = false;
    }
    results.push({ joint: name, hiddenInClip, ...circularMeanDeg(bearings) });
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
