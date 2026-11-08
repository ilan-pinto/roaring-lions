// GH-943 WebGPU P2 T2: the banding index. Pure (pixels in, a number or a refusal out).
//
// Why it exists: the lead saw banding in the shadow penumbra and the lit ground of the node (G) frames on the P1 sheet. "Looks banded" is
// not a measurement, and the P2 T2 probe has to read six hypotheses on two arms, so the eye is replaced by this one number.
//
// What it reads. Banding is a SHALLOW gradient drawn as a staircase of flat 8-bit plateaus, each ending in a one-level step. So:
//   1. Luma: Rec. 709 of the 8-bit sRGB pixel, rounded to an integer level (0..255). The encoded value, because the bands are in the
//      encoded value: the canvas is what is quantised.
//   2. The mask: a 9x9 box blur of that luma, and its change over a 32 px baseline (centred, horizontally and vertically). A pixel is
//      on a shallow gradient when the magnitude of that change is 0.5 to 4 levels. Flat ground (under 0.5) cannot band; an edge or a
//      texture (over 4) is not a gradient. Pixels whose box or baseline would leave the crop are not masked, so a crop reads the same
//      whether it is handed as a rectangle of a frame or as a cropped fixture.
//   3. Runs: maximal runs of identical luma along each row and each column of the crop. A masked pixel is read along the axis its
//      gradient follows (rows when |dx| >= |dy|, else columns): along the other axis it lies on an iso-line, whose run is long
//      whatever the quantisation, so it would read every smooth gradient as banded.
//   4. The index: the fraction of masked pixels that sit in a run of 12 px or more which ends (either end, inside the crop) in a step of
//      exactly 1 level. A dithered gradient breaks its plateaus into short runs; a staircase keeps them long; a hard edge ends its run in
//      a step of more than 1.
// An EMPTY mask is a REFUSAL, never a pass (the casebook's empty-array shape: a crop with no shallow gradient in it says nothing about
// banding, and a 0 read off it would be a pass that tested nothing). Callers exit 2 on it.

/** A rectangle in pixels, top-left origin. */
export interface Crop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The constants the brief fixes. Exported so a test can name them, never so a caller can tune them. */
export const BANDING = {
  /** Side of the box blur that the mask's gradient is read on. */
  blur: 9,
  /** The baseline the gradient is measured over, px. */
  baseline: 32,
  /** A shallow gradient changes by at least this many levels over the baseline... */
  minChange: 0.5,
  /** ...and at most this many. */
  maxChange: 4,
  /** A run of identical luma at least this long is a plateau. */
  minRun: 12,
} as const;

export type BandingResult =
  | {
      readonly kind: 'index';
      /** Fraction of masked pixels in a banded run, 0..1. */
      readonly index: number;
      /** Pixels on a shallow gradient. */
      readonly masked: number;
      /** Of those, pixels in a run of `minRun`+ that ends in a 1-level step. */
      readonly banded: number;
      /** Pixels in the crop. */
      readonly pixels: number;
    }
  | { readonly kind: 'refused'; readonly reason: string; readonly pixels: number };

/** The 8-bit luma level of every pixel of the crop, row-major, `crop.w * crop.h`. */
export function cropLuma(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, crop: Crop): Uint8Array {
  if (crop.x < 0 || crop.y < 0 || crop.w <= 0 || crop.h <= 0 || crop.x + crop.w > w || crop.y + crop.h > h) {
    throw new Error(`banding: crop ${crop.x},${crop.y} ${crop.w}x${crop.h} is not inside the ${w}x${h} frame`);
  }
  if (rgba.length < w * h * 4) throw new Error(`banding: ${rgba.length} bytes is not a ${w}x${h} RGBA frame`);
  const out = new Uint8Array(crop.w * crop.h);
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const i = ((crop.y + y) * w + crop.x + x) * 4;
      out[y * crop.w + x] = Math.round(0.2126 * (rgba[i] as number) + 0.7152 * (rgba[i + 1] as number) + 0.0722 * (rgba[i + 2] as number));
    }
  }
  return out;
}

/** 9x9 box mean of `l` (`w` x `h`), through a summed-area table. Only cells whose whole box is inside are meaningful; the caller masks the rest. */
function boxBlur(l: Uint8Array, w: number, h: number, side: number): Float64Array {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += l[y * w + x] as number;
      sat[(y + 1) * (w + 1) + x + 1] = (sat[y * (w + 1) + x + 1] as number) + row;
    }
  }
  const r = (side - 1) / 2;
  const out = new Float64Array(w * h);
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const x0 = x - r;
      const y0 = y - r;
      const x1 = x + r + 1;
      const y1 = y + r + 1;
      const s = (sat[y1 * (w + 1) + x1] as number) - (sat[y0 * (w + 1) + x1] as number) - (sat[y1 * (w + 1) + x0] as number) + (sat[y0 * (w + 1) + x0] as number);
      out[y * w + x] = s / (side * side);
    }
  }
  return out;
}

/**
 * For one line of `n` levels (read through `at`), marks every index that lies in a run of `minRun`+ identical levels ending, at either
 * end inside the line, in a step of exactly 1.
 */
function markBandedRuns(n: number, at: (i: number) => number, minRun: number, into: Uint8Array, set: (i: number) => number): void {
  let start = 0;
  while (start < n) {
    const v = at(start);
    let end = start + 1;
    while (end < n && at(end) === v) end++;
    if (end - start >= minRun) {
      const left = start > 0 ? Math.abs(at(start - 1) - v) : 0;
      const right = end < n ? Math.abs(at(end) - v) : 0;
      if (left === 1 || right === 1) for (let i = start; i < end; i++) into[set(i)] = 1;
    }
    start = end;
  }
}

/** The banding index of `crop` in an RGBA8 frame `w` x `h`. See the file header. */
export function bandingIndex(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, crop: Crop): BandingResult {
  const cw = crop.w;
  const ch = crop.h;
  const l = cropLuma(rgba, w, h, crop);
  const b = boxBlur(l, cw, ch, BANDING.blur);
  const half = BANDING.baseline / 2;
  // A pixel is evaluable when its baseline ends (+-16) are cells whose box is inside the crop (+-4): 20 px from every edge.
  const m = half + (BANDING.blur - 1) / 2;
  // Banded runs along rows and along columns, as two flag planes over the crop.
  const rowRuns = new Uint8Array(cw * ch);
  const colRuns = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) markBandedRuns(cw, (x) => l[y * cw + x] as number, BANDING.minRun, rowRuns, (x) => y * cw + x);
  for (let x = 0; x < cw; x++) markBandedRuns(ch, (y) => l[y * cw + x] as number, BANDING.minRun, colRuns, (y) => y * cw + x);
  let masked = 0;
  let banded = 0;
  for (let y = m; y < ch - m; y++) {
    for (let x = m; x < cw - m; x++) {
      const dx = (b[y * cw + x + half] as number) - (b[y * cw + x - half] as number);
      const dy = (b[(y + half) * cw + x] as number) - (b[(y - half) * cw + x] as number);
      const change = Math.hypot(dx, dy);
      if (change < BANDING.minChange || change > BANDING.maxChange) continue;
      masked++;
      const runs = Math.abs(dx) >= Math.abs(dy) ? rowRuns : colRuns;
      if (runs[y * cw + x] === 1) banded++;
    }
  }
  const pixels = cw * ch;
  if (masked === 0) {
    return {
      kind: 'refused',
      reason: `banding: no pixel of the ${cw}x${ch} crop at ${crop.x},${crop.y} is on a shallow gradient (${BANDING.minChange}-${BANDING.maxChange} levels over ${BANDING.baseline} px): an empty mask measures nothing`,
      pixels,
    };
  }
  return { kind: 'index', index: banded / masked, masked, banded, pixels };
}

/** Interleaved-gradient noise, 0..1 (Jimenez 2014): the noise the output grade dithers with (`output-grade.ts` `gradeNoise`). */
export function ign(x: number, y: number): number {
  const f = (v: number): number => v - Math.floor(v);
  return f(52.9829189 * f(0.06711056 * x + 0.00583715 * y));
}
