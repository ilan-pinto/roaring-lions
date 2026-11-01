/**
 * The instrument behind the claw-fragment gate in `mesh_hands.test.ts` (GH-826 step 3, the Demolition review's must-fix 1).
 *
 * The importer's bodies carry the old orange claw; the hands pass cuts the faces the forearm bone dominates. Seven of the Demolition
 * claw's faces were weighted to the SPINE, survived the cut, and hung in the air beside the new support hand (a flat orange
 * zig-zag, 88 cm2 a man). They are found the way the eye finds them: by colour. A "claw tone" uniform face is one whose mean atlas
 * colour is a saturated tan-orange, and the question is whether a spine, arm or hand bone of a hands team still dominates any.
 * Shares nothing with `hands-pass.ts`.
 */
import { atlasOf, labOf } from './mesh_forearm';
import { readAccessor, readGlb } from './mesh_gait';

/** CIELAB: L* above, C* above, hue between (degrees). The review's literals. */
export const CLAW_TONE_BAND = { minL: 35, minC: 35, hueMin: 35, hueMax: 80 } as const;

export interface ClawFace {
  readonly face: number;
  /** The bone that dominates most of the face's vertices. */
  readonly bone: string;
  readonly lab: [number, number, number];
}

const CARRIER = /_(spine|upperarm_[LR]|forearm_[LR]|hand_[LR]|finger_[LR]|fist_[LR])$/;

/**
 * Every `uniform` face of claw tone whose dominant bone is a spine, arm or hand bone. `uvTweak` rewrites a vertex's UV before the
 * colour is read (a constructed failing input: it paints chosen vertices claw tone).
 */
export function clawToneFaces(path: string, uvTweak?: (uv: [number, number], vertex: number, bone: string) => [number, number]): ClawFace[] {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const uni = nodes.find((n) => n.name === 'uniform' && n.mesh !== undefined && n.skin !== undefined);
  if (!uni) throw new Error(`${path}: no skinned uniform node`);
  const skin = glb.json.skins![uni.skin!];
  const prim = glb.json.meshes![uni.mesh!].primitives[0];
  const UV = readAccessor(glb, prim.attributes.TEXCOORD_0);
  const J = readAccessor(glb, prim.attributes.JOINTS_0);
  const W = readAccessor(glb, prim.attributes.WEIGHTS_0);
  const I = readAccessor(glb, prim.indices!);
  const atlas = atlasOf(glb);
  const bone = (v: number): string => {
    let b = 0;
    for (let k = 1; k < 4; k++) if (W.data[v * 4 + k] > W.data[v * 4 + b]) b = k;
    return nodes[skin.joints[J.data[v * 4 + b]]]?.name ?? '';
  };
  const bones = new Map<number, string>();
  const uvOf = (v: number): [number, number] => {
    if (!bones.has(v)) bones.set(v, bone(v));
    const t: [number, number] = [UV.data[v * 2], UV.data[v * 2 + 1]];
    return uvTweak ? uvTweak(t, v, bones.get(v)!) : t;
  };
  const texel = (u: number, w: number): [number, number, number] => {
    const x = Math.min(atlas.w - 1, Math.max(0, Math.floor(u * atlas.w))), y = Math.min(atlas.h - 1, Math.max(0, Math.floor(w * atlas.h)));
    const o = (y * atlas.w + x) * 4;
    return [atlas.rgba[o], atlas.rgba[o + 1], atlas.rgba[o + 2]];
  };
  const found: ClawFace[] = [];
  for (let f = 0; f < I.count / 3; f++) {
    const tri = [I.data[f * 3], I.data[f * 3 + 1], I.data[f * 3 + 2]];
    const votes = new Map<string, number>();
    for (const v of tri) { const b = bone(v); votes.set(b, (votes.get(b) ?? 0) + 1); }
    const dom = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (!CARRIER.test(dom)) continue;
    const uv = tri.map(uvOf);
    const cu = (uv[0][0] + uv[1][0] + uv[2][0]) / 3, cv = (uv[0][1] + uv[1][1] + uv[2][1]) / 3;
    const samples = [[cu, cv], ...uv.map((p) => [(p[0] + cu) / 2, (p[1] + cv) / 2])].map(([u, w]) => texel(u, w));
    const m = [0, 1, 2].map((k) => samples.reduce((s, c) => s + c[k], 0) / samples.length);
    const lab = labOf(m[0], m[1], m[2]);
    const chroma = Math.hypot(lab[1], lab[2]), hue = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
    if (lab[0] > CLAW_TONE_BAND.minL && chroma > CLAW_TONE_BAND.minC && hue > CLAW_TONE_BAND.hueMin && hue < CLAW_TONE_BAND.hueMax) found.push({ face: f, bone: dom, lab });
  }
  return found;
}
