/**
 * Hand proportion (GH-826 F1, spec 1.10): L x W x T, the visible forearm, hand over forearm, the
 * hung elbow height. The instrument is `mesh_hands.ts`; the bands are the spec's literals (the cap is 400
 * since R0b, departure 17).
 *
 * STEP 1 STATE. No shipped figure has a hand bone yet, so two things are read here:
 *  - `art/parts/hands/hands_probe.glb`, the generator's own hands on the bones the hands pass will
 *    add (`export_hands_probe.py`): GREEN;
 *  - today's `art/meshes/{inf_squad,demo_squad,breach_team}.glb`, through the fallback hand (the
 *    forearm bone's vertices past the review's measured wrist): RED, for the spec's reasons.
 *    That block pins both directions: a file that does not carry `rl_hands` must be red, and
 *    one that does must be green, so the hands pass cannot ship without turning it.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readGlb } from './mesh_gait';
import { isFusedHands } from './mesh_hand_source';
import {
  HAND_BANDS, handViolations, measureHand, measureShippedHand, principalExtents, readingFrom, type HandReading,
} from './mesh_hands';

const PROBE = fileURLToPath(new URL('../../art/parts/hands/hands_probe.glb', import.meta.url));
const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));
const S = 1.778;
/** The frozen rigid Rifle Squad (origin/main before the GH-746 Meshy pilot; see fixtures/README.txt): the one figure the
 *  hands pass built, read in its place while the shipped inf_squad is a fused Meshy figure. */
const RIGID_SQUAD = fileURLToPath(new URL('./fixtures/inf_squad_rigid_592ebbb19.glb', import.meta.url));
/** A shipped team file, or, for a team whose shipped file is now FUSED (Meshy-sculpted fists, `rl_hands.source`
 *  "meshy") and which had a hands-pass generation, that frozen generation: the gate keeps its subject. */
const handsPassFileOf = (team: string): string => {
  const shipped = `${MESHES}${team}.glb`;
  if (!isFusedHands(shipped)) return shipped;
  if (team === 'inf_squad') return RIGID_SQUAD;
  throw new Error(`${team}: shipped fused, and no frozen hands-pass generation to read in its place`);
};

describe('the generator\'s hands, on bones', () => {
  const hands: [string, 'L' | 'R', string][] = [['p0', 'L', 'grip, anatomical right'], ['p1', 'R', 'support, anatomical left'], ['p2', 'R', 'shield handle']];
  for (const [prefix, side, what] of hands) {
    it(`${prefix} (${what}) is inside every band`, () => {
      const r = measureHand(PROBE, prefix, side, S);
      expect(handViolations(r), JSON.stringify(r)).toEqual([]);
    });
  }

  it('reads the palm\'s breadth off the hand bone\'s own frame: 0.094 on all three poses, whatever the thumb does', () => {
    for (const [prefix, side] of [['p0', 'L'], ['p1', 'R'], ['p2', 'R']] as const) {
      expect(measureHand(PROBE, prefix, side, S).palmBreadthM).toBeCloseTo(0.094, 3);
    }
    // the principal-axis W is far wider (0.13 to 0.15): that is the thumb, which is why W is reported and not gated
    expect(measureHand(PROBE, 'p1', 'R', S).widthM).toBeGreaterThan(0.14);
  });

  it('reads the visible forearm and the hung elbow height off the joints, not off the generator', () => {
    const r = measureHand(PROBE, 'p0', 'L', S);
    expect(r.forearmM).toBeCloseTo(0.268, 3);
    expect(r.elbowOverStature!).toBeCloseTo(0.615, 3);
  });

  it('keeps the firing hand\'s trigger finger on its own bone, inside the whole-hand length band', () => {
    const r = measureHand(PROBE, 'p0', 'L', S);
    expect(r.hasFingerBone).toBe(true);
    expect(r.lengthWithFingerM).toBeGreaterThan(r.lengthM);
    expect(r.lengthWithFingerM).toBeLessThan(HAND_BANDS.lengthWithFingerM[1]);
  });

  it('stays at or under 400 triangles a living hand and 64 a corpse fist', () => {
    const glb = readGlb(PROBE);
    const tri = new Map<string, number>();
    for (const n of glb.json.nodes ?? []) {
      if (n.mesh === undefined || !n.name) continue;
      const prim = glb.json.meshes![n.mesh].primitives[0];
      const count = glb.json.accessors![prim.indices!].count / 3;
      const fig = n.name.slice(0, 2);
      tri.set(fig, (tri.get(fig) ?? 0) + count);
    }
    for (const fig of ['p0', 'p1', 'p2']) expect(tri.get(fig), fig).toBeLessThanOrEqual(400);
    expect(tri.get('p3')).toBeLessThanOrEqual(64);
    expect(tri.get('p0')).toBeGreaterThan(350);              // not a hollow pass: this is a modelled hand
  });
});

describe('falsification: today\'s shipped bytes', () => {
  // the review's measured wrists (`_coord/inf-review/data/<team>.json`, wrist_t), metres along the elbow-to-tip axis
  const SHIPPED: [string, string, 'L' | 'R', number][] = [
    ['inf_squad', 'f1', 'L', 0.04], ['inf_squad', 'f1', 'R', 0.10],
    ['demo_squad', 'demo_a', 'L', 0.12], ['demo_squad', 'demo_b', 'R', 0.13],
    ['breach_team', 'brc_point', 'R', 0.03],
  ];
  for (const [team, prefix, side, wrist] of SHIPPED) {
    const file = handsPassFileOf(team);
    it(`${team} ${prefix}_${side}: ${'rl_hands' in (readGlb(file).json.scenes?.[0]?.extras ?? {}) ? 'carries hands: green' : 'still a Meshy claw: red'}`, () => {
      const carries = 'rl_hands' in (readGlb(file).json.scenes?.[0]?.extras ?? {});
      const r = measureShippedHand(file, prefix, side, wrist);
      const v = handViolations(r);
      if (carries) { expect(v).toEqual([]); return; }
      const text = v.join(' | ');
      expect(text, JSON.stringify(r)).toMatch(/visible forearm/);              // 0.03 to 0.13 against 0.255 to 0.285
      // the hung elbow reads low only where the Meshy arm's elbow really is (Breach 0.536); the Demolition figures' read 0.597
      // and 0.614 against the kit-free stature, which is in or at the band: the review's 0.38 to 0.57 came from a stature that
      // counted the worn kit's whip and helmet cover
      if (team === 'breach_team') expect(text).toMatch(/hung elbow height/);
      expect(r.forearmM).toBeLessThan(0.14);
      if (team !== 'demo_squad') expect(text).toMatch(/hand over forearm/);     // 2.3 to 5.9 against 0.42 to 0.62
    });
  }
});


describe('every figure of a team the hands pass has been through carries proportioned hands (GH-826 step 2)', () => {
  it('reads the hands-pass population: the Rifle Squad, shipped or (while it ships fused) its frozen rigid generation', () => {
    expect(isFusedHands(handsPassFileOf('inf_squad')), 'the subject is a hands-pass figure').toBe(false);
  });
  for (const team of ['inf_squad']) {
    for (const prefix of ['f0', 'f1', 'f2']) {
      for (const side of ['L', 'R'] as const) {
        it(`${team} ${prefix}_${side}: length, palm, thickness, forearm and hung elbow inside the bands`, () => {
          const r = measureShippedHand(handsPassFileOf(team), prefix, side, 0);
          expect(r.elbowOverStature, 'read with a stature (hand bones present)').not.toBeNull();
          expect(handViolations(r), JSON.stringify(r)).toEqual([]);
        });
      }
    }
  }
});

/**
 * A FUSED figure's hands (GH-746 Meshy pilot): fists Meshy sculpted closed on the gun, skinned rigidly to the hand bones.
 * Not the hands pass's output, but the same anthropometry applies, read by the same instrument on the hand bones, with
 * the same literal bands. Every violation the bytes show today is listed per hand with its reading (the open defects of
 * the pilot, for the lead and the high-effort review), and the list is exact both ways: a violation not listed fails, and
 * a listed one that is gone fails (delete it). Read 9 Nov 2026 on the round-3 bytes.
 *
 *   - fist length 0.157-0.183 m against 0.115-0.16 on 5 of 6 hands (the sculpted fist; the 3 cm cuff blend is forearm-
 *     dominant, so not that): the fists read large;
 *   - visible forearm 0.248-0.257 on the support side (anatomical left, `_R`) and 0.320-0.352 on the firing side: the
 *     importer's elbow joints, not the sleeve (the support elbow sits inside the sleeve bulge, round-1 notes);
 *   - hung elbow 0.644-0.648 of stature against 0.605-0.625: the elbow joints sit 3-4 cm high on every figure;
 *   - hand over forearm 0.631-0.656 on the support side, from the short support forearm.
 */
const FUSED_HAND_OPEN: Readonly<Record<string, readonly string[]>> = {
  'inf_squad f0_L': ['hand length', 'visible forearm', 'hung elbow height over stature'],
  'inf_squad f0_R': ['hand over forearm', 'visible forearm', 'hung elbow height over stature'],
  'inf_squad f1_L': ['hand length', 'visible forearm', 'hung elbow height over stature'],
  'inf_squad f1_R': ['hand length', 'hand over forearm', 'visible forearm', 'hung elbow height over stature'],
  'inf_squad f2_L': ['hand length', 'visible forearm', 'hung elbow height over stature'],
  'inf_squad f2_R': ['hand length', 'hand over forearm', 'hung elbow height over stature'],
};

describe('a fused (Meshy) figure\'s hands, against the same bands: every violation named', () => {
  const fused = readdirSync(MESHES).filter((n) => n.endsWith('.glb')).map((n) => n.slice(0, -4)).filter((t) => isFusedHands(`${MESHES}${t}.glb`));
  it('reads the fused population: today the Rifle Squad alone, and every exemption names one of its hands', () => {
    expect(fused).toEqual(['inf_squad']);
    for (const k of Object.keys(FUSED_HAND_OPEN)) expect(fused, k).toContain(k.split(' ')[0]);
  });
  for (const team of fused) {
    for (const prefix of ['f0', 'f1', 'f2']) {
      for (const side of ['L', 'R'] as const) {
        it(`${team} ${prefix}_${side}: palm and thickness in band; the open violations exactly as listed`, () => {
          const r = measureShippedHand(`${MESHES}${team}.glb`, prefix, side, 0);
          expect(r.elbowOverStature, 'read with a stature (hand bones present)').not.toBeNull();
          const names = handViolations(r).map((v) => v.replace(/ [-\d.]+ (outside|over) .*$/, ''));
          expect(names, JSON.stringify(r)).toEqual(FUSED_HAND_OPEN[`${team} ${prefix}_${side}`] ?? []);
        });
      }
    }
  }
});

describe('the instrument can fail', () => {
  const good = measureHand(PROBE, 'p1', 'R', S);
  it('flags a palm 1.25x wide (the spec\'s second failing input: 0.094 becomes 0.118)', () => {
    const r: HandReading = { ...good, palmBreadthM: good.palmBreadthM * 1.25 };
    expect(r.palmBreadthM).toBeGreaterThan(0.117);
    expect(handViolations(r).join()).toMatch(/palm breadth/);
  });
  it('flags a forearm that is a stub', () => {
    const r: HandReading = { ...good, forearmM: 0.04, handOverForearm: good.lengthM / 0.04 };
    expect(handViolations(r).join()).toMatch(/visible forearm/);
  });
  it('flags a hand a block thick', () => {
    expect(handViolations({ ...good, thicknessM: 0.12 }).join()).toMatch(/thickness/);
  });
  it('flags a figure whose elbow hangs too low', () => {
    expect(handViolations({ ...good, elbowOverStature: 0.535 }).join()).toMatch(/elbow height/);
  });
  it('refuses an empty point set instead of passing it', () => {
    expect(() => principalExtents([])).toThrow();
    expect(() => readingFrom('x', [], [], [0, 0, 0], [0, 0.268, 0], S)).toThrow();
  });
  it('principal extents of a known box come out as its sides', () => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 10; j++) for (let k = 0; k <= 4; k++) pts.push([i * 0.01, j * 0.01, k * 0.01]);
    const [a, b, c] = principalExtents(pts);
    expect(a).toBeCloseTo(0.2, 1); expect(b).toBeCloseTo(0.1, 1); expect(c).toBeCloseTo(0.04, 1);
  });
});
