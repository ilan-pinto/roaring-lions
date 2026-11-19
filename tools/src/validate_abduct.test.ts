// GH-1438 E8: tools/validate_abduct.mjs, the authoring guards on `do.kind: abduct`. The behaviour the route bound rests
// on (at shipped speeds a captive keeps up inside it and is left behind beyond it) is packages/sim/src/mission.test.ts,
// "E8: abduct", the shipped-speed case.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { abductFailures, abductRouteBound, ABDUCT_RELEASE_TILES, ABDUCT_ROUTE_MARGIN_TILES } from '../validate_abduct.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const unit = (rel: string): { id: string; mobility: { speed_tiles_s: number } } =>
  JSON.parse(readFileSync(join(ROOT, 'data', 'units', rel), 'utf8')) as { id: string; mobility: { speed_tiles_s: number } };
const MILITIA = unit('enemy/militia_cell.json');
const CIVILIANS = unit('civilians.json');
const UNITS = new Map([MILITIA, CIVILIANS, unit('kdf/inf_squad.json')].map((u) => [u.id, u]));
const BLOCKED = new Set(['#']);

const run = (mission: unknown, map: unknown): { failures: string[]; warnings: string[] } =>
  abductFailures(mission, map, UNITS, BLOCKED, 'm.json');

/** A 64 x 12 open map; `wall` puts a `^` column at x = 20 over rows 0-10, leaving a gap at row 11. */
function map(opts: { to?: [number, number]; wall?: boolean; exitZone?: number[] } = {}): unknown {
  const rows = Array.from({ length: 12 }, (_, y) =>
    Array.from({ length: 64 }, (_, x) => (opts.wall === true && x === 20 && y < 11 ? '^' : '.')).join(''),
  );
  const to = opts.to ?? [30, 5];
  return {
    rows,
    markers: { exit: to, refuge: [1, 10] },
    zones: { exit_zone: opts.exitZone ?? [to[0] - 1, 2, 3, 7], refuge_zone: [0, 8, 4, 4], mid: [12, 0, 3, 12] },
  };
}
/** Escort at (5,5), one captive at (4,5): a tile behind, so the start gap is 1. */
function mission(opts: { group?: string; extra?: Record<string, unknown>; evac?: string } = {}): Record<string, unknown> {
  return {
    starting_force: [{ unit: 'inf_squad', count: 1, at: [2, 1], group: 'kdf' }],
    enemy: { garrison: [{ unit: 'militia_cell', count: 1, at: [5, 5], group: 'takers' }] },
    civilians: { refuge: 'refuge', groups: [{ unit: 'civilians', count: 1, at: [4, 5], group: 'taken' }] },
    objectives: [
      { id: 'hold', type: 'survive_until', primary: true, seconds: 300 },
      ...(opts.evac !== undefined ? [{ id: 'home', type: 'evacuate_before', target: opts.evac, count: 1, seconds: 300 }] : []),
    ],
    triggers: [
      {
        id: 'led_away',
        label: 'They are led away',
        on: { kind: 'timer_s', value: 1 },
        do: { kind: 'abduct', group: opts.group ?? 'takers', captives: 'taken', to: 'exit', zone: 'exit_zone' },
      },
      ...(opts.extra !== undefined ? [opts.extra] : []),
    ],
  };
}

describe('abductRouteBound', () => {
  it('is (6 - gap) x vE / (vE - vC) - 2, from literals', () => {
    expect(ABDUCT_RELEASE_TILES).toBe(6);
    expect(ABDUCT_ROUTE_MARGIN_TILES).toBe(2);
    expect(abductRouteBound(1, 0.5, 0)).toBeCloseTo(10, 9); // 6 x 1 / 0.5 - 2
    expect(abductRouteBound(1, 0.5, 2)).toBeCloseTo(6, 9); // 4 x 2 - 2
    expect(abductRouteBound(0.8, 0.8, 0)).toBe(Infinity); // the gap never opens
    expect(abductRouteBound(0.7, 0.8, 0)).toBe(Infinity);
  });

  it('at the shipped speeds, read from data/units: militia_cell over civilians, 29.67 tiles a tile apart, 36 beside', () => {
    expect([MILITIA.mobility.speed_tiles_s, CIVILIANS.mobility.speed_tiles_s]).toEqual([0.95, 0.8]);
    expect(abductRouteBound(MILITIA.mobility.speed_tiles_s, CIVILIANS.mobility.speed_tiles_s, 1)).toBeCloseTo(29.667, 3);
    expect(abductRouteBound(MILITIA.mobility.speed_tiles_s, CIVILIANS.mobility.speed_tiles_s, 0)).toBeCloseTo(36, 9);
  });

  it('pins the release radius to the sim: ABDUCT_RELEASE_SQ = 36 * 65536 in mission.ts is 6 tiles squared', () => {
    const src = readFileSync(join(ROOT, 'packages', 'sim', 'src', 'mission.ts'), 'utf8');
    const m = /const ABDUCT_RELEASE_SQ = (\d+) \* 65536;/.exec(src);
    expect(m?.[1]).toBe(String(ABDUCT_RELEASE_TILES * ABDUCT_RELEASE_TILES));
  });
});

describe('abductFailures', () => {
  it('passes a short open route, with no warning', () => {
    expect(run(mission(), map({ to: [30, 5] }))).toEqual({ failures: [], warnings: [] });
  });

  it('refuses a route past the bound, naming the trigger: 29 tiles pass, 30 do not (bound 29.67)', () => {
    expect(run(mission(), map({ to: [34, 5] })).failures).toEqual([]); // (5,5) -> (34,5): 29
    expect(run(mission(), map({ to: [35, 5] })).failures).toEqual([
      'm.json: abduct trigger "led_away": escort route 30.0 tiles to "exit" is longer than the 29.7 on which its ' +
        'captives keep up (escort 0.95 t/s, captives 0.8 t/s, 1.0 tiles apart at the start, released past 6): they ' +
        'would be left behind, never taken',
    ]);
  });

  it('measures the WALKING route: a ridge that forces a detour refuses a goal the straight line would pass', () => {
    // (5,5) -> (30,3) is 25.8 straight (2 diagonals and 23 steps); round the ridge's end at row 11 it is
    // 6 sqrt 2 + 9 + 8 sqrt 2 + 2 = 30.8, past the 29.67.
    expect(run(mission(), map({ to: [30, 3] })).failures).toEqual([]);
    const f = run(mission(), map({ to: [30, 3], wall: true })).failures;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/escort route 30\.8 tiles/);
  });

  it('refuses captives that start beyond the release radius, whatever the route', () => {
    const m = mission();
    (m.civilians as { groups: { at: number[] }[] }).groups[0].at = [5, 12 - 0.5]; // 6.5 tiles below the escort
    expect(run(m, map({ to: [6, 5], exitZone: [5, 2, 3, 7] })).failures).toEqual([
      'm.json: abduct trigger "led_away": its captives start 6.5 tiles from escort "takers", past the 6-tile release: none would ever be held',
    ]);
  });

  it('refuses a goal no walk reaches', () => {
    const m = map({ to: [30, 5] }) as { rows: string[] };
    m.rows = m.rows.map((r) => `${r.slice(0, 20)}^${r.slice(21)}`); // a full-height ridge
    expect(run(mission(), m).failures).toEqual(['m.json: abduct trigger "led_away": no walking route from escort "takers" to marker "exit"']);
  });

  it('refuses an escort group a player or civilian placement declares', () => {
    const msg = (g: string): string =>
      `m.json: abduct trigger "led_away" escort group "${g}" is declared by a starting_force, reinforce or civilians ` +
      'placement; only an enemy (side 1) member leads, so it would hold nobody';
    expect(run(mission({ group: 'kdf' }), map()).failures).toEqual([msg('kdf')]);
    expect(run(mission({ group: 'taken' }), map()).failures).toEqual([msg('taken')]);
    // A reinforce that drops a player squad into the enemy's escort group.
    const reinforced = mission({
      extra: { id: 'r', label: 'Help', on: { kind: 'timer_s', value: 5 }, do: { kind: 'reinforce', units: [{ unit: 'inf_squad', count: 1, at: [3, 3], group: 'takers' }] } },
    });
    expect(run(reinforced, map()).failures).toEqual([msg('takers')]);
    // The control: an escort a `spawn` raises is an enemy group.
    const spawned = mission({
      group: 'late',
      extra: { id: 's', label: 'They come', on: { kind: 'timer_s', value: 0 }, do: { kind: 'spawn', units: [{ unit: 'militia_cell', count: 1, at: [5, 6], group: 'late' }] } },
    });
    expect(run(spawned, map()).failures).toEqual([]);
  });

  it('refuses a `to` outside the exit zone', () => {
    expect(run(mission(), map({ to: [30, 5], exitZone: [40, 2, 3, 7] })).failures).toEqual([
      'm.json: abduct trigger "led_away" marker "exit" is outside zone "exit_zone": the escort stops there and nobody is ever taken',
    ]);
  });

  it('accepts a `to` on the zone`s first and last tiles and refuses one a tile beyond (the rectangle`s edges)', () => {
    // exit_zone [28, 2, 3, 7] covers x 28..30, y 2..8. A short route from (5,5), well inside the bound.
    const z = [28, 2, 3, 7];
    const outside = 'm.json: abduct trigger "led_away" marker "exit" is outside zone "exit_zone": the escort stops there and nobody is ever taken';
    expect(run(mission(), map({ to: [30, 8], exitZone: z })).failures).toEqual([]); // the last tile, both axes
    expect(run(mission(), map({ to: [28, 2], exitZone: z })).failures).toEqual([]); // the first tile, both axes
    expect(run(mission(), map({ to: [31, 8], exitZone: z })).failures).toEqual([outside]); // a tile past x
    expect(run(mission(), map({ to: [30, 9], exitZone: z })).failures).toEqual([outside]); // a tile past y
    expect(run(mission(), map({ to: [27, 2], exitZone: z })).failures).toEqual([outside]); // a tile before x
    expect(run(mission(), map({ to: [28, 1], exitZone: z })).failures).toEqual([outside]); // a tile before y
  });

  it('bounds with the FASTEST escort and the SLOWEST captive: two of each, from literal unit records', () => {
    // Literal unit records, listed slow-escort first and fast-captive first, so neither the first placement nor the
    // wrong extreme stands in. Escorts at (5,5) and (5,6), captives at (4,5) and (4,6): the largest start gap is
    // sqrt 2. Route: the longer body's walk, (5,6) -> (15,5), 9 + sqrt 2 = 10.41 tiles.
    const units = new Map(
      [
        { id: 'esc_slow', mobility: { speed_tiles_s: 0.5 } },
        { id: 'esc_fast', mobility: { speed_tiles_s: 1.0 } },
        { id: 'cap_fast', mobility: { speed_tiles_s: 0.8 } },
        { id: 'cap_slow', mobility: { speed_tiles_s: 0.4 } },
      ].map((u) => [u.id, u]),
    );
    const m = mission();
    m.enemy = {
      garrison: [
        { unit: 'esc_slow', count: 1, at: [5, 5], group: 'takers' },
        { unit: 'esc_fast', count: 1, at: [5, 6], group: 'takers' },
      ],
    };
    m.civilians = {
      refuge: 'refuge',
      groups: [
        { unit: 'cap_fast', count: 1, at: [4, 5], group: 'taken' },
        { unit: 'cap_slow', count: 1, at: [4, 6], group: 'taken' },
      ],
    };
    // (6 - sqrt 2) x 1.0 / 0.6 - 2 = 5.64 refuses 10.41; either wrong pair, (0.5 over 0.4) or (1.0 over 0.8), gives
    // (6 - sqrt 2) x 5 - 2 = 20.93 and would accept it.
    const route = 9 + Math.SQRT2;
    const gap = Math.SQRT2;
    expect(abductRouteBound(1.0, 0.4, gap)).toBeLessThan(route);
    expect(abductRouteBound(0.5, 0.4, gap)).toBeGreaterThan(route);
    expect(abductRouteBound(1.0, 0.8, gap)).toBeGreaterThan(route);
    expect(abductFailures(m, map({ to: [15, 5] }), units, BLOCKED, 'm.json').failures).toEqual([
      'm.json: abduct trigger "led_away": escort route 10.4 tiles to "exit" is longer than the 5.6 on which its ' +
        'captives keep up (escort 1 t/s, captives 0.4 t/s, 1.4 tiles apart at the start, released past 6): they ' +
        'would be left behind, never taken',
    ]);
  });

  it('refuses captives no civilians.groups placement declares', () => {
    const m = mission();
    (m.triggers as { do: Record<string, unknown> }[])[0].do.captives = 'takers';
    expect(run(m, map()).failures).toEqual([
      'm.json: abduct trigger "led_away" names captives "takers", which no civilians.groups placement declares',
    ]);
  });

  it('WARNS, and does not fail, when the route crosses an evacuate_before zone', () => {
    const r = run(mission({ evac: 'mid' }), map({ to: [30, 5] }));
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([
      'm.json: abduct trigger "led_away": the escort\'s route to "exit" crosses evacuate_before zone "mid" at (12, 5); ' +
        'a held captive standing there is counted out as evacuated',
    ]);
    expect(run(mission({ evac: 'refuge_zone' }), map({ to: [30, 5] })).warnings).toEqual([]); // the control: off the route
  });
});
