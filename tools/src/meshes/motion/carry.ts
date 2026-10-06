/**
 * A long item carried in one hand while walking (ground-fix, 6 Oct).
 *
 * yahalom_squad's yah_a holds a 1.45 m sensor mast LEVEL in his right hand
 * (`import_meshy_crew_team.py`: 1.25 m of it ahead of the hand, 0.20 m
 * behind). rig.py's walk swings that arm like any other, and a mast rigid on
 * the forearm turns a 10-degree swing into a 0.2 m dip at its head: measured
 * on main's bytes it went 114.5 mm into the ground in `move` and `moveFire`
 * (after the stride pass had lowered his hips into the replanted stride; 15 mm
 * before it). Nobody walks with a pole swinging from one hand.
 *
 * The carry: through `move` and `moveFire` the carrying arm stops swinging --
 * the upper arm hangs at its rest under the torso, so it follows the lean and
 * the bob and nothing else -- and the forearm bends at the elbow until the
 * item points `pitchDeg` above level along the figure's own heading. The
 * item's direction is read from its own vertices (their principal axis,
 * turned to point away from the elbow), never assumed. Every other clip keeps
 * the item as it was: level at hand height in `idle`, swung clear of the
 * ground by `kneel.ts`'s `liftArm` in the kneel clips.
 *
 * The LIFT (ground-debt, 6 Oct) is the same idea for an item worn on the
 * torso rather than held in a hand: breach_team's brc_point wears a 1.2 m
 * ballistic shield on his spine (`import_meshy_crew_team.py`: his left arm
 * is baked into the torso, so the forearm bone it would ride swings with a
 * gait the arm never makes), and it hangs to 30 mm off the ground standing.
 * The run leans his torso and drops his hips, and on main's bytes the
 * shield's foot went 54-148 mm into the ground through the whole of `move`
 * and `moveFire`. So the shield moves onto a bone of its own under the spine
 * -- keyed at its rest in every clip, where it rides the torso exactly as it
 * did -- and through `move` and `moveFire` that bone is carried up the
 * torso's own axis by the least amount that keeps its foot, at every sample
 * of both clips, no lower than it stands: the man lifts it to run.
 */
import type { Document } from '@gltf-transform/core';
import { addBone, rebind, writeTrack } from './edit';
import { rotateWorld } from './hold';
import { lowestY } from './kneel';
import { add, cross, deg, dot, len, norm, qconj, qfromTo, qmul, qrot, scale, sub, type V3 } from './math';
import { denseTimes, keyTimes, restVertices, Rig, tracksOf } from './rig';
import type { MotionTeam } from './teams';

export const CARRY_CLIPS: readonly string[] = ['move', 'moveFire'];
export const CARRY_FPS = 120;

/** The principal axis of a point set (power iteration on its covariance). */
function principalAxis(pts: readonly V3[]): { centre: V3; axis: V3 } {
  const c = scale(pts.reduce((a, p) => add(a, p), [0, 0, 0] as V3), 1 / pts.length);
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += d[i] * d[j];
  }
  let v: V3 = [1, 0.3, 0.2];
  for (let it = 0; it < 64; it++) {
    v = norm([
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ]);
  }
  return { centre: c, axis: v };
}

export function applyCarry(doc: Document, id: string, spec: MotionTeam): string[] {
  const lines: string[] = [];
  for (const f of spec.figures) {
    if (f.lift) lines.push(...liftCarry(doc, id, f.prefix, f.lift));
    if (!f.carry) continue;
    const rig = new Rig(doc);
    const p = f.prefix;
    const side = f.carry.forearm;
    const upper = rig.node(`${p}_upperarm_${side}`);
    const fore = rig.node(`${p}_forearm_${side}`);
    const root = rig.node(`${p}_root`);
    // The item: the forearm's own kit -- what is not sleeve.
    const item = restVertices(rig).filter((v) => v.joint === fore && (v.role === 'metal' || v.role === 'weapon'));
    if (item.length < 8) throw new Error(`${id}: ${p} carries nothing on ${fore.getName()} (${item.length} vertices)`);
    const { centre, axis: a0 } = principalAxis(item.map((v) => v.p));
    // Point it AWAY from the arm: its centre sits on the side it reaches
    // out to, measured from the elbow (the forearm bone's origin).
    const elbow = rig.restWorld.get(fore)!.t;
    const axisRest = dot(a0, sub(centre, elbow)) >= 0 ? a0 : scale(a0, -1);
    const reach = Math.max(...item.map((v) => dot(sub(v.p, elbow), axisRest)));
    // Its heading at rest, level: where the man points it. A clip that turns
    // the figure's root turns that heading with it.
    const restHeading = norm([axisRest[0], 0, axisRest[2]]);
    if (len(restHeading) < 0.5) throw new Error(`${id}: ${p}'s carried item stands upright at rest -- no heading to carry it along`);
    const rootRest = rig.restWorld.get(root)!.r;
    const pitch = deg(f.carry.pitchDeg);
    for (const anim of doc.getRoot().listAnimations()) {
      if (!CARRY_CLIPS.includes(anim.getName())) continue;
      const tracks = tracksOf(anim);
      const times = denseTimes(tracks, CARRY_FPS);
      const rotU: number[] = [];
      const rotF: number[] = [];
      let lo = Infinity;
      let hi = -Infinity;
      for (const t of times) {
        const pose = rig.sample(tracks, t);
        // The carrying arm hangs from the torso and does not swing.
        pose.set(upper, { ...pose.get(upper)!, r: rig.rest.get(upper)!.r });
        pose.set(fore, { ...pose.get(fore)!, r: rig.rest.get(fore)!.r });
        const fw = rig.worldOf(fore, pose).r;
        const cur = qrot(qmul(fw, qconj(rig.restWorld.get(fore)!.r)), axisRest);
        const head = qrot(qmul(rig.worldOf(root, pose).r, qconj(rootRest)), restHeading);
        const flat = norm([head[0], 0, head[2]]);
        const want: V3 = add(scale(flat, Math.cos(pitch)), [0, Math.sin(pitch), 0]);
        rotateWorld(rig, pose, fore, qfromTo(cur, want));
        rotU.push(...pose.get(upper)!.r);
        rotF.push(...pose.get(fore)!.r);
        const now = qrot(qmul(rig.worldOf(fore, pose).r, qconj(rig.restWorld.get(fore)!.r)), axisRest);
        const err = Math.asin(Math.min(1, len(cross(now, want))));
        if (err > deg(0.5)) throw new Error(`${id} ${anim.getName()} ${p}: carry off by ${(err * 180 / Math.PI).toFixed(2)} deg`);
        const el = Math.asin(Math.max(-1, Math.min(1, now[1])));
        lo = Math.min(lo, el);
        hi = Math.max(hi, el);
      }
      writeTrack(doc, anim, upper, 'rotation', times, rotU);
      writeTrack(doc, anim, fore, 'rotation', times, rotF);
      lines.push(
        `carry ${p} ${anim.getName()}: ${fore.getName()}'s item (${item.length} vertices, ${reach.toFixed(2)} m past the elbow) ` +
          `at ${((lo * 180) / Math.PI).toFixed(1)}..${((hi * 180) / Math.PI).toFixed(1)} deg, ${times.length} keys`
      );
    }
  }
  return lines;
}

/**
 * The lift (see the header): `prefix`'s `role` vertices on its spine move to
 * a bone `${prefix}_${bone}` of their own, keyed at rest in every clip, and
 * carried up the torso in `move` and `moveFire` until the item's lowest
 * vertex is never under its own standing clearance.
 */
function liftCarry(doc: Document, id: string, p: string, lift: { readonly role: string; readonly bone: string }): string[] {
  const lines: string[] = [];
  let rig = new Rig(doc);
  const spineName = `${p}_spine`;
  const name = `${p}_${lift.bone}`;
  const item = restVertices(rig).filter((v) => v.joint === rig.node(spineName) && v.role === lift.role);
  if (item.length < 8) throw new Error(`${id}: ${p} wears no ${lift.role} on ${spineName} (${item.length} vertices)`);
  // How far off the ground it stands: the clearance the carry keeps.
  const clear = Math.min(...item.map((v) => v.p[1]));
  if (clear < 0) throw new Error(`${id}: ${p}'s ${lift.role} stands ${clear.toFixed(4)} m under the ground at rest`);
  const centre = scale(item.reduce((a, v) => add(a, v.p), [0, 0, 0] as V3), 1 / item.length);
  addBone(doc, rig, name, rig.node(spineName), { t: centre, r: [0, 0, 0, 1], s: 1 });
  rig = new Rig(doc);
  const moved = rebind(rig, lift.role, rig.node(spineName), rig.node(name));
  if (moved !== item.length) throw new Error(`${id}: ${name} took ${moved} of ${item.length} ${lift.role} vertices`);
  rig = new Rig(doc);
  const bone = rig.node(name);
  const rest = rig.rest.get(bone)!;
  // Every clip keys the new bone at its rest (rig.py's rule, `feet.ts`'s
  // reason: an untouched bone keeps whatever the last clip left in it).
  for (const anim of doc.getRoot().listAnimations()) {
    const times = keyTimes(tracksOf(anim), spineName);
    writeTrack(doc, anim, bone, 'translation', times, times.flatMap(() => [...rest.t]));
    writeTrack(doc, anim, bone, 'rotation', times, times.flatMap(() => [...rest.r]));
    writeTrack(doc, anim, bone, 'scale', times, times.flatMap(() => [1, 1, 1]));
  }
  rig = new Rig(doc);
  const pts = restVertices(rig).filter((v) => v.joint === rig.node(name)).map((v) => ({ joint: v.joint, p: v.p }));
  // The torso's own up, in the spine's frame: what the carry lifts along.
  const sw = rig.restWorld.get(rig.node(spineName))!;
  const up = scale(qrot(qconj(sw.r), [0, 1, 0]), 1 / sw.s);
  let need = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    if (!CARRY_CLIPS.includes(anim.getName())) continue;
    const tracks = tracksOf(anim);
    for (const t of denseTimes(tracks, CARRY_FPS)) {
      const pose = rig.sample(tracks, t);
      const w = rig.worldOf(rig.node(spineName), pose);
      const k = qrot(w.r, scale(up, w.s))[1];
      if (k <= 0.5) throw new Error(`${id} ${anim.getName()} ${p}: the torso leans past 60 deg -- no up to carry along`);
      need = Math.max(need, (clear - lowestY(rig, pose, pts)) / k);
    }
  }
  const at = add(rest.t, scale(up, need));
  for (const anim of doc.getRoot().listAnimations()) {
    if (!CARRY_CLIPS.includes(anim.getName())) continue;
    const tracks = tracksOf(anim);
    const times = keyTimes(tracks, spineName);
    writeTrack(doc, anim, bone, 'translation', times, times.flatMap(() => [...at]));
    let lo = Infinity;
    const now = tracksOf(anim);
    for (const t of denseTimes(now, CARRY_FPS)) lo = Math.min(lo, lowestY(rig, rig.sample(now, t), pts));
    if (lo < clear - 1e-6) throw new Error(`${id} ${anim.getName()} ${p}: carried ${name} reads ${lo.toFixed(4)} m, under its ${clear.toFixed(4)}`);
    lines.push(
      `lift ${p} ${anim.getName()}: ${name} (${pts.length} ${lift.role} vertices) up the torso ${(need * 1000).toFixed(0)} mm, ` +
        `lowest ${(lo * 1000).toFixed(1)} mm (it stands ${(clear * 1000).toFixed(1)} mm off the ground), ${times.length} keys`
    );
  }
  return [`lift ${p}: ${moved} ${lift.role} vertices onto ${name}`, ...lines];
}
