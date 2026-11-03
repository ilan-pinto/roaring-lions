// Tel Marum (large)'s standoff doctrine, GH-920 B3: the facts pinned in tel_marum_doctrine.test.ts for the 48x48 map, carried to the
// 96x96 twin SCALED (every point at twice its tile, the corridor a 4x12 block of boulders) and driven through the real Sim.
//
// Speeds and ranges are global unit data and do not scale (the lead's ruling of 2 Nov), so a fact that is TERRAIN AND LINE OF SIGHT
// carries over, and a fact that is ARITHMETIC ON A RANGE (the Grad's 20 tiles, a rifle's 9) does not: a distance doubles and a range
// does not. Each block says which it is. A fact that cannot hold at 2x is not dropped: it is pinned here as what the twin does read
// (the number, and a control on a geometry where the same code does see the thing), with the reason. In the order of the original:
//
//   HOLDS at 2x (terrain, line of sight, or scale-free)  DOES NOT HOLD at 2x (pinned as the negative, with the reason)
//   - the west pocket sees the approach, not the         - the battery reaches both saddles, the pass and the approach: it
//     hollow, not the narrow saddle                        reaches the pass and the wide saddle only (12.2 and 16.1; the narrow
//   - the narrow corridor is watched along its whole       saddle is 34.0 and the approach 36.1, past a range of 20)
//     length from the northern plain, not from its       - the corridor's watcher is inside the battery's envelope: 26.3, not 13.6
//     own mouth                                          - the approach zone is a gradient, spottable and shellable in part: it
//   - the corridor is infantry-only: foot 16 (twice        is spottable in part (21 of 35) and shellable nowhere (34.0 and more)
//     the original's 8), wheels 55 round (twice 28,      - the village is inside the battery's splash radius: 4.0 away, past
//     less a diagonal), the wide saddle unchanged by       the 3.0 splash (the original: 2.0), because the village keeps its
//     the field (76, twice 38), the flank closed to        native footprint while the battery marker doubles
//     armour (94 on foot, twice 48 less two)             - the shipped spotter sees two corridor tiles: it sees none (its marker
//   - the field splits the task force; a boulder is        at twice the tile is 16.0 from the mouth against a sight of 9)
//     not a wall to sight                                - "ten of twelve at four tiles": the best sight-9 post sees 20 of 48,
//   - the village covers structures and only them; the     still 4.0 away (the same standoff, a smaller share)
//     western wave source is behind the wall             - "half the corridor costs a post 0.2 outside a Spike": half costs a
//   - a battery 12.6 tiles from the flank fires on an      post 6.1 from it, INSIDE a Spike's reach; a quarter costs 9.06
//     identified flanker and prefers the nearer target   - a battery AT ITS MARKER never fires at the flanker (34.0 > 20)
//
// Every negative is paired with a positive on the same geometry, as in the original. OBSERVER has sight_tiles 96, past anything on
// the map (the longest ray here is the battery to the start line, 76), so every `sees()` is a terrain-and-LOS fact, not a claim about
// what a unit posted on the map can see. The Sim is the real one; nothing is read off the generator.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, units, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

const JSON_L = maps.tel_marum_l as unknown as MapJson;
const JSON_S = maps.tel_marum as unknown as MapJson;

const observer = (sight: number): UnitTypeJson => ({
  id: `t_observer_${sight}`,
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: sight, signature: 0.6 },
});

type Pt = readonly [number, number];

/** A ray from `a` to `b` through the real Sim, after `ticks` of it (12 s by default, as the original reads it), at `sight` tiles. */
function sees(a: Pt, b: Pt, ticks = 12 * TICKS_PER_SECOND, sight = 96): boolean {
  const map = parseMap(JSON_L);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const t = sim.addUnitType(observer(sight));
  const watcher = sim.spawn(t, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const target = sim.spawn(t, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < ticks; i++) sim.tick();
  const detection = sim.debugDetection(watcher, target);
  if (!detection) throw new Error(`no detection record between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  return detection.visible;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** grad_122, from data/units/enemy/rocket_battery.json. */
const GRAD_RANGE = 20;
const GRAD_MIN_RANGE = 4;
const GRAD_SPLASH = 3;

// The original's points (tel_marum_doctrine.test.ts) and their twins at twice the tile.
const SMALL = {
  BATTERY: [25, 6], HOLLOW: [24, 29], APPROACH: [24, 24], START: [24, 44], SADDLE_NARROW: [10, 14], SADDLE_WIDE: [24, 14],
  PASS: [24, 12], OVERWATCH_W: [20, 16], SPOTTER_NARROW: [12, 4],
} as const satisfies Record<string, Pt>;
const BATTERY: Pt = [50, 12];
const HOLLOW: Pt = [48, 58];
const APPROACH: Pt = [48, 48];
const START: Pt = [48, 88];
const SADDLE_NARROW: Pt = [20, 28];
const SADDLE_WIDE: Pt = [48, 28];
const PASS: Pt = [48, 24];
const OVERWATCH_W: Pt = [40, 32];
const SPOTTER_NARROW: Pt = [24, 8];
const LARGE: Record<keyof typeof SMALL, Pt> = { BATTERY, HOLLOW, APPROACH, START, SADDLE_NARROW, SADDLE_WIDE, PASS, OVERWATCH_W, SPOTTER_NARROW };

/** The corridor's 48 boulder tiles: x 20..23, y 24..35 (the original's twelve, x 10..11, y 12..17, as 2x2 blocks). */
const CORRIDOR: Pt[] = [];
for (let y = 24; y <= 35; y++) for (let x = 20; x <= 23; x++) CORRIDOR.push([x, y] as Pt);
const rows = JSON_L.rows as string[];

describe('the points are the original\'s at twice the tile (the shipped markers, not a second list)', () => {
  it('each constant here is exactly twice its twin in tel_marum_doctrine.test.ts, and the named ones are the map\'s own markers', () => {
    for (const k of Object.keys(SMALL) as (keyof typeof SMALL)[]) expect(LARGE[k], k).toEqual([2 * SMALL[k][0], 2 * SMALL[k][1]]);
    const m = JSON_L.markers as Record<string, Pt>;
    expect(m.battery_position).toEqual(BATTERY);
    expect(m.hollow).toEqual(HOLLOW);
    expect(m.approach).toEqual(APPROACH);
    expect(m.start_line).toEqual(START);
    expect(m.saddle_narrow).toEqual(SADDLE_NARROW);
    expect(m.saddle_wide).toEqual(SADDLE_WIDE);
    expect(m.pass).toEqual(PASS);
    expect(m.overwatch_west).toEqual(OVERWATCH_W);
  });

  it('the corridor is 48 boulder tiles and nothing else is a boulder', () => {
    expect(CORRIDOR.every(([x, y]) => rows[y][x] === 'b')).toBe(true);
    let boulders = 0;
    for (const r of rows) for (const c of r) if (c === 'b') boulders++;
    // the 48 and the scree apron south of its mouth, the original's row 18, x 9..12: 4 cells of 2x2
    expect(boulders).toBe(48 + 16);
  });
});

describe("the Grad battery's envelope: ARITHMETIC ON A RANGE, so it does NOT survive a doubled distance", () => {
  it('every distance is exactly twice the original\'s (the markers doubled)', () => {
    for (const k of ['PASS', 'SADDLE_WIDE', 'SADDLE_NARROW', 'APPROACH', 'HOLLOW', 'START'] as const) {
      expect(dist(BATTERY, LARGE[k]), k).toBeCloseTo(2 * dist(SMALL.BATTERY, SMALL[k]), 9);
    }
  });

  it('reaches the pass and the wide saddle (12.2 and 16.1), as the original did (6.1 and 8.1)', () => {
    for (const p of [PASS, SADDLE_WIDE]) {
      expect(dist(BATTERY, p)).toBeGreaterThan(GRAD_MIN_RANGE);
      expect(dist(BATTERY, p)).toBeLessThanOrEqual(GRAD_RANGE);
    }
    expect(dist(BATTERY, PASS)).toBeCloseTo(12.17, 2);
    expect(dist(BATTERY, SADDLE_WIDE)).toBeCloseTo(16.12, 2);
  });

  it('does NOT reach the narrow saddle (34.0) or the approach (36.1): the original reached both, at 17.0 and 18.0', () => {
    // The mission's whole premise (the narrow flank is chargeable because only the Grad reaches it) rests on 17.0 <= 20. Doubled it is
    // 34.0, and a range of 20 does not double. A Tel Marum mission on this map would need the battery marker 12.6 tiles from the flank,
    // not 34.0 (the control in the last block).
    expect(dist(SMALL.BATTERY, SMALL.SADDLE_NARROW)).toBeCloseTo(17.0, 1);
    expect(dist(BATTERY, SADDLE_NARROW)).toBeCloseTo(34.0, 1);
    expect(dist(BATTERY, SADDLE_NARROW)).toBeGreaterThan(GRAD_RANGE);
    expect(dist(BATTERY, APPROACH)).toBeCloseTo(36.06, 2);
    expect(dist(BATTERY, APPROACH)).toBeGreaterThan(GRAD_RANGE);
  });

  it('still does not reach the hollow (46.0) or the start line (76.0)', () => {
    expect(dist(BATTERY, HOLLOW)).toBeGreaterThan(GRAD_RANGE);
    expect(dist(BATTERY, START)).toBeGreaterThan(GRAD_RANGE);
    expect(dist(BATTERY, START)).toBeCloseTo(76.0, 1);
  });
});

describe('the west pocket: TERRAIN AND LINE OF SIGHT, and it holds at 2x', () => {
  it('sees the approach, so the battery can be given eyes on it', () => {
    expect(sees(OVERWATCH_W, APPROACH)).toBe(true);
  });

  it('cannot see the hollow, so the hollow is dead ground', () => {
    expect(sees(OVERWATCH_W, HOLLOW)).toBe(false);
  });

  it('cannot see the narrow saddle: solid rock between them (paired with the positive above)', () => {
    expect(sees(OVERWATCH_W, SADDLE_NARROW)).toBe(false);
  });
});

describe('the narrow corridor: watched along its length, not from its mouth (LOS), and it holds at 2x', () => {
  it('has an unobstructed line of sight from the northern plain along its whole length', () => {
    for (const y of [26, 30, 34]) expect(sees(SPOTTER_NARROW, [20, y] as Pt), `y ${y}`).toBe(true);
  });

  it('is not watched from its own mouth', () => {
    expect(sees(SPOTTER_NARROW, SADDLE_NARROW)).toBe(true);
    // (16,18) is the original's (8,9) doubled: the corridor's north mouth, west of it
    expect(sees([16, 18] as Pt, SADDLE_NARROW)).toBe(false);
  });

  it('leaves its watcher OUTSIDE the battery envelope: 26.3 against 20 (the original: 13.6, inside) -- a range fact, it does not double', () => {
    expect(dist(SMALL.SPOTTER_NARROW, SMALL.BATTERY)).toBeCloseTo(13.15, 1);
    expect(dist(SPOTTER_NARROW, BATTERY)).toBeCloseTo(26.3, 1);
    expect(dist(SPOTTER_NARROW, BATTERY)).toBeGreaterThan(GRAD_RANGE);
  });
});

describe('the corridor is infantry-only, and the field still prices one route, not both (hold at 2x)', () => {
  const CORRIDOR_SOUTH: Pt = [20, 38];
  const CORRIDOR_NORTH: Pt = [20, 22];

  /** Tel Marum (large) with every `b` back to '.': the same ground, minus the field. */
  const control = (): MapJson => ({ ...JSON_L, rows: JSON_L.rows.map((r) => r.split('b').join('.')) });

  function load(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
    const map = parseMap(json);
    const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
    applyTerrain(map, sim);
    return { map, sim };
  }

  /** Shortest route in steps between two open tiles for one domain, walked off the real `FlowField`. `null` means no route. */
  function route(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): number | null {
    const { map, sim } = load(json);
    const mask = domain === 'foot' ? sim.blocked : sim.blockedVehicle;
    const field = new FlowField(map.width, map.height);
    field.compute(mask, sim.elevation, to[0], to[1]);
    let x = from[0];
    let y = from[1];
    for (let steps = 0; steps <= map.width * map.height; steps++) {
      if (x === to[0] && y === to[1]) return steps;
      const d = field.dirs[y * map.width + x];
      if (d === undefined || d === DIR_NONE) return null;
      x += DIR_DX[d] ?? 0;
      y += DIR_DY[d] ?? 0;
    }
    return null;
  }

  it('costs a rifleman nothing (16 steps across the wall, twice the original\'s 8) and a vehicle 55 round the pass (twice 28, one diagonal short)', () => {
    expect(route(JSON_L, 'foot', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(16);
    expect(route(control(), 'foot', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(16);
    // without the field a vehicle crosses on the same sixteen
    expect(route(control(), 'vehicle', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(16);
    expect(route(JSON_L, 'vehicle', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(55);
    // the original's pair, for the ratio: 8 and 28
    expect(route(JSON_S, 'foot', [10, 19], [10, 11])).toBe(8);
    expect(route(JSON_S, 'vehicle', [10, 19], [10, 11])).toBe(28);
  });

  it('leaves the wide saddle exactly as it was: 76 steps start to battery, twice the original\'s 38, with the field and without it', () => {
    for (const domain of ['foot', 'vehicle'] as const) {
      expect(route(JSON_L, domain, START, BATTERY)).toBe(76);
      expect(route(control(), domain, START, BATTERY)).toBe(76);
      expect(route(JSON_S, domain, SMALL.START, SMALL.BATTERY)).toBe(38);
    }
  });

  it('makes the whole flank unavailable to armour, not merely longer', () => {
    const mid: Pt = [22, 30];
    const foot = (route(JSON_L, 'foot', START, mid) ?? NaN) + (route(JSON_L, 'foot', mid, BATTERY) ?? NaN);
    expect(foot).toBe(94); // the original's 48, doubled, less two diagonals
    expect(route(JSON_L, 'vehicle', START, mid)).toBe(null);
    const veh = (route(control(), 'vehicle', START, mid) ?? NaN) + (route(control(), 'vehicle', mid, BATTERY) ?? NaN);
    expect(veh).toBe(94);
  });

  it('is a boulder field and not a second ridge: blocks wheels, not feet, not sight', () => {
    const { map } = load(JSON_L);
    for (const [x, y] of CORRIDOR) {
      const t = y * map.width + x;
      expect(map.boulder[t], `${x},${y}`).toBe(1);
      expect(map.blocked[t], `${x},${y}`).toBe(0);
    }
    expect(sees(SPOTTER_NARROW, SADDLE_NARROW)).toBe(true);
  });

  it('splits the shipped task force when both are ordered through it: the squad walks it, the Lavi stays out (40 s, as the original)', () => {
    for (const [json, label] of [[JSON_L, 'boulders'], [control(), 'control']] as const) {
      const { sim } = load(json);
      const foot = sim.spawn(sim.addUnitType(units.inf_squad as UnitTypeJson), 0, fx.from(20.5), fx.from(38.5));
      const tank = sim.spawn(sim.addUnitType(units.mbt_lavi as UnitTypeJson), 0, fx.from(21.5), fx.from(38.5));
      sim.queueCommand({ kind: 'move', ids: [foot, tank], x: fx.from(CORRIDOR_NORTH[0] + 0.5), y: fx.from(CORRIDOR_NORTH[1] + 0.5) });
      const onCorridor = (id: number): boolean => {
        const x = (sim.state.posX[id] ?? 0) >> 16;
        const y = (sim.state.posY[id] ?? 0) >> 16;
        return x >= 20 && x <= 21 && y >= 24 && y <= 35;
      };
      let footEntered = false;
      let tankEntered = false;
      for (let i = 0; i < 40 * TICKS_PER_SECOND; i++) {
        sim.tick();
        footEntered ||= onCorridor(foot);
        tankEntered ||= onCorridor(tank);
      }
      expect(footEntered, `${label}: infantry through the corridor`).toBe(true);
      expect(tankEntered, `${label}: armour through the corridor`).toBe(label === 'control');
      // one tile short of the clicked tile (20,22), as the original's squad stops one short of (10,11): the Lavi is `front`
      expect([(sim.state.posX[foot] ?? 0) >> 16, (sim.state.posY[foot] ?? 0) >> 16], `${label}: infantry past the mouth`).toEqual([20, 23]);
    }
  });
});

describe('the approach zone: open ground, holds; "a gradient, not a kill box" does NOT hold (nothing in it is shellable)', () => {
  const zone = () => {
    const z = (JSON_L.zones as Record<string, number[]>).approach;
    if (!z) throw new Error('map has no "approach" zone');
    return z;
  };
  const tiles = (): Pt[] => {
    const [x, y, w, h] = zone();
    const out: Pt[] = [];
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) out.push([i, j] as Pt);
    return out;
  };

  it('exists, every tile in it is open ground, and it contains the approach marker', () => {
    const [x, y, w, h] = zone();
    for (const [i, j] of tiles()) expect(rows[j][i]).toBe('.');
    expect([w, h]).toEqual([7, 5]);
    expect(APPROACH[0]).toBeGreaterThanOrEqual(x);
    expect(APPROACH[0]).toBeLessThan(x + w);
    expect(APPROACH[1]).toBeGreaterThanOrEqual(y);
    expect(APPROACH[1]).toBeLessThan(y + h);
  });

  it('is spottable in part (the west pocket sees 21 of its 35 tiles) and shellable NOWHERE (the nearest tile is 34.0 from the battery)', () => {
    const all = tiles();
    const seen = all.filter((p) => sees(OVERWATCH_W, p));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThan(all.length);
    expect(seen.length).toBe(21);
    const shellable = all.filter((p) => dist(p, BATTERY) <= GRAD_RANGE);
    // the original: some of its tiles were both seen and in range, and some not (a gradient). Here none is in range, so there is no gradient
    expect(shellable).toHaveLength(0);
    expect(Math.min(...all.map((p) => dist(p, BATTERY)))).toBeCloseTo(34.0, 1);
  });
});

describe('the western wave source and the village (hold, bar the splash)', () => {
  it('the western wave source stands on open ground north of the wall', () => {
    const [x, y] = (JSON_L.markers as Record<string, Pt>).sarim_west;
    expect(rows[y][x]).toBe('.');
    expect(y).toBeLessThan(24);
  });

  it('the flagged town block covers structures and nothing else', () => {
    const [x, y, w, h] = (JSON_L.zones as Record<string, number[]>).town_block;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) expect(rows[j][i]).toBe('#');
    // and every `#` on the map is inside it
    rows.forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') expect(i >= x && i < x + w && j >= y && j < y + h, `${i},${j}`).toBe(true); }));
  });

  it('is NOT inside the battery splash radius: 4.0 tiles from the marker, past the 3.0 splash (the original: 2.0), because the village keeps its native footprint', () => {
    const [x, y, w, h] = (JSON_L.zones as Record<string, number[]>).town_block;
    let nearest = Infinity;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) nearest = Math.min(nearest, dist([i, j] as Pt, BATTERY));
    expect(nearest).toBe(4);
    expect(nearest).toBeGreaterThan(GRAD_SPLASH);
    expect(units.rocket_battery.weapons[0].splash_tiles).toBe(GRAD_SPLASH);
    expect(GRAD_SPLASH).toBeLessThan(4);
  });
});

// The corridor's eyes. Terrain and sight, with ranges unchanged: the corridor is 12 tiles long against a sight of 9, so a post sees
// only part of it, and the original's "ten of twelve" cannot be reached at all.
describe('eyes on the narrow corridor', () => {
  /** inf_squad rifles reach 8.0; at_team's spike_atgm reaches 9.0. Anything this close to a tile the flank walks over can be shot off it. */
  const FLANK_REACH = 9;

  /** How many of the corridor's 48 tiles each post sees at `sight`. One Sim, every post a watcher, every tile a target; no tick loop,
   *  because `detectionPair` is range and `losRay` alone (the original checked 2,073 pairs at 0 and 240 ticks; checked again below). */
  function corridorSeenFrom(posts: Pt[], sight: number): number[] {
    const map = parseMap(JSON_L);
    const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: posts.length + CORRIDOR.length + 4 });
    applyTerrain(map, sim);
    const tw = sim.addUnitType(observer(sight));
    const tt = sim.addUnitType({ ...observer(96), id: 't_corridor_tgt' });
    const targets = CORRIDOR.map((c) => sim.spawn(tt, 1, fx.from(c[0] + 0.5), fx.from(c[1] + 0.5)));
    const watchers = posts.map((p) => sim.spawn(tw, 0, fx.from(p[0] + 0.5), fx.from(p[1] + 0.5)));
    return watchers.map((w) => targets.filter((t) => sim.debugDetection(w, t)?.visible === true).length);
  }

  const standoff = (a: Pt) => Math.min(...CORRIDOR.map((c) => dist(a, c)));

  /** Every open tile a post of this sight could conceivably watch from. */
  function posts(sight: number): Pt[] {
    const out: Pt[] = [];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === '.' && CORRIDOR.some((c) => dist([x, y] as Pt, c) <= sight)) out.push([x, y] as Pt);
    return out;
  }

  it('leaves the shipped spotter seeing NONE of the corridor\'s 48 tiles (its marker is 16.0 from the mouth; the original saw two of twelve, at 8.1)', () => {
    // paired with the sight line proved above: at sight 96 it sees all 48, so what stops it is its own sight_tiles: 9
    expect(corridorSeenFrom([SPOTTER_NARROW], 96)).toEqual([CORRIDOR.length]);
    expect(corridorSeenFrom([SPOTTER_NARROW], 9)).toEqual([0]);
    expect(units.sarim_rifles.sensors.sight_tiles).toBe(9);
    expect(dist(SPOTTER_NARROW, [23, 24] as Pt)).toBeCloseTo(16.03, 2);
    expect(dist(SMALL.SPOTTER_NARROW, [11, 12] as Pt)).toBeCloseTo(8.06, 2);
  });

  it('the zero-tick read equals the ticked one (the premise of the sweep): a post seeing 20 of 48 reads 20 after 12 s', () => {
    const ps = posts(9);
    const counts = corridorSeenFrom(ps, 9);
    const best = ps[counts.indexOf(Math.max(...counts))];
    const ticked = CORRIDOR.filter((c) => sees(best, c, 12 * TICKS_PER_SECOND, 9));
    expect(ticked).toHaveLength(Math.max(...counts));
  });

  it('offers no sight-9 post that sees more than 20 of 48 -- and the best of them stands 4.0 tiles from the corridor (the original: ten of twelve, 4.0)', () => {
    const ps = posts(9);
    const counts = corridorSeenFrom(ps, 9);
    expect(Math.max(...counts)).toBe(20);
    const seeing = ps.filter((_, i) => counts[i] > 0);
    expect(seeing.length).toBe(224);
    // an observer good enough to matter is always shootable from the ground it observes
    for (const levels of [[1, 9.0], [8, 7.07], [12, 6.08], [16, 5.1], [20, 4.0]] as const) {
      const sel = ps.filter((_, i) => counts[i] >= levels[0]);
      expect(sel.length, `>= ${levels[0]}`).toBeGreaterThan(0);
      expect(Math.max(...sel.map(standoff)), `>= ${levels[0]}`).toBeCloseTo(levels[1], 1);
    }
    expect(ps.filter((_, i) => counts[i] >= 21)).toHaveLength(0);
    // the sight-9 posts that see at all are inside a Spike's reach by construction (sight 9 = reach 9); the table above is what is not a tautology
    expect(Math.max(...seeing.map(standoff))).toBeLessThanOrEqual(FLANK_REACH);
  });

  it('at the Sarim roster\'s longest sight (12) half the corridor costs a post 6.1 from it, INSIDE a Spike; a quarter costs 9.06, the original\'s 0.2 outside', () => {
    expect(units.manpad_team.sensors.sight_tiles).toBe(12);
    const ps = posts(12);
    const counts = corridorSeenFrom(ps, 12);
    expect(Math.max(...counts)).toBe(25);
    const half = ps.filter((_, i) => counts[i] >= 24);
    expect(half.length).toBe(10);
    expect(Math.max(...half.map(standoff))).toBeCloseTo(6.08, 2);
    expect(Math.max(...half.map(standoff))).toBeLessThan(FLANK_REACH);
    const quarter = ps.filter((_, i) => counts[i] >= 12);
    expect(quarter.length).toBe(119);
    expect(Math.max(...quarter.map(standoff))).toBeCloseTo(9.06, 2);
    expect(Math.max(...quarter.map(standoff))).toBeGreaterThan(FLANK_REACH);
  });

  it('reloads too slowly for a short-lived observer to matter (unit data, scale-free): one rocket per thirty seconds', () => {
    const grad = units.rocket_battery.weapons[0];
    expect(grad.id).toBe('grad_122');
    expect(grad.rof_per_min).toBe(2);
    expect(60 / grad.rof_per_min).toBe(30);
  });
});

// Candidacy, not preference, driven through the real Sim. The marker battery is out of range of the flank, so the original's
// "fires on the next reload once identified" cannot hold; with the battery moved to 12.6 tiles from the flank it holds exactly.
describe('what the battery will and will not shoot at in the corridor', () => {
  /** A battery at `at`, one rifle squad on the narrow saddle, an optional decoy, and nothing else alive. */
  function batteryVsCorridor(at: Pt, identify: boolean, decoy: Pt | null): { atFlanker: number; atDecoy: number; flankerWhileDecoyLived: number } {
    const map = parseMap(JSON_L);
    const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
    applyTerrain(map, sim);
    const grad = sim.spawn(sim.addUnitType(units.rocket_battery as UnitTypeJson), 1, fx.from(at[0] + 0.5), fx.from(at[1] + 0.5));
    const inf = sim.addUnitType(units.inf_squad as UnitTypeJson);
    const flanker = sim.spawn(inf, 0, fx.from(SADDLE_NARROW[0] + 0.5), fx.from(SADDLE_NARROW[1] + 0.5));
    const near = decoy ? sim.spawn(inf, 0, fx.from(decoy[0] + 0.5), fx.from(decoy[1] + 0.5)) : -1;
    let atFlanker = 0;
    let atDecoy = 0;
    let flankerWhileDecoyLived = 0;
    for (let i = 0; i < 120 * TICKS_PER_SECOND; i++) {
      if (identify) {
        sim.identifyTo(1, flanker);
        if (near >= 0) sim.identifyTo(1, near);
      }
      const decoyLived = near >= 0 && sim.state.alive[near] === 1;
      for (const e of sim.tick()) {
        if (e.kind !== 'fire' || e.shooter !== grad) continue;
        if (e.target === flanker) {
          atFlanker++;
          if (decoyLived) flankerWhileDecoyLived++;
        }
        if (e.target === near) atDecoy++;
      }
    }
    return { atFlanker, atDecoy, flankerWhileDecoyLived };
  }

  /** A battery 12.6 tiles from the flank, where the original's was 17.0: open ground west of the pass. */
  const NEAR: Pt = [24, 16];

  it('never fires at a corridor it has not identified (the battery\'s own sight is 6): as shipped, and with the battery near', () => {
    expect(units.rocket_battery.sensors.sight_tiles).toBe(6);
    expect(batteryVsCorridor(BATTERY, false, null).atFlanker).toBe(0);
    expect(dist(NEAR, SADDLE_NARROW)).toBeCloseTo(12.65, 2);
    expect(batteryVsCorridor(NEAR, false, null).atFlanker).toBe(0);
  });

  it('does NOT fire at an identified flanker from its marker (34.0 > 20), and does from 12.6 tiles: the range, and nothing else, is the difference', () => {
    expect(rows[NEAR[1]][NEAR[0]]).toBe('.');
    expect(batteryVsCorridor(BATTERY, true, null).atFlanker).toBe(0);
    expect(batteryVsCorridor(NEAR, true, null).atFlanker).toBe(3);
  });

  it('prefers the nearer of two identified targets, which is the rule and not a bug (battery 12.6 from the flank, decoy 6.0 away)', () => {
    const decoy: Pt = [30, 16];
    expect(rows[decoy[1]][decoy[0]]).toBe('.');
    expect(dist(NEAR, decoy)).toBeCloseTo(6.0, 1);
    expect(dist(NEAR, decoy)).toBeGreaterThan(GRAD_MIN_RANGE);
    expect(dist(NEAR, decoy)).toBeLessThan(dist(NEAR, SADDLE_NARROW));
    const r = batteryVsCorridor(NEAR, true, decoy);
    expect(r.atDecoy).toBe(3);
    expect(r.atFlanker).toBe(1);
    expect(r.flankerWhileDecoyLived).toBe(0);
  });
});
