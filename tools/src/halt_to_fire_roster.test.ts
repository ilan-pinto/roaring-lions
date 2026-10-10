// Who halts to fire, read off the SHIPPED roster (spec
// docs/superpowers/specs/2026-10-05-infantry-halt-to-fire.md §1).
//
// The derivation lives in `unitTypeFromJson` and is unit-tested there against
// fixtures. This pins what it does to the real data, as one exact list, so a new
// unit that lands on the wrong side -- a foot team authored without weapons, a
// truck authored without `wheeled`, a drone without `domain: "air"` -- changes
// this list and has to be looked at. The expected list is a literal, not a
// filter over the roster: computing it from the roster would agree with any
// derivation whatsoever.
//
// packages/sim imports nothing and packages/data is a leaf, so tools/ is the
// only place that may hold both ends of this.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { unitTypeFromJson, type UnitTypeJson } from '../../packages/sim/src/sim';

const HALTS_TO_FIRE = [
  'at_team',
  'atgm_cell',
  'breach_team',
  'demo_squad',
  'inf_squad',
  'manpad_team',
  'militia_cell',
  'mortar_crew',
  'mortar_team',
  'recoilless_team',
  'recon_zikit',
  'rpg_team',
  'sarim_rifles',
  'sniper_team',
  'yahalom_squad',
];

describe('halt to fire on the shipped roster', () => {
  const all = Object.values(units) as UnitTypeJson[];

  it('is exactly the armed foot units, and nothing else', () => {
    const got = all
      .filter((u) => unitTypeFromJson(u).haltsToFire)
      .map((u) => u.id)
      .sort();
    expect(got).toEqual(HALTS_TO_FIRE);
  });

  it('excludes the units a role or a flag might drag in', () => {
    const byId = new Map(all.map((u) => [u.id, u]));
    const halts = (id: string) => {
      const u = byId.get(id);
      if (u === undefined) throw new Error(`no unit ${id} on the roster`);
      return unitTypeFromJson(u).haltsToFire;
    };
    // The vest is the attack: no aimed shot to kneel for.
    expect(halts('charge_squad')).toBe(false);
    // role "artillery", like the mortar teams, but a Grad on a truck.
    expect(halts('rocket_battery')).toBe(false);
    // role "support", like breach_team, but it flies.
    expect(halts('paramotor')).toBe(false);
    // Foot and unarmed.
    expect(halts('digger_crew')).toBe(false);
    expect(halts('civilians')).toBe(false);
    // role "aa": the derivation calls it wheeled, so it is the one override.
    expect(byId.get('manpad_team')?.mobility.halts_to_fire).toBe(true);
  });
});
