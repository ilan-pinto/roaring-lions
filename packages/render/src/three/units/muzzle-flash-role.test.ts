import { describe, it, expect } from 'vitest';
import { MUZZLE_FLASH_ROLES, isMuzzleFlashRole, muzzleFlashPaletteKey } from './muzzle-flash-role';

describe('muzzle-flash-role', () => {
  it('recognises the closed three-role muzzle-flash vocabulary', () => {
    expect(MUZZLE_FLASH_ROLES).toEqual(['core', 'mid', 'outer']);
    for (const role of MUZZLE_FLASH_ROLES) expect(isMuzzleFlashRole(role)).toBe(true);
    expect(isMuzzleFlashRole('hull')).toBe(false); // a vehicle role, not this class's
    expect(isMuzzleFlashRole('uniform')).toBe(false); // an infantry role, not this class's
    expect(isMuzzleFlashRole('bogus')).toBe(false);
  });

  it('maps each zone to exactly one reserved vfx palette key, hottest at the core', () => {
    expect(muzzleFlashPaletteKey('core')).toBe('vfx.white_hot');
    expect(muzzleFlashPaletteKey('mid')).toBe('vfx.fire');
    expect(muzzleFlashPaletteKey('outer')).toBe('vfx.ember');
  });

  it('every key is a palette reference (band.name), never raw hex', () => {
    for (const role of MUZZLE_FLASH_ROLES) {
      expect(muzzleFlashPaletteKey(role)).toMatch(/^[a-z_]+\.[a-z0-9_]+$/);
    }
  });
});
