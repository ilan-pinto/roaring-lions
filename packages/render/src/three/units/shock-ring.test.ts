import { describe, expect, it } from 'vitest';
import { ShockRingPool, shockRingState } from './shock-ring';

describe('shockRingState', () => {
  it('grows to its radius and fades out over its duration', () => {
    expect(shockRingState(0, 300, 2.2)?.opacity).toBeCloseTo(0.75, 9);
    const mid = shockRingState(150, 300, 2.2);
    expect(mid?.radius).toBeCloseTo(2.2 * 0.75, 9);
    expect(shockRingState(300, 300, 2.2)).toBeNull();
    expect(shockRingState(-1, 300, 2.2)).toBeNull();
  });
});

describe('ShockRingPool', () => {
  it('draws a spawned ring until it expires, and hides it under the debug flag', () => {
    const pool = new ShockRingPool(0xffffff);
    pool.spawn(1, 0, 1, 2.2, 300);
    expect(pool.liveCount).toBe(1);
    const visible = () => pool.group.children.filter((c) => c.visible).length;
    expect(visible()).toBe(1);
    pool.setDebugHidden(true);
    pool.step(16);
    expect(visible()).toBe(0);
    pool.setDebugHidden(false);
    expect(visible()).toBe(1);
    pool.step(300);
    expect(pool.liveCount).toBe(0);
    expect(visible()).toBe(0);
    pool.dispose();
  });
});
