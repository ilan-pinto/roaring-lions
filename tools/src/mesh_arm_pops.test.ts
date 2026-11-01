/**
 * No arm pops (GH-826 step 2): no arm or hand bone of the Rifle Squad turns faster than a hand can be swung. A two-bone IK
 * solved frame by frame can land on the other side of its own elbow in one frame (it did: a forearm turned 100 to 180
 * degrees between two keys of `idle`, `move` and `kneel` before the solver was given the last frame's answer and a forearm
 * hinge; and the support arm snapped 80 to 135 degrees once in each kneel transition, where the elbow left one basin for
 * the other), and nothing that reads the pose at one key, or two, sees it: the hand is on its station at both ends and the
 * arm flies through the body in between.
 *
 * The limit is a RATE, a LITERAL: 20 degrees in one 120 Hz step (8.3 ms), 2,400 degrees a second, applied to the turn
 * between two consecutive keys whatever their spacing (a 60 Hz clip may turn 40 degrees between its keys). It holds for
 * every arm bone of every figure of every clip, and no exemption is named. The snaps the first version of this file listed
 * (`KNOWN_SNAPS`, deleted 1 Nov 2026 when the lead ruled them fixed) are asserted gone by name below.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readAccessor, readGlb } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));
const FILE = `${MESHES}inf_squad.glb`;
const FIGURES = ['f0', 'f1', 'f2'];
const BONES = ['upperarm_L', 'forearm_L', 'hand_L', 'upperarm_R', 'forearm_R', 'hand_R', 'finger_L'];
const CLIPS = ['idle', 'move', 'fire', 'moveFire', 'kneel', 'kneelIn', 'kneelOut', 'pinned'];
/** Degrees a second: 20 degrees in one 120 Hz step. */
const MAX_TURN_DEG_PER_S = 2400;
/** The steps that were snaps before the fix (clip, bone, degrees in one 8 ms key step then): they are held to the same limit. */
const FORMER_SNAPS: readonly [string, string, number][] = [
  ['kneelIn', 'upperarm_R', 89], ['kneelIn', 'forearm_R', 127], ['kneelIn', 'hand_R', 133],
  ['kneelOut', 'upperarm_R', 83], ['kneelOut', 'forearm_R', 116], ['kneelOut', 'hand_R', 125],
  ['move', 'forearm_R', 71],
];

/** The fastest turn between two consecutive keys of a node's rotation track in a clip, degrees a second, and the step behind it. */
export function maxTurnRate(path: string, clip: string, node: string, tweak?: (q: number[], k: number) => number[]): { rate: number; stepDeg: number; at: number } {
  const glb = readGlb(path);
  const nodes = glb.json.nodes ?? [];
  const ni = nodes.findIndex((n) => n.name === node);
  const anim = glb.json.animations!.find((a) => a.name === clip)!;
  const ch = anim.channels.find((c) => c.target.node === ni && c.target.path === 'rotation');
  if (!ch) throw new Error(`${path}: ${node} has no rotation track in ${clip}`);
  const times = readAccessor(glb, anim.samplers[ch.sampler].input);
  const out = readAccessor(glb, anim.samplers[ch.sampler].output);
  const q = (k: number): number[] => {
    const v = [0, 1, 2, 3].map((c) => out.data[k * 4 + c]);
    return tweak ? tweak(v, k) : v;
  };
  let best = { rate: 0, stepDeg: 0, at: 0 };
  for (let k = 1; k < out.count; k++) {
    const a = q(k - 1), b = q(k);
    const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    const stepDeg = (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
    const rate = stepDeg / (times.data[k] - times.data[k - 1]);
    if (rate > best.rate) best = { rate, stepDeg, at: times.data[k] };
  }
  return best;
}

describe('no arm or hand bone of the Rifle Squad turns faster than 20 degrees in one 120 Hz step', () => {
  for (const clip of CLIPS) {
    it(`${clip}: every arm bone of every figure stays under ${MAX_TURN_DEG_PER_S} degrees a second between its keys`, () => {
      let seen = 0;
      for (const fig of FIGURES) {
        for (const b of BONES) {
          const w = maxTurnRate(FILE, clip, `${fig}_${b}`);
          seen++;
          expect(w.rate, `${fig}_${b} in ${clip}: ${w.stepDeg.toFixed(1)} degrees at t=${w.at.toFixed(3)} s`).toBeLessThanOrEqual(MAX_TURN_DEG_PER_S);
        }
      }
      expect(seen, 'bones read').toBe(FIGURES.length * BONES.length);
    });
  }

  it('the support arm of every figure no longer snaps in the kneel transitions, nor f2 in move (they were 71 to 133 degrees in one step)', () => {
    for (const fig of FIGURES) {
      for (const [clip, bone, was] of FORMER_SNAPS) {
        const w = maxTurnRate(FILE, clip, `${fig}_${bone}`);
        expect(w.stepDeg, `${fig}_${bone} in ${clip} (was ${was})`).toBeLessThan(40);
      }
    }
  });

  it('the check can fail: one key of f0_forearm_L in move turned 150 degrees reads past the limit (constructed failing input)', () => {
    const flipped = maxTurnRate(FILE, 'move', 'f0_forearm_L', (q, k) => {
      if (k !== 3) return q;
      const h = (150 * Math.PI) / 360, s = Math.sin(h), c = Math.cos(h);
      const [x, y, z, w] = q;
      return [w * s + x * c, y * c + z * s, z * c - y * s, w * c - x * s];     // q * rotX(150)
    });
    expect(flipped.rate).toBeGreaterThan(MAX_TURN_DEG_PER_S);
    expect(maxTurnRate(FILE, 'move', 'f0_forearm_L').rate).toBeLessThanOrEqual(MAX_TURN_DEG_PER_S);
  });

  it('the check can fail: a 90 degree turn between two keys of the support forearm in kneelIn (the old snap) reads past the limit (constructed failing input)', () => {
    const snapped = maxTurnRate(FILE, 'kneelIn', 'f1_forearm_R', (q, k) => {
      if (k < 14) return q;
      const h = (90 * Math.PI) / 360, s = Math.sin(h), c = Math.cos(h);
      const [x, y, z, w] = q;
      return [w * s + x * c, y * c + z * s, z * c - y * s, w * c - x * s];
    });
    expect(snapped.rate).toBeGreaterThan(MAX_TURN_DEG_PER_S);
  });
});
