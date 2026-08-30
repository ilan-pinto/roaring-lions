import { describe, expect, it } from 'vitest';
import { FlashLightManager } from './flash-light';
import { FLASH_CAPACITY } from './palette-material';

describe('FlashLightManager', () => {
  it('spawns nothing for a light with no decay_ms -- there is no duration to animate', () => {
    const m = new FlashLightManager();
    m.spawn(1, 2, { intensity: 3, radius_tiles: 2 });
    expect(m.liveCount).toBe(0);
  });

  it('spawns nothing for a light whose rounded intensity is 0 -- cigarette_ember (0.3) is the shipped case this excludes', () => {
    const m = new FlashLightManager();
    m.spawn(1, 2, { intensity: 0.3, radius_tiles: 0.5, decay_ms: 420 });
    expect(m.liveCount).toBe(0);
  });

  it('spawns a real flash when decay_ms > 0 and rounded intensity >= 1', () => {
    const m = new FlashLightManager();
    m.spawn(4, 6, { intensity: 3.8, radius_tiles: 5.5, decay_ms: 170 });
    expect(m.liveCount).toBe(1);
  });

  it('evicts the OLDEST flash when spawning past capacity, keeping the newest', () => {
    const m = new FlashLightManager();
    for (let i = 0; i < FLASH_CAPACITY; i++) {
      m.spawn(i, 0, { intensity: 2, radius_tiles: 1, decay_ms: 200 });
    }
    expect(m.liveCount).toBe(FLASH_CAPACITY);
    // One more: the SLOT at index 0 (x=0, the oldest) must be evicted, so the
    // newest spawn (x=FLASH_CAPACITY) takes its place after step() writes.
    m.spawn(FLASH_CAPACITY, 0, { intensity: 2, radius_tiles: 1, decay_ms: 200 });
    expect(m.liveCount).toBe(FLASH_CAPACITY);
    m.step(0);
    const xs = m.posArray.map((v) => v.x);
    expect(xs).not.toContain(0);
    expect(xs).toContain(FLASH_CAPACITY);
  });

  it('follows sin(progress * PI): 0 at spawn, peaks at midlife, 0 again once expired', () => {
    const m = new FlashLightManager();
    m.spawn(0, 0, { intensity: 3.8, radius_tiles: 5, decay_ms: 100 });
    m.step(0);
    expect(m.shiftArray[0]).toBe(0); // sin(0) = 0
    m.step(50); // progress 0.5 -> sin(pi/2) = 1, full maxShift
    expect(m.shiftArray[0]).toBe(4); // round(intensity 3.8) clamped to MAX_SHIFT_STEPS (4)
    m.step(49); // progress 0.99 -> sin(~pi) close to 0, rounds to 0
    expect(m.shiftArray[0]).toBe(0);
    m.step(1); // progress 1.0 -- past decay_ms, retired
    expect(m.liveCount).toBe(0);
    expect(m.shiftArray[0]).toBe(0);
  });

  it('retires an expired flash and clears its slot back to the inert default', () => {
    const m = new FlashLightManager();
    m.spawn(3, 3, { intensity: 2, radius_tiles: 2, decay_ms: 50 });
    m.step(60);
    expect(m.liveCount).toBe(0);
    expect(m.radiusArray[0]).toBe(0);
    expect(m.shiftArray[0]).toBe(0);
  });

  it('register() points a structural material stand-in at the SAME arrays, so a later step() is visible without re-registering', () => {
    const m = new FlashLightManager();
    const material = {
      uniforms: {
        uFlashPos: { value: [] as unknown },
        uFlashRadius: { value: [] as unknown },
        uFlashShift: { value: [] as unknown },
      },
    };
    m.register(material);
    expect(material.uniforms.uFlashPos.value).toBe(m.posArray);
    expect(material.uniforms.uFlashRadius.value).toBe(m.radiusArray);
    expect(material.uniforms.uFlashShift.value).toBe(m.shiftArray);

    m.spawn(7, 8, { intensity: 3, radius_tiles: 4, decay_ms: 100 });
    m.step(50);
    const posValue = material.uniforms.uFlashPos.value as { x: number; y: number }[];
    expect(posValue[0].x).toBe(7);
    expect(posValue[0].y).toBe(8);
  });

  it('never stores more than FLASH_CAPACITY live flashes', () => {
    const m = new FlashLightManager();
    for (let i = 0; i < FLASH_CAPACITY * 3; i++) {
      m.spawn(i, i, { intensity: 4, radius_tiles: 1, decay_ms: 500 });
    }
    expect(m.liveCount).toBe(FLASH_CAPACITY);
  });
});
