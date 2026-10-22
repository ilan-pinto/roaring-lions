// E1 (GH-709): the unit schema accepts a unit `aura` (the field-works area shape plus the
// unit-only `affects: "passengers"` and `stationary`) and the structure schema still refuses
// both unit-only parts. Engine only: no shipped unit carries an aura, so these fixtures are
// the only content the schema sees until the medic trio lands.
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
const validateStructures = ajv.compile(read('structure.schema.json'));

const base = {
  name: 'Probe',
  faction: 'kdf',
  cost: { logistics: 100 },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8 },
  hull: { hp: 360, armor: { front: 10, side: 10, rear: 10 } },
};
const medic = {
  ...base,
  id: 'probe_medic',
  role: 'support',
  aura: { area: [{ radius: 2.5, affects: 'foot', heal_per_s: 0.02, heal_cap: 1.0, stationary: true }] },
};
const medevac = {
  ...base,
  id: 'probe_medevac',
  role: 'apc',
  mobility: { speed_tiles_s: 3, domain: 'air' },
  hull: { hp: 800, armor: { front: 32, side: 20, rear: 14 }, transport_slots: 4 },
  aura: { area: [{ radius: 1, affects: 'passengers', heal_per_s: 0.03 }] },
};
const withEffect = (e: object): object => ({ ...medic, aura: { area: [{ radius: 2.5, affects: 'foot', ...e }] } });
const structures = (e: object): object => ({
  types: {
    probe_station: {
      id: 'probe_station',
      symbol: 'P',
      hp_per_tile: 200,
      aura: { area: [{ radius: 4, affects: 'foot', heal_per_s: 0.01, ...e }] },
    },
  },
});

describe('unit schema: aura (E1)', () => {
  it('accepts the medic (area, stationary) and the medevac (passengers)', () => {
    expect(validateUnit(medic)).toBe(true);
    expect(validateUnit(medevac)).toBe(true);
  });
  it('refuses an empty area, an unknown key, an unknown affects and a cap under 0.7', () => {
    expect(validateUnit({ ...medic, aura: { area: [] } })).toBe(false);
    expect(validateUnit({ ...medic, aura: {} })).toBe(false);
    expect(validateUnit(withEffect({ repair_components_s: 30 }))).toBe(false);
    expect(validateUnit({ ...medic, aura: { area: [{ radius: 2, affects: 'air' }] } })).toBe(false);
    expect(validateUnit(withEffect({ heal_per_s: 0.02, heal_cap: 0.5 }))).toBe(false);
    expect(validateUnit(withEffect({ radius: 13 }))).toBe(false);
  });
});

describe('structure schema: the unit-only parts stay refused', () => {
  it('accepts the shipped station shape (the control)', () => {
    expect(validateStructures(structures({}))).toBe(true);
  });
  it('refuses affects passengers and a stationary flag', () => {
    expect(validateStructures(structures({ affects: 'passengers' }))).toBe(false);
    expect(validateStructures(structures({ stationary: true }))).toBe(false);
  });
});
