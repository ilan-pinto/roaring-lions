/**
 * How a figure holds its weapon: the butt in the shoulder, the cheek on the
 * stock, the bore on the facing, and both hands ON the weapon.
 *
 * Measured on the shipped files before this pass (motion checkpoint, 5 Oct):
 * every rifleman fired from the hip -- eye 0.54-0.71 m above the bore, butt
 * 0.22-0.34 m below the shoulder joint, support hand 0.36-0.54 m off the
 * weapon -- because the weapon rode `forearm_R` and `fire` only swung that
 * one arm. Here the weapon rides its own bone on the chest
 * (`{prefix}_weapon`, a child of `{prefix}_spine`), is PLACED by the hold
 * below, and both arms are solved onto grips on it by two-bone IK. Every
 * number is the approved checkpoint's.
 *
 * The shooting side is the figure's anatomical RIGHT (glTF +Z), which in
 * rig.py's naming is the `_L` bones -- the B7 retarget mirrored a
 * right-handed capture by bone NAME, so every shooter used to hold on his
 * left shoulder.
 */
import type { Node } from '@gltf-transform/core';
import {
  add,
  apply,
  compose,
  cross,
  deg,
  dot,
  invert,
  len,
  lerp3,
  norm,
  qaxis,
  qbasis,
  qconj,
  qfromTo,
  qmul,
  qnorm,
  qrot,
  qslerp,
  scale,
  smoothstep,
  sub,
  type Q,
  type V3,
  type Xf,
} from './math';
import { carry, type Pose, type RestVertex, type Rig } from './rig';
import { turnOf } from './contact';
import { describeHands, MAX_AXIS_ERROR_DEG, weaponFrameOf, wristReading, type HandRig, type HandStation, type WristReading } from './hands';

/** `spike` (spike-walk, 6 Oct): the at_team gunner's Spike. Unlike the
 *  other two tubes it is not re-seated by formula -- its command-launch unit
 *  sits at the REAR, in front of the eye, where the importer measured it
 *  (`import_meshy_kdf_team._shoulder_launcher`) -- so its aim is the rest
 *  seat carried with the head, its grips are the rest hands carried with the
 *  weapon, and the hold owns its carry too (`SPIKE_CARRY_REAR`). */
export type WeaponKind = 'rifle' | 'rpg' | 'manpad' | 'spike';

/** Where the hands close, as fractions of the weapon's length from the butt
 *  and drops below the bore (metres). */
export const GRIPS: Record<WeaponKind, { trigger: [number, number]; support: [number, number] }> = {
  rifle: { trigger: [0.3, 0.07], support: [0.62, 0.035] },
  rpg: { trigger: [0.42, 0.1], support: [0.62, 0.08] },
  manpad: { trigger: [0.46, 0.1], support: [0.62, 0.08] },
  // Unread: a Spike's grips are its rest hands (`HoldFigure.restGrips`).
  spike: { trigger: [0.2, 0.15], support: [0.1, 0.2] },
};

/** How far back along the weapon the support hand may slide to reach. */
export const SUPPORT_MIN_FRAC: Record<WeaponKind, number> = { rifle: 0.42, rpg: 0.5, manpad: 0.42, spike: 0.1 };
/** The rifle's butt pocket, from the shooting shoulder JOINT: forward, up,
 *  medial. These rigs' shoulder pivots sit low (the cut is at the armpit),
 *  so the top of the visible shoulder cap is about +0.16 m above them. */
export const RIFLE_POCKET: V3 = [0.05, 0.16, 0.05];
/** Eye height above the bore once the cheek is on the stock. */
export const CHEEK_EYE_ABOVE_BORE = 0.068;
/** Low ready: the muzzle 30 deg down and 15 deg across the body. */
export const READY_PITCH_DEG = -30;
export const READY_YAW_DEG = 15;
export const READY_POCKET: V3 = [0.03, 0.12, 0.06];
/** A shouldered launcher: its bore this far below and beside the eye -- on
 *  the shoulder, its sight beside the cheek -- with this fraction of the tube
 *  behind the seat. Chosen by the clearance gates: at 0.08 beside (the
 *  checkpoint mock) the RPG ran through his head (477-1047 samples inside),
 *  at 0.18 still 27-82; at 0.22 none, in any clip. */
export const TUBE_BELOW_EYE = 0.04;
export const TUBE_BESIDE_EYE = 0.22;
export const TUBE_BEHIND = 0.4;
export const AIM_ELEVATION_DEG: Record<WeaponKind, number> = { rifle: 0, rpg: 3, manpad: 35, spike: 0 };
/** The carry the hold blends a tube's aim FROM inside a kneel drop. In
 *  `idle`/`move` a tube keeps the importer's own seated carry (apply-hold.ts). */
export const CARRY_ELEVATION_DEG: Record<WeaponKind, number> = {
  rifle: READY_PITCH_DEG,
  rpg: 20,
  manpad: 70,
  spike: -15,
};
/**
 * The Spike's carry in \`idle\`/\`move\` (and the start of a kneel drop): at
 * the chest, in front, both hands on it, muzzle CARRY_ELEVATION_DEG.spike
 * down and SPIKE_CARRY_YAW_IN across the body -- carried, not aimed. Low and
 * in front because the command-launch unit is the REAR of this tube:
 * shouldered and pitched up like the RPG's carry, it would sit in his upper
 * back. Its rear end sits SPIKE_CARRY_REAR from the tube-side shoulder joint
 * (forward, up) and SPIKE_CARRY_IN inboard of the rest seat's own lateral.
 *
 * Searched on the shipped figure (spike-walk, 6 Oct), against the two gates
 * that hold every launcher (launcher_clearance, launcher_arms): the first cut
 * (0.14 forward, level across, 20 down) put 145 Spike samples inside him and
 * 258 arm vertices (limit 148); 0.25 forward cleared the tube but not the
 * arms (236), and the support arm reaching across his chest to the handle is
 * what costs -- turning the muzzle 30 across and the tube 8 cm inboard brings
 * the handle to it: 0 samples inside, arms 146 (idle) / 135 (move), level
 * with the aim seat's own 150. Further forward, the hands leave the grips.
 */
export const SPIKE_CARRY_REAR: readonly [number, number] = [0.34, 0.06];
export const SPIKE_CARRY_IN = 0.08;
export const SPIKE_CARRY_YAW_IN = 30;
/** Torso: forward lean and blade (shooting shoulder back), degrees. */
export const AIM_TORSO: Record<WeaponKind, { lean: number; blade: number }> = {
  rifle: { lean: 12, blade: 20 },
  rpg: { lean: 6, blade: 25 },
  manpad: { lean: -4, blade: 25 },
  spike: { lean: 4, blade: 0 },
};
export const READY_TORSO = { lean: 0, blade: 10 };
/**
 * A figure with MODELLED hands (GH-826) has fixed stations on the weapon: the support palm sits at u 0.54 on the
 * handguard, 0.54 m ahead of the butt, and the rig's arms (a 0.117 m upper arm from the armpit pivot, a 0.268 m
 * forearm) reach 0.46 m to a palm. The formula grips slid the hand back until it reached; these hands do not
 * slide. What gives is the stance: bladed to the target the way a shooter stands (30 to 45 degrees; the support
 * shoulder comes forward by 0.33 m x sin(blade) against the firing one), the support shoulder protracted further,
 * and the butt a little further back in its pocket. Measured on inf_squad (`_coord/inf-hands/r1/`): at 20 degrees
 * and the formula pocket the support wrist was 0.17 m out of reach in `fire`, 0.09 m at low ready.
 */
export const HANDS_READY_TORSO = { lean: 0, blade: 28 };
export const HANDS_AIM_TORSO = { lean: 12, blade: 38 };
export const HANDS_PROTRACTION: V3 = [0.11, 0.0, 0.045];
export const HANDS_RIFLE_POCKET: V3 = [0.015, 0.16, 0.05];
export const HANDS_READY_POCKET: V3 = [0.0, 0.12, 0.06];
/** The support shoulder reaching for the handguard: the scapula slides
 *  forward and in (protraction), metres in the figure's frame. The cut
 *  rigs' upper-arm bone is short (0.15 m, from the armpit), so without it a
 *  support hand closes 5 cm short of a carbine's handguard. */
export const SUPPORT_PROTRACTION: V3 = [0.06, 0.0, 0.03];
export const PROTRACTION_TUBE = 0.7;
/** A hand further than this from its grip is a defect the pass refuses. */
export const MAX_GRIP_GAP_M = 0.04;

export interface HoldFigure {
  readonly prefix: string;
  readonly kind: WeaponKind;
  /** The weapon's rest frame: butt point, bore axis, up, length. */
  readonly butt: V3;
  readonly axis: V3;
  readonly up: V3;
  readonly length: number;
  /** Weapon vertices (indices into the rest list) and the joint that carried them. */
  readonly fromJoint: Node;
  /** Hands: rest points carried by each forearm. */
  readonly handShoot: V3;
  readonly handSupport: V3;
  readonly eye: V3;
  readonly eyeJoint: Node;
  /** 'L' or 'R': the rig.py side of the arm on the trigger -- the
   *  anatomical right, except a Spike, held on the left where it was seated. */
  readonly shootSide: 'L' | 'R';
  /** A Spike only: the rest hand points, which the importer solved onto its
   *  pistol grip and handle -- the grips, carried with the weapon. */
  readonly restGrips?: { readonly shoot: V3; readonly support: V3 };
  /** A figure whose hands are modelled pieces on bones of their own (GH-826): the stations the hold closes them on. */
  readonly hands?: HandRig;
}

/** +1 when the weapon is held on the anatomical right (+Z), -1 on the left. */
export const holdSide = (h: HoldFigure): 1 | -1 => (h.kind === 'spike' ? -1 : 1);

function pca(points: V3[]): { c: V3; axis: V3 } {
  const n = points.length;
  const c: V3 = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) c[k] += p[k] / n;
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += d[i] * d[j];
  }
  let v: V3 = [1, 0.1, 0.05];
  for (let it = 0; it < 64; it++) {
    v = norm([
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ]);
  }
  return { c, axis: v };
}

/** The distal end of a forearm part: where its hand closes. */
export function handPoint(rig: Rig, verts: RestVertex[], forearm: Node): V3 {
  const elbow = rig.restWorld.get(forearm)!.t;
  const own = verts.filter((v) => v.joint === forearm && v.role !== 'weapon' && v.role !== 'metal');
  if (own.length < 8) throw new Error(`motion: ${forearm.getName()} carries ${own.length} vertices, no hand to place`);
  const d = own.map((v) => len(sub(v.p, elbow)));
  const cut = [...d].sort((a, b) => a - b)[Math.floor(d.length * 0.9)];
  const far = own.filter((_, i) => d[i] >= cut);
  const fc = scale(far.reduce((a, v) => add(a, v.p), [0, 0, 0] as V3), 1 / far.length);
  const dir = norm(sub(fc, elbow));
  return add(elbow, scale(dir, Math.min(0.38, len(sub(fc, elbow)) * 0.85)));
}

export function describeHold(rig: Rig, verts: RestVertex[], prefix: string, kind: WeaponKind): HoldFigure {
  const fromJoint = rig.node(`${prefix}_forearm_R`);
  const w = verts.filter((v) => v.joint === fromJoint && v.role === 'weapon').map((v) => v.p);
  if (w.length < 30) throw new Error(`motion: ${prefix} has ${w.length} weapon vertices on forearm_R`);
  const { c, axis: a0 } = pca(w);
  const axis = a0[0] < 0 ? scale(a0, -1) : a0;
  const proj = w.map((p) => dot(sub(p, c), axis));
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const up = norm(sub([0, 1, 0], scale(axis, axis[1])));
  const zL = rig.restWorld.get(rig.node(`${prefix}_upperarm_L`))!.t[2];
  const zR = rig.restWorld.get(rig.node(`${prefix}_upperarm_R`))!.t[2];
  const right = zL > zR ? 'L' : 'R';
  // A Spike stays on the shoulder the importer seated it on: the tube rides
  // `forearm_R` (the anatomical left), whose hand closes on its pistol grip.
  const shootSide = kind === 'spike' ? (right === 'L' ? 'R' : 'L') : right;
  const support = shootSide === 'L' ? 'R' : 'L';
  const head = rig.node(`${prefix}_head`);
  const face = verts.filter((v) => v.joint === head && v.role === 'face');
  const eye: V3 =
    face.length > 0
      ? scale(face.reduce((s, v) => add(s, v.p), [0, 0, 0] as V3), 1 / face.length)
      : add(rig.restWorld.get(head)!.t, [0.09, 0.04, 0]);
  const wf = kind === 'rifle' ? weaponFrameOf(rig, prefix) : undefined;
  const hands = wf && rig.has(`${prefix}_hand_${shootSide}`) ? describeHands(rig, prefix, shootSide) : undefined;
  if (hands && wf) {
    // The reshaped carbine and its hands (GH-826): the weapon's frame is the one the hands pass seated it in, and
    // the hands' reach points are their wrists. Nothing is measured off a point cloud.
    const wristS = rig.restWorld.get(hands.fire.hand)!.t;
    const wristP = rig.restWorld.get(hands.support.hand)!.t;
    return {
      prefix, kind, butt: wf.butt, axis: wf.axis, up: wf.up, length: wf.length, fromJoint, handShoot: wristS, handSupport: wristP,
      eye, eyeJoint: head, shootSide, hands,
    };
  }
  const handShoot = handPoint(rig, verts, rig.node(`${prefix}_forearm_${shootSide}`));
  const handSupport = handPoint(rig, verts, rig.node(`${prefix}_forearm_${support}`));
  return {
    prefix,
    kind,
    butt: add(c, scale(axis, lo)),
    axis,
    up,
    length: hi - lo,
    fromJoint,
    handShoot,
    handSupport,
    eye,
    eyeJoint: head,
    shootSide,
    ...(kind === 'spike' ? { restGrips: { shoot: handShoot, support: handSupport } } : {}),
  };
}

/** The weapon bone's rest world frame: at the butt, axis-aligned. */
export const weaponRest = (h: HoldFigure): Xf => ({ t: h.butt, r: [0, 0, 0, 1], s: 1 });

export interface HoldState {
  /** 0 = low ready / carry, 1 = aim. */
  readonly aim: number;
  /** The aimed torso lean, degrees, when not the weapon's own (a kneeling
   *  shooter sits back over his heel and leans less). */
  readonly aimLean?: number;
  /** Degrees more blade than the stance's own (a figure with modelled hands turns further to reach). */
  readonly bladeExtra?: number;
  /** Take the pelvis's tilt and the clip's own heading out of the torso first (a kneel's lerp, a kneeler's turn to the
   *  target): the stance's blade is an absolute turn from the weapon's line, and the head keeps the clip's look. A
   *  stride (idle, move, fire, moveFire) keeps the clip's own sway above the belt instead: that is the walk. */
  readonly upright?: boolean;
}

export interface HoldResult {
  readonly gapShoot: number;
  readonly gapSupport: number;
  readonly eyeAboveBore: number;
  /** A modelled hand (GH-826) only: each wrist's bend past its anatomical limit, degrees, and how far the hand's
   *  orientation was turned off the station's own to get there (the spec allows 15). */
  readonly wrist?: { readonly fire: WristReading; readonly support: WristReading; readonly offsetFire: number; readonly offsetSupport: number; readonly cost: number };
}

const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function setWorldRot(rig: Rig, pose: Pose, node: Node, worldRot: Q): void {
  const p = rig.parent.get(node)!;
  const pw = rig.worldOf(p, pose);
  const cur = pose.get(node)!;
  pose.set(node, { ...cur, r: qnorm(qmul(qconj(pw.r), worldRot)) });
}

/** Rotate `node` in WORLD space by `q` about its own origin. */
export function rotateWorld(rig: Rig, pose: Pose, node: Node, q: Q): void {
  const w = rig.worldOf(node, pose);
  setWorldRot(rig, pose, node, qmul(q, w.r));
}

/**
 * `hinge`: turn the forearm about the elbow's own hinge (the normal of the bend plane) first and only then by the small
 * remainder. The shortest arc is ill-conditioned when the forearm has to fold nearly back on itself (a ready arm: the
 * upper arm is short, the forearm turns almost 180 degrees), and from one frame to the next its twist flips by 180
 * degrees. Used by the modelled hands; the formula holds keep the arc they were authored with.
 */
/** Which way each upper arm's elbow was last seen bending about its hinge (see `twoBoneIK`'s hinge form). */
const BEND_SIGN = new WeakMap<Node, number>();
export function twoBoneIK(rig: Rig, pose: Pose, upper: Node, fore: Node, handRest: V3, target: V3, pole: V3, hinge = false): number {
  if (hinge) {
    // The arm is solved from its REST relation to the torso, not from whatever the clip had it doing: the shortest arc from
    // an incoming pose is discontinuous where that pose points nearly opposite the answer (a drop's half-way pose does,
    // and the upper arm turned 100 degrees in one frame), and the hold replaces both arms outright anyway.
    pose.set(upper, { ...pose.get(upper)!, r: rig.rest.get(upper)!.r });
    pose.set(fore, { ...pose.get(fore)!, r: rig.rest.get(fore)!.r });
  }
  const S = rig.worldOf(upper, pose).t;
  const E = rig.worldOf(fore, pose).t;
  const H = carry(rig, (n) => rig.worldOf(n, pose), fore, handRest);
  const a = len(sub(E, S));
  const b = len(sub(H, E));
  const d = sub(target, S);
  const L = Math.min(len(d), (a + b) * 0.999);
  const dn = norm(d);
  const cosA = Math.max(-1, Math.min(1, (a * a + L * L - b * b) / (2 * a * L)));
  const pp = norm(sub(pole, scale(dn, dot(pole, dn))));
  const E2 = add(add(S, scale(dn, a * cosA)), scale(pp, a * Math.sqrt(Math.max(0, 1 - cosA * cosA))));
  rotateWorld(rig, pose, upper, qfromTo(sub(E, S), sub(E2, S)));
  const E3 = rig.worldOf(fore, pose).t;
  const H2 = carry(rig, (n) => rig.worldOf(n, pose), fore, handRest);
  const aDir = norm(sub(H2, E3));
  const bDir = norm(sub(add(S, scale(dn, L)), E3));
  if (hinge) {
    const n = norm(cross(dn, pp));
    const pa = sub(aDir, scale(n, dot(aDir, n)));
    const pb = sub(bDir, scale(n, dot(bDir, n)));
    if (len(pa) > 1e-6 && len(pb) > 1e-6) {
      const na = norm(pa), nb = norm(pb);
      // The elbow only flexes one way: the forearm turns about the hinge in the sense the bend implies (upper arm toward the
      // forearm's answer), so a turn that atan2 reports the other way round near 180 degrees is the same turn, long way.
      let phi = Math.atan2(dot(cross(na, nb), n), dot(na, nb));
      const eu = norm(sub(E2, S));
      const flex = dot(cross(eu, bDir), n);
      if (Math.abs(flex) > 1e-3) {
        if (phi * flex < 0 && Math.abs(phi) > deg(100)) phi += Math.sign(flex) * 2 * Math.PI;
        BEND_SIGN.set(upper, Math.sign(flex));
      } else if (Math.abs(phi) > deg(150)) {
        // fully folded: the turn is 180 either way and atan2 picks by rounding; the sense the arm was bending in decides
        phi = (BEND_SIGN.get(upper) ?? -1) * Math.abs(phi);
      }
      const q1 = qaxis(n, phi);
      const q2 = qfromTo(qrot(q1, aDir), bDir);
      rotateWorld(rig, pose, fore, qmul(q2, q1));
    } else rotateWorld(rig, pose, fore, qfromTo(aDir, bDir));
  } else rotateWorld(rig, pose, fore, qfromTo(sub(H2, E3), sub(add(S, scale(dn, L)), E3)));
  const H3 = carry(rig, (n) => rig.worldOf(n, pose), fore, handRest);
  return len(sub(H3, target));
}

function weaponDir(pitchDeg: number, yawInDeg: number, side: number): V3 {
  const p = deg(pitchDeg);
  const y = deg(yawInDeg);
  // yaw "in" turns the muzzle toward the support side (-side on Z).
  return norm([Math.cos(p) * Math.cos(y), Math.sin(p), -side * Math.cos(p) * Math.sin(y)]);
}

/** A hand is held when it is on its station and its wrist inside the anatomy. */
/** A hand's cost (`placeHand`) under which a stance is settled: on the station, inside the wrist, near its own turn. */
const HELD_COST = 0.006;
/** The trigger finger is on the trigger by this much aim (0 low ready, 1 aimed): a finger half way between the receiver
 *  and the trigger hovers off both, and the hand loses a fifth of its contact for the frames it takes to get there. */
export const TRIGGER_CLOSE_AIM = 0.2;
/** More blade, degrees, tried in turn when a modelled hand cannot reach (the stance gives, not the station). */
const BLADE_EXTRAS = [0, 5, 10, 15, 20, 25, 30];

export function solveHold(rig: Rig, pose: Pose, h: HoldFigure, weapon: Node, st: HoldState): HoldResult {
  if (!h.hands) return solveHoldOnce(rig, pose, h, weapon, st);
  // Every node the solve writes, restored between tries.
  const hr = h.hands;
  const p = h.prefix;
  const nodes: Node[] = [
    rig.node(`${p}_spine`), rig.node(`${p}_neck`), rig.node(`${p}_head`), weapon,
    hr.fire.upper, hr.fire.fore, hr.fire.hand, hr.support.upper, hr.support.fore, hr.support.hand,
    ...(hr.finger ? [hr.finger.node] : []),
  ];
  const saved = nodes.map((n) => pose.get(n)!);
  let best: HoldResult | null = null;
  let bestSnap: Xf[] = [];
  let bestScore = Infinity;
  let bestExtra = 0;
  const lastExtra = BLADE_MEMORY.get(h);
  const mem0 = [HAND_MEMORY.get(hr.fire), HAND_MEMORY.get(hr.support)];
  let memBest = mem0;
  const order = lastExtra === undefined ? BLADE_EXTRAS : [lastExtra, ...BLADE_EXTRAS.filter((e) => e !== lastExtra)];
  for (const extra of order) {
    nodes.forEach((n, i) => pose.set(n, saved[i]));
    for (const [i, st2] of [hr.fire, hr.support].entries()) { if (mem0[i]) HAND_MEMORY.set(st2, mem0[i]!); else HAND_MEMORY.delete(st2); }
    const r = solveHoldOnce(rig, pose, h, weapon, { ...st, bladeExtra: (st.bladeExtra ?? 0) + extra });
    const handCost = r.wrist ? r.wrist.cost : Math.max(r.gapShoot, r.gapSupport);
    const score = handCost + 0.0002 * extra + (lastExtra === undefined ? 0 : 0.0002 * Math.abs(extra - lastExtra));
    // the stance changes to another blade only for a real gain: a torso that toggles 5 degrees between two frames takes the arm
    // to another solution with it
    if (score < bestScore - (best ? SWITCH_MARGIN : 0)) {
      bestScore = score;
      best = r;
      bestExtra = extra;
      memBest = [HAND_MEMORY.get(hr.fire), HAND_MEMORY.get(hr.support)];
      bestSnap = nodes.map((n) => pose.get(n)!);
    }
    // nothing left to gain: both hands sit on their stations, in their wrists' range, with no turn off the station
    if (handCost < HELD_COST) break;
  }
  nodes.forEach((n, i) => pose.set(n, bestSnap[i]));
  BLADE_MEMORY.set(h, bestExtra);
  for (const [i, st2] of [hr.fire, hr.support].entries()) { if (memBest[i]) HAND_MEMORY.set(st2, memBest[i]!); else HAND_MEMORY.delete(st2); }
  return best!;
}

/**
 * Solve one figure's hold into `pose` (mutated): torso, weapon bone, both
 * arms, and on an aimed rifle the cheek weld. Returns the residual gaps.
 */
function solveHoldOnce(rig: Rig, pose: Pose, h: HoldFigure, weapon: Node, st: HoldState): HoldResult {
  const p = h.prefix;
  const side = holdSide(h); // anatomical right is +Z
  const spine = rig.node(`${p}_spine`);
  const aimTorso = h.hands ? HANDS_AIM_TORSO : AIM_TORSO[h.kind];
  const readyTorso = h.hands ? HANDS_READY_TORSO : READY_TORSO;
  const lean = readyTorso.lean + ((st.aimLean ?? aimTorso.lean) - readyTorso.lean) * st.aim;
  const blade = readyTorso.blade + (aimTorso.blade - readyTorso.blade) * st.aim + (st.bladeExtra ?? 0);
  let lostHeading = 0;
  if (h.hands && st.upright) {
    // A kneel's stance is built on an upright torso: a pelvis tipped by the lerp between standing and kneeling must
    // not leave the shoulders where a formula placed them for a man standing, or the stations drift out of reach.
    // A stride (idle, move, fire, moveFire) keeps the clip's own sway above the belt: that is the walk.
    const rootN = rig.node(`${p}_root`);
    const rw = rig.worldOf(rootN, pose);
    const rr = rig.restWorld.get(rootN)!;
    const up0 = qmul(qmul(rw.r, qconj(rr.r)), rig.restWorld.get(spine)!.r);
    // The heading the torso gives up is the head's to keep: the face stays where the clip looks.
    const heading = (q: Q): number => { const f = qrot(q, [1, 0, 0]); return Math.atan2(-f[2], f[0]); };
    lostHeading = wrapPi(heading(rig.worldOf(spine, pose).r) - heading(up0));
    setWorldRot(rig, pose, spine, up0);
  }
  // Lean: the head toward +X is a rotation about -Z. Blade: the shooting
  // (+Z) shoulder back is a rotation about +Y by a negative angle.
  rotateWorld(rig, pose, spine, qmul(qaxis([0, 0, 1], -deg(lean)), qaxis([0, 1, 0], -side * deg(blade))));
  // The head does not blade with the shoulders: a shooter looks down the
  // bore, so the neck turns the face back onto the aim by the blade.
  rotateWorld(rig, pose, rig.node(`${p}_neck`), qaxis([0, 1, 0], side * deg(blade)));
  if (lostHeading !== 0) rotateWorld(rig, pose, rig.node(`${p}_neck`), qaxis([0, 1, 0], lostHeading));

  const W = (n: Node) => rig.worldOf(n, pose);
  const shoulder = W(rig.node(`${p}_upperarm_${h.shootSide}`)).t;
  const eye0 = carry(rig, W, h.eyeJoint, h.eye);

  // The two placements, then blended by `aim`.
  const place = (aim: boolean): { butt: V3; dir: V3 } => {
    if (h.kind === 'spike') {
      // Aimed: the rest seat, carried with the eye -- the CLU in front of it,
      // the bore beside the cheek, level. Carried: low in front, muzzle down.
      if (aim) return { butt: add(eye0, sub(h.butt, h.eye)), dir: h.axis };
      const outboard = h.butt[2] - h.eye[2] - side * SPIKE_CARRY_IN;
      const dir = weaponDir(CARRY_ELEVATION_DEG.spike, SPIKE_CARRY_YAW_IN, side);
      return { butt: [shoulder[0] + SPIKE_CARRY_REAR[0], shoulder[1] + SPIKE_CARRY_REAR[1], eye0[2] + outboard], dir };
    }
    if (h.kind === 'rifle') {
      if (aim) {
        const pk = h.hands ? HANDS_RIFLE_POCKET : RIFLE_POCKET;
        const butt = add(shoulder, [pk[0], pk[1], -side * pk[2]]);
        return { butt, dir: weaponDir(AIM_ELEVATION_DEG.rifle, 0, side) };
      }
      const rk = h.hands ? HANDS_READY_POCKET : READY_POCKET;
      const butt = add(shoulder, [rk[0], rk[1], -side * rk[2]]);
      return { butt, dir: weaponDir(READY_PITCH_DEG, READY_YAW_DEG, side) };
    }
    const el = aim ? AIM_ELEVATION_DEG[h.kind] : CARRY_ELEVATION_DEG[h.kind];
    const dir = weaponDir(el, 0, side);
    const seat: V3 = [shoulder[0] + 0.02, eye0[1] - TUBE_BELOW_EYE - (aim ? 0 : 0.03), eye0[2] + side * TUBE_BESIDE_EYE];
    return { butt: sub(seat, scale(dir, TUBE_BEHIND * h.length)), dir };
  };
  const a = place(false);
  const b = place(true);
  const butt = lerp3(a.butt, b.butt, st.aim);
  const dir = norm(lerp3(a.dir, b.dir, st.aim));
  const r = qmul(qbasis(dir, [0, 1, 0]), qconj(qbasis(h.axis, h.up)));
  // The weapon bone's rest world is `weaponRest(h)` (at the rest butt, no
  // rotation), so posing its WORLD at (butt, r) maps every rest vertex v to
  // butt + r (v - restButt): the weapon, moved and turned as a whole.
  pose.set(weapon, rig.localFor(weapon, { t: butt, r, s: 1 }, pose));

  // Cheek weld on an aimed rifle: pitch the neck and head down until the
  // eye sits CHEEK_EYE_ABOVE_BORE over the bore, and tilt the head onto the
  // stock. Blended by `aim`.
  let eyeAboveBore = NaN;
  if (h.kind === 'rifle' && st.aim > 0) {
    const neck = rig.node(`${p}_neck`);
    const head = rig.node(`${p}_head`);
    const lateral: V3 = [0, 0, 1];
    for (let it = 0; it < 16; it++) {
      const eye = carry(rig, W, h.eyeJoint, h.eye);
      const along = dot(sub(eye, butt), dir);
      const boreAt = add(butt, scale(dir, along));
      const err = eye[1] - (boreAt[1] + CHEEK_EYE_ABOVE_BORE) * 1;
      const want = err * st.aim;
      if (Math.abs(want) < 0.004) break;
      const step = Math.max(-deg(5), Math.min(deg(5), want / 0.13));
      // A positive step pitches the face DOWN: about +Z moves +Y toward -X...
      // for a figure facing +X, nose-down is a rotation about -Z.
      rotateWorld(rig, pose, neck, qaxis(lateral, -step * 0.5));
      rotateWorld(rig, pose, head, qaxis(lateral, -step * 0.5));
    }
    rotateWorld(rig, pose, head, qaxis([1, 0, 0], deg(10) * st.aim));
    const eye = carry(rig, W, h.eyeJoint, h.eye);
    const along = dot(sub(eye, butt), dir);
    eyeAboveBore = eye[1] - add(butt, scale(dir, along))[1];
  }

  if (h.hands) {
    const hr = h.hands;
    const delta: Xf = { t: sub(butt, qrot(r, h.butt)), r, s: 1 };
    const sup0 = h.shootSide === 'L' ? 'R' : 'L';
    // Protract the support shoulder, as the formula grips always did (SUPPORT_PROTRACTION).
    {
      const k = (0.7 + 0.3 * st.aim) * (h.kind === 'rifle' ? 1 : PROTRACTION_TUBE);
      const ua = rig.node(`${p}_upperarm_${sup0}`);
      const parentW = rig.worldOf(rig.parent.get(ua)!, pose);
      const want: V3 = [HANDS_PROTRACTION[0] * k, HANDS_PROTRACTION[1] * k, side * HANDS_PROTRACTION[2] * k];
      const local = qrot(qconj(parentW.r), scale(want, 1 / parentW.s));
      const cur = pose.get(ua)!;
      pose.set(ua, { ...cur, t: add(cur.t, local) });
    }
    const fire = placeHand(rig, pose, hr.fire, delta, [-0.2, -1, 0.7 * side], smoothstep(Math.min(1, st.aim / TRIGGER_CLOSE_AIM)));
    const supp = placeHand(rig, pose, hr.support, delta, supportPole ? [supportPole[0], supportPole[1], supportPole[2] * side] : [0.1, -1, -0.35 * side]);
    if (hr.finger) {
      // The trigger finger lies along the receiver at low ready and goes onto the trigger as the weapon comes up.
      const rest = rig.rest.get(hr.finger.node)!;
      const cur = pose.get(hr.finger.node) ?? rest;
      pose.set(hr.finger.node, { ...cur, r: qmul(rest.r, qaxis([1, 0, 0], -deg(hr.finger.triggerDeg) * smoothstep(Math.min(1, st.aim / TRIGGER_CLOSE_AIM)))) });
    }
    return {
      gapShoot: fire.gap, gapSupport: supp.gap, eyeAboveBore,
      wrist: { fire: fire.wrist, support: supp.wrist, offsetFire: fire.offsetDeg, offsetSupport: supp.offsetDeg, cost: fire.cost + supp.cost },
    };
  }
  // Grips, then the arms onto them.
  const grip = (frac: number, drop: number): V3 => {
    const rest = sub(add(h.butt, scale(h.axis, frac * h.length)), scale(h.up, drop));
    return add(butt, qrot(r, sub(rest, h.butt)));
  };
  const g = GRIPS[h.kind];
  // A Spike's grips are where the importer closed the hands, moved with it.
  const carried = (rest: V3): V3 => add(butt, qrot(r, sub(rest, h.butt)));
  const trigger = h.restGrips ? carried(h.restGrips.shoot) : grip(g.trigger[0], g.trigger[1]);
  const supportG = grip(g.support[0], g.support[1]);
  const sup = h.shootSide === 'L' ? 'R' : 'L';
  // Protract the support shoulder: forward and toward the midline, fully
  // when aimed and most of the way at low ready (the hand is still forward).
  // Less on a shouldered tube: its grips sit close in under it, and a full
  // protraction pushes the upper arm's root into the chest (measured on
  // rpg_team: +60-110 arm vertices inside the torso); none at all and the
  // support hand closes 4 cm short of the RPG's front grip.
  {
    const k = (0.7 + 0.3 * st.aim) * (h.kind === 'rifle' ? 1 : PROTRACTION_TUBE);
    const ua = rig.node(`${p}_upperarm_${sup}`);
    const parentW = rig.worldOf(rig.parent.get(ua)!, pose);
    const want: V3 = [SUPPORT_PROTRACTION[0] * k, SUPPORT_PROTRACTION[1] * k, side * SUPPORT_PROTRACTION[2] * k];
    const local = qrot(qconj(parentW.r), scale(want, 1 / parentW.s));
    const cur = pose.get(ua)!;
    pose.set(ua, { ...cur, t: add(cur.t, local) });
  }
  const gapShoot = twoBoneIK(
    rig,
    pose,
    rig.node(`${p}_upperarm_${h.shootSide}`),
    rig.node(`${p}_forearm_${h.shootSide}`),
    h.handShoot,
    trigger,
    [-0.2, -1, 0.7 * side]
  );
  // The support hand slides back along the handguard until it reaches: a
  // short-armed figure holds nearer the magazine well, which is a real grip
  // too. Never behind SUPPORT_MIN_FRAC.
  let gapSupport = Infinity;
  if (h.restGrips) {
    gapSupport = twoBoneIK(
      rig,
      pose,
      rig.node(`${p}_upperarm_${sup}`),
      rig.node(`${p}_forearm_${sup}`),
      h.handSupport,
      carried(h.restGrips.support),
      [0.1, -1, -0.35 * side]
    );
  }
  for (let frac = g.support[0]; !h.restGrips && frac >= SUPPORT_MIN_FRAC[h.kind] - 1e-9; frac -= 0.02) {
    gapSupport = twoBoneIK(
      rig,
      pose,
      rig.node(`${p}_upperarm_${sup}`),
      rig.node(`${p}_forearm_${sup}`),
      h.handSupport,
      grip(frac, g.support[1]),
      [0.1, -1, -0.35 * side]
    );
    if (gapSupport < 0.005) break;
  }
  void supportG;
  return { gapShoot, gapSupport, eyeAboveBore };
}

/**
 * Frame-to-frame memory of the solutions, so a clip stays on one solution: a bend plane that turns 90 degrees in one
 * frame is a pop on screen and an interpolation error half way between the keys. Per hand: the elbow swing and the
 * orientation offset last chosen. Per figure: the blade extra last chosen. Cleared at the start of every clip
 * (`resetHoldMemory`); a solve in time order is the contract.
 */
type HandVars = readonly [number, number, number, number];
const HAND_MEMORY = new WeakMap<HandStation, HandVars>();
const BLADE_MEMORY = new WeakMap<HoldFigure, number>();
export function resetHoldMemory(h: HoldFigure): void {
  BLADE_MEMORY.delete(h);
  if (h.hands) { HAND_MEMORY.delete(h.hands.fire); HAND_MEMORY.delete(h.hands.support); }
}

/** What a clip's last frame left in the memory: the next clip can start from it (a drop starts from the idle's arms). */
export interface HoldMemory { readonly fire?: HandVars; readonly support?: HandVars; readonly blade?: number }
export function holdMemory(h: HoldFigure): HoldMemory {
  return { fire: h.hands ? HAND_MEMORY.get(h.hands.fire) : undefined, support: h.hands ? HAND_MEMORY.get(h.hands.support) : undefined, blade: BLADE_MEMORY.get(h) };
}
export function setHoldMemory(h: HoldFigure, m: HoldMemory): void {
  resetHoldMemory(h);
  if (!h.hands) return;
  if (m.fire) HAND_MEMORY.set(h.hands.fire, m.fire);
  if (m.support) HAND_MEMORY.set(h.hands.support, m.support);
  if (m.blade !== undefined) BLADE_MEMORY.set(h, m.blade);
}

/**
 * How fast the elbow's swing and the hand's turn may change, degrees a second, and the time since the last frame the next
 * `placeHand` is for (set by the caller; null at a clip's first frame). An arm that changes basin in one 8 ms frame is a
 * pop; with the swing held to this rate it takes the long way round through the in-between swings, and the wrist and the
 * station give a little where they must.
 */
export const HOLD_RATE_DEG_PER_S = 600;
let holdDt: number | null = null;
export function setHoldDt(dt: number | null): void { holdDt = dt; }
/** A team that asks for it (`MotionTeam.supportPole`): where the support elbow points when the hold's swing is 0, instead of the Rifle
 *  Squad's `[0.1, -1, -0.35]` (down). Demolition's elbow hangs down-and-out at the low ready and flares out and up at the aim, so against
 *  "down" it swung 10 degrees at the half way of the drop and 130 at its end; against "out, a little down" it swings 55 to 65 throughout and the
 *  search takes no wrist-limit exit (pace x16) that turned the upper arm 55 to 62 degrees in 8 ms (GH-826 step 3). z is for the anatomical right. */
let supportPole: V3 | null = null;
export function setSupportPole(p: V3 | null): void { supportPole = p; }

/** The elbow's swing about the shoulder-to-wrist line may go this far either way, degrees. */
const MAX_SWING_DEG = 120;
/** The hand may roll about its own channel axis this far either way (a wrist's pronation and supination): it keeps the
 *  hand closed on the grip or the handguard, and it is not the axis error the gate holds to 15 degrees. */
const MAX_ROLL_DEG = 40;
/** What a hand's contact is worth to the solver: it prices the contact it would lose below this fraction. */
const CONTACT_GOAL = 0.34;
/** A hand off its station is charged by the metre, dearly: the contact and depth tables assume it is on it. */
const GAP_WEIGHT = 10;
/** An elbow swung off its natural bend is charged by the degree: a swung elbow rides high, into the face and the helmet's gear. */
const SWING_WEIGHT = 0.0001;
/** How much cheaper (in `intrinsic` cost) another solution must be before a clip leaves the one it is on. */
const SWITCH_MARGIN = 0.012;
const CONTACT_WEIGHT = 0.1;
/** ...and the depth the weapon would sink into the glove past this many metres (the gate holds 3 mm). */
const DEPTH_GOAL = 0.002;
const DEPTH_WEIGHT = 4;
const clampVars = (v: HandVars): HandVars => {
  const sw = Math.max(-deg(MAX_SWING_DEG), Math.min(deg(MAX_SWING_DEG), v[0]));
  const roll = Math.max(-deg(MAX_ROLL_DEG), Math.min(deg(MAX_ROLL_DEG), v[1]));
  const a = Math.hypot(v[2], v[3]);
  const cap = deg(MAX_AXIS_ERROR_DEG - 1);
  const k = a > cap ? cap / a : 1;
  return [sw, roll, v[2] * k, v[3] * k];
};

/**
 * One modelled hand onto its station (GH-826). `delta` takes the weapon's REST frame to where the hold put it, so the
 * hand's ideal world transform is `delta . station`. The arm reaches for the wrist that puts the station's reference
 * point (the grip's axis point, the handguard's) exactly where it belongs; the hand turns to the station's own
 * orientation unless that costs the wrist more than its anatomy gives (flexion 60, extension 55, radial 20, ulnar
 * 35 degrees), when the hand is turned off it, about the reference point, by the least turn (at most 15 degrees)
 * that does. Returns the reference point's miss and the wrist's reading.
 *
 * The free variables are the elbow's swing about the shoulder-to-wrist line and the hand's turn off its station (a
 * rotation vector, at most 15 degrees). They are found by a compass search that starts from the last frame's answer, so
 * a clip moves continuously; only a frame the last answer no longer serves starts again from a spread of swings.
 */
export function placeHand(rig: Rig, pose: Pose, st: HandStation, delta: Xf, pole: V3, trigger = 0): { gap: number; wrist: WristReading; offsetDeg: number; cost: number } {
  const hw = compose(delta, st.rest);
  const refStation = add(hw.t, qrot(hw.r, st.ref));
  const restWrist = rig.restWorld.get(st.hand)!.t;
  const restLocal = rig.rest.get(st.hand)!.r;
  const savedUpper = pose.get(st.upper)!;
  const savedFore = pose.get(st.fore)!;
  const savedHand = pose.get(st.hand)!;
  const S0 = rig.worldOf(st.upper, pose).t;
  const prev = HAND_MEMORY.get(st);
  type Eval = { cost: number; intrinsic: number; upper: Xf; fore: Xf; hand: Xf; gap: number; wrist: WristReading; off: number; v: HandVars };
  // the pace the solution may change at; widened only where the wrist would otherwise go past its anatomy
  let pace = 1;
  const windowed = (v: HandVars): HandVars => {
    if (!prev || !holdDt) return v;
    const l = deg(HOLD_RATE_DEG_PER_S * holdDt * pace);
    const c = (x: number, p: number): number => Math.max(p - l, Math.min(p + l, x));
    return [c(v[0], prev[0]), c(v[1], prev[1]), c(v[2], prev[2]), c(v[3], prev[3])];
  };
  const evalAt = (vIn: HandVars): Eval => {
    const v = windowed(clampVars(vIn));
    pose.set(st.upper, savedUpper);
    pose.set(st.fore, savedFore);
    pose.set(st.hand, savedHand);
    // the hand's turn off its station, in the hand's own frame: a roll about its channel axis, then a tilt of that axis
    const R = qnorm(qmul(hw.r, turnOf(st.channel, v[1], v[2], v[3])));
    const target = sub(refStation, qrot(R, st.ref));
    const axis = norm(sub(target, S0));
    const poleSwung = qrot(qaxis(axis, v[0]), pole);
    twoBoneIK(rig, pose, st.upper, st.fore, restWrist, target, poleSwung, true);
    // The forearm carries the hand's pronation: twist it about its own long axis until the hand sits on it with no twist of its
    // own (the wrist keeps its flexion and deviation). The IK leaves the forearm's twist to whatever its arc happened to give,
    // and that jumps by 50 or 70 degrees between two frames; the twist the hand's orientation asks for does not. A sleeve and a
    // cuff that turn together also keep the wrist seam shut.
    {
      const f0 = rig.worldOf(st.fore, pose);
      const l0 = qnorm(qmul(qconj(f0.r), R));
      const tau = 2 * Math.atan2(l0[1], l0[3]);
      const cur = pose.get(st.fore)!;
      pose.set(st.fore, { ...cur, r: qnorm(qmul(cur.r, qaxis([0, 1, 0], tau))) });
    }
    const fw = rig.worldOf(st.fore, pose);
    const local = qnorm(qmul(qconj(fw.r), R));
    pose.set(st.hand, { ...savedHand, r: local });
    const hwNow = rig.worldOf(st.hand, pose);
    const gap = len(sub(add(hwNow.t, qrot(hwNow.r, st.ref)), refStation));
    const wrist = wristReading(restLocal, local, st.thumbMinusX);
    const off = (Math.hypot(v[2], v[3]) * 180) / Math.PI;
    // an arm swung off its natural bend is charged a little, a hand turned off its station a little more; a change from
    // the last frame's answer is charged too, so the clip stays on one solution
    const contact = st.contact.at(v[1], v[2], v[3], trigger);
    const depth = st.contact.depth(v[1], v[2], v[3], trigger);
    const intrinsic = GAP_WEIGHT * gap + 0.004 * wrist.overDeg + 0.001 * wrist.softDeg + CONTACT_WEIGHT * Math.max(0, CONTACT_GOAL - contact) + DEPTH_WEIGHT * Math.max(0, depth - DEPTH_GOAL) + SWING_WEIGHT * Math.abs((v[0] * 180) / Math.PI) + 0.0003 * off + 0.00005 * (Math.abs((v[1] * 180) / Math.PI));
    let cost = intrinsic;
    if (prev) {
      const d = Math.hypot(v[1] - prev[1], v[2] - prev[2], v[3] - prev[3]);
      cost += 0.00005 * ((d * 180) / Math.PI) + 0.0001 * Math.abs(((v[0] - prev[0]) * 180) / Math.PI);
    }
    return { cost, intrinsic, upper: pose.get(st.upper)!, fore: pose.get(st.fore)!, hand: pose.get(st.hand)!, gap, wrist, off, v };
  };
  const compass = (start: HandVars): Eval => {
    let cur = evalAt(start);
    let swStep = deg(12), oStep = deg(5);
    for (let it = 0; it < 80 && (swStep > deg(0.3) || oStep > deg(0.15)); it++) {
      let improved = false;
      for (const [i, step] of [[0, swStep], [1, oStep * 2], [2, oStep], [3, oStep]] as const) {
        for (const sgn of [1, -1]) {
          const w = [...cur.v] as [number, number, number, number];
          w[i] += sgn * step;
          const e = evalAt(w);
          if (e.cost < cur.cost - 1e-9) { cur = e; improved = true; }
        }
      }
      if (!improved) { swStep /= 2; oStep /= 2; }
      if (cur.gap < 0.0015 && cur.wrist.overDeg < 1e-9 && cur.wrist.softDeg < 1e-9 && cur.off < 0.5) break;
    }
    return cur;
  };
  const settled = (e: Eval): boolean => e.gap < 0.004 && e.wrist.overDeg < 1e-9 && e.intrinsic < 0.004;
  const solve = (): Eval => {
    let b: Eval = compass(prev ?? [0, 0, 0, 0]);
    if (!settled(b)) {
      for (const sw of [0, 30, -30, 60, -60, 90, -90]) {
        const e = compass([deg(sw), 0, 0, 0]);
        // a clip changes to another solution only for a real gain: an arm that flips between two nearly equal ones is a pop
        if (prev ? e.intrinsic < b.intrinsic - SWITCH_MARGIN : e.cost < b.cost - 1e-9) b = e;
        if (settled(b) && !prev) break;
      }
    }
    return b;
  };
  let best = solve();
  // The wrist's anatomy is a gate and the pace is not: where the paced solution would bend the wrist past its limit, let the
  // arm go faster, up to sixteen times as fast, rather than past the limit.
  for (const wider of [2, 4, 8, 16]) {
    if (!prev || !holdDt || best.wrist.overDeg < 0.05) break;
    pace = wider;
    const e = solve();
    if (e.wrist.overDeg < best.wrist.overDeg) best = e;
  }
  pose.set(st.upper, best.upper);
  pose.set(st.fore, best.fore);
  pose.set(st.hand, best.hand);
  HAND_MEMORY.set(st, best.v);
  return { gap: best.gap, wrist: best.wrist, offsetDeg: best.off, cost: best.intrinsic };
}

/**
 * The weapon of a figure whose clip the hold does not own (`down`, `fall`, `wreck`): it stays in the firing hand.
 * The hands keep the wrist `grip` gave them (a man falling with a rifle still holds it), and the weapon is put
 * where that hand's station says it is.
 */
export function followHand(rig: Rig, pose: Pose, h: HoldFigure, weapon: Node, grip: ReadonlyMap<Node, Q>): void {
  const hr = h.hands!;
  for (const st of [hr.fire, hr.support]) {
    const cur = pose.get(st.hand)!;
    const q = grip.get(st.hand);
    if (!q) continue;
    pose.set(st.hand, { ...cur, r: q });
    // the fist that shows in its place turns with it
    const fist = hr.fists.get(st.hand);
    if (fist) pose.set(fist, { ...pose.get(fist)!, r: q });
  }
  // the hand may be scaled away (a fist shows instead): measure the world with it at full size
  const cur = pose.get(hr.fire.hand)!;
  pose.set(hr.fire.hand, { ...cur, s: 1 });
  const hw = rig.worldOf(hr.fire.hand, pose);
  pose.set(hr.fire.hand, cur);
  const w = compose(compose(hw, invert(hr.fire.rest)), weaponRest(h));
  pose.set(weapon, rig.localFor(weapon, w, pose));
}

/** The weapon bone's local pose that keeps it where the old forearm put it:
 *  the death clips, `work`, and any clip the hold does not own. */
export function followForearm(rig: Rig, pose: Pose, h: HoldFigure, weapon: Node): void {
  const fw = rig.worldOf(h.fromJoint, pose);
  const rel = compose(invert(rig.restWorld.get(h.fromJoint)!), weaponRest(h));
  pose.set(weapon, rig.localFor(weapon, compose(fw, rel), pose));
}

export { cross, apply, qslerp };
