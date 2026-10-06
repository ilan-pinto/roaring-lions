/**
 * An ankle for every walker (`{prefix}_foot_L` / `_R`).
 *
 * rig.py's rigs end at the shin: the boot is rigid on it, so a boot can only
 * point where the shin points. On a planted foot that is fatal -- as the
 * body passes over it the shin turns through ~60 deg, and a rigid boot
 * drags its sole backward (measured: re-solved legs read 1.3-1.9x the
 * ground speed with the ankle planted) or digs its toe into the ground (a
 * kneeling back foot went 0.14 m under). With an ankle the boot stays flat
 * through the stance and tucks its toe when the man kneels.
 *
 * The bone sits at the ankle -- `ANKLE_ABOVE_SOLE` above the boot's own sole,
 * under the knee -- and takes every boot vertex below `ANKLE_SPLIT_ABOVE`
 * over that height; the shaft of the boot stays on the shin. Faces across
 * the split stretch a little at the ankle, as a skinned ankle does.
 *
 * Every animation keys the new bones at their rest (rig.py's rule: an
 * untouched bone keeps whatever the last clip left in it); the passes that
 * pose a foot overwrite those keys.
 */
import type { Document } from '@gltf-transform/core';
import { addBone, rebind, writeTrack } from './edit';
import { keyTimes, restVertices, Rig, tracksOf } from './rig';

export const ANKLE_ABOVE_SOLE = 0.09;
export const ANKLE_SPLIT_ABOVE = 0.02;

/** Every prefix with a shin -- every standing or walking body. */
export function shinPrefixes(rig: Rig): string[] {
  return rig.nodes
    .map((n) => /^(.*)_shin_L$/.exec(n.getName())?.[1])
    .filter((p): p is string => p !== undefined && rig.has(`${p}_shin_R`));
}

export function addFeet(doc: Document): string[] {
  let rig = new Rig(doc);
  const prefixes = shinPrefixes(rig);
  const verts = restVertices(rig);
  const lines: string[] = [];
  for (const p of prefixes) {
    for (const side of ['L', 'R'] as const) {
      const shin = rig.node(`${p}_shin_${side}`);
      const boot = verts.filter((v) => v.role === 'boot' && v.joint === shin);
      if (boot.length < 8) continue;
      const sole = Math.min(...boot.map((v) => v.p[1]));
      const knee = rig.restWorld.get(shin)!.t;
      const ankle: [number, number, number] = [knee[0], sole + ANKLE_ABOVE_SOLE, knee[2]];
      const foot = addBone(doc, rig, `${p}_foot_${side}`, shin, { t: ankle, r: [0, 0, 0, 1], s: 1 });
      rig = new Rig(doc);
      const moved = rebind(rig, 'boot', rig.node(shin.getName()), foot, (q) => q[1] < ankle[1] + ANKLE_SPLIT_ABOVE);
      lines.push(`ankle ${p}_foot_${side}: at ${ankle[1].toFixed(3)} m, ${moved} boot vertices`);
    }
  }
  rig = new Rig(doc);
  const feet = rig.nodes.filter((n) => /_foot_[LR]$/.test(n.getName()));
  for (const anim of doc.getRoot().listAnimations()) {
    const tracks = tracksOf(anim);
    for (const f of feet) {
      const shin = rig.parent.get(f)!;
      const times = keyTimes(tracks, shin.getName());
      const rest = rig.rest.get(f)!;
      writeTrack(doc, anim, f, 'translation', times, times.flatMap(() => [...rest.t]));
      writeTrack(doc, anim, f, 'rotation', times, times.flatMap(() => [...rest.r]));
      writeTrack(doc, anim, f, 'scale', times, times.flatMap(() => [1, 1, 1]));
    }
  }
  return lines;
}
