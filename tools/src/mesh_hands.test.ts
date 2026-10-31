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
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readGlb } from './mesh_gait';
import {
  HAND_BANDS, handViolations, measureHand, measureShippedHand, principalExtents, readingFrom, type HandReading,
} from './mesh_hands';

const PROBE = fileURLToPath(new URL('../../art/parts/hands/hands_probe.glb', import.meta.url));
const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));
const S = 1.778;

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
    it(`${team} ${prefix}_${side}: ${'rl_hands' in (readGlb(`${MESHES}${team}.glb`).json.scenes?.[0]?.extras ?? {}) ? 'carries hands: green' : 'still a Meshy claw: red'}`, () => {
      const carries = 'rl_hands' in (readGlb(`${MESHES}${team}.glb`).json.scenes?.[0]?.extras ?? {});
      const r = measureShippedHand(`${MESHES}${team}.glb`, prefix, side, wrist);
      const v = handViolations(r);
      if (carries) { expect(v).toEqual([]); return; }
      const text = v.join(' | ');
      expect(text, JSON.stringify(r)).toMatch(/visible forearm/);              // 0.03 to 0.13 against 0.255 to 0.285
      expect(text).toMatch(/hung elbow height/);                                // 0.38 to 0.57 against 0.605 to 0.625
      expect(r.forearmM).toBeLessThan(0.14);
      if (team !== 'demo_squad') expect(text).toMatch(/hand over forearm/);     // 2.3 to 5.9 against 0.42 to 0.62
    });
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
