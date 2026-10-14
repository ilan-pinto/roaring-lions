// The garrison rules validate_data cannot leave to runtime (garrison overhaul, 2026-10-14).
// Its own module because validate_data.mjs runs its sweep at import time and exits.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { garrisonStanceFailures, garrisonWeaponFailures } from '../validate_garrison.mjs';

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

function missionsOnDisk(): Record<string, unknown>[] {
  return readdirSync(join(ROOT, 'data/missions'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(ROOT, 'data/missions', f), 'utf8')));
}

describe('garrisonStanceFailures (B2)', () => {
  const units = new Map<string, { abilities?: string[] }>([
    ['can', { abilities: ['garrison'] }],
    ['cannot', { abilities: [] }],
  ]);
  const at = (unit: string) => ({ unit, count: 1, at: [3, 3], stance: { kind: 'garrison', building: [3, 3] } });
  it('refuses a garrison stance on a unit without the ability, wherever the placement sits', () => {
    expect(garrisonStanceFailures({ enemy: { garrison: [at('cannot')] } }, units, 'm')).toHaveLength(1);
    expect(garrisonStanceFailures({ enemy: { waves: [{ units: [at('cannot')] }] } }, units, 'm')).toHaveLength(1);
    expect(garrisonStanceFailures({ triggers: [{ do: { kind: 'spawn', units: [at('cannot')] } }] }, units, 'm')).toHaveLength(1);
    expect(garrisonStanceFailures({ starting_force: [at('cannot')] }, units, 'm')).toHaveLength(1);
  });
  it('passes one with it, and a placement with another stance', () => {
    expect(garrisonStanceFailures({ enemy: { garrison: [at('can')] } }, units, 'm')).toEqual([]);
    expect(garrisonStanceFailures({ enemy: { garrison: [{ ...at('cannot'), stance: { kind: 'hold_position' } }] } }, units, 'm')).toEqual([]);
  });
  it('every shipped mission passes', () => {
    const byId = new Map(unitsOnDisk().map((u) => [String(u.id), u as { abilities?: string[] }]));
    expect(missionsOnDisk().flatMap((m) => garrisonStanceFailures(m, byId, String(m.id)))).toEqual([]);
  });
});
