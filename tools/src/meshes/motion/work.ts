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
 * ARMED WORKERS (GH-826 step 3: demo_a carries a carbine). A worker whose
 * file has a `{prefix}_weapon` bone does not keep the kneel's arms, which
 * are solved onto the carbine's grips: his carbine is SLUNG on his back
 * (`rescue.ts`'s method, the medics' `carry` and `treat`), and both arms,
 * hands, trigger finger, neck and head go back to their rest, so he works
 * with free hands. The spine takes the unarmed kneeler's lean (`kneel.ts`)
 * plus `leanExtraDeg`, which is what brings his hands onto the charge at
 * the pump's peak. Nothing is gripped: no pose here is a station, and the
 * gate for the clip (`mesh_work.test.ts`) reads the sling's clearance from
 * the body and the hands' depth in the charge instead.
 *
 * It keys every node `kneel` keys (an untouched bone keeps whatever the last
 * clip left in it), loops over `kneel`'s duration, and is idempotent: it
 * reads only clips it does not write (`--step=work` replaces its own).
 */
import type { Document } from '@gltf-transform/core';
import { deg, qaxis, qrot, type V3 } from './math';
import { rotateWorld, twoBoneIK, type HoldFigure } from './hold';
import { KNEEL_FPS, KNEEL_UNARMED_LEAN, writeClip } from './kneel';
import { slingLocal } from './rescue';
import { weaponFrameOf } from './hands';
import { carry, clipRange, restVertices, Rig, tracksOf, type Pose } from './rig';

export const WORK_VERSION = 2;
/** rig.py: WORK_PUMP_RAD, half of it on the upper arm, and WORK_SPINE_RAD. */
export const WORK_PUMP_RAD = 0.22;
export const WORK_SPINE_RAD = 0.08;

/** How an armed worker slings his carbine: butt and direction as `rescue.ts`'s `SLING_BUTT`/`SLING_DIR`. */
export interface WorkSling {
  readonly butt: V3;
  readonly dir: V3;
}

export interface WorkOptions {
  /** Extra forward lean of an armed worker's spine over the unarmed kneeler's, degrees. Absent: the least that puts both hands on the charge. */
  readonly leanExtraDeg?: number;
  readonly sling?: WorkSling;
}

/** The hands press the satchel in turn, this far (metres) up from its top face at the top of the stroke (`rescue.ts`'s TREAT_STROKE is 0.045). */
export const WORK_STROKE = 0.05;
/** Each hand's mark: this far in from the satchel's near edge, and this far either side of its centre line (metres). */
export const WORK_HAND_IN = 0.06;
export const WORK_HAND_ACROSS = 0.075;
/** A worker's lowest hand vertex stands this far above the satchel's top face at the bottom of the stroke (metres). */
export const WORK_HAND_CLEAR = 0.001;
/** A hand may be this far off its mark (metres) in the lean the search settles on. */
export const WORK_REACH_TOL = 0.004;
/** The extra lean is searched in these steps, degrees, up to the limit. */
export const WORK_LEAN_STEP = 1;
export const WORK_LEAN_MAX = 60;

/** The bones an armed worker gets back at their rest in `work`: arms, hands, trigger finger, neck, head. */
const FREE_BONES = ['upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R', 'hand_L', 'hand_R', 'finger_L', 'neck', 'head'];

export function applyWork(doc: Document, id: string, workers: readonly string[], opts: WorkOptions = {}): string[] {
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
  const armed = workers.filter((w) => rig.has(`${w}_weapon`));
  const sling = new Map<string, ReturnType<typeof slingLocal>>();
  for (const w of armed) {
    const wf = weaponFrameOf(rig, w);
    if (!wf) throw new Error(`${id}: ${w} has a weapon bone but no rl_hands weapon frame to sling it by`);
    if (!opts.sling) throw new Error(`${id}: ${w} is armed, so \`work\` needs a sling (WorkOptions.sling)`);
    const h = { prefix: w, axis: wf.axis, up: wf.up } as unknown as HoldFigure;
    sling.set(w, slingLocal(rig, h, rig.node(`${w}_weapon`), opts.sling.butt, opts.sling.dir));
    for (const b of [...FREE_BONES, 'spine']) {
      if (rig.has(`${w}_${b}`) && !nodes.includes(rig.node(`${w}_${b}`))) nodes.push(rig.node(`${w}_${b}`));
    }
  }
  const dur = t1 - t0;
  const n = Math.max(2, Math.round(dur * KNEEL_FPS));
  const times = Array.from({ length: n + 1 }, (_, i) => (i / n) * dur);
  // The satchel and each armed worker's hands, from the file's own rest geometry
  const verts = restVertices(rig);
  const charge = verts.filter((v) => v.role === 'charge').map((v) => v.p);
  if (armed.length && charge.length === 0) throw new Error(`${id}: an armed worker needs a charge to put his hands on`);
  const box = [0, 1, 2].map((a) => [Math.min(...charge.map((q) => q[a])), Math.max(...charge.map((q) => q[a]))]);
  const handVerts = (w: string, side: 'L' | 'R') =>
    verts.filter((v) => v.joint.getName() === `${w}_hand_${side}` || (side === 'L' && v.joint.getName() === `${w}_finger_L`));
  const handRest = (w: string, side: 'L' | 'R'): V3 => {
    const hv = handVerts(w, side);
    return [0, 1, 2].map((a) => hv.reduce((acc, v) => acc + v.p[a], 0) / hv.length) as V3;
  };
  const build = (leanExtraDeg: number): { poses: Pose[]; worst: number } => {
    const lean = deg(KNEEL_UNARMED_LEAN + leanExtraDeg);
    let worst = 0;
    const poses = times.map((t, i) => {
      const p = rig.sample(tracks, t0 + t);
      const pump = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / dur);
      const u = (2 * Math.PI * i) / n;
      for (const w of workers) {
        const lateral: V3 = qrot(rig.worldOf(rig.node(`${w}_root`), p).r, [0, 0, 1]);
        if (!armed.includes(w)) {
          rotateWorld(rig, p, rig.node(`${w}_spine`), qaxis(lateral, WORK_SPINE_RAD * pump));
          rotateWorld(rig, p, rig.node(`${w}_upperarm_R`), qaxis(lateral, 0.5 * WORK_PUMP_RAD * pump));
          rotateWorld(rig, p, rig.node(`${w}_forearm_R`), qaxis(lateral, WORK_PUMP_RAD * pump));
          continue;
        }
        // free hands: arms, hands, finger, neck, head at rest; the spine upright, then leaned as the unarmed kneeler's is
        for (const b of FREE_BONES) {
          if (!rig.has(`${w}_${b}`)) continue;
          const nd = rig.node(`${w}_${b}`);
          p.set(nd, { ...p.get(nd)!, t: rig.rest.get(nd)!.t, r: rig.rest.get(nd)!.r });
        }
        const sp = rig.node(`${w}_spine`);
        p.set(sp, { ...p.get(sp)!, t: rig.rest.get(sp)!.t, r: rig.rest.get(sp)!.r });
        // the unarmed kneeler's lean (`kneel.ts`, `rescue.ts`' treat): about the WORLD z, negative is forward for a man facing +x
        // (his root bone is turned half a circle, so `lateral` below is world -z)
        rotateWorld(rig, p, sp, qaxis([0, 0, 1], -lean));
        rotateWorld(rig, p, sp, qaxis(lateral, WORK_SPINE_RAD * pump));
        p.set(rig.node(`${w}_weapon`), { ...p.get(rig.node(`${w}_weapon`))!, ...sling.get(w)! });
        // both hands press the satchel's near top edge, in turn: the one that is down rests on the face, the other is raised
        const zc = (box[2][0] + box[2][1]) / 2;
        for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
          const ph = sgn > 0 ? 0 : Math.PI;
          const lift = 0.5 * WORK_STROKE * (1 + Math.cos(u + ph));
          const hv = handVerts(w, side);
          const rest = handRest(w, side);
          let y = box[1][1] + 0.05 + lift;
          const target = (yy: number): V3 => [box[0][0] + WORK_HAND_IN, yy, zc + sgn * WORK_HAND_ACROSS];
          const up = rig.node(`${w}_upperarm_${side}`);
          const fo = rig.node(`${w}_forearm_${side}`);
          const keepU = p.get(up)!, keepF = p.get(fo)!;
          // the mark's height is solved against the hand's own geometry: its lowest vertex lands on the satchel's top (plus the lift)
          for (let it = 0; it < 6; it++) {
            p.set(up, keepU); p.set(fo, keepF);
            if (twoBoneIK(rig, p, up, fo, rest, target(y), [-0.1, -1, sgn * 0.4], true) > 0.03) break;     // out of reach: the lean search goes on
            const wd = rig.worlds(p);
            const low = Math.min(...hv.map((v) => carry(rig, wd as never, v.joint, v.p)[1]));
            const dy = box[1][1] + WORK_HAND_CLEAR + lift - low;
            y += dy;
            if (Math.abs(dy) < 0.0002) break;
          }
          p.set(up, keepU); p.set(fo, keepF);
          worst = Math.max(worst, twoBoneIK(rig, p, up, fo, rest, target(y), [-0.1, -1, sgn * 0.4], true));
        }
      }
      return p;
    });
    return { poses, worst };
  };
  let leanExtra = opts.leanExtraDeg;
  let built: { poses: Pose[]; worst: number };
  if (armed.length === 0) built = build(0);
  else if (leanExtra !== undefined) built = build(leanExtra);
  else {
    leanExtra = 0;
    built = build(0);
    while (built.worst > WORK_REACH_TOL && leanExtra < WORK_LEAN_MAX) {
      leanExtra += WORK_LEAN_STEP;
      built = build(leanExtra);
    }
    if (built.worst > WORK_REACH_TOL) throw new Error(`${id}: a hand cannot reach the charge: ${built.worst.toFixed(3)} m off at ${KNEEL_UNARMED_LEAN + leanExtra} deg of lean`);
  }
  const poses = built.poses;
  writeClip(doc, 'work', nodes, times, poses);
  const scene = root.listScenes()[0];
  scene.setExtras({
    ...((scene.getExtras() ?? {}) as Record<string, unknown>),
    rl_work: {
      version: WORK_VERSION,
      workers: [...workers],
      ...(armed.length ? { armed, leanDeg: KNEEL_UNARMED_LEAN + (leanExtra ?? 0), sling: opts.sling } : {}),
    },
  });
  return [
    `work: from kneel, ${workers.join(', ')} pump${armed.length ? `; ${armed.join(', ')} sling the carbine, free hands press the satchel in turn, lean ${KNEEL_UNARMED_LEAN + (leanExtra ?? 0)} deg, worst reach miss ${built.worst.toFixed(4)} m` : ''}; ${n} frames over ${dur.toFixed(2)} s`,
  ];
}
