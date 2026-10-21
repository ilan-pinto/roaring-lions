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
 * through), and each `workers` figure pumps its anatomical-right forearm and
 * upper arm and leans its spine into the work, by the same radians
 * `rig.py` declares for the sprite (`WORK_PUMP_RAD`, `WORK_SPINE_RAD`).
 * World-axis turns about the figure's own lateral axis (its root +Z), as the
 * pinned fold's.
 *
 * It keys every node `kneel` keys (an untouched bone keeps whatever the last
 * clip left in it), loops over `kneel`'s duration, and is idempotent: it
 * reads only clips it does not write (`--step=work` replaces its own).
 */
import type { Document } from '@gltf-transform/core';
import { qaxis, qrot, type V3 } from './math';
import { rotateWorld } from './hold';
import { KNEEL_FPS, writeClip } from './kneel';
import { clipRange, Rig, tracksOf } from './rig';

export const WORK_VERSION = 1;
/** rig.py: WORK_PUMP_RAD, half of it on the upper arm, and WORK_SPINE_RAD. */
export const WORK_PUMP_RAD = 0.22;
export const WORK_SPINE_RAD = 0.08;

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
  for (const w of workers) {
    for (const part of ['upperarm_R', 'forearm_R', 'spine']) {
      if (!rig.has(`${w}_${part}`) || !nodes.includes(rig.node(`${w}_${part}`))) throw new Error(`${id}: kneel does not key ${w}_${part}`);
    }
  }
  const dur = t1 - t0;
  const n = Math.max(2, Math.round(dur * KNEEL_FPS));
  const times = Array.from({ length: n + 1 }, (_, i) => (i / n) * dur);
  const poses = times.map((t) => {
    const p = rig.sample(tracks, t0 + t);
    const pump = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / dur);
    for (const w of workers) {
      const lateral: V3 = qrot(rig.worldOf(rig.node(`${w}_root`), p).r, [0, 0, 1]);
      rotateWorld(rig, p, rig.node(`${w}_spine`), qaxis(lateral, WORK_SPINE_RAD * pump));
      rotateWorld(rig, p, rig.node(`${w}_upperarm_R`), qaxis(lateral, 0.5 * WORK_PUMP_RAD * pump));
      rotateWorld(rig, p, rig.node(`${w}_forearm_R`), qaxis(lateral, WORK_PUMP_RAD * pump));
    }
    return p;
  });
  writeClip(doc, 'work', nodes, times, poses);
  const scene = root.listScenes()[0];
  scene.setExtras({ ...((scene.getExtras() ?? {}) as Record<string, unknown>), rl_work: { version: WORK_VERSION, workers: [...workers] } });
  return [`work: from kneel, ${workers.join(', ')} pump; ${n} frames over ${dur.toFixed(2)} s`];
}
