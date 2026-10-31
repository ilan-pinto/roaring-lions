/**
 * The hands' side of the hold (GH-826 step 2): where a rigged hand closes on the weapon, read from the file the
 * hands pass wrote (`extras.rl_hands`, `hands-pass.ts`), and the wrist's anatomical limits.
 *
 * A hand is one rigid piece on `{prefix}_hand_{L|R}`; its hand-local frame has the wrist crease at the origin. The
 * stations are rigid transforms hand-local -> the weapon part's own frame (`hands.py` solved them on the real
 * carbine: the grip's reshaped pistol grip, the handguard's real section), so with the weapon at its rest pose a
 * hand's world transform is `weaponFrame . station`, and the hold keeps that relation however the weapon moves:
 * the weapon is moved, the hands follow it, and the arms reach for the hands' wrists. There is no formula grip and
 * no sliding back along the handguard.
 */
import type { Node } from '@gltf-transform/core';
import { compose, deg, invert, qconj, qmul, qrot, type Q, type V3, type Xf } from './math';
import type { Rig } from './rig';
import { contactTable, type ContactTable, type FingerSpec } from './contact';

export interface HandStation {
  /** The rig.py bone side of this hand's arm. 'L' is the anatomical right (the shooting hand). */
  readonly side: 'L' | 'R';
  readonly upper: Node;
  readonly fore: Node;
  readonly hand: Node;
  /** hand-local -> rest world, with the weapon at its rest pose. */
  readonly rest: Xf;
  /** The hand-local point that must sit on the station (the grip's axis point, the handguard's axis point). */
  readonly ref: V3;
  /** Thumb on the -x side of the hand (a right hand): decides which way ulnar deviation turns. */
  readonly thumbMinusX: boolean;
  /** The hand's channel axis in its own frame (unit): the axis the closed hand curls about, along the grip or the bore. */
  readonly channel: V3;
  /** What the palm keeps of its contact with the weapon when the hand is turned off the station (roll, tilt, tilt). */
  readonly contact: ContactTable;
}

/** The channel axes in the hand's own frame, from the stations' rotations (`hands_fit.py`): the fist about the pistol
 *  grip is about hand x, the support palm about a line between x and y (0.8192, 0.5736, 0: the 35 degree yaw). */
export const GRIP_CHANNEL: V3 = [1, 0, 0];
export const SUPPORT_CHANNEL: V3 = [0.8192, 0.5736, 0];

export interface HandRig {
  readonly fire: HandStation;
  readonly support: HandStation;
  /** The firing hand's trigger finger, a bone of its own: it flexes about its own x, `triggerDeg` at full aim. */
  readonly finger?: { readonly node: Node; readonly triggerDeg: number };
  /** The hand and fist bones whose scale shows the hand or the fist, by side. */
  readonly fists: ReadonlyMap<Node, Node>;
}

interface RlHandsExtras {
  readonly stations: {
    readonly grip: { readonly R: number[][]; readonly t: number[]; readonly ref: number[] };
    readonly support: { readonly R: number[][]; readonly t: number[]; readonly ref: number[] };
    readonly finger: { readonly trigger_deg: number; readonly pivot: number[]; readonly axis: number[] };
  };
  readonly weapons: Record<string, { readonly origin: number[]; readonly q: number[]; readonly root: { readonly t: number[]; readonly r: number[] } }>;
  readonly part: { readonly butt_x: number; readonly triangles: number };
}

export function rlHands(rig: Rig): RlHandsExtras | undefined {
  const ex = (rig.doc.getRoot().listScenes()[0].getExtras() ?? {}) as { rl_hands?: RlHandsExtras };
  return ex.rl_hands;
}

/** A rotation matrix given as three rows, as a quaternion. */
function qfromRows(m: number[][]): Q {
  const m00 = m[0][0], m01 = m[0][1], m02 = m[0][2];
  const m10 = m[1][0], m11 = m[1][1], m12 = m[1][2];
  const m20 = m[2][0], m21 = m[2][1], m22 = m[2][2];
  const tr = m00 + m11 + m22;
  let q: Q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export interface WeaponFrame {
  readonly butt: V3;
  readonly axis: V3;
  readonly up: V3;
  readonly length: number;
  readonly xf: Xf;
}

/** The reshaped carbine's frame at its rest seat, from the hands pass (the hold no longer measures a PCA). */
export function weaponFrameOf(rig: Rig, prefix: string): WeaponFrame | undefined {
  const rh = rlHands(rig);
  const w = rh?.weapons[prefix];
  if (!rh || !w) return undefined;
  // the frame was written with the figure's root where the importer put it; the wedge has moved the root since
  const rootThen: Xf = { t: w.root.t as unknown as V3, r: w.root.r as unknown as Q, s: 1 };
  const rootNow = rig.restWorld.get(rig.node(`${prefix}_root`))!;
  const moved = compose(rootNow, invert(rootThen));
  const xf = compose(moved, { t: w.origin as unknown as V3, r: w.q as unknown as Q, s: 1 });
  const q = xf.r;
  const at = (v: V3): V3 => {
    const r = qrot(q, v);
    return [xf.t[0] + r[0], xf.t[1] + r[1], xf.t[2] + r[2]];
  };
  const butt = at([rh.part.butt_x, 0, 0]);
  const fwd = qrot(q, [1, 0, 0]);
  const up = qrot(q, [0, 1, 0]);
  return { butt, axis: fwd, up, length: -2 * rh.part.butt_x, xf };
}

export function describeHands(rig: Rig, prefix: string, shootSide: 'L' | 'R'): HandRig | undefined {
  const rh = rlHands(rig);
  const wf = weaponFrameOf(rig, prefix);
  if (!rh || !wf) return undefined;
  const support = shootSide === 'L' ? 'R' : 'L';
  const mk = (side: 'L' | 'R', st: { R: number[][]; t: number[]; ref: number[] }, channel: V3, parts: readonly string[], finger: FingerSpec | null): HandStation => {
    const station: Xf = { t: st.t as unknown as V3, r: qfromRows(st.R), s: 1 };
    return {
      side,
      upper: rig.node(`${prefix}_upperarm_${side}`),
      fore: rig.node(`${prefix}_forearm_${side}`),
      hand: rig.node(`${prefix}_hand_${side}`),
      rest: compose(wf.xf, station),
      ref: st.ref as unknown as V3,
      thumbMinusX: side === 'L',
      channel,
      contact: contactTable(st, st.ref as unknown as V3, channel, parts, finger),
    };
  };
  const fire = mk(shootSide, rh.stations.grip, GRIP_CHANNEL, ['inf_grip_R', 'inf_grip_R_index'], { part: 'inf_grip_R_index', pivot: rh.stations.finger.pivot, axis: rh.stations.finger.axis, deg: rh.stations.finger.trigger_deg });
  const sup = mk(support, rh.stations.support, SUPPORT_CHANNEL, ['inf_support_L'], null);
  const fingerName = `${prefix}_finger_${shootSide}`;
  const fists = new Map<Node, Node>();
  for (const s of ['L', 'R'] as const) if (rig.has(`${prefix}_fist_${s}`)) fists.set(rig.node(`${prefix}_hand_${s}`), rig.node(`${prefix}_fist_${s}`));
  return {
    fire,
    support: sup,
    ...(rig.has(fingerName) ? { finger: { node: rig.node(fingerName), triggerDeg: rh.stations.finger.trigger_deg } } : {}),
    fists,
  };
}

/** The wrist's anatomical limits, degrees (spec 1.3). */
export const WRIST_LIMITS = { flexion: 60, extension: 55, radial: 20, ulnar: 35 } as const;

export interface WristReading {
  /** Positive flexion (fingers toward the palm) or negative extension, degrees. */
  readonly flexDeg: number;
  /** Positive ulnar, negative radial deviation, degrees. */
  readonly ulnarDeg: number;
  /** How far past the nearest limit, degrees; 0 when inside all four. */
  readonly overDeg: number;
  /** How far past 85% of the nearest limit, degrees: the solver keeps clear of a limit it could just reach. */
  readonly softDeg: number;
}

/**
 * The wrist's bend, from the hand's rotation relative to its rest relation to the forearm: `relLocal` is the hand
 * bone's local rotation now, `restLocal` its rest one. The hand's distal axis (+y of the hand's own frame) is
 * swung by the difference; its tilt toward the palm (-z) is flexion, its lean toward the little finger ulnar.
 */
export function wristReading(restLocal: Q, relLocal: Q, thumbMinusX: boolean): WristReading {
  const q = qmul(qconj(restLocal), relLocal);
  const y = qrot(q, [0, 1, 0]);
  const flex = -Math.atan2(y[2], y[1]) * (180 / Math.PI);
  const dev = Math.atan2(y[0], y[1]) * (180 / Math.PI);
  const ulnar = thumbMinusX ? dev : -dev;
  const over = Math.max(
    0,
    flex - WRIST_LIMITS.flexion,
    -flex - WRIST_LIMITS.extension,
    ulnar - WRIST_LIMITS.ulnar,
    -ulnar - WRIST_LIMITS.radial
  );
  const soft = Math.max(
    0,
    flex - WRIST_LIMITS.flexion * 0.85,
    -flex - WRIST_LIMITS.extension * 0.85,
    ulnar - WRIST_LIMITS.ulnar * 0.85,
    -ulnar - WRIST_LIMITS.radial * 0.85
  );
  return { flexDeg: flex, ulnarDeg: ulnar, overDeg: over, softDeg: soft };
}

/** Offsets to try, in order, when the ideal hand orientation is out of reach or past a wrist limit: world-axis
 *  turns of the hand about its station point, each at most `MAX_AXIS_ERROR_DEG` in total (spec: 15 degrees). */
export const MAX_AXIS_ERROR_DEG = 15;
export function orientationOffsets(): Q[] {
  const out: Q[] = [[0, 0, 0, 1]];
  const steps = [0, 5, 10, 15];
  const seen = new Set<string>();
  const cand: { q: Q; ang: number }[] = [];
  for (const a of [-1, 0, 1]) {
    for (const b of [-1, 0, 1]) {
      for (const c of [-1, 0, 1]) {
        if (a === 0 && b === 0 && c === 0) continue;
        for (const s of steps.slice(1)) {
          const v = [a * s, b * s, c * s];
          const ang = Math.hypot(v[0], v[1], v[2]);
          if (ang > MAX_AXIS_ERROR_DEG + 1e-9) continue;
          const key = v.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          // small-angle rotation vector -> quaternion
          const h = deg(ang) / 2;
          const k = ang > 0 ? Math.sin(h) / ang : 0;
          cand.push({ q: [v[0] * k, v[1] * k, v[2] * k, Math.cos(h)], ang });
        }
      }
    }
  }
  cand.sort((p, q) => p.ang - q.ang);
  for (const c of cand) out.push(c.q);
  return out;
}
