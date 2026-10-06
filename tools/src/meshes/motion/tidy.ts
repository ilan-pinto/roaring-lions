/**
 * Arm flaps: the Meshy A-pose remeshes carry a web of cloth from the armpit
 * to the sleeve, and the cut hands it to the upper arm. At the A-pose it is
 * hidden against the torso; on an arm brought forward onto a weapon it
 * stands off the arm like a wing (motion checkpoint finding #11: up to
 * 0.28 m from the arm's axis on `rpg_team`, where an arm is 0.05-0.06 m in
 * radius).
 *
 * The fix is geometric and local: every vertex an arm bone carries is held
 * within a radius of that bone's own axis, keeping where it lies ALONG the
 * axis. A vertex inside the cap does not move, so a sleeve keeps its shape
 * and only the web folds in. Weapons are never touched.
 */
import type { Document } from '@gltf-transform/core';
import { add, dot, len, norm, scale, sub, type V3 } from './math';
import { Rig } from './rig';

/** Radial caps, metres from the bone's axis. A real upper arm is about
 *  0.05-0.06 m in radius in a sleeve; the shoulder cap and the elbow pad
 *  stand a little proud, hence the margin. */
export const ARM_RADIUS_CAP = { upperarm: 0.085, forearm: 0.075 };
/** How far an arm part may reach past its own joints along the bone: the
 *  shoulder cap above the shoulder joint, and the elbow overlap. */
export const ARM_AXIAL_SLACK = { shoulder: 0.1, elbow: 0.04 };

export function tidyArms(doc: Document, prefixes: readonly string[]): string[] {
  const rig = new Rig(doc);
  const joints = rig.skin.listJoints();
  const lines: string[] = [];
  for (const p of prefixes) {
    for (const side of ['L', 'R']) {
      for (const seg of ['upperarm', 'forearm'] as const) {
        const bone = rig.node(`${p}_${seg}_${side}`);
        const ji = joints.indexOf(bone);
        const origin = rig.restWorld.get(bone)!.t;
        let axis: V3;
        if (seg === 'upperarm') axis = norm(sub(rig.restWorld.get(rig.node(`${p}_forearm_${side}`))!.t, origin));
        else {
          // The forearm's own direction: the bone's +Y in glTF bone space.
          const r = rig.restWorld.get(bone)!.r;
          const [x, y, z, w] = r;
          axis = norm([2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)]);
        }
        const cap = ARM_RADIUS_CAP[seg];
        // Along the axis too: a forearm vertex more than a few cm ABOVE its
        // own elbow, or an upper-arm one past it, is sleeve the cut gave to
        // the wrong bone, and it swings out as a slab when the arm bends.
        const upperLen = seg === 'upperarm' ? len(sub(rig.restWorld.get(rig.node(`${p}_forearm_${side}`))!.t, origin)) : Infinity;
        const tMin = seg === 'upperarm' ? -ARM_AXIAL_SLACK.shoulder : -ARM_AXIAL_SLACK.elbow;
        const tMax = seg === 'upperarm' ? upperLen + ARM_AXIAL_SLACK.elbow : Infinity;
        let moved = 0;
        let worst = 0;
        for (const node of rig.skinNode) {
          const mesh = node.getMesh();
          if (!mesh) continue;
          const role = (node.getExtras() as { rl_role?: string }).rl_role ?? mesh.getName();
          if (role === 'weapon' || role === 'metal') continue;
          for (const prim of mesh.listPrimitives()) {
            const pa = prim.getAttribute('POSITION')!;
            const pos = pa.getArray()!;
            const J = prim.getAttribute('JOINTS_0')!.getArray()!;
            const W = prim.getAttribute('WEIGHTS_0')!.getArray()!;
            let touched = false;
            for (let i = 0; i < pos.length / 3; i++) {
              let b = 0;
              for (let k = 1; k < 4; k++) if (W[i * 4 + k] > W[i * 4 + b]) b = k;
              if (J[i * 4 + b] !== ji) continue;
              const v: V3 = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
              const d = sub(v, origin);
              const t = dot(d, axis);
              const radial = sub(d, scale(axis, t));
              const r = len(radial);
              const tc = Math.min(tMax, Math.max(tMin, t));
              if (r <= cap && tc === t) continue;
              worst = Math.max(worst, r, t - tc, tc - t);
              const nv = add(add(origin, scale(axis, tc)), scale(radial, Math.min(1, cap / r)));
              pos[i * 3] = nv[0];
              pos[i * 3 + 1] = nv[1];
              pos[i * 3 + 2] = nv[2];
              moved++;
              touched = true;
            }
            if (touched) pa.setArray(pos);
          }
        }
        if (moved > 0) lines.push(`tidy ${p}_${seg}_${side}: ${moved} vertices folded in (worst ${worst.toFixed(3)} m -> ${cap})`);
      }
    }
  }
  return lines;
}
