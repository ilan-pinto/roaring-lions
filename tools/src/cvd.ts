// Colour-vision deficiency simulation, used to GATE the team-colour palette
// (`tools/src/cvd.test.ts`) rather than to render anything -- this module is
// the measuring instrument, not a runtime dependency of the app.
//
// `simulate` reproduces Machado, Oliveira & Fernandes, "A Physiologically-based
// Model for Simulation of Color Vision Deficiency" (IEEE TVCG 15(6), 2009),
// applied at severity 1.0 (full dichromacy) in LINEAR RGB, exactly as the
// paper's own supplementary matrices are meant to be used. The three matrices
// below are quoted from that supplementary table and cross-checked against an
// independent, unrelated implementation that cites the same paper and the
// same severity -- the CRAN `palettecore` package's `R/cvd.R`
// (https://rdrr.io/cran/palettecore/src/R/cvd.R), whose own comment reads
// "Machado, Oliveira & Fernandes (2009) matrices at severity 1.0 on the
// paper's [0, 1] scale" -- and the nine coefficients of each matrix matched
// to six decimal places. Do not "simplify" these to the commonly-copied
// Brettel/Vienot-derived approximations (e.g. the ColorJack matrices) that
// circulate under the same paper's name; those are a different, cruder
// model and were rejected by the source gist itself as "very inaccurate".
//
// `labDistance` is plain CIE76 ΔE over CIELAB (D65), used only as this
// module's own distance metric -- it makes no claim about perceptual
// uniformity beyond what CIE76 already is.

export type CvdKind = 'deuteranopia' | 'protanopia' | 'tritanopia';

type Mat3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

const MATRICES: Record<CvdKind, Mat3> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** sRGB channel [0, 1] to linear-light [0, 1], the standard piecewise 2.4 curve (IEC 61966-2-1). */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexToSrgb(hex: string): readonly [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * hex -> sRGB -> linear -> Machado severity-1.0 matrix for `kind` -> clamp.
 * Returns LINEAR RGB (not re-encoded to sRGB), because the only downstream
 * consumer is `labDistance`, which itself wants linear RGB as its own input.
 */
export function simulate(hex: string, kind: CvdKind): readonly [number, number, number] {
  const srgb = hexToSrgb(hex);
  const linear = srgb.map(srgbToLinear) as [number, number, number];
  const m = MATRICES[kind];
  const out = m.map(([a, b, c]) => a * linear[0] + b * linear[1] + c * linear[2]) as [number, number, number];
  return out.map(clamp01) as [number, number, number];
}

// sRGB primaries -> XYZ (D65), linear RGB in, IEC 61966-2-1 / sRGB standard matrix.
const RGB_TO_XYZ: Mat3 = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

// CIE standard illuminant D65, 2 degree observer.
const D65 = { x: 0.95047, y: 1.0, z: 1.08883 };

function rgbToXyz([r, g, b]: readonly [number, number, number]): readonly [number, number, number] {
  return RGB_TO_XYZ.map(([a, bb, c]) => a * r + bb * g + c * b) as [number, number, number];
}

function labF(t: number): number {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta ** 2) + 4 / 29;
}

function xyzToLab([x, y, z]: readonly [number, number, number]): readonly [number, number, number] {
  const fx = labF(x / D65.x);
  const fy = labF(y / D65.y);
  const fz = labF(z / D65.z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 ΔE between two LINEAR RGB triples (as `simulate` returns): Euclidean distance in CIELAB. */
export function labDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const [l1, a1, b1] = xyzToLab(rgbToXyz(a));
  const [l2, a2, b2] = xyzToLab(rgbToXyz(b));
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}
