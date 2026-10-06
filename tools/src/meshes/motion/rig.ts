/**
 * Forward kinematics over a gltf-transform `Document`: the rest pose, a
 * clip sampled at a time, world transforms, and the skinned rest geometry
 * grouped by the joint that carries it.
 *
 * Every rigged infantry GLB in this repository binds RIGIDLY -- one joint
 * per vertex at weight 1 (`rig.rig_parts`, "no weight painting") -- so a
 * vertex's posed position is `jointWorld * jointRestWorld^-1 * v`, and its
 * stored position IS its rest (armature) position. The loader checks that
 * rather than assuming it: a vertex with a second weight over 1e-3 throws.
 */
import type { Accessor, Animation, Document, Node, Skin } from '@gltf-transform/core';
import { apply, compose, invert, qnorm, qslerp, XI, type Q, type V3, type Xf } from './math';

export interface Track {
  readonly node: Node;
  readonly path: 'translation' | 'rotation' | 'scale';
  readonly times: Float32Array;
  readonly values: Float32Array;
  readonly interpolation: string;
}

export type Pose = Map<Node, Xf>;

export function restLocal(node: Node): Xf {
  const s = node.getScale();
  return { t: [...node.getTranslation()] as V3, r: [...node.getRotation()] as Q, s: s[0] };
}

/** Every track of an animation, keyed `${node}.${path}`. */
export function tracksOf(anim: Animation): Map<string, Track> {
  const out = new Map<string, Track>();
  for (const c of anim.listChannels()) {
    const node = c.getTargetNode();
    const s = c.getSampler();
    const path = c.getTargetPath();
    if (!node || !s || (path !== 'translation' && path !== 'rotation' && path !== 'scale')) continue;
    out.set(`${node.getName()}.${path}`, {
      node,
      path,
      times: s.getInput()!.getArray() as Float32Array,
      values: s.getOutput()!.getArray() as Float32Array,
      interpolation: s.getInterpolation(),
    });
  }
  return out;
}

function sampleTrack(tr: Track, t: number): number[] {
  const n = tr.times.length;
  const k = tr.path === 'rotation' ? 4 : 3;
  const at = (i: number): number[] => Array.from(tr.values.subarray(i * k, i * k + k));
  if (n === 1 || t <= tr.times[0]) return at(0);
  if (t >= tr.times[n - 1]) return at(n - 1);
  let i = 0;
  while (i < n - 2 && tr.times[i + 1] <= t) i++;
  const a = at(i);
  if (tr.interpolation === 'STEP') return a;
  const b = at(i + 1);
  const u = (t - tr.times[i]) / (tr.times[i + 1] - tr.times[i]);
  if (k === 4) return qslerp(a as Q, b as Q, u);
  return a.map((x, j) => x + (b[j] - x) * u);
}

export function clipRange(tracks: Map<string, Track>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const tr of tracks.values()) {
    lo = Math.min(lo, tr.times[0]);
    hi = Math.max(hi, tr.times[tr.times.length - 1]);
  }
  return [lo, hi];
}

/** The key times of one node's rotation track, or a uniform grid. */
export function keyTimes(tracks: Map<string, Track>, nodeName: string, fallbackFps = 24): number[] {
  const tr = tracks.get(`${nodeName}.rotation`);
  if (tr && tr.times.length > 1) return Array.from(tr.times);
  const [lo, hi] = clipRange(tracks);
  const n = Math.max(1, Math.round((hi - lo) * fallbackFps));
  return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
}

/**
 * A dense key grid for re-keying a clip: `fps` uniform frames over its range,
 * merged with every key time any of its tracks already has. The second half
 * is load-bearing -- a track keyed coarser than the grid (a root's bob at
 * 30 fps) has a KINK at each of its keys, and a pose solved on either side of
 * one but not at it sags through it: a planted sole read 0.8 mm under the
 * ground at a root key that fell between two 120 fps keys.
 */
export function denseTimes(tracks: Map<string, Track>, fps: number): number[] {
  const [lo, hi] = clipRange(tracks);
  const n = Math.max(1, Math.round((hi - lo) * fps));
  const all = Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
  for (const tr of tracks.values()) all.push(...tr.times);
  all.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) if (out.length === 0 || t - out[out.length - 1] > 1e-6) out.push(t);
  return out;
}

export class Rig {
  readonly nodes: Node[];
  readonly byName = new Map<string, Node>();
  readonly parent = new Map<Node, Node | null>();
  readonly rest = new Map<Node, Xf>();
  readonly restWorld = new Map<Node, Xf>();
  readonly skin: Skin;
  readonly skinNode: Node[];

  constructor(readonly doc: Document) {
    const root = doc.getRoot();
    this.nodes = root.listNodes();
    for (const n of this.nodes) {
      this.byName.set(n.getName(), n);
      this.parent.set(n, n.getParentNode());
      this.rest.set(n, restLocal(n));
    }
    const skins = root.listSkins();
    if (skins.length !== 1) throw new Error(`motion: expected one skin, found ${skins.length}`);
    this.skin = skins[0];
    this.skinNode = this.nodes.filter((n) => n.getSkin() === this.skin);
    for (const n of this.nodes) this.restWorld.set(n, this.worldOf(n, this.rest));
  }

  node(name: string): Node {
    const n = this.byName.get(name);
    if (!n) throw new Error(`motion: no node ${name}`);
    return n;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** The local pose of every node at time `t` of a clip (rest where untracked). */
  sample(tracks: Map<string, Track>, t: number): Pose {
    const pose: Pose = new Map(this.rest);
    for (const tr of tracks.values()) {
      const cur = pose.get(tr.node) ?? XI;
      const v = sampleTrack(tr, t);
      if (tr.path === 'translation') pose.set(tr.node, { ...cur, t: v as V3 });
      else if (tr.path === 'rotation') pose.set(tr.node, { ...cur, r: qnorm(v as Q) });
      else pose.set(tr.node, { ...cur, s: v[0] });
    }
    return pose;
  }

  worldOf(node: Node, pose: Pose, cache?: Map<Node, Xf>): Xf {
    const hit = cache?.get(node);
    if (hit) return hit;
    const p = this.parent.get(node) ?? null;
    const local = pose.get(node) ?? this.rest.get(node) ?? XI;
    const w = p ? compose(this.worldOf(p, pose, cache), local) : local;
    cache?.set(node, w);
    return w;
  }

  /** A function that resolves world transforms for one pose, memoised. */
  worlds(pose: Pose): (n: Node | string) => Xf {
    const cache = new Map<Node, Xf>();
    return (n) => this.worldOf(typeof n === 'string' ? this.node(n) : n, pose, cache);
  }

  /** The local transform that puts `node` at world `w` under `pose`'s parent. */
  localFor(node: Node, w: Xf, pose: Pose): Xf {
    const p = this.parent.get(node) ?? null;
    if (!p) return w;
    const pw = this.worldOf(p, pose);
    // A parent scaled out of the clip (a living root hidden in `down` or
    // `wreck`, the corpse showing instead) has no inverse; whatever rides it
    // is invisible, so it keeps its rest pose rather than a NaN.
    if (Math.abs(pw.s) < 1e-8) return this.rest.get(node) ?? w;
    return compose(invert(pw), w);
  }
}

export interface RestVertex {
  readonly role: string;
  readonly joint: Node;
  readonly p: V3;
}

/**
 * Every skinned vertex at rest, tagged with its role (`extras.rl_role` or the
 * mesh name) and the one joint that carries it.
 */
export function restVertices(rig: Rig): RestVertex[] {
  const out: RestVertex[] = [];
  const joints = rig.skin.listJoints();
  for (const node of rig.skinNode) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    // A vertex's rest WORLD position is jointRestWorld * inverseBind * v --
    // glTF's own skinning at the rest pose. On every rig.py team that product
    // is the identity (the binds are the rests, at the origin); a captured
    // civilian's mesh sits in its exporter's own space under a 0.01-scaled,
    // quarter-turned armature, and only this form puts its boots on the ground.
    const ibm = rig.skin.getInverseBindMatrices()!.getArray()!;
    const role = ((node.getExtras() as { rl_role?: string }).rl_role ??
      (mesh.getExtras() as { rl_role?: string }).rl_role ??
      mesh.getName()) as string;
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')!.getArray()!;
      const j = prim.getAttribute('JOINTS_0')!.getArray()!;
      const w = prim.getAttribute('WEIGHTS_0')!.getArray()!;
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (w[i * 4 + k] > w[i * 4 + best]) best = k;
        const ji = j[i * 4 + best];
        const m = ibm.subarray(ji * 16, ji * 16 + 16);
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const local: V3 = [
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ];
        out.push({ role, joint: joints[ji], p: apply(rig.restWorld.get(joints[ji])!, local) });
      }
    }
  }
  return out;
}

/** World position of a rest point carried rigidly by `joint` under a pose. */
export function carry(rig: Rig, world: (n: Node) => Xf, joint: Node, restPoint: V3): V3 {
  const restW = rig.restWorld.get(joint)!;
  return apply(world(joint), apply(invert(restW), restPoint));
}

export type { Accessor };
