import { describe, it, expect } from 'vitest';
import { parseRigidFixture } from './rigid-mesh-fixture';
import {
  buildMuzzleFlashTemplate,
  muzzleFlashPowerScale,
  muzzleFlashEnvelope,
  MuzzleFlashManager,
  MUZZLE_FLASH_CAPACITY,
} from './muzzle-flash';

describe('muzzleFlashPowerScale', () => {
  it('matches vfx/particles.ts:174\'s own established magnitude-to-size law', () => {
    expect(muzzleFlashPowerScale(0)).toBeCloseTo(0.75, 10);
    expect(muzzleFlashPowerScale(1)).toBeCloseTo(2.0, 10);
  });

  it('a coax_mg-strength shot (measured firePower ~0.19) scales well below a gun_120-strength one (~1)', () => {
    const coax = muzzleFlashPowerScale(0.19);
    const gun120 = muzzleFlashPowerScale(0.99997);
    expect(coax).toBeLessThan(gun120);
    expect(gun120 / coax).toBeGreaterThan(1.5);
  });
});

describe('muzzleFlashEnvelope', () => {
  it('grows from 0, peaks at exactly mid-life, decays back to 0', () => {
    expect(muzzleFlashEnvelope(0)).toBeCloseTo(0, 10);
    expect(muzzleFlashEnvelope(0.5)).toBeCloseTo(1, 10);
    expect(muzzleFlashEnvelope(1)).toBeCloseTo(0, 10);
  });

  it('clamps progress outside [0, 1] rather than reading sin past PI', () => {
    expect(muzzleFlashEnvelope(-1)).toBeCloseTo(0, 10);
    expect(muzzleFlashEnvelope(2)).toBeCloseTo(0, 10);
  });
});

describe('buildMuzzleFlashTemplate', () => {
  it('extracts all three concentric zones by role', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'core', extrasRole: 'core' },
        { nodeName: 'mid', extrasRole: 'mid' },
        { nodeName: 'outer', extrasRole: 'outer' },
      ],
    });
    const template = buildMuzzleFlashTemplate(gltf);
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
    const template = buildMuzzleFlashTemplate(gltf);
    expect(Object.keys(template.geometries).sort()).toEqual(['core', 'mid', 'outer']);
  });

  it('throws loudly for a role outside the closed vocabulary', async () => {
    const gltf = await parseRigidFixture({
      parts: [{ nodeName: 'hull', extrasRole: 'hull' }],
    });
    expect(() => buildMuzzleFlashTemplate(gltf)).toThrow(/no role for mesh/);
  });

  it('throws loudly when a zone is missing entirely, never drawing an incomplete flash', async () => {
    const gltf = await parseRigidFixture({
      parts: [
        { nodeName: 'core', extrasRole: 'core' },
        { nodeName: 'mid', extrasRole: 'mid' },
      ],
    });
    expect(() => buildMuzzleFlashTemplate(gltf)).toThrow(/missing the "outer" zone/);
  });
});

describe('MuzzleFlashManager', () => {
  it('is not ready until load() resolves', () => {
    const mgr = new MuzzleFlashManager();
    expect(mgr.ready).toBe(false);
    mgr.dispose();
  });

  it('spawn() with zero/negative duration is a no-op', () => {
    const mgr = new MuzzleFlashManager();
    mgr.spawn(0, 0, 0, 0, 1, 0);
    mgr.spawn(0, 0, 0, 0, 1, -10);
    expect(mgr.liveCount).toBe(0);
    mgr.dispose();
  });

  it('ages a spawned flash to retirement over its own declared duration', () => {
    const mgr = new MuzzleFlashManager();
    mgr.spawn(1, 2, 3, 0, 1, 170);
    expect(mgr.liveCount).toBe(1);
    mgr.step(100);
    expect(mgr.liveCount).toBe(1);
    mgr.step(100); // 200ms total, past the 170ms duration
    expect(mgr.liveCount).toBe(0);
    mgr.dispose();
  });

  it('never exceeds its own bounded capacity, evicting the oldest first', () => {
    const mgr = new MuzzleFlashManager(4);
    for (let i = 0; i < 10; i++) mgr.spawn(i, 0, 0, 0, 1, 1000);
    expect(mgr.liveCount).toBe(4);
    mgr.dispose();
  });

  it('defaults to MUZZLE_FLASH_CAPACITY when built with no explicit ceiling', () => {
    const mgr = new MuzzleFlashManager();
    for (let i = 0; i < MUZZLE_FLASH_CAPACITY + 5; i++) mgr.spawn(i, 0, 0, 0, 1, 1000);
    expect(mgr.liveCount).toBe(MUZZLE_FLASH_CAPACITY);
    mgr.dispose();
  });

  it('step() is total over an empty pool and over an unloaded (meshes still null) one', () => {
    const mgr = new MuzzleFlashManager();
    expect(() => mgr.step(16)).not.toThrow();
    mgr.spawn(0, 0, 0, 0, 1, 100);
    expect(() => mgr.step(16)).not.toThrow();
    mgr.dispose();
  });

  it('setColors is safe to call before any GLB has loaded', () => {
    const mgr = new MuzzleFlashManager();
    expect(() => mgr.setColors((key) => (key === 'vfx.white_hot' ? '#FFF6D0' : '#FFB43C'))).not.toThrow();
    mgr.dispose();
  });

  it('dispose() on a manager that never loaded does not throw', () => {
    const mgr = new MuzzleFlashManager();
    expect(() => mgr.dispose()).not.toThrow();
  });
});
