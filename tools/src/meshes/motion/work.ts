/**
 * The `work` clip for a kneeling crew that sets a charge (Field Works #277,
 * Task 12 Step 4): one looping clip, `work`, that `demo_squad` plays while
 * its engineer digs in or builds, instead of the `idle` the renderer falls
 * back on while a team has no `work`.
 *
 * Not rig.py's `build_work_clip`: that keys a SEPARATE kneeler body, which a
 * Meshy cut that stands (demo_a, since the spike-walk change of 6 Oct) does
 * not have. This is built the way `pinned.ts` is, from the team's own `kneel`
 * clip: every figure holds the kneel (the breath of the base carries
 * through), and each `workers` figure works over it, one of two ways.
 *
 *   A free-armed worker (every rigid or procedural figure) PUMPS its
 *   anatomical-right forearm and upper arm and leans its spine into the work,
 *   by the same radians `rig.py` declares for the sprite (`WORK_PUMP_RAD`,
 *   `WORK_SPINE_RAD`).
 *
 *   A worker whose fists are FUSED to its weapon (a skinned Meshy figure,
 *   `rl_hands.source === 'meshy'`, with a weapon bone of its own: the Combat
 *   Engineers since GH-826 unit 1, variant (a), the lead's ruling of 12 Nov
 *   2026) cannot pump: a forearm turned about its elbow takes a fist that is
 *   one piece with the carbine off the carbine. He kneels over the charge with
 *   the carbine still in BOTH hands instead: the kneel's legs and hips, the
 *   torso leant over the charge and bobbing, the head down looking at it, and
 *   everything the spine carries (both arms, both fists, the weapon) in the
 *   sculpted carry, where the fists are closed on the gun by construction.
 *   The kneel's own upper body is not kept: it is the AIM (`kneel.ts`), and a
 *   man setting a charge is not sighting down his carbine.
 *
 * World-axis turns about the figure's own lateral axis (its root +Z), as the
 * pinned fold's: a positive turn is forward.
 *
 * It keys every node `kneel` keys (an untouched bone keeps whatever the last
 * clip left in it), loops over `kneel`'s duration, and is idempotent: it
 * reads only clips it does not write (`--step=work` replaces its own).
 */
import type { Document, Node } from '@gltf-transform/core';
import { deg, qaxis, qconj, qmul, qnorm, qrot, type V3 } from './math';
import { rotateWorld } from './hold';
import { rlHands } from './hands';
import { KNEEL_FPS, writeClip } from './kneel';
import { clipRange, Rig, tracksOf, type Pose } from './rig';

export const WORK_VERSION = 1;
/** rig.py: WORK_PUMP_RAD, half of it on the upper arm, and WORK_SPINE_RAD. */
export const WORK_PUMP_RAD = 0.22;
export const WORK_SPINE_RAD = 0.08;
/**
 * A worker with fused fists: the torso's steady lean over the charge and the bob about it (the whole of his motion, so
 * a little more than the 0.08 rad that went with an arm pump), and how far the neck and the head each look down past the
 * torso. The lean is what the carbine allows: carried across the lap in the sculpted hold, its magazine hangs over the
 * raised thigh, and at 22 degrees plus a 0.14 rad bob it went into the knee pad (rendered, 12 Nov 2026). At 13 plus
 * 0.10 it clears it; the head, which nods the whole bob again, carries the rest of the read.
 */
export const WORK_HELD_LEAN_DEG = 13;
export const WORK_HELD_BOB_RAD = 0.1;
export const WORK_HELD_LOOK_DEG = { neck: 16, head: 22 } as const;
/** ...and the neck and the head each nod with the bob by this share of it (the head leads the torso down to the work). */
export const WORK_HELD_NOD = 0.5;

/** Every node under `top`, itself excluded. */
function descendants(rig: Rig, top: Node): Node[] {
  return rig.nodes.filter((n) => {
    for (let p = rig.parent.get(n) ?? null; p; p = rig.parent.get(p) ?? null) if (p === top) return true;
    return false;
  });
}

/** Whether `w` works with both fists fused to a weapon of its own (the module comment's second way). */
export function worksHeld(rig: Rig, w: string): boolean {
  return rlHands(rig)?.source === 'meshy' && rig.has(`${w}_weapon`) && rig.has(`${w}_hand_L`) && rig.has(`${w}_hand_R`);
}

export function applyWork(doc: Document, id: string, workers: readonly string[]): string[] {
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (a.getName() !== 'work') continue;
    const data = a.listSamplers().flatMap((s) => [s.getInput(), s.getOutput()]).filter((x): x is NonNullable<typeof x> => x !== null);
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
    for (const acc of new Set(data)) if (acc.listParents().every((p) => p === root)) acc.dispose();
  }
  const rig = new Rig(doc);
  const base = root.listAnimations().find((a) => a.getName() === 'kneel');
  if (!base) throw new Error(`${id}: no kneel to work from`);
  const tracks = tracksOf(base);
  const [t0, t1] = clipRange(tracks);
  const nodes = [...new Set([...tracks.values()].map((t) => t.node))];
  const held = workers.filter((w) => worksHeld(rig, w));
  /** What a held worker's spine carries: both arms, both fists, the weapon, the neck and the head. */
  const carried = new Map<string, Node[]>(held.map((w) => [w, descendants(rig, rig.node(`${w}_spine`))]));
  for (const w of workers) {
    const moved = held.includes(w)
      ? [rig.node(`${w}_spine`), ...carried.get(w)!]
      : ['upperarm_R', 'forearm_R', 'spine'].map((part) => {
          if (!rig.has(`${w}_${part}`)) throw new Error(`${id}: kneel does not key ${w}_${part}`);
          return rig.node(`${w}_${part}`);
        });
    for (const n of moved) if (!nodes.includes(n)) throw new Error(`${id}: kneel does not key ${n.getName()}`);
  }
  const dur = t1 - t0;
  const n = Math.max(2, Math.round(dur * KNEEL_FPS));
  const times = Array.from({ length: n + 1 }, (_, i) => (i / n) * dur);
  const poses = times.map((t) => {
    const p = rig.sample(tracks, t0 + t);
    const pump = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / dur);
    for (const w of workers) {
      const lateral: V3 = qrot(rig.worldOf(rig.node(`${w}_root`), p).r, [0, 0, 1]);
      if (held.includes(w)) {
        workHeld(rig, p, w, carried.get(w)!, lateral, pump);
        continue;
      }
      rotateWorld(rig, p, rig.node(`${w}_spine`), qaxis(lateral, WORK_SPINE_RAD * pump));
      rotateWorld(rig, p, rig.node(`${w}_upperarm_R`), qaxis(lateral, 0.5 * WORK_PUMP_RAD * pump));
      rotateWorld(rig, p, rig.node(`${w}_forearm_R`), qaxis(lateral, WORK_PUMP_RAD * pump));
    }
    return p;
  });
  writeClip(doc, 'work', nodes, times, poses);
  const scene = root.listScenes()[0];
  scene.setExtras({
    ...((scene.getExtras() ?? {}) as Record<string, unknown>),
    rl_work: { version: WORK_VERSION, workers: [...workers], ...(held.length ? { held: [...held] } : {}) },
  });
  const how = workers.map((w) => `${w} ${held.includes(w) ? 'leans and bobs over it, the weapon in both fists' : 'pumps'}`).join(', ');
  return [`work: from kneel, ${how}; ${n} frames over ${dur.toFixed(2)} s`];
}

/**
 * One frame of a held worker, into `pose` (which holds the kneel): the kneel's root, hips and legs are kept; the spine
 * stands upright over the kneeling root and leans WORK_HELD_LEAN_DEG forward, plus the bob; every node the spine carries
 * goes back to its rest local transform -- the sculpted carry, in which hand = weapon x station exactly -- and the neck
 * and the head then look down at the charge. No arm bone is turned on its own, so no fist can leave the gun.
 */
function workHeld(rig: Rig, pose: Pose, w: string, carried: readonly Node[], lateral: V3, pump: number): void {
  const spine = rig.node(`${w}_spine`);
  const rootN = rig.node(`${w}_root`);
  // upright over the root, as the hold's own `upright`: the root's turn from its rest, applied to the spine's rest
  const rw = rig.worldOf(rootN, pose);
  const up0 = qmul(qmul(rw.r, qconj(rig.restWorld.get(rootN)!.r)), rig.restWorld.get(spine)!.r);
  const pw = rig.worldOf(rig.parent.get(spine)!, pose);
  pose.set(spine, { ...pose.get(spine)!, r: qnorm(qmul(qconj(pw.r), up0)) });
  rotateWorld(rig, pose, spine, qaxis(lateral, deg(WORK_HELD_LEAN_DEG) + WORK_HELD_BOB_RAD * pump));
  for (const node of carried) pose.set(node, rig.rest.get(node)!);
  for (const part of ['neck', 'head'] as const) {
    rotateWorld(rig, pose, rig.node(`${w}_${part}`), qaxis(lateral, deg(WORK_HELD_LOOK_DEG[part]) + WORK_HELD_NOD * WORK_HELD_BOB_RAD * pump));
  }
}
