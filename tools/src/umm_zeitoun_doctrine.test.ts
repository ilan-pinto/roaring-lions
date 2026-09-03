// Umm Zeitoun's basin doctrine, as assertions.
//
// Tel Marum is a pass: one axis, a rock wall, two saddles -- the puzzle is
// forcing a gap. Umm Zeitoun is a basin: no wall, no gate, crossable
// everywhere -- the puzzle is choosing which hill to pay for, because being
// SEEN is what prices the ground here, not a chokepoint. Four enemy posts and
// two MANPAD teams watch four hills; the staging bowl behind the watershed
// rim is dead ground precisely because nothing on the map can see into it.
//
// Every claim below is driven through the real `Sim`, `FlowField` and
// `parseMap`, in the idiom of `tools/src/tel_marum_doctrine.test.ts` and
// `tools/src/qarn_hadid_relief.test.ts`: every negative is paired with a
// positive on the same geometry, and every route is paired with a CONTROL
// built from the same map with one thing removed (the scree turned to open
// ground, the ditch filled in) so "the vehicle went round" cannot pass for
// the wrong reason.
//
// This file pins `docs/campaign/tel_marum/design.md` §4.4 (markers, zones,
// sight claims) and §4.5 (routes per domain). The design document states its
// own method: every `sees()` call is `sim.debugDetection` after 12 simulated
// seconds, and every route walks `FlowField.compute` over `sim.blocked` or
// `sim.blockedVehicle` with the elevation grid, so slope is priced -- the
// same method this file uses. Re-driving that method against the shipped
// grid reproduced every one of the design's claims exactly, with three
// exceptions, all found by running the design's own stated method rather than
// by re-deriving a different one:
//
//   1. §4.4 B: `horn_west` to `lane_east` is stated as 27.0 tiles; the real
//      distance between those two markers is 23.3 (sqrt(23^2 + 4^2)). Both
//      readings are "out of sight" at `sarim_rifles`' 9-tile sight, so the
//      boolean claim is untouched -- this is a transcription error in the
//      prose, not a geometry problem. Its mirror, `horn_east` to `lane_west`
//      at 23.5, checks out exactly. Pinned here at the MEASURED 23.3.
//
//   2. §4.4 D: the design states an observer at `[22,26]` (open ground,
//      inside the hamlet zone) is BLIND to `hamlet_square` at 2.0 tiles.
//      Measured: it SEES `hamlet_square` (the distance of 2.0 is exactly
//      right; the visibility verdict is not). The two points sit on the same
//      open lane -- row 26 runs `.` from x=15 to x=23 then `r` (a road tile,
//      `hamlet_square` itself) at x=24, with no structure or ridge tile
//      anywhere between them -- so there is nothing in this grid that could
//      block that ray. The other three negatives in the same table
//      (`civ_refuge` 11.0, `lane_west` 8.2, `rim_crest` 15.1, all genuinely
//      blind) and the one other positive (`knoll_stone` 7.1, genuinely seen)
//      are unaffected and still support the section's thesis -- an observer
//      inside the hamlet cannot see most of the map, just not literally
//      everything two tiles up its own street. Pinned here as SEES.
//
//   3. §4.4 G: the design states the enemy post at `knoll_stone` (4.1 tiles
//      from a KDF mortar tube sited in the wadi at `[24,37]`) cannot see that
//      tube. Measured: it CAN. Hand-derivation, since this is exactly the
//      kind of claim a ray drawn by eye gets wrong (the tel_marum file's own
//      opening line): `knoll_stone` sits at elevation 3, so
//      h0 = 3 + EYE_HEIGHT(1) = 4; the tube tile sits at elevation 1, so
//      h1 = 1 + 1 = 2; total = 4 (dx=1, dy=4, y-major). `losRay`'s line
//      height at step k is `h0*total + (h1-h0)*k` = `16 - 2k`. The three
//      tiles the Bresenham walk actually crosses are (23,34) elevation 2,
//      (23,35) elevation 2 and (24,36) elevation 1 -- none of them `blocked`,
//      so each contributes `rise = 0` and is compared as
//      `elevation*total > lineH`: `8 > 14`, `8 > 12`, `4 > 10` are all false.
//      Nothing pokes above the sightline; the ground descends monotonically
//      from the post to the tube, and high ground seeing over lower obstacles
//      is the elevation system working as designed (CLAUDE.md's elevation
//      section), not a defect in this map. The other three mortar/observer
//      pairs in the same table (`horn_west`/`horn_east` vs the mid-basin
//      tube, `crest` vs the `lane_centre` tube) are all genuinely blind and
//      still support the section's "mirror is exact" thesis for those three
//      sitings; the wadi siting specifically is not a safe one. Pinned here
//      as SEES, and this table's tube position is not one a mission should
//      site the mortar at without accounting for it.
//
// No map tile was moved to produce any of the three corrections above: in
// each case the geometry is self-consistent with the rest of the design (the
// hamlet's own street grid, the hill's own descending elevation profile), and
// what was wrong was the sentence describing it, not the grid.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, units, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];

const MAP = maps.umm_zeitoun as unknown as MapJson;

/** Sight far past anything on this map, so only terrain can hide -- the
 *  longest ray here is `kdf_start` to `stockpile_yard`, 38 tiles, inside 48. */
const OBSERVER: UnitTypeJson = {
  id: 't_observer',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 48, signature: 0.6 },
};

function watcher(sight: number): UnitTypeJson {
  return { ...OBSERVER, id: `t_watch_${sight}`, sensors: { optics: 1, sight_tiles: sight, signature: 0.6 } };
}

/** `sight` defaults to 48 (a terrain/LOS fact: "nothing solid blocks this
 *  ray"). Passing a roster sight (9 for `sarim_rifles`, 12 for `manpad_team`,
 *  16 for `recon_drone`/`sniper_team`) makes it a roster fact instead --
 *  confusing the two is what made `tm_spotter_narrow` a decorative eye on
 *  Tel Marum, and every table below says which one it is testing. */
function sees(a: Pt, b: Pt, sight = 48): boolean {
  const map = parseMap(MAP);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const tw = sim.addUnitType(watcher(sight));
  const tt = sim.addUnitType({ ...OBSERVER, id: 't_target' });
  const w = sim.spawn(tw, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const t = sim.spawn(tt, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  const detection = sim.debugDetection(w, t);
  if (!detection) throw new Error(`no detection record between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  return detection.visible;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Look up a named marker, or throw -- a missing marker should read as a
 *  named error, not a silent `undefined` destructure. */
function marker(name: string): Pt {
  const raw = MAP.markers?.[name];
  if (!raw || raw.length < 2 || raw[0] === undefined || raw[1] === undefined) {
    throw new Error(`map has no "${name}" marker`);
  }
  return [raw[0], raw[1]];
}

function zone(name: string): [number, number, number, number] {
  const raw = MAP.zones?.[name];
  if (!raw || raw.length < 4) throw new Error(`map has no "${name}" zone`);
  return [raw[0], raw[1], raw[2], raw[3]];
}

function load(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
  applyTerrain(map, sim);
  return { map, sim };
}

/** Shortest route in tiles between two open tiles for one domain, walked off
 *  the real flow field a unit would get -- slope priced in. `null` means the
 *  mask offers no route at all. */
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

/** The same map with every `b` (the west horn's scree apron) back to open
 *  ground -- the control for "the scree is what shuts armour out". */
const scree = (json: MapJson): MapJson => ({ ...json, rows: json.rows.map((r) => r.split('b').join('.')) });

/** The same map with the anti-tank ditch filled back in -- the control for
 *  "the ditch is what taxes armour into the hamlet". */
const noDitch = (json: MapJson): MapJson => ({ ...json, rows: json.rows.map((r) => r.split('d').join('.')) });

function tilesOf(name: string): string[] {
  const [x, y, w, h] = zone(name);
  const out: string[] = [];
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) out.push(MAP.rows[j][i]);
  return out;
}

function tally(tiles: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tiles) out[t] = (out[t] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------------------

describe('the map the design specifies', () => {
  it('is a 48x48 arid basin with the elevation range 0-7', () => {
    expect(MAP.width).toBe(48);
    expect(MAP.height).toBe(48);
    expect(MAP.rows).toHaveLength(48);
    expect(MAP.terrain).toBe('arid');
    expect(MAP.elevation).toBeDefined();
    expect(MAP.elevation).toHaveLength(48);
    const levels = new Set((MAP.elevation ?? []).join(''));
    expect(Math.min(...[...levels].map(Number))).toBe(0);
    expect(Math.max(...[...levels].map(Number))).toBe(7);
  });

  it('has no chokepoint: no tunnels, no mosque, no cover-3', () => {
    // §4.6: Sarim doctrine is standoff, not the Marj's spade, and this map's
    // whole structural difference from Tel Marum is that the `^` frame is a
    // boundary, not a wall -- absent means absent, never an empty array.
    expect(MAP.tunnels).toBeUndefined();
    const flat = MAP.rows.join('');
    expect(flat).not.toContain('m');
    expect(flat).not.toContain('3');
  });

  it('parses into exactly the ten structures the design audits', () => {
    const { map } = load(MAP);
    const byType = map.structures.reduce<Record<string, number>>((acc, s) => {
      acc[s.type] = (acc[s.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(map.structures).toHaveLength(10);
    expect(byType).toEqual({ warehouse: 1, concrete: 2, shanty: 4, house: 3 });
    const hpPerTile: Record<string, number> = { warehouse: 340, concrete: 700, shanty: 120, house: 260 };
    const totalHp = map.structures.reduce((acc, s) => acc + s.tiles.length * hpPerTile[s.type], 0);
    expect(totalHp).toBe(13_500);
  });

  it('sits every one of its 25 markers on passable ground', () => {
    const { map } = load(MAP);
    const names = Object.keys(MAP.markers ?? {});
    expect(names).toHaveLength(25);
    for (const name of names) {
      const [x, y] = marker(name);
      expect(map.blocked[y * map.width + x], `${name} at (${x},${y})`).toBe(0);
    }
  });

  it('keeps civ_refuge and civ_north inside their own arrival zones', () => {
    // The runtime throws if a mission's refuge marker sits outside its
    // arrival zone, so this pairing is load-bearing the moment a mission
    // reads it, not merely tidy.
    for (const [m, z] of [
      ['civ_refuge', 'refuge_wadi'],
      ['civ_north', 'north_shelf'],
    ] as const) {
      const [mx, my] = marker(m);
      const [zx, zy, zw, zh] = zone(z);
      expect(mx).toBeGreaterThanOrEqual(zx);
      expect(mx).toBeLessThan(zx + zw);
      expect(my).toBeGreaterThanOrEqual(zy);
      expect(my).toBeLessThan(zy + zh);
    }
  });
});

describe('zone contents match the design’s audit', () => {
  it('staging: 33 open + 3 road, every tile passable', () => {
    expect(tally(tilesOf('staging'))).toEqual({ '.': 33, r: 3 });
  });

  it('crest_line: 16 open, 6 knoll, 2 road, 2 cover-2', () => {
    expect(tally(tilesOf('crest_line'))).toEqual({ '.': 16, n: 6, r: 2, '2': 2 });
  });

  it('post_stone: exactly two shanty tiles, one contiguous structure', () => {
    const tiles = tally(tilesOf('post_stone'));
    expect(tiles.s).toBe(2);
    const { map } = load(MAP);
    const shantyHere = map.structures.filter((s) => s.type === 'shanty' && s.tiles.length === 2);
    expect(shantyHere.length).toBeGreaterThanOrEqual(1);
  });

  it('stockpile: warehouse x9, concrete x6, shanty x2 -- 7,500 hp', () => {
    expect(tally(tilesOf('stockpile'))).toEqual({ w: 9, '#': 6, s: 2, '.': 14, r: 4 });
    const hp = 9 * 340 + 6 * 700 + 2 * 120;
    expect(hp).toBe(7_500);
  });

  it('crest_top: two concrete tiles, one structure -- Adhal’s relay hut', () => {
    const tiles = tally(tilesOf('crest_top'));
    expect(tiles['#']).toBe(2);
    const { map } = load(MAP);
    const relay = map.structures.find((s) => s.type === 'concrete' && s.tiles.length === 2);
    expect(relay).toBeDefined();
  });

  it('hamlet: 14 house, 6 shanty, 5 road, 20 open -- the flagged zone', () => {
    expect(tally(tilesOf('hamlet'))).toEqual({ h: 14, s: 6, r: 5, '.': 20 });
  });

  it('basin_floor is a trigger region only: it contains rock, structures and the ditch', () => {
    const tiles = tally(tilesOf('basin_floor'));
    expect(tiles['^']).toBeGreaterThan(0);
    expect((tiles.h ?? 0) + (tiles.s ?? 0)).toBeGreaterThan(0);
    expect(tiles.d).toBeGreaterThan(0);
  });
});

describe('A: the staging bowl is dead ground, and the rim crest is not', () => {
  // Terrain fact (OBSERVER, sight 48): "nothing solid blocks this ray". Every
  // negative (staging, camp_ground) is paired with the same seven positives
  // from rim_crest, on the identical geometry.
  const TARGETS: [string, Pt][] = [
    ['crest', marker('crest')],
    ['horn_west', marker('horn_west')],
    ['horn_east', marker('horn_east')],
    ['knoll_stone', marker('knoll_stone')],
    ['manpad_north', marker('manpad_north')],
    ['manpad_basin', marker('manpad_basin')],
    ['battery_south', marker('battery_south')],
  ];

  it('staging and camp_ground see none of the seven', () => {
    const staging: Pt = [24, 44];
    const campGround = marker('camp_ground');
    for (const [name, t] of TARGETS) {
      expect(sees(staging, t), `staging -> ${name}`).toBe(false);
      expect(sees(campGround, t), `camp_ground -> ${name}`).toBe(false);
    }
  });

  it('rim_crest sees all seven -- the ground that must be held is the ground that can be seen', () => {
    const rimCrest = marker('rim_crest');
    for (const [name, t] of TARGETS) {
      expect(sees(rimCrest, t), `rim_crest -> ${name}`).toBe(true);
    }
  });

  it('the bowl sits inside the battery’s 20-tile envelope and is safe only because unseen', () => {
    const staging: Pt = [24, 44];
    expect(dist(staging, marker('battery_south'))).toBeCloseTo(15.2, 1);
  });
});

describe('B: each post watches its own lane (sarim_rifles, sight 9), and none watches every lane', () => {
  it('grounds the sight figure in the roster', () => {
    expect(units.sarim_rifles.sensors.sight_tiles).toBe(9);
  });

  it('horn_west sees lane_west and not lane_east', () => {
    expect(sees(marker('horn_west'), marker('lane_west'), 9)).toBe(true);
    expect(dist(marker('horn_west'), marker('lane_west'))).toBeCloseTo(6.4, 1);
    expect(sees(marker('horn_west'), marker('lane_east'), 9)).toBe(false);
    // Design states 27.0 here; measured is 23.3 (sqrt(23^2 + 4^2)). Both are
    // outside sarim_rifles' 9-tile sight either way -- see header note 1.
    expect(dist(marker('horn_west'), marker('lane_east'))).toBeCloseTo(23.3, 1);
  });

  it('horn_east sees lane_east and not lane_west', () => {
    expect(sees(marker('horn_east'), marker('lane_east'), 9)).toBe(true);
    expect(dist(marker('horn_east'), marker('lane_east'))).toBeCloseTo(5.7, 1);
    expect(sees(marker('horn_east'), marker('lane_west'), 9)).toBe(false);
    expect(dist(marker('horn_east'), marker('lane_west'))).toBeCloseTo(23.5, 1);
  });

  it('knoll_stone sees rim_crest, hamlet_square and civ_refuge, not uz_wells', () => {
    const p = marker('knoll_stone');
    expect(sees(p, marker('rim_crest'), 9)).toBe(true);
    expect(dist(p, marker('rim_crest'))).toBeCloseTo(8.1, 1);
    expect(sees(p, marker('hamlet_square'), 9)).toBe(true);
    expect(dist(p, marker('hamlet_square'))).toBeCloseTo(7.1, 1);
    expect(sees(p, marker('civ_refuge'), 9)).toBe(true);
    expect(dist(p, marker('civ_refuge'))).toBeCloseTo(4.0, 1);
    expect(sees(p, marker('uz_wells'), 9)).toBe(false);
    expect(dist(p, marker('uz_wells'))).toBeCloseTo(9.2, 1);
  });

  it('crest is a relay, not a spotter -- it watches only its own two ways up', () => {
    const p = marker('crest');
    expect(sees(p, marker('north_gate'), 9)).toBe(true);
    expect(dist(p, marker('north_gate'))).toBeCloseTo(5.8, 1);
    expect(sees(p, marker('crest_reverse'), 9)).toBe(true);
    expect(dist(p, marker('crest_reverse'))).toBeCloseTo(3.2, 1);
    expect(sees(p, marker('stockpile_yard'), 9)).toBe(false);
    expect(dist(p, marker('stockpile_yard'))).toBeCloseTo(18.0, 1);
  });
});

describe('C: the MANPAD teams are Sarim’s real spotters (sight 12), and there is no free lane', () => {
  it('grounds sight and missile range in the roster', () => {
    expect(units.manpad_team.sensors.sight_tiles).toBe(12);
    expect(units.manpad_team.weapons[0].range_tiles).toBe(13);
  });

  it('manpad_north sees north_gate and lane_centre, but not crest (its own rock collar) or stockpile_yard', () => {
    const p = marker('manpad_north');
    expect(sees(p, marker('north_gate'), 12)).toBe(true);
    expect(dist(p, marker('north_gate'))).toBeCloseTo(2.2, 1);
    expect(sees(p, marker('lane_centre'), 12)).toBe(true);
    expect(dist(p, marker('lane_centre'))).toBeCloseTo(8.9, 1);
    // Inside the 12-tile sight radius by distance alone, and still blind:
    // an LOS block, not a range miss.
    expect(sees(p, marker('crest'), 12)).toBe(false);
    expect(dist(p, marker('crest'))).toBeCloseTo(7.8, 1);
    expect(sees(p, marker('stockpile_yard'), 12)).toBe(false);
    expect(dist(p, marker('stockpile_yard'))).toBeCloseTo(13.0, 1);
  });

  it('manpad_basin sees lane_east, lane_centre and horn_east, but not hamlet_square (the houses)', () => {
    const p = marker('manpad_basin');
    expect(sees(p, marker('lane_east'), 12)).toBe(true);
    expect(dist(p, marker('lane_east'))).toBeCloseTo(5.8, 1);
    expect(sees(p, marker('lane_centre'), 12)).toBe(true);
    expect(dist(p, marker('lane_centre'))).toBeCloseTo(6.3, 1);
    expect(sees(p, marker('horn_east'), 12)).toBe(true);
    expect(dist(p, marker('horn_east'))).toBeCloseTo(7.1, 1);
    expect(sees(p, marker('hamlet_square'), 12)).toBe(false);
    expect(dist(p, marker('hamlet_square'))).toBeCloseTo(7.2, 1);
  });

  it('lane_centre is outside every rifle post’s sight 9, and both MANPADs see it', () => {
    const lc = marker('lane_centre');
    for (const post of ['horn_west', 'horn_east', 'knoll_stone', 'crest']) {
      expect(sees(marker(post), lc, 9), post).toBe(false);
    }
    expect(sees(marker('manpad_north'), lc, 12)).toBe(true);
    expect(sees(marker('manpad_basin'), lc, 12)).toBe(true);
  });
});

describe('D: the hamlet is a warren, not an observation post', () => {
  const OBS: Pt = [22, 26];

  it('stands on open ground inside the hamlet zone', () => {
    expect(MAP.rows[OBS[1]][OBS[0]]).toBe('.');
    const [zx, zy, zw, zh] = zone('hamlet');
    expect(OBS[0]).toBeGreaterThanOrEqual(zx);
    expect(OBS[0]).toBeLessThan(zx + zw);
    expect(OBS[1]).toBeGreaterThanOrEqual(zy);
    expect(OBS[1]).toBeLessThan(zy + zh);
  });

  it('is blind to civ_refuge, lane_west and rim_crest -- the houses block its own sight', () => {
    expect(sees(OBS, marker('civ_refuge'))).toBe(false);
    expect(dist(OBS, marker('civ_refuge'))).toBeCloseTo(11.0, 1);
    expect(sees(OBS, marker('lane_west'))).toBe(false);
    expect(dist(OBS, marker('lane_west'))).toBeCloseTo(8.2, 1);
    expect(sees(OBS, marker('rim_crest'))).toBe(false);
    expect(dist(OBS, marker('rim_crest'))).toBeCloseTo(15.1, 1);
  });

  it('sees knoll_stone', () => {
    expect(sees(OBS, marker('knoll_stone'))).toBe(true);
    expect(dist(OBS, marker('knoll_stone'))).toBeCloseTo(7.1, 1);
  });

  it('CORRECTED: also sees hamlet_square, two tiles up the same open lane', () => {
    // The design states this pair is blind. Measured: it is not. Row 26 runs
    // open ground and then a road tile (hamlet_square itself) with no
    // structure or ridge anywhere between (22,26) and (24,26) -- see header
    // note 2. This does not undermine "you cannot solve the hamlet from
    // outside": the three genuinely-blind negatives above still stand.
    expect(MAP.rows[26].slice(22, 25)).toBe('..r');
    expect(sees(OBS, marker('hamlet_square'))).toBe(true);
    expect(dist(OBS, marker('hamlet_square'))).toBeCloseTo(2.0, 1);
  });
});

describe('E: a drone’s look is priced (recon_drone, sight 16), against a MANPAD envelope of 13', () => {
  it('grounds sight and MANPAD range in the roster', () => {
    expect(units.recon_drone.sensors.sight_tiles).toBe(16);
    expect(units.manpad_team.weapons[0].range_tiles).toBe(13);
  });

  const POSTS: [string, Pt][] = [
    ['crest', marker('crest')],
    ['horn_west', marker('horn_west')],
    ['horn_east', marker('horn_east')],
    ['knoll_stone', marker('knoll_stone')],
  ];

  function seenFrom(station: Pt): string[] {
    return POSTS.filter(([, p]) => sees(station, p, 16)).map(([name]) => name);
  }

  it('rim_crest station identifies knoll_stone only, and is outside both MANPAD envelopes', () => {
    const station: Pt = [24, 41];
    expect(seenFrom(station)).toEqual(['knoll_stone']);
    expect(dist(station, marker('manpad_north'))).toBeCloseTo(29.3, 1);
    expect(dist(station, marker('manpad_basin'))).toBeCloseTo(19.9, 1);
  });

  it('the west-flank station identifies horn_west only, and is outside both envelopes', () => {
    const station: Pt = [14, 30];
    expect(seenFrom(station)).toEqual(['horn_west']);
    expect(dist(station, marker('manpad_north'))).toBeCloseTo(19.0, 1);
    expect(dist(station, marker('manpad_basin'))).toBeCloseTo(17.9, 1);
  });

  it('the mid-basin station identifies both horns and knoll_stone, inside manpad_basin', () => {
    const station: Pt = [24, 30];
    expect(seenFrom(station).sort()).toEqual(['horn_east', 'horn_west', 'knoll_stone'].sort());
    expect(dist(station, marker('manpad_basin'))).toBeCloseTo(10.0, 1);
  });

  it('the north-west station identifies crest and horn_west, inside manpad_north', () => {
    const station: Pt = [18, 16];
    expect(seenFrom(station).sort()).toEqual(['crest', 'horn_west'].sort());
    expect(dist(station, marker('manpad_north'))).toBeCloseTo(4.5, 1);
  });

  it('the north-axis station identifies crest and both horns, inside both envelopes', () => {
    const station: Pt = [24, 16];
    expect(seenFrom(station).sort()).toEqual(['crest', 'horn_east', 'horn_west'].sort());
    expect(dist(station, marker('manpad_north'))).toBeCloseTo(5.7, 1);
    expect(dist(station, marker('manpad_basin'))).toBeCloseTo(8.5, 1);
  });
});

describe('F: the sniper (amr, range 15, collateral_risk 0.05) is the answer to the observer', () => {
  it('grounds range and collateral risk in the roster', () => {
    expect(units.sniper_team.weapons[0].range_tiles).toBe(15);
    expect(units.sniper_team.weapons[0].collateral_risk).toBe(0.05);
    expect(units.sniper_team.unlock?.roe_rating_min).toBe(60);
  });

  const SHOTS: [string, Pt, Pt, number][] = [
    ['crest', marker('crest'), [19, 13], 7.8],
    ['horn_west', marker('horn_west'), [22, 20], 12.4],
    ['horn_west', marker('horn_west'), [22, 30], 13.9],
    ['horn_east', marker('horn_east'), [26, 20], 11.4],
    ['horn_east', marker('horn_east'), [26, 30], 13.0],
    ['knoll_stone', marker('knoll_stone'), [24, 41], 8.1],
  ];

  it('kills every horn and the knoll post from open ground, inside AMR range', () => {
    for (const [target, t, shooter, d] of SHOTS) {
      expect(MAP.rows[shooter[1]][shooter[0]], `${target} shooter tile`).not.toBe('^');
      const { map } = load(MAP);
      expect(map.blocked[shooter[1] * map.width + shooter[0]], `${target} shooter blocked`).toBe(0);
      expect(dist(shooter, t), `${target} distance`).toBeCloseTo(d, 1);
      expect(dist(shooter, t), `${target} within AMR range`).toBeLessThanOrEqual(15);
      expect(sees(shooter, t, 16), `sniper sees ${target}`).toBe(true);
    }
  });
});

describe('G: the KDF mortar (range 18, sight 7) needs the player’s own eyes', () => {
  it('grounds range, sight and collateral risk in the roster', () => {
    expect(units.mortar_team.weapons[0].range_tiles).toBe(18);
    expect(units.mortar_team.sensors.sight_tiles).toBe(7);
    expect(units.mortar_team.weapons[0].collateral_risk).toBe(0.7);
  });

  it('the mid-basin tube is blind to both horns', () => {
    const tube: Pt = [24, 28];
    expect(sees(marker('horn_west'), tube, 9)).toBe(false);
    expect(dist(marker('horn_west'), tube)).toBeCloseTo(14.9, 1);
    expect(sees(marker('horn_east'), tube, 9)).toBe(false);
    expect(dist(marker('horn_east'), tube)).toBeCloseTo(13.9, 1);
  });

  it('the lane_centre tube is blind to crest', () => {
    const tube = marker('lane_centre');
    expect(sees(marker('crest'), tube, 9)).toBe(false);
    expect(dist(marker('crest'), tube)).toBeCloseTo(16.4, 1);
  });

  it('CORRECTED: the wadi tube at [24,37] is NOT blind to knoll_stone', () => {
    // The design states knoll_stone (4.1 tiles off) cannot see this tube.
    // Measured: it can -- see header note 3 for the full hand-derivation.
    // Pinned here as the terrain fact it is, so a future mission does not
    // site the mortar here believing it unobserved.
    const tube: Pt = [24, 37];
    const post = marker('knoll_stone');
    expect(dist(post, tube)).toBeCloseTo(4.1, 1);
    expect(sees(post, tube, 9)).toBe(true);

    // The hand-derivation, pinned as data rather than prose: h0 = elevation
    // at knoll_stone + EYE_HEIGHT(1), h1 = elevation at the tube + 1, and the
    // three intermediate tiles the ray actually crosses (Bresenham, y-major)
    // never exceed the line between them.
    const { map } = load(MAP);
    const elevAt = (p: Pt) => map.elevation[p[1] * map.width + p[0]];
    expect(elevAt(post)).toBe(3);
    expect(elevAt(tube)).toBe(1);
    const h0 = elevAt(post) + 1;
    const h1 = elevAt(tube) + 1;
    const total = 4;
    const lineH = (k: number) => h0 * total + (h1 - h0) * k;
    const crossed: [Pt, number][] = [
      [[23, 34], 1],
      [[23, 35], 2],
      [[24, 36], 3],
    ];
    for (const [p, k] of crossed) {
      expect(map.blocked[p[1] * map.width + p[0]], `${p.join(',')} not blocked`).toBe(0);
      expect(elevAt(p) * total, `${p.join(',')} below the sightline`).toBeLessThan(lineH(k));
    }
  });
});

describe('§4.5 routes, per domain, slope priced', () => {
  const LEGS: [string, Pt, string, Pt, number, number | null][] = [
    ['kdf_start', marker('kdf_start'), 'rim_crest', marker('rim_crest'), 4, 4],
    ['rim_crest', marker('rim_crest'), 'knoll_stone', marker('knoll_stone'), 8, 8],
    ['rim_crest', marker('rim_crest'), 'hamlet_square', marker('hamlet_square'), 15, 19],
    ['rim_crest', marker('rim_crest'), 'horn_west summit', marker('horn_west'), 18, null],
    ['rim_crest', marker('rim_crest'), 'horn_east summit', marker('horn_east'), 18, 18],
    ['rim_crest', marker('rim_crest'), 'lane_centre', marker('lane_centre'), 21, 22],
    ['lane_centre', marker('lane_centre'), 'stockpile_yard', marker('stockpile_yard'), 13, 13],
    ['lane_centre', marker('lane_centre'), 'crest', marker('crest'), 16, 16],
    ['hamlet_square', marker('hamlet_square'), 'civ_refuge', marker('civ_refuge'), 11, 19],
    ['uz_wells', marker('uz_wells'), 'civ_refuge', marker('civ_refuge'), 9, 9],
    ['kdf_start', marker('kdf_start'), 'stockpile_yard', marker('stockpile_yard'), 38, 38],
  ];

  it('walks every leg of the §4.5 table at its stated foot and vehicle cost', () => {
    for (const [an, a, bn, b, foot, veh] of LEGS) {
      expect(route(MAP, 'foot', a, b), `${an} -> ${bn} (foot)`).toBe(foot);
      expect(route(MAP, 'vehicle', a, b), `${an} -> ${bn} (vehicle)`).toBe(veh);
    }
  });

  it('the two horns are the same 18-tile distance and different domains', () => {
    const rc = marker('rim_crest');
    expect(route(MAP, 'foot', rc, marker('horn_west'))).toBe(18);
    expect(route(MAP, 'foot', rc, marker('horn_east'))).toBe(18);
    expect(route(MAP, 'vehicle', rc, marker('horn_west'))).toBeNull();
    expect(route(MAP, 'vehicle', rc, marker('horn_east'))).toBe(18);
  });

  it('is the scree doing it, not the hill -- cleared, armour reaches horn_west too', () => {
    // The control: without the boulder field the west horn is exactly as
    // reachable to armour as the east one, on the same 18 tiles infantry pays.
    const rc = marker('rim_crest');
    const hw = marker('horn_west');
    expect(route(scree(MAP), 'vehicle', rc, hw)).toBe(18);
    expect(route(scree(MAP), 'foot', rc, hw)).toBe(18);
  });

  it('the anti-tank ditch costs armour exactly four tiles into the hamlet, and infantry nothing', () => {
    const rc = marker('rim_crest');
    const hs = marker('hamlet_square');
    expect(route(MAP, 'foot', rc, hs)).toBe(15);
    expect(route(MAP, 'vehicle', rc, hs)).toBe(19);
    // The control: filled in, both domains take the same 15 -- the +4 is the
    // ditch, not some other feature of the ground.
    expect(route(noDitch(MAP), 'foot', rc, hs)).toBe(15);
    expect(route(noDitch(MAP), 'vehicle', rc, hs)).toBe(15);
  });

  it('the two towns feel like one distance: 38 tiles start-to-depot, unchanged by domain', () => {
    const start = marker('kdf_start');
    const depot = marker('stockpile_yard');
    expect(route(MAP, 'foot', start, depot)).toBe(38);
    expect(route(MAP, 'vehicle', start, depot)).toBe(38);
  });
});
