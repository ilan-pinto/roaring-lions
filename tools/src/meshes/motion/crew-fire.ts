/**
 * The crew-served weapons' gunner ON THE GUN, and their `fire` (unit polish,
 * the lead's rulings of 2026-10-14).
 *
 * Until this step `atgm_cell` and `mortar_crew` carried no `fire` clip at all,
 * so `meshClipOrFallback` played `idle` while a Kornet or an 82 mm round left:
 * two men kneeling beside a weapon neither of them touched (the phase-1
 * sheet, `_coord/unit-polish/sheet.png`). Both weapons ride the team's
 * shared, never-keyed `prop` bone, so neither team is a squad rig and neither
 * gets the runtime launcher kick (`units/squad-motion.ts`): the whole of the
 * motion is here, in the clip.
 *
 *  - The GUNNER is re-seated at the weapon -- his kneeling root, its corpse
 *    and its walker moved together, rest and every key (`formation.ts`'s
 *    rigid move) -- and in `idle` and `fire` his torso is solved so his EYE
 *    sits `EYE_GAP_M` behind the ATGM's sight, or so his inboard hand reaches
 *    the mortar's elevating handwheel; both his hands close on the ATGM's two
 *    grips by two-bone IK (`hold.ts`'s `twoBoneIK`). Solved per key, so the
 *    idle's pelvis sway still moves him while his eye and hands stay put.
 *  - `fire` is a keyframe table (`CREW_FIRE`) of world-space deltas on top of
 *    that seated pose: the flinch, the guiding hold, the duck, the reach.
 *    Pitch positive leans FORWARD, yaw positive turns to the figure's LEFT.
 *  - Nothing moves the weapon. `prop` stays still: the ground census forbids
 *    a baseplate dip or a tripod rock (a 0.8 deg rock moves its feet 7 mm).
 *
 * Every number is the approved proposal's (`_coord/unit-polish/proposal.md`
 * section 2). Points on the weapon are MEASURED on its own vertices here, not
 * typed: the ATGM's sight and grips off the post, the mortar's handwheel off
 * the part (`mortar-graft.ts`'s `rl_crew_points`, measured in Blender by
 * `tools/units/mortar_crew_part.py`).
 */
import type { Document, Node } from '@gltf-transform/core';
import { handPoint, rotateWorld, twoBoneIK } from './hold';
import { moveVertices, rebuildBinds, verifyBinds } from './formation';
import { shiftNode, writeTrack } from './edit';
import { writeClip } from './kneel';
import { add, deg, len, norm, qaxis, qconj, qfromTo, qmul, scale, smoothstep, sub, type V3 } from './math';
import { carry, restVertices, Rig, tracksOf, type Pose } from './rig';

/** Eye behind the sight's eyepiece, metres (the lead: "about 0.06 m"). */
export const EYE_GAP_M = 0.06;
/** A hand further than this from its grip or wheel is refused. */
export const CREW_GRIP_GAP_M = 0.04;
/** How far a shoulder may slide toward its grip (scapula protraction), m:
 *  `hold.ts`'s SUPPORT_PROTRACTION, 0.06 forward, for the same reason --
 *  these cut rigs' upper-arm bone is short and starts at the armpit. */
export const SHOULDER_REACH_M = 0.06;
/** The `fire` clip's sample rate. */
export const CREW_FIRE_FPS = 24;

export interface FireKey {
  readonly t: number;
  /** World deltas, degrees: spine [pitch fwd, yaw left], head [pitch down, yaw left]. */
  readonly spine?: readonly [number, number];
  readonly head?: readonly [number, number];
  /** The outboard upper arm pitched forward/down, degrees (the loader's reach). */
  readonly reach?: number;
}

export interface CrewFireSpec {
  readonly durationS: number;
  readonly gunner: string;
  readonly mate: string;
  /** What the gunner is seated at. `console`: a fire-control unit's display
   *  and its two hand grips, read from the GLB's `rl_crew_points` (`sight`,
   *  `grip_r`, `grip_l`, written by the importer), not measured off the gun. */
  readonly seat: 'sight' | 'handwheel' | 'console';
  /** Where the eye sits from the `sight`: this far back along -X (default
   *  `EYE_GAP_M`, an eyepiece) and this far above it (default 0) -- a screen
   *  is read from arm's length, not with the eye on it. */
  readonly eyeGapM?: number;
  readonly eyeRiseM?: number;
  /** The team's `fire` is the launcher's, not a hand-held weapon's: an
   *  existing `fire` (rig.py's raise-and-recoil, built for a figure that
   *  carries a rifle -- at_nlos_team's leader) is REPLACED. The figures named
   *  in `keep` hold that clip's FIRST frame through the new one -- the hold's
   *  aim, before any recoil: the leader covers with his carbine while the
   *  launcher fires, and does not kick as if he had shot. Without this an
   *  existing `fire` is refused, as before. */
  readonly replacesFire?: { readonly keep: readonly string[] };
  readonly keys: Readonly<Record<string, readonly FireKey[]>>;
}

/**
 * The approved tables. Kornet: 2.0 s, its flight time to the 8-tile effective
 * range at 4 tiles/s, the gunner guiding with his eye on the sight; the
 * launcher flinch is the standard's 2 deg x 1.5 = 3, taken mostly in the head (see the table)
 * (the proposal's figure). Mortar: 1.5 s from the round leaving -- duck,
 * hold, rise, the loader reaching for the next bomb.
 */
export const CREW_FIRE: Readonly<Record<string, CrewFireSpec>> = {
  atgm_cell: {
    durationS: 2.0,
    gunner: 'atgm_crew0',
    mate: 'atgm_crew1',
    seat: 'sight',
    keys: {
      atgm_crew0: [
        // The flinch is a 3 deg jolt of the head across the sight, nothing
        // at the spine: his arms are near full reach to the grips (a 3 deg
        // spine flinch took a hand 46 mm off them, 4.5 deg 54 mm), and his
        // eye is at the sight, so a head pitched back put the post's sight
        // block into his face (3 samples inside).
        { t: 0, spine: [0, 0], head: [0, 0] },
        { t: 0.06, spine: [0, 0], head: [0, 3] },
        { t: 0.46, spine: [0, 0], head: [0, 0] },
        { t: 1.0, spine: [0, 0.5] },
        { t: 1.6, spine: [0, -0.5] },
        { t: 1.8, spine: [0, 0] },
        { t: 2.0, spine: [0, 0] },
      ],
      // He kneels on the launcher's left; the tube and its backblast are on
      // his right, so he turns LEFT, away from it.
      atgm_crew1: [
        { t: 0, spine: [0, 0], head: [0, 0] },
        { t: 0.06, spine: [0, 8], head: [0, 35] },
        { t: 0.5, spine: [0, 8], head: [0, 35] },
        { t: 1.0, spine: [0, 0], head: [0, 0] },
        { t: 2.0, spine: [0, 0], head: [0, 0] },
      ],
    },
  },
  // GH-709 Phase 7: the Zaron Missile Team. Kornet's table shape and length:
  // the gunner guides from the fire-control case's display (seat `console`),
  // hands on its two grips, his eye 0.40 m back from the screen and 0.26 m
  // above its centre. The loader kneels on the launcher's right, so the
  // launcher is on HIS left: he ducks and turns right, away from the launch
  // and the backblast. Nothing moves `prop`.
  at_nlos_team: {
    durationS: 2.0,
    gunner: 'nl_gun',
    mate: 'nl_load',
    seat: 'console',
    replacesFire: { keep: ['nl_lead'] },
    eyeGapM: 0.4,
    eyeRiseM: 0.26,
    keys: {
      nl_gun: [
        { t: 0, spine: [0, 0], head: [0, 0] },
        { t: 0.06, spine: [0, 0], head: [0, 3] },
        { t: 0.46, spine: [0, 0], head: [0, 0] },
        { t: 1.0, spine: [0, 0.5] },
        { t: 1.6, spine: [0, -0.5] },
        { t: 1.8, spine: [0, 0] },
        { t: 2.0, spine: [0, 0] },
      ],
      nl_load: [
        { t: 0, spine: [0, 0], head: [0, 0] },
        { t: 0.06, spine: [15, -10], head: [15, -35] },
        { t: 0.6, spine: [15, -10], head: [15, -35] },
        { t: 1.2, spine: [0, 0], head: [0, 0] },
        { t: 2.0, spine: [0, 0], head: [0, 0] },
      ],
    },
  },
  mortar_crew: {
    durationS: 1.5,
    gunner: 'emtr_crew0',
    mate: 'emtr_crew1',
    seat: 'handwheel',
    keys: {
      // On the mortar's right; the muzzle is on his left: he ducks and turns right.
      emtr_crew0: [
        { t: 0, spine: [0, 0], head: [0, 0] },
        { t: 0.15, spine: [15, 0], head: [20, -30] },
        { t: 0.7, spine: [15, 0], head: [20, -30] },
        { t: 1.1, spine: [0, 0], head: [0, 0] },
        { t: 1.5, spine: [0, 0], head: [0, 0] },
      ],
      // On its left: ducks, turns left, rises, reaches out for the next bomb.
      emtr_crew1: [
        { t: 0, spine: [0, 0], head: [0, 0], reach: 0 },
        { t: 0.15, spine: [25, 0], head: [0, 40], reach: 0 },
        { t: 0.7, spine: [25, 0], head: [0, 40], reach: 0 },
        { t: 1.1, spine: [0, 0], head: [0, 0], reach: 0 },
        { t: 1.3, spine: [20, 30], head: [15, 0], reach: 40 },
        { t: 1.5, spine: [0, 0], head: [0, 0], reach: 0 },
      ],
    },
  },
};

const UP: V3 = [0, 1, 0];
const PITCH_AXIS: V3 = [0, 0, -1]; // positive = lean forward (+X) about the right axis
const ROLE_PART = 'weapon';

function lerpKeys(keys: readonly FireKey[], t: number): Required<Omit<FireKey, 't'>> {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const u = b.t > a.t ? smoothstep((t - a.t) / (b.t - a.t)) : 0;
  const v2 = (x?: readonly [number, number], y?: readonly [number, number]): [number, number] => [
    (x?.[0] ?? 0) + ((y?.[0] ?? 0) - (x?.[0] ?? 0)) * u,
    (x?.[1] ?? 0) + ((y?.[1] ?? 0) - (x?.[1] ?? 0)) * u,
  ];
  return { spine: v2(a.spine, b.spine), head: v2(a.head, b.head), reach: (a.reach ?? 0) + ((b.reach ?? 0) - (a.reach ?? 0)) * u };
}

/** World-space pitch (forward) then yaw (left) of `node` about its own origin. */
function turn(rig: Rig, pose: Pose, node: Node, pitchDeg: number, yawDeg: number): void {
  if (pitchDeg) rotateWorld(rig, pose, node, qaxis(PITCH_AXIS, deg(pitchDeg)));
  if (yawDeg) rotateWorld(rig, pose, node, qaxis(UP, deg(yawDeg)));
}

interface Seat {
  readonly eyeRest: V3; // gunner's eye, rest world (face centroid on head)
  readonly eyeTarget?: V3;
  readonly grips?: { readonly right: V3; readonly left: V3 };
  readonly wheel?: V3;
  readonly handR: V3; // hand rest points (anatomical right = `_L` bones)
  readonly handL: V3;
}

/** The ATGM post's sight and grips, off its own `prop` vertices. */
function measurePost(post: V3[]): { sight: V3; right: V3; left: V3; rear: V3; muzzle: V3 } {
  const minX = Math.min(...post.map((p) => p[0]));
  const rearBand = post.filter((p) => p[0] < minX + 0.12);
  const topY = Math.max(...rearBand.map((p) => p[1]));
  const top = rearBand.filter((p) => p[1] > topY - 0.06);
  const sight = top.reduce((a, p) => (p[0] < a[0] ? p : a));
  const gripBand = post.filter((p) => p[0] < minX + 0.2 && p[1] > 0.55 && p[1] < 0.8);
  if (gripBand.length < 4) throw new Error(`crew-fire: no grips found on the post (${gripBand.length} vertices in the band)`);
  const right = gripBand.reduce((a, p) => (p[2] > a[2] ? p : a));
  const left = gripBand.reduce((a, p) => (p[2] < a[2] ? p : a));
  // The tube's two ends: above the tripod's feet (y > 0.5), the rearmost and
  // the foremost 3 cm of it.
  const tube = post.filter((p) => p[1] > 0.5);
  const centroid = (pts: V3[]): V3 => scale(pts.reduce((a, p) => add(a, p), [0, 0, 0] as V3), 1 / pts.length);
  const tMin = Math.min(...tube.map((p) => p[0]));
  const tMax = Math.max(...tube.map((p) => p[0]));
  const rear = centroid(tube.filter((p) => p[0] < tMin + 0.03));
  const muzzle = centroid(tube.filter((p) => p[0] > tMax - 0.03));
  return { sight, right, left, rear, muzzle };
}

/** A `console` seat's points off the scene's `rl_crew_points` (glTF metres,
 *  team frame): the display's centre and the two grips, refused if absent or
 *  malformed. The grips must sit on either side of the display, the right
 *  grip on the figure's right (+Z): swapped, the arms would cross. */
export function consolePoints(extras: unknown): { sight: V3; right: V3; left: V3 } {
  const pts = (extras as { rl_crew_points?: Record<string, unknown> } | undefined)?.rl_crew_points;
  if (!pts) throw new Error('crew-fire: a console seat needs rl_crew_points on the scene (the importer writes it)');
  const v3 = (k: string): V3 => {
    const v = pts[k];
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x)))
      throw new Error(`crew-fire: rl_crew_points.${k} is not three numbers`);
    return [v[0], v[1], v[2]];
  };
  const sight = v3('sight');
  const right = v3('grip_r');
  const left = v3('grip_l');
  if (!(right[2] > sight[2] && left[2] < sight[2]))
    throw new Error(`crew-fire: the console grips are not either side of the display (right z ${right[2]}, display ${sight[2]}, left ${left[2]})`);
  return { sight, right, left };
}

/** Move a kneeling figure (its root, corpse and walker) by `d`, binds rebuilt. */
function reseat(doc: Document, rig: Rig, prefix: string, d: V3): void {
  const moving = [`${prefix}_root`, `${prefix}_death_root`, `${prefix}w_root`].filter((n) => rig.has(n)).map((n) => rig.node(n));
  const subtree = new Set<Node>();
  const walk = (n: Node): void => {
    subtree.add(n);
    for (const c of n.listChildren()) walk(c);
  };
  for (const n of moving) walk(n);
  moveVertices(rig, subtree, d as [number, number, number]);
  for (const n of moving) shiftNode(doc, n, d as [number, number, number]);
}

/** Torso aimed so the eye lands on `target`: the spine swings the eye
 *  there, and the neck takes back part of the lean so he looks along the
 *  tube. How much is searched (0-100 % in 5 % steps), because the neck's
 *  turn also changes the eye's distance from the spine base, which a pure
 *  swing cannot correct: the best of the 21 lands the eye on the target. */
function aimEye(rig: Rig, pose: Pose, prefix: string, eyeRest: V3, target: V3): number {
  const spine = rig.node(`${prefix}_spine`);
  const neck = rig.node(`${prefix}_neck`);
  const head = rig.node(`${prefix}_head`);
  const start = new Map(pose);
  let best: { err: number; pose: Pose } | null = null;
  for (let k = 0; k <= 20; k++) {
    const trial: Pose = new Map(start);
    const eyeNow = (): V3 => carry(rig, (n) => rig.worldOf(n, trial), head, eyeRest);
    for (let it = 0; it < 6; it++) {
      const base = rig.worldOf(spine, trial).t;
      rotateWorld(rig, trial, spine, qfromTo(sub(eyeNow(), base), sub(target, base)));
      if (it === 0) {
        const sw = rig.worldOf(spine, trial).r;
        const rest = rig.restWorld.get(spine)!.r;
        const fwd = norm(rotateVec(qmul(sw, qconj(rest)), [1, 0, 0]));
        const pitch = Math.atan2(-fwd[1], fwd[0]);
        rotateWorld(rig, trial, neck, qaxis(PITCH_AXIS, -pitch * (k / 20)));
      }
    }
    const err = len(sub(eyeNow(), target));
    if (!best || err < best.err) best = { err, pose: trial };
  }
  for (const [n, x] of best!.pose) pose.set(n, x);
  return best!.err;
}

function rotateVec(q: [number, number, number, number], v: V3): V3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

/** Slide a shoulder up to SHOULDER_REACH_M toward its grip (in its parent's frame). */
function protract(rig: Rig, pose: Pose, upper: Node, grip: V3): void {
  const at = rig.worldOf(upper, pose).t;
  const d = sub(grip, at);
  const want = scale(norm(d), Math.min(SHOULDER_REACH_M, len(d)));
  const pw = rig.worldOf(rig.parent.get(upper)!, pose);
  const local = rotateVec(qconj(pw.r), scale(want, 1 / pw.s));
  const cur = pose.get(upper)!;
  pose.set(upper, { ...cur, t: add(cur.t, local) });
}

/** The seated gunner, solved into `pose` (mutated). Returns the gaps. */
function seatGunner(rig: Rig, pose: Pose, p: string, seat: Seat): { eye: number; hands: number[] } {
  const hands: number[] = [];
  let eye = 0;
  if (seat.eyeTarget) eye = aimEye(rig, pose, p, seat.eyeRest, seat.eyeTarget);
  if (seat.grips) {
    protract(rig, pose, rig.node(`${p}_upperarm_L`), seat.grips.right);
    protract(rig, pose, rig.node(`${p}_upperarm_R`), seat.grips.left);
    hands.push(twoBoneIK(rig, pose, rig.node(`${p}_upperarm_L`), rig.node(`${p}_forearm_L`), seat.handR, seat.grips.right, [-0.2, -1, 0.7]));
    hands.push(twoBoneIK(rig, pose, rig.node(`${p}_upperarm_R`), rig.node(`${p}_forearm_R`), seat.handL, seat.grips.left, [-0.2, -1, -0.7]));
  }
  if (seat.wheel) {
    // The inboard hand (the mortar is on his LEFT: rig `_R`), the torso
    // leaning in until it reaches.
    const spine = rig.node(`${p}_spine`);
    const up = rig.node(`${p}_upperarm_R`);
    for (let it = 0; it < 4; it++) {
      const sh = rig.worldOf(up, pose).t;
      const need = len(sub(seat.wheel, sh)) - 0.48;
      if (need <= 0) break;
      const base = rig.worldOf(spine, pose).t;
      const toward = norm(sub(seat.wheel, base));
      const cur = norm(sub(sh, base));
      const q = qfromTo(cur, norm(add(cur, scale(toward, Math.min(0.5, need * 2)))));
      rotateWorld(rig, pose, spine, q);
    }
    hands.push(twoBoneIK(rig, pose, up, rig.node(`${p}_forearm_R`), seat.handL, seat.wheel, [-0.2, -1, -0.7]));
  }
  return { eye, hands };
}

export function applyCrewFire(doc: Document, id: string): string[] {
  const spec = CREW_FIRE[id];
  if (!spec) return [];
  const root = doc.getRoot();
  const replaced: string[] = [];
  const kept: Pose = new Map();
  const existing = root.listAnimations().find((a) => a.getName() === 'fire');
  if (existing) {
    if (!spec.replacesFire) throw new Error(`crew-fire: ${id} already has a fire clip`);
    const keep = spec.replacesFire.keep;
    const before = new Rig(doc);
    const tracks = tracksOf(existing);
    const first = before.sample(tracks, 0);
    for (const tr of tracks.values()) {
      if (keep.some((p) => tr.node.getName().startsWith(`${p}_`))) kept.set(tr.node, first.get(tr.node)!);
    }
    if (keep.length > 0 && kept.size === 0) throw new Error(`crew-fire: ${id}'s fire keys none of ${keep.join(', ')}`);
    replaced.push(
      `crew ${id}: rig.py's fire (${existing.listChannels().length} channels) replaced -- the team fires the launcher; ` +
        `${keep.join(', ')} hold its first frame (${kept.size} bones)`
    );
    const accessors = new Set(existing.listSamplers().flatMap((sm) => [sm.getInput(), sm.getOutput()]));
    for (const ch of existing.listChannels()) ch.dispose();
    for (const sm of existing.listSamplers()) sm.dispose();
    existing.dispose();
    for (const a of accessors) if (a && a.listParents().every((p) => p === root)) a.dispose();
  }
  const idle = root.listAnimations().find((a) => a.getName() === 'idle');
  if (!idle) throw new Error(`crew-fire: ${id} has no idle`);
  let rig = new Rig(doc);
  verifyBinds(rig);
  const lines: string[] = [...replaced];
  const g = spec.gunner;
  const prop = rig.node('prop');
  const idleTracks0 = tracksOf(idle);
  const pose0 = rig.sample(idleTracks0, 0);
  const w0 = (n: Node) => rig.worldOf(n, pose0);
  const partWorld = restVertices(rig)
    .filter((v) => v.joint === prop && v.role === ROLE_PART)
    .map((v) => carry(rig, w0, prop, v.p));
  if (partWorld.length < 100) throw new Error(`crew-fire: ${id} has ${partWorld.length} weapon vertices on prop`);

  // --- where the gunner kneels -------------------------------------------
  const rootAt = rig.restWorld.get(rig.node(`${g}_root`))!.t;
  let d: V3;
  let post: { sight: V3; right: V3; left: V3; rear?: V3; muzzle?: V3 } | null = null;
  let wheel: V3 | null = null;
  const gap = spec.eyeGapM ?? EYE_GAP_M;
  const rise = spec.eyeRiseM ?? 0;
  if (spec.seat === 'sight' || spec.seat === 'console') {
    post = spec.seat === 'sight' ? measurePost(partWorld) : consolePoints(root.listScenes()[0].getExtras());
    if (spec.seat === 'console') {
      // The declared GRIPS must be on the case (its `metal` on `prop`): a grip
      // point off the geometry would have the IK close a hand on air, and the
      // pass's own hand gap -- to the TARGET -- cannot see that. Read against
      // the vertices, which on a grip (rings every 3 cm, 3 cm out) is honest;
      // the display's centre is mid-panel, far from any of the lid's eight
      // corners, so it is not judged here (crew_on_gun.test.ts reads the eye
      // against the case's vertices instead).
      const caseWorld = restVertices(rig)
        .filter((v) => v.joint === prop && v.role === 'metal')
        .map((v) => carry(rig, w0, prop, v.p));
      if (caseWorld.length < 50) throw new Error(`crew-fire: ${id} has ${caseWorld.length} metal vertices on prop -- no console`);
      for (const [k, p] of [['grip_r', post.right], ['grip_l', post.left]] as const) {
        const gapM = Math.min(...caseWorld.map((q) => len(sub(q, p))));
        if (gapM > CREW_GRIP_GAP_M) throw new Error(`crew-fire: rl_crew_points.${k} is ${gapM.toFixed(3)} m off the console's own vertices`);
      }
    }
    // Directly behind the sight, at exactly the distance his own torso
    // reaches: his spine base sits where swinging his rest eye about it
    // lands the eye on the target (|target - base| = |eye - base|).
    const eyeTarget: V3 = [post.sight[0] - gap, post.sight[1] + rise, post.sight[2]];
    const head0 = rig.node(`${g}_head`);
    const face0 = restVertices(rig).filter((v) => v.joint === head0 && v.role === 'face');
    // At idle frame 0, after the ground step's raise -- not at rest.
    const eye0: V3 = carry(rig, w0, head0, scale(face0.reduce((s, v) => add(s, v.p), [0, 0, 0] as V3), 1 / Math.max(1, face0.length)));
    const base0 = w0(rig.node(`${g}_spine`)).t;
    const R = len(sub(eye0, base0));
    const dy = eyeTarget[1] - base0[1];
    if (Math.abs(dy) >= R) throw new Error(`crew-fire: ${g} cannot reach the sight height (${dy.toFixed(2)} vs ${R.toFixed(2)})`);
    const horiz = Math.sqrt(R * R - dy * dy);
    d = [eyeTarget[0] - horiz - base0[0], 0, eyeTarget[2] - base0[2]];
  } else {
    const pts = ((root.listScenes()[0].getExtras() ?? {}) as { rl_crew_points?: { handwheel: V3; socket: V3 } }).rl_crew_points;
    if (!pts) throw new Error('crew-fire: mortar_crew has no rl_crew_points (run mortar-graft.ts first)');
    wheel = pts.handwheel;
    // Beside the tube on its right, clear of the baseplate disc.
    // The baseplate: the low vertices round the socket (the bipod's feet are
    // low too, a metre forward, and are not the plate).
    const sock = pts.socket;
    const plate = partWorld.filter((p) => p[1] < 0.06 && Math.hypot(p[0] - sock[0], p[2] - sock[2]) < 0.6);
    const pc: V3 = scale(plate.reduce((a, p) => add(a, p), [0, 0, 0] as V3), 1 / plate.length);
    const pr = Math.max(...plate.map((p) => Math.hypot(p[0] - pc[0], p[2] - pc[2])));
    const want: V3 = [wheel[0] - 0.36, 0, pc[2] + pr + 0.18];
    d = [want[0] - rootAt[0], 0, want[2] - rootAt[2]];
  }
  reseat(doc, rig, g, d);
  rebuildBinds(new Rig(doc));
  rig = new Rig(doc);
  lines.push(`crew ${g}: re-seated at the ${spec.seat}, moved (${d[0].toFixed(2)}, ${d[2].toFixed(2)}) m`);

  const verts = restVertices(rig);
  const head = rig.node(`${g}_head`);
  const face = verts.filter((v) => v.joint === head && v.role === 'face');
  const eyeRest: V3 =
    face.length > 0 ? scale(face.reduce((s, v) => add(s, v.p), [0, 0, 0] as V3), 1 / face.length) : add(rig.restWorld.get(head)!.t, [0.09, 0.04, 0]);
  const seat: Seat = {
    eyeRest,
    ...(post ? { eyeTarget: [post.sight[0] - gap, post.sight[1] + rise, post.sight[2]] as V3, grips: { right: post.right, left: post.left } } : {}),
    ...(wheel ? { wheel } : {}),
    handR: handPoint(rig, verts, rig.node(`${g}_forearm_L`)),
    handL: handPoint(rig, verts, rig.node(`${g}_forearm_R`)),
  };

  // --- idle: re-solved per key ------------------------------------------
  const gunnerBones = ['spine', 'neck', 'head', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R'].map((b) => rig.node(`${g}_${b}`));
  const idleTracks = tracksOf(idle);
  const times = Array.from(new Set([...idleTracks.values()].flatMap((tr) => Array.from(tr.times)))).sort((a, b) => a - b);
  const solved = times.map((t) => {
    const pose = rig.sample(idleTracks, t);
    const gap = seatGunner(rig, pose, g, seat);
    return { pose, gap };
  });
  const worstEye = Math.max(...solved.map((s) => s.gap.eye));
  const worstHand = Math.max(...solved.flatMap((s) => s.gap.hands));
  if (worstHand > CREW_GRIP_GAP_M) throw new Error(`crew-fire: ${g}'s hand is ${worstHand.toFixed(3)} m off its grip in idle`);
  if (post && worstEye > 0.03) throw new Error(`crew-fire: ${g}'s eye is ${worstEye.toFixed(3)} m off its target in idle`);
  for (const b of gunnerBones) {
    writeTrack(doc, idle, b, 'rotation', times, solved.flatMap((s) => [...s.pose.get(b)!.r]));
    writeTrack(doc, idle, b, 'translation', times, solved.flatMap((s) => [...s.pose.get(b)!.t]));
  }
  lines.push(`crew ${g} idle: ${times.length} keys, eye ${post ? `${(worstEye * 1000).toFixed(1)} mm off ${gap} m behind${rise ? ` and ${rise} m above` : ''} the ${spec.seat}` : 'free'}, hands within ${(worstHand * 1000).toFixed(1)} mm`);

  // --- fire: the table on top of the seated idle frame 0 -----------------
  rig = new Rig(doc);
  const idleNow = tracksOf(idle);
  const n = Math.round(spec.durationS * CREW_FIRE_FPS);
  const fireTimes = Array.from({ length: n + 1 }, (_, i) => (i * spec.durationS) / n);
  const tracked = new Set<Node>([...idleNow.values()].map((tr) => tr.node));
  for (const n of kept.keys()) tracked.add(n);
  for (const pfx of [g, spec.mate]) {
    for (const b of ['spine', 'neck', 'head', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R']) tracked.add(rig.node(`${pfx}_${b}`));
  }
  let fireHand = 0;
  const poses = fireTimes.map((t) => {
    const pose = rig.sample(idleNow, 0);
    for (const [n, x] of kept) pose.set(n, x);
    for (const pfx of [g, spec.mate]) {
      const k = lerpKeys(spec.keys[pfx] ?? [], t);
      turn(rig, pose, rig.node(`${pfx}_spine`), k.spine[0], k.spine[1]);
      turn(rig, pose, rig.node(`${pfx}_head`), k.head[0], k.head[1]);
      if (k.reach) {
        // The outboard arm: the mate is on the LEFT, his left arm is rig `_R`.
        rotateWorld(rig, pose, rig.node(`${pfx}_upperarm_R`), qaxis(PITCH_AXIS, deg(k.reach)));
      }
    }
    // The gunner's hands stay on the weapon through the flinch and the duck.
    if (seat.grips) {
      fireHand = Math.max(
        fireHand,
        twoBoneIK(rig, pose, rig.node(`${g}_upperarm_L`), rig.node(`${g}_forearm_L`), seat.handR, seat.grips.right, [-0.2, -1, 0.7]),
        twoBoneIK(rig, pose, rig.node(`${g}_upperarm_R`), rig.node(`${g}_forearm_R`), seat.handL, seat.grips.left, [-0.2, -1, -0.7]),
      );
    }
    if (seat.wheel) {
      fireHand = Math.max(fireHand, twoBoneIK(rig, pose, rig.node(`${g}_upperarm_R`), rig.node(`${g}_forearm_R`), seat.handL, seat.wheel, [-0.2, -1, -0.7]));
    }
    return pose;
  });
  if (fireHand > CREW_GRIP_GAP_M) throw new Error(`crew-fire: ${g}'s hand is ${fireHand.toFixed(3)} m off the weapon in fire`);
  writeClip(doc, 'fire', [...tracked], fireTimes, poses);
  lines.push(`crew ${id} fire: ${spec.durationS} s, ${fireTimes.length} keys at ${CREW_FIRE_FPS} fps, gunner's hands within ${(fireHand * 1000).toFixed(1)} mm`);

  // --- the renderer's fire point for a launcher's backblast --------------
  // (A console team's points are the importer's, measured on its launcher
  // part, and already on the scene.)
  if (post?.rear && post.muzzle) {
    const scene = root.listScenes()[0];
    const rear = post.rear;
    const muzzle = post.muzzle;
    scene.setExtras({
      ...((scene.getExtras() ?? {}) as Record<string, unknown>),
      rl_fire: {
        backblast: rear.map((x) => Math.round(x * 1e4) / 1e4),
        muzzle: muzzle.map((x) => Math.round(x * 1e4) / 1e4),
      },
    });
    lines.push(
      `crew ${id}: rl_fire.backblast at the tube's rear (${rear.map((x) => x.toFixed(2)).join(', ')}), ` +
        `muzzle (${muzzle.map((x) => x.toFixed(2)).join(', ')})`
    );
  }
  return lines;
}

/** The pinned huddle's head drop for a gunner kept on his launcher, degrees. */
export const CREW_PINNED_HEAD_DEG = 10;
/** ...and his spine leans back off the gun by this much, degrees. */
export const CREW_PINNED_BACK_DEG = 8;

/**
 * The ATGM gunner in `pinned` (run after `pinned.ts`): the huddle folds every
 * figure 40 deg forward at the spine, and a gunner already seated with his eye
 * at the sight folds straight into the launcher -- measured, 397 post samples
 * inside his head and 60 inside his torso. He keeps his seat instead, sits back
 * off the launcher with his hands off the grips, and ducks his head: down
 * behind the gun.
 */
export function applyCrewPinned(doc: Document, id: string): string[] {
  const spec = CREW_FIRE[id];
  if (!spec || (spec.seat !== 'sight' && spec.seat !== 'console')) return [];
  const root = doc.getRoot();
  const idle = root.listAnimations().find((a) => a.getName() === 'idle');
  const pinned = root.listAnimations().find((a) => a.getName() === 'pinned');
  if (!idle || !pinned) return [];
  const rig = new Rig(doc);
  const g = spec.gunner;
  const prop = rig.node('prop');
  const idleT = tracksOf(idle);
  const pinT = tracksOf(pinned);
  const pose0 = rig.sample(idleT, 0);
  const post =
    spec.seat === 'console'
      ? consolePoints(root.listScenes()[0].getExtras())
      : measurePost(
          restVertices(rig)
            .filter((v) => v.joint === prop && v.role === ROLE_PART)
            .map((v) => carry(rig, (n) => rig.worldOf(n, pose0), prop, v.p))
        );
  const verts = restVertices(rig);
  const handR = handPoint(rig, verts, rig.node(`${g}_forearm_L`));
  const handL = handPoint(rig, verts, rig.node(`${g}_forearm_R`));
  const bones = ['spine', 'neck', 'head', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R'].map((b) => rig.node(`${g}_${b}`));
  const times = Array.from(new Set([...pinT.values()].flatMap((tr) => Array.from(tr.times)))).sort((a, b) => a - b);
  let worst = 0;
  const poses = times.map((t) => {
    const pose = rig.sample(pinT, t);
    const seated = rig.sample(idleT, t);
    for (const b of bones) pose.set(b, seated.get(b)!);
    turn(rig, pose, rig.node(`${g}_spine`), -CREW_PINNED_BACK_DEG, 0);
    turn(rig, pose, rig.node(`${g}_head`), CREW_PINNED_HEAD_DEG, 0);
    // His hands come off the grips as he sits back: reported, not held.
    const w = (n: Node) => rig.worldOf(n, pose);
    worst = Math.max(
      worst,
      len(sub(carry(rig, w, rig.node(`${g}_forearm_L`), handR), post.right)),
      len(sub(carry(rig, w, rig.node(`${g}_forearm_R`), handL), post.left))
    );
    return pose;
  });
  for (const b of bones) {
    writeTrack(doc, pinned, b, 'rotation', times, poses.flatMap((p) => [...p.get(b)!.r]));
    writeTrack(doc, pinned, b, 'translation', times, poses.flatMap((p) => [...p.get(b)!.t]));
  }
  return [`crew ${g} pinned: sat back ${CREW_PINNED_BACK_DEG} deg off the launcher, head down ${CREW_PINNED_HEAD_DEG} deg, hands ${(worst * 1000).toFixed(1)} mm off the grips`];
}
