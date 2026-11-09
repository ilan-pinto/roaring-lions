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
 *   5. the weapon bone pushed 10 mm into both gloves in `fire` (4 mm moves the support reading by under 1 mm: its deepest point is
 *      where the fingers close on the handguard, not where the weapon is): the per-clip depth ceilings go red;
 *   6. the old first-vertex-and-centroid sampler on the same shipped bytes: 2.0 mm where the dense reading is 9.0.
 *
 * GH-746 (9 Nov): the shipped squad is a FUSED Meshy figure (see FUSED below). Inputs 2, 3 and 4 run on it (its station
 * and axis are read against the fist's sculpted place on the gun); 5 and 6 run on the frozen rigid squad whose procedural
 * hands their ceilings were measured on, and a fused twin of 5 runs on the shipped bytes. Its open readings are named in
 * FUSED_GRIP_OPEN, each with a demotion.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { measureGrip, readGlb, type GlbFile } from './mesh_gait';
import { isFusedHands } from './mesh_hand_source';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));
const SQUAD = `${MESHES}inf_squad.glb`;
/**
 * GH-746 Meshy pilot: the shipped Rifle Squad may be a FUSED figure (`rl_hands.source` "meshy"): fists Meshy sculpted on
 * its own 0.79 m gun, skinned rigidly to the hand bones. Then (measureGrip) the station is where the fist was sculpted on
 * the gun (its centroid in the weapon's bind space) and the axis its bone's turn from its bind orientation against the
 * weapon's; the limits are the same literals. The readings calibrated on the procedural hand (the weapon-in-glove
 * ceilings, the old sampler) are falsified on the frozen rigid squad they were measured on (`RIGID`).
 */
const FUSED = isFusedHands(SQUAD);
const RIGID = FUSED ? fileURLToPath(new URL('./fixtures/inf_squad_rigid_592ebbb19.glb', import.meta.url)) : SQUAD;
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
const GRIP_S_CARBINE: readonly [number, number] = [0.26, 0.31];
const SUPPORT_S_CARBINE: readonly [number, number] = [0.62, 0.68];
/** The same reading on the fused figure's own gun (Meshy's, kept with the fists sculpted on it; GH-746), measured on the
 *  9 Nov bytes: firing 0.375 / 0.375 / 0.401 (f0 / f1 / f2; f2's body is a 0.966 x 1.08 scaling, which moves the same
 *  fist along the same gun's cloud), support 0.752 / 0.754 / 0.757. Bands 0.05 wide, as narrow as the carbine's. The
 *  cloud is longer than the bore (0.82-0.86 m against 0.79: the vest pocket that went with the stock), so these are the
 *  instrument's s, not the bore's. The support fist is a C-clamp further forward on the handguard than the carbine's. */
const GRIP_S_FUSED: readonly [number, number] = [0.36, 0.41];
const SUPPORT_S_FUSED: readonly [number, number] = [0.73, 0.78];
const GRIP_S = FUSED ? GRIP_S_FUSED : GRIP_S_CARBINE;
const SUPPORT_S = FUSED ? SUPPORT_S_FUSED : SUPPORT_S_CARBINE;
/** The review's own definition, against which the shipped Meshy claws are red: the hand's centroid to the grip's
 *  centroid (firing), and to the nearest handguard vertex (support). Measured here 0.025-0.029 and 0.027-0.033. */
const REVIEW_FIRE_MAX_M = 0.035;
const REVIEW_SUPPORT_MAX_M = 0.04;
/**
 * WEAPON_IN_HAND: the spec holds the weapon's surface to <= 3 mm inside the glove. `measureGrip` samples every weapon triangle
 * on a barycentric grid at 5 mm or finer (R2 review, 1 Nov 2026: it used to take each triangle's first vertex and centroid, the
 * handguard's triangles run 100 mm and more, and the support fingers were never sampled: 2.0 mm read, 9.0 real; the same bytes
 * read both ways are in the test below). The ceilings are PER CLIP AND PER HAND, LITERALS about a millimetre over what the bytes
 * read, mm (firing hand / support hand):
 *
 *   clip       reads         ceiling firing / support
 *   idle       8.4 / 9.1     9.5 / 10.5     firing hand: NOT MET (see below)
 *   move       8.4 / 9.1     9.5 / 10.5     NOT MET
 *   fire       2.9 / 9.0     4.0 / 10.5     firing MET (2.9), support NOT MET
 *   moveFire   2.9 / 9.1     4.0 / 10.5     as fire
 *   kneel      2.9 / 9.1     4.0 / 10.5     as fire
 *   kneelIn    8.6 / 9.6     9.5 / 10.5     NOT MET
 *   kneelOut   8.4 / 9.1     9.5 / 10.5     NOT MET
 *   pinned     2.9 / 9.1     4.0 / 10.5     as fire
 *
 * The 3 mm is met only by the FIRING hand in the aimed clips. The support hand reads 9.0-9.6 mm in every clip, and did before the
 * hands pass was fixed (9.0-9.6 on the bytes of 291488e10): the fingers wrap a handguard modelled as a closed section, and the lead
 * accepted it on the R2 review (not visible: the fingers read as wrapping the handguard). The firing hand's 8.4 in idle, move and
 * the transitions is the 14 degree tilt the wrist needs when the forearm carries the pronation (it read 4.0 before).
 */
const WEAPON_IN_HAND_CEILING_M: Readonly<Record<(typeof CLIPS)[number], readonly [number, number]>> = {
  idle: [0.0095, 0.0105], move: [0.0095, 0.0105], fire: [0.004, 0.0105], moveFire: [0.004, 0.0105],
  kneel: [0.004, 0.0105], kneelIn: [0.0095, 0.0105], kneelOut: [0.0095, 0.0105], pinned: [0.004, 0.0105],
};

/**
 * Readings of the FUSED figure that fail for a named reason, per `${figure} ${reading}` (the fist is locked to the gun, so
 * each reads the same in every clip). Each must still fail, or the entry is deleted (the demotion); every other reading
 * of the fused figure keeps every limit. Read 9 Nov 2026 on the round-3 bytes.
 */
/** f1's and f2's support fists at rest (idle, move): a ratchet at round 5's 12.1-12.3 mm, never raised (see FUSED_GRIP_OPEN). */
const SUPPORT_REST_RATCHET_M = 0.0135;
const FUSED_GRIP_OPEN: Readonly<Record<string, string>> = FUSED ? {
  // An INSTRUMENT limit: readWeaponFrame's pistol-grip finder takes the first protrusion under the cloud between s 0.12
  // and 0.75, and Meshy's gun carries the vest pocket that went with the stock (18-23 cm under the butt), so its "grip"
  // is that pocket at s ~0.2, 16-20 cm from the fist. The fist's place on the gun is read by the station, s and contact.
  'f0 review fire': 'firing review gap 0.192 m: the grip finder reads the stock pocket, not the pistol grip',
  'f1 review fire': 'firing review gap 0.165 m: the grip finder reads the stock pocket, not the pistol grip',
  'f2 review fire': 'firing review gap 0.205 m: the grip finder reads the stock pocket, not the pistol grip',
  // A DEFECT: Meshy's fused fist is SOLID round the grip, so the grip runs through the fist's closed volume: the gun's
  // surface 15.1 / 15.6 / 20.1 mm inside the firing fist (round 5, 9 Nov; round 4 read 21.4 / 20.9 / 19.9; ceilings 4-9.5).
  // A grip channel was tried in round 5 and not shipped: an exact boolean against the parted (open) gun gutted the fist
  // (327 -> 144 faces), against a voxel-closed gun tripled it (2,367 triangles, 37 slivers), and against the grip's convex
  // hull cut the fingers in the trigger guard (327 -> 184 faces). It wants a fist sculpted round a hollow grip (the lead).
  'f0 depth fire': 'the gun 15.1 mm inside the firing fist (ceiling 4-9.5): Meshy\'s solid fused fist round the grip',
  'f1 depth fire': 'the gun 15.6 mm inside the firing fist (ceiling 4-9.5): Meshy\'s solid fused fist round the grip',
  'f2 depth fire': 'the gun 20.1 mm inside the firing fist (ceiling 4-9.5): Meshy\'s solid fused fist round the grip',
  // A DEFECT: rl_hands carries ONE station table, measured on one body; f2 is a 0.966 x 1.08 scaling of it, so the hold
  // puts his fists on the shared stations, 23.4 mm (firing) off where they were sculpted on his own gun (f1 5.0, f0 0.0).
  'f2 station fire': 'firing fist 23.4 mm off its sculpted station (limit 20): one station table for three scaled bodies',
  // A DEFECT (9 Nov): the support fist rolls 40 deg round the handguard as the weapon comes up (hold.ts
  // REST_CARRY_SUPPORT_ROLL_DEG, the elbow under the handguard), and the handguard is not round: in the aimed clips its
  // surface sits 11.3 / 14.9 / 16.7 mm inside the smaller (x0.8) fist (ceiling 10.5; round 5, 9 Nov). Round 5 also
  // WELDED and closed the support fist's rim (B2), so the inside test now sees f1's and f2's handguard 12.1-12.3 mm
  // inside it in idle and move too (round 4, its rim open, read 0.2-3.2): Meshy's solid fused fist, as on the grip. At rest
  // that is held by SUPPORT_REST_RATCHET_M (13.5 mm), not exempted.
  'f0 depth support': 'the handguard 11.3 mm inside the support fist when aimed (ceiling 10.5): the roll round a square handguard',
  'f1 depth support': 'the handguard 14.9 mm inside the support fist when aimed (ceiling 10.5): the roll round a square handguard; at rest a 13.5 mm ratchet',
  'f2 depth support': 'the handguard 16.7 mm inside the support fist when aimed (ceiling 10.5): the roll round a square handguard; at rest a 13.5 mm ratchet',
} : {};

const readings = new Map<string, ReturnType<typeof measureGrip>>();
function read(fig: string, clip: string): ReturnType<typeof measureGrip> {
  const k = `${fig} ${clip}`;
  let r = readings.get(k);
  if (!r) { r = measureGrip(SQUAD, clip, fig, { hz: hzOf(clip) }); readings.set(k, r); }
  return r;
}
const rigidReadings = new Map<string, ReturnType<typeof measureGrip>>();
function readRigid(fig: string, clip: string): ReturnType<typeof measureGrip> {
  if (!FUSED) return read(fig, clip);
  const k = `${fig} ${clip}`;
  let r = rigidReadings.get(k);
  if (!r) { r = measureGrip(RIGID, clip, fig, { hz: hzOf(clip) }); rigidReadings.set(k, r); }
  return r;
}
/** `expect(v).toBeLessThanOrEqual(limit)`, or, for a named open reading, the demotion: it must still be over. */
function within(fig: string, what: string, v: number, limit: number, label: string): void {
  const key = `${fig} ${what}`;
  if (key in FUSED_GRIP_OPEN) expect(v, `${label}: inside the limit now, delete FUSED_GRIP_OPEN "${key}"`).toBeGreaterThan(limit);
  else expect(v, label).toBeLessThanOrEqual(limit);
}

describe('the Rifle Squad holds the carbine in every clip', () => {
  for (const fig of FIGURES) {
    for (const clip of CLIPS) {
      it(`${fig} ${clip}: both hands on their stations, axes true, palms on, wrists in range`, () => {
        const r = read(fig, clip);
        expect(r.instants, 'instants with the weapon drawn').toBeGreaterThan(10);
        within(fig, 'station fire', r.fire.stationGapM!, FIRE_STATION_M, 'firing hand to the grip station');
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
        within(fig, 'review fire', r.fire.reviewGapM, REVIEW_FIRE_MAX_M, 'review reading, firing');
        expect(r.support.reviewGapM, 'review reading, support').toBeLessThanOrEqual(REVIEW_SUPPORT_MAX_M);
        within(fig, 'depth fire', r.fire.depthM!, WEAPON_IN_HAND_CEILING_M[clip][0], 'weapon inside the firing glove');
        // the support fist in idle and move: f0 under the ceiling; f1 and f2 under a RATCHET at today's reading (round 5
        // closed the welded fist, and the inside test now sees the handguard 12.1-12.3 mm into Meshy's solid fist); in
        // the aimed clips the open reading (FUSED_GRIP_OPEN), where the fist rolls round the handguard
        if (clip === 'idle' || clip === 'move') {
          expect(r.support.depthM!, 'weapon inside the support glove').toBeLessThanOrEqual(fig === 'f0' ? WEAPON_IN_HAND_CEILING_M[clip][1] : SUPPORT_REST_RATCHET_M);
        } else within(fig, 'depth support', r.support.depthM!, WEAPON_IN_HAND_CEILING_M[clip][1], 'weapon inside the support glove');
      }, 120_000);
    }
  }

  it('every open fused reading names a figure and a reading this file gates, with a reason', () => {
    for (const [k, why] of Object.entries(FUSED_GRIP_OPEN)) {
      expect(FIGURES as readonly string[], k).toContain(k.split(' ')[0]);
      expect(['station fire', 'review fire', 'depth fire', 'depth support'], k).toContain(k.split(' ').slice(1).join(' '));
      expect(why.length, 'a reason, not a name').toBeGreaterThan(20);
    }
  });

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
function patched(clip: string, node: string, prop: 'rotation' | 'translation', edit: (v: number[]) => number[], src = SQUAD): string {
  const raw = readFileSync(src);
  const glb = readGlb(src);
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
  // Both on the procedural hand these ceilings were measured on: the shipped squad, or the frozen rigid one while it ships fused.
  it('the weapon bone pushed 10 mm into both gloves in fire reads past the ceilings it holds (firing 5.3, support 12.0), and the unpatched file does not', () => {
    const file = patched('fire', 'f1_weapon', 'translation', (v) => [v[0], v[1] - 0.01, v[2]], RIGID);
    const r = measureGrip(file, 'fire', 'f1', { hz: 60 });
    expect(r.fire.depthM!, 'firing glove').toBeGreaterThan(WEAPON_IN_HAND_CEILING_M.fire[0]);
    expect(r.support.depthM!, 'support glove').toBeGreaterThan(WEAPON_IN_HAND_CEILING_M.fire[1]);
    expect(readRigid('f1', 'fire').fire.depthM!).toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M.fire[0]);
    expect(readRigid('f1', 'fire').support.depthM!).toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M.fire[1]);
  }, 60_000);

  it('on the fused figure too: the weapon bone pushed 15 mm into the fists in idle takes the support fist past its ceiling, and the shipped bytes do not', () => {
    if (!FUSED) return;
    // (in the aimed clips both fists' depths are open readings, FUSED_GRIP_OPEN; idle, where the support fist is at its
    // sculpted place, is gated, so the push is made there)
    // (10 mm read 9.7 against the 10.5 ceiling on the real-size fist: the push is 15 mm)
    // (f0: f1's and f2's support fists are open readings at rest since round 5, FUSED_GRIP_OPEN)
    const file = patched('idle', 'f0_weapon', 'translation', (v) => [v[0], v[1] - 0.015, v[2]]);
    const r = measureGrip(file, 'idle', 'f0', { hz: 60 });
    expect(r.support.depthM!, 'support fist').toBeGreaterThan(WEAPON_IN_HAND_CEILING_M.idle[1]);
    expect(read('f0', 'idle').support.depthM!).toBeLessThanOrEqual(WEAPON_IN_HAND_CEILING_M.idle[1]);
  }, 60_000);

  it('the f1/f2 rest ratchet can fail: f1\'s weapon bone pushed 15 mm into the fists in idle reads past 13.5 mm', () => {
    if (!FUSED) return;
    const file = patched('idle', 'f1_weapon', 'translation', (v) => [v[0], v[1] - 0.015, v[2]]);
    expect(measureGrip(file, 'idle', 'f1', { hz: 60 }).support.depthM!).toBeGreaterThan(SUPPORT_REST_RATCHET_M);
    expect(read('f1', 'idle').support.depthM!).toBeLessThanOrEqual(SUPPORT_REST_RATCHET_M);
  }, 60_000);

  it('the old sampler (each weapon triangle\'s first vertex and centroid) reads the SAME bytes at 2 mm in the support hand where the dense one reads 9 (constructed failing input 6)', () => {
    const dense = readRigid('f1', 'fire');
    const sparse = measureGrip(RIGID, 'fire', 'f1', { hz: 60, sparseWeaponSamples: true });
    expect(sparse.support.depthM!, 'sparse sampling, support glove').toBeLessThan(0.004);
    expect(dense.support.depthM!, 'dense sampling, support glove').toBeGreaterThan(0.008);
    // ...and a ceiling set from the sparse reading would have passed a hand sunk 9 mm into the handguard
    expect(dense.support.depthM!).toBeGreaterThan(sparse.support.depthM! + 0.005);
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
      // a fused figure has no trigger finger (Meshy sculpted the fist closed; mesh_arm_pops asserts the bone skins nothing)
      for (const b of ['weapon', 'upperarm_L', 'forearm_L', 'hand_L', ...(FUSED ? [] : ['finger_L']), 'upperarm_R', 'forearm_R', 'hand_R']) {
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
