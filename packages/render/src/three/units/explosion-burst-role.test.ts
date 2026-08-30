import { describe, it, expect } from 'vitest';
import { EXPLOSION_BURST_ROLES, isExplosionBurstRole, explosionBurstPaletteKey } from './explosion-burst-role';

describe('explosion-burst-role', () => {
  it('recognises the closed three-role explosion-burst vocabulary', () => {
    expect(EXPLOSION_BURST_ROLES).toEqual(['core', 'mid', 'outer']);
    for (const role of EXPLOSION_BURST_ROLES) expect(isExplosionBurstRole(role)).toBe(true);
    expect(isExplosionBurstRole('hull')).toBe(false); // a vehicle role, not this class's
    expect(isExplosionBurstRole('uniform')).toBe(false); // an infantry role, not this class's
    expect(isExplosionBurstRole('bogus')).toBe(false);
  });

  it('maps each zone to exactly one reserved vfx palette key, hottest at the core', () => {
    expect(explosionBurstPaletteKey('core')).toBe('vfx.white_hot');
    expect(explosionBurstPaletteKey('mid')).toBe('vfx.fire');
    expect(explosionBurstPaletteKey('outer')).toBe('vfx.ember');
  });

  it('every key is a palette reference (band.name), never raw hex', () => {
    for (const role of EXPLOSION_BURST_ROLES) {
      expect(explosionBurstPaletteKey(role)).toMatch(/^[a-z_]+\.[a-z0-9_]+$/);
    }
  });

  it('shares its vocabulary with the muzzle flash -- both asset classes read the same colours', async () => {
    const muzzle = await import('./muzzle-flash-role');
    expect(EXPLOSION_BURST_ROLES).toEqual(muzzle.MUZZLE_FLASH_ROLES);
    for (const role of EXPLOSION_BURST_ROLES) {
      expect(explosionBurstPaletteKey(role)).toBe(muzzle.muzzleFlashPaletteKey(role));
    }
  });
});
