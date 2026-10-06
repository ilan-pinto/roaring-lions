/**
 * Structural edits to a rigged GLB: a new bone in the skin, vertices moved
 * onto it, and animation channels replaced or added. Kept apart from the
 * kinematics so each half can be read without the other.
 */
import type { Animation, Document, Node } from '@gltf-transform/core';
import { compose, invert, toMat4, type Xf } from './math';
import type { Rig } from './rig';

/** Add `name` as a child of `parent`, at rest WORLD `restWorld`, to the skin. */
export function addBone(doc: Document, rig: Rig, name: string, parent: Node, restWorld: Xf): Node {
  if (rig.has(name)) throw new Error(`motion: ${name} already exists -- has this file been through the pass?`);
  const local = compose(invert(rig.restWorld.get(parent)!), restWorld);
  const node = doc.createNode(name).setTranslation(local.t).setRotation(local.r).setScale([local.s, local.s, local.s]);
  parent.addChild(node);
  const skin = rig.skin;
  const ibm = skin.getInverseBindMatrices();
  if (!ibm) throw new Error('motion: the skin has no inverse bind matrices');
  const old = ibm.getArray() as Float32Array;
  const next = new Float32Array(old.length + 16);
  next.set(old);
  next.set(toMat4(invert(restWorld)), old.length);
  ibm.setArray(next);
  skin.addJoint(node);
  return node;
}

/**
 * Move every vertex of meshes with role `role` whose dominant joint is
 * `from` (and passes `keep`) onto `to`, rigidly. Returns how many moved.
 */
export function rebind(rig: Rig, role: string, from: Node, to: Node, keep: (p: [number, number, number]) => boolean = () => true): number {
  const joints = rig.skin.listJoints();
  const fromIdx = joints.indexOf(from);
  const toIdx = joints.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) throw new Error('motion: rebind joint not in the skin');
  let moved = 0;
  for (const node of rig.skinNode) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const r = (node.getExtras() as { rl_role?: string }).rl_role ?? (mesh.getExtras() as { rl_role?: string }).rl_role ?? mesh.getName();
    if (r !== role) continue;
    for (const prim of mesh.listPrimitives()) {
      const ja = prim.getAttribute('JOINTS_0')!;
      const wa = prim.getAttribute('WEIGHTS_0')!;
      const pa = prim.getAttribute('POSITION')!.getArray()!;
      const j = ja.getArray()!;
      const w = wa.getArray()!;
      const n = j.length / 4;
      for (let i = 0; i < n; i++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (w[i * 4 + k] > w[i * 4 + best]) best = k;
        if (j[i * 4 + best] !== fromIdx) continue;
        if (!keep([pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]])) continue;
        j[i * 4] = toIdx;
        j[i * 4 + 1] = 0;
        j[i * 4 + 2] = 0;
        j[i * 4 + 3] = 0;
        w[i * 4] = 1;
        w[i * 4 + 1] = 0;
        w[i * 4 + 2] = 0;
        w[i * 4 + 3] = 0;
        moved++;
      }
      ja.setArray(j);
      wa.setArray(w);
    }
  }
  return moved;
}

/** Replace (or add) the `path` channel of `node` in `anim`. */
export function writeTrack(
  doc: Document,
  anim: Animation,
  node: Node,
  path: 'translation' | 'rotation' | 'scale',
  times: number[],
  values: number[]
): void {
  for (const c of anim.listChannels()) {
    if (c.getTargetNode() === node && c.getTargetPath() === path) {
      const s = c.getSampler();
      c.dispose();
      if (s) {
        const i = s.getInput();
        const o = s.getOutput();
        s.dispose();
        for (const a of [i, o]) if (a && a.listParents().every((p) => p === doc.getRoot())) a.dispose();
      }
    }
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
  const output = doc
    .createAccessor()
    .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
    .setArray(new Float32Array(values))
    .setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  anim.addSampler(sampler);
  anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
}

/** Translate a node's rest AND every translation key of it, by `d`. */
export function shiftNode(doc: Document, node: Node, d: [number, number, number]): void {
  const t = node.getTranslation();
  node.setTranslation([t[0] + d[0], t[1] + d[1], t[2] + d[2]]);
  for (const anim of doc.getRoot().listAnimations()) {
    for (const c of anim.listChannels()) {
      if (c.getTargetNode() !== node || c.getTargetPath() !== 'translation') continue;
      const out = c.getSampler()!.getOutput()!;
      const v = (out.getArray() as Float32Array).slice();
      for (let i = 0; i < v.length; i += 3) {
        v[i] += d[0];
        v[i + 1] += d[1];
        v[i + 2] += d[2];
      }
      // A fresh accessor: an output may be shared between channels.
      const fresh = doc.createAccessor().setType('VEC3').setArray(v).setBuffer(doc.getRoot().listBuffers()[0]);
      c.getSampler()!.setOutput(fresh);
      if (out.listParents().every((p) => p === doc.getRoot())) out.dispose();
    }
  }
}
