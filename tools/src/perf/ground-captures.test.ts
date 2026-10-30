import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../../../packages/render/src/quality';
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
  stopOrderScript,
  viewsFor,
  wadeCommand,
  wadeOrderScript,
  wadeViews,
} from './ground-captures';
import {
  EXPECTED_RAIN_DROPS,
  NameClaims,
  READ_RAIN_HEIGHTS_SCRIPT,
  READ_RENDER_SCRIPT,
  assertMotion,
  assertPresetBooted,
  halfToFloat,
  makeHeightSampler,
  onScreenDropCount,
  planPasses,
  rainLabel,
  requestedModeFailures,
  squadScreenScript,
  stopName,
  stopTile,
  suffixedViews,
  tickName,
  type RenderRead,
} from './ground-captures-plan';

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

// ============================================================================
// GH-871 P4 T12: the S-L2 options. Literal grids, literal numbers: the oracles import nothing.
// ============================================================================

const T12_LINE = [
  '--port=5196',
  '--maps=ein_qasab',
  '--markers=ein_qasab:causeway_s,ein_qasab:kdf_start,ein_qasab:hamlet',
  '--zooms=1,1.6,2.5',
  '--quality=high,medium,low',
  '--ticks=6',
  '--motion=reduce',
  '--clip=5',
  '--stops=road,water,grass',
  '--out=/Users/ilpinto/dev/roaring-lions-ep/_coord/wet-theme/p4/look2/captures',
];

describe('T12 option parsing', () => {
  it('accepts the S-L2 command line, every old option unchanged', () => {
    const a = parseGroundCaptureArgs(T12_LINE);
    expect(a.port).toBe(5196);
    expect(a.maps).toEqual(['ein_qasab']);
    expect(a.markers?.map((m) => m.marker)).toEqual(['causeway_s', 'kdf_start', 'hamlet']);
    expect(a.zooms).toEqual([1, 1.6, 2.5]);
    expect(a.quality).toEqual(['high', 'medium', 'low']);
    expect(a.ticks).toBe(6);
    expect(a.motion).toBe('reduce');
    expect(a.clip).toBe(5);
    expect(a.stops).toEqual(['road', 'water', 'grass']);
    // the T6 line still parses to the T6 key set
    const t6 = parseGroundCaptureArgs(['--maps=ein_qasab', '--markers=ein_qasab:causeway_s', '--reflect=0.25', '--wade=ein_qasab:causeway_s']);
    expect(Object.keys(t6).sort()).toEqual(['decals', 'maps', 'markers', 'out', 'port', 'reflect', 'reuse', 'wade']);
  });
  it('a run without the T12 flags has none of their keys', () => {
    const a = parseGroundCaptureArgs(['--maps=ein_qasab', '--markers=ein_qasab:hamlet']);
    for (const k of ['quality', 'ticks', 'motion', 'clip', 'stops', 'zooms']) expect(k in a).toBe(false);
  });
  it('refuses a bad value of each', () => {
    const base = ['--maps=a', '--markers=a:m', '--zooms=1,1.6'];
    expect(() => parseGroundCaptureArgs([...base, '--quality=ultra'])).toThrow(/high, medium or low/);
    expect(() => parseGroundCaptureArgs([...base, '--quality=high,high'])).toThrow(/twice/);
    expect(() => parseGroundCaptureArgs([...base, '--quality='])).toThrow(/at least one/);
    expect(() => parseGroundCaptureArgs([...base, '--ticks=0'])).toThrow(/1\.\.60/);
    expect(() => parseGroundCaptureArgs([...base, '--ticks=six'])).toThrow(/whole number/);
    expect(() => parseGroundCaptureArgs([...base, '--motion=full'])).toThrow(/only takes "reduce"/);
    expect(() => parseGroundCaptureArgs([...base, '--clip=0'])).toThrow(/--clip/);
    expect(() => parseGroundCaptureArgs([...base, '--clip=999'])).toThrow(/--clip/);
    expect(() => parseGroundCaptureArgs([...base, '--stops=road,sky'])).toThrow(/road, water or grass/);
    expect(() => parseGroundCaptureArgs([...base, '--stops=road,road'])).toThrow(/twice/);
    expect(() => parseGroundCaptureArgs(['--maps=a', '--markers=a:m', '--zooms=1,1.0'])).toThrow(/twice/);
  });
  it('each needs --markers, and --ticks needs a zoom-1.6 marker view to strip', () => {
    for (const f of ['--quality=high', '--motion=reduce', '--clip=5', '--stops=road', '--zooms=1']) {
      expect(() => parseGroundCaptureArgs(['--maps=a', f])).toThrow(/--markers/);
    }
    expect(() => parseGroundCaptureArgs(['--maps=a', '--markers=a:m', '--ticks=3'])).toThrow(/zoom 1\.6/);
    expect(parseGroundCaptureArgs(['--maps=a', '--markers=a:m', '--zooms=1.6', '--ticks=3']).ticks).toBe(3);
  });
});

describe('the shipped ladder, pinned', () => {
  it('EXPECTED_RAIN_DROPS is the ladder QUALITY_PRESETS ships (6000 / 3500 / 900)', () => {
    expect(EXPECTED_RAIN_DROPS).toEqual({ high: 6000, medium: 3500, low: 900 });
    expect(QUALITY_PRESETS.high.rain?.drops).toBe(EXPECTED_RAIN_DROPS.high);
    expect(QUALITY_PRESETS.medium.rain?.drops).toBe(EXPECTED_RAIN_DROPS.medium);
    expect(QUALITY_PRESETS.low.rain?.drops).toBe(EXPECTED_RAIN_DROPS.low);
  });
});

describe('passes and names: no two frames share a file', () => {
  const rows = Array.from({ length: 48 }, () => '.'.repeat(48));
  const table = { causeway_s: [22, 34], hamlet: [42, 22] } as const;
  const views = viewsFor('m', rows, ['causeway_s', 'hamlet'], table, [1, 1.6, 2.5]);

  it('plans the baseline, then one pass per preset, then the reduced pass; no options is the baseline alone', () => {
    expect(planPasses({})).toEqual([{ preset: 'high', reduced: false, suffix: '', full: true }]);
    expect(planPasses({ quality: ['medium', 'low'], motion: 'reduce' })).toEqual([
      { preset: 'high', reduced: false, suffix: '', full: true },
      { preset: 'medium', reduced: false, suffix: '-medium', full: false },
      { preset: 'low', reduced: false, suffix: '-low', full: false },
      { preset: 'high', reduced: true, suffix: '-reduced', full: false },
    ]);
  });
  it('the marker zooms follow --zooms; the default stays 1 and 2.5', () => {
    expect(viewsFor('m', rows, ['hamlet'], table).filter((v) => v.name.startsWith('m-hamlet')).map((v) => v.zoom)).toEqual([1, 2.5]);
    expect(views.filter((v) => v.name.startsWith('m-hamlet')).map((v) => v.name)).toEqual(['m-hamlet-z1', 'm-hamlet-z1.6', 'm-hamlet-z2.5']);
  });
  it('suffixes the marker views only, as <view>-<preset> and <view>-reduced', () => {
    const high = suffixedViews(views, 'm', ['causeway_s'], '-high');
    expect(high.map((v) => v.name)).toEqual(['m-causeway_s-z1-high', 'm-causeway_s-z1.6-high', 'm-causeway_s-z2.5-high']);
    expect(high[1]).toEqual({ name: 'm-causeway_s-z1.6-high', x: 22, y: 34, zoom: 1.6, fog: false });
    expect(suffixedViews(views, 'm', ['hamlet'], '-reduced').map((v) => v.name)).toEqual(['m-hamlet-z1-reduced', 'm-hamlet-z1.6-reduced', 'm-hamlet-z2.5-reduced']);
  });
  it('every view of every pass has its own name (the distinct-names check)', () => {
    const wanted = ['causeway_s', 'hamlet'];
    const names = [
      ...views.map((v) => v.name),
      ...(['-high', '-medium', '-low', '-reduced'] as const).flatMap((sfx) => suffixedViews(views, 'm', wanted, sfx).map((v) => v.name)),
    ];
    // 4 centre + fog + 6 marker views in the baseline (no road on this grid), 6 more for each of 4 passes
    expect(names).toHaveLength(11 + 24);
    expect(new Set(names).size).toBe(names.length);
  });
  it('a claim register throws on a repeat, naming the file', () => {
    const c = new NameClaims();
    expect(c.claim('a')).toBe('a');
    expect(() => c.claim('a')).toThrow(/two views are named "a"/);
    expect(c.size).toBe(1);
  });
  it('names a tick frame by its tick and a stop by its kind', () => {
    expect(tickName('m-causeway_s-z1.6', 3)).toBe('m-causeway_s-z1.6-t3');
    expect(stopName('m', 'water')).toBe('m-squad-water');
  });
});

describe('a requested mode that took no frame fails the run', () => {
  const none = { presetFrames: {}, tickFrames: 0, reducedFrames: 0, clipPath: null, stopFrames: {} };
  it('names each mode that took nothing', () => {
    const asked = { quality: ['high', 'low'] as const, ticks: 6, motion: 'reduce' as const, clip: 5, stops: ['road', 'water'] as const };
    const f = requestedModeFailures(asked, none);
    expect(f).toHaveLength(7);
    expect(f.join('\n')).toMatch(/--quality=low[^\n]*no low frame/);
    expect(f.join('\n')).toMatch(/--ticks=6/);
    expect(f.join('\n')).toMatch(/--motion=reduce/);
    expect(f.join('\n')).toMatch(/--clip=5/);
    expect(f.join('\n')).toMatch(/--stops=water/);
  });
  it('is empty when everything asked for was taken, and when nothing was asked', () => {
    const took = { presetFrames: { high: 6, low: 6 }, tickFrames: 18, reducedFrames: 6, clipPath: '/x/v.webm', stopFrames: { road: 1, water: 1 } };
    expect(requestedModeFailures({ quality: ['high', 'low'], ticks: 6, motion: 'reduce', clip: 5, stops: ['road', 'water'] }, took)).toEqual([]);
    expect(requestedModeFailures({}, none)).toEqual([]);
  });
  it('one preset taking frames does not excuse another', () => {
    expect(requestedModeFailures({ quality: ['high', 'low'] }, { ...none, presetFrames: { high: 6 } })).toHaveLength(1);
  });
});

describe('--stops: the tiles', () => {
  // x is the column, y the row. Water interior at (2,2) only (3x3 of ~ around it); grass interior far right.
  const rows = [
    '...........', //
    '.~~~.......',
    '.~~~~......',
    '.~~~.......',
    '.....rrr...',
    '...........',
    '...........',
  ];
  it('a road tile is the nearest r, ties to the lowest (y, x), with no interior asked of a lane', () => {
    expect(stopTile(rows, [0, 4], 'road')).toEqual({ tile: [5, 4], nonKind: 7 });
    expect(stopTile(rows, [9, 4], 'road')).toEqual({ tile: [7, 4], nonKind: 7 });
    expect(stopTile(['r.r'], [1, 0], 'road')?.tile).toEqual([0, 0]);
  });
  it('a water tile is an INTERIOR one: all 8 neighbours are ~, the nearest such', () => {
    const w = stopTile(rows, [9, 0], 'water');
    expect(w).toEqual({ tile: [2, 2], nonKind: 0 });
    // the nearer ~ at (4,2) has non-water neighbours, so the interior one wins over it
    expect(rows[2][4]).toBe('~');
  });
  it('with no interior water it falls back to the fewest non-water neighbours, and says how many', () => {
    const thin = ['.....', '.~~~.', '.....'];
    // (2,1) has neighbours (1,1),(3,1) water and six land: 6 non-water; the end tiles have 7.
    expect(stopTile(thin, [0, 0], 'water')).toEqual({ tile: [2, 1], nonKind: 6 });
  });
  it('a grass tile is an interior open one', () => {
    expect(stopTile(rows, [9, 5], 'grass')).toEqual({ tile: [9, 5], nonKind: 0 });
    // next to the road the grass is not interior, so the nearest interior tile is chosen
    expect(stopTile(rows, [5, 3], 'grass')?.nonKind).toBe(0);
    expect(stopTile(rows, [5, 3], 'grass')?.tile).toEqual([6, 2]);
  });
  it('is null when the map has no tile of the kind', () => {
    expect(stopTile(['...', '...'], [1, 1], 'water')).toBeNull();
    expect(stopTile(['~~~'], [1, 0], 'road')).toBeNull();
  });
});

describe('--stops is a Command, never a state write (invariant 4)', () => {
  it('hands exactly the wade Command shape to sim.queueCommand and writes no sim state', () => {
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
        state: new Proxy({ posX: new Proxy([], guard('posX')), posY: new Proxy([], guard('posY')), alive: [] }, guard('state')),
      },
      guard('sim')
    );
    const run = new Function('window', `return ${stopOrderScript(5, [2, 2])};`) as (w: unknown) => unknown;
    expect(run({ __lions: { sim } })).toBe(true);
    // tile (2,2): (2.5, 2.5) tiles is 163840 in Q16.16
    expect(queued).toEqual([{ kind: 'move', ids: [5], x: 163840, y: 163840 }]);
    expect(writes).toEqual([]);
  });
  it('the squad screen read writes nothing', () => {
    expect(squadScreenScript(3)).not.toMatch(/queueCommand|posX\[[^\]]*\]\s*=[^=]|\.state\s*=/);
  });
});

describe('halfToFloat and the height sampler', () => {
  it('decodes half floats from their bit patterns', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0x4000)).toBe(2);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x3800)).toBe(0.5);
    expect(halfToFloat(0x0000)).toBe(0);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    // 2.3 in half is 0x409a = 2.30078125
    expect(halfToFloat(0x409a)).toBeCloseTo(2.30078125, 9);
  });
  it('samples bilinear at texel centres, clamped, on a 1x1-tile map (4x4 texels, value = column)', () => {
    const texels = Array.from({ length: 16 }, (_, k) => k % 4);
    const f = makeHeightSampler(texels, 1, 1);
    expect(f(0.125, 0.5)).toBeCloseTo(0, 12);
    expect(f(0.375, 0.5)).toBeCloseTo(1, 12);
    expect(f(0.5, 0.5)).toBeCloseTo(1.5, 12);
    expect(f(0, 0)).toBeCloseTo(0, 12);
    expect(f(1, 1)).toBeCloseTo(3, 12);
    expect(f(7, -4)).toBeCloseTo(3, 12);
  });
  it('refuses a texture of the wrong size', () => {
    expect(() => makeHeightSampler([1, 2, 3], 1, 1)).toThrow(/3 texels, expected 16/);
  });
});

describe('the on-screen drop count (the per-frame density label)', () => {
  const flat = (): number => 0;
  const at = (x: number, y: number, zoom: number, low: number, period: number, mapW = 48) =>
    onScreenDropCount({ drops: 6000, low: { x: low, z: low }, period, fall: 0, mapW, mapH: mapW, view: { x, y, zoom, width: 1400, height: 900 }, ground: flat });
  // Hand check. 6,000 drops over a 64 x 64 window is 1.46 a tile^2. At zoom 1.6 the 1400x900 canvas
  // shows 1400/(64 * 1.6 * sqrt 2) * 2 = 19.3 across and 900 * sin 30 / (32 * 1.6 * sqrt 2) * 2 = 12.4 up
  // the screen, a ground diamond of 19.3 x 24.8 = 479 tiles^2: about 700 drops. At zoom 0.35 the whole
  // 48 x 48 map (2,304 tiles^2) is on screen: 2,304 / 4,096 * 6,000 = 3,375.
  it('at zoom 1.6 mid-map is about 700, within a literal band', () => {
    const n = at(24, 24, 1.6, -4.3258, 64);
    expect(n).toBeGreaterThan(650);
    expect(n).toBeLessThan(770);
  });
  it('at zoom 0.35 the whole map is on screen: about 3,375', () => {
    const n = at(24, 24, 0.35, -8, 64);
    expect(n).toBeGreaterThan(3200);
    expect(n).toBeLessThan(3500);
  });
  it('differs between zoom 0.35 and zoom 1.6 (the density the lead reads each frame by)', () => {
    expect(at(24, 24, 0.35, -8, 64)).toBeGreaterThan(4 * at(24, 24, 1.6, -4.3258, 64));
  });
  it('drops landing off the map are not counted: at the (44,44) corner far fewer than mid-map, and fewer than with no edge', () => {
    const corner = at(44, 44, 1.6, 9.5498, 64);
    expect(corner).toBeGreaterThan(150);
    expect(corner).toBeLessThan(280);
    // the same window on a map 1,000 wide has no edge to cull at: the count is the open-ground one
    expect(at(44, 44, 1.6, 9.5498, 64, 1000)).toBeGreaterThan(2 * corner);
  });
  it('a drop count of 0 is 0', () => {
    expect(onScreenDropCount({ drops: 0, low: { x: 0, z: 0 }, period: 64, fall: 0, mapW: 48, mapH: 48, view: { x: 24, y: 24, zoom: 1, width: 1400, height: 900 }, ground: flat })).toBe(0);
  });
});

describe('the render read-back (GH-871 P4 T12)', () => {
  const read = (renderer: unknown, extra: Record<string, unknown> = {}): RenderRead =>
    JSON.parse(
      (new Function('window', 'document', `return ${READ_RENDER_SCRIPT};`) as (w: unknown, d: unknown) => string)(
        { __lions: { renderer, sim: { tickCount: 7 } } },
        { documentElement: { dataset: { motion: 'reduce', ...extra } } }
      )
    ) as RenderRead;
  const rain = { drops: 3500, mesh: { visible: false, material: { uniforms: { uFall: { value: 1.5 }, uLow: { value: { x: -4, y: -5 } }, uPeriod: { value: 64 } } } }, mapWidth: 48, mapHeight: 48 };
  const renderer = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    opts: { weather: 'rain', quality: { rain: { drops: 3500 } }, reducedMotion: () => true },
    cssWidth: 1400,
    cssHeight: 900,
    camera: { x: 22, y: 34, zoom: 1.6 },
    rain,
    ...over,
  });
  it('reads the preset, the motion answer, the batch and the camera', () => {
    expect(read(renderer())).toEqual({
      weather: 'rain',
      qualityDrops: 3500,
      reduced: true,
      motionAttr: 'reduce',
      rain: { drops: 3500, visible: false, period: 64, fall: 1.5, low: { x: -4, z: -5 }, mapW: 48, mapH: 48 },
      view: { x: 22, y: 34, zoom: 1.6, width: 1400, height: 900 },
      tick: 7,
    });
  });
  it('a dry map reads rain null', () => {
    expect(read(renderer({ rain: null, opts: { weather: undefined, quality: { rain: { drops: 6000 } }, reducedMotion: () => false } })).rain).toBeNull();
  });
  it('THROWS naming the field when the tree has changed, never a silent null', () => {
    expect(() => read(renderer({ opts: undefined }))).toThrow(/renderer\.opts is missing/);
    expect(() => read(renderer({ opts: { reducedMotion: undefined } }))).toThrow(/opts\.reducedMotion is missing/);
    expect(() => read(renderer({ cssWidth: undefined }))).toThrow(/cssWidth/);
    expect(() => read(renderer({ camera: undefined }))).toThrow(/camera/);
    expect(() => read(renderer({ rain: { drops: 1, mesh: {} } }))).toThrow(/rain\.mesh\.material\.uniforms/);
    expect(() => read(renderer({ rain: { ...rain, mapWidth: undefined } }))).toThrow(/mapWidth/);
  });
  it('the height read finds none on a dry map and throws without texels on a wet one', () => {
    const run = (r: unknown): unknown => JSON.parse((new Function('window', `return ${READ_RAIN_HEIGHTS_SCRIPT};`) as (w: unknown) => string)({ __lions: { renderer: r } }));
    expect(run({ rain: null })).toBeNull();
    expect(run({ rain: { mapWidth: 1, mapHeight: 1, heightData: new Uint16Array([1, 2]) } })).toEqual({ w: 1, h: 1, bits: [1, 2] });
    expect(() => run({ rain: { mapWidth: 1, mapHeight: 1 } })).toThrow(/heightData is missing/);
  });
});

describe('the assertions: a pass must READ BACK what it asked for', () => {
  const wet = (over: Partial<RenderRead> = {}): RenderRead => ({
    weather: 'rain',
    qualityDrops: 6000,
    reduced: false,
    motionAttr: 'system',
    rain: { drops: 6000, visible: true, period: 64, fall: 0, low: { x: 0, z: 0 }, mapW: 48, mapH: 48 },
    view: { x: 0, y: 0, zoom: 1, width: 1400, height: 900 },
    tick: 0,
    ...over,
  });
  it('a booted preset must carry the ladder step: 6000, 3500, 900', () => {
    expect(() => assertPresetBooted('high', wet())).not.toThrow();
    expect(() => assertPresetBooted('medium', wet({ qualityDrops: 3500, rain: { ...wet().rain!, drops: 3500 } }))).not.toThrow();
    expect(() => assertPresetBooted('low', wet({ qualityDrops: 900, rain: { ...wet().rain!, drops: 900 } }))).not.toThrow();
    // asked for medium, booted high
    expect(() => assertPresetBooted('medium', wet())).toThrow(/booted for medium \(rain drops 3500\) but the renderer's quality carries 6000/);
    // quality right but the live batch is the wrong size, or absent on a wet map
    expect(() => assertPresetBooted('high', wet({ rain: { ...wet().rain!, drops: 1500 } }))).toThrow(/batch has 1500 instances/);
    expect(() => assertPresetBooted('high', wet({ rain: null }))).toThrow(/no rain batch/);
    // the pre-ladder low (1500) is a mismatch against the shipped 900
    expect(() => assertPresetBooted('low', wet({ qualityDrops: 1500 }))).toThrow(/quality carries 1500/);
    // a dry map has no batch to check
    expect(() => assertPresetBooted('high', wet({ weather: 'clear', rain: null }))).not.toThrow();
    expect(() => assertPresetBooted('high', wet({ qualityDrops: null }))).toThrow(/carries null/);
  });
  it('a reduced pass reads reducedMotion true, data-motion reduce and the rain mesh hidden', () => {
    const ok = wet({ reduced: true, motionAttr: 'reduce', rain: { ...wet().rain!, visible: false } });
    expect(() => assertMotion(true, ok)).not.toThrow();
    expect(() => assertMotion(true, wet())).toThrow(/reducedMotion\(\) says false/);
    expect(() => assertMotion(true, wet({ reduced: true, motionAttr: 'system' }))).toThrow(/data-motion is system/);
    expect(() => assertMotion(true, wet({ reduced: true, motionAttr: 'reduce' }))).toThrow(/rain mesh is still visible/);
    expect(() => assertMotion(true, wet({ reduced: true, motionAttr: 'reduce', rain: null }))).toThrow(/no rain batch/);
  });
  it('a full-motion pass reads reducedMotion false and the rain mesh visible', () => {
    expect(() => assertMotion(false, wet())).not.toThrow();
    expect(() => assertMotion(false, wet({ reduced: true }))).toThrow(/full-motion pass but the renderer's reducedMotion\(\) says true/);
    expect(() => assertMotion(false, wet({ rain: { ...wet().rain!, visible: false } }))).toThrow(/rain mesh is not visible/);
    expect(() => assertMotion(false, wet({ weather: 'clear', rain: null }))).not.toThrow();
  });
  it('rainLabel is null without a batch, 0 on screen while hidden, and refuses a batch without heights', () => {
    expect(rainLabel(wet({ rain: null }), null)).toBeNull();
    const hidden = wet({ rain: { ...wet().rain!, visible: false } });
    expect(rainLabel(hidden, () => 0)).toEqual({ onScreen: 0, total: 6000, period: 64, visible: false });
    expect(() => rainLabel(wet(), null)).toThrow(/height texels were not read/);
    const label = rainLabel(wet({ view: { x: 24, y: 24, zoom: 1.6, width: 1400, height: 900 }, rain: { ...wet().rain!, low: { x: -4.3258, z: -4.3258 } } }), () => 0);
    expect(label?.total).toBe(6000);
    expect(label?.onScreen).toBeGreaterThan(650);
    expect(label?.onScreen).toBeLessThan(770);
  });
});

describe('frameLine carries the T12 labels', () => {
  const rec = { calls: 12, triangles: 3456, textures: 7, geometries: 9, tick: 4, puddle: 0.25, marsh: 0.25 };
  it('appends the preset, the zoom and the density; a record without them prints as before', () => {
    expect(frameLine('v', { ...rec, preset: 'medium', zoom: 1.6, rain: { onScreen: 410, total: 3500, period: 64, visible: true } })).toBe(
      '  v: tick=4 puddle=0.25 marsh=0.25 calls=12 tris=3456 tex=7 geo=9 preset=medium zoom=1.6 drops=410 P=64 total=3500'
    );
    expect(frameLine('v', { ...rec, preset: 'high', zoom: 2.5, rain: { onScreen: 0, total: 6000, period: 32, visible: false } })).toContain('drops=0(hidden) P=32 total=6000');
    expect(frameLine('v', { ...rec, preset: 'high', zoom: 1, rain: null })).toContain('preset=high zoom=1 rain=none');
    expect(frameLine('v', { ...rec, squadScreen: [700.4, 451.6] })).toContain(' squad=[700,452]');
  });
});
