/**
 * The readability measure of a KDF figure against the wet ground it stands on (GH-871 cheap-wet follow-up,
 * task 2): CIEDE2000 of the figure's mean colour, and of its darkest 15%, against the ground behind it,
 * with the floor 15.6 the P4 look sheets used.
 *
 * Pure: pixels in, numbers out, no browser. `ground:capture --read` writes the frames and
 * `wet-readability-report.ts` reads them through here.
 *
 * ## Why a mask from a frame PAIR
 *
 * P4's methods guessed the figure from the picture: "cool pixels brighter than the ground" saw a flat lift
 * and was blind to a rim, and "pixels that differ from the ground by 8 dE" dropped every camouflage pixel
 * that happened to be near the road's colour, which is exactly the pixels the darkest-15% number is about.
 * Neither can score a treatment it was not shaped for. The pair does not guess: the SAME view is drawn with
 * the units shown and with the units hidden (rain off and the sun's shadow off in both), and a pixel belongs
 * to the figure iff the two frames differ there. It does not depend on how the figure is lit, so one mask
 * serves every treatment, and a figure pixel is dropped only if it is within `MASK_THRESHOLD` levels of the ground behind it in every channel.
 *
 * ## The numbers
 *
 *  - ground: the mean sRGB of the BACKDROP frame (units hidden, shadows on, rain off) over the annulus
 *    `RING_INNER_PX..RING_OUTER_PX` outside the dilated mask. A mean of 8-bit sRGB values, then Lab, as P4's
 *    readability.txt did, so the figures are comparable with look 2 / 3 / 4.
 *  - mean: the mean sRGB of the figure pixels of the MEASUREMENT frame (units shown, rain off).
 *  - darkest 15%: the mean sRGB of the figure pixels with the lowest luminance, the lowest 15% by count
 *    (at least 5 pixels).
 *  - `perPixelMedian`: the median over figure pixels of CIEDE2000 against the backdrop pixel BEHIND it, a
 *    sanity figure that needs no annulus.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** A decoded 8-bit RGBA picture (`pngjs`'s `PNG` shape). */
export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray | Buffer;
}

export type Lab = readonly [number, number, number];

/** The floor the P4 sheets used: a figure reads when its dE2000 against the ground is at least this. */
export const READABILITY_FLOOR = 15.6;
/** The darkest share of the figure the "darkest" number averages. */
export const DARKEST_SHARE = 0.15;
/** Fewest pixels in the darkest group. */
export const DARKEST_MIN_PIXELS = 5;
/** A figure pixel differs from the backdrop by more than this in some channel (0..255). Not smaller: the frames
 *  are drawn with ambient occlusion, which darkens the ground around a figure's feet by up to ~8 levels, and at
 *  2 the mask grew to 5,000 px for a squad whose figures cover about 1,800 (measured at threshold 2, 6, 10, 16:
 *  5,324 / 2,714 / 1,805 / 1,339 on the road stop). 10 keeps the figure and drops the halo. */
export const MASK_THRESHOLD = 10;
/** Fewest pixels the largest connected component of the mask must have for the mask to be a figure. */
export const MASK_MIN_PIXELS = 40;
/** The annulus the ground is read from, px outside the mask's edge. */
export const RING_INNER_PX = 6;
export const RING_OUTER_PX = 22;

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of an 8-bit sRGB colour (Rec. 709 weights on linear light). */
export function luminance(c: Rgb): number {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/** CIE Lab (D65) of an 8-bit sRGB colour; the channels may be fractional (a mean). */
export function srgbToLab(c: Rgb): Lab {
  const r = srgbToLinear(c.r);
  const g = srgbToLinear(c.g);
  const b = srgbToLinear(c.b);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** CIEDE2000 (Sharma, Wu, Dalal 2005, kL = kC = kH = 1). */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1 = Math.hypot(a1p, b1);
  const C2 = Math.hypot(a2p, b2);
  const h1 = C1 === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360;
  const h2 = C2 === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360;
  const dL = L2 - L1;
  const dC = C2 - C1;
  let dh = h2 - h1;
  if (C1 * C2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin(rad(dh) / 2);
  const Lb = (L1 + L2) / 2;
  const Cbar = (C1 + C2) / 2;
  let hb: number;
  if (C1 * C2 === 0) hb = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hb = (h1 + h2) / 2;
  else hb = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T =
    1 - 0.17 * Math.cos(rad(hb - 30)) + 0.24 * Math.cos(rad(2 * hb)) + 0.32 * Math.cos(rad(3 * hb + 6)) - 0.2 * Math.cos(rad(4 * hb - 63));
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cbar;
  const Sh = 1 + 0.015 * Cbar * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/** CIEDE2000 between two 8-bit sRGB colours. */
export function deltaE2000Rgb(a: Rgb, b: Rgb): number {
  return deltaE2000(srgbToLab(a), srgbToLab(b));
}

// ---------------------------------------------------------------------------
// The mask
// ---------------------------------------------------------------------------

function pixelAt(f: Frame, i: number): Rgb {
  return { r: f.data[i * 4] as number, g: f.data[i * 4 + 1] as number, b: f.data[i * 4 + 2] as number };
}

/**
 * The figure's pixels: those where `shown` and `hidden` differ by more than `MASK_THRESHOLD` in some channel,
 * restricted to the connected component(s) (8-neighbour) of at least `MASK_MIN_PIXELS` pixels within `radiusPx`
 * of `(cx, cy)`. A frame pair that never moved (identical) returns an EMPTY mask, never a guess; the caller
 * must refuse an empty mask.
 */
export function figureMask(shown: Frame, hidden: Frame, cx: number, cy: number, radiusPx: number): Uint8Array {
  if (shown.width !== hidden.width || shown.height !== hidden.height) throw new Error('figureMask: the two frames differ in size');
  const { width: w, height: h } = shown;
  const raw = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.hypot(x - cx, y - cy) > radiusPx) continue;
      const i = y * w + x;
      const dr = Math.abs((shown.data[i * 4] as number) - (hidden.data[i * 4] as number));
      const dg = Math.abs((shown.data[i * 4 + 1] as number) - (hidden.data[i * 4 + 1] as number));
      const db = Math.abs((shown.data[i * 4 + 2] as number) - (hidden.data[i * 4 + 2] as number));
      if (Math.max(dr, dg, db) > MASK_THRESHOLD) raw[i] = 1;
    }
  }
  // Connected components of >= MASK_MIN_PIXELS, 8-neighbour.
  const out = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < raw.length; start++) {
    if (raw[start] === 0 || seen[start] === 1) continue;
    const stack = [start];
    const comp: number[] = [];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      comp.push(p);
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (raw[q] === 1 && seen[q] === 0) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (comp.length >= MASK_MIN_PIXELS) for (const p of comp) out[p] = 1;
  }
  return out;
}

export function maskSize(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) n += v;
  return n;
}

/** The backdrop's pixels in the annulus `inner..outer` px outside the mask's edge (Chebyshev-free: Euclidean to the nearest mask pixel). */
export function ringIndices(mask: Uint8Array, width: number, height: number, inner: number, outer: number): number[] {
  const members: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) members.push(i);
  if (members.length === 0) return [];
  // Distance to the mask by a bounded scan around each candidate: the mask is a few thousand pixels, the window small.
  let x0 = width;
  let y0 = height;
  let x1 = 0;
  let y1 = 0;
  for (const i of members) {
    const x = i % width;
    const y = (i - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const out: number[] = [];
  const edge = members.filter((i) => {
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || mask[ny * width + nx] === 0) return true;
    }
    return false;
  });
  for (let y = Math.max(0, y0 - outer); y <= Math.min(height - 1, y1 + outer); y++) {
    for (let x = Math.max(0, x0 - outer); x <= Math.min(width - 1, x1 + outer); x++) {
      const i = y * width + x;
      if (mask[i] === 1) continue;
      let best = Infinity;
      for (const e of edge) {
        const ex = e % width;
        const ey = (e - ex) / width;
        const d = Math.hypot(x - ex, y - ey);
        if (d < best) best = d;
        if (best < inner) break;
      }
      if (best >= inner && best <= outer) out.push(i);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The measure
// ---------------------------------------------------------------------------

export interface Readability {
  /** Figure pixels in the mask. */
  readonly pixels: number;
  /** The ground's mean sRGB (annulus of the backdrop frame). */
  readonly ground: Rgb;
  /** CIEDE2000 of the figure's mean colour against the ground. */
  readonly mean: number;
  /** CIEDE2000 of the darkest `DARKEST_SHARE` of the figure against the ground. */
  readonly darkest: number;
  /** The median over figure pixels of CIEDE2000 against the backdrop pixel behind each. */
  readonly perPixelMedian: number;
  /** The share (0..1) of figure pixels whose own CIEDE2000 against the pixel behind them is at least `READABILITY_FLOOR`:
   *  how much of the figure separates from what it stands on. The mean and the darkest 15% are the lead's two numbers;
   *  on a dark ground a dark figure cannot clear them (see `rain-rim.ts`'s header), this one can move. */
  readonly shareAboveFloor: number;
  /** The figure's mean and darkest-group mean sRGB, for the report. */
  readonly figureMean: Rgb;
  readonly figureDarkest: Rgb;
  /** The figure's own contrast: p95 luminance over p5 luminance (the camouflage's internal range). */
  readonly internalContrast: number;
}

function meanRgb(px: readonly Rgb[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of px) {
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const n = px.length;
  return { r: r / n, g: g / n, b: b / n };
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

/**
 * The readability of the figure in `measured` (units shown, rain off) over `backdrop` (units hidden, shadows on, rain
 * off), through `mask`. Throws on an empty mask or an empty ring: a number from nothing is the failure this
 * module exists to refuse.
 */
export function readability(measured: Frame, backdrop: Frame, mask: Uint8Array): Readability {
  const { width, height } = measured;
  const figure: { rgb: Rgb; y: number; i: number }[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) {
      const rgb = pixelAt(measured, i);
      figure.push({ rgb, y: luminance(rgb), i });
    }
  }
  if (figure.length === 0) throw new Error('readability: the figure mask is empty (the units-shown and units-hidden frames did not differ)');
  const ring = ringIndices(mask, width, height, RING_INNER_PX, RING_OUTER_PX);
  if (ring.length === 0) throw new Error('readability: the ground ring is empty (the mask fills the frame?)');
  const ground = meanRgb(ring.map((i) => pixelAt(backdrop, i)));
  const sorted = [...figure].sort((a, b) => a.y - b.y);
  const nDark = Math.max(DARKEST_MIN_PIXELS, Math.floor(DARKEST_SHARE * figure.length));
  const figureMean = meanRgb(figure.map((f) => f.rgb));
  const figureDarkest = meanRgb(sorted.slice(0, nDark).map((f) => f.rgb));
  const groundLab = srgbToLab(ground);
  const per = figure.map((f) => deltaE2000(srgbToLab(f.rgb), srgbToLab(pixelAt(backdrop, f.i))));
  per.sort((a, b) => a - b);
  const ys = sorted.map((f) => f.y);
  return {
    pixels: figure.length,
    ground,
    mean: deltaE2000(srgbToLab(figureMean), groundLab),
    darkest: deltaE2000(srgbToLab(figureDarkest), groundLab),
    perPixelMedian: quantile(per, 0.5),
    shareAboveFloor: per.filter((v) => v >= READABILITY_FLOOR).length / per.length,
    figureMean,
    figureDarkest,
    internalContrast: quantile(ys, 0.95) / Math.max(quantile(ys, 0.05), 1e-6),
  };
}

/** The share of two masks' union that they share: the repaint control's number (1 is identical). */
export function maskOverlap(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 1 || b[i] === 1) either++;
    if (a[i] === 1 && b[i] === 1) both++;
  }
  return either === 0 ? 0 : both / either;
}

/** The share of pixels inside `mask` at which two frames differ by more than `MASK_THRESHOLD`: 0 for two identical repaints. */
export function repaintDifference(a: Frame, b: Frame, mask: Uint8Array): number {
  let n = 0;
  let diff = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    n++;
    const d = Math.max(
      Math.abs((a.data[i * 4] as number) - (b.data[i * 4] as number)),
      Math.abs((a.data[i * 4 + 1] as number) - (b.data[i * 4 + 1] as number)),
      Math.abs((a.data[i * 4 + 2] as number) - (b.data[i * 4 + 2] as number))
    );
    if (d > MASK_THRESHOLD) diff++;
  }
  return n === 0 ? 0 : diff / n;
}
