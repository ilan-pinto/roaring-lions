import { describe, expect, it } from 'vitest';
import { isoY } from '../project';
import { VIEW_DIRECTION } from './camera';
import { HAZE_FORWARD, HAZE_LOW, aheadOf, hazeAmount, hazeRadiance, hazeReferenceLevel } from './haze';

describe('haze (N-18, N-19)', () => {
  it('points away from the camera along the ground', () => {
    const n = Math.hypot(VIEW_DIRECTION.x, VIEW_DIRECTION.z);
    expect(HAZE_FORWARD[0]).toBeCloseTo(-VIEW_DIRECTION.x / n, 12);
    expect(HAZE_FORWARD[1]).toBeCloseTo(-VIEW_DIRECTION.z / n, 12);
  });
  // The claim the mock rested on: on flat ground, further ahead IS higher on screen.
  it('orders flat ground exactly as the screen does', () => {
    for (let i = 0; i < 200; i++) {
      const [ax, az, bx, bz] = [i % 17, (i * 7) % 23, (i * 5) % 19, (i * 3) % 29];
      const da = aheadOf(ax, az, 24, 24);
      const db = aheadOf(bx, bz, 24, 24);
      if (Math.abs(da - db) < 1e-9) continue;
      expect(da > db).toBe(isoY(ax, az) < isoY(bx, bz));
    }
  });
  it('is 0 at and before the focus plane and the full amount at +20 tiles', () => {
    expect(hazeAmount(-5, 0, 0.12)).toBe(0);
    expect(hazeAmount(0, 0, 0.12)).toBe(0);
    expect(hazeAmount(10, 0, 0.12)).toBeCloseTo(0.06, 12);
    expect(hazeAmount(20, 0, 0.12)).toBeCloseTo(0.12, 12);
    expect(hazeAmount(80, 0, 0.12)).toBeCloseTo(0.12, 12);
  });
  it('adds up to 6% on ground 2 levels below the reference, never more', () => {
    expect(hazeAmount(0, 1, 0.12)).toBeCloseTo(HAZE_LOW / 2, 12);
    expect(hazeAmount(0, 2, 0.12)).toBeCloseTo(HAZE_LOW, 12);
    expect(hazeAmount(0, 7, 0.12)).toBeCloseTo(HAZE_LOW, 12);
    expect(hazeAmount(0, -3, 0.12)).toBe(0);
  });
  it('gives a flat map no low-lying term at all (N-19)', () => {
    const flat = { width: 4, height: 4, elevation: null, blocked: new Uint8Array(16) };
    expect(hazeReferenceLevel(flat)).toBe(0);
  });
  it('takes the median over unblocked tiles', () => {
    const elevation = Uint8Array.from([0, 0, 1, 1, 2, 2, 3, 9, 9]);
    const blocked = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1, 1]);
    expect(hazeReferenceLevel({ width: 3, height: 3, elevation, blocked })).toBe(1);
  });
  it('scales the tint to lit ground under the day sun', () => {
    expect(hazeRadiance(2.6, 0.8188, 0.9)).toBeCloseTo((2.6 * 0.8188 + 0.9) / Math.PI, 12);
  });
});
