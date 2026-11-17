/**
 * The `work` clip (Field Works #277, Task 12 Step 4; `motion/work.ts`), both ways it is built.
 *
 * The shipped Combat Engineers (GH-826 unit 1, 12 Nov 2026) are a skinned Meshy body with both fists fused to its
 * carbine: `demo_a` kneels over the charge with the carbine still in both hands (the lead's variant (a)), leaning and
 * bobbing, his head down; nothing pumps. A free-armed (rigid) team still pumps its right forearm, held here on the
 * frozen rigid Combat Engineers (`fixtures/demo_squad_rigid_422df13dd.glb`).
 *
 * Oracles are literals: a fist on its gun is 1 mm and half a degree; rig.py's 0.22 rad forearm pump is 12.6 degrees.
 *
 * Falsified by mutation of `motion/work.ts` (12 Nov 2026), seven mutations, each run and watched red, then put back:
 *   - the forearm pump put back for a held worker (`rotateWorld(... forearm_R ..., WORK_PUMP_RAD * pump)` at the end of
 *     `workHeld`): "rebuilt ... both fists on the carbine" red, a fist 56 mm off the gun;
 *   - `worksHeld` returning false: the same test red (113 mm), with "leans over the charge" and "holding the kneel";
 *   - `worksHeld` returning true: all three tests of the rigid half red (no pump: 0 deg against 11);
 *   - the held lean set to 0, the held bob set to 0, the look-down set to 0: "leans over the charge" red, each;
 *   - the carried nodes NOT put back to the sculpted carry (the aimed kneel's arms kept under the leant spine):
 *     "rebuilt ... both fists on the carbine" red, 76 mm.
 * The "shipped" test reads the committed bytes and cannot see a mutation of the pass until the file is rebuilt; the
 * "rebuilt" one runs the pass on those bytes and can.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { applyWork } from './meshes/motion/work';
import { clipDuration, measureBoneTilt, measureFistsOnGun, measureWorldTurns } from './mesh_work';

const SHIPPED = fileURLToPath(new URL('../../art/meshes/demo_squad.glb', import.meta.url));
const RIGID = fileURLToPath(new URL('./fixtures/demo_squad_rigid_422df13dd.glb', import.meta.url));
const TMP = mkdtempSync(path.join(tmpdir(), 'mesh-work-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** `file` with its `work` built again by `motion/work.ts`, written beside nothing: a temp file. */
async function rebuilt(file: string, name: string): Promise<string> {
  const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
  applyWork(doc, 'demo_squad', ['demo_a']);
  const out = path.join(TMP, name);
  writeFileSync(out, await io.writeBinary(doc));
  return out;
}

async function rotations(file: string, clip: string): Promise<{ rot: Map<string, Float32Array>; frames: number; length: number }> {
  const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
  const a = doc.getRoot().listAnimations().find((x) => x.getName() === clip);
  if (!a) throw new Error(`${path.basename(file)} has no "${clip}" clip`);
  const rot = new Map<string, Float32Array>();
  for (const c of a.listChannels()) {
    if (c.getTargetPath() === 'rotation') rot.set(c.getTargetNode()?.getName() ?? '', c.getSampler()?.getOutput()?.getArray() as Float32Array);
  }
  const t = a.listSamplers()[0].getInput();
  return { rot, frames: t?.getCount() ?? 0, length: t?.getMax([])[0] ?? 0 };
}

/** Largest difference between two tracks' key components. */
function maxAbs(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Infinity;
  let mx = 0;
  for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i] - b[i]));
  return mx;
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

/** The nodes of `file` under `top` (and `top`). */
async function under(file: string, top: string): Promise<Set<string>> {
  const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
  const out = new Set<string>();
  const walk = (n: { getName(): string; listChildren(): unknown[] }): void => {
    out.add(n.getName());
    for (const c of n.listChildren()) walk(c as never);
  };
  const node = doc.getRoot().listNodes().find((n) => n.getName() === top);
  if (!node) throw new Error(`no node ${top}`);
  walk(node);
  return out;
}

describe('demo_squad work clip: a worker whose fists are fused to his carbine', () => {
  it('shipped: demo_a keeps both fists on the carbine at every key', () => {
    const r = measureFistsOnGun(SHIPPED, 'work', 'demo_a');
    expect(r.samples).toBeGreaterThan(60);
    expect(r.gapM).toBeLessThan(0.001);
    expect(r.turnDeg).toBeLessThan(0.5);
  });

  it('rebuilt by motion/work.ts: demo_a keeps both fists on the carbine at every key', async () => {
    const r = measureFistsOnGun(await rebuilt(SHIPPED, 'held.glb'), 'work', 'demo_a');
    expect(r.samples).toBeGreaterThan(60);
    expect(r.gapM).toBeLessThan(0.001);
    expect(r.turnDeg).toBeLessThan(0.5);
  });

  it('the instrument reads a fist that leaves the gun: the aimed kneel is not the sculpted carry', () => {
    // the same hands on the same weapon in `kneel`, where the support fist ROLLS round the handguard as the carbine
    // comes up (hold.ts, REST_CARRY_SUPPORT_ROLL_DEG, 40 degrees): on the gun, and turned on it
    const r = measureFistsOnGun(SHIPPED, 'kneel', 'demo_a');
    expect(r.turnDeg).toBeGreaterThan(30);
  });

  it('leans over the charge and bobs, his head down, where the kneel looks ahead', async () => {
    const file = await rebuilt(SHIPPED, 'lean.glb');
    const spine = measureBoneTilt(file, 'work', 'demo_a_spine');
    const head = measureBoneTilt(file, 'work', 'demo_a_head');
    const kneelHead = measureBoneTilt(file, 'kneel', 'demo_a_head');
    // 13 degrees of lean (what the carbine across his lap allows over the raised thigh), bobbing 0.10 rad (5.7 degrees)
    expect(Math.min(...spine)).toBeGreaterThan(12.5);
    expect(Math.min(...spine)).toBeLessThan(13.5);
    expect(Math.max(...spine) - Math.min(...spine)).toBeGreaterThan(5.2);
    expect(Math.max(...spine) - Math.min(...spine)).toBeLessThan(6.2);
    // ...and the head looks down at the charge: 51 to 62 degrees off the vertical, against the aimed kneel's 27 to 29
    expect(Math.min(...head)).toBeGreaterThan(45);
    expect(Math.max(...kneelHead)).toBeLessThan(35);
    expect(Math.max(...head) - Math.min(...head)).toBeGreaterThan(9);
  });

  it('leaves demo_b, the charge and demo_a below the spine holding the kneel', async () => {
    const file = await rebuilt(SHIPPED, 'rest.glb');
    const turns = measureWorldTurns(file, 'work', 'kneel');
    const movers = await under(file, 'demo_a_spine');
    let checked = 0;
    for (const [name, turn] of turns) {
      if (movers.has(name) || !/^(demo_[ab]_|prop$)/.test(name)) continue;
      expect(turn, name).toBeLessThan(0.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
    expect(movers.has('demo_a_weapon')).toBe(true);
    expect(movers.has('demo_a_hand_L')).toBe(true);
    // ...and the worker's spine is not among the holders: it turned
    expect(turns.get('demo_a_spine')!).toBeGreaterThan(8);
  });

  it('loops over the kneel duration and says who works how', async () => {
    const file = await rebuilt(SHIPPED, 'loop.glb');
    const w = await rotations(file, 'work');
    expect(clipDuration(file, 'work')).toBeCloseTo(clipDuration(file, 'kneel'), 5);
    expect(clipDuration(SHIPPED, 'work')).toBeCloseTo(clipDuration(SHIPPED, 'kneel'), 5);
    const f = w.rot.get('demo_a_spine')!;
    expect(maxDeg(f.slice(0, 4), f.slice(f.length - 4))).toBeLessThan(0.5);
    const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
    expect(doc.getRoot().listScenes()[0].getExtras().rl_work).toEqual({ version: 1, workers: ['demo_a'], held: ['demo_a'] });
  });

  it('is idempotent: built twice, the same keys', async () => {
    const once = await rotations(await rebuilt(SHIPPED, 'once.glb'), 'work');
    const twice = await rotations(await rebuilt(await rebuilt(SHIPPED, 'twice-a.glb'), 'twice-b.glb'), 'work');
    expect(twice.rot.size).toBe(once.rot.size);
    for (const [name, track] of once.rot) expect(maxAbs(track, twice.rot.get(name)!), name).toBeLessThan(1e-6);
  });

  it('keeps the full clip set the passes wrote', async () => {
    const doc = await io.readBinary(new Uint8Array(readFileSync(SHIPPED)));
    const names = doc.getRoot().listAnimations().map((x) => x.getName()).sort();
    // `fall`: a skinned body dies on its living body (the captured fall), as the Rifle Squad's does
    expect(names).toEqual(['down', 'fall', 'fire', 'idle', 'kneel', 'kneelIn', 'kneelOut', 'move', 'moveFire', 'pinned', 'work', 'wreck']);
  });
});

describe('work clip: a free-armed (rigid) worker still pumps', () => {
  it('pumps demo_a forearm about 12.6 degrees off the kneel and leans his spine', async () => {
    const file = await rebuilt(RIGID, 'rigid.glb');
    const w = await rotations(file, 'work');
    const k = await rotations(file, 'kneel');
    expect(maxDeg(w.rot.get('demo_a_forearm_R')!, k.rot.get('demo_a_forearm_R')!)).toBeGreaterThan(11);
    expect(maxDeg(w.rot.get('demo_a_forearm_R')!, k.rot.get('demo_a_forearm_R')!)).toBeLessThan(14);
    expect(maxDeg(w.rot.get('demo_a_upperarm_R')!, k.rot.get('demo_a_upperarm_R')!)).toBeGreaterThan(5);
    expect(maxDeg(w.rot.get('demo_a_spine')!, k.rot.get('demo_a_spine')!)).toBeGreaterThan(3.5);
  });

  it('leaves demo_b and every other demo_a bone holding the kneel', async () => {
    const file = await rebuilt(RIGID, 'rigid-rest.glb');
    const w = await rotations(file, 'work');
    const k = await rotations(file, 'kneel');
    const movers = new Set(['demo_a_forearm_R', 'demo_a_upperarm_R', 'demo_a_spine']);
    let checked = 0;
    for (const [name, track] of w.rot) {
      if (movers.has(name)) continue;
      expect(maxDeg(track, k.rot.get(name)!), name).toBeLessThan(0.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('writes the very keys the frozen file shipped with, and no `held`', async () => {
    const file = await rebuilt(RIGID, 'rigid-same.glb');
    const now = await rotations(file, 'work');
    const then = await rotations(RIGID, 'work');
    expect(now.frames).toBe(then.frames);
    expect(now.rot.size).toBe(then.rot.size);
    // (built from the file's float32 `kneel` where the pass built it from the kneel in memory: the last bits differ)
    for (const [name, track] of then.rot) expect(maxAbs(track, now.rot.get(name)!), name).toBeLessThan(1e-5);
    const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
    expect(doc.getRoot().listScenes()[0].getExtras().rl_work).toEqual({ version: 1, workers: ['demo_a'] });
  });
});
