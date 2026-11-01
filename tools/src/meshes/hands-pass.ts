/**
 * `pnpm hands:meshes` -- the infantry hands pass (GH-826 step 2). Pipeline order, load-bearing:
 *
 *   export (Blender) -> THIS -> motion:meshes -> gait:meshes -> kit:meshes --teams -> encode:meshes
 *
 * It runs over a team's importer output, the bytes BEFORE the motion pass (`art/meshes/<id>.glb` at the rev the
 * motion pass records as `rl_motion.base`, `--from=<rev>`; the Meshy sources the importers cut these bodies from
 * are not in the repo, which is why this is a GLB pass). It does five things to each figure, and nothing else:
 *
 *   elbow     the forearm joint moves UP the arm to 0.615 of the figure's stature, where a man's elbow is
 *             (the cut had put it at the middle of the forearm, 0.953 m on a 1.78 m body). The sleeve between the
 *             old elbow and the new one is re-bound from the upper-arm bone to the forearm bone, and the part of
 *             the sleeve and the elbow ball that hung BELOW the old elbow, with the old forearm, is cut away;
 *   forearm   a 12-sided, 5-ring tapered tube from inside the sleeve to the wrist, 0.268 m from the elbow, bound
 *             to the forearm bone, coloured by a solid texel of the team's own atlas (the sleeve's), ending 0.015 m
 *             short of the glove's cuff so the sleeve overlaps it;
 *   hands     a modelled, gloved hand (`tools/units/hands.py`, library `art/parts/hands/hands_lib.glb`) rigid on a
 *             NEW bone `{prefix}_hand_{L|R}` at the wrist, the firing hand's index finger a part of its own on
 *             `{prefix}_finger_L`, and a corpse fist on `{prefix}_fist_{L|R}` that replaces the hand in `down`,
 *             `fall` and `wreck` (the importer's bodies have no corpse twin: the living body lies down);
 *   weapon    the Meshy carbine's fist-sized grip block goes with the carbine: each man's weapon is replaced by
 *             the reshaped part (`art/parts/kdf_carbine/kdf_carbine.glb`, its UVs on the same atlas crop), seated
 *             where the old one rode (`forearm_R`), its frame written to `extras.rl_hands`;
 *   clips     every key the moved forearm had is carried over, so the arm moves as it did, straight now.
 *
 * What it refuses, so a mistake cannot ship quietly: a file that is already through the motion or hands pass; a
 * forearm stretched more than 3x; a figure whose weapon is not 315 triangles; a missing hand part; a figure
 * with the wrong number of arm vertices to cut. Everything is deterministic (no noise, no clock).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Animation, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { addBone, writeTrack } from './motion/edit';
import { describeHold } from './motion/hold';
import { add, cross, dot, invert, len, norm, qaxis, qmul, qconj, qrot, scale, sub, toMat4, type Q, type V3, type Xf } from './motion/math';
import { clipRange, Rig, restVertices, tracksOf } from './motion/rig';
import {
  addVertex, bindTo, columnsOf, dominant, loftEllipses, orthoFrame, qfromColumns, readParts, readPrim, removeFaces, vert, vertexCount,
  writePrim, type PartMesh,
} from './hands-geometry';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

export const HANDS_VERSION = 1;
/** The elbow's height over the figure's stature (ANSUR elbow height, standing, over stature). */
export const ELBOW_OVER_STATURE = 0.615;
/** Elbow joint to the wrist crease, the hand bone's head (ANSUR radiale to stylion). */
export const FOREARM_M = 0.268;
/** The sleeve covers the glove's cuff this far. */
export const SLEEVE_OVER_CUFF_M = 0.015;
export const CUFF_LEN_M = 0.030;
export const MAX_STRETCH = 3.0;
/** The part's butt plate, from its centre, metres. */
export const PART_BUTT_X = -0.425;
export const PART_TRIANGLES_OLD = 315;
/** Clips in which the living body lies dead: the fist replaces the hand. */
export const DEAD_CLIPS: readonly string[] = ['down', 'fall', 'wreck'];

export interface SleevePatch { readonly rect: readonly [number, number, number, number]; readonly down: boolean }

/** The tube's section where it leaves the sleeve (half extents, metres) at most: full 0.104 x 0.080. Left and right alike. */
export const FOREARM_TOP_A_MAX = 0.052;
export const FOREARM_TOP_B_MAX = 0.040;

export interface HandsTeam {
  /** The anatomical RIGHT hand's bone side (rig.py's `_L`): the firing hand. */
  readonly figures: readonly string[];
  readonly glove: readonly [number, number];
  /** Solid texels of the sleeve, per bone side. */
  readonly sleeve: { readonly L: readonly [number, number]; readonly R: readonly [number, number] };
  /**
   * The old forearm's own sleeve cloth, per bone side: the pixel rectangle of the atlas the old forearm's largest UV island
   * covers (x, y, width, height), and whether the arm runs up the rectangle (v increases with the distance from the elbow)
   * or down it. The new tube stretches this over its length and mirrors it across its circumference (no seam).
   */
  readonly sleevePatch: { readonly L: SleevePatch; readonly R: SleevePatch };
  readonly atlas: readonly [number, number];
  /** The review's measured sleeve below the old elbow, metres (only to print the stretch). */
  readonly oldSleeve: { readonly L: number; readonly R: number };
}

export const HANDS_TEAMS: Record<string, HandsTeam> = {
  inf_squad: {
    figures: ['f0', 'f1', 'f2'],
    // limestone.7 #75624A: (119,100,75), dE 1.10 to its key, a real 5 x 5 solid block of this atlas (spec 1.5)
    glove: [540, 594],
    // the sleeve's own colour, solid 5 x 5 blocks within dE 0.1 of the review's sleeve means (36.0,-8.4,8.7) / (32.2,-9.1,9.2)
    sleeve: { L: [339, 370], R: [418, 142] },
    // the old forearm's own islands (the largest of each side, inside the olive-green cloth: mean dE 1.1 / 2.1 to the sleeve means above)
    sleevePatch: { L: { rect: [474, 620, 64, 90], down: true }, R: { rect: [284, 408, 44, 78], down: false } },
    atlas: [2048, 1024],
    oldSleeve: { L: 0.04, R: 0.1 },
  },
  demo_squad: {
    // demo_b is listed first, as the motion table lists him; demo_a is armed with the same carbine (GH-826 step 3).
    figures: ['demo_b', 'demo_a'],
    // dust.6 #6B4F29 (107,79,41), a real 5 x 5 solid block of the figure bake (std < 2), dE 0.10 to its key. The figure keeps
    // pixels 0..1023 of the 2048 x 1024 atlas, so this is the same texel the kit names for coyote_shade.
    glove: [805, 792],
    // solid 5 x 5 blocks within dE 0.07 of the review's sleeve mean (34.3, -5.7, 17.0), rgb (81, 82, 53)
    sleeve: { L: [879, 893], R: [876, 130] },
    // Departure 42: the old forearm's own UV islands are fragments of plain olive (the largest all-cloth rectangles are 12 x 9
    // and 17 x 39 px, texel std 2 to 3 of 255), so this body's sleeve cloth is taken from the atlas's own all-cloth rectangle with
    // the most texture: 48 x 24 px, mean dE76 2.3 to the sleeve, std 6.9 (the upper arm reads 7 to 11 at its vertices).
    sleevePatch: { L: { rect: [205, 187, 48, 24], down: false }, R: { rect: [205, 187, 48, 24], down: false } },
    atlas: [2048, 1024],
    oldSleeve: { L: 0.12, R: 0.13 },
  },
};

export interface HandsLib {
  readonly parts: Map<string, PartMesh>;
  readonly lib: {
    stations: {
      grip: { R: number[][]; t: number[]; x_ref: number; ref: number[]; finger: { pivot: number[]; axis: number[]; trigger_deg: number } };
      support: { R: number[][]; t: number[]; x_ref: number; ref: number[] };
    };
    triangles: { living: number; fist: number };
  };
}

export async function loadHandsLib(file = path.join(REPO, 'art', 'parts', 'hands', 'hands_lib.glb')): Promise<HandsLib> {
  const { parts, sceneExtras } = await readParts(file);
  const raw = sceneExtras.rl_hands_lib;
  if (typeof raw !== 'string') throw new Error(`hands: ${file} has no rl_hands_lib scene extras`);
  return { parts, lib: JSON.parse(raw) };
}

export interface CarbinePart {
  readonly mesh: PartMesh;
}

export async function loadCarbine(file = path.join(REPO, 'art', 'parts', 'kdf_carbine', 'kdf_carbine.glb')): Promise<CarbinePart> {
  const { parts } = await readParts(file);
  const mesh = [...parts.values()][0];
  if (!mesh) throw new Error(`hands: ${file} has no mesh`);
  return { mesh };
}

const SIDES = 12;
/**
 * The UV of ring `k` (of 5), column `col` (of 12) of a forearm tube: the old sleeve's patch, stretched along the tube and
 * mirrored across the circumference (u runs 0 to 1 over half the turn and back), so there is no seam to tear.
 */
export function sleevePatchUv(patch: SleevePatch, atlas: readonly [number, number], k: number, col: number, rings = 5): [number, number] {
  const [x, y, w, h] = patch.rect;
  const theta = (2 * Math.PI * col) / SIDES;
  const uu = Math.abs(((theta + Math.PI) % (2 * Math.PI)) - Math.PI) / Math.PI;
  const f = k / (rings - 1);
  const vv = patch.down ? 1 - f : f;
  return [(x + 0.5 + uu * (w - 1)) / atlas[0], (y + 0.5 + vv * (h - 1)) / atlas[1]];
}

const texelUv = (t: readonly [number, number], atlas: readonly [number, number]): [number, number] => [(t[0] + 0.5) / atlas[0], (t[1] + 0.5) / atlas[1]];

/** Blender part frame (x forward, y across, z up) -> glTF (x forward, y up, z the figure's right): a proper rotation. */
const bToG = (v: V3): V3 => [v[0], v[2], -v[1]];

export interface FigureReport {
  readonly prefix: string;
  readonly lines: string[];
}

function sceneExtras(doc: Document): Record<string, unknown> {
  return (doc.getRoot().listScenes()[0].getExtras() ?? {}) as Record<string, unknown>;
}

/** The ellipse a ring of `pts` makes in the plane square to `axis`: centre offset (in the plane), two unit axes, half-extents. */
function sectionOf(pts: V3[], origin: V3, axis: V3): { off: V3; u: V3; v: V3; a: number; b: number } {
  // plane coordinates
  const ref: V3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const e1 = norm(sub(ref, scale(axis, dot(ref, axis))));
  const e2 = cross(axis, e1);
  const xy = pts.map((p) => { const d = sub(p, origin); return [dot(d, e1), dot(d, e2)] as [number, number]; });
  const cx = xy.reduce((s, q) => s + q[0], 0) / xy.length, cy = xy.reduce((s, q) => s + q[1], 0) / xy.length;
  // principal axes of the 2D scatter
  let sxx = 0, sxy = 0, syy = 0;
  for (const q of xy) { const dx = q[0] - cx, dy = q[1] - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(th), s = Math.sin(th);
  const u2: [number, number] = [c, s], v2: [number, number] = [-s, c];
  const proj = (w: [number, number]) => xy.map((q) => (q[0] - cx) * w[0] + (q[1] - cy) * w[1]).map(Math.abs).sort((x, y) => x - y);
  const pu = proj(u2), pv = proj(v2);
  const q80 = (arr: number[]) => arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.8))];
  const u = add(scale(e1, u2[0]), scale(e2, u2[1]));
  const v = add(scale(e1, v2[0]), scale(e2, v2[1]));
  return { off: add(scale(e1, cx), scale(e2, cy)), u, v, a: q80(pu), b: q80(pv) };
}

/** True when a clip scales the figure's living root to nothing for its whole length: nothing on that body is drawn in it. */
export function livingBodyHidden(anim: Animation, prefix: string): boolean {
  if (!DEAD_CLIPS.includes(anim.getName())) return false;
  const root = anim.listChannels().find((c) => c.getTargetNode()?.getName() === `${prefix}_root` && c.getTargetPath() === 'scale');
  if (!root) return false;
  const v = root.getSampler()!.getOutput()!.getArray() as Float32Array;
  return v.length > 0 && Array.from(v).every((x) => Math.abs(x) < 1e-6);
}

export interface ArmPlan {
  readonly prefix: string;
  readonly side: 'L' | 'R';
  readonly S: V3;
  readonly d: V3;
  readonly tOld: number;
  readonly tE: number;
  readonly Enew: V3;
  readonly W: V3;
}

export function runHandsPass(doc: Document, id: string, spec: HandsTeam, lib: HandsLib, carbine: CarbinePart, base: string): FigureReport[] {
  const ex = sceneExtras(doc);
  if (ex.rl_motion) throw new Error(`${id}: already through the motion pass (${JSON.stringify(ex.rl_motion)}): the hands pass runs BEFORE it`);
  if (ex.rl_hands) throw new Error(`${id}: already through the hands pass (${JSON.stringify(ex.rl_hands)})`);
  for (const k of ['inf_grip_R', 'inf_grip_R_index', 'inf_support_L', 'inf_fist_R', 'inf_fist_L']) {
    if (!lib.parts.has(k)) throw new Error(`${id}: the hand library has no ${k}`);
  }
  const uniformNode = doc.getRoot().listNodes().find((n) => n.getName() === 'uniform' && n.getMesh());
  const weaponNode = doc.getRoot().listNodes().find((n) => n.getName() === 'weapon' && n.getMesh());
  if (!uniformNode || !weaponNode) throw new Error(`${id}: no uniform or weapon mesh`);
  const uPrim = uniformNode.getMesh()!.listPrimitives();
  const wPrim = weaponNode.getMesh()!.listPrimitives();
  if (uPrim.length !== 1 || wPrim.length !== 1) throw new Error(`${id}: expected one primitive per role`);
  const U = readPrim(uPrim[0]);
  const Wp = readPrim(wPrim[0]);

  let rig = new Rig(doc);
  const allVerts = restVertices(rig);
  const joints0 = rig.skin.listJoints();
  const jointIndex = (n: Node): number => {
    const i = rig.skin.listJoints().indexOf(n);
    if (i < 0) throw new Error(`${id}: ${n.getName()} is not in the skin`);
    return i;
  };
  const out: FigureReport[] = [];
  // 1. what the old weapons were: the frame the hold measured on them (before anything moves)
  const oldHolds = new Map(spec.figures.map((p) => [p, describeHold(rig, allVerts, p, 'rifle')]));
  // plans, from the untouched rig
  const plans: ArmPlan[] = [];
  const staturePer = new Map<string, number>();
  for (const p of spec.figures) {
    const own = allVerts.filter((v) => v.joint.getName().startsWith(`${p}_`) && v.role !== 'weapon');
    const top = Math.max(...own.map((v) => v.p[1]));
    staturePer.set(p, top);
    for (const side of ['L', 'R'] as const) {
      const up = rig.node(`${p}_upperarm_${side}`);
      const fo = rig.node(`${p}_forearm_${side}`);
      const S = rig.restWorld.get(up)!.t;
      const Eold = rig.restWorld.get(fo)!.t;
      const d = norm(sub(Eold, S));
      const tOld = len(sub(Eold, S));
      const yElbow = ELBOW_OVER_STATURE * top;
      const tE = (yElbow - S[1]) / d[1];
      if (!(tE > 0.05 && tE < tOld)) throw new Error(`${id} ${p}_${side}: the new elbow is ${tE.toFixed(3)} m down the arm, not between the pivot and the old elbow ${tOld.toFixed(3)}`);
      const Enew = add(S, scale(d, tE));
      plans.push({ prefix: p, side, S, d, tOld, tE, Enew, W: add(Enew, scale(d, FOREARM_M)) });
    }
  }

  // 2. the weapon: drop the 3 Meshy carbines, remember where each one rode
  const weaponFrames = new Map<string, { origin: V3; q: Q }>();
  for (const p of spec.figures) {
    const h = oldHolds.get(p)!;
    const q = (() => {
      const z = norm(cross(h.axis, h.up));
      const y = cross(z, h.axis);
      return qfromColumns(norm(h.axis), y, z);
    })();
    weaponFrames.set(p, { origin: add(h.butt, scale(h.axis, -PART_BUTT_X)), q });
  }
  const forearmR = new Map(spec.figures.map((p) => [p, jointIndex(rig.node(`${p}_forearm_R`))]));
  const oldWeaponTris = Wp.idx.length / 3;
  if (oldWeaponTris !== PART_TRIANGLES_OLD * spec.figures.length) {
    throw new Error(`${id}: the weapon primitive has ${oldWeaponTris} triangles, expected ${PART_TRIANGLES_OLD * spec.figures.length} (three Meshy carbines)`);
  }
  removeFaces(Wp, () => true);
  const [atlasW, atlasH] = spec.atlas;
  void atlasH;
  for (const p of spec.figures) {
    const fr = weaponFrames.get(p)!;
    const m = carbine.mesh;
    const base0 = vertexCount(Wp);
    for (let i = 0; i < m.pos.length / 3; i++) {
      const lp: V3 = [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
      const ln: V3 = [m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]];
      // the part's atlas crop is the right half of the team atlas, stretched across u
      const uv: [number, number] = [0.5 + m.uv[i * 2] / 2, m.uv[i * 2 + 1]];
      addVertex(Wp, add(fr.origin, qrot(fr.q, lp)), norm(qrot(fr.q, ln)), uv, forearmR.get(p)!);
    }
    for (const i of m.idx) Wp.idx.push(base0 + i);
  }

  // 3. bones and geometry, arm by arm
  const lines = new Map<string, string[]>(spec.figures.map((p) => [p, []]));
  const L = (p: string, s: string) => lines.get(p)!.push(s);
  const glove = texelUv(spec.glove, spec.atlas);
  const handBones = new Map<string, { hand: Node; finger?: Node; fist: Node; frame: { x: V3; y: V3; z: V3 }; W: V3 }>();
  const boneWork: { plan: ArmPlan; handRest: Xf }[] = [];

  // 3a. vertices of the arms first, from the untouched rig (indices of joints are stable: bones are only appended)
  for (const plan of plans) {
    const { prefix: p, side, S, d, tOld, tE } = plan;
    const jU = jointIndex(rig.node(`${p}_upperarm_${side}`));
    const jF = jointIndex(rig.node(`${p}_forearm_${side}`));
    const sleeveUv0 = texelUv(spec.sleeve[side], spec.atlas);
    const t = (i: number): number => dot(sub(vert(U, i), S), d);
    // The elbow ball: a flat-coloured piece (its triangles have no UV area) centred on the old elbow. It moves with the
    // elbow, and takes the sleeve's colour (it sampled the glove's).
    const uvArea = (a: number, b: number, c: number): number =>
      Math.abs((U.uv[b * 2] - U.uv[a * 2]) * (U.uv[c * 2 + 1] - U.uv[a * 2 + 1]) - (U.uv[c * 2] - U.uv[a * 2]) * (U.uv[b * 2 + 1] - U.uv[a * 2 + 1])) / 2;
    const blob = new Set<number>();
    for (let f = 0; f < U.idx.length / 3; f++) {
      const a = U.idx[f * 3], b = U.idx[f * 3 + 1], c = U.idx[f * 3 + 2];
      if (dominant(U, a) !== jU || dominant(U, b) !== jU || dominant(U, c) !== jU || uvArea(a, b, c) > 1e-7) continue;
      const cen = scale(add(add(vert(U, a), vert(U, b)), vert(U, c)), 1 / 3);
      if (len(sub(cen, add(S, scale(d, tOld)))) > 0.08) continue;
      blob.add(a); blob.add(b); blob.add(c);
    }
    const shift = sub(plan.Enew, add(S, scale(d, tOld)));
    for (const i of blob) {
      U.pos[i * 3] += shift[0]; U.pos[i * 3 + 1] += shift[1]; U.pos[i * 3 + 2] += shift[2];
      U.uv[i * 2] = sleeveUv0[0]; U.uv[i * 2 + 1] = sleeveUv0[1];
    }
    // faces of the old forearm (sleeve and claw) go; so does the lower half of the cloth below the old elbow
    let foreFaces = 0, lowerFaces = 0;
    const r = removeFaces(U, (_f, a, b, c) => {
      const ja = dominant(U, a), jb = dominant(U, b), jc = dominant(U, c);
      if (ja === jF || jb === jF || jc === jF) { foreFaces++; return true; }
      if (blob.has(a) && blob.has(b) && blob.has(c)) return false;
      if (ja === jU && jb === jU && jc === jU && (t(a) + t(b) + t(c)) / 3 > tOld) { lowerFaces++; return true; }
      return false;
    });
    // the sleeve between the new elbow and the old one rides the forearm now (the ball, and cloth flapping far off
    // the arm, stay on the upper-arm bone, which `tidy` folds in as it always has)
    let rebound = 0;
    const seamPts: V3[] = [];
    for (let i = 0; i < vertexCount(U); i++) {
      if (dominant(U, i) !== jU) continue;
      const ti = t(i);
      const q = vert(U, i);
      const rad = len(sub(sub(q, S), scale(d, ti)));
      const isBlob = U.uv[i * 2] === sleeveUv0[0] && U.uv[i * 2 + 1] === sleeveUv0[1];
      if (ti > tE && rad <= 0.09 && !isBlob) { bindTo(U, i, jF); rebound++; }
      if (ti > tOld - 0.15 && ti < tOld + 0.0 && rad < 0.1 && !isBlob) seamPts.push(q);
    }
    if (seamPts.length < 8) throw new Error(`${id} ${p}_${side}: only ${seamPts.length} sleeve vertices near the old elbow to take a section from`);
    L(p, `arm ${side}: elbow ${(plan.Enew[1]).toFixed(3)} m (was ${(S[1] + d[1] * tOld).toFixed(3)}), cut ${foreFaces} forearm + ${lowerFaces} elbow-ball faces (${r.verts} vertices), re-bound ${rebound} sleeve vertices to the forearm`);

    // 3b. the forearm tube, from inside the sleeve to 0.015 short of the cuff
    const sec = sectionOf(seamPts, add(S, scale(d, tOld - 0.07)), d);
    const tTop = tOld - 0.04;
    const tEnd = tE + FOREARM_M - SLEEVE_OVER_CUFF_M - 0.0;
    const tWrist = tE + FOREARM_M;
    // the tube ends over the glove's cuff: the cuff is 0.074 x 0.056 at its rim (hands.py), the sleeve a hair over it
    const endA = 0.043, endB = 0.034;
    // A sleeved forearm is an ellipse, not a round tube: about 0.095 x 0.078 at mid. The firing side's old section was round and
    // 0.11 x 0.11 there, so the top is capped, and the same cap on both sides keeps the two arms within 1 cm.
    const topA = Math.min(sec.a * 0.92, FOREARM_TOP_A_MAX), topB = Math.min(sec.b * 0.92, FOREARM_TOP_B_MAX);
    const rings = [] as { c: V3; u: V3; v: V3; a: number; b: number }[];
    const nR = 5;
    for (let k = 0; k < nR; k++) {
      const f = k / (nR - 1);
      const tk = tTop + (tEnd - tTop) * f;
      const w = f * f * (3 - 2 * f);
      const off = scale(sec.off, 1 - w);
      // the section's axes are the seam's; they turn to the hand's (x across) by the end
      rings.push({ c: add(add(S, scale(d, tk)), off), u: sec.u, v: sec.v, a: topA + (endA - topA) * w, b: topB + (endB - topB) * w });
    }
    void tWrist;
    const tube = loftEllipses(rings, SIDES);
    const base0 = vertexCount(U);
    const patch = spec.sleevePatch[side];
    tube.pos.forEach((q, i) => addVertex(U, q, tube.nrm[i], sleevePatchUv(patch, spec.atlas, Math.floor(i / SIDES), i % SIDES), jF));
    for (const tr of tube.tri) U.idx.push(base0 + tr[0], base0 + tr[1], base0 + tr[2]);
    const stretch = FOREARM_M / ((tOld - tE) + spec.oldSleeve[side]);
    if (stretch > MAX_STRETCH) throw new Error(`${id} ${p}_${side}: the forearm is stretched ${stretch.toFixed(2)}x, the limit is ${MAX_STRETCH}`);
    L(p, `arm ${side}: forearm tube ${tube.tri.length} triangles, section ${(sec.a * 1000).toFixed(0)}x${(sec.b * 1000).toFixed(0)} mm at the seam, stretch ${stretch.toFixed(2)}x (limit ${MAX_STRETCH})`);
    boneWork.push({ plan, handRest: { t: plan.W, r: [0, 0, 0, 1], s: 1 } });
  }

  // write the arrays now, so the bones' IBMs and the vertices agree when the rig is rebuilt
  writePrim(uPrim[0], U);
  writePrim(wPrim[0], Wp);

  // 4. the bones: forearm re-rested, hand, finger, fist
  for (const plan of plans) {
    const { prefix: p, side, tE } = plan;
    rig = new Rig(doc);
    const up = rig.node(`${p}_upperarm_${side}`);
    const fo = rig.node(`${p}_forearm_${side}`);
    const upW = rig.restWorld.get(up)!;
    const oldLocal = rig.rest.get(fo)!;
    const G: Q = qmul([0, 0, 0, 1], qconj(oldLocal.r));      // new rest rotation (identity) times the old one's inverse
    fo.setTranslation([0, tE, 0]);
    fo.setRotation([0, 0, 0, 1]);
    // every key the forearm had, kept as motion RELATIVE to its rest, now relative to the new one
    for (const anim of doc.getRoot().listAnimations()) {
      for (const c of anim.listChannels()) {
        if (c.getTargetNode() !== fo) continue;
        const out = c.getSampler()!.getOutput()!;
        const v = (out.getArray() as Float32Array).slice();
        if (c.getTargetPath() === 'rotation') {
          for (let i = 0; i < v.length; i += 4) {
            const q = qmul(G, [v[i], v[i + 1], v[i + 2], v[i + 3]]);
            v[i] = q[0]; v[i + 1] = q[1]; v[i + 2] = q[2]; v[i + 3] = q[3];
          }
        } else if (c.getTargetPath() === 'translation') {
          for (let i = 0; i < v.length; i += 3) {
            const dev = Math.hypot(v[i] - oldLocal.t[0], v[i + 1] - oldLocal.t[1], v[i + 2] - oldLocal.t[2]);
            // The KDF importer's dead clips leave stray keys on a living bone whose root is scaled to nothing (demo_squad's
            // forearm sat at y -1.69 in `down`): the body is not drawn, so the key is irrelevant and is reset to the new rest.
            if (dev > 1e-4 && !livingBodyHidden(anim, p)) throw new Error(`${id} ${fo.getName()} ${anim.getName()}: a translation key ${dev.toFixed(4)} m off its rest: not constant, refused`);
            v[i] = 0; v[i + 1] = tE; v[i + 2] = 0;
          }
        } else continue;
        const fresh = doc.createAccessor().setType(c.getTargetPath() === 'rotation' ? 'VEC4' : 'VEC3').setArray(v).setBuffer(doc.getRoot().listBuffers()[0]);
        c.getSampler()!.setOutput(fresh);
        if (out.listParents().every((x) => x === doc.getRoot())) out.dispose();
      }
    }
    const foW = { t: plan.Enew, r: upW.r, s: 1 };
    const ibm = rig.skin.getInverseBindMatrices()!;
    const arr = (ibm.getArray() as Float32Array).slice();
    arr.set(toMat4(invert(foW)), jointIndex(fo) * 16);
    ibm.setArray(arr);

    // hand frame: y down the arm, x across (thumb forward), z dorsal
    const frame = orthoFrame(plan.d, side === 'L' ? [-1, 0, 0] : [1, 0, 0]);
    const hq = qfromColumns(frame.x, frame.y, frame.z);
    rig = new Rig(doc);
    const hand = addBone(doc, rig, `${p}_hand_${side}`, fo, { t: plan.W, r: hq, s: 1 });
    rig = new Rig(doc);
    const fist = addBone(doc, rig, `${p}_fist_${side}`, fo, { t: plan.W, r: hq, s: 1 });
    let finger: Node | undefined;
    if (side === 'L') {
      rig = new Rig(doc);
      const fp = lib.lib.stations.grip.finger;
      const pivot: V3 = [fp.pivot[0], fp.pivot[1], fp.pivot[2]];
      const al = Math.atan2(fp.axis[1], fp.axis[0]);
      const fq = qmul(hq, qaxis([0, 0, 1], al));
      const fw = add(plan.W, qrot(hq, pivot));
      finger = addBone(doc, rig, `${p}_finger_L`, rig.node(`${p}_hand_L`), { t: fw, r: fq, s: 1 });
    }
    handBones.set(`${p}_${side}`, { hand, ...(finger ? { finger } : {}), fist, frame, W: plan.W });
  }

  // 5. the hands' vertices, the cuff's included, bound to the new bones
  rig = new Rig(doc);
  const U2 = readPrim(uPrim[0]);
  for (const plan of plans) {
    const { prefix: p, side } = plan;
    const hb = handBones.get(`${p}_${side}`)!;
    const R = hb.frame;
    const place = (m: PartMesh, jointNode: Node): number => {
      const j = jointIndex(jointNode);
      const base0 = vertexCount(U2);
      for (let i = 0; i < m.pos.length / 3; i++) {
        const lp: V3 = [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
        const ln: V3 = [m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]];
        const wp = add(hb.W, add(add(scale(R.x, lp[0]), scale(R.y, lp[1])), scale(R.z, lp[2])));
        const wn = norm(add(add(scale(R.x, ln[0]), scale(R.y, ln[1])), scale(R.z, ln[2])));
        addVertex(U2, wp, wn, glove, j);
      }
      for (const i of m.idx) U2.idx.push(base0 + i);
      return m.idx.length / 3;
    };
    let tris = 0;
    if (side === 'L') {
      tris += place(lib.parts.get('inf_grip_R')!, hb.hand);
      tris += place(lib.parts.get('inf_grip_R_index')!, hb.finger!);
    } else tris += place(lib.parts.get('inf_support_L')!, hb.hand);
    const fistTris = place(lib.parts.get(side === 'L' ? 'inf_fist_R' : 'inf_fist_L')!, hb.fist);
    L(p, `hand ${side}: ${tris} triangles on ${hb.hand.getName()}${hb.finger ? ` + ${hb.finger.getName()}` : ''}, fist ${fistTris} on ${hb.fist.getName()}`);
  }
  writePrim(uPrim[0], U2);

  // 6. every clip keys the new bones (rest values), the hand or the fist hidden by scale
  rig = new Rig(doc);
  for (const anim of doc.getRoot().listAnimations()) {
    const [lo, hi] = clipRange(tracksOf(anim));
    const dead = DEAD_CLIPS.includes(anim.getName());
    for (const plan of plans) {
      const hb = handBones.get(`${plan.prefix}_${plan.side}`)!;
      for (const [node, visible] of [[hb.hand, !dead], [hb.fist, dead], ...(hb.finger ? [[hb.finger, !dead] as [Node, boolean]] : [])] as [Node, boolean][]) {
        const rest = rig.rest.get(node)!;
        const s = visible ? 1 : 0;
        writeTrack(doc, anim, node, 'translation', [lo, hi], [...rest.t, ...rest.t]);
        writeTrack(doc, anim, node, 'rotation', [lo, hi], [...rest.r, ...rest.r]);
        writeTrack(doc, anim, node, 'scale', [lo, hi], [s, s, s, s, s, s]);
      }
    }
  }

  // 7. what the motion pass needs to find: the weapons' frames and the hands' stations, in glTF axes
  const st = lib.lib.stations;
  const station = (sm: { R: number[][]; t: number[] }) => ({
    R: [0, 1, 2].map((r) => {
      // R_g = C R_b with C = bToG: rows of R_b permuted
      const rb = sm.R;
      return r === 0 ? rb[0] : r === 1 ? rb[2] : rb[1].map((x) => -x);
    }),
    t: bToG([sm.t[0], sm.t[1], sm.t[2]]),
  });
  const gripS = station(st.grip);
  const supS = station(st.support);
  const pivotG = st.grip.finger;
  void pivotG;
  const rl_hands = {
    version: HANDS_VERSION,
    base,
    triangles: lib.lib.triangles,
    glove: spec.glove,
    forearm_m: FOREARM_M,
    elbow_over_stature: ELBOW_OVER_STATURE,
    stations: {
      // hand-local -> the part's own glTF frame (x forward, y up, z the figure's right); firing hand = bone `_L`
      grip: { R: gripS.R, t: gripS.t, bone_side: 'L', x_ref: st.grip.x_ref, ref: st.grip.ref },
      support: { R: supS.R, t: supS.t, bone_side: 'R', x_ref: st.support.x_ref, ref: st.support.ref },
      finger: { pivot: st.grip.finger.pivot, axis: st.grip.finger.axis, trigger_deg: st.grip.finger.trigger_deg },
    },
    // the weapon's frame at its rest seat, with the figure's root as it was: the wedge moves a figure's root afterwards
    // (`motion/formation.ts`), and the frame moves with it (`weaponFrameOf`)
    weapons: Object.fromEntries(spec.figures.map((p) => {
      const rw = rig.restWorld.get(rig.node(`${p}_root`))!;
      return [p, {
        origin: weaponFrames.get(p)!.origin.map((x) => +x.toFixed(6)), q: weaponFrames.get(p)!.q.map((x) => +x.toFixed(8)),
        root: { t: rw.t.map((x) => +x.toFixed(6)), r: rw.r.map((x) => +x.toFixed(8)) },
      }];
    })),
    part: { triangles: carbine.mesh.idx.length / 3, butt_x: PART_BUTT_X },
  };
  doc.getRoot().listScenes()[0].setExtras({ ...ex, rl_hands: rl_hands as unknown as Record<string, unknown> });

  for (const p of spec.figures) {
    const own = lines.get(p)!;
    own.push(`weapon: Meshy carbine replaced by the reshaped part, ${carbine.mesh.idx.length / 3} triangles`);
    out.push({ prefix: p, lines: own });
  }
  void joints0;
  void atlasW;
  void cross;
  void columnsOf;
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const only = args.find((a) => a.startsWith('--id='))?.slice(5);
  const from = args.find((a) => a.startsWith('--from='))?.slice(7);
  const inFile = args.find((a) => a.startsWith('--in='))?.slice(5);
  const outFile = args.find((a) => a.startsWith('--out='))?.slice(6);
  const baseLabel = args.find((a) => a.startsWith('--base='))?.slice(7);
  const ids = only ? only.split(',') : Object.keys(HANDS_TEAMS);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const lib = await loadHandsLib();
  const carbine = await loadCarbine();
  for (const id of ids) {
    const spec = HANDS_TEAMS[id];
    if (!spec) throw new Error(`hands: no HANDS_TEAMS entry for ${id}`);
    const rel = path.join('art', 'meshes', `${id}.glb`);
    const file = path.join(REPO, rel);
    const bytes = inFile
      ? readFileSync(inFile)
      : from
        ? execFileSync('/usr/bin/git', ['-C', REPO, 'show', `${from}:${rel}`], { maxBuffer: 1 << 28 })
        : readFileSync(file);
    const doc = await io.readBinary(new Uint8Array(bytes));
    const reports = runHandsPass(doc, id, spec, lib, carbine, baseLabel ?? from ?? (inFile ? 'scratch' : 'working tree'));
    writeFileSync(outFile ?? file, await io.writeBinary(doc));
    console.log(`HANDS ${id}`);
    for (const r of reports) for (const l of r.lines) console.log(`  ${r.prefix}: ${l}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
