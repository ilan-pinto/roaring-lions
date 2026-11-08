// GH-943 WebGPU P2 T2: the pure half of the banding probe (`webgpu-banding-probe.ts`). Pixels and readings in, verdicts out, so a test
// can feed each refusal the input that trips it.
import { bandingIndex, ign, type Crop } from '../golden-diff/banding';

export type ProbeArm = 'L' | 'G' | 'F';
export type CropId = 'penumbra' | 'lit';
export type Hypothesis = 'H0' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'HX';

export const HYPOTHESIS_NAME: Record<Hypothesis, string> = {
  H0: 'exposure: the flat palette ground (ground-albedo + macro hidden)',
  H1: 'dither: the output dither forced on / off',
  H2: 'precision: the scene pass at FloatType (node)',
  H3: 'shadow filtering: radius 0 / 4, BasicShadowMap, VSM (node)',
  H4: 'AO hidden',
  H5: 'sky light (environment) hidden',
  HX: 'what the large soft shadow is: the fog-of-war shroud revealed',
};

/** An RGBA8 frame. */
export interface Frame {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

/** A pixel is UNSTABLE when two zero-time repaints of the same state differ there (the parked force, P1 sheet). Deltas skip them. */
export function unstableMask(a: Frame, b: Frame): Uint8Array {
  if (a.w !== b.w || a.h !== b.h) throw new Error(`banding-probe: frames ${a.w}x${a.h} and ${b.w}x${b.h} differ in size`);
  const m = new Uint8Array(a.w * a.h);
  for (let p = 0; p < a.w * a.h; p++) {
    const i = p * 4;
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) m[p] = 1;
  }
  return m;
}

export interface Delta {
  /** Pixels that differ, over the stable pixels of `region` (the whole frame when absent). */
  readonly changed: number;
  /** Mean absolute channel delta over the same pixels, 0..255. */
  readonly meanAbs: number;
  /** Pixels compared. */
  readonly pixels: number;
}

/** The A/B delta between two frames of one arm, over `region` (default the whole frame), skipping `unstable` pixels. */
export function abDelta(a: Frame, b: Frame, unstable: Uint8Array | null, region?: Crop): Delta {
  if (a.w !== b.w || a.h !== b.h) throw new Error(`banding-probe: frames ${a.w}x${a.h} and ${b.w}x${b.h} differ in size`);
  const r = region ?? { x: 0, y: 0, w: a.w, h: a.h };
  let changed = 0;
  let sum = 0;
  let pixels = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const p = y * a.w + x;
      if (unstable !== null && unstable[p] === 1) continue;
      pixels++;
      const i = p * 4;
      const d = Math.abs((a.data[i] as number) - (b.data[i] as number)) + Math.abs((a.data[i + 1] as number) - (b.data[i + 1] as number)) + Math.abs((a.data[i + 2] as number) - (b.data[i + 2] as number));
      if (d > 0) changed++;
      sum += d;
    }
  }
  return { changed, meanAbs: pixels === 0 ? 0 : sum / (pixels * 3), pixels };
}

export type IndexReading = { readonly index: number; readonly masked: number } | { readonly refused: string };

export function readIndex(f: Frame, crop: Crop): IndexReading {
  const r = bandingIndex(f.data, f.w, f.h, crop);
  return r.kind === 'index' ? { index: r.index, masked: r.masked } : { refused: r.reason };
}

export function fmtIndex(r: IndexReading | undefined): string {
  if (r === undefined) return 'n/a';
  return 'refused' in r ? 'REFUSED' : r.index.toFixed(3);
}

/** One variant of one hypothesis, read on one arm. */
export interface VariantRow {
  readonly hypothesis: Hypothesis;
  readonly variant: string;
  readonly arm: ProbeArm;
  /** What the in-page toggle reported (an object count, a note). */
  readonly applied: string;
  /** Whole frame, over stable pixels: the "did the toggle move the frame" delta. */
  readonly frame: Delta;
  /** Each crop's own delta. */
  readonly crops: Record<CropId, Delta>;
  readonly index: Record<CropId, IndexReading>;
  /** The frame after the restore equals the baseline on the stable pixels. */
  readonly restored: boolean;
}

/**
 * The hypotheses whose toggle moved nothing: every variant, on every arm it ran on, has a whole-frame delta of 0 over the stable pixels.
 * A toggle that changed nothing tested nothing, so its row cannot be read either way, and the probe REFUSES (exit 2).
 */
export function deadHypotheses(rows: readonly VariantRow[]): Hypothesis[] {
  const by = new Map<Hypothesis, number>();
  for (const r of rows) by.set(r.hypothesis, (by.get(r.hypothesis) ?? 0) + r.frame.changed);
  return [...by.entries()].filter(([, changed]) => changed === 0).map(([h]) => h);
}

/**
 * Which y convention a dither follows, read off the frames: the dither-on minus dither-off difference over `crop`, correlated with the
 * output grade's noise `ign(x + 0.5, y')` for y' = H - row - 0.5 (gl_FragCoord, bottom-left: legacy's, and what the node twin's flip
 * is meant to reproduce) and for y' = row + 0.5 (top-left, the node `screenCoordinate` unflipped).
 */
export function ditherConvention(on: Frame, off: Frame, crop: Crop): { readonly bottomLeft: number; readonly topLeft: number; readonly moved: number } {
  const d: number[] = [];
  const nb: number[] = [];
  const nt: number[] = [];
  let moved = 0;
  for (let y = crop.y; y < crop.y + crop.h; y++) {
    for (let x = crop.x; x < crop.x + crop.w; x++) {
      const i = (y * on.w + x) * 4;
      const v = (on.data[i] as number) + (on.data[i + 1] as number) + (on.data[i + 2] as number) - (off.data[i] as number) - (off.data[i + 1] as number) - (off.data[i + 2] as number);
      if (v !== 0) moved++;
      d.push(v);
      nb.push(ign(x + 0.5, on.h - y - 0.5) - 0.5);
      nt.push(ign(x + 0.5, y + 0.5) - 0.5);
    }
  }
  return { bottomLeft: pearson(d, nb), topLeft: pearson(d, nt), moved };
}

export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n === 0) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] as number;
    mb += b[i] as number;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] as number) - ma;
    const db = (b[i] as number) - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return saa === 0 || sbb === 0 ? 0 : sab / Math.sqrt(saa * sbb);
}

/** The markdown table of the rows, one line per variant and arm. */
export function variantTable(rows: readonly VariantRow[]): string[] {
  const out = [
    '| hyp | variant | arm | toggle | frame delta px (mean) | penumbra delta px | lit delta px | index penumbra | index lit | restored |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    out.push(
      `| ${r.hypothesis} | ${r.variant} | ${r.arm} | ${r.applied} | ${r.frame.changed} (${r.frame.meanAbs.toFixed(4)}) | ${r.crops.penumbra.changed} | ${r.crops.lit.changed} | ${fmtIndex(r.index.penumbra)} | ${fmtIndex(r.index.lit)} | ${r.restored ? 'yes' : 'NO'} |`
    );
  }
  return out;
}
