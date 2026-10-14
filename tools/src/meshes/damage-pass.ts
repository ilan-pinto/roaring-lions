/**
 * The damage pass: real damaged geometry on a vehicle wreck, cut into the
 * `WRECK_` twins the wreck pass made, never into the live vehicle.
 *
 *     pnpm damage:meshes                  # every vehicle with a recipe
 *     pnpm damage:meshes -- --id=mbt_lavi # one
 *
 * Design: `docs/superpowers/specs/2026-10-14-wreck-damage-design.md`, which
 * closes D1 of the wreck spec ("structural damage per vehicle is a later
 * art pass"). Pipeline order, load-bearing:
 *
 *     export -> running-gear -> kit -> wreck -> DAMAGE -> encode
 *
 * The wreck pass rebuilds `death_root` with every twin SHARING its live mesh
 * (and disposes any damaged copy it finds), so damage comes after it; this
 * pass reads the wreck pose out of each twin's matrix, so it must. Re-running
 * any earlier pass means re-running wreck and damage after it.
 *
 * What it writes, per wreck node a recipe touches:
 *
 *   - a NEW mesh, a copy of the live mesh's one primitive with the damage cut
 *     in, same material, exactly the same attribute set and component types
 *     (so `_RL_WHEEL`/`_RL_TRACK` ride along; new vertices take 0 / -1);
 *   - `extras.rl_damage = { source: <live node name> }` on the wreck node and
 *     on the mesh. The node's flag is what `validate_mesh_assets.py`'s wreck
 *     contract accepts in place of a shared mesh; the mesh's is what makes
 *     the copy findable for stripping.
 *
 * The live meshes are never written: every accessor they hold is byte-
 * identical before and after (`damage-pass.test.ts`).
 *
 * **Debris that lies on the ground is built in `death_root` space** (y = 0
 * is the ground the wreck pass seats on) and carried into the twin's own
 * space by the inverse of its matrix, so a thrown track costs no node and no
 * draw call: it is more triangles in the rubber twin.
 *
 * **Idempotent.** `stripDamage` points every damaged twin back at its live
 * mesh and disposes the copy and every accessor only it held, so a second
 * run writes the same bytes. No randomness: the torn edges come from a
 * fixed integer hash.
 *
 * gltf-transform only, no Blender and no Meshy (the lead's ruling): the cuts
 * are region and tag tests over the shipped bytes, and the tags #550 wrote
 * (`_RL_TRACK`) exist only in the bytes.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Accessor, type Document, type Mesh, type Node, type Primitive, type mat4 } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { inLostTyre, lostTyre } from './lost-tyre';
import { DAMAGE_RECIPES, type BreakBarrel, type DamageOp, type BlowOut, type DropTyre, type PeelPlate, type Simplify, type SnapRotor, type ThrowTrack } from './damage-recipes';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');

export const DEATH_ROOT = 'death_root';
export const WRECK_PREFIX = 'WRECK_';
/** The extras key on a damaged twin (node) and its own mesh. */
export const DAMAGE_KEY = 'rl_damage';

const TRACK = '_RL_TRACK';
const WHEEL = '_RL_WHEEL';

// ---------------------------------------------------------------------------
// Small maths
// ---------------------------------------------------------------------------

type V3 = [number, number, number];

/** Integer hash in [0, 1). Never Math.random: two runs must write the same bytes. */
export function hash01(n: number): number {
  let x = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

/** Smooth noise in about [-1, 1] along u, periodic in 2 pi: a torn edge. */
function edgeNoise(u: number, seed: number): number {
  let v = 0;
  for (let k = 1; k <= 5; k++) v += (hash01(seed * 31 + k) - 0.5) * Math.sin(k * u + hash01(seed * 17 + k) * 6.283) * (2 / k);
  return v;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Rodrigues: rotate v about unit axis k by theta. */
function rotate(v: V3, k: V3, theta: number): V3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** Column-major glTF matrix times a point / a direction. */
const xfPoint = (m: mat4, p: V3): V3 => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const xfDir = (m: mat4, d: V3): V3 => [
  m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
  m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
  m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
];

/** Inverse of an affine column-major matrix. */
export function invertAffine(m: mat4): mat4 {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  if (Math.abs(det) < 1e-12) throw new Error('damage-pass: a wreck node has a singular matrix');
  const r = [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
  const t: V3 = [m[12], m[13], m[14]];
  const tx = -(r[0]! * t[0] + r[3]! * t[1] + r[6]! * t[2]);
  const ty = -(r[1]! * t[0] + r[4]! * t[1] + r[7]! * t[2]);
  const tz = -(r[2]! * t[0] + r[5]! * t[1] + r[8]! * t[2]);
  return [r[0]!, r[1]!, r[2]!, 0, r[3]!, r[4]!, r[5]!, 0, r[6]!, r[7]!, r[8]!, 0, tx, ty, tz, 1] as unknown as mat4;
}

// ---------------------------------------------------------------------------
// A primitive as plain arrays, every attribute carried
// ---------------------------------------------------------------------------

interface Attr {
  readonly semantic: string;
  readonly size: number;
  readonly ctor: { new (n: number | ArrayLike<number>): ArrayLike<number> };
  readonly normalized: boolean;
  readonly type: string;
  data: number[];
}

/** A primitive pulled into arrays, so damage is ordinary array work. */
export class Geo {
  readonly attrs: Attr[];
  idx: number[];

  constructor(prim: Primitive) {
    this.attrs = prim.listSemantics().map((semantic) => {
      const a = prim.getAttribute(semantic) as Accessor;
      const arr = a.getArray();
      if (!arr) throw new Error(`damage-pass: attribute ${semantic} has no data`);
      return {
        semantic,
        size: a.getElementSize(),
        ctor: arr.constructor as Attr['ctor'],
        normalized: a.getNormalized(),
        type: a.getType(),
        data: Array.from(arr as ArrayLike<number>),
      };
    });
    const indices = prim.getIndices();
    if (!indices) throw new Error('damage-pass: a non-indexed primitive (every shipped vehicle mesh is indexed)');
    this.idx = Array.from(indices.getArray() as ArrayLike<number>);
    for (const s of ['POSITION', 'NORMAL']) {
      if (!this.attrs.some((a) => a.semantic === s)) throw new Error(`damage-pass: no ${s}`);
    }
  }

  private attr(s: string): Attr | undefined {
    return this.attrs.find((a) => a.semantic === s);
  }
  get count(): number {
    return this.attr('POSITION')!.data.length / 3;
  }
  get faces(): number {
    return this.idx.length / 3;
  }
  has(s: string): boolean {
    return this.attr(s) !== undefined;
  }
  get(s: string, i: number): number {
    return this.attr(s)!.data[i]!;
  }
  pos(i: number): V3 {
    const d = this.attr('POSITION')!.data;
    return [d[3 * i]!, d[3 * i + 1]!, d[3 * i + 2]!];
  }
  nrm(i: number): V3 {
    const d = this.attr('NORMAL')!.data;
    return [d[3 * i]!, d[3 * i + 1]!, d[3 * i + 2]!];
  }
  tri(f: number): [number, number, number] {
    return [this.idx[3 * f]!, this.idx[3 * f + 1]!, this.idx[3 * f + 2]!];
  }
  centroid(f: number): V3 {
    const [a, b, c] = this.tri(f).map((i) => this.pos(i)) as [V3, V3, V3];
    return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  }
  faceNormal(f: number): V3 {
    const [a, b, c] = this.tri(f).map((i) => this.pos(i)) as [V3, V3, V3];
    return norm(cross(sub(b, a), sub(c, a)));
  }
  /** Copy vertex i (every attribute) to a new index, then place it at p with normal n. */
  copyVertex(i: number, p?: V3, n?: V3): number {
    const j = this.count;
    for (const a of this.attrs) for (let k = 0; k < a.size; k++) a.data.push(a.data[a.size * i + k]!);
    if (p) this.set('POSITION', j, p);
    if (n) this.set('NORMAL', j, norm(n));
    return j;
  }
  set(s: string, i: number, v: readonly number[]): void {
    const a = this.attr(s)!;
    for (let k = 0; k < a.size; k++) a.data[a.size * i + k] = v[k]!;
  }
  /** Mark a vertex as no longer wheel or track: debris does not turn. */
  untag(i: number): void {
    if (this.has(WHEEL)) this.set(WHEEL, i, [0]);
    if (this.has(TRACK)) this.set(TRACK, i, [-1]);
  }
  /** Remove the picked faces and hand them back. */
  cut(pick: (f: number) => boolean): [number, number, number][] {
    const keep: number[] = [];
    const gone: [number, number, number][] = [];
    for (let f = 0; f < this.faces; f++) {
      const t = this.tri(f);
      if (pick(f)) gone.push(t);
      else keep.push(...t);
    }
    this.idx = keep;
    return gone;
  }
  /** Re-add faces on fresh vertices, every vertex moved by `xf`; `flip` reverses winding. */
  reattach(tris: readonly [number, number, number][], xf: (p: V3, n: V3) => [V3, V3], flip = false): void {
    const map = new Map<number, number>();
    for (const t of tris) {
      for (const v of t) {
        if (map.has(v)) continue;
        const [p, n] = xf(this.pos(v), this.nrm(v));
        const j = this.copyVertex(v, p, n);
        this.untag(j);
        map.set(v, j);
      }
      const [a, b, c] = t.map((v) => map.get(v)!) as [number, number, number];
      this.idx.push(...(flip ? [a, c, b] : [a, b, c]));
    }
  }
  /** A quad on four copies of `like` (so every attribute, UV included, is a real one), facing `n`. */
  quad(like: number, corners: readonly [V3, V3, V3, V3], n: V3): void {
    const ids = corners.map((p) => {
      const j = this.copyVertex(like, p, n);
      this.untag(j);
      return j;
    });
    const [a, b, c, d] = ids as [number, number, number, number];
    // Winding so the face's front is along n.
    const front = dot(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])), n) >= 0;
    this.idx.push(...(front ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
  }
  /** Drop vertices no face uses, so a cut does not leave dead weight in the file. */
  compact(): void {
    const used = new Int32Array(this.count).fill(-1);
    let next = 0;
    for (const i of this.idx) if (used[i] === -1) used[i] = next++;
    for (const a of this.attrs) {
      const out: number[] = new Array(next * a.size);
      for (let i = 0; i < used.length; i++) {
        const j = used[i]!;
        if (j < 0) continue;
        for (let k = 0; k < a.size; k++) out[a.size * j + k] = a.data[a.size * i + k]!;
      }
      a.data = out;
    }
    this.idx = this.idx.map((i) => used[i]!);
  }
}

// ---------------------------------------------------------------------------
// The verbs
// ---------------------------------------------------------------------------

/** What a verb knows about where its twin lies: twin space <-> death_root (ground) space. */
interface Frame {
  readonly toGround: mat4;
  readonly fromGround: mat4;
}

export interface VerbReport {
  verb: DamageOp['verb'];
  mesh: string;
  faces: number;
}

function throwTrack(g: Geo, op: ThrowTrack, frame: Frame): number {
  if (!g.has(TRACK)) throw new Error('throwTrack: the mesh carries no _RL_TRACK (run running-gear:meshes first)');
  const onSide = (p: V3) => p[2] * op.side > 0;
  const isTrack = (f: number) => g.tri(f).every((v) => g.get(TRACK, v) >= 0) && onSide(g.centroid(f));
  const all = g.cut(isTrack);
  if (all.length === 0) throw new Error(`throwTrack: no track faces on side ${op.side}`);
  // The LOWER run is what lies out on the sand. A tracked hull whose tag
  // covers the whole loop (Namer, D9) also loses its upper run and the top of
  // each end: a track off its wheels does not keep a return run in the air.
  const meanY = (t: readonly number[]) => t.reduce((y, v) => y + g.pos(v)[1], 0) / t.length;
  const tris = all.filter((t) => meanY(t) < op.lowY);
  if (tris.length === 0) throw new Error(`throwTrack: no track faces below y ${op.lowY} on side ${op.side}`);
  // The run's own extent and the side's own centre line, measured.
  let xF = -Infinity;
  let xR = Infinity;
  let zSum = 0;
  let n = 0;
  for (const t of tris)
    for (const v of t) {
      const p = g.pos(v);
      xF = Math.max(xF, p[0]);
      xR = Math.min(xR, p[0]);
      zSum += Math.abs(p[2]);
      n++;
    }
  const zc = zSum / n;
  const L = xF - xR;
  const zOf = (t: number) => op.side * (zc + op.out0 + op.out1 * t * t + op.wave * Math.sin(t * 8.5));
  const dzdx = (t: number) => (op.side * (2 * op.out1 * t + op.wave * 8.5 * Math.cos(t * 8.5))) / -L;
  // The strip lives in the GROUND frame, so carry each vertex through the
  // twin's matrix first: what is "on the sand" is a fact about the wreck,
  // not about the hull the track fell off.
  g.reattach(tris, (p, nn) => {
    const t = Math.min(1, Math.max(0, (xF - p[0]) / L));
    const lat = Math.abs(p[2]) - zc; // across the track, outward positive
    const phi = Math.atan(dzdx(t));
    // the ramps at either end come down onto the sand; the run keeps its thickness
    const y = Math.min(p[1], 0.07) * 0.55 + 0.012;
    const ground: V3 = [p[0] + op.slide - op.side * lat * Math.sin(phi), y, zOf(t) + op.side * lat * Math.cos(phi)];
    const turned = rotate(Math.abs(nn[1]) > 0.2 ? nn : [nn[0], 0.4, nn[2]], [0, 1, 0], -phi);
    // `ground` is ALREADY in the ground frame: it was built from the live
    // vertex's x and lateral offset, never from the twin's tilted pose.
    return [xfPoint(frame.fromGround, ground), xfDir(frame.fromGround, turned)];
  });
  return all.length;
}

function peelPlate(g: Geo, op: PeelPlate): number {
  const s = op.side;
  const jag = (u: number, k: number) => op.jag * edgeNoise(u * 3, op.seed * 7 + k);
  const inPanel = (f: number) => {
    const c = g.centroid(f);
    return (
      g.faceNormal(f)[2] * s > op.normalMin &&
      c[2] * s > op.zMin &&
      c[0] > op.x0 + jag(c[1], 1) &&
      c[0] < op.x1 + jag(c[1], 2) &&
      c[1] > op.y0 &&
      c[1] < op.y1 + jag(c[0], 3)
    );
  };
  const tris = g.cut(inPanel);
  if (tris.length === 0) throw new Error(`peelPlate: no faces on ${op.mesh} in the box`);
  let zOut = 0;
  let low = tris[0]![0];
  for (const t of tris)
    for (const v of t) {
      zOut += g.pos(v)[2];
      if (g.pos(v)[1] < g.pos(low)[1]) low = v;
    }
  zOut /= tris.length * 3;
  // The hinge line and the sense that swings the free edge OUTWARD (+side).
  const rad = (op.angleDeg * Math.PI) / 180;
  const [hinge, axis, theta, freeOf]: [V3, V3, number, (p: V3) => number] =
    op.hinge === 'top'
      ? [[0, op.y1, zOut], [1, 0, 0], -rad * s, (p) => (op.y1 - p[1]) / (op.y1 - op.y0)]
      : op.hinge === 'rear'
        ? [[op.x0, 0, zOut], [0, 1, 0], -rad * s, (p) => (p[0] - op.x0) / (op.x1 - op.x0)]
        : [[op.x1, 0, zOut], [0, 1, 0], rad * s, (p) => (op.x1 - p[0]) / (op.x1 - op.x0)];
  const peel = (p: V3, nn: V3): [V3, V3] => {
    const r = rotate(sub(p, hinge), axis, theta);
    // a crumple along the free edge
    const free = Math.max(0, Math.min(1, freeOf(p)));
    return [add(add(r, hinge), [0, 0.05 * free * Math.sin(p[0] * 9 + p[1] * 7), 0]), rotate(nn, axis, theta)];
  };
  g.reattach(tris, peel);
  // The plate's inside: same faces, reversed, normals flipped.
  g.reattach(tris, (p, nn) => {
    const [q, m] = peel(p, nn);
    return [q, scale(m, -1)];
  }, true);
  if (op.backing) {
    // A backing across the opening, inset 0.28 m, so a hull with nothing
    // modelled behind the plate does not read hollow.
    const zc = zOut - s * 0.28;
    const [x0, x1, y0, y1] = [op.x0 - 0.05, op.x1 + 0.05, op.y0, op.y1 + 0.05];
    g.quad(low, [[x0, y0, zc], [x1, y0, zc], [x1, y1, zc], [x0, y1, zc]], [0, 0, s]);
    g.quad(low, [[x0, y0 + 0.01, zc], [x1, y0 + 0.01, zc], [x1, y0 + 0.01, zOut], [x0, y0 + 0.01, zOut]], [0, 1, 0]);
  }
  return tris.length;
}

function breakBarrel(g: Geo, op: BreakBarrel, frame: Frame): number {
  // The tube's axis, measured off the vertices forward of the break.
  let ay = 0;
  let az = 0;
  let n = 0;
  for (let i = 0; i < g.count; i++) {
    const p = g.pos(i);
    if (p[0] <= op.breakX) continue;
    ay += p[1];
    az += p[2];
    n++;
  }
  if (n === 0) throw new Error(`breakBarrel: no vertex forward of x ${op.breakX} on ${op.mesh}`);
  ay /= n;
  az /= n;
  const onTube = (v: number) => {
    const p = g.pos(v);
    return p[0] > op.breakX && Math.hypot(p[1] - ay, p[2] - az) < op.axisRadius;
  };
  const tris = g.cut((f) => g.tri(f).every(onTube));
  if (tris.length === 0) throw new Error(`breakBarrel: no barrel faces on ${op.mesh}`);
  let root = Infinity;
  for (const t of tris) for (const v of t) root = Math.min(root, g.pos(v)[0]);
  // In the ground frame: the pivot, the barrel's direction, and the axis
  // across it that tips the muzzle DOWN whatever way the turret was thrown.
  const pivot = xfPoint(frame.toGround, [root, ay, az]);
  const dir = norm(xfDir(frame.toGround, [1, 0, 0]));
  let across = norm(cross(dir, [0, 1, 0]));
  if (Math.hypot(...cross(dir, [0, 1, 0])) < 1e-3) across = [0, 0, 1];
  const ground = new Map<number, V3>();
  for (const t of tris) for (const v of t) ground.set(v, xfPoint(frame.toGround, g.pos(v)));
  // Find the sign that lowers the muzzle, then the largest angle up to
  // `droopDeg` that keeps every vertex 2 cm above the sand.
  const lowest = (theta: number) => {
    let y = Infinity;
    for (const p of ground.values()) y = Math.min(y, add(rotate(sub(p, pivot), across, theta), pivot)[1]);
    return y;
  };
  const want = (op.droopDeg * Math.PI) / 180;
  const sign = lowest(want) < lowest(-want) ? 1 : -1;
  let theta = sign * want;
  for (let k = 0; k < 40 && lowest(theta) < 0.02; k++) theta *= 0.9;
  g.reattach(tris, (p, nn) => {
    const q = add(rotate(sub(xfPoint(frame.toGround, p), pivot), across, theta), pivot);
    const m = rotate(xfDir(frame.toGround, nn), across, theta);
    return [xfPoint(frame.fromGround, q), xfDir(frame.fromGround, m)];
  });
  return tris.length;
}

/** One wheel of the scene's `rl_running_gear` (#550). */
interface GearWheel {
  readonly side: string;
  readonly centre: V3;
  readonly radius: number;
}

function dropTyre(g: Geo, op: DropTyre, frame: Frame, wheels: readonly GearWheel[], liveRubber: Primitive): number {
  const wheel = wheels[op.wheel];
  if (!wheel) throw new Error(`dropTyre: no wheel ${op.wheel} in rl_running_gear (${wheels.length} wheels)`);
  const c = wheel.centre;
  // The same volume the wreck pass seats around (`lost-tyre.ts`), its slab
  // measured off the LIVE rubber whichever mesh this cut is on.
  const tyre = lostTyre(liveRubber, wheel, op.wheel);
  // A face goes only when ALL its vertices are in the tyre: the wreck pass's
  // seat skips tyre VERTICES, so a face cut on its centroid could take with
  // it a vertex the seat stood the corner on (the technical's corner was left
  // 0.047 m in the air that way).
  const tris = g.cut((f) =>
    g.tri(f).every((v) => {
      const q = g.pos(v);
      return inLostTyre(tyre, q[0], q[1], q[2]);
    })
  );
  if (tris.length === 0) throw new Error(`dropTyre: no face of wheel ${op.wheel} outside its rim on ${op.mesh}`);
  const s = c[2] >= 0 ? 1 : -1;
  // Axle (Z) to vertical, then a yaw: the tyre lies flat. Both about its own centre.
  const flat = (v: V3): V3 => rotate(rotate(v, [1, 0, 0], (-s * Math.PI) / 2), [0, 1, 0], (op.yawDeg * Math.PI) / 180);
  let lowest = Infinity;
  for (const t of tris) for (const v of t) lowest = Math.min(lowest, flat(sub(g.pos(v), c))[1]);
  const at: V3 = [c[0] + op.along, 0.01 - lowest, s * (Math.abs(c[2]) + op.out)];
  g.reattach(tris, (p, nn) => [xfPoint(frame.fromGround, add(flat(sub(p, c)), at)), xfDir(frame.fromGround, flat(nn))]);
  return tris.length;
}

function blowOut(g: Geo, op: BlowOut): number {
  const gone = g.cut((f) => hash01(f * 2654435761 + 17) >= op.keep);
  if (g.faces === 0) throw new Error(`blowOut: keep ${op.keep} left no shard on ${op.mesh}`);
  return gone.length;
}

function snapRotor(g: Geo, op: SnapRotor, frame: Frame): number {
  // The hub: the middle of the disc's own plan bounds.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < g.count; i++) {
    const p = g.pos(i);
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
  }
  const hub: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const radial = (p: V3) => Math.hypot(p[0] - hub[0], p[2] - hub[2]);
  const SECTORS = 24;
  const sector = (p: V3) => Math.floor(((Math.atan2(p[2] - hub[2], p[0] - hub[0]) + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS;
  // Blades: runs of occupied sectors, circular, from the faces past the hub.
  const occupied = new Array<boolean>(SECTORS).fill(false);
  const isBlade = (f: number) => g.tri(f).every((v) => radial(g.pos(v)) > op.hubRadius);
  for (let f = 0; f < g.faces; f++) if (isBlade(f)) occupied[sector(g.centroid(f))] = true;
  const start = occupied.findIndex((o, k) => !o && occupied[(k + 1) % SECTORS]);
  if (start < 0) throw new Error(`snapRotor: no gap between blades on ${op.mesh} -- not a bladed disc`);
  const bladeOf = new Array<number>(SECTORS).fill(-1);
  let blade = -1;
  for (let k = 1; k <= SECTORS; k++) {
    const s = (start + k) % SECTORS;
    if (!occupied[s]) continue;
    if (!occupied[(s + SECTORS - 1) % SECTORS]) blade++;
    bladeOf[s] = blade;
  }
  const blades = blade + 1;
  if (blades < 2 || op.snapBlade >= blades) throw new Error(`snapRotor: ${blades} blade(s) found on ${op.mesh}`);

  const groups: [number, number, number][][] = Array.from({ length: blades }, () => []);
  const snapped: [number, number, number][] = [];
  const all = g.cut(isBlade);
  for (const t of all) {
    const c = t.map((v) => g.pos(v)).reduce((a, b) => add(a, b), [0, 0, 0] as V3);
    const b = bladeOf[sector(scale(c, 1 / 3))]!;
    if (b === op.snapBlade && t.every((v) => radial(g.pos(v)) > op.snapAt)) snapped.push(t);
    else groups[b]!.push(t);
  }
  const hubG = xfPoint(frame.toGround, hub);
  // Each blade droops about the hub, toward the sand, as far as `droopDeg` or 2 cm above the ground.
  for (const tris of groups) {
    if (tris.length === 0) continue;
    let mean: V3 = [0, 0, 0];
    let n = 0;
    for (const t of tris) for (const v of t) { mean = add(mean, xfPoint(frame.toGround, g.pos(v))); n++; }
    const dir = norm([mean[0] / n - hubG[0], 0, mean[2] / n - hubG[2]]);
    const axis = norm(cross(dir, [0, 1, 0]));
    const pts = new Map<number, V3>();
    for (const t of tris) for (const v of t) pts.set(v, xfPoint(frame.toGround, g.pos(v)));
    const lowest = (th: number) => {
      let y = Infinity;
      for (const p of pts.values()) y = Math.min(y, add(rotate(sub(p, hubG), axis, th), hubG)[1]);
      return y;
    };
    const want = (op.droopDeg * Math.PI) / 180;
    const sign = lowest(want) < lowest(-want) ? 1 : -1;
    let th = sign * want;
    for (let k = 0; k < 40 && lowest(th) < 0.02; k++) th *= 0.9;
    g.reattach(tris, (p, nn) => [
      xfPoint(frame.fromGround, add(rotate(sub(xfPoint(frame.toGround, p), hubG), axis, th), hubG)),
      xfDir(frame.fromGround, rotate(xfDir(frame.toGround, nn), axis, th)),
    ]);
  }
  // The broken piece: flattened onto the sand beside the body.
  if (snapped.length > 0) {
    let c: V3 = [0, 0, 0];
    let n = 0;
    for (const t of snapped) for (const v of t) { c = add(c, xfPoint(frame.toGround, g.pos(v))); n++; }
    c = scale(c, 1 / n);
    const yaw = (op.yawDeg * Math.PI) / 180;
    const flatOf = (p: V3): V3 => {
      const q = sub(xfPoint(frame.toGround, p), c);
      return rotate([q[0], q[1] * 0.15, q[2]], [0, 1, 0], yaw);
    };
    let low = Infinity;
    for (const t of snapped) for (const v of t) low = Math.min(low, flatOf(g.pos(v))[1]);
    g.reattach(snapped, (p) => [
      xfPoint(frame.fromGround, add(flatOf(p), [op.lieAt[0], 0.01 - low, op.lieAt[1]])),
      xfDir(frame.fromGround, [0, 1, 0]),
    ]);
  }
  return all.length;
}

/** Resolves once meshoptimizer's WASM is up; `applyDamagePass` refuses a `simplify` before it. */
let simplifierUp = false;
export const damagePassReady: Promise<void> = MeshoptSimplifier.ready.then(() => {
  simplifierUp = true;
});

/** What the last `simplify` achieved, for the log and the tests: the error meshopt reports, relative to the mesh extent. */
export const simplifyReadings: { mesh: string; before: number; after: number; error: number }[] = [];

function simplify(g: Geo, op: Simplify): number {
  if (!simplifierUp) throw new Error('simplify: await damagePassReady before applyDamagePass');
  if (!(op.ratio > 0 && op.ratio <= 1)) throw new Error(`simplify: ratio ${op.ratio} is not in (0, 1]`);
  const before = g.faces;
  const pos = new Float32Array(g.count * 3);
  for (let i = 0; i < g.count; i++) pos.set(g.pos(i), 3 * i);
  const target = Math.floor((g.idx.length * op.ratio) / 3) * 3;
  const [out, error] = MeshoptSimplifier.simplify(new Uint32Array(g.idx), pos, 3, target, op.maxError, op.flags ? [...op.flags] : undefined);
  g.idx = Array.from(out);
  simplifyReadings.push({ mesh: op.mesh, before, after: g.faces, error });
  return before - g.faces;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

const extrasOf = (o: { getExtras(): Record<string, unknown> }): Record<string, unknown> => o.getExtras() ?? {};
const isDamaged = (o: { getExtras(): Record<string, unknown> }): boolean => DAMAGE_KEY in extrasOf(o);

function deathRootOf(doc: Document): Node | undefined {
  return doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === DEATH_ROOT);
}

/** Dispose an accessor iff nothing but the Root still references it. */
function disposeIfOrphan(accessor: Accessor): void {
  if (accessor.listParents().every((p) => p.propertyType === 'Root')) accessor.dispose();
}

/**
 * Point every damaged twin back at its live mesh and dispose the copies --
 * and every accessor only a copy held, since the writer emits whatever the
 * Root still holds (the wreck pass's own trap).
 */
export function stripDamage(doc: Document): void {
  const liveByName = new Map<string, Mesh>();
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh();
    if (m && !n.getName().startsWith(WRECK_PREFIX)) liveByName.set(n.getName(), m);
  }
  for (const n of doc.getRoot().listNodes()) {
    if (!isDamaged(n)) continue;
    const { [DAMAGE_KEY]: dmg, ...rest } = extrasOf(n);
    const source = (dmg as { source?: unknown } | undefined)?.source;
    const live = typeof source === 'string' ? liveByName.get(source) : undefined;
    if (!live) throw new Error(`damage-pass: ${n.getName()} names source "${String(source)}", which no live node has`);
    n.setMesh(live).setExtras(rest);
  }
  for (const m of doc.getRoot().listMeshes()) {
    if (!isDamaged(m)) continue;
    const accessors = m.listPrimitives().flatMap((p) => [...p.listAttributes(), ...(p.getIndices() ? [p.getIndices()!] : [])]);
    for (const p of m.listPrimitives()) p.dispose();
    m.dispose();
    for (const a of accessors) disposeIfOrphan(a);
  }
}

function writeGeo(doc: Document, like: Primitive, g: Geo): Primitive {
  const buffer = like.getAttribute('POSITION')!.getBuffer() ?? doc.getRoot().listBuffers()[0]!;
  const prim = doc.createPrimitive().setMaterial(like.getMaterial()).setMode(like.getMode());
  for (const a of g.attrs) {
    prim.setAttribute(
      a.semantic,
      doc
        .createAccessor()
        .setBuffer(buffer)
        .setType(a.type as 'SCALAR')
        .setNormalized(a.normalized)
        .setArray(new a.ctor(a.data) as Float32Array<ArrayBuffer>)
    );
  }
  const big = g.count > 65535;
  prim.setIndices(doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(big ? new Uint32Array(g.idx) : new Uint16Array(g.idx)));
  return prim;
}

/**
 * Cut `ops` into `doc`'s wreck twins. Idempotent: strips first.
 * Returns what each verb moved, for the log and the tests.
 */
export function applyDamagePass(doc: Document, vehicleId: string, ops: readonly DamageOp[]): VerbReport[] {
  stripDamage(doc);
  const deathRoot = deathRootOf(doc);
  if (!deathRoot) throw new Error(`${vehicleId}: no ${DEATH_ROOT} -- run wreck:meshes first`);
  const dm = deathRoot.getMatrix();
  for (let k = 0; k < 16; k++) {
    if (Math.abs(dm[k]! - (k % 5 === 0 ? 1 : 0)) > 1e-9) throw new Error(`${vehicleId}: ${DEATH_ROOT} is not at the identity`);
  }

  const reports: VerbReport[] = [];
  const meshNameOf = (op: DamageOp) => (op.verb === 'throwTrack' ? 'hull_rubber' : op.mesh);
  const rg = doc.getRoot().listScenes()[0]?.getExtras().rl_running_gear as { wheels?: GearWheel[] } | undefined;
  const wheels = rg?.wheels ?? [];
  const liveRubber = (): Primitive => {
    const n = doc.getRoot().listNodes().find((x) => x.getName() === 'hull_rubber');
    const p = n?.getMesh()?.listPrimitives()[0];
    if (!p) throw new Error(`${vehicleId}: dropTyre needs the live hull_rubber`);
    return p;
  };
  const byMesh = new Map<string, DamageOp[]>();
  for (const op of ops) byMesh.set(meshNameOf(op), [...(byMesh.get(meshNameOf(op)) ?? []), op]);

  for (const [source, meshOps] of byMesh) {
    const twin = deathRoot.listChildren().find((n) => n.getName() === `${WRECK_PREFIX}${source}`);
    if (!twin) throw new Error(`${vehicleId}: no ${WRECK_PREFIX}${source} under ${DEATH_ROOT}`);
    const live = twin.getMesh();
    if (!live) throw new Error(`${vehicleId}: ${twin.getName()} has no mesh`);
    const prims = live.listPrimitives();
    if (prims.length !== 1) throw new Error(`${vehicleId}: ${source} has ${prims.length} primitives (the contract is one)`);
    const like = prims[0]!;
    const g = new Geo(like);
    const toGround = twin.getMatrix();
    const frame: Frame = { toGround, fromGround: invertAffine(toGround) };
    for (const op of meshOps) {
      const faces =
        op.verb === 'throwTrack'
          ? throwTrack(g, op, frame)
          : op.verb === 'peelPlate'
            ? peelPlate(g, op)
            : op.verb === 'breakBarrel'
              ? breakBarrel(g, op, frame)
              : op.verb === 'dropTyre'
                ? dropTyre(g, op, frame, wheels, liveRubber())
                : op.verb === 'snapRotor'
                  ? snapRotor(g, op, frame)
                  : op.verb === 'simplify'
                    ? simplify(g, op)
                    : blowOut(g, op);
      reports.push({ verb: op.verb, mesh: source, faces });
    }
    g.compact();
    const copy = doc
      .createMesh(`${WRECK_PREFIX}${source}`)
      .addPrimitive(writeGeo(doc, like, g))
      .setExtras({ [DAMAGE_KEY]: { source } });
    twin.setMesh(copy).setExtras({ ...extrasOf(twin), [DAMAGE_KEY]: { source } });
  }
  return reports;
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

const KNOWN = (): string => Object.keys(DAMAGE_RECIPES).join(', ');
const ID_FLAG = '--id=';

/** argv -> ids. Every argument must be recognised: a typo must not rewrite every vehicle. */
export function parseDamageArgs(argv: readonly string[]): readonly string[] | 'all' {
  const ids: string[] = [];
  for (const arg of argv) {
    if (arg === '--') continue;
    if (!arg.startsWith(ID_FLAG) || arg.length === ID_FLAG.length) {
      throw new Error(`unrecognised argument "${arg}" -- usage: damage:meshes [--id=<vehicle>]... -- known: ${KNOWN()}`);
    }
    ids.push(arg.slice(ID_FLAG.length));
  }
  return ids.length ? ids : 'all';
}

export async function runDamagePass(ids: readonly string[] | 'all', dir = VEHICLES): Promise<void> {
  const wanted = ids === 'all' ? Object.keys(DAMAGE_RECIPES) : ids;
  for (const id of wanted) {
    if (!Object.prototype.hasOwnProperty.call(DAMAGE_RECIPES, id)) throw new Error(`no damage recipe for "${id}" -- known: ${KNOWN()}`);
  }
  await damagePassReady;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const id of wanted) {
    const file = path.join(dir, `${id}.glb`);
    const before = readFileSync(file).length;
    const doc = await io.read(file);
    const reports = applyDamagePass(doc, id, DAMAGE_RECIPES[id]!);
    await io.write(file, doc);
    const after = statSync(file).size;
    console.log(`DAMAGE_PASS_OK ${id} ${after - before >= 0 ? '+' : ''}${after - before} bytes: ${reports.map((r) => `${r.verb}(${r.mesh}, ${r.faces} faces)`).join(', ')}`);
    for (const r of simplifyReadings.splice(0)) {
      console.log(`  simplify ${r.mesh}: ${r.before} -> ${r.after} triangles (${((100 * r.after) / r.before).toFixed(1)}%), meshopt error ${r.error.toExponential(3)}`);
    }
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  runDamagePass(parseDamageArgs(process.argv.slice(2))).then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
