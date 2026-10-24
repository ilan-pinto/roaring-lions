import { describe, expect, it } from 'vitest';
import { ZOOM_FADE_FULL, ZOOM_FADE_OFF, zoomFadeWeight } from './zoom-fade';

describe('zoomFadeWeight', () => {
  it('pins the band to the literal numbers the PR states, not to the constants', () => {
    expect(ZOOM_FADE_OFF).toBe(0.7);
    expect(ZOOM_FADE_FULL).toBe(0.9);
    expect(zoomFadeWeight(0.65)).toBe(0);
    expect(zoomFadeWeight(0.8)).toBeCloseTo(0.5, 10);
    expect(zoomFadeWeight(0.75)).toBeCloseTo(0.15625, 10);
  });
  it('is exactly 0 at and below the off zoom and exactly 1 at and above the full zoom', () => {
    expect(zoomFadeWeight(0.35)).toBe(0);
    expect(zoomFadeWeight(0.5)).toBe(0);
    expect(zoomFadeWeight(ZOOM_FADE_OFF)).toBe(0);
    expect(zoomFadeWeight(ZOOM_FADE_FULL)).toBe(1);
    expect(zoomFadeWeight(1.0)).toBe(1);
    expect(zoomFadeWeight(2.5)).toBe(1);
  });
  it('is strictly between 0 and 1 inside the band, and monotone', () => {
    let prev = 0;
    for (let z = ZOOM_FADE_OFF + 0.01; z < ZOOM_FADE_FULL - 0.005; z += 0.01) {
      const w = zoomFadeWeight(z);
      expect(w).toBeGreaterThan(prev);
      expect(w).toBeLessThan(1);
      prev = w;
    }
    expect(zoomFadeWeight((ZOOM_FADE_OFF + ZOOM_FADE_FULL) / 2)).toBeCloseTo(0.5, 10);
  });
  it('leaves the gated scenarios (zoom 1.0 and above) untouched', () => {
    for (const z of [1.0, 1.6, 2.2, 2.5]) expect(zoomFadeWeight(z)).toBe(1);
  });
  it('treats NaN as off rather than as full', () => {
    expect(zoomFadeWeight(Number.NaN)).toBe(0);
  });
});
