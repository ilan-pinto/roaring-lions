/**
 * Instruments for the `work` clip, read from a GLB's bytes with `mesh_gait.ts`'s readers (never from the motion pass
 * that wrote it).
 *
 * `measureFistsOnGun`: a figure whose fists are sculpted closed on its weapon (a skinned Meshy body) has, in its bind
 * pose, one fixed relation between each hand bone and its weapon bone; the fist's vertices ride the hand bone and the
 * gun's the weapon bone, so the fist is on the gun in a posed frame exactly when that relation is the bind pose's. The
 * reading is how far each hand has moved (metres) and turned (degrees) off it, the worst over the clip.
 *
 * `measureBoneTilt`: the angle between a bone's own long axis (its node's +Y) and world up.
 *
 * `measureWorldTurns`: how far every node's world rotation differs between two clips.
 *
 * All three sample the clip at WORK_SAMPLE_FPS over its own duration, never at a track's keys: a figure with modelled
 * hands has its constant tracks cut to two keys (`motion/tidy.ts`, `collapseConstantTracks`), and a weapon that never
 * moves on its spine is exactly such a track.
 */
import { nodeWorlds, readClip, readGlb } from './mesh_gait';

export const WORK_SAMPLE_FPS = 30;

/** Sample instants of `clip`, WORK_SAMPLE_FPS apart, first and last included. */
function instants(start: number, end: number): number[] {
  const n = Math.max(2, Math.round((end - start) * WORK_SAMPLE_FPS));
  return Array.from({ length: n + 1 }, (_, i) => start + ((end - start) * i) / n);
}

type M4 = ArrayLike<number>;
const col = (m: M4, c: number): [number, number, number] => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
const dot3 = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: readonly number[]): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** `hand` as `weapon` sees it: the hand's origin and its three axes in the weapon's frame (both unscaled bones). */
function relation(weapon: M4, hand: M4): { t: number[]; axes: number[][] } {
  const w = [unit(col(weapon, 0)), unit(col(weapon, 1)), unit(col(weapon, 2))];
  const d = [hand[12] - weapon[12], hand[13] - weapon[13], hand[14] - weapon[14]];
  return { t: w.map((a) => dot3(a, d)), axes: [0, 1, 2].map((c) => w.map((a) => dot3(a, unit(col(hand, c))))) };
}

export interface FistsOnGun {
  /** The worst any key puts either hand bone off its bind-pose place on the weapon, metres. */
  readonly gapM: number;
  /** ...and the worst it turns it off its bind-pose orientation on the weapon, degrees. */
  readonly turnDeg: number;
  readonly samples: number;
}

export function measureFistsOnGun(path: string, clip: string, prefix: string): FistsOnGun {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const idx = (name: string): number => {
    const i = nodes.findIndex((n) => n.name === name);
    if (i < 0) throw new Error(`${path}: no node ${name}`);
    return i;
  };
  const weapon = idx(`${prefix}_weapon`);
  const hands = [idx(`${prefix}_hand_L`), idx(`${prefix}_hand_R`)];
  const rest = nodeWorlds(glb, new Map(), 0);
  const rest0 = hands.map((h) => relation(rest[weapon], rest[h]));
  const { tracks, start, end } = readClip(glb, clip);
  for (const n of [weapon, ...hands]) if (!tracks.has(`${n}:rotation`)) throw new Error(`${path} ${clip}: ${nodes[n].name} is not keyed`);
  const times = instants(start, end);
  let gapM = 0;
  let turnDeg = 0;
  for (const t of times) {
    const w = nodeWorlds(glb, tracks, t);
    hands.forEach((h, k) => {
      const r = relation(w[weapon], w[h]);
      gapM = Math.max(gapM, Math.hypot(r.t[0] - rest0[k].t[0], r.t[1] - rest0[k].t[1], r.t[2] - rest0[k].t[2]));
      // the turn between the two relations: trace of R_now R_rest^T, from the axes' pairwise dots
      const tr = [0, 1, 2].reduce((s, c) => s + dot3(r.axes[c], rest0[k].axes[c]), 0);
      turnDeg = Math.max(turnDeg, (Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180) / Math.PI);
    });
  }
  return { gapM, turnDeg, samples: times.length };
}

/** Degrees between `node`'s own +Y (a bone's long axis) and world up, at every sample of `clip`. */
export function measureBoneTilt(path: string, clip: string, node: string): number[] {
  const glb = readGlb(path);
  const i = (glb.json.nodes ?? []).findIndex((n) => n.name === node);
  if (i < 0) throw new Error(`${path}: no node ${node}`);
  const { tracks, start, end } = readClip(glb, clip);
  if (!tracks.has(`${i}:rotation`)) throw new Error(`${path} ${clip}: ${node} is not keyed`);
  return instants(start, end).map((t) => (Math.acos(Math.max(-1, Math.min(1, unit(col(nodeWorlds(glb, tracks, t)[i], 1))[1]))) * 180) / Math.PI);
}

/**
 * For every named node of `path`: the largest angle, degrees, between its WORLD rotation in `clipA` and in `clipB`,
 * the two clips sampled at the same fraction of their own durations. A node scaled out of a clip (a hidden root) has no
 * rotation to read there and is skipped at that sample.
 */
export function measureWorldTurns(path: string, clipA: string, clipB: string): Map<string, number> {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const a = readClip(glb, clipA);
  const b = readClip(glb, clipB);
  const ta = instants(a.start, a.end);
  const tb = instants(b.start, b.start + (b.end - b.start));
  const out = new Map<string, number>();
  const n = Math.min(ta.length, tb.length);
  for (let k = 0; k < n; k++) {
    const wa = nodeWorlds(glb, a.tracks, ta[Math.round((k * (ta.length - 1)) / (n - 1))]);
    const wb = nodeWorlds(glb, b.tracks, tb[Math.round((k * (tb.length - 1)) / (n - 1))]);
    nodes.forEach((node, i) => {
      if (!node.name) return;
      const ca = [0, 1, 2].map((c) => col(wa[i], c));
      const cb = [0, 1, 2].map((c) => col(wb[i], c));
      if ([...ca, ...cb].some((v) => Math.hypot(v[0], v[1], v[2]) < 1e-6)) return;
      const tr = [0, 1, 2].reduce((s2, c) => s2 + dot3(unit(ca[c]), unit(cb[c])), 0);
      const d = (Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180) / Math.PI;
      out.set(node.name, Math.max(out.get(node.name) ?? 0, d));
    });
  }
  return out;
}

/** Seconds from the first key of `clip` to its last. */
export function clipDuration(path: string, clip: string): number {
  const { start, end } = readClip(readGlb(path), clip);
  return end - start;
}
