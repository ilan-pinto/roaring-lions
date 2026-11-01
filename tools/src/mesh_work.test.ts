/**
 * demo_squad's `work` clip (Field Works #277, Task 12 Step 4): built from
 * `kneel` (`motion/work.ts`), demo_a working, everything else holding.
 * GH-826 step 3 made demo_a an armed worker: carbine slung, free hands on the satchel (`mesh_work_demo.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';

const FILE = fileURLToPath(new URL('../../art/meshes/demo_squad.glb', import.meta.url));

async function rotations(clip: string): Promise<{ rot: Map<string, Float32Array>; frames: number; length: number }> {
  const doc = await new NodeIO().readBinary(new Uint8Array(readFileSync(FILE)));
  const a = doc.getRoot().listAnimations().find((x) => x.getName() === clip);
  if (!a) throw new Error(`demo_squad has no "${clip}" clip`);
  const rot = new Map<string, Float32Array>();
  for (const c of a.listChannels()) {
    if (c.getTargetPath() === 'rotation') rot.set(c.getTargetNode()?.getName() ?? '', c.getSampler()?.getOutput()?.getArray() as Float32Array);
  }
  const t = a.listSamplers()[0].getInput();
  return { rot, frames: t?.getCount() ?? 0, length: t?.getMax([])[0] ?? 0 };
}

/** Largest angle (degrees) between two tracks' keys. */
function maxDeg(a: Float32Array, b: Float32Array): number {
  let mx = 0;
  // a track the motion pass found constant is cut to two keys (`collapseConstantTracks`): its last key stands for all of them
  const nb = b.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const j = Math.min(i / 4, nb - 1) * 4;
    let dot = 0;
    for (let k = 0; k < 4; k++) dot += a[i + k] * b[j + k];
    mx = Math.max(mx, (2 * Math.acos(Math.min(1, Math.abs(dot))) * 180) / Math.PI);
  }
  return mx;
}

describe('demo_squad work clip', () => {
  // GH-826 step 3: demo_a carries a carbine, slings it, and presses the satchel with free hands (mesh_work_demo.test.ts reads that
  // half off the bytes). What stays true from Task 12 is that the work clip is the kneel with ONE man doing something else.
  const SPINE_AND_ARMS = new Set([
    'demo_a_upperarm_L', 'demo_a_forearm_L', 'demo_a_upperarm_R', 'demo_a_forearm_R', 'demo_a_hand_L', 'demo_a_hand_R', 'demo_a_finger_L',
    'demo_a_spine', 'demo_a_neck', 'demo_a_head', 'demo_a_weapon',
  ]);

  it('moves demo_a\'s arms, hands, spine, neck, head and (slung) carbine off the kneel\'s, and only those', async () => {
    const w = await rotations('work');
    const k = await rotations('kneel');
    for (const bone of ['demo_a_forearm_L', 'demo_a_forearm_R', 'demo_a_upperarm_R', 'demo_a_spine']) {
      expect(maxDeg(w.rot.get(bone)!, k.rot.get(bone)!), `${bone} leaves the kneel's pose`).toBeGreaterThan(10);
    }
  });

  it('leaves demo_b and every other demo_a bone holding the kneel', async () => {
    const w = await rotations('work');
    const k = await rotations('kneel');
    let checked = 0;
    for (const [name, track] of w.rot) {
      if (SPINE_AND_ARMS.has(name)) continue;
      expect(maxDeg(track, k.rot.get(name)!), name).toBeLessThan(0.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('loops over the kneel duration, and the worker\'s hands close the loop', async () => {
    const w = await rotations('work');
    const k = await rotations('kneel');
    expect(w.frames).toBe(k.frames);
    expect(w.length).toBeCloseTo(k.length, 5);
    for (const bone of ['demo_a_forearm_L', 'demo_a_forearm_R', 'demo_a_upperarm_L', 'demo_a_upperarm_R']) {
      const f = w.rot.get(bone)!;
      expect(maxDeg(f.slice(0, 4), f.slice(f.length - 4)), bone).toBeLessThan(0.5);
    }
  });

  it('keeps the full clip set and the gait stride the motion passes wrote', async () => {
    const doc = await new NodeIO().readBinary(new Uint8Array(readFileSync(FILE)));
    const names = doc.getRoot().listAnimations().map((x) => x.getName()).sort();
    expect(names).toEqual(['down', 'fire', 'idle', 'kneel', 'kneelIn', 'kneelOut', 'move', 'moveFire', 'pinned', 'work', 'wreck']);
    const gait = doc.getRoot().listScenes()[0].getExtras().rl_gait as { move: { strideM: number } };
    expect(gait.move.strideM).toBeGreaterThan(1.7);
    expect(gait.move.strideM).toBeLessThan(1.9);
  });
});
