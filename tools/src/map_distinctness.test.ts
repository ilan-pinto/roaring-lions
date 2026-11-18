// GH-382: every campaign mission is played on its own ground. See map_distinctness.ts for the
// metric (feature identity over all eight orientations, plus elevation). The only excuse is the NAMED_EXCEPTIONS list (one entry,
// lead's ruling 17 Nov 2026), with a demotion assertion below.
import { describe, expect, it } from 'vitest';
import {
  FEATURE_GATE,
  NAMED_EXCEPTIONS,
  allPairs,
  campaignMissions,
  compare,
  isNamedException,
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
  it('every pair of missions is distinct: the gate holds the whole campaign, but for the named exceptions', () => {
    const rows = allPairs(campaignMissions());
    const bad = rows.filter((r) => r.fails);
    expect(report(bad)).toBe('');
    expect(bad).toEqual([]);
  });

  it('the named exceptions are needed, real and closed: each excused pair is still alike, each id is a campaign mission, and only those pairs are excused', () => {
    const rows = allPairs(campaignMissions());
    const ids = new Set(campaignMissions().map((m) => m.mission));
    expect(NAMED_EXCEPTIONS.length).toBe(1);
    for (const e of NAMED_EXCEPTIONS) {
      expect(e.reason.length, 'a reason').toBeGreaterThan(20);
      for (const m of e.missions) expect(ids.has(m), `${m} is a campaign mission`).toBe(true);
    }
    const excused = rows.filter((r) => r.excused);
    // Demotion: an entry that stops being needed (its maps diverge) reads here as a pair that is not alike any more.
    expect(excused.map((r) => `${r.a.mission}~${r.b.mission}`)).toEqual([
      'bir_tarsha_1_recon~bir_tarsha_2_foothold',
      'bir_tarsha_1_recon~bir_tarsha_3_clearance',
      'bir_tarsha_2_foothold~bir_tarsha_3_clearance',
    ]);
    for (const e of NAMED_EXCEPTIONS)
      for (const a of e.missions)
        for (const b of e.missions)
          if (a < b) {
            const r = rows.find((x) => (x.a.mission === a && x.b.mission === b) || (x.a.mission === b && x.b.mission === a));
            expect(r, `${a} ~ ${b} is a pair of the campaign`).toBeDefined();
            expect(r?.excused, `${a} ~ ${b} is still alike, so the exception is still needed (delete the entry when the maps diverge)`).toBe(true);
          }
    // Closed: a pair with one id named and one not is not excused, and a mission is never excused against itself.
    expect(isNamedException('bir_tarsha_1_recon', 'qarn_hadid_2_foothold')).toBe(false);
    expect(isNamedException('bir_tarsha_1_recon', 'bir_tarsha_1_recon')).toBe(false);
  });

  it('there is nothing else to excuse: two towns, or one, playing on one map file both fail', () => {
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
    it('a flat copy of a relief map still fails: same features, grid stripped to zeros (GH-161)', () => {
      const crest = SAMPLE.map((_, y) => (y >= 2 && y <= 7 ? '0000022000' : '0000000000'));
      const c = compare(mk(SAMPLE, crest), mk(SAMPLE, SAMPLE.map(() => '0000000000')));
      expect(c.feature).toBe(1);
      expect(tooAlike(c)).toBe(true);
    });
    it('a flat copy of a gentle relief map fails on elevation alone, with the features moved (GH-161)', () => {
      // A 1-level terrace is within one level of flat everywhere it stands: the counted tiles are all alike.
      const terrace = SAMPLE.map((_, y) => (y >= 2 && y <= 7 ? '0000011000' : '0000000000'));
      const other = SAMPLE.map((r) => r.replace(/[^.]/g, '.'));
      other[0] = 'hhhhhhhhhh';
      const c = compare(mk(SAMPLE, terrace), mk(other, SAMPLE.map(() => '0000000000')));
      expect(c.feature).toBeLessThanOrEqual(FEATURE_GATE);
      expect(c.elevationWithin).toBe(1);
      expect(tooAlike(c)).toBe(true);
    });
    it('the same crest on the same tiles fails on elevation, with the features moved (GH-161)', () => {
      const crest = SAMPLE.map((_, y) => (y >= 2 && y <= 7 ? '0000022000' : '0000000000'));
      const other = SAMPLE.map((r) => r.replace(/[^.]/g, '.'));
      other[0] = 'hhhhhhhhhh';
      const c = compare(mk(SAMPLE, crest), mk(other, crest));
      expect(c.feature).toBeLessThanOrEqual(FEATURE_GATE);
      expect(c.elevationWithin).toBe(1);
      expect(tooAlike(c)).toBe(true);
    });
    it('two different sparse reliefs pass: the flat tiles no longer vouch for each other (GH-161)', () => {
      // Each grid is 94% zeros, so over ALL tiles they sit within one level on 88% of them. Their crests
      // stand in different places, so over the tiles where either is raised they agree on none.
      const a = SAMPLE.map((_, y) => (y >= 2 && y <= 4 ? '0000022000' : '0000000000'));
      const b = SAMPLE.map((_, y) => (y >= 6 && y <= 8 ? '0220000000' : '0000000000'));
      const other = SAMPLE.map((r) => r.replace(/[^.]/g, '.'));
      other[0] = 'hhhhhhhhhh';
      const c = compare(mk(SAMPLE, a), mk(other, b));
      expect(c.feature).toBeLessThanOrEqual(FEATURE_GATE);
      expect(c.elevationWithin).not.toBeNull();
      expect(c.elevationWithin ?? 1).toBeLessThan(0.2);
      expect(tooAlike(c)).toBe(false);
    });
    it('two all-zero grids have nothing to tell them apart and still read as alike (GH-161)', () => {
      const other = SAMPLE.map((r) => r.replace(/[^.]/g, '.'));
      other[0] = 'hhhhhhhhhh';
      const c = compare(mk(SAMPLE, SAMPLE.map(() => '0000000000')), mk(other, SAMPLE.map(() => '0000000000')));
      expect(c.elevationWithin).toBe(1);
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
