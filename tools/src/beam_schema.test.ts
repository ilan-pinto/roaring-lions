// E6 (GH-274) item 3: the unit schema accepts a `directed_energy` weapon with its `beam` block
// and refuses a half-declared pair in either direction. Engine only: no shipped unit carries one
// (aa_gachelet is built elsewhere), so these fixtures are the only content the schema sees.
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

const beam = { dwell_s: 1.5, heat_s: 12, cooldown_s: 6 };
const weapon = {
  id: 'beam', type: 'directed_energy', range_tiles: 9, accuracy: 1, penetration: 5, damage: 80,
  rof_per_min: 40, can_target: ['air'], collateral_risk: 0, beam,
};
const unit = (w: object): object => ({
  id: 'probe_beam', name: 'Probe', faction: 'kdf', role: 'aa',
  cost: { logistics: 350 },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1.4, sight_tiles: 12 },
  hull: { hp: 1100, armor: { front: 40, side: 25, rear: 20 } },
  weapons: [w],
});
const without = (o: Record<string, unknown>, k: string): object => {
  const rest = { ...o };
  delete rest[k];
  return rest;
};

describe('unit schema: directed energy and the beam block (E6 item 3)', () => {
  it('accepts the approved beam numbers', () => {
    expect(validateUnit(unit(weapon))).toBe(true);
  });

  it('refuses a directed_energy weapon with no beam block', () => {
    expect(validateUnit(unit(without(weapon, 'beam')))).toBe(false);
  });

  it('refuses a beam block on any other weapon type', () => {
    expect(validateUnit(unit({ ...weapon, type: 'small_arms' }))).toBe(false);
    expect(validateUnit(unit({ ...without(weapon, 'beam'), type: 'small_arms' }))).toBe(true);
  });

  it('refuses a beam with no can_target, indirect fire or submunitions', () => {
    expect(validateUnit(unit(without(weapon, 'can_target')))).toBe(false);
    expect(validateUnit(unit({ ...weapon, indirect: true }))).toBe(false);
    expect(validateUnit(unit({ ...weapon, submunitions: { count: 2, scatter_tiles: 1, damage: 5, splash_tiles: 1 } }))).toBe(false);
  });

  it('refuses a block missing any of its three numbers, an unknown key, or nonsense', () => {
    for (const k of Object.keys(beam)) {
      expect(validateUnit(unit({ ...weapon, beam: without(beam, k) }))).toBe(false);
    }
    expect(validateUnit(unit({ ...weapon, beam: { ...beam, extra: 1 } }))).toBe(false);
    expect(validateUnit(unit({ ...weapon, beam: { ...beam, dwell_s: 0 } }))).toBe(false);
    expect(validateUnit(unit({ ...weapon, beam: { ...beam, heat_s: -1 } }))).toBe(false);
    expect(validateUnit(unit({ ...weapon, beam: { ...beam, cooldown_s: 0 } }))).toBe(false);
  });
});
