// Wadi Tarfan (large), GH-920 B3: the 96x96 twin of Wadi Tarfan, held three ways.
//   1. the generator (tools/maps/wadi_tarfan_l/build.mjs) writes exactly the shipped files;
//   2. the map is what the design says it is: Wadi Tarfan's own seats, camps, income and tunnel capacities at
//      twice the tile, the seats 77.8 tiles apart, a 35-minute cap in a 512-entity room;
//   3. it is OFFERED (B7, the lead's ruling after B4's fairness and B5's render and memory): on the Free Play picker,
//      in VERSUS_FAIR_MAPS and FACTION_MATCHUP_MAPS, and still closed for formations until its own S4 run.
// The verifier's own tests are in large_map_verify.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACTION_MATCHUP_MAPS, MAP_CAP_MINUTES, VERSUS_FAIR_MAPS, matchCapMinutes, matchupAllowed, versusMapAllowed } from '@lions/net';
import { maps, versusRules, type MapJson } from '@lions/data';
import { formationsOpenIn } from '../../packages/app/src/net/versus-formations';
import { UNLISTED_MAP_IDS } from '../../packages/app/src/ui/menu';
import { SHIPPED_MAP_IDS } from '../../packages/worker/src/match/map-ids';
import { MATCHUP_MAPS, MIRROR_RULES_MAPS, RULES_ONLY_MAPS } from '../validate_versus_rules.mjs';
import { build, keepCliffs, loadSketch, serialise } from '../maps/wadi_tarfan_l/build.mjs';

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
    // the original's vents were 4.9 and 5.7 off it, and 5.7 and 5.7 since GH-884 moved route A's friendly vent from (22,15) to (22,14); a doubled copy would be 9.9 and 11.3
    const orig = (smallRules.tunnels?.friendly ?? []).map((r) => off(r.points[r.points.length - 1]));
    expect(orig.map((v) => Math.round(v * 10) / 10)).toEqual([5.7, 5.7]);
  });

  it('carries the 512-entity room and the 35-minute cap (design 5.2, the lead\'s ruling of 2 Nov)', () => {
    expect(Object.keys(rules).sort()).toEqual(['cap_minutes', 'capacity', 'ends', 'id', 'income_zones', 'map', 'tunnels']);
    expect(rules.capacity).toBe(512);
    expect(rules.cap_minutes).toBe(35);
    expect(matchCapMinutes('wadi_tarfan_l')).toBe(35);
    expect(MAP_CAP_MINUTES.wadi_tarfan_l).toBe(35);
  });
});

// GH-920 B4: fairness. The three data levers the generator pulls, each held by a literal oracle; the readings that
// chose them (placed, economy and tunnel arms, 192 + 192 seeds a cell) are in the PR and need no test, they are the
// reason the numbers below are these numbers.
describe('the fairness levers (B4)', () => {
  const rowsOf = large.rows as string[];
  const at = (x: number, y: number) => rowsOf[y][x];

  it('each pump house stands on a rock plinth: the other three tiles of its 2x2 cell block are `^`', () => {
    // 1 tile of pump house is too little to stop a line of fire across the centre ford (KDF 69% placed); the 2x2
    // the sketch draws there reads 52%. The building stays its native one tile (large_map_verify holds that).
    const pumps: string[] = [];
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (at(x, y) === 'p') pumps.push(`${x},${y}`);
    expect(pumps).toEqual(['45,41', '50,54']);
    // the block of the top one is (44..45, 40..41) and of its half-turn twin (50..51, 54..55)
    expect([at(44, 40), at(45, 40), at(44, 41), at(45, 41)]).toEqual(['^', '^', '^', 'p']);
    expect([at(50, 54), at(51, 54), at(50, 55), at(51, 55)]).toEqual(['p', '^', '^', '^']);
  });

  it('the vents sit near the centre, 0.3 of the doubled offset from it; the mouths stay where doubling put them', () => {
    // (40,33) and (30,38) are where doubling the 48x48 vents puts them: 15 to 20 tiles off the fight, where the
    // Sarim raid never finds a target (tunnel cell 3 read KDF 96%). 3/10 of the offset from (47.5, 47.5) is these.
    const t = rules.tunnels;
    expect(t?.friendly?.map((r) => r.points)).toEqual([[[25, 23], [32, 28], [45, 43]], [[23, 25], [26, 31], [42, 45]]]);
    expect(t?.hostile?.map((r) => r.points)).toEqual([[[70, 72], [63, 67], [50, 52]], [[72, 70], [69, 64], [53, 50]]]);
    for (const r of [...(t?.friendly ?? []), ...(t?.hostile ?? [])]) {
      const [vx, vy] = r.points[r.points.length - 1];
      expect(Math.hypot(vx - 47.5, vy - 47.5), r.id).toBeLessThan(7);
    }
  });

  it('a step of two levels between source cells stays a cliff; a step of one is still a ramp', () => {
    // el: a 96x96 grid of 1s (a stand-in for the ramp the 9/3/3/1 rule drew); elev: a 48x48 grid of source cells, all 0 except (10,10) at 2 and (30,30) at 1
    const elev = Array.from({ length: 48 }, () => Array<number>(48).fill(0));
    elev[10][10] = 2;
    elev[30][30] = 1;
    const out = keepCliffs(Array.from({ length: 96 }, () => Array<number>(96).fill(1)), elev);
    expect(out[20][20]).toBe(2); // inside the high cell, leaning toward a cell two lower: its own level
    expect(out[19][19]).toBe(0); // in a low cell, leaning (diagonally) toward the high one: its own level
    expect(out[19][20]).toBe(0); // the same, along an axis
    expect(out[18][18]).toBe(1); // in a low cell leaning away from it: untouched
    expect(out[60][60]).toBe(1); // a cell one level above its neighbours: a ramp, untouched
    expect(out[61][61]).toBe(1);
    expect(out[5][5]).toBe(1);
  });
});

describe('registered, and OFFERED (GH-920 B7: the lead\'s ruling opened it for the mirror and both faction cells)', () => {
  it('is in both versus lists: a room may be hosted on it, in the mirror and in KDF v Sarim either way round', () => {
    // Was `not.toContain` in both (B3: registered, not offered); the opening commit flips them, with the validator's list.
    expect(VERSUS_FAIR_MAPS).toContain('wadi_tarfan_l');
    expect(FACTION_MATCHUP_MAPS).toContain('wadi_tarfan_l');
    expect(versusMapAllowed('wadi_tarfan_l')).toBe(true);
    for (const mode of ['kdf', 'sarim', 'mirror'] as const) expect(matchupAllowed(mode, 'wadi_tarfan_l'), mode).toBe(true);
    // its rules file is classified as a faction-matchup map, not rules-only and not mirror-only
    expect(RULES_ONLY_MAPS).not.toContain('wadi_tarfan_l');
    expect(MATCHUP_MAPS).toContain('wadi_tarfan_l');
    expect(MIRROR_RULES_MAPS).not.toContain('wadi_tarfan_l');
  });

  it('is on the Free Play picker, and is a shipped map the Worker knows', () => {
    expect(UNLISTED_MAP_IDS.has('wadi_tarfan_l')).toBe(false);
    expect(SHIPPED_MAP_IDS).toContain('wadi_tarfan_l');
  });

  it('is open for formations in versus since 7 Nov (GH-859: S4 on 3 Nov tripped 1 of 21 cells, the 6 Nov re-run 0 of 21); the gate shut closes it, and the tel_marum economy room stays the closed control', () => {
    expect(formationsOpenIn('versus', true, 'wadi_tarfan_l')).toBe(true);
    expect(formationsOpenIn('versus', undefined, 'wadi_tarfan_l')).toBe(true);
    expect(formationsOpenIn('versus', false, 'wadi_tarfan_l')).toBe(false);
    expect(formationsOpenIn('versus', true, 'tel_marum', 'economy')).toBe(false);
    expect(formationsOpenIn('sandbox', undefined, 'wadi_tarfan_l')).toBe(true);
    expect(formationsOpenIn(undefined, undefined, 'wadi_tarfan_l')).toBe(true);
    // the original stays open
    expect(formationsOpenIn('versus', true, 'wadi_tarfan')).toBe(true);
  });
});
