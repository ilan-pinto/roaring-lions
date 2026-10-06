/**
 * Kneel-to-fire (the lead's approval, 5 Oct; the sim's halt-to-fire is PR
 * #402). Three clips, built from the team's own `idle`:
 *
 *   kneelIn    standing low ready -> kneeling aim, 0.2 s, played once
 *   kneel      kneeling aim, looping over idle's own breath
 *   kneelOut   kneeling aim -> standing low ready, 0.2 s, played once
 *
 * 0.2 s is the sim's own `KNEEL_DROP_TICKS`/`KNEEL_RISE_TICKS` (4 ticks at
 * 20 Hz): the renderer scrubs these two clips by the ticks LEFT in the sim's
 * transition, so a clip and the stance it draws can never disagree about
 * how far down the man is (`units/stance.ts`).
 *
 * The pose (approved numbers): the hip joint at half its standing height;
 * the shooting-side knee on the ground with the shin flat and the toe
 * tucked, the ankle 0.30 m behind the hip; the support foot 0.36 m ahead
 * with the shin vertical; the torso leaning 6 deg instead of 12. The drop
 * is a braking half-step -- the support foot reaches forward first, the
 * hips follow, the back knee goes down last -- and the rise runs the other
 * way: hips first, the support foot last.
 *
 * Every node idle keys is keyed in every frame of the new clips (rig.py's
 * own rule, `_new_action`: an untouched bone keeps whatever the last clip
 * left in it), sampled from `idle` where this pass does not pose it.
 */
import type { Animation, Document, Node } from '@gltf-transform/core';
import { holdFrame, type HoldContext } from './apply-hold';
import { writeTrack } from './edit';
import { rotateWorld } from './hold';
import { add, deg, dot, len, lerp3, norm, qaxis, qconj, qfromTo, qmul, qnorm, qslerp, scale, smoothstep, sub, type V3, type Xf } from './math';
import { carry, clipRange, restVertices, Rig, tracksOf, type Pose, type Track } from './rig';
import type { MotionTeam } from './teams';

export const KNEEL_TRANSITION_S = 0.2;
export const KNEEL_FPS = 30;
/** Hip joint height when kneeling, as a fraction of its standing height. */
export const KNEEL_HIP_FRAC = 0.5;
/** The back ankle: 0.30 m behind the hip, low -- the shin nearly flat on
 *  the ground -- with the boot turned toe-down (`KNEEL_TOE_TUCK`) so the man
 *  kneels on his knee and the ball of his foot. */
export const KNEEL_BACK_ANKLE: V3 = [-0.3, 0.13, 0];
export const KNEEL_TOE_TUCK = -65;
export const KNEEL_FRONT_ANKLE: V3 = [0.36, 0.09, 0];
export const KNEEL_AIM_LEAN = 6;
/** How far the rigid back boot's toe may go under the ground. */
export const KNEEL_TOE_SINK = 0.07;
/** The standing aim's lean, which the transitions blend from. */
const STANDING_AIM_LEAN = 12;
/** An unarmed kneeler (yahalom's mast man) leans this far, degrees. */
export const KNEEL_UNARMED_LEAN = 10;

interface Leg {
  readonly thigh: Node;
  readonly shin: Node;
  readonly foot: Node;
  /** The ankle (the foot bone's origin, `feet.ts`) as a rest point. */
  readonly ankleRest: V3;
}

function legOf(rig: Rig, p: string, side: 'L' | 'R'): Leg {
  const thigh = rig.node(`${p}_thigh_${side}`);
  const shin = rig.node(`${p}_shin_${side}`);
  const foot = rig.node(`${p}_foot_${side}`);
  return { thigh, shin, foot, ankleRest: rig.restWorld.get(foot)!.t };
}

/** Set a foot's WORLD rotation (the armature's frame; rest is identity). */
function footWorld(rig: Rig, pose: Pose, leg: Leg, q: [number, number, number, number]): void {
  const shinW = rig.worldOf(leg.shin, pose).r;
  pose.set(leg.foot, { ...pose.get(leg.foot)!, r: qnorm(qmul(qconj(shinW), q)) });
}

function legIK(rig: Rig, pose: Pose, leg: Leg, target: V3, pole: V3): void {
  const S = rig.worldOf(leg.thigh, pose).t;
  const K = rig.worldOf(leg.shin, pose).t;
  const A = carry(rig, (n) => rig.worldOf(n, pose), leg.shin, leg.ankleRest);
  const a = len(sub(K, S));
  const b = len(sub(A, K));
  const d = sub(target, S);
  const L = Math.min(len(d), (a + b) * 0.999);
  const dn = norm(d);
  const cosA = Math.max(-1, Math.min(1, (a * a + L * L - b * b) / (2 * a * L)));
  const pp = norm(sub(pole, scale(dn, dot(pole, dn))));
  const K2 = add(add(S, scale(dn, a * cosA)), scale(pp, a * Math.sqrt(Math.max(0, 1 - cosA * cosA))));
  rotateWorld(rig, pose, leg.thigh, qfromTo(sub(K, S), sub(K2, S)));
  const K3 = rig.worldOf(leg.shin, pose).t;
  const A2 = carry(rig, (n) => rig.worldOf(n, pose), leg.shin, leg.ankleRest);
  rotateWorld(rig, pose, leg.shin, qfromTo(sub(A2, K3), sub(add(S, scale(dn, L)), K3)));
}

interface Kneeler {
  readonly prefix: string;
  readonly hold?: HoldContext;
  /** The anatomical right leg -- rig.py's `_L` -- is the knee that goes down. */
  readonly back: Leg;
  readonly front: Leg;
  readonly hipRestY: number;
  readonly boots: { joint: Node; p: V3 }[];
  readonly frontBoots: { joint: Node; p: V3 }[];
  readonly restSole: number;
}

/** Lowest boot point of one figure under a pose. */
function soleY(rig: Rig, pose: Pose, boots: { joint: Node; p: V3 }[]): number {
  const cache = new Map<Node, Xf>();
  let lo = Infinity;
  for (const b of boots) lo = Math.min(lo, carry(rig, (n) => rig.worldOf(n, pose, cache), b.joint, b.p)[1]);
  return lo;
}

/** Pose one figure kneeling (root and legs; the hold is applied after). */
function kneelBody(rig: Rig, pose: Pose, k: Kneeler): void {
  const root = rig.node(`${k.prefix}_root`);
  const hipNow = rig.worldOf(k.back.thigh, pose).t;
  const drop = hipNow[1] - k.hipRestY * KNEEL_HIP_FRAC;
  const r = pose.get(root)!;
  pose.set(root, { ...r, t: [r.t[0], r.t[1] - drop, r.t[2]] });
  const hb = rig.worldOf(k.back.thigh, pose).t;
  const hf = rig.worldOf(k.front.thigh, pose).t;
  legIK(rig, pose, k.back, [hb[0] + KNEEL_BACK_ANKLE[0], KNEEL_BACK_ANKLE[1], hb[2]], [1, -0.6, 0]);
  legIK(rig, pose, k.front, [hf[0] + KNEEL_FRONT_ANKLE[0], KNEEL_FRONT_ANKLE[1], hf[2] - 0.03], [1, 0.8, 0]);
  footWorld(rig, pose, k.front, [0, 0, 0, 1]);
  footWorld(rig, pose, k.back, qaxis([0, 0, 1], deg(KNEEL_TOE_TUCK)));
  // Seat the FRONT sole on the ground (the foot that is flat); the IK targets
  // the ankle, and the boot's own depth below it differs per figure. The
  // back toe is allowed under the ground by KNEEL_TOE_SINK at most.
  const s = soleY(rig, pose, k.frontBoots) - k.restSole;
  const r2 = pose.get(root)!;
  pose.set(root, { ...r2, t: [r2.t[0], r2.t[1] - s, r2.t[2]] });
}

function lerpPose(a: Pose, b: Pose, nodes: Node[], u: (n: Node) => number): Pose {
  const out: Pose = new Map(a);
  for (const n of nodes) {
    const x = a.get(n)!;
    const y = b.get(n)!;
    const t = u(n);
    out.set(n, { t: lerp3(x.t, y.t, t), r: qslerp(x.r, y.r, t), s: x.s + (y.s - x.s) * t });
  }
  return out;
}

function writeClip(doc: Document, name: string, nodes: Node[], times: number[], poses: Pose[]): Animation {
  if (doc.getRoot().listAnimations().some((a) => a.getName() === name)) {
    throw new Error(`kneel: the file already has a "${name}" clip`);
  }
  const anim = doc.createAnimation(name);
  for (const n of nodes) {
    writeTrack(doc, anim, n, 'translation', times, poses.flatMap((p) => [...p.get(n)!.t]));
    writeTrack(doc, anim, n, 'rotation', times, poses.flatMap((p) => [...p.get(n)!.r]));
    writeTrack(doc, anim, n, 'scale', times, poses.flatMap((p) => [p.get(n)!.s, p.get(n)!.s, p.get(n)!.s]));
  }
  return anim;
}

export function applyKneel(doc: Document, id: string, spec: MotionTeam, holds: readonly HoldContext[]): string[] {
  const rig = new Rig(doc);
  const idle = doc.getRoot().listAnimations().find((a) => a.getName() === 'idle');
  if (!idle) throw new Error(`${id}: no idle to kneel from`);
  const tracks: Map<string, Track> = tracksOf(idle);
  const [t0, t1] = clipRange(tracks);
  const animated = [...new Set([...tracks.values()].map((t) => t.node))];
  const verts = restVertices(rig);
  const kneelers: Kneeler[] = spec.figures
    .filter((f) => f.kneels)
    .map((f) => {
      const h = holds.find((c) => c.hold.prefix === f.prefix);
      const zL = rig.restWorld.get(rig.node(`${f.prefix}_thigh_L`))!.t[2];
      const zR = rig.restWorld.get(rig.node(`${f.prefix}_thigh_R`))!.t[2];
      const right = zL > zR ? 'L' : 'R';
      const back = legOf(rig, f.prefix, right);
      const front = legOf(rig, f.prefix, right === 'L' ? 'R' : 'L');
      const boots = verts
        .filter((v) => v.role === 'boot' && (v.joint === back.shin || v.joint === front.shin))
        .filter((_, i) => i % 3 === 0)
        .map((v) => ({ joint: v.joint, p: v.p }));
      const hold: HoldContext | undefined = h
        ? {
            ...h,
            hold: { ...h.hold, fromJoint: rig.node(h.hold.fromJoint.getName()), eyeJoint: rig.node(h.hold.eyeJoint.getName()) },
          }
        : undefined;
      return {
        prefix: f.prefix,
        ...(hold ? { hold } : {}),
        back,
        front,
        hipRestY: rig.restWorld.get(back.thigh)!.t[1],
        boots,
        frontBoots: boots.filter((b) => b.joint === front.shin),
        restSole: soleY(rig, new Map(rig.rest), boots),
      };
    });

  const kneelingRaw = (t: number): Pose => {
    const p = rig.sample(tracks, t);
    for (const k of kneelers) kneelBody(rig, p, k);
    return p;
  };
  const finish = (p: Pose, aim: number, kneelOf: (k: Kneeler) => number): number => {
    let worst = 0;
    for (const k of kneelers) {
      if (k.hold) {
        const lean = STANDING_AIM_LEAN + (KNEEL_AIM_LEAN - STANDING_AIM_LEAN) * kneelOf(k);
        // A MANPAD has no hold-carry to blend from (see apply-hold.ts): it
        // aims through the whole drop and rise.
        const a = k.hold.hold.kind === 'manpad' ? 1 : aim;
        worst = Math.max(worst, holdFrame(rig, p, k.hold, a, lean).gap);
      } else {
        rotateWorld(rig, p, rig.node(`${k.prefix}_spine`), qaxis([0, 0, 1], -deg(KNEEL_UNARMED_LEAN) * kneelOf(k)));
      }
    }
    return worst;
  };
  // Every node idle keys, plus the weapon bones the hold added.
  const nodes = [...new Set([...animated, ...holds.map((h) => rig.node(h.weaponName))])];
  const lines: string[] = [];

  // The loop: idle's own duration, so the breath carries over.
  const nLoop = Math.max(2, Math.round((t1 - t0) * KNEEL_FPS));
  const loopTimes = Array.from({ length: nLoop + 1 }, (_, i) => (i / nLoop) * (t1 - t0));
  let worst = 0;
  let sink = 0;
  const loopPoses = loopTimes.map((t) => {
    const p = kneelingRaw(t0 + t);
    worst = Math.max(worst, finish(p, 1, () => 1));
    for (const k of kneelers) sink = Math.max(sink, k.restSole - soleY(rig, p, k.boots));
    return p;
  });
  if (sink > KNEEL_TOE_SINK) throw new Error(`${id}: a kneeling boot ${sink.toFixed(3)} m under the ground (limit ${KNEEL_TOE_SINK})`);
  writeClip(doc, 'kneel', nodes, loopTimes, loopPoses);
  lines.push(
    `kneel: ${kneelers.map((k) => k.prefix).join(', ')}; ${nLoop} frames over ${(t1 - t0).toFixed(2)} s, ` +
      `worst grip gap ${worst.toFixed(3)} m, back toe ${sink.toFixed(3)} m under`
  );

  // The transitions, by stage, u in [0, 1] over the clip.
  const nT = Math.round(KNEEL_TRANSITION_S * KNEEL_FPS);
  const tTimes = Array.from({ length: nT + 1 }, (_, i) => (i / nT) * KNEEL_TRANSITION_S);
  const S = rig.sample(tracks, t0);
  const K = kneelingRaw(t0);
  const owner = (n: Node): Kneeler | undefined => kneelers.find((k) => n.getName().startsWith(`${k.prefix}_`));
  // Fraction KNEELING of each node at u, for the drop.
  const stageIn = (n: Node, u: number): number => {
    const k = owner(n);
    if (!k) return 0;
    if (n === k.front.thigh || n === k.front.shin || n === k.front.foot) return smoothstep(u / 0.6); // the half-step leads
    if (n === k.back.thigh || n === k.back.shin || n === k.back.foot) return smoothstep((u - 0.25) / 0.75); // the knee goes down last
    return smoothstep((u - 0.1) / 0.9);
  };
  // ...and for the rise.
  const stageOut = (n: Node, u: number): number => {
    const k = owner(n);
    if (!k) return 0;
    if (n === k.front.thigh || n === k.front.shin || n === k.front.foot) return 1 - smoothstep((u - 0.35) / 0.65); // the support foot last
    if (n === k.back.thigh || n === k.back.shin || n === k.back.foot) return 1 - smoothstep(u / 0.75);
    return 1 - smoothstep(u / 0.7); // the hips first
  };
  const plan: [string, (n: Node, u: number) => number, (u: number) => number][] = [
    ['kneelIn', stageIn, (u) => smoothstep((u - 0.3) / 0.7)],
    ['kneelOut', stageOut, (u) => 1 - smoothstep(u / 0.5)],
  ];
  for (const [name, stage, aimAt] of plan) {
    let w = 0;
    const poses = tTimes.map((t) => {
      const u = t / KNEEL_TRANSITION_S;
      const p = lerpPose(S, K, animated, (n) => stage(n, u));
      w = Math.max(w, finish(p, aimAt(u), (k) => stage(rig.node(`${k.prefix}_root`), u)));
      return p;
    });
    writeClip(doc, name, nodes, tTimes, poses);
    lines.push(`${name}: ${nT} frames over ${KNEEL_TRANSITION_S} s, worst grip gap ${w.toFixed(3)} m`);
  }
  return lines;
}
