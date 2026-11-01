/**
 * The hold, applied to a whole file: a weapon bone per shooter, its weapon
 * vertices moved onto it, and every clip re-keyed so the hold owns the
 * torso, both arms and the weapon (`hold.ts`).
 *
 * Which clips the hold owns, and in which state:
 *
 *   idle, move            low ready (a rifle), the shoulder carry (a tube),
 *                         or the low carry (the Spike, the hold's own)
 *   fire, moveFire        aimed
 *   kneel*                built by `kneel.ts`, which calls `holdFrame`
 *   everything else       (deaths, `down`, `work`) the weapon follows the
 *                         forearm it used to ride, so a falling body keeps
 *                         its weapon exactly as it did before this pass
 */
import type { Document, Node } from '@gltf-transform/core';
import { addBone, rebind, writeTrack } from './edit';
import { describeHold, followForearm, followHand, MAX_GRIP_GAP_M, resetHoldMemory, setHoldDt, holdMemory, setHoldMemory, solveHold, type HoldMemory, weaponRest, type HoldFigure } from './hold';
import { clipRange, keyTimes, restVertices, Rig, tracksOf, type Pose } from './rig';
import type { Q } from './math';
import type { MotionTeam } from './teams';

/** The longest a held clip may go between two keys: a hand that is on its station at both keys can be off it between them. */
export const HELD_KEY_STEP_S = 1 / 30;
export function denseTimes(times: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < times.length; i++) {
    out.push(times[i]);
    if (i + 1 < times.length) {
      const gap = times[i + 1] - times[i];
      const n = Math.ceil(gap / HELD_KEY_STEP_S - 1e-9);
      for (let k = 1; k < n; k++) out.push(times[i] + (gap * k) / n);
    }
  }
  return out;
}

export const AIM_CLIPS: Record<string, number> = { idle: 0, move: 0, fire: 1, moveFire: 1 };

/** Bones the hold writes for one figure, in the order they are solved. */
export function heldBones(prefix: string): string[] {
  return ['spine', 'neck', 'head', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R'].map((b) => `${prefix}_${b}`);
}

/** A looping clip's last key may differ from its first by this much, degrees, before the clip is solved again from where it ended. */
export const HOLD_SEAM_DEG = 5;

export interface HoldContext {
  readonly hold: HoldFigure;
  readonly weaponName: string;
  /** The hold's memory at the end of `idle`: a kneel's drop starts from it. Written by `applyHold`. */
  idleMemory?: HoldMemory;
}

export function holdFrame(rig: Rig, pose: Pose, ctx: HoldContext, aim: number, aimLean?: number, upright = false, bladeExtra = 0): {
  gap: number; eye: number; wristOver: number; offsetDeg: number;
} {
  const r = solveHold(rig, pose, ctx.hold, rig.node(ctx.weaponName), { aim, upright, ...(bladeExtra ? { bladeExtra } : {}), ...(aimLean !== undefined ? { aimLean } : {}) });
  return {
    gap: Math.max(r.gapShoot, r.gapSupport), eye: r.eyeAboveBore,
    wristOver: r.wrist ? Math.max(r.wrist.fire.overDeg, r.wrist.support.overDeg) : 0,
    offsetDeg: r.wrist ? Math.max(r.wrist.offsetFire, r.wrist.offsetSupport) : 0,
  };
}

/** The hand and finger bones a modelled hand's hold writes (none for a figure with a formula hand). */
export function handBones(ctx: HoldContext): Node[] {
  const hr = ctx.hold.hands;
  return hr ? [hr.fire.hand, hr.support.hand, ...hr.fists.values(), ...(hr.finger ? [hr.finger.node] : [])] : [];
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
  // What a modelled hand's wrist does at low ready, first frame of `idle`: the dead clips keep it (a man who falls
  // with a rifle still has his hands on it).
  const grip = new Map<Node, Q>();
  const idleAnim = doc.getRoot().listAnimations().find((a) => a.getName() === 'idle');
  if (idleAnim && ctx.some((c) => c.hold.hands)) {
    const tr = tracksOf(idleAnim);
    const pose0 = rig.sample(tr, clipRange(tr)[0]);
    for (const c of ctx) {
      if (!c.hold.hands) continue;
      holdFrame(rig, pose0, c, 0);
      for (const n of [c.hold.hands.fire.hand, c.hold.hands.support.hand]) grip.set(n, pose0.get(n)!.r);
    }
  }
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
      // A Spike is the exception (spike-walk, 6 Oct): its importer seat IS
      // the aim, so the hold carries it too (`SPIKE_CARRY_REAR`).
      const ownsCarry = c.hold.kind === 'rifle' || c.hold.kind === 'spike';
      const aim = !ownsCarry && AIM_CLIPS[name] === 0 ? undefined : AIM_CLIPS[name];
      const times = c.hold.hands ? denseTimes(keyTimes(tracks, `${p}_spine`)) : keyTimes(tracks, `${p}_spine`);
      const written = aim === undefined ? [c.weaponName] : [...heldBones(p), c.weaponName];
      const nodes: Node[] = [...written.map((n) => rig.node(n)), ...handBones(c)];
      let rot: number[][] = [];
      let tr: number[][] = [];
      let worstGap = 0;
      let worstWrist = 0;
      let worstOffset = 0;
      let eyeLo = Infinity;
      let eyeHi = -Infinity;
      // One run of the clip. A looping clip's last key meets its first again, so a run may start from where the last one
      // ended (`from`): the solver is paced, and a run from nothing leaves the arm wherever the pace had got it by the end.
      const runLoop = (from: HoldMemory | null): void => {
        resetHoldMemory(c.hold);
        if (from) setHoldMemory(c.hold, from);
        rot = nodes.map(() => [] as number[]);
        tr = nodes.map(() => [] as number[]);
        worstGap = 0; worstWrist = 0; worstOffset = 0; eyeLo = Infinity; eyeHi = -Infinity;
        let tPrev: number | null = from && times.length > 1 ? times[0] - (times[1] - times[0]) : null;
        for (const t of times) {
          const pose = rig.sample(tracks, t);
          setHoldDt(tPrev === null ? null : t - tPrev);
          tPrev = t;
          if (aim === undefined) {
            if (c.hold.hands) followHand(rig, pose, c.hold, rig.node(c.weaponName), grip);
            else followForearm(rig, pose, c.hold, rig.node(c.weaponName));
          } else {
            // A rest carry (a Meshy figure sculpted at the low ready) aims `fire` from an upright torso: the capture's
            // 44 deg crouched lean put its eye at or under the bore, whatever the pocket (measured 1 Nov). The run keeps
            // its own lean in `moveFire`, as every team does.
            const r = holdFrame(rig, pose, c, aim, undefined, !!c.hold.restCarry && name === 'fire');
            worstGap = Math.max(worstGap, r.gap);
            worstWrist = Math.max(worstWrist, r.wristOver);
            worstOffset = Math.max(worstOffset, r.offsetDeg);
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
        setHoldDt(null);
      };
      /** The turn between the last key and the first, the worst of the held bones, degrees. */
      const seamDeg = (): number => {
        let w = 0;
        nodes.forEach((_n, i) => {
          const n4 = rot[i].length - 4;
          const d = Math.abs(rot[i][0] * rot[i][n4] + rot[i][1] * rot[i][n4 + 1] + rot[i][2] * rot[i][n4 + 2] + rot[i][3] * rot[i][n4 + 3]);
          w = Math.max(w, (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI);
        });
        return w;
      };
      runLoop(null);
      let passes = 1;
      let seam = seamDeg();
      // Close the loop: re-run the clip from where it ended until the seam is small, at most four runs in all.
      while (aim !== undefined && c.hold.hands && seam > HOLD_SEAM_DEG && passes < 4) {
        runLoop(holdMemory(c.hold));
        passes++;
        seam = seamDeg();
      }
      const seamNote = `, loop seam ${seam.toFixed(1)} deg${passes > 1 ? ` (${passes} runs)` : ''}`;
      if (name === 'idle') c.idleMemory = holdMemory(c.hold);
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
            (c.hold.hands ? `${seamNote}, wrist over limit ${worstWrist.toFixed(1)} deg, hand turned off its station up to ${worstOffset.toFixed(0)} deg` : '') +
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
