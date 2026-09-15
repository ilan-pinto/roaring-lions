import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FlashLightManager, FLASH_CAPACITY, FLASH_INTENSITY_SCALE, FLASH_HEIGHT } from './flash-light';

const spec = { intensity: 3.5, radius_tiles: 7, decay_ms: 500 };

describe('FlashLightManager (point-light pool)', () => {
  it('owns FLASH_CAPACITY lights, all always in the scene at zero intensity when idle', () => {
    const m = new FlashLightManager();
    const scene = new THREE.Scene();
    m.addTo(scene);
    expect(m.lights).toHaveLength(FLASH_CAPACITY);
    expect(scene.children.filter((c) => (c as THREE.PointLight).isPointLight)).toHaveLength(FLASH_CAPACITY);
    for (const l of m.lights) {
      expect(l.intensity).toBe(0);
      expect(l.visible).toBe(true); // a changing light COUNT recompiles every material
      expect(l.castShadow).toBe(false);
    }
  });

  it('spawns nothing without decay_ms or at intensity 0, but a FRACTIONAL intensity is a light', () => {
    // The rule changed on 2026-09-15: the guard was `Math.round(intensity) <=
    // 0`, a leftover from the toon era's integer ramp STEPS, and it silently
    // discarded `cigarette_ember`'s 0.3 -- an emitter that declares a light
    // and got none. A `PointLight` is continuous, so the only meaningless
    // intensity is a non-positive one.
    const m = new FlashLightManager();
    m.spawn(1, 2, 0, { intensity: 3 }, '#FFB43C'); // no decay_ms
    m.spawn(1, 2, 0, { intensity: 0, radius_tiles: 0.5, decay_ms: 420 }, '#FFB43C');
    m.spawn(1, 2, 0, { intensity: -1, radius_tiles: 0.5, decay_ms: 420 }, '#FFB43C');
    expect(m.liveCount).toBe(0);
    // `cigarette_ember`'s own shipped numbers.
    m.spawn(1, 2, 0, { intensity: 0.3, radius_tiles: 0.5, decay_ms: 420 }, '#FFB43C');
    expect(m.liveCount).toBe(1);
    m.step(210);
    expect(m.lights[0].intensity).toBeCloseTo(0.3 * FLASH_INTENSITY_SCALE, 6);
  });

  it('a live flash drives one light: position above ground, colour, distance, peak at midlife, gone after decay', () => {
    const m = new FlashLightManager();
    m.spawn(4, 6, 0.5, spec, '#FFB43C');
    expect(m.liveCount).toBe(1);
    m.step(250);
    const l = m.lights[0];
    expect(l.position.toArray()).toEqual([4, 0.5 + FLASH_HEIGHT, 6]);
    expect(l.color.getHexString().toUpperCase()).toBe('FFB43C');
    expect(l.distance).toBe(7);
    expect(l.intensity).toBeCloseTo(3.5 * FLASH_INTENSITY_SCALE, 6);
    m.step(300);
    expect(m.liveCount).toBe(0);
    expect(l.intensity).toBe(0);
  });

  it('evicts the OLDEST flash past capacity, keeping the newest', () => {
    const m = new FlashLightManager();
    for (let i = 0; i < FLASH_CAPACITY + 1; i++) m.spawn(i, 0, 0, spec, '#FFB43C');
    expect(m.liveCount).toBe(FLASH_CAPACITY);
    m.step(250);
    const xs = m.lights.map((l) => l.position.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(1); // x=0 (the oldest) was evicted
  });
});
