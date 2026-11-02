// Milh Flats (large), GH-920 B3 and B4: the 96x96 twin of Milh Flats, held three ways.
//   1. the generator (tools/maps/milh_flats_l/build.mjs) writes exactly the shipped files;
//   2. the map is what the design says it is: Milh Flats' own landmarks at twice the tile, the seats 77.8 tiles apart on
//      the ANTI-diagonal, a 35-minute cap in a 512-entity room, the two tell rocks kept at their native four tiles;
//   3. it is REGISTERED but NOT OFFERED: held out of the Free Play picker, out of VERSUS_FAIR_MAPS and
//      FACTION_MATCHUP_MAPS, and closed for formations, until B5 (render and memory) is read and the lead opens it.
//      This package must not open the map.
// B4 (fairness) pulled no lever on this map: the first geometry read 50.5% on seeds 0-191 and 49.7% on the held-out
// seeds 4000-4287 (the PR has the table), so there is no fairness lever to pin, only the geometry the numbers were read on.
// The verifier's own tests are in large_map_verify.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACTION_MATCHUP_MAPS, MAP_CAP_MINUTES, VERSUS_FAIR_MAPS, matchCapMinutes, matchupAllowed, versusMapAllowed } from '@lions/net';
import { maps, versusRules, type MapJson, type VersusRulesJson } from '@lions/data';
import { formationsOpenIn } from '../../packages/app/src/net/versus-formations';
import { UNLISTED_MAP_IDS } from '../../packages/app/src/ui/menu';
import { SHIPPED_MAP_IDS } from '../../packages/worker/src/match/map-ids';
import { RULES_ONLY_MAPS } from '../validate_versus_rules.mjs';
import { SEAT_0, SEAT_1, build, loadSketch, serialise } from '../maps/milh_flats_l/build.mjs';
import { SPECS, shipped, verifyLargeMap } from './large_map_verify';

const ROOT = join(__dirname, '..', '..');
const large = maps.milh_flats_l as unknown as MapJson;
const small = maps.milh_flats as unknown as MapJson;
const rules = versusRules.milh_flats_l;
type Pt = readonly number[];

describe('the generator', () => {
  it('writes exactly the shipped map and rules (a drift between the two is red)', () => {
    const { map, versus } = build();
    expect(serialise(map)).toBe(readFileSync(join(ROOT, 'data/maps/milh_flats_l.json'), 'utf8'));
    expect(serialise(versus)).toBe(readFileSync(join(ROOT, 'data/versus/milh_flats_l.json'), 'utf8'));
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

describe('the map is Milh Flats at twice the tile', () => {
  it('is 96x96 and arid, with its own id and a name that says "(large)"', () => {
    expect([large.width, large.height, large.terrain, large.id]).toEqual([96, 96, 'arid', 'milh_flats_l']);
    expect(large.name).toContain('Milh Flats (large)');
  });

  it('the seats are on the anti-diagonal and 77.8 tiles apart, as Rujm Sawda\'s and Wadi Tarfan (large)\'s are: (20,75) and (75,20)', () => {
    const m = large.markers as Record<string, Pt>;
    const s = small.markers as Record<string, Pt>;
    expect(s.versus_0).toEqual([9, 38]);
    expect(s.versus_1).toEqual([38, 9]);
    expect(m.versus_0).toEqual([20, 75]);
    expect(m.versus_1).toEqual([75, 20]);
    expect([...SEAT_0, ...SEAT_1]).toEqual([20, 75, 75, 20]);
    expect(Math.hypot(m.versus_1[0] - m.versus_0[0], m.versus_1[1] - m.versus_0[1])).toBeCloseTo(77.78, 1);
    // doubling the original's seats would give 2 * (38 - 9) * sqrt(2) = 82.0 -- 4 tiles more of walk than the 78 the lead ruled
    expect(Math.hypot(2 * (s.versus_1[0] - s.versus_0[0]), 2 * (s.versus_1[1] - s.versus_0[1]))).toBeCloseTo(82.02, 1);
    for (const p of [m.versus_0, m.versus_1]) expect(p[0] + p[1]).toBe(95);
  });

  it('every marker and zone of the original is here, by name, and only those; the lone centre marker is one of the four tiles round the centre', () => {
    expect(Object.keys(large.markers as object).sort()).toEqual(Object.keys(small.markers as object).sort());
    expect(Object.keys(large.zones as object).sort()).toEqual(Object.keys(small.zones as object).sort());
    // the sketch's (23,23) is the tile above-left of the true centre (23.5, 23.5); its large twin is (47,47) of (47..48, 47..48)
    expect((small.markers as Record<string, Pt>).centre).toEqual([23, 23]);
    expect((large.markers as Record<string, Pt>).centre).toEqual([47, 47]);
  });

  it('income zones are at LANDMARK size (the same w x h), the two deploy grounds at area size (doubled)', () => {
    const z = large.zones as Record<string, Pt>;
    const s = small.zones as Record<string, Pt>;
    for (const n of Object.keys(s)) {
      if (n.startsWith('deploy_')) expect(z[n].slice(2), n).toEqual(s[n].slice(2).map((v) => 2 * v));
      else expect(z[n].slice(2), n).toEqual(s[n].slice(2));
    }
    // each seat stands inside its own deploy ground
    const inside = (p: Pt, r: Pt) => p[0] >= r[0] && p[0] < r[0] + r[2] && p[1] >= r[1] && p[1] < r[1] + r[3];
    expect(inside((large.markers as Record<string, Pt>).versus_0, z.deploy_0)).toBe(true);
    expect(inside((large.markers as Record<string, Pt>).versus_1, z.deploy_1)).toBe(true);
  });

  it('the original has NO rules file and no tunnels, so neither has the twin: a mirror-only map', () => {
    expect(Object.hasOwn(versusRules, 'milh_flats')).toBe(false);
    expect(rules.tunnels).toBeUndefined();
    expect(Object.keys(rules).sort()).toEqual(['cap_minutes', 'capacity', 'ends', 'id', 'income_zones', 'map']);
  });

  it('carries the 512-entity room and the 35-minute cap (design 5.2, the lead\'s ruling of 2 Nov), a camp beside each formation, and an income table a mirror room never reads', () => {
    expect(rules.capacity).toBe(512);
    expect(rules.cap_minutes).toBe(35);
    expect(matchCapMinutes('milh_flats_l')).toBe(35);
    expect(MAP_CAP_MINUTES.milh_flats_l).toBe(35);
    expect(rules.ends.friendly.camp).toEqual({ at: [14, 75], size: [2, 2] });
    expect(rules.ends.hostile.camp).toEqual({ at: [80, 19], size: [2, 2] });
    expect(rules.income_zones.reduce((a, z) => a + z.rate_per_min, 0)).toBe(220);
  });

  it('each tell\'s rock crown keeps its native four tiles on a knoll: a 2x2-block copy would be 16 tiles, past CROWN_MAX_TILES (12), and crown nothing', () => {
    const rows = large.rows as string[];
    const rocks: string[] = [];
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (rows[y][x] === '^') rocks.push(`${x},${y}`);
    // the top tell's rock is (21..22, 21..22) in the middle of the knoll block (20..23, 20..23); its twin is the half-turn
    expect(rocks).toEqual(['21,21', '22,21', '21,22', '22,22', '73,73', '74,73', '73,74', '74,74']);
    // the knoll round the top rock: the 4x4 block minus the rock is knoll, nothing else
    const around: string[] = [];
    for (let y = 20; y < 24; y++) for (let x = 20; x < 24; x++) if (!(x >= 21 && x <= 22 && y >= 21 && y <= 22)) around.push(rows[y][x]);
    expect(around).toEqual(Array(12).fill('n'));
  });
});

describe('the verifier on it (B2 checks, run on the shipped data)', () => {
  it('passes every check, with the seats on the anti-diagonal and the centre marker alone', () => {
    const { json, rules: r, spec } = shipped('milh_flats_l');
    expect(spec.antiDiagonal).toBe(true);
    expect(spec.lone).toEqual(['centre']);
    const rep = verifyLargeMap(json, r, spec);
    expect(rep.failures).toEqual([]);
    expect(rep.facts.asymmetric_tiles).toBe(0);
    expect(rep.facts.seat_distance).toBe(77.8);
    expect(rep.facts.fat_stairs).toBe(0);
    expect(rep.facts.road_stairs).toBe(0);
    expect(rep.facts.road_blocks).toBe(0);
    expect(rep.facts.thick_wall_blocks).toBe(0);
    expect(rep.facts.thick_ditch_blocks).toBe(0);
    expect(Number(rep.facts.built_share)).toBeLessThanOrEqual(0.01);
    expect(Number(rep.facts.cover_share)).toBeGreaterThanOrEqual(0.085);
    expect(Number(rep.facts.cover_share)).toBeLessThanOrEqual(0.11);
  });

  it('is red when the spec forgets the anti-diagonal (the main-diagonal rule) and when a seat leaves it', () => {
    const { json, rules: r, spec } = shipped('milh_flats_l');
    const main = verifyLargeMap(json, r, { ...spec, antiDiagonal: false }).failures;
    expect(main.some((f) => f.includes('is not on the main diagonal'))).toBe(true);
    // seat 1 one tile off x + y = 95 (and seat 0 mirrored, so only the diagonal is wrong, not the twin rule)
    const moved = JSON.parse(JSON.stringify(json)) as MapJson;
    const mk = moved.markers as Record<string, number[]>;
    mk.versus_1 = [75, 21];
    mk.versus_0 = [20, 74];
    const off = verifyLargeMap(moved, r, spec).failures;
    expect(off.some((f) => f.includes('is not on the anti-diagonal (x + y == 95)'))).toBe(true);
  });

  it('keeps the original\'s building shapes exactly (house 2x2, concrete 2x2, shanty 1)', () => {
    const { json, rules: r, spec } = shipped('milh_flats_l');
    expect(spec.reference?.id).toBe('milh_flats');
    // a spec with no reference still holds the ceilings; the reference is the sharper check
    expect(verifyLargeMap(json, r, { ...spec, reference: undefined }).failures).toEqual([]);
    expect(SPECS.milh_flats_l().routesPerEnd).toBe(0);
    expect((rules as VersusRulesJson).tunnels).toBeUndefined();
  });
});

describe('registered, and NOT offered (B5 first)', () => {
  it('is in neither versus list: no room may be hosted on it, in any pairing', () => {
    expect(VERSUS_FAIR_MAPS).not.toContain('milh_flats_l');
    expect(FACTION_MATCHUP_MAPS).not.toContain('milh_flats_l');
    expect(versusMapAllowed('milh_flats_l')).toBe(false);
    for (const mode of ['kdf', 'sarim'] as const) expect(matchupAllowed(mode, 'milh_flats_l'), mode).toBe(false);
    expect(RULES_ONLY_MAPS).toContain('milh_flats_l');
    // the original stays offered, for the mirror
    expect(VERSUS_FAIR_MAPS).toContain('milh_flats');
  });

  it('is held out of the Free Play picker, but is a shipped map the Worker knows', () => {
    expect(UNLISTED_MAP_IDS.has('milh_flats_l')).toBe(true);
    expect(SHIPPED_MAP_IDS).toContain('milh_flats_l');
  });

  it('is closed for formations even when the versus gate is open; a sandbox room on it is not a versus room', () => {
    expect(formationsOpenIn('versus', true, 'milh_flats_l')).toBe(false);
    expect(formationsOpenIn('versus', undefined, 'milh_flats_l')).toBe(false);
    expect(formationsOpenIn('sandbox', undefined, 'milh_flats_l')).toBe(true);
    expect(formationsOpenIn(undefined, undefined, 'milh_flats_l')).toBe(true);
    // the original stays open
    expect(formationsOpenIn('versus', true, 'milh_flats')).toBe(true);
  });
});
