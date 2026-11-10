import { describe, expect, it } from 'vitest';
import type { VersusModeFileJson } from './versus';
import { FLAG_BACKSTOP_MINUTES, SETUP_BAND_TILES_LARGE, SETUP_KIT, SETUP_SECONDS, VERSUS_CAP_MINUTES_DEFAULT, doctrines, flagBlockOf, maps, setupLineOf, setupRegionOf, versusCapMinutesOf, versusMissionOf, versusModes, versusRules, versusTunnelsOf, versusZonesOf } from './index';

describe('the exports', () => {
  it('doctrines are the two shipped files, keyed by faction, with the Q4 caps', () => {
    expect(Object.keys(doctrines).sort()).toEqual(['kdf', 'sarim']);
    expect(doctrines.kdf.faction).toBe('kdf');
    expect(doctrines.sarim.faction).toBe('sarim');
    expect(doctrines.kdf.pop_cap).toBe(40);
    expect(doctrines.sarim.pop_cap).toBe(56);
  });
  it('versusRules has one file per matchup map, and the large mirror-only map\'s, keyed by map id', () => {
    // rujm_sawda (GH-913) is in VERSUS_FAIR_MAPS (L8) and not in FACTION_MATCHUP_MAPS.
    expect(Object.keys(versusRules).sort()).toEqual(['milh_flats_l', 'rujm_sawda', 'tel_marum', 'wadi_tarfan', 'wadi_tarfan_l']); // Was 3 rules files; wadi_tarfan_l and milh_flats_l are GH-920 B3
    for (const [id, r] of Object.entries(versusRules)) expect(r.map).toBe(id);
  });
});

describe('the flag backstop ruling (GH-976 WP6a)', () => {
  it('is 12 minutes after the bell: a ruling pinned here, so a change is a decision and not a drive-by', () => {
    expect(FLAG_BACKSTOP_MINUTES).toBe(12);
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

describe('versusCapMinutesOf (GH-913 L8)', () => {
  const base = versusRules.wadi_tarfan;
  it('is 25 for a file with no cap_minutes and for no file at all; Rujm Sawda declares 35', () => {
    expect(VERSUS_CAP_MINUTES_DEFAULT).toBe(25);
    expect(versusCapMinutesOf(base)).toBe(25);
    expect(versusCapMinutesOf(undefined)).toBe(25);
    expect(versusCapMinutesOf(versusRules.rujm_sawda)).toBe(35);
  });
  it('takes 25..60 and throws on the rest', () => {
    for (const ok of [25, 35, 60]) expect(versusCapMinutesOf({ ...base, cap_minutes: ok })).toBe(ok);
    for (const bad of [24, 61, 0, 35.5, Number.NaN]) expect(() => versusCapMinutesOf({ ...base, cap_minutes: bad }), String(bad)).toThrow(/cap_minutes/);
  });
});

describe('GH-976 v2: setupRegionOf', () => {
  it('literal oracle: a 12x1 map, seats at 0 and 10, band 2 -> cells 0-4 are 0, cell 5 the band, cells 6-11 are 1', () => {
    const r = setupRegionOf(12, 1, [0, 0], [10, 0], 2);
    expect([...r]).toEqual([0, 0, 0, 0, 0, -1, 1, 1, 1, 1, 1, 1]);
  });
  it('the diagonal seats of a 48x48 map are point images: region[t] === 1 - region[mirror], and the band maps onto itself', () => {
    const r = setupRegionOf(48, 48, [10, 10], [37, 37], 8);
    let band = 0;
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        const v = r[y * 48 + x];
        const m = r[(47 - y) * 48 + (47 - x)];
        if (v === -1) { expect(m).toBe(-1); band++; } else expect(v).toBe(1 - m);
      }
    }
    expect(band).toBeGreaterThan(0);
    expect(r[10 * 48 + 10]).toBe(0);
    expect(r[37 * 48 + 37]).toBe(1);
  });
  /** The BigInt oracle: every cell of a W x W map, doubled coordinates, exact. Returns how many cells had D^2 above 2^31. */
  const bigOracle = (W: number, a: [number, number], b: [number, number], band: number, got: ArrayLike<number>): number => {
    const A = [BigInt(2 * a[0] + 1), BigInt(2 * a[1] + 1)];
    const B = [BigInt(2 * b[0] + 1), BigInt(2 * b[1] + 1)];
    const L = (A[0] - B[0]) ** 2n + (A[1] - B[1]) ** 2n;
    let beyond32 = 0;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const c = [BigInt(2 * x + 1), BigInt(2 * y + 1)];
        const D = (c[0] - B[0]) ** 2n + (c[1] - B[1]) ** 2n - ((c[0] - A[0]) ** 2n + (c[1] - A[1]) ** 2n);
        if (D * D > 2n ** 31n) beyond32++;
        const want = D * D >= 4n * BigInt(band) ** 2n * L ? (D > 0n ? 0 : 1) : -1;
        expect(got[y * W + x], `(${x},${y})`).toBe(want);
      }
    }
    return beyond32;
  };
  it('96x96, the shipped seats (20,20) / (75,75), band 12: every cell equals a BigInt oracle written here', () => {
    // These seats keep D^2 under 2^31 (max about 1.75e9); the next case is the one that leaves int32.
    bigOracle(96, [20, 20], [75, 75], 12, setupRegionOf(96, 96, [20, 20], [75, 75], 12));
  });
  it('96x96 with seats in the corners (D^2 up to 2e10, past int32): every cell equals the BigInt oracle (R0.20)', () => {
    const beyond = bigOracle(96, [0, 0], [95, 95], 12, setupRegionOf(96, 96, [0, 0], [95, 95], 12));
    expect(beyond).toBeGreaterThan(0); // the oracle really does leave int32
  });
});

describe('GH-976 v2: setupLineOf', () => {
  it('is the bisector clipped to the rectangle: the diagonal seats give the anti-diagonal corner to corner', () => {
    const l = setupLineOf(48, 48, [10, 10], [37, 37]);
    const ends = [l.a, l.b].sort((p, q) => p[0] - q[0]);
    expect(ends[0][0]).toBeCloseTo(0, 9);
    expect(ends[0][1]).toBeCloseTo(48, 9);
    expect(ends[1][0]).toBeCloseTo(48, 9);
    expect(ends[1][1]).toBeCloseTo(0, 9);
  });
  it('seats side by side give the vertical line through their midpoint, edge to edge', () => {
    const l = setupLineOf(48, 48, [5, 10], [15, 10]);
    expect(l.a[0]).toBeCloseTo(10.5, 9);
    expect(l.b[0]).toBeCloseTo(10.5, 9);
    expect(Math.abs(l.a[1] - l.b[1])).toBeCloseTo(48, 9);
  });
});

describe('GH-976 v2: flagBlockOf', () => {
  const file = versusModes.wadi_tarfan_l;
  it('setup false is today\'s flags and hold, with no setup block', () => {
    const b = flagBlockOf(file, false);
    expect(b.flags).toBe(file.flags);
    expect(b.holdS).toBe(30);
    expect(b.setup).toBeNull();
  });
  it('setup true is the staged block', () => {
    const b = flagBlockOf(file, true);
    expect(b.flags).toBe(file.flag_setup?.flags);
    expect(b.holdS).toBe(45);
    expect(b.setup).toEqual({ seconds: SETUP_SECONDS, band_tiles: SETUP_BAND_TILES_LARGE, kit: { ...SETUP_KIT } });
  });
  it('a file without flag_setup throws', () => {
    const bare: VersusModeFileJson = { ...file, flag_setup: undefined };
    expect(() => flagBlockOf(bare, true)).toThrow(/no flag_setup/);
    expect(() => flagBlockOf({ ...bare, flags: undefined }, false)).toThrow(/no flag mode/);
  });
});
