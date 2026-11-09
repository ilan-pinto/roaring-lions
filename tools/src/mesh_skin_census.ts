/**
 * Skinned-surface censuses read from a team GLB's own bytes (GH-746, the Meshy Rifle Squad's round-4 review):
 *
 *  - `fistSlivers`: triangles of the `uniform` mesh within 0.12 m of a fist (the vertices its `hand_{L|R}` bone owns)
 *    whose longest edge is over 25 mm and whose height under it is under 2.5 mm -- the needles the fused grip's open rim
 *    left when it was parted from the gun (N1). Read at rest and at the clip's sampled instants.
 *  - `armpitStretch`: edges of the `uniform` mesh joining a vertex the figure's spine owns to one an upper arm owns that
 *    a clip stretches to over 2.5x their rest length and over 3 cm -- the comb behind the receiver in moveFire (N3).
 *  - `openRim` (B2, round 5): the `uniform` mesh WELDED by position (the export splits it at every UV seam, so a seam
 *    would read as two open edges), and its boundary edges within 0.06 m of each fist counted, the fists named by ROLE
 *    from `rl_hands.stations` (grip = the firing fist, support = the other), never by side: on this rig `hand_L` is the
 *    firing fist. An open edge inside the figure's gun or within 4 mm of its surface is SEALED (the parting line the gun
 *    closes); the rest are EXPOSED, the torn fan the lead saw on the support fist in round 3.
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
export const RIM_NEAR_FIST_M = 0.06;
export const RIM_SEALED_M = 0.004;

type V3 = [number, number, number];
type Accessor = ReturnType<typeof readAccessor>;

export interface Uniform {
  pos: Accessor; joints: Accessor; weights: Accessor; skin: { joints: number[] }; ibm: Accessor | null;
  dom: string[]; tris: [number, number, number][];
}

export function readUniform(glb: GlbFile, name = 'uniform'): Uniform {
  const nodes = glb.json.nodes ?? [];
  for (const node of nodes) {
    if (node.mesh === undefined || node.skin === undefined || node.name !== name) continue;
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
  throw new Error(`no skinned \`${name}\` mesh`);
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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

/** The closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTri(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

export interface RimReading {
  readonly role: 'firing' | 'support'; readonly hand: string;
  /** welded boundary edges within RIM_NEAR_FIST_M of the fist: all of them, and those not sealed by the gun */
  readonly open: number; readonly exposed: number;
}

/** The fists' bones by role, from the file's `rl_hands.stations` (grip = firing). */
export function fistRoles(glb: GlbFile): { firing: 'L' | 'R'; support: 'L' | 'R' } {
  const st = (glb.json.scenes?.[0]?.extras as { rl_hands?: { stations?: Record<string, { bone_side?: string }> } } | undefined)
    ?.rl_hands?.stations;
  const firing = st?.grip?.bone_side, support = st?.support?.bone_side;
  if ((firing !== 'L' && firing !== 'R') || (support !== 'L' && support !== 'R') || firing === support) {
    throw new Error(`rl_hands.stations names no firing and support fist (grip ${firing}, support ${support})`);
  }
  return { firing, support };
}

/** The welded open rim at each of `figure`'s fists, at rest (`clip` null) or at `frac` of `clip` (see `RimReading`). */
export function openRim(path: string | GlbFile, figure: string, clip: string | null, frac = 0.5, sealedM = RIM_SEALED_M): RimReading[] {
  const glb = typeof path === 'string' ? readGlb(path) : path;
  const roles = fistRoles(glb);
  const u = readUniform(glb);
  const rest = positions(glb, u, null, 0);
  const p = clip === null ? rest : positions(glb, u, clip, frac);
  // weld by REST position at 1e-5 m: split twins coincide there
  const rep = new Map<string, number>();
  const weld = rest.map((q, v) => {
    const key = `${Math.round(q[0] * 1e5)},${Math.round(q[1] * 1e5)},${Math.round(q[2] * 1e5)}`;
    const r = rep.get(key);
    if (r === undefined) { rep.set(key, v); return v; }
    return r;
  });
  const use = new Map<string, number>();
  for (const t of u.tris) {
    const w = [weld[t[0]], weld[t[1]], weld[t[2]]];
    if (w[0] === w[1] || w[1] === w[2] || w[2] === w[0]) continue;   // a degenerate (welded) triangle is no surface
    for (const [a, b] of [[w[0], w[1]], [w[1], w[2]], [w[2], w[0]]]) {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  const boundary = [...use].filter(([, n]) => n === 1).map(([k]) => k.split('-').map(Number) as [number, number]);
  // the figure's own gun, posed the same way
  const wu = readUniform(glb, 'weapon');
  const wp = clip === null ? positions(glb, wu, null, 0) : positions(glb, wu, clip, frac);
  const wtris = wu.tris.filter((t) => wu.dom[t[0]].startsWith(`${figure}_`));
  const sealed = (m: V3): boolean => {
    let best = Infinity, inside = false;
    for (const [a, b, c] of wtris) {
      const q = closestOnTri(m, wp[a], wp[b], wp[c]);
      const d = len(sub(m, q));
      if (d < best) { best = d; inside = dot(sub(m, q), cross(sub(wp[b], wp[a]), sub(wp[c], wp[a]))) < 0; }
    }
    return best <= sealedM || inside;
  };
  const out: RimReading[] = [];
  for (const [role, side] of [['firing', roles.firing], ['support', roles.support]] as const) {
    const bone = `${figure}_hand_${side}`;
    const own = u.dom.flatMap((d, v) => (d === bone ? [v] : []));
    if (own.length === 0) continue;
    const c: V3 = [0, 0, 0];
    for (const v of own) for (let k = 0; k < 3; k++) c[k] += p[v][k] / own.length;
    let open = 0, exposed = 0;
    for (const [a, b] of boundary) {
      if (Math.max(len(sub(p[a], c)), len(sub(p[b], c))) > RIM_NEAR_FIST_M) continue;
      open++;
      const m: V3 = [(p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2, (p[a][2] + p[b][2]) / 2];
      if (!sealed(m)) exposed++;
    }
    out.push({ role, hand: bone, open, exposed });
  }
  return out;
}

/** A copy of `glb` with `uniform` triangle `tri` removed (made degenerate in the index buffer). */
export function withoutTriangle(glb: GlbFile, tri: number): GlbFile {
  const json = JSON.parse(JSON.stringify(glb.json)) as GlbFile['json'];
  const bin = new Uint8Array(glb.bin);
  const node = (json.nodes ?? []).find((n) => n.name === 'uniform')!;
  const acc = json.accessors![json.meshes![node.mesh!].primitives[0].indices!];
  const bv = json.bufferViews![acc.bufferView!];
  const size = acc.componentType === 5125 ? 4 : 2;
  const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + tri * 3 * size;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const first = size === 4 ? dv.getUint32(off, true) : dv.getUint16(off, true);
  for (let k = 1; k < 3; k++) {
    if (size === 4) dv.setUint32(off + k * size, first, true); else dv.setUint16(off + k * size, first, true);
  }
  return { json, bin };
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
