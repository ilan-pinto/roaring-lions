/**
 * The wedge: each figure's living root and its corpse moved, rest and every
 * key alike, to the team's approved slot (`teams.ts`). A rigid translation of
 * a whole figure, so nothing about a pose changes -- only where the man
 * stands in his team. The renderer reads the slots back off the root bones
 * (`units/squad.ts`), so it never holds a copy of this table.
 */
import type { Document, Node } from '@gltf-transform/core';
import { shiftNode } from './edit';
import { invert, toMat4 } from './math';
import { Rig } from './rig';
import type { MotionTeam } from './teams';

export function applyFormation(doc: Document, spec: MotionTeam): string[] {
  const rig = new Rig(doc);
  verifyBinds(rig);
  const lines: string[] = [];
  for (const f of spec.figures) {
    if (!f.slot) continue;
    const root = rig.node(`${f.prefix}_root`);
    const at = rig.restWorld.get(root)!.t;
    const d: [number, number, number] = [f.slot[0] - at[0], 0, f.slot[1] - at[2]];
    const moving: Node[] = [root];
    for (const n of [`${f.prefix}_death_root`, ...(f.companions ?? [])]) if (rig.has(n)) moving.push(rig.node(n));
    // The figure's own vertices move with it, and its joints' inverse bind
    // matrices are rebuilt, so the file's REST pose agrees with its bind
    // pose afterwards -- every later stage (the hold, the kneel, the gait
    // pass, validate:meshes) measures rest geometry against joint rests.
    const subtree = new Set<Node>();
    const walk = (n: Node): void => {
      subtree.add(n);
      for (const c of n.listChildren()) walk(c);
    };
    for (const n of moving) walk(n);
    moveVertices(rig, subtree, d);
    for (const n of moving) {
      // A root bone's translation is in its parent's (the armature's) frame,
      // which carries no rotation in these files -- asserted, not assumed.
      const p = rig.parent.get(n);
      if (p) {
        const r = rig.restWorld.get(p)!.r;
        if (Math.abs(r[3]) < 0.9999) throw new Error(`formation: ${n.getName()}'s parent is rotated`);
      }
      shiftNode(doc, n, d);
    }
    rebuildBinds(new Rig(doc));
    lines.push(
      `wedge ${f.prefix}: (${at[0].toFixed(2)}, ${at[2].toFixed(2)}) -> (${f.slot[0].toFixed(2)}, ${f.slot[1].toFixed(2)}) m, ` +
        `${moving.length} node(s)`
    );
  }
  return lines;
}

export function moveVertices(rig: Rig, joints: Set<Node>, d: [number, number, number]): void {
  const list = rig.skin.listJoints();
  const idx = new Set([...joints].map((j) => list.indexOf(j)).filter((i) => i >= 0));
  for (const node of rig.skinNode) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const pa = prim.getAttribute('POSITION')!;
      const pos = pa.getArray()!;
      const J = prim.getAttribute('JOINTS_0')!.getArray()!;
      const W = prim.getAttribute('WEIGHTS_0')!.getArray()!;
      for (let i = 0; i < pos.length / 3; i++) {
        let b = 0;
        for (let k = 1; k < 4; k++) if (W[i * 4 + k] > W[i * 4 + b]) b = k;
        if (!idx.has(J[i * 4 + b])) continue;
        pos[i * 3] += d[0];
        pos[i * 3 + 1] += d[1];
        pos[i * 3 + 2] += d[2];
      }
      pa.setArray(pos);
    }
  }
}

/** The move rebuilds binds from rest worlds, so it first proves that is
 *  what the file's binds already are (and that its skinned meshes sit at
 *  the origin) -- otherwise a rebuild would silently re-pose every vertex. */
export function verifyBinds(rig: Rig): void {
  const arr = rig.skin.getInverseBindMatrices()!.getArray() as Float32Array;
  rig.skin.listJoints().forEach((j, i) => {
    const want = toMat4(invert(rig.restWorld.get(j)!));
    for (let k = 0; k < 16; k++) {
      if (Math.abs(arr[i * 16 + k] - want[k]) > 2e-4) {
        throw new Error(`formation: ${j.getName()}'s inverse bind matrix is not its rest (element ${k}: ${arr[i * 16 + k]} vs ${want[k]})`);
      }
    }
  });
  for (const n of rig.skinNode) {
    const t = n.getTranslation();
    const r = n.getRotation();
    if (Math.hypot(t[0], t[1], t[2]) > 1e-6 || Math.abs(r[3]) < 0.999999) throw new Error(`formation: skinned node ${n.getName()} is not at the origin`);
  }
}

/** Every joint's inverse bind matrix from its rest world (see verifyBinds). */
export function rebuildBinds(rig: Rig): void {
  const ibm = rig.skin.getInverseBindMatrices()!;
  const arr = (ibm.getArray() as Float32Array).slice();
  rig.skin.listJoints().forEach((j, i) => {
    arr.set(toMat4(invert(rig.restWorld.get(j)!)), i * 16);
  });
  ibm.setArray(arr);
}
