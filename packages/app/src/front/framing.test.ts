import { describe, expect, it } from 'vitest';
import { REF_LAYER, hostZoom } from './framing';

describe('hostZoom -- the cover law', () => {
  it('is the reference zoom on the reference layer', () => {
    expect(hostZoom(REF_LAYER.width, REF_LAYER.height, 1.6)).toBeCloseTo(1.6, 10);
  });
  it('scales with a 16:9 layer, so every 16:9 screen frames the same world', () => {
    expect(hostZoom(2560, 1440, 1.6)).toBeCloseTo(2.1333333, 6);
  });
  it('lets width bind on a wide layer and crops the height, like object-fit: cover', () => {
    expect(hostZoom(2560, 1080, 1.6)).toBeCloseTo(2.1333333, 6);
  });
  it('lets height bind on a tall layer and crops the width', () => {
    expect(hostZoom(1600, 1200, 1.6)).toBeCloseTo(1.7777778, 6);
  });
  it('a zero-sized layer gives a finite positive zoom, never NaN or 0', () => {
    const z = hostZoom(0, 0, 1.6);
    expect(Number.isFinite(z) && z > 0).toBe(true);
  });
});
