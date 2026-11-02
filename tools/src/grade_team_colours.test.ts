// Look uplift L2 (GH-943): the `grade-team-colours` gate (spec section 8). See grade_team_colours.ts for the rule.
import { describe, expect, it } from 'vitest';
import { FLOOR, gradesOnDisk, teamColourFailures, TEAM_SETS, worstPair } from './grade_team_colours';
import type { GradeJson } from '../../packages/render/src/three/grade-maths';

/** A grade built to collapse the team colours: a heavy single-hue split tone, amber over shadows AND highlights,
 *  with the lift and gain leaning the same way. Not a shipped file; the gate must refuse it. */
const SINGLE_HUE: GradeJson = {
  id: 'single_hue',
  lift: { tint: 'dust.0', amount: 0.2, level: 0 },
  gamma: { tint: 'dust.0', amount: 0, value: 1 },
  gain: { tint: 'dust.0', amount: 0.3, value: 1 },
  saturation: 1,
  warmth: 0,
  split_tone: { shadows: { tint: 'dust.0', amount: 0.15 }, highlights: { tint: 'dust.0', amount: 0.15 }, balance: 0 },
};

describe('grade-team-colours: every grade on disk keeps the team colours apart', () => {
  const grades = gradesOnDisk();

  it('finds the shipped grades (a gate that loops over nothing passes vacuously)', () => {
    expect(grades.map((g) => g.id)).toEqual(expect.arrayContaining(['dawn', 'dusk']));
    expect(TEAM_SETS.map((s) => s.name)).toEqual(['default', 'deuteranopia', 'protanopia', 'tritanopia']);
  });

  for (const strength of [1, 1.5]) {
    // 1 is the file as authored. 1.5 is the strongest column of the L2 mock sheet: a lead who picks it
    // would author those values, so the mock may not offer a column the gate would refuse.
    it(`each shipped grade at strength ${strength} stays above the floor`, () => {
      for (const grade of grades) expect(teamColourFailures(grade, strength), grade.id).toEqual([]);
    });
  }

  it('measures real separations: the ungraded default worst pair is far above the floor, a shaded deuteranopia pair is under it', () => {
    const id = (c: readonly [number, number, number]) => c;
    expect(worstPair(TEAM_SETS[0], 1, id).delta).toBeGreaterThan(FLOOR * 2);
    expect(worstPair(TEAM_SETS[1], 0.5, id).delta).toBeLessThan(FLOOR);
  });

  it('REFUSES a grade with a heavy single-hue split tone (the falsifier: it can fail)', () => {
    const failures = teamColourFailures(SINGLE_HUE);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toMatch(/falls to delta E/);
  });

  it('REFUSES a grade that desaturates the frame away, under every set', () => {
    const grey: GradeJson = { ...SINGLE_HUE, id: 'grey', lift: { ...SINGLE_HUE.lift, amount: 0 }, gain: { ...SINGLE_HUE.gain, amount: 0 }, split_tone: { ...SINGLE_HUE.split_tone, shadows: { tint: 'dust.0', amount: 0 }, highlights: { tint: 'dust.0', amount: 0 } }, saturation: 0.15 };
    const failures = teamColourFailures(grey);
    for (const set of TEAM_SETS) expect(failures.some((f) => f.includes(` ${set.name} `)), set.name).toBe(true);
  });
});
