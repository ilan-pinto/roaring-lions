// The generic large-map verifier (GH-920 B2), held three ways, as rujm_sawda.test.ts holds Rujm's:
//   1. green on both shipped large maps (Rujm Sawda 80x80, Wadi Tarfan (large) 96x96);
//   2. RED on each census distortion of design 2.2, each constructed on the shipped Wadi Tarfan (large)
//      and asserting the specific line it must draw, with the rest of the map kept symmetric so that
//      only the distortion is wrong: a 4x house, a 2-thick wall, a staircase road (a 2x2 block and an
//      orthogonal staircase), a 2-thick ditch, a scalloped contour, a marker at 2x on both halves;
//   3. RED on the checks Rujm's verifier has always had (symmetry, the seats, spawns, the cut, the
//      economy, tunnels), re-run on this map.
// And the naive 2x copy of the 48x48 map, built here from data/maps/wadi_tarfan.json with no look stage at all,
// must be red on every distortion at once: that is what the verifier is for.
import { describe, expect, it } from 'vitest';
import { maps, versusRules, type MapJson, type VersusRulesJson } from '@lions/data';
import { SPECS, shipped, staged, verifyLargeMap, verifyVersusVisibility } from './large_map_verify';

const W = 96;

interface Rules {
  ends: Record<'friendly' | 'hostile', { camp: { at: number[]; size: number[] } }>;
  tunnels: Record<'friendly' | 'hostile', { id: string; points: number[][]; capacity: number }[]>;
  income_zones: { zone: string; rate_per_min: number }[];
}
type Doc = { json: MapJson; rules: Rules };
const fresh = (): Doc => {
  const s = shipped('wadi_tarfan_l');
  return { json: JSON.parse(JSON.stringify(s.json)) as MapJson, rules: JSON.parse(JSON.stringify(s.rules)) as Rules };
};
const rowsOf = (d: Doc) => d.json.rows as string[];
const elevOf = (d: Doc) => d.json.elevation as string[];
const setRow = (rows: string[], x: number, y: number, c: string) => {
  rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1);
};
/** Write `c` at (x, y) and at its half-turn twin, so a mutation that is NOT about symmetry keeps the map symmetric. */
const setBoth = (rows: string[], x: number, y: number, c: string) => {
  setRow(rows, x, y, c);
  setRow(rows, W - 1 - x, W - 1 - y, c);
};
const failures = (d: Doc) => verifyLargeMap(d.json, d.rules as unknown as VersusRulesJson, SPECS.wadi_tarfan_l()).failures;
const has = (d: Doc, needle: string) => failures(d).some((f) => f.includes(needle));

/**
 * The top-left corner of a free square of `side` open tiles in the top half, one open tile clear of every
 * other feature on each side, off the seat and the diagonal the roads run along. (The margin was two until
 * GH-920 B4: the pump-house plinth and the vents near the centre took the last 10 x 10 clear ground.)
 */
function freeSquare(d: Doc, side: number, after = 0): [number, number] {
  const rows = rowsOf(d);
  let seen = 0;
  for (let y = 4; y < 40; y++) {
    for (let x = 4; x < W - 4 - side; x++) {
      let ok = true;
      for (let yy = y - 1; yy < y + side + 1 && ok; yy++) for (let xx = x - 1; xx < x + side + 1 && ok; xx++) if (rows[yy][xx] !== '.') ok = false;
      // keep off the seat's formation and the diagonal the roads run along
      if (ok && !(x < 30 && y < 32) && Math.abs(x - y) > 6 && seen++ === after) return [x, y];
    }
  }
  throw new Error('no free square');
}

describe('green on the shipped large maps', () => {
  it('Wadi Tarfan (large) passes every check', () => {
    const { json, rules, spec } = shipped('wadi_tarfan_l');
    const r = verifyLargeMap(json, rules, spec);
    expect(r.failures).toEqual([]);
    expect(r.facts.asymmetric_tiles).toBe(0);
    expect(r.facts.seat_distance).toBe(77.8);
    expect(r.facts.fat_stairs).toBe(0);
    expect(r.facts.road_stairs).toBe(0);
    expect(r.facts.road_blocks).toBe(0);
    expect(r.facts.thick_wall_blocks).toBe(0);
    expect(r.facts.thick_ditch_blocks).toBe(0);
    expect(r.facts.wheels_all_plugged).toBe('no route');
    expect(Number(r.facts.built_share)).toBeLessThanOrEqual(0.01);
    expect(Number(r.facts.cover_share)).toBeGreaterThanOrEqual(0.085);
    expect(Number(r.facts.cover_share)).toBeLessThanOrEqual(0.11);
  });

  it('Rujm Sawda passes every check, its mesas\' 26 staircases named as the one exemption', () => {
    const { json, rules, spec } = shipped('rujm_sawda');
    const r = verifyLargeMap(json, rules, spec);
    expect(r.failures).toEqual([]);
    expect(r.facts.fat_stairs).toBe(26);
    expect(spec.maxFatStairs).toBe(26);
    // ...and the exemption is a ceiling, not a pass: one fewer allowed and the check goes red
    expect(verifyLargeMap(json, rules, { ...spec, maxFatStairs: 25 }).failures.some((f) => f.includes('2x2 diagonal step'))).toBe(true);
    // a spec that names no lone marker refuses Rujm's `centre`
    expect(verifyLargeMap(json, rules, { ...spec, lone: [] }).failures.some((f) => f.includes('markers with no twin tile: centre'))).toBe(true);
  });

  it('the 96x96 twin has the 48x48 original\'s building shapes, exactly', () => {
    const d = fresh();
    expect(failures(d)).toEqual([]);
    const spec = SPECS.wadi_tarfan_l();
    expect(spec.reference?.id).toBe('wadi_tarfan');
    // a spec with no reference still holds the ceilings; the reference is the sharper check
    expect(verifyLargeMap(d.json, d.rules as unknown as VersusRulesJson, { ...spec, reference: undefined }).failures).toEqual([]);
  });
});

describe('red on each census distortion of a naive 2x upscale (design 2.2)', () => {
  it('a house four times its footprint: 4x4 where the native one is 2x2', () => {
    const d = fresh();
    const [x, y] = freeSquare(d, 4);
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) setBoth(rowsOf(d), x + dx, y + dy, 'h');
    const out = failures(d);
    expect(out.some((f) => f.includes("building(s) over their type's native footprint") && f.includes('house 4x4:16'))).toBe(true);
    expect(out.some((f) => f.includes('house shapes are'))).toBe(true);
    expect(out.some((f) => f.startsWith('symmetry'))).toBe(false);
  });

  it('a house of the right size is not red on the ceiling, but is red against the reference (a pump house drawn 2x2)', () => {
    const d = fresh();
    const [x, y] = freeSquare(d, 2);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) setBoth(rowsOf(d), x + dx, y + dy, 'p');
    const out = failures(d);
    expect(out.some((f) => f.includes('native footprint'))).toBe(false); // 4 tiles is the pump house's ceiling
    expect(out.some((f) => f.includes('pump_house shapes are'))).toBe(true);
  });

  it('a wall two tiles thick', () => {
    const d = fresh();
    const [x, y] = freeSquare(d, 4);
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 2; dy++) setBoth(rowsOf(d), x + dx, y + dy, '=');
    // a 4x2 slab of wall holds 3 2x2 blocks, and its twin another 3
    expect(has(d, 'census: 6 2x2 block(s) of wall, a wall two tiles thick')).toBe(true);
  });

  it('a ditch two tiles thick', () => {
    const d = fresh();
    const [x, y] = freeSquare(d, 4);
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 2; dy++) setBoth(rowsOf(d), x + dx, y + dy, 'd');
    expect(failures(d).some((f) => /census: \d+ 2x2 block\(s\) of ditch, a ditch two tiles thick/.test(f))).toBe(true);
  });

  it('a road drawn as 2x2 blocks (the PR 928 zig-zag)', () => {
    const d = fresh();
    const [x, y] = freeSquare(d, 6);
    // two blocks one step apart on the diagonal: the naive 2x of a corner-touching chain
    for (const [bx, by] of [[0, 0], [2, 2]]) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) setBoth(rowsOf(d), x + bx + dx, y + by + dy, 'r');
    const out = failures(d);
    expect(out.some((f) => /census: 4 2x2 block\(s\) of road, a staircase road/.test(f))).toBe(true);
  });

  it('a road drawn as an orthogonal staircase: bend tiles side by side', () => {
    const d = fresh();
    const [x, y] = freeSquare(d, 6);
    // (0,0) (1,0) (1,1) (2,1) (2,2) (3,2): each of the four inner tiles is a bend and each touches the next
    for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]]) setBoth(rowsOf(d), x + dx, y + dy, 'r');
    const out = failures(d);
    expect(out.some((f) => f.includes('road bend(s) side by side, an orthogonal staircase'))).toBe(true);
    expect(out.some((f) => f.includes('of road, a staircase road'))).toBe(false);
  });

  it('a Z of road, drawn either way up: bends side by side across the row, or down the column', () => {
    // each orientation puts its two bend tiles next to each other in only ONE direction, so each needs its own look
    for (const z of [[[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 0], [0, 1], [1, 1], [1, 2]]]) {
      const d = fresh();
      const [x, y] = freeSquare(d, 6);
      for (const [dx, dy] of z) setBoth(rowsOf(d), x + dx, y + dy, 'r');
      expect(has(d, 'road bend(s) side by side, an orthogonal staircase'), JSON.stringify(z)).toBe(true);
    }
  });

  it('a one-tile chain with a single corner is NOT a staircase (a right angle is fine)', () => {
    const d = fresh();
    const [x, y] = freeSquare(d, 6);
    for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]) setBoth(rowsOf(d), x + dx, y + dy, 'r');
    expect(failures(d)).toEqual([]);
  });

  it('a scalloped contour: a bank drawn on 2x2 cells (the naive copy of one tile a step)', () => {
    const d = fresh();
    // a clean cell-diagonal bank across a free patch of level-1 ground, mirrored: x/2 + y/2 on a 2x2 grid
    const el = elevOf(d);
    let changed = 0;
    const [x0, y0] = [4, 26]; // open plain, nowhere near a contour; elevation needs no free ground
    expect(failures(d)).toEqual([]);
    for (let dy = 0; dy < 12; dy++) {
      for (let dx = 0; dx < 12; dx++) {
        const lv = (dx >> 1) + (dy >> 1) >= 6 ? '3' : '2';
        for (const [x, y] of [[x0 + dx, y0 + dy], [W - 1 - (x0 + dx), W - 1 - (y0 + dy)]]) {
          if (el[y][x] !== lv) changed++;
          setRow(el, x, y, lv);
        }
      }
    }
    expect(changed).toBeGreaterThan(0);
    const out = failures(d);
    expect(out.some((f) => /census: \d+ 2x2 diagonal step\(s\) in the relief, a contour that will scallop/.test(f))).toBe(true);
  });

  it('a marker at 2x on BOTH halves: the twin of 2x is 95 - 2x, not 2 x its own tile', () => {
    const d = fresh();
    const mk = d.json.markers as Record<string, number[]>;
    // versus_1 drawn naively at twice its source tile, (37, 37) -> (74, 74); its twin tile (21,21) is then unmarked
    mk.versus_1 = [74, 74];
    const out = failures(d);
    expect(out.some((f) => f.includes('symmetry: versus_1 74,74 is not versus_0 20,20 mirrored'))).toBe(true);
    expect(out.some((f) => f.includes('symmetry: markers with no twin tile'))).toBe(true);
  });

  it('every marker naively doubled, centre and centre_ford among them: the twin pairs break', () => {
    const d = fresh();
    const src = maps.wadi_tarfan as unknown as MapJson;
    d.json.markers = Object.fromEntries(Object.entries(src.markers as Record<string, number[]>).map(([n, p]) => [n, [2 * p[0], 2 * p[1]]]));
    const out = failures(d);
    expect(out.filter((f) => f.startsWith('symmetry')).length).toBeGreaterThan(2);
  });
});

describe('the naive 2x copy of Wadi Tarfan is red on every distortion at once', () => {
  it('nearest-neighbour rows and levels, markers at 2x, zones at 4x: the whole census', () => {
    const src = maps.wadi_tarfan as unknown as MapJson;
    const rows = (src.rows as string[]).flatMap((r) => {
      const wide = [...r].map((c) => c + c).join('');
      return [wide, wide];
    });
    const elevation = (src.elevation as string[]).flatMap((r) => {
      const wide = [...r].map((c) => c + c).join('');
      return [wide, wide];
    });
    const d = fresh();
    d.json = {
      ...src,
      id: 'wadi_tarfan_l',
      width: W,
      height: W,
      rows,
      elevation,
      markers: Object.fromEntries(Object.entries(src.markers as Record<string, number[]>).map(([n, p]) => [n, [2 * p[0], 2 * p[1]]])),
      zones: Object.fromEntries(Object.entries(src.zones as Record<string, number[]>).map(([n, r]) => [n, r.map((v) => 2 * v)])),
    } as MapJson;
    const out = failures(d);
    expect(out.some((f) => f.includes('native footprint'))).toBe(true); // houses are 4x4
    expect(out.some((f) => f.includes('house shapes are'))).toBe(true);
    expect(out.some((f) => /2x2 block\(s\) of wall/.test(f))).toBe(true);
    expect(out.some((f) => /2x2 block\(s\) of ditch/.test(f))).toBe(true);
    expect(out.some((f) => /2x2 block\(s\) of road/.test(f))).toBe(true);
    expect(out.some((f) => f.includes('2x2 diagonal step'))).toBe(true);
    expect(out.some((f) => f.startsWith('symmetry: markers with no twin tile') || f.startsWith('symmetry: versus_1'))).toBe(true);
  });
});

describe('red on everything the Rujm verifier has always refused, on this map', () => {
  it('one row character flipped (symmetry)', () => {
    const d = fresh();
    expect(rowsOf(d)[2][2]).toBe('.');
    setRow(rowsOf(d), 2, 2, '1');
    expect(has(d, 'symmetry: 2 tiles are not their half-turn twin, first row 2,2')).toBe(true);
  });

  it('one elevation digit lowered (symmetry)', () => {
    const d = fresh();
    const was = elevOf(d)[2][2];
    setRow(elevOf(d), 2, 2, String(Number(was) - 1));
    expect(has(d, 'first elevation 2,2')).toBe(true);
  });

  it('both seats moved off the main diagonal, still a symmetric pair', () => {
    const d = fresh();
    const mk = d.json.markers as Record<string, number[]>;
    mk.versus_0 = [20, 22];
    mk.versus_1 = [75, 73];
    const out = failures(d);
    expect(out.some((f) => f.includes('seats: versus_0 (20,22) is not on the main diagonal'))).toBe(true);
    expect(out.some((f) => f.startsWith('symmetry: versus_1'))).toBe(false);
  });

  it('a ridge on a formation tile, its twin too (spawns, in all three pairings)', () => {
    const d = fresh();
    expect('.n').toContain(rowsOf(d)[25][22]); // seat 0 + (2, 5): open ground, and a tile both forces use
    setBoth(rowsOf(d), 22, 25, '^');
    const out = failures(d);
    for (const pair of ['kdf/kdf', 'kdf/sarim', 'sarim/kdf']) {
      expect(out.some((f) => f.startsWith(`spawns: ${pair}`) && f.includes('closed to wheels')), pair).toBe(true);
      expect(out.some((f) => f.startsWith(`spawns: ${pair}:`) && f.includes('not placed on their formation tile')), pair).toBe(true);
    }
  });

  it('a camp standing on the formation: a unit would spawn under it', () => {
    const d = fresh();
    d.rules.ends.friendly.camp.at = [21, 21];
    d.rules.ends.hostile.camp.at = [73, 73]; // its half-turn image, so the camps stay a pair
    const out = failures(d);
    expect(out.some((f) => f.startsWith('spawns:') && f.includes('is on a camp tile'))).toBe(true);
    expect(out.some((f) => f.includes('the hostile camp is not'))).toBe(false);
  });

  it('a marker on rock', () => {
    const d = fresh();
    (d.json.markers as Record<string, number[]>).farm_near_0 = [64, 32];
    expect(rowsOf(d)[32][64]).toBe('^');
    expect(has(d, 'markers: farm_near_0 (64,32) is on ^')).toBe(true);
  });

  it('the cut: a vehicle gap in the ditch away from every ford', () => {
    const d = fresh();
    expect(failures(d)).toEqual([]);
    // the ditch runs down column 64 through rows 38..39; open both tiles (and their twins) and a vehicle crosses
    expect(rowsOf(d)[38][64]).toBe('d');
    expect(rowsOf(d)[39][64]).toBe('d');
    for (const y of [38, 39]) setBoth(rowsOf(d), 64, y, '.');
    expect(has(d, 'the wadi leaks')).toBe(true);
  });

  it('the cut: the centre ford filled in does not carry a vehicle alone', () => {
    const d = fresh();
    for (let y = 44; y <= 51; y++) for (let x = 44; x <= 51; x++) setBoth(rowsOf(d), x, y, 'd');
    expect(has(d, 'cut: centre alone does not carry a vehicle from seat 0 to seat 1')).toBe(true);
    expect(has(d, 'cut: ne_ford alone')).toBe(false);
  });

  it('built share over 1%: a hundred more building tiles', () => {
    const d = fresh();
    for (let y = 4; y < 14; y++) for (let x = 30; x < 40; x++) if (rowsOf(d)[y][x] === '.') setBoth(rowsOf(d), x, y, 's');
    expect(has(d, 'buildings: built share')).toBe(true);
  });

  it('cover share outside 8.5-11%: the scrub stripped', () => {
    const d = fresh();
    d.json.rows = rowsOf(d).map((r) => r.replace(/[12]/g, '.'));
    expect(has(d, 'census: cover share')).toBe(true);
  });

  it('a lone building with no twin', () => {
    const d = fresh();
    const [x, y] = freeSquare(d, 2);
    setRow(rowsOf(d), x, y, 'p');
    expect(has(d, 'has no mirrored twin')).toBe(true);
  });

  it('a hostile route that is not its twin, a camp moved, a zone that pays unequally, a route dropped', () => {
    const a = fresh();
    a.rules.tunnels.hostile[0].capacity += 1;
    expect(has(a, 'hostile route wtl_h_north is not friendly route wtl_f_north mirrored')).toBe(true);

    const b = fresh();
    b.rules.ends.hostile.camp.at = [78, 77];
    expect(has(b, 'the hostile camp is not the friendly camp mirrored')).toBe(true);

    const c = fresh();
    c.rules.income_zones[3].rate_per_min += 5;
    expect(has(c, 'economy: income is 305 a minute, not 300')).toBe(true);
    expect(has(c, 'its twin')).toBe(true);

    const e = fresh();
    e.rules.tunnels.friendly = e.rules.tunnels.friendly.slice(0, 1);
    expect(has(e, 'economy: tunnel routes per end are 1 and 2, not 2 and 2')).toBe(true);
  });

  it('a vent inside 18 tiles of the opposing anchor', () => {
    const d = fresh();
    const pts = d.rules.tunnels.friendly[0].points;
    pts[pts.length - 1] = [64, 64]; // 15.6 tiles from (75,75)
    expect(has(d, 'the least is 18')).toBe(true);
  });

  it('the wrong size', () => {
    const d = fresh();
    d.json = { ...d.json, width: 95 } as MapJson;
    expect(has(d, 'shape: 95x96, not 96x96')).toBe(true);
  });

  it('is the shipped data the verifier read (a spec keyed to a map that does not exist throws)', () => {
    expect(() => shipped('nowhere')).toThrow('no large-map spec for "nowhere"');
    expect((versusRules as Record<string, VersusRulesJson>).wadi_tarfan_l.cap_minutes).toBe(35);
  });
});

// --- the built-share cap is PER MAP (GH-974) ----------------------------------------------------------------------------
// It was one global 1% (MAX_BUILT_SHARE), an upscale-fidelity check: a naive 2x copy draws every building four times its
// footprint, so a map's share quadruples. Milh Flats (large), redone (STAGED), has a town of its own (0.76% built, 1.2% in the
// design's mock, and the versus visibility gate holds a town to 3%), so the cap is the spec's: `maxBuiltShare`, required.
describe('the built-share cap is per map', () => {
  const milh = () => {
    const s = staged('milh_flats_l_redo');
    return { json: JSON.parse(JSON.stringify(s.json)) as MapJson, rules: s.rules, spec: s.spec };
  };
  const built = (r: { failures: string[] }) => r.failures.some((f) => f.includes('buildings: built share'));

  it('each spec names its own cap: the three upscaled maps the old 1%, the redo of Milh Flats (large) 3%', () => {
    expect(SPECS.rujm_sawda().maxBuiltShare).toBe(0.01);
    expect(SPECS.wadi_tarfan_l().maxBuiltShare).toBe(0.01);
    expect(SPECS.milh_flats_l().maxBuiltShare).toBe(0.01);
    expect(SPECS.milh_flats_l_redo().maxBuiltShare).toBe(0.03);
    expect(SPECS.rujm_sawda_redo().maxBuiltShare).toBe(0.01); // 0.75% built: it fits the upscale era's cap too
    expect(SPECS.wadi_tarfan_l_redo().maxBuiltShare).toBe(0.01); // under 1% built: it fits the upscale era's cap too
  });

  it('RED: a cap just under a map\'s own share fails that map (the redo: 70 building tiles of 9,216 = 0.76%)', () => {
    const { json, rules, spec } = milh();
    expect(verifyLargeMap(json, rules, spec).failures).toEqual([]);
    const tight = verifyLargeMap(json, rules, { ...spec, maxBuiltShare: 0.007 });
    expect(built(tight)).toBe(true);
    expect(tight.failures.filter((f) => !f.includes('buildings: built share'))).toEqual([]); // and nothing else is red
    expect(built(verifyLargeMap(json, rules, { ...spec, maxBuiltShare: 0.0077 }))).toBe(false);
  });

  it('the cap is the spec\'s, not a global: 54 more sheds take the redo past 1% (red under a 1% spec) and not past 3% (green under its own)', () => {
    const { json, rules, spec } = milh();
    const rows = json.rows as string[];
    // single shanty tiles, two apart, on open plain north of the town and wadi (rows 3 and 5), each with its half-turn twin
    for (let x = 22; x <= 54; x += 2) setBoth(rows, x, 3, 's');
    for (let x = 22; x <= 40; x += 2) setBoth(rows, x, 5, 's');
    const own = verifyLargeMap(json, rules, spec);
    expect(Number(own.facts.built_share)).toBeGreaterThan(0.01);
    expect(Number(own.facts.built_share)).toBeLessThan(0.03);
    expect(built(own)).toBe(false);
    expect(built(verifyLargeMap(json, rules, { ...spec, maxBuiltShare: 0.01 }))).toBe(true);
  });
});

// --- the versus gate cannot be skipped by forgetting a field (GH-974 review) ---------------------------------------------
describe('the visibility gate is required of every spec', () => {
  it('the exempt set is exactly the three maps offered before the gate; every other spec (the two staged redos) holds a town list', () => {
    const exempt = Object.keys(SPECS).filter((id) => 'exempt' in SPECS[id]().visibility).sort();
    expect(exempt).toEqual(['milh_flats_l', 'rujm_sawda', 'wadi_tarfan_l']);
    const bound = Object.keys(SPECS).filter((id) => 'towns' in SPECS[id]().visibility);
    expect(bound).toEqual(['milh_flats_l_redo', 'rujm_sawda_redo', 'wadi_tarfan_l_redo']);
    expect(Object.keys(SPECS).length).toBe(exempt.length + bound.length);
  });

  it('RED: a spec that names neither `towns` nor `exempt` fails the gate (a fourth map that forgets the field)', async () => {
    const { json, rules, spec } = staged('milh_flats_l_redo');
    expect((await verifyVersusVisibility(json, rules, spec)).failures).toEqual([]);
    const forgot = { ...spec } as Partial<typeof spec>;
    delete forgot.visibility;
    const out = await verifyVersusVisibility(json, rules, forgot as typeof spec);
    expect(out.failures.some((f) => f.includes('names neither `towns` nor `exempt`'))).toBe(true);
  });

  it('an exempt spec is not measured (and says why), a bound one is', async () => {
    const w = shipped('wadi_tarfan_l');
    const out = await verifyVersusVisibility(w.json, w.rules, w.spec);
    expect(out.failures).toEqual([]);
    expect(String(out.facts.visibility_exempt)).toContain('GH-974');
    expect(out.facts.visible_whole_map).toBeUndefined();
  });
});

// GH-920 B3: Tel Marum (large) is NOT point-symmetric (a campaign valley played from two measured seats), so its spec says
// `asymmetric: true`. What that flag skips is held by the first test (it is the only reason the map passes), and each check it
// adds in place of the skipped ones is red on a constructed input.
describe('the asymmetric spec (Tel Marum (large))', () => {
  const freshTm = () => {
    const s = shipped('tel_marum_l');
    return { json: JSON.parse(JSON.stringify(s.json)) as MapJson, rules: JSON.parse(JSON.stringify(s.rules)) as Rules, spec: s.spec };
  };
  const setCell = (json: MapJson, x: number, y: number, c: string) => setRow(json.rows as string[], x, y, c);
  const run = (json: MapJson, rules: Rules, spec: ReturnType<typeof shipped>['spec']) => verifyLargeMap(json, rules as unknown as VersusRulesJson, spec).failures;

  it('passes every check on the shipped map, which is not point-symmetric, and reports the way back as a fact', () => {
    const { json, rules, spec } = freshTm();
    const r = verifyLargeMap(json, rules as unknown as VersusRulesJson, spec);
    expect(r.failures).toEqual([]);
    expect(Number(r.facts.asymmetric_tiles)).toBeGreaterThan(6000);
    expect(r.facts.foot_seat_to_seat_back).toBeDefined();
    expect(r.facts.wheels_seat_to_seat_back).toBeDefined();
  });

  it('read as symmetric the same map is red on the half-turn, the seat diagonal and the camps (the flag is what lets it through)', () => {
    const { json, rules, spec } = freshTm();
    const f = run(json, rules, { ...spec, asymmetric: false, displaced: undefined });
    for (const needle of ['are not their half-turn twin', 'is not the friendly camp mirrored', 'is not on the main diagonal', 'is not versus_0']) {
      expect(f.some((x) => x.includes(needle)), needle).toBe(true);
    }
  });

  it('the placer\'s moves are a literal: one too many or one too few is red, and so is a pairing the spec forgets', () => {
    const { json, rules, spec } = freshTm();
    expect(run(json, rules, { ...spec, displaced: { ...spec.displaced, 'kdf/sarim': 12 } }).some((x) => x.includes('kdf/sarim: the placer moved 13 units off their formation tile, the spec says 12'))).toBe(true);
    expect(run(json, rules, { ...spec, displaced: { ...spec.displaced, 'kdf/kdf': 8 } }).some((x) => x.includes('kdf/kdf: the placer moved 7 units'))).toBe(true);
    const rest = { ...spec.displaced };
    delete rest['sarim/kdf'];
    expect(run(json, rules, { ...spec, displaced: rest }).some((x) => x.includes('sarim/kdf: the spec pins no displaced count (the placer moved 10)'))).toBe(true);
  });

  it('a unit the placer puts on a boulder is red (closed to wheels), and one it puts on a camp tile is red', () => {
    const { json, rules, spec } = freshTm();
    // every open tile of the bowl rows 30-35 becomes boulder: the displaced Sarim-end units can only land on it
    for (let y = 30; y <= 35; y++) for (let x = 38; x <= 59; x++) if ((json.rows as string[])[y][x] === '.') setCell(json, x, y, 'b');
    const f = run(json, rules, spec);
    const landed = f.find((x) => x.includes('closed to wheels') && x.includes('landed on b'));
    expect(landed).toBeDefined();
    // a camp under where one lands
    const m = /landed on b at \((\d+),(\d+)\)/.exec(landed ?? '');
    expect(m).not.toBeNull();
    const fresh2 = freshTm();
    const camped = fresh2.rules;
    camped.ends.hostile.camp.at = [Number(m?.[1]), Number(m?.[2])];
    expect(run(fresh2.json, camped, fresh2.spec).some((x) => x.includes('landed on a camp tile'))).toBe(true);
  });

  it('a seat marker missing, a marker on rock and a marker off the map are red here as on a symmetric map', () => {
    const { json, rules, spec } = freshTm();
    const mk = json.markers as Record<string, number[]>;
    const keep = mk.versus_1;
    delete (mk as Record<string, unknown>).versus_1;
    expect(run(json, rules, spec).some((x) => x.includes('a seat marker is missing'))).toBe(true);
    mk.versus_1 = keep;
    mk.pass = [48, 40]; // the outcrop's rock
    expect(run(json, rules, spec).some((x) => x.includes('ground nothing can stand on'))).toBe(true);
    mk.pass = [200, 3]; // the loader itself refuses a marker off the map, before the verifier reads anything
    expect(() => run(json, rules, spec)).toThrow('is out of bounds');
  });

  it('the checks that are not about symmetry still bite: a vent inside 18 tiles of the opposing anchor, a dropped route, a house four times its footprint', () => {
    const { json, rules, spec } = freshTm();
    const r2 = JSON.parse(JSON.stringify(rules)) as Rules;
    const t = r2.tunnels.friendly[0]!;
    t.points[2] = [56, 40]; // 6.3 from the hostile anchor (58,34)
    expect(run(json, r2, spec).some((x) => x.includes('is 6.3 tiles from the hostile anchor'))).toBe(true);
    const r3 = JSON.parse(JSON.stringify(rules)) as Rules;
    r3.tunnels.hostile.pop();
    expect(run(json, r3, spec).some((x) => x.includes('tunnel routes per end are 2 and 1'))).toBe(true);
    for (let y = 6; y < 10; y++) for (let x = 48; x < 52; x++) setCell(json, x, y, '#');
    expect(run(json, rules, spec).some((x) => x.includes('building(s) over their type\'s native footprint') || x.includes('shapes are'))).toBe(true);
  });
});

