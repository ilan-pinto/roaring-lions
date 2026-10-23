// E6 (GH-274) item 1, G1: the unit schema accepts `demolition_method: "placed"` with its
// `placed_charge` block, and refuses a half-declared pair in either direction. Engine only: no
// shipped unit carries one yet, so these fixtures are the only content the schema sees until the
// Tzav lands out of docs/campaign/special_units/e5/.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): object => JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', f), 'utf8')) as object;
const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => {
  addSchema: (s: object) => unknown;
  compile: (s: object) => (d: unknown) => boolean;
})({ allErrors: true, strict: false });
ajv.addSchema(read('common.schema.json'));
const validateUnit = ajv.compile(read('unit.schema.json'));

const charge = { fuse_s: 8, blast_tiles: 2.5, damage: 300, suppression: 120, withdraw_tiles: 4 };
const base = {
  id: 'probe_placed',
  name: 'Probe',
  faction: 'kdf',
  role: 'engineer',
  cost: { logistics: 100 },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 8 },
  hull: { hp: 2600, armor: { front: 380, side: 200, rear: 120 } },
  abilities: ['demolish'],
  demolition_time_s: 3,
};
const placed = { ...base, demolition_method: 'placed', placed_charge: charge };
const without = (o: Record<string, unknown>, k: string): object => {
  const { [k]: _gone, ...rest } = o;
  return rest;
};

describe('unit schema: placed charge (E6 G1)', () => {
  it('accepts a placed unit with the approved Tzav numbers', () => {
    expect(validateUnit(placed)).toBe(true);
  });

  it('still accepts charges and blade with no block', () => {
    expect(validateUnit({ ...base, demolition_method: 'charges' })).toBe(true);
    expect(validateUnit({ ...base, demolition_method: 'blade' })).toBe(true);
    expect(validateUnit(base)).toBe(true);
  });

  it('refuses method placed with no placed_charge', () => {
    expect(validateUnit(without(placed, 'placed_charge'))).toBe(false);
  });

  it('refuses a placed_charge on a unit whose method is not placed, or absent', () => {
    expect(validateUnit({ ...base, demolition_method: 'charges', placed_charge: charge })).toBe(false);
    expect(validateUnit({ ...base, placed_charge: charge })).toBe(false);
  });

  it('refuses a block missing any of its five numbers, an unknown key, or nonsense', () => {
    for (const k of Object.keys(charge)) {
      expect(validateUnit({ ...placed, placed_charge: without(charge, k) })).toBe(false);
    }
    expect(validateUnit({ ...placed, placed_charge: { ...charge, extra: 1 } })).toBe(false);
    expect(validateUnit({ ...placed, placed_charge: { ...charge, fuse_s: 0 } })).toBe(false);
    expect(validateUnit({ ...placed, placed_charge: { ...charge, blast_tiles: 0 } })).toBe(false);
    expect(validateUnit({ ...placed, placed_charge: { ...charge, damage: -1 } })).toBe(false);
    expect(validateUnit({ ...placed, placed_charge: { ...charge, withdraw_tiles: -1 } })).toBe(false);
  });
});
