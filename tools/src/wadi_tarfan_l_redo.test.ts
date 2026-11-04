// Wadi Tarfan (large), REDONE (GH-974): the 96x96 faction map with a plan in it, STAGED and held six ways.
//   1. the generator (tools/maps/wadi_tarfan_l_redo/build.mjs) writes exactly the staged files (docs/campaign/staged_maps/wadi_tarfan_l_redo),
//      which are byte for byte what B4 measured (the sha256 is in the PR);
//   2. the map is what the design says it is (_coord/versus-maps-design/design.md): the shipped seats, camps, tunnels and zones,
//      a scree wadi with 2-LEVEL cliff banks running edge to edge with a gap at each of three fords, bare-slope bluffs, and
//      Tarfan, four walled yards at the centre ford;
//   3. the seal holds: with the three fords plugged no vehicle crosses, and the check that says so goes red when the bed is cut or
//      a crossing is forgotten;
//   4. the town pays: the centre ford is the richest zone and the total is still the shipped 300 a minute;
//   5. it is inside the versus visibility gate (VERSUS_CAPS), and the spec that says so is no longer in the exempt set;
//   6. it draws fewer structure triangles in any 48x48 window than the 48x48 control draws in all of its map, which is how it fits
//      the render budget (PR 1001: the cost of a town is triangles; the shipped map's 104 ditch tiles draw 4 M a pass). The
//      shipped Wadi Tarfan (large) is untouched: nothing here reads the redo through `@lions/data`.
// The counts below are INDEPENDENT of the code under test: each was read by a Python script over the staged rows, levels and the GLB
// files (not parseMap, not the generator, not map_triangles.ts), the way PR 959's pins were swept.
// B4 (fairness) is in the PR, not here: the geometry was read once on seeds 0-191 and 4000-4287 and no lever was pulled; the fix round then
// pulled two (the road gates and the ford scrub, `describe('the road gates ...')` and the cover test) and read the cells again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_CAP_MINUTES, matchCapMinutes } from '@lions/net';
import { maps, parseMap, versusRules, type MapJson, type VersusRulesJson } from '@lions/data';
import { BELTS, BLUFF, FARMS, FOLDS, FORD_SCRUB, FUNNEL, LANE_HALF, OUTCROPS, PLAIN, RATES, SHELF, SHELF_REACH, TOWN_ZONE, WADI, YARDS, bedCentre, build, serialise, tileMap } from '../maps/wadi_tarfan_l_redo/build.mjs';
import { SPECS, staged, verifyLargeMap, verifyVersusVisibility } from './large_map_verify';
import { billOf, centreBill, densestWindow, meshesOf } from './map_triangles';

const ROOT = join(__dirname, '..', '..');
const STAGED_DIR = join(ROOT, 'docs', 'campaign', 'staged_maps', 'wadi_tarfan_l_redo');
const large = JSON.parse(readFileSync(join(STAGED_DIR, 'map.json'), 'utf8')) as MapJson;
const rules = JSON.parse(readFileSync(join(STAGED_DIR, 'versus.json'), 'utf8')) as VersusRulesJson;
const shipped = maps.wadi_tarfan_l as unknown as MapJson;
const shippedRules = versusRules.wadi_tarfan_l as unknown as VersusRulesJson;
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
const spec = () => SPECS.wadi_tarfan_l_redo();
const failuresOf = (json: MapJson, s = spec()) => verifyLargeMap(json, rules, s).failures;
const house = (rows: string[], x: number, y: number) => {
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) setBoth(rows, x + dx, y + dy, 'h');
};

describe('the generator', () => {
  it('writes exactly the staged map and rules (a drift between the two is red)', () => {
    const { map, versus } = build();
    expect(serialise(map)).toBe(readFileSync(join(STAGED_DIR, 'map.json'), 'utf8'));
    expect(serialise(versus)).toBe(readFileSync(join(STAGED_DIR, 'versus.json'), 'utf8'));
  });

  it('is its own half-turn by construction: every tile and every elevation digit, and the tile map the build reads has no seam', () => {
    const { t, el } = tileMap();
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        expect(t[y][x], `${x},${y}`).toBe(t[95 - y][95 - x]);
        expect(el[y][x], `${x},${y}`).toBe(el[95 - y][95 - x]);
      }
    }
  });

  it('the symbols, by a Python count of the staged rows: 7,198 open, 942 scrub, 518 scree, 176 wall, 94 road, 90 acacia, 56 knoll, 42 cover-2, 68 rock, 16 shed, 8 pump, 8 house', () => {
    const n: Record<string, number> = {};
    for (const r of rowsOf) for (const c of r) n[c] = (n[c] ?? 0) + 1;
    expect(n).toEqual({ '.': 7198, '1': 942, b: 518, '=': 176, r: 94, o: 90, n: 56, '2': 42, '^': 68, s: 16, p: 8, h: 8 }); // the 68 rock: four crowns of 8 and four road-gate outcrops of 9
    expect(n.d).toBeUndefined(); // no ditch: a ditch segment is 38,240 triangles a tile (the shipped map has 104)
    expect(n['#']).toBeUndefined(); // no concrete block
    expect(n['3']).toBeUndefined(); // never cover 3: it cannot be told from cover 2 in a duel
  });
});

describe('the map is a plan: Wadi Tarfan (large), redone', () => {
  it('is 96x96 and arid, with the shipped id and name (so opening it is a file copy)', () => {
    expect([large.width, large.height, large.terrain, large.id, large.name]).toEqual([96, 96, 'arid', 'wadi_tarfan_l', shipped.name]);
  });

  it('keeps the shipped seats on the main diagonal, 77.8 apart, the shipped camps, tunnel routes and limits; only the income rates differ', () => {
    const m = large.markers as Record<string, Pt>;
    expect([m.versus_0, m.versus_1]).toEqual([[20, 20], [75, 75]]);
    expect(Math.hypot(m.versus_1[0] - m.versus_0[0], m.versus_1[1] - m.versus_0[1])).toBeCloseTo(77.78, 1);
    expect(rules.ends).toEqual(shippedRules.ends);
    expect(rules.tunnels).toEqual(shippedRules.tunnels);
    expect((rules.tunnels?.friendly ?? []).map((r) => [r.id, r.capacity])).toEqual([['wtl_f_north', 3], ['wtl_f_west', 3]]);
    expect([rules.capacity, rules.cap_minutes, rules.id, rules.map]).toEqual([512, 35, 'wadi_tarfan_l', 'wadi_tarfan_l']);
    expect(matchCapMinutes('wadi_tarfan_l')).toBe(35);
    expect(MAP_CAP_MINUTES.wadi_tarfan_l).toBe(35);
    const withoutIncome = (r: VersusRulesJson) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'income_zones'));
    expect(withoutIncome(rules)).toEqual(withoutIncome(shippedRules));
    expect(rules.income_zones.map((z) => z.zone).sort()).toEqual(shippedRules.income_zones.map((z) => z.zone).sort());
  });

  it('its markers are the shipped ones but for the two far farms\' (three tiles off the wadi\'s lip); it adds one zone, the town, and moves the near farm\'s zone one row', () => {
    const m = large.markers as Record<string, Pt>;
    const s = shipped.markers as Record<string, Pt>;
    expect(Object.keys(m).sort()).toEqual(Object.keys(s).sort());
    for (const k of Object.keys(s)) if (!k.startsWith('farm_far_')) expect(m[k], k).toEqual(s[k]);
    expect([m.farm_far_0, m.farm_far_1]).toEqual([[10, 74], [85, 21]]);
    expect([s.farm_far_0, s.farm_far_1]).toEqual([[13, 77], [82, 18]]);
    const z = large.zones as Record<string, Pt>;
    const sz = shipped.zones as Record<string, Pt>;
    expect(Object.keys(z).sort()).toEqual([...Object.keys(sz), 'town'].sort());
    const moved = Object.keys(sz).filter((k) => JSON.stringify(z[k]) !== JSON.stringify(sz[k])).sort();
    expect(moved).toEqual(['farm_far_0', 'farm_far_1', 'farm_near_0', 'farm_near_1']);
    expect(z.town).toEqual([35, 35, 26, 26]);
    expect(TOWN_ZONE).toEqual([35, 35, 26, 26]);
    expect([z.farm_near_0, z.farm_near_1, z.farm_far_0, z.farm_far_1]).toEqual([[53, 30, 7, 7], [36, 59, 7, 7], [7, 71, 7, 7], [82, 18, 7, 7]]);
  });

  it('the plain is level 2 (the shipped one sloped through 1 to a dip: a one-level dip hides nothing), the home shelf 3, and the spawn grounds are open to wheels', () => {
    expect([PLAIN, SHELF, SHELF_REACH]).toEqual([2, 3, 58]);
    const n: Record<number, number> = {};
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) n[levelOf(x, y)] = (n[levelOf(x, y)] ?? 0) + 1;
    expect(n).toEqual({ 0: 454, 1: 14, 2: 4976, 3: 3692, 4: 48, 5: 32 }); // Python count of the staged elevation
    expect([levelOf(20, 20), levelOf(75, 75)]).toEqual([3, 3]);
    for (let y = 10; y <= 30; y++) for (let x = 15; x <= 23; x++) expect('.r', `seat 0 formation ${x},${y}`).toContain(rowsOf[y][x]);
  });
});

describe('the wadi: a scree bed two levels down, edge to edge, and a gap at each of three fords', () => {
  /** Every bed tile's neighbour that is not scree and not a ford (level 0 floor or level 1 ramp): the banks. */
  const cliffs = (rows: string[], lv: (x: number, y: number) => number) => {
    let pairs = 0;
    const off: string[] = [];
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (rows[y][x] !== 'b' || lv(x, y) !== 0) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx > 95 || ny > 95 || rows[ny][nx] === 'b' || lv(nx, ny) < 2) continue;
          if (lv(nx, ny) - lv(x, y) === 2) pairs++;
          else off.push(`${x},${y}->${nx},${ny} is ${lv(nx, ny)}`);
        }
      }
    }
    return { pairs, off };
  };

  it('the bed is 416 scree tiles at level 0, and every other scree tile is at level 2 (the 102 of the funnel); none on the shelf', () => {
    const at: Record<number, number> = {};
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (rowsOf[y][x] === 'b') at[levelOf(x, y)] = (at[levelOf(x, y)] ?? 0) + 1;
    expect(at).toEqual({ 0: 416, 2: 102 });
  });

  it('every bank is a 2-LEVEL CLIFF: 330 bed-bank pairs (Python), each exactly two levels, none other', () => {
    const c = cliffs(rowsOf, levelOf);
    expect(c.pairs).toBe(330);
    expect(c.off).toEqual([]);
  });

  it('RED: lower the plain by one level and the same census reads no cliff at all (the shipped map\'s one-level bank, which hides nothing)', () => {
    const elev = (large.elevation as string[]).map((r) => [...r].map(Number));
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (elev[y][x] === 2 && rowsOf[y][x] !== 'b') elev[y][x] = 1;
    const c = cliffs(rowsOf, (x, y) => elev[y][x]);
    expect(c.pairs).toBe(0); // 330 to 0
    expect(c.off).toEqual([]);
  });

  it('is five tiles across a row, on an S-curve: the bed centre is the rounded sine, and a bed tile is within two of it', () => {
    expect(WADI).toEqual({ amp: 3.8, period: 124, fords: [0, 42, -42], fordHalf: 2, bedHalf: 2 });
    expect([bedCentre(0), bedCentre(31), bedCentre(42), bedCentre(-42), bedCentre(93)].map((v) => v + 0)).toEqual([0, 4, 3, -3, -4]); // Python round(3.8 sin(2 pi v / 124))
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (rowsOf[y][x] === 'b' && levelOf(x, y) === 0) expect(Math.abs(x + y - 95 - bedCentre(x - y)), `${x},${y}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('it runs from edge to edge: five tiles of scree at level 0 on the top edge (x 89-93) and on the bottom edge (x 2-6), so there is no mesa and no pocket', () => {
    const at = (row: string) => [...row].map((c, x) => [c, x] as const).filter(([c]) => c === 'b').map(([, x]) => x);
    expect(at(rowsOf[0])).toEqual([89, 90, 91, 92, 93]);
    expect(at(rowsOf[95])).toEqual([2, 3, 4, 5, 6]);
    for (const x of [89, 90, 91, 92, 93]) expect(levelOf(x, 0), `top edge ${x}`).toBe(0);
    for (const x of [2, 3, 4, 5, 6]) expect(levelOf(x, 95), `bottom edge ${x}`).toBe(0);
    // and no bed on the side edges: the band leaves the map through the top and the bottom
    for (let y = 0; y < 96; y++) expect([rowsOf[y][0], rowsOf[y][95]], `side edge ${y}`).not.toContain('b');
  });

  it('each ford is a gap of five v-values through the bed: Python counts of floor tiles at level 0 and ramp tiles at level 1 (12 / 6 at the centre, 13 / 4 at each outer ford)', () => {
    const want: Record<number, [number, number]> = { 0: [12, 6], 42: [13, 4], [-42]: [13, 4] };
    for (const f of WADI.fords) {
      const floor: string[] = [];
      const ramp: string[] = [];
      for (let y = 0; y < 96; y++) {
        for (let x = 0; x < 96; x++) {
          if (Math.abs(x - y - f) > 2) continue;
          if (levelOf(x, y) === 0 && '.r'.includes(rowsOf[y][x])) floor.push(`${x},${y}`);
          if (levelOf(x, y) === 1) ramp.push(`${x},${y}`);
        }
      }
      expect([floor.length, ramp.length], `ford ${f}`).toEqual(want[f]);
    }
    // the road through the centre ford and the track through each outer ford (v = 42: x - y = 42, from (62,20) to (78,36))
    expect(rowsOf[47][47]).toBe('r');
    expect(rowsOf[48][48]).toBe('r');
    expect(levelOf(47, 47)).toBe(0);
    for (let x = 62; x <= 78; x++) expect(rowsOf[x - 42][x], `NE ford track ${x}`).toBe('r');
    for (let x = 17; x <= 33; x++) expect(rowsOf[x + 42][x], `SW ford track ${x}`).toBe('r');
  });
});

describe('the bluffs', () => {
  it('each bluff is a hill of BARE slopes: a crown of 8 rock tiles at level 5 and a ring of 12 knoll at level 4, then open ground at 3 and 3; no cover on the slope', () => {
    expect(BLUFF.hill).toBe(3);
    expect(BLUFF.crowns).toEqual({ bluff_far_0: [62, 12, 4, 2], bluff_near_0: [26, 42, 4, 2] });
    const crowns = [...Object.values(BLUFF.crowns), ...Object.values(BLUFF.crowns).map(([x, y, w, h]) => [96 - x - w, 96 - y - h, w, h])];
    for (const [x0, y0, w, h] of crowns) {
      const ring: string[] = [];
      for (let y = y0 - 3; y < y0 + h + 3; y++) {
        for (let x = x0 - 3; x < x0 + w + 3; x++) {
          const d = Math.max(x0 - x, 0, x - (x0 + w - 1)) + Math.max(y0 - y, 0, y - (y0 + h - 1));
          if (d === 0) expect([rowsOf[y][x], levelOf(x, y)], `crown ${x},${y}`).toEqual(['^', 5]);
          else if (d === 1) {
            expect([rowsOf[y][x], levelOf(x, y)], `ring ${x},${y}`).toEqual(['n', 4]);
            ring.push(`${x},${y}`);
          } else if (d <= 3) {
            expect(levelOf(x, y), `slope ${x},${y}`).toBe(3);
            // a slope tile is plain open ground, never scrub, acacia, knoll or scree (72 of them, by a Python read)
            expect(rowsOf[y][x], `slope ${x},${y}`).toBe('.');
          }
        }
      }
      expect(ring).toHaveLength(12);
    }
    // the rock that is not a road-gate outcrop (literal rects, the four 3x3 blocks of 'the road gates' below) is the four crowns of 8 and no other
    const gate = (x: number, y: number) => [[41, 37], [37, 41], [52, 56], [56, 52]].some(([gx, gy]) => x >= gx && x < gx + 3 && y >= gy && y < gy + 3);
    let rock = 0;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (rowsOf[y][x] === '^' && !gate(x, y)) rock++;
    expect(rock).toBe(32);
  });

  it('a bluff\'s marker is on the ring of knoll that faces the enemy, one row below the crown, and so is open ground', () => {
    const m = large.markers as Record<string, Pt>;
    for (const k of ['bluff_far_0', 'bluff_near_0', 'bluff_far_1', 'bluff_near_1']) expect([rowsOf[m[k][1]][m[k][0]], levelOf(m[k][0], m[k][1])], k).toEqual(['n', 4]);
  });
});

describe('the road gates: four outcrops of rock close the main road to a pass (GH-974 fix round)', () => {
  // The four blocks, as literal top-left corners (a Python flood fill of the staged rows reads exactly four 8-connected clusters of 9 rock tiles
  // outside the four crowns of 8: (41..43, 37..39), (37..39, 41..43) and their half-turns (52..54, 56..58), (56..58, 52..54)).
  const BLOCKS = [[41, 37], [37, 41], [52, 56], [56, 52]];
  const withBlocks = (blocks: number[][]): MapJson => {
    const j = clone();
    const rows = j.rows as string[];
    for (const [gx, gy] of BLOCKS) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) setRow(rows, gx + dx, gy + dy, '.');
    for (const [gx, gy] of blocks) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) setRow(rows, gx + dx, gy + dy, '^');
    return j;
  };

  it('stands four 3x3 blocks of rock on the plain, level 2, with no rock touching them: (41,37) and its transpose and half-turns', () => {
    expect(OUTCROPS).toEqual([[41, 37, 3, 3]]);
    for (const [gx, gy] of BLOCKS) {
      for (let dy = -1; dy <= 3; dy++) {
        for (let dx = -1; dx <= 3; dx++) {
          const inside = dx >= 0 && dx < 3 && dy >= 0 && dy < 3;
          expect(rowsOf[gy + dy][gx + dx] === '^', `${gx + dx},${gy + dy}`).toBe(inside);
          if (inside) expect(levelOf(gx + dx, gy + dy), `level ${gx + dx},${gy + dy}`).toBe(PLAIN);
        }
      }
    }
  });

  it('leaves a pass three tiles wide: no rock within one tile of the road line (|x - y| <= 1), and the nearest rock stands two off it', () => {
    let nearest = 99;
    for (const [gx, gy] of BLOCKS) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) nearest = Math.min(nearest, Math.abs(gx + dx - (gy + dy)));
    expect(nearest).toBe(2);
    for (const [from, to] of [[76, 86], [104, 114]]) {
      for (let s = from; s <= to; s++) {
        for (let y = 0; y < 96; y++) {
          const x = s - y;
          if (x >= 0 && x < 96 && Math.abs(x - y) <= 1) expect('.r1', `pass ${x},${y}`).toContain(rowsOf[y][x]); // open ground, road or scrub: all passable
        }
      }
    }
  });

  it('is what the verifier reads: the seat-to-seat route costs the straight diagonal over wheels and on foot (800 and 800), as it did before the outcrops', () => {
    const rep = verifyLargeMap(large, rules, spec());
    expect(rep.failures).toEqual([]);
    expect([rep.facts.wheels_seat_to_seat, rep.facts.foot_seat_to_seat]).toEqual([800, 800]);
  });

  it('RED: one tile west (40,37) the two blocks touch at a corner and seal the road; the same read costs 878 over wheels and 860 on foot (placed KDF 94% there)', () => {
    const j = withBlocks([[40, 37], [37, 40], [53, 56], [56, 53]]);
    const rep = verifyLargeMap(j, rules, spec());
    expect([rep.facts.wheels_seat_to_seat, rep.facts.foot_seat_to_seat]).toEqual([878, 860]);
  });

  it('RED: with the outcrops taken away the same read still costs 800 (the pass costs the road nothing), and a single rock on the road costs it', () => {
    expect(verifyLargeMap(withBlocks([]), rules, spec()).facts.wheels_seat_to_seat).toBe(800);
    const j = withBlocks([]);
    setBoth(j.rows as string[], 40, 40, '^');
    expect(Number(verifyLargeMap(j, rules, spec()).facts.wheels_seat_to_seat)).toBeGreaterThan(800);
  });
});

describe('Tarfan: four walled yards at the centre ford, and the farms and folds', () => {
  const walls =(x0: number, y0: number, w: number, h: number) => {
    let n = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (rowsOf[y][x] === '=') n++;
    return n;
  };

  it('has the yards A and B of seat 0 and their half-turns: six-tile rings, two two-tile gates each, 16 wall tiles a yard, 64 in all (Python)', () => {
    expect(Object.keys(YARDS)).toEqual(['A', 'B']);
    let total = 0;
    for (const y of Object.values(YARDS)) {
      for (const [x0, y0] of [[y.x0, y.y0], [90 - y.x0, 90 - y.y0]]) {
        expect(walls(x0, y0, 6, 6), `yard ${x0},${y0}`).toBe(16);
        total += 16;
      }
      for (const [gx, gy] of y.gates) {
        expect(rowsOf[gy][gx], `gate ${gx},${gy}`).toBe('.');
        expect(rowsOf[95 - gy][95 - gx], `twin gate ${gx},${gy}`).toBe('.');
      }
    }
    expect(total).toBe(64);
  });

  it('holds 2 two-floor houses (4 tiles each, one a bank, on the lip over the ford), 4 sheds of two tiles and 2 pump houses (Python); 24 building tiles, 3.55% of the zone', () => {
    const [x0, y0, w, h] = large.zones!.town as number[];
    const n: Record<string, number> = {};
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if ('hsp'.includes(rowsOf[y][x])) n[rowsOf[y][x]] = (n[rowsOf[y][x]] ?? 0) + 1;
    expect(n).toEqual({ h: 8, s: 8, p: 8 });
    expect(rowsOf.slice(38, 40).map((r) => r.slice(48, 50))).toEqual(['hh', 'hh']);
    expect(rowsOf.slice(56, 58).map((r) => r.slice(46, 48))).toEqual(['hh', 'hh']);
    // no house anywhere else: the farms keep one-floor sheds (the shipped farms' two houses read 90% visible against the 92% scoring cap)
    expect(rowsOf.join('').split('h').length - 1).toBe(8);
  });

  it('keeps the main road clear: the diagonal is road from the camp to its twin, and the yards stand at least 5 tiles off it', () => {
    for (let k = 18; k < 78; k++) expect(rowsOf[k][k], `road ${k}`).toBe('r');
    for (const y of Object.values(YARDS)) {
      for (const [x, yy] of [[y.x0, y.y0], [y.x0 + 5, y.y0], [y.x0, y.y0 + 5], [y.x0 + 5, y.y0 + 5]]) expect(Math.abs(x - yy)).toBeGreaterThanOrEqual(5);
    }
  });

  it('the farms: a six-tile ring of 16 wall tiles with a one-floor shed, each holding its marker inside, two tiles off the bed\'s scree at least (Python)', () => {
    expect(Object.keys(FARMS)).toEqual(['farm_near_0', 'farm_far_1']);
    const m = large.markers as Record<string, Pt>;
    const bed: number[][] = [];
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (rowsOf[y][x] === 'b' && levelOf(x, y) === 0) bed.push([x, y]);
    for (const [name, f] of Object.entries(FARMS)) {
      for (const [x0, y0] of [[f.x0, f.y0], [90 - f.x0, 90 - f.y0]]) {
        expect(walls(x0, y0, 6, 6), `${name} yard ${x0},${y0}`).toBe(16);
        let gap = Infinity;
        for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
          if (i > 0 && i < 5 && j > 0 && j < 5) continue;
          for (const [bx, by] of bed) gap = Math.min(gap, Math.max(Math.abs(bx - (x0 + i)), Math.abs(by - (y0 + j))));
        }
        expect(gap, `${name} yard ${x0},${y0}`).toBeGreaterThanOrEqual(2);
      }
      const own = name === 'farm_near_0' ? ['farm_near_0', 'farm_near_1'] : ['farm_far_1', 'farm_far_0'];
      const rects = [[f.x0, f.y0], [90 - f.x0, 90 - f.y0]];
      own.forEach((k, i) => {
        const [x0, y0] = rects[i];
        expect(m[k][0] > x0 && m[k][0] < x0 + 5 && m[k][1] > y0 && m[k][1] < y0 + 5, `${k} marker is inside its yard`).toBe(true);
        expect(rowsOf[m[k][1]][m[k][0]], k).toBe('.');
      });
    }
  });

  it('four sheepfolds, 12 wall tiles each (a five-by-four ring, a gap in each long side), two a flank; with the yards and farms that is all 176 walls', () => {
    expect(FOLDS).toEqual([[46, 22, 5, 4, [[48, 22], [48, 25]]], [22, 46, 4, 5, [[22, 48], [25, 48]]]]);
    for (const [x0, y0, w, h, gaps] of FOLDS) {
      for (const [fx, fy] of [[x0, y0], [96 - x0 - w, 96 - y0 - h]]) expect(walls(fx, fy, w, h), `fold ${fx},${fy}`).toBe(12);
      for (const [gx, gy] of gaps) expect(rowsOf[gy][gx]).toBe('.');
    }
    expect(rowsOf.join('').split('=').length - 1).toBe(64 + 64 + 48);
  });

  it('the funnel: two jagged strips of scree at level 2 on the plain beside the road, 72 core tiles (|x - y| of 7 or 8) and 30 fringe (6 or 9)', () => {
    expect(FUNNEL).toEqual({ core: [7, 8], from: 59, to: 76 });
    let core = 0;
    let fringe = 0;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (rowsOf[y][x] === 'b' && levelOf(x, y) === 2) {
          const v = Math.abs(x - y);
          expect(v >= 6 && v <= 9, `strip ${x},${y}`).toBe(true);
          if (v === 7 || v === 8) core++;
          else fringe++;
        }
      }
    }
    expect([core, fringe]).toEqual([72, 30]);
  });

  it('the cover: belts on a jittered lattice, none in the armour lane (|x - y| under 11 between the two shelves) but the ford scrub, 12.3% of the map and never cover 3', () => {
    expect([BELTS.stepX, BELTS.stepY, LANE_HALF]).toEqual([8, 8, 11]);
    let scrubInLane = 0;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if ('12on'.includes(rowsOf[y][x]) && Math.abs(x - y) < LANE_HALF && x + y > SHELF_REACH && x + y < 190 - SHELF_REACH) {
          // the only cover the lane holds is the ford scrub (the next test); a bluff's ring is outside it
          const band = (x + y >= 84 && x + y <= 92) || (x + y >= 98 && x + y <= 106);
          if (!band || rowsOf[y][x] !== '1') throw new Error(`cover ${rowsOf[y][x]} in the armour lane at ${x},${y}`);
          scrubInLane++;
        }
      }
    }
    expect(scrubInLane).toBe(22);
    let cover = 0;
    for (const r of rowsOf) for (const c of r) if ('123on'.includes(c)) cover++;
    expect(cover).toBe(1130); // Python count: 942 + 42 + 90 + 56 (the belts' 920 and the ford scrub's 22)
    expect(cover / 9216).toBeCloseTo(0.1226, 4);
  });

  it('the ford scrub: 22 tiles of cover 1 in the lane, nine diagonals short of each bank\'s bed (x + y 84-92 and 98-106), 11 a bank, on open ground', () => {
    expect(FORD_SCRUB).toEqual({ from: 84, to: 92, density: 25, symbol: '1', salt: 10 });
    // Python read of the staged rows: the 11 tiles of seat 0's bank, and their half-turns (95 - x, 95 - y) on seat 1's
    const bank0 = [[44, 40], [44, 42], [47, 42], [48, 42], [49, 42], [42, 43], [45, 43], [48, 43], [46, 44], [41, 45], [43, 47]];
    const tiles = [...bank0, ...bank0.map(([x, y]) => [95 - x, 95 - y])];
    for (const [x, y] of tiles) expect([rowsOf[y][x], levelOf(x, y)], `scrub ${x},${y}`).toEqual(['1', levelOf(x, y)]);
    expect(tiles).toHaveLength(22);
    // no other tile of the lane band is scrub, and every tile of the band that is not is not cover
    let inBand = 0;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        const band = (x + y >= 84 && x + y <= 92) || (x + y >= 98 && x + y <= 106);
        if (band && Math.abs(x - y) < LANE_HALF && '12on'.includes(rowsOf[y][x])) inBand++;
      }
    }
    expect(inBand).toBe(22);
  });
});

describe('the town pays', () => {
  it('the centre ford, the court of the town, is the richest zone at 80 a minute; each outer ford pays 30 (was 60 / 40 / 40); the total is still the shipped 300 a minute', () => {
    expect(RATES.centre_ford).toBe(80);
    const pay = Object.fromEntries(rules.income_zones.map((z) => [z.zone, z.rate_per_min]));
    expect(pay).toEqual({
      centre_ford: 80, ne_ford: 30, sw_ford: 30,
      bluff_near_0: 20, bluff_near_1: 20, bluff_far_0: 20, bluff_far_1: 20,
      farm_near_0: 20, farm_near_1: 20, farm_far_0: 20, farm_far_1: 20,
    });
    expect(Math.max(...Object.values(pay))).toBe(pay.centre_ford);
    expect(rules.income_zones.reduce((a, z) => a + z.rate_per_min, 0)).toBe(300);
    expect(shippedRules.income_zones.reduce((a, z) => a + z.rate_per_min, 0)).toBe(300);
    expect(shippedRules.income_zones.find((z) => z.zone === 'centre_ford')?.rate_per_min).toBe(60);
  });

  it('the court is reachable by wheels from either seat (the corridor of an income zone is cut when it is not) and holds the whole of the ford\'s gap: the zone rect covers the bed at v = -2..2', () => {
    const [zx, zy, zw, zh] = large.zones!.centre_ford as number[];
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (Math.abs(x - y) <= 2 && levelOf(x, y) === 0 && rowsOf[y][x] !== 'b') {
          expect(x >= zx && x < zx + zw && y >= zy && y < zy + zh, `ford floor ${x},${y} is inside the zone`).toBe(true);
        }
      }
    }
    const rep = verifyLargeMap(large, rules, spec());
    expect(rep.facts.wheels_via_centre_only).toBe(rep.facts.wheels_seat_to_seat); // the road through the court is the short way
  });

  it('RED: a spec that expects the shipped split (60 / 40 / 40) fails on the redo\'s rates only where the twin check would see a difference, and a rates table that does not sum to 300 is red', () => {
    const withRate = (zone: string, rate: number): VersusRulesJson => ({
      ...rules,
      income_zones: rules.income_zones.map((z) => (z.zone === zone ? { ...z, rate_per_min: rate } : z)),
    });
    const r2 = withRate('centre_ford', 60);
    expect(verifyLargeMap(large, r2, spec()).failures.some((f) => f.includes('income is 280 a minute, not 300'))).toBe(true);
    const r3 = withRate('farm_near_1', 30);
    expect(verifyLargeMap(large, r3, spec()).failures.some((f) => f.includes('farm_near_1 pays 30 and its twin farm_near_0 pays 20'))).toBe(true);
  });
});

describe('the seal: three fords, and nothing else', () => {
  it('with the crossings plugged no vehicle crosses; each alone carries one at the same cost both ways; the centre ford is the short way', () => {
    const rep = verifyLargeMap(large, rules, spec());
    expect(rep.failures).toEqual([]);
    expect(rep.facts.wheels_all_plugged).toBe('no route');
    expect(rep.facts.wheels_via_ne_ford_only).toBe(rep.facts.wheels_via_sw_ford_only);
    expect(rep.facts.wheels_via_centre_only).toBe(rep.facts.wheels_seat_to_seat);
    expect(Number(rep.facts.wheels_via_centre_only)).toBeLessThan(Number(rep.facts.wheels_via_ne_ford_only));
    expect(rep.facts.fat_stairs).toBe(0);
  });

  it('RED: a hole through the bed (its five scree tiles on a row turned to open ground) opens a fourth crossing', () => {
    const j = clone();
    for (let x = 74; x <= 78; x++) setBoth(j.rows as string[], x, 20, '.'); // row 20 of the bed: x + y in 94..98, clear of both ford plugs
    const out = failuresOf(j);
    expect(out.some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(true);
    expect(out.some((f) => f.startsWith('symmetry'))).toBe(false);
  });

  it('RED: a spec that forgets the centre ford as a crossing sees the town leak; one that forgets an outer ford sees it leak', () => {
    const s = spec();
    const noCentre = { ...s, crossings: s.crossings!.filter((c) => c.name !== 'centre') };
    expect(failuresOf(large, noCentre).some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(true);
    const noNe = { ...s, crossings: s.crossings!.filter((c) => c.name !== 'ne_ford') };
    expect(failuresOf(large, noNe).some((f) => f.includes('with every crossing plugged a vehicle still crosses'))).toBe(true);
  });
});

describe('the verifier on it: every B2 check and the versus visibility gate, run on the staged data', () => {
  it('passes every check, with the seats on the main diagonal and no marker alone', () => {
    const { json, rules: r, spec: s } = staged('wadi_tarfan_l_redo');
    expect(s.antiDiagonal).toBeUndefined();
    expect(s.lone).toBeUndefined();
    expect(s.maxBuiltShare).toBe(0.01);
    expect(s.maxFatStairs).toBeUndefined();
    const rep = verifyLargeMap(json, r, s);
    expect(rep.failures).toEqual([]);
    expect(rep.facts.asymmetric_tiles).toBe(0);
    expect(rep.facts.seat_distance).toBe(77.8);
    expect(rep.facts.road_stairs).toBe(0);
    expect(rep.facts.road_blocks).toBe(0);
    expect(rep.facts.thick_wall_blocks).toBe(0);
    expect(rep.facts.buildings).toBe(12); // 2 houses, 8 sheds (4 farm sheds and 4 yard sheds), 2 pump houses
    expect(Number(rep.facts.built_share)).toBeCloseTo(32 / 9216, 4); // 32 building tiles
    expect(Number(rep.facts.cover_share)).toBeCloseTo(1130 / 9216, 4);
    expect(Number(rep.facts.cover_share)).toBeGreaterThanOrEqual(0.1);
    expect(Number(rep.facts.cover_share)).toBeLessThanOrEqual(0.14);
  });

  it('holds the versus visibility gate: the whole map, the seat corridor, every scoring zone and the town', async () => {
    const { json, rules: r, spec: s } = staged('wadi_tarfan_l_redo');
    expect('towns' in s.visibility ? s.visibility.towns : null).toEqual(['town']);
    const v = await verifyVersusVisibility(json, r, s);
    expect(v.failures).toEqual([]);
    expect(Number(v.facts.visible_whole_map)).toBeGreaterThanOrEqual(0.95);
    expect(Number(v.facts.visible_corridor)).toBeGreaterThanOrEqual(0.92);
    expect(Number(v.facts.visible_town)).toBeGreaterThanOrEqual(0.85);
    // the shipped farms read 90% (two houses each); a one-floor shed clears the 92% scoring cap in all four
    for (const w of ['farm_near_0', 'farm_near_1', 'farm_far_0', 'farm_far_1', 'centre_ford', 'ne_ford', 'sw_ford']) expect(Number(v.facts[`visible_${w}`]), w).toBeGreaterThanOrEqual(0.93);
    expect(Number(v.facts.building_share)).toBeLessThanOrEqual(0.03);
    expect(Number(v.facts.built_town)).toBeCloseTo(24 / 676, 4);
    expect(Number(v.facts.house_share)).toBeCloseTo(8 / 32, 3); // 25%, under the 40% cap
    expect(v.facts.building_tiles).toBe(32);
  });

  it('RED: caps just over the map\'s own readings turn the town red twice over: its visible share (98.6%) and its built share (3.6%)', async () => {
    const { json, rules: r, spec: s } = staged('wadi_tarfan_l_redo');
    const tight = await verifyVersusVisibility(json, r, s, { town: 0.99, maxTownBuiltShare: 0.03 });
    expect(tight.failures.some((f) => f.includes('of the town town is visible, under 99%'))).toBe(true);
    expect(tight.failures.some((f) => f.includes('buildings cover 3.6% of town zone town, over 3%'))).toBe(true);
    expect(tight.failures).toHaveLength(2); // and nothing else is red
    const exact = await verifyVersusVisibility(json, r, s, { town: 0.98, maxTownBuiltShare: 0.04 });
    expect(exact.failures).toEqual([]);
  });

  it('is bound to the gate: the spec holds a town list, and the exempt set is the three offered maps only', () => {
    expect(spec().visibility).toEqual({ towns: ['town'] });
    expect(Object.keys(SPECS).filter((id) => 'exempt' in SPECS[id]().visibility).sort()).toEqual(['milh_flats_l', 'rujm_sawda', 'wadi_tarfan_l']);
  });
});

describe('the triangle bill: it fits the render budget from the start', () => {
  const ms = meshesOf(large);

  it('counts, by a Python flood fill and a Python parse of the GLBs: 176 walls, 2 houses, 8 sheds, 2 pump houses, no ditch; 693,788 triangles a pass', () => {
    const b = billOf(ms);
    expect(Object.fromEntries(Object.entries(b.byType).map(([k, v]) => [k, v.meshes]))).toEqual({ wall: 176, shanty: 8, house: 2, pump_house: 2 });
    expect(b.perPass).toBe(693_788); // 176*3087 + 2*39016 + 8*7157 + 2*7594
    expect(b.frame).toBe(2_081_364);
  });

  it('the centre 48x48 draws 506,602 a pass and the densest 48x48 525,124 (at 35,18), against the control\'s 694,926 in its whole map', () => {
    expect(centreBill(ms, 96, 48).perPass).toBe(506_602);
    const d = densestWindow(ms, 96, 48);
    expect(d.bill.perPass).toBe(525_124);
    expect([d.x0, d.y0]).toEqual([35, 18]);
    const control = billOf(meshesOf(maps.milh_flats as unknown as MapJson));
    expect(control.perPass).toBe(694_926);
    expect(d.bill.perPass).toBeLessThan(control.perPass);
  });

  it('the verifier reads the same numbers, and the predicted cost against the control is NEGATIVE at the centre (-0.37 ms) and in the densest window (-0.33 ms)', () => {
    const rep = verifyLargeMap(large, rules, spec());
    expect(rep.facts.triangles_control_per_pass).toBe(694_926);
    expect(rep.facts.triangles_whole_per_pass).toBe(693_788);
    expect(rep.facts.triangles_centre_per_pass).toBe(506_602);
    expect(rep.facts.triangles_densest_per_pass).toBe(525_124);
    expect(rep.facts.triangles_densest_at).toBe('35,18');
    expect(rep.facts.triangles_centre_vs_control_ms).toBe(-0.37);
    expect(rep.facts.triangles_densest_vs_control_ms).toBe(-0.33);
  });

  it('against the SHIPPED Wadi Tarfan (large) the redo draws 3.6 M fewer a pass over the map and 2.0 M fewer at the centre: the shipped 104 ditch tiles are 3.98 M of its 4.29 M', () => {
    const was = meshesOf(shipped);
    expect(billOf(was).perPass).toBe(4_289_938);
    expect(billOf(was).byType.ditch).toEqual({ meshes: 104, triangles: 3_976_960 });
    expect(centreBill(was, 96, 48).perPass).toBe(2_515_458);
    expect(densestWindow(was, 96, 48).bill.perPass).toBe(2_783_138);
    expect(billOf(ms).perPass - billOf(was).perPass).toBe(-3_596_150);
    expect(centreBill(ms, 96, 48).perPass - centreBill(was, 96, 48).perPass).toBe(-2_008_856);
  });

  it('RED: eight more houses in the centre window take it over the control (the centre check); six in the north take only the densest window over it', () => {
    // the centre window is x, y in [24, 72): open ground west of the town on seat 0's side, 4 apart so no two touch (a touching pair is one house)
    const a = clone();
    for (const [x, y] of [[26, 52], [30, 52], [26, 56], [41, 56], [34, 62], [30, 66], [34, 66], [38, 66]]) house(a.rows as string[], x, y);
    const outA = failuresOf(a);
    expect(outA.some((f) => f.includes('triangles: the centre 48x48'))).toBe(true);
    expect(outA.some((f) => f.includes('triangles: the densest 48x48'))).toBe(true);
    // rows 16-17 are above the centre window (y >= 24) and their half-turns (rows 78-79) below it
    const b = clone();
    for (const x of [26, 30, 34, 38, 42, 46]) house(b.rows as string[], x, 16);
    const outB = failuresOf(b);
    expect(outB.some((f) => f.includes('triangles: the densest 48x48'))).toBe(true);
    expect(outB.some((f) => f.includes('triangles: the centre 48x48'))).toBe(false);
    const rep = verifyLargeMap(b, rules, spec());
    expect(rep.facts.triangles_centre_per_pass).toBe(506_602); // unchanged: none of the six stands in it
  });

  it('the sim holds 256 structures and every wall tile is one: the redo stands 188 (176 walls, 12 buildings), 68 under the cap', () => {
    const sim = readFileSync(join(ROOT, 'packages', 'sim', 'src', 'sim.ts'), 'utf8');
    const cap = Number(/const MAX_STRUCTURES = (\d+);/.exec(sim)?.[1]);
    expect(cap).toBe(256);
    expect(parseMap(large).structures).toHaveLength(188);
    expect(cap - parseMap(large).structures.length).toBe(68);
  });

  it('RED: a spec that states no `triangles` is not held to a bill (the check is the spec\'s)', () => {
    const j = clone();
    for (const [x, y] of [[26, 52], [30, 52], [26, 56], [41, 56], [34, 62], [30, 66], [34, 66], [38, 66]]) house(j.rows as string[], x, y);
    const s = { ...spec() } as Partial<ReturnType<typeof spec>>;
    delete s.triangles;
    expect(failuresOf(j, s as ReturnType<typeof spec>).some((f) => f.startsWith('triangles'))).toBe(false);
  });
});

describe('STAGED, not offered: the shipped Wadi Tarfan (large) is untouched', () => {
  it('its map is not the redo\'s: the shipped rows keep the ditch, the four farmhouses and the upscaled relief; and its generator still writes it', () => {
    expect(JSON.stringify(shipped.rows)).not.toBe(JSON.stringify(large.rows));
    expect(shipped.id).toBe('wadi_tarfan_l');
    const flat = (shipped.rows as string[]).join('');
    expect(flat.split('d').length - 1).toBe(104);
    expect(flat.split('h').length - 1).toBe(16); // four farmhouses of four tiles: the redo has two houses
    expect(parseMap(shipped).structures.filter((s) => s.type === 'house')).toHaveLength(4);
    expect(parseMap(large).structures.filter((s) => s.type === 'house')).toHaveLength(2);
    // the shipped relief slopes from 3 down to 0 over sixteen tiles; the redo's plain is flat at 2 with a cliff to the bed
    expect(Number((shipped.elevation as string[])[40][20])).toBe(3);
    expect(Number((shipped.elevation as string[])[40][40])).toBe(1);
    expect(levelOf(40, 40)).toBe(2);
  });

  it('the shipped spec is still exempt from the gate, still has the 1% cap and no triangle bill; the redo is a separate id', () => {
    expect('exempt' in SPECS.wadi_tarfan_l().visibility).toBe(true);
    expect(SPECS.wadi_tarfan_l().maxBuiltShare).toBe(0.01);
    expect(SPECS.wadi_tarfan_l().triangles).toBeUndefined();
    expect(Object.keys(SPECS)).toContain('wadi_tarfan_l_redo');
    expect((shippedRules.income_zones.find((z) => z.zone === 'ne_ford') ?? { rate_per_min: 0 }).rate_per_min).toBe(40);
  });
});
