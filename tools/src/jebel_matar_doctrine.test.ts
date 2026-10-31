// Jebel Matar's doctrine (Ein Qasab II, "Dead Ground", GH-912 MDD 3.2), as assertions.
//
// The mission rests on three claims that arithmetic on the sketch cannot settle and that a
// grid drawn by eye got wrong once already (the dyke's second door, below):
//
//   1. every EASTERN wheel enters the hollow through the one 2-tile gap in the basalt dyke;
//   2. the NORTH-WEST wheel route costs +8 over the foot route, all of it the boulder band;
//   3. the hollow (the hold zone) is dead ground from the level-1 north downs.
//
// Each is driven through the real Sim (the real `FlowField` and the real line of sight), and
// each number is paired with the SAME map with the one feature turned back into open ground
// or closed up. Without that control "the wheels went through the gap" also passes when the
// dyke was never a barrier, and "the hollow is hidden" also passes when nothing could see
// anything at all. Oracles are literals, measured on the committed map.
//
// What the sight half proves and does not: OBSERVER has sight_tiles 48, far past anything on
// this map, so every `visible` below is a TERRAIN-AND-LOS fact, not a claim about what the
// Rif's own units (sight 9-11) can see. Do not read it as "the roster sees this".
//
// THE SECOND DOOR, found by this file. The MDD sketch drew the dyke's staircase one row short:
// row 41 carried a six-tile cover patch (`222222`, x 28-33) over the two dyke tiles (31,41)
// and (32,41), so closing the gap at (37-38,35) still left wheels a way in (30 steps against
// 21). The committed map has `^^` there. The "gap closed" case below is the one that went red.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];

const SHIPPED = maps.jebel_matar as MapJson;
const W = SHIPPED.width;

function marker(name: string): Pt {
  const raw = SHIPPED.markers?.[name];
  if (!raw || raw.length < 2 || raw[0] === undefined || raw[1] === undefined) throw new Error(`jebel_matar has no "${name}" marker`);
  return [raw[0], raw[1]];
}

/** The same ground with a symbol turned into another. */
function swap(json: MapJson, from: string, to: string): MapJson {
  return { ...json, rows: json.rows.map((r) => r.split(from).join(to)) };
}

/** The same ground with one row's span overwritten. */
function paint(json: MapJson, y: number, x0: number, glyphs: string): MapJson {
  return { ...json, rows: json.rows.map((r, i) => (i === y ? r.slice(0, x0) + glyphs + r.slice(x0 + glyphs.length) : r)) };
}

/** The same ground with the relief ironed out. */
function flatRelief(json: MapJson): MapJson {
  return { ...json, elevation: (json.elevation ?? []).map((r) => '0'.repeat(r.length)) };
}

function load(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 512 });
  applyTerrain(map, sim);
  return { map, sim };
}

/** The tiles of the shortest route a unit of this domain walks, off the real `FlowField`
 *  (slope priced in), start tile included. `null` means the mask offers no route at all. */
function route(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): Pt[] | null {
  const { map, sim } = load(json);
  const field = new FlowField(map.width, map.height);
  field.compute(domain === 'foot' ? sim.blocked : sim.blockedVehicle, sim.elevation, to[0], to[1]);
  let x = from[0];
  let y = from[1];
  const path: Pt[] = [];
  for (let steps = 0; steps <= map.width * map.height; steps++) {
    path.push([x, y]);
    if (x === to[0] && y === to[1]) return path;
    const d = field.dirs[y * map.width + x];
    if (d === undefined || d === DIR_NONE) return null;
    x += DIR_DX[d] ?? 0;
    y += DIR_DY[d] ?? 0;
  }
  return null;
}

const steps = (p: Pt[] | null): number | null => (p === null ? null : p.length - 1);
const crosses = (p: Pt[] | null, tiles: readonly Pt[]): boolean => p !== null && p.some(([x, y]) => tiles.some(([a, b]) => a === x && b === y));

const FARM = marker('farm');
const RIF_E = marker('rif_e');
const RIF_N = marker('rif_n');
const RIF_NW = marker('rif_nw');
/** The dyke's one vehicle gap: x 37-38 on row 35 (MDD 3.2). */
const GAP: readonly Pt[] = [
  [37, 35],
  [38, 35],
];

describe('the dyke gap: every eastern wheel comes through one 2-tile door', () => {
  it('the eastern raid line is 21 steps by wheel and runs through the gap', () => {
    const veh = route(SHIPPED, 'vehicle', RIF_E, FARM);
    expect(steps(veh)).toBe(21);
    expect(crosses(veh, GAP)).toBe(true);
    // The gap is the only place the path touches the dyke's staircase.
    expect(steps(route(SHIPPED, 'foot', RIF_E, FARM))).toBe(21);
  });

  it('closing the gap leaves wheels no way in at all, while a rifleman still crosses a rubble crossing', () => {
    // The control that makes "through the gap" mean something: with the two gap tiles dyke,
    // the vehicle mask has NO route from the east (this was 30 steps while row 41 was open).
    const closed = paint(SHIPPED, 35, 37, '^^');
    expect(route(closed, 'vehicle', RIF_E, FARM)).toBeNull();
    // Foot crosses the `b` rubble: 24 steps, +3 on the gap's 21.
    expect(steps(route(closed, 'foot', RIF_E, FARM))).toBe(24);
  });

  it('the dyke adds no distance: with it flattened the eastern line is still 21', () => {
    // What the dyke does is choose the door, not lengthen the road.
    const flat = swap(SHIPPED, '^', '.');
    expect(steps(route(flat, 'vehicle', RIF_E, FARM))).toBe(21);
  });

  it('the rubble crossings are foot-only: a boulder tile is open to infantry and a wall to wheels', () => {
    const { map, sim } = load(SHIPPED);
    const rubble: Pt[] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (SHIPPED.rows[y]?.[x] === 'b' && y >= 28 && y <= 41 && x >= 32) rubble.push([x, y]);
    expect(rubble.length).toBe(6); // (43,29)(44,29)(42,30)(43,30)(32,40)(33,40)
    for (const [x, y] of rubble) {
      expect(sim.blocked[y * W + x], `(${x},${y}) foot`).toBe(0);
      expect(sim.blockedVehicle[y * W + x], `(${x},${y}) wheels`).toBe(1);
    }
  });

  it('the start line has its own easy road: kdf_start to the farm is 20 on foot and by wheel', () => {
    const start = marker('kdf_start');
    expect(steps(route(SHIPPED, 'foot', start, FARM))).toBe(20);
    expect(steps(route(SHIPPED, 'vehicle', start, FARM))).toBe(20);
  });
});

describe('the north-west wheel route is +8, and it is the boulders', () => {
  it('rif_nw to the farm is 25 on foot and 33 by wheel', () => {
    expect(steps(route(SHIPPED, 'foot', RIF_NW, FARM))).toBe(25);
    expect(steps(route(SHIPPED, 'vehicle', RIF_NW, FARM))).toBe(33);
  });

  it('with the boulders flattened the wheel route is the foot route, 25', () => {
    const flat = swap(SHIPPED, 'b', '.');
    expect(steps(route(flat, 'vehicle', RIF_NW, FARM))).toBe(25);
    expect(steps(route(flat, 'foot', RIF_NW, FARM))).toBe(25);
  });

  it('the band costs the north-west door and not the north one: rif_n is 25 with or without it', () => {
    // If this moves, the boulders have leaked onto the saddle track.
    expect(steps(route(SHIPPED, 'vehicle', RIF_N, FARM))).toBe(25);
    expect(steps(route(swap(SHIPPED, 'b', '.'), 'vehicle', RIF_N, FARM))).toBe(25);
  });
});

describe('the hollow is dead ground from the north downs', () => {
  const OBSERVER: UnitTypeJson = {
    id: 't_observer',
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.2 },
    sensors: { optics: 1, sight_tiles: 48, signature: 0.6 },
  };

  /** Open, cover-free tiles of a rectangle on the committed map, thinned to every `stepX` / `stepY`. */
  function tiles(x0: number, y0: number, w: number, h: number, stepX = 1, stepY = 1): Pt[] {
    const { map } = load(SHIPPED);
    const out: Pt[] = [];
    for (let y = y0; y < y0 + h; y += stepY) {
      for (let x = x0; x < x0 + w; x += stepX) {
        if (map.blocked[y * W + x] === 0 && map.cover[y * W + x] === 0) out.push([x, y]);
      }
    }
    return out;
  }

  /** Share of observers that see ANY target, and of pairs seen, with one sim for the lot. */
  function sight(json: MapJson, observers: readonly Pt[], targets: readonly Pt[]): { observers: number; seeing: number; pairs: number; seen: number } {
    const { map, sim } = load(json);
    const t = sim.addUnitType(OBSERVER);
    const o = observers.map((p) => sim.spawn(t, 0, fx.from(p[0] + 0.5), fx.from(p[1] + 0.5)));
    const g = targets.map((p) => sim.spawn(t, 1, fx.from(p[0] + 0.5), fx.from(p[1] + 0.5)));
    for (let i = 0; i < 4 * TICKS_PER_SECOND; i++) sim.tick();
    let seeing = 0;
    let seen = 0;
    for (const a of o) {
      let any = false;
      for (const b of g) {
        const d = sim.debugDetection(a, b);
        if (!d) throw new Error(`no detection record for ${a} -> ${b} on ${map.id}`);
        if (d.visible) {
          seen++;
          any = true;
        }
      }
      if (any) seeing++;
    }
    return { observers: o.length, seeing, pairs: o.length * g.length, seen };
  }

  // The hold zone [17,18,15,10], thinned; the downs are the level-1 band y 0-6, thinned; the
  // crest band is y 9-12 (level 4); the saddle slot is x 32-36 on rows 8-14 (level 2).
  const hollow = tiles(17, 18, 15, 10, 1, 1).filter(([x, y]) => (x + y) % 3 === 0);
  const downs = tiles(0, 0, 48, 7, 3, 2);
  const crest = tiles(0, 9, 48, 4, 3, 1);
  const saddle = tiles(32, 8, 5, 7, 1, 2);

  it('sees nothing of it from anywhere on the level-1 north downs', () => {
    expect(hollow.length).toBeGreaterThan(25);
    expect(downs.length).toBeGreaterThan(40);
    const r = sight(SHIPPED, downs, hollow);
    expect(r.seen, `${r.seeing}/${r.observers} downs tiles see the hollow`).toBe(0);
  });

  it('control: with the relief ironed flat the same downs see most of it', () => {
    // Without this the zero above also passes when nothing can see anything (sight too short,
    // detection never ran, the spawn broken).
    const r = sight(flatRelief(SHIPPED), downs, hollow);
    expect(r.seeing / r.observers).toBeGreaterThan(0.9);
    expect(r.seen / r.pairs).toBeGreaterThan(0.3);
  });

  it('is open to the crests: most of the level-4 band sees into it', () => {
    const r = sight(SHIPPED, crest, hollow);
    expect(r.seeing / r.observers, 'crest observers that see any of the hollow').toBeGreaterThan(0.6);
  });

  it('is open to the saddle slot too, which is why the saddle truck sits there', () => {
    // The north track is a notch in the crest: from inside it the farm is in view. The raider
    // meets this ground only on the skyline (MDD 3.0), and not on the downs.
    const r = sight(SHIPPED, saddle, hollow);
    expect(r.seeing).toBe(r.observers);
  });
});
