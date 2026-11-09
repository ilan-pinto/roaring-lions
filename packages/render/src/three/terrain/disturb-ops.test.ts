/**
 * GH-943 P2 (T7): the bend's maths on numbers against LITERALS (worked by hand from the constants, not read back from the code
 * under test). The bodies are written once against `Ops<T>` and run here through `NUMBER_OPS`; the node twin runs the same bodies on
 * TSL nodes. `disturb.test.ts` separately compares them with the transpiled GLSL.
 *
 * Falsify (by hand, commit message):
 *  - sum the pushes as magnitudes: `px += Math.abs(p.px)` in `disturbDisplacement` (the cancel spec goes red);
 *  - the spring: `DISTURB_SPRING_ZETA` 0.45 -> 0.9 (the overshoot spec goes red);
 *  - the wash gain dropped: `DISTURB_WASH_PUSH_GAIN - 1` -> `0` in `disturbSlotPushOps` (the wash spec goes red).
 */
import { describe, expect, it } from 'vitest';
import { NUMBER_OPS } from '../fog-ops';
import {
  DISTURB_SLOT_WASH,
  disturbDisplacement,
  disturbProfile,
  disturbSlotPushOps,
  disturbThrash,
  type DisturberSlot,
} from './disturb';

const disc = (x: number, z: number, radius = 1, strength = 1, kind = 0): DisturberSlot => ({ ax: x, az: z, bx: x, bz: z, radius, strength, kind });
const push = (s: DisturberSlot, ox: number, oz: number, spring = 1): { px: number; pz: number; wash: number } =>
  disturbSlotPushOps(NUMBER_OPS, ox, oz, { ...s, kind: s.kind ?? 0 }, spring);

describe('the capsule push', () => {
  it('a disc pushes RADIALLY: away from its centre, full strength inside the core (0.55 of the radius)', () => {
    expect(push(disc(0, 0), 0.5, 0)).toEqual({ px: 1, pz: 0, wash: 0 });
    expect(push(disc(0, 0), 0, -0.5)).toEqual({ px: 0, pz: -1, wash: 0 });
    const diag = push(disc(0, 0), 0.3, 0.4); // d = 0.5, still in the core
    expect(diag.px).toBeCloseTo(0.6, 12);
    expect(diag.pz).toBeCloseTo(0.8, 12);
  });

  it('the falloff is a smoothstep from 0.55 to 1.25 of the radius: half way is half', () => {
    expect(push(disc(0, 0), 0.9, 0).px).toBeCloseTo(0.5, 12); // t = 0.5
    expect(push(disc(0, 0), 1.25, 0).px).toBe(0);
    expect(push(disc(0, 0), 2, 0).px).toBe(0);
    expect(push(disc(0, 0, 2), 1.8, 0).px).toBeCloseTo(0.5, 12); // the radius scales the reach
  });

  it('standing on the capsule pushes along +x (no direction to take)', () => {
    expect(push(disc(3, 3), 3, 3)).toEqual({ px: 1, pz: 0, wash: 0 });
  });

  it('two equal opposed pushes CANCEL (they add as vectors), each worth 0.2915 at a tile', () => {
    const left = push(disc(-1, 0), 0, 0);
    const right = push(disc(1, 0), 0, 0);
    expect(left.px).toBeCloseTo(0.29154518950437325, 12);
    expect(right.px).toBeCloseTo(-0.29154518950437325, 12);
    const both = disturbDisplacement([disc(-1, 0), disc(1, 0)], 0, 1, 0, 0, { x: 0, h: 1, z: 0 }, 1);
    expect(both).toEqual({ dx: 0, dy: 0, dz: 0 });
    // Anti-vacuity: either alone bends the blade.
    expect(Math.abs(disturbDisplacement([disc(-1, 0)], 0, 1, 0, 0, { x: 0, h: 1, z: 0 }, 1).dx)).toBeGreaterThan(0.1);
  });

  it('a rotor wash counts 1.7 times over a hull and is also summed on its own', () => {
    const wash = push(disc(0, 0, 1, 0.4, DISTURB_SLOT_WASH), 0.5, 0);
    expect(wash.px).toBeCloseTo(0.4 * 1.7, 12);
    expect(wash.wash).toBeCloseTo(0.4 * 1.7, 12);
    expect(push(disc(0, 0, 1, 0.4), 0.5, 0)).toEqual({ px: 0.4, pz: 0, wash: 0 });
  });
});

describe('the release spring', () => {
  it('starts at 1, overshoots about 20% (the dip below the track is -0.2053), and has settled by the tail (-0.0085)', () => {
    expect(disturbProfile(0, 1)).toBe(1);
    let lowest = Infinity;
    for (let i = 0; i <= 1000; i++) lowest = Math.min(lowest, disturbProfile(i / 1000, 1));
    expect(lowest).toBeCloseTo(-0.20534601927163817, 3);
    expect(lowest).toBeGreaterThan(-0.3); // the floor is never what bounds it
    expect(disturbProfile(1, 1)).toBeCloseTo(-0.008499966367317882, 9);
  });

  it('reduced motion (spring 0) is a monotone fall from 1 to 0, no dip', () => {
    let last = 1;
    for (let i = 0; i <= 100; i++) {
      const p = disturbProfile(i / 100, 0);
      expect(p).toBeLessThanOrEqual(last + 1e-12);
      expect(p).toBeGreaterThanOrEqual(0);
      last = p;
    }
    expect(disturbProfile(1, 0)).toBe(0);
  });
});

describe('the rotation about the foot', () => {
  const at = (cls: number, relH: number) => disturbDisplacement([disc(-0.5, 0)], cls, 1, 0, 0, { x: 0, h: relH, z: 0 }, 1);

  it('a blade of grass at a full push lies down to 0.8 of its height; a crown keeps all but 1% of its own', () => {
    const grass = at(0, 1);
    expect(grass.dy).toBeCloseTo(-0.8, 12);
    expect(grass.dx).toBeCloseTo(0.9797958971132712, 12);
    expect(grass.dz).toBe(0);
    const tree = at(3, 2);
    expect(tree.dy).toBeCloseTo(-0.02, 12);
    expect(tree.dx).toBeCloseTo(0.2821347195933178, 12);
  });

  it('leans AWAY from the disturber, on either side', () => {
    expect(disturbDisplacement([disc(0.5, 0)], 0, 1, 0, 0, { x: 0, h: 1, z: 0 }, 1).dx).toBeCloseTo(-0.9797958971132712, 12);
    expect(disturbDisplacement([disc(0, 0.5)], 0, 1, 0, 0, { x: 0, h: 1, z: 0 }, 1).dz).toBeCloseTo(-0.9797958971132712, 12);
  });

  it('a push that is gone moves nothing (the early return)', () => {
    expect(disturbDisplacement([disc(0, 0)], 0, 1, 5, 5, { x: 0, h: 1, z: 0 }, 1)).toEqual({ dx: 0, dy: 0, dz: 0 });
    expect(disturbDisplacement([], 0, 1, 0, 0, { x: 0, h: 1, z: 0 }, 1)).toEqual({ dx: 0, dy: 0, dz: 0 });
  });
});

describe('the thrash', () => {
  it('a shrub swings 0.5735 rad at a full wash on the peak of its cycle (a quarter period, phase 0); grass and reeds do not swing', () => {
    expect(disturbThrash(2, 1, 1, 0.1, 0)).toBeCloseTo(0.5735131044230968, 12);
    expect(disturbThrash(0, 1, 1, 0.1, 0)).toBe(0);
    expect(disturbThrash(1, 1, 1, 0.1, 0)).toBe(0);
    expect(disturbThrash(2, 1, 1, 0.3, 0)).toBeCloseTo(-0.5735131044230968, 12); // signed: back toward the hull
  });

  it('reaches a displacement only under a wash slot, and only with the spring on (reduced motion keeps the flatten, drops the thrash)', () => {
    const hull = [disc(-0.5, 0, 1, 1, 0)];
    const wash = [disc(-0.5, 0, 1, 1, DISTURB_SLOT_WASH)];
    const rel = { x: 0, h: 1, z: 0 };
    // A hull and a wash at the same push differ only by the thrash and the gain; at spring 0 the wash's lean is the same flatten.
    const hullNow = disturbDisplacement(hull, 2, 1, 0, 0, rel, 1, 0.1);
    const hullLater = disturbDisplacement(hull, 2, 1, 0, 0, rel, 1, 0.3);
    expect(hullNow).toEqual(hullLater); // no wash, no swing, whatever the clock
    const washNow = disturbDisplacement(wash, 2, 1, 0, 0, rel, 1, 0.1);
    const washLater = disturbDisplacement(wash, 2, 1, 0, 0, rel, 1, 0.3);
    expect(washNow.dx).not.toBeCloseTo(washLater.dx, 3);
    expect(disturbDisplacement(wash, 2, 1, 0, 0, rel, 0, 0.1)).toEqual(disturbDisplacement(wash, 2, 1, 0, 0, rel, 0, 0.3));
  });
});
