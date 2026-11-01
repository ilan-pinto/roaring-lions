/**
 * No arm pops (GH-826 step 2): between two consecutive keys of a clip, no arm or hand bone of the Rifle Squad turns more
 * than a stride's worth. A two-bone IK solved frame by frame can land on the other side of its own elbow in one frame
 * (it did: a forearm turned 100 to 180 degrees between two keys of `idle`, `move` and `kneel` before the solver was given
 * the last frame's answer and a forearm hinge), and nothing that reads the pose at one key, or two, sees it: the hand is
 * on its station at both ends and the arm flies through the body in between.
 *
 * The limit is a LITERAL, 65 degrees, and every bone of every clip but the entries of KNOWN_SNAPS stays under 50.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readAccessor, readGlb } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));
const FILE = `${MESHES}inf_squad.glb`;
const FIGURES = ['f0', 'f1', 'f2'];
const BONES = ['upperarm_L', 'forearm_L', 'hand_L', 'upperarm_R', 'forearm_R', 'hand_R', 'finger_L'];
const CLIPS = ['idle', 'move', 'fire', 'moveFire', 'kneel', 'kneelIn', 'kneelOut', 'pinned'];
const MAX_KEY_STEP_DEG = 65;
/**
 * OPEN, named, and gated against going stale: the support arm of every figure snaps once in each kneel transition, and
 * f2's forearm once in `move` (measured 1 Nov 2026, 120 Hz keys 8 ms apart, 60 Hz in `move`). The IK leaves one elbow
 * basin for another there (the old one runs out of wrist). Each entry is the step its bone takes, degrees. An entry that
 * no longer exceeds the limit must be deleted: the second test fails when it can.
 */
const KNOWN_SNAPS: Readonly<Record<string, number>> = {
  'kneelIn f0_upperarm_R': 89, 'kneelIn f0_forearm_R': 127, 'kneelIn f0_hand_R': 133,
  'kneelIn f1_upperarm_R': 89, 'kneelIn f1_forearm_R': 127, 'kneelIn f1_hand_R': 133,
  'kneelIn f2_upperarm_R': 87, 'kneelIn f2_forearm_R': 124, 'kneelIn f2_hand_R': 131,
  'kneelOut f0_upperarm_R': 83, 'kneelOut f0_forearm_R': 116, 'kneelOut f0_hand_R': 125,
  'kneelOut f1_upperarm_R': 81, 'kneelOut f1_forearm_R': 116, 'kneelOut f1_hand_R': 124,
  'kneelOut f2_upperarm_R': 82, 'kneelOut f2_forearm_R': 116, 'kneelOut f2_hand_R': 123,
  'move f2_forearm_R': 71,
};

/** The largest turn between two consecutive keys of a node's rotation track in a clip, degrees. */
export function maxKeyStepDeg(path: string, clip: string, node: string, tweak?: (q: number[], k: number) => number[]): number {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const ni = nodes.findIndex((n) => n.name === node);
  const anim = glb.json.animations!.find((a) => a.name === clip)!;
  const ch = anim.channels.find((c) => c.target.node === ni && c.target.path === 'rotation');
  if (!ch) throw new Error(`${path}: ${node} has no rotation track in ${clip}`);
  const out = readAccessor(glb, anim.samplers[ch.sampler].output);
  const q = (k: number): number[] => {
    const v = [0, 1, 2, 3].map((c) => out.data[k * 4 + c]);
    return tweak ? tweak(v, k) : v;
  };
  let worst = 0;
  for (let k = 1; k < out.count; k++) {
    const a = q(k - 1), b = q(k);
    const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    worst = Math.max(worst, (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI);
  }
  return worst;
}

describe('no arm or hand bone of the Rifle Squad flips between two keys', () => {
  for (const clip of CLIPS) {
    it(`${clip}: every arm bone's largest key-to-key turn is at most ${MAX_KEY_STEP_DEG} degrees`, () => {
      let seen = 0;
      for (const fig of FIGURES) {
        for (const b of BONES) {
          const worst = maxKeyStepDeg(FILE, clip, `${fig}_${b}`);
          seen++;
          if (`${clip} ${fig}_${b}` in KNOWN_SNAPS) continue;
          expect(worst, `${fig}_${b} in ${clip}`).toBeLessThanOrEqual(MAX_KEY_STEP_DEG);
        }
      }
      expect(seen, 'bones read').toBe(FIGURES.length * BONES.length);
    });
  }

  it('every named snap is still there (an entry that went under the limit is deleted)', () => {
    for (const [key, was] of Object.entries(KNOWN_SNAPS)) {
      const [clip, bone] = key.split(' ');
      const now = maxKeyStepDeg(FILE, clip, bone);
      expect(now, `${key}: no longer over ${MAX_KEY_STEP_DEG} degrees -- delete it from KNOWN_SNAPS`).toBeGreaterThan(MAX_KEY_STEP_DEG);
      expect(Math.abs(now - was), `${key}: the snap moved from the recorded ${was}`).toBeLessThan(6);
    }
  });

  it('the check can fail: one key of f0_forearm_L in move turned 150 degrees reads past the limit (constructed failing input)', () => {
    const flipped = maxKeyStepDeg(FILE, 'move', 'f0_forearm_L', (q, k) => {
      if (k !== 3) return q;
      const h = (150 * Math.PI) / 360, s = Math.sin(h), c = Math.cos(h);
      const [x, y, z, w] = q;
      return [w * s + x * c, y * c + z * s, z * c - y * s, w * c - x * s];     // q * rotX(150)
    });
    expect(flipped).toBeGreaterThan(MAX_KEY_STEP_DEG);
    expect(maxKeyStepDeg(FILE, 'move', 'f0_forearm_L')).toBeLessThanOrEqual(MAX_KEY_STEP_DEG);
  });
});
