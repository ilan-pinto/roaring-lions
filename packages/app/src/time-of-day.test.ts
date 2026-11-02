import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GradeJson } from '@lions/render';
import { gradeOf, GRADE_ON_BY_DEFAULT, lightOverrideOf, timeOfDayOf } from './time-of-day';

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

// PA-24 (lead ruling L3, 9 Oct): First Light alone lifts its dawn fill and
// softens its sun's shadow, through an optional `map.light` block. The
// `dawn` preset itself is untouched.
describe('lightOverrideOf (PA-24)', () => {
  it("takes a mission's authored light, and nothing when it has none", () => {
    expect(lightOverrideOf({ map: { file: 'x', light: { fill: 0.9, shadow: 0.7 } } })).toEqual({ fill: 0.9, shadow: 0.7 });
    expect(lightOverrideOf({ map: { file: 'x', light: { fill: 1.1 } } })).toEqual({ fill: 1.1 });
    expect(lightOverrideOf({ map: { file: 'x', time_of_day: 'dawn' } })).toBeUndefined();
    expect(lightOverrideOf(null)).toBeUndefined();
  });
  // Literals on purpose: the oracle is this line, not the data.
  it('is authored on beit_sahwan_breach alone, at fill 0.9 and shadow 0.7', () => {
    const lit: Record<string, unknown> = {};
    for (const f of readdirSync(MISSIONS).filter((n) => n.endsWith('.json'))) {
      const m = JSON.parse(readFileSync(join(MISSIONS, f), 'utf8')) as { id: string; map: object };
      const o = lightOverrideOf(m);
      if (o !== undefined) lit[m.id] = o;
    }
    expect(lit).toEqual({ beit_sahwan_breach: { fill: 0.9, shadow: 0.7 } });
  });
});

// Look uplift L2 (GH-943): `gradeOf`.
describe('gradeOf', () => {
  const g = (id: string): GradeJson => ({ id }) as unknown as GradeJson;
  const grades = [g('dawn'), g('dusk')];
  const q = (s: string): URLSearchParams => new URLSearchParams(s);

  it('is OFF by default while the lead judges the mock, and the constant says so', () => {
    expect(GRADE_ON_BY_DEFAULT).toBe(false);
    expect(gradeOf(null, q(''), 'dusk', grades).grade).toBeNull();
    expect(gradeOf(null, q('tod=dusk'), 'dusk', grades).grade).toBeNull();
  });

  it('`&grade=0|off|false` is always off, even over a mission that authors one', () => {
    for (const v of ['0', 'off', 'false']) {
      expect(gradeOf(null, q(`grade=${v}`), 'dusk', grades).grade).toBeNull();
      expect(gradeOf({ map: { grade: 'dusk' } }, q(`grade=${v}`), 'dusk', grades).grade).toBeNull();
    }
  });

  it('auto (bare, =auto, =1) is the time of day\'s grade, night is dusk, and DAY IS THE IDENTITY (no file)', () => {
    for (const v of ['grade', 'grade=auto', 'grade=1']) {
      expect(gradeOf(null, q(v), 'dawn', grades).grade?.id).toBe('dawn');
      expect(gradeOf(null, q(v), 'dusk', grades).grade?.id).toBe('dusk');
      expect(gradeOf(null, q(v), 'night', grades).grade?.id).toBe('dusk');
      expect(gradeOf(null, q(v), 'day', grades).grade).toBeNull();
    }
  });

  it('names a grade, with an optional strength 0..2', () => {
    const c = gradeOf(null, q('grade=dusk:0.5'), 'day', grades);
    expect(c.grade?.id).toBe('dusk');
    expect(c.strength).toBe(0.5);
    expect(c.warning).toBeNull();
    expect(gradeOf(null, q('grade=dawn'), 'dusk', grades).strength).toBe(1);
    expect(gradeOf(null, q('grade=dawn:2'), 'dusk', grades).strength).toBe(2);
  });

  it('warns on an unknown id or a bad strength, and draws ungraded / strength 1', () => {
    const unknown = gradeOf(null, q('grade=noon'), 'day', grades);
    expect(unknown.grade).toBeNull();
    expect(unknown.warning).toMatch(/unknown &grade "noon"/);
    for (const bad of ['dusk:3', 'dusk:-1', 'dusk:x', 'dusk:']) {
      const c = gradeOf(null, q(`grade=${bad}`), 'day', grades);
      expect(c.strength, bad).toBe(1);
      expect(c.warning, bad).toMatch(/strength/);
      expect(c.grade?.id, bad).toBe('dusk');
    }
  });

  it('a mission\'s authored map.grade wins over the flag\'s id, and needs the flag present while it is off by default', () => {
    expect(gradeOf({ map: { grade: 'dawn' } }, q('grade=dusk'), 'dusk', grades).grade?.id).toBe('dawn');
    expect(gradeOf({ map: { grade: 'dawn' } }, q(''), 'dusk', grades).grade).toBeNull();
    expect(gradeOf({ map: { grade: 'nope' } }, q('grade'), 'dusk', grades).warning).toMatch(/unknown &grade "nope"/);
  });
});
