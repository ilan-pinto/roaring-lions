import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  BLOOM_RADIUS,
  BLOOM_RESOLUTION_SCALE,
  BLOOM_STRENGTH,
  BLOOM_THRESHOLD,
  QuarterBloomPass,
  bloomPassFor,
  createBloomPass,
  halfToFloat,
  linearLuminance,
  luminanceCensus,
} from './bloom';
import { QUALITY_PRESETS } from '../quality';

/** Every internal target the pass sizes: the bright pass and both blur
 *  chains' first mip, which are the full-size ones. */
function sizes(pass: QuarterBloomPass): { bright: [number, number]; h0: [number, number]; v0: [number, number]; h1: [number, number] } {
  const wh = (t: THREE.WebGLRenderTarget): [number, number] => [t.width, t.height];
  return {
    bright: wh(pass.renderTargetBright),
    h0: wh(pass.renderTargetsHorizontal[0]),
    v0: wh(pass.renderTargetsVertical[0]),
    h1: wh(pass.renderTargetsHorizontal[1]),
  };
}

describe('bloom constants (rulings D1, D8)', () => {
  it('pins strength 0.5, radius 0.35, threshold 1.0, quarter resolution', () => {
    expect(BLOOM_STRENGTH).toBe(0.5);
    expect(BLOOM_RADIUS).toBe(0.35);
    expect(BLOOM_THRESHOLD).toBe(1.0);
    expect(BLOOM_RESOLUTION_SCALE).toBe(0.25);
  });

  it('createBloomPass carries the ruled values into the pass', () => {
    const pass = createBloomPass(1440, 900, 2);
    expect(pass.strength).toBe(BLOOM_STRENGTH);
    expect(pass.radius).toBe(BLOOM_RADIUS);
    expect(pass.threshold).toBe(BLOOM_THRESHOLD);
    // Blends into the read buffer, never swaps: the chain after it reads
    // the same buffer it read.
    expect(pass.needsSwap).toBe(false);
    pass.dispose();
  });
});

describe('QuarterBloomPass: internal targets at a quarter of the drawing buffer', () => {
  it('at construction: 1440x900 css at DPR 2 (2880x1800) gives a 720x450 bright target', () => {
    // Falsify: drop the pre-halving in `createBloomPass` and this reads
    // 1440x900 -- three's own half resolution, the audit's +5.4-7.7 ms.
    const pass = createBloomPass(1440, 900, 2);
    expect(sizes(pass)).toEqual({ bright: [720, 450], h0: [720, 450], v0: [720, 450], h1: [360, 225] });
    pass.dispose();
  });

  it('after setSize (which the composer always calls with the FULL buffer size) it stays at a quarter', () => {
    // Falsify: delete `QuarterBloomPass.setSize` and this reads 1000x600 /
    // 500x300 -- the composer's resize undoing the quarter, the trap
    // `WorldGTAOPass` documents for AO.
    const pass = createBloomPass(1440, 900, 2);
    pass.setSize(2000, 1200);
    expect(sizes(pass)).toEqual({ bright: [500, 300], h0: [500, 300], v0: [500, 300], h1: [250, 150] });
    pass.setSize(3, 3);
    expect(pass.renderTargetBright.width).toBeGreaterThanOrEqual(1);
    expect(pass.renderTargetBright.height).toBeGreaterThanOrEqual(1);
    pass.dispose();
  });

  it('bloomPassFor: high and medium build one, low builds nothing', () => {
    const high = bloomPassFor(QUALITY_PRESETS.high, 800, 600, 1);
    const medium = bloomPassFor(QUALITY_PRESETS.medium, 800, 600, 1);
    expect(high).toBeInstanceOf(QuarterBloomPass);
    expect(medium).toBeInstanceOf(QuarterBloomPass);
    expect(bloomPassFor(QUALITY_PRESETS.low, 800, 600, 1)).toBeNull();
    high?.dispose();
    medium?.dispose();
  });
});

describe('halfToFloat', () => {
  it('decodes binary16 bit patterns', () => {
    expect(halfToFloat(0x0000)).toBe(0);
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0x3800)).toBe(0.5);
    expect(halfToFloat(0x4000)).toBe(2);
    expect(halfToFloat(0x3b33)).toBeCloseTo(0.9, 3);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x0001)).toBeCloseTo(2 ** -24, 30);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(halfToFloat(0x7e00)).toBeNaN();
    // Agrees with three's own encoder across the range the census sees.
    for (const v of [0.01, 0.05, 0.31, 0.73, 0.9, 1.0, 1.37, 4, 10]) {
      expect(halfToFloat(THREE.DataUtils.toHalfFloat(v))).toBeCloseTo(v, 2);
    }
  });
});

describe('luminanceCensus', () => {
  const half = (v: number): number => THREE.DataUtils.toHalfFloat(v);
  const buffer = (pixels: [number, number, number][]): Uint16Array => {
    const data = new Uint16Array(pixels.length * 4);
    pixels.forEach(([r, g, b], i) => {
      data[i * 4] = half(r);
      data[i * 4 + 1] = half(g);
      data[i * 4 + 2] = half(b);
      data[i * 4 + 3] = half(1);
    });
    return data;
  };

  it('uses the Rec. 709 coefficients the high-pass thresholds on', () => {
    expect(linearLuminance(1, 0, 0)).toBeCloseTo(0.2126, 6);
    expect(linearLuminance(0, 1, 0)).toBeCloseTo(0.7152, 6);
    expect(linearLuminance(0, 0, 1)).toBeCloseTo(0.0722, 6);
    expect(linearLuminance(1, 1, 1)).toBeCloseTo(1, 6);
  });

  it('reads max, p50 and the fraction over threshold off a constructed buffer', () => {
    // 10 pixels: eight grey 0.2, one 0.8, one HDR 3.0 (the only one over 1).
    const px: [number, number, number][] = [];
    for (let i = 0; i < 8; i++) px.push([0.2, 0.2, 0.2]);
    px.push([0.8, 0.8, 0.8], [3, 3, 3]);
    const c = luminanceCensus(buffer(px), 1);
    expect(c.samples).toBe(10);
    expect(c.p50).toBeCloseTo(0.2, 2);
    expect(c.max).toBeCloseTo(3, 2);
    expect(c.fracOverThreshold).toBeCloseTo(0.1, 6);
  });

  it('samples every stride-th pixel, and a stride can skip the hot one', () => {
    const px: [number, number, number][] = [[0.1, 0.1, 0.1], [5, 5, 5], [0.1, 0.1, 0.1], [0.1, 0.1, 0.1]];
    const c = luminanceCensus(buffer(px), 2);
    expect(c.samples).toBe(2);
    expect(c.max).toBeCloseTo(0.1, 2);
  });

  it('a NaN in the frame reads as Infinity, never averaged away', () => {
    const data = buffer([[0.1, 0.1, 0.1]]);
    data[0] = 0x7e00;
    expect(luminanceCensus(data, 1).max).toBe(Infinity);
  });

  it('an empty buffer is an empty census, not a crash', () => {
    expect(luminanceCensus(new Uint16Array(0), 5)).toEqual({ samples: 0, p50: 0, p99: 0, max: 0, fracOverThreshold: 0 });
  });
});
