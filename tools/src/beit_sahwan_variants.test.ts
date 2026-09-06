// Beit Sahwan's three per-mission map variants, as assertions.
//
// `docs/campaign/map-variants-design.md` §3.2 authors `beit_sahwan_2` (the
// fields west of the line, foothold), `beit_sahwan_3` (the town, contested,
// clearance) and `beit_sahwan_4` (the town after, subterranean) as separate
// files derived from the base `beit_sahwan_outskirts.json` -- Option A of
// that document, the same pattern `tel_marum_variants.test.ts` pins for Tel
// Marum. Missions I (`beit_sahwan_1_recon`) and the breach
// (`beit_sahwan_breach`) stay on the base by design (recon learns the town as
// it is; the yard's eight raid axes are the mission's own shape) and are not
// touched here.
//
// Every route is walked off the real `FlowField` with `sim.blocked`/
// `sim.blockedVehicle`, every sight claim is a `sim.debugDetection` after 12
// simulated seconds with the map's own structures registered (unlike a route
// measurement, `applyTerrain` alone is not enough for a sight claim that
// depends on a structure's `low_profile` flag -- that flag lives on the
// STRUCTURE type, read by `losRay` only when a structure entity exists at the
// tile; `tools/src/backtest/playtest.ts`'s own `run()` registers structures
// for exactly this reason and this file's `sees()` copies that, not
// `tel_marum_variants.test.ts`'s plainer `load()`, which never needed to).
//
// Two corrections to the design document, found by measuring rather than
// reading -- the same class of hazard §3.1's own TM-3 section records, and
// recorded there a second time (dated 2026-09-06) rather than only here:
//
//   `beit_sahwan_2`'s sketch put two SHORT horizontal wall runs at y=17 and
//   y=27 (x=2-7). The three waves this mission actually sends walk dead
//   straight along y=23 the entire width of `west_approach`
//   (`town_center`[31,22]/`mortar_line`[44,24] -> `kdf_assembly`[4,23] both
//   reduce to a single-row path at y=23 for x<=16) -- five and six rows off
//   either sketched wall, so it gated nothing a wave, or the plan's own
//   attack-move, ever crosses. Shipped instead: ONE north-south wall at
//   x=11, spanning the full height of the zone, with the design's own y=17
//   and y=27 kept as the two GATES in it rather than two separate wall rows.
//   This is the vertical analogue of Tel Marum's TM-2 ditch, and it is what
//   is pinned below, not the sketch: it forces the same 27-tile route through
//   one gate or the other (turns 1 -> 3, tile count unchanged, exactly TM-1's
//   own "length unchanged, shape bent" signature) and seals completely only
//   when BOTH gates are blocked.
//
//   `beit_sahwan_3`'s two-tile-wide road rubble (the north spur, the south
//   vertical road) and `beit_sahwan_4`'s two-tile-wide "one road down" both
//   measure as a real LOCAL closure (a vehicle genuinely cannot cross those
//   exact tiles any more) but as measured ZERO effect on the two headline
//   town legs (`kdf_assembly` -> `town_center`/`bs_hvt_atgm`) for BS-III, and
//   only a shape (not length) change for BS-IV -- this map is open ground
//   everywhere but its buildings, so a diagonal-absorbing flow field routes
//   around anything narrower than the map's own open span for free (CLAUDE.md
//   "a climb telescopes", reproduced here without any elevation at all).
//   BS-IV's "one road down" was widened at authoring (x20-28, y23-28, one row
//   short of the souk's own ring at y29) specifically because that IS this
//   mission's fictional point (the Namer and the Eitan can no longer drive
//   the shaft axis) and the two-tile sketch could not deliver even a shape
//   change; BS-III's clinic wall was left as authored because it is a
//   genuine, substantial barrier on its own terms (measured below, +4 tiles)
//   and its "two entries" rubble is honest, minor texture rather than this
//   mission's point.
import { describe, expect, it } from 'vitest';
import {
  applyTerrain,
  maps,
  parseMap,
  structures as structureCatalogue,
  type MapJson,
} from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];

const BASE = maps.beit_sahwan_outskirts as unknown as MapJson;
const BS2 = maps.beit_sahwan_2 as unknown as MapJson;
const BS3 = maps.beit_sahwan_3 as unknown as MapJson;
const BS4 = maps.beit_sahwan_4 as unknown as MapJson;
const VARIANTS: readonly (readonly [string, MapJson])[] = [
  ['beit_sahwan_2', BS2],
  ['beit_sahwan_3', BS3],
  ['beit_sahwan_4', BS4],
];

/** Sight far past anything on this map -- a terrain/LOS fact, matching
 *  `tel_marum_variants.test.ts`'s OBSERVER exactly. */
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

/** Like `load`, but also registers every structure the map's own grid
 *  carries -- required for any claim that reads a STRUCTURE type's flag
 *  (here, `wall`'s `low_profile`), which `applyTerrain` alone never sets.
 *  Mirrors `playtest.ts`'s `run()`. */
function loadWithStructures(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
  const { map, sim } = load(json);
  const structIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
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
 *  mask offers no route at all -- mirrors `tel_marum_doctrine.test.ts`'s and
 *  `tel_marum_variants.test.ts`'s `route()`. */
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

/** The full sequence of tiles the shortest route visits -- used to derive
 *  `turns` below. Beit Sahwan's own legs run close to diagonal across a wide
 *  open square, so `tel_marum_variants.test.ts`'s "distinct columns" metric
 *  (built for Tel Marum's near-vertical legs) is not discriminating here --
 *  it reads 27-35 on every leg tested, changed obstacle or not, simply
 *  because a mostly-horizontal 27-tile diagonal touches ~28 columns
 *  regardless. Direction changes (the design document's own §0 metric for
 *  Beit Sahwan specifically) is what actually separates a bent route from a
 *  straight one on this map. */
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

/** Number of direction changes along the shortest route -- §0's own metric. */
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

/** Real sim, real sight, real structures -- matches `playtest.ts`'s own
 *  structure-registration idiom, not `tel_marum_variants.test.ts`'s plainer
 *  `load()`, because this file's one sight claim depends on it. */
function sees(json: MapJson, a: Pt, b: Pt): boolean {
  const { sim } = loadWithStructures(json);
  const t = sim.addUnitType(OBSERVER);
  const watcher = sim.spawn(t, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const target = sim.spawn(t, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  const detection = sim.debugDetection(watcher, target);
  if (!detection) throw new Error(`no detection record between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  return detection.visible;
}

/** Overwrite a rectangular run of tiles -- the two-gate/two-crossing controls,
 *  in the idiom of `tel_marum_doctrine.test.ts`'s `control()` and
 *  `tel_marum_variants.test.ts`'s `withBlockedRun()`. */
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
const KDF_ASSEMBLY = marker(BASE, 'kdf_assembly');
const TOWN_CENTER = marker(BASE, 'town_center');
const CIV_REFUGE = marker(BASE, 'civ_refuge');
const CIV_COLLECTION = marker(BASE, 'civ_collection');
// Not markers on the base map -- objective/HVT points, matching how the
// mission JSON itself addresses them.
const BS_HVT_ATGM: Pt = [38, 22];
const BS4_START: Pt = [26, 34];
const SHAFT_HEAD: Pt = [26, 13];

const BUILDING_SYMBOLS = new Set(['#', 'h', 'a', 'w', 's', 'm']);

describe('shared landmarks — the drift guard, and the reason Option A is safe', () => {
  it.each(VARIANTS)('%s: every base marker is present, at its base coordinates', (_id, json) => {
    for (const [name, pos] of Object.entries(BASE.markers ?? {})) {
      expect(json.markers?.[name], `missing marker "${name}"`).toEqual(pos);
    }
  });

  it.each(VARIANTS)('%s: zones are copied whole -- no zone moved, dropped or resized', (_id, json) => {
    expect(json.zones).toEqual(BASE.zones);
  });

  it('no variant adds a marker -- the design names none for Beit Sahwan, unlike Tel Marum', () => {
    const added = (json: MapJson) => Object.keys(json.markers ?? {}).filter((k) => !(k in (BASE.markers ?? {})));
    expect(added(BS2)).toEqual([]);
    expect(added(BS3)).toEqual([]);
    expect(added(BS4)).toEqual([]);
  });

  it.each(VARIANTS)('%s: the tunnels block is byte-identical to the base', (_id, json) => {
    expect(json.tunnels).toEqual(BASE.tunnels);
  });

  it.each(VARIANTS)('%s: still a 48x48 frame', (_id, json) => {
    expect(json.width).toBe(48);
    expect(json.height).toBe(48);
    expect(json.rows).toHaveLength(48);
    json.rows.forEach((r) => expect(r).toHaveLength(48));
  });

  it.each(VARIANTS)('%s: touches no building tile at all', (_id, json) => {
    // Correction (2026-09-06, measured): beit_sahwan_4's sketch also rubbled
    // the warehouse at (30-33,24-27). Isolated with `pnpm playtest`, that one
    // edit alone -- nothing else -- turns the mission's scripted plan from
    // VICTORY (2.1 min, roster 6) into DEFEAT (both irreplaceable
    // yahalom_squad teams dead by t=172s), because `b` carries no sight-block
    // and opens a line from `bs4_ambush_mouth_west`'s garrison (31.5,23.5,
    // sitting on the warehouse's own ring) straight through ground a 340
    // hp/tile structure used to cover. Dropped; see the build note in
    // `docs/campaign/map-variants-design.md` §3.2. All three variants now
    // leave every building tile byte-identical to the base.
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 48; x++) {
        if (BUILDING_SYMBOLS.has(BASE.rows[y][x])) expect(json.rows[y][x]).toBe(BASE.rows[y][x]);
      }
  });

  it('the garrison tiles a mission points a "garrison" stance at, by tile, are still buildings', () => {
    // beit_sahwan_3_clearance.json: bs_cell_north_block -> [28,12] (the north
    // house). beit_sahwan_4_subterranean.json: bs4_cell_souk -> [23,31] (the
    // souk shanty), bs_cell_north_block -> [28,12] again.
    expect(BS3.rows[12][28]).toBe('h');
    expect(BS4.rows[12][28]).toBe('h');
    expect(BS4.rows[31][23]).toBe('s');
  });
});

describe('beit_sahwan_2 (the fields west of the line): the field wall bends the approach, does not seal it', () => {
  it('vehicle kdf_assembly -> town_center: 27 tiles unchanged, 1 -> 3 direction changes', () => {
    expect(route(BASE, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(27);
    expect(turns(BASE, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(1);
    expect(route(BS2, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(27);
    expect(turns(BS2, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(3);
  });

  it('foot kdf_assembly -> town_center: also bent, same as vehicle (the wall blocks both domains)', () => {
    expect(route(BS2, 'foot', KDF_ASSEMBLY, TOWN_CENTER)).toBe(27);
    expect(turns(BS2, 'foot', KDF_ASSEMBLY, TOWN_CENTER)).toBe(3);
  });

  it('two gates, not one: blocking either alone still routes at 27 tiles, blocking both seals to 36', () => {
    const noGateWest = withBlockedRun(BS2, 17, 17, 11, 11, '=');
    const noGateEast = withBlockedRun(BS2, 27, 27, 11, 11, '=');
    const noBoth = withBlockedRun(noGateWest, 27, 27, 11, 11, '=');
    expect(route(noGateWest, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(27);
    expect(route(noGateEast, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(27);
    expect(route(noBoth, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(36);
    // Control: the base has no wall at x=11 at all, so it is unaffected by
    // any of these edits.
    expect(route(BASE, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(27);
  });

  it('the west_approach hold zone is not sealed by the wall -- the player spawn side stays open ground', () => {
    // west_approach is [0,8,17,32] (x0-16,y8-39); the wall sits at x=11,
    // WITHIN the zone, with the player's own starting_force at x2-6 -- all
    // west of it, so hold_for is satisfiable regardless of the wall.
    const wa = BS2.zones?.west_approach;
    if (!wa) throw new Error('no west_approach zone');
    for (const [x, y] of [
      [4, 20], // apc_eitan
      [3, 26], // ifv_namer
      [6, 21], // inf_squad
      [5, 24], // at_team
      [2, 23], // mortar_team
      [6, 25], // yahalom_squad
      [2, 20], // camp
      [3, 21], // camp
    ]) {
      expect(x, `(${x},${y}) inside west_approach`).toBeGreaterThanOrEqual(wa[0]);
      expect(x).toBeLessThan(wa[0] + wa[2]);
      expect(BS2.rows[y][x], `(${x},${y}) is not open ground`).not.toMatch(/[=#hwasm]/);
    }
  });

  it('bs_tn_west stays clear: vent, mouth and waypoints are all open ground, west of the wall', () => {
    for (const [x, y] of [
      [7, 22], // vent
      [30, 22], // mouth
      [24, 22], // waypoint
      [18, 22], // waypoint
    ]) {
      expect(BS2.rows[y][x], `(${x},${y}) blocked`).not.toMatch(/[=#hwasm]/);
    }
  });
});

describe('beit_sahwan_3 (the town, contested): the clinic wall is real, the two named entries are not', () => {
  it('the two headline legs are unchanged in length AND shape -- the rubble sits off both axes', () => {
    expect(route(BASE, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(27);
    expect(route(BS3, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(27);
    expect(turns(BS3, 'vehicle', KDF_ASSEMBLY, TOWN_CENTER)).toBe(1);
    expect(route(BASE, 'vehicle', KDF_ASSEMBLY, BS_HVT_ATGM)).toBe(34);
    expect(route(BS3, 'vehicle', KDF_ASSEMBLY, BS_HVT_ATGM)).toBe(34);
    expect(turns(BS3, 'vehicle', KDF_ASSEMBLY, BS_HVT_ATGM)).toBe(1);
  });

  it('the northern rr spur is a genuine local closure to vehicles: 5 -> 7 tiles crossing it', () => {
    expect(route(BASE, 'vehicle', [29, 15], [34, 15])).toBe(5);
    expect(route(BS3, 'vehicle', [29, 15], [34, 15])).toBe(7);
  });

  it('the southern vertical road is a genuine local closure to vehicles: 9 -> 10 tiles crossing it', () => {
    expect(route(BASE, 'vehicle', [20, 30], [29, 30])).toBe(9);
    expect(route(BS3, 'vehicle', [20, 30], [29, 30])).toBe(10);
  });

  it('the clinic wall is the variant\'s real barrier: 9 -> 13 tiles round it, where the base only detours the building', () => {
    expect(route(BASE, 'vehicle', [28, 25], [35, 25])).toBe(9);
    expect(route(BS3, 'vehicle', [28, 25], [35, 25])).toBe(13);
  });

  it('the wall does not block sight (low_profile) -- the ring is a movement barrier only, not a fresh blind spot', () => {
    expect(sees(BASE, [29, 20], [29, 30])).toBe(true);
    expect(sees(BS3, [29, 20], [29, 30])).toBe(true);
  });

  it('the gap sits exactly on bs_cell_centre\'s own spawn tile (29,25) -- the militia stays "in the open", per the shipped plan\'s own comment', () => {
    expect(BS3.rows[25][29]).toBe('2');
    expect(sees(BS3, [27, 25], [29, 25])).toBe(true);
  });

  it('every tunnel mouth, waypoint and vent stays open ground', () => {
    for (const [x, y] of [
      [30, 22], [24, 22], [18, 22], [7, 22], // bs_tn_west
      [27, 13], [29, 15], [32, 17], // bs_tn_north
      [22, 29], [24, 27], [26, 24], // bs_tn_souk
      [35, 26], [31, 21], // bs_tn_clinic mouth/vent (waypoint [33,23] is
      // deliberately inside the new wall ring -- see the comment below)
    ]) {
      expect(BS3.rows[y][x], `(${x},${y}) blocked`).not.toMatch(/[=#hwasm]/);
    }
    // bs_tn_clinic's own waypoint (33,23) sits inside the new wall ring on
    // purpose: `sim.ts`'s own chargeTunnel comment says the retarget-to-
    // nearest-open-tile path exists precisely to "rescue... a route venting
    // inside a walled compound", and CHARGE_RANGE_SQ is 2 tiles, so a team
    // approaching from the open ground at (33,22) -- one tile outside the
    // wall -- is already in range without ever needing to stand on it.
    expect(BS3.rows[23][33]).toBe('=');
  });

  it('the three civilian groups keep their foot route to civ_refuge within 2 tiles of the base', () => {
    const legs: Pt[] = [
      [28, 14], // group 0
      [31, 22], // group 1
      [27, 35], // group 2
    ];
    for (const from of legs) {
      const baseRoute = route(BASE, 'foot', from, CIV_REFUGE);
      const variantRoute = route(BS3, 'foot', from, CIV_REFUGE);
      if (baseRoute === null || variantRoute === null) throw new Error(`no route from ${JSON.stringify(from)}`);
      expect(Math.abs(variantRoute - baseRoute)).toBeLessThanOrEqual(2);
    }
  });
});

describe('beit_sahwan_4 (the town after): one road down, real to vehicles, free to foot', () => {
  it('vehicle start -> shaft_head: 21 tiles unchanged, 0 -> 3 direction changes', () => {
    expect(route(BASE, 'vehicle', BS4_START, SHAFT_HEAD)).toBe(21);
    expect(turns(BASE, 'vehicle', BS4_START, SHAFT_HEAD)).toBe(0);
    expect(route(BS4, 'vehicle', BS4_START, SHAFT_HEAD)).toBe(21);
    expect(turns(BS4, 'vehicle', BS4_START, SHAFT_HEAD)).toBe(3);
  });

  it('foot start -> shaft_head: completely unaffected -- b is free to boots by construction', () => {
    expect(route(BS4, 'foot', BS4_START, SHAFT_HEAD)).toBe(21);
    expect(turns(BS4, 'foot', BS4_START, SHAFT_HEAD)).toBe(0);
    expect(route(BS4, 'foot', BS4_START, SHAFT_HEAD)).toBe(route(BASE, 'foot', BS4_START, SHAFT_HEAD));
  });

  it('the road-down band seals cleanly only against a vehicle -- a foot crossing straight through it is untouched', () => {
    expect(route(BASE, 'vehicle', [24, 25], [24, 26])).toBe(1);
    expect(route(BS4, 'vehicle', [24, 25], [24, 26])).toBeNull();
    expect(route(BS4, 'foot', [24, 25], [24, 26])).toBe(1);
  });

  it('every tunnel mouth, waypoint and vent stays open ground (bs_tn_souk\'s vent (26,24) is `b` -- open to foot, which is who surfaces there)', () => {
    for (const [x, y] of [
      [30, 22], [24, 22], [18, 22], [7, 22], // bs_tn_west
      [27, 13], [29, 15], [32, 17], // bs_tn_north
      [22, 29], [24, 27], // bs_tn_souk mouth/waypoint
      [35, 26], [33, 23], [31, 21], // bs_tn_clinic
    ]) {
      expect(BS4.rows[y][x], `(${x},${y}) should not be a hard block`).not.toMatch(/[=#hwasm^]/);
    }
    expect(BS4.rows[24][26]).toBe('b'); // bs_tn_souk's vent -- vehicle-blocked, foot-open
  });

  it('the four garrison/civilian points inside the changed sector keep their tiles open', () => {
    // bs4_charge_crossroads (25.5,25.5) and bs_ambush_market_lane (27.5,24.5)
    // both sit inside the widened road-down band -- foot units, unaffected.
    expect(BS4.rows[25][25]).toBe('b');
    expect(BS4.rows[24][27]).toBe('b');
  });

  it('all three civilian/hostage groups keep an identical foot route to civ_collection', () => {
    const legs: Pt[] = [
      [28, 14], // group 0
      [24, 33], // group 1
      [24, 14], // hostages
    ];
    for (const from of legs) {
      expect(route(BS4, 'foot', from, CIV_COLLECTION)).toBe(route(BASE, 'foot', from, CIV_COLLECTION));
    }
  });
});
