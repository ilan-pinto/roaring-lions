import { describe, expect, it } from 'vitest';
import { doctrines, maps, versusMissionOf, versusRules, versusZonesOf } from './index';

describe('the exports', () => {
  it('doctrines are the two shipped files, keyed by faction, with the Q4 caps', () => {
    expect(Object.keys(doctrines).sort()).toEqual(['kdf', 'sarim']);
    expect(doctrines.kdf.faction).toBe('kdf');
    expect(doctrines.sarim.faction).toBe('sarim');
    expect(doctrines.kdf.pop_cap).toBe(40);
    expect(doctrines.sarim.pop_cap).toBe(56);
  });
  it('versusRules has one file per matchup map, keyed by map id', () => {
    expect(Object.keys(versusRules).sort()).toEqual(['tel_marum', 'wadi_tarfan']);
    for (const [id, r] of Object.entries(versusRules)) expect(r.map).toBe(id);
  });
});

describe('versusMissionOf', () => {
  const rules = versusRules.wadi_tarfan;
  it('lists side 0\'s camp first whichever end it stands on', () => {
    const a = versusMissionOf(rules, { friendly: 0, hostile: 1 });
    expect(a.structures.map((s) => s.side)).toEqual([0, 1]);
    expect(a.structures[0].at).toEqual([...rules.ends.friendly.camp.at]);
    const b = versusMissionOf(rules, { friendly: 1, hostile: 0 });
    expect(b.structures.map((s) => s.side)).toEqual([0, 1]);
    expect(b.structures[0].at).toEqual([...rules.ends.hostile.camp.at]);
    expect(b.structures[1].at).toEqual([...rules.ends.friendly.camp.at]);
  });
  it('returns exactly the six keys the runtime needs and authors no objective', () => {
    const m = versusMissionOf(rules, { friendly: 0, hostile: 1 });
    expect(Object.keys(m).sort()).toEqual(['id', 'ledger', 'map', 'objectives', 'resources', 'structures']);
    expect(m.id).toBe('versus:wadi_tarfan');
    expect(m.map).toEqual({ file: 'wadi_tarfan' });
    expect(m.objectives).toEqual([]);
    expect(m.ledger).toEqual({ requires: [], produces: [] });
    expect(m.structures.every((s) => s.type === 'camp')).toBe(true);
    expect(m.resources).toEqual({ income_zones: rules.income_zones });
  });
});

describe('versusZonesOf', () => {
  const mapZones = maps.wadi_tarfan.zones;
  it('is the map\'s zones when the file declares none, and adds the file\'s own', () => {
    expect(versusZonesOf(versusRules.wadi_tarfan, mapZones)).toEqual(mapZones);
    const extra = { ...versusRules.wadi_tarfan, zones: { extra_ground: [1, 2, 3, 4] } };
    expect(versusZonesOf(extra, mapZones)).toEqual({ ...mapZones, extra_ground: [1, 2, 3, 4] });
  });
  it('refuses a name the map already has', () => {
    const clash = { ...versusRules.wadi_tarfan, zones: { centre_ford: [1, 2, 3, 4] } };
    expect(() => versusZonesOf(clash, mapZones)).toThrow(/centre_ford/);
  });
});
