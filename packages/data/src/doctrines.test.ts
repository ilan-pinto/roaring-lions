// GH-1383 slice 1: resolveDoctrine / applyDoctrine against the six shipped picks. Every oracle here is a LITERAL
// (CLAUDE.md: an oracle takes literals, never values imported from the code under test); the picks themselves are
// the input.
import { describe, expect, it } from 'vitest';
import { applyDoctrine, resolveDoctrine, type DoctrinePickJson } from './doctrines';
import { doctrinePicks, doctrines, units } from './index';

const pick = (id: string): DoctrinePickJson => {
  const p = doctrinePicks[id];
  if (p === undefined) throw new Error(`no pick ${id}`);
  return p;
};
const unit = (id: string) => {
  const u = (units as Record<string, { id: string; cost: { logistics: number; population?: number } }>)[id];
  if (u === undefined) throw new Error(`no unit ${id}`);
  return u;
};

describe('resolveDoctrine(base, null) is the base, by reference', () => {
  it('returns the base menu array itself and the base cap and purse', () => {
    for (const base of [doctrines.kdf, doctrines.sarim]) {
      const r = resolveDoctrine(base, null);
      expect(r.menu).toBe(base.menu);
      expect(r.id).toBeNull();
      expect(r.signature).toBeNull();
      expect(r.prices).toEqual({});
    }
    expect(resolveDoctrine(doctrines.kdf, null).popCap).toBe(40);
    expect(resolveDoctrine(doctrines.sarim, null).popCap).toBe(56);
    expect(resolveDoctrine(doctrines.kdf, null).logisticsStart).toBe(1500);
    expect(resolveDoctrine(doctrines.sarim, null).logisticsStart).toBe(2400);
  });

  it('applyDoctrine under no pick returns every shipped unit itself (toBe, not toEqual)', () => {
    const all = Object.values(units) as { id: string; cost: { logistics: number } }[];
    expect(all.length).toBeGreaterThan(40);
    for (const base of [doctrines.kdf, doctrines.sarim]) {
      const r = resolveDoctrine(base, null);
      for (const u of all) expect(applyDoctrine(u, r)).toBe(u);
    }
  });
});

describe('the six shipped picks resolve to these menus, caps, prices and signatures', () => {
  const cases: [string, 'kdf' | 'sarim', string[], number, Record<string, number>, string][] = [
    [
      'kdf_armour',
      'kdf',
      ['mbt_lavi', 'ifv_namer', 'apc_eitan', 'inf_squad', 'at_team', 'mortar_team', 'recon_drone', 'dozer_d9', 'inf_medic_squad', 'apc_kipod'],
      42,
      { at_team: 245, ifv_namer: 605, inf_squad: 308, mbt_lavi: 860 },
      'kdf_armour_thrust',
    ],
    [
      'kdf_airmobile',
      'kdf',
      ['ifv_namer', 'apc_eitan', 'inf_squad', 'at_team', 'mortar_team', 'jeep_shoded', 'recon_drone', 'heli_peten', 'yahalom_squad', 'inf_medic_squad', 'scout_shachaf', 'sniper_team'],
      35,
      { apc_eitan: 525, heli_peten: 375, ifv_namer: 665, jeep_shoded: 300 },
      'kdf_airmobile_cover',
    ],
    [
      'kdf_urban',
      'kdf',
      ['mbt_lavi', 'apc_eitan', 'inf_squad', 'at_team', 'mortar_team', 'jeep_shoded', 'recon_drone', 'dozer_d9', 'yahalom_squad', 'inf_medic_squad', 'breach_team', 'demo_squad'],
      35,
      { breach_team: 290, demo_squad: 283, mbt_lavi: 915 },
      'kdf_urban_casualty',
    ],
    [
      'sarim_standoff',
      'sarim',
      ['sarim_rifles', 'atgm_cell', 'manpad_team', 'rocket_battery', 'recoilless_team', 'mortar_crew'],
      56,
      { atgm_cell: 222, sarim_rifles: 355 },
      'sarim_standoff_screen',
    ],
    [
      'sarim_raid',
      'sarim',
      ['sarim_rifles', 'gun_truck', 'manpad_team', 'recoilless_team', 'technical', 'moto_rpg'],
      44,
      { gun_truck: 345, manpad_team: 218, technical: 315 },
      'sarim_raid_column',
    ],
    [
      'sarim_militia',
      'sarim',
      ['sarim_rifles', 'atgm_cell', 'gun_truck', 'recoilless_team', 'militia_cell', 'rpg_team'],
      44,
      { militia_cell: 258, recoilless_team: 212, sarim_rifles: 345 },
      'sarim_militia_swarm',
    ],
  ];

  for (const [id, faction, menu, cap, prices, signature] of cases) {
    it(id, () => {
      const r = resolveDoctrine(doctrines[faction], pick(id));
      expect(r.id).toBe(id);
      expect(r.faction).toBe(faction);
      expect(r.menu).toEqual(menu);
      expect(r.popCap).toBe(cap);
      expect(r.prices).toEqual(prices);
      expect(r.signature).toBe(signature);
      // No purse op in v1 (the lead's Q5): the purse is the base's.
      expect(r.logisticsStart).toBe(faction === 'kdf' ? 1500 : 2400);
    });
  }
});

describe('applyDoctrine', () => {
  const armour = resolveDoctrine(doctrines.kdf, pick('kdf_armour'));

  it('writes a priced unit cost.logistics and nothing else, on a copy', () => {
    const lavi = unit('mbt_lavi');
    const was = JSON.stringify(lavi);
    const fielded = applyDoctrine(lavi, armour);
    expect(fielded).not.toBe(lavi);
    expect(fielded.cost.logistics).toBe(860);
    expect(lavi.cost.logistics).toBe(906);
    expect(JSON.stringify(lavi)).toBe(was);
    // Population is the one cost field the sim reads (sim.ts): a doctrine never writes it.
    expect(fielded.cost.population).toBe(3);
    expect({ ...fielded, cost: { ...fielded.cost, logistics: 906 } }).toEqual(lavi);
    expect(applyDoctrine(unit('inf_squad'), armour).cost.logistics).toBe(308);
  });

  it('returns a unit no set_price names itself, on the menu or off it', () => {
    for (const id of ['apc_eitan', 'apc_kipod', 'heli_peten', 'sarim_rifles']) expect(applyDoctrine(unit(id), armour)).toBe(unit(id));
  });
});

describe('resolveDoctrine refuses a pick that does not fit its base', () => {
  const withOps = (p: DoctrinePickJson, ops: DoctrinePickJson['ops']): DoctrinePickJson => ({ ...p, ops });

  it('another faction', () => {
    expect(() => resolveDoctrine(doctrines.sarim, pick('kdf_armour'))).toThrow(/extends "kdf", not "sarim"/);
  });

  it('a removal not on the menu, an addition already on it, a price off the resolved menu', () => {
    const p = pick('kdf_armour');
    expect(() => resolveDoctrine(doctrines.kdf, withOps(p, [{ op: 'menu_remove', units: ['apc_kipod'] }]))).toThrow(/menu_remove "apc_kipod"/);
    expect(() => resolveDoctrine(doctrines.kdf, withOps(p, [{ op: 'menu_add', units: ['mbt_lavi'] }]))).toThrow(/menu_add "mbt_lavi"/);
    expect(() =>
      resolveDoctrine(doctrines.kdf, withOps(p, [{ op: 'menu_remove', units: ['heli_peten'] }, { op: 'set_price', unit: 'heli_peten', logistics: 400 }])),
    ).toThrow(/set_price "heli_peten"/);
  });
});
