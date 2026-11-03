// GH-416: keep the fight visible. Every campaign map must show at least VISIBLE_FLOOR of its
// fight tiles -- the passable tiles near its objectives and along its main routes -- to the
// default camera, with no building's mesh over more than half of a rifleman standing there.
// See map_visibility.ts for the metric and for why the floor is 0.84.
import { describe, expect, it } from 'vitest';
import { maps, parseMap, versusRules, type MapJson } from '../../packages/data/src/index';
import {
  VISIBLE_FLOOR,
  bodyHiddenShare,
  campaignMaps,
  measureMap,
  occluderFor,
  placeBuildings,
} from './map_visibility';

/**
 * Maps still under the floor. Each names the reading it was exempted at, which is a RATCHET:
 * the map may get better and may not get worse. When one clears the floor the demotion test
 * goes red and says to delete its entry.
 */
const EXEMPT: Record<string, { measured: number; reason: string }> = {
  beit_sahwan_3: {
    measured: 0.792,
    reason:
      'The old town at street scale is the map (ground-ladder §2, "sight lines of 3-5 tiles"). Fitting ' +
      'buildings to their plots (lead ruling 7 Oct, units/building-fit.ts) took it from 0.457 to 0.792; ' +
      'the lead accepted ~80% for it rather than a height cap or a shanty town. The floor is its reading ' +
      'under the fit, so it can get better and not worse.',
  },
};

describe('map visibility (GH-416)', async () => {
  const maps = campaignMaps();
  const results = new Map<string, Awaited<ReturnType<typeof measureMap>>>();
  for (const [id, missions] of maps) results.set(id, await measureMap(id, missions));

  it('measures every campaign map, and every one has a real fight to measure', () => {
    // 29 maps carry the 29 campaign missions (world.json). An instrument that found no fight
    // tiles would pass every map vacuously, so each must have a few hundred.
    expect(maps.size).toBe(29);
    for (const [id, r] of results) expect(r.fightTiles, id).toBeGreaterThan(300);
  });

  for (const [id] of maps) {
    const ex = EXEMPT[id];
    if (!ex) {
      it(`${id}: at least ${VISIBLE_FLOOR} of the fight is visible`, () => {
        const r = results.get(id)!;
        expect(r.visible, `${id}: ${r.hiddenTiles} of ${r.fightTiles} fight tiles hidden`).toBeGreaterThanOrEqual(
          VISIBLE_FLOOR
        );
      });
    } else {
      it(`${id}: exempt (${ex.measured}) -- no worse than when it was exempted, and still under the floor`, () => {
        const r = results.get(id)!;
        expect(r.visible, `${id} got worse than its exemption`).toBeGreaterThanOrEqual(ex.measured - 0.001);
        expect(
          r.visible,
          `${id} now clears the floor (${r.visible.toFixed(3)}): delete its EXEMPT entry`
        ).toBeLessThan(VISIBLE_FLOOR);
      });
    }
  }

  it('every exemption names a campaign map and gives a reason', () => {
    for (const [id, ex] of Object.entries(EXEMPT)) {
      expect(maps.has(id), id).toBe(true);
      expect(ex.reason.length, id).toBeGreaterThan(40);
    }
  });
});

// The instrument itself, on ground built for it. Each check is paired with a control that
// differs in one thing, so "the tile is visible" cannot pass for the wrong reason.
describe('map visibility: the instrument', () => {
  const open = (w: number, h: number): string[] => Array.from({ length: h }, () => '.'.repeat(w));
  const withBlock = (rows: string[], x0: number, y0: number, n: number, ch: string): string[] =>
    rows.map((r, y) => (y >= y0 && y < y0 + n ? r.slice(0, x0) + ch.repeat(n) + r.slice(x0 + n) : r));
  const mapOf = (rows: string[]) =>
    parseMap({ id: 't', name: 't', width: rows[0].length, height: rows.length, rows } as MapJson);

  it('reads the shipped house mesh: a real silhouette, over four world units tall', async () => {
    const h = await occluderFor('house');
    expect(h).not.toBeNull();
    let covered = 0;
    for (const d of h!.depth) if (d > -Infinity) covered++;
    expect(covered).toBeGreaterThan(1000);
    // 4.24 world units tall and 4.26 x 3.71 in plan, whatever footprint it stands on.
    expect(h!.planW).toBeGreaterThan(4);
    expect(h!.planD).toBeGreaterThan(3.5);
  });

  it('a house hides the ground up-screen of it (smaller x and y) and not the ground in front', async () => {
    const rows = withBlock(open(24, 24), 12, 12, 3, 'h');
    const m = mapOf(rows);
    const placed = await placeBuildings(m, 'off');
    expect(bodyHiddenShare(m, placed, 10, 10)).toBeGreaterThan(0.5); // behind it, as the camera looks
    expect(bodyHiddenShare(m, placed, 17, 17)).toBe(0); // in front of it
    expect(bodyHiddenShare(m, placed, 18, 9)).toBe(0); // beside it, across the view axis
    // control: the same tile on the same ground with no house
    const bare = mapOf(open(24, 24));
    expect(bodyHiddenShare(bare, await placeBuildings(bare), 10, 10)).toBe(0);
  });

  it('a house fitted to a 2x2 hides less than the same house at its shipped size', async () => {
    const hiddenTiles = async (fit: 'off' | 'stretch') => {
      const m = mapOf(withBlock(open(24, 24), 12, 12, 2, 'h'));
      const placed = await placeBuildings(m, fit);
      let n = 0;
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 24; x++) if (m.blocked[y * 24 + x] === 0 && bodyHiddenShare(m, placed, x, y) > 0.5) n++;
      return n;
    };
    const shipped = await hiddenTiles('off');
    const fitted = await hiddenTiles('stretch');
    expect(shipped).toBeGreaterThan(15);
    expect(fitted).toBeGreaterThan(0); // still a building, still a shadow
    expect(fitted).toBeLessThan(shipped / 2);
  });

  it('a shanty on the same footprint hides less than a house: the lever the reworked maps use', async () => {
    const count = async (ch: string) => {
      const m = mapOf(withBlock(open(24, 24), 12, 12, 3, ch));
      const placed = await placeBuildings(m, 'off');
      let n = 0;
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 24; x++) if (m.blocked[y * 24 + x] === 0 && bodyHiddenShare(m, placed, x, y) > 0.5) n++;
      return n;
    };
    const house = await count('h');
    const shanty = await count('s');
    expect(house).toBeGreaterThan(15);
    expect(shanty).toBeLessThan(house / 3);
  });
});

// --- the versus gate (GH-974) --------------------------------------------------------------------------------------------
// The caps of `VERSUS_CAPS`, each on ground built for it. Every cap has a control that differs in ONE thing, so "the gate is
// red" cannot be a side effect of another cap, and the instrument is asked at the building's SHIPPED size (`fit: 'off'`),
// where a 2x2 house hides about twenty tiles, so a few buildings are enough to bite. The control has sheds only (one floor,
// about one tile hidden each): every cap reads green on it, with room to spare.
import { VERSUS_CAPS, measureVersus, type VersusVisibilitySpec } from './map_visibility';

describe('the versus gate: each cap, red on an input built to fail it', () => {
  const SIDE = 64;
  const seats = { versus_0: [8, 56], versus_1: [56, 8] };
  const base = (): string[][] => Array.from({ length: SIDE }, () => Array<string>(SIDE).fill('.'));
  const put = (g: string[][], x: number, y: number, w: number, h: number, c: string) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g[j][i] = c;
  };
  const mapOf = (g: string[][], zones: Record<string, number[]> = { town: [24, 24, 16, 16], z: [44, 44, 8, 8] }) =>
    parseMap({ id: 'v', name: 'v', width: SIDE, height: SIDE, rows: g.map((r) => r.join('')), markers: seats, zones } as unknown as MapJson);
  const spec: VersusVisibilitySpec = { towns: ['town'], scoring: ['z'] };
  const run = (g: string[][], s: VersusVisibilitySpec = spec, zones?: Record<string, number[]>) => measureVersus(mapOf(g, zones), s, 'off');
  const has = (r: { failures: string[] }, needle: string) => r.failures.some((f) => f.includes(needle));
  const house = (g: string[][], x: number, y: number) => put(g, x, y, 2, 2, 'h');

  /** The control: open ground and eight sheds in the town, no house. */
  const control = (): string[][] => {
    const g = base();
    for (const [x, y] of [[30, 26], [34, 26], [26, 31], [30, 36], [36, 30], [34, 40], [38, 26], [28, 38]]) g[y][x] = 's';
    return g;
  };

  it('the control is green, and measures something: a corridor of hundreds of tiles, a town and a scoring zone read', async () => {
    const r = await run(control());
    expect(r.failures).toEqual([]);
    expect(Number(r.facts.corridor_tiles)).toBeGreaterThan(200);
    expect(Number(r.facts.visible_whole_map)).toBeGreaterThanOrEqual(0.95);
    expect(Number(r.facts.visible_corridor)).toBeGreaterThanOrEqual(0.92);
    expect(Number(r.facts.visible_town)).toBeGreaterThanOrEqual(0.85);
    expect(Number(r.facts.visible_z)).toBe(1);
    expect(Number(r.facts.building_tiles)).toBe(8);
  });

  it('whole map under 95%: sixteen houses in a corner, off the corridor and every zone (no other visibility cap goes red)', async () => {
    const g = control();
    for (let i = 0; i < 16; i++) house(g, 2 + (i % 4) * 4, 2 + Math.floor(i / 4) * 4);
    const r = await run(g);
    expect(has(r, 'of the map is visible, under 95%')).toBe(true);
    expect(has(r, 'seat corridor is visible')).toBe(false);
    expect(has(r, 'of the zone')).toBe(false);
    expect(has(r, 'of the town')).toBe(false);
  });

  it('seat corridor under 92%: five houses along the seat-to-seat line (the whole map stays over 95%)', async () => {
    const g = control();
    for (const k of [8, 14, 20, 26, 32]) house(g, 8 + k, 56 - k - 1);
    const r = await run(g);
    expect(has(r, 'of the seat corridor is visible, under 92%')).toBe(true);
    expect(has(r, 'of the map is visible, under 95%')).toBe(false);
  });

  it('a scoring zone under 92%: one house in it; the same zone and reading named as a TOWN (85%) is green', async () => {
    const g = control();
    house(g, 44, 44);
    const asScoring = await run(g);
    expect(has(asScoring, 'of the zone z is visible, under 92%')).toBe(true);
    expect(Number(asScoring.facts.visible_z)).toBeGreaterThanOrEqual(0.85); // between the two caps: this is what tells the town cap from the scoring cap
    const asTown = await run(g, { towns: ['town', 'z'], scoring: [] });
    expect(has(asTown, 'of the town z is visible')).toBe(false);
  });

  it('a town under 85%: two houses in its yards', async () => {
    const g = control();
    house(g, 26, 26);
    house(g, 28, 32);
    const r = await run(g);
    expect(has(r, 'of the town town is visible, under 85%')).toBe(true);
    expect(has(r, 'of the map is visible')).toBe(false);
  });

  it('buildings over 3% of the map: a lattice of sheds (one floor, hiding little)', async () => {
    const g = control();
    for (let y = 1; y < SIDE; y += 3) for (let x = 1; x < SIDE; x += 3) if (y < 20 || y > 44) g[y][x] = 's';
    const r = await run(g);
    expect(Number(r.facts.building_share)).toBeGreaterThan(0.03);
    expect(has(r, '% of the map is building, over 3%')).toBe(true);
  });

  it('buildings over 25% of a town zone: a comb of sheds fills half of it', async () => {
    const g = control();
    for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x += 2) if (g[y][x] === '.') g[y][x] = 's';
    const r = await run(g);
    expect(has(r, 'of town zone town, over 25%')).toBe(true);
  });

  it('walls are not building tiles: a town of 88 wall tiles reads the same building share as the control, and stays green', async () => {
    const g = control();
    // a wall ring round the town zone (24..39) and two dividers: 60 + 2 x 14 = 88 wall tiles in a 256-tile zone (34%, over the 25% cap if they counted)
    for (let i = 24; i < 40; i++) for (const [x, y] of [[i, 24], [i, 39], [24, i], [39, i]]) if (g[y][x] === '.') g[y][x] = '=';
    for (let i = 25; i < 39; i++) for (const [x, y] of [[32, i], [i, 32]]) if (g[y][x] === '.') g[y][x] = '=';
    const r = await run(g);
    expect(r.failures).toEqual([]);
    expect(r.facts.building_tiles).toBe(8);
    expect(Number(r.facts.built_town)).toBeCloseTo(7 / 256, 3); // the control's seven sheds inside the zone, no wall among them
  });

  it('floors: an apartment (three) is red on its floors AND as a forbidden type; a warehouse (two) only as a forbidden type', async () => {
    const apartment = control();
    put(apartment, 4, 30, 3, 3, 'a');
    const a = await run(apartment);
    expect(has(a, 'apartment has 3 floors, over 2')).toBe(true);
    expect(has(a, 'a apartment stands on the map')).toBe(true);
    const warehouse = control();
    put(warehouse, 4, 30, 3, 3, 'w');
    const w = await run(warehouse);
    expect(has(w, 'warehouse has')).toBe(false);
    expect(has(w, 'a warehouse stands on the map')).toBe(true);
  });

  it('houses over 40% of the building tiles: two houses among eight sheds is red, among sixteen it is not', async () => {
    const few = control();
    house(few, 4, 4);
    house(few, 10, 4);
    expect(Number((await run(few)).facts.house_share)).toBeCloseTo(0.5, 2); // 8 of 16
    expect(has(await run(few), 'houses are 50% of the building tiles, over 40%')).toBe(true);
    const many = control();
    house(many, 4, 4);
    house(many, 10, 4);
    for (let i = 0; i < 8; i++) many[10 + i * 2][4] = 's';
    const r = await run(many);
    expect(Number(r.facts.house_share)).toBeCloseTo(8 / 24, 2);
    expect(has(r, 'houses are')).toBe(false);
  });

  it('is not vacuous: an unknown zone, a zone with nothing in it and a caps override each turn it red', async () => {
    expect(has(await run(control(), { towns: ['nowhere'], scoring: ['z'] }), 'town zone nowhere is not on the map')).toBe(true);
    expect(has(await run(control(), spec, { town: [24, 24, 16, 16], z: [0, 0, 2, 2] }), 'so it measures nothing')).toBe(true);
    // a cap the plain map cannot meet: the comparison runs
    const r = await measureVersus(mapOf(control()), { ...spec, caps: { wholeMap: 1.01 } }, 'off');
    expect(has(r, 'of the map is visible, under 101%')).toBe(true);
    expect(VERSUS_CAPS.wholeMap).toBe(0.95);
    expect(VERSUS_CAPS.corridorAndZones).toBe(0.92);
    expect(VERSUS_CAPS.town).toBe(0.85);
  });
});

// The gate read REPORT-ONLY on the three maps offered before it (GH-974): the numbers the PR and the notes quote, pinned so a change
// to a shipped map, or to the instrument, is noticed. None of them is a verdict: their specs are exempt (`visibility.exempt`).
describe('the versus gate on the shipped large maps (report only)', () => {
  const read = async (id: 'milh_flats_l' | 'wadi_tarfan_l' | 'rujm_sawda') => {
    const rules = (versusRules as unknown as Record<string, { income_zones: { zone: string }[] }>)[id];
    const m = parseMap((maps as unknown as Record<string, MapJson>)[id]);
    return measureVersus(m, { towns: [], scoring: rules.income_zones.map((z) => z.zone) });
  };

  it('Milh Flats (large), the first build: 99.8% whole map, houses 53% of its 30 building tiles (over the 40% cap, only failure)', async () => {
    const r = await read('milh_flats_l');
    expect(r.facts.building_tiles).toBe(30);
    expect(Number(r.facts.visible_whole_map)).toBeCloseTo(0.9976, 3);
    expect(r.failures).toEqual(['buildings: houses are 53% of the building tiles, over 40%']);
  });

  it('Wadi Tarfan (large): the two far farms of seat 1 read 89.7% and 90.2%, houses 67%', async () => {
    const r = await read('wadi_tarfan_l');
    expect(Number(r.facts.visible_farm_near_1)).toBeCloseTo(0.8974, 3);
    expect(Number(r.facts.visible_farm_far_1)).toBeCloseTo(0.9024, 3);
    expect(r.failures.length).toBe(3);
    expect(r.failures.some((f) => f.includes('houses are 67%'))).toBe(true);
  });

  it('Rujm Sawda: its four walled wells read 91.7% each, one tile under the 92% scoring cap', async () => {
    const r = await read('rujm_sawda');
    for (const w of ['well_n_0', 'well_w_0', 'well_s_1', 'well_e_1']) expect(Number(r.facts[`visible_${w}`])).toBeCloseTo(0.9167, 3);
    expect(r.failures.length).toBe(4);
    expect(r.failures.every((f) => f.includes('well_'))).toBe(true);
  });
});
