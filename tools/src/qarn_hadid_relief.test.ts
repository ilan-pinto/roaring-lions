// Qarn Hadid's relief, as assertions.
//
// This map exists to exercise the terrain system, so its claims are exactly
// the ones a reader would otherwise have to take on trust: that its hills
// REORDER routes rather than merely costing more, that its two vehicle-only
// obstacles do what their symbols promise, and that its cover-3 tiles — the
// first authored anywhere in the game — are worth standing on.
//
// Every claim is driven through the real `FlowField` and the real `Sim`, and
// every positive is paired with a CONTROL built from the same map with one
// thing removed: the elevation flattened, the `d` tiles filled in, the `b`
// tiles turned back to open ground, the cover level overridden. A route
// measurement with no control passes when the goal was unreachable for an
// unrelated reason, and a slope measurement with no flattened control cannot
// tell "the relief chose this" from "the geometry chose this".
//
// The one fact that makes this map worth authoring, from CLAUDE.md and
// measured rather than reasoned: A CLIMB TELESCOPES. Every monotone route to
// a fixed height pays the same total wherever it crosses, so slope only
// reorders routes over ground that rises ABOVE its destination and comes back
// down. A ramp up to a plateau changes no route at all. So the map's two ways
// through the ridge are a HIGH one near the axis (the shoulder gate, crest 6)
// and a LOW one further out (the saddle gate, a notch at plain level) — and
// the flat control is what proves the low one is chosen for its height and
// not for its position.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, TERRAIN_LEGEND, units, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];

const MAP = maps.qarn_hadid as unknown as MapJson;

/** The same map with every tile at height 0: the control that separates "the
 *  relief chose this route" from "the walls chose this route". */
function flattened(json: MapJson): MapJson {
  const elevation = json.elevation;
  if (!elevation) throw new Error('qarn_hadid must declare an elevation grid');
  return { ...json, elevation: elevation.map((r) => '0'.repeat(r.length)) };
}

/** The same map with every `d` back to open ground. */
const filledIn = (json: MapJson): MapJson => ({
  ...json,
  rows: json.rows.map((r) => r.split('d').join('.')),
});

/** The same map with every `b` back to open ground. */
const cleared = (json: MapJson): MapJson => ({
  ...json,
  rows: json.rows.map((r) => r.split('b').join('.')),
});

function load(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
  const map = parseMap(json);
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 16 });
  applyTerrain(map, sim);
  return { map, sim };
}

function fieldTo(json: MapJson, domain: 'foot' | 'vehicle', to: Pt) {
  const { map, sim } = load(json);
  const mask = domain === 'foot' ? sim.blocked : sim.blockedVehicle;
  const field = new FlowField(map.width, map.height);
  field.compute(mask, sim.elevation, to[0], to[1]);
  return { map, field };
}

/** The tiles a unit of `domain` actually walks, off the real flow field —
 *  slope priced in. `null` means the mask offers no route at all. */
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

/** What that route costs, in tenths of a tile — a plain step is 10, a diagonal
 *  14, and one level of climb is another 10 (`UPHILL_PER_LEVEL`). */
function cost(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): number | null {
  const { map, field } = fieldTo(json, domain, to);
  const c = field.costAt(from[1] * map.width + from[0]);
  return c >= 0x7fffffff ? null : c;
}

/** The cheapest route from `from` to `to` that is FORCED through `via`. */
const costVia = (json: MapJson, domain: 'foot' | 'vehicle', from: Pt, via: Pt, to: Pt): number =>
  (cost(json, domain, from, via) ?? NaN) + (cost(json, domain, via, to) ?? NaN);

/** Which gate a route used, named by where it crossed the wall's crest row.
 *  Row 20 is solid `^` everywhere except the two gates, so this cannot be
 *  ambiguous — and it reports the x, so a route that somehow crossed
 *  elsewhere names the tile rather than silently reading as one of the two. */
function gate(p: Pt[] | null): string {
  if (p === null) return 'no route';
  const at = p.find((q) => q[1] === WALL_ROW);
  if (at === undefined) return 'never crossed the wall';
  if (at[0] >= SADDLE_X0 && at[0] <= SADDLE_X1) return 'saddle';
  if (at[0] >= SHOULDER_X0 && at[0] <= SHOULDER_X1) return 'shoulder';
  return `neither (x=${at[0]})`;
}

const WALL_ROW = 20;
const SHOULDER_X0 = 18;
const SHOULDER_X1 = 21;
const SADDLE_X0 = 29;
const SADDLE_X1 = 32;

/** Open ground on the southern plain, on the map's own axis. */
const START: Pt = [24, 40];
/** Open ground in the northern basin, on the same axis. */
const GOAL: Pt = [24, 12];
/** The shoulder gate's own column nearest the axis -- the cheapest tile to
 *  cross it at, so the two gates are compared at their best. */
const SHOULDER: Pt = [21, WALL_ROW];
const SADDLE: Pt = [29, WALL_ROW];

// ---------------------------------------------------------------------------

describe('the terrain vocabulary', () => {
  it('authors every terrain symbol the legend declares', () => {
    // Driven off TERRAIN_LEGEND rather than a list typed here, so a symbol
    // added to the game fails this map rather than quietly going unexercised
    // for another year — which is exactly what happened to `3` and `d`.
    const present = new Set(MAP.rows.join(''));
    const missing = Object.keys(TERRAIN_LEGEND).filter((s) => !present.has(s));
    expect(missing).toEqual([]);
    expect(Object.keys(TERRAIN_LEGEND)).toHaveLength(10);
  });

  it('parses into the four mechanical layers the symbols promise', () => {
    const { map } = load(MAP);
    const at = (x: number, y: number): number => y * map.width + x;
    // `^` — impassable, no cover, and the only blocked tile that is not a building.
    expect(map.blocked[at(0, WALL_ROW)]).toBe(1);
    expect(map.cover[at(0, WALL_ROW)]).toBe(0);
    expect(map.structures.some((s) => s.tiles.includes(at(0, WALL_ROW)))).toBe(false);
    // `b` — open on foot, a wall to wheels and tracks. Never `blocked`.
    expect(map.boulder[at(40, 26)]).toBe(1);
    expect(map.blocked[at(40, 26)]).toBe(0);
    expect(map.cover[at(40, 26)]).toBe(0);
    // `d` — mechanically `b` to the byte.
    expect(map.boulder[at(30, WALL_ROW)]).toBe(1);
    expect(map.blocked[at(30, WALL_ROW)]).toBe(0);
    // `3` — the heaviest cover level, authored here for the first time.
    expect(map.cover[at(27, 15)]).toBe(3);
  });

  it('carries real relief, not a tint: 0 to 7, and both a hill and a hollow', () => {
    const { map } = load(MAP);
    const levels = new Set(map.elevation);
    expect(Math.min(...levels)).toBe(0);
    expect(Math.max(...levels)).toBe(7);
    // The bowl really is a bowl: a floor BELOW the plain with a rim ABOVE it.
    const at = (x: number, y: number): number => map.elevation[y * map.width + x] ?? -1;
    expect(at(38, 38)).toBe(0); // the Hollow's floor
    expect(at(44, 38)).toBe(3); // its eastern rim
    expect(at(24, 30)).toBe(1); // the plain either side
    // And the mountain rises above both gates it stands between.
    expect(at(24, WALL_ROW)).toBe(7); // the horn
    expect(at(20, WALL_ROW)).toBe(6); // the shoulder gate: passable, and AT the crest
    expect(at(30, WALL_ROW)).toBe(1); // the saddle gate: a notch at plain level
  });
});

describe('the two gates: relief REORDERS the route, it does not merely price it', () => {
  it('sends a rifleman through the saddle, and the same map flattened through the shoulder', () => {
    // The whole point of the map, in two lines. Same rows, same walls, same
    // endpoints; the ONLY difference is the elevation grid.
    expect(gate(route(MAP, 'foot', START, GOAL))).toBe('saddle');
    expect(gate(route(flattened(MAP), 'foot', START, GOAL))).toBe('shoulder');
  });

  it('takes the LONGER route in tiles, which is what makes it a reordering', () => {
    // If the relief route were also the shorter one, the elevation would have
    // changed nothing but the number printed beside it.
    const relief = route(MAP, 'foot', START, GOAL);
    const flat = route(flattened(MAP), 'foot', START, GOAL);
    expect(relief).not.toBeNull();
    expect(flat).not.toBeNull();
    expect((relief ?? []).length - 1).toBe(30);
    expect((flat ?? []).length - 1).toBe(28);
  });

  it('picks two routes that share nothing but their endpoints', () => {
    const key = (p: Pt[]): Set<string> => new Set(p.map((q) => `${q[0]},${q[1]}`));
    const a = key(route(MAP, 'foot', START, GOAL) ?? []);
    const b = key(route(flattened(MAP), 'foot', START, GOAL) ?? []);
    const shared = [...a].filter((t) => b.has(t));
    expect(shared.sort()).toEqual(['24,12', '24,40']);
  });

  it('flips the ORDER of the two gates, and the flip is the climb', () => {
    // Forced through each gate in turn, so the two are compared on the same
    // ground rather than inferred from which one the field happened to pick.
    //
    // The shoulder gate is 8 tiles nearer the axis than the saddle, which is
    // worth 16 on flat ground -- and it stands 5 levels higher than the plain
    // either side of it, which is worth 50. Relief cannot reorder a route by
    // less than it costs to climb, and here it reorders it by 22.
    expect(costVia(flattened(MAP), 'foot', START, SHOULDER, GOAL)).toBe(304);
    expect(costVia(flattened(MAP), 'foot', START, SADDLE, GOAL)).toBe(320);
    expect(costVia(MAP, 'foot', START, SHOULDER, GOAL)).toBe(354);
    expect(costVia(MAP, 'foot', START, SADDLE, GOAL)).toBe(332);
    // The shoulder pays exactly its climb: 5 levels at UPHILL_PER_LEVEL.
    expect(costVia(MAP, 'foot', START, SHOULDER, GOAL) - costVia(flattened(MAP), 'foot', START, SHOULDER, GOAL)).toBe(50);
  });
});

describe('the anti-tank ditch', () => {
  it('shuts the cheap gate to armour and leaves it open to boots', () => {
    // The defender's own logic, and the reason the ditch is where it is: the
    // saddle is the easy way through, so that is where you dig.
    expect(gate(route(MAP, 'foot', START, GOAL))).toBe('saddle');
    expect(gate(route(MAP, 'vehicle', START, GOAL))).toBe('shoulder');
  });

  it('is what moves the armour, not the slope — filled in, it takes the saddle too', () => {
    // The control. Without it, "armour went over the shoulder" is equally
    // consistent with the ditch doing nothing and the hill doing everything.
    const filled = filledIn(MAP);
    expect(gate(route(filled, 'vehicle', START, GOAL))).toBe('saddle');
    expect(gate(route(filled, 'foot', START, GOAL))).toBe('saddle');
    expect(cost(MAP, 'vehicle', START, GOAL)).toBe(354);
    expect(cost(filled, 'vehicle', START, GOAL)).toBe(332);
  });

  it('is authored as straight runs only, so no segment draws an X', () => {
    // `decor-place.ts`'s `ditchYawTurns`: the ditch GLB is a straight
    // prismatic segment with no bend, so a tile with ditch neighbours on BOTH
    // axes draws TWO segments crossing at its centre — correct (never a gap)
    // and visibly a crossing rather than a corner. The rule for an author is
    // therefore "straight runs only", and this is that rule as an assertion.
    // Mirrors the renderer's condition rather than driving it: `tools` may not
    // import `@lions/render` (eslint), and `packages/render` may not import
    // `@lions/data`, so no single file can hold both the map and the function.
    const isDitch = (x: number, y: number): boolean =>
      y >= 0 && y < MAP.height && x >= 0 && x < MAP.width && MAP.rows[y]?.[x] === 'd';
    const junctions: string[] = [];
    const runs: string[] = [];
    for (let y = 0; y < MAP.height; y++) {
      for (let x = 0; x < MAP.width; x++) {
        if (!isDitch(x, y)) continue;
        runs.push(`${x},${y}`);
        if ((isDitch(x - 1, y) || isDitch(x + 1, y)) && (isDitch(x, y - 1) || isDitch(x, y + 1))) {
          junctions.push(`${x},${y}`);
        }
      }
    }
    expect(junctions).toEqual([]);
    // The two runs, exactly: the notch seal (rock wall to rock wall) and the
    // prepared line across the village approach.
    const expected = [
      ...Array.from({ length: 15 }, (_, i) => `${20 + i},11`),
      ...Array.from({ length: 4 }, (_, i) => `${29 + i},20`),
    ];
    expect(runs.sort()).toEqual(expected.sort());
  });
});

describe('the scree: open on foot, a wall to wheels and tracks', () => {
  const SOUTH: Pt = [40, 31];
  const NORTH: Pt = [40, 23];

  it('costs a rifleman nothing and sends a vehicle the long way round', () => {
    expect((route(MAP, 'foot', SOUTH, NORTH) ?? []).length - 1).toBe(8);
    expect((route(MAP, 'vehicle', SOUTH, NORTH) ?? []).length - 1).toBe(20);
  });

  it('is the boulders doing it — cleared, both domains walk the same eight', () => {
    const control = cleared(MAP);
    expect((route(control, 'foot', SOUTH, NORTH) ?? []).length - 1).toBe(8);
    expect((route(control, 'vehicle', SOUTH, NORTH) ?? []).length - 1).toBe(8);
  });

  it('leaves armour a route, rather than deleting the pocket entirely', () => {
    // A field that abuts the cliff would exclude armour from the whole
    // north-east rather than charge it for going round — measured on an
    // earlier draft, which returned no vehicle route at all. The bench
    // between the fan and the wall is deliberate ground.
    const veh = route(MAP, 'vehicle', SOUTH, NORTH);
    expect(veh).not.toBeNull();
    expect((veh ?? []).some((p) => p[0] === 33)).toBe(true);
  });
});

describe('the Hollow: relief that prices ground without reordering it', () => {
  // The measured NEGATIVE, and it is the same rule as the gates read from the
  // other side. A bowl 16 tiles across cannot be walked round for less than
  // the 50 it costs to climb out of, so the route through it is unchanged and
  // only the number moves. Recorded rather than tuned away: "a bowl makes
  // routes bend" is the intuition, and on this geometry it is false.
  const WEST: Pt = [28, 38];
  const EAST: Pt = [46, 38];

  it('charges 50 to cross and changes not one tile of the route', () => {
    const relief = route(MAP, 'foot', WEST, EAST);
    const flat = route(flattened(MAP), 'foot', WEST, EAST);
    expect(relief).toEqual(flat);
    expect(cost(MAP, 'foot', WEST, EAST)).toBe(230);
    expect(cost(flattened(MAP), 'foot', WEST, EAST)).toBe(180);
  });

  it('really is a bowl: the route drops to 0 and climbs a rim of 3', () => {
    const { map } = load(MAP);
    const levels = (route(MAP, 'foot', WEST, EAST) ?? []).map(
      (p) => map.elevation[p[1] * map.width + p[0]] ?? -1
    );
    expect(Math.min(...levels)).toBe(0);
    expect(Math.max(...levels)).toBe(3);
  });
});

describe('cover 3, the first authored anywhere in the game', () => {
  /** How much HP a squad loses on `tile` over 90 s of rifle fire, with the
   *  tile's authored cover and with it overridden. Same seed and same spawn
   *  order in both runs, so the two share every per-entity RNG stream and only
   *  the cover differs. */
  function hpLost(tile: Pt, shooter: Pt, override: number | null, seed: number): number {
    const map = parseMap(MAP);
    const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 8 });
    applyTerrain(map, sim);
    if (override !== null) sim.setCover(tile[0], tile[1], override);
    const st = sim.addUnitType(units.sarim_rifles as unknown as UnitTypeJson);
    const tt = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
    sim.spawn(st, 1, fx.from(shooter[0] + 0.5), fx.from(shooter[1] + 0.5));
    const target = sim.spawn(tt, 0, fx.from(tile[0] + 0.5), fx.from(tile[1] + 0.5));
    // `sim.state` is the read-only view the renderer uses; `sim.hp` itself is
    // private, and nothing outside the sim may reach past this (invariant 4).
    const hp0 = sim.state.hp[target] ?? 0;
    for (let i = 0; i < 90 * TICKS_PER_SECOND; i++) sim.tick();
    return ((hp0 - (sim.state.hp[target] ?? 0)) / 65536) | 0;
  }

  const TERRACE: Pt = [27, 15];
  const SHOOTER: Pt = [24, 10];
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

  it('keeps a squad alive where open ground kills it', () => {
    // Ten seeds, not one: a single duel's outcome is a per-entity RNG stream,
    // and the first version of this measurement read cover 2 as SAFER than
    // cover 3 on one seed purely from stream divergence.
    const onTerrace = SEEDS.map((s) => hpLost(TERRACE, SHOOTER, null, s));
    const inOpen = SEEDS.map((s) => hpLost(TERRACE, SHOOTER, 0, s));
    expect(mean(onTerrace)).toBeLessThan(mean(inOpen) * 0.2);
    // `inf_squad` has 400 hp. In the open it is wiped nearly every run.
    expect(inOpen.filter((v) => v >= 400).length).toBeGreaterThanOrEqual(9);
    expect(onTerrace.filter((v) => v >= 400).length).toBe(0);
  });

  it('is a ladder, and its big step is 0 -> 1, not 2 -> 3', () => {
    // Honest, and worth knowing before authoring a `3`: COVER_HIT goes
    // 1 / .375 / .1375 / .09, so the top two rungs are 1.5x apart and a duel
    // cannot separate them. Cover 3 buys signature and suppression as much as
    // it buys misses.
    const open = mean(SEEDS.map((s) => hpLost(TERRACE, SHOOTER, 0, s)));
    const light = mean(SEEDS.map((s) => hpLost(TERRACE, SHOOTER, 1, s)));
    const heavy = mean(SEEDS.map((s) => hpLost(TERRACE, SHOOTER, 2, s)));
    const garrison = mean(SEEDS.map((s) => hpLost(TERRACE, SHOOTER, 3, s)));
    expect(open).toBeGreaterThan(light * 2);
    expect(light).toBeGreaterThan(heavy);
    expect(Math.abs(heavy - garrison)).toBeLessThan(open * 0.1);
  });
});
