/**
 * A planted gait for rig.py's procedural walkers.
 *
 * rig.py's `move` swings each leg as a pendulum (`gait_pose`): a sinusoid
 * has no stance phase, so no foot is ever still on the ground -- measured,
 * the weighted planted speed of `rpg_team`'s walk is 0.36 m/s against the
 * 2.9 it needs, `recoilless_team`'s -0.03. Scaling a pendulum cannot plant
 * it (`stride.ts`'s warp is for the captured runs, which have a stance).
 *
 * So the legs are re-solved: each foot follows a stance-and-swing path in
 * the clip's own frame -- on the ground, sliding back at exactly the speed
 * the rate match will play it at (`v / timeScale`) for the stance fraction
 * of the cycle, then lifted and carried forward -- and two-bone IK puts the
 * thigh and shin on it. Each foot keeps the phase its own pendulum had (the
 * moment it was furthest forward is its heel strike), so a team's figures
 * stay out of step exactly as rig.py staggered them. Hips, spine, arms and
 * the root's bob are the clip's own.
 */
import type { Animation, Document, Node } from '@gltf-transform/core';
import { writeTrack } from './edit';
import { rotateWorld } from './hold';
import { add, deg, dot, len, norm, qaxis, qconj, qfromTo, qmul, qnorm, qrot, qslerp, scale, smoothstep, sub, type V3 } from './math';
import { carry, clipRange, Rig, tracksOf, type Pose, type Track } from './rig';

/** Half the planted foot's travel under the hip, at most, metres. */
export const HALF_STEP_MAX_M = 0.34;
/** The swinging boot's toe lift at mid-swing. */
export const SWING_TOE_UP = deg(20);

export interface GaitShape {
  /** Fraction of the cycle a foot is on the ground. */
  readonly stance: number;
  /** Ankle lift at mid-swing, metres. */
  readonly lift: number;
}

/** A walk keeps a foot down 60% of the cycle; a run 40%; a sprint less. */
export function gaitShape(v: number): GaitShape {
  if (v < 2.0) return { stance: 0.6, lift: 0.1 };
  if (v < 4.0) return { stance: 0.42, lift: 0.15 };
  return { stance: 0.32, lift: 0.2 };
}

interface LegIK {
  readonly side: 'L' | 'R';
  readonly thigh: Node;
  readonly shin: Node;
  readonly hip?: Node;
  readonly foot: Node;
  readonly ankleRest: V3;
  /** Lateral (z) offset of the ankle from the root, and its rest height. */
  readonly restAnkle: V3;
}

/** rig.py names a leg `{prefix}_thigh_L`/`_shin_L`/`_foot_L` (the foot from
 *  `feet.ts`); a captured civilian (`prefix` '') is a Mixamo biped. */
export function legNames(rig: Rig, prefix: string, side: 'L' | 'R'): { thigh: string; shin: string; foot: string; hip?: string } {
  if (prefix === '' && rig.has('LeftUpLeg')) {
    const s = side === 'L' ? 'Left' : 'Right';
    return { thigh: `${s}UpLeg`, shin: `${s}Leg`, foot: `${s}Foot` };
  }
  return { thigh: `${prefix}_thigh_${side}`, shin: `${prefix}_shin_${side}`, foot: `${prefix}_foot_${side}`, hip: `${prefix}_hip_${side}` };
}

/** The node whose translation carries a figure's height (and its hips' dip). */
export function figureRoot(rig: Rig, prefix: string): Node {
  return prefix === '' && rig.has('Hips') ? rig.node('Hips') : rig.node(`${prefix}_root`);
}

function legs(rig: Rig, prefix: string): LegIK[] {
  return (['L', 'R'] as const).map((side) => {
    const n = legNames(rig, prefix, side);
    const thigh = rig.node(n.thigh);
    const shin = rig.node(n.shin);
    // The effector is the ankle (`feet.ts`'s foot bone, or the biped's own):
    // the boot below it is held flat through the stance, so the sole stays
    // where it landed.
    const foot = rig.node(n.foot);
    const ankleRest = rig.restWorld.get(foot)!.t;
    return { side, thigh, shin, foot, ...(n.hip && rig.has(n.hip) ? { hip: rig.node(n.hip) } : {}), ankleRest, restAnkle: ankleRest };
  });
}

function legLength(rig: Rig, leg: LegIK): number {
  const S = rig.restWorld.get(leg.thigh)!.t;
  const K = rig.restWorld.get(leg.shin)!.t;
  return len(sub(K, S)) + len(sub(leg.ankleRest, K));
}

function ik(rig: Rig, pose: Pose, leg: LegIK, target: V3): void {
  const S = rig.worldOf(leg.thigh, pose).t;
  const K = rig.worldOf(leg.shin, pose).t;
  const A = carry(rig, (n) => rig.worldOf(n, pose), leg.shin, leg.ankleRest);
  const a = len(sub(K, S));
  const b = len(sub(A, K));
  const d = sub(target, S);
  const L = Math.min(len(d), (a + b) * 0.999);
  const dn = norm(d);
  const cosA = Math.max(-1, Math.min(1, (a * a + L * L - b * b) / (2 * a * L)));
  const pole: V3 = [1, 0, 0]; // knees forward
  const pp = norm(sub(pole, scale(dn, dot(pole, dn))));
  const K2 = add(add(S, scale(dn, a * cosA)), scale(pp, a * Math.sqrt(Math.max(0, 1 - cosA * cosA))));
  rotateWorld(rig, pose, leg.thigh, qfromTo(sub(K, S), sub(K2, S)));
  const K3 = rig.worldOf(leg.shin, pose).t;
  const A2 = carry(rig, (n) => rig.worldOf(n, pose), leg.shin, leg.ankleRest);
  rotateWorld(rig, pose, leg.shin, qfromTo(sub(A2, K3), sub(add(S, scale(dn, L)), K3)));
}

/** Each foot's heel strike as a phase in [0, 1): when its ankle was furthest forward. */
function strikePhases(rig: Rig, tracks: Map<string, Track>, ls: LegIK[], root: Node): number[] {
  const [t0, t1] = clipRange(tracks);
  const n = 96;
  return ls.map((leg) => {
    let best = -Infinity;
    let at = 0;
    for (let s = 0; s < n; s++) {
      const pose = rig.sample(tracks, t0 + ((t1 - t0) * s) / n);
      const x = carry(rig, (q) => rig.worldOf(q, pose), leg.shin, leg.ankleRest)[0] - rig.worldOf(root, pose).t[0];
      if (x > best) {
        best = x;
        at = s / n;
      }
    }
    return at;
  });
}

/** Re-solve one figure's legs in `anim` onto planted footpaths. */
export function replantFigure(
  doc: Document,
  anim: Animation,
  prefix: string,
  groundSpeed: number,
  shapeIn: GaitShape
): { strikes: number[]; worstReach: number; worstDrop: number; stance: number } {
  let shape = shapeIn;
  const rig = new Rig(doc);
  const tracks = tracksOf(anim);
  const [t0, t1] = clipRange(tracks);
  const T = t1 - t0;
  const ls = legs(rig, prefix);
  const root = figureRoot(rig, prefix);
  const strikes = strikePhases(rig, tracks, ls, root);
  const rootRest = rig.restWorld.get(root)!.t;
  // Every rig here faces world +X at rest (rig.py by construction; the
  // civilians through their forward_fix node), so the lateral axis is +Z.
  const figureLateral: V3 | null = [0, 0, 1];
  // The stance shortens before the legs over-reach: a planted foot travels
  // S = speed * stance * T under the hip, and past +-HALF_STEP_MAX_M a
  // 1.7 m figure's leg (hip pivot ~0.8 m) can only reach it by dropping its
  // hips a quarter of a metre (measured on mortar_team at a 0.6 stance).
  const stance = Math.min(shape.stance, (2 * HALF_STEP_MAX_M) / (groundSpeed * T));
  shape = { ...shape, stance };
  const S = groundSpeed * stance * T;
  const n = Math.max(16, Math.round(T * 30));
  const times = Array.from({ length: n + 1 }, (_, i) => t0 + (T * i) / n);
  const out = new Map<Node, number[]>();
  const outT = new Map<Node, number[]>();
  const push = (node: Node, v: number[], path: 'rotation' | 'translation' = 'rotation'): void => {
    const m = path === 'rotation' ? out : outT;
    if (!m.has(node)) m.set(node, []);
    m.get(node)!.push(...v);
  };
  let worstReach = 0;
  let worstDrop = 0;
  const target = (leg: LegIK, s: number): V3 => {
    let x: number;
    let y = leg.restAnkle[1];
    if (s < shape.stance) {
      x = S / 2 - S * (s / shape.stance);
    } else {
      const u = (s - shape.stance) / (1 - shape.stance);
      x = -S / 2 + S * smoothstep(u);
      y += shape.lift * Math.sin(Math.PI * u);
    }
    return [rootRest[0] + x, y, leg.restAnkle[2]];
  };
  for (const t of times) {
    const pose = rig.sample(tracks, t);
    const phase = (t - t0) / T;
    // The targets first, then the hips lowered as far as the furthest
    // planted foot needs to reach it (a leg 1% short of straight): the
    // dip a runner's hips make at heel strike and toe-off.
    const targets = ls.map((leg, i) => target(leg, (phase - strikes[i] + 1) % 1));
    let drop = 0;
    ls.forEach((leg, i) => {
      const S0 = rig.worldOf(leg.thigh, pose).t;
      const reach = 0.99 * legLength(rig, leg);
      const d = targets[i];
      const flat = Math.hypot(d[0] - S0[0], d[2] - S0[2]);
      const maxHip = d[1] + Math.sqrt(Math.max(0, reach * reach - flat * flat));
      drop = Math.max(drop, S0[1] - maxHip);
    });
    if (drop > 0) {
      // A world drop, in the root's parent's frame (scaled and turned on a
      // captured biped).
      const r = pose.get(root)!;
      const pw = rig.worldOf(rig.parent.get(root)!, pose);
      const d = scale(qrot(qconj(pw.r), [0, -drop, 0]), 1 / pw.s);
      pose.set(root, { ...r, t: [r.t[0] + d[0], r.t[1] + d[1], r.t[2] + d[2]] });
    }
    push(root, [...pose.get(root)!.t], 'translation');
    worstDrop = Math.max(worstDrop, drop);
    for (let i = 0; i < ls.length; i++) {
      const leg = ls[i];
      ik(rig, pose, leg, targets[i]);
      // The boot: flat on the ground through the stance; in the swing the
      // toe lifts (up to SWING_TOE_UP) and comes back down to land flat.
      const s = (phase - strikes[i] + 1) % 1;
      const toe = s < shape.stance ? 0 : SWING_TOE_UP * Math.sin(Math.PI * ((s - shape.stance) / (1 - shape.stance)));
      // World rotation: the foot's own REST orientation (flat), pitched by the
      // toe lift about the figure's lateral axis.
      const shinW = rig.worldOf(leg.shin, pose).r;
      const restFoot = rig.restWorld.get(leg.foot)!.r;
      const lateral = qrot(rig.restWorld.get(root)!.r, [0, 0, 1]);
      const want = qmul(qaxis(figureLateral ?? lateral, toe), restFoot);
      pose.set(leg.foot, { ...pose.get(leg.foot)!, r: qnorm(qmul(qconj(shinW), want)) });
      const reach = len(sub(carry(rig, (q) => rig.worldOf(q, pose), leg.shin, leg.ankleRest), targets[i]));
      worstReach = Math.max(worstReach, reach);
      if (leg.hip) {
        // rig.py's hip-fix piece takes half the thigh's turn.
        const restHip = rig.rest.get(leg.hip)!.r;
        const thighRel = pose.get(leg.thigh)!.r;
        pose.set(leg.hip, { ...pose.get(leg.hip)!, r: qslerp(restHip, thighRel, 0.5) });
      }
    }
    for (const leg of ls) {
      push(leg.thigh, [...pose.get(leg.thigh)!.r]);
      push(leg.shin, [...pose.get(leg.shin)!.r]);
      push(leg.foot, [...pose.get(leg.foot)!.r]);
      if (leg.hip) push(leg.hip, [...pose.get(leg.hip)!.r]);
    }
  }
  for (const [node, v] of out) writeTrack(doc, anim, node, 'rotation', times, v);
  for (const [node, v] of outT) writeTrack(doc, anim, node, 'translation', times, v);
  return { strikes, worstReach, worstDrop, stance };
}
