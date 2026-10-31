/**
 * GH-871 P4 PR 914 (the lead's ruling 1): the KDF figure's rain RIM, the model behind its
 * PROVISIONAL gain (`RAIN_KDF_RIM_GAIN`, `weather.ts`), with NO browser. The controller replaces the
 * gain with the measured pick from `pnpm ground:capture -- --rim=...`; this file is the reasoning
 * for the number it ships with, and the pure maths of the rim factor.
 *
 * THE RIM: `gain x overcast.1 x (1 - n.v)^power` is added as emission (`units/rain-rim.ts`). It is
 * nothing in the middle of a figure and largest on its outline.
 *
 * THE AREA SHARE. For a sphere seen from afar, a pixel at radius rho (0..1) has n.v = sqrt(1 - rho^2)
 * and the disk's area is uniform in rho^2, so the factor's mean over the figure is
 * 2 / ((p + 1)(p + 2)): 0.1 at p = 3, against the retired flat lift's 1.0 everywhere. 4.3% of the
 * area has a factor of at least 0.5, 13.7% at least 0.25 and 28.7% at least 0.1. A limb is nearer a
 * vertical cylinder seen from the dimetric camera (elevation 30 degrees, from the rain box's
 * `H / tan(elevation) = 10.4` for `H = 6`): n.v = cos(30) x sqrt(1 - x^2), mean factor 0.077.
 * The OUTERMOST pixel of a limb of half-width W pixels sits at x = 1 - 0.5 / W: its factor is 0.39 at
 * W = 10 (a torso at z2.5), 0.28 at W = 6 and 0.20 at W = 4. The model reads the outer pixel at 0.4.
 *
 * THE GAIN. The S-L2 figure (look 2: method B, the darkest 15%, which the rim does not touch inside
 * the figure) plus the rim's radiance at the outer pixel, run forward through three r186's ACES to
 * the display, compared in LUMINANCE with the wet ground it stands on (look 2's ground colours).
 * The pick: the outer rim pixel at about 1.5 x the road's luminance, so the outline reads against the
 * dark ground; on marsh water, darker still, the same rim is brighter against it, on the bright
 * grass it stays nearer the ground and the figure keeps its S-L2 contrast there. The first pick,
 * 0.4 put the road at 1.63 x; look4 (the lead's one extra run, gains 0 to 0.9) showed 0.2 and 0.4
 * nearly invisible, 0.6 the smallest visible rim without frost and 0.9 frost, so the SHIPPED gain
 * is 0.6: the model puts the outermost pixel at 2.84 x the road (look4 measured it as a dotted pale
 * outline at 3 to 4x zoom; no gain cleared dE 15.6, the model's luminance ratio is not dE). The mean
 * radiance the rim adds to a figure is 0.1 x 0.6 x 0.74 x 0.391 = 0.0174, 15% of the retired flat
 * lift's 0.116.
 *
 * Every number is a LITERAL (the grounds and figure samples from `look3/readability.txt`, (2)).
 */
import { describe, expect, it } from 'vitest';

type V = [number, number, number];

/** `overcast.1` (a literal, not the palette read), linear. */
const SKY: V = [0.346704, 0.396755, 0.462077];
const SKY_LUMA = 0.2126 * SKY[0] + 0.7152 * SKY[1] + 0.0722 * SKY[2];
/** `1 - hazeFar` at its rain maximum: the modelled attenuation (the shader adds the rim unattenuated). */
const HAZE_KEEP = 0.74;
const POWER = 3;
/** The shipped provisional gain, as a literal. */
const GAIN = 0.6;
/** The outermost pixel's rim factor (a torso half-width of 10 px). */
const F_OUTER = 0.4;

const GROUND: Record<'road' | 'water' | 'grass', V> = { road: [44, 42, 34], water: [32, 26, 16], grass: [68, 97, 56] };
/** The S-L2 figure, method B (the darkest 15%): what the rim sits on. */
const FIGURE: Record<'road' | 'water' | 'grass', V> = { road: [10, 7, 3], water: [14, 9, 4], grass: [12, 9, 5] };
const KINDS = ['road', 'water', 'grass'] as const;

const toLin = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lin3 = (c: V): V => [toLin(c[0]), toLin(c[1]), toLin(c[2])];
const luma = (l: V): number => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];

/* three r186 ACESFilmicToneMapping, exposure 1.0 (row-major form of its GLSL mat3s). */
const MI = [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]];
const MO = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul = (m: number[][], v: V): V => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as V;
const fit = (v: number): number => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
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
const fitInv = (y: number): number => {
  const A = 1 - 0.983729 * y;
  const B = 0.0245786 - 0.432951 * y;
  const C = -(0.000090537 + 0.238081 * y);
  if (Math.abs(A) < 1e-12) return -C / B;
  return Math.max(0, (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A));
};
const acesInv = (t: V): V => mul(MIi, mul(MOi, t).map(fitInv) as V).map((q) => Math.max(0, q * 0.6)) as V;

/** The rim factor `(1 - n.v)^p` at `n.v`. */
const factor = (nv: number, p = POWER): number => (1 - nv) ** p;

/** The display luminance of the figure's dark texel with the rim at factor `f` and gain `g` added. */
function rimLuma(kind: (typeof KINDS)[number], g: number, f: number): number {
  const scene = acesInv(lin3(FIGURE[kind]));
  return luma(aces(scene.map((x, i) => x + g * HAZE_KEEP * f * SKY[i]) as V));
}
/** Rim luminance over the ground's, on the display. */
const ratio = (kind: (typeof KINDS)[number], g: number, f: number): number => rimLuma(kind, g, f) / luma(lin3(GROUND[kind]));

/** The mean of `fn(rho)` over a disk, by midpoint quadrature in rho^2 (uniform area). */
function diskMean(fn: (nv: number) => number, n = 20000): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += fn(Math.sqrt(1 - (i + 0.5) / n));
  return s / n;
}

describe('the rim factor over a figure (the area share)', () => {
  it('the sphere\'s mean factor is 2 / ((p + 1)(p + 2)): 0.1 at p = 3, a tenth of the flat lift', () => {
    expect(diskMean((nv) => factor(nv))).toBeCloseTo(0.1, 3);
    expect(diskMean((nv) => factor(nv, 2))).toBeCloseTo(1 / 6, 3);
    expect(diskMean((nv) => factor(nv, 4))).toBeCloseTo(1 / 15, 3);
  });

  it('4.3% of the area has a factor of at least 0.5, 13.7% at least 0.25, 28.7% at least 0.1 (p = 3)', () => {
    const share = (t: number): number => {
      const u = 1 - t ** (1 / POWER);
      return u * u;
    };
    expect(share(0.5)).toBeCloseTo(0.0426, 3);
    expect(share(0.25)).toBeCloseTo(0.1368, 3);
    expect(share(0.1)).toBeCloseTo(0.2868, 3);
    // ...and the quadrature agrees with the closed form.
    const n = 20000;
    let hit = 0;
    for (let i = 0; i < n; i++) if (factor(Math.sqrt(1 - (i + 0.5) / n)) >= 0.5) hit++;
    expect(hit / n).toBeCloseTo(0.0426, 3);
  });

  it('a limb is a vertical cylinder under the 30 degree camera: mean 0.077, and the outer pixel\'s factor by half-width', () => {
    const ce = Math.cos(Math.PI / 6);
    const N = 100000;
    let s = 0;
    for (let i = 0; i < N; i++) s += factor(ce * Math.sqrt(1 - ((i + 0.5) / N) ** 2));
    expect(s / N).toBeCloseTo(0.0769, 3);
    const outer = (w: number): number => factor(ce * Math.sqrt(1 - (1 - 0.5 / w) ** 2));
    expect(outer(10)).toBeCloseTo(0.388, 3);
    expect(outer(6)).toBeCloseTo(0.28, 2);
    expect(outer(4)).toBeCloseTo(0.196, 3);
  });

  it('the middle of a figure gets nothing: n.v = 1 is exactly 0, and the silhouette edge is exactly 1', () => {
    expect(factor(1)).toBe(0);
    expect(factor(0)).toBe(1);
    expect(factor(0.9)).toBeCloseTo(0.001, 6);
  });
});

describe('the shipped gain (0.6, from look4), by luminance against the ground', () => {
  it('reproduces the S-L2 figure with no rim: dark against every ground (the model\'s inverse is checked first)', () => {
    for (const k of KINDS) expect(rimLuma(k, 0, F_OUTER) / luma(lin3(FIGURE[k]))).toBeCloseTo(1, 2);
    expect(ratio('road', 0, F_OUTER)).toBeLessThan(0.35);
    expect(ratio('water', 0, F_OUTER)).toBeLessThan(0.85);
  });

  it('at the shipped gain the outer rim pixel is 2.84 x the road, 6.26 x the marsh water, 0.67 x the grass', () => {
    expect(ratio('road', GAIN, F_OUTER)).toBeCloseTo(2.84, 1);
    expect(ratio('water', GAIN, F_OUTER)).toBeCloseTo(6.26, 1);
    expect(ratio('grass', GAIN, F_OUTER)).toBeCloseTo(0.67, 1);
  });

  it('across the outer-pixel factors of a 6 to 20 px half-width the road reads 2.18 to 3.54 x', () => {
    expect(ratio('road', GAIN, 0.33)).toBeGreaterThan(2.1);
    expect(ratio('road', GAIN, 0.47)).toBeLessThan(3.6);
  });

  it('the gain is monotone in the rim\'s luminance, so the capture\'s several gains order the look', () => {
    const gains = [0.15, 0.25, 0.4, 0.6, 0.8];
    const roads = gains.map((g) => ratio('road', g, F_OUTER));
    for (let i = 1; i < roads.length; i++) expect(roads[i]).toBeGreaterThan(roads[i - 1]);
  });

  it('the rim adds 15% of the retired flat lift\'s mean radiance to a figure', () => {
    const flat = 0.4 * HAZE_KEEP * SKY_LUMA;
    const rim = 0.1 * GAIN * HAZE_KEEP * SKY_LUMA;
    expect(flat).toBeCloseTo(0.1157, 3);
    expect(rim).toBeCloseTo(0.01735, 4);
    expect(rim / flat).toBeCloseTo(0.15, 6);
  });

  it('stays far under the bloom bar: the largest rim radiance (factor 1, gain 0.6) is 0.277', () => {
    expect(Math.max(...SKY) * GAIN).toBeCloseTo(0.277, 3);
    expect(Math.max(...SKY) * GAIN).toBeLessThan(0.9);
  });
});
