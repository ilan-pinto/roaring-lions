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
  // D11: the mechanism ships with today's two authored values; nothing else changes.
  it('reads every shipped mission without a warning, and finds exactly the two authored values', () => {
    const found: Record<string, string> = {};
    for (const f of readdirSync(MISSIONS).filter((n) => n.endsWith('.json'))) {
      const m = JSON.parse(readFileSync(join(MISSIONS, f), 'utf8')) as { map: { time_of_day?: string } };
      const r = timeOfDayOf(m, P(''));
      expect(r.warning, f).toBeNull();
      if (m.map.time_of_day !== undefined) found[f] = r.value;
    }
    expect(found).toEqual({ 'beit_sahwan_breach.json': 'dawn', 'beit_sahwan_0_tutorial.json': 'day' });
  });
});
