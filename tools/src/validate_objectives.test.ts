// GH-2 and GH-4: the authoring-time objective checks, on literal fixtures (each rule seen red) and on the shipped tree.
// The sim-guard review of PR 1240 noted that the starts-inside mirror had no test of its own: a mutation of it stayed green.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { objectiveFailures } from '../validate_objectives.mjs';

const map = { zones: { dest: [20, 2, 5, 7], other: [0, 0, 3, 3] } };
type Obj = Record<string, unknown>;
const hold: Obj = { id: 'hold', type: 'survive_until', primary: true, seconds: 60 };
const escort = (extra: Obj = {}): Obj => ({ id: 'vip', type: 'escort', primary: true, target: 'vip', zone: 'dest', ...extra });
const ceiling = (extra: Obj = {}): Obj => ({ id: 'clean', type: 'no_collateral_above', primary: false, threshold: 30, ...extra });
const force = (...p: Obj[]): Obj[] => p;
/** Failures for objective `o` in a mission with `rest` as its other objectives and `m` as the other mission fields. */
const run = (o: Obj, rest: Obj[] = [hold], m: Obj = {}): string[] =>
  objectiveFailures(o, { id: 'fx', starting_force: force({ unit: 'u', count: 1, at: [3, 5], tag: 'vip' }), objectives: [o, ...rest], ...m }, map, 'fx.json');

describe('escort', () => {
  it('passes a tagged unit that starts outside a known zone', () => {
    expect(run(escort())).toEqual([]);
  });
  it('refuses an unknown or missing zone', () => {
    expect(run(escort({ zone: 'nowhere' }))).toEqual(['fx.json: escort "vip" references unknown zone "nowhere"']);
    expect(run(escort({ zone: undefined }))).toHaveLength(1);
  });
  it('refuses a tag no starting_force placement carries, or none at all', () => {
    expect(run(escort({ target: 'nobody' }))[0]).toContain('needs a tag on a starting_force placement');
    expect(run(escort({ target: undefined }))[0]).toContain('needs a tag on a starting_force placement');
  });
  it('refuses a single unit that starts on a tile inside the zone: it would complete on the first tick', () => {
    const m = { starting_force: force({ unit: 'u', count: 1, at: [21, 5], tag: 'vip' }) };
    expect(run(escort(), [hold], m)).toEqual(['fx.json: escort "vip" starts inside zone "dest", so it would complete on the first tick']);
  });
  it('holds the starts-inside edges exactly: the corner tiles are inside, the tile beyond each side is not', () => {
    const at = (x: number, y: number) => run(escort(), [hold], { starting_force: force({ unit: 'u', count: 1, at: [x, y], tag: 'vip' }) });
    for (const [x, y] of [[20.5, 2.5], [24.5, 2.5], [20.5, 8.5], [24.5, 8.5]]) expect(at(x, y), `(${x}, ${y})`).toHaveLength(1);
    for (const [x, y] of [[19.5, 5.5], [25.5, 5.5], [22.5, 1.5], [22.5, 9.5]]) expect(at(x, y), `(${x}, ${y})`).toEqual([]);
  });
  it('does not flag what only the runtime can judge: a larger placement, or one tagged unit inside and one outside', () => {
    expect(run(escort(), [hold], { starting_force: force({ unit: 'u', count: 3, at: [21, 5], tag: 'vip' }) })).toEqual([]);
    expect(
      run(escort(), [hold], { starting_force: force({ unit: 'u', count: 1, at: [21, 5], tag: 'vip' }, { unit: 'u', count: 1, at: [3, 5], tag: 'vip' }) }),
    ).toEqual([]);
  });
  it('refuses a zone on any other type', () => {
    expect(run({ ...hold, zone: 'dest' }, [])).toEqual(['fx.json: objective "hold" is a survive_until, which takes no zone (only escort does)']);
  });
});

describe('no_collateral_above', () => {
  it('passes a whole threshold from 0 to 100 beside another primary', () => {
    for (const threshold of [0, 30, 100]) expect(run(ceiling({ threshold }), [hold]), String(threshold)).toEqual([]);
  });
  it('refuses a missing, fractional or out-of-range threshold', () => {
    for (const threshold of [undefined, 12.5, -1, 101]) {
      expect(run(ceiling({ threshold }), [hold])[0], String(threshold)).toContain('needs a whole threshold from 0 to 100');
    }
  });
  it('refuses a mission that switches ROE off', () => {
    expect(run(ceiling(), [hold], { roe: { enabled: false } })).toEqual(['fx.json: no_collateral_above "clean" reads the ROE score, which this mission switches off']);
  });
  it('needs a primary that is not itself a ceiling: two ceilings would wait on each other', () => {
    const c2 = ceiling({ id: 'clean2', primary: true });
    expect(run(ceiling({ primary: true }), [c2])[0]).toContain('needs another primary objective (not a ceiling)');
    expect(run(ceiling(), [hold, c2])).toEqual([]);
    expect(run(ceiling({ primary: true }), [])[0]).toContain('needs another primary objective (not a ceiling)');
  });
  it('refuses a threshold on any other type', () => {
    expect(run({ ...hold, threshold: 10 }, [])).toEqual(['fx.json: objective "hold" is a survive_until, which takes no threshold (only no_collateral_above does)']);
  });
});

describe('the shipped missions', () => {
  it('pass the same checks (no stray `zone` or `threshold`, and any escort or ceiling that ships is well formed)', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const dir = join(root, 'data', 'missions');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const m = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { map: { file: string }; objectives: Obj[] };
      const mp = JSON.parse(readFileSync(join(root, 'data', 'maps', `${m.map.file}.json`), 'utf8')) as typeof map;
      // A mission with no objectives would skip every check below and report success.
      expect(m.objectives.length, `${f}: objectives`).toBeGreaterThan(0);
      for (const o of m.objectives) {
        expect(objectiveFailures(o, m, mp, f), f).toEqual([]);
      }
    }
  });
});
