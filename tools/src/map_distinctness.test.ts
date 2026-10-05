// GH-382: every campaign mission is played on its own ground. See map_distinctness.ts for the
// metric (feature identity over all eight orientations, plus elevation); there is no allowlist.
import { describe, expect, it } from 'vitest';
import {
  FEATURE_GATE,
  allPairs,
  campaignMissions,
  compare,
  orientations,
  report,
  tooAlike,
  type GridMap,
} from './map_distinctness';

const mk = (rows: string[], elevation?: string[]): GridMap => ({
  id: 'x',
  width: rows[0].length,
  height: rows.length,
  rows,
  elevation,
});

const SAMPLE = ['..h.......', '..h..oo...', '.......b..', '1111......', '.....rrrrr', '..........', '.mmm......', '.mmm..#...', '..........', '.........f'];

describe('map distinctness', () => {
  it('every pair of missions is distinct: the gate holds the whole campaign, with no allowlist', () => {
    const rows = allPairs(campaignMissions());
    const bad = rows.filter((r) => r.fails);
    expect(report(bad)).toBe('');
    expect(bad).toEqual([]);
  });

  it('there is nothing to excuse: two towns, or one, playing on one map file both fail', () => {
    const copy = (mission: string, town: string) => ({ mission, town, map: 'qarn_hadid_2' });
    expect(allPairs([copy('a', 'x'), copy('b', 'y')]).every((r) => r.fails)).toBe(true);
    expect(allPairs([copy('a', 'x'), copy('b', 'x')]).every((r) => r.fails)).toBe(true);
  });

  describe('falsification: the check goes red on copies', () => {
    it('an identical copy reads 100% and fails', () => {
      const c = compare(mk(SAMPLE), mk(SAMPLE));
      expect(c.feature).toBe(1);
      expect(tooAlike(c)).toBe(true);
    });
    it('a mirrored copy still fails', () => {
      const mirrored = SAMPLE.map((r) => [...r].reverse().join(''));
      const c = compare(mk(SAMPLE), mk(mirrored));
      expect(c.feature).toBe(1);
      expect(tooAlike(c)).toBe(true);
    });
    it('every rotation of a copy fails', () => {
      for (const g of orientations(SAMPLE.map((r) => [...r]))) {
        const c = compare(mk(SAMPLE), mk(g.map((r) => r.join(''))));
        expect(c.feature, 'an orientation of the same map must read 100%').toBe(1);
      }
    });
    it('a flat copy of a relief map fails on elevation even with the features moved', () => {
      const relief = SAMPLE.map(() => '0101010101');
      const shifted = SAMPLE.map((r) => r.replace(/[^.]/g, '.'));
      const other = [...shifted];
      other[0] = 'hhhhhhhhhh';
      const c = compare(mk(SAMPLE, relief), mk(other, SAMPLE.map(() => '0000000000')));
      expect(c.feature).toBeLessThanOrEqual(FEATURE_GATE);
      expect(c.elevationWithin).not.toBeNull();
      expect(tooAlike(c)).toBe(true);
    });
    it('two genuinely different maps pass', () => {
      const other = ['.........#', '..........', '..ooo.....', '..ooo..1..', '..........', '=====.....', '..........', '.....mm...', '.....mm...', '..........'];
      expect(tooAlike(compare(mk(SAMPLE), mk(other)))).toBe(false);
    });
    it('a map with no elevation grid is not compared on elevation', () => {
      expect(compare(mk(SAMPLE, SAMPLE.map(() => '0000000000')), mk(SAMPLE)).elevationWithin).toBeNull();
    });
  });
});
