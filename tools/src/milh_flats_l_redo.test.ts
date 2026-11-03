// Milh Flats (large), REDONE (GH-974): the 96x96 mirror-only map with a plan in it, STAGED and held four ways.
//   1. the generator (tools/maps/milh_flats_l_redo/build.mjs, from sketch.mjs) writes exactly the staged files
//      (docs/campaign/staged_maps/milh_flats_l_redo), which are byte for byte what B4 and the render budget measured;
//   2. the map is what the design says it is (_coord/versus-maps-design/design.md): the seats 77.8 tiles apart on the
//      ANTI-diagonal, a 35-minute cap in a 512-entity room, the two tell rocks at their native four tiles, a scree wadi with
//      2-level cliff banks for each seat, a ford at the end of each, and Bir Milh, a walled enclosure with two gates;
//   3. the seal holds: with the two fords and the town plugged no vehicle crosses, and the check that says so is red when
//      the seal is cut (a hole in the town wall, a gap in a bed, the town left out of the crossings);
//   4. it is NOT OFFERED: the render budget failed (the town's walls and houses cost the frame), so what the game ships is still
//      the first build, and nothing here reads the redo through `@lions/data`.
// The counts below are INDEPENDENT of the code under test: each was read by a Python flood fill of the staged rows and
// levels (not parseMap, not the generator), the way PR 959's pins were swept.
// B4 (fairness) is in the PR, not here: the geometry was read once on seeds 0-191 and 4000-4287 and no lever was pulled.
// The verifier's own tests are in large_map_verify.test.ts, the visibility gate's in map_visibility.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_CAP_MINUTES, matchCapMinutes } from '@lions/net';
import { maps, parseMap, versusRules, type MapJson, type VersusRulesJson } from '@lions/data';
import { SEAT_0, SEAT_1, TOWN, WADI, build, loadSketch, serialise, townTop } from '../maps/milh_flats_l_redo/build.mjs';
import { KEPT_RELIEF, PLAIN } from '../maps/milh_flats_l_redo/sketch.mjs';
import { SPECS, staged, verifyLargeMap, verifyVersusVisibility } from './large_map_verify';

const ROOT = join(__dirname, '..', '..');
const STAGED_DIR = join(ROOT, 'docs', 'campaign', 'staged_maps', 'milh_flats_l_redo');
const large = JSON.parse(readFileSync(join(STAGED_DIR, 'map.json'), 'utf8')) as MapJson;
const rules = JSON.parse(readFileSync(join(STAGED_DIR, 'versus.json'), 'utf8')) as VersusRulesJson;
const small = maps.milh_flats as unknown as MapJson;
type Pt = readonly number[];
const rowsOf = large.rows as string[];
const levelOf = (x: number, y: number) => Number((large.elevation as string[])[y][x]);

const clone = (): MapJson => JSON.parse(JSON.stringify(large)) as MapJson;
const setRow = (rows: string[], x: number, y: number, c: string) => {
  rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1);
};
/** Write `c` at (x, y) and at its half-turn twin, so a mutation that is not about symmetry keeps the map symmetric. */
const setBoth = (rows: string[], x: number, y: number, c: string) => {
  setRow(rows, x, y, c);
  setRow(rows, 95 - x, 95 - y, c);
};
const failuresOf = (json: MapJson, spec = SPECS.milh_flats_l_redo()) => verifyLargeMap(json, rules, spec).failures;

describe('the generator', () => {
  it('writes exactly the staged map and rules (a drift between the two is red)', () => {
    const { map, versus } = build();
    expect(serialise(map)).toBe(readFileSync(join(STAGED_DIR, 'map.json'), 'utf8'));
    expect(serialise(versus)).toBe(readFileSync(join(STAGED_DIR, 'versus.json'), 'utf8'));
  });

  it('its sketch keeps the 48x48 original\'s SKELETON and nothing of its hamlet: corner boulders, the tells, level 2 everywhere else', () => {
    const { rows, elev } = loadSketch();
    const orig = small.rows as string[];
    expect(rows).toHaveLength(48);
    const symbols = new Set<string>();
    for (const r of rows) for (const c of r) symbols.add(c);
    // no hamlet (h s #), wall, ditch, road or tell slope (n) survives; only open ground, cover, the rock and the corner scree
    expect([...symbols].sort()).toEqual(['.', '1', '2', '^', 'b', 'o'].sort());
    // the scree is only the two corner masses: every `b` of the sketch is in the original too, and the mid-map fields are gone
    let b = 0;
    let origB = 0;
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        if (rows[y][x] === 'b') {
          b++;
          expect(orig[y][x], `${x},${y}`).toBe('b');
        }
        if (orig[y][x] === 'b') origB++;
        // point-symmetric, the premise of the half-turn
        expect(rows[y][x], `${x},${y}`).toBe(rows[47 - y][47 - x]);
        expect(elev[y][x], `${x},${y}`).toBe(elev[47 - y][47 - x]);
      }
    }
    expect(origB).toBe(178);
    expect(b).toBe(110); // the two corner masses, by a Python flood fill from cells (0,0) and (47,47)
    // level 2 outside the kept relief boxes (the tell hill and the seat plateau, and their half-turns)
    const kept = (x: number, y: number) => KEPT_RELIEF.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) if (!kept(x, y) && !kept(47 - x, 47 - y)) expect(elev[y][x], `${x},${y}`).toBe(PLAIN);
  });
});

describe('the map is a plan: Milh Flats (large), redone', () => {
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
    for (const p of [m.versus_0, m.versus_1]) expect(p[0] + p[1]).toBe(95);
  });

  it('its markers and zones are the redo\'s own: the old knolls, havens, huts, hooks, lanes and cairns are retired; the fords, farms, flags, gates and the town are new', () => {
    expect(Object.keys(large.markers as object).sort()).toEqual([
      'centre', 'flag_0', 'flag_1', 'gate_0', 'gate_1', 'tell_nw', 'tell_nw_crown', 'tell_se', 'tell_se_crown', 'versus_0', 'versus_1', 'wadi_mouth_0', 'wadi_mouth_1',
    ]);
    expect(Object.keys(large.zones as object).sort()).toEqual([
      'bir_milh', 'camp_yard_0', 'camp_yard_1', 'deploy_0', 'deploy_1', 'farm_0', 'farm_1', 'ford_nw', 'ford_se', 'tell_nw', 'tell_se', 'town',
    ]);
    // the sketch's (23,23) centre is the tile above-left of the true centre (23.5, 23.5); its large twin is (47,47) of (47..48, 47..48)
    expect((large.markers as Record<string, Pt>).centre).toEqual([47, 47]);
    // the two gates are the town's two doors, on the north and south sides, the half-turn of each other
    expect((large.markers as Record<string, Pt>).gate_1).toEqual([47, 36]);
    expect((large.markers as Record<string, Pt>).gate_0).toEqual([48, 59]);
  });

  it('the deploy grounds are the original\'s doubled, each seat stands inside its own, and the town and court are where the design puts them', () => {
    const z = large.zones as Record<string, Pt>;
    const s = small.zones as Record<string, Pt>;
    for (const n of ['deploy_0', 'deploy_1']) expect(z[n].slice(2), n).toEqual(s[n].slice(2).map((v) => 2 * v));
    const inside = (p: Pt, r: Pt) => p[0] >= r[0] && p[0] < r[0] + r[2] && p[1] >= r[1] && p[1] < r[1] + r[3];
    expect(inside((large.markers as Record<string, Pt>).versus_0, z.deploy_0)).toBe(true);
    expect(inside((large.markers as Record<string, Pt>).versus_1, z.deploy_1)).toBe(true);
    expect(z.town).toEqual([36, 36, 24, 24]); // the whole enclosure
    expect(z.bir_milh).toEqual([44, 44, 8, 8]); // the khan court, shrunk from the original's 14x14 hamlet
    expect([TOWN.x0, TOWN.y0, TOWN.n]).toEqual([36, 36, 24]);
  });

  it('the original has NO rules file and no tunnels, so neither has the twin: a mirror-only map', () => {
    expect(Object.hasOwn(versusRules, 'milh_flats')).toBe(false);
    expect(rules.tunnels).toBeUndefined();
    expect(Object.keys(rules).sort()).toEqual(['cap_minutes', 'capacity', 'ends', 'id', 'income_zones', 'map']);
  });

  it('carries the 512-entity room and the 35-minute cap, a camp beside each formation, and an income table (the town, the tells, the fords, the farms) a mirror room never reads', () => {
    expect(rules.capacity).toBe(512);
    expect(rules.cap_minutes).toBe(35);
    expect(matchCapMinutes('milh_flats_l')).toBe(35);
    expect(MAP_CAP_MINUTES.milh_flats_l).toBe(35);
    expect(rules.ends.friendly.camp).toEqual({ at: [14, 75], size: [2, 2] });
    expect(rules.ends.hostile.camp).toEqual({ at: [80, 19], size: [2, 2] });
    expect(rules.income_zones.map((z) => z.zone).sort()).toEqual(['bir_milh', 'farm_0', 'farm_1', 'ford_nw', 'ford_se', 'tell_nw', 'tell_se']);
    expect(rules.income_zones.reduce((a, z) => a + z.rate_per_min, 0)).toBe(220);
  });

  it('each tell\'s rock crown keeps its native four tiles on a knoll, and the slopes are BARE: the only `n` on the map is the two 12-tile rings', () => {
    const rocks: string[] = [];
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (rowsOf[y][x] === '^') rocks.push(`${x},${y}`);
    expect(rocks).toEqual(['21,21', '22,21', '21,22', '22,22', '73,73', '74,73', '73,74', '74,74']);
    const ring: string[] = [];
    for (let y = 20; y < 24; y++) for (let x = 20; x < 24; x++) if (!(x >= 21 && x <= 22 && y >= 21 && y <= 22)) ring.push(rowsOf[y][x]);
    expect(ring).toEqual(Array(12).fill('n'));
    // Python count: 24 `n` tiles in all (2 rings of 12), against the 48x48 original's hundreds of cover-2 tiles
    expect(rowsOf.join('').split('n').length - 1).toBe(24);
  });
});

describe('the wadis: a scree bed two levels down, and a ford at the end of each', () => {
  it('the bed is 264 scree tiles at level 0 (132 a wadi), every other scree tile is a corner boulder field at level 2', () => {
    let bed = 0;
    let corner = 0;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (rowsOf[y][x] !== 'b') continue;
        if (levelOf(x, y) === 0) bed++;
        else {
          expect(levelOf(x, y), `${x},${y}`).toBe(2);
          corner++;
        }
      }
    }
    expect(bed).toBe(264); // 4 wide x (28 diagonal rows + 9 straight rows) - the ford's 16, twice; by a Python count
    expect(corner).toBe(440);
    expect(WADI.width * (WADI.diagEnd + 1 + (WADI.bedEnd - WADI.diagEnd)) - 16).toBe(132);
  });

  it('every bank is a 2-LEVEL CLIFF: each bed tile\'s neighbour that is not bed, not the ford (level 0 or its level-1 ramp) and not the town ring stands exactly two levels above it', () => {
    let cliffs = 0;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (rowsOf[y][x] !== 'b' || levelOf(x, y) !== 0) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx > 95 || ny > 95) continue;
          if (rowsOf[ny][nx] === 'b' || '=d'.includes(rowsOf[ny][nx]) || levelOf(nx, ny) < 2) continue;
          expect(levelOf(nx, ny) - levelOf(x, y), `bank of ${x},${y} at ${nx},${ny}`).toBe(2);
          cliffs++;
        }
      }
    }
    expect(cliffs).toBe(246); // by a Python count of the same pairs: each of them a step of exactly two levels
  });

  it('each ford is a 4x4 gap in the scree on the bed floor (level 0), with a level-1 ramp tile either side, and it is its zone', () => {
    const z = large.zones as Record<string, Pt>;
    expect(z.ford_nw).toEqual([32, 29, 4, 4]);
    expect(z.ford_se).toEqual([60, 63, 4, 4]);
    for (const [x0, y0] of [[32, 29], [60, 63]]) {
      for (let y = y0; y < y0 + 4; y++) {
        for (let x = x0; x < x0 + 4; x++) {
          expect('.r').toContain(rowsOf[y][x]);
          expect(levelOf(x, y), `${x},${y}`).toBe(0);
        }
        expect(levelOf(x0 - 1, y), `ramp ${x0 - 1},${y}`).toBe(1);
        expect(levelOf(x0 + 4, y), `ramp ${x0 + 4},${y}`).toBe(1);
      }
      // the scree closes the bed above and below the gap
      expect(rowsOf[y0 - 1][x0 + 1]).toBe('b');
      expect(rowsOf[y0 + 4][x0 + 1]).toBe('b');
    }
  });
});

describe('Bir Milh: a walled enclosure with two gates', () => {
  it('its ring is closed to wheels but for TWO four-tile gates (north and south); the east and west walls and both belts are unbroken', () => {
    // north belt y = 36 and south belt y = 59: ditch from x = 36..45 and 50..59, the gate at x = 46..49
    for (const y of [36, 59]) {
      for (let x = 36; x < 60; x++) {
        if (x >= 46 && x <= 49) expect('.r', `gate ${x},${y}`).toContain(rowsOf[y][x]);
        else expect(rowsOf[y][x], `${x},${y}`).toBe('d');
      }
    }
    // east and west walls, x = 36 and x = 59, y = 37..58: wall, or a ditch where the east-west street meets it (a FOOT gate)
    for (const x of [36, 59]) {
      for (let y = 37; y < 59; y++) expect('=d', `${x},${y}`).toContain(rowsOf[y][x]);
      expect([rowsOf[47][x], rowsOf[48][x]]).toEqual(['d', 'd']);
    }
    expect(rowsOf.join('').split('d').length - 1).toBe(44); // 40 on the two belts + 4 foot gates
  });

  it('the streets are four tiles wide: the north gate\'s street runs clear from the gate to the court, its road one tile', () => {
    for (let y = 37; y < 47; y++) for (let x = 46; x < 50; x++) expect('.rp', `${x},${y}`).toContain(rowsOf[y][x]);
    for (let y = 36; y < 48; y++) expect(rowsOf[y][47], `47,${y}`).toBe('r');
    for (let y = 48; y < 60; y++) expect(rowsOf[y][48], `48,${y}`).toBe('r');
  });

  it('it holds 6 houses, 14 sheds, 2 concrete blocks and 2 pump houses (Python flood fill), and 172 wall tiles with the two farms\'', () => {
    const count = (sym: string): number[] => {
      const seen = new Set<number>();
      const sizes: number[] = [];
      for (let y = 0; y < 96; y++) {
        for (let x = 0; x < 96; x++) {
          if (rowsOf[y][x] !== sym || seen.has(y * 96 + x)) continue;
          let n = 0;
          const st = [[x, y]];
          seen.add(y * 96 + x);
          while (st.length) {
            const [a, b] = st.pop()!;
            n++;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const [nx, ny] = [a + dx, b + dy];
              if (nx >= 0 && ny >= 0 && nx < 96 && ny < 96 && rowsOf[ny][nx] === sym && !seen.has(ny * 96 + nx)) {
                seen.add(ny * 96 + nx);
                st.push([nx, ny]);
              }
            }
          }
          sizes.push(n);
        }
      }
      return sizes.sort((p, q) => p - q);
    };
    expect(count('h')).toEqual([4, 4, 4, 4, 4, 4]); // the farms keep a one-floor farmhouse, not a house
    expect(count('s')).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 4, 4]); // 14 sheds of two tiles and 2 farmhouses of four
    expect(count('#')).toEqual([4, 4]);
    expect(count('p')).toEqual([1, 1]);
    // the court's furniture, by a Python scan of the rows: a pump house at each of two opposite corners of the crossing, a
    // concrete block at the other two corners of the khan court (44..51), the half-turn of each other
    const at = (sym: string) => rowsOf.flatMap((r, y) => [...r].flatMap((c, x) => (c === sym ? [`${x},${y}`] : [])));
    expect(at('p')).toEqual(['46,46', '49,49']);
    expect(at('#')).toEqual(['44,44', '45,44', '44,45', '45,45', '50,50', '51,50', '50,51', '51,51']);
    expect(rowsOf.join('').split('=').length - 1).toBe(172); // 124 in the town, 24 in each farm
    const outside = (sym: string) => {
      let n = 0;
      for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (rowsOf[y][x] === sym && !(x >= 36 && x < 60 && y >= 36 && y < 60)) n++;
      return n;
    };
    expect(outside('h') + outside('#') + outside('p')).toBe(0);
    expect(outside('s')).toBe(8); // the two farmhouses
  });

  it('the town is its own half-turn, tile for tile, and its generator template is the twelve rows above the seam', () => {
    const top = townTop();
    expect(top).toHaveLength(12);
    for (let y = 0; y < 12; y++) {
      expect(top[y]).toHaveLength(24);
      for (let x = 0; x < 24; x++) expect(rowsOf[36 + y][36 + x], `${x},${y}`).toBe(rowsOf[59 - y][59 - x]);
    }
  });
});

describe('the seal: one line from the top edge to the bottom, crossed at the two fords and through the town', () => {
  it('with the fords and the town plugged no vehicle crosses; each alone carries one, at equal cost both ways', () => {
    const rep = verifyLargeMap(large, rules, SPECS.milh_flats_l_redo());
    expect(rep.failures).toEqual([]);
    expect(rep.facts.wheels_all_plugged).toBe('no route');
    expect(Number(rep.facts.wheels_via_ford_nw_only)).toBeGreaterThan(0);
    expect(rep.facts.wheels_via_ford_nw_only).toBe(rep.facts.wheels_via_ford_se_only);
    expect(Number(rep.facts.wheels_via_town_only)).toBeLessThan(Number(rep.facts.wheels_via_ford_nw_only)); // the town is the short way, the fords the long
    expect(rep.facts.wheels_via_town_only).toBe(rep.facts.wheels_seat_to_seat);
  });

  it('RED: a hole in the town\'s west and east walls (a third gate) lets a vehicle cross with every crossing plugged', () => {
    const j = clone();
    setBoth(j.rows as string[], 36, 40, '.');
    const out = failuresOf(j);
    expect(out.some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(true);
    expect(out.some((f) => f.startsWith('symmetry'))).toBe(false);
  });

  it('RED: a gap in a wadi\'s bed (the four scree tiles of one row turned to open ground) opens a fourth crossing', () => {
    const j = clone();
    for (let x = 52; x <= 55; x++) setBoth(j.rows as string[], x, 7, '.'); // row 7 of the diagonal bed: x + y in [59, 62]
    const out = failuresOf(j);
    expect(out.some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(true);
  });

  it('RED: a spec that forgets the town as a crossing sees the town leak; plugging the whole enclosure instead hides a hole in its ring', () => {
    const spec = SPECS.milh_flats_l_redo();
    const withoutTown = { ...spec, crossings: spec.crossings!.filter((c) => c.name !== 'town') };
    expect(failuresOf(large, withoutTown).some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(true);
    // the same crossing as the whole enclosure's zone: the plug covers the ring, so the same hole in it (a third gate) is NOT seen
    const holed = clone();
    setBoth(holed.rows as string[], 36, 40, '.');
    const wholeTown = { ...spec, crossings: spec.crossings!.map((c) => (c.name === 'town' ? { name: 'town', zone: 'town' } : c)) };
    expect(failuresOf(holed, spec).some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(true);
    expect(failuresOf(holed, wholeTown).some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(false);
  });
});

describe('the verifier on it (B2 checks and the versus visibility gate, run on the shipped data)', () => {
  it('passes every check, with the seats on the anti-diagonal and the centre marker alone', () => {
    const { json, rules: r, spec } = staged('milh_flats_l_redo');
    expect(spec.antiDiagonal).toBe(true);
    expect(spec.lone).toEqual(['centre']);
    expect(spec.maxBuiltShare).toBe(0.03);
    const rep = verifyLargeMap(json, r, spec);
    expect(rep.failures).toEqual([]);
    expect(rep.facts.asymmetric_tiles).toBe(0);
    expect(rep.facts.seat_distance).toBe(77.8);
    expect(rep.facts.fat_stairs).toBe(0);
    expect(rep.facts.road_stairs).toBe(0);
    expect(rep.facts.road_blocks).toBe(0);
    expect(rep.facts.thick_wall_blocks).toBe(0);
    expect(rep.facts.thick_ditch_blocks).toBe(0);
    expect(Number(rep.facts.built_share)).toBeCloseTo(0.0076, 4); // 70 building tiles of 9,216
    expect(Number(rep.facts.cover_share)).toBeCloseTo(0.1039, 3);
    expect(Number(rep.facts.cover_share)).toBeGreaterThanOrEqual(0.1);
    expect(Number(rep.facts.cover_share)).toBeLessThanOrEqual(0.14);
  });

  it('is red when the spec forgets the anti-diagonal (the main-diagonal rule) and when a seat leaves it', () => {
    const { json, rules: r, spec } = staged('milh_flats_l_redo');
    const main = verifyLargeMap(json, r, { ...spec, antiDiagonal: false }).failures;
    expect(main.some((f) => f.includes('is not on the main diagonal'))).toBe(true);
    const moved = JSON.parse(JSON.stringify(json)) as MapJson;
    const mk = moved.markers as Record<string, number[]>;
    mk.versus_1 = [75, 21];
    mk.versus_0 = [20, 74];
    const off = verifyLargeMap(moved, r, spec).failures;
    expect(off.some((f) => f.includes('is not on the anti-diagonal (x + y == 95)'))).toBe(true);
  });

  it('holds the versus visibility gate: the whole map, the seat corridor, the scoring zones and the town', async () => {
    const { json, rules: r, spec } = staged('milh_flats_l_redo');
    expect(spec.visibility?.towns).toEqual(['town']);
    const v = await verifyVersusVisibility(json, r, spec);
    expect(v.failures).toEqual([]);
    expect(Number(v.facts.visible_whole_map)).toBeGreaterThanOrEqual(0.95);
    expect(Number(v.facts.visible_corridor)).toBeGreaterThanOrEqual(0.92);
    expect(Number(v.facts.visible_town)).toBeGreaterThanOrEqual(0.85);
    expect(Number(v.facts.building_share)).toBeLessThanOrEqual(0.03);
    expect(Number(v.facts.house_share)).toBeLessThanOrEqual(0.4);
    expect(v.facts.building_tiles).toBe(70); // 24 house + 28 shed + 8 farmhouse + 8 concrete + 2 pump, by the flood fill above
  });

  it('the cut\'s three crossings are named: the two fords and the town (its north gate\'s box: the interior has no other exit)', () => {
    expect(SPECS.milh_flats_l_redo().crossings?.map((c) => c.name)).toEqual(['ford_nw', 'ford_se', 'town']);
    expect(SPECS.milh_flats_l_redo().crossings?.[2]).toEqual({ name: 'town', marker: 'gate_1', radius: 3 });
  });
});

describe('STAGED, not offered: the shipped Milh Flats (large) is still the first build', () => {
  it('its id and rules are the shipped ones (so opening it is a file copy), and the shipped map has none of the redo\'s features', () => {
    expect(large.id).toBe('milh_flats_l');
    expect(rules.id).toBe('milh_flats_l');
    expect(rules.map).toBe('milh_flats_l');
    const shipped = maps.milh_flats_l as unknown as MapJson;
    expect(shipped.id).toBe('milh_flats_l');
    expect(JSON.stringify(shipped.rows)).not.toBe(JSON.stringify(large.rows));
    const flat = (shipped.rows as string[]).join('');
    // the first build: ten buildings, no town ring, no wadi bed (scree on level 0)
    expect(parseMap(shipped).structures.filter((st) => st.type !== 'wall').length).toBe(10);
    expect(flat.split('d').length - 1).toBeLessThan(44);
    let bed = 0;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (flat[y * 96 + x] === 'b' && (shipped.elevation as string[])[y][x] === '0') bed++;
    expect(bed).toBe(0);
    expect(Object.keys(shipped.zones as object)).toContain('knoll_0'); // the redo retires knoll_0
    expect(Object.keys(large.zones as object)).not.toContain('knoll_0');
  });

  it('its generator is not the shipped one: build.mjs of milh_flats_l still writes the first build', () => {
    expect(SPECS.milh_flats_l().visibility).toBeUndefined();
    expect(SPECS.milh_flats_l().maxBuiltShare).toBe(0.01);
    expect(SPECS.milh_flats_l().reference?.id).toBe('milh_flats');
  });
});
