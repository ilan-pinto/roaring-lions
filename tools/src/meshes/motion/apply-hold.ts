/**
 * The hold, applied to a whole file: a weapon bone per shooter, its weapon
 * vertices moved onto it, and every clip re-keyed so the hold owns the
 * torso, both arms and the weapon (`hold.ts`).
 *
 * Which clips the hold owns, and in which state:
 *
 *   idle, move            low ready (a rifle) or the shoulder carry (a tube)
 *   fire, moveFire        aimed
 *   kneel*                built by `kneel.ts`, which calls `holdFrame`
 *   everything else       (deaths, `down`, `work`) the weapon follows the
 *                         forearm it used to ride, so a falling body keeps
 *                         its weapon exactly as it did before this pass
 */
import type { Document, Node } from '@gltf-transform/core';
import { addBone, rebind, writeTrack } from './edit';
import { describeHold, followForearm, MAX_GRIP_GAP_M, solveHold, weaponRest, type HoldFigure } from './hold';
import { keyTimes, restVertices, Rig, tracksOf, type Pose } from './rig';
import type { MotionTeam } from './teams';

export const AIM_CLIPS: Record<string, number> = { idle: 0, move: 0, fire: 1, moveFire: 1 };

/** Bones the hold writes for one figure, in the order they are solved. */
export function heldBones(prefix: string): string[] {
  return ['spine', 'neck', 'head', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R'].map((b) => `${prefix}_${b}`);
}

export interface HoldContext {
  readonly hold: HoldFigure;
  readonly weaponName: string;
}

export function holdFrame(rig: Rig, pose: Pose, ctx: HoldContext, aim: number, aimLean?: number): { gap: number; eye: number } {
  const r = solveHold(rig, pose, ctx.hold, rig.node(ctx.weaponName), { aim, ...(aimLean !== undefined ? { aimLean } : {}) });
  return { gap: Math.max(r.gapShoot, r.gapSupport), eye: r.eyeAboveBore };
}

export function applyHold(doc: Document, id: string, spec: MotionTeam): { line: string; ctx: HoldContext[] }[] {
  let rig = new Rig(doc);
  const verts = restVertices(rig);
  const armed = spec.figures.filter((f) => f.weapon);
  const holds = armed.map((f) => describeHold(rig, verts, f.prefix, f.weapon!));
  // Bones first, then the rig is rebuilt so it knows them.
  const moved: number[] = [];
  for (const h of holds) {
    const bone = addBone(doc, rig, `${h.prefix}_weapon`, rig.node(`${h.prefix}_spine`), weaponRest(h));
    rig = new Rig(doc);
    moved.push(rebind(rig, 'weapon', h.fromJoint, bone));
    if (moved[moved.length - 1] < 30) throw new Error(`${id}: ${h.prefix} rebound ${moved[moved.length - 1]} weapon vertices`);
  }
  rig = new Rig(doc);
  const ctx: HoldContext[] = holds.map((h) => ({ hold: { ...h, fromJoint: rig.node(h.fromJoint.getName()), eyeJoint: rig.node(h.eyeJoint.getName()) }, weaponName: `${h.prefix}_weapon` }));
  const out: { line: string; ctx: HoldContext[] }[] = [];
  for (const anim of doc.getRoot().listAnimations()) {
    const name = anim.getName();
    const tracks = tracksOf(anim);
    for (const c of ctx) {
      const p = c.hold.prefix;
      // A tube is carried in `idle`/`move` as the importer seated it -- on the
      // shoulder at its own pitch, both hands on its grips, already clear of
      // the body (`_seat_launcher`) -- and the hold owns only the AIM. Carried
      // by the hold instead, a 1.4 m MANPAD at 70 deg drove its tail through
      // his back (249 samples inside) and the RPG's arms crossed his chest
      // (344-379 arm vertices inside, against 223/281 before).
      const aim = c.hold.kind !== 'rifle' && AIM_CLIPS[name] === 0 ? undefined : AIM_CLIPS[name];
      const times = keyTimes(tracks, `${p}_spine`);
      const written = aim === undefined ? [c.weaponName] : [...heldBones(p), c.weaponName];
      const nodes: Node[] = written.map((n) => rig.node(n));
      const rot = nodes.map(() => [] as number[]);
      const tr = nodes.map(() => [] as number[]);
      let worstGap = 0;
      let eyeLo = Infinity;
      let eyeHi = -Infinity;
      for (const t of times) {
        const pose = rig.sample(tracks, t);
        if (aim === undefined) followForearm(rig, pose, c.hold, rig.node(c.weaponName));
        else {
          const r = holdFrame(rig, pose, c, aim);
          worstGap = Math.max(worstGap, r.gap);
          if (Number.isFinite(r.eye)) {
            eyeLo = Math.min(eyeLo, r.eye);
            eyeHi = Math.max(eyeHi, r.eye);
          }
        }
        nodes.forEach((n, i) => {
          const x = pose.get(n)!;
          rot[i].push(...x.r);
          tr[i].push(...x.t);
        });
      }
      nodes.forEach((n, i) => {
        writeTrack(doc, anim, n, 'rotation', times, rot[i]);
        // Translation too: the support shoulder protracts (`SUPPORT_PROTRACTION`).
        writeTrack(doc, anim, n, 'translation', times, tr[i]);
        if (n.getName() === c.weaponName) writeTrack(doc, anim, n, 'scale', times, times.flatMap(() => [1, 1, 1]));
      });
      if (worstGap > MAX_GRIP_GAP_M) {
        throw new Error(`${id} ${name} ${p}: a hand ${worstGap.toFixed(3)} m off its grip (limit ${MAX_GRIP_GAP_M})`);
      }
      if (aim !== undefined) {
        out.push({
          line: `hold ${p} ${name}: aim ${aim}, worst grip gap ${worstGap.toFixed(3)} m` +
            (Number.isFinite(eyeLo) ? `, eye over bore ${eyeLo.toFixed(3)}..${eyeHi.toFixed(3)} m` : ''),
          ctx,
        });
      }
    }
  }
  if (out.length === 0) out.push({ line: `hold: ${holds.length} figures`, ctx });
  out[0] = { ...out[0], line: `${out[0].line} (rebound ${moved.join('/')} weapon vertices)` };
  return out;
}
