/**
 * Skinned-surface censuses read from a team GLB's own bytes (GH-746, the Meshy Rifle Squad's round-4 review):
 *
 *  - `fistSlivers`: triangles of the `uniform` mesh within 0.12 m of a fist (the vertices its `hand_{L|R}` bone owns)
 *    whose longest edge is over 25 mm and whose height under it is under 2.5 mm -- the needles the fused grip's open rim
 *    left when it was parted from the gun (N1). Read at rest and at the clip's sampled instants.
 *  - `armpitStretch`: edges of the `uniform` mesh joining a vertex the figure's spine owns to one an upper arm owns that
 *    a clip stretches to over 2.5x their rest length and over 3 cm -- the comb behind the receiver in moveFire (N3).
 *
 * The instruments share no arithmetic with the importer that made the file (`tools/units/import_meshy_skinned_team.py`):
 * they skin the vertices through `mesh_gait`'s own `computeSkinMats` / `skinPoint`, the renderer's maths.
 */
import { computeSkinMats, nodeWorlds, readAccessor, readClip, readGlb, skinPoint, type GlbFile } from './mesh_gait';

export const SLIVER_LONG_M = 0.025;
export const SLIVER_THIN_M = 0.0025;
export const SLIVER_NEAR_FIST_M = 0.12;
export const STRETCH_RATIO = 2.5;
export const STRETCH_MIN_M = 0.03;

type V3 = [number, number, number];
type Accessor = ReturnType<typeof readAccessor>;

export interface Uniform {
  pos: Accessor; joints: Accessor; weights: Accessor; skin: { joints: number[] }; ibm: Accessor | null;
  dom: string[]; tris: [number, number, number][];
}

export function readUniform(glb: GlbFile): Uniform {
  const nodes = glb.json.nodes ?? [];
  for (const node of nodes) {
    if (node.mesh === undefined || node.skin === undefined || node.name !== 'uniform') continue;
    const skin = glb.json.skins![node.skin];
    const prim = glb.json.meshes![node.mesh].primitives[0];
    const pos = readAccessor(glb, prim.attributes.POSITION);
    const joints = readAccessor(glb, prim.attributes.JOINTS_0);
    const weights = readAccessor(glb, prim.attributes.WEIGHTS_0);
    const ibm = skin.inverseBindMatrices === undefined ? null : readAccessor(glb, skin.inverseBindMatrices);
    const dom: string[] = [];
    for (let v = 0; v < pos.count; v++) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) {
        const w = weights.data[v * 4 + k];
        if (w > bw) { bw = w; best = joints.data[v * 4 + k]; }
      }
      dom.push(best < 0 ? '' : (nodes[skin.joints[best]]?.name ?? ''));
    }
    const idx = readAccessor(glb, prim.indices!).data;
    const tris: [number, number, number][] = [];
    for (let i = 0; i + 2 < idx.length; i += 3) tris.push([idx[i], idx[i + 1], idx[i + 2]]);
    return { pos, joints, weights, skin, ibm, dom, tris };
  }
  throw new Error('no skinned `uniform` mesh');
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Every vertex's position, at rest (the bind pose, `clip` null) or at time `t` of `clip`. */
function positions(glb: GlbFile, u: Uniform, clip: string | null, frac: number): V3[] {
  const out: V3[] = [];
  if (clip === null) {
    for (let v = 0; v < u.pos.count; v++) out.push([u.pos.data[v * 3], u.pos.data[v * 3 + 1], u.pos.data[v * 3 + 2]]);
    return out;
  }
  const { tracks, start, end } = readClip(glb, clip);
  const mats = computeSkinMats(u.skin, nodeWorlds(glb, tracks, start + (end - start) * frac), u.ibm);
  for (let v = 0; v < u.pos.count; v++) out.push(skinPoint(u.pos, u.joints, u.weights, v, mats));
  return out;
}

export interface SliverReading { readonly hand: string; readonly count: number; readonly longestM: number }

/** The slivers at each of `figure`'s fists, at rest (`clip` null) or at `frac` of `clip`. */
export function fistSlivers(path: string | GlbFile, figure: string, clip: string | null, frac = 0.5): SliverReading[] {
  const glb = typeof path === 'string' ? readGlb(path) : path;
  const u = readUniform(glb);
  const p = positions(glb, u, clip, frac);
  const out: SliverReading[] = [];
  for (const side of ['L', 'R'] as const) {
    const bone = `${figure}_hand_${side}`;
    const own = u.dom.flatMap((d, v) => (d === bone ? [v] : []));
    if (own.length === 0) continue;
    const c: V3 = [0, 0, 0];
    for (const v of own) for (let k = 0; k < 3; k++) c[k] += p[v][k] / own.length;
    let count = 0, longest = 0;
    for (const [a, b, d] of u.tris) {
      if (Math.min(len(sub(p[a], c)), len(sub(p[b], c)), len(sub(p[d], c))) > SLIVER_NEAR_FIST_M) continue;
      const L = Math.max(len(sub(p[b], p[a])), len(sub(p[d], p[b])), len(sub(p[a], p[d])));
      const h = len(cross(sub(p[b], p[a]), sub(p[d], p[a]))) / Math.max(L, 1e-9);
      if (L > SLIVER_LONG_M && h < SLIVER_THIN_M) { count++; longest = Math.max(longest, L); }
    }
    out.push({ hand: bone, count, longestM: longest });
  }
  return out;
}

export interface StretchReading { readonly pair: string; readonly edges: number; readonly longestM: number }

/** Edges between `figure`'s spine and its `upperarm_{side}` stretched by `clip` at `frac` (see STRETCH_*). */
export function armpitStretch(path: string | GlbFile, figure: string, side: 'L' | 'R', clip: string, frac = 0.5): StretchReading {
  const glb = typeof path === 'string' ? readGlb(path) : path;
  const u = readUniform(glb);
  const rest = positions(glb, u, null, 0);
  const p = positions(glb, u, clip, frac);
  const sp = `${figure}_spine`, ua = `${figure}_upperarm_${side}`;
  const seen = new Set<string>();
  let edges = 0, longest = 0;
  for (const t of u.tris) {
    for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as const) {
      const pair = [u.dom[a], u.dom[b]].sort().join(' ');
      if (pair !== [sp, ua].sort().join(' ')) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lr = len(sub(rest[a], rest[b])), lp = len(sub(p[a], p[b]));
      if (lp > STRETCH_MIN_M && lp > STRETCH_RATIO * Math.max(lr, 1e-4)) { edges++; longest = Math.max(longest, lp); }
    }
  }
  return { pair: `${sp} / ${ua}`, edges, longestM: longest };
}

/**
 * A copy of `glb` whose `uniform` vertex `v` sits at `to` (bind space): the bytes every reader above then sees. For the
 * constructed failing inputs.
 */
export function withVertexAt(glb: GlbFile, v: number, to: V3): GlbFile {
  const json = JSON.parse(JSON.stringify(glb.json)) as GlbFile['json'];
  const bin = new Uint8Array(glb.bin);
  const node = (json.nodes ?? []).find((n) => n.name === 'uniform')!;
  const acc = json.accessors![json.meshes![node.mesh!].primitives[0].attributes.POSITION];
  const bv = json.bufferViews![acc.bufferView!];
  const stride = bv.byteStride ?? 12;
  const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + v * stride;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let k = 0; k < 3; k++) dv.setFloat32(off + 4 * k, to[k], true);
  return { json, bin };
}
