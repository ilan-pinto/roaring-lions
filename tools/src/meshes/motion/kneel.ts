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
import { carry, clipRange, restVertices, Rig, tracksOf, type Influence, type Pose, type Track } from './rig';
import type { MotionTeam } from './teams';

export const KNEEL_TRANSITION_S = 0.2;
export const KNEEL_FPS = 30;
/** The drop and the rise are keyed four times as densely as the loop: a
 *  leg swinging through 0.2 s sags between keys (slerped joints, a chord
 *  under an arc), and at 30 fps the planted toe dipped 5-19 mm under the
 *  ground between two keys that both sat on it. */
export const KNEEL_TRANSITION_FPS = 120;
/** Hip joint height when kneeling, as a fraction of its standing height. */
export const KNEEL_HIP_FRAC = 0.5;
/** The back ankle: 0.30 m behind the hip, low -- the shin nearly flat on
 *  the ground -- with the boot turned toe-down (`KNEEL_TOE_TUCK`) so the man
 *  kneels on his knee and the ball of his foot. */
export const KNEEL_BACK_ANKLE: V3 = [-0.3, 0.13, 0];
export const KNEEL_TOE_TUCK = -65;
export const KNEEL_FRONT_ANKLE: V3 = [0.36, 0.09, 0];
export const KNEEL_AIM_LEAN = 6;
/**
 * Where a kneeling figure's lowest vertex sits, metres above the ground
 * (kneel-toe, 6 Oct). The front sole is seated at it, and the back boot is
 * PLANTED at it: the ankle's IK target moves by exactly what the tucked toe
 * is off the ground, so the toe neither sinks nor hovers. `KNEEL_BACK_ANKLE`'s
 * 0.13 m is where the ankle starts; a figure's own boot length decides where
 * it ends (0.17-0.22 m on the shipped rigs).
 *
 * Until this, the tucked toe was allowed 0.07 m under the ground and a guard
 * said it never went past that -- but the guard picked its boot vertices by
 * the SHIN joint after `feet.ts` had moved the sole onto the new ankle bone,
 * so it read the boot's shaft: "0.000 m under" on inf_squad over a toe 3.8 mm
 * in, 0.047 on rpg_team over 76.5 mm, and 94 mm on militia_cell. The
 * transitions, lerped joint by joint, went to 0.20 m. The occlusion outline
 * (`units/silhouette.ts`) drew every buried toe as a speck.
 */
export const KNEEL_GROUND_CLEAR = 0.003;
/** A kneeling or rising figure may have both feet off the ground by no more
 *  than this before the lower foot is put back down. */
export const KNEEL_FLOAT_MAX = 0.008;
/** The standing aim's lean, which the transitions blend from. */
const STANDING_AIM_LEAN = 12;
/** An unarmed kneeler (yahalom's mast man) leans this far, degrees. */
export const KNEEL_UNARMED_LEAN = 10;
/**
 * An unarmed kneeler's hanging hand clears the ground by this much, metres
 * (kneel-toe, 6 Oct): his arm swings forward at the shoulder, as far as it
 * must and no further. yahalom's yah_a, leaning 10 deg at half his standing
 * hip height, had his right hand 36 mm in the ground.
 */
export const KNEEL_HAND_CLEAR = 0.06;

export interface Leg {
  readonly thigh: Node;
  readonly shin: Node;
  readonly foot: Node;
  /** The ankle (the foot bone's origin, `feet.ts`) as a rest point. */
  readonly ankleRest: V3;
}

export function legOf(rig: Rig, p: string, side: 'L' | 'R'): Leg {
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
  /** Each leg's vertices, any role: the boot below the ankle (the foot
   *  bone's), and the knee above it (thigh and shin -- a kneeling knee is
   *  trouser, not boot). Separate, because moving the ankle moves the two
   *  in opposite directions. */
  readonly backFoot: Pt[];
  readonly backKnee: Pt[];
  readonly frontFoot: Pt[];
  readonly frontKnee: Pt[];
  /** Every vertex of the figure: the report's reading. */
  readonly bodyVerts: Pt[];
  /** Each arm's vertices (upper arm and forearm), with its shoulder. */
  readonly arms: { upper: Node; pts: Pt[] }[];
}

/** A rest point carried by `joint` -- or, on a smooth-skinned rig, blended
 *  over `influences` (`rig.restSkinnedVertices`). */
export type Pt = { joint: Node; p: V3; influences?: readonly Influence[] };

/** Metres of forward lean on `plantLeg`'s pole (see there). */
const PLANT_POLE_FORWARD = 0.03;

/** Lowest of a set of rest points under a pose. A point on a joint scaled
 *  out (a death twin) collapses to its root and is not drawn: skipped. */
export function lowestY(rig: Rig, pose: Pose, pts: readonly Pt[]): number {
  const cache = new Map<Node, Xf>();
  const world = (n: Node): Xf => rig.worldOf(n, pose, cache);
  let lo = Infinity;
  for (const b of pts) {
    if (world(b.joint).s < 1e-6) continue;
    if (b.influences) {
      let y = 0;
      for (const f of b.influences) y += f.w * carry(rig, world, f.joint, f.p)[1];
      lo = Math.min(lo, y);
    } else lo = Math.min(lo, carry(rig, world, b.joint, b.p)[1]);
  }
  return lo;
}

/**
 * Move a leg's lowest vertex to `y` by moving its ANKLE: two-bone IK to the
 * ankle shifted by the difference, the knee kept in the plane it is already
 * bent in, and the foot's world rotation put back -- so the boot moves
 * rigidly, by exactly that difference, up to IK reach. A few rounds, since
 * a bend changes which vertex is lowest. A STRAIGHT leg has no bend plane
 * of its own -- its knee's offset from the hip-ankle line is rounding noise
 * -- so the pole leans `PLANT_POLE_FORWARD` forward, and a standing leg
 * that has to give bends its knee the way a knee bends. Without it the
 * plane was whatever the noise said, a knee flipped between two keys, and
 * the slerp between them put a toe 17 mm under the ground.
 */
export function plantLeg(rig: Rig, pose: Pose, leg: Leg, pts: readonly Pt[], y: number): void {
  for (let round = 0; round < 4; round++) {
    const off = y - lowestY(rig, pose, pts);
    if (Math.abs(off) < 1e-4) return;
    const footW = rig.worldOf(leg.foot, pose).r;
    const ankle = rig.worldOf(leg.foot, pose).t;
    const knee = sub(rig.worldOf(leg.shin, pose).t, rig.worldOf(leg.thigh, pose).t);
    legIK(rig, pose, leg, [ankle[0], ankle[1] + off, ankle[2]], add(knee, [PLANT_POLE_FORWARD, 0, 0]));
    footWorld(rig, pose, leg, footW);
  }
}

/**
 * Keep one figure on the ground through a lerped transition frame: a leg
 * under the ground is lifted to `KNEEL_GROUND_CLEAR`, and a figure with both
 * feet more than `KNEEL_FLOAT_MAX` off it has its lower foot put back down
 * (the support foot, on the rise) -- and, past the leg's reach, its root.
 */
function groundFigure(rig: Rig, pose: Pose, k: Kneeler): void {
  for (const [leg, pts] of [[k.back, k.backFoot], [k.front, k.frontFoot]] as const) {
    if (lowestY(rig, pose, pts) < KNEEL_GROUND_CLEAR) plantLeg(rig, pose, leg, pts, KNEEL_GROUND_CLEAR);
  }
  raiseKnees(rig, pose, k);
  const b = lowestY(rig, pose, [...k.backFoot, ...k.backKnee]);
  const f = lowestY(rig, pose, [...k.frontFoot, ...k.frontKnee]);
  if (Math.min(b, f) <= KNEEL_FLOAT_MAX) return;
  if (b < f) plantLeg(rig, pose, k.back, k.backFoot, KNEEL_GROUND_CLEAR);
  else plantLeg(rig, pose, k.front, k.frontFoot, KNEEL_GROUND_CLEAR);
  const lo = lowestY(rig, pose, [...k.backFoot, ...k.backKnee, ...k.frontFoot, ...k.frontKnee]);
  if (lo > KNEEL_FLOAT_MAX) shiftRoot(rig, pose, k, KNEEL_GROUND_CLEAR - lo);
}

function shiftRoot(rig: Rig, pose: Pose, k: Kneeler, dy: number): void {
  const root = rig.node(`${k.prefix}_root`);
  const r = pose.get(root)!;
  pose.set(root, { ...r, t: [r.t[0], r.t[1] + dy, r.t[2]] });
}

/** A knee under the ground cannot be fixed at the ankle (lifting the ankle
 *  under a fixed hip LOWERS the knee): the whole figure rises by it, and
 *  the feet are put back down. */
function raiseKnees(rig: Rig, pose: Pose, k: Kneeler): void {
  for (let round = 0; round < 4; round++) {
    const knee = lowestY(rig, pose, [...k.backKnee, ...k.frontKnee]);
    if (knee >= KNEEL_GROUND_CLEAR - 1e-4) return;
    shiftRoot(rig, pose, k, KNEEL_GROUND_CLEAR - knee);
    for (const [leg, pts] of [[k.back, k.backFoot], [k.front, k.frontFoot]] as const) {
      if (lowestY(rig, pose, pts) > KNEEL_GROUND_CLEAR) plantLeg(rig, pose, leg, pts, KNEEL_GROUND_CLEAR);
    }
  }
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
  // the ankle, and the boot's own depth below it differs per figure.
  shiftRoot(rig, pose, k, KNEEL_GROUND_CLEAR - lowestY(rig, pose, k.frontFoot));
  // ...then plant the tucked back toe on it too, and keep the knee out of it.
  plantLeg(rig, pose, k.back, k.backFoot, KNEEL_GROUND_CLEAR);
  raiseKnees(rig, pose, k);
}

/** Swing a hanging arm forward at the shoulder until its lowest vertex is
 *  `KNEEL_HAND_CLEAR` off the ground: the least swing that clears it, by
 *  bisection (the swing raises the hand monotonically while the arm hangs
 *  below the shoulder, which is the only case it acts on). */
function liftArm(rig: Rig, pose: Pose, arm: { upper: Node; pts: Pt[] }): void {
  if (lowestY(rig, pose, arm.pts) >= KNEEL_HAND_CLEAR) return;
  const base = pose.get(arm.upper)!;
  const at = (rad: number): number => {
    pose.set(arm.upper, base);
    rotateWorld(rig, pose, arm.upper, qaxis([0, 0, 1], rad));
    return lowestY(rig, pose, arm.pts);
  };
  let lo = 0;
  let hi = deg(75);
  if (at(hi) < KNEEL_HAND_CLEAR) throw new Error(`kneel: ${arm.upper.getName()} cannot clear the ground`);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < KNEEL_HAND_CLEAR) lo = mid;
    else hi = mid;
  }
  at(hi);
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
      // By JOINT, every role: the sole is on the ankle bone since
      // `feet.ts`, and a kneeling knee is trouser, not boot.
      const on = (...joints: Node[]): Pt[] => verts.filter((v) => joints.includes(v.joint)).map((v) => ({ joint: v.joint, p: v.p }));
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
        backFoot: on(back.foot),
        backKnee: on(back.thigh, back.shin),
        frontFoot: on(front.foot),
        frontKnee: on(front.thigh, front.shin),
        bodyVerts: verts.filter((v) => v.joint.getName().startsWith(`${f.prefix}_`)).map((v) => ({ joint: v.joint, p: v.p })),
        arms: (['L', 'R'] as const).map((side) => {
          const upper = rig.node(`${f.prefix}_upperarm_${side}`);
          const fore = rig.node(`${f.prefix}_forearm_${side}`);
          return { upper, pts: verts.filter((v) => v.joint === upper || v.joint === fore).map((v) => ({ joint: v.joint, p: v.p })) };
        }),
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
        for (const arm of k.arms) liftArm(rig, p, arm);
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
  // The lowest vertex of every kneeler over a clip's frames, both ways:
  // [lowest instant, highest instant]. Printed, and refused outside
  // [0, KNEEL_FLOAT_MAX + clear] -- a cheap guard on the pass's own
  // arithmetic; the gate is mesh_gait.test.ts, reading the bytes.
  const ground = (poses: Pose[]): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    let at = '';
    for (const p of poses) {
      for (const k of kneelers) {
        const y = lowestY(rig, p, k.bodyVerts);
        if (y < lo) at = k.prefix;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
    if (lo < 0 || hi > KNEEL_FLOAT_MAX + KNEEL_GROUND_CLEAR) {
      throw new Error(`${id}: a kneeler's lowest vertex reads ${lo.toFixed(4)}..${hi.toFixed(4)} m (lowest: ${at})`);
    }
    return [lo, hi];
  };
  let worst = 0;
  const loopPoses = loopTimes.map((t) => {
    const p = kneelingRaw(t0 + t);
    worst = Math.max(worst, finish(p, 1, () => 1));
    return p;
  });
  const [lo, hi] = ground(loopPoses);
  const lift = Math.max(
    ...kneelers.map((k) => rig.worldOf(k.back.foot, loopPoses[0]).t[1] - KNEEL_BACK_ANKLE[1])
  );
  writeClip(doc, 'kneel', nodes, loopTimes, loopPoses);
  lines.push(
    `kneel: ${kneelers.map((k) => k.prefix).join(', ')}; ${nLoop} frames over ${(t1 - t0).toFixed(2)} s, ` +
      `worst grip gap ${worst.toFixed(3)} m, lowest vertex ${lo.toFixed(4)}..${hi.toFixed(4)} m, back ankle up to ${lift.toFixed(3)} m over ${KNEEL_BACK_ANKLE[1]}`
  );

  // The transitions, by stage, u in [0, 1] over the clip.
  const nT = Math.round(KNEEL_TRANSITION_S * KNEEL_TRANSITION_FPS);
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
      for (const k of kneelers) groundFigure(rig, p, k);
      w = Math.max(w, finish(p, aimAt(u), (k) => stage(rig.node(`${k.prefix}_root`), u)));
      return p;
    });
    const [glo, ghi] = ground(poses);
    writeClip(doc, name, nodes, tTimes, poses);
    lines.push(`${name}: ${nT} frames over ${KNEEL_TRANSITION_S} s, worst grip gap ${w.toFixed(3)} m, lowest vertex ${glo.toFixed(4)}..${ghi.toFixed(4)} m`);
  }
  return lines;
}
