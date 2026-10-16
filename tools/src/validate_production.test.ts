// F4 (GH-183) Task 7: the production cross-checks, on literal fixtures (each rule seen red) and on the shipped tree.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { MAX_PRODUCTION_LINES as SIM_MAX } from '@lions/sim';
import { MAX_PRODUCTION_LINES, productionFailures, productionRuleFailures } from '../validate_production.mjs';

const catalogue = {
  types: {
    camp: { symbol: 'c', produces_for: 0 },
    house: { symbol: 'h' },
    fence: { symbol: 'f', per_tile: true },
  },
};
const mapWith = (rows: string[] = ['....', '....']) => ({ rows, markers: { rally_a: [1, 1] }, zones: {} });
const enemyUnits = new Map<string, unknown>([
  ['sarim_rifles', { id: 'sarim_rifles', cost: { logistics: 340 } }],
  ['spy', { id: 'spy', cost: { logistics: 100, intel: 5 } }],
]);
const camp1 = { type: 'camp', at: [0, 0], side: 1 };
const run = (m: Record<string, unknown>, map = mapWith()) =>
  productionRuleFailures({ id: 'fx_m', map: { file: 'm' }, ...m }, map, catalogue, enemyUnits, 'fx.json');

describe('productionFailures on fixtures', () => {
  it('passes a mission with neither field', () => {
    expect(run({})).toEqual([]);
    expect(run({ structures: [{ type: 'camp', at: [0, 0] }] })).toEqual([]);
  });
  it('passes a side-1 camp with a clean menu and a declared rally', () => {
    expect(run({ structures: [camp1], enemy: { production: { menu: ['sarim_rifles'], rally: 'rally_a' } } })).toEqual([]);
  });
  it('refuses a menu unit that is not an enemy unit, by name', () => {
    const out = run({ structures: [camp1], enemy: { production: { menu: ['inf_squad'] } } });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"inf_squad"');
    expect(out[0]).toContain('data/units/enemy/');
  });
  it('refuses a menu unit that costs intel', () => {
    const out = run({ structures: [camp1], enemy: { production: { menu: ['spy'] } } });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('intel');
  });
  it('refuses a rally the map does not declare', () => {
    const out = run({ structures: [camp1], enemy: { production: { menu: ['sarim_rifles'], rally: 'nowhere' } } });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"nowhere"');
  });
  it('refuses a menu with no side-1 camp in structures, by name', () => {
    for (const structures of [undefined, [], [{ type: 'camp', at: [0, 0] }], [{ type: 'house', at: [0, 0] }]]) {
      const out = run({ ...(structures !== undefined ? { structures } : {}), enemy: { production: { menu: ['sarim_rifles'] } } });
      expect(out, JSON.stringify(structures)).toHaveLength(1);
      expect(out[0]).toContain('no side-1 production structure');
    }
  });
  it('counts a non-camp type given side 1 as a side-1 camp', () => {
    expect(run({ structures: [{ type: 'house', at: [0, 0], side: 1 }], enemy: { production: { menu: ['sarim_rifles'] } } })).toEqual([]);
  });
  it('refuses more than 4 production structures for one side, grid and structures alike', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ type: 'camp', at: [i * 3, 0] }));
    const a = run({ structures: five });
    expect(a).toHaveLength(1);
    expect(a[0]).toContain('5 production structures for side 0');
    expect(run({ structures: five.slice(0, 4) })).toEqual([]);
    // Grid: three separate `c` blocks plus two structures make five for side 0.
    const grid = mapWith(['cc.cc.cc', 'cc.cc.cc']);
    const b = run({ structures: five.slice(0, 2) }, grid);
    expect(b).toHaveLength(1);
    expect(b[0]).toContain('5 production structures for side 0');
    expect(run({ structures: five.slice(0, 1) }, grid)).toEqual([]);
    // One connected block is one structure.
    expect(run({}, mapWith(['cccccc', 'cccccc']))).toEqual([]);
    // Side 1 counts its own bound.
    const six = Array.from({ length: 5 }, (_, i) => ({ type: 'camp', at: [i * 3, 0], side: 1 }));
    expect(run({ structures: six })[0]).toContain('side 1');
  });
  it('refuses any enemy.production while D7 stands, naming D7 and R-F4-5', () => {
    const m = { id: 'fx_m', map: { file: 'm' }, structures: [camp1], enemy: { production: { menu: ['sarim_rifles'], rally: 'rally_a' } } };
    expect(productionRuleFailures(m, mapWith(), catalogue, enemyUnits, 'fx.json')).toEqual([]);
    const out = productionFailures(m, mapWith(), catalogue, enemyUnits, 'fx.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('D7');
    expect(out[0]).toContain('R-F4-5');
    expect(out[0]).toContain('answers KDF only');
    expect(productionFailures({ id: 'fx_m', map: { file: 'm' } }, mapWith(), catalogue, enemyUnits, 'fx.json')).toEqual([]);
  });
  it('pins the bound to the sim\'s', () => {
    expect(MAX_PRODUCTION_LINES).toBe(SIM_MAX);
  });
});

describe('every shipped mission passes the production cross-checks', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
  const maps = new Map<string, unknown>();
  for (const f of readdirSync(join(root, 'maps'))) {
    if (!f.endsWith('.json')) continue;
    const m = JSON.parse(readFileSync(join(root, 'maps', f), 'utf8'));
    maps.set(m.id, m);
  }
  const cat = JSON.parse(readFileSync(join(root, 'structures.json'), 'utf8'));
  const enemy = new Map<string, unknown>();
  for (const f of readdirSync(join(root, 'units', 'enemy'))) {
    if (!f.endsWith('.json')) continue;
    const u = JSON.parse(readFileSync(join(root, 'units', 'enemy', f), 'utf8'));
    enemy.set(u.id, u);
  }
  const files = readdirSync(join(root, 'missions')).filter((f) => f.endsWith('.json'));
  it('finds the missions, maps and enemy units (the loop below is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(maps.size).toBeGreaterThan(5);
    expect(enemy.size).toBeGreaterThan(5);
  });
  for (const f of files) {
    it(f, () => {
      const m = JSON.parse(readFileSync(join(root, 'missions', f), 'utf8'));
      expect(productionFailures(m, maps.get(m.map.file), cat, enemy, f)).toEqual([]);
    });
  }
});

describe('the mission schema types structures[].side and enemy.production', () => {
  const schema = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'schemas', 'mission.schema.json'), 'utf8'),
  );
  const Ctor = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;
  const validate = new Ctor({ allErrors: true, strict: false }).compile(schema);
  const errs = (m: Record<string, unknown>, prefix: string) => {
    validate({ id: 'm', ...m });
    return (validate.errors ?? []).filter((e) => e.instancePath.startsWith(prefix));
  };
  it('side accepts 0 and 1 and refuses 2', () => {
    expect(errs({ structures: [{ type: 'camp', at: [0, 0], side: 1 }] }, '/structures')).toEqual([]);
    expect(errs({ structures: [{ type: 'camp', at: [0, 0], side: 2 }] }, '/structures').length).toBeGreaterThan(0);
  });
  it('production needs a menu, bounds logistics_start and refuses `tag`', () => {
    const ok = { menu: ['sarim_rifles'], logistics_start: 894784, logistics_rate_per_min: 30, rally: 'r', group: 'g' };
    expect(errs({ enemy: { production: ok } }, '/enemy')).toEqual([]);
    expect(errs({ enemy: { production: {} } }, '/enemy').length).toBeGreaterThan(0);
    expect(errs({ enemy: { production: { menu: [] } } }, '/enemy').length).toBeGreaterThan(0);
    expect(errs({ enemy: { production: { ...ok, logistics_start: 894785 } } }, '/enemy').length).toBeGreaterThan(0);
    expect(errs({ enemy: { production: { ...ok, tag: 'x' } } }, '/enemy').length).toBeGreaterThan(0);
  });
});
