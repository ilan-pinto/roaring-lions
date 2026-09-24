import { describe, expect, it } from 'vitest';
import { colourRegister, registerDelta, withinRegister } from './register';

const solid = (w: number, h: number, r: number, g: number, b: number): Uint8Array => {
  const a = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set([r, g, b, 255], i * 4);
  return a;
};

describe('colourRegister -- spec §3.7’s metric', () => {
  it('black: Y 0, and no pixel is bright enough to carry a saturation', () => {
    expect(colourRegister(solid(2, 2, 0, 0, 0), 2, 2)).toEqual({ meanY: 0, meanS: 0, samples: 0 });
  });
  it('white: Y 1, S 0', () => {
    const r = colourRegister(solid(2, 2, 255, 255, 255), 2, 2);
    expect(r.meanY).toBeCloseTo(1, 10);
    expect(r.meanS).toBe(0);
    expect(r.samples).toBe(4);
  });
  it('pure red: Y is the Rec. 709 red weight, S is 1', () => {
    const r = colourRegister(solid(1, 1, 255, 0, 0), 1, 1);
    expect(r.meanY).toBeCloseTo(0.2126, 6);
    expect(r.meanS).toBe(1);
  });
  // A mean of sRGB codes would read 0.502 here. Luminance is linear light.
  it('linearises before weighting: sRGB 128 grey is Y 0.2159', () => {
    expect(colourRegister(solid(1, 1, 128, 128, 128), 1, 1).meanY).toBeCloseTo(0.21586, 4);
  });
  it('a box samples only inside itself', () => {
    const a = new Uint8Array(2 * 4);
    a.set([255, 255, 255, 255], 0);
    a.set([0, 0, 0, 255], 4);
    expect(colourRegister(a, 2, 1, { x: 0, y: 0, width: 1, height: 1 }).meanY).toBeCloseTo(1, 10);
  });
});

describe('registerDelta / withinRegister', () => {
  const mission = { meanY: 0.2423, meanS: 0.2985, samples: 1 };
  it('is relative to the mission', () => {
    const d = registerDelta({ meanY: 0.2382, meanS: 0.3, samples: 1 }, mission);
    expect(d.dY).toBeCloseTo(-0.0169, 3);
    expect(d.dS).toBeCloseTo(0.005, 3);
  });
  // Spec M16 and M17, as the two ends of the bar.
  it('holds for the measured host and fails for the shipped Phase 0 plate', () => {
    expect(withinRegister({ meanY: 0.2382, meanS: 0.3, samples: 1 }, mission, 0.1)).toBe(true);
    expect(withinRegister({ meanY: 0.3153, meanS: 0.269, samples: 1 }, mission, 0.1)).toBe(false);
  });
});
