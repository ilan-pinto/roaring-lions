// The panel hands the model the FULL enemy roster (data/units/enemy), and never offers the wounded casualty as owned.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { addsInput } from './stores-adds-view';
import type { StoreInput } from './stores-model';

const DIR = resolve(__dirname, '../../../../data/units/enemy');
const enemyIds = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => (JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as { id: string }).id)
  .sort();

const store = (over: Partial<StoreInput> = {}): StoreInput => ({ units: [], ledger: {}, credits: 0, owned: {}, ...over });

describe('addsInput', () => {
  it('passes every file of data/units/enemy as `enemies`, not the sarim subset', () => {
    expect(enemyIds.length).toBeGreaterThanOrEqual(17);
    const a = addsInput('mbt_lavi', store());
    expect(a).not.toBeNull();
    expect(a!.enemies.map((e) => e.id).sort()).toEqual(enemyIds);
    expect(a!.enemies.some((e) => e.faction !== 'sarim')).toBe(true);
  });

  it('never counts wounded_kdf as open', () => {
    const w = units.wounded_kdf as { id: string; name: string };
    const a = addsInput('mbt_lavi', store({ units: [{ id: w.id, name: w.name }], owned: {} }));
    expect(a!.open.has('wounded_kdf')).toBe(false);
  });
});
