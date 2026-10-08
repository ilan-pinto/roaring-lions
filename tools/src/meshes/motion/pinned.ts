/**
 * The pinned huddle (pass C2/C4, approved 7 Oct, P1): one looping clip,
 * `pinned`, that a pinned unit -- and a broken one standing still -- plays
 * instead of `down`.
 *
 * Why it exists: rig.py's `build_death_clip` builds `down` and `wreck`
 * "otherwise IDENTICAL", and the renderer played `down` for pinned. On 17 of
 * the 20 infantry GLBs that carry a `down`, a pinned team lay in exactly the
 * pose it would lie in dead (docs/polish/combat-states.md §2.1).
 *
 * The pose: every visible figure down on a knee -- the kneel's own pose,
 * built from the team's `kneel` clip where it has one and by the kneel's own
 * IK (`kneelBody`) where a standing figure has none -- then folded forward
 * at the spine, the neck and the head (`PINNED_FOLD_DEG`), so the weapon,
 * which rides the spine, points at the ground in front of him. Low, compact,
 * and nothing aimed at the enemy: the reverse of kneel-to-fire, and nothing
 * like a body lying flat. A figure already low at its weapon (a crew-served
 * team's crew) folds where it kneels. A hanging hand is swung clear of the
 * ground, and a figure the fold puts under the ground is raised out of it.
 *
 * It loops over its base clip's own duration and keys, so the breath of
 * `idle`/`kneel` carries into the huddle, and it keys every node the base
 * keys (rig.py's rule: an untouched bone keeps whatever the last clip left
 * in it).
 *
 * Idempotent, unlike the rest of the motion pass: it reads only clips it
 * does not write, so a re-run replaces its own `pinned` with the same bytes
 * (`--step=pinned` runs it alone on a file already through the pass).
 */
import type { Document, Node } from '@gltf-transform/core';
import { qaxis, qrot, deg, type V3 } from './math';
import { rotateWorld } from './hold';
import { KNEEL_FPS, KNEEL_GROUND_CLEAR, kneelBody, kneelerOf, liftArm, lowestY, writeClip, type Pt } from './kneel';
import { clipRange, restVertices, Rig, tracksOf, type Pose } from './rig';

export const PINNED_VERSION = 1;
/** The fold, degrees, about each figure's own lateral axis. The approved
 *  mock (combat-states.md §5, sheet 02) bent Blender bones by 50/25/30 in
 *  their LOCAL axes; on these world-axis turns that sum of 105 deg put the
 *  face past straight down, looking back between the knees (the facing
 *  gate read 164-180 deg). 45/15/15 is the same silhouette -- folded, the
 *  weapon at the ground -- with the face down and still forward. */
export const PINNED_FOLD_DEG = { spine: 40, neck: 10, head: 0 } as const;
/** A figure whose hip stands above this fraction of its rest height in the
 *  base pose is standing, and is put on a knee before it folds. */
export const PINNED_STANDING_HIP_FRAC = 0.75;
/** The least a figure folds when the full fold would put its weapon in the
 *  ground: below this it is no longer a huddle, and it is raised instead. */
export const PINNED_MIN_FOLD = 0.4;
/** A kneel that puts any part of a figure this far under the ground is not
 *  taken (metres). */
export const PINNED_KNEEL_SINK_MAX = 0.02;

/** Every figure prefix in the file: a `${p}_root` with a spine on it. */
export function figurePrefixes(rig: Rig): string[] {
  return rig.nodes
    .map((n) => /^(.*)_root$/.exec(n.getName())?.[1])
    .filter((p): p is string => p !== undefined && !p.endsWith('_death') && rig.has(`${p}_spine`));
}

/** A file that carries the corpse pair (`down` and `wreck`) gets a huddle:
 *  that pair is what the renderer used to fall back on for pinned. A file
 *  with no `wreck` (the civilians) keeps its `down`, which is a living crawl
 *  there and never a corpse. */
export function needsPinned(doc: Document): boolean {
  const names = new Set(doc.getRoot().listAnimations().map((a) => a.getName()));
  return names.has('down') && names.has('wreck');
}

export function applyPinned(doc: Document, id: string): string[] {
  const root = doc.getRoot();
  // A re-run replaces its own clip, and the old clip's key data with it:
  // disposing the animation alone leaves its accessors in the file.
  for (const a of root.listAnimations()) {
    if (a.getName() !== 'pinned') continue;
    const data = a.listSamplers().flatMap((s) => [s.getInput(), s.getOutput()]).filter((x): x is NonNullable<typeof x> => x !== null);
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
    for (const acc of new Set(data)) if (acc.listParents().every((p) => p === root)) acc.dispose();
  }
  const rig = new Rig(doc);
  const base = root.listAnimations().find((a) => a.getName() === 'kneel') ?? root.listAnimations().find((a) => a.getName() === 'idle');
  if (!base) throw new Error(`${id}: no kneel or idle to huddle from`);
  const tracks = tracksOf(base);
  const [t0, t1] = clipRange(tracks);
  const nodes = [...new Set([...tracks.values()].map((t) => t.node))];
  const keyed = new Set(nodes);
  const verts = restVertices(rig);
  const first = rig.sample(tracks, t0);
  const figures = figurePrefixes(rig).filter((p) => rig.worldOf(rig.node(`${p}_root`), first).s > 1e-6);
  // A team already flat by design (`sniper_team`, drawn prone on its own
  // death roots in idle) has no standing body to fold: its huddle is its
  // own living rest pose, which is not its corpse (the gate reads that).
  for (const p of figures) {
    for (const part of ['root', 'spine', 'neck', 'head']) {
      if (rig.has(`${p}_${part}`) && !keyed.has(rig.node(`${p}_${part}`))) {
        throw new Error(`${id}: ${base.getName()} does not key ${p}_${part}`);
      }
    }
  }
  const legged = (p: string): boolean =>
    ['thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'foot_L', 'foot_R', 'upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R'].every((b) =>
      rig.has(`${p}_${b}`)
    );
  const kneelers = new Map(figures.filter(legged).map((p) => [p, kneelerOf(rig, p, verts)]));
  const bodyOf = (p: string): Pt[] => verts.filter((v) => v.joint.getName().startsWith(`${p}_`)).map((v) => ({ joint: v.joint, p: v.p }));
  const bodies = new Map(figures.map((p) => [p, bodyOf(p)]));
  const armsOf = (p: string): { upper: Node; pts: Pt[] }[] =>
    (['L', 'R'] as const)
      .filter((s) => rig.has(`${p}_upperarm_${s}`) && rig.has(`${p}_forearm_${s}`))
      .map((s) => {
        const upper = rig.node(`${p}_upperarm_${s}`);
        const fore = rig.node(`${p}_forearm_${s}`);
        return { upper, pts: verts.filter((v) => v.joint === upper || v.joint === fore).map((v) => ({ joint: v.joint, p: v.p })) };
      });
  // Who is standing in the base pose, decided once from its first frame so
  // the loop never flips a man between kneeling and not.
  const standing = new Set(
    [...kneelers.entries()]
      .filter(([, k]) => rig.worldOf(k.back.thigh, first).t[1] > k.hipRestY * PINNED_STANDING_HIP_FRAC)
      .map(([p]) => p)
  );
  // ...unless kneeling would drive something he wears into the ground:
  // breach_team's point man carries a ballistic shield on his spine that
  // hangs to 30 mm off the ground standing, and kneels it 0.39 m under.
  // He stays on his feet and folds behind it.
  const keptUp: string[] = [];
  for (const f of [...standing]) {
    const p = rig.sample(tracks, t0);
    kneelBody(rig, p, kneelers.get(f)!);
    if (lowestY(rig, p, bodies.get(f)!) < KNEEL_GROUND_CLEAR - PINNED_KNEEL_SINK_MAX) {
      standing.delete(f);
      keptUp.push(f);
    }
  }

  const n = Math.max(2, Math.round((t1 - t0) * KNEEL_FPS));
  const times = Array.from({ length: n + 1 }, (_, i) => (i / n) * (t1 - t0));
  /** One figure into the huddle, folded by `amount` of the full fold. */
  const huddle = (p: Pose, f: string, amount: number): void => {
    const k = kneelers.get(f);
    if (k && standing.has(f)) kneelBody(rig, p, k);
    // The figure's own lateral axis: its root's +Z (the motion pass's team
    // frame is +X forward, +Z the anatomical right), so a crewman turned to
    // his weapon folds toward it. A positive turn about it is FORWARD here
    // (measured: the negative read 50 deg backward, the weapon to the sky).
    const lateral: V3 = qrot(rig.worldOf(rig.node(`${f}_root`), p).r, [0, 0, 1]);
    for (const part of ['spine', 'neck', 'head'] as const) {
      if (!rig.has(`${f}_${part}`)) continue;
      rotateWorld(rig, p, rig.node(`${f}_${part}`), qaxis(lateral, deg(PINNED_FOLD_DEG[part]) * amount));
    }
    for (const arm of armsOf(f)) {
      try {
        liftArm(rig, p, arm);
      } catch {
        // An arm that cannot clear by swinging is clear once the figure is
        // raised, below.
      }
    }
  };
  // How far each figure folds: the full fold, or as much of it as keeps a
  // long weapon (the Spike, a mortar's baseplate man) off the ground -- by
  // bisection on the first frame, then held for the whole loop. Folding
  // less beats raising the man: a raised kneeler floats on his knees.
  const amountOf = new Map<string, number>();
  const floors = new Map<string, number>();
  for (const f of figures) {
    // Over every frame of the loop: the base clip's breath dips a little,
    // and a fold that clears frame 0 can still touch down on frame 12.
    const lowAt = (a: number): number => {
      let y = Infinity;
      for (const t of times) {
        const p = rig.sample(tracks, t0 + t);
        huddle(p, f, a);
        y = Math.min(y, lowestY(rig, p, bodies.get(f)!));
      }
      return y;
    };
    // Against the figure's own floor: a crewman seated at his weapon already
    // touches the ground somewhere, and only what the fold ADDS is refused.
    const floor = Math.min(KNEEL_GROUND_CLEAR, lowAt(0)) - 1e-4;
    floors.set(f, floor + 1e-4);
    let a = 1;
    if (lowAt(1) < floor) {
      let lo = PINNED_MIN_FOLD;
      let hi = 1;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (lowAt(mid) >= floor) lo = mid;
        else hi = mid;
      }
      a = lo;
    }
    amountOf.set(f, a);
  }

  let raised = 0;
  let lo = figures.length === 0 ? 0 : Infinity;
  const pose = (t: number): Pose => {
    const p = rig.sample(tracks, t);
    for (const f of figures) {
      huddle(p, f, amountOf.get(f)!);
      const y = lowestY(rig, p, bodies.get(f)!);
      const floor = floors.get(f)!;
      if (y < floor - 1e-4) {
        const r = rig.node(`${f}_root`);
        const x = p.get(r)!;
        p.set(r, { ...x, t: [x.t[0], x.t[1] + (floor - y), x.t[2]] });
        raised = Math.max(raised, floor - y);
      }
      lo = Math.min(lo, lowestY(rig, p, bodies.get(f)!));
    }
    return p;
  };
  const poses = times.map((t) => pose(t0 + t));
  writeClip(doc, 'pinned', nodes, times, poses);
  const scene = root.listScenes()[0];
  scene.setExtras({ ...((scene.getExtras() ?? {}) as Record<string, unknown>), rl_pinned: { version: PINNED_VERSION } });
  return [
    `pinned: from ${base.getName()}, ${figures.join(', ')}` +
      (standing.size > 0 ? ` (knelt: ${[...standing].join(', ')})` : '') +
      (keptUp.length > 0 ? ` (kept on his feet, his kneel sinks: ${keptUp.join(', ')})` : '') +
      (figures.length === 0 ? ' (no standing figure: the base pose as it is)' : '') +
      `; fold ${figures.map((f) => `${f} ${(amountOf.get(f)! * 100).toFixed(0)}% (floor ${floors.get(f)!.toFixed(3)})`).join(', ')}` +
      `; ${n} frames over ${(t1 - t0).toFixed(2)} s, lowest vertex ${lo.toFixed(4)} m, raised up to ${raised.toFixed(3)} m`,
  ];
}
