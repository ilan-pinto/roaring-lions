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
 *
 * LOOP SEAMS (R2 review, 1 Nov 2026): a looping clip plays its last key and then its first again, and a rate read key to key
 * inside the clip never sees that step. `moveFire`'s f1 support upper arm turned 38 degrees there (1.5 before the hands
 * pass) once every 0.625 s. For idle, move, fire, moveFire, kneel and pinned the WORLD rotation of every arm bone of every
 * figure may differ by at most 20 degrees between the last key and the first.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { measureJointPoses, readAccessor, readGlb, rotationDeltaDeg } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));
const FILE = `${MESHES}inf_squad.glb`;
const FIGURES = ['f0', 'f1', 'f2'];
/** Every team the hands pass has been through (GH-826): the Rifle Squad (step 2), the Demolition squad (step 3). */
const SQUADS: readonly { name: string; file: string; figures: readonly string[] }[] = [
  { name: 'Rifle Squad', file: FILE, figures: FIGURES },
  { name: 'Demolition squad', file: `${MESHES}demo_squad.glb`, figures: ['demo_b', 'demo_a'] },
];
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

const LOOPING = ['idle', 'move', 'fire', 'moveFire', 'kneel', 'pinned'];
const MAX_SEAM_DEG = 20;

/** The world rotation of an arm bone at the clip's last key against its first, degrees. */
export function seamTurnDeg(file: string, clip: string, node: string): number {
  const a = measureJointPoses(file, clip, 'start').find((j) => j.name === node);
  const b = measureJointPoses(file, clip, 'end').find((j) => j.name === node);
  if (!a || !b) throw new Error(`${file}: no joint ${node}`);
  return rotationDeltaDeg(a.rotation, b.rotation);
}

const scratch = mkdtempSync(path.join(tmpdir(), 'pops-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
/** A copy of `file` with the LAST key of `node`'s rotation track in `clip` replaced by `edit(q)`: a seam that is not closed. */
function withLastKey(file: string, clip: string, node: string, edit: (q: number[]) => number[]): string {
  const raw = readFileSync(file);
  const glb = readGlb(file);
  const bin = Buffer.from(glb.bin);
  const ni = (glb.json.nodes ?? []).findIndex((n) => n.name === node);
  const anim = glb.json.animations!.find((a) => a.name === clip)!;
  const ch = anim.channels.find((c) => c.target.node === ni && c.target.path === 'rotation')!;
  const acc = glb.json.accessors![anim.samplers[ch.sampler].output];
  const bv = glb.json.bufferViews![acc.bufferView!];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + (acc.count - 1) * 16;
  const q = edit([0, 1, 2, 3].map((c) => bin.readFloatLE(base + c * 4)));
  q.forEach((x, c) => bin.writeFloatLE(x, base + c * 4));
  const out = Buffer.from(raw);
  bin.copy(out, 20 + raw.readUInt32LE(12) + 8);
  const f = path.join(scratch, `seam_${node}_${clip}.glb`);
  writeFileSync(f, out);
  return f;
}

describe('a looping clip closes its loop (the last key meets the first)', () => {
  for (const squad of SQUADS) {
    for (const clip of LOOPING) {
      it(`${squad.name} ${clip}: every arm bone of every figure turns at most ${MAX_SEAM_DEG} degrees, in the world, between the last key and the first`, () => {
        let seen = 0;
        for (const fig of squad.figures) {
          for (const b of BONES) {
            if (b === 'finger_L') continue;
            const d = seamTurnDeg(squad.file, clip, `${fig}_${b}`);
            seen++;
            expect(d, `${fig}_${b} in ${clip}`).toBeLessThanOrEqual(MAX_SEAM_DEG);
          }
        }
        expect(seen, 'bones read').toBe(squad.figures.length * 6);
      });
    }
  }

  it('the check can fail: f1_upperarm_R in moveFire with its last key turned 38 degrees (the seam before the fix) reads past the limit (constructed failing input)', () => {
    const h = (38 * Math.PI) / 360, s = Math.sin(h), c = Math.cos(h);
    const bad = withLastKey(FILE, 'moveFire', 'f1_upperarm_R', ([x, y, z, w]) => [w * s + x * c, y * c + z * s, z * c - y * s, w * c - x * s]);
    expect(seamTurnDeg(bad, 'moveFire', 'f1_upperarm_R')).toBeGreaterThan(MAX_SEAM_DEG);
    expect(seamTurnDeg(FILE, 'moveFire', 'f1_upperarm_R')).toBeLessThanOrEqual(MAX_SEAM_DEG);
  });
});

describe('no arm or hand bone turns faster than 20 degrees in one 120 Hz step', () => {
  for (const squad of SQUADS) {
    for (const clip of CLIPS) {
      it(`${squad.name} ${clip}: every arm bone of every figure stays under ${MAX_TURN_DEG_PER_S} degrees a second between its keys`, () => {
        let seen = 0;
        for (const fig of squad.figures) {
          for (const b of BONES) {
            const w = maxTurnRate(squad.file, clip, `${fig}_${b}`);
            seen++;
            expect(w.rate, `${fig}_${b} in ${clip}: ${w.stepDeg.toFixed(1)} degrees at t=${w.at.toFixed(3)} s`).toBeLessThanOrEqual(MAX_TURN_DEG_PER_S);
          }
        }
        expect(seen, 'bones read').toBe(squad.figures.length * BONES.length);
      });
    }
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
