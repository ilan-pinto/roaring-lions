// GH-943 WebGPU P1: the frame-CONTENT floor on a node capture, and the validation-error refusal.
//
// Why it exists: on 2026-11-06 the WebGPU arm (G) drew a pure black frame (a depth-stencil texture bound with aspect 'all', so every
// bind group after it was invalid; see `packages/render/src/three/backend/depth-aspect.node.test.ts`). CI did not catch it:
//  - `backend-gates` said "5 of 5 captures are byte-identical", which identical black frames are;
//  - the settled-frame check passed, because two black repaints are byte-equal;
//  - every layer floor on the golden-baseline node arm DID read 0 px, but that arm is report-only.
// Nothing asked whether the picture had anything in it, and nothing read the console's GPUValidationErrors. These two do.
//
// Pure (pixels or lines in, a verdict out) so a test can feed a black, a flat and a real frame and watch each verdict.

/** How a content refusal starts, as `capture()` words it and `ci/content-vote.ts` reads it back out of a log. One source for both ends. */
export const FRAME_CONTENT_PREFIX = 'frame-content:';
export const GPU_VALIDATION_PREFIX = 'gpu-validation:';

/** The error `capture()` throws for a refused node capture: `[<label>] REFUSED (<arm>): <refusal>`. */
export function captureRefusalMessage(label: string, arm: string, refusal: string): string {
  return `[${label}] REFUSED (${arm}): ${refusal}`;
}

const CONTENT_REFUSAL_LINE = new RegExp(`\\] REFUSED \\([a-z0-9]+\\): (?:${GPU_VALIDATION_PREFIX}|${FRAME_CONTENT_PREFIX})`);

/** A log line that carries a CONTENT refusal (a GPU validation error, or a black or near-constant frame) in `captureRefusalMessage`'s shape.
 *  A backend refusal, a baseline difference and a parity band are not content, and are not matched. */
export function isContentRefusalLine(line: string): boolean {
  return CONTENT_REFUSAL_LINE.test(line);
}

/** Rec. 709 luma of an 8-bit sRGB pixel, in 0..255 (the encoded value: this asks "is anything there", not a light measurement). */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface FrameContentStats {
  readonly pixels: number;
  /** Mean luma, 0..255. */
  readonly meanLuma: number;
  /** Standard deviation of luma over the frame, 0..255. A constant frame reads 0 whatever its colour. */
  readonly stdLuma: number;
}

/**
 * The part of a capture the stats read: the CENTRE of the canvas rect, 20% to 80% on both axes. A capture's clip is the canvas, but
 * the HUD draws over it in the DOM (the top bar, the hint line, and the minimap, which is a separate ground photograph and stays
 * correct when the world pass is black). Over the whole clip the black G frame read mean 7.3 and std 31.9, all of it HUD; over the
 * centre it reads 0 and 0. The centre is world on every scenario the gates capture.
 */
export const CONTENT_REGION = { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 } as const;

/** Stats over an RGBA8 buffer (pngjs `PNG.data`), inside `region` (fractions of the frame). Alpha is ignored: a capture is opaque. */
export function frameContentStats(
  rgba: Uint8Array,
  width: number,
  height: number,
  region: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number } = CONTENT_REGION
): FrameContentStats {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return { pixels: 0, meanLuma: 0, stdLuma: 0 };
  const xa = Math.floor(width * region.x0);
  const xb = Math.ceil(width * region.x1);
  const ya = Math.floor(height * region.y0);
  const yb = Math.ceil(height * region.y1);
  let sum = 0;
  let sumSq = 0;
  let pixels = 0;
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * width + x) * 4;
      const l = luma(rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number);
      sum += l;
      sumSq += l * l;
      pixels++;
    }
  }
  if (pixels === 0) return { pixels: 0, meanLuma: 0, stdLuma: 0 };
  const mean = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - mean * mean);
  return { pixels, meanLuma: mean, stdLuma: Math.sqrt(variance) };
}

/**
 * The floors, in 8-bit luma units over `CONTENT_REGION`. Calibrated on 2026-11-06 against all 12 committed golden baselines
 * (`tools/golden-baselines/*`, legacy on SwiftShader), the 11 node-WebGL2 captures of CI run 42194042430 (`visual-backends (webgl2)`,
 * dusk and combat included) and T9's Metal sheet frames (L, F, L-shipped). The darkest real frame is dusk: mean 14.66, std 17.38;
 * the flattest is aftermath: std 17.85 (mean 81.24). Both floors sit more than 3.5x under those. The black G frames (CI SwiftShader
 * and T9 Metal alike) read mean 0.00, std 0.00 on every scenario but `combat`.
 */
export const MIN_MEAN_LUMA = 4;
export const MIN_STD_LUMA = 4;

/** Why this capture is not a picture of a scene, or null when it is. */
export function frameContentRefusal(s: FrameContentStats, minMean = MIN_MEAN_LUMA, minStd = MIN_STD_LUMA): string | null {
  if (s.pixels === 0) return `${FRAME_CONTENT_PREFIX} the capture has no pixels`;
  const read = `mean luma ${s.meanLuma.toFixed(2)}, std ${s.stdLuma.toFixed(2)} over ${s.pixels} px`;
  if (s.meanLuma < minMean) return `${FRAME_CONTENT_PREFIX} the frame is black (${read}; floor mean >= ${minMean}): the renderer drew nothing, so every later reading of it is vacuous`;
  if (s.stdLuma < minStd) return `${FRAME_CONTENT_PREFIX} the frame is near-constant (${read}; floor std >= ${minStd}): one flat colour is not a scene`;
  return null;
}

/** Console lines that mean the GPU refused work: the frame they belong to is not what the code asked for. */
const GPU_VALIDATION = /GPUValidationError|Invalid BindGroup|Invalid CommandBuffer/;

/** Why these console lines refuse the capture, or null. */
export function validationErrorRefusal(lines: readonly string[]): string | null {
  const hits = lines.filter((l) => GPU_VALIDATION.test(l));
  if (hits.length === 0) return null;
  return `${GPU_VALIDATION_PREFIX} the page logged ${hits.length} GPU validation error(s); the first: "${(hits[0] as string).slice(0, 200)}"`;
}
