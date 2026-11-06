/**
 * GH-943 WebGPU-primary P1 (T5): the bloom's SPEC -- the numbers and the census maths that the legacy pass (`bloom.ts`,
 * `UnrealBloomPass`) and its node twin (`bloom.node.ts`, `BloomNode`) both read. ADDON-FREE: no `three` import at all, so the twin
 * can take it without dragging `three/addons/postprocessing` into the node chunk. `bloom.ts` re-exports every name here, so each
 * legacy importer is unchanged.
 *
 * Selective HDR bloom (Defilade Task 4, rulings D1 and D8; see `bloom.ts`'s header for why it thresholds scene-referred luminance
 * and sits after fog/AO and before the output transform). The ruled numbers live HERE, once.
 */

/** How much of the blurred bright buffer is added back (ruling D1). 0.7
 *  started washing the Lavi hull in the kill frame. */
export const BLOOM_STRENGTH = 0.5;
/** `UnrealBloomPass.radius`: how far the mip blend leans to the wide mips
 *  (ruling D1). */
export const BLOOM_RADIUS = 0.35;
/** Scene-referred LINEAR luminance a pixel must pass to bloom (ruling D1).
 *  The census's quiet-frame ceiling (0.9) sits under it on purpose. */
export const BLOOM_THRESHOLD = 1.0;
/** The bloom's internal resolution, per axis, as a fraction of the drawing
 *  buffer. Not a tuning knob: it is the `'quarter'` in
 *  `RenderQuality.bloom`. */
export const BLOOM_RESOLUTION_SCALE = 0.25;

/** `LuminosityHighPassShader`'s default `smoothWidth`, and `BloomNode`'s: the high-pass is `smoothstep(threshold, threshold +
 *  smoothWidth, L)`, so a pixel at or under `BLOOM_THRESHOLD` writes exactly 0 and the additive blend adds exactly +0. */
export const BLOOM_SMOOTH_WIDTH = 0.01;

/**
 * The strength the bloom runs at: the ruled strength scaled by the zoom-fade weight, or exactly 0 when the layer is switched off.
 * The legacy path skips the pass (`enabled = false`); the node graph has no skip, so it multiplies by this instead -- 0 adds
 * exactly nothing (x + 0 == x), which is what the `bloom` zero check measures.
 */
export function bloomStrengthFor(enabled: boolean, fade: number): number {
  return enabled ? BLOOM_STRENGTH * fade : 0;
}

/** What a layer toggle and the zoom fade drive on the node chain. Implemented by `bloom.node.ts`; held by `ThreeRenderer`
 *  through `RenderBackend.bloom`, so the renderer never imports the twin (it would put a `.node.ts` in the shared chunk). */
export interface BloomControl {
  /** Switches the bloom on or off (strength 0 when off). Returns whether the state changed. */
  setEnabled(visible: boolean): boolean;
  /** The zoom-fade weight, 0..1 (`zoom-fade.ts`). */
  setFade(weight: number): void;
  /** The strength in force now (`bloomStrengthFor`). */
  readonly strength: number;
  /** Whether a bloom node is currently built into the chain (false before the chain exists, or when the preset has no bloom). */
  readonly built: boolean;
  /** DEBUG ONLY: the pre-bloom HalfFloat buffer as `width x height` RGBA half bits, rows tight and bottom-up or top-down as the
   *  backend gives them; `null` when no bloom stage is built. */
  readPreBloom(): Promise<{ data: Uint16Array; width: number; height: number } | null>;
}

/**
 * Strips WebGPU's row padding from a half-float RGBA readback. `copyTextureToBuffer` pads each row to 256 bytes and sizes the last
 * row tight (`(h-1)*bytesPerRow + w*8` bytes); the WebGL2 backend returns it tight. Both are accepted, and a length that fits
 * neither is a bug, not data: it THROWS.
 */
export function tightHalfRgba(data: Uint16Array, width: number, height: number): Uint16Array {
  const tightLen = width * height * 4;
  if (data.length === tightLen) return data;
  const stride = (Math.ceil((width * 8) / 256) * 256) / 2; // padded row, in u16 elements
  const paddedLen = (height - 1) * stride + width * 4;
  if (data.length !== paddedLen) {
    throw new Error(`tightHalfRgba: ${data.length} elements fits neither a tight ${width}x${height} (${tightLen}) nor a 256-byte padded one (${paddedLen})`);
  }
  const out = new Uint16Array(tightLen);
  for (let y = 0; y < height; y++) out.set(data.subarray(y * stride, y * stride + width * 4), y * width * 4);
  return out;
}

/** IEEE 754 binary16 to a JS number. What `readRenderTargetPixels` returns
 *  for a HalfFloat target is these bits in a `Uint16Array`. */
export function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const e = (bits >> 10) & 0x1f;
  const f = bits & 0x3ff;
  if (e === 0) return sign * 2 ** -14 * (f / 1024);
  if (e === 31) return f === 0 ? sign * Infinity : NaN;
  return sign * 2 ** (e - 15) * (1 + f / 1024);
}

/** Rec. 709 luminance of LINEAR RGB -- the coefficients three's
 *  `luminance()` uses for the linear-sRGB working space, which is what
 *  `LuminosityHighPassShader` (the bloom's own high-pass) thresholds. */
export function linearLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface LuminanceCensus {
  /** Pixels sampled (every `stride`-th of the buffer). */
  samples: number;
  p50: number;
  p99: number;
  max: number;
  /** Fraction of samples whose luminance is above `BLOOM_THRESHOLD`. */
  fracOverThreshold: number;
}

/**
 * The census of one HalfFloat RGBA readback: every `stride`-th pixel's linear
 * luminance, its p50/p99/max and the fraction above the bloom threshold.
 * Non-finite samples count as `Infinity` (a NaN in the frame is a bug the
 * census should shout about, not average away).
 */
export function luminanceCensus(rgbaHalf: Uint16Array, stride: number): LuminanceCensus {
  const pixels = Math.floor(rgbaHalf.length / 4);
  const step = Math.max(1, Math.floor(stride));
  const values: number[] = [];
  let over = 0;
  for (let i = 0; i < pixels; i += step) {
    const at = i * 4;
    let l = linearLuminance(halfToFloat(rgbaHalf[at]), halfToFloat(rgbaHalf[at + 1]), halfToFloat(rgbaHalf[at + 2]));
    if (!Number.isFinite(l)) l = Infinity;
    values.push(l);
    if (l > BLOOM_THRESHOLD) over++;
  }
  if (values.length === 0) return { samples: 0, p50: 0, p99: 0, max: 0, fracOverThreshold: 0 };
  values.sort((a, b) => a - b);
  const q = (p: number): number => values[Math.min(values.length - 1, Math.floor(p * values.length))];
  return { samples: values.length, p50: q(0.5), p99: q(0.99), max: values[values.length - 1], fracOverThreshold: over / values.length };
}
