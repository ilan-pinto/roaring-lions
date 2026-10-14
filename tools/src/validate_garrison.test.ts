// The garrison rules validate_data cannot leave to runtime (garrison overhaul, 2026-10-14).
// Its own module because validate_data.mjs runs its sweep at import time and exits.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { garrisonWeaponFailures } from '../validate_garrison.mjs';

const ROOT = join(__dirname, '..', '..');
function unitsOnDisk(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const dir of ['data/units/kdf', 'data/units/enemy']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (f.endsWith('.json')) out.push(JSON.parse(readFileSync(join(ROOT, dir, f), 'utf8')));
    }
  }
  return out;
}

describe('garrisonWeaponFailures (G4)', () => {
  const mortar = { id: 'm', abilities: ['garrison'], weapons: [{ id: 'w', type: 'mortar' }] };
  it('refuses an indirect weapon on a garrison-capable unit that does not say it holds fire inside', () => {
    expect(garrisonWeaponFailures(mortar, 'm.json')).toHaveLength(1);
    expect(garrisonWeaponFailures({ ...mortar, weapons: [{ id: 'w', type: 'rocket' }] }, 'm.json')).toHaveLength(1);
  });
  it('passes it once it does, and ignores a unit that cannot garrison', () => {
    expect(garrisonWeaponFailures({ ...mortar, weapons: [{ id: 'w', type: 'mortar', fires_from_building: false }] }, 'm.json')).toEqual([]);
    expect(garrisonWeaponFailures({ ...mortar, abilities: [] }, 'm.json')).toEqual([]);
  });
  it('passes a direct-fire weapon either way', () => {
    expect(garrisonWeaponFailures({ ...mortar, weapons: [{ id: 'w', type: 'atgm' }] }, 'm.json')).toEqual([]);
  });
  it('every shipped unit passes, and mortar_team is the one that needed the flag', () => {
    const all = unitsOnDisk();
    expect(all.flatMap((u) => garrisonWeaponFailures(u, String(u.id)))).toEqual([]);
    const mt = all.find((u) => u.id === 'mortar_team') as { weapons: { fires_from_building?: boolean }[] };
    expect(mt.weapons[0].fires_from_building).toBe(false);
  });
});
