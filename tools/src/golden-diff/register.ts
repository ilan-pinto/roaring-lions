/**
 * The "one colour register" acceptance test (spec §3.7,
 * `docs/superpowers/specs/2026-09-24-scene-host-design.md`): mean relative
 * luminance and mean HSV saturation over a frame, made runnable rather than
 * eyeballed, plus a tolerance check relative to a reference ("mission")
 * measurement.
 *
 * **Luminance is WCAG's own definition** -- Rec. 709 weights on LINEARISED
 * sRGB, never on the raw 0-255 code. A mean of sRGB bytes reads 0.502 at code
 * 128; the actual relative luminance there is 0.216 (`register.test.ts`'s own
 * "linearises before weighting" case). Gamma is not linear light, and
 * averaging gamma-encoded values silently averages the wrong quantity.
 *
 * **Saturation stays on the sRGB-ENCODED channel values on purpose** --
 * `(max - min) / max`, the ordinary HSV definition, computed on the SAME
 * bytes the screen shows. It is a ratio between channels of one pixel, so it
 * needs no linearisation to be meaningful, and the spec's own text says so
 * explicitly. Pixels whose brightest channel is under `SATURATION_FLOOR`
 * carry no reliable hue -- a rounding artefact on a near-black pixel can read
 * as fully saturated -- so they are excluded from `meanS`'s average entirely
 * rather than counted as zero.
 */

/** One frame's colour register: what `colourRegister` measures and what
 *  `registerDelta`/`withinRegister` compare. */
export interface Register {
  readonly meanY: number;
  readonly meanS: number;
  /** How many pixels contributed to `meanS` -- the ones whose brightest
   *  channel cleared `SATURATION_FLOOR`. `meanY` is always over every pixel
   *  in the box; only the saturation average skips the near-black tail. */
  readonly samples: number;
}

/** A pixel rectangle, in the same coordinate frame as `width`/`height`. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The sRGB piecewise-gamma breakpoint (IEC 61966-2-1). */
const SRGB_LINEAR_THRESHOLD = 0.04045;

/** Below this sRGB-encoded value (out of 1) a channel carries no reliable
 *  hue -- the spec's own floor. 0.02 of 255 is ~5.1, so this excludes only
 *  the near-black tail. */
const SATURATION_FLOOR = 0.02;

/** `c` is an sRGB-encoded channel value in [0, 1]. Returns the linear-light
 *  value the Rec. 709 weights are defined over. */
function srgbToLinear(c: number): number {
  return c <= SRGB_LINEAR_THRESHOLD ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The running sums a box scan needs, before dividing into a `Register`. */
interface Accumulator {
  sumY: number;
  sumS: number;
  samples: number;
  total: number;
}

function accumulate(rgba: Uint8Array | Uint8ClampedArray | Buffer, width: number, box: Box): Accumulator {
  let sumY = 0;
  let sumS = 0;
  let samples = 0;
  let total = 0;
  for (let row = 0; row < box.height; row++) {
    const y = box.y + row;
    for (let col = 0; col < box.width; col++) {
      const x = box.x + col;
      const i = (y * width + x) * 4;
      const r = rgba[i] / 255;
      const g = rgba[i + 1] / 255;
      const b = rgba[i + 2] / 255;
      total += 1;
      sumY += 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
      const max = Math.max(r, g, b);
      if (max < SATURATION_FLOOR) continue;
      const min = Math.min(r, g, b);
      sumS += (max - min) / max;
      samples += 1;
    }
  }
  return { sumY, sumS, samples, total };
}

/**
 * Mean relative luminance and mean HSV saturation over `rgba` -- an
 * interleaved RGBA buffer `width` x `height` pixels wide, exactly what a PNG
 * decode (`pngjs`) or a raw `page.screenshot()` buffer already is.
 *
 * `box` restricts the scan to a sub-rectangle (default: the whole frame),
 * both in pixels of the SAME buffer -- it does not crop or copy anything.
 */
export function colourRegister(
  rgba: Uint8Array | Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  box: Box = { x: 0, y: 0, width, height }
): Register {
  const { sumY, sumS, samples, total } = accumulate(rgba, width, box);
  return {
    meanY: total > 0 ? sumY / total : 0,
    // 0 rather than NaN when nothing cleared the floor: a frame with no
    // saturation signal at all (e.g. solid black) reports zero rather than
    // an undefined average.
    meanS: samples > 0 ? sumS / samples : 0,
    samples,
  };
}

/** `a` relative to `mission`, as a fraction of the mission's own value --
 *  the same shape the spec's own numbers are reported in ("-1.7%", "17%
 *  apart"). Division by a zero mission value is the caller's problem: a
 *  mission register of exactly zero luminance or saturation is not a
 *  meaningful reference frame to begin with. */
export function registerDelta(a: Register, mission: Register): { dY: number; dS: number } {
  return {
    dY: (a.meanY - mission.meanY) / mission.meanY,
    dS: (a.meanS - mission.meanS) / mission.meanS,
  };
}

/** Spec §3.7's pass rule: both channels within `tolerance` of the mission
 *  (0.10 there). */
export function withinRegister(a: Register, mission: Register, tolerance: number): boolean {
  const { dY, dS } = registerDelta(a, mission);
  return Math.abs(dY) <= tolerance && Math.abs(dS) <= tolerance;
}
