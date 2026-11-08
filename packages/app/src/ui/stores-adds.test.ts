import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { missions as shippedMissions, units, world } from '@lions/data';
import type { MissionJson } from '@lions/sim';
import { coinPrice } from './stores-model';
import { ADDS_TAGS, APP_HEAVY_COLLATERAL, unitAdds, type AddsInput, type AddsTag, type UnitJson, type WeakTag } from './stores-adds';

const HERE = dirname(fileURLToPath(import.meta.url));
const ALL = Object.values(units) as unknown as UnitJson[];
const KDF = ALL.filter((u) => u.faction === 'kdf');
const ENEMIES = ALL.filter((u) => u.faction === 'sarim');
const byId = (id: string): UnitJson => {
  const u = ALL.find((x) => x.id === id);
  if (u === undefined) throw new Error(`no unit ${id}`);
  return u;
};
/** The starting roster (the account's first open set). */
const START = new Set(['apc_eitan', 'at_team', 'inf_squad', 'jeep_shoded', 'mortar_team']);
const WORLD = (world.regions as { towns: { missions: string[] }[] }[]).flatMap((r) => r.towns.flatMap((t) => t.missions));
const MISSIONS = Object.values(shippedMissions) as unknown as MissionJson[];

const input = (id: string | UnitJson, over: Partial<AddsInput> = {}): AddsInput => ({
  unit: typeof id === 'string' ? byId(id) : id,
  kdf: KDF,
  enemies: ENEMIES,
  open: START,
  ownedTiers: {},
  ledger: {},
  missions: MISSIONS,
  worldMissionIds: WORLD,
  versusMenu: new Set(),
  threats: {},
  refusal: () => null,
  ...over,
});

const allTags = (a: ReturnType<typeof unitAdds>): AddsTag[] => [...a.brings.shown.map((s) => s.tag), ...a.brings.more];
const allWeak = (a: ReturnType<typeof unitAdds>): WeakTag[] => [...a.watch.shown, ...a.watch.more];

/** A hard, armed, non-special unit: holds no block B tag and no block C tag but ground-bound. */
const BASE: UnitJson = {
  id: 'fx_base',
  name: 'Fixture',
  role: 'mbt',
  faction: 'kdf',
  hull: { hp: 500, armor: { front: 100, side: 80, rear: 50 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 10 },
  weapons: [{ id: 'gun', type: 'small_arms', range_tiles: 8, accuracy: 0.5, penetration: 10, damage: 10, rof_per_min: 60 }],
} as UnitJson;
const withWeapon = (patch: Record<string, unknown>): UnitJson => ({ ...BASE, weapons: [{ ...BASE.weapons![0], ...patch }] }) as UnitJson;
const tagsOf = (u: UnitJson): AddsTag[] => allTags(unitAdds(input(u, { kdf: [u], open: new Set() })));
const weakOf = (u: UnitJson): WeakTag[] => allWeak(unitAdds(input(u, { kdf: [u], open: new Set() })));

describe('T3 block B: each tag holds on its fixture and not on the same fixture without it', () => {
  const cases: [AddsTag, UnitJson, UnitJson][] = [
    ['heal', { ...BASE, aura: { area: [{ radius: 3, affects: 'foot', heal_per_s: 2 }] } } as UnitJson, { ...BASE, aura: { area: [{ radius: 3, affects: 'foot', heal_per_s: 0 }] } } as UnitJson],
    ['rescue', { ...BASE, rescue: { radius_tiles: 5, treat_s: 4, drag_speed_mult: 0.5, carry_speed_mult: 0.7 } } as UnitJson, BASE],
    ['evacuate', { ...BASE, hull: { ...BASE.hull, transport_slots: 1, can_carry: ['wounded'] } } as UnitJson, { ...BASE, hull: { ...BASE.hull, transport_slots: 1 } } as UnitJson],
    ['transport', { ...BASE, hull: { ...BASE.hull, transport_slots: 3 } } as UnitJson, { ...BASE, hull: { ...BASE.hull, transport_slots: 1, can_carry: ['wounded'] } } as UnitJson],
    ['markTunnel', { ...BASE, abilities: ['mark_tunnel'] } as UnitJson, BASE],
    ['markTarget', { ...BASE, abilities: ['mark_target'] } as UnitJson, BASE],
    ['indirect', withWeapon({ type: 'mortar' }), BASE],
    ['area', withWeapon({ splash_tiles: 2 }), withWeapon({ splash_tiles: 0 })],
    ['coverIgnore', withWeapon({ cover_ignore: 0.5 }), withWeapon({ cover_ignore: 0 })],
    ['beam', withWeapon({ type: 'directed_energy', beam: { dwell_s: 2, heat_s: 10, cooldown_s: 10 } }), BASE],
    ['structure', withWeapon({ can_target: ['ground', 'structure'] }), withWeapon({ can_target: ['ground'] })],
    ['demolish', { ...BASE, abilities: ['demolish'] } as UnitJson, BASE],
    ['construct', { ...BASE, abilities: ['construct'] } as UnitJson, BASE],
    ['smoke', { ...BASE, abilities: ['smoke'] } as UnitJson, BASE],
    ['garrison', { ...BASE, abilities: ['garrison'] } as UnitJson, BASE],
    ['thermal', { ...BASE, sensors: { ...BASE.sensors, thermal: true } } as UnitJson, { ...BASE, sensors: { ...BASE.sensors, thermal: false } } as UnitJson],
    ['crush', { ...BASE, mobility: { ...BASE.mobility, can_crush: true } } as UnitJson, BASE],
    ['engagesAir', withWeapon({ can_target: ['ground', 'air'] }), withWeapon({ can_target: ['ground'] })],
    ['flies', { ...BASE, mobility: { ...BASE.mobility, domain: 'air' } } as UnitJson, BASE],
  ];

  it('covers every tag in ADDS_TAGS exactly once (19)', () => {
    expect(ADDS_TAGS).toHaveLength(19);
    expect(cases.map(([t]) => t).sort()).toEqual([...ADDS_TAGS].sort());
  });
  it.each(cases)('%s', (tag, yes, no) => {
    expect(tagsOf(yes)).toContain(tag);
    expect(tagsOf(no)).not.toContain(tag);
  });
  it('the base fixture holds none of them (so a "without" case proves the predicate, not the base)', () => {
    expect(tagsOf(BASE)).toEqual([]);
  });

  it('over the shipped KDF roster every tag holds on at least one unit and not on all', () => {
    expect(KDF.length).toBeGreaterThanOrEqual(30);
    const held = KDF.map((u) => new Set(allTags(unitAdds(input(u)))));
    for (const tag of ADDS_TAGS) {
      const n = held.filter((s) => s.has(tag)).length;
      expect(n, `${tag} holds on none`).toBeGreaterThan(0);
      expect(n, `${tag} holds on all`).toBeLessThan(KDF.length);
    }
  });
  it('shows the first four in priority order and the rest as more; the transport tag carries its seats', () => {
    const a = unitAdds(input('inf_medic_squad'));
    expect(a.brings.shown.map((s) => s.tag)).toEqual(['heal', 'rescue', 'evacuate', 'smoke']);
    expect(a.brings.more).toEqual(['garrison', 'engagesAir']);
    const apc = unitAdds(input('apc_eitan'));
    expect(apc.brings.shown.find((s) => s.tag === 'transport')?.n).toBeGreaterThan(0);
  });
});

describe('block C: watch-for tags', () => {
  const cases: [WeakTag['kind'], UnitJson, UnitJson][] = [
    ['soft', { ...BASE, hull: { ...BASE.hull, armor: { front: 10, side: 10, rear: 10 } } } as UnitJson, BASE],
    ['unarmed', { ...BASE, weapons: [] }, BASE],
    ['minRange', withWeapon({ min_range_tiles: 6 }), withWeapon({ min_range_tiles: 0 })],
    ['needsSpotter', { ...BASE, sensors: { optics: 1, sight_tiles: 5 } }, BASE],
    ['groundBound', BASE, { ...BASE, mobility: { ...BASE.mobility, domain: 'air' } } as UnitJson],
    ['conduct', withWeapon({ collateral_risk: 0.5 }), withWeapon({ collateral_risk: 0.49 })],
  ];
  it.each(cases)('%s', (kind, yes, no) => {
    expect(weakOf(yes).map((w) => w.kind)).toContain(kind);
    expect(weakOf(no).map((w) => w.kind)).not.toContain(kind);
  });
  it('minRange reports the largest min range; needsSpotter its sight and range', () => {
    const u = { ...BASE, sensors: { optics: 1, sight_tiles: 7 }, weapons: [{ ...BASE.weapons![0], range_tiles: 28, min_range_tiles: 6 }, { ...BASE.weapons![0], id: 'b', range_tiles: 20, min_range_tiles: 3 }] } as UnitJson;
    const w = weakOf(u);
    expect(w).toContainEqual({ kind: 'minRange', n: 6 });
    expect(w).toContainEqual({ kind: 'needsSpotter', sight: 7, range: 28 });
  });
  it('the howitzer on the shipped data reads the spec worked example', () => {
    const kinds = weakOf(byId('spg_long_range')).map((w) => w.kind);
    expect(kinds).toEqual(['minRange', 'needsSpotter', 'groundBound', 'conduct']);
  });
});

describe('T4: the heavy-collateral copy is pinned to the sim source', () => {
  it('APP_HEAVY_COLLATERAL === the raw number in mission.ts / 65536', () => {
    const src = readFileSync(resolve(HERE, '../../../sim/src/mission.ts'), 'utf8');
    const m = /HEAVY_COLLATERAL = (\d+)/.exec(src);
    expect(m, 'the constant moved or was renamed').not.toBeNull();
    expect(APP_HEAVY_COLLATERAL).toBe(Number(m?.[1]) / 65536);
  });
});

describe('T1 block D: the closest unit', () => {
  it('the howitzer compares with the mortar (same role); the medic with the rifle squad (bucket)', () => {
    expect(unitAdds(input('spg_long_range')).compare.against).toBe(byId('mortar_team').name);
    expect(unitAdds(input('inf_medic_squad')).compare.against).toBe(byId('inf_squad').name);
  });
  it('role outranks bucket: an open unit of ANOTHER role in the howitzer bucket and nearer in cost does not win', () => {
    const how = byId('spg_long_range');
    const other = { ...how, id: 'fx_other', name: 'Other', role: 'engineer' } as UnitJson;
    const open = new Set([...START, 'fx_other']);
    const a = unitAdds(input(how, { kdf: [...KDF, other], open }));
    // The fixture is only a test if it shares the bucket and is nearer in cost.
    expect(unitAdds(input(other, { kdf: [...KDF, other], open })).role.bucket).toBe(unitAdds(input(how)).role.bucket);
    expect(Math.abs((other.cost?.logistics ?? 0) - (how.cost?.logistics ?? 0))).toBeLessThan(Math.abs((byId('mortar_team').cost?.logistics ?? 0) - (how.cost?.logistics ?? 0)));
    expect(a.compare.against).toBe(byId('mortar_team').name);
  });
  it('nobody in the role or bucket: against is null and theirs are null', () => {
    const a = unitAdds(input('spg_long_range', { open: new Set() }));
    expect(a.compare.against).toBeNull();
    expect(a.compare.rows.every((r) => r.theirs === null)).toBe(true);
  });
  it('rows are the five stats in order; range is the maximum over weapons', () => {
    const a = unitAdds(input('spg_long_range'));
    expect(a.compare.rows.map((r) => r.stat)).toEqual(['range', 'armourFront', 'hp', 'speed', 'sight']);
    expect(a.compare.rows[0]).toEqual({ stat: 'range', mine: 28, theirs: 18 });
  });
  it('ties go to the smallest cost gap, then to id order', () => {
    const mk = (id: string, logistics: number): UnitJson => ({ ...BASE, id, name: id, cost: { logistics } }) as UnitJson;
    const me = mk('fx_me', 100);
    const a = mk('fx_a', 110);
    const b = mk('fx_b', 90);
    const c = mk('fx_c', 150);
    const open = new Set(['fx_a', 'fx_b', 'fx_c']);
    expect(unitAdds(input(me, { kdf: [me, c, b, a], open })).compare.against).toBe('fx_a');
    expect(unitAdds(input(me, { kdf: [me, c, a], open: new Set(['fx_a', 'fx_c']) })).compare.against).toBe('fx_a');
  });
});

describe('T7: the comparison unit is read at its own owned tiers', () => {
  it('mortar_team at armour tier 2 compares at hp 402 (literal), base 350', () => {
    const hp = (tiers: Record<string, Record<string, number>>) =>
      unitAdds(input('spg_long_range', { ownedTiers: tiers })).compare.rows.find((r) => r.stat === 'hp')?.theirs;
    expect(hp({ mortar_team: { armour: 2 } })).toBe(402);
    expect(hp({})).toBe(350);
  });
});

describe('T6 block E: the gap, over the open set', () => {
  it('the medic is the first support in a starting brigade, new heal and rescue', () => {
    const gap = unitAdds(input('inf_medic_squad')).gap;
    expect(gap[0]).toEqual({ kind: 'firstRole', role: 'support' });
    const fresh = gap.find((g) => g.kind === 'newTags');
    expect(fresh && fresh.kind === 'newTags' ? fresh.tags : []).toEqual(expect.arrayContaining(['heal', 'rescue']));
  });
  it('the howitzer reads reach 28 (+10) and no plusOne', () => {
    const gap = unitAdds(input('spg_long_range')).gap;
    expect(gap).toContainEqual({ kind: 'reach', n: 28, d: 10 });
    expect(gap.some((g) => g.kind === 'plusOne')).toBe(false);
  });
  it('plusOne holds only when nothing else does', () => {
    const a = unitAdds(input('mortar_team', { open: new Set([...START, 'sniper_team', 'recon_drone']) , kdf: KDF }));
    // A second mortar-class unit beats nothing here, so the model has nothing new to say but "+1".
    const twin = { ...byId('mortar_team'), id: 'fx_mortar2', name: 'Mortar 2' } as UnitJson;
    const b = unitAdds(input(twin, { kdf: [...KDF, twin], open: START }));
    expect(b.gap).toEqual([{ kind: 'plusOne', role: 'artillery', name: byId('mortar_team').name }]);
    expect(a.gap.length).toBeLessThanOrEqual(3);
  });
  it('is computed over the open set, never the catalogue', () => {
    // With every KDF unit open the medic is no longer the first support (veh_ambulance is support too).
    const everything = new Set(KDF.map((k) => k.id));
    everything.delete('inf_medic_squad');
    const gap = unitAdds(input('inf_medic_squad', { open: everything })).gap;
    expect(gap.some((g) => g.kind === 'firstRole')).toBe(false);
  });
});

describe('T8 block F: where it can be used', () => {
  const MED: UnitJson = { ...BASE, id: 'fx_med', name: 'Med', role: 'support', unlock: { price: 4000 } } as UnitJson;
  const mission = (id: string, extra: Record<string, unknown>): MissionJson =>
    ({ id, map: { file: 'x' }, ledger: { requires: [], produces: [] }, objectives: [], ...extra }) as unknown as MissionJson;
  const fixtureMissions = [
    mission('m_a', { resources: { logistics_start: 100 }, starting_force: [{ unit: 'fx_med', count: 1 }] }),
    mission('m_b', { starting_force: [{ unit: 'fx_med', count: 1, from_ledger: true }] }),
    mission('m_c', { starting_force: [{ unit: 'inf_squad', count: 2, upgrades_to: 'fx_med' }] }),
    mission('m_d', { resources: { logistics_start: 100 } }),
  ];
  const where = (over: Partial<AddsInput> = {}) =>
    unitAdds(input(MED, { kdf: [MED], missions: fixtureMissions, worldMissionIds: ['m_a', 'm_b', 'm_c', 'm_d'], ...over })).where;

  it('on loan counts only placements that are not the brigade body: 1 of 2', () => {
    expect(where()).toContainEqual({ kind: 'loaned', n: 1 });
  });
  it('the dock counts missions with resources only (2 of 4), and only world missions', () => {
    expect(where()).toContainEqual({ kind: 'dock', n: 2 });
    expect(where({ worldMissionIds: ['m_a'] })).toContainEqual({ kind: 'dock', n: 1 });
    expect(where({ missions: [fixtureMissions[1]], worldMissionIds: ['m_b'] }).some((w) => w.kind === 'dock')).toBe(false);
  });
  it('an upgrades_to placement reads fieldedAs', () => {
    expect(where()).toContainEqual({ kind: 'fieldedAs', base: 'inf_squad', mission: 'm_c' });
  });
  it('once the unit is open the placements are no longer loans', () => {
    expect(where({ open: new Set(['fx_med']) }).some((w) => w.kind === 'loaned')).toBe(false);
  });
  it('a reinforce trigger placement on loan counts for its mission', () => {
    const t = mission('m_t', { triggers: [{ on: { kind: 'timer_s', value: 5 }, do: { kind: 'reinforce', units: [{ unit: 'fx_med', count: 1 }] } }] });
    expect(where({ missions: [t], worldMissionIds: ['m_t'] })).toContainEqual({ kind: 'loaned', n: 1 });
  });
  it('the shipped medic is on loan in many missions on a starting ledger', () => {
    const w = unitAdds(input('inf_medic_squad')).where;
    const loaned = w.find((x) => x.kind === 'loaned');
    expect(loaned && loaned.kind === 'loaned' ? loaned.n : 0).toBeGreaterThan(20);
  });
  it('a priced unit says the coin rule once', () => {
    expect(where().filter((w) => w.kind === 'coinsSinglePlayer')).toHaveLength(1);
    expect(unitAdds(input('inf_squad')).where.some((w) => w.kind === 'coinsSinglePlayer')).toBe(false);
  });
});

describe('R0.8: the versus line follows the injected refusal', () => {
  const refuse = (id: string) => (id === 'spg_cluster' ? 'refused' : null);
  const lines = (id: string, over: Partial<AddsInput> = {}) =>
    unitAdds(input(id, { refusal: refuse, ...over })).where.map((w) => w.kind);
  it('a bought-only unit that is not refused joins a brigade room', () => {
    const k = lines('spg_long_range');
    expect(k).toContain('brigadeRoom');
    expect(k).not.toContain('campaignOnly');
  });
  it('a refused bought-only unit is campaign only', () => {
    const k = lines('spg_cluster');
    expect(k).toContain('campaignOnly');
    expect(k).not.toContain('brigadeRoom');
  });
  it('an earned unit on the menu shows versus and no brigadeRoom', () => {
    const k = lines('inf_squad', { versusMenu: new Set(['inf_squad']) });
    expect(k).toContain('versus');
    expect(k).not.toContain('brigadeRoom');
    expect(k).not.toContain('campaignOnly');
  });
  it('a held unit on the menu is not versus (VERSUS_HELD_UNITS)', () => {
    expect(lines('mbt_lavi_camo', { versusMenu: new Set(['mbt_lavi_camo']) })).not.toContain('versus');
  });
  it('an earned unit on no menu is campaign only', () => {
    expect(lines('at_team')).toContain('campaignOnly');
  });
});

describe('T9 block G: the credit and coin totals', () => {
  const tier = (price: number) => ({ price, patch: { 'hull.hp': 10 } });
  const U: UnitJson = { ...BASE, id: 'fx_t', upgrades: { armour: { tiers: [tier(160), tier(240), tier(340)] } } } as UnitJson;
  it('credits are the sum; coins are the sum of each tier coin price, which differs from coinPrice(sum)', () => {
    const g = unitAdds(input(U, { kdf: [U] })).upgrades;
    expect(g).toEqual({ tracks: ['armour'], tiers: 3, credits: 740, coins: 80 });
    expect(coinPrice(740)).toBe(75);
    expect(g?.coins).not.toBe(coinPrice(740));
  });
  it('a unit with no tracks is null', () => {
    expect(unitAdds(input(BASE, { kdf: [BASE] })).upgrades).toBeNull();
  });
});

describe('Hurt by', () => {
  const foe = (id: string, role: string, armed = true): UnitJson =>
    ({ ...BASE, id, name: id.toUpperCase(), role, faction: 'sarim', weapons: armed ? BASE.weapons : [] }) as UnitJson;
  const enemies = [foe('atgm_cell', 'at_team'), foe('rpg_team', 'at_team'), foe('sarim_rifles', 'infantry'), foe('mortar_crew', 'artillery'), foe('wounded_sarim', 'wounded'), foe('cart', 'support', false)];
  it('groups the threat table entries by role; shrugs off the rest; skips wounded and unarmed', () => {
    const h = unitAdds(input(BASE, { kdf: [BASE], enemies, threats: { fx_base: ['atgm_cell', 'rpg_team', 'mortar_crew', 'wounded_sarim'] } })).hurtBy;
    expect(h?.groups).toEqual([
      { role: 'artillery', names: ['MORTAR_CREW'] },
      { role: 'at_team', names: ['ATGM_CELL', 'RPG_TEAM'] },
    ]);
    expect(h?.moreGroups).toBe(0);
    expect(h?.shrugs).toEqual(['SARIM_RIFLES']);
  });
  it('is null for a soft unit', () => {
    const soft = { ...BASE, hull: { ...BASE.hull, armor: { front: 10, side: 10, rear: 10 } } } as UnitJson;
    expect(unitAdds(input(soft, { kdf: [soft], enemies, threats: { fx_base: ['atgm_cell'] } })).hurtBy).toBeNull();
  });
  it('caps at three groups and counts the rest', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((r) => foe(`f_${r}`, `role_${r}`));
    const h = unitAdds(input(BASE, { kdf: [BASE], enemies: many, threats: { fx_base: many.map((m) => m.id) } })).hurtBy;
    expect(h?.groups).toHaveLength(3);
    expect(h?.moreGroups).toBe(2);
  });
  it('the threat literal: a table naming atgm_cell puts the Kornet team in a group', () => {
    const h = unitAdds(input('mbt_lavi', { threats: { mbt_lavi: ['atgm_cell'] } })).hurtBy;
    expect(h?.groups.flatMap((g) => g.names)).toEqual([byId('atgm_cell').name]);
    expect(h?.shrugs).not.toContain(byId('atgm_cell').name);
    expect(h?.shrugs).not.toContain(byId('wounded_sarim').name);
  });
});

describe('no unit id in the model source', () => {
  it('stores-adds.ts names none of the KDF ids (the loop cannot pass empty)', () => {
    const ids = KDF.map((u) => u.id);
    expect(ids.length).toBeGreaterThanOrEqual(30);
    const src = readFileSync(resolve(HERE, 'stores-adds.ts'), 'utf8');
    const found = ids.filter((id) => new RegExp(`\\b${id}\\b`).test(src));
    expect(found).toEqual([]);
  });
});
