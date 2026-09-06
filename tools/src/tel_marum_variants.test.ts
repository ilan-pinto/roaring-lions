// Tel Marum's three per-mission map variants, as assertions.
//
// `docs/campaign/map-variants-design.md` §3.1 authors `tel_marum_1` (The
// Herders' Floor, recon), `tel_marum_2` (The Prepared Ground, foothold) and
// `tel_marum_3` (The Churned Pass, clearance) as separate files derived from
// the base `tel_marum.json` -- Option A of that document. This file pins its
// measured claims against the real engine, in the idiom of
// `tel_marum_doctrine.test.ts` and `umm_zeitoun_doctrine.test.ts`: every
// route is walked off the real `FlowField` with `sim.blocked`/
// `sim.blockedVehicle` and the real elevation grid, every sight claim is a
// `sim.debugDetection` after 12 simulated seconds, and every claim that can
// be falsified by removing the new obstacle is paired with a CONTROL that
// does exactly that.
//
// One correction to the design document, found by building it rather than by
// reading it (dated note added to the design doc itself, 2026-09-06):
//
//   §3.1 `tel_marum_3`'s sketch adds a `b` "footing" at (19,16) and (29,16) --
//   inside rows 16-17, the wall band the same document says (twice, and
//   CLAUDE.md a third time) "all three variants leave... untouched". Worse,
//   (19,16) is the exact tile `tm_pocket_west`'s `atgm_cell` garrisons at
//   [19.5,16.5] in both `tel_marum_1_recon` and `tel_marum_2_foothold` (III
//   moves that pocket to the same tile) -- a boulder under a live garrison
//   spawn. `tel_marum_3.json` does NOT carry these two tiles; rows 12-17 are
//   copied byte-identical from the base for all three variants, full stop,
//   and this file's "shared landmarks" block is the guard. Dropping the
//   footings changes NOTHING measured below -- every route/column number this
//   file pins for `tel_marum_3` was re-measured with the footings absent and
//   matches the design document's own predictions exactly; the crater belt
//   at rows 20-21 (kept) already does the gating the footings were meant to
//   sharpen.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];

const BASE = maps.tel_marum as unknown as MapJson;
const TM1 = maps.tel_marum_1 as unknown as MapJson;
const TM2 = maps.tel_marum_2 as unknown as MapJson;
const TM3 = maps.tel_marum_3 as unknown as MapJson;
const VARIANTS: readonly (readonly [string, MapJson])[] = [
  ['tel_marum_1', TM1],
  ['tel_marum_2', TM2],
  ['tel_marum_3', TM3],
];

/** Sight far past anything on this map -- a terrain/LOS fact, matching
 *  `tel_marum_doctrine.test.ts`'s OBSERVER exactly. */
const OBSERVER: UnitTypeJson = {
  id: 't_observer',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 48, signature: 0.6 },
};

function load(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
  applyTerrain(map, sim);
  return { map, sim };
}

function marker(json: MapJson, name: string): Pt {
  const raw = json.markers?.[name];
  if (!raw || raw.length < 2 || raw[0] === undefined || raw[1] === undefined) {
    throw new Error(`map has no "${name}" marker`);
  }
  return [raw[0], raw[1]];
}

/** Shortest route in tiles, walked off the real `FlowField`. `null` means the
 *  mask offers no route at all -- mirrors `tel_marum_doctrine.test.ts`'s
 *  `route()`. */
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

/** How many DISTINCT x-columns the shortest route crosses -- the design
 *  document's own "1 column" / "7 columns" shape metric (§0, §2.3, §3.1):
 *  a route confined to one column is a straight line up the map; a route
 *  touching many is the dogleg the obstacle forced. `null` if no route. */
function columns(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): number | null {
  const { map, sim } = load(json);
  const mask = domain === 'foot' ? sim.blocked : sim.blockedVehicle;
  const field = new FlowField(map.width, map.height);
  field.compute(mask, sim.elevation, to[0], to[1]);
  let x = from[0];
  let y = from[1];
  const xs = new Set<number>([x]);
  for (let steps = 0; steps <= map.width * map.height; steps++) {
    if (x === to[0] && y === to[1]) return xs.size;
    const d = field.dirs[y * map.width + x];
    if (d === undefined || d === DIR_NONE) return null;
    x += DIR_DX[d] ?? 0;
    y += DIR_DY[d] ?? 0;
    xs.add(x);
  }
  return null;
}

/** Real sim, real sight -- matches `tel_marum_doctrine.test.ts`'s `sees()`. */
function sees(json: MapJson, a: Pt, b: Pt): boolean {
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const t = sim.addUnitType(OBSERVER);
  const watcher = sim.spawn(t, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const target = sim.spawn(t, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  const detection = sim.debugDetection(watcher, target);
  if (!detection) throw new Error(`no detection record between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  return detection.visible;
}

/** Overwrite a rectangular run of tiles -- used to build the "one crossing
 *  sealed" controls in the two-routes block, in the idiom of
 *  `tel_marum_doctrine.test.ts`'s `control()` (which subtracts a symbol; this
 *  adds one). */
function withBlockedRun(json: MapJson, y0: number, y1: number, x0: number, x1: number, ch: string): MapJson {
  const rows = json.rows.slice();
  for (let y = y0; y <= y1; y++) {
    const chars = rows[y].split('');
    for (let x = x0; x <= x1; x++) chars[x] = ch;
    rows[y] = chars.join('');
  }
  return { ...json, rows };
}

// Pulled off the base map's own markers rather than hardcoded, so a future
// edit to the base's marker table cannot silently leave these stale --
// `marker()` throws by name rather than destructuring `undefined`.
const START = marker(BASE, 'start_line');
const HOLLOW = marker(BASE, 'hollow');
const APPROACH = marker(BASE, 'approach');
const BATTERY = marker(BASE, 'battery_position');
const SADDLE_WIDE = marker(BASE, 'saddle_wide');
const SADDLE_NARROW = marker(BASE, 'saddle_narrow');
const OVERWATCH_W = marker(BASE, 'overwatch_west');
// Not markers on the base map -- observer stations, matching
// `tel_marum_doctrine.test.ts`'s own literal SPOTTER_NARROW/mouth points.
const SPOTTER_NARROW: Pt = [12, 4];
const CORRIDOR_MOUTH: Pt = [8, 9];

describe('shared landmarks — the drift guard, and the reason Option A is safe', () => {
  it.each(VARIANTS)('%s: rows 12-17 (the wall) are byte-identical to the base', (_id, json) => {
    for (let y = 12; y <= 17; y++) expect(json.rows[y]).toBe(BASE.rows[y]);
  });

  it.each(VARIANTS)('%s: the flanking ^ columns (0-5, 42-47) are untouched on every row', (_id, json) => {
    for (let y = 0; y < 48; y++) {
      expect(json.rows[y].slice(0, 6)).toBe(BASE.rows[y].slice(0, 6));
      expect(json.rows[y].slice(42, 48)).toBe(BASE.rows[y].slice(42, 48));
    }
  });

  it.each(VARIANTS)('%s: every base marker is present, at its base coordinates', (_id, json) => {
    for (const [name, pos] of Object.entries(BASE.markers ?? {})) {
      expect(json.markers?.[name], `missing marker "${name}"`).toEqual(pos);
    }
  });

  it.each(VARIANTS)('%s: zones are copied whole -- no zone moved, dropped or resized', (_id, json) => {
    expect(json.zones).toEqual(BASE.zones);
  });

  it('each variant adds only the markers its own section names, nothing else', () => {
    const added = (json: MapJson) => Object.keys(json.markers ?? {}).filter((k) => !(k in (BASE.markers ?? {})));
    expect(added(TM1).sort()).toEqual(['ford_east', 'ford_west']);
    expect(added(TM2).sort()).toEqual(['crossing_east', 'crossing_west']);
    expect(added(TM3).sort()).toEqual(['gate_east', 'gate_west']);
  });

  it.each(VARIANTS)('%s: no tunnels exist on the base and none were added', (_id, json) => {
    expect(json.tunnels).toEqual(BASE.tunnels);
  });

  it.each(VARIANTS)('%s: still a 48x48 frame', (_id, json) => {
    expect(json.width).toBe(48);
    expect(json.height).toBe(48);
    expect(json.rows).toHaveLength(48);
    json.rows.forEach((r) => expect(r).toHaveLength(48));
  });
});

// The design's own headline number for each variant: how far the vehicle
// route bends and how many distinct columns it now touches, against the
// base's 1-column straight line. Foot is asserted unchanged on the same legs
// -- rule 4 of the design's obstacle grammar ("never lengthen a civilian's
// line") generalised to every foot leg this file can cheaply re-measure.
describe('tel_marum_1 (The Herders\' Floor): vehicle screen bends, foot does not', () => {
  it('vehicle start_line -> hollow: 15 -> 17 tiles, 1 -> 7 columns', () => {
    expect(route(BASE, 'vehicle', START, HOLLOW)).toBe(15);
    expect(columns(BASE, 'vehicle', START, HOLLOW)).toBe(1);
    expect(route(TM1, 'vehicle', START, HOLLOW)).toBe(17);
    expect(columns(TM1, 'vehicle', START, HOLLOW)).toBe(7);
  });

  it('vehicle start_line -> approach: 20 tiles unchanged, 1 -> 7 columns', () => {
    expect(route(BASE, 'vehicle', START, APPROACH)).toBe(20);
    expect(route(TM1, 'vehicle', START, APPROACH)).toBe(20);
    expect(columns(BASE, 'vehicle', START, APPROACH)).toBe(1);
    expect(columns(TM1, 'vehicle', START, APPROACH)).toBe(7);
  });

  it('foot start_line -> hollow / approach: unchanged in tiles', () => {
    for (const to of [HOLLOW, APPROACH]) {
      expect(route(TM1, 'foot', START, to)).toBe(route(BASE, 'foot', START, to));
    }
  });

  it('the foot-blocked mask differs from the base ONLY at the new stock pen (14-15, 27-28) -- nothing else on foot moved', () => {
    const { sim: baseSim } = load(BASE);
    const { sim: tm1Sim } = load(TM1);
    const diffs: Array<[number, number]> = [];
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 48; x++) {
        const i = y * 48 + x;
        if (baseSim.blocked[i] !== tm1Sim.blocked[i]) diffs.push([x, y]);
      }
    const expected: Array<[number, number]> = [
      [14, 27],
      [15, 27],
      [14, 28],
      [15, 28],
    ];
    expect(diffs.sort()).toEqual(expected.sort());
  });

  it('two fords, not one: blocking either alone still crosses, blocking both seals it', () => {
    const noWest = withBlockedRun(TM1, 34, 35, 12, 14, 'b');
    const noEast = withBlockedRun(TM1, 34, 35, 30, 32, 'b');
    const noBoth = withBlockedRun(noWest, 34, 35, 30, 32, 'b');
    expect(route(noWest, 'vehicle', START, HOLLOW)).toBe(17);
    expect(route(noEast, 'vehicle', START, HOLLOW)).toBe(23);
    expect(route(noBoth, 'vehicle', START, HOLLOW)).toBeNull();
    // Control: the unmodified base (no fords, no boulders at all here) has
    // never needed either crossing.
    expect(route(BASE, 'vehicle', START, HOLLOW)).toBe(15);
  });

  it("the herders' evacuation route: [21,24] -> start_line, unchanged at 20 tiles", () => {
    // civilians.groups[0].at is [21,24]; civilians.refuge is "start_line" --
    // mission.ts requires the refuge marker to sit inside the evacuate_before
    // target zone ("muster_ground"), which start_line does. Every symbol TM1
    // adds (o, n, b, s excepted) is foot-open; the stock pen is nowhere near
    // this line, which the mask-diff test above already proves in general.
    expect(route(BASE, 'foot', [21, 24], START)).toBe(20);
    expect(route(TM1, 'foot', [21, 24], START)).toBe(20);
  });

  it('the herders, the ammo/garrison tiles and the stock pen footprint are where the mission and the grid agree', () => {
    expect(TM1.rows[24][21]).toBe('.'); // civilians.groups[0].at [21,24]
    const mz = TM1.zones?.muster_ground;
    if (!mz) throw new Error('no muster_ground zone');
    for (let y = mz[1]; y < mz[1] + mz[3]; y++)
      for (let x = mz[0]; x < mz[0] + mz[2]; x++) expect(TM1.rows[y][x]).toBe('.');
    for (const [x, y] of [
      [28, 16],
      [19, 16],
      [20, 16],
      [24, 13],
      [26, 16],
      [25, 6],
    ]) {
      expect(TM1.rows[y][x], `garrison tile (${x},${y}) blocked`).not.toMatch(/[\^#=hwasm]/);
    }
  });
});

describe('tel_marum_2 (The Prepared Ground): the ditch bends armour, the draw is dead ground', () => {
  it('vehicle start_line -> hollow: 15 -> 16 tiles, 1 -> 5 columns', () => {
    expect(route(TM2, 'vehicle', START, HOLLOW)).toBe(16);
    expect(columns(TM2, 'vehicle', START, HOLLOW)).toBe(5);
  });

  it('vehicle start_line -> approach: 20 tiles unchanged, 1 -> 5 columns', () => {
    expect(route(TM2, 'vehicle', START, APPROACH)).toBe(20);
    expect(columns(TM2, 'vehicle', START, APPROACH)).toBe(5);
  });

  it('foot start_line -> hollow / approach: unchanged in tiles, and the foot-blocked mask never moved', () => {
    for (const to of [HOLLOW, APPROACH]) {
      expect(route(TM2, 'foot', START, to)).toBe(route(BASE, 'foot', START, to));
    }
    const { sim: baseSim } = load(BASE);
    const { sim: tm2Sim } = load(TM2);
    expect(tm2Sim.blocked).toEqual(baseSim.blocked);
  });

  it('two crossings, not one: blocking either alone still crosses at the same 20 tiles', () => {
    const noWest = withBlockedRun(TM2, 33, 34, 15, 17, 'd');
    const noEast = withBlockedRun(TM2, 33, 34, 28, 30, 'd');
    expect(route(noWest, 'vehicle', START, APPROACH)).toBe(20);
    expect(route(noEast, 'vehicle', START, APPROACH)).toBe(20);
    // Blocking both named crossings does NOT seal the ditch: a sliver at
    // x=6, beside the western `^` flank, was never part of either named run
    // (design text: "y=33-34, x=7-14 / 18-27 / 31-41"). It is a 39-tile
    // detour against 20 for either named crossing -- not a design defect
    // (nothing claims a hermetic seal here, unlike TM1's fords or TM3's
    // gates), but worth pinning as what "two crossings" actually means on
    // this variant: two GOOD options, not the only two routes that exist.
    const noBoth = withBlockedRun(noWest, 33, 34, 28, 30, 'd');
    expect(route(noBoth, 'vehicle', START, APPROACH)).toBe(39);
  });

  it('the draw: elevation 2 either side of the ammo cache, flat through the middle', () => {
    for (const y of [27, 28, 29]) {
      const row = TM2.elevation?.[y];
      if (!row) throw new Error(`no elevation row ${y}`);
      expect(row.slice(19, 22)).toBe('222');
      expect(row.slice(22, 25)).toBe(BASE.elevation?.[y]?.slice(22, 25) ?? '000');
      expect(row.slice(25, 28)).toBe('222');
    }
  });

  it('the ammo_draw zone and the mission-raised shanty footprint are open ground', () => {
    const az = TM2.zones?.ammo_draw;
    if (!az) throw new Error('no ammo_draw zone');
    for (let y = az[1]; y < az[1] + az[3]; y++)
      for (let x = az[0]; x < az[0] + az[2]; x++) expect(TM2.rows[y][x]).toBe('.');
    // structures[0].at [22,27] size [2,2] (tel_marum_2_foothold.json) is
    // mission-authored, not part of the map file -- but it must still sit on
    // ground the map itself leaves open.
    for (const [x, y] of [
      [22, 27],
      [23, 27],
      [22, 28],
      [23, 28],
    ]) {
      expect(TM2.rows[y][x]).toBe('.');
    }
  });

  it('every garrison tile the mission fields stays open, tm_ammo_guard included', () => {
    for (const [x, y] of [
      [20, 16],
      [19, 16],
      [28, 16],
      [26, 16],
      [24, 13],
      [25, 6],
      [22, 26],
    ]) {
      expect(TM2.rows[y][x], `garrison tile (${x},${y}) blocked`).not.toMatch(/[\^#=hwasm]/);
    }
  });
});

describe('tel_marum_3 (The Churned Pass): the crater belt gates the approach, the pass corridor is untouched', () => {
  it('vehicle start_line -> battery_position: 38 -> 39 tiles, 3 -> 8 columns', () => {
    expect(route(BASE, 'vehicle', START, BATTERY)).toBe(38);
    expect(columns(BASE, 'vehicle', START, BATTERY)).toBe(3);
    expect(route(TM3, 'vehicle', START, BATTERY)).toBe(39);
    expect(columns(TM3, 'vehicle', START, BATTERY)).toBe(8);
  });

  it('vehicle approach -> saddle_wide: 10 -> 14 tiles, 3 -> 6 columns', () => {
    expect(route(BASE, 'vehicle', APPROACH, SADDLE_WIDE)).toBe(10);
    expect(columns(BASE, 'vehicle', APPROACH, SADDLE_WIDE)).toBe(3);
    expect(route(TM3, 'vehicle', APPROACH, SADDLE_WIDE)).toBe(14);
    expect(columns(TM3, 'vehicle', APPROACH, SADDLE_WIDE)).toBe(6);
  });

  it('foot start_line -> battery_position: unchanged at 38 tiles', () => {
    expect(route(TM3, 'foot', START, BATTERY)).toBe(38);
  });

  it('the boulder corridor is untouched: foot 8, vehicle 28 -> 31 (the wider bay gates cost armour, the corridor itself does not move)', () => {
    const CORRIDOR_SOUTH: Pt = [10, 19];
    const CORRIDOR_NORTH: Pt = [10, 11];
    expect(route(BASE, 'foot', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(8);
    expect(route(TM3, 'foot', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(8);
    expect(route(BASE, 'vehicle', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(28);
    expect(route(TM3, 'vehicle', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(31);
  });

  it('the foot-blocked mask never moved on this variant', () => {
    const { sim: baseSim } = load(BASE);
    const { sim: tm3Sim } = load(TM3);
    expect(tm3Sim.blocked).toEqual(baseSim.blocked);
  });

  it('two gates, not one: blocking either the full west or the full east gate still routes north, blocking both seals it', () => {
    // "the only vehicle gates north out of the approach are now x <= 19 and
    // x >= 29" (design §3.1) -- the FULL width of each gate, not merely the
    // tiles nearest the centre outcrop. A narrower block would reroute
    // within the SAME gate rather than test the other one.
    const noWest = withBlockedRun(TM3, 20, 21, 6, 19, 'b');
    const noEast = withBlockedRun(TM3, 20, 21, 29, 41, 'b');
    const noBoth = withBlockedRun(noWest, 20, 21, 29, 41, 'b');
    expect(route(noWest, 'vehicle', APPROACH, SADDLE_WIDE)).toBe(14);
    expect(route(noEast, 'vehicle', APPROACH, SADDLE_WIDE)).toBe(14);
    expect(route(noBoth, 'vehicle', APPROACH, SADDLE_WIDE)).toBeNull();
    // Control: the base has no crater belt at all, so blocking either half
    // of it is meaningless there -- the base's own route is unaffected by
    // rows 20-21 in the first place except through the pre-existing outcrop.
    expect(route(BASE, 'vehicle', APPROACH, SADDLE_WIDE)).toBe(10);
  });

  it("the three families' foot route to the refuge (approach): [27,5] -> approach, unchanged at 19 tiles", () => {
    // civilians.groups[0].at is [27.5,5.5] -> tile (27,5); civilians.refuge
    // is "approach". This is the exact hazard the design document's own
    // draft caught (§3.1): a berm run to x=27 would have put this tile
    // inside the boulder field. The shipped berm stops at x=26 (row 5:
    // 'b' at 22-26 only), so (27,5) stays open on both base and variant.
    expect(TM3.rows[5][27]).toBe('.');
    expect(route(BASE, 'foot', [27, 5], APPROACH)).toBe(19);
    expect(route(TM3, 'foot', [27, 5], APPROACH)).toBe(19);
  });

  it('the town_block zone (the raze/ROE-flagged structure) is untouched -- still exactly the base #s', () => {
    const tb = TM3.zones?.town_block;
    if (!tb) throw new Error('no town_block zone');
    for (let y = tb[1]; y < tb[1] + tb[3]; y++)
      for (let x = tb[0]; x < tb[0] + tb[2]; x++) expect(TM3.rows[y][x]).toBe(BASE.rows[y][x]);
  });

  it('every garrison tile the mission fields stays open, tm_spotter_narrow and tm_manpad included', () => {
    for (const [x, y] of [
      [19, 16],
      [28, 16],
      [20, 16],
      [12, 4],
      [26, 16],
      [24, 13],
      [23, 8],
      [25, 6],
    ]) {
      expect(TM3.rows[y][x], `garrison tile (${x},${y}) blocked`).not.toMatch(/[\^#=hwasm]/);
    }
  });
});

// Sight facts the briefings depend on. None of the three variants touch the
// tiles these rays cross (TM1/TM2's floor changes sit south of the wall but
// their added symbols -- o, n, b, d, elevation 2 in a gap well off these
// lines -- do not intersect them; TM3's changes sit north of the wall but
// stop short of the corridor mouth and its own watcher's line). Re-driven
// through the real Sim rather than assumed, because a ray drawn by eye is
// exactly what got these facts wrong during the base map's own design
// (tel_marum_doctrine.test.ts's opening line).
describe('sight facts the briefings claim are unaffected by any variant', () => {
  it.each(VARIANTS)('%s: the west pocket still cannot see the hollow', (_id, json) => {
    expect(sees(json, OVERWATCH_W, HOLLOW)).toBe(false);
  });

  it.each(VARIANTS)('%s: the corridor is still unwatched from its own mouth', (_id, json) => {
    // Paired with a positive: [12,4] genuinely sees [10,14] on every variant,
    // so the negative below is not a broken spawn or a dead detection system.
    expect(sees(json, SPOTTER_NARROW, SADDLE_NARROW)).toBe(true);
    expect(sees(json, CORRIDOR_MOUTH, SADDLE_NARROW)).toBe(false);
  });
});
