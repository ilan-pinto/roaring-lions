// Qarn Hadid's sight and route facts, as assertions.
//
// `tools/src/qarn_hadid_relief.test.ts` already pins every terrain-MECHANICAL
// claim about this map: the two-gate reordering, the ditch's domain lock, the
// scree's domain lock, the Hollow's non-reordering price, cover 3's HP effect.
// This file does not repeat any of that. What it pins instead is the SIGHT
// geometry the three Qarn Hadid missions are built on (docs/campaign/
// qarn_hadid/design.md §3.3, docs/campaign/qarn_hadid/script.md §5) and the
// ROUTE figures the two armour roads and the civilian walks depend on
// (design.md §3.2's "measured this session" table and the "two armour roads"
// table) -- none of which lived in any test before this one.
//
// Method, from design.md's own Appendix and script.md §5's "Method" note,
// reproduced here rather than re-derived: sight uses the `sees()` pattern from
// tools/src/tel_marum_doctrine.test.ts -- spawn units on the real map, run 12s
// of ticks, read sim.debugDetection(a,b).visible, which is range plus losRay
// with no accumulated contact in it, so the answer does not depend on how long
// the sim ran. A "N of M tiles" claim spawns one observer and one target per
// tile (batched into a single sim per observer/sight-range pair, cross-checked
// against the one-sim-per-pair form -- both return identical counts on every
// assertion below). Routes use FlowField.compute over sim.blocked /
// sim.blockedVehicle, exactly as qarn_hadid_relief.test.ts does.
//
// Two of design.md/script.md's own numbers do NOT reproduce, and per this
// task's brief ("if the map disagrees with the script's number, do not move
// the test — report the disagreement") this file pins the MEASURED fact in
// both cases rather than the document's claim, and says so here:
//
// 1. S4 -- script.md claims [33,26] (the scree bench, sight 8) sees 17 of the
//    20 saddle-gate tiles. Driven through the real Sim (single-pair AND
//    batched, identically) it sees 13 of 20. The saddle-gate tiles it does
//    NOT see are exactly its four northernmost rows (y=18-19 plus two tiles of
//    y=20) -- consistent with the bench watching the notch from below and
//    losing the far lip to elevation, not a spawn or range bug (paired
//    single-pair recheck: 13/20, identical). Pinned at 13, not 17.
//
// 2. S8c-S11 -- script.md defines "the armour's road" 10-tile sample as
//    route(MAP, 'vehicle', [20,17], [28,5]) restricted to 11<=y<=17, and
//    itself warns: "If reproducing this exact procedure ... does not return
//    exactly 10 tiles, treat design.md's summary counts as provisional
//    pending correction rather than silently adjusting S8c-S11 to whatever a
//    different slice returns." Reproduced here exactly as specified, the
//    slice contains SEVEN tiles, not ten: [20,17],[19,16],[19,15],[19,14],
//    [19,13],[19,12],[19,11]. No adjacent y-band (10-17, 9-17, 12-17, 11-16,
//    11-18) returns ten either. Measured against that seven-tile sample:
//    knoll_top sees 4 of 7 (design.md claimed 0 of 10 -- "sees nothing... not
//    its own road", the literal wording now shipped in qarn_hadid_3_
//    clearance.json's briefing beat 5); [15,8] sees 4 of 7 (claimed 8/10);
//    [14,12] sees 7 of 7 (claimed 7/10); [13,10] sees 5 of 7 (claimed 6/10).
//    The four visible-from-knoll_top tiles are exactly the SOUTHERN half of
//    the sample (y=14-17, nearest the wall); the three invisible ones are the
//    northern half (y=11-13, nearest the second ditch) -- a real, reproducible
//    elevation fact, not a broken spawn (single-pair recheck matches the
//    batch exactly). This contradicts the shipped briefing's "not its own
//    road" clause for the southern third of that road. Recorded here rather
//    than silently fixed: correcting the narrative text is narrative-
//    designer's call, not mission-author's, and this file pins the
//    reproducible fact so the next person to touch this ground has it.
//
// Everything else below reproduces design.md/script.md exactly.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];

const MAP = maps.qarn_hadid as unknown as MapJson;

function load(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
  const map = parseMap(json);
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 64 });
  applyTerrain(map, sim);
  return { map, sim };
}

function observerType(sight: number): UnitTypeJson {
  return {
    id: `qh_observer_${sight}`,
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.2 },
    sensors: { optics: 1, sight_tiles: sight, signature: 0.6 },
  };
}

/** One observer, one sim, every target spawned at once -- cheaper than a sim
 *  per pair and, per the header note, verified to return the identical count
 *  as the one-sim-per-pair form on every assertion in this file. */
function sightBatch(sight: number, observer: Pt, targets: readonly Pt[]): boolean[] {
  const { sim } = load(MAP);
  const t = sim.addUnitType(observerType(sight));
  const watcher = sim.spawn(t, 0, fx.from(observer[0] + 0.5), fx.from(observer[1] + 0.5));
  const ids = targets.map((p) => sim.spawn(t, 1, fx.from(p[0] + 0.5), fx.from(p[1] + 0.5)));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  return ids.map((id) => sim.debugDetection(watcher, id)?.visible ?? false);
}

function countVisible(sight: number, observer: Pt, targets: readonly Pt[]): number {
  return sightBatch(sight, observer, targets).filter(Boolean).length;
}

function sees(sight: number, a: Pt, b: Pt): boolean {
  return sightBatch(sight, a, [b])[0] ?? false;
}

function rectTiles(x0: number, y0: number, w: number, h: number): Pt[] {
  const out: Pt[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y]);
  return out;
}

/** The shoulder gate's 20 tiles: x in [18,22), y in [18,23). */
const SHOULDER_TILES = rectTiles(18, 18, 4, 5);
/** The saddle gate's 20 tiles: x in [29,33), y in [18,23). */
const SADDLE_TILES = rectTiles(29, 18, 4, 5);

function fieldTo(json: MapJson, domain: 'foot' | 'vehicle', to: Pt) {
  const { map, sim } = load(json);
  const mask = domain === 'foot' ? sim.blocked : sim.blockedVehicle;
  const field = new FlowField(map.width, map.height);
  field.compute(mask, sim.elevation, to[0], to[1]);
  return { map, field };
}

/** The tiles a unit of `domain` actually walks, off the real flow field. */
function route(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): Pt[] | null {
  const { map, field } = fieldTo(json, domain, to);
  let x = from[0];
  let y = from[1];
  const out: Pt[] = [[x, y]];
  for (let steps = 0; steps <= map.width * map.height; steps++) {
    if (x === to[0] && y === to[1]) return out;
    const d = field.dirs[y * map.width + x];
    if (d === undefined || d === DIR_NONE) return null;
    x += DIR_DX[d] ?? 0;
    y += DIR_DY[d] ?? 0;
    out.push([x, y]);
  }
  return null;
}

/** Tile count of a route (steps, excluding the start tile itself -- matching
 *  design.md's own "N tiles" convention). */
function tiles(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): number | null {
  const r = route(json, domain, from, to);
  return r === null ? null : r.length - 1;
}

/** Cost in tenths of a tile, matching qarn_hadid_relief.test.ts's `cost()`. */
function cost(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): number | null {
  const { map, field } = fieldTo(json, domain, to);
  const c = field.costAt(from[1] * map.width + from[0]);
  return c >= 0x7fffffff ? null : c;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------------------
// Markers (read directly from data/maps/qarn_hadid.json, not re-typed).
const KDF_START: Pt = [24, 39];
const SOUTH_PLAIN: Pt = [24, 33];
const SHOULDER_GATE: Pt = [20, 20];
const SADDLE_GATE: Pt = [30, 20];
const NORTH_JUNCTION: Pt = [24, 12];
const VILLAGE_SQUARE: Pt = [28, 5];
const KNOLL_TOP: Pt = [10, 9];
const SCREE_NORTH: Pt = [40, 23];
const HOLLOW_FLOOR: Pt = [38, 38];
const CIV_REFUGE: Pt = [10, 43];
const CLINIC_YARD: Pt = [44, 10];

// grad_122, from data/units/enemy/rocket_battery.json.
const GRAD_RANGE = 20;
const GRAD_MIN_RANGE = 4;

describe('the two gates cannot see each other', () => {
  it('the shoulder gate sees only itself, at sight 9, 12 and 48', () => {
    for (const sight of [9, 12, 48]) {
      expect(countVisible(sight, SHOULDER_GATE, SHOULDER_TILES)).toBe(20);
      expect(countVisible(sight, SHOULDER_GATE, SADDLE_TILES)).toBe(0);
    }
  });

  it('the saddle gate sees only itself, at sight 9, 12 and 48', () => {
    for (const sight of [9, 12, 48]) {
      expect(countVisible(sight, SADDLE_GATE, SADDLE_TILES)).toBe(20);
      expect(countVisible(sight, SADDLE_GATE, SHOULDER_TILES)).toBe(0);
    }
  });
});

describe('who can watch the low gate', () => {
  it('the cover-3 block sees the whole notch at rifle sight', () => {
    // design.md §3.3.2 -- "the sentence mission II is built on".
    expect(countVisible(9, [32, 15], SADDLE_TILES)).toBe(20);
  });

  it('the scree bench sees 13 of the 20 notch tiles at sight 8', () => {
    // Corrected from script.md's claimed 17/20 -- see header note 1.
    expect(countVisible(8, [33, 26], SADDLE_TILES)).toBe(13);
  });
});

describe('who can watch the high gate', () => {
  it('the north junction sees 8/20 at sight 9 and 11/20 at sight 12', () => {
    expect(countVisible(9, NORTH_JUNCTION, SHOULDER_TILES)).toBe(8);
    expect(countVisible(12, NORTH_JUNCTION, SHOULDER_TILES)).toBe(11);
  });

  it('the west ditch end sees 9/20 at sight 9', () => {
    expect(countVisible(9, [18, 11], SHOULDER_TILES)).toBe(9);
  });

  it("the knoll's east shoulder sees 5/20 at sight 9 and 11/20 at sight 12", () => {
    expect(countVisible(9, [14, 12], SHOULDER_TILES)).toBe(5);
    expect(countVisible(12, [14, 12], SHOULDER_TILES)).toBe(11);
  });

  it('nobody outside the gate sees more than 12 of 20 at sight 9 or 12', () => {
    for (const post of [NORTH_JUNCTION, [18, 11], [14, 12]] as Pt[]) {
      expect(countVisible(9, post, SHOULDER_TILES)).toBeLessThanOrEqual(12);
      expect(countVisible(12, post, SHOULDER_TILES)).toBeLessThanOrEqual(12);
    }
  });
});

describe('the relay hill is blind', () => {
  it('sees the shoulder gate and nothing else named on the map', () => {
    expect(countVisible(48, KNOLL_TOP, SHOULDER_TILES)).toBeGreaterThan(0);
    expect(sees(48, KNOLL_TOP, VILLAGE_SQUARE)).toBe(false);
    expect(sees(48, KNOLL_TOP, NORTH_JUNCTION)).toBe(false);
    // The second ditch's mouth at its west end.
    expect(sees(48, KNOLL_TOP, [20, 11])).toBe(false);
  });

  /** design.md/script.md's own "armour's road" sample --
   *  route(MAP,'vehicle',[20,17],[28,5]) restricted to 11<=y<=17 -- which
   *  reproduces as SEVEN tiles, not ten. See header note 2. */
  const ARMOUR_ROAD_SAMPLE: Pt[] = (() => {
    const r = route(MAP, 'vehicle', [20, 17], [28, 5]);
    if (r === null) throw new Error('west armour road is unreachable');
    const band = r.filter(([, y]) => y >= 11 && y <= 17);
    if (band.length !== 7) {
      throw new Error(
        `the armour-road sample no longer has 7 tiles (has ${band.length}) -- the route changed; ` +
          `re-measure S8c-S11 rather than silently accepting a new count`
      );
    }
    return band;
  })();

  it("does not see the southernmost third of the west armour road, but a post on its own east shoulder does", () => {
    expect(countVisible(48, KNOLL_TOP, ARMOUR_ROAD_SAMPLE)).toBe(4);
    expect(countVisible(8, [15, 8], ARMOUR_ROAD_SAMPLE)).toBe(4);
    expect(countVisible(8, [14, 12], ARMOUR_ROAD_SAMPLE)).toBe(7);
    expect(countVisible(8, [13, 10], ARMOUR_ROAD_SAMPLE)).toBe(5);
  });
});

describe('the Hollow is dead ground twice over', () => {
  it('sees nothing outside its own zone', () => {
    const outside: Pt[] = [KDF_START, SOUTH_PLAIN, SADDLE_GATE, SHOULDER_GATE, NORTH_JUNCTION, VILLAGE_SQUARE, KNOLL_TOP, SCREE_NORTH];
    expect(sightBatch(48, HOLLOW_FLOOR, outside)).toEqual(outside.map(() => false));
  });

  it('is not seen from any of the five posts that could otherwise support it', () => {
    for (const post of [KDF_START, SOUTH_PLAIN, SADDLE_GATE, SHOULDER_GATE, NORTH_JUNCTION] as Pt[]) {
      expect(sees(48, post, HOLLOW_FLOOR)).toBe(false);
    }
  });

  it("is within the Grad's range of the start line and the low road, and not of the high one", () => {
    expect(dist(HOLLOW_FLOOR, KDF_START)).toBeGreaterThan(GRAD_MIN_RANGE);
    expect(dist(HOLLOW_FLOOR, KDF_START)).toBeLessThanOrEqual(GRAD_RANGE);
    expect(dist(HOLLOW_FLOOR, SOUTH_PLAIN)).toBeLessThanOrEqual(GRAD_RANGE);
    expect(dist(HOLLOW_FLOOR, SADDLE_GATE)).toBeLessThanOrEqual(GRAD_RANGE);
    expect(dist(HOLLOW_FLOOR, SHOULDER_GATE)).toBeGreaterThan(GRAD_RANGE);
    expect(dist(HOLLOW_FLOOR, NORTH_JUNCTION)).toBeGreaterThan(GRAD_RANGE);
  });
});

describe("the tube's eyes have to be forward", () => {
  it('nothing in the scree sees the start line, at any realistic sight', () => {
    for (const post of [SCREE_NORTH, [33, 26], [40, 30]] as Pt[]) {
      for (const sight of [8, 9, 12]) {
        expect(sees(sight, post, KDF_START)).toBe(false);
      }
    }
  });

  it('the bench sees the near plain and nothing further west', () => {
    expect(sightBatch(8, [33, 26], [[28, 32], [30, 30]])).toEqual([true, true]);
    expect(sightBatch(8, [33, 26], [SOUTH_PLAIN, KDF_START])).toEqual([false, false]);
  });
});

describe('killing my own favourite: the south plain cannot support either gate', () => {
  it('sees almost nothing north of the wall', () => {
    expect(countVisible(12, SOUTH_PLAIN, SHOULDER_TILES)).toBe(2);
    expect(countVisible(12, SOUTH_PLAIN, SADDLE_TILES)).toBe(0);
    const northSample: Pt[] = [NORTH_JUNCTION, SHOULDER_GATE, SADDLE_GATE, VILLAGE_SQUARE, KNOLL_TOP, [24, 17], [15, 8], [39, 13]];
    expect(sightBatch(12, SOUTH_PLAIN, northSample)).toEqual(northSample.map(() => false));
  });
});

describe('the_gates zone: foot and vehicle passability', () => {
  it('is 153 tiles, 108 foot-passable and 104 vehicle-passable', () => {
    const { sim } = load(MAP);
    let total = 0;
    let footOpen = 0;
    let vehOpen = 0;
    for (let y = 16; y < 16 + 9; y++) {
      for (let x = 17; x < 17 + 17; x++) {
        total++;
        if (sim.blocked[y * MAP.width + x] === 0) footOpen++;
        if (sim.blockedVehicle[y * MAP.width + x] === 0) vehOpen++;
      }
    }
    expect(total).toBe(153);
    expect(footOpen).toBe(108);
    expect(vehOpen).toBe(104);
  });
});

describe('routes off the start line', () => {
  it('foot takes the saddle, vehicle takes the shoulder, to the north junction', () => {
    expect(tiles(MAP, 'foot', KDF_START, NORTH_JUNCTION)).toBe(29);
    expect(cost(MAP, 'foot', KDF_START, NORTH_JUNCTION)).toBe(322);
    expect(tiles(MAP, 'vehicle', KDF_START, NORTH_JUNCTION)).toBe(27);
    expect(cost(MAP, 'vehicle', KDF_START, NORTH_JUNCTION)).toBe(344);
  });

  it('foot takes the saddle, vehicle takes the shoulder, to the village square', () => {
    expect(tiles(MAP, 'foot', KDF_START, VILLAGE_SQUARE)).toBe(34);
    expect(cost(MAP, 'foot', KDF_START, VILLAGE_SQUARE)).toBe(374);
    expect(tiles(MAP, 'vehicle', KDF_START, VILLAGE_SQUARE)).toBe(39);
    expect(cost(MAP, 'vehicle', KDF_START, VILLAGE_SQUARE)).toBe(486);
  });

  it('both domains take the shoulder to the knoll', () => {
    expect(tiles(MAP, 'foot', KDF_START, KNOLL_TOP)).toBe(31);
    expect(cost(MAP, 'foot', KDF_START, KNOLL_TOP)).toBe(442);
    expect(tiles(MAP, 'vehicle', KDF_START, KNOLL_TOP)).toBe(31);
    expect(cost(MAP, 'vehicle', KDF_START, KNOLL_TOP)).toBe(442);
  });

  it('the scree costs a rifleman 16 and a vehicle 22, south of the wall', () => {
    expect(tiles(MAP, 'foot', KDF_START, SCREE_NORTH)).toBe(16);
    expect(cost(MAP, 'foot', KDF_START, SCREE_NORTH)).toBe(244);
    expect(tiles(MAP, 'vehicle', KDF_START, SCREE_NORTH)).toBe(22);
    expect(cost(MAP, 'vehicle', KDF_START, SCREE_NORTH)).toBe(280);
  });

  it('the Hollow and the refuge cost both domains the same, south of the wall', () => {
    expect(tiles(MAP, 'foot', KDF_START, HOLLOW_FLOOR)).toBe(14);
    expect(cost(MAP, 'foot', KDF_START, HOLLOW_FLOOR)).toBe(164);
    expect(tiles(MAP, 'vehicle', KDF_START, HOLLOW_FLOOR)).toBe(14);
    expect(cost(MAP, 'vehicle', KDF_START, HOLLOW_FLOOR)).toBe(164);
    expect(tiles(MAP, 'foot', KDF_START, CIV_REFUGE)).toBe(14);
    expect(cost(MAP, 'foot', KDF_START, CIV_REFUGE)).toBe(166);
    expect(tiles(MAP, 'vehicle', KDF_START, CIV_REFUGE)).toBe(14);
    expect(cost(MAP, 'vehicle', KDF_START, CIV_REFUGE)).toBe(166);
  });
});

/** The second ditch is a single row at y=11, x=20-34 -- so a route crossing
 *  that row at a tile OUTSIDE [20,34] went round an end, and the x it
 *  crosses at names which one. */
function ditchCrossing(p: Pt[]): number[] {
  return p.filter(([, y]) => y === 11).map(([x]) => x);
}

describe('the two armour roads into the village', () => {
  it('the west road is 17 tiles for a vehicle, crossing the ditch at its west end', () => {
    const r = route(MAP, 'vehicle', [20, 17], VILLAGE_SQUARE);
    expect(r).not.toBeNull();
    expect((r as Pt[]).length - 1).toBe(17);
    const crossing = ditchCrossing(r as Pt[]);
    expect(crossing.length).toBeGreaterThan(0);
    expect(Math.min(...crossing)).toBeLessThan(20);
  });

  it('the same leg costs a rifleman 13 tiles', () => {
    expect(tiles(MAP, 'foot', [20, 17], VILLAGE_SQUARE)).toBe(13);
  });

  it('the east road is 23 tiles for a vehicle, crossing the ditch at its east end through the olive grove', () => {
    const r = route(MAP, 'vehicle', [30, 17], VILLAGE_SQUARE);
    expect(r).not.toBeNull();
    expect((r as Pt[]).length - 1).toBe(23);
    const crossing = ditchCrossing(r as Pt[]);
    expect(crossing.length).toBeGreaterThan(0);
    expect(Math.min(...crossing)).toBeGreaterThan(34);
  });

  it('the same leg costs a rifleman 12 tiles', () => {
    expect(tiles(MAP, 'foot', [30, 17], VILLAGE_SQUARE)).toBe(12);
  });
});

describe("mission I's road party", () => {
  it('is 10 tiles from the refuge on foot, crossing into south_staging after 3', () => {
    const r = route(MAP, 'foot', [34, 31], KDF_START);
    expect(r).not.toBeNull();
    const path = r as Pt[];
    expect(path.length - 1).toBe(10);
    const zx = 16;
    const zy = 34;
    const zw = 17;
    const zh = 12;
    const idx = path.findIndex(([x, y]) => x >= zx && x < zx + zw && y >= zy && y < zy + zh);
    expect(idx).toBe(3);
  });

  it('is 11 tiles from player_start for the first group and 12 for the second, on both domains', () => {
    // design.md/script.md state "11 tiles... for both a rifleman and a jeep"
    // without naming which group; measured, the FIRST group ([34,31]) is 11
    // and the SECOND ([36,32]) is 12, identically for foot and vehicle
    // (Chebyshev distance: max(10,11)=11 and max(12,10)=12). Both are short
    // walks well inside the 240s clock either way -- this does not change
    // whether the mission is winnable or how it should be played, so it is
    // pinned here rather than treated as a defect, but the "11 tiles" the
    // debrief line uses is a narrative rounding, not a measurement of both
    // groups.
    const PLAYER_START: Pt = [24, 42];
    expect(tiles(MAP, 'foot', [34, 31], PLAYER_START)).toBe(11);
    expect(tiles(MAP, 'vehicle', [34, 31], PLAYER_START)).toBe(11);
    expect(tiles(MAP, 'foot', [36, 32], PLAYER_START)).toBe(12);
    expect(tiles(MAP, 'vehicle', [36, 32], PLAYER_START)).toBe(12);
  });
});

describe("mission III's civilians walk to the clinic yard well inside five minutes", () => {
  it('the three-family group is 15 tiles from the clinic yard on foot', () => {
    // script.md's own R16/R16b measured a PROXY point 2 tiles short of the
    // real clinic_yard marker, from proxy start tiles ([30,3]/[29,8]) that
    // are also not quite the authored civilian positions, and flagged
    // "re-measure to the marker itself when the marker lands". This measures
    // the real marker against the real, now-authored civilian positions.
    expect(tiles(MAP, 'foot', [29, 3], CLINIC_YARD)).toBe(15);
  });

  it('the two-family group is 22 tiles from the clinic yard on foot', () => {
    // Longer than script.md's 19-tile proxy figure -- the proxy start tile
    // ([29,8]) sat closer to the village exit than the authored [22,5] does.
    // 22 tiles is still a fraction of the 300s clock: civilians walk at
    // 0.8 tiles/s (data/units/civilians.json), so under 28 seconds once a
    // soldier has triggered the flee order.
    expect(tiles(MAP, 'foot', [22, 5], CLINIC_YARD)).toBe(22);
  });
});
