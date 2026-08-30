import { describe, it, expect } from 'vitest';
import { SMOKE_PLUME_ROLES, isSmokePlumeRole, smokePlumePaletteKey } from './smoke-plume-role';

describe('smoke-plume-role', () => {
  it('recognises the closed three-role smoke-plume vocabulary', () => {
    expect(SMOKE_PLUME_ROLES).toEqual(['base', 'mid', 'top']);
    for (const role of SMOKE_PLUME_ROLES) expect(isSmokePlumeRole(role)).toBe(true);
    expect(isSmokePlumeRole('core')).toBe(false); // the OTHER vfx-mesh vocabulary, not this one
    expect(isSmokePlumeRole('outer')).toBe(false);
    expect(isSmokePlumeRole('hull')).toBe(false); // a vehicle role, not this class's
    expect(isSmokePlumeRole('bogus')).toBe(false);
  });

  it('maps each zone to a gunmetal ramp entry, darkest (densest) at the base, lightest (thinnest) at the top', () => {
    expect(smokePlumePaletteKey('base')).toBe('gunmetal.3');
    expect(smokePlumePaletteKey('mid')).toBe('gunmetal.2');
    expect(smokePlumePaletteKey('top')).toBe('gunmetal.0');
  });

  it('never resolves to the reserved vfx band -- smoke is not a saturated hot-effect colour', () => {
    for (const role of SMOKE_PLUME_ROLES) {
      expect(smokePlumePaletteKey(role)).not.toMatch(/^vfx\./);
    }
  });

  it('every key is a palette reference (band.name), never raw hex', () => {
    for (const role of SMOKE_PLUME_ROLES) {
      expect(smokePlumePaletteKey(role)).toMatch(/^[a-z_]+\.[a-z0-9_]+$/);
    }
  });

  it('does NOT share its vocabulary with the incandescent vfx-mesh classes -- the geometry relationship differs, not just the names', async () => {
    const muzzle = await import('./muzzle-flash-role');
    const burst = await import('./explosion-burst-role');
    expect(SMOKE_PLUME_ROLES).not.toEqual(muzzle.MUZZLE_FLASH_ROLES);
    expect(SMOKE_PLUME_ROLES).not.toEqual(burst.EXPLOSION_BURST_ROLES);
  });
});
