/**
 * The grip, per clip, on the Demolition squad (GH-826 step 3): both hands ON the carbine in every clip of `demo_b` and `demo_a`,
 * read off the shipped bytes by `measureGrip` (mesh_gait.ts), as `mesh_grip.test.ts` does for the Rifle Squad. The limits are
 * the spec's, as LITERALS; nothing is imported from `motion/`. `work` is not here: demo_a's carbine is slung in it and his hands
 * are on the satchel (`mesh_work_demo.test.ts`).
 *
 *   firing hand's reference point to its grip station            <= 0.020 m
 *   support hand's reference point to its handguard station      <= 0.025 m
 *   the hand's channel axis against the grip's / the bore's      <= 15 deg
 *   contact: palm-side surface within 8 mm of the weapon, by area >= CONTACT_MIN (see below)
 *   the wrist past its anatomical limits (60 / 55 / 20 / 35)       0 deg (0.5 deg of float)
 *   weapon surface inside the glove                                per clip and per hand, below
 *
 * Constructed failing inputs, each run and watched red before it was written down:
 *   1. a Meshy claw (sarim_rifles, shipped): the firing hand reads 0.1 m or more from the grip by the review's own definition;
 *   2. the shipped bytes with the support hand's rotation turned 40 degrees in `fire` (the orientation solve skipped): the axis
 *      limit goes red;
 *   3. the shipped bytes with the weapon bone moved 4 cm rearward in `fire`: the station limits go red;
 *   4. the weapon bone pushed 10 mm along its x (the firing grip, 9.9 mm against 4.0) or down its y (the support glove, 12.2 against 10.5)
 *      in `fire`: the per-clip depth ceilings go red.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { measureGrip, readGlb } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));
const SQUAD = `${MESHES}demo_squad.glb`;
const FIGURES = ['demo_b', 'demo_a'] as const;
const CLIPS = ['idle', 'move', 'fire', 'moveFire', 'kneel', 'kneelIn', 'kneelOut', 'pinned'] as const;
const hzOf = (clip: string): number => (clip === 'kneelIn' || clip === 'kneelOut' ? 120 : 60);

const FIRE_STATION_M = 0.02;
const SUPPORT_STATION_M = 0.025;
const AXIS_DEG = 15;
/** The spec's floor: 25 % ("holding, not hovering"). Read here: 29-35 % in every clip but the firing hand in `kneelIn`, which reads 25.0-25.4. */
const CONTACT_MIN = 0.25;
const WRIST_OVER_DEG = 0.5;
/** Where the hand's centroid sits along the weapon, butt 0 to muzzle 1 (the same part, the same stations as the Rifle Squad). */
const GRIP_S: readonly [number, number] = [0.26, 0.31];
const SUPPORT_S: readonly [number, number] = [0.62, 0.68];
const REVIEW_FIRE_MAX_M = 0.035;
const REVIEW_SUPPORT_MAX_M = 0.04;
/** PER CLIP AND PER HAND, LITERALS about a millimetre over what these bytes read (the dense sampler, `measureGrip`), mm: firing / support. */
const WEAPON_IN_HAND_CEILING_M: Readonly<Record<(typeof CLIPS)[number], readonly [number, number]>> = {
  idle: [0.0035, 0.0105], move: [0.0035, 0.0105], fire: [0.004, 0.0105], moveFire: [0.004, 0.0105],
  kneel: [0.004, 0.0105], kneelIn: [0.0045, 0.0105], kneelOut: [0.0045, 0.0105], pinned: [0.004, 0.0105],
};

const readings = new Map<string, ReturnType<typeof measureGrip>>();
function read(fig: string, clip: string): ReturnType<typeof measureGrip> {
  const k = `${fig} ${clip}`;
  let r = readings.get(k);
  if (!r) { r = measureGrip(SQUAD, clip, fig, { hz: hzOf(clip) }); readings.set(k, r); }
  return r;
}

describe('the Demolition squad holds the carbine in every clip', () => {
  for (const fig of FIGURES) {
    for (const clip of CLIPS) {
      it(`${fig} ${clip}: both hands on their stations, axes true, palms on, wrists in range`, () => {
        const r = read(fig, clip);
        expect(r.instants, 'instants with the weapon drawn').toBeGreaterThan(10);
        expect(r.fire.stationGapM!, 'firing hand to the grip station').toBeLessThanOrEqual(FIRE_STATION_M);
        expect(r.support.stationGapM!, 'support hand to the handguard station').toBeLessThanOrEqual(SUPPORT_STATION_M);
        expect(r.fire.axisDeg!, 'firing hand axis').toBeLessThanOrEqual(AXIS_DEG);
        expect(r.support.axisDeg!, 'support hand axis').toBeLessThanOrEqual(AXIS_DEG);
        expect(r.fire.contact!, 'firing hand contact').toBeGreaterThanOrEqual(CONTACT_MIN);
        expect(r.support.contact!, 'support hand contact').toBeGreaterThanOrEqual(CONTACT_MIN);
        expect(r.fire.wristOverDeg!, 'firing wrist past its limit').toBeLessThanOrEqual(WRIST_OVER_DEG);
        expect(r.support.wristOverDeg!, 'support wrist past its limit').toBeLessThanOrEqual(WRIST_OVER_DEG);
        expect(r.fire.sMin, 'firing hand along the weapon, lowest').toBeGreaterThanOrEqual(GRIP_S[0]);
        expect(r.fire.sMax, 'firing hand along the weapon, highest').toBeLessThanOrEqual(GRIP_S[1]);
        expect(r.support.sMin, 'support hand along the weapon, lowest').toBeGreaterThanOrEqual(SUPPORT_S[0]);
        expect(r.support.sMax, 'support hand along the weapon, highest').toBeLessThanOrEqual(SUPPORT_S[1]);
        expect(r.fire.reviewGapM, 'review reading, firing').toBeLessThanOrEqual(REVIEW_FIRE_MAX_M);
        expect(r.support.reviewGapM, 'review reading, support').toBeLessThanOrEqual(REVIEW_SUPPORT_MAX_M);
        expect(r.fire.depthM!, 'weapon inside the firing glove').toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M[clip][0]);
        expect(r.support.depthM!, 'weapon inside the support glove').toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M[clip][1]);
      }, 120_000);
    }
  }

  it('reads the population it says it reads: 2 figures x 8 clips', () => {
    expect(FIGURES.length * CLIPS.length).toBe(16);
    for (const fig of FIGURES) expect(read(fig, 'fire').frame.lengthM, `${fig}: the weapon cloud's length`).toBeGreaterThan(0.8);
  });
});

describe('a Meshy claw is red (constructed failing input 1)', () => {
  it('sarim_rifles shipped: the firing hand reads 0.1 m or more from the grip by the review definition', () => {
    const r = measureGrip(`${MESHES}sarim_rifles.glb`, 'fire', 'sar0', { fallbackWristT: { L: 0.13, R: 0.13 } });
    expect(r.fire.stationGapM).toBeNull();                         // no hand bones to read a station from
    expect(r.fire.reviewGapM).toBeGreaterThan(REVIEW_FIRE_MAX_M * 2);
  }, 60_000);
});

// ---- fixtures: the shipped bytes, with one track patched ----------------------------------------------------------
const scratch = mkdtempSync(path.join(tmpdir(), 'grip-demo-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let nextFile = 0;
/** A copy of the shipped GLB with every key of `node`'s `prop` track in `clip` passed through `edit`, written to scratch. */
function patched(clip: string, node: string, prop: 'rotation' | 'translation', edit: (v: number[]) => number[]): string {
  const raw = readFileSync(SQUAD);
  const glb = readGlb(SQUAD);
  const bin = Buffer.from(glb.bin);
  const nodes = glb.json.nodes ?? [];
  const ni = nodes.findIndex((n) => n.name === node);
  const anim = glb.json.animations!.find((a) => a.name === clip)!;
  const ch = anim.channels.find((c) => c.target.node === ni && c.target.path === prop);
  if (!ch) throw new Error(`no ${prop} track on ${node} in ${clip}`);
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
  const file = path.join(scratch, `fixture_${nextFile++}.glb`);
  writeFileSync(file, out);
  return file;
}
const qmulx = (q: number[], deg: number): number[] => {
  const h = (deg * Math.PI) / 360;
  const [x, y, z, w] = q, s = Math.sin(h), c = Math.cos(h);
  return [w * s + x * c, y * c + z * s, z * c - y * s, w * c - x * s];
};

describe('the instrument can fail on these bytes', () => {
  it('a support hand turned 40 degrees off its station in fire goes red on the axis limit (constructed failing input 2)', () => {
    const file = patched('fire', 'demo_a_hand_R', 'rotation', (v) => qmulx(v, 40));
    const r = measureGrip(file, 'fire', 'demo_a', { hz: 60 });
    expect(r.support.axisDeg!).toBeGreaterThan(AXIS_DEG);
    expect(read('demo_a', 'fire').support.axisDeg!).toBeLessThanOrEqual(AXIS_DEG);
  }, 60_000);

  it('the weapon moved 4 cm rearward in fire goes red on both stations (constructed failing input 3)', () => {
    const file = patched('fire', 'demo_a_weapon', 'translation', (v) => [v[0] - 0.04, v[1], v[2]]);
    const r = measureGrip(file, 'fire', 'demo_a', { hz: 60 });
    expect(r.fire.stationGapM!).toBeGreaterThan(FIRE_STATION_M);
    expect(r.support.stationGapM!).toBeGreaterThan(SUPPORT_STATION_M);
  }, 60_000);

  it('the weapon bone pushed 10 mm along its own x in fire sinks the firing grip past its ceiling (constructed failing input 4a)', () => {
    const file = patched('fire', 'demo_a_weapon', 'translation', (v) => [v[0] + 0.01, v[1], v[2]]);
    const r = measureGrip(file, 'fire', 'demo_a', { hz: 60 });
    expect(r.fire.depthM!, 'firing glove').toBeGreaterThan(WEAPON_IN_HAND_CEILING_M.fire[0]);       // 9.9 mm against 4.0
    expect(read('demo_a', 'fire').fire.depthM!).toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M.fire[0]);
  }, 60_000);

  it('the weapon bone pushed 10 mm down its own y in fire sinks the handguard into the support glove past its ceiling (constructed failing input 4b)', () => {
    const file = patched('fire', 'demo_a_weapon', 'translation', (v) => [v[0], v[1] - 0.01, v[2]]);
    const r = measureGrip(file, 'fire', 'demo_a', { hz: 60 });
    expect(r.support.depthM!, 'support glove').toBeGreaterThan(WEAPON_IN_HAND_CEILING_M.fire[1]);   // 12.2 mm against 10.5
    expect(read('demo_a', 'fire').support.depthM!).toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M.fire[1]);
  }, 60_000);
});

// ---- recoil and lean keep the grip ----------------------------------------------------------------------------
function under(glb: ReturnType<typeof readGlb>, root: string): Set<string> {
  const nodes = glb.json.nodes ?? [];
  const out = new Set<string>();
  const walk = (i: number): void => { out.add(nodes[i].name ?? ''); for (const c of nodes[i].children ?? []) walk(c); };
  walk(nodes.findIndex((n) => n.name === root));
  return out;
}

describe('recoil and lean keep the grip', () => {
  const glb = readGlb(SQUAD);
  for (const fig of FIGURES) {
    it(`${fig}: both arms, both hands, the finger and the weapon descend from the spine`, () => {
      const set = under(glb, `${fig}_spine`);
      for (const b of ['weapon', 'upperarm_L', 'forearm_L', 'hand_L', 'finger_L', 'upperarm_R', 'forearm_R', 'hand_R']) {
        expect(set.has(`${fig}_${b}`), `${fig}_${b} under ${fig}_spine`).toBe(true);
      }
    });
  }

  it('a spine pitched as recoil pitches it (rifle x 2.5) moves no hand against its station', () => {
    const rest = measureGrip(SQUAD, 'fire', 'demo_b', { hz: 30 });
    const kicked = measureGrip(SQUAD, 'fire', 'demo_b', { hz: 30, spinePitchDeg: 5 });
    expect(Math.abs(kicked.fire.stationGapM! - rest.fire.stationGapM!)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(kicked.support.stationGapM! - rest.support.stationGapM!)).toBeLessThanOrEqual(0.001);
  }, 60_000);
});
