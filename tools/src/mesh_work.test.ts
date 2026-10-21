/**
 * demo_squad's `work` clip (Field Works #277, Task 12 Step 4): built from
 * `kneel` (`motion/work.ts`), demo_a pumping, everything else holding.
 * Oracles are literals: rig.py's 0.22 rad forearm pump is 12.6 degrees.
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
  for (let i = 0; i < a.length; i += 4) {
    let dot = 0;
    for (let k = 0; k < 4; k++) dot += a[i + k] * b[i + k];
    mx = Math.max(mx, (2 * Math.acos(Math.min(1, Math.abs(dot))) * 180) / Math.PI);
  }
  return mx;
}

describe('demo_squad work clip', () => {
  it('pumps demo_a forearm about 12.6 degrees off the kneel and leans his spine', async () => {
    const w = await rotations('work');
    const k = await rotations('kneel');
    expect(maxDeg(w.rot.get('demo_a_forearm_R')!, k.rot.get('demo_a_forearm_R')!)).toBeGreaterThan(11);
    expect(maxDeg(w.rot.get('demo_a_forearm_R')!, k.rot.get('demo_a_forearm_R')!)).toBeLessThan(14);
    expect(maxDeg(w.rot.get('demo_a_upperarm_R')!, k.rot.get('demo_a_upperarm_R')!)).toBeGreaterThan(5);
    expect(maxDeg(w.rot.get('demo_a_spine')!, k.rot.get('demo_a_spine')!)).toBeGreaterThan(3.5);
  });

  it('leaves demo_b and every other demo_a bone holding the kneel', async () => {
    const w = await rotations('work');
    const k = await rotations('kneel');
    const movers = new Set(['demo_a_forearm_R', 'demo_a_upperarm_R', 'demo_a_spine']);
    let checked = 0;
    for (const [name, track] of w.rot) {
      if (movers.has(name)) continue;
      expect(maxDeg(track, k.rot.get(name)!), name).toBeLessThan(0.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('loops over the kneel duration', async () => {
    const w = await rotations('work');
    const k = await rotations('kneel');
    expect(w.frames).toBe(k.frames);
    expect(w.length).toBeCloseTo(k.length, 5);
    const f = w.rot.get('demo_a_forearm_R')!;
    expect(maxDeg(f.slice(0, 4), f.slice(f.length - 4))).toBeLessThan(0.5);
  });
});
