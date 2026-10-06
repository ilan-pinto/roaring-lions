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
  sub,
  type Q,
  type V3,
  type Xf,
} from './math';
import { carry, type Pose, type RestVertex, type Rig } from './rig';

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
function handPoint(rig: Rig, verts: RestVertex[], forearm: Node): V3 {
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
}

export interface HoldResult {
  readonly gapShoot: number;
  readonly gapSupport: number;
  readonly eyeAboveBore: number;
}

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

function twoBoneIK(rig: Rig, pose: Pose, upper: Node, fore: Node, handRest: V3, target: V3, pole: V3): number {
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
  rotateWorld(rig, pose, fore, qfromTo(sub(H2, E3), sub(add(S, scale(dn, L)), E3)));
  const H3 = carry(rig, (n) => rig.worldOf(n, pose), fore, handRest);
  return len(sub(H3, target));
}

function weaponDir(pitchDeg: number, yawInDeg: number, side: number): V3 {
  const p = deg(pitchDeg);
  const y = deg(yawInDeg);
  // yaw "in" turns the muzzle toward the support side (-side on Z).
  return norm([Math.cos(p) * Math.cos(y), Math.sin(p), -side * Math.cos(p) * Math.sin(y)]);
}

/**
 * Solve one figure's hold into `pose` (mutated): torso, weapon bone, both
 * arms, and on an aimed rifle the cheek weld. Returns the residual gaps.
 */
export function solveHold(rig: Rig, pose: Pose, h: HoldFigure, weapon: Node, st: HoldState): HoldResult {
  const p = h.prefix;
  const side = holdSide(h); // anatomical right is +Z
  const spine = rig.node(`${p}_spine`);
  const aimTorso = AIM_TORSO[h.kind];
  const lean = READY_TORSO.lean + ((st.aimLean ?? aimTorso.lean) - READY_TORSO.lean) * st.aim;
  const blade = READY_TORSO.blade + (aimTorso.blade - READY_TORSO.blade) * st.aim;
  // Lean: the head toward +X is a rotation about -Z. Blade: the shooting
  // (+Z) shoulder back is a rotation about +Y by a negative angle.
  rotateWorld(rig, pose, spine, qmul(qaxis([0, 0, 1], -deg(lean)), qaxis([0, 1, 0], -side * deg(blade))));
  // The head does not blade with the shoulders: a shooter looks down the
  // bore, so the neck turns the face back onto the aim by the blade.
  rotateWorld(rig, pose, rig.node(`${p}_neck`), qaxis([0, 1, 0], side * deg(blade)));

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
        const butt = add(shoulder, [RIFLE_POCKET[0], RIFLE_POCKET[1], -side * RIFLE_POCKET[2]]);
        return { butt, dir: weaponDir(AIM_ELEVATION_DEG.rifle, 0, side) };
      }
      const butt = add(shoulder, [READY_POCKET[0], READY_POCKET[1], -side * READY_POCKET[2]]);
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

/** The weapon bone's local pose that keeps it where the old forearm put it:
 *  the death clips, `work`, and any clip the hold does not own. */
export function followForearm(rig: Rig, pose: Pose, h: HoldFigure, weapon: Node): void {
  const fw = rig.worldOf(h.fromJoint, pose);
  const rel = compose(invert(rig.restWorld.get(h.fromJoint)!), weaponRest(h));
  pose.set(weapon, rig.localFor(weapon, compose(fw, rel), pose));
}

export { cross, apply, qslerp };
