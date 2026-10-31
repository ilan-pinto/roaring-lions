/**
 * GH-871 P4 S-L2 ruling 3: the rain lift on KDF figures, calibrated on the
 * readability the lead's S-L2 look measured, with NO browser.
 *
 * The ruling: "a small lift for KDF infantry under rain on wet maps only ...
 * so infantry clear the 15.6 floor on the wet road and in marsh water
 * (measured as at S-L2, with both methods). Keep grass readable." The S-L2
 * readings (`_coord/wet-theme/p4/look2/readability.txt`, z2.5, high, rain),
 * CIEDE2000 of the squad against the ground it stood on, method A (the 20% of
 * pixels farthest from the ground) / method B (the darkest 15%):
 *
 *     road   8.2 / 9.0    water 4.0 / 6.4    grass 30.7 / 31.1    (floor 15.6)
 *
 * THE MODEL. The captured sRGB figure colour is run back through three's ACES
 * (`ACESFilmicToneMapping`, exposure 1.0: the matrices and the RRT/ODT fit
 * below are three r186's `tonemapping_pars_fragment`) to scene radiance,
 * `gain x overcast.1` (the emissive the lift adds, linear) is added, and the
 * sum is run forward again to the display. dE2000 against the ground is the
 * repo's own `deltaE2000`. At gain 0 the model must reproduce the S-L2 numbers
 * (it does: the first two tests), so its inverse is checked against the
 * measurement before any lift is believed.
 *
 * ASSUMPTIONS and LIMITS, in the order they are likely to bite:
 *  - the figure sample is all unit pixels. S-L2 says the water squad stands in
 *    reed decor (a share of the sample is reeds, which no unit lift moves), and
 *    a cast shadow on the road is ground. `share` below dilutes the lift: at
 *    0.75 the smallest passing gain is 0.5, at 0.5 it is 0.8. The recapture,
 *    not this file, decides whether the real sample is diluted.
 *  - the lift is attenuated by 0.74 (`1 - hazeFar`, the rain's maximum haze)
 *    before it reaches the display. The shader adds the emissive unattenuated,
 *    so the real lift is up to 1/0.74 stronger than modelled: that error is on
 *    the safe side for road and water and harmless for grass (its dE rises
 *    with gain up to 1.0 in the table).
 *  - a mean figure colour stands for a pixel set; the model lifts the mean, not
 *    each pixel, and method B's darkest pixels are a constant lift's best case.
 *  - bloom, the SMAA/vignette in `OutputPass`, and 8-bit quantisation are not
 *    modelled (the sample colours are integers, so +-0.5/255 is the floor).
 *
 * Every number is a LITERAL: the grounds and figures from `readability.txt`,
 * the dE tables recomputed here with `delta-e2000.ts` when this was written.
 * Only the gain under test comes from the shipped table.
 */
import { describe, expect, it } from 'vitest';
import { deltaE2000, linearHex } from './delta-e2000';
import { WET_SURFACE_PARAMS, SURFACE_PARAMS } from '../../packages/render/src/three/units/unit-surface';

type V = [number, number, number];

/** The lift's colour: `overcast.1`, the rain sky (a LITERAL, not the palette read). */
const SKY_HEX = '#9FA9B5';
/** `1 - hazeFar` at its rain maximum: the modelled attenuation of the lift. */
const HAZE_KEEP = 0.74;
const FLOOR = 15.6;
const MARGIN = 3;
const GRASS_MIN = 20;

const GROUND: Record<'road' | 'water' | 'grass', V> = { road: [41, 37, 29], water: [30, 25, 15], grass: [67, 96, 56] };
/** The S-L2 figure samples: [method A, method B]. */
const FIGURE: Record<'road' | 'water' | 'grass', [V, V]> = {
  road: [[15, 10, 5], [8, 6, 2]],
  water: [[23, 19, 15], [11, 5, 2]],
  grass: [[14, 11, 7], [8, 6, 3]],
};
/** The S-L2 record, dE2000 A / B. */
const MEASURED: Record<'road' | 'water' | 'grass', [number, number]> = {
  road: [8.2, 9.0],
  water: [4.0, 6.4],
  grass: [30.7, 31.1],
};

const toLin = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lin3 = (c: V): V => [toLin(c[0]), toLin(c[1]), toLin(c[2])];

/* three r186 ACESFilmicToneMapping, exposure 1.0 (row-major form of its GLSL mat3s). */
const MI = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const MO = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];
const mul = (m: number[][], v: V): V =>
  [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as V;
const fit = (v: number): number =>
  (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** Scene radiance (linear) to display-linear. */
const aces = (c: V): V => mul(MO, mul(MI, c.map((q) => q / 0.6) as V).map(fit) as V).map(clamp01) as V;

const inv3 = (m: number[][]): number[][] => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
};
const MIi = inv3(MI);
const MOi = inv3(MO);
/** The RRT/ODT fit's inverse: the positive root of `fit(v) = y`. */
const fitInv = (y: number): number => {
  const A = 1 - 0.983729 * y;
  const B = 0.0245786 - 0.432951 * y;
  const C = -(0.000090537 + 0.238081 * y);
  if (Math.abs(A) < 1e-12) return -C / B;
  return Math.max(0, (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A));
};
/** Display-linear back to scene radiance. */
const acesInv = (t: V): V => {
  const v = mul(MOi, t).map(fitInv) as V;
  return mul(MIi, v).map((q) => Math.max(0, q * 0.6)) as V;
};

const SKY_LIN = linearHex(SKY_HEX) as unknown as V;

/** The figure sample after a lift of `gain` on a `share` of its pixels. */
function lifted(figure: V, gain: number, share = 1): V {
  const r = acesInv(lin3(figure));
  return aces(r.map((x, i) => x + share * gain * HAZE_KEEP * SKY_LIN[i]) as V);
}
/** dE2000 of the lifted figure against its ground. */
function de(kind: 'road' | 'water' | 'grass', method: 0 | 1, gain: number, share = 1): number {
  return deltaE2000(lifted(FIGURE[kind][method], gain, share), lin3(GROUND[kind]));
}
const need = (kind: 'road' | 'water' | 'grass'): number => (kind === 'grass' ? GRASS_MIN : FLOOR + MARGIN);
const KINDS = ['road', 'water', 'grass'] as const;

describe('the S-L2 readings, as literals', () => {
  it('the recorded figures and grounds give the recorded dE2000 (the literals are the record)', () => {
    for (const k of KINDS) {
      for (const m of [0, 1] as const) {
        const direct = deltaE2000(lin3(FIGURE[k][m]), lin3(GROUND[k]));
        expect(direct, `${k} method ${m === 0 ? 'A' : 'B'}`).toBeCloseTo(MEASURED[k][m], 0);
        // The record's figures are rounded integers; 0.2 is the rounding, not slack.
        expect(Math.abs(direct - MEASURED[k][m])).toBeLessThan(0.2);
      }
    }
  });

  it('the model at gain 0 reproduces them (the ACES inverse is checked against the measurement)', () => {
    for (const k of KINDS) {
      for (const m of [0, 1] as const) {
        expect(Math.abs(de(k, m, 0) - MEASURED[k][m]), `${k} ${m}`).toBeLessThan(0.35);
      }
    }
  });

  it('the road and the water are below the floor today, and grass is well above it', () => {
    expect(de('road', 0, 0)).toBeLessThan(FLOOR);
    expect(de('water', 1, 0)).toBeLessThan(FLOOR);
    expect(de('grass', 0, 0)).toBeGreaterThan(30);
  });
});

describe('the shipped lift', () => {
  const GAIN = WET_SURFACE_PARAMS.kdfFigureLift as number;

  it('the wet table carries a gain and the shipped table carries none', () => {
    expect(typeof GAIN).toBe('number');
    expect(GAIN).toBe(0.4);
    expect('kdfFigureLift' in SURFACE_PARAMS).toBe(false);
  });

  it('clears road and marsh water at the floor plus a margin of 3, and grass at 20, on BOTH methods', () => {
    for (const k of KINDS) {
      for (const m of [0, 1] as const) {
        expect(de(k, m, GAIN), `${k} method ${m === 0 ? 'A' : 'B'}`).toBeGreaterThanOrEqual(need(k));
      }
    }
  });

  it('the model table at the shipped gain (literals)', () => {
    const want: Record<(typeof KINDS)[number], [number, number]> = {
      road: [24.0, 23.4],
      water: [28.9, 26.9],
      grass: [23.1, 23.1],
    };
    for (const k of KINDS) {
      for (const m of [0, 1] as const) expect(Math.abs(de(k, m, GAIN) - want[k][m]), `${k} ${m}`).toBeLessThan(0.1);
    }
  });

  it('is the smallest grid step that passes: 0.30 misses the road, 0.35 passes', () => {
    expect(de('road', 0, 0.3)).toBeLessThan(need('road'));
    expect(de('road', 0, 0.35)).toBeGreaterThanOrEqual(need('road'));
    expect(de('road', 1, 0.35)).toBeGreaterThanOrEqual(need('road'));
  });

  it('keeps grass readable at three times the gain (a cold lift does not walk onto the green)', () => {
    for (const m of [0, 1] as const) expect(de('grass', m, GAIN * 3)).toBeGreaterThanOrEqual(GRASS_MIN);
  });

  it('an albedo-proportional lift in the KDF olive reaches the road floor only by losing grass: the reason for the sky colour', () => {
    // The cheaper-looking `emissive = colour x gain`, modelled with olive.1 (#6E7449) as the colour: at
    // the gains where it clears the road (olive gain 0.8 and 1.2 give 22.4 and 31.1 on the road) the
    // lifted figure reaches the green ground's own lightness and grass drops to 8.0 and 13.5.
    const OLIVE = linearHex('#6E7449') as unknown as V;
    const grey = (kind: 'road' | 'grass', gain: number): number => {
      const r = acesInv(lin3(FIGURE[kind][0]));
      const d = aces(r.map((x, i) => x + gain * HAZE_KEEP * OLIVE[i]) as V);
      return deltaE2000(d, lin3(GROUND[kind]));
    };
    for (const gain of [0.8, 1.2]) {
      expect(grey('road', gain)).toBeGreaterThan(22);
      expect(grey('grass', gain)).toBeLessThan(GRASS_MIN);
    }
  });

  it('SENSITIVITY (not a gate): a sample that is only 75% unit pixels needs 0.5, one at 50% needs 0.8', () => {
    expect(de('road', 1, 0.4, 0.75)).toBeLessThan(need('road'));
    for (const k of KINDS) for (const m of [0, 1] as const) expect(de(k, m, 0.5, 0.75), `${k} ${m}`).toBeGreaterThanOrEqual(need(k));
    for (const k of KINDS) for (const m of [0, 1] as const) expect(de(k, m, 0.8, 0.5), `${k} ${m}`).toBeGreaterThanOrEqual(need(k));
  });
});
