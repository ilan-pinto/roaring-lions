import { describe, expect, it } from 'vitest';
import { COST_LAYERS, parseGroundCaptureArgs, roadCloseUp, viewsFor } from './ground-captures';

describe('parseGroundCaptureArgs', () => {
  it('defaults to port 5196 and the four audit maps', () => {
    const a = parseGroundCaptureArgs([]);
    expect(a.port).toBe(5196);
    expect(a.maps).toEqual(['beit_sahwan_outskirts', 'tel_marum', 'qarn_hadid', 'wadi_halam_basin']);
    expect(a.decals).toBe(false);
  });
  it('takes --port, --out, --maps, --decals and --reuse', () => {
    const a = parseGroundCaptureArgs(['--port=5194', '--out=x/y', '--maps=qarn_hadid', '--decals']);
    expect(a).toEqual({ port: 5194, out: 'x/y', maps: ['qarn_hadid'], decals: true, reuse: false });
    expect(parseGroundCaptureArgs(['--reuse']).reuse).toBe(true);
  });
  it('takes a comma list of maps', () => {
    const a = parseGroundCaptureArgs(['--maps=tel_marum,qarn_hadid']);
    expect(a.maps).toEqual(['tel_marum', 'qarn_hadid']);
  });
  // The lead's server is 5177 and the tools own 5173-5182. A run that reuses
  // one of them measures another tree.
  it('refuses a port outside 5193-5199', () => {
    expect(() => parseGroundCaptureArgs(['--port=5177'])).toThrow(/5193-5199/);
    expect(() => parseGroundCaptureArgs(['--port=abc'])).toThrow(/5193-5199/);
  });
});

describe('roadCloseUp', () => {
  // The audit's rule: most road tiles within Chebyshev distance 3, ties by (y, x).
  // (3,2) sees all five of the run plus the stray at (0,0); nothing else sees six.
  it('picks the road tile with the most road inside radius 3', () => {
    const rows = ['r........', '.........', '..rrrrr..'];
    expect(roadCloseUp(rows)).toEqual([3, 2]);
  });
  it('is null on a map with no road', () => {
    expect(roadCloseUp(['...', '...'])).toBeNull();
  });
});

describe('viewsFor', () => {
  // F-16: the 0.5 view is added alongside 0.35, 1 and 2.5 because Task 5
  // measures on `centre-z0.5` -- this replaces the spec's original
  // three-zoom expectation.
  it('frames the centre at 0.35, 0.5, 1 and 2.5, one fogged view, and a road close-up', () => {
    const rows = Array.from({ length: 48 }, (_, y) => (y === 20 ? 'r'.repeat(48) : '.'.repeat(48)));
    const names = viewsFor('m', rows).map((v) => v.name);
    expect(names).toEqual([
      'm-centre-z0.35-nofog',
      'm-centre-z0.5-nofog',
      'm-centre-z1-nofog',
      'm-centre-z2.5-nofog',
      'm-centre-z1-fog',
      'm-road-z2.5-nofog',
    ]);
    const road = viewsFor('m', rows).find((v) => v.name.includes('road'));
    expect(road?.y).toBe(20);
  });
  it('omits the road view on a map with no road', () => {
    const rows = Array.from({ length: 4 }, () => '....');
    const names = viewsFor('m', rows).map((v) => v.name);
    expect(names.some((n) => n.includes('road'))).toBe(false);
  });
});

describe('COST_LAYERS', () => {
  it('measures decals ahead of scorch, so the one array reads both trees', () => {
    expect(COST_LAYERS).toEqual(['scatter', 'decor', 'units', 'buildings', 'decals', 'scorch']);
  });
});
