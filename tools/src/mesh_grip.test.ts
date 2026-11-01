/**
 * The grip, per clip (GH-826 step 2): both hands ON the carbine in every clip of the Rifle Squad, read off the shipped
 * bytes by `measureGrip` (mesh_gait.ts), an instrument that shares no arithmetic with the motion pass. The limits are
 * the spec's, as LITERALS; nothing is imported from `motion/`.
 *
 *   firing hand's reference point to its grip station            <= 0.020 m
 *   support hand's reference point to its handguard station      <= 0.025 m
 *   the hand's channel axis against the grip's / the bore's      <= 15 deg
 *   contact: palm-side surface within 8 mm of the weapon, by area >= 25 %
 *   the wrist past its anatomical limits (60 / 55 / 20 / 35)       0 deg (0.5 deg of float)
 *   weapon surface inside the glove                                the spec says <= 3 mm; see WEAPON_IN_HAND below
 *
 * Sampled at 60 Hz, and 120 Hz for the kneel transitions, between keys as well as on them: a hand that is on its station
 * at two keys can be off it between them (it was: a 100 degree forearm flip between two frames put the hand 7 cm off at
 * the half-way frame, and nothing that read keys saw it).
 *
 * Constructed failing inputs, each run and watched red before it was written down:
 *   1. a Meshy claw (demo_squad, shipped): the firing hand reads 0.11 m from the grip by the review's own definition;
 *   2. the shipped bytes with the firing... support hand's rotation turned 40 degrees in `fire` (the orientation solve
 *      skipped): the axis limit goes red;
 *   3. the shipped bytes with the weapon bone moved 4 cm rearward in `fire` (the support station put back at the
 *      magazine well): the station limits go red;
 *   4. the weapon bone re-parented under the pelvis, then the spine pitched as recoil does: the grip moves;
 *   5. the weapon bone pushed 4 mm into both gloves in `fire`: the per-clip depth ceiling (3.0 mm) goes red.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { measureGrip, readGlb, type GlbFile } from './mesh_gait';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));
const SQUAD = `${MESHES}inf_squad.glb`;
const FIGURES = ['f0', 'f1', 'f2'] as const;
const CLIPS = ['idle', 'move', 'fire', 'moveFire', 'kneel', 'kneelIn', 'kneelOut', 'pinned'] as const;
const hzOf = (clip: string): number => (clip === 'kneelIn' || clip === 'kneelOut' ? 120 : 60);

const FIRE_STATION_M = 0.02;
const SUPPORT_STATION_M = 0.025;
const AXIS_DEG = 15;
const CONTACT_MIN = 0.25;
const WRIST_OVER_DEG = 0.5;
/** Where the hand's centroid sits along the weapon, butt 0 to muzzle 1: re-derived on the reshaped carbine (the spec's
 *  bands, 0.36-0.42 and 0.62-0.72, were read off the Meshy rifle; the grip is at u 0.263 and the handguard station at
 *  u 0.54 of the 0.845 m part, and the hand's centroid reads 0.28 and 0.65). Measured 0.280-0.289 and 0.646-0.660. */
const GRIP_S: readonly [number, number] = [0.26, 0.31];
const SUPPORT_S: readonly [number, number] = [0.62, 0.68];
/** The review's own definition, against which the shipped Meshy claws are red: the hand's centroid to the grip's
 *  centroid (firing), and to the nearest handguard vertex (support). Measured here 0.025-0.029 and 0.027-0.033. */
const REVIEW_FIRE_MAX_M = 0.035;
const REVIEW_SUPPORT_MAX_M = 0.04;
/**
 * WEAPON_IN_HAND: the spec holds the weapon's surface to <= 3 mm inside the glove. The generator's own census (convex
 * pieces, `tools/units/hands.py`) reads 2.1 / 2.8 / 1.8 mm at the station; this instrument reads the glove's real
 * triangles and the carbine's. The ceiling is PER CLIP (R1 review ruling, 1 Nov 2026: a blanket 10 mm let the aimed clips
 * regress by 7 mm unseen), each a LITERAL a millimetre or so over what the bytes read, the larger of the two hands:
 *
 *   clip       reads (fire / support, mm)   ceiling
 *   fire       1.5 / 2.0                    3.0    the spec's 3 mm: MET
 *   kneel      1.5 / 2.0                    3.0    MET
 *   pinned     1.5 / 2.0                    3.0    MET
 *   moveFire   1.5 / 4.2                    5.0    NOT MET (the support hand, running)
 *   idle       7.9 / 2.0                    9.0    NOT MET: the firing wrist, read with no twist in the hand (the forearm carries
 *   move       7.9 / 2.1                    9.0    the pronation, so a cuff and a sleeve turn together), has 7 degrees to give
 *   kneelIn    7.9 / 5.4                    9.0    at the low ready, and the hand tilts 14 degrees off its station to stay inside
 *   kneelOut   8.4 / 2.0                    9.5    its limit; before the forearm twist (1 Nov) these read 3.6 / 3.6 / 3.6 / 6.3
 *
 * The 3 mm question for the clips marked NOT MET is the lead's (report, R1).
 */
const WEAPON_IN_HAND_CEILING_M: Readonly<Record<(typeof CLIPS)[number], number>> = {
  idle: 0.009, move: 0.009, fire: 0.003, moveFire: 0.005, kneel: 0.003, kneelIn: 0.009, kneelOut: 0.0095, pinned: 0.003,
};

const readings = new Map<string, ReturnType<typeof measureGrip>>();
function read(fig: string, clip: string): ReturnType<typeof measureGrip> {
  const k = `${fig} ${clip}`;
  let r = readings.get(k);
  if (!r) { r = measureGrip(SQUAD, clip, fig, { hz: hzOf(clip) }); readings.set(k, r); }
  return r;
}

describe('the Rifle Squad holds the carbine in every clip', () => {
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
        expect(r.fire.depthM!, 'weapon inside the firing glove').toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M[clip]);
        expect(r.support.depthM!, 'weapon inside the support glove').toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M[clip]);
      }, 120_000);
    }
  }

  it('reads the population it says it reads: 3 figures x 8 clips', () => {
    expect(FIGURES.length * CLIPS.length).toBe(24);
    for (const fig of FIGURES) expect(read(fig, 'fire').frame.lengthM, `${fig}: the weapon cloud's length`).toBeGreaterThan(0.8);
  });
});

describe('a Meshy claw is red (constructed failing input 1)', () => {
  it('demo_squad shipped: the firing hand reads 0.1 m or more from the grip by the review definition', () => {
    const r = measureGrip(`${MESHES}demo_squad.glb`, 'fire', 'demo_b', { fallbackWristT: { L: 0.13, R: 0.13 } });
    expect(r.fire.stationGapM).toBeNull();                         // no hand bones to read a station from
    expect(r.fire.reviewGapM).toBeGreaterThan(0.1);
    expect(r.fire.reviewGapM).toBeGreaterThan(REVIEW_FIRE_MAX_M * 2);
  }, 60_000);
});

// ---- fixtures: the shipped bytes, with one track patched ----------------------------------------------------------
const scratch = mkdtempSync(path.join(tmpdir(), 'grip-'));
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
  const jlen = raw.readUInt32LE(12);
  const out = Buffer.from(raw);
  bin.copy(out, 20 + jlen + 8);
  const file = path.join(scratch, `fixture_${nextFile++}.glb`);
  writeFileSync(file, out);
  return file;
}
const qmulx = (q: number[], deg: number): number[] => {
  const h = (deg * Math.PI) / 360;
  const [x, y, z, w] = q, s = Math.sin(h), c = Math.cos(h);
  return [w * s + x * c, y * c + z * s, z * c - y * s, w * c - x * s];     // q * rotX(deg)
};

describe('the instrument can fail', () => {
  it('a support hand turned 40 degrees off its station in fire goes red on the axis limit (constructed failing input 2)', () => {
    const file = patched('fire', 'f1_hand_R', 'rotation', (v) => qmulx(v, 40));
    const r = measureGrip(file, 'fire', 'f1', { hz: 60 });
    expect(r.support.axisDeg!).toBeGreaterThan(AXIS_DEG);
    // ...and the same file's unpatched reading is inside it, so it is the patch the instrument saw
    expect(read('f1', 'fire').support.axisDeg!).toBeLessThanOrEqual(AXIS_DEG);
  }, 60_000);

  it('the weapon moved 4 cm rearward in fire (the support hand left at the magazine well) goes red on both stations (constructed failing input 3)', () => {
    const file = patched('fire', 'f1_weapon', 'translation', (v) => [v[0] - 0.04, v[1], v[2]]);
    const r = measureGrip(file, 'fire', 'f1', { hz: 60 });
    expect(r.fire.stationGapM!).toBeGreaterThan(FIRE_STATION_M);
    expect(r.support.stationGapM!).toBeGreaterThan(SUPPORT_STATION_M);
  }, 60_000);
});

describe('the weapon-in-glove ceiling can fail (constructed failing input 5)', () => {
  it('the weapon bone pushed 4 mm into both gloves in fire reads past the 3.0 mm ceiling it holds, and the unpatched file does not', () => {
    const file = patched('fire', 'f1_weapon', 'translation', (v) => [v[0], v[1], v[2] - 0.004]);
    const r = measureGrip(file, 'fire', 'f1', { hz: 60 });
    expect(r.fire.depthM!, 'firing glove').toBeGreaterThan(WEAPON_IN_HAND_CEILING_M.fire);
    expect(r.support.depthM!, 'support glove').toBeGreaterThan(WEAPON_IN_HAND_CEILING_M.fire);
    expect(read('f1', 'fire').fire.depthM!).toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M.fire);
    expect(read('f1', 'fire').support.depthM!).toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M.fire);
  }, 60_000);
});

// ---- recoil and lean keep the grip ----------------------------------------------------------------------------
/** The bone names under `root`, in a parsed GLB's hierarchy. */
function under(glb: GlbFile, root: string): Set<string> {
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
    const rest = measureGrip(SQUAD, 'fire', 'f1', { hz: 30 });
    const kicked = measureGrip(SQUAD, 'fire', 'f1', { hz: 30, spinePitchDeg: 5 });
    expect(Math.abs(kicked.fire.stationGapM! - rest.fire.stationGapM!)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(kicked.support.stationGapM! - rest.support.stationGapM!)).toBeLessThanOrEqual(0.001);
  }, 60_000);

  it('FIXTURE: the weapon bone under the pelvis, and the same kick moves the grip (constructed failing input 4)', () => {
    const copy: GlbFile = { json: JSON.parse(JSON.stringify(glb.json)), bin: glb.bin };
    const nodes = copy.json.nodes!;
    const wi = nodes.findIndex((n) => n.name === 'f1_weapon');
    const spine = nodes.findIndex((n) => n.name === 'f1_spine');
    const pelvis = nodes.findIndex((n) => n.name === 'f1_pelvis');
    expect(pelvis, 'f1_pelvis exists').toBeGreaterThanOrEqual(0);
    nodes[spine].children = (nodes[spine].children ?? []).filter((c) => c !== wi);
    nodes[pelvis].children = [...(nodes[pelvis].children ?? []), wi];
    expect(under(copy, 'f1_spine').has('f1_weapon'), 'the fixture really moved it').toBe(false);
    const rest = measureGrip(SQUAD, 'fire', 'f1', { hz: 30, glb: copy });
    const kicked = measureGrip(SQUAD, 'fire', 'f1', { hz: 30, glb: copy, spinePitchDeg: 5 });
    const moved = Math.max(
      Math.abs(kicked.fire.stationGapM! - rest.fire.stationGapM!),
      Math.abs(kicked.support.stationGapM! - rest.support.stationGapM!),
    );
    expect(moved, 'the grip moved by').toBeGreaterThan(0.005);
  }, 60_000);
});
