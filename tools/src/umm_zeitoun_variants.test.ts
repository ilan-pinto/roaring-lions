// Umm Zeitoun's two per-mission map variants, as assertions.
//
// `docs/campaign/map-variants-design.md` §3.4 authors `umm_zeitoun_3`
// (between the horns, clearance) and `umm_zeitoun_4` (the shelf, clearance)
// as separate files derived from the base `umm_zeitoun.json` -- Option A of
// that document, the same pattern `tel_marum_variants.test.ts`,
// `beit_sahwan_variants.test.ts` and `wadi_halam_variants.test.ts` pin for
// their towns. Missions I (`umm_zeitoun_1_recon`) and II
// (`umm_zeitoun_2_buildup`) stay on the base by design -- the design's own
// words: "Umm Zeitoun is the exemplar and needs the least work", and I's own
// briefing states the thing a variant would contradict ("no wall across it,
// no gate to force, crossable anywhere on its width").
//
// Every route is walked off the real `FlowField` with `sim.blocked`/
// `sim.blockedVehicle` and the real elevation grid (unchanged by either
// variant -- neither touches the `elevation` grid at all, only `rows`);
// every sight claim is a `sim.debugDetection` after 12 simulated seconds,
// matching `umm_zeitoun_doctrine.test.ts`'s own `sees()` exactly (no
// structure registration needed: unlike Beit Sahwan's `wall`/`low_profile`,
// nothing on this map's sight table depends on a structure type, only on
// `blocked` and elevation, both of which `applyTerrain` alone sets).
//
// One correction to the design document, found by measuring rather than by
// reading (dated note added to the design doc itself, 2026-09-06):
//
//   §3.4's `umm_zeitoun_3` estimates "+0 to +2 tiles either arm; shape 5
//   columns -> 8" from its `o` orchard and `2` cover additions. Measured: the
//   change is exactly zero, on every leg this file can reach, including the
//   two headline horn legs and the hamlet route. The reason is mechanical
//   and already on record twice in this tree before this file: `o` grove and
//   cover levels 1-3 are not members of `blocked`/`blockedVehicle` at all --
//   `packages/data/src/map.ts`'s `TERRAIN_LEGEND` marks grove and cover
//   `stopsFoot: false, stopsVehicle: false` -- so `FlowField.compute` prices
//   them at the same cost as open ground and the shortest-path SET does not
//   move, which is CLAUDE.md's own "cover changes no route" finding
//   (`tools/src/qarn_hadid_relief.test.ts`'s Tel Marum measurement)
//   reproduced on a third map. `umm_zeitoun_3`'s two blocks are real ground
//   all the same -- they hand the two split halves of the force a covered
//   line for the FIGHT the mission's own briefing describes ("the split is
//   already the mission's decision; this gives each half of the split its
//   own covered line rather than the same open floor twice") -- but they do
//   not, and by construction cannot, bend the MARCH. Pinned here as the
//   measured byte-identical route set, not the estimate.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];

const BASE = maps.umm_zeitoun as unknown as MapJson;
const UZ3 = maps.umm_zeitoun_3 as unknown as MapJson;
const UZ4 = maps.umm_zeitoun_4 as unknown as MapJson;
const VARIANTS: readonly (readonly [string, MapJson])[] = [
  ['umm_zeitoun_3', UZ3],
  ['umm_zeitoun_4', UZ4],
];

/** Sight far past anything on this map -- matches
 *  `umm_zeitoun_doctrine.test.ts`'s own OBSERVER exactly. */
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

function zone(json: MapJson, name: string): [number, number, number, number] {
  const raw = json.zones?.[name];
  if (!raw || raw.length < 4) throw new Error(`map has no "${name}" zone`);
  return [raw[0], raw[1], raw[2], raw[3]];
}

/** Shortest route in tiles, walked off the real `FlowField`. `null` means the
 *  mask offers no route at all -- mirrors every other town's own `route()`. */
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
 *  `turns`/`columns` below, matching `beit_sahwan_variants.test.ts`'s
 *  `path()`. */
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

/** Number of direction changes along the shortest route. */
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

/** Distinct x-columns the shortest route touches. */
function columns(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): number {
  return new Set(path(json, domain, from, to).map((p) => p[0])).size;
}

/** Real sim, real sight -- matches `umm_zeitoun_doctrine.test.ts`'s own
 *  `sees()` exactly (48-tile sight unless a roster figure is passed). */
function sees(json: MapJson, a: Pt, b: Pt, sight = 48): boolean {
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const tw = sim.addUnitType({ ...OBSERVER, id: 't_watch', sensors: { optics: 1, sight_tiles: sight, signature: 0.6 } });
  const tt = sim.addUnitType({ ...OBSERVER, id: 't_target' });
  const w = sim.spawn(tw, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const t = sim.spawn(tt, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  const detection = sim.debugDetection(w, t);
  if (!detection) throw new Error(`no detection record between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  return detection.visible;
}

/** Overwrite a rectangular run of tiles -- the "seal the gap" control, in the
 *  idiom of every other town's `withBlockedRun()`. */
function withBlockedRun(json: MapJson, y0: number, y1: number, x0: number, x1: number, ch: string): MapJson {
  const rows = json.rows.slice();
  for (let y = y0; y <= y1; y++) {
    const chars = rows[y].split('');
    for (let x = x0; x <= x1; x++) chars[x] = ch;
    rows[y] = chars.join('');
  }
  return { ...json, rows };
}

function tally(json: MapJson, name: string): Record<string, number> {
  const [x, y, w, h] = zone(json, name);
  const out: Record<string, number> = {};
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      const t = json.rows[j][i];
      out[t] = (out[t] ?? 0) + 1;
    }
  return out;
}

// Umm Zeitoun's landmark set (docs/campaign/map-variants-design.md §4.2):
// `stockpile`, `crest_top`, `post_stone` and the `hamlet` structures.
const LANDMARK_ZONES = ['stockpile', 'crest_top', 'post_stone', 'hamlet'] as const;

// Pulled off the base map's own markers rather than hardcoded.
const RIM_CREST = marker(BASE, 'rim_crest');
const KDF_START = marker(BASE, 'kdf_start');
const HORN_WEST = marker(BASE, 'horn_west');
const HORN_EAST = marker(BASE, 'horn_east');
const HAMLET_SQUARE = marker(BASE, 'hamlet_square');
const LANE_CENTRE = marker(BASE, 'lane_centre');
const LANE_WEST = marker(BASE, 'lane_west');
const LANE_EAST = marker(BASE, 'lane_east');
const CIV_REFUGE = marker(BASE, 'civ_refuge');
const CIV_NORTH = marker(BASE, 'civ_north');
const STOCKPILE_YARD = marker(BASE, 'stockpile_yard');
const CREST = marker(BASE, 'crest');
const CREST_REVERSE = marker(BASE, 'crest_reverse');
const NORTH_GATE = marker(BASE, 'north_gate');
const UZ_EYE_DEPOT: Pt = [31, 12]; // uz_hvt/garrison position, umm_zeitoun_4_clearance.json

// ---------------------------------------------------------------------------

describe('shared landmarks — the drift guard, and the reason Option A is safe', () => {
  it.each(VARIANTS)('%s: markers deep-equal the base at the same coordinates, none added', (_id, json) => {
    for (const [name, pos] of Object.entries(BASE.markers ?? {})) {
      expect(json.markers?.[name], `missing marker "${name}"`).toEqual(pos);
    }
    const added = Object.keys(json.markers ?? {}).filter((k) => !(k in (BASE.markers ?? {})));
    expect(added).toEqual([]);
  });

  it.each(VARIANTS)('%s: zones are copied whole -- no zone moved, dropped or resized', (_id, json) => {
    expect(json.zones).toEqual(BASE.zones);
  });

  it.each(VARIANTS)('%s: the elevation grid is untouched -- neither variant edits relief, only rows', (_id, json) => {
    expect(json.elevation).toEqual(BASE.elevation);
  });

  it.each(VARIANTS)('%s: no tunnels exist on the base and none were added', (_id, json) => {
    expect(json.tunnels).toEqual(BASE.tunnels);
    expect(json.tunnels).toBeUndefined();
  });

  it.each(VARIANTS)('%s: still a 48x48 frame', (_id, json) => {
    expect(json.width).toBe(48);
    expect(json.height).toBe(48);
    expect(json.rows).toHaveLength(48);
    json.rows.forEach((r) => expect(r).toHaveLength(48));
  });

  it.each(VARIANTS)('%s: every tile is a legal terrain symbol', (_id, json) => {
    const allowed = new Set('.123ronbd^=#hwasmc'.split(''));
    for (const row of json.rows) for (const ch of row) expect(allowed.has(ch), `illegal symbol "${ch}"`).toBe(true);
  });

  it.each(VARIANTS)('%s: the four landmark zones (stockpile, crest_top, post_stone, hamlet) are byte-identical to the base', (_id, json) => {
    for (const name of LANDMARK_ZONES) {
      expect(tally(json, name), name).toEqual(tally(BASE, name));
      const [x, y, w, h] = zone(json, name);
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) expect(json.rows[j][i], `${name} (${i},${j})`).toBe(BASE.rows[j][i]);
    }
  });

  it.each(VARIANTS)('%s: sits every one of the base map’s 25 markers on passable ground', (_id, json) => {
    const { map } = load(json);
    for (const name of Object.keys(BASE.markers ?? {})) {
      const [x, y] = marker(json, name);
      expect(map.blocked[y * map.width + x], `${name} at (${x},${y})`).toBe(0);
    }
  });
});

// The base's own split-routing facts, re-measured on every variant: the
// basin's structural signature must survive both, since neither touches the
// scree (west horn, x=6-15) or the ditch (y=31).
describe('the base split-routing facts hold on every variant', () => {
  it.each(VARIANTS)('%s: the west horn still has no vehicle route (the scree), foot still 18', (_id, json) => {
    expect(route(json, 'vehicle', RIM_CREST, HORN_WEST)).toBeNull();
    expect(route(json, 'foot', RIM_CREST, HORN_WEST)).toBe(18);
  });

  it.each(VARIANTS)('%s: the east horn is 18 tiles for both domains, unchanged', (_id, json) => {
    expect(route(json, 'vehicle', RIM_CREST, HORN_EAST)).toBe(18);
    expect(route(json, 'foot', RIM_CREST, HORN_EAST)).toBe(18);
  });

  it.each(VARIANTS)('%s: the anti-tank ditch still costs armour exactly +4 tiles into the hamlet, foot nothing', (_id, json) => {
    expect(route(json, 'foot', RIM_CREST, HAMLET_SQUARE)).toBe(15);
    expect(route(json, 'vehicle', RIM_CREST, HAMLET_SQUARE)).toBe(19);
  });
});

describe('umm_zeitoun_3 (Between the Horns): the orchard/cover blocks change the fight, not the march', () => {
  // CORRECTED against the design's own "+0 to +2 tiles; shape 5 -> 8"
  // estimate -- see the header note. `o` and cover levels are not members of
  // `blocked`/`blockedVehicle`, so every leg below is measured
  // BYTE-IDENTICAL, path included, not merely equal in length.
  const LEGS: [string, Pt, string, Pt][] = [
    ['rim_crest', RIM_CREST, 'horn_west', HORN_WEST],
    ['rim_crest', RIM_CREST, 'horn_east', HORN_EAST],
    ['rim_crest', RIM_CREST, 'hamlet_square', HAMLET_SQUARE],
    ['hamlet_square', HAMLET_SQUARE, 'civ_refuge', CIV_REFUGE],
  ];

  it('every leg is unchanged in length, turns and columns, both domains', () => {
    for (const [an, a, bn, b] of LEGS) {
      for (const dom of ['foot', 'vehicle'] as const) {
        expect(route(UZ3, dom, a, b), `${an}->${bn} ${dom} length`).toBe(route(BASE, dom, a, b));
        expect(turns(UZ3, dom, a, b), `${an}->${bn} ${dom} turns`).toBe(turns(BASE, dom, a, b));
        expect(columns(UZ3, dom, a, b), `${an}->${bn} ${dom} columns`).toBe(columns(BASE, dom, a, b));
      }
    }
  });

  it('every leg is byte-identical path, not merely equal length (the strong form of "no route bend")', () => {
    for (const [an, a, bn, b] of LEGS) {
      for (const dom of ['foot', 'vehicle'] as const) {
        expect(path(UZ3, dom, a, b), `${an}->${bn} ${dom}`).toEqual(path(BASE, dom, a, b));
      }
    }
  });

  it('the west orchard (15-18, 25-28) is open ground, one column clear of the hamlet’s western edge at x=19', () => {
    for (let y = 25; y <= 28; y++) for (let x = 15; x <= 18; x++) expect(UZ3.rows[y][x]).toBe('o');
    const [hx] = zone(UZ3, 'hamlet');
    expect(hx).toBe(19);
    for (let y = 25; y <= 28; y++) expect(UZ3.rows[y][19]).not.toBe('o');
  });

  it('the east orchard (30-34, 25-28) and the east-glacis cover (33-36, 18-19) are placed as specified', () => {
    for (let y = 25; y <= 28; y++) for (let x = 30; x <= 34; x++) expect(UZ3.rows[y][x]).toBe('o');
    for (let y = 18; y <= 19; y++) for (let x = 33; x <= 36; x++) expect(UZ3.rows[y][x]).toBe('2');
  });

  it('lane_east sits inside the east orchard’s footprint and stays open regardless -- `o` blocks nothing', () => {
    // (33,27) is inside both the orchard rectangle and the lane_east marker's
    // own tile. Harmless by construction: `o` is not a member of `blocked` or
    // `blockedVehicle`, so a marker sitting inside it is not the TM-1 hazard
    // (a BLOCKING symbol under a live spawn) -- confirmed here rather than
    // assumed.
    expect(LANE_EAST).toEqual([33, 27]);
    expect(UZ3.rows[27][33]).toBe('o');
    const { map } = load(UZ3);
    expect(map.blocked[27 * map.width + 33]).toBe(0);
  });

  it('every open-ground garrison tile the mission fields stays open', () => {
    // hamlet_garrison's two riflemen deliberately sit INSIDE a house
    // (`stance: { kind: "garrison", building: [20,24] / [26,27] }` --
    // `the_house_was_the_section` walks them into the street on
    // `zone_entered`) and are excluded here on purpose; the "landmark
    // zones... byte-identical" test above already proves the hamlet's own
    // tiles (theirs included) are untouched by this variant.
    for (const [x, y] of [
      [10, 23], // uz_eye_west
      [37, 23], // uz_eye_east
      [23, 33], // uz_eye_knoll
      [30, 22], // uz_manpad_basin
      [34, 20], // uz_atgm_glacis
      [17, 19], // uz_atgm_lateral
      [25, 27], // uz_rcl_hamlet
      [13, 6], // uz_hvt_lantern
    ]) {
      expect(UZ3.rows[y][x], `garrison tile (${x},${y}) blocked`).not.toMatch(/[\^#=hwasmc]/);
    }
  });

  it('both civilian groups keep an identical foot route to civ_refuge -- the orchards sit north of them, `o` never blocks foot', () => {
    const hamletNorth: Pt = [22, 26]; // civilians.groups[0].at [22.5,26.5]
    const hamletSouth: Pt = [21, 28]; // civilians.groups[1].at [21.5,28.5]
    for (const from of [hamletNorth, hamletSouth]) {
      expect(route(UZ3, 'foot', from, CIV_REFUGE)).toBe(route(BASE, 'foot', from, CIV_REFUGE));
    }
    expect(route(UZ3, 'foot', hamletNorth, CIV_REFUGE)).toBe(11);
    expect(route(UZ3, 'foot', hamletSouth, CIV_REFUGE)).toBe(9);
  });

  it('sight facts the briefing claims are unaffected: the hamlet warren, and each horn’s own lane (sarim_rifles, sight 9)', () => {
    const obs: Pt = [22, 26];
    expect(sees(UZ3, obs, CIV_REFUGE)).toBe(false);
    expect(sees(UZ3, obs, LANE_WEST)).toBe(false);
    expect(sees(UZ3, obs, marker(UZ3, 'rim_crest'))).toBe(false);
    expect(sees(UZ3, obs, marker(UZ3, 'knoll_stone'))).toBe(true);
    expect(sees(UZ3, obs, HAMLET_SQUARE)).toBe(true);
    expect(sees(UZ3, HORN_WEST, LANE_WEST, 9)).toBe(true);
    expect(sees(UZ3, HORN_WEST, LANE_EAST, 9)).toBe(false);
    expect(sees(UZ3, HORN_EAST, LANE_EAST, 9)).toBe(true);
    expect(sees(UZ3, HORN_EAST, LANE_WEST, 9)).toBe(false);
  });
});

describe('umm_zeitoun_4 (The Shelf): the north-track ditch and the porters’ spoil gate armour, not boots', () => {
  it('vehicle lane_centre -> stockpile_yard: 13 -> 19 tiles, foot unchanged at 13', () => {
    expect(route(BASE, 'vehicle', LANE_CENTRE, STOCKPILE_YARD)).toBe(13);
    expect(route(UZ4, 'vehicle', LANE_CENTRE, STOCKPILE_YARD)).toBe(19);
    expect(route(BASE, 'foot', LANE_CENTRE, STOCKPILE_YARD)).toBe(13);
    expect(route(UZ4, 'foot', LANE_CENTRE, STOCKPILE_YARD)).toBe(13);
  });

  it('vehicle kdf_start -> stockpile_yard: 38 -> 41 tiles (9 -> 10 turns, 10 -> 13 columns), foot unchanged at 38', () => {
    expect(route(BASE, 'vehicle', KDF_START, STOCKPILE_YARD)).toBe(38);
    expect(route(UZ4, 'vehicle', KDF_START, STOCKPILE_YARD)).toBe(41);
    expect(turns(BASE, 'vehicle', KDF_START, STOCKPILE_YARD)).toBe(9);
    expect(turns(UZ4, 'vehicle', KDF_START, STOCKPILE_YARD)).toBe(10);
    expect(columns(BASE, 'vehicle', KDF_START, STOCKPILE_YARD)).toBe(10);
    expect(columns(UZ4, 'vehicle', KDF_START, STOCKPILE_YARD)).toBe(13);
    expect(route(BASE, 'foot', KDF_START, STOCKPILE_YARD)).toBe(38);
    expect(route(UZ4, 'foot', KDF_START, STOCKPILE_YARD)).toBe(38);
  });

  it('vehicle lane_centre -> crest: 16 -> 21 tiles, foot unchanged at 16', () => {
    expect(route(BASE, 'vehicle', LANE_CENTRE, CREST)).toBe(16);
    expect(route(UZ4, 'vehicle', LANE_CENTRE, CREST)).toBe(21);
    expect(route(BASE, 'foot', LANE_CENTRE, CREST)).toBe(16);
    expect(route(UZ4, 'foot', LANE_CENTRE, CREST)).toBe(16);
  });

  it('neither edit alone moves the headline leg -- only the ditch AND the spoil together gate armour', () => {
    // The ditch (y=11, x17-27, gapped at the road x=24) sits off the base
    // route's own column (the route runs through x=31 at y=11, per the base
    // path) and buys nothing alone. The spoil (28-35, 10-11) sits ON it
    // (the base route crosses (32,10) and (32,9) directly) and is what
    // forces the detour; combined with the ditch the detour is longer still
    // (13->17 spoil alone, 13->19 both), because the ditch closes the
    // shortcut back down through x17-27 that the spoil-only detour would
    // otherwise use.
    const ditchOnly = withBlockedRun(withBlockedRun(BASE, 11, 11, 17, 23, 'd'), 11, 11, 25, 27, 'd');
    const spoilOnly = withBlockedRun(BASE, 10, 11, 28, 35, 'b');
    expect(route(ditchOnly, 'vehicle', LANE_CENTRE, STOCKPILE_YARD)).toBe(13);
    expect(route(spoilOnly, 'vehicle', LANE_CENTRE, STOCKPILE_YARD)).toBe(17);
    expect(route(UZ4, 'vehicle', LANE_CENTRE, STOCKPILE_YARD)).toBe(19);
  });

  it('two routes, not one chokepoint: sealing the road gap at x=24 still leaves a finite (longer) vehicle route', () => {
    // The map's own open west flank (x=8-11, never touched by this variant)
    // is the second route the design's grammar (§2.4 rule 2) requires --
    // this basin has no flanking `^` wall the way Tel Marum does, so a single
    // named gate is never a true chokepoint here.
    const sealed = withBlockedRun(UZ4, 11, 11, 24, 24, 'd');
    expect(route(sealed, 'vehicle', LANE_CENTRE, STOCKPILE_YARD)).toBe(20);
    expect(route(sealed, 'vehicle', KDF_START, STOCKPILE_YARD)).toBe(41);
    // Control: the base has no obstacle here at all, so sealing the same
    // tile on it is a no-op on the field's OTHER tiles but still routes.
    const baseSealed = withBlockedRun(BASE, 11, 11, 24, 24, 'd');
    expect(route(baseSealed, 'vehicle', LANE_CENTRE, STOCKPILE_YARD)).not.toBeNull();
  });

  it('the porters’ foot route to civ_north is untouched -- the cut sits south of their spawn, not across their line', () => {
    const porters: Pt = [29, 9]; // civilians.groups[0].at [29.5,9.5]
    expect(route(UZ4, 'foot', porters, CIV_NORTH)).toBe(route(BASE, 'foot', porters, CIV_NORTH));
    expect(route(UZ4, 'foot', porters, CIV_NORTH)).toBe(6);
  });

  it('the north-track cut (y=11, x17-27) and the porters’ spoil (28-35, y10-11) are placed as specified, gapped at the road', () => {
    for (let x = 17; x <= 27; x++) {
      if (x === 24) expect(UZ4.rows[11][x], `(${x},11) should be the road gap`).toBe('r');
      else expect(UZ4.rows[11][x], `(${x},11)`).toBe('d');
    }
    for (let y = 10; y <= 11; y++) for (let x = 28; x <= 35; x++) expect(UZ4.rows[y][x]).toBe('b');
  });

  it('the crest’s knoll cap is extended north at y=3, x10-18, clear of crest_top', () => {
    for (let x = 10; x <= 18; x++) expect(UZ4.rows[3][x]).toBe('n');
    const [, cy] = zone(UZ4, 'crest_top');
    expect(cy).toBe(5); // one row south of the edit -- no overlap
  });

  it('every open-ground garrison tile the mission fields stays open, uz_rcl_depot (inside the spoil footprint) included', () => {
    // uz_wh_garrison deliberately sits INSIDE the warehouse
    // (`stance: { kind: "garrison", building: [30,6] }`) and is excluded
    // here on purpose -- the "landmark zones... byte-identical" test above
    // already proves `stockpile`'s own tiles are untouched by this variant.
    for (const [x, y] of [
      [13, 6], // uz_hvt_lantern
      [15, 5], // uz_lantern_guard
      [14, 7], // uz_eye_crest
      [31, 12], // uz_eye_depot
      [20, 12], // uz_manpad_north
      [27, 10], // uz_atgm_north
    ]) {
      expect(UZ4.rows[y][x], `garrison tile (${x},${y}) blocked`).not.toMatch(/[\^#=hwasmc]/);
    }
    // uz_rcl_depot [33.5,10.5] sits inside the new spoil block on purpose --
    // `recoilless_team`'s role is `at_team`, one of `FOOT_ROLES`
    // (`packages/sim/src/sim.ts`), so it defaults to foot and `b` never
    // blocks it. Confirmed against the real mask, not merely the regex,
    // since the regex above does not even list `b`/`d`.
    expect(UZ4.rows[10][33]).toBe('b');
    const { map } = load(UZ4);
    expect(map.blocked[10 * map.width + 33]).toBe(0);
  });

  it('sight facts the briefing claims are unaffected: the depot eye still sees the yard, the crest relay still watches only its own two ways up', () => {
    expect(sees(UZ4, UZ_EYE_DEPOT, STOCKPILE_YARD)).toBe(true);
    expect(sees(BASE, UZ_EYE_DEPOT, STOCKPILE_YARD)).toBe(true);
    expect(sees(UZ4, CREST, NORTH_GATE, 9)).toBe(true);
    expect(sees(UZ4, CREST, CREST_REVERSE, 9)).toBe(true);
    expect(sees(UZ4, CREST, STOCKPILE_YARD, 9)).toBe(false);
  });
});
