import { describe, expect, it } from 'vitest';
import { DIR_DX, DIR_DY, FlowField } from './flowfield';
import { corridorRoute, makeRouteSource, type RouteSource } from './corridor';

// Hand-drawn grids. Symbols: '.' open, '#' building (blocked to all), 'b' boulder and 'd' ditch
// (a wall to anything on wheels, open on foot), 'r' road, 'x' a road tile that is also a building
// (blocked to all: a road broken by a building).
interface Grid {
  w: number;
  h: number;
  foot: Uint8Array;
  vehicle: Uint8Array;
  roads: Uint8Array;
  hasRoad: boolean;
}

function parse(rows: string[]): Grid {
  const h = rows.length;
  const w = rows[0].length;
  const foot = new Uint8Array(w * h);
  const vehicle = new Uint8Array(w * h);
  const roads = new Uint8Array(w * h);
  let hasRoad = false;
  for (let y = 0; y < h; y++) {
    expect(rows[y].length).toBe(w);
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      const t = y * w + x;
      if (c === '#' || c === 'x') {
        foot[t] = 1;
        vehicle[t] = 1;
      }
      if (c === 'b' || c === 'd') vehicle[t] = 1;
      if (c === 'r' || c === 'x') {
        roads[t] = 1;
        hasRoad = true;
      }
    }
  }
  return { w, h, foot, vehicle, roads, hasRoad };
}

function source(g: Grid, withRoads = true): RouteSource {
  return makeRouteSource(g.w, g.h, g.vehicle, new Uint8Array(g.w * g.h), withRoads && g.hasRoad ? g.roads : null);
}

/** The foot route over the same grid, by the real FlowField on the foot mask. */
function footReaches(g: Grid, from: [number, number], to: [number, number]): boolean {
  const f = new FlowField(g.w, g.h);
  f.compute(g.foot, new Uint8Array(g.w * g.h), to[0], to[1]);
  let t = from[1] * g.w + from[0];
  for (let i = 0; i <= g.w * g.h; i++) {
    if (t === to[1] * g.w + to[0]) return true;
    const d = f.dirs[t];
    if (d === 255) return false;
    t += DIR_DY[d] * g.w + DIR_DX[d];
  }
  return false;
}

const xy = (g: Grid, t: number): [number, number] => [t % g.w, (t - (t % g.w)) / g.w];

/** Ends, 8-adjacency, no vehicle-blocked tile, and the corner rule on every diagonal. */
function expectDrivable(g: Grid, route: Int32Array, from: [number, number], to: [number, number]): void {
  expect(xy(g, route[0])).toEqual(from);
  expect(xy(g, route[route.length - 1])).toEqual(to);
  for (let i = 0; i < route.length; i++) {
    expect(g.vehicle[route[i]]).toBe(0);
    if (i === 0) continue;
    const [px, py] = xy(g, route[i - 1]);
    const [x, y] = xy(g, route[i]);
    expect(Math.max(Math.abs(x - px), Math.abs(y - py))).toBe(1);
    if (x !== px && y !== py) {
      expect(g.vehicle[py * g.w + x]).toBe(0);
      expect(g.vehicle[y * g.w + px]).toBe(0);
    }
  }
}

const pt = (x: number, y: number) => ({ x, y });
const idx = (g: Grid, x: number, y: number) => y * g.w + x;

describe('corridorRoute: the flow route (no road)', () => {
  it('open ground: reaches `to`, every step 8-adjacent', () => {
    const g = parse(['..........', '..........', '..........', '..........', '..........']);
    const r = corridorRoute(source(g), pt(0, 0), pt(9, 4));
    expect(r).not.toBeNull();
    if (r === null) return;
    expectDrivable(g, r, [0, 0], [9, 4]);
    expect(r.length).toBe(10); // a diagonal run, then along the row
  });

  it('from === to is the one tile', () => {
    const g = parse(['...', '...']);
    expect(Array.from(corridorRoute(source(g), pt(1, 1), pt(1, 1)) ?? [])).toEqual([idx(g, 1, 1)]);
  });

  it('a ditch row with no gap: null; with one gap: the route passes through it', () => {
    const closed = parse(['.........', '.........', 'ddddddddd', '.........', '.........']);
    expect(corridorRoute(source(closed), pt(4, 0), pt(4, 4))).toBeNull();
    const gap = parse(['.........', '.........', 'dddd.dddd', '.........', '.........']);
    const r = corridorRoute(source(gap), pt(4, 0), pt(4, 4));
    expect(r).not.toBeNull();
    if (r === null) return;
    expectDrivable(gap, r, [4, 0], [4, 4]);
    expect(Array.from(r)).toContain(idx(gap, 4, 2));
  });

  it('a boulder field is a wall to the route and not to a foot path over the same grid', () => {
    const boulders = parse(['.........', '.........', 'bbbbbbbbb', '.........', '.........']);
    const open = parse(['.........', '.........', '.........', '.........', '.........']);
    // Paired against the same grid with b turned to '.', so "no route" cannot be the geometry.
    expect(corridorRoute(source(boulders), pt(4, 0), pt(4, 4))).toBeNull();
    expect(corridorRoute(source(open), pt(4, 0), pt(4, 4))).not.toBeNull();
    expect(footReaches(boulders, [4, 0], [4, 4])).toBe(true);
    // With a gap the route goes through the gap, never over a boulder, where the foot path goes straight.
    const gap = parse(['.........', '.........', 'bbbbb.bbb', '.........', '.........']);
    const r = corridorRoute(source(gap), pt(0, 0), pt(0, 4));
    expect(r).not.toBeNull();
    if (r === null) return;
    expectDrivable(gap, r, [0, 0], [0, 4]);
    expect(Array.from(r)).toContain(idx(gap, 5, 2));
    expect(r.length).toBeGreaterThan(5); // the straight foot line is 5 tiles
  });

  it('from or to blocked: null', () => {
    const g = parse(['....#', '.....', 'b....']);
    expect(corridorRoute(source(g), pt(4, 0), pt(0, 1))).toBeNull();
    expect(corridorRoute(source(g), pt(0, 1), pt(4, 0))).toBeNull();
    expect(corridorRoute(source(g), pt(0, 2), pt(1, 1))).toBeNull(); // a boulder under the start
    expect(corridorRoute(source(g), pt(-1, 0), pt(1, 1))).toBeNull();
    expect(corridorRoute(source(g), pt(1, 1), pt(5, 1))).toBeNull();
  });

  it('from === to on a blocked tile is null, not a one-tile route', () => {
    const g = parse(['...', '.b.', '...']);
    expect(corridorRoute(source(g), pt(1, 1), pt(1, 1))).toBeNull();
  });

  it('is deterministic and returns a fresh array each call', () => {
    const g = parse(['........', '..##....', '..##....', '........']);
    const a = corridorRoute(source(g), pt(0, 1), pt(7, 2));
    const b = corridorRoute(source(g), pt(0, 1), pt(7, 2));
    expect(a).not.toBeNull();
    expect(Array.from(a ?? [])).toEqual(Array.from(b ?? []));
    expect(a).not.toBe(b);
  });
});

describe('corridorRoute: the road (D5)', () => {
  // A road along row 2, one row above the straight line between the ends on row 3.
  const road = ['..........', '..........', '.rrrrrrrrr', '..........', '..........'];
  const noRoad = road.map((r) => r.replace(/r/g, '.'));

  it('a road that detours two tiles is still taken', () => {
    const g = parse(road);
    const control = parse(noRoad);
    const direct = corridorRoute(source(control), pt(1, 3), pt(9, 3));
    const r = corridorRoute(source(g), pt(1, 3), pt(9, 3));
    expect(direct).not.toBeNull();
    expect(r).not.toBeNull();
    if (direct === null || r === null) return;
    expectDrivable(g, r, [1, 3], [9, 3]);
    expect(direct.length).toBe(9);
    // Up onto the road, along it, down off it: two tiles longer than driving straight.
    expect(r.length).toBe(11);
    for (let x = 1; x <= 9; x++) expect(Array.from(r)).toContain(idx(g, x, 2));
    // The unroaded control route is the direct one, so the difference is the road.
    expect(Array.from(direct)).not.toEqual(Array.from(r));
  });

  it('a junction tile is never listed twice', () => {
    const g = parse(road);
    const r = corridorRoute(source(g), pt(1, 2), pt(9, 2)); // both ends already on the road
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(new Set(Array.from(r)).size).toBe(r.length);
    expect(r.length).toBe(9);
    const s = corridorRoute(source(g), pt(3, 4), pt(7, 4));
    expect(s).not.toBeNull();
    expect(new Set(Array.from(s ?? [])).size).toBe(s?.length);
  });

  it('a road broken by a building is not taken', () => {
    const broken = parse(['..........', '..........', '.rrrrxrrrr', '..........', '..........']);
    const control = parse(noRoad.map((r, y) => (y === 2 ? '.....#....' : r)));
    const r = corridorRoute(source(broken), pt(1, 3), pt(9, 3));
    const c = corridorRoute(source(control), pt(1, 3), pt(9, 3));
    expect(r).not.toBeNull();
    expect(c).not.toBeNull();
    if (r === null || c === null) return;
    expectDrivable(broken, r, [1, 3], [9, 3]);
    expect(Array.from(r)).toEqual(Array.from(c)); // the wheeled field's route
    expect(r.length).toBe(9);
  });

  it('the road does not cut a corner between two buildings', () => {
    // Road tiles (1,1) and (2,2) touch only on a diagonal, and the two tiles beside that
    // diagonal are buildings, so FlowField would not step it and neither may the road.
    const g = parse(['......', '.r#...', '.#r...', '......', '......', '......']);
    const r = corridorRoute(source(g), pt(0, 0), pt(3, 3));
    expect(r).not.toBeNull();
    if (r === null) return;
    expectDrivable(g, r, [0, 0], [3, 3]);
    const list = Array.from(r);
    const i = list.indexOf(idx(g, 1, 1));
    if (i >= 0 && i + 1 < list.length) expect(list[i + 1]).not.toBe(idx(g, 2, 2));
  });

  it('a road tile under a vehicle-only wall (a ditch across it) is not driven', () => {
    const g = parse(['..........', '..........', '.rrrdrrrr.', '..........', '..........']);
    const control = parse(['..........', '..........', '....d.....', '..........', '..........']);
    const r = corridorRoute(source(g), pt(1, 3), pt(9, 3));
    const c = corridorRoute(source(control), pt(1, 3), pt(9, 3));
    expect(r).not.toBeNull();
    expect(Array.from(r ?? [])).toEqual(Array.from(c ?? [1]));
  });

  it('the nearest road tile is an OPEN one: a road tile under a building is passed over', () => {
    // (5,2) is the road tile nearest the start and is a building; R_from must be a drivable neighbour.
    const g = parse(['..........', '..........', '.rrrrxrrrr', '..........', '..........']);
    const r = corridorRoute(source(g), pt(5, 3), pt(9, 3));
    expect(r).not.toBeNull();
    if (r !== null) expectDrivable(g, r, [5, 3], [9, 3]);
  });

  it('ties for the nearest road tile go to the lowest index', () => {
    // A U of road. (2,2) and (4,2) are both 5 (squared) from the start; (2,2) has the lower index.
    const g = parse(['.......', '..rrr..', '..r.r..', '.......', '.......']);
    const r = corridorRoute(source(g), pt(3, 4), pt(3, 0));
    expect(r).not.toBeNull();
    if (r === null) return;
    expectDrivable(g, r, [3, 4], [3, 0]);
    expect(Array.from(r)).toContain(idx(g, 2, 2));
    expect(Array.from(r)).not.toContain(idx(g, 4, 2));
  });

  it('a road-connected pair whose approach is walled off: null, not a fall back', () => {
    // `from` sits in a sealed pocket beside the road: R_from is the road tile next door
    // and no field walk reaches it.
    const g = parse(['rrrrrrrr', '########', '#.#....#', '#.#....#', '########']);
    expect(corridorRoute(source(g), pt(1, 2), pt(4, 3))).toBeNull();
  });

  it('with the road mask absent or empty, the flow route', () => {
    const g = parse(road);
    const none = makeRouteSource(g.w, g.h, g.vehicle, new Uint8Array(g.w * g.h), null);
    const empty = makeRouteSource(g.w, g.h, g.vehicle, new Uint8Array(g.w * g.h), new Uint8Array(g.w * g.h));
    const a = corridorRoute(none, pt(1, 3), pt(9, 3));
    const b = corridorRoute(empty, pt(1, 3), pt(9, 3));
    expect(a?.length).toBe(9);
    expect(Array.from(b ?? [])).toEqual(Array.from(a ?? [1]));
  });
});

describe('corridorRoute: a field that loops', () => {
  it('is null at the step cap rather than a hang', () => {
    const f = new FlowField(3, 1);
    f.dirs.fill(255);
    f.dirs[0] = 0; // E
    f.dirs[1] = 4; // W: tile 0 and 1 send each other round forever
    const loop: RouteSource = { width: 3, height: 1, vehicleMask: new Uint8Array(3), roadMask: null, fieldFor: () => f };
    expect(corridorRoute(loop, pt(0, 0), pt(2, 0))).toBeNull();
  });
});

describe('corridorRoute: relief', () => {
  it('bends round a hill as a unit does (the field prices the climb)', () => {
    const g = parse(['.........', '.........', '.........']);
    const elevation = new Uint8Array(27);
    for (let y = 0; y < 3; y++) elevation[y * 9 + 4] = 3; // a ridge across every row at x=4
    const flat = makeRouteSource(9, 3, g.vehicle, new Uint8Array(27), null);
    const hill = makeRouteSource(9, 3, g.vehicle, elevation, null);
    const a = corridorRoute(flat, pt(0, 1), pt(8, 1));
    const b = corridorRoute(hill, pt(0, 1), pt(8, 1));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Every route crosses the full-height ridge, so the climb is paid once either way: same length.
    expect(b?.length).toBe(a?.length);
    // A knoll with a way round, though, is skirted.
    const knoll = new Uint8Array(27);
    knoll[1 * 9 + 4] = 9;
    const k = corridorRoute(makeRouteSource(9, 3, g.vehicle, knoll, null), pt(0, 1), pt(8, 1));
    expect(k).not.toBeNull();
    expect(Array.from(k ?? [])).not.toContain(1 * 9 + 4);
  });
});
