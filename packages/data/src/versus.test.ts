import { describe, expect, it } from 'vitest';
import { doctrines, maps, versusMissionOf, versusRules, versusTunnelsOf, versusZonesOf } from './index';

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

describe('versusTunnelsOf (GH-681)', () => {
  it('returns the end\'s routes in file order, owned by the side, pre-dug, as copies', () => {
    const rules = versusRules.tel_marum;
    const north = versusTunnelsOf(rules, 'hostile', 1);
    expect(north.map((r) => r.id)).toEqual(['tm_n_west', 'tm_n_east']);
    for (const r of north) {
      expect(r.side).toBe(1);
      expect(r.pre_dug).toBe(true);
      expect(r.dig_tiles_per_s).toBe(1);
      expect(r.capacity).toBe(4);
    }
    expect(north[1].points).toEqual([[29, 17], [33, 22], [36, 27]]);
    // Copies: mutating the result leaves the shared rules alone.
    north[1].points[0][0] = 99;
    expect(versusTunnelsOf(rules, 'hostile', 0)[1].points[0][0]).toBe(29);
    expect(versusTunnelsOf(rules, 'friendly', 0).map((r) => r.id)).toEqual(['tm_s_west', 'tm_s_east']);
  });
  it('is [] for a file with no tunnels block', () => {
    const bare = { ...versusRules.tel_marum, tunnels: undefined };
    expect(versusTunnelsOf(bare, 'hostile', 1)).toEqual([]);
  });
});
