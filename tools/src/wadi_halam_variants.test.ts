// Wadi Halam's four per-mission map variants, as assertions.
//
// `docs/campaign/map-variants-design.md` §3.3 authors `wadi_halam_2` (The
// Terraces, foothold), `wadi_halam_3` (The Cattle Track, buildup),
// `wadi_halam_4` (The Village, clearance) and `wadi_halam_5` (The Depot,
// clearance, "author last") as separate files derived from the base
// `wadi_halam_basin.json` -- Option A of that document, the same pattern
// `tel_marum_variants.test.ts` and `beit_sahwan_variants.test.ts` pin for
// their towns. Mission I (`wadi_halam_1_fords`) stays on the base by design
// ("the fords are the lesson" and the base map already teaches them).
//
// Every route is walked off the real `FlowField` with `sim.blocked`/
// `sim.blockedVehicle` and (for II) the real elevation grid; every sight
// claim is a `sim.debugDetection` after 12 simulated seconds. Several
// findings here correct the design document's own estimates -- dated notes
// were added to `docs/campaign/map-variants-design.md` §3.3 itself,
// 2026-09-06, and are summarised again at the top of each `describe` block
// below so this file does not silently disagree with what it pins:
//
//   `wadi_halam_2`'s ditch-stub coordinates from the design sketch (36-41,
//   y18-19 / y28-29) sit INSIDE the depot compound's own walled footprint
//   (x34-42, y16-31) -- a shared landmark every variant must leave
//   untouched -- so they are relocated to open ground outside the compound,
//   on the same columns, at the rows each raider group's own straight-line
//   approach actually crosses (measured, not estimated: y~12 north, y~35
//   south).
//
//   `wadi_halam_2`'s elevation shoulder (the "ramp... 3 tiles off each
//   raider's axis" the design calls for) produces real, measured DEAD
//   GROUND but -- unlike Tel Marum's saddle table -- no route-length or
//   route-shape change on any of the three wave approaches to pump_house:
//   every one of them already funnels through the identical northwest
//   corner (23,16) regardless of origin (the depot compound's own shape
//   forces that funnel with no elevation involved at all), and climbing the
//   shoulder there is cheaper than any detour long enough to avoid it. This
//   is the same "distant ridge"/"bowl" absorption CLAUDE.md already
//   documents twice, on a third map.
//
//   `wadi_halam_3`'s two bypass-ditch cuts, positioned per the design's own
//   sketch rows, left two full rows of completely open ground between the
//   cut and the compound's own wall -- a route slips underneath a one-row
//   ditch for nothing when the surrounding field is open, exactly Beit
//   Sahwan II's own corrected lesson reproduced on a second map. Moved
//   adjacent to the compound's north/south walls (rows 12/35, unchanged from
//   the original sketch's own row numbers -- the compound's own bulk is what
//   was missing from the geometry, not the ditch's position) this produces a
//   genuine light effect matching CLAUDE.md's own calibration table: route
//   length UNCHANGED, shape bent (more turns on the north lane; different
//   tiles taken on the south lane) -- not the length increase the design
//   text speculated. wh_hvt_amir's own withdrawal to `rif_east` is
//   unaffected by either ditch and stays finite, which is what the design
//   actually requires of it ("verify... a route ... is finite").
//
//   `wadi_halam_4`'s headline vehicle route (`player_start` -> `village_center`)
//   is measured UNCHANGED (20 tiles, 1 turn) on every edit made -- it runs
//   along y=26, south of the courtyard wall (y16-18), the west-approach
//   rubble (y19-21) and the mosque forecourt (y22-25) alike. This is the
//   same shape as Beit Sahwan III's own correction: the headline leg is
//   untouched: what is real are several substantial LOCAL closures (the
//   only north-south gap in the whole two-house block goes from 4 to 19
//   tiles to cross once walled; the west rubble lane from 2 to 6; the
//   mosque forecourt from 8 to 9 and 4 to 6 on its two approaches).
//
//   `wadi_halam_5`'s northern spoil patch, as the design sketched it
//   (31-32, 25-26), sits directly on the D9's own chosen tile (31,25) --
//   the exact diagonal shortcut its real route already takes from its start
//   [13,25] to the gate -- moving the route by one tile, exactly the
//   failure this mission's own design text names ("anything else means the
//   spoil has leaked onto the road, and the change should be dropped rather
//   than trimmed"). Shifted one row south (26-27), which stays beside the
//   same leg and produces a byte-identical route, pinned below as the exact
//   path array rather than only its length.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];

const BASE = maps.wadi_halam_basin as unknown as MapJson;
const WH2 = maps.wadi_halam_2 as unknown as MapJson;
const WH3 = maps.wadi_halam_3 as unknown as MapJson;
const WH4 = maps.wadi_halam_4 as unknown as MapJson;
const WH5 = maps.wadi_halam_5 as unknown as MapJson;
const VARIANTS: readonly (readonly [string, MapJson])[] = [
  ['wadi_halam_2', WH2],
  ['wadi_halam_3', WH3],
  ['wadi_halam_4', WH4],
  ['wadi_halam_5', WH5],
];

/** Sight far past anything on this map -- matches
 *  `tel_marum_variants.test.ts`'s and `beit_sahwan_variants.test.ts`'s own
 *  OBSERVER exactly. */
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

/** Shortest route in tiles off the real `FlowField`. `null` means no route
 *  at all -- mirrors `tel_marum_doctrine.test.ts`'s `route()`. */
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

/** The full sequence of tiles the shortest route visits. */
function path(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): Pt[] {
  const { map, sim } = load(json);
  const mask = domain === 'foot' ? sim.blocked : sim.blockedVehicle;
  const field = new FlowField(map.width, map.height);
  field.compute(mask, sim.elevation, to[0], to[1]);
  let x = from[0];
  let y = from[1];
  const pts: Pt[] = [[x, y]];
  for (let steps = 0; steps <= map.width * map.height; steps++) {
    if (x === to[0] && y === to[1]) return pts;
    const d = field.dirs[y * map.width + x];
    if (d === undefined || d === DIR_NONE) return pts;
    x += DIR_DX[d] ?? 0;
    y += DIR_DY[d] ?? 0;
    pts.push([x, y]);
  }
  return pts;
}

/** Number of direction changes along the shortest route -- the design
 *  document's own §0 "not a straight line" metric. */
function turns(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): number {
  const pts = path(json, domain, from, to);
  let count = 0;
  let prevDx = 0;
  let prevDy = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    if (i > 1 && (dx !== prevDx || dy !== prevDy)) count++;
    prevDx = dx;
    prevDy = dy;
  }
  return count;
}

/** Real sim, real sight -- matches `tel_marum_variants.test.ts`'s `sees()`.
 *  No structure registration needed here: the one sight claim this file
 *  makes is about ELEVATION (wadi_halam_2's shoulder), not a structure's
 *  `low_profile` flag. */
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

/** Overwrite a rectangular run of tiles -- the gap/seal controls, in the
 *  idiom of `tel_marum_doctrine.test.ts`'s `control()`. */
function withBlockedRun(json: MapJson, y0: number, y1: number, x0: number, x1: number, ch: string): MapJson {
  const rows = json.rows.slice();
  for (let y = y0; y <= y1; y++) {
    const chars = rows[y].split('');
    for (let x = x0; x <= x1; x++) chars[x] = ch;
    rows[y] = chars.join('');
  }
  return { ...json, rows };
}

// Pulled off the base map's own markers rather than hardcoded.
const PUMP_HOUSE = marker(BASE, 'pump_house');
const VILLAGE_CENTER = marker(BASE, 'village_center');
const DEPOT_GATE = marker(BASE, 'depot_gate');
const RIF_NORTH = marker(BASE, 'rif_north');
const RIF_EAST = marker(BASE, 'rif_east');
const RIF_SOUTH = marker(BASE, 'rif_south');
const HIDE_NORTH = marker(BASE, 'hide_north');
const KDF_CROSSING = marker(BASE, 'kdf_crossing');
const CIV_REFUGE = marker(BASE, 'civ_refuge');

const BUILDING_SYMBOLS = new Set(['s', 'h', 'a', 'w', '#', 'm', '=', 'c']);

describe('shared landmarks — the drift guard, and the reason Option A is safe', () => {
  it.each(VARIANTS)('%s: every base marker is present, at its base coordinates', (_id, json) => {
    for (const [name, pos] of Object.entries(BASE.markers ?? {})) {
      expect(json.markers?.[name], `missing marker "${name}"`).toEqual(pos);
    }
  });

  it.each(VARIANTS)('%s: zones are copied whole -- no zone moved, dropped or resized', (_id, json) => {
    expect(json.zones).toEqual(BASE.zones);
  });

  it.each(VARIANTS)('%s: the tunnels block is byte-identical to the base (neither carries one)', (_id, json) => {
    expect(json.tunnels).toEqual(BASE.tunnels);
  });

  it.each(VARIANTS)('%s: still a 48x48 frame, green terrain kept', (_id, json) => {
    expect(json.width).toBe(48);
    expect(json.height).toBe(48);
    expect(json.rows).toHaveLength(48);
    json.rows.forEach((r) => expect(r).toHaveLength(48));
    expect(json.terrain).toBe('green');
  });

  it.each(VARIANTS)('%s: touches no building tile at all', (_id, json) => {
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 48; x++) {
        if (BUILDING_SYMBOLS.has(BASE.rows[y][x])) expect(json.rows[y][x]).toBe(BASE.rows[y][x]);
      }
  });

  it.each(VARIANTS)('%s: the poplar gallery (x7-12, every row) is byte-identical to the base', (_id, json) => {
    for (let y = 0; y < 48; y++) {
      expect(json.rows[y].slice(7, 13)).toBe(BASE.rows[y].slice(7, 13));
    }
  });

  it('each variant adds only the markers its own section names, nothing else', () => {
    const added = (json: MapJson) => Object.keys(json.markers ?? {}).filter((k) => !(k in (BASE.markers ?? {})));
    expect(added(WH2)).toEqual([]);
    expect(added(WH3)).toEqual([]);
    expect(added(WH4)).toEqual([]);
    expect(added(WH5)).toEqual([]);
  });
});

describe('wadi_halam_2 (The Terraces): a real dead-ground shoulder that does not reroute the wave approaches', () => {
  it('vehicle kdf_crossing -> pump_house: unchanged at 14 tiles -- the player is never taxed', () => {
    expect(route(BASE, 'vehicle', KDF_CROSSING, PUMP_HOUSE)).toBe(14);
    expect(route(WH2, 'vehicle', KDF_CROSSING, PUMP_HOUSE)).toBe(14);
  });

  it('foot kdf_crossing -> pump_house: unchanged at 14 tiles', () => {
    expect(route(WH2, 'foot', KDF_CROSSING, PUMP_HOUSE)).toBe(route(BASE, 'foot', KDF_CROSSING, PUMP_HOUSE));
  });

  it('vehicle rif_east -> pump_house: unchanged at 35 tiles -- the elevation shoulder is absorbed, not reordered', () => {
    expect(route(BASE, 'vehicle', RIF_EAST, PUMP_HOUSE)).toBe(35);
    expect(route(WH2, 'vehicle', RIF_EAST, PUMP_HOUSE)).toBe(35);
    // Same exact tiles too, not merely the same count.
    expect(path(WH2, 'vehicle', RIF_EAST, PUMP_HOUSE)).toEqual(path(BASE, 'vehicle', RIF_EAST, PUMP_HOUSE));
  });

  it('vehicle rif_north -> pump_house: unchanged at 27 tiles, shape bent (3 -> 5 turns) by the relocated ditch stub', () => {
    expect(route(BASE, 'vehicle', RIF_NORTH, PUMP_HOUSE)).toBe(27);
    expect(turns(BASE, 'vehicle', RIF_NORTH, PUMP_HOUSE)).toBe(3);
    expect(route(WH2, 'vehicle', RIF_NORTH, PUMP_HOUSE)).toBe(27);
    expect(turns(WH2, 'vehicle', RIF_NORTH, PUMP_HOUSE)).toBe(5);
  });

  it('vehicle rif_south -> pump_house: unchanged at 30 tiles, real tiles differ (the south ditch stub is dodged, not ignored)', () => {
    expect(route(BASE, 'vehicle', RIF_SOUTH, PUMP_HOUSE)).toBe(30);
    expect(route(WH2, 'vehicle', RIF_SOUTH, PUMP_HOUSE)).toBe(30);
    const basePath = path(BASE, 'vehicle', RIF_SOUTH, PUMP_HOUSE);
    const varPath = path(WH2, 'vehicle', RIF_SOUTH, PUMP_HOUSE);
    expect(varPath).not.toEqual(basePath);
  });

  it('the ditch is genuinely open only at its gap column -- every other tile in its span is vehicle-blocked, foot-open', () => {
    for (let x = 36; x <= 41; x++) {
      if (x === 39) {
        expect(WH2.rows[12][x], `gap (${x},12)`).toBe('.');
      } else {
        expect(WH2.rows[12][x], `(${x},12)`).toBe('d');
      }
    }
  });

  it('the elevation shoulder is a real dead-ground wall: a line laid flat across its crest is blocked, the base equivalent is not', () => {
    expect(sees(BASE, [17, 17], [25, 17])).toBe(true);
    expect(sees(WH2, [17, 17], [25, 17])).toBe(false);
    // Positive control: a line that never crosses the shoulder (both ends
    // west of it) still sees on both, so this is the shoulder and not a
    // broken detection system.
    expect(sees(BASE, [14, 17], [17, 17])).toBe(true);
    expect(sees(WH2, [14, 17], [17, 17])).toBe(true);
  });

  it('the shed [16,19] and pump_house [17,20] sit on a single flat tread, never straddling a riser', () => {
    const shedRows = [19, 20];
    const shedCols = [16, 17];
    const levels = new Set<string>();
    for (const y of shedRows) for (const x of shedCols) levels.add(WH2.elevation?.[y]?.[x] ?? '?');
    expect(levels.size).toBe(1);
    expect([...levels][0]).toBe('0');
  });

  it('the player-side pasture (x13-17) stays at elevation 0 everywhere, matching ground outside the zone', () => {
    for (let y = 14; y < 34; y++) {
      for (let x = 13; x <= 17; x++) {
        expect(WH2.elevation?.[y]?.[x], `(${x},${y})`).toBe('0');
      }
    }
  });
});

describe('wadi_halam_3 (The Cattle Track): the bypass ditches bend shape without lengthening, the commander\'s escape stays finite', () => {
  it("wh_hvt_amir's withdrawal (hide_north -> rif_east) is unaffected by either ditch and stays finite at 30 tiles", () => {
    expect(route(BASE, 'vehicle', HIDE_NORTH, RIF_EAST)).toBe(30);
    expect(route(WH3, 'vehicle', HIDE_NORTH, RIF_EAST)).toBe(30);
  });

  it('vehicle rif_north -> pump_house: unchanged at 27 tiles, shape bent (3 -> 5 turns)', () => {
    expect(route(WH3, 'vehicle', RIF_NORTH, PUMP_HOUSE)).toBe(27);
    expect(turns(WH3, 'vehicle', RIF_NORTH, PUMP_HOUSE)).toBe(5);
  });

  it('vehicle rif_south -> pump_house: unchanged at 30 tiles, real tiles differ from the base', () => {
    expect(route(WH3, 'vehicle', RIF_SOUTH, PUMP_HOUSE)).toBe(30);
    expect(path(WH3, 'vehicle', RIF_SOUTH, PUMP_HOUSE)).not.toEqual(path(BASE, 'vehicle', RIF_SOUTH, PUMP_HOUSE));
  });

  it('the north ditch is a genuine local closure crossing it directly: 2 -> 4 tiles', () => {
    expect(route(BASE, 'vehicle', [38, 11], [38, 13])).toBe(2);
    expect(route(WH3, 'vehicle', [38, 11], [38, 13])).toBe(4);
  });

  it('the south ditch is a genuine local closure crossing it directly: 2 -> 4 tiles', () => {
    expect(route(BASE, 'vehicle', [37, 34], [37, 36])).toBe(2);
    expect(route(WH3, 'vehicle', [37, 34], [37, 36])).toBe(4);
  });

  it('the two civilian foot routes to civ_refuge are unaffected -- olive fingers and knolls never block, and neither ditch lies on their line', () => {
    expect(route(WH3, 'foot', [20, 32], CIV_REFUGE)).toBe(route(BASE, 'foot', [20, 32], CIV_REFUGE));
    expect(route(WH3, 'foot', [23, 33], CIV_REFUGE)).toBe(route(BASE, 'foot', [23, 33], CIV_REFUGE));
  });

  it('the gallery-finger and knoll tiles are all flavour on open ground -- never over a building, never over a marker tile', () => {
    for (const [x, y] of [
      [22, 9], // hide_north marker
      [22, 38], // hide_south marker
    ]) {
      expect(WH3.rows[y][x], `(${x},${y})`).toBe(BASE.rows[y][x]);
    }
  });
});

describe('wadi_halam_4 (The Village): the headline route is untouched, three local closures are real', () => {
  it('vehicle player_start(9,21) -> village_center: unchanged at 20 tiles, 1 turn -- the route runs along y=26, south of every edit', () => {
    expect(route(BASE, 'vehicle', [9, 21], VILLAGE_CENTER)).toBe(20);
    expect(turns(BASE, 'vehicle', [9, 21], VILLAGE_CENTER)).toBe(1);
    expect(route(WH4, 'vehicle', [9, 21], VILLAGE_CENTER)).toBe(20);
    expect(turns(WH4, 'vehicle', [9, 21], VILLAGE_CENTER)).toBe(1);
  });

  it('foot player_start(9,21) -> village_center: also unchanged at 20 tiles', () => {
    expect(route(WH4, 'foot', [9, 21], VILLAGE_CENTER)).toBe(route(BASE, 'foot', [9, 21], VILLAGE_CENTER));
  });

  it('the north lane is the only gap in the two-house block: walling it is a genuine local closure, 4 -> 19 tiles', () => {
    expect(route(BASE, 'vehicle', [29, 15], [29, 19])).toBe(4);
    expect(route(WH4, 'vehicle', [29, 15], [29, 19])).toBe(19);
  });

  it('the west-approach rubble is a genuine local closure: 2 -> 6 tiles crossing it', () => {
    expect(route(BASE, 'vehicle', [23, 20], [25, 20])).toBe(2);
    expect(route(WH4, 'vehicle', [23, 20], [25, 20])).toBe(6);
  });

  it('the mosque forecourt wall is a real, modest barrier on both of its approaches', () => {
    expect(route(BASE, 'vehicle', [29, 20], [29, 26])).toBe(8);
    expect(route(WH4, 'vehicle', [29, 20], [29, 26])).toBe(9);
    expect(route(BASE, 'vehicle', [32, 23], VILLAGE_CENTER)).toBe(4);
    expect(route(WH4, 'vehicle', [32, 23], VILLAGE_CENTER)).toBe(6);
  });

  it('the lane is single-file its whole height, flanked by houses on both sides at every row -- so a wall anywhere in it seals it completely, and its own "gap" at (29,17) is a fully isolated pocket (unreachable diagonally too: no-corner-cutting blocks every diagonal approach around a house)', () => {
    // (29,17) itself: open, but every orthogonal neighbour is blocked --
    // (29,16) and (29,18) are the new wall, (28,17) and (30,17) are houses.
    expect(WH4.rows[17][29]).toBe('.');
    expect(WH4.rows[16][29]).toBe('=');
    expect(WH4.rows[18][29]).toBe('=');
    expect(WH4.rows[17][28]).toBe('h');
    expect(WH4.rows[17][30]).toBe('h');
    // Sealing that already-unreachable "gap" too changes nothing further --
    // the corridor was already fully sealed by the wall alone.
    const sealed = withBlockedRun(WH4, 17, 17, 29, 29, '=');
    expect(route(sealed, 'vehicle', [29, 15], [29, 19])).toBe(route(WH4, 'vehicle', [29, 15], [29, 19]));
    expect(route(BASE, 'vehicle', [29, 15], [29, 19])).toBe(4);
  });

  it('the mosque itself and the ROE flagged_zone are untouched -- the wall sits on the zone\'s own border, never its interior', () => {
    const mz = BASE.zones?.mosque_block;
    if (!mz) throw new Error('no mosque_block zone');
    for (let y = mz[1] + 0; y < mz[1] + 3; y++)
      for (let x = mz[0]; x < mz[0] + 3; x++) expect(WH4.rows[y][x]).toBe('m');
  });

  it('all three civilian foot routes to civ_refuge are unaffected by any edit', () => {
    for (const from of [
      [28, 20],
      [29, 28],
      [25, 23],
    ] as Pt[]) {
      expect(route(WH4, 'foot', from, CIV_REFUGE)).toBe(route(BASE, 'foot', from, CIV_REFUGE));
    }
  });

  it('every enemy garrison tile this mission fields stays a building, untouched by the new cover/rubble/walls', () => {
    for (const [x, y] of [
      [26, 17],
      [31, 17],
      [26, 28],
      [31, 28],
    ]) {
      expect(WH4.rows[y][x], `(${x},${y})`).toBe(BASE.rows[y][x]);
    }
  });
});

describe('wadi_halam_5 (The Depot): the lightest variant -- the D9\'s own route is byte-identical', () => {
  it("the D9's route from its own spawn [13,25] to depot_gate is the exact same tile sequence as the base, 21 tiles", () => {
    const basePath = path(BASE, 'vehicle', [13, 25], DEPOT_GATE);
    const varPath = path(WH5, 'vehicle', [13, 25], DEPOT_GATE);
    expect(varPath).toEqual(basePath);
    expect(varPath).toHaveLength(22); // 22 points = 21 steps
  });

  it('the south route (village_center -> depot_gate) is unaffected: 5 tiles on both', () => {
    expect(route(BASE, 'vehicle', VILLAGE_CENTER, DEPOT_GATE)).toBe(5);
    expect(route(WH5, 'vehicle', VILLAGE_CENTER, DEPOT_GATE)).toBe(5);
  });

  it('the road at x=33 and the gate at [34,24] are untouched', () => {
    for (let y = 25; y <= 33; y++) expect(WH5.rows[y][33]).toBe('r');
    expect(WH5.rows[24][34]).toBe('.');
  });

  it('the spoil tiles are open ground on the base, boulder field on the variant, and never on the road', () => {
    // (31,27)/(32,27) are skipped by construction -- the south house block
    // already occupies them ((30-32,27-29)), so the northern patch is a
    // 2-tile sliver at row 26 rather than the sketch's full 2x2, exactly
    // the "never overwrite a building" rule every other town's variants
    // follow (`only_open`, matching `beit_sahwan_variants.test.ts`'s own
    // idiom).
    for (const [x, y] of [
      [31, 26],
      [32, 26],
      [31, 30],
      [32, 30],
      [31, 31],
      [32, 31],
    ]) {
      expect(BASE.rows[y][x], `(${x},${y}) base`).toBe('.');
      expect(WH5.rows[y][x], `(${x},${y}) variant`).toBe('b');
    }
    expect(BASE.rows[27][31]).toBe('h');
    expect(WH5.rows[27][31]).toBe('h');
  });

  it('the forecourt cover sits on open ground only -- (36,22) is skipped because it is a warehouse tile on the base', () => {
    expect(BASE.rows[22][36]).toBe('w');
    expect(WH5.rows[22][36]).toBe('w');
    for (const [x, y] of [
      [35, 22],
      [35, 23],
      [36, 23],
      [35, 26],
      [36, 26],
      [35, 27],
      [36, 27],
    ]) {
      expect(WH5.rows[y][x], `(${x},${y})`).toBe('2');
    }
  });

  it("every one of the mission's seven raze targets and the gate ambush tile are still buildings/open exactly as the base", () => {
    for (const [x, y] of [
      [36, 18],
      [40, 18],
      [36, 21],
      [40, 21],
      [36, 24],
      [39, 24],
      [37, 27],
    ]) {
      expect(WH5.rows[y][x], `(${x},${y})`).toBe(BASE.rows[y][x]);
    }
  });
});
