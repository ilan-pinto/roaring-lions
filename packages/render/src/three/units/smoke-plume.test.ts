import { describe, it, expect } from 'vitest';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildSmokePlumeTemplate,
  SmokePlumeManager,
  SMOKE_PLUME_CAPACITY,
  SMOKE_PLUME_BASE_SCALE,
  SMOKE_PLUME_DEFAULT_DURATION_MS,
  SMOKE_PLUME_RISE_FRACTION,
  SMOKE_PLUME_FADE_FRACTION,
  SMOKE_PLUME_FOOTPRINT_MIN,
  smokePlumeRiseEnvelope,
  smokePlumeFootprintScale,
} from './smoke-plume';

describe('smokePlumeRiseEnvelope', () => {
  it('starts at 0 and ramps linearly to 1 over the rise fraction', () => {
    expect(smokePlumeRiseEnvelope(0)).toBe(0);
    expect(smokePlumeRiseEnvelope(SMOKE_PLUME_RISE_FRACTION / 2)).toBeCloseTo(0.5, 10);
    expect(smokePlumeRiseEnvelope(SMOKE_PLUME_RISE_FRACTION)).toBeCloseTo(1, 10);
  });

  it('holds at 1 through the persist phase', () => {
    const mid = SMOKE_PLUME_RISE_FRACTION + (1 - SMOKE_PLUME_RISE_FRACTION - SMOKE_PLUME_FADE_FRACTION) / 2;
    expect(smokePlumeRiseEnvelope(mid)).toBe(1);
    expect(smokePlumeRiseEnvelope(1 - SMOKE_PLUME_FADE_FRACTION)).toBe(1);
  });

  it('ramps linearly back to 0 over the fade fraction, ending exactly at life\'s end', () => {
    const fadeStart = 1 - SMOKE_PLUME_FADE_FRACTION;
    expect(smokePlumeRiseEnvelope(fadeStart + SMOKE_PLUME_FADE_FRACTION / 2)).toBeCloseTo(0.5, 10);
    expect(smokePlumeRiseEnvelope(1)).toBeCloseTo(0, 10);
  });

  it('the fade phase is longer than the rise phase -- billows up fast, thins slowly', () => {
    expect(SMOKE_PLUME_FADE_FRACTION).toBeGreaterThan(SMOKE_PLUME_RISE_FRACTION);
  });

  it('clamps progress outside [0, 1] rather than reading past either end', () => {
    expect(smokePlumeRiseEnvelope(-1)).toBe(0);
    expect(smokePlumeRiseEnvelope(2)).toBeCloseTo(0, 10);
  });
});

describe('smokePlumeFootprintScale', () => {
  it('never collapses fully to zero, unlike the height envelope it is derived from', () => {
    expect(smokePlumeFootprintScale(0)).toBeCloseTo(SMOKE_PLUME_FOOTPRINT_MIN, 10);
  });

  it('reaches exactly 1 when the rise envelope is at its own peak', () => {
    expect(smokePlumeFootprintScale(1)).toBeCloseTo(1, 10);
  });

  it('is monotonically increasing in its input', () => {
    expect(smokePlumeFootprintScale(0.75)).toBeGreaterThan(smokePlumeFootprintScale(0.25));
  });
});

describe('SMOKE_PLUME_BASE_SCALE / SMOKE_PLUME_DEFAULT_DURATION_MS', () => {
  it('are positive, finite judgment-call constants (see this file\'s own top comment for the arithmetic)', () => {
    expect(SMOKE_PLUME_BASE_SCALE).toBeGreaterThan(0);
    expect(Number.isFinite(SMOKE_PLUME_BASE_SCALE)).toBe(true);
    expect(SMOKE_PLUME_DEFAULT_DURATION_MS).toBeGreaterThan(0);
  });

  it('reads over SECONDS, not the burst\'s sub-second lifetime', () => {
    // The whole point of this asset per its own brief: "a plume reads over
    // seconds." 1000ms is a generous floor -- the actual constant is 4000.
    expect(SMOKE_PLUME_DEFAULT_DURATION_MS).toBeGreaterThan(1000);
  });
});

describe('buildSmokePlumeTemplate', () => {
  it('extracts all three stacked-slab zones by role', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'base', extrasRole: 'base' },
        { nodeName: 'mid', extrasRole: 'mid' },
        { nodeName: 'top', extrasRole: 'top' },
      ],
    });
    const template = buildSmokePlumeTemplate(gltf);
    expect(Object.keys(template.geometries).sort()).toEqual(['base', 'mid', 'top']);
  });

  it('falls back to the node name when extras.rl_role is absent', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'base', extrasRole: null },
        { nodeName: 'mid', extrasRole: null },
        { nodeName: 'top', extrasRole: null },
      ],
    });
    const template = buildSmokePlumeTemplate(gltf);
    expect(Object.keys(template.geometries).sort()).toEqual(['base', 'mid', 'top']);
  });

  it('throws loudly for a role outside the closed vocabulary', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull', extrasRole: 'hull' }],
    });
    expect(() => buildSmokePlumeTemplate(gltf)).toThrow(/no role for mesh/);
  });

  it('throws loudly for the OTHER vfx-mesh vocabulary (core/mid/outer is not this class\'s)', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'core', extrasRole: 'core' }],
    });
    expect(() => buildSmokePlumeTemplate(gltf)).toThrow(/no role for mesh/);
  });

  it('throws loudly when a zone is missing entirely, never drawing an incomplete plume', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'base', extrasRole: 'base' },
        { nodeName: 'mid', extrasRole: 'mid' },
      ],
    });
    expect(() => buildSmokePlumeTemplate(gltf)).toThrow(/missing the "top" zone/);
  });
});

describe('SmokePlumeManager', () => {
  it('is not ready until load() resolves', () => {
    const mgr = new SmokePlumeManager();
    expect(mgr.ready).toBe(false);
    mgr.dispose();
  });

  it('spawn() with zero/negative duration is a no-op', () => {
    const mgr = new SmokePlumeManager();
    mgr.spawn(0, 0, 0, 0, 1, 0);
    mgr.spawn(0, 0, 0, 0, 1, -10);
    expect(mgr.liveCount).toBe(0);
    mgr.dispose();
  });

  it('ages a spawned plume to retirement over its own declared duration', () => {
    const mgr = new SmokePlumeManager();
    mgr.spawn(1, 2, 3, 0, 1, 4000);
    expect(mgr.liveCount).toBe(1);
    mgr.step(3000);
    expect(mgr.liveCount).toBe(1);
    mgr.step(1500); // 4500ms total, past the 4000ms duration
    expect(mgr.liveCount).toBe(0);
    mgr.dispose();
  });

  it('never exceeds its own bounded capacity, evicting the oldest first', () => {
    const mgr = new SmokePlumeManager(4);
    for (let i = 0; i < 10; i++) mgr.spawn(i, 0, 0, 0, 1, 5000);
    expect(mgr.liveCount).toBe(4);
    mgr.dispose();
  });

  it('defaults to SMOKE_PLUME_CAPACITY when built with no explicit ceiling', () => {
    const mgr = new SmokePlumeManager();
    for (let i = 0; i < SMOKE_PLUME_CAPACITY + 5; i++) mgr.spawn(i, 0, 0, 0, 1, 5000);
    expect(mgr.liveCount).toBe(SMOKE_PLUME_CAPACITY);
    mgr.dispose();
  });

  it('step() is total over an empty pool and over an unloaded (meshes still null) one', () => {
    const mgr = new SmokePlumeManager();
    expect(() => mgr.step(16)).not.toThrow();
    mgr.spawn(0, 0, 0, 0, 1, 4000);
    expect(() => mgr.step(16)).not.toThrow();
    mgr.dispose();
  });

  it('setColors is safe to call before any GLB has loaded', () => {
    const mgr = new SmokePlumeManager();
    expect(() => mgr.setColors((key) => (key === 'gunmetal.3' ? '#363B39' : '#8E9491'))).not.toThrow();
    mgr.dispose();
  });

  it('dispose() on a manager that never loaded does not throw', () => {
    const mgr = new SmokePlumeManager();
    expect(() => mgr.dispose()).not.toThrow();
  });
});
