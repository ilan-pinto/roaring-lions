// GH-913 L6: the presentation census (tools/src/presentation_census.ts). Report-only for the map
// itself, with the instrument held to account on fixtures built to make it read red.
//
// What each fixture is for, so a green run means something:
//  - the occlusion fixture puts ONE tall building on one bank of an otherwise empty, half-turn
//    symmetric field. If the census cannot tell the two seats apart there, it cannot tell them
//    apart on Rujm Sawda either. Its controls differ in one thing each (no building; a shanty).
//  - the relief fixture is two radial hills, one per seat, on a half-turn symmetric field. On the
//    MAIN diagonal the sun is perpendicular to the seat axis and the seats read alike. Turn the
//    same field's seats onto the ANTI-diagonal and one seat's enemy-facing slopes face the sun and
//    the other's face away. Same terrain, same code, one change.
//  - the cast-shadow fixture is one block of high ground and a tile in its lee.
import { describe, expect, it } from 'vitest';
import { parseMap, type MapJson } from '../../packages/data/src/index';
import {
  SEAT_TOLERANCE,
  castShadowed,
  census,
  drawnSurface,
  gap,
  LIT_DIFFERENCE_MAX,
  TWIN_MISMATCH_MAX,
  lightAt,
  litDifferenceShare,
  loadMap,
  planSeats,
  twinMismatches,
  type Census,
  type Point,
} from './presentation_census';
import { surfaceWorldY } from '../../packages/render/src/three/terrain/surface';

const SIZE = 40;
const open = (): string[][] => Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => '.'));
const stamp = (rows: string[][], x0: number, y0: number, n: number, ch: string): void => {
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) rows[y][x] = ch;
};
const mapJson = (rows: string[][], extra: Partial<MapJson> = {}): MapJson =>
  ({
    id: 't',
    name: 't',
    width: SIZE,
    height: SIZE,
    rows: rows.map((r) => r.join('')),
    markers: { versus_0: [4, 4], versus_1: [35, 35] },
    zones: {
      home_0: [2, 2, 5, 5],
      home_1: [33, 33, 5, 5],
      centre: [18, 18, 4, 4],
    },
    ...extra,
  }) as MapJson;

/** Run the census on a fixture. */
const run = async (rows: string[][], extra: Partial<MapJson> = {}, seats?: readonly [Point, Point]) => {
  const json = mapJson(rows, extra);
  return census(parseMap(json), json.rows, seats ? { seats } : {});
};

describe('presentation census: Rujm Sawda (GH-913 L6)', async () => {
  const { json, map } = loadMap('rujm_sawda');
  const c = await census(map, json.rows);
  const [s0, s1] = c.seats;

  it('gives each seat the other end, the contested ground and the other bank, and nothing of its own', () => {
    const [p0, p1] = planSeats(map);
    const names = (p: typeof p0) => new Set(p.goals.map((g) => g.zone));
    expect([...names(p0)].sort()).toEqual(
      ['centre', 'home_1', 'mesa_ne', 'mesa_sw', 'tell_sw', 'well_e_1', 'well_s_1'].sort()
    );
    expect([...names(p1)].sort()).toEqual(
      ['centre', 'home_0', 'mesa_ne', 'mesa_sw', 'tell_ne', 'well_n_0', 'well_w_0'].sort()
    );
  });

  it('measures something: hundreds of approach and slope tiles per seat, and some hidden ones', () => {
    // An instrument that found nothing would read 0 against 0 and pass every bar.
    for (const s of c.seats) {
      expect(s.approachTiles).toBeGreaterThan(500);
      expect(s.slopeTiles).toBeGreaterThan(200);
      expect(s.hiddenTiles).toBeGreaterThan(0);
      expect(s.lit).toBeGreaterThan(0);
      expect(s.shadowed).toBeGreaterThan(0);
    }
  });

  it('counts the same slope tiles for both seats: the map is half-turn symmetric and so is the half', () => {
    // 430 / 430 today. It was 408 / 449 with the half-turn centre half a tile out, so this pins
    // the +0.5 in `slopeTiles`.
    expect(s0.slopeTiles).toBe(s1.slopeTiles);
  });

  it('occlusion: the two seats are within the proposed bar (8 hidden tiles each of about 900)', () => {
    expect(c.hiddenGap).toBeLessThanOrEqual(SEAT_TOLERANCE);
  });

  it('relief: two ABSOLUTE checks, the lit difference and the twin mismatches (GH-913 look pass)', () => {
    // The relative lit-share gap (12.2% before the look pass, 27.5% after) is retired as a bar: it
    // divides by a lit share that the 2x2-cell staircase banks had padded with about 170 scallop
    // facets, lit for one seat and shadowed on its twin. Smoothing the banks removed them, the
    // skew stayed where it was, and the ratio more than doubled on a map no less fair. Counts do
    // not move with the denominator. The lead ruled the census report-only on 1 Nov 2026: these
    // are a per-map no-worse ratchet, not a pass/fail bar. Seat 0 / seat 1 lit, of 362 slope
    // tiles: 69 / 50, a difference of 19 (5.2%; 4.4% before). Tiles reading differently from
    // their twin: 138 (309 before). Plan: _coord/rujm-sawda-look/plan.md section 4.
    expect(litDifferenceShare(c)).toBeLessThanOrEqual(LIT_DIFFERENCE_MAX);
    expect(twinMismatches(c, map.width, map.height)).toBeLessThanOrEqual(TWIN_MISMATCH_MAX);
    // the demotion: a census that found nothing to compare would pass both vacuously
    expect(s0.lit).toBeGreaterThan(0);
    expect(twinMismatches(c, map.width, map.height)).toBeGreaterThan(0);
  });

  it('cast shadow from the relief reaches no enemy-facing slope on this map (the sun is too high)', () => {
    // 55 degrees up, so a rise of one world unit shades 0.7 tile. Pinned so that a map which
    // does shade (a taller massif) shows up as a change to read rather than a silent one.
    const surface = drawnSurface(map, json.rows);
    let cast = 0;
    for (const slope of c.slope)
      for (const t of slope.keys()) {
        const x = t % map.width;
        const y = Math.floor(t / map.width);
        if (castShadowed(surface, map, x + 0.5, surfaceWorldY(surface, x + 0.5, y + 0.5) + 0.02, y + 0.5)) cast++;
      }
    expect(cast).toBe(0);
  });
});

describe('presentation census: the two absolute relief checks go red (GH-913 look pass)', async () => {
  const { json } = loadMap('rujm_sawda');
  const elev = json.elevation as string[];
  /** The bottom half is the x-FLIP of the top half's elevation, not its half-turn: a map that is not point-symmetric. */
  const flipped = elev.map((r, y) => (y < 40 ? r : elev[79 - y]));
  /** The control writes the bottom half as the true half-turn, which the shipped map already is. */
  const turned = elev.map((r, y) => (y < 40 ? r : [...elev[79 - y]].reverse().join('')));
  const read = async (elevation: string[]): Promise<Census> => {
    const j: MapJson = { ...json, elevation };
    return census(parseMap(j), j.rows);
  };

  it('control: re-deriving the bottom half as the half-turn reads exactly as shipped', async () => {
    const c = await read(turned);
    expect(c.seats[0].lit).toBe(69);
    expect(c.seats[1].lit).toBe(50);
    expect(twinMismatches(c, 80, 80)).toBe(138);
  });

  it('RED: the bottom half x-flipped splits the lit counts far past the bar (16.6% against 7%)', async () => {
    const c = await read(flipped);
    expect(litDifferenceShare(c)).toBeGreaterThan(2 * LIT_DIFFERENCE_MAX);
  });

  it('RED: the same flip leaves twice the allowed number of tiles reading differently (307 against 150)', async () => {
    const c = await read(flipped);
    expect(twinMismatches(c, 80, 80)).toBeGreaterThan(2 * TWIN_MISMATCH_MAX);
  });

  it('the measures on literals: a 10-tile lit split of 100 is 10%, and a missing twin counts as a mismatch', () => {
    const seat = (lit: number) => ({ slopeTiles: 100, lit });
    const fake = (l0: number, l1: number, a: [number, 0 | 1 | -1][], b: [number, 0 | 1 | -1][]) =>
      ({ seats: [seat(l0), seat(l1)], slope: [new Map(a), new Map(b)] }) as unknown as Census;
    expect(litDifferenceShare(fake(40, 30, [], []))).toBeCloseTo(0.1, 10);
    expect(litDifferenceShare(fake(30, 30, [], []))).toBe(0);
    // 80x80: tile 0's twin is 6399. Same light: no mismatch. Other light, or absent: one each.
    expect(twinMismatches(fake(0, 0, [[0, 1]], [[6399, 1]]), 80, 80)).toBe(0);
    expect(twinMismatches(fake(0, 0, [[0, 1]], [[6399, -1]]), 80, 80)).toBe(1);
    expect(twinMismatches(fake(0, 0, [[0, 1], [5, 0]], [[6399, 1]]), 80, 80)).toBe(1);
  });
});

describe('presentation census: Wadi Tarfan (large), 96x96 (GH-920 B6)', async () => {
  const { json, map } = loadMap('wadi_tarfan_l');
  const c = await census(map, json.rows);
  const [s0, s1] = c.seats;
  const elev = json.elevation as string[];
  const read = async (elevation: string[]): Promise<Census> => {
    const j: MapJson = { ...json, elevation };
    return census(parseMap(j), j.rows);
  };

  it('measures something, and counts the same slope tiles for both seats (the map is exactly half-turn symmetric)', () => {
    // 613 / 613 enemy-facing slope tiles, 918 / 923 approach tiles: an instrument that found nothing
    // would read 0 against 0 and pass every bar.
    expect(s0.slopeTiles).toBe(613);
    expect(s1.slopeTiles).toBe(613);
    expect(s0.approachTiles).toBeGreaterThan(500);
    expect(s0.lit).toBeGreaterThan(0);
    expect(s0.shadowed).toBeGreaterThan(0);
  });

  it('relief: the lit difference is inside the bar (196 against 184, 2.0% of 613)', () => {
    expect(s0.lit).toBe(196);
    expect(s1.lit).toBe(184);
    expect(litDifferenceShare(c)).toBeLessThanOrEqual(LIT_DIFFERENCE_MAX);
  });

  it('relief: the twin mismatches are RECORDED at 390, which is OVER the 150 bar (reported, not widened)', () => {
    // Report-only (lead ruling 1 Nov 2026). The elevation and the rows are exactly half-turn symmetric
    // (0 differing tiles), so none of the 390 is a map asymmetry: every one is a lit tile whose twin is
    // shadowed (380: 196 + 184) or a neutral one (10), the fixed sun against a slope that does not face
    // along the seat axis. The count therefore scales with the lit slope tiles (613 here, 362 on Rujm Sawda:
    // 138 there). A per-map no-worse ratchet, as Rujm's was; the bar itself is the lead's to rule on.
    const n = twinMismatches(c, map.width, map.height);
    expect(n).toBeLessThanOrEqual(390);
    expect(n).toBeGreaterThan(TWIN_MISMATCH_MAX); // the demotion: if this fails the reading came under the bar, so pin it to the bar
  });

  it('RED: the bottom half x-flipped splits the lit counts past the bar (10.3% against 7%)', async () => {
    const flipped = elev.map((r, y) => (y < 48 ? r : elev[95 - y]));
    const f = await read(flipped);
    expect(litDifferenceShare(f)).toBeGreaterThan(LIT_DIFFERENCE_MAX);
    expect(litDifferenceShare(f)).toBeGreaterThan(4 * litDifferenceShare(c));
  });

  it('control: re-deriving the bottom half as the half-turn reads exactly as shipped', async () => {
    const turned = elev.map((r, y) => (y < 48 ? r : [...elev[95 - y]].reverse().join('')));
    const t = await read(turned);
    expect(t.seats[0].lit).toBe(196);
    expect(t.seats[1].lit).toBe(184);
    expect(twinMismatches(t, 96, 96)).toBe(twinMismatches(c, 96, 96));
  });
});

describe('presentation census: the instrument', () => {
  it('RED: one tall building on one bank only splits the seats far outside the bar', async () => {
    const rows = open();
    stamp(rows, 27, 27, 3, 'a'); // an apartment, 3 floors, in the lane to seat 1
    const c = await run(rows);
    // seat 0 walks up-screen of it; seat 1 walks in front of it
    expect(c.seats[0].hiddenTiles).toBeGreaterThan(c.seats[1].hiddenTiles + 10);
    expect(c.hiddenGap).toBeGreaterThan(5 * SEAT_TOLERANCE);
  });

  it('control: the same field with no building reads zero hidden and no gap', async () => {
    const c = await run(open());
    expect(c.seats[0].approachTiles).toBeGreaterThan(100); // there is something to hide
    expect(c.seats[0].hiddenTiles).toBe(0);
    expect(c.seats[1].hiddenTiles).toBe(0);
    expect(c.hiddenGap).toBe(0);
  });

  it('control: a shanty on the same plot hides a fraction of what the apartment does', async () => {
    const tall = open();
    stamp(tall, 27, 27, 3, 'a');
    const low = open();
    stamp(low, 27, 27, 3, 's');
    const cTall = await run(tall);
    const cLow = await run(low);
    expect(cLow.seats[0].hiddenTiles).toBeLessThan(cTall.seats[0].hiddenTiles / 2);
  });

  it('the gap measure: a pair of tiny shares cannot fail on noise, a real split still does', () => {
    // 0.4% against 0.6% is 33% unfloored; over the 2% floor it is 10%
    expect(gap(0.004, 0.006)).toBeLessThanOrEqual(SEAT_TOLERANCE);
    expect(gap(0.0, 0.0)).toBe(0);
    expect(gap(0.3, 0.2)).toBeGreaterThan(0.3);
  });

  // Two hills, one per seat, radial and half-turn symmetric, one level per two tiles.
  const hills = (): string[] => {
    const lv = (x: number, y: number): number => {
      const d = Math.min(Math.hypot(x - 4, y - 4), Math.hypot(x - 35, y - 35));
      return Math.max(0, 6 - Math.floor(d / 2));
    };
    return Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => String(lv(x, y))).join(''));
  };
  const hillsAnti = (): string[] => {
    const lv = (x: number, y: number): number => {
      const d = Math.min(Math.hypot(x - 4, y - 35), Math.hypot(x - 35, y - 4));
      return Math.max(0, 6 - Math.floor(d / 2));
    };
    return Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => String(lv(x, y))).join(''));
  };

  it('relief, main diagonal: the sun is perpendicular to the seat axis and the seats read alike', async () => {
    const c = await run(open(), { elevation: hills() });
    expect(c.seats[0].slopeTiles).toBeGreaterThan(50);
    expect(c.seats[0].slopeTiles).toBe(c.seats[1].slopeTiles);
    expect(c.reliefGap).toBeLessThanOrEqual(SEAT_TOLERANCE);
  });

  it('RED relief, anti-diagonal: same hills, seats on the other diagonal, one faces the sun and one does not', async () => {
    const json = mapJson(open(), {
      elevation: hillsAnti(),
      markers: { versus_0: [4, 35], versus_1: [35, 4] },
      zones: { home_0: [2, 33, 5, 5], home_1: [33, 2, 5, 5], centre: [18, 18, 4, 4] },
    });
    const c = await census(parseMap(json), json.rows);
    expect(c.seats[0].slopeTiles).toBe(c.seats[1].slopeTiles);
    // seat 0 (bottom-left) faces +x,-y: away from the sun. seat 1 faces -x,+y: toward it.
    expect(c.seats[1].lit).toBeGreaterThan(c.seats[0].lit + 20);
    expect(c.seats[0].shadowed).toBeGreaterThan(c.seats[1].shadowed + 20);
    expect(c.reliefGap).toBeGreaterThan(5 * SEAT_TOLERANCE);
  });

  it('cast shadow: a tile in the lee of a high block is shaded, one on the sun side and one with no block are not', () => {
    const block = open();
    const elev = block.map((r) => r.map(() => '0'));
    // a 3x3 ridge block (`^` is blocked and a terrace) at level 9 in the middle
    stamp(block, 19, 19, 3, '^');
    stamp(elev, 19, 19, 3, '9');
    const json = mapJson(block, { elevation: elev.map((r) => r.join('')) });
    const map = parseMap(json);
    const surface = drawnSurface(map, json.rows);
    const y = (x: number, z: number) => surfaceWorldY(surface, x, z) + 0.02;
    // The sun comes from -x,+z (screen-left); the lee is +x,-z. One tile past the block's lee corner.
    expect(castShadowed(surface, map, 22.5, y(22.5, 18.5), 18.5)).toBe(true);
    // the same distance on the sun side
    expect(castShadowed(surface, map, 18.5, y(18.5, 22.5), 22.5)).toBe(false);
    // control: no block, the same tile
    const flat = parseMap(mapJson(open()));
    const fs = drawnSurface(flat, mapJson(open()).rows);
    expect(castShadowed(fs, flat, 22.5, y(22.5, 18.5) * 0 + 0.02, 18.5)).toBe(false);
    // and lightAt agrees with castShadowed: in the lee reads shadowed
    expect(lightAt(surface, map, 22, 18)).toBe(-1);
  });
});
