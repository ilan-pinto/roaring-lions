// Tel Marum (large), GH-920 B3 and B4: the 96x96 twin of Tel Marum, held three ways.
//   1. the generator (tools/maps/tel_marum_l/build.mjs) writes exactly the shipped files;
//   2. the map is what the design says it is: Tel Marum's own ground at twice the tile (areas as 2x2 blocks, the village at its
//      native footprint, every marker at twice its tile), the original's measured seats doubled, a camp that keeps its offset from
//      its seat, tunnel vents that keep their offset from the fight, a 35-minute cap in a 512-entity room;
//   3. it is REGISTERED and NOT OFFERED (rules-only, unlisted, formations closed, in neither @lions/net list).
// Unlike the other three large maps this one is NOT point-symmetric (a campaign valley played from two measured seats), so
// there is no half-turn anywhere in it: the generator draws the whole map and the verifier reads it with `asymmetric: true`.
// B4 (fairness) pulled no lever on this map: the first geometry was read once (the PR has the table), so there is no fairness
// lever to pin, only the geometry the numbers were read on. The saddle doctrine is in tel_marum_l_doctrine.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACTION_MATCHUP_MAPS, MAP_CAP_MINUTES, VERSUS_FAIR_MAPS, matchCapMinutes, versusMapAllowed } from '@lions/net';
import { maps, versusRules, type MapJson, type VersusRulesJson } from '@lions/data';
import { formationsOpenIn } from '../../packages/app/src/net/versus-formations';
import { UNLISTED_MAP_IDS } from '../../packages/app/src/ui/menu';
import { SHIPPED_MAP_IDS } from '../../packages/worker/src/match/map-ids';
import { MATCHUP_MAPS, MIRROR_RULES_MAPS, RULES_ONLY_MAPS, CAMP_REACH } from '../validate_versus_rules.mjs';
import { SEAT_0, SEAT_1, build, loadSketch, serialise } from '../maps/tel_marum_l/build.mjs';
import { SPECS, shipped, verifyLargeMap } from './large_map_verify';

const ROOT = join(__dirname, '..', '..');
const large = maps.tel_marum_l as unknown as MapJson;
const small = maps.tel_marum as unknown as MapJson;
const rules = versusRules.tel_marum_l as VersusRulesJson;
const srules = versusRules.tel_marum as VersusRulesJson;
type Pt = readonly number[];
const rowsL = large.rows as string[];
const rowsS = small.rows as string[];
const elL = (large.elevation as string[]).map((r) => [...r].map(Number));
const elS = (small.elevation as string[]).map((r) => [...r].map(Number));
const markersL = large.markers as Record<string, Pt>;
const markersS = small.markers as Record<string, Pt>;
const zonesL = large.zones as Record<string, Pt>;
const zonesS = small.zones as Record<string, Pt>;

describe('the generator', () => {
  it('writes exactly the shipped map and rules (a drift between the two is red)', () => {
    const { map, versus } = build();
    expect(serialise(map)).toBe(readFileSync(join(ROOT, 'data/maps/tel_marum_l.json'), 'utf8'));
    expect(serialise(versus)).toBe(readFileSync(join(ROOT, 'data/versus/tel_marum_l.json'), 'utf8'));
  });

  it('reads the shipped 48x48 map as its cell sketch, and that sketch is NOT point-symmetric (the premise of "no half-turn here")', () => {
    const { rows, elev } = loadSketch();
    expect(rows).toHaveLength(48);
    let off = 0;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) if (rows[y][x] !== rows[47 - y][47 - x] || elev[y][x] !== elev[47 - y][47 - x]) off++;
    // the valley is south, the village and the pass north: more than half the cells differ from their half-turn twin
    expect(off).toBeGreaterThan(48 * 24);
  });
});

describe('the map is Tel Marum at twice the tile', () => {
  it('is 96x96 and highland, with its own id and a name that says "(large)"', () => {
    expect([large.width, large.height, large.terrain, large.id]).toEqual([96, 96, 'highland', 'tel_marum_l']);
    expect(large.name).toContain('Tel Marum (large)');
    expect(small.terrain).toBe('highland');
  });

  it('rock and the boulder corridor are the original\'s cells copied as 2x2 blocks; open ground stays open (symbols, by an independent loop)', () => {
    for (let cy = 0; cy < 48; cy++) {
      for (let cx = 0; cx < 48; cx++) {
        const c = rowsS[cy][cx];
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const got = rowsL[2 * cy + dy][2 * cx + dx];
          if (c === '^' || c === 'b') expect(got, `${2 * cx + dx},${2 * cy + dy}`).toBe(c);
          else expect(got === '^' || got === 'b', `${2 * cx + dx},${2 * cy + dy}`).toBe(false);
        }
      }
    }
  });

  it('the village keeps its native 3x2 footprint, centred on twice the source centre: tiles (49..51, 7..8), and nothing else is a building', () => {
    const hash: string[] = [];
    rowsL.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') hash.push(`${x},${y}`); }));
    expect(hash).toEqual(['49,7', '50,7', '51,7', '49,8', '50,8', '51,8']);
    const src: string[] = [];
    rowsS.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') src.push(`${x},${y}`); }));
    expect(src).toEqual(['24,3', '25,3', '26,3', '24,4', '25,4', '26,4']);
  });

  it('every rock and boulder tile stands at its own cell\'s level; the corridor floor is level 3 all along (the interpolation would lift its edge)', () => {
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if ('^b'.includes(rowsL[y][x])) expect(elL[y][x], `${x},${y}`).toBe(elS[y >> 1][x >> 1]);
      }
    }
    const floor: number[] = [];
    for (let y = 24; y <= 35; y++) for (let x = 20; x <= 23; x++) floor.push(elL[y][x]);
    expect(floor).toEqual(Array(48).fill(3));
  });

  it('a step of two levels or more stays ONE tile: the berm across the valley, the pass bowl, the wall (keepCliffs); a one-level step is a ramp', () => {
    // the berm is the original's rows 25-26, x 18-30 at level 2 on ground 0: rows 50-53, x 36-61
    expect(elL[49][48]).toBe(0);
    expect(elL[50][48]).toBe(2);
    expect(elL[53][48]).toBe(2);
    expect(elL[54][48]).toBe(0);
    // the bowl floor (level 3 at its edge, 2 in the pass mouth) drops to the valley (0) between rows 35 and 36, in one tile
    expect(elL[35][40]).toBe(3);
    expect(elL[36][40]).toBe(0);
    // the northern plain (1) climbs to the pass floor (2) by a one-level step, row 23 to row 24
    expect(elL[23][48]).toBe(1);
    expect(elL[24][48]).toBe(2);
  });

  it('there is no cover on the sketch and none on the twin, and no other symbol is invented', () => {
    for (const rows of [rowsS, rowsL]) expect(new Set(rows.join(''))).toEqual(new Set(['.', '^', 'b', '#']));
  });
});

describe('seats, markers and zones', () => {
  it('the seats: the hostile one is the original\'s (29,17) doubled, (58,34); the friendly one is moved from its doubled (54,90) to (54,64), 30.3 tiles apart (GH-920 fit, 6 Nov), named in the map as versus_0 and versus_1', () => {
    expect([...SEAT_0, ...SEAT_1]).toEqual([54, 64, 58, 34]);
    expect(markersL.versus_0).toEqual([54, 64]);
    expect(markersL.versus_1).toEqual([58, 34]);
    expect(Math.hypot(markersL.versus_1[0] - markersL.versus_0[0], markersL.versus_1[1] - markersL.versus_0[1])).toBeCloseTo(30.27, 1);
    // the original has no seat markers: its seats are the VERSUS_SEATS table (27,45) / (29,17); only the hostile one is still doubled
    expect(markersS.versus_0).toBeUndefined();
    expect([29 * 2, 17 * 2]).toEqual([58, 34]);
    // the friendly seat's distance to the approach (the fight) is the fit's point: 42.4 tiles when doubled, 17.1 now, against the hostile seat's 17.2
    expect(Math.hypot(markersL.approach[0] - markersL.versus_0[0], markersL.approach[1] - markersL.versus_0[1])).toBeCloseTo(17.09, 1);
    expect(Math.hypot(markersL.approach[0] - markersL.versus_1[0], markersL.approach[1] - markersL.versus_1[1])).toBeCloseTo(17.2, 1);
  });

  it('every marker of the original is here at exactly twice its tile, plus the two seats and nothing else', () => {
    expect(Object.keys(markersL).sort()).toEqual([...Object.keys(markersS), 'versus_0', 'versus_1'].sort());
    for (const [name, p] of Object.entries(markersS)) expect(markersL[name], name).toEqual([2 * p[0], 2 * p[1]]);
  });

  it('zones: the two grounds double (valley floor, muster ground); every other zone keeps its w x h about twice its centre', () => {
    expect(Object.keys(zonesL).sort()).toEqual(Object.keys(zonesS).sort());
    for (const [name, r] of Object.entries(zonesS)) {
      if (name === 'valley_floor' || name === 'muster_ground') expect(zonesL[name], name).toEqual([2 * r[0], 2 * r[1], 2 * r[2], 2 * r[3]]);
      else {
        expect(zonesL[name].slice(2), name).toEqual(r.slice(2));
        // the same centre, doubled: x0 + w/2 -> 2 (x0 + w/2), to the floor
        expect(zonesL[name][0] + zonesL[name][2] / 2 - 2 * (r[0] + r[2] / 2), name).toBeGreaterThanOrEqual(-0.5);
        expect(zonesL[name][0] + zonesL[name][2] / 2 - 2 * (r[0] + r[2] / 2), name).toBeLessThanOrEqual(0.5);
      }
    }
    // the village's zone is exactly its tiles
    expect(zonesL.town_block).toEqual([49, 7, 3, 2]);
  });

  it('each seat stands in open ground, in the bowl / the valley it stood in', () => {
    expect(rowsL[64][54]).toBe('.');
    expect(rowsL[34][58]).toBe('.');
    // the second seat is SOUTH of the wall band (rows 24-35 are the wall; its bowl is rows 30-35), as the original's (29,17) is in the bowl rows 15-17
    expect(markersL.versus_1[1]).toBeLessThanOrEqual(35);
    expect(markersL.versus_1[1]).toBeGreaterThanOrEqual(30);
  });
});

describe('the rules file', () => {
  it('carries the 512-entity room and the 35-minute cap (the lead\'s ruling of 2 Nov), and the original\'s economy unchanged', () => {
    expect(rules.capacity).toBe(512);
    expect(rules.cap_minutes).toBe(35);
    expect(matchCapMinutes('tel_marum_l')).toBe(35);
    expect(MAP_CAP_MINUTES.tel_marum_l).toBe(35);
    expect(rules.income_zones).toEqual(srules.income_zones);
    expect(rules.income_zones.reduce((a, z) => a + z.rate_per_min, 0)).toBe(140);
    // the original has neither field
    expect((srules as { capacity?: number }).capacity).toBeUndefined();
    expect(srules.cap_minutes).toBeUndefined();
  });

  it('each camp keeps its tile offset from its seat: (-7,+1) and (-4,-3), 2x2 as the original\'s', () => {
    expect(srules.ends.friendly.camp).toEqual({ at: [20, 46], size: [2, 2] });   // moved from 21 on main with the camp exits (GH-976, 5 Nov)
    expect(srules.ends.hostile.camp).toEqual({ at: [25, 14], size: [2, 2] });
    expect(rules.ends.friendly.camp).toEqual({ at: [47, 65], size: [2, 2] });
    expect(rules.ends.hostile.camp).toEqual({ at: [54, 31], size: [2, 2] });
    expect([47 - 54, 65 - 64]).toEqual([20 - 27, 46 - 45]);
    expect([54 - 58, 31 - 34]).toEqual([25 - 29, 14 - 17]);
    for (const [end, seat] of [['friendly', markersL.versus_0], ['hostile', markersL.versus_1]] as const) {
      const c = rules.ends[end].camp;
      const reach = Math.min(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => Math.max(Math.abs(c.at[0] + dx - seat[0]), Math.abs(c.at[1] + dy - seat[1]))));
      expect(reach, end).toBeLessThanOrEqual(CAMP_REACH);
    }
  });

  it('the four tunnel routes: the middle point at twice the original\'s tile; the friendly mouths move with the friendly seat (26 tiles north); each VENT is the source vent\'s offset from the approach scaled by K (friendly 0.5, hostile 1) and the hostile end pulled 0.7 of the way to its seat; capacity copied from the source route (main moved two from 4 to 3)', () => {
    const appr = markersS.approach;
    const apprL = markersL.approach;
    expect(apprL).toEqual([48, 48]);
    const rule = { friendly: { k: 0.5, home: 0, seat: markersL.versus_0, shift: [0, -26] }, hostile: { k: 1, home: 0.7, seat: markersL.versus_1, shift: [0, 0] } };
    for (const end of ['friendly', 'hostile'] as const) {
      const { k, home, seat, shift } = rule[end];
      srules.tunnels![end]!.forEach((r, i) => {
        const t = rules.tunnels![end]![i]!;
        expect(t.id, r.id).toBe(r.id.replace(/^tm_/, 'tml_'));
        expect(t.capacity, r.id).toBe(r.capacity);   // copied from the source route
        expect(t.points[0], r.id).toEqual([2 * r.points[0]![0] + shift[0], 2 * r.points[0]![1] + shift[1]]);
        expect(t.points[1], r.id).toEqual([2 * r.points[1]![0], 2 * r.points[1]![1]]);
        const vent = r.points[2]!;
        const vx = apprL[0] + k * (vent[0] - appr[0]);
        const vy = apprL[1] + k * (vent[1] - appr[1]);
        const want = [Math.round(vx + home * (seat[0] - vx)), Math.round(vy + home * (seat[1] - vy))];
        // the generator takes the nearest open tile to this point, so the shipped vent is near it and not necessarily on it
        expect(Math.hypot(t.points[2]![0] - want[0], t.points[2]![1] - want[1]), r.id).toBeLessThanOrEqual(3);
      });
    }
    // literals, so the rule above is not the only witness
    expect(rules.tunnels!.friendly!.map((r) => r.points)).toEqual([[[44, 62], [28, 76], [42, 51]], [[52, 62], [68, 80], [55, 53]]]);
    expect(rules.tunnels!.hostile!.map((r) => r.points)).toEqual([[[44, 34], [32, 44], [52, 39]], [[58, 34], [66, 44], [59, 39]]]);
  });
});

describe('the verifier on it (B2 checks, run on the shipped data, with the asymmetric spec)', () => {
  it('passes every check, with the seats 30.3 apart and the placer moving 5, 11 and 5 units off their formation tiles', () => {
    const { json, rules: r, spec } = shipped('tel_marum_l');
    expect(spec.asymmetric).toBe(true);
    expect(spec.displaced).toEqual({ 'kdf/kdf': 5, 'kdf/sarim': 11, 'sarim/kdf': 5 });
    const rep = verifyLargeMap(json, r, spec);
    expect(rep.failures).toEqual([]);
    expect(rep.facts.seat_distance).toBe(30.3);
    expect(rep.facts.fat_stairs).toBe(0);
    expect(rep.facts.thick_wall_blocks).toBe(0);
    expect(rep.facts.road_blocks).toBe(0);
    expect(rep.facts.displaced_kdf_kdf).toBe(5);
    expect(rep.facts.displaced_kdf_sarim).toBe(11);
    expect(rep.facts.displaced_sarim_kdf).toBe(5);
    expect(Number(rep.facts.built_share)).toBeLessThanOrEqual(0.01);
    // the equal-cost-both-ways rule is the symmetric maps': here the way back is shorter (a descent is free), and both are finite
    expect(Number(rep.facts.foot_seat_to_seat)).toBeGreaterThan(Number(rep.facts.foot_seat_to_seat_back));
  });

  it('read as a SYMMETRIC map it is red on symmetry, the seat diagonal and the spawns (the asymmetric flag is what lets it through)', () => {
    const { json, rules: r, spec } = shipped('tel_marum_l');
    const f = verifyLargeMap(json, r, { ...spec, asymmetric: false, displaced: undefined }).failures;
    expect(f.some((x) => x.includes('are not their half-turn twin'))).toBe(true);
    expect(f.some((x) => x.includes('is not on the main diagonal'))).toBe(true);
    expect(f.some((x) => x.includes('is not the friendly camp mirrored'))).toBe(true);
  });

  it('keeps the original\'s building shape exactly (one 3x2 of six tiles)', () => {
    const { json, rules: r, spec } = shipped('tel_marum_l');
    expect(spec.reference?.id).toBe('tel_marum');
    expect(verifyLargeMap(json, r, { ...spec, reference: undefined }).failures).toEqual([]);
    expect(SPECS.tel_marum_l().routesPerEnd).toBe(2);
  });
});

describe('registered, and NOT OFFERED (GH-920 B3): rules-only, unlisted, formations closed, in neither @lions/net list', () => {
  it('is in neither VERSUS_FAIR_MAPS nor FACTION_MATCHUP_MAPS, so no room may be hosted on it; its original stays offered', () => {
    expect(VERSUS_FAIR_MAPS).not.toContain('tel_marum_l');
    expect(FACTION_MATCHUP_MAPS).not.toContain('tel_marum_l');
    expect(versusMapAllowed('tel_marum_l')).toBe(false);
    expect(RULES_ONLY_MAPS).toEqual(['tel_marum_l']);
    expect(MATCHUP_MAPS).not.toContain('tel_marum_l');
    expect(MIRROR_RULES_MAPS).not.toContain('tel_marum_l');
    expect(VERSUS_FAIR_MAPS).toContain('tel_marum');
    expect(FACTION_MATCHUP_MAPS).toContain('tel_marum');
  });

  it('is off the Free Play picker (unlisted) and is a shipped map the Worker knows', () => {
    expect(UNLISTED_MAP_IDS.has('tel_marum_l')).toBe(true);
    expect(SHIPPED_MAP_IDS).toContain('tel_marum_l');
  });

  it('keeps formations closed in a versus room until its own S4 run; a sandbox room on it is open', () => {
    expect(formationsOpenIn('versus', true, 'tel_marum_l')).toBe(false);
    expect(formationsOpenIn('versus', undefined, 'tel_marum_l')).toBe(false);
    expect(formationsOpenIn('sandbox', undefined, 'tel_marum_l')).toBe(true);
    expect(formationsOpenIn('versus', true, 'tel_marum')).toBe(true);
  });
});
