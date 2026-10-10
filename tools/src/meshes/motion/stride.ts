/**
 * Stride warping (motion checkpoint finding #3, approved 5 Oct).
 *
 * The finding: every walker's legs ran 1.8-2.9x too fast for its stride,
 * so a planted foot slid BACKWARD at 0.8-1.95x the body's speed, at 3.2-5.0
 * steps a second (charge_squad 7.9). The cause was the declaration, not the
 * renderer: `pnpm gait:meshes` declared one boot's peak-to-peak travel as
 * the ground covered per cycle. A planted foot sweeps back only while it is
 * on the ground -- a fraction of the cycle -- so the real ground per cycle
 * is that travel divided by the stance fraction, and the rate match played
 * the legs 1/stance too fast.
 *
 * The fix is in two halves. `pnpm gait:meshes` now declares the ground a
 * clip's legs really cover: the PLANTED foot's backward speed times the
 * cycle (`plantedSpeed`). And this pass re-times each locomotion clip so that
 * at the unit's own speed the rate match lands on a realistic cadence
 * (`targetCadence`): the legs' swing is scaled about its mean pose until the
 * planted foot sweeps at `v / timeScale`. A shorter stride at a human
 * cadence, instead of a long stride played fast.
 *
 * The knee is clamped while it is here (finding #11: the soldier's capture
 * folds it to 147-159 deg, past a runner's ~130), and the root height is
 * re-solved per frame so each figure's lowest sole keeps exactly the height
 * profile the clip had -- its flight phase and its contacts stay its own.
 */
import type { Animation, Document, Node } from '@gltf-transform/core';
import { writeTrack } from './edit';
import { qangle, qconj, qmul, qnorm, qslerp, QI, type Q, type V3, type Xf } from './math';
import { carry, clipRange, restVertices, Rig, tracksOf, type Pose, type Track } from './rig';
import { gaitShape, replantFigure } from './replant';
import { MESH_METRES_PER_TILE, targetCadence, type MotionTeam } from './teams';

export const KNEE_MAX_DEG = 130;
/** A foot is planted while its sole is within this of its own lowest. */
export const CONTACT_M = 0.015;
/** Planted weight fades from 1 on the ground to 0 this far above it. */
export const PLANTED_FADE_M = 0.012;
export const STRIDE_SAMPLES = 120;
export const WARP_MIN = 0.3;
export const WARP_MAX = 1.6;
export const WARP_TOLERANCE = 0.03;

export interface Foot {
  readonly shin: Node;
  readonly verts: { joint: Node; p: V3 }[];
}

/** Every walking figure in a clip: a prefix whose thigh the clip turns. */
export function walkers(rig: Rig, tracks: Map<string, Track>): string[] {
  // A captured biped (the civilians) is one figure, prefix ''.
  if (rig.has('LeftUpLeg') && rig.has('RightUpLeg')) return [''];
  const out: string[] = [];
  for (const n of rig.nodes) {
    const m = /^(.*)_thigh_L$/.exec(n.getName());
    if (!m) continue;
    const tr = tracks.get(`${n.getName()}.rotation`);
    if (!tr || tr.times.length < 3) continue;
    let moves = false;
    for (let i = 4; i < tr.values.length && !moves; i++) if (Math.abs(tr.values[i] - tr.values[i % 4]) > 1e-3) moves = true;
    if (moves) out.push(m[1]);
  }
  return out;
}

export function feetOf(rig: Rig, prefix: string): Foot[] {
  const verts = restVertices(rig);
  if (prefix === '' && rig.has('LeftFoot')) {
    return (['Left', 'Right'] as const).map((s) => {
      const joints = new Set([`${s}Foot`, `${s}ToeBase`].filter((n) => rig.has(n)).map((n) => rig.node(n)));
      return { shin: rig.node(`${s}Leg`), verts: verts.filter((v) => v.role === 'boot' && joints.has(v.joint)).map((v) => ({ joint: v.joint, p: v.p })) };
    });
  }
  return (['L', 'R'] as const).map((s) => {
    const shin = rig.node(`${prefix}_shin_${s}`);
    const footName = `${prefix}_foot_${s}`;
    const foot = rig.has(footName) ? rig.node(footName) : null;
    return {
      shin,
      verts: verts.filter((v) => v.role === 'boot' && (v.joint === shin || v.joint === foot)).map((v) => ({ joint: v.joint, p: v.p })),
    };
  });
}

function sole(rig: Rig, pose: Pose, foot: Foot): { y: number; x: number } {
  const cache = new Map<Node, Xf>();
  const pts = foot.verts.map((v) => carry(rig, (n) => rig.worldOf(n, pose, cache), v.joint, v.p));
  pts.sort((a, b) => a[1] - b[1]);
  const low = pts.slice(0, Math.max(3, Math.floor(pts.length * 0.1)));
  return { y: pts[0][1], x: low.reduce((a, p) => a + p[0], 0) / low.length };
}

/**
 * The ground speed, metres per CLIP second, that a figure's planted feet
 * describe: the median backward speed of a sole while it is within
 * CONTACT_M of its own lowest, both feet pooled. NaN with no contact.
 */
export function plantedSpeed(rig: Rig, tracks: Map<string, Track>, feet: Foot[], samples = STRIDE_SAMPLES): number {
  const [t0, t1] = clipRange(tracks);
  const dt = (t1 - t0) / samples;
  // Every boot vertex at every sample: its own forward velocity, weighted by
  // how near the ground it is (1 at the ground -- the clip's own lowest sole
  // -- falling to 0 at PLANTED_FADE_M above it). MATERIAL points, not the
  // lowest point: a rigid boot rocks heel to toe through a stance, and the
  // lowest point travels forward across the sole while no material slides
  // (a rolling contact). Weighted, not thresholded, so it moves smoothly
  // with a warp the pass bisects on.
  const pts: V3[][] = [];
  for (let s = 0; s <= samples; s++) {
    const pose = rig.sample(tracks, t0 + s * dt);
    const cache = new Map<Node, Xf>();
    pts.push(feet.flatMap((f) => f.verts.map((v) => carry(rig, (n) => rig.worldOf(n, pose, cache), v.joint, v.p))));
  }
  let ground = Infinity;
  for (const frame of pts) for (const p of frame) ground = Math.min(ground, p[1]);
  let num = 0;
  let den = 0;
  for (let s = 0; s < samples; s++) {
    const a = pts[s];
    const b = pts[s + 1];
    for (let i = 0; i < a.length; i++) {
      const h = (a[i][1] + b[i][1]) / 2 - ground;
      const w = Math.max(0, 1 - h / PLANTED_FADE_M) ** 2;
      if (w <= 0) continue;
      num += w * (-(b[i][0] - a[i][0]) / dt);
      den += w;
    }
  }
  return den > 0 ? num / den : NaN;
}

function meanQ(qs: Q[]): Q {
  let acc: Q = [0, 0, 0, 0];
  for (const q of qs) {
    const s = acc[0] * q[0] + acc[1] * q[1] + acc[2] * q[2] + acc[3] * q[3] < 0 ? -1 : 1;
    acc = [acc[0] + s * q[0], acc[1] + s * q[1], acc[2] + s * q[2], acc[3] + s * q[3]];
  }
  return qnorm(acc);
}

interface Source {
  readonly times: number[];
  readonly rot: Map<Node, Q[]>;
  readonly rootT: V3[];
  readonly soles: number[];
}

/** Rewrite one figure's leg and root tracks in `anim` with warp `k`. */
function warp(doc: Document, rig: Rig, anim: Animation, prefix: string, feet: Foot[], src: Source, k: number): void {
  const legs = ['thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'hip_L', 'hip_R']
    .map((b) => `${prefix}_${b}`)
    .filter((n) => rig.has(n))
    .map((n) => rig.node(n));
  const root = rig.node(`${prefix}_root`);
  for (const n of legs) {
    const qs = src.rot.get(n)!;
    const mean = meanQ(qs);
    let out = qs.map((q) => qnorm(qmul(mean, qslerp(QI, qmul(qconj(mean), q), k))));
    if (n.getName().includes('_shin_')) {
      const rest = rig.rest.get(n)!.r;
      const max = (KNEE_MAX_DEG * Math.PI) / 180;
      out = out.map((q) => {
        const rel = qmul(qconj(rest), q);
        const a = qangle(rel);
        return a > max ? qnorm(qmul(rest, qslerp(QI, rel, max / a))) : q;
      });
    }
    writeTrack(doc, anim, n, 'rotation', src.times, out.flatMap((q) => [...q]));
  }
  // Root height: keep each frame's lowest sole where the clip had it.
  const tracks = tracksOf(anim);
  const rootT = src.times.map((t, i) => {
    const pose = rig.sample(tracks, t);
    const now = Math.min(...feet.map((f) => sole(rig, pose, f).y));
    const r = src.rootT[i];
    return [r[0], r[1] + (src.soles[i] - now), r[2]] as V3;
  });
  writeTrack(doc, anim, root, 'translation', src.times, rootT.flatMap((r) => [...r]));
}

export function applyStride(doc: Document, id: string, spec: MotionTeam): string[] {
  const lines: string[] = [];
  const v = spec.speedTiles * MESH_METRES_PER_TILE;
  const cadence = targetCadence(v);
  for (const anim of doc.getRoot().listAnimations()) {
    if (anim.getName() !== 'move' && anim.getName() !== 'moveFire') continue;
    const rig = new Rig(doc);
    const tracks0 = tracksOf(anim);
    const [t0, t1] = clipRange(tracks0);
    const cycle = t1 - t0;
    // Steps per cycle: two, which `countTracePeaks` in mesh_gait.ts checks.
    const ts = (cadence * cycle) / 2;
    const want = v / ts;
    for (const prefix of walkers(rig, tracks0)) {
      const feet = feetOf(rig, prefix);
      if (feet.some((f) => f.verts.length < 8)) {
        lines.push(`stride ${prefix} ${anim.getName()}: no boots, left alone`);
        continue;
      }
      if ((spec.strideMode ?? 'replant') === 'replant') {
        const before = plantedSpeed(rig, tracks0, feet);
        const r = replantFigure(doc, anim, prefix, want, gaitShape(v));
        const after = plantedSpeed(new Rig(doc), tracksOf(anim), feetOf(new Rig(doc), prefix));
        lines.push(
          `replant ${prefix} ${anim.getName()}: planted ${before.toFixed(2)} -> ${after.toFixed(2)} m/s (want ${want.toFixed(2)}), ` +
            `strikes ${r.strikes.map((x) => x.toFixed(2)).join('/')}, worst reach miss ${r.worstReach.toFixed(3)} m, hips dip up to ${r.worstDrop.toFixed(3)} m, stance ${r.stance.toFixed(2)}; ` +
            `${(2 * ts / cycle).toFixed(2)} steps/s at ${v.toFixed(2)} m/s`
        );
        if (Math.abs(after / want - 1) > 0.1) throw new Error(`${id}: ${prefix} ${anim.getName()} replant reads ${after.toFixed(3)} vs ${want.toFixed(3)}`);
        continue;
      }
      const thighT = tracks0.get(`${prefix}_thigh_L.rotation`)!;
      const times = Array.from(thighT.times);
      const legs = ['thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'hip_L', 'hip_R'].map((b) => `${prefix}_${b}`).filter((n) => rig.has(n));
      const rot = new Map<Node, Q[]>();
      const rootT: V3[] = [];
      const soles: number[] = [];
      for (const t of times) {
        const pose = rig.sample(tracks0, t);
        for (const n of legs) {
          const node = rig.node(n);
          if (!rot.has(node)) rot.set(node, []);
          rot.get(node)!.push(pose.get(node)!.r);
        }
        rootT.push(pose.get(rig.node(`${prefix}_root`))!.t);
        soles.push(Math.min(...feet.map((f) => sole(rig, pose, f).y)));
      }
      const src: Source = { times, rot, rootT, soles };
      const u0 = plantedSpeed(rig, tracks0, feet);
      if (!Number.isFinite(u0) || u0 <= 0) {
        lines.push(`stride ${prefix} ${anim.getName()}: no planted foot (u ${u0.toFixed(3)}), left alone`);
        continue;
      }
      // u(k) rises with k (a wider swing sweeps faster); bisect on it.
      const at = (k: number): number => {
        warp(doc, rig, anim, prefix, feet, src, k);
        return plantedSpeed(rig, tracksOf(anim), feet);
      };
      let lo = WARP_MIN;
      let hi = WARP_MAX;
      let k = Math.min(WARP_MAX, Math.max(WARP_MIN, want / u0));
      let u = at(k);
      for (let it = 0; it < 14 && Math.abs(u / want - 1) >= WARP_TOLERANCE; it++) {
        if (u < want) lo = k;
        else hi = k;
        k = (lo + hi) / 2;
        u = at(k);
      }
      lines.push(
        `stride ${prefix} ${anim.getName()}: planted ${u0.toFixed(2)} -> ${u.toFixed(2)} m/s (want ${want.toFixed(2)}), ` +
          `warp x${k.toFixed(3)}; at ${v.toFixed(2)} m/s: ${(2 * (v / u0) / cycle).toFixed(2)} -> ${(2 * (v / u) / cycle).toFixed(2)} steps/s ` +
          `(target ${cadence.toFixed(2)})`
      );
      if (Math.abs(u / want - 1) > 0.1) throw new Error(`${id}: ${prefix} ${anim.getName()} warp did not converge (${u.toFixed(3)} vs ${want.toFixed(3)})`);
    }
  }
  return lines;
}
