// Wadi Tarfan (large), GH-920 B3: the 96x96 twin of Wadi Tarfan, held three ways.
//   1. the generator (tools/maps/wadi_tarfan_l/build.mjs) writes exactly the shipped files;
//   2. the map is what the design says it is: Wadi Tarfan's own seats, camps, income and tunnel capacities at
//      twice the tile, the seats 77.8 tiles apart, a 35-minute cap in a 512-entity room;
//   3. it is REGISTERED but NOT OFFERED: held out of the Free Play picker, out of VERSUS_FAIR_MAPS and
//      FACTION_MATCHUP_MAPS, and closed for formations, until B4 (fairness) and B5 (render and memory) are read
//      and the lead opens it. This package must not open the map.
// The verifier's own tests are in large_map_verify.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACTION_MATCHUP_MAPS, MAP_CAP_MINUTES, VERSUS_FAIR_MAPS, matchCapMinutes, matchupAllowed, versusMapAllowed } from '@lions/net';
import { maps, versusRules, type MapJson } from '@lions/data';
import { formationsOpenIn } from '../../packages/app/src/net/versus-formations';
import { UNLISTED_MAP_IDS } from '../../packages/app/src/ui/menu';
import { SHIPPED_MAP_IDS } from '../../packages/worker/src/match/map-ids';
import { RULES_ONLY_MAPS } from '../validate_versus_rules.mjs';
import { build, loadSketch, serialise } from '../maps/wadi_tarfan_l/build.mjs';

const ROOT = join(__dirname, '..', '..');
const large = maps.wadi_tarfan_l as unknown as MapJson;
const small = maps.wadi_tarfan as unknown as MapJson;
const rules = versusRules.wadi_tarfan_l;
const smallRules = versusRules.wadi_tarfan;
type Pt = readonly number[];

describe('the generator', () => {
  it('writes exactly the shipped map and rules (a drift between the two is red)', () => {
    const { map, versus } = build();
    expect(serialise(map)).toBe(readFileSync(join(ROOT, 'data/maps/wadi_tarfan_l.json'), 'utf8'));
    expect(serialise(versus)).toBe(readFileSync(join(ROOT, 'data/versus/wadi_tarfan_l.json'), 'utf8'));
  });

  it('reads the shipped 48x48 map as its cell sketch, and that sketch is point-symmetric (the premise of every twin rule)', () => {
    const { rows, elev } = loadSketch();
    expect(rows).toHaveLength(48);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        expect(rows[y][x], `${x},${y}`).toBe(rows[47 - y][47 - x]);
        expect(elev[y][x], `${x},${y}`).toBe(elev[47 - y][47 - x]);
      }
    }
  });
});

describe('the map is Wadi Tarfan at twice the tile', () => {
  it('is 96x96 and arid, with its own id and a name that says "(large)"', () => {
    expect([large.width, large.height, large.terrain, large.id]).toEqual([96, 96, 'arid', 'wadi_tarfan_l']);
    expect(large.name).toContain('Wadi Tarfan (large)');
  });

  it('the seats are the 48x48 map\'s at PR 947, doubled: (20,20) and (75,75), 77.8 tiles apart, as Rujm Sawda\'s are', () => {
    const m = large.markers as Record<string, Pt>;
    const s = small.markers as Record<string, Pt>;
    expect(s.versus_0).toEqual([10, 10]);
    expect(m.versus_0).toEqual([20, 20]);
    expect(m.versus_1).toEqual([75, 75]);
    expect(Math.hypot(m.versus_1[0] - m.versus_0[0], m.versus_1[1] - m.versus_0[1])).toBeCloseTo(77.78, 1);
    // the twin of 2x is 2(47 - x) + 1: 2 * 37 = 74 would not be the half-turn image of 20
    expect(m.versus_1[0]).toBe(2 * (47 - s.versus_0[0]) + 1);
  });

  it('every marker and zone of the original is here, by name, and only those', () => {
    expect(Object.keys(large.markers as object).sort()).toEqual(Object.keys(small.markers as object).sort());
    expect(Object.keys(large.zones as object).sort()).toEqual(Object.keys(small.zones as object).sort());
  });

  it('income zones are at LANDMARK size (the same w x h), the two camps at area size (doubled)', () => {
    const z = large.zones as Record<string, Pt>;
    const s = small.zones as Record<string, Pt>;
    for (const n of Object.keys(s)) {
      if (n.startsWith('camp_')) expect(z[n].slice(2), n).toEqual(s[n].slice(2).map((v) => 2 * v));
      else expect(z[n].slice(2), n).toEqual(s[n].slice(2));
    }
  });

  it('the rules are Wadi Tarfan\'s at PR 947 in everything but geometry: the same income, the same capacity 3 on every route', () => {
    expect(rules.income_zones).toEqual(smallRules.income_zones);
    expect(rules.income_zones.reduce((a, z) => a + z.rate_per_min, 0)).toBe(300);
    expect(rules.tunnels?.friendly?.map((r) => r.capacity)).toEqual(smallRules.tunnels?.friendly?.map((r) => r.capacity));
    expect(rules.tunnels?.friendly?.map((r) => r.capacity)).toEqual([3, 3]);
    expect(rules.tunnels?.hostile?.map((r) => r.capacity)).toEqual([3, 3]);
    expect(rules.ends.friendly.camp.size).toEqual([2, 2]);
    expect(rules.ends.friendly.camp.at).toEqual([17, 17]);
    expect(rules.ends.hostile.camp.at).toEqual([77, 77]);
  });

  it('the routes are laid along the line of advance: every vent within 6 tiles of the seat-to-seat diagonal, as the original\'s were', () => {
    const off = (p: Pt) => Math.abs(p[0] - p[1]) / Math.SQRT2;
    for (const end of ['friendly', 'hostile'] as const) {
      for (const r of rules.tunnels?.[end] ?? []) {
        const vent = r.points[r.points.length - 1];
        expect(off(vent), `${r.id} vent ${vent}`).toBeLessThanOrEqual(6);
      }
    }
    // the original's vents were 5.0 and 5.7 off it; a doubled copy would be 9.9 and 11.3
    const orig = (smallRules.tunnels?.friendly ?? []).map((r) => off(r.points[r.points.length - 1]));
    expect(orig.map((v) => Math.round(v * 10) / 10)).toEqual([4.9, 5.7]);
  });

  it('carries the 512-entity room and the 35-minute cap (design 5.2, the lead\'s ruling of 2 Nov)', () => {
    expect(Object.keys(rules).sort()).toEqual(['cap_minutes', 'capacity', 'ends', 'id', 'income_zones', 'map', 'tunnels']);
    expect(rules.capacity).toBe(512);
    expect(rules.cap_minutes).toBe(35);
    expect(matchCapMinutes('wadi_tarfan_l')).toBe(35);
    expect(MAP_CAP_MINUTES.wadi_tarfan_l).toBe(35);
  });
});

describe('registered, and NOT offered (B4 and B5 first)', () => {
  it('is in neither versus list: no room may be hosted on it, in any pairing', () => {
    expect(VERSUS_FAIR_MAPS).not.toContain('wadi_tarfan_l');
    expect(FACTION_MATCHUP_MAPS).not.toContain('wadi_tarfan_l');
    expect(versusMapAllowed('wadi_tarfan_l')).toBe(false); // the mirror is allowed on any OFFERED map, so the map's own gate is this one
    for (const mode of ['kdf', 'sarim'] as const) expect(matchupAllowed(mode, 'wadi_tarfan_l'), mode).toBe(false);
    expect(RULES_ONLY_MAPS).toContain('wadi_tarfan_l');
  });

  it('is held out of the Free Play picker, but is a shipped map the Worker knows', () => {
    expect(UNLISTED_MAP_IDS.has('wadi_tarfan_l')).toBe(true);
    expect(SHIPPED_MAP_IDS).toContain('wadi_tarfan_l');
  });

  it('is closed for formations even when the versus gate is open; a sandbox room on it is not a versus room', () => {
    expect(formationsOpenIn('versus', true, 'wadi_tarfan_l')).toBe(false);
    expect(formationsOpenIn('versus', undefined, 'wadi_tarfan_l')).toBe(false);
    expect(formationsOpenIn('sandbox', undefined, 'wadi_tarfan_l')).toBe(true);
    expect(formationsOpenIn(undefined, undefined, 'wadi_tarfan_l')).toBe(true);
    // the original stays open
    expect(formationsOpenIn('versus', true, 'wadi_tarfan')).toBe(true);
  });
});
