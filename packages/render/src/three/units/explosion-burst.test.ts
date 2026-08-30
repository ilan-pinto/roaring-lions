import { describe, it, expect } from 'vitest';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildExplosionBurstTemplate,
  ExplosionBurstManager,
  EXPLOSION_BURST_CAPACITY,
  EXPLOSION_BURST_BASE_SCALE,
  EXPLOSION_BURST_DEFAULT_DURATION_MS,
  explosionBurstPowerFromFootprint,
} from './explosion-burst';

describe('explosionBurstPowerFromFootprint', () => {
  it('reads 1 (full power) at or above the reference footprint size', () => {
    expect(explosionBurstPowerFromFootprint(0, 0, 2, 2, 9)).toBeCloseTo(1, 10); // 3x3 = 9 tiles
    expect(explosionBurstPowerFromFootprint(0, 0, 5, 5, 9)).toBe(1); // larger footprint clamps, does not overshoot
  });

  it('scales linearly below the reference size', () => {
    // 2x2 = 4 tiles against a reference of 9 -> 4/9
    expect(explosionBurstPowerFromFootprint(0, 0, 1, 1, 9)).toBeCloseTo(4 / 9, 10);
  });

  it('a single-tile footprint still reads as some power, never negative', () => {
    const power = explosionBurstPowerFromFootprint(3, 3, 3, 3, 9);
    expect(power).toBeGreaterThan(0);
    expect(power).toBeLessThanOrEqual(1);
  });

  it('clamps to [0, 1] regardless of input shape', () => {
    expect(explosionBurstPowerFromFootprint(0, 0, 20, 20, 9)).toBe(1);
  });
});

describe('EXPLOSION_BURST_BASE_SCALE / EXPLOSION_BURST_DEFAULT_DURATION_MS', () => {
  it('are positive, finite judgment-call constants (see this file\'s own top comment for the arithmetic)', () => {
    expect(EXPLOSION_BURST_BASE_SCALE).toBeGreaterThan(0);
    expect(Number.isFinite(EXPLOSION_BURST_BASE_SCALE)).toBe(true);
    expect(EXPLOSION_BURST_DEFAULT_DURATION_MS).toBeGreaterThan(0);
  });
});

describe('buildExplosionBurstTemplate', () => {
  it('extracts all three concentric zones by role', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'core', extrasRole: 'core' },
        { nodeName: 'mid', extrasRole: 'mid' },
        { nodeName: 'outer', extrasRole: 'outer' },
      ],
    });
    const template = buildExplosionBurstTemplate(gltf);
    expect(Object.keys(template.geometries).sort()).toEqual(['core', 'mid', 'outer']);
  });

  it('falls back to the node name when extras.rl_role is absent', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'core', extrasRole: null },
        { nodeName: 'mid', extrasRole: null },
        { nodeName: 'outer', extrasRole: null },
      ],
    });
    const template = buildExplosionBurstTemplate(gltf);
    expect(Object.keys(template.geometries).sort()).toEqual(['core', 'mid', 'outer']);
  });

  it('throws loudly for a role outside the closed vocabulary', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull', extrasRole: 'hull' }],
    });
    expect(() => buildExplosionBurstTemplate(gltf)).toThrow(/no role for mesh/);
  });

  it('throws loudly when a zone is missing entirely, never drawing an incomplete burst', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'core', extrasRole: 'core' },
        { nodeName: 'mid', extrasRole: 'mid' },
      ],
    });
    expect(() => buildExplosionBurstTemplate(gltf)).toThrow(/missing the "outer" zone/);
  });
});

describe('ExplosionBurstManager', () => {
  it('is not ready until load() resolves', () => {
    const mgr = new ExplosionBurstManager();
    expect(mgr.ready).toBe(false);
    mgr.dispose();
  });

  it('spawn() with zero/negative duration is a no-op', () => {
    const mgr = new ExplosionBurstManager();
    mgr.spawn(0, 0, 0, 0, 1, 0);
    mgr.spawn(0, 0, 0, 0, 1, -10);
    expect(mgr.liveCount).toBe(0);
    mgr.dispose();
  });

  it('ages a spawned burst to retirement over its own declared duration', () => {
    const mgr = new ExplosionBurstManager();
    mgr.spawn(1, 2, 3, 0, 1, 450);
    expect(mgr.liveCount).toBe(1);
    mgr.step(300);
    expect(mgr.liveCount).toBe(1);
    mgr.step(300); // 600ms total, past the 450ms duration
    expect(mgr.liveCount).toBe(0);
    mgr.dispose();
  });

  it('never exceeds its own bounded capacity, evicting the oldest first', () => {
    const mgr = new ExplosionBurstManager(4);
    for (let i = 0; i < 10; i++) mgr.spawn(i, 0, 0, 0, 1, 1000);
    expect(mgr.liveCount).toBe(4);
    mgr.dispose();
  });

  it('defaults to EXPLOSION_BURST_CAPACITY when built with no explicit ceiling', () => {
    const mgr = new ExplosionBurstManager();
    for (let i = 0; i < EXPLOSION_BURST_CAPACITY + 5; i++) mgr.spawn(i, 0, 0, 0, 1, 1000);
    expect(mgr.liveCount).toBe(EXPLOSION_BURST_CAPACITY);
    mgr.dispose();
  });

  it('step() is total over an empty pool and over an unloaded (meshes still null) one', () => {
    const mgr = new ExplosionBurstManager();
    expect(() => mgr.step(16)).not.toThrow();
    mgr.spawn(0, 0, 0, 0, 1, 100);
    expect(() => mgr.step(16)).not.toThrow();
    mgr.dispose();
  });

  it('setColors is safe to call before any GLB has loaded', () => {
    const mgr = new ExplosionBurstManager();
    expect(() => mgr.setColors((key) => (key === 'vfx.white_hot' ? '#FFF6D0' : '#FFB43C'))).not.toThrow();
    mgr.dispose();
  });

  it('dispose() on a manager that never loaded does not throw', () => {
    const mgr = new ExplosionBurstManager();
    expect(() => mgr.dispose()).not.toThrow();
  });
});
