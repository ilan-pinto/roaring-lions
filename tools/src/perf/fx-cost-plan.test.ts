import { describe, expect, it } from 'vitest';
import {
  BASELINE,
  WET_BUDGET_MS,
  bootViews,
  buildSchedule,
  deltaRow,
  formatDelta,
  formatLoadLine,
  formatNetLayers,
  formatNetTotal,
  medianOf,
  netCost,
  parseCostArgs,
  parseViews,
  totalNetCost,
  resolveWetConfigs,
  wetConfigList,
  type WetFacts,
} from './fx-cost-plan';

const WET_FACTS: WetFacts = {
  rainMap: true,
  wetGround: true,
  rainBatch: true,
  wetDefine: true,
  ripplesAllowed: true,
  reducedMotion: false,
  shadowCurrent: 2048,
  shadowPreset: 4096,
};
const DRY_FACTS: WetFacts = {
  rainMap: false,
  wetGround: false,
  rainBatch: false,
  wetDefine: false,
  ripplesAllowed: true,
  reducedMotion: false,
  shadowCurrent: 4096,
  shadowPreset: 4096,
};

describe('parseCostArgs: the GH-829 command line is unchanged', () => {
  it('a bare --breakdown is beit_sahwan_outskirts, 3 rounds of 100 frames, dpr 2, no burn', () => {
    const a = parseCostArgs(['--breakdown']);
    expect(a.breakdown).toBe(true);
    expect(a.wet).toBe(false);
    expect(a.maps).toEqual(['beit_sahwan_outskirts']);
    expect(a.rounds).toBe(3);
    expect(a.frames).toBe(100);
    expect(a.dpr).toBe(2);
    expect(a.burn).toBe(0);
  });

  it('--breakdown --map=<id> --dpr=1 --rounds=5 --burn=2 reads as written, still one map', () => {
    const a = parseCostArgs(['--root=/x', '--port=5211', '--breakdown', '--map=wadi_halam_basin', '--dpr=1', '--rounds=5', '--burn=2', '--presets=high']);
    expect(a.maps).toEqual(['wadi_halam_basin']);
    expect(a.wet).toBe(false);
    expect(a.dpr).toBe(1);
    expect(a.rounds).toBe(5);
    expect(a.frames).toBe(100);
    expect(a.burn).toBe(2);
    expect(a.views['wadi_halam_basin']).toEqual(bootViews());
  });

  it('the FX rows mode (no --breakdown) parses to breakdown false', () => {
    expect(parseCostArgs(['--label=x']).breakdown).toBe(false);
  });

  it('the old flags refuse garbage rather than reading NaN', () => {
    expect(() => parseCostArgs(['--breakdown', '--rounds=abc'])).toThrow(/--rounds wants a positive integer/);
    expect(() => parseCostArgs(['--breakdown', '--dpr=0'])).toThrow(/--dpr wants a positive number/);
    expect(() => parseCostArgs(['--breakdown', '--burn=-1'])).toThrow(/--burn/);
  });
});

describe('parseCostArgs: the wet two-map mode', () => {
  it('--maps takes the spec defaults: 12 rounds of 20 frames', () => {
    const a = parseCostArgs(['--breakdown', '--maps=ein_qasab,wadi_halam_basin']);
    expect(a.wet).toBe(true);
    expect(a.maps).toEqual(['ein_qasab', 'wadi_halam_basin']);
    expect(a.rounds).toBe(12);
    expect(a.frames).toBe(20);
  });

  it('--rounds and --frames override the wet defaults', () => {
    const a = parseCostArgs(['--breakdown', '--maps=ein_qasab,wadi_halam_basin', '--rounds=4', '--frames=30']);
    expect(a.rounds).toBe(4);
    expect(a.frames).toBe(30);
  });

  it('ein_qasab defaults to causeway_s at zooms 1, 1.6 and 2.5; the basin to its GH-829 boot views', () => {
    const a = parseCostArgs(['--breakdown', '--maps=ein_qasab,wadi_halam_basin']);
    expect(a.views['ein_qasab']).toEqual([
      { name: 'causeway_s-z1', at: { kind: 'marker', marker: 'causeway_s' }, zoom: 1 },
      { name: 'causeway_s-z1.6', at: { kind: 'marker', marker: 'causeway_s' }, zoom: 1.6 },
      { name: 'causeway_s-z2.5', at: { kind: 'marker', marker: 'causeway_s' }, zoom: 2.5 },
    ]);
    expect(a.views['wadi_halam_basin']).toEqual([
      { name: 'boot', at: { kind: 'boot' }, zoom: null },
      { name: 'boot-z1.6', at: { kind: 'boot' }, zoom: 1.6 },
      { name: 'boot-z2.5', at: { kind: 'boot' }, zoom: 2.5 },
    ]);
  });

  it('--views takes a marker or coordinates and replaces that map\'s defaults only', () => {
    const a = parseCostArgs(['--breakdown', '--maps=ein_qasab,wadi_halam_basin', '--views=ein_qasab:20,31,1.6;ein_qasab:causeway_n,2']);
    expect(a.views['ein_qasab']).toEqual([
      { name: 't20_31-z1.6', at: { kind: 'tile', x: 20, y: 31 }, zoom: 1.6 },
      { name: 'causeway_n-z2', at: { kind: 'marker', marker: 'causeway_n' }, zoom: 2 },
    ]);
    expect(a.views['wadi_halam_basin']).toEqual(bootViews());
  });

  it('a --views entry that names no timed map, has no zoom or is malformed is an error', () => {
    const maps = ['ein_qasab', 'wadi_halam_basin'];
    expect(() => parseViews('tel_marum:causeway_s,1', maps)).toThrow(/names map "tel_marum"/);
    expect(() => parseViews('ein_qasab:causeway_s', maps)).toThrow(/wants/);
    expect(() => parseViews('ein_qasab:1,2', maps)).toThrow(/wants <x>,<y>,<zoom> or <marker>,<zoom>/);
    expect(() => parseViews('ein_qasab:causeway_s,0', maps)).toThrow(/positive number/);
    expect(() => parseViews('nocolon', maps)).toThrow(/wants <map>:/);
  });

  it('--views refuses the same view twice for one map', () => {
    const maps = ['ein_qasab', 'wadi_halam_basin'];
    expect(() => parseViews('ein_qasab:causeway_s,1;ein_qasab:causeway_s,1', maps)).toThrow(/names view "causeway_s-z1" twice for map "ein_qasab"/);
    expect(() => parseViews('ein_qasab:causeway_s,1;wadi_halam_basin:causeway_s,1', maps)).not.toThrow();
  });

  it('refuses the combinations that would read as something else', () => {
    expect(() => parseCostArgs(['--breakdown', '--maps=a,b', '--map=a'])).toThrow(/not both/);
    expect(() => parseCostArgs(['--maps=a,b'])).toThrow(/--breakdown option/);
    expect(() => parseCostArgs(['--breakdown', '--map=a', '--views=a:m,1'])).toThrow(/--views needs --maps/);
    expect(() => parseCostArgs(['--breakdown', '--maps=a,a'])).toThrow(/twice/);
    expect(() => parseCostArgs(['--breakdown', '--maps='])).toThrow(/names no map/);
  });
});

describe('buildSchedule', () => {
  const views = {
    A: [
      { name: 'a0', at: { kind: 'boot' as const }, zoom: null },
      { name: 'a1', at: { kind: 'boot' as const }, zoom: 1.6 },
    ],
    B: [
      { name: 'b0', at: { kind: 'boot' as const }, zoom: null },
      { name: 'b1', at: { kind: 'boot' as const }, zoom: 1.6 },
    ],
  };
  const configs = ['baseline', 'x', 'y'];
  const steps = buildSchedule({ maps: ['A', 'B'], rounds: 3, views, configs });

  it('has every (round, map, view, config) exactly once', () => {
    expect(steps).toHaveLength(3 * 2 * 2 * 3);
    expect(new Set(steps.map((s) => `${s.round}/${s.map}/${s.view}/${s.config}`)).size).toBe(steps.length);
  });

  it('map A and map B alternate within every round, not all A then all B', () => {
    for (let round = 0; round < 3; round++) {
      const maps = steps.filter((s) => s.round === round).map((s) => s.map);
      // Collapse consecutive repeats: the maps visited, in order.
      const runs = maps.filter((m, i) => i === 0 || m !== maps[i - 1]);
      expect(runs).toEqual(['A', 'B', 'A', 'B']);
    }
  });

  it('no map runs more than one view\'s configs in a row', () => {
    let run = 0;
    let prev = '';
    let longest = 0;
    for (const s of steps) {
      run = s.map === prev ? run + 1 : 1;
      prev = s.map;
      longest = Math.max(longest, run);
    }
    expect(longest).toBe(configs.length);
  });

  it('a round finishes before the next begins', () => {
    const rounds = steps.map((s) => s.round);
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
  });

  it('a map with fewer views has no step at a slot it lacks, and the other still alternates', () => {
    const s = buildSchedule({ maps: ['A', 'B'], rounds: 1, views: { A: views.A, B: [views.B[0]!] }, configs: ['baseline'] });
    expect(s.map((x) => `${x.map}:${x.view}`)).toEqual(['A:a0', 'B:b0', 'A:a1']);
  });
});

describe('the wet schedule carries wet-program in every cell', () => {
  it('each (round, map, view) times baseline, wet-all, wet-program and shadow-full exactly once', () => {
    const views = { A: bootViews(), B: bootViews() };
    const steps = buildSchedule({ maps: ['A', 'B'], rounds: 2, views, configs: wetConfigList() });
    for (const config of [BASELINE, 'wet-all', 'wet-program', 'shadow-full']) {
      expect(steps.filter((x) => x.config === config), config).toHaveLength(2 * 2 * 3);
    }
  });
});

describe('resolveWetConfigs', () => {
  it('on a rain map at high every wet config resolves', () => {
    const r = resolveWetConfigs(WET_FACTS);
    for (const [name, res] of Object.entries(r)) expect(res, name).toEqual({ resolves: true });
  });

  it('on a dry map every wet config is unresolved, "dry-map"', () => {
    const r = resolveWetConfigs(DRY_FACTS);
    for (const [name, res] of Object.entries(r)) expect(res, name).toEqual({ resolves: false, reason: 'dry-map' });
  });

  it('low: ripples are off by the preset, and there is no shadow step to undo', () => {
    const r = resolveWetConfigs({ ...WET_FACTS, ripplesAllowed: false, shadowCurrent: 1024, shadowPreset: 1024 });
    expect(r.ripples).toEqual({ resolves: false, reason: 'ripples-off' });
    expect(r['shadow-full']).toEqual({ resolves: false, reason: 'no-shadow-step' });
    expect(r['wet-all']).toEqual({ resolves: true });
  });

  it('medium steps 2048 -> 1024, so shadow-full has a step to undo', () => {
    expect(resolveWetConfigs({ ...WET_FACTS, shadowCurrent: 1024, shadowPreset: 2048 })['shadow-full']).toEqual({ resolves: true });
  });

  it('reduced motion stills the rain and the ripples but not the wet ground', () => {
    const r = resolveWetConfigs({ ...WET_FACTS, reducedMotion: true });
    expect(r.rain).toEqual({ resolves: false, reason: 'reduced-motion' });
    expect(r.ripples).toEqual({ resolves: false, reason: 'reduced-motion' });
    expect(r.wet).toEqual({ resolves: true });
  });

  it('a rain map whose batch was never built (the last ladder step) cannot time the rain layer', () => {
    expect(resolveWetConfigs({ ...WET_FACTS, rainBatch: false }).rain).toEqual({ resolves: false, reason: 'no-rain-batch' });
  });

  it('wet-program needs the compiled wet define: a dry map and a wet ground without the define are both n/a', () => {
    expect(resolveWetConfigs(WET_FACTS)['wet-program']).toEqual({ resolves: true });
    expect(resolveWetConfigs(DRY_FACTS)['wet-program']).toEqual({ resolves: false, reason: 'dry-map' });
    expect(resolveWetConfigs({ ...WET_FACTS, wetDefine: false })['wet-program']).toEqual({ resolves: false, reason: 'no-wet-define' });
  });

  it('wet-program still resolves on low and under reduced motion (the program is compiled either way)', () => {
    const low = resolveWetConfigs({ ...WET_FACTS, ripplesAllowed: false, shadowCurrent: 1024, shadowPreset: 1024 });
    expect(low['wet-program']).toEqual({ resolves: true });
    expect(resolveWetConfigs({ ...WET_FACTS, reducedMotion: true })['wet-program']).toEqual({ resolves: true });
  });

  it('a page with no sun says no-sun, not no-quality', () => {
    expect(resolveWetConfigs({ ...WET_FACTS, shadowCurrent: null })['shadow-full']).toEqual({ resolves: false, reason: 'no-sun' });
  });

  it('a page with no quality cannot say what the un-stepped shadow map is', () => {
    expect(resolveWetConfigs({ ...WET_FACTS, shadowPreset: null })['shadow-full']).toEqual({ resolves: false, reason: 'no-quality' });
  });
});

describe('deltaRow: an unresolved config prints n/a, never a 0 delta', () => {
  it('a resolved config is a number, a negative one included', () => {
    expect(deltaRow(10, 9.25, { resolves: true })).toEqual({ kind: 'delta', value: -0.75 });
    expect(formatDelta(deltaRow(10, 12.5, { resolves: true }))).toBe('delta 2.50');
  });

  it('the same reading, unresolved, is n/a with its reason even when the frames match to the bit', () => {
    const row = deltaRow(10, 10, { resolves: false, reason: 'dry-map' });
    expect(row).toEqual({ kind: 'na', reason: 'dry-map' });
    expect(formatDelta(row)).toBe('delta n/a (dry-map)');
    expect(formatDelta(row)).not.toMatch(/0\.00/);
  });
});

describe('netCost and totalNetCost: net = gross - saving, on literals', () => {
  const yes = { resolves: true } as const;
  const dry = { resolves: false, reason: 'dry-map' } as const;
  // base 12.0 booted; wet layers hidden 10.7 (gross 1.3); the wet PROGRAM removed 10.2 (gross 1.8);
  // shadow at full size 12.4 (saving 0.4).
  const input = {
    base: 12.0,
    wetAll: { med: 10.7, resolution: yes },
    wetProgram: { med: 10.2, resolution: yes },
    shadowFull: { med: 12.4, resolution: yes },
  };

  it('the layer net: gross 1.30, saving 0.40 -> 0.90, with no budget verdict and its caveat', () => {
    const n = netCost(input);
    expect(n.kind).toBe('net');
    if (n.kind !== 'net') return;
    expect(n.gross).toBeCloseTo(1.3, 10);
    expect(n.saving).toBeCloseTo(0.4, 10);
    expect(n.net).toBeCloseTo(0.9, 10);
    const text = formatNetLayers(n);
    expect(text).toContain('NET (layers) 0.90 ms = gross 1.30 - saving 0.40');
    expect(text).toContain('excludes the standing wet-program cost');
    expect(text).not.toMatch(/within|OVER/);
  });

  it('the total net uses the wet-program frame: gross 1.80, saving 0.40 -> 1.40, OVER high\'s +1.0 while the layer net read 0.90', () => {
    const n = totalNetCost(input);
    expect(n.kind).toBe('net');
    if (n.kind !== 'net') return;
    expect(n.gross).toBeCloseTo(1.8, 10);
    expect(n.saving).toBeCloseTo(0.4, 10);
    expect(n.net).toBeCloseTo(1.4, 10);
    expect(formatNetTotal('high', n)).toContain('NET (total wet) 1.40 ms = gross 1.80 - saving 0.40');
    expect(formatNetTotal('high', n)).toContain('budget +1.0 ms: OVER');
    expect(formatNetTotal('high', { ...n, net: 0.95 })).toContain('within');
    expect(formatNetTotal('low', { ...n, net: 0.4 })).toContain('within'); // the budget is inclusive
  });

  it('the total ignores the wet-all frame and the layer net ignores the wet-program frame', () => {
    const swapped = { ...input, wetAll: { med: 1, resolution: yes }, wetProgram: { med: 11, resolution: yes } };
    expect(totalNetCost(swapped)).toMatchObject({ gross: 1 });
    expect(netCost(swapped)).toMatchObject({ gross: 11 });
  });

  it('a step that costs nothing back (saving 0) leaves net = gross', () => {
    const n = netCost({ ...input, base: 5, wetAll: { med: 4, resolution: yes }, shadowFull: { med: 5, resolution: yes } });
    expect(n).toMatchObject({ kind: 'net', gross: 1, saving: 0, net: 1 });
  });

  it('low has no step: saving is a true zero, flagged, not n/a', () => {
    const n = totalNetCost({
      ...input,
      base: 8,
      wetProgram: { med: 7.7, resolution: yes },
      shadowFull: { med: 8, resolution: { resolves: false, reason: 'no-shadow-step' } },
    });
    expect(n).toMatchObject({ kind: 'net', saving: 0, stepless: true });
    if (n.kind === 'net') {
      expect(n.net).toBeCloseTo(0.3, 10);
      expect(formatNetTotal('low', n)).toContain('no shadow step on this preset');
    }
  });

  it('a dry map is n/a end to end for both nets, whatever the frames read', () => {
    const d = { base: 10, wetAll: { med: 10, resolution: dry }, wetProgram: { med: 10, resolution: dry }, shadowFull: { med: 10, resolution: dry } };
    expect(netCost(d)).toEqual({ kind: 'na', reason: 'dry-map' });
    expect(totalNetCost(d)).toEqual({ kind: 'na', reason: 'dry-map' });
    expect(formatNetTotal('high', totalNetCost(d))).toBe('NET (total wet) n/a (dry-map)');
    expect(formatNetLayers(netCost(d))).toBe('NET (layers) n/a (dry-map)');
  });

  it('an unresolved wet-program makes the total n/a even when wet-all resolved', () => {
    const n = totalNetCost({ ...input, wetProgram: { med: 0, resolution: { resolves: false, reason: 'no-wet-define' } } });
    expect(n).toEqual({ kind: 'na', reason: 'no-wet-define' });
    expect(netCost({ ...input, wetProgram: { med: 0, resolution: { resolves: false, reason: 'no-wet-define' } } }).kind).toBe('net');
  });

  it('a shadow-full that failed for any other reason makes the net n/a, not a silent zero saving', () => {
    const sf = { med: 10, resolution: { resolves: false, reason: 'no-quality' } } as const;
    expect(netCost({ ...input, shadowFull: sf })).toEqual({ kind: 'na', reason: 'no-quality' });
    expect(totalNetCost({ ...input, shadowFull: sf })).toEqual({ kind: 'na', reason: 'no-quality' });
  });
});

describe('small pieces', () => {
  it('the budgets are the lead\'s +1.0 / +0.7 / +0.4', () => {
    expect(WET_BUDGET_MS).toEqual({ high: 1.0, medium: 0.7, low: 0.4 });
  });

  it('the wet config list is the baseline then rain, wet, marsh, ripples, wet-all, wet-program, shadow-full', () => {
    expect(wetConfigList()).toEqual([BASELINE, 'rain', 'wet', 'marsh', 'ripples', 'wet-all', 'wet-program', 'shadow-full']);
  });

  it('the load line prints both loadavgs, one decimal', () => {
    expect(formatLoadLine('high', [1.234, 2, 3.06], [0.5, 0.25, 0.01])).toBe('load high before 1.2/2.0/3.1 after 0.5/0.3/0.0');
  });

  it('medianOf takes the upper middle of an even list and refuses an empty one', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(3);
    expect(() => medianOf([])).toThrow();
  });
});
