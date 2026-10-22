/**
 * Selective HDR bloom (Defilade Task 4, the lead's rulings D1 and D8,
 * 21 Oct 2026; gap audit `_coord/defilade-t4/audit.md` §2-3).
 *
 * **Selective by luminance, not by object.** Nothing is tagged "bloom me".
 * The pass reads the post chain's scene-referred HalfFloat buffer and keeps
 * only what is brighter than `BLOOM_THRESHOLD` -- a LINEAR luminance of 1.0,
 * before ACES. The lit world never gets there: the census
 * (`tools/src/perf/bloom-census.ts`, every shipped map at `day`) holds every
 * quiet frame under 0.9, so on a frame with no effect in it the high-pass
 * writes exactly 0 (`smoothstep(1.0, 1.01, L)` is 0 below 1.0) and the
 * additive blend adds +0. What does cross it is what an HDR gain pushes past
 * 1 on purpose -- muzzle flashes, tracers, fireballs (Task 2's gain table) --
 * and ground lit by a blast's pooled `PointLight`.
 *
 * **Where it sits** (`post-chain.ts`'s `setBloomPass`): after fog of war and
 * AO, before `OutputPass`. After fog so a blast over unseen ground stays
 * dark (no information leak through the shroud); before `OutputPass` because
 * it must see scene-referred values -- after the output transform the
 * buffer is display-referred and capped at 1, and no threshold could tell a
 * flash from white sand.
 *
 * **Quarter resolution** (D8): three's `UnrealBloomPass` runs its bright
 * target at HALF the size it is given, and `EffectComposer.addPass` /
 * `setSize` always hand it the full drawing-buffer size, overwriting the
 * constructor's resolution. So, like `WorldGTAOPass`'s half-res AO, the
 * scale has to live in `setSize`: `QuarterBloomPass` halves what it is told
 * before the base class halves it again, and its bright target lands at a
 * quarter of the buffer per axis whatever size the composer sets. The audit
 * measured why: at three's default (½) medium/low paid +5.4-7.7 ms a frame on
 * an M3 Pro against ±0.1 at ¼, and ~38 MB of targets against ~10 MB at
 * 2880x1800. A soft glow at strength 0.5 does not show the lost resolution.
 *
 * The census reads the SAME buffer this pass reads, through
 * `ThreeRenderer.debugPreBloomLuminance` and `luminanceCensus` below.
 */
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

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

/**
 * `UnrealBloomPass` whose internal targets stay at a quarter of whatever size
 * it is set to. The base class halves its input; this halves it first.
 *
 * Safe because every target the pass sizes is internal (the bright target and
 * the five blur mips); the one draw into the CHAIN's buffer -- the additive
 * blend into `readBuffer` -- is a full-screen quad sized by that buffer,
 * so the frame stays full resolution and the glow is sampled up.
 *
 * The base constructor does not call `setSize` (verified against r186's
 * source), so it sizes its targets from the resolution passed in, which
 * `createBloomPass` pre-halves for the same reason.
 */
export class QuarterBloomPass extends UnrealBloomPass {
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
  }
}

/** The bloom pass at the drawing buffer's size (`css x pixelRatio`), with
 *  the ruled strength, radius and threshold. Its targets are a quarter of
 *  that per axis, now and after every `setSize` the composer makes. */
export function createBloomPass(cssWidth: number, cssHeight: number, pixelRatio: number): QuarterBloomPass {
  const w = Math.max(1, Math.round(cssWidth * pixelRatio));
  const h = Math.max(1, Math.round(cssHeight * pixelRatio));
  return new QuarterBloomPass(
    new THREE.Vector2(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD
  );
}

/**
 * The bloom pass a quality preset asks for, or `null` -- the ONE gate
 * `ThreeRenderer.init` and the chain-order test both go through, so the
 * test cannot pin an order the renderer does not build. `'off'` builds
 * nothing at all (no targets, no programs), not a disabled pass.
 */
export function bloomPassFor(
  quality: { readonly bloom: 'off' | 'quarter' },
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number
): QuarterBloomPass | null {
  return quality.bloom === 'quarter' ? createBloomPass(cssWidth, cssHeight, pixelRatio) : null;
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
