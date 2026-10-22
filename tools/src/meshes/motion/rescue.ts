/**
 * The medic team's two rescue clips (GH-707 P2, 22 Oct 2026), built from the
 * team's own `move` and `idle` the way `work.ts` and `pinned.ts` are, because
 * both need what the earlier steps made: the replanted, grounded legs of
 * `move`, and the hold's `{prefix}_weapon` bones.
 *
 *   carry   Two bearers carry a casualty on the litter. The file ships the
 *           litter and the casualty on it as rigid parts of a bone
 *           (`med_a_litter`) that every clip rig.py wrote scales to 0; here it
 *           is scale 1. The men fall in at `RescueSpec.bearers` (front and
 *           rear of a 2.2 m litter, the lead's allowance of +-1.35 m, past the
 *           +-1.2 m rest footprint, for this clip only) and each closes both
 *           hands on a pole grip by two-bone IK, every frame, refusing a hand
 *           more than `MAX_GRIP_GAP_M` off. The legs are `move`'s, re-timed by
 *           1 / `carryMult` so a planted foot moves at the unit's own carrying
 *           speed (`rescue.carry_speed_mult` x `mobility.speed_tiles_s`): a
 *           `carry` is not a locomotion clip (`LOCOMOTION_CLIPS`), so the
 *           renderer will not rate-match it, exactly as `crawl`. The litter
 *           rides the bearers' mean bob.
 *   treat   Both men kneel over a casualty (`kneel.ts`'s unarmed kneel, the
 *           body of it) and work with both hands low and forward, in turn.
 *
 * In both, the carbine is SLUNG: the hold's weapon bone is set to one fixed
 * pose in the spine's frame, muzzle up behind the shoulder, outside the pack
 * and the folded stretcher, so a man whose hands are busy is not holding it.
 * (In every other clip the hold owns the weapon.)
 *
 * Runs once, inside `runMotionPass`, after the kneel clips (it reads `move`, `idle` and
 * the hold's weapon bones).
 */
import type { Document, Node } from '@gltf-transform/core';
import { handPoint, MAX_GRIP_GAP_M, rotateWorld, twoBoneIK, type HoldFigure } from './hold';
import { KNEEL_FPS, KNEEL_UNARMED_LEAN, kneelBody, kneelerOf, lowestY, writeClip } from './kneel';
import { add, deg, norm, qaxis, qbasis, qconj, qmul, type Q, type V3 } from './math';
import { clipRange, denseTimes, restVertices, Rig, tracksOf, type Pose } from './rig';
import type { MotionTeam } from './teams';

export const RESCUE_VERSION = 1;

export interface RescueSpec {
  /** The parentless bone the litter and its casualty ride (scale 0 outside `carry`). */
  readonly litter: string;
  /** Where each bearer stands in `carry`, team frame (x forward, z the figures' right), metres. */
  readonly bearers: readonly { readonly prefix: string; readonly x: number; readonly z: number }[];
  /** The grip centres, relative to the litter's centre: x along it, z across, and the
   *  height of the poles above the ground. Both poles, both ends. */
  readonly grips: { readonly x: number; readonly z: number; readonly y: number };
  /** `rescue.carry_speed_mult` of the unit JSON (pinned by test). */
  readonly carryMult: number;
  /** Where `treat` puts the hands, forward of the figure's own slot and above the ground. */
  readonly treatHands: { readonly forward: number; readonly across: number; readonly y: number };
}

/** The slung carbine: its butt, from the figure's spine head, in the figure's own axes
 *  (x forward, y up, z right), and its direction. Behind the pack (whose back face is
 *  ~0.43 m behind the spine), the muzzle up beside the folded stretcher's poles. */
export const SLING_BUTT: V3 = [-0.47, -0.2, -0.14];
export const SLING_DIR: V3 = [-0.05, 0.9, 0.43];
/** `treat`: the extra forward lean over the casualty, degrees, on top of the unarmed kneel's. */
export const TREAT_LEAN_EXTRA = 16;
/** `treat`: the hands move this far (metres) about their mark, in turn. */
export const TREAT_STROKE = 0.045;
/** The IK's tolerance in `treat`, where no hand is closing on an object. */
export const TREAT_REACH_SLACK = 0.09;

/** The weapon bone's local pose that puts the carbine in its sling, solved at REST. */
function slingLocal(rig: Rig, h: HoldFigure, weapon: Node): { t: V3; r: Q; s: number } {
  const spine = rig.node(`${h.prefix}_spine`);
  const head = rig.restWorld.get(spine)!.t;
  const butt = add(head, SLING_BUTT);
  const dir = norm(SLING_DIR);
  const r = qmul(qbasis(dir, [0, 1, 0]), qconj(qbasis(h.axis, h.up)));
  return rig.localFor(weapon, { t: butt, r, s: 1 }, new Map(rig.rest));
}

export function applyRescue(doc: Document, id: string, spec: MotionTeam, holds: readonly { hold: HoldFigure; weaponName: string }[]): string[] {
  const rescue = spec.rescue;
  if (!rescue) return [];
  const lines: string[] = [];
  const rig = new Rig(doc);
  const root = doc.getRoot();
  const verts = restVertices(rig);
  const clip = (name: string) => {
    const a = root.listAnimations().find((x) => x.getName() === name);
    if (!a) throw new Error(`${id}: no ${name} to build the rescue clips from`);
    return a;
  };
  const litter = rig.node(rescue.litter);
  for (const b of rescue.bearers) {
    if (!holds.find((h) => h.hold.prefix === b.prefix)) throw new Error(`${id}: bearer ${b.prefix} has no hold (no carbine to sling)`);
  }
  const sling = new Map<string, { t: V3; r: Q; s: number }>();
  for (const h of holds) sling.set(h.hold.prefix, slingLocal(rig, h.hold, rig.node(h.weaponName)));
  const hands = (prefix: string, side: 'L' | 'R'): V3 => handPoint(rig, verts, rig.node(`${prefix}_forearm_${side}`));
  const reset = (pose: Pose, node: Node): void => {
    pose.set(node, { ...pose.get(node)!, t: rig.rest.get(node)!.t, r: rig.rest.get(node)!.r });
  };

  // ---------------------------------------------------------------- carry
  {
    const move = clip('move');
    const tracks = tracksOf(move);
    const [t0, t1] = clipRange(tracks);
    const times = denseTimes(tracks, 30);
    const k = 1 / rescue.carryMult;
    const nodes = [...new Set([...tracks.values()].map((t) => t.node))];
    if (!nodes.includes(litter)) throw new Error(`${id}: move does not key ${rescue.litter}`);
    const litterRest = rig.rest.get(litter)!;
    let worst = 0;
    const poses: Pose[] = times.map((t) => {
      const p = rig.sample(tracks, t);
      const bob: number[] = [];
      for (const b of rescue.bearers) {
        const rootNode = rig.node(`${b.prefix}_root`);
        const rest = rig.rest.get(rootNode)!;
        const cur = p.get(rootNode)!;
        bob.push(cur.t[1] - rest.t[1]);
        p.set(rootNode, { ...cur, t: [b.x + (cur.t[0] - rest.t[0]), cur.t[1], b.z + (cur.t[2] - rest.t[2])] });
      }
      const lift = bob.reduce((a, c) => a + c, 0) / bob.length;
      p.set(litter, { t: [litterRest.t[0], litterRest.t[1] + lift, litterRest.t[2]], r: litterRest.r, s: 1 });
      for (const b of rescue.bearers) {
        const pre = b.prefix;
        for (const n of ['upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R', 'neck', 'head', 'spine']) reset(p, rig.node(`${pre}_${n}`));
        // The hold's chest weapon is gone from the hands: the carbine hangs on the back.
        p.set(rig.node(`${pre}_weapon`), { ...p.get(rig.node(`${pre}_weapon`))!, ...sling.get(pre)! });
        // A man's anatomical right is +z, which rig.py calls `_L`.
        for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
          const target: V3 = [(b.x > 0 ? 1 : -1) * rescue.grips.x, rescue.grips.y + lift, sgn * rescue.grips.z];
          const gap = twoBoneIK(
            rig,
            p,
            rig.node(`${pre}_upperarm_${side}`),
            rig.node(`${pre}_forearm_${side}`),
            hands(pre, side),
            target,
            [-0.2, -1, sgn * 0.5]
          );
          worst = Math.max(worst, gap);
        }
      }
      return p;
    });
    if (worst > MAX_GRIP_GAP_M) throw new Error(`${id} carry: a hand ${worst.toFixed(3)} m off its grip (limit ${MAX_GRIP_GAP_M})`);
    const dur = t1 - t0;
    writeClip(doc, 'carry', nodes, times.map((t) => (t - t0) * k), poses);
    lines.push(
      `carry: from move, bearers ${rescue.bearers.map((b) => `${b.prefix} at x ${b.x}`).join(', ')}; ${times.length} keys, ` +
        `${dur.toFixed(3)} s -> ${(dur * k).toFixed(3)} s (x${k.toFixed(3)}), worst grip gap ${worst.toFixed(3)} m, litter scale 1`
    );
  }

  // ---------------------------------------------------------------- treat
  {
    const idle = clip('idle');
    const tracks = tracksOf(idle);
    const [t0, t1] = clipRange(tracks);
    const nodes = [...new Set([...[...tracks.values()].map((t) => t.node), ...holds.map((h) => rig.node(h.weaponName))])];
    const kneelers = rescue.bearers.map((b) => kneelerOf(rig, b.prefix, verts));
    const n = Math.max(2, Math.round((t1 - t0) * KNEEL_FPS));
    const times = Array.from({ length: n + 1 }, (_, i) => (i / n) * (t1 - t0));
    let worst = 0;
    let lo = Infinity;
    const poses: Pose[] = times.map((t, i) => {
      const p = rig.sample(tracks, t0 + t);
      const u = (2 * Math.PI * i) / n;
      for (const k of kneelers) {
        kneelBody(rig, p, k);
        rotateWorld(rig, p, rig.node(`${k.prefix}_spine`), qaxis([0, 0, 1], -deg(KNEEL_UNARMED_LEAN + TREAT_LEAN_EXTRA)));
        const slot = rig.rest.get(rig.node(`${k.prefix}_root`))!.t;
        for (const a of ['upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R']) reset(p, rig.node(`${k.prefix}_${a}`));
        p.set(rig.node(`${k.prefix}_weapon`), { ...p.get(rig.node(`${k.prefix}_weapon`))!, ...sling.get(k.prefix)! });
        for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
          // hands alternate: one presses while the other eases off
          const ph = sgn > 0 ? 0 : Math.PI;
          const target: V3 = [
            slot[0] + rescue.treatHands.forward + TREAT_STROKE * Math.sin(u + ph),
            rescue.treatHands.y + 0.5 * TREAT_STROKE * (1 + Math.cos(u + ph)),
            slot[2] + sgn * rescue.treatHands.across,
          ];
          worst = Math.max(
            worst,
            twoBoneIK(rig, p, rig.node(`${k.prefix}_upperarm_${side}`), rig.node(`${k.prefix}_forearm_${side}`), hands(k.prefix, side), target, [-0.1, -1, sgn * 0.4])
          );
        }
        lo = Math.min(lo, lowestY(rig, p, k.bodyVerts));
      }
      return p;
    });
    if (worst > TREAT_REACH_SLACK) throw new Error(`${id} treat: a hand ${worst.toFixed(3)} m off its mark (slack ${TREAT_REACH_SLACK})`);
    if (lo < 0) throw new Error(`${id} treat: lowest vertex ${lo.toFixed(4)} m, under the ground`);
    writeClip(doc, 'treat', nodes, times, poses);
    lines.push(`treat: unarmed kneel +${TREAT_LEAN_EXTRA} deg lean, hands alternating; ${n} frames over ${(t1 - t0).toFixed(2)} s, worst reach miss ${worst.toFixed(3)} m, lowest vertex ${lo.toFixed(4)} m`);
  }

  const scene = root.listScenes()[0];
  scene.setExtras({ ...((scene.getExtras() ?? {}) as Record<string, unknown>), rl_rescue: { version: RESCUE_VERSION, litter: rescue.litter, bearers: rescue.bearers.map((b) => b.prefix) } });
  return lines;
}
