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
  lightAt,
  loadMap,
  planSeats,
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

  it('relief: REPORT. 12.2% on lit share, over the proposed 10% bar; a ratchet, not a pass', () => {
    // Seat 0: 156 lit / 266 shadowed / 8 neutral of 430. Seat 1: 137 / 285 / 8. The gap is the
    // terrain's own lopsidedness about the main diagonal (the map is half-turn symmetric, not
    // diagonal symmetric), not the sun, which cancels on this axis. It is sensitive to the census's
    // free parameters (10.7% to 37.5% over the settings tried) and Wadi Tarfan, a map that plays
    // fair, reads 15.1%, so this number is for the lead to read, not a thing to tune a map to.
    // It may get better and may not get worse.
    expect(c.reliefGap).toBeLessThanOrEqual(0.125);
    expect(c.reliefGap).toBeGreaterThan(0.05); // and the demotion: if it falls under, say so here
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
