// GH-943 WebGPU P2 T8: the pure half of the before/after banding sheet (`webgpu-banding-sheet.ts`). Pixels in, pixels and verdicts out.
import type { Crop } from '../golden-diff/banding';
import type { CropId, Frame } from './webgpu-banding-probe-lib';

export type SheetArm = 'Ls' | 'L' | 'G';
export type SheetState = 'shipped' | 'flat';
export type SheetPhase = 'before' | 'after';
export type IndexOrRefused = number | null;

/** The luma stretch a pair shares: the 1st and 99th percentile of the BEFORE tile, so before and after are stretched by the same law. */
export function stretchRange(f: Frame, crop: Crop): { lo: number; hi: number } {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = crop.y; y < crop.y + crop.h; y++) {
    for (let x = crop.x; x < crop.x + crop.w; x++) {
      const i = (y * f.w + x) * 4;
      hist[Math.round(0.2126 * (f.data[i] as number) + 0.7152 * (f.data[i + 1] as number) + 0.0722 * (f.data[i + 2] as number))]++;
      n++;
    }
  }
  const at = (q: number): number => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v] as number;
      if (acc >= q * n) return v;
    }
    return 255;
  };
  const lo = at(0.01);
  const hi = Math.max(at(0.99), lo + 8);
  return { lo, hi };
}

/** The crop as an RGBA tile, every channel mapped lo..hi to 0..255. A 1-level step becomes (255 / (hi - lo)) levels wide. */
export function stretchedTile(f: Frame, crop: Crop, range: { lo: number; hi: number }): Uint8Array {
  const out = new Uint8Array(crop.w * crop.h * 4);
  const k = 255 / (range.hi - range.lo);
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const s = ((crop.y + y) * f.w + crop.x + x) * 4;
      const d = (y * crop.w + x) * 4;
      for (let c = 0; c < 3; c++) out[d + c] = Math.max(0, Math.min(255, Math.round(((f.data[s + c] as number) - range.lo) * k)));
      out[d + 3] = 255;
    }
  }
  return out;
}

/** |a - b| per channel times `gain`, clamped: the legacy frame's before/after difference, made visible. */
export function amplifiedDiff(a: Frame, b: Frame, gain: number): { data: Uint8Array; changed: number; meanAbs: number } {
  if (a.w !== b.w || a.h !== b.h) throw new Error('banding-sheet: frames differ in size');
  const data = new Uint8Array(a.w * a.h * 4);
  let changed = 0;
  let sum = 0;
  for (let p = 0; p < a.w * a.h; p++) {
    const i = p * 4;
    let any = false;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((a.data[i + c] as number) - (b.data[i + c] as number));
      if (d > 0) any = true;
      sum += d;
      data[i + c] = Math.min(255, d * gain);
    }
    data[i + 3] = 255;
    if (any) changed++;
  }
  return { data, changed, meanAbs: sum / (a.w * a.h * 3) };
}

export interface GateRow {
  readonly crop: CropId;
  readonly node: IndexOrRefused;
  readonly legacy: IndexOrRefused;
  readonly verdict: 'PASS' | 'FAIL' | 'REFUSED';
}

/** The T8 gate: with the texture removed from both arms, the node index is at or under L-matched's, per crop. A refused reading is no verdict. */
export function gateRows(node: Record<CropId, IndexOrRefused>, legacy: Record<CropId, IndexOrRefused>): GateRow[] {
  return (['penumbra', 'lit'] as const).map((crop) => {
    const n = node[crop];
    const l = legacy[crop];
    const verdict = n === null || l === null ? 'REFUSED' : n <= l ? 'PASS' : 'FAIL';
    return { crop, node: n, legacy: l, verdict };
  });
}

/** The legacy half of the gate: L-matched's flat index must FALL across the fix (not just the node's). */
export function legacyFalls(before: Record<CropId, IndexOrRefused>, after: Record<CropId, IndexOrRefused>): GateRow[] {
  return (['penumbra', 'lit'] as const).map((crop) => {
    const b = before[crop];
    const a = after[crop];
    const verdict = b === null || a === null ? 'REFUSED' : a < b ? 'PASS' : 'FAIL';
    return { crop, node: a, legacy: b, verdict };
  });
}
