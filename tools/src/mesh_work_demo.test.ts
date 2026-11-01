/**
 * The Demolition engineer at work (GH-826 step 3): `demo_a` carries a carbine now, slings it in `work`, and works the
 * satchel with free hands. Read off the shipped bytes by `mesh_work.ts` and `measureMountedPartInBody`
 * (`mesh_gait.ts`); the limits are LITERALS, nothing is imported from `motion/`.
 *
 *   the sling     the carbine stands at least 10 mm clear of the worker's body (the spec's `>= 0.01 m`, the kit at its maximum
 *                 INCLUDED: the file carries every kit part, superseded tiers too) and has no sample inside it
 *   the hands     each hand comes down onto the satchel's top face in turn: its nearest vertex is within 4 mm of the box at the
 *                 bottom of its stroke and no deeper than 3 mm into it, and at the top of the stroke it stands 30 mm or more clear
 *   the body      no vertex of the worker that is not a hand is deeper in the satchel's box than it was on main (32.4 mm: the front boot), and
 *                 none is under the ground
 *
 * Constructed failing inputs, each run and watched red before it was written down:
 *   1. the slung carbine pushed 0.2 m into his back: samples inside, and the clearance is gone;
 *   2. the carbine pulled 0.2 m further out: a clearance far over 10 mm, which is not failing, so the pair of readings
 *      shows the instrument sees distance in both directions;
 *   3. the firing forearm turned 60 degrees in `work`: that hand never comes near the satchel;
 *   4. the worker's spine turned upright in `work` (no lean): neither hand reaches the satchel.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { measureMountedPartInBody, readGlb } from './mesh_gait';
import { measureWorkContact } from './mesh_work';

const FILE = fileURLToPath(new URL('../../art/meshes/demo_squad.glb', import.meta.url));
const WORKER = 'demo_a';

const SLING_CLEAR_M = 0.01;
const HAND_DEPTH_MAX_M = 0.003;
const HAND_REST_MAX_M = 0.004;
const HAND_LIFT_MIN_M = 0.03;
/** The deepest a vertex of the worker that is not a hand sits in the satchel's AXIS-ALIGNED box. It is the front boot and shin: the
 *  kneel puts the front foot 0.36 m ahead of the hip, inside the box's 0.56..0.96 m, and it reads 32.4 mm on origin/main's shipped
 *  bytes (the same legs, the same kneel) as much as on these. The satchel's corners are chamfered, so the box over-reports. The ceiling
 *  holds that line (1 mm over) and fails a worker who is further in. */
const BODY_IN_CHARGE_MAX_M = 0.0335;
const GROUND_FLOOR_M = -0.001;

const bodyOf = (name: string): boolean => name.startsWith(`${WORKER}_`) && !/_weapon$|_hand_|_finger_|_fist_|death/.test(name);
const sling = (file: string) => measureMountedPartInBody(file, 'work', { roles: ['weapon', 'metal'], joint: `${WORKER}_weapon`, bodyJoint: bodyOf, clearance: true });

const scratch = mkdtempSync(path.join(tmpdir(), 'work-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let nextFile = 0;
/** A copy of the shipped GLB with every key of `node`'s `prop` track in `work` passed through `edit`. */
function patched(node: string, prop: 'rotation' | 'translation', edit: (v: number[]) => number[]): string {
  const raw = readFileSync(FILE);
  const glb = readGlb(FILE);
  const bin = Buffer.from(glb.bin);
  const ni = (glb.json.nodes ?? []).findIndex((n) => n.name === node);
  const anim = glb.json.animations!.find((a) => a.name === 'work')!;
  const ch = anim.channels.find((c) => c.target.node === ni && c.target.path === prop);
  if (!ch) throw new Error(`no ${prop} track on ${node} in work`);
  const acc = glb.json.accessors![anim.samplers[ch.sampler].output];
  const bv = glb.json.bufferViews![acc.bufferView!];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const n = prop === 'rotation' ? 4 : 3;
  for (let k = 0; k < acc.count; k++) {
    const v = [0, 1, 2, 3].slice(0, n).map((c) => bin.readFloatLE(base + (k * n + c) * 4));
    edit(v).forEach((x, c) => bin.writeFloatLE(x, base + (k * n + c) * 4));
  }
  const out = Buffer.from(raw);
  bin.copy(out, 20 + raw.readUInt32LE(12) + 8);
  const file = path.join(scratch, `work_${nextFile++}.glb`);
  writeFileSync(file, out);
  return file;
}
const qmulx = (q: number[], deg: number): number[] => {
  const h = (deg * Math.PI) / 360;
  const [x, y, z, w] = q, s = Math.sin(h), c = Math.cos(h);
  return [w * s + x * c, y * c + z * s, z * c - y * s, w * c - x * s];
};

describe('the engineer slings his carbine in work', () => {
  const r = sling(FILE);
  it('has no sample inside his body and stands 10 mm or more clear of it, the maximum kit worn', () => {
    expect(r.instants, 'instants with the carbine drawn').toBeGreaterThan(5);
    expect(r.samples, 'carbine surface samples').toBeGreaterThan(300);
    expect(r.worstInside, 'samples inside the body').toBe(0);
    expect(r.minClearanceM, 'nearest approach').toBeGreaterThanOrEqual(SLING_CLEAR_M);
  }, 120_000);

  it('records the sling in the file: the carbine rides the spine bone in work, muzzle up', () => {
    const glb = readGlb(FILE);
    const x = (glb.json.scenes?.[0]?.extras as { rl_work?: { armed?: string[]; sling?: { dir: number[] } } } | undefined)?.rl_work;
    expect(x?.armed, 'rl_work.armed').toEqual([WORKER]);
    expect(x?.sling?.dir[1], 'the muzzle points up').toBeGreaterThan(0.5);
  });
});

describe('the engineer\'s hands press the satchel in turn', () => {
  const c = measureWorkContact(FILE, WORKER);
  it('reads the population it says it reads', () => {
    expect(c.instants).toBeGreaterThan(60);
    expect(Object.keys(c.hands).sort()).toEqual([`${WORKER}_hand_L`, `${WORKER}_hand_R`]);
    expect(c.charge.hi[1] - c.charge.lo[1], 'the satchel is 0.2 m tall').toBeGreaterThan(0.15);
  }, 120_000);
  for (const hand of [`${WORKER}_hand_L`, `${WORKER}_hand_R`]) {
    it(`${hand}: rests on the top face at the bottom of its stroke, no deeper than 3 mm, and lifts 30 mm or more clear at the top`, () => {
      expect(c.hands[hand].minM, 'nearest approach (negative is depth)').toBeGreaterThanOrEqual(-HAND_DEPTH_MAX_M);
      expect(c.hands[hand].minM, 'nearest approach').toBeLessThanOrEqual(HAND_REST_MAX_M);
      expect(c.hands[hand].maxM, 'farthest over the clip').toBeGreaterThanOrEqual(HAND_LIFT_MIN_M);
    });
  }
  it('nothing else of him is in the satchel, and nothing is under the ground', () => {
    expect(c.bodyInChargeM, 'deepest non-hand vertex in the satchel').toBeLessThanOrEqual(BODY_IN_CHARGE_MAX_M);
    expect(c.lowestM, 'lowest vertex').toBeGreaterThanOrEqual(GROUND_FLOOR_M);
  });
});

describe('the checks can fail (constructed failing inputs)', () => {
  it('1: the carbine pushed 0.2 m into his back (the weapon bone\'s local -x is toward the chest) has samples inside, or no clearance', () => {
    const bad = patched(`${WORKER}_weapon`, 'translation', (v) => [v[0] - 0.2, v[1], v[2]]);
    const r = sling(bad);
    expect(r.worstInside > 0 || r.minClearanceM < SLING_CLEAR_M, `inside ${r.worstInside}, clearance ${r.minClearanceM}`).toBe(true);
  }, 120_000);

  it('2: pulled 0.2 m back, the same instrument reads a clearance far over the limit: it sees distance both ways', () => {
    const far = patched(`${WORKER}_weapon`, 'translation', (v) => [v[0] + 0.2, v[1], v[2]]);
    expect(sling(far).minClearanceM).toBeGreaterThan(sling(FILE).minClearanceM + 0.1);
  }, 120_000);

  it('3: the firing forearm turned 60 degrees in work keeps that hand off the satchel', () => {
    const bad = patched(`${WORKER}_forearm_L`, 'rotation', (v) => qmulx(v, 60));
    const c = measureWorkContact(bad, WORKER);
    expect(c.hands[`${WORKER}_hand_L`].minM, 'hand_L nearest approach').toBeGreaterThan(HAND_REST_MAX_M);
  }, 120_000);

  it('5: the worker\'s root moved 0.15 m toward the satchel puts his boots and knee deeper in its box than the ceiling', () => {
    const bad = patched(`${WORKER}_root`, 'translation', (v) => [v[0] + 0.15, v[1], v[2]]);
    const c = measureWorkContact(bad, WORKER);
    expect(c.bodyInChargeM, 'deepest non-hand vertex in the box').toBeGreaterThan(BODY_IN_CHARGE_MAX_M);
  }, 120_000);

  it('4: the worker\'s spine put upright in work (no lean): neither hand reaches the satchel', () => {
    const bad = patched(`${WORKER}_spine`, 'rotation', () => [0, 0, 0, 1]);
    const c = measureWorkContact(bad, WORKER);
    expect(Math.min(c.hands[`${WORKER}_hand_L`].minM, c.hands[`${WORKER}_hand_R`].minM), 'nearest of the two').toBeGreaterThan(HAND_REST_MAX_M);
  }, 120_000);
});
