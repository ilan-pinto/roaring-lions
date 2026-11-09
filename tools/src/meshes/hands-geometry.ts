/**
 * Geometry plumbing for the hands pass (GH-826 step 2): a primitive as plain arrays you can delete faces from,
 * re-bind vertices of and append to, and the loaders for the two parts the pass grafts (the hand library and the
 * reshaped carbine). No rig knowledge here.
 *
 * A rigid-skinned infantry primitive stores each vertex's REST WORLD position (the binds are the rests; see
 * `rig.ts`), so a vertex appended here is simply written at its rest world position with one joint at weight 1.
 */
import { NodeIO, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readFileSync } from 'node:fs';
import { add, cross, dot, norm, qrot, scale, sub, type Q, type V3 } from './motion/math';

export interface PrimData {
  pos: number[];
  nrm: number[];
  uv: number[];
  joints: number[];   // 4 per vertex
  weights: number[];  // 4 per vertex
  idx: number[];
}

export function readPrim(p: Primitive): PrimData {
  return {
    pos: Array.from(p.getAttribute('POSITION')!.getArray()!),
    nrm: Array.from(p.getAttribute('NORMAL')!.getArray()!),
    uv: Array.from(p.getAttribute('TEXCOORD_0')!.getArray()!),
    joints: Array.from(p.getAttribute('JOINTS_0')!.getArray()!),
    weights: Array.from(p.getAttribute('WEIGHTS_0')!.getArray()!),
    idx: Array.from(p.getIndices()!.getArray()!),
  };
}

export function writePrim(p: Primitive, d: PrimData): void {
  const set = (name: string, arr: ArrayLike<number>, ctor: Float32ArrayConstructor | Uint8ArrayConstructor) => {
    const a = p.getAttribute(name)!;
    a.setArray(ctor.from(arr as ArrayLike<number> & Iterable<number>));
  };
  set('POSITION', d.pos, Float32Array);
  set('NORMAL', d.nrm, Float32Array);
  set('TEXCOORD_0', d.uv, Float32Array);
  set('JOINTS_0', d.joints, Uint8Array);
  set('WEIGHTS_0', d.weights, Float32Array);
  const ix = p.getIndices()!;
  if (d.pos.length / 3 > 65535) throw new Error(`hands: ${d.pos.length / 3} vertices will not index in 16 bits`);
  ix.setArray(Uint16Array.from(d.idx));
}

export const vertexCount = (d: PrimData): number => d.pos.length / 3;

export function vert(d: PrimData, i: number): V3 {
  return [d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]];
}

export function dominant(d: PrimData, i: number): number {
  let b = 0;
  for (let k = 1; k < 4; k++) if (d.weights[i * 4 + k] > d.weights[i * 4 + b]) b = k;
  return d.joints[i * 4 + b];
}

export function bindTo(d: PrimData, i: number, joint: number): void {
  d.joints[i * 4] = joint;
  d.joints[i * 4 + 1] = d.joints[i * 4 + 2] = d.joints[i * 4 + 3] = 0;
  d.weights[i * 4] = 1;
  d.weights[i * 4 + 1] = d.weights[i * 4 + 2] = d.weights[i * 4 + 3] = 0;
}

/** Append one vertex at a rest world position, bound to `joint` at weight 1. Returns its index. */
export function addVertex(d: PrimData, p: V3, n: V3, uv: [number, number], joint: number): number {
  const i = d.pos.length / 3;
  d.pos.push(p[0], p[1], p[2]);
  d.nrm.push(n[0], n[1], n[2]);
  d.uv.push(uv[0], uv[1]);
  d.joints.push(joint, 0, 0, 0);
  d.weights.push(1, 0, 0, 0);
  return i;
}

/** Drop the faces `drop(face index, a, b, c)` says, then every vertex no face uses; indices remapped. */
export function removeFaces(d: PrimData, drop: (f: number, a: number, b: number, c: number) => boolean): { faces: number; verts: number } {
  const keep: number[] = [];
  let dropped = 0;
  for (let f = 0; f < d.idx.length / 3; f++) {
    const a = d.idx[f * 3], b = d.idx[f * 3 + 1], c = d.idx[f * 3 + 2];
    if (drop(f, a, b, c)) { dropped++; continue; }
    keep.push(a, b, c);
  }
  const n = d.pos.length / 3;
  const used = new Uint8Array(n);
  for (const i of keep) used[i] = 1;
  const remap = new Int32Array(n).fill(-1);
  let m = 0;
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], joints: number[] = [], weights: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!used[i]) continue;
    remap[i] = m++;
    pos.push(d.pos[i * 3], d.pos[i * 3 + 1], d.pos[i * 3 + 2]);
    nrm.push(d.nrm[i * 3], d.nrm[i * 3 + 1], d.nrm[i * 3 + 2]);
    uv.push(d.uv[i * 2], d.uv[i * 2 + 1]);
    joints.push(...d.joints.slice(i * 4, i * 4 + 4));
    weights.push(...d.weights.slice(i * 4, i * 4 + 4));
  }
  const dv = n - m;
  d.pos = pos; d.nrm = nrm; d.uv = uv; d.joints = joints; d.weights = weights;
  d.idx = keep.map((i) => remap[i]);
  return { faces: dropped, verts: dv };
}

/** A mesh read from a library GLB: positions, normals, triangle indices, and the node's extras. */
export interface PartMesh {
  readonly name: string;
  readonly pos: Float32Array;
  readonly nrm: Float32Array;
  readonly uv: Float32Array;
  readonly idx: Uint32Array;
  readonly extras: Record<string, unknown>;
}

export async function readParts(path: string): Promise<{ parts: Map<string, PartMesh>; sceneExtras: Record<string, unknown> }> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc: Document = await io.readBinary(new Uint8Array(readFileSync(path)));
  const parts = new Map<string, PartMesh>();
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh();
    if (!m) continue;
    const p = m.listPrimitives()[0];
    parts.set(n.getName(), {
      name: n.getName(),
      pos: Float32Array.from(p.getAttribute('POSITION')!.getArray()!),
      nrm: Float32Array.from(p.getAttribute('NORMAL')!.getArray()!),
      uv: Float32Array.from(p.getAttribute('TEXCOORD_0')?.getArray() ?? []),
      idx: Uint32Array.from(p.getIndices()!.getArray()!),
      extras: (n.getExtras() ?? {}) as Record<string, unknown>,
    });
  }
  return { parts, sceneExtras: (doc.getRoot().listScenes()[0]?.getExtras() ?? {}) as Record<string, unknown> };
}

/** A 3x3 rotation (row-major rows) applied to a vector. */
export type M3 = readonly [readonly number[], readonly number[], readonly number[]];
export const mvec = (m: M3, v: V3): V3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

/** The rotation with columns x, y, z, as a quaternion. */
export function qfromColumns(x: V3, y: V3, z: V3): Q {
  const m00 = x[0], m10 = x[1], m20 = x[2];
  const m01 = y[0], m11 = y[1], m21 = y[2];
  const m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** The rotation matrix (columns x, y, z) of a quaternion. */
export function columnsOf(q: Q): [V3, V3, V3] {
  return [qrot(q, [1, 0, 0]), qrot(q, [0, 1, 0]), qrot(q, [0, 0, 1])];
}

export function orthoFrame(yAxis: V3, xHint: V3): { x: V3; y: V3; z: V3 } {
  const y = norm(yAxis);
  const x = norm(sub(xHint, scale(y, dot(xHint, y))));
  const z = cross(x, y);
  return { x, y, z };
}

/**
 * A closed-ish tube along a centreline, `ringCount` rings of `sides` points. `sections(k)` gives ring k's centre,
 * the two section axes (unit, perpendicular to the sweep) and the half-extents along them. Returns vertex arrays and
 * triangles (indices into the returned arrays), faces wound outward, normals the ellipse's.
 */
export function loftEllipses(
  rings: { c: V3; u: V3; v: V3; a: number; b: number }[], sides: number,
): { pos: V3[]; nrm: V3[]; tri: [number, number, number][]; ring: number[][] } {
  const pos: V3[] = [];
  const nrm: V3[] = [];
  const ring: number[][] = [];
  for (const r of rings) {
    const ids: number[] = [];
    for (let i = 0; i < sides; i++) {
      const ang = (2 * Math.PI * i) / sides;
      const cu = Math.cos(ang), sv = Math.sin(ang);
      const p = add(r.c, add(scale(r.u, cu * r.a), scale(r.v, sv * r.b)));
      const n = norm(add(scale(r.u, cu / r.a), scale(r.v, sv / r.b)));
      ids.push(pos.length);
      pos.push(p);
      nrm.push(n);
    }
    ring.push(ids);
  }
  const tri: [number, number, number][] = [];
  for (let k = 0; k + 1 < ring.length; k++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      tri.push([ring[k][i], ring[k + 1][i], ring[k + 1][j]], [ring[k][i], ring[k + 1][j], ring[k][j]]);
    }
  }
  // wind outward: the triangle's normal against the ellipse normal at its first vertex
  for (const t of tri) {
    const a = pos[t[0]], b = pos[t[1]], c = pos[t[2]];
    const fn = cross(sub(b, a), sub(c, a));
    if (dot(fn, nrm[t[0]]) < 0) { const x = t[1]; t[1] = t[2]; t[2] = x; }
  }
  return { pos, nrm, tri, ring };
}
