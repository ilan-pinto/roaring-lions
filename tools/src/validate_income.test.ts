// F2 (GH-183): the income cross-checks, on literal fixtures (each rule seen red) and on the shipped tree.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { incomeFailures } from '../validate_income.mjs';

const map = {
  id: 'm',
  zones: { hill: [0, 0, 2, 2], yard: [4, 4, 2, 2] },
  markers: { gate: [0, 7], rear: [3, 3] },
};
const mission = (resources: Record<string, unknown>, id = 'fixture_m') => ({ id, map: { file: 'm' }, resources });
const run = (resources: Record<string, unknown>, id?: string) => incomeFailures(mission(resources, id), map, 'fixture.json');

describe('incomeFailures on fixtures', () => {
  it('passes a mission with no resources, and one with only a base rate', () => {
    expect(incomeFailures({ id: 'x' }, map, 'x.json')).toEqual([]);
    expect(run({ logistics_rate_per_min: 20 })).toEqual([]);
  });
  it('passes declared zones, each once, and a declared entry', () => {
    expect(
      run({ supply_corridor: true, supply_entry: 'gate', income_zones: [{ zone: 'hill', rate_per_min: 5 }, { zone: 'yard', rate_per_min: 3 }] }),
    ).toEqual([]);
  });
  it('refuses a zone the map does not declare, by name', () => {
    const out = run({ income_zones: [{ zone: 'nowhere', rate_per_min: 5 }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('fixture_m');
    expect(out[0]).toContain('"nowhere"');
  });
  it('refuses a duplicated zone, by name', () => {
    const out = run({ income_zones: [{ zone: 'hill', rate_per_min: 5 }, { zone: 'hill', rate_per_min: 2 }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"hill"');
    expect(out[0]).toContain('more than once');
  });
  it('refuses supply_corridor with no supply_entry', () => {
    const out = run({ supply_corridor: true });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('fixture_m');
    expect(out[0]).toContain('supply_entry');
  });
  it('does not require an entry when supply_corridor is false or absent', () => {
    expect(run({ supply_corridor: false })).toEqual([]);
  });
  it('refuses an entry the map has no marker for, by name', () => {
    const out = run({ supply_corridor: true, supply_entry: 'nope' });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"nope"');
  });
  it('refuses an entry that names a zone but not a marker', () => {
    expect(run({ supply_entry: 'hill' })).toHaveLength(1);
  });
});

describe('every shipped mission passes the income cross-checks', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
  const maps = new Map<string, unknown>();
  for (const f of readdirSync(join(root, 'maps'))) {
    if (!f.endsWith('.json')) continue;
    const m = JSON.parse(readFileSync(join(root, 'maps', f), 'utf8'));
    maps.set(m.id, m);
  }
  const files = readdirSync(join(root, 'missions')).filter((f) => f.endsWith('.json'));
  it('finds the missions and the maps (the loop below is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(maps.size).toBeGreaterThan(5);
  });
  for (const f of files) {
    it(f, () => {
      const m = JSON.parse(readFileSync(join(root, 'missions', f), 'utf8'));
      const mp = maps.get(m.map.file);
      expect(mp, `${f} map`).toBeDefined();
      expect(incomeFailures(m, mp, f)).toEqual([]);
    });
  }
});

describe('the mission schema bounds income_zones at the runtime limit', () => {
  const schema = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'schemas', 'mission.schema.json'), 'utf8'),
  );
  // `Ajv2020` is a CJS default under this loader, as in validate_data.mjs.
  const Ctor = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;
  const validate = new Ctor({ allErrors: true, strict: false }).compile(schema);
  const zones = (n: number) => Array.from({ length: n }, (_, i) => ({ zone: `z${i}`, rate_per_min: 1 }));
  const errorsFor = (n: number) => {
    validate({ id: 'm', resources: { income_zones: zones(n) } });
    return (validate.errors ?? []).filter((e) => e.instancePath === '/resources/income_zones');
  };
  it('32 zones raise no income_zones error, 33 raise maxItems', () => {
    expect(errorsFor(32)).toEqual([]);
    expect(errorsFor(33).map((e) => e.keyword)).toEqual(['maxItems']);
  });
});
