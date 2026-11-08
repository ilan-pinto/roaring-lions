// GH-943 WebGPU P2 T2: the banding probe's pure half. Each refusal and reading is fed the input that trips it.
import { describe, expect, it } from 'vitest';
import { ign } from '../golden-diff/banding';
import { abDelta, deadHypotheses, ditherConvention, unstableMask, type Delta, type Frame, type VariantRow } from './webgpu-banding-probe-lib';

function solid(w: number, h: number, f: (x: number, y: number) => number): Frame {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(f(x, y));
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { w, h, data };
}

const ZERO: Delta = { changed: 0, meanAbs: 0, pixels: 100 };
const row = (hypothesis: VariantRow['hypothesis'], arm: VariantRow['arm'], changed: number): VariantRow => ({
  hypothesis,
  variant: 'v',
  arm,
  applied: '',
  frame: { changed, meanAbs: changed > 0 ? 0.1 : 0, pixels: 100 },
  crops: { penumbra: ZERO, lit: ZERO },
  index: { penumbra: { index: 0, masked: 1 }, lit: { index: 0, masked: 1 } },
  restored: true,
});

describe('deadHypotheses: a toggle that moved nothing tested nothing', () => {
  // Falsified by making the filter `changed >= 0` (every hypothesis then reads dead, and the first two assertions go red).
  it('names a hypothesis whose every variant moved 0 stable px on every arm', () => {
    expect(deadHypotheses([row('H4', 'L', 0), row('H4', 'G', 0), row('H5', 'L', 12), row('H5', 'G', 0)])).toEqual(['H4']);
  });

  it('keeps a hypothesis that moved one arm only (H0 moves L; G has no texture to hide)', () => {
    expect(deadHypotheses([row('H0', 'L', 5000), row('H0', 'G', 0)])).toEqual([]);
  });

  it('keeps a hypothesis one of whose variants moved', () => {
    expect(deadHypotheses([row('H3', 'L', 0), row('H3', 'L', 3)])).toEqual([]);
  });
});

describe('abDelta skips the unstable pixels of the repaint control', () => {
  it('reads 0 when the only difference is a pixel the control already saw move', () => {
    const a = solid(8, 8, () => 10);
    const b = solid(8, 8, (x, y) => (x === 3 && y === 3 ? 90 : 10));
    expect(abDelta(a, b, null).changed).toBe(1);
    expect(abDelta(a, b, unstableMask(a, b)).changed).toBe(0);
  });

  it('reads a region only', () => {
    const a = solid(8, 8, () => 10);
    const b = solid(8, 8, (x) => (x >= 4 ? 20 : 10));
    expect(abDelta(a, b, null, { x: 0, y: 0, w: 4, h: 8 }).changed).toBe(0);
    expect(abDelta(a, b, null, { x: 4, y: 0, w: 4, h: 8 }).changed).toBe(32);
  });
});

describe('ditherConvention reads which y origin a dither used', () => {
  const W = 256;
  const H = 180;
  const base = (x: number): number => 100 + x / 64;
  const crop = { x: 32, y: 40, w: 160, h: 100 };

  it('says bottom-left for a gl_FragCoord dither', () => {
    const on = solid(W, H, (x, y) => base(x) + ign(x + 0.5, H - y - 0.5) - 0.5);
    const off = solid(W, H, (x) => base(x));
    const d = ditherConvention(on, off, crop);
    expect(d.bottomLeft).toBeGreaterThan(0.3);
    expect(Math.abs(d.topLeft)).toBeLessThan(0.1);
  });

  it('says top-left for an unflipped screen-coordinate dither', () => {
    const on = solid(W, H, (x, y) => base(x) + ign(x + 0.5, y + 0.5) - 0.5);
    const off = solid(W, H, (x) => base(x));
    const d = ditherConvention(on, off, crop);
    expect(d.topLeft).toBeGreaterThan(0.3);
    expect(Math.abs(d.bottomLeft)).toBeLessThan(0.1);
  });
});
