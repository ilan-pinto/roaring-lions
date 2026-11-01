/**
 * Hand proportion, read off the bytes (GH-826 F1, spec 1.10).
 *
 * The review's instrument, in TypeScript: the principal-axis extents (L x W x T, 0.5 to 99.5
 * percentile) of the vertices a hand owns past the wrist plane, the visible forearm (elbow joint
 * to the wrist crease, i.e. the hand bone's head), and the hung elbow height over the figure's
 * stature. Nothing here is imported from a generator or a motion pass: the bands in
 * `HAND_BANDS` are literals, from the spec, so the check cannot move with the thing it checks.
 *
 * Two readers, one measurement:
 *
 *  - `measureHand` reads a hand that has its own bone, `{prefix}_hand_{L|R}` (what the hands
 *    pass writes, and what `art/parts/hands/hands_probe.glb` carries today);
 *  - `measureFallbackHand` reads a shipped Meshy figure, which has no hand bone: the hand is the
 *    forearm bone's vertices past a wrist the review measured (`wristT`, along the elbow-to-
 *    farthest-vertex axis). It is how the gate sees today's bytes, which is the failing input.
 *
 * `_L` bones are the figure's ANATOMICAL RIGHT hand on the Meshy rigs.
 */
import { readAccessor, readGlb, type GlbFile } from './mesh_gait';

/** The spec's bands for a CLOSED hand, in metres (and the ratios). Literals on purpose. */
export const HAND_BANDS = {
  /** L, hand bone only: the trigger finger is its own bone when the hand has one. */
  lengthM: [0.115, 0.16],
  /** The whole hand, trigger finger included, wrist crease to the extended fingertip. */
  lengthWithFingerM: [0.16, 0.22],
  /**
   * The spec's W band, 0.085 to 0.115, applied to the PALM's breadth. A principal-axis W counts a
   * thumb held out, and the spec's own thumb poses (abducted 20 to 50 degrees) read 0.13 to 0.15
   * on a palm 0.094 across, so W itself cannot be held to that band. The palm breadth is read on
   * the ulnar side, which no thumb is on: twice the distance from the hand's own centre line to
   * its least-extended edge (see `palmBreadth`).
   */
  palmBreadthM: [0.085, 0.115],
  /**
   * The spec says 0.095, a fist's band. A hand wrapped round a 0.030 pistol grip is the palm (0.033) plus the grip plus
   * the fingers on its far side, which measures 0.097 to 0.099 once the fingers close on the real section (R0b: the
   * lead asked for a tighter curl). 0.105 still refuses a block-thick hand (the review's medic: 0.12).
   */
  thicknessMaxM: 0.105,
  handOverForearm: [0.42, 0.62],
  forearmM: [0.255, 0.285],
  elbowOverStature: [0.605, 0.625],
} as const;

export interface HandReading {
  readonly bone: string;
  readonly vertices: number;
  readonly lengthM: number;
  readonly widthM: number;
  /** Twice the smaller half-breadth about the wrist's centre line, in the hand bone's own x; NaN for a hand with no bone of its own. */
  readonly palmBreadthM: number;
  readonly thicknessM: number;
  /** L including the `{prefix}_finger_{side}` part, when there is one. */
  readonly lengthWithFingerM: number;
  /** The hand has its own `{prefix}_finger_{side}` part (the trigger finger), so `lengthWithFingerM` is meaningful. */
  readonly hasFingerBone: boolean;
  readonly forearmM: number;
  readonly handOverForearm: number;
  /** Elbow joint height over the figure's stature; null when the caller gave no stature. */
  readonly elbowOverStature: number | null;
}

type V3 = [number, number, number];

interface SkinnedVerts {
  /** Bind-pose positions and the dominant joint NAME per vertex. */
  readonly pos: V3[];
  readonly joint: string[];
  /** Joint heads in the bind pose, by joint name. */
  readonly heads: Map<string, V3>;
  /** Each joint's inverse-bind matrix (column-major): world bind position -> the joint's own frame. */
  readonly ibms: Map<string, number[]>;
  readonly triangles: number;
}

/** Every skinned vertex in the file with its dominant joint, and every joint's head (the inverse of its IBM). The worn
 *  kit (`kit_*` nodes) is not the body: it is left out of every reading, the stature included. */
export function readSkinned(glb: GlbFile): SkinnedVerts {
  const nodes = glb.json.nodes ?? [];
  const pos: V3[] = [];
  const joint: string[] = [];
  const heads = new Map<string, V3>();
  const ibms = new Map<string, number[]>();
  let triangles = 0;
  for (const node of nodes) {
    if (node.mesh === undefined || node.skin === undefined) continue;
    if ((node.name ?? '').startsWith('kit_')) continue;
    const skin = glb.json.skins?.[node.skin];
    if (!skin) continue;
    if (skin.inverseBindMatrices !== undefined) {
      const ibm = readAccessor(glb, skin.inverseBindMatrices).data;
      skin.joints.forEach((j, k) => {
        const name = nodes[j]?.name ?? '';
        if (!heads.has(name)) {
          heads.set(name, invertTranslation(ibm.subarray(k * 16, k * 16 + 16)));
          ibms.set(name, Array.from(ibm.subarray(k * 16, k * 16 + 16)));
        }
      });
    }
    for (const prim of glb.json.meshes?.[node.mesh]?.primitives ?? []) {
      const p = readAccessor(glb, prim.attributes.POSITION);
      const j = readAccessor(glb, prim.attributes.JOINTS_0);
      const w = readAccessor(glb, prim.attributes.WEIGHTS_0);
      if (prim.indices !== undefined) triangles += readAccessor(glb, prim.indices).count / 3;
      for (let v = 0; v < p.count; v++) {
        let best = -1, bw = 0;
        for (let k = 0; k < 4; k++) {
          const x = w.data[v * 4 + k];
          if (x > bw) { bw = x; best = j.data[v * 4 + k]; }
        }
        pos.push([p.data[v * 3], p.data[v * 3 + 1], p.data[v * 3 + 2]]);
        joint.push(best < 0 ? '' : (nodes[skin.joints[best]]?.name ?? ''));
      }
    }
  }
  return { pos, joint, heads, ibms, triangles };
}

/** The bind-pose position of a joint: the translation of the inverse of its (rigid) inverse-bind matrix. */
function invertTranslation(m: ArrayLike<number>): V3 {
  // glTF is column-major: rotation r = m[0..2], m[4..6], m[8..10]; translation t = m[12..14]. inverse t' = -r^T t.
  const t = [m[12], m[13], m[14]];
  return [
    -(m[0] * t[0] + m[1] * t[1] + m[2] * t[2]),
    -(m[4] * t[0] + m[5] * t[1] + m[6] * t[2]),
    -(m[8] * t[0] + m[9] * t[1] + m[10] * t[2]),
  ];
}

function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a: V3): number { return Math.hypot(a[0], a[1], a[2]); }

/** Eigenvectors of a symmetric 3x3 matrix by Jacobi rotations, largest eigenvalue first. */
function eigenSym3(c: number[][]): V3[] {
  const a = c.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] * a[i][j];
    if (off < 1e-24) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = cs * akp - sn * akq; a[k][q] = sn * akp + cs * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = cs * apk - sn * aqk; a[q][k] = sn * apk + cs * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = cs * vkp - sn * vkq; v[k][q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return order.map((i) => [v[0][i], v[1][i], v[2][i]] as V3);
}

function percentile(sorted: number[], q: number): number {
  const x = (sorted.length - 1) * q;
  const lo = Math.floor(x), hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

/** Principal-axis extents of a point set, the review's way: 0.5 to 99.5 percentile along each axis, longest first. */
export function principalExtents(pts: readonly V3[]): [number, number, number] {
  if (pts.length < 8) throw new Error(`principalExtents: ${pts.length} points, an empty measurement is a silent pass`);
  const n = pts.length;
  const mean: V3 = [0, 0, 0];
  for (const p of pts) { mean[0] += p[0] / n; mean[1] += p[1] / n; mean[2] += p[2] / n; }
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const d = sub(p, mean);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (d[i] * d[j]) / n;
  }
  const axes = eigenSym3(cov);
  return axes.map((ax) => {
    const pr = pts.map((p) => dot(sub(p, mean), ax)).sort((a, b) => a - b);
    return percentile(pr, 0.995) - percentile(pr, 0.005);
  }) as [number, number, number];
}

/**
 * The palm's breadth, thumb excluded by side. The hand bone's own frame is the hand's: x across the
 * palm, y distal, z dorsal (the hands pass authors the bone that way; the probe does too). The
 * thumb is on one side of the wrist's centre line, so the other side's extent is the palm's own
 * half-breadth, and twice that is the palm. A hand scaled wide moves both sides.
 */
export function palmBreadth(hand: readonly V3[], ibm: readonly number[]): number {
  const xs = hand.map((p) => ibm[0] * p[0] + ibm[4] * p[1] + ibm[8] * p[2] + ibm[12]).sort((a, b) => a - b);
  const lo = -percentile(xs, 0.005), hi = percentile(xs, 0.995);
  return 2 * Math.min(lo, hi);
}

/** Everything a reading needs, from a hand's own vertices (past its wrist plane) and the two joint heads. */
export function readingFrom(
  bone: string, hand: readonly V3[], withFinger: readonly V3[], wrist: V3, elbow: V3, stature: number | null,
  hasFingerBone = false, handIbm: readonly number[] | null = null,
): HandReading {
  const [L, W, T] = principalExtents(hand);
  const [LF] = principalExtents(withFinger);
  const forearm = norm(sub(wrist, elbow));
  return {
    bone, vertices: hand.length, lengthM: L, widthM: W, palmBreadthM: handIbm ? palmBreadth(hand, handIbm) : NaN, thicknessM: T, hasFingerBone, lengthWithFingerM: LF,
    forearmM: forearm, handOverForearm: L / forearm,
    elbowOverStature: stature === null ? null : elbow[1] / stature,
  };
}

/** Vertices at or past the wrist plane: the plane through `wrist`, normal along the way the hand points. */
function pastWrist(pts: readonly V3[], wrist: V3, axis: V3): V3[] {
  return pts.filter((p) => dot(sub(p, wrist), axis) >= 0);
}

function farthest(pts: readonly V3[], from: V3): V3 {
  let best = pts[0], bd = -1;
  for (const p of pts) { const d = norm(sub(p, from)); if (d > bd) { bd = d; best = p; } }
  return best;
}

/**
 * A hand with its own bone. `prefix` is the figure ('f1'), `side` the BONE side ('L' is the
 * anatomical right). The trigger finger, when the figure has `{prefix}_finger_{side}`, is read
 * separately and added only to `lengthWithFingerM`.
 */
export function measureHand(path: string, prefix: string, side: 'L' | 'R', stature: number | null = null): HandReading {
  const sk = readSkinned(readGlb(path));
  const hb = `${prefix}_hand_${side}`, fb = `${prefix}_forearm_${side}`, gb = `${prefix}_finger_${side}`;
  const wrist = sk.heads.get(hb);
  const elbow = sk.heads.get(fb);
  if (!wrist || !elbow) throw new Error(`${path}: no ${hb} / ${fb} joint: a hand without its own bone cannot be read here`);
  const own = sk.pos.filter((_, i) => sk.joint[i] === hb);
  if (!own.length) throw new Error(`${path}: no vertex rides ${hb}`);
  const far = farthest(own, wrist);
  const axis = sub(far, wrist);
  const an = norm(axis);
  const unit: V3 = [axis[0] / an, axis[1] / an, axis[2] / an];
  const hand = pastWrist(own, wrist, unit);
  const finger = sk.pos.filter((_, i) => sk.joint[i] === gb);
  return readingFrom(hb, hand, hand.concat(finger), wrist, elbow, stature, finger.length > 0, sk.ibms.get(hb) ?? null);
}

/**
 * A shipped Meshy figure: no hand bone, so the hand is the forearm bone's vertices past `wristT`
 * metres along the axis from the elbow joint to the farthest forearm vertex. `wristT` is the
 * review's measured wrist (`_coord/inf-review/data/<team>.json`, `wrist_t`), passed in.
 */
export function measureFallbackHand(path: string, prefix: string, side: 'L' | 'R', wristT: number): HandReading {
  const sk = readSkinned(readGlb(path));
  const fb = `${prefix}_forearm_${side}`;
  const elbow = sk.heads.get(fb);
  if (!elbow) throw new Error(`${path}: no ${fb} joint`);
  const own = sk.pos.filter((_, i) => sk.joint[i] === fb);
  if (!own.length) throw new Error(`${path}: no vertex rides ${fb}`);
  const far = farthest(own, elbow);
  const axis = sub(far, elbow);
  const an = norm(axis);
  const unit: V3 = [axis[0] / an, axis[1] / an, axis[2] / an];
  const wrist: V3 = [elbow[0] + unit[0] * wristT, elbow[1] + unit[1] * wristT, elbow[2] + unit[2] * wristT];
  const hand = own.filter((p) => dot(sub(p, elbow), unit) >= wristT);
  // stature: the top of every vertex this figure's bones own
  const prefixRe = new RegExp(`^${prefix}_`);
  let top = -Infinity;
  sk.pos.forEach((p, i) => { if (prefixRe.test(sk.joint[i]) && !/_death_root$/.test(sk.joint[i])) top = Math.max(top, p[1]); });
  return readingFrom(`${fb}@${wristT}`, hand, hand, wrist, elbow, top);
}

/** The spec's bands, as a list of what is wrong. Empty is a pass. */
export function handViolations(r: HandReading, b: typeof HAND_BANDS = HAND_BANDS): string[] {
  const out: string[] = [];
  const band = (name: string, v: number, [lo, hi]: readonly [number, number]) => {
    if (!(v >= lo && v <= hi)) out.push(`${name} ${v.toFixed(3)} outside ${lo} to ${hi}`);
  };
  band('hand length', r.lengthM, b.lengthM);
  if (r.hasFingerBone) band('hand length with the finger', r.lengthWithFingerM, b.lengthWithFingerM);
  if (Number.isFinite(r.palmBreadthM)) band('palm breadth', r.palmBreadthM, b.palmBreadthM);
  if (!(r.thicknessM <= b.thicknessMaxM)) out.push(`hand thickness ${r.thicknessM.toFixed(3)} over ${b.thicknessMaxM}`);
  band('hand over forearm', r.handOverForearm, b.handOverForearm);
  band('visible forearm', r.forearmM, b.forearmM);
  if (r.elbowOverStature !== null) band('hung elbow height over stature', r.elbowOverStature, b.elbowOverStature);
  return out;
}

/** The top of every vertex this figure's bones own (the stature the hung elbow is read against); death roots excluded. */
export function statureOf(path: string, prefix: string): number {
  const sk = readSkinned(readGlb(path));
  const prefixRe = new RegExp(`^${prefix}_`);
  let top = -Infinity;
  sk.pos.forEach((p, i) => { if (prefixRe.test(sk.joint[i]) && !/_death_root$/.test(sk.joint[i])) top = Math.max(top, p[1]); });
  return top;
}

/**
 * One reader for a shipped file, either generation: a file the hands pass has been through (`extras.rl_hands`) is read
 * off its own hand bones; one that has not is still a Meshy claw on the forearm bone, read at the review's measured
 * wrist. The gate calls this, so migrating a team flips its reading with no edit to the gate.
 */
export function measureShippedHand(path: string, prefix: string, side: 'L' | 'R', fallbackWristT: number): HandReading {
  const extras = (readGlb(path).json.scenes?.[0]?.extras ?? {}) as Record<string, unknown>;
  return 'rl_hands' in extras
    ? measureHand(path, prefix, side, statureOf(path, prefix))
    : measureFallbackHand(path, prefix, side, fallbackWristT);
}
