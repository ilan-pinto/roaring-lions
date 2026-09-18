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
  /** `pnpm gait:meshes` writes `rl_gait` onto the scene's own extras, and
   *  the renderer reads it from there (`parseGaitExtras`). Declared here so
   *  a node-side gate can read the SHIPPED declaration rather than a
   *  re-measurement of it -- the whole point of the declared-vs-measured
   *  check being that those two can disagree. */
  scene?: number;
  scenes?: { extras?: Record<string, unknown> }[];
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

/**
 * One role mesh's skinning inputs, resolved once.
 *
 * Extracted because there are now FOUR readers of the same eleven lines
 * (`measureRoleTravel`, `measureRoleFootprint`, `measureFacing`,
 * `measureWeaponAxis`) and a fourth hand copy is how the role-lookup rule
 * -- match the NODE name or the MESH name, whichever the exporter wrote --
 * drifts between them. `need` is appended to the two error messages so each
 * caller still says what it wanted the role for.
 */
interface SkinnedRole {
  readonly glb: GlbFile;
  readonly pos: Accessor;
  readonly joints: Accessor;
  readonly weights: Accessor;
  readonly skin: { joints: number[]; inverseBindMatrices?: number };
  readonly ibm: Accessor | null;
}

function loadSkinnedRole(path: string, role: string, need = ''): SkinnedRole {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const meshes = glb.json.meshes ?? [];
  const nodeIndex = nodes.findIndex(
    (n) => n.mesh !== undefined && (n.name === role || meshes[n.mesh]?.name === role)
  );
  if (nodeIndex < 0) throw new Error(`${path}: no mesh node named "${role}"${need}`);
  const node = nodes[nodeIndex];
  const prim = meshes[node.mesh as number].primitives[0];
  const skin = glb.json.skins?.[node.skin as number];
  if (!skin) throw new Error(`${path}: mesh "${role}" is not skinned`);
  const ibmAcc = skin.inverseBindMatrices;
  return {
    glb,
    pos: readAccessor(glb, prim.attributes.POSITION),
    joints: readAccessor(glb, prim.attributes.JOINTS_0),
    weights: readAccessor(glb, prim.attributes.WEIGHTS_0),
    skin,
    ibm: ibmAcc === undefined ? null : readAccessor(glb, ibmAcc),
  };
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
  const { glb, pos, joints, weights, skin, ibm } = loadSkinnedRole(path, role);

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
  /**
   * The single tracked vertex's own forward (`+x`) and height (`y`)
   * position at each of the `SAMPLES` sampled instants, in clip order.
   * Free -- the same skinning pass already visits this vertex once per
   * sample to build `axisTravelM`; this just keeps what it saw instead of
   * only the running min/max. Exists for a periodicity check: peak-to-peak
   * travel over a whole clip cannot tell a clip that bakes ONE gait cycle
   * from one that bakes two, and `gait-pass.ts`'s declared `cycleS` assumes
   * one. Not reported per-figure or per-vertex beyond the one already
   * selected as `axisTravelM`'s own vertex, which is deliberate: it is the
   * vertex with the most to say about the gait, and adding every vertex's
   * trace here would multiply this return value by the mesh's vertex count
   * for a check that needs exactly one representative signal.
   */
  readonly bestVertexTrace: {
    readonly forwardM: readonly number[];
    readonly heightM: readonly number[];
  };
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
export interface FigureTravel {
  /** The figure's own root joint -- the top-most ancestor of its bones that
   *  is itself a joint of this skin. `mil0_root`, `f1_Hips`, `Hips`. */
  readonly root: string;
  /** The joints under that root which dominantly own any of the role's
   *  vertices, sorted, for a message that names what was read. */
  readonly joints: readonly string[];
  readonly vertexCount: number;
  /** Peak-to-peak FORWARD (`+x`) travel of this figure's own worst vertex, in
   *  metres -- the quantity `RoleFootprint.axisTravelM[0]` reports for the
   *  pooled role, scoped to one figure. */
  readonly forwardTravelM: number;
  /** Every joint under this root stays collapsed for the whole clip, so this
   *  figure is not on screen. Each `rig.py` team hides a second, prone copy
   *  of its boots under a `death_root` during `move`, and
   *  `meshy_mortar_team` hides a whole kneeling tableau; without this flag
   *  the minimum over figures would be a permanent zero on thirteen files. */
  readonly hiddenInClip: boolean;
}

/**
 * The same skinning pass as `measureRoleFootprint`, reported PER FIGURE
 * instead of pooled -- a third report over the one skinning implementation,
 * never a second implementation (see `skinPoint`'s own note).
 *
 * ## Why this exists, and it is the defect GH-145 was raised about
 *
 * `measureRoleFootprint` takes `axisTravelM` from the single WORST vertex of
 * the whole `boot` role, and a team file pools two or three figures into that
 * one mesh. So a file where ONE rifleman's legs stop moving -- exactly the
 * legless-rig defect this module was written for -- reports the same number
 * as a file where nobody's do. Measured: stripping one of `militia_cell`'s
 * two figures of its hip, thigh, shin and pelvis channels leaves
 * `axisTravelM[0]` **identical at 1.4673**, and the whole gate green.
 * Thirteen of the fifteen gaited files carry more than one figure.
 *
 * ## Figures are found from the SKELETON, not from the names
 *
 * A vertex belongs to whichever joint dominantly influences it
 * (`WEIGHTS_0 > 0.5`); that joint belongs to whichever figure root it hangs
 * under, found by walking node parents while the parent is still a joint of
 * this skin. No name parsing, which matters because the three rig families
 * prefix their bones `demo_a_`, `mil0_` and `f0_` and the civilians not at
 * all, and because `meshy_mortar_team` carries TWO skeletons per figure
 * (`f0_root` kneeling and `f0_st_root` standing) that a prefix rule would
 * merge and that this correctly keeps apart.
 */
export function measureRoleTravelByFigure(
  path: string,
  role: string,
  clip: string
): FigureTravel[] {
  const { glb, pos, joints, weights, skin, ibm } = loadSkinnedRole(path, role);
  const nodes = glb.json.nodes ?? [];
  const { tracks, start, end } = readClip(glb, clip);

  // node index -> skin joint index, so "is my parent also a joint?" is O(1).
  const skinIndexOfNode = new Map<number, number>();
  skin.joints.forEach((nodeIndex, skinIndex) => skinIndexOfNode.set(nodeIndex, skinIndex));
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => { for (const c of n.children ?? []) parent[c] = i; });
  const rootOf = skin.joints.map((nodeIndex) => {
    let cur = nodeIndex;
    for (;;) {
      const p = parent[cur];
      if (p < 0 || !skinIndexOfNode.has(p)) return cur;
      cur = p;
    }
  });

  const owner = new Int32Array(pos.count).fill(-1);
  for (let v = 0; v < pos.count; v++) {
    for (let k = 0; k < 4; k++) {
      if (weights.data[v * 4 + k] > 0.5) {
        owner[v] = joints.data[v * 4 + k];
        break;
      }
    }
  }

  const lo = new Float64Array(pos.count).fill(Infinity);
  const hi = new Float64Array(pos.count).fill(-Infinity);
  const live = new Uint8Array(skin.joints.length);
  for (let s = 0; s < SAMPLES; s++) {
    const t = start + ((end - start) * s) / SAMPLES;
    const worlds = nodeWorlds(glb, tracks, t);
    const skinMats = computeSkinMats(skin, worlds, ibm);
    for (let j = 0; j < skin.joints.length; j++) {
      if (jointScale(worlds[skin.joints[j]]) > HIDDEN_SCALE) live[j] = 1;
    }
    for (let v = 0; v < pos.count; v++) {
      if (owner[v] < 0) continue;
      const x = skinPoint(pos, joints, weights, v, skinMats)[0];
      if (x < lo[v]) lo[v] = x;
      if (x > hi[v]) hi[v] = x;
    }
  }

  const byRoot = new Map<number, { joints: Set<string>; count: number; worst: number; live: boolean }>();
  for (let v = 0; v < pos.count; v++) {
    const j = owner[v];
    if (j < 0) continue;
    const root = rootOf[j];
    const entry = byRoot.get(root) ?? { joints: new Set<string>(), count: 0, worst: 0, live: false };
    entry.joints.add(nodes[skin.joints[j]]?.name ?? `joint${j}`);
    entry.count++;
    const span = hi[v] - lo[v];
    if (span > entry.worst) entry.worst = span;
    if (live[j] === 1) entry.live = true;
    byRoot.set(root, entry);
  }

  return [...byRoot.entries()]
    .map(([root, e]) => ({
      root: nodes[root]?.name ?? `node${root}`,
      joints: [...e.joints].sort(),
      vertexCount: e.count,
      forwardTravelM: e.worst,
      hiddenInClip: !e.live,
    }))
    .sort((a, b) => a.root.localeCompare(b.root));
}

export interface RootTravel {
  readonly root: string;
  /** Largest horizontal (x/z) distance from the first sample, metres. */
  readonly horizontalM: number;
  readonly startY: number;
  readonly endY: number;
  readonly liveAtStart: boolean;
}

/** The parentless joints of skin 0 -- one per figure on every shipped rig. */
function skinRoots(glb: GlbFile): number[] {
  const nodes = glb.json.nodes ?? [];
  const skin = glb.json.skins?.[0];
  if (!skin) throw new Error('no skin');
  const jointSet = new Set(skin.joints);
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => { for (const c of n.children ?? []) parent[c] = i; });
  return skin.joints.filter((j) => parent[j] < 0 || !jointSet.has(parent[j]));
}

/** Where each figure's root joint goes over `clip`: the fall gate's
 *  "no horizontal root motion, starts standing, ends prone" instrument. */
export function measureRootTravel(path: string, clip: string): RootTravel[] {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const { tracks, start, end } = readClip(glb, clip);
  const roots = skinRoots(glb);
  const first = nodeWorlds(glb, tracks, start);
  const out = roots.map((r) => ({
    root: nodes[r]?.name ?? `node${r}`,
    x0: first[r][12], y0: first[r][13], z0: first[r][14],
    liveAtStart: jointScale(first[r]) > HIDDEN_SCALE,
    horizontalM: 0, endY: first[r][13],
  }));
  for (let s = 1; s <= SAMPLES; s++) {
    const t = start + ((end - start) * s) / SAMPLES;
    const worlds = nodeWorlds(glb, tracks, t);
    roots.forEach((r, i) => {
      const m = worlds[r];
      const o = out[i];
      o.horizontalM = Math.max(o.horizontalM, Math.hypot(m[12] - o.x0, m[14] - o.z0));
      o.endY = m[13];
    });
  }
  return out.map((o) => ({ root: o.root, horizontalM: o.horizontalM, startY: o.y0, endY: o.endY, liveAtStart: o.liveAtStart }));
}

export function clipSeconds(path: string, clip: string): number {
  const glb = readGlb(path);
  const { start, end } = readClip(glb, clip);
  return end - start;
}

export interface JointPose {
  readonly name: string;
  readonly translation: [number, number, number];
  /** Unit quaternion (x, y, z, w) of the world rotation, scale removed. */
  readonly rotation: [number, number, number, number];
  readonly scale: number;
}

function quatFromMat(m: Mat4, scale: number): [number, number, number, number] {
  const s = scale > 0 ? 1 / scale : 0;
  const m00 = m[0] * s, m01 = m[4] * s, m02 = m[8] * s;
  const m10 = m[1] * s, m11 = m[5] * s, m12 = m[9] * s;
  const m20 = m[2] * s, m21 = m[6] * s, m22 = m[10] * s;
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const k = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / k; x = (m21 - m12) * k; y = (m02 - m20) * k; z = (m10 - m01) * k;
  } else if (m00 > m11 && m00 > m22) {
    const k = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / k; x = 0.25 * k; y = (m01 + m10) / k; z = (m02 + m20) / k;
  } else if (m11 > m22) {
    const k = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / k; x = (m01 + m10) / k; y = 0.25 * k; z = (m12 + m21) / k;
  } else {
    const k = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / k; x = (m02 + m20) / k; y = (m12 + m21) / k; z = 0.25 * k;
  }
  return [x, y, z, w];
}

/** Every skin-0 joint's world pose at the first or last frame of `clip`. */
export function measureJointPoses(path: string, clip: string, at: 'start' | 'end'): JointPose[] {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const skin = glb.json.skins?.[0];
  if (!skin) throw new Error(`${path}: no skin`);
  const { tracks, start, end } = readClip(glb, clip);
  const worlds = nodeWorlds(glb, tracks, at === 'start' ? start : end);
  return skin.joints.map((j) => {
    const m = worlds[j];
    const scale = jointScale(m);
    return {
      name: nodes[j]?.name ?? `node${j}`,
      translation: [m[12], m[13], m[14]],
      rotation: quatFromMat(m, scale),
      scale,
    };
  });
}

/** Angle between two unit quaternions, degrees, sign-agnostic. */
export function rotationDeltaDeg(a: readonly number[], b: readonly number[]): number {
  const d = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(d) * 180) / Math.PI;
}

export function measureRoleFootprint(path: string, role: string, clip: string): RoleFootprint {
  const { glb, pos, joints, weights, skin, ibm } = loadSkinnedRole(path, role);

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
  // `bestForwardM`/`bestHeightM`: the same `best` vertex `axisTravelM` is
  // built from, sampled at every instant rather than reduced to a min/max --
  // free here, since `skinMats` for this instant is already in hand for the
  // float/sink pass above.
  const bestForwardM: number[] = [];
  const bestHeightM: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const skinMats = sampleAt(s);
    let lowestNow = Infinity;
    for (const v of active) {
      const y = skinPoint(pos, joints, weights, v, skinMats)[1];
      if (y < lowestNow) lowestNow = y;
    }
    if (lowestNow > floatM) floatM = lowestNow;
    if (lowestNow < sinkM) sinkM = lowestNow;

    const o = skinPoint(pos, joints, weights, best, skinMats);
    bestForwardM.push(o[0]);
    bestHeightM.push(o[1]);
  }

  return {
    axisTravelM: [hi[best * 3] - lo[best * 3], hi[best * 3 + 1] - lo[best * 3 + 1], hi[best * 3 + 2] - lo[best * 3 + 2]],
    floatM,
    sinkM,
    activeVertexCount: active.length,
    clipSeconds: end - start,
    bestVertexTrace: { forwardM: bestForwardM, heightM: bestHeightM },
  };
}

/** The fraction of a trace's own peak-to-trough span a sample must fall to
 *  or below before `countTracePeaks` is willing to count a later rise as a
 *  NEW peak, and the fraction it must rise to or above to BE counted.
 *  Deliberately two thresholds rather than one -- noise sitting near a
 *  single threshold would otherwise cross it back and forth and inflate the
 *  count; a peak has to clear the high band and a trough has to clear the
 *  low band before either counts. 0.3/0.7 is not a fitted number: it is the
 *  midpoint of a comfortable working range, found by widening from a
 *  tighter band until the false positives below stopped appearing and
 *  stopping well short of a band so wide it would miss a real second
 *  cycle. */
export const CYCLE_PEAK_LOW_FRACTION = 0.3;
export const CYCLE_PEAK_HIGH_FRACTION = 0.7;

/**
 * How many times a sampled trace rises from near its minimum to near its
 * maximum -- built to answer exactly one question: does a `move`/`moveFire`
 * clip bake ONE gait cycle or more than one? Peak-to-peak travel
 * (`axisTravelM`, `measureRoleTravel`'s `maxTravelM`) cannot answer this --
 * it is invariant to how many cycles the sampled window contains, while the
 * ground distance a stride like that implies is not: two cycles baked into
 * one clip halve the true per-cycle distance without moving that number at
 * all.
 *
 * **Phase-aligned before counting, and that is not optional.** A looping
 * clip's sample window can start at any point in its own cycle -- mid-swing
 * as often as at a trough -- so a naive left-to-right scan either splits one
 * real peak across the array boundary (undercounting) or treats an
 * already-elevated starting sample as a free peak (overcounting). Rotating
 * the trace to start at its own global minimum before scanning removes both
 * failure modes, because a genuine single cycle then starts exactly where a
 * linear scan needs it to.
 *
 * **Calibrated against every rigged locomotion clip in this tree
 * (2026-09-16), on the `forward` axis of `RoleFootprint.bestVertexTrace`:
 * reads exactly 1 for all seventeen clips this branch's own gait-pass
 * declares a gait for**, and a synthetic concatenation of one of those
 * traces with itself reads exactly 2 (three copies, 3) -- the positive
 * control that proves this is measuring periodicity and not just returning
 * 1 by construction. The `height` axis was tried first and rejected: it
 * double-counts a genuine single cycle on two of the seventeen
 * (`at_team`, `meshy_mortar_team`) from a secondary bounce the forward
 * sweep does not have, which is why `gait-pass.ts` reads this off
 * `bestVertexTrace.forwardM` and not `.heightM`.
 */
export function countTracePeaks(
  trace: readonly number[],
  lowFraction: number = CYCLE_PEAK_LOW_FRACTION,
  highFraction: number = CYCLE_PEAK_HIGH_FRACTION
): number {
  if (trace.length === 0) return 0;
  const min = Math.min(...trace);
  const max = Math.max(...trace);
  const span = max - min;
  if (span <= 0) return 0;
  const lowT = min + span * lowFraction;
  const highT = min + span * highFraction;

  let minIdx = 0;
  for (let i = 1; i < trace.length; i++) if (trace[i] < trace[minIdx]) minIdx = i;
  const rotated = [...trace.slice(minIdx), ...trace.slice(0, minIdx)];

  let peaks = 0;
  let armed = false;
  for (const v of rotated) {
    if (!armed && v <= lowT) armed = true;
    else if (armed && v >= highT) {
      peaks++;
      armed = false;
    }
  }
  return peaks;
}

/**
 * Which way round is this gait? Mean height of the tracked boot vertex while
 * it is travelling FORWARD, minus its mean height while travelling BACK, as a
 * fraction of its own height span.
 *
 * ## Why a direction check needs this and not the obvious things
 *
 * Every other number this module reports is **invariant under time
 * reversal**: `axisTravelM` is `hi - lo` per axis, `countTracePeaks` scans a
 * rotated trace for peaks, and a bearing is a pose. So a `move` clip exported
 * backwards -- a figure moonwalking -- clears the multiplier band, the
 * cadence ceiling, declared-versus-measured, the cycle count and the entire
 * facing sweep, with nothing anywhere going red.
 *
 * The duty factor does not help either, and that was measured rather than
 * assumed: the fraction of samples spent travelling backward is **0.46-0.51
 * on sixteen of the seventeen shipped locomotion clips**, because `rig.py`
 * authors its swing as a pure sinusoid and a reversed sine is a phase-shifted
 * sine. There is no asymmetry there to read.
 *
 * What IS chiral is the relationship between the two axes: a foot lifts to
 * swing forward and plants to drag back, so it is higher while moving forward
 * than while moving back. Reversing the clip swaps which half is which, so
 * this quantity is **exactly negated** -- it cannot be fooled by phase.
 *
 * Measured 2026-09-16 on all seventeen: +0.113 (`meshy_mortar_team`) to
 * +0.470 (`civilian_woman`) -- and `sniper_team` at **-0.065**, the one file
 * in the tree whose boot is higher while it travels backward. See
 * `mesh_gait.test.ts` for the exemption and the diagnosis.
 *
 * **It is probably not a PURE chirality signal, and the exemption is where
 * that is argued.** The tracked vertex is a toe, and on both rig families the
 * boot is bound rigidly to the shin with NO foot bone (confirmed), so it
 * pivots at the KNEE: a toe `d` metres forward of the bone's tail would gain
 * height on the FORWARD swing in proportion to `d`, against the heel lift the
 * knee bend gives at the back. A 2-D model says that term wins at a small
 * stride scale, and `sniper_team` -- the slowest unit in the game, with
 * photogrammetry boots -- is the only shipped rig in that corner. The model
 * is a hypothesis with gaps, spelled out at `SWING_LIFT_OUTLIERS` in
 * `mesh_gait.test.ts`; do not quote it as settled. A clip exported backwards
 * is still exactly the negation of its forward self, so the check does what
 * it was built for; it is the small readings either side of zero that should
 * not be over-read.
 *
 * Returns `NaN` when the trace never moves in one of the two directions, or
 * has no height span at all -- a crew-served rig, where the question is
 * meaningless rather than answered zero.
 */
export function swingLiftFraction(
  forwardM: readonly number[],
  heightM: readonly number[]
): number {
  let up = 0, upCount = 0, down = 0, downCount = 0;
  for (let i = 1; i < forwardM.length && i < heightM.length; i++) {
    const d = forwardM[i] - forwardM[i - 1];
    const y = (heightM[i] + heightM[i - 1]) / 2;
    if (d > 0) { up += y; upCount++; } else if (d < 0) { down += y; downCount++; }
  }
  if (upCount === 0 || downCount === 0) return NaN;
  const span = Math.max(...heightM) - Math.min(...heightM);
  if (!(span > 0)) return NaN;
  return (up / upCount - down / downCount) / span;
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
  /**
   * Mean length, in metres, of the ground-plane lever this bearing is taken
   * over: `|head joint -> its own face centroid|` projected onto the ground,
   * averaged across the sampled instants.
   *
   * **This is the instrument's own error bar and it varies TENFOLD across
   * the roster**, which is why it is reported rather than assumed. The
   * bearing is an `atan2` of a difference, so the angular noise a fixed
   * amount of skinning wobble produces goes as `1 / leverM`. Measured in
   * bind pose when Task 3 took its baseline: `sarim_rifles` 0.0813,
   * `office_worker` 0.0692, `farm_worker` 0.0639, `meshy_soldier` 0.0582,
   * `civilian_child` 0.0505 -- and `civilian_woman` **0.0160**, whose
   * `face` vertices sit almost symmetrically around her own head joint. At
   * 16 mm she reads a 78.7 deg spread on a STANDING `idle` where the same
   * rig's own `Head`->`headfront` marker reads 5.83.
   *
   * A gate can therefore ask whether this reading is worth believing before
   * believing it, instead of widening a band until the shortest lever in
   * the tree fits inside it -- which would take the band past the defects
   * it exists to catch. `mesh_gait.test.ts` does exactly that.
   */
  readonly leverM: number;
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
  const role = 'face';
  const { glb, pos, joints, weights, skin, ibm } = loadSkinnedRole(
    path,
    role,
    ' -- measureFacing needs it'
  );
  const nodes = glb.json.nodes ?? [];

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
    let leverSum = 0;
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
      leverSum += Math.hypot(dx, dz);
      if (hiddenInClip && jointScale(headWorld) > HIDDEN_SCALE) hiddenInClip = false;
    }
    results.push({
      joint: name,
      hiddenInClip,
      leverM: leverSum / SAMPLES,
      ...circularMeanDeg(bearings),
    });
  }
  return results;
}

/** The Meshy-derived rigs carry a `headfront` marker bone hanging off each
 *  `Head`. It exists so the import scripts can read a heading without a mesh,
 *  and it is the SECOND, independent facing instrument this tree has. */
const HEAD_MARKER_RE = /(?:^|_)headfront$/;

export interface MarkerFacing {
  /** The marker bone read, e.g. `f0_headfront`. */
  readonly marker: string;
  /** Its parent -- the head joint the bearing is taken from. */
  readonly joint: string;
  readonly meanDeg: number;
  readonly minDeg: number;
  readonly maxDeg: number;
  readonly hiddenInClip: boolean;
}

/**
 * The same question `measureFacing` answers, asked of the RIG instead of the
 * MESH: the ground-plane bearing from a head joint to its own `headfront`
 * marker bone, sampled across the clip.
 *
 * **It exists to be disagreed with.** Task 2 built a pose that passed every
 * build-time check and was still wrong -- an aim distributed through
 * `Spine02` solved cleanly and put the weapon on the axis, while the exported
 * face read +15.2 against the arms-only +0.3. A spine roll tilts the head
 * rather than yawing it, and the head-forward vector carries a vertical
 * component (measured 0.0859 forward, 0.0311 up), so a roll rotates part of
 * that into a lateral component and swings the MESH bearing while the MARKER,
 * which lies along the head's own forward axis, barely moves. Neither
 * instrument can see that alone; the disagreement between them is the signal.
 * Nothing automated caught it at the time -- a by-hand comparison did.
 *
 * Not a replacement for `measureFacing` and must never become one: **`rig.py`
 * builds its head bone as a VERTICAL segment and ships no marker at all**, so
 * this reads nothing on the fifteen `kit.py` files -- the majority of the
 * roster, and the family that produced the `mortar_team` defect. It raises
 * there rather than returning an empty array.
 *
 * The head joint is the marker's own PARENT in the node hierarchy rather than
 * a name match, so a rig that renames its head bone still pairs correctly.
 */
export function measureMarkerFacing(
  path: string,
  clip: string,
  markerPattern: RegExp = HEAD_MARKER_RE
): MarkerFacing[] {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => { for (const c of n.children ?? []) parent[c] = i; });

  const markers = nodes
    .map((n, i) => ({ index: i, name: n.name ?? '' }))
    .filter((n) => markerPattern.test(n.name) && parent[n.index] >= 0);
  if (markers.length === 0) {
    throw new Error(
      `${path}: no node matching ${markerPattern} with a parent -- measureMarkerFacing needs one ` +
        `per figure (this rig family may not carry a head marker at all)`
    );
  }

  let clipData: { tracks: Map<string, Track>; start: number; end: number };
  try {
    clipData = readClip(glb, clip);
  } catch {
    throw new Error(`${path}: no clip "${clip}" -- measureMarkerFacing needs it`);
  }
  const { tracks, start, end } = clipData;

  return markers.map(({ index, name }) => {
    const head = parent[index];
    const bearings: number[] = [];
    let hiddenInClip = true;
    for (let s = 0; s < SAMPLES; s++) {
      const t = start + ((end - start) * s) / SAMPLES;
      const worlds = nodeWorlds(glb, tracks, t);
      const dx = worlds[index][12] - worlds[head][12];
      const dz = worlds[index][14] - worlds[head][14];
      bearings.push((Math.atan2(dz, dx) * 180) / Math.PI);
      if (hiddenInClip && jointScale(worlds[head]) > HIDDEN_SCALE) hiddenInClip = false;
    }
    return {
      marker: name,
      joint: nodes[head].name ?? '',
      hiddenInClip,
      ...circularMeanDeg(bearings),
    };
  });
}

export interface WeaponAxis {
  /** The firing-hand joint whose dominant vertices were read. */
  readonly joint: string;
  /** Circular mean of the sampled ground-plane bearings of the weapon's own
   *  long axis, degrees, `+X` = 0 and positive to the figure's left -- the
   *  same convention `measureFacing` reports in. */
  readonly meanDeg: number;
  readonly minDeg: number;
  readonly maxDeg: number;
  /** As `FigureFacing.hiddenInClip` -- this joint is scaled out of the clip,
   *  so the axis is of geometry the player never sees. */
  readonly hiddenInClip: boolean;
  /** How many vertices of the role the joint dominantly owns. A gate must
   *  assert this before believing the axis: a handful of cuff vertices has a
   *  principal direction too, and it is not a barrel. */
  readonly vertexCount: number;
  /** Mean peak-to-peak length of that cloud along its own first principal
   *  component, in metres -- the "is this a rifle?" number. A shipped
   *  assault rifle reads ~0.6 m; a bare forearm reads ~0.25. */
  readonly extentM: number;
  /**
   * How far ABOVE the ground plane the same oriented axis points, degrees,
   * `+` = muzzle up. Mean, then the two extremes, over the same samples.
   *
   * ## Why the bearing alone was not enough, measured rather than argued
   *
   * `meanDeg` is `atan2(dz, dx)` -- it PROJECTS the axis onto the ground and
   * throws this component away. So a weapon can point at the sky and read a
   * perfect `0.0` bearing, and that is not hypothetical: every `kit.py`
   * rifleman's `fire` clip levered its rifle out of the level carry `kit.py`
   * builds -- from **+2.47 deg** to a mean of **+17.0** with a peak of
   * **+25.6** -- held it there for the whole clip, and passed all 291
   * assertions in `mesh_gait.test.ts` at a bearing of `-0.0` with a spread of
   * `0.0`. It was found by putting `idle` and `fire` side by side as
   * pictures.
   *
   * Those are WORLD angles, off this function. The same defect photographs at
   * roughly 28 deg of screen slope in `idle` and 40 in `fire` through
   * `render_clip_pose.py`'s dimetric camera, which is where the "about 45
   * degrees" it was first reported as comes from: that camera roughly doubles
   * a small elevation. Quote the instrument, not the render, for a number.
   *
   * A plain arithmetic mean, not a circular one: elevation lives on
   * [-90, +90] and cannot wrap, so the wrap-around handling `circularMeanDeg`
   * exists for would be answering a question that is not asked here.
   */
  readonly elevationDeg: number;
  readonly elevationMinDeg: number;
  readonly elevationMaxDeg: number;
}

/**
 * Which way does each figure's WEAPON point during `clip`?
 *
 * ## Why this is geometry and not a bone direction
 *
 * Task 2 gated `fire`'s aim with the firing hand's own bone direction,
 * head -> tail, as a proxy for the barrel -- the best thing available at the
 * time, and honest about being a proxy. Measured against the rifle itself it
 * is systematically off: **4.1 deg on `idle`, 4.2 deg on `moveFire`, 7.6 deg
 * on `fire`** for `meshy_soldier.glb`, so the shipped barrel sits near +8.8
 * where the proxy reports +1.2. A proxy that is wrong by a rig-dependent
 * amount cannot be shared across rigs, and -- the part that matters -- it
 * cannot catch a weapon bound to the WRONG BONE, because it never looks at
 * the weapon at all.
 *
 * ## Method
 *
 * The vertices of `role` whose dominant skin influence (`WEIGHTS_0 > 0.5`)
 * is the matched joint, skinned through the live clip by the same
 * `computeSkinMats`/`skinPoint` blend every other reader here uses. Per
 * sampled instant: their covariance's first principal component (power
 * iteration, seeded from the covariance's own largest column so the seed
 * cannot be orthogonal to the answer), projected onto the ground plane and
 * read as `atan2(dz, dx)` -- and, since the projection throws away the one
 * dimension in which a rifle can be aimed at the sky while reading a perfect
 * bearing, `asin(dy)` beside it. See `WeaponAxis.elevationDeg`.
 *
 * **A principal component has no sign**, and the sign is chosen from the
 * cloud rather than from the bone: the axis is oriented toward whichever of
 * its two extreme points lies FURTHER from the hand joint. A rifle is
 * gripped behind its balance point, so that end is the muzzle. Orienting it
 * by the bone instead would put the proxy back into the answer through the
 * side door.
 *
 * ## Which role, and which joint
 *
 * Both are the caller's, because the two rig families in this tree disagree
 * and neither is wrong. On the Meshy bipeds the rifle is modelled but has no
 * `weapon` role -- `classify_vertex_roles` splits by base-colour texture and
 * the rifle is the same olive as the uniform (Task 2's report, F2) -- so the
 * cloud is `uniform` vertices on `*_RightHand`. On a `kit.py` team the rifle
 * IS its own `weapon` role and the rig has no hand bone at all, so it is
 * `weapon` on `*_forearm_R`. `vertexCount` and `extentM` are reported so a
 * caller can refuse a cloud that is not a weapon rather than take its
 * bearing on trust.
 *
 * Throws on a missing role, a missing clip or an unmatched joint, for the
 * reason `measureFacing` does: an empty result is a silent pass.
 */
export function measureWeaponAxis(
  path: string,
  role: string,
  clip: string,
  jointPattern: RegExp
): WeaponAxis[] {
  const { glb, pos, joints, weights, skin, ibm } = loadSkinnedRole(
    path,
    role,
    ' -- measureWeaponAxis needs it'
  );
  const nodes = glb.json.nodes ?? [];

  let clipData: { tracks: Map<string, Track>; start: number; end: number };
  try {
    clipData = readClip(glb, clip);
  } catch {
    throw new Error(`${path}: no clip "${clip}" -- measureWeaponAxis needs it`);
  }
  const { tracks, start, end } = clipData;

  const handJoints = skin.joints
    .map((jointNode, skinIndex) => ({ jointNode, skinIndex, name: nodes[jointNode]?.name ?? '' }))
    .filter((j) => jointPattern.test(j.name));
  if (handJoints.length === 0) {
    throw new Error(
      `${path}: no joint matching ${jointPattern} in the skin that drives "${role}" -- ` +
        `measureWeaponAxis needs one per figure (have ${skin.joints.length} joints)`
    );
  }

  const vertsForSkinIndex = new Map<number, number[]>();
  for (const { skinIndex } of handJoints) vertsForSkinIndex.set(skinIndex, []);
  for (let v = 0; v < pos.count; v++) {
    for (let k = 0; k < 4; k++) {
      if (weights.data[v * 4 + k] <= 0.5) continue;
      vertsForSkinIndex.get(joints.data[v * 4 + k])?.push(v);
    }
  }
  const empty = handJoints.filter((j) => (vertsForSkinIndex.get(j.skinIndex) ?? []).length === 0);
  if (empty.length === handJoints.length) {
    throw new Error(
      `${path}: every joint matching ${jointPattern} (${empty.map((j) => j.name).join(', ')}) owns ` +
        `no "${role}" vertex weighted above 0.5 -- measureWeaponAxis cannot read an axis without one`
    );
  }

  const results: WeaponAxis[] = [];
  for (const { jointNode, skinIndex, name } of handJoints) {
    const verts = vertsForSkinIndex.get(skinIndex) ?? [];
    if (verts.length === 0) continue;
    const bearings: number[] = [];
    const elevations: number[] = [];
    let extentSum = 0;
    let hiddenInClip = true;
    for (let s = 0; s < SAMPLES; s++) {
      const t = start + ((end - start) * s) / SAMPLES;
      const worlds = nodeWorlds(glb, tracks, t);
      const skinMats = computeSkinMats(skin, worlds, ibm);
      const pts = verts.map((v) => skinPoint(pos, joints, weights, v, skinMats));
      const axis = principalAxis(pts);
      const jointWorld = worlds[jointNode];
      const oriented = orientAwayFromJoint(axis, pts, [jointWorld[12], jointWorld[13], jointWorld[14]]);
      bearings.push((Math.atan2(oriented.dir[2], oriented.dir[0]) * 180) / Math.PI);
      // The component the bearing throws away. `oriented.dir` is unit length
      // by construction (`principalAxis` normalises and `orientAwayFromJoint`
      // only flips the sign), so this is the elevation directly; the clamp is
      // against float drift past +/-1 rather than against a real value.
      elevations.push(
        (Math.asin(Math.max(-1, Math.min(1, oriented.dir[1]))) * 180) / Math.PI
      );
      extentSum += oriented.extentM;
      if (hiddenInClip && jointScale(jointWorld) > HIDDEN_SCALE) hiddenInClip = false;
    }
    results.push({
      joint: name,
      hiddenInClip,
      vertexCount: verts.length,
      extentM: extentSum / SAMPLES,
      elevationDeg: elevations.reduce((a, b) => a + b, 0) / elevations.length,
      elevationMinDeg: Math.min(...elevations),
      elevationMaxDeg: Math.max(...elevations),
      ...circularMeanDeg(bearings),
    });
  }
  return results;
}

/** First principal component of a point cloud, by power iteration on its own
 *  covariance. Unit length, arbitrary sign -- see `orientAwayFromJoint`.
 *  Deterministic: the seed is the covariance's largest column, which cannot
 *  be orthogonal to the dominant eigenvector unless the covariance is zero. */
function principalAxis(pts: readonly (readonly [number, number, number])[]): [number, number, number] {
  const n = pts.length;
  let mx = 0, my = 0, mz = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; mz += p[2]; }
  mx /= n; my /= n; mz /= n;
  const c = new Float64Array(9);
  for (const p of pts) {
    const dx = p[0] - mx, dy = p[1] - my, dz = p[2] - mz;
    c[0] += dx * dx; c[1] += dx * dy; c[2] += dx * dz;
    c[4] += dy * dy; c[5] += dy * dz;
    c[8] += dz * dz;
  }
  c[3] = c[1]; c[6] = c[2]; c[7] = c[5];
  let best = 0;
  for (let col = 1; col < 3; col++) {
    const norm = Math.hypot(c[col], c[3 + col], c[6 + col]);
    if (norm > Math.hypot(c[best], c[3 + best], c[6 + best])) best = col;
  }
  let vx = c[best], vy = c[3 + best], vz = c[6 + best];
  let len = Math.hypot(vx, vy, vz);
  if (len === 0) return [1, 0, 0];
  vx /= len; vy /= len; vz /= len;
  for (let i = 0; i < 64; i++) {
    const nx = c[0] * vx + c[1] * vy + c[2] * vz;
    const ny = c[3] * vx + c[4] * vy + c[5] * vz;
    const nz = c[6] * vx + c[7] * vy + c[8] * vz;
    len = Math.hypot(nx, ny, nz);
    if (len === 0) break;
    vx = nx / len; vy = ny / len; vz = nz / len;
  }
  return [vx, vy, vz];
}

/** Picks the sign of `axis` that points at whichever extreme of the cloud is
 *  further from `joint`, and returns the cloud's span along it. */
function orientAwayFromJoint(
  axis: readonly [number, number, number],
  pts: readonly (readonly [number, number, number])[],
  joint: readonly [number, number, number]
): { dir: [number, number, number]; extentM: number } {
  let lo = pts[0], hi = pts[0], sLo = Infinity, sHi = -Infinity;
  for (const p of pts) {
    const s = p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2];
    if (s < sLo) { sLo = s; lo = p; }
    if (s > sHi) { sHi = s; hi = p; }
  }
  const dHi = Math.hypot(hi[0] - joint[0], hi[1] - joint[1], hi[2] - joint[2]);
  const dLo = Math.hypot(lo[0] - joint[0], lo[1] - joint[1], lo[2] - joint[2]);
  const sign = dHi >= dLo ? 1 : -1;
  return { dir: [axis[0] * sign, axis[1] * sign, axis[2] * sign], extentM: sHi - sLo };
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
