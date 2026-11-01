/**
 * Skin-volume census for a smooth-skinned figure (the Meshy pilot, 1 Nov 2026): does a joint collapse ("candy-wrapper")
 * or lose volume in any clip, and does the weapon deform at all?
 *
 * Reading, per figure, per joint band (shoulder, elbow, wrist, knee, hip) and per clip at `HZ`: the vertices within
 * `BAND_M` of the joint along its rest bone, as a cross-section about the posed bone's axis: the mean radius from the
 * axis, posed over rest. A candy-wrapper twist or a pinched elbow reads as a radius that falls; a bulging seam as one
 * that rises. `volumeLoss` is `1 - (posed mean radius / rest mean radius)`, the worst instant of the clip.
 *
 * The weapon: every vertex of the `weapon` role must carry ONE joint at weight 1 (rigid by construction), and the
 * posed pairwise distances of a sample of its vertices must equal the rest ones (no deformation, to 0.1 mm).
 *
 * Literals live here. Nothing is imported from the importer or the motion pass.
 */
import { computeSkinMats, nodeWorlds, readAccessor, readClip, readGlb, skinPoint, type GlbFile } from './mesh_gait';

export const HZ = 30;
export const BAND_M = 0.03;
/** The joint bands read, as [bone whose head is the joint, the parent bone that meets it]. */
export const JOINT_BANDS: readonly (readonly [string, string])[] = [
  ['forearm_L', 'upperarm_L'], ['forearm_R', 'upperarm_R'],
  ['upperarm_L', 'spine'], ['upperarm_R', 'spine'],
  ['hand_L', 'forearm_L'], ['hand_R', 'forearm_R'],
  ['shin_L', 'thigh_L'], ['shin_R', 'thigh_R'],
  ['thigh_L', 'pelvis'], ['thigh_R', 'pelvis'],
];
export const LIVING_CLIPS: readonly string[] = ['idle', 'move', 'fire', 'moveFire', 'kneel', 'kneelIn', 'kneelOut', 'pinned'];

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export interface JointVolume {
  readonly figure: string;
  readonly joint: string;
  readonly clip: string;
  readonly vertices: number;
  readonly restRadiusM: number;
  /** The worst instant's mean radius over the rest's: under 1 is a loss. */
  readonly worstRatio: number;
  readonly volumeLoss: number;
  readonly atS: number;
}

interface Mesh {
  readonly role: string;
  readonly pos: ReturnType<typeof readAccessor>;
  readonly J: ReturnType<typeof readAccessor>;
  readonly W: ReturnType<typeof readAccessor>;
  readonly skin: { joints: number[]; inverseBindMatrices?: number };
  readonly ibm: ReturnType<typeof readAccessor> | null;
}

function meshesOf(glb: GlbFile): Mesh[] {
  const out: Mesh[] = [];
  for (const n of glb.json.nodes ?? []) {
    if (n.mesh === undefined || n.skin === undefined || (n.name ?? '').startsWith('kit_')) continue;
    const mesh = glb.json.meshes![n.mesh]; const prim = mesh.primitives[0]; const skin = glb.json.skins![n.skin];
    out.push({
      role: ((n as { extras?: { rl_role?: string } }).extras?.rl_role ?? mesh.name ?? '') as string,
      pos: readAccessor(glb, prim.attributes.POSITION), J: readAccessor(glb, prim.attributes.JOINTS_0), W: readAccessor(glb, prim.attributes.WEIGHTS_0),
      skin, ibm: skin.inverseBindMatrices === undefined ? null : readAccessor(glb, skin.inverseBindMatrices),
    });
  }
  return out;
}

/** The figures' joint bands over the living clips. */
export function measureJointVolumes(path: string, figures: readonly string[], clips: readonly string[] = LIVING_CLIPS): JointVolume[] {
  const glb = readGlb(path);
  const names = (glb.json.nodes ?? []).map((n) => n.name ?? '');
  const meshes = meshesOf(glb);
  const rest = nodeWorlds(glb, new Map(), 0);
  const out: JointVolume[] = [];
  const at = (m: ArrayLike<number>, c: number): V3 => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  for (const fig of figures) {
    for (const [bone, parent] of JOINT_BANDS) {
      const bi = names.indexOf(`${fig}_${bone}`), pi = names.indexOf(`${fig}_${parent}`);
      if (bi < 0 || pi < 0) continue;
      const jointRest = at(rest[bi], 3);
      const axisRest = norm(at(rest[bi], 1));   // the bone's +Y, along it
      // the band's vertices: within BAND_M of the joint along the bone's axis, within 0.16 m of the joint, on a bone of this joint's chain
      const band: { mesh: Mesh; v: number; restR: number }[] = [];
      for (const m of meshes) {
        if (m.role === 'weapon') continue;
        const restMats = computeSkinMats(m.skin, rest, m.ibm);
        for (let v = 0; v < m.pos.count; v++) {
          let dom = 0; for (let k = 1; k < 4; k++) if (m.W.data[v * 4 + k] > m.W.data[v * 4 + dom]) dom = k;
          const jn = names[m.skin.joints[m.J.data[v * 4 + dom]]];
          if (jn !== `${fig}_${bone}` && jn !== `${fig}_${parent}`) continue;
          const p = skinPoint(m.pos, m.J, m.W, v, restMats);
          const d = sub(p, jointRest);
          const t = dot(d, axisRest);
          if (Math.abs(t) > BAND_M || len(d) > 0.16) continue;
          const r = len(sub(d, [axisRest[0] * t, axisRest[1] * t, axisRest[2] * t]));
          band.push({ mesh: m, v, restR: r });
        }
      }
      if (band.length < 12) continue;
      const restMean = band.reduce((a, b) => a + b.restR, 0) / band.length;
      for (const clip of clips) {
        let c; try { c = readClip(glb, clip); } catch { continue; }
        let worst = Infinity, atS = c.start;
        for (let t = c.start; t <= c.end + 1e-9; t += 1 / HZ) {
          const worlds = nodeWorlds(glb, c.tracks, Math.min(t, c.end));
          const joint = at(worlds[bi], 3);
          const axis = norm(at(worlds[bi], 1));
          const mats = new Map<Mesh, ReturnType<typeof computeSkinMats>>();
          let sum = 0;
          for (const b of band) {
            let ms = mats.get(b.mesh); if (!ms) { ms = computeSkinMats(b.mesh.skin, worlds, b.mesh.ibm); mats.set(b.mesh, ms); }
            const p = skinPoint(b.mesh.pos, b.mesh.J, b.mesh.W, b.v, ms);
            const d = sub(p, joint); const tt = dot(d, axis);
            sum += len(sub(d, [axis[0] * tt, axis[1] * tt, axis[2] * tt]));
          }
          const ratio = sum / band.length / restMean;
          if (ratio < worst) { worst = ratio; atS = t; }
        }
        out.push({ figure: fig, joint: bone, clip, vertices: band.length, restRadiusM: restMean, worstRatio: worst, volumeLoss: 1 - worst, atS });
      }
    }
  }
  return out;
}

export interface WeaponRigidity {
  readonly figure: string;
  readonly vertices: number;
  /** Vertices of the weapon role on this figure with a second influence over 1e-6, or a first under 1. */
  readonly softVertices: number;
  /** The worst change of a sampled pairwise distance over the living clips, metres. */
  readonly worstStretchM: number;
}

/** The weapon role: one joint per vertex at weight 1, and no posed pairwise distance moves. */
export function measureWeaponRigidity(path: string, figures: readonly string[], clips: readonly string[] = LIVING_CLIPS): WeaponRigidity[] {
  const glb = readGlb(path);
  const names = (glb.json.nodes ?? []).map((n) => n.name ?? '');
  const meshes = meshesOf(glb).filter((m) => m.role === 'weapon');
  const rest = nodeWorlds(glb, new Map(), 0);
  const out: WeaponRigidity[] = [];
  for (const fig of figures) {
    let vertices = 0, soft = 0;
    const sample: { mesh: Mesh; v: number }[] = [];
    for (const m of meshes) {
      for (let v = 0; v < m.pos.count; v++) {
        let dom = 0; for (let k = 1; k < 4; k++) if (m.W.data[v * 4 + k] > m.W.data[v * 4 + dom]) dom = k;
        const jn = names[m.skin.joints[m.J.data[v * 4 + dom]]];
        if (!jn.startsWith(`${fig}_`)) continue;
        vertices++;
        let second = 0; for (let k = 0; k < 4; k++) if (k !== dom) second = Math.max(second, m.W.data[v * 4 + k]);
        if (second > 1e-6 || m.W.data[v * 4 + dom] < 1 - 1e-6) soft++;
        if (vertices % 37 === 0) sample.push({ mesh: m, v });
      }
    }
    const restP = sample.map((s) => skinPoint(s.mesh.pos, s.mesh.J, s.mesh.W, s.v, computeSkinMats(s.mesh.skin, rest, s.mesh.ibm)));
    const restD: number[] = [];
    for (let i = 0; i + 1 < restP.length; i++) restD.push(len(sub(restP[i], restP[i + 1])));
    let worst = 0;
    for (const clip of clips) {
      let c; try { c = readClip(glb, clip); } catch { continue; }
      for (let t = c.start; t <= c.end + 1e-9; t += 1 / HZ) {
        const worlds = nodeWorlds(glb, c.tracks, Math.min(t, c.end));
        const mats = new Map<Mesh, ReturnType<typeof computeSkinMats>>();
        const P = sample.map((s) => { let ms = mats.get(s.mesh); if (!ms) { ms = computeSkinMats(s.mesh.skin, worlds, s.mesh.ibm); mats.set(s.mesh, ms); } return skinPoint(s.mesh.pos, s.mesh.J, s.mesh.W, s.v, ms); });
        for (let i = 0; i + 1 < P.length; i++) worst = Math.max(worst, Math.abs(len(sub(P[i], P[i + 1])) - restD[i]));
      }
    }
    out.push({ figure: fig, vertices, softVertices: soft, worstStretchM: worst });
  }
  return out;
}
