import { describe, expect, it } from 'vitest';
import { trackCloseup, type CloseupCatalogue } from './garage-closeup';

describe('trackCloseup (GH-238 K11)', () => {
  const cat = (files: string[]): CloseupCatalogue => ({
    entries: { mbt_lavi_armour: { file: 'mbt_lavi_armour.jpg', unit: 'mbt_lavi', track: 'armour' } },
    files: new Set(files),
  });

  it('resolves a named pair whose file is on disk', () => {
    expect(trackCloseup('/ui/garage/closeups/', 'mbt_lavi', 'armour', cat(['mbt_lavi_armour.jpg']))).toBe(
      '/ui/garage/closeups/mbt_lavi_armour.jpg'
    );
    expect(trackCloseup('/ui/garage/closeups', 'mbt_lavi', 'armour', cat(['mbt_lavi_armour.jpg']))).toBe(
      '/ui/garage/closeups/mbt_lavi_armour.jpg'
    );
  });

  it('is null for a pair the manifest never names, or whose file is missing', () => {
    expect(trackCloseup('/c/', 'mbt_lavi', 'sensors', cat(['mbt_lavi_armour.jpg']))).toBeNull();
    expect(trackCloseup('/c/', 'mbt_lavi', 'armour', cat([]))).toBeNull();
  });

  it('reads the shipped set by default', () => {
    expect(trackCloseup('/c/', 'mbt_lavi', 'armour')).toBe('/c/mbt_lavi_armour.jpg');
    expect(trackCloseup('/c/', 'inf_squad', 'sensors')).toBe('/c/inf_squad_sensors.jpg');
    // The D9 declares no firepower track, so it has no close-up for one.
    expect(trackCloseup('/c/', 'dozer_d9', 'firepower')).toBeNull();
  });
});
