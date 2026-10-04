// GH-382: every campaign mission is played on its own ground. See map_distinctness.ts for the
// metric (feature identity over all eight orientations, plus elevation) and the allowlist.
import { describe, expect, it } from 'vitest';
import {
  FEATURE_GATE,
  PENDING_ARCS,
  allPairs,
  campaignMissions,
  compare,
  excused,
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
  it('every pair of missions is distinct, except the arcs still pending under #382', () => {
    const rows = allPairs(campaignMissions());
    const bad = rows.filter((r) => r.fails && !excused(r));
    expect(report(bad)).toBe('');
    expect(bad).toEqual([]);
  });

  it('names its pending arcs, each pointing at #382, and none of them is Wadi Halam', () => {
    expect(PENDING_ARCS.length).toBeGreaterThan(0);
    for (const p of PENDING_ARCS) expect(p.todo).toMatch(/#382/);
    expect(PENDING_ARCS.map((p) => p.town)).not.toContain('wadi_halam');
  });

  it('holds every pending arc to what it fails today (an arc that now passes must leave the list)', () => {
    const rows = allPairs(campaignMissions());
    for (const p of PENDING_ARCS) {
      const mine = rows.filter((r) => r.a.town === p.town && r.b.town === p.town);
      // one-mission towns have no pair; every other pending town must still be failing
      if (mine.length > 0) expect(mine.some((r) => r.fails), `${p.town} passes now: remove it from PENDING_ARCS`).toBe(true);
    }
  });

  it('a pair across two towns is never excused', () => {
    const rows = allPairs(campaignMissions());
    for (const r of rows.filter((x) => x.a.town !== x.b.town)) expect(excused(r)).toBe(false);
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
