import { describe, expect, it } from 'vitest';
import {
  COST_LAYERS,
  FIRST_INFANTRY_SCRIPT,
  READ_TUNING_SCRIPT,
  assertReflectApplied,
  frameLine,
  reflectRunFailed,
  hasArrived,
  nearestWaterTile,
  parseGroundCaptureArgs,
  positionScript,
  reflectName,
  reflectViews,
  roadCloseUp,
  viewsFor,
  wadeCommand,
  wadeOrderScript,
  wadeViews,
} from './ground-captures';

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

// GH-871 P4 T6. Literal rows, literal markers: the oracles do not import their arguments.
describe('--reflect and --wade parsing', () => {
  // The command line the plan names, verbatim.
  const PLAN = [
    '--port=5196',
    '--maps=ein_qasab,wadi_halam_basin,tel_marum',
    '--markers=ein_qasab:causeway_s,ein_qasab:kdf_start,ein_qasab:hamlet',
    '--reflect=0.20,0.25,0.35',
    '--wade=ein_qasab:causeway_s',
    '--out=/Users/ilpinto/dev/roaring-lions-ep/_coord/wet-theme/p4/look1/captures',
  ];
  it('accepts the plan command line, every old option unchanged', () => {
    const a = parseGroundCaptureArgs(PLAN);
    expect(a.port).toBe(5196);
    expect(a.maps).toEqual(['ein_qasab', 'wadi_halam_basin', 'tel_marum']);
    expect(a.out).toBe('/Users/ilpinto/dev/roaring-lions-ep/_coord/wet-theme/p4/look1/captures');
    expect(a.markers).toEqual([
      { map: 'ein_qasab', marker: 'causeway_s' },
      { map: 'ein_qasab', marker: 'kdf_start' },
      { map: 'ein_qasab', marker: 'hamlet' },
    ]);
    expect(a.reflect).toEqual([0.2, 0.25, 0.35]);
    expect(a.wade).toEqual({ map: 'ein_qasab', marker: 'causeway_s' });
  });
  it('is absent without the flags, and a run without them has no extra keys', () => {
    const a = parseGroundCaptureArgs(['--maps=ein_qasab']);
    expect(Object.keys(a).sort()).toEqual(['decals', 'maps', 'out', 'port', 'reuse']);
  });
  it('refuses a reflectance outside 0..1, a repeat, an empty list and a bare --reflect', () => {
    const base = ['--maps=a', '--markers=a:m'];
    expect(() => parseGroundCaptureArgs([...base, '--reflect=1.5'])).toThrow(/0\.\.1/);
    expect(() => parseGroundCaptureArgs([...base, '--reflect=x'])).toThrow(/0\.\.1/);
    expect(() => parseGroundCaptureArgs([...base, '--reflect=0.2,0.20'])).toThrow(/twice/);
    expect(() => parseGroundCaptureArgs([...base, '--reflect='])).toThrow(/at least one/);
    expect(() => parseGroundCaptureArgs(['--maps=a', '--reflect=0.2'])).toThrow(/--markers/);
  });
  it('refuses a malformed --wade and a map the run does not photograph', () => {
    expect(() => parseGroundCaptureArgs(['--maps=a', '--wade=a'])).toThrow(/<map>:<marker>/);
    expect(() => parseGroundCaptureArgs(['--maps=a', '--wade=b:m'])).toThrow(/--wade names map "b"/);
  });
});

describe('reflectViews', () => {
  const rows = Array.from({ length: 48 }, () => '.'.repeat(48));
  const table = { causeway_s: [22, 34], hamlet: [42, 22] } as const;
  it('names a view per marker view and value as <view>-r<v>, and the names are all distinct', () => {
    const views = viewsFor('m', rows, ['causeway_s'], table);
    const extra = reflectViews('m', views, ['causeway_s'], [0.2, 0.25, 0.35]);
    expect(extra.map((v) => v.name)).toEqual([
      'm-causeway_s-z1-r0.2',
      'm-causeway_s-z1-r0.25',
      'm-causeway_s-z1-r0.35',
      'm-causeway_s-z2.5-r0.2',
      'm-causeway_s-z2.5-r0.25',
      'm-causeway_s-z2.5-r0.35',
    ]);
    const all = [...views, ...extra].map((v) => v.name);
    expect(new Set(all).size).toBe(all.length);
    expect(extra.map((v) => v.reflect)).toEqual([0.2, 0.25, 0.35, 0.2, 0.25, 0.35]);
  });
  it('keeps the camera of the view it repeats, and leaves the plain views without a reflectance', () => {
    const views = viewsFor('m', rows, ['hamlet'], table);
    const extra = reflectViews('m', views, ['hamlet'], [0.25]);
    expect(extra[0]).toEqual({ name: 'm-hamlet-z1-r0.25', x: 42, y: 22, zoom: 1, fog: false, reflect: 0.25 });
    expect(views.every((v) => v.reflect === undefined)).toBe(true);
  });
  it('repeats nothing for a marker that was not asked for, or with no values', () => {
    const views = viewsFor('m', rows, ['causeway_s', 'hamlet'], table);
    expect(reflectViews('m', views, ['hamlet'], [0.2]).map((v) => v.name)).toEqual([
      'm-hamlet-z1-r0.2',
      'm-hamlet-z2.5-r0.2',
    ]);
    expect(reflectViews('m', views, ['hamlet'], [])).toEqual([]);
  });
  it('names one reflectance of one view', () => {
    expect(reflectName('m-a-z1', 0.35)).toBe('m-a-z1-r0.35');
  });
});

describe('nearestWaterTile', () => {
  // x is the column, y the row.
  const rows = [
    '.....', //
    '..~..',
    '.....',
    '~....',
    '.....',
  ];
  it('picks the nearest ~ tile by distance', () => {
    expect(nearestWaterTile(rows, [2, 0])).toEqual([2, 1]);
    expect(nearestWaterTile(rows, [0, 4])).toEqual([0, 3]);
  });
  it('breaks a tie to the lowest (y, x)', () => {
    // from (1,2), (2,1) and (0,3) are both at squared distance 2.
    expect(nearestWaterTile(rows, [1, 2])).toEqual([2, 1]);
    // two tiles in one row, equidistant: the lower x wins
    expect(nearestWaterTile(['~...~'], [2, 0])).toEqual([0, 0]);
  });
  it('is null on a map with no ~, and a marker on a ~ tile picks itself', () => {
    expect(nearestWaterTile(['...', '...'], [1, 1])).toBeNull();
    expect(nearestWaterTile(rows, [2, 1])).toEqual([2, 1]);
  });
});

describe('the wade order is a Command, never a state write (invariant 4)', () => {
  it('builds a move Command to the centre of the tile in Q16.16', () => {
    // tile (22, 33): (22.5, 33.5) in tiles is 1474560 and 2195456 in Q16.16
    expect(wadeCommand([7], [22, 33])).toEqual({ kind: 'move', ids: [7], x: 1474560, y: 2195456 });
  });
  it('hands exactly that Command to sim.queueCommand and writes no sim state', () => {
    const queued: unknown[] = [];
    const writes: string[] = [];
    const guard = (name: string): ProxyHandler<object> => ({
      set: (_t, k) => {
        writes.push(`${name}.${String(k)}`);
        return true;
      },
    });
    const sim = new Proxy(
      {
        queueCommand: (c: unknown) => queued.push(c),
        state: new Proxy({ posX: new Proxy([], guard('posX')), alive: [] }, guard('state')),
      },
      guard('sim')
    );
    const cmd = wadeCommand([7], [22, 33]);
    const run = new Function('window', `return ${wadeOrderScript(cmd)};`) as (w: unknown) => unknown;
    expect(run({ __lions: { sim } })).toBe(true);
    expect(queued).toEqual([{ kind: 'move', ids: [7], x: 1474560, y: 2195456 }]);
    expect(writes).toEqual([]);
  });
  it('the reading scripts write nothing either', () => {
    for (const script of [FIRST_INFANTRY_SCRIPT, positionScript(3)]) {
      expect(script).not.toMatch(/queueCommand|posX\[[^\]]*\]\s*=[^=]|posY\[[^\]]*\]\s*=[^=]|\.state\s*=/);
    }
  });
});

describe('wade arrival and views', () => {
  it('has arrived within 1.5 tiles of the tile centre, not beyond', () => {
    expect(hasArrived({ x: 22.5, y: 33.5 }, [22, 33])).toBe(true);
    expect(hasArrived({ x: 23.9, y: 33.5 }, [22, 33])).toBe(true);
    expect(hasArrived({ x: 24.1, y: 33.5 }, [22, 33])).toBe(false);
  });
  it('photographs the tile at z1 and z2.5 under names of their own', () => {
    expect(wadeViews('m', [22, 33])).toEqual([
      { name: 'm-wade-z1', x: 22, y: 33, zoom: 1, fog: false },
      { name: 'm-wade-z2.5', x: 22, y: 33, zoom: 2.5, fog: false },
    ]);
  });
});

// Fix round 1: a wrong private-field name must not read as a dry map.
describe('the tuning read-back (GH-871 P4 T6 fix round 1)', () => {
  const read = (renderer: unknown): unknown =>
    JSON.parse((new Function('window', `return ${READ_TUNING_SCRIPT};`) as (w: unknown) => string)({ __lions: { renderer } }));
  it('reads both reflectances off a wet ground material', () => {
    const groundMat = { uniforms: { uPuddleReflect: { value: 0.25 }, uMarshReflect: { value: 0.2 } } };
    expect(read({ groundMat })).toEqual({ puddle: 0.25, marsh: 0.2 });
  });
  it('reads null, null from a ground material with no wet uniform (a dry map)', () => {
    expect(read({ groundMat: { uniforms: {} } })).toEqual({ puddle: null, marsh: null });
    expect(read({ groundMat: {} })).toEqual({ puddle: null, marsh: null });
  });
  it('THROWS when there is no groundMat at all: that is a changed tree, not a dry map', () => {
    expect(() => read({})).toThrow(/no groundMat: tree changed/);
    expect(() => read({ ground: { uniforms: {} } })).toThrow(/no groundMat/);
  });
  it('a -r frame must read back the reflectance it was asked for', () => {
    const view = { name: 'm-a-z1-r0.35', reflect: 0.35 };
    expect(() => assertReflectApplied(view, { puddle: 0.35, marsh: 0.35 })).not.toThrow();
    expect(() => assertReflectApplied(view, { puddle: 0.25, marsh: 0.35 })).toThrow(/asked for reflectance 0\.35.*puddle=0\.25/);
    expect(() => assertReflectApplied(view, { puddle: 0.35, marsh: null })).toThrow(/marsh=null/);
    expect(() => assertReflectApplied(view, { puddle: null, marsh: null })).toThrow(/puddle=null/);
    // a plain view asks for nothing
    expect(() => assertReflectApplied({ name: 'm-a-z1' }, { puddle: 0.25, marsh: 0.25 })).not.toThrow();
  });
  it('a run that asked for --reflect and took no -r frame has failed', () => {
    expect(reflectRunFailed([0.2, 0.25], 0)).toBe(true);
    expect(reflectRunFailed([0.2, 0.25], 6)).toBe(false);
    expect(reflectRunFailed(undefined, 0)).toBe(false);
  });
});

describe('frameLine', () => {
  const rec = { calls: 12, triangles: 3456, textures: 7, geometries: 9 };
  it('prints the tick, the reflectances and the draw cost', () => {
    expect(frameLine('m-a-z1-r0.2', { ...rec, tick: 0, puddle: 0.2, marsh: 0.2 })).toBe(
      '  m-a-z1-r0.2: tick=0 puddle=0.2 marsh=0.2 calls=12 tris=3456 tex=7 geo=9'
    );
    expect(frameLine('m-wade-z2.5', { ...rec, tick: 380, puddle: 0.25, marsh: 0.25 })).toContain('tick=380 puddle=0.25');
    expect(frameLine('d-centre', { ...rec, tick: 0, puddle: null, marsh: null })).toBe(
      '  d-centre: tick=0 dry calls=12 tris=3456 tex=7 geo=9'
    );
  });
});
