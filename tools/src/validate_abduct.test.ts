// GH-1438 E8: tools/validate_abduct.mjs, the authoring guards on `do.kind: abduct`. The route-length cap is retired: the
// escort paces to its captives, which packages/sim/src/abduct-pace.test.ts proves at the shipped speeds (taken on 60 and
// 120 tiles). What stays is every way an abduct holds nobody: captives, escort side, `to` in the zone, the start gap and
// a `to` no walk reaches, and the evacuation-crossing warning.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { abductFailures, ABDUCT_RELEASE_TILES } from '../validate_abduct.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BLOCKED = new Set(['#']);

const run = (mission: unknown, map: unknown): { failures: string[]; warnings: string[] } => abductFailures(mission, map, BLOCKED, 'm.json');

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

describe('the release radius', () => {
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

  it('a long route is no fault: the escort paces (30 tiles, the 1655 cap refused it, and 58)', () => {
    expect(run(mission(), map({ to: [35, 5] }))).toEqual({ failures: [], warnings: [] }); // (5,5) -> (35,5): 30
    expect(run(mission(), map({ to: [63, 5], exitZone: [61, 2, 3, 7] }))).toEqual({ failures: [], warnings: [] }); // 58
  });

  it('walks round a ridge with a gap: no fault (the 1655 cap refused this 30.8-tile detour)', () => {
    expect(run(mission(), map({ to: [30, 3], wall: true })).failures).toEqual([]);
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
    // exit_zone [28, 2, 3, 7] covers x 28..30, y 2..8. A short route from (5,5).
    const z = [28, 2, 3, 7];
    const outside = 'm.json: abduct trigger "led_away" marker "exit" is outside zone "exit_zone": the escort stops there and nobody is ever taken';
    expect(run(mission(), map({ to: [30, 8], exitZone: z })).failures).toEqual([]); // the last tile, both axes
    expect(run(mission(), map({ to: [28, 2], exitZone: z })).failures).toEqual([]); // the first tile, both axes
    expect(run(mission(), map({ to: [31, 8], exitZone: z })).failures).toEqual([outside]); // a tile past x
    expect(run(mission(), map({ to: [30, 9], exitZone: z })).failures).toEqual([outside]); // a tile past y
    expect(run(mission(), map({ to: [27, 2], exitZone: z })).failures).toEqual([outside]); // a tile before x
    expect(run(mission(), map({ to: [28, 1], exitZone: z })).failures).toEqual([outside]); // a tile before y
  });

  it('two escorts and two captives (the fixture 1655 bounded by the fastest and slowest): speeds no longer matter, the start gap is over EVERY pair', () => {
    // Escorts at (5,5) and (5,6), captives at (4,5) and (4,6), on unit ids no catalogue knows: the validator reads no
    // speed. The 1655 cap refused this 10.4-tile walk at 1.0 over 0.4 t/s; it passes now.
    const m = mission();
    const escorts = (at: [number, number]): Record<string, unknown> => ({
      garrison: [
        { unit: 'esc_slow', count: 1, at: [5, 5], group: 'takers' },
        { unit: 'esc_fast', count: 1, at, group: 'takers' },
      ],
    });
    m.enemy = escorts([5, 6]);
    m.civilians = {
      refuge: 'refuge',
      groups: [
        { unit: 'cap_fast', count: 1, at: [4, 5], group: 'taken' },
        { unit: 'cap_slow', count: 1, at: [4, 6], group: 'taken' },
      ],
    };
    expect(run(m, map({ to: [15, 5] }))).toEqual({ failures: [], warnings: [] });
    // The second escort moved to (5,0): it is sqrt 37 = 6.08 tiles from the captive at (4,6), though the first escort
    // stands a tile from both. The largest pair decides, so it is refused.
    m.enemy = escorts([5, 0]);
    expect(run(m, map({ to: [15, 5] })).failures).toEqual([
      'm.json: abduct trigger "led_away": its captives start 6.1 tiles from escort "takers", past the 6-tile release: none would ever be held',
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
