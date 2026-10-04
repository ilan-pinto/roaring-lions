import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { timeOfDayOf } from './time-of-day';

const P = (q: string): URLSearchParams => new URLSearchParams(q);
const MISSIONS = join(__dirname, '../../../data/missions');

describe('timeOfDayOf (R-12, N-23)', () => {
  it('takes a mission\'s authored value', () => {
    expect(timeOfDayOf({ map: { file: 'x', time_of_day: 'dawn' } }, P('')).value).toBe('dawn');
  });
  it('ignores &tod= on a mission (N-23)', () => {
    expect(timeOfDayOf({ map: { file: 'x', time_of_day: 'day' } }, P('tod=dusk')).value).toBe('day');
    expect(timeOfDayOf({ map: { file: 'x' } }, P('tod=dusk')).value).toBe('day');
  });
  it('reads &tod= in the sandbox, and passes night through (the renderer maps it, D10)', () => {
    expect(timeOfDayOf(null, P('sandbox=qarn_hadid&tod=dusk')).value).toBe('dusk');
    expect(timeOfDayOf(null, P('tod=night')).value).toBe('night');
  });
  it('falls back to day with a warning that names a bad value', () => {
    const r = timeOfDayOf(null, P('tod=noon'));
    expect(r.value).toBe('day');
    expect(r.warning).toMatch(/noon/);
    expect(timeOfDayOf(null, P('')).warning).toBeNull();
  });
  // D11 shipped two authored values; GH-382's light rotation (docs/campaign/ground-ladder.md
  // section 10) adds sixteen more so no two consecutive campaign missions share a light.
  // Literals on purpose: this list is the oracle, not a copy of the data.
  it('reads every shipped mission without a warning, and finds exactly the authored values', () => {
    const found: Record<string, string> = {};
    for (const f of readdirSync(MISSIONS).filter((n) => n.endsWith('.json'))) {
      const m = JSON.parse(readFileSync(join(MISSIONS, f), 'utf8')) as { map: { time_of_day?: string } };
      const r = timeOfDayOf(m, P(''));
      expect(r.warning, f).toBeNull();
      if (m.map.time_of_day !== undefined) found[f] = r.value;
    }
    expect(found).toEqual({
      'beit_sahwan_breach.json': 'dawn',
      'beit_sahwan_0_tutorial.json': 'day',
      'beit_sahwan_2_foothold.json': 'dusk',
      'beit_sahwan_4_subterranean.json': 'dusk',
      'khan_rafid_1_recon.json': 'dawn',
      'khan_rafid_3_clearance.json': 'dusk',
      'deir_amun_1_recon.json': 'dawn',
      'deir_amun_2_foothold.json': 'dusk',
      'tel_marum_1_recon.json': 'dusk',
      'tel_marum_3_clearance.json': 'dawn',
      'qarn_hadid_2_foothold.json': 'dusk',
      'qarn_hadid_3_clearance.json': 'dawn',
      'umm_zeitoun_2_buildup.json': 'dusk',
      'umm_zeitoun_3_clearance.json': 'dawn',
      'wadi_halam_1_fords.json': 'dusk',
      'wadi_halam_2_laager.json': 'dawn',
      'wadi_halam_4_village.json': 'dusk',
      'wadi_halam_5_depot.json': 'dawn',
    });
  });
});
