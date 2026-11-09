/**
 * GH-943 P2 (T6): the wind written once against `Ops<T>` (`wind.ts`), on numbers. The node foliage twin runs these same bodies on
 * TSL nodes (`decor-mesh.node.ts`), so these readings are the twin's maths, not a transcription of it.
 *
 * Oracles are literals: the readings below were taken from `windLean` / `windGust` / `gustHash` / `swayOffset` BEFORE they were
 * re-expressed through `NUMBER_OPS` (GH-943 P2 T6), printed with full double precision, and retyped. `sway.ts`'s `swayOffset` is
 * the reduced-motion branch's independent oracle (it keeps its own maths). Falsifications, run by hand (commit message):
 *  - the gust phase with the wrong sign, `t + dot(p, dir) / SPEED` in `windGustOps`;
 *  - a trunk with a legacy amplitude (`legacySwayConstants`' `trunk ? 0` -> `trunk ? SWAY_AMPLITUDE`);
 *  - the mode select inverted in `foliageLeanOps`.
 */
import { describe, expect, it } from 'vitest';
import { NUMBER_INT_OPS, NUMBER_OPS } from '../fog-ops';
import { tileHash } from '../../tile-hash';
import { swayOffset } from './sway';
import {
  SWAY_DIR_X, SWAY_DIR_Z, WIND_GUST_SALT, foliageLeanOps, gustHash, legacySwayOps, windGust, windHashOps, windLean, windLeanOps,
  type FoliageLeanInputs, type WindClassId,
} from './wind';

const O = NUMBER_OPS;
const IO = NUMBER_INT_OPS;

describe('the field on numbers, against readings taken before the Ops rewrite', () => {
  it('windLean: four classes, dry (strength 1.3) and wet (strength 1), heading (0.8, -0.6)', () => {
    const rows: [WindClassId, number, number, number, number, number, number, number, number, number][] = [
      [3, 1, 0.9, 12.3, 5.5, 4.135, 0.02971155355311375, -0.022283665164835313, 0.05105019288200502, -0.038287644661503764],
      [0, 0.7, 0.2, 47.25, -3.1, 0.9530000000000001, 0.01174801727216359, -0.008811012954122692, 0.033294496749913784, -0.024970872562435336],
      [1, 0.4, 0.3, 101.7, 20.2, 9.574, 0.006528060909642395, -0.004896045682231795, 0.011047487693240977, -0.008285615769930732],
      [2, 1, 1, 7.9, 0.4, 2.248, -0.008195068955299893, 0.00614630171647492, -0.013868578232045972, 0.010401433674034479],
    ];
    for (const [cls, hN, h, t, ox, oz, dx, dz, wdx, wdz] of rows) {
      const d = windLean(cls, hN, h, t, ox, oz, { strength: 1.3, dirX: 0.8, dirZ: -0.6 });
      expect([d.dx, d.dz]).toEqual([dx, dz]);
      const w = windLean(cls, hN, h, t, ox, oz, { strength: 1, dirX: 0.8, dirZ: -0.6 }, true);
      expect([w.dx, w.dz]).toEqual([wdx, wdz]);
    }
  });
  it('windGust inside a gust (0 < g < 1), at (2.5, -1.25) along (0.6, -0.8), and the tree lean there', () => {
    const rows: [number, number, number, number][] = [
      [43.77000000000001, 0.7245352578716507, -0.01338136461824257, 0.017841819490990094],
      [49.97000000000001, 0.8660723501643787, 0.01995582755051482, -0.026607770067353095],
      [71.67, 0.5780859909348738, 0.012170294141421775, -0.016227058855229036],
      [77.86999999999999, 0.3074728321985459, -0.012975435624859913, 0.01730058083314655],
      [96.46999999999996, 0.4746402404801787, -0.0070588665487539715, 0.009411822065005297],
    ];
    for (const [t, g, dx, dz] of rows) {
      expect(windGust(t, 2.5, -1.25, 0.6, -0.8)).toBe(g);
      const l = windLean(3, 1, 0.8, t, 2.5, -1.25, { strength: 1, dirX: 0.6, dirZ: -0.8 });
      expect([l.dx, l.dz]).toEqual([dx, dz]);
    }
    // And a calm reading (the smoothstep floor) and a near-calm one.
    expect(windGust(10, 4, 9, 0.6, -0.8)).toBe(0.008774004590350647);
    expect(windGust(33.3, 20, 2, 0.6, -0.8)).toBe(0);
  });
  it('gustHash at five lattice points', () => {
    expect([-5, 0, 1, 77, 4096].map(gustHash)).toEqual([
      0.12640726566314697, 0.19826346635818481, 0.19324982166290283, 0.0820775032043457, 0.8222569823265076,
    ]);
  });
});

describe('the gust lattice hash on IntOps', () => {
  it('windHashOps is the top 24 bits of tileHash(i, salt), over negatives and products past 2^31', () => {
    let topBit = 0;
    for (let i = -3000; i <= 3000; i += 7) {
      const want = Math.floor(tileHash(i, WIND_GUST_SALT) * 16777216) / 16777216;
      expect(windHashOps(O, IO, i), `${i}`).toBe(want);
      if (tileHash(i, WIND_GUST_SALT) >= 0.5) topBit++;
    }
    // Anti-vacuity: the unsigned reading matters (a signed shift would corrupt these).
    expect(topBit).toBeGreaterThan(300);
  });
});

describe('foliageLeanOps: the whole lean the twin compiles', () => {
  const at = (k: number, mode: number, amp = 1): FoliageLeanInputs<number> => ({
    cls: k % 4,
    hN: ((k * 37) % 101) / 100,
    worldH: ((k * 53) % 131) / 100,
    t: k * 1.37 - 20,
    ox: ((k * 29) % 97) - 40 + 0.31,
    oz: ((k * 41) % 89) - 33 + 0.77,
    dirX: 0.8,
    dirZ: -0.6,
    strength: 1.3,
    mode,
    amp,
  });

  it('mode 1 is windLean, exactly, for every class, dry and wet', () => {
    let moved = 0;
    for (const wet of [false, true]) {
      for (let k = 0; k < 200; k++) {
        const x = at(k, 1);
        const got = foliageLeanOps(O, IO, x, wet, false);
        const want = windLean(x.cls as WindClassId, x.hN, x.worldH, x.t, x.ox, x.oz, { strength: 1.3, dirX: 0.8, dirZ: -0.6 }, wet);
        expect([got.dx, got.dz]).toEqual([want.dx, want.dz]);
        // A trunk plays the same wind (GH-984 N1).
        expect(foliageLeanOps(O, IO, x, wet, true)).toEqual(got);
        if (Math.abs(want.dx) > 1e-4) moved++;
      }
    }
    expect(moved).toBeGreaterThan(100);
  });

  it('mode 0 is the legacy sway (sway.ts swayOffset): the fixed axis, the periodic gust, crowns only', () => {
    let moved = 0;
    for (const wet of [false, true]) {
      for (let k = 0; k < 200; k++) {
        const x = at(k, 0);
        const got = foliageLeanOps(O, IO, x, wet, false);
        const want = swayOffset(x.worldH, x.t, x.ox, x.oz, wet);
        expect(got.dx).toBeCloseTo(want.dx, 12);
        expect(got.dz).toBeCloseTo(want.dz, 12);
        if (Math.abs(want.dx) > 1e-4) moved++;
      }
    }
    expect(moved).toBeGreaterThan(100);
    // It ignores the map's heading: the fixed screen-right axis.
    const x = at(17, 0);
    const s = legacySwayOps(O, x.worldH, x.t, x.ox, x.oz, false, false);
    expect(foliageLeanOps(O, IO, x, false, false)).toEqual({ dx: SWAY_DIR_X * s, dz: SWAY_DIR_Z * s });
  });

  it('reduced motion: a trunk holds still (legacy amplitude 0), at every sample, dry and wet', () => {
    for (const wet of [false, true]) {
      for (let k = 0; k < 200; k++) {
        const got = foliageLeanOps(O, IO, at(k, 0), wet, true);
        expect(Math.abs(got.dx) + Math.abs(got.dz)).toBe(0);
      }
    }
  });

  it('uSwayAmp scales both modes, and 0 is the rest pose (the `wind` layer)', () => {
    for (const mode of [0, 1]) {
      for (let k = 0; k < 50; k++) {
        const one = foliageLeanOps(O, IO, at(k, mode), false, false);
        const half = foliageLeanOps(O, IO, at(k, mode, 0.5), false, false);
        const off = foliageLeanOps(O, IO, at(k, mode, 0), false, false);
        expect(half.dx).toBeCloseTo(one.dx / 2, 15);
        expect(Math.abs(off.dx) + Math.abs(off.dz)).toBe(0);
      }
    }
  });

  it('windLeanOps reads the class tables by id (selects at the half-integers, like int(cls + 0.5))', () => {
    const args = [0.6, 0.7, 13.1, 2.2, 5.3, 0.8, -0.6, 1] as const;
    for (const cls of [0, 1, 2, 3] as WindClassId[]) {
      const exact = windLeanOps(O, IO, cls, ...args, false);
      expect(windLeanOps(O, IO, cls + 0.3, ...args, false)).toBe(exact);
      expect(windLeanOps(O, IO, cls - 0.3, ...args, false)).toBe(exact);
    }
    expect(windLeanOps(O, IO, 0, ...args, false)).not.toBe(windLeanOps(O, IO, 1, ...args, false));
  });
});
