// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import { missingKeys, setCatalogue } from '../i18n/t';
import { versusModes } from '@lions/data';
import { payRange, pointsExplainer } from './points-explainer';
import { NetPoints, payZoneOf } from './net-points';
import { pointsViewOf } from '../net/points-view';

afterEach(() => { setCatalogue('en', en); document.body.replaceChildren(); });

const real = versusModes['wadi_tarfan_l']!.modes.points!;

describe('pointsExplainer (GH-1103)', () => {
  it('reads wadi_tarfan_l: first to 600, 10 to 40 a minute, 1 per 100 value', () => {
    expect(pointsExplainer(real)).toBe(
      'First to 600. Hold a zone alone to earn its points every minute (10 to 40 a minute). Destroying enemy units adds 1 for every 100 of their value.'
    );
    expect(missingKeys()).toEqual([]);
  });
  it('is built from the data: another target, pay and kill rate change the text', () => {
    const text = pointsExplainer({ zones: [{ per_min: 15 }], per_value_destroyed: 3, target: 900 });
    expect(text).toContain('First to 900.');
    expect(text).toContain('(15 a minute)');
    expect(text).toContain('adds 3 for every 100');
  });
  it('drops the kill sentence when kills pay nothing', () => {
    expect(pointsExplainer({ zones: [{ per_min: 5 }], per_value_destroyed: 0, target: 100 })).not.toContain('Destroying');
  });
  it('payRange spans the min and max', () => {
    expect(payRange([{ per_min: 20 }, { per_min: 40 }, { per_min: 10 }])).toBe('10 to 40 a minute');
  });
});

describe('the points HUD at match start (GH-1103)', () => {
  const rules = { zones: [{ zone: 'a', per_min: 30 }, { zone: 'b', per_min: 10 }], target: 600 };
  const rt = (scores: [number, number], a: number, b: number) => ({
    scoreOf: (s: 0 | 1) => scores[s],
    incomeZones: [
      { zone: 'a', rect: [0, 0, 4, 4], state: a, holder: a },
      { zone: 'b', rect: [8, 8, 4, 4], state: b, holder: b },
    ],
  });
  const explainText = () => document.querySelector<HTMLElement>('.rl-net-points__explain')!;

  it('shows the line while nobody has scored, then hides it', () => {
    const p = new NetPoints(document.body, { theirs: 'Raven' }, 'EXPLAIN');
    p.update(pointsViewOf(rt([0, 0], -1, -1), rules, 0));
    expect(explainText().hidden).toBe(false);
    expect(explainText().textContent).toBe('EXPLAIN');
    p.update(pointsViewOf(rt([1, 0], 0, -1), rules, 0));
    expect(explainText().hidden).toBe(true);
  });
  it('the rate sums only the zones you hold alone', () => {
    const p = new NetPoints(document.body, { theirs: 'Raven' });
    // a: mine alone (30); b: contested (-2) pays nobody.
    p.update(pointsViewOf(rt([5, 5], 0, -2), rules, 0));
    expect(document.querySelector('[data-row=mine] .rl-net-points__rate')!.textContent).toBe('+30 a minute');
    expect(document.querySelector('[data-row=theirs] .rl-net-points__rate')!.textContent).toBe('+0 a minute');
  });
  it('maps a held zone for the minimap', () => {
    const v = pointsViewOf(rt([0, 0], 0, 1), rules, 0);
    expect(v.zones.map(payZoneOf).map((z) => z.state)).toEqual(['held', 'target']);
  });
});
