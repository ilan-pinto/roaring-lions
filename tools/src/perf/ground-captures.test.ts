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

describe('--markers', () => {
  it('parses <map>:<marker> pairs, and is absent without the flag', () => {
    const a = parseGroundCaptureArgs(['--maps=ein_qasab,tel_marum', '--markers=ein_qasab:kdf_start,tel_marum:saddle']);
    expect(a.markers).toEqual([
      { map: 'ein_qasab', marker: 'kdf_start' },
      { map: 'tel_marum', marker: 'saddle' },
    ]);
    expect(parseGroundCaptureArgs(['--maps=ein_qasab']).markers).toBeUndefined();
  });
  it('refuses a malformed pair and a map the run does not photograph', () => {
    expect(() => parseGroundCaptureArgs(['--maps=a', '--markers=a'])).toThrow(/<map>:<marker>/);
    expect(() => parseGroundCaptureArgs(['--maps=a', '--markers=b:m'])).toThrow(/map "b"/);
  });
  const rows = Array.from({ length: 48 }, () => '.'.repeat(48));
  const table = { kdf_start: [4, 44], hamlet: [42, 22] } as const;
  it('appends a z1 and a z2.5 no-fog view per named marker, centred on its tile', () => {
    const base = viewsFor('m', rows);
    const views = viewsFor('m', rows, ['kdf_start'], table);
    expect(views.slice(0, base.length)).toEqual(base);
    expect(views.slice(base.length)).toEqual([
      { name: 'm-kdf_start-z1', x: 4, y: 44, zoom: 1, fog: false },
      { name: 'm-kdf_start-z2.5', x: 4, y: 44, zoom: 2.5, fog: false },
    ]);
  });
  it('names the marker and the map when the marker does not exist', () => {
    expect(() => viewsFor('m', rows, ['causeway_x'], table)).toThrow(/map "m" has no marker "causeway_x"/);
    // inherited keys are not markers
    expect(() => viewsFor('m', rows, ['toString'], table)).toThrow(/no marker "toString"/);
  });
});

describe('COST_LAYERS', () => {
  it('measures decals ahead of scorch, so the one array reads both trees', () => {
    expect(COST_LAYERS).toEqual(['scatter', 'decor', 'props', 'units', 'buildings', 'decals', 'scorch']);
  });
});
