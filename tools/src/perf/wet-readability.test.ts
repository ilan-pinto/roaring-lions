/**
 * `wet-readability.ts`: CIEDE2000 against the published pairs, the frame-pair mask on synthetic scenes, and the
 * refusals (an empty mask, an empty ring). Oracles are LITERALS: Sharma, Wu and Dalal (2005) Table 1 for the
 * colour difference, and the numbers P4's `readability.txt` Python implementation gives for the same two sRGB
 * colours (41,37,29 ground; 15,10,5 and 60,70,90 figures).
 */
import { describe, expect, it } from 'vitest';
import {
  DARKEST_MIN_PIXELS,
  MASK_MIN_PIXELS,
  deltaE2000,
  deltaE2000Rgb,
  figureMask,
  luminance,
  maskOverlap,
  maskSize,
  readability,
  repaintDifference,
  srgbToLab,
  type Frame,
} from './wet-readability';

function solid(w: number, h: number, rgb: readonly [number, number, number]): { frame: Frame; data: Uint8Array } {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { frame: { width: w, height: h, data }, data };
}

/** A frame of `ground` with a filled `rw x rh` rectangle of `fig` at (x0, y0). */
function scene(
  w: number,
  h: number,
  ground: readonly [number, number, number],
  fig: readonly [number, number, number],
  x0: number,
  y0: number,
  rw: number,
  rh: number
): Frame {
  const { frame, data } = solid(w, h, ground);
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const i = (y * w + x) * 4;
      data[i] = fig[0];
      data[i + 1] = fig[1];
      data[i + 2] = fig[2];
    }
  }
  return frame;
}

describe('deltaE2000 against Sharma, Wu and Dalal (2005), Table 1', () => {
  const pairs: [readonly [number, number, number], readonly [number, number, number], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [50, 3.2972, 0], 1.0],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ];
  for (const [a, b, want] of pairs) {
    it(`Lab ${a.join(',')} vs ${b.join(',')} is ${want}`, () => {
      expect(deltaE2000(a, b)).toBeCloseTo(want, 3);
      // Symmetric.
      expect(deltaE2000(b, a)).toBeCloseTo(want, 3);
    });
  }

  it('is 0 for the same colour, and matches the Python reading of two sRGB colours', () => {
    expect(deltaE2000Rgb({ r: 41, g: 37, b: 29 }, { r: 41, g: 37, b: 29 })).toBe(0);
    // look 2's road: ground (41,37,29), a near-black figure (15,10,5): 8.04 (the P4 sheets' "below the floor").
    expect(deltaE2000Rgb({ r: 15, g: 10, b: 5 }, { r: 41, g: 37, b: 29 })).toBeCloseTo(8.035, 2);
    // A cool grey-blue figure over the same road clears the 15.6 floor.
    expect(deltaE2000Rgb({ r: 60, g: 70, b: 90 }, { r: 41, g: 37, b: 29 })).toBeCloseTo(19.017, 2);
  });

  it('sRGB to Lab: white is L 100, black is L 0, mid grey 118 is L 50', () => {
    expect(srgbToLab({ r: 255, g: 255, b: 255 })[0]).toBeCloseTo(100, 1);
    expect(srgbToLab({ r: 0, g: 0, b: 0 })[0]).toBeCloseTo(0, 5);
    expect(srgbToLab({ r: 119, g: 119, b: 119 })[0]).toBeCloseTo(50.0, 0);
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
});

describe('figureMask: the units-shown frame against the units-hidden frame', () => {
  const ground: [number, number, number] = [41, 37, 29];
  const hidden = scene(120, 120, ground, ground, 0, 0, 0, 0);

  it('finds exactly the pixels that differ, whatever colour the figure is', () => {
    for (const fig of [[15, 10, 5], [60, 70, 90], [52, 47, 39]] as const) {
      const shown = scene(120, 120, ground, fig, 50, 40, 12, 30);
      const mask = figureMask(shown, hidden, 56, 55, 60);
      expect(maskSize(mask)).toBe(12 * 30);
    }
  });

  it('a figure the same colour as the ground (to within the threshold) is NOT invented, and an unmoved pair is empty', () => {
    const same = scene(120, 120, ground, [48, 44, 36], 50, 40, 12, 30);
    expect(maskSize(figureMask(same, hidden, 56, 55, 60))).toBe(0);
    expect(maskSize(figureMask(hidden, hidden, 56, 55, 60))).toBe(0);
  });

  it('drops a speck smaller than MASK_MIN_PIXELS and anything outside the radius', () => {
    const speck = scene(120, 120, ground, [200, 200, 200], 10, 10, 5, 5);
    expect(5 * 5).toBeLessThan(MASK_MIN_PIXELS);
    expect(maskSize(figureMask(speck, hidden, 12, 12, 60))).toBe(0);
    const far = scene(120, 120, ground, [200, 200, 200], 100, 100, 10, 10);
    expect(maskSize(figureMask(far, hidden, 20, 20, 30))).toBe(0);
  });

  it('refuses two frames of different sizes', () => {
    expect(() => figureMask(scene(10, 10, ground, ground, 0, 0, 0, 0), scene(11, 10, ground, ground, 0, 0, 0, 0), 5, 5, 5)).toThrow(/differ in size/);
  });
});

describe('readability', () => {
  const ground: [number, number, number] = [41, 37, 29];
  const backdrop = scene(160, 160, ground, ground, 0, 0, 0, 0);

  it('a uniform figure reads as the dE2000 of its colour against the ground, mean and darkest alike', () => {
    for (const [fig, want] of [[[15, 10, 5], 8.035], [[60, 70, 90], 19.017]] as const) {
      const shown = scene(160, 160, ground, fig, 70, 50, 14, 40);
      const mask = figureMask(shown, backdrop, 77, 70, 70);
      const r = readability(shown, backdrop, mask);
      expect(r.pixels).toBe(14 * 40);
      expect(r.mean).toBeCloseTo(want, 2);
      expect(r.darkest).toBeCloseTo(want, 2);
      expect(r.perPixelMedian).toBeCloseTo(want, 2);
      // Every figure pixel is the same colour: all of them clear the floor, or none does.
      expect(r.shareAboveFloor).toBe(want > 15.6 ? 1 : 0);
      expect(r.ground.r).toBeCloseTo(41, 5);
    }
  });

  it('the darkest 15% is the dark end of a two-tone figure, and the mean sits between the tones', () => {
    // 100 figure pixels: 20 near-black (the darkest 15% = 15 of them), 80 pale. The darkest group is black, the mean is not.
    const { frame, data } = solid(160, 160, ground);
    const shown: Frame = frame;
    let k = 0;
    for (let y = 50; y < 60; y++) {
      for (let x = 70; x < 80; x++) {
        const dark = k++ < 20;
        const i = (y * 160 + x) * 4;
        data[i] = dark ? 5 : 90;
        data[i + 1] = dark ? 5 : 100;
        data[i + 2] = dark ? 5 : 120;
      }
    }
    const mask = figureMask(shown, backdrop, 75, 55, 40);
    const r = readability(shown, backdrop, mask);
    expect(r.pixels).toBe(100);
    expect(Math.floor(0.15 * 100)).toBeGreaterThanOrEqual(DARKEST_MIN_PIXELS);
    expect(r.figureDarkest.r).toBe(5);
    expect(r.figureMean.r).toBeCloseTo(0.2 * 5 + 0.8 * 90, 5);
    expect(r.darkest).toBeCloseTo(deltaE2000Rgb({ r: 5, g: 5, b: 5 }, { r: 41, g: 37, b: 29 }), 3);
    expect(r.mean).not.toBeCloseTo(r.darkest, 0);
    expect(r.internalContrast).toBeGreaterThan(10);
    // 80 pale pixels (dE about 14 to 16 against this ground) and 20 near-black (dE 12): the share is whatever clears 15.6, and is not 0 or 1.
    expect(r.shareAboveFloor).toBeGreaterThanOrEqual(0);
    expect(r.shareAboveFloor).toBeLessThanOrEqual(0.8);
  });

  it('refuses an empty mask rather than reading a number from nothing', () => {
    expect(() => readability(backdrop, backdrop, new Uint8Array(160 * 160))).toThrow(/mask is empty/);
  });

  it('refuses an empty ring (the mask fills the frame)', () => {
    const full = new Uint8Array(160 * 160).fill(1);
    expect(() => readability(backdrop, backdrop, full)).toThrow(/ring is empty/);
  });

  it('the ground is the backdrop frame, not the measurement frame: a shadow only the backdrop has moves it', () => {
    const shadowed = scene(160, 160, [20, 18, 14], [20, 18, 14], 0, 0, 0, 0);
    const shown = scene(160, 160, ground, [60, 70, 90], 70, 50, 14, 40);
    const mask = figureMask(shown, backdrop, 77, 70, 70);
    const a = readability(shown, backdrop, mask);
    const b = readability(shown, shadowed, mask);
    expect(a.ground.r).toBe(41);
    expect(b.ground.r).toBe(20);
    expect(b.mean).not.toBeCloseTo(a.mean, 1);
  });
});

describe('the repaint control', () => {
  it('identical repaints differ nowhere, a moved figure differs where it moved', () => {
    const ground: [number, number, number] = [41, 37, 29];
    const a = scene(100, 100, ground, [200, 200, 200], 40, 30, 10, 20);
    const b = scene(100, 100, ground, [200, 200, 200], 40, 30, 10, 20);
    const moved = scene(100, 100, ground, [200, 200, 200], 45, 30, 10, 20);
    const hidden = scene(100, 100, ground, ground, 0, 0, 0, 0);
    const mask = figureMask(a, hidden, 45, 40, 50);
    expect(repaintDifference(a, b, mask)).toBe(0);
    expect(repaintDifference(a, moved, mask)).toBeCloseTo(0.5, 5);
    expect(maskOverlap(mask, figureMask(moved, hidden, 50, 40, 50))).toBeCloseTo(1 / 3, 5);
  });
});
