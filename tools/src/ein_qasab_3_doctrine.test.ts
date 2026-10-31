// The lower causeway's doctrine (Ein Qasab III, "One Road", GH-912 MDD 3.3), as assertions.
//
// The mission rests on three claims that a drawn sketch cannot settle, so each is driven through
// the real Sim (the real `FlowField` masks, the real line of sight) and paired with a control
// that turns the one feature back into plain ground:
//
//   1. no vehicle reaches either island (the marsh flattened: both are reachable);
//   2. every vehicle route from the south bank to the north crosses the causeway, in BOTH
//      channels (the marsh flattened: sealing the causeway cuts nothing);
//   3. the reverse slope behind the lip is dead ground from the hamlet terrace's south edge, and
//      from everything south of the houses (the relief ironed flat: it is seen).
//
// Without the controls "no vehicle reaches the island" also passes when the island was never a
// vehicle destination (a wall all round it, a goal on a blocked tile), and "dead ground" also
// passes when nothing could see anything. Oracles are literals measured on the committed map.
//
// What the sight half proves and does not: OBSERVER has sight_tiles 48, so every `visible` is a
// TERRAIN-AND-LOS fact, not a claim about what the Rif's own units (sight 9-11) can see.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];

const SHIPPED = maps.ein_qasab_3 as MapJson;
const W = SHIPPED.width;

function marker(name: string): Pt {
  const raw = SHIPPED.markers?.[name];
  if (!raw || raw.length < 2 || raw[0] === undefined || raw[1] === undefined) throw new Error(`ein_qasab_3 has no "${name}" marker`);
  return [raw[0], raw[1]];
}

/** The same ground with every marsh tile turned back into open ground. */
const flatMarsh = (json: MapJson): MapJson => ({ ...json, rows: json.rows.map((r) => r.split('~').join('.')) });

/** The same ground with the relief ironed out. */
const flatRelief = (json: MapJson): MapJson => ({ ...json, elevation: (json.elevation ?? []).map((r) => '0'.repeat(r.length)) });

/** The same ground with the causeway's tile (x 24) turned into marsh on the given rows. */
const seal = (json: MapJson, ys: readonly number[]): MapJson => ({
  ...json,
  rows: json.rows.map((r, y) => (ys.includes(y) ? r.slice(0, 24) + '~' + r.slice(25) : r)),
});

/** The same ground with a rectangle of tiles turned into basalt. */
const wall = (json: MapJson, x0: number, y0: number, x1: number, y1: number): MapJson => ({
  ...json,
  rows: json.rows.map((r, y) => (y >= y0 && y <= y1 ? r.slice(0, x0) + '^'.repeat(x1 - x0 + 1) + r.slice(x1 + 1) : r)),
});

function load(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 512 });
  applyTerrain(map, sim);
  return { map, sim };
}

/** Every tile from which the real `FlowField` for this domain reaches `goal` (the goal included). */
function reaching(json: MapJson, domain: 'foot' | 'vehicle', goal: Pt): Set<number> {
  const { map, sim } = load(json);
  const field = new FlowField(map.width, map.height);
  field.compute(domain === 'foot' ? sim.blocked : sim.blockedVehicle, sim.elevation, goal[0], goal[1]);
  const out = new Set<number>();
  for (let t = 0; t < map.width * map.height; t++) {
    if (t === goal[1] * map.width + goal[0] || (field.dirs[t] ?? DIR_NONE) !== DIR_NONE) out.add(t);
  }
  return out;
}

const inBox = (set: Set<number>, x0: number, y0: number, x1: number, y1: number): number => {
  let n = 0;
  for (const t of set) {
    const x = t % W;
    const y = Math.floor(t / W);
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) n++;
  }
  return n;
};

/** The tiles of the shortest route, off the real `FlowField`, start included; `null` for no route. */
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
/** Tiles of the path on the causeway itself: column 24 inside either channel (rows 17-19, 29-31). */
const causewayTiles = (p: Pt[] | null): number => (p ?? []).filter(([x, y]) => x === 24 && ((y >= 17 && y <= 19) || (y >= 29 && y <= 31))).length;

// The islands and the islet, as boxes (rows 20-28 are the dry band between the channels; the
// meanders at x 17-18 and 30-31 split it in three).
const WEST_ISLAND: readonly [number, number, number, number] = [0, 20, 16, 28];
const EAST_ISLAND: readonly [number, number, number, number] = [31, 20, 47, 28];
const MILL_ISLET: readonly [number, number, number, number] = [18, 20, 30, 28];
const KDF = marker('kdf_start');
const CAMP_DOOR = marker('camp_door');
const HEAD = marker('causeway_head');

describe('no vehicle reaches either island', () => {
  it('a wheel from the start line reaches the mill islet and nothing of either island', () => {
    const veh = reaching(SHIPPED, 'vehicle', KDF);
    expect(inBox(veh, ...MILL_ISLET), 'mill islet').toBe(95);
    expect(inBox(veh, ...WEST_ISLAND), 'west island').toBe(0);
    expect(inBox(veh, ...EAST_ISLAND), 'east island').toBe(0);
  });

  it('control: a rifleman reaches all three, and with the marsh flattened a wheel reaches the islands too', () => {
    const foot = reaching(SHIPPED, 'foot', KDF);
    expect(inBox(foot, ...WEST_ISLAND)).toBe(153);
    expect(inBox(foot, ...EAST_ISLAND)).toBe(153);
    expect(inBox(foot, ...MILL_ISLET)).toBeGreaterThan(100);
    const veh = reaching(flatMarsh(SHIPPED), 'vehicle', KDF);
    expect(inBox(veh, ...WEST_ISLAND)).toBe(153);
    expect(inBox(veh, ...EAST_ISLAND)).toBe(153);
  });

  it('from the camp door the west island grove (4,21) is 20 steps on foot and no route at all by wheel', () => {
    const island: Pt = [4, 21];
    expect(steps(route(SHIPPED, 'foot', CAMP_DOOR, island))).toBe(20);
    expect(route(SHIPPED, 'vehicle', CAMP_DOOR, island)).toBeNull();
    expect(steps(route(flatMarsh(SHIPPED), 'vehicle', CAMP_DOOR, island))).not.toBeNull();
  });
});

describe('every vehicle route south to north crosses the causeway', () => {
  it('the start line reaches the head in 35 steps by wheel, with all six causeway tiles on the way', () => {
    const veh = route(SHIPPED, 'vehicle', KDF, HEAD);
    expect(steps(veh)).toBe(35);
    expect(causewayTiles(veh)).toBe(6);
    expect(steps(route(SHIPPED, 'foot', KDF, HEAD))).toBe(31);
  });

  it('sealing the causeway in either channel, alone, cuts the whole north bank off from every wheel', () => {
    // 722 north-bank tiles (y <= 16) are reachable by wheel from the start line; seal the
    // causeway in ONE row of ONE channel and none is. A second road would leave some.
    expect(inBox(reaching(SHIPPED, 'vehicle', KDF), 0, 0, 47, 16)).toBe(722);
    for (const [label, ys] of [
      ['north channel', [18]],
      ['south channel', [30]],
    ] as const) {
      const cut = seal(SHIPPED, ys);
      expect(inBox(reaching(cut, 'vehicle', KDF), 0, 0, 47, 16), `${label} sealed: north bank by wheel`).toBe(0);
      // A rifleman wades round the seal: the north bank is still all his.
      expect(inBox(reaching(cut, 'foot', KDF), 0, 0, 47, 16), `${label} sealed: north bank on foot`).toBe(757);
    }
  });

  it('control: with the marsh flattened the same seal cuts nothing', () => {
    // Without this the zero above also passes when the north bank was never a vehicle destination.
    const cut = seal(flatMarsh(SHIPPED), [18, 30]);
    expect(inBox(reaching(cut, 'vehicle', KDF), 0, 0, 47, 16)).toBe(722);
  });

  it('the marsh costs the column +5 from the camp door and +4 from the start line', () => {
    expect(steps(route(SHIPPED, 'vehicle', CAMP_DOOR, HEAD))).toBe(33);
    expect(steps(route(flatMarsh(SHIPPED), 'vehicle', CAMP_DOOR, HEAD))).toBe(28);
    expect(steps(route(flatMarsh(SHIPPED), 'vehicle', KDF, HEAD))).toBe(31);
  });

  it('the mill is one channel away: 21 steps by wheel over three causeway tiles, 16 on foot', () => {
    const mill = marker('mill');
    const veh = route(SHIPPED, 'vehicle', CAMP_DOOR, mill);
    expect(steps(veh)).toBe(21);
    expect(causewayTiles(veh)).toBe(3);
    expect(steps(route(SHIPPED, 'foot', CAMP_DOOR, mill))).toBe(16);
  });

  it('the enemy comes down from the north and never needs the causeway: rif_nw 15 and rif_n 22 to the head', () => {
    expect(steps(route(SHIPPED, 'vehicle', marker('rif_nw'), HEAD))).toBe(15);
    expect(steps(route(SHIPPED, 'vehicle', marker('rif_n'), HEAD))).toBe(22);
    expect(causewayTiles(route(SHIPPED, 'vehicle', marker('rif_n'), HEAD))).toBe(0);
  });
});

describe("Hallaq's man has one road out, and it is the protected one", () => {
  const FERRY: Pt = [25, 14];
  const NORTH_EXIT = marker('north_exit');
  const inHamlet = (p: Pt): boolean => p[0] >= 8 && p[0] < 38 && p[1] >= 8 && p[1] < 12;

  it('the truck at the yard reaches north_exit in 14 steps, 4 of them inside the flagged hamlet zone', () => {
    const veh = route(SHIPPED, 'vehicle', FERRY, NORTH_EXIT);
    expect(steps(veh)).toBe(14);
    expect((veh ?? []).filter(inHamlet)).toHaveLength(4);
  });

  it('control: refusing the zone altogether costs +20, round either end of the terrace', () => {
    const detour = wall(SHIPPED, 8, 8, 37, 11);
    const veh = route(detour, 'vehicle', FERRY, NORTH_EXIT);
    expect(steps(veh)).toBe(34);
    expect((veh ?? []).filter(inHamlet)).toHaveLength(0);
  });
});

describe('the reverse slope is dead ground from the hamlet terrace', () => {
  const OBSERVER: UnitTypeJson = {
    id: 't_observer',
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.2 },
    sensors: { optics: 1, sight_tiles: 48, signature: 0.6 },
  };

  /** Open, cover-free tiles of a rectangle on the committed map, thinned. */
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

  /** How many (observer, target) pairs see each other, with one sim for the lot. */
  function sight(json: MapJson, observers: readonly Pt[], targets: readonly Pt[]): { pairs: number; seen: number } {
    const { sim } = load(json);
    const t = sim.addUnitType(OBSERVER);
    const o = observers.map((p) => sim.spawn(t, 0, fx.from(p[0] + 0.5), fx.from(p[1] + 0.5)));
    const g = targets.map((p) => sim.spawn(t, 1, fx.from(p[0] + 0.5), fx.from(p[1] + 0.5)));
    for (let i = 0; i < 4 * TICKS_PER_SECOND; i++) sim.tick();
    let seen = 0;
    for (const a of o) {
      for (const b of g) {
        const d = sim.debugDetection(a, b);
        if (!d) throw new Error(`no detection record for ${a} -> ${b}`);
        if (d.visible) seen++;
      }
    }
    return { pairs: o.length * g.length, seen };
  }

  // Rows 0-2 are the reverse slope (level 3) behind the lip (level 5, rows 4-7); row 3 is the
  // level-4 shelf the reserve stands on. The hamlet terrace is level 4: its south edge is row 10.
  const slope = tiles(14, 0, 34, 3, 2, 1);
  const shelf = tiles(14, 3, 34, 1, 2, 1);
  const terraceEdge = tiles(0, 10, 48, 1, 2, 1);
  const terraceTop = tiles(0, 8, 48, 1, 2, 1);
  const head = tiles(19, 11, 10, 6, 2, 2);
  const lip = tiles(0, 5, 48, 1, 2, 1);

  it('sees nothing of rows 0-2 from the terrace edge or from the terrace top', () => {
    expect(slope.length).toBeGreaterThan(40);
    expect(terraceEdge.length).toBeGreaterThan(10);
    expect(sight(SHIPPED, terraceEdge, slope).seen).toBe(0);
    expect(sight(SHIPPED, terraceTop, slope).seen).toBe(0);
  });

  it('sees nothing of rows 0-3 from the causeway head or the riser: the reserve is hidden from the column', () => {
    const rows03 = [...slope, ...shelf];
    expect(head.length).toBeGreaterThan(10);
    expect(sight(SHIPPED, head, rows03).seen).toBe(0);
    expect(sight(SHIPPED, tiles(0, 11, 48, 1, 2, 1), rows03).seen).toBe(0);
  });

  it('control: with the relief ironed flat the terrace edge sees most of the slope', () => {
    const r = sight(flatRelief(SHIPPED), terraceEdge, slope);
    expect(r.seen / r.pairs).toBeGreaterThan(0.6);
  });

  it('control: the lip itself sees all of it, and the terrace edge does see the level-4 shelf', () => {
    const fromLip = sight(SHIPPED, lip, slope);
    expect(fromLip.seen).toBe(fromLip.pairs);
    // Row 3 stands at the terrace's own level, so the lip does not hide it from the edge: the
    // reserve is dead ground to the column (above), not to a man standing on the terrace.
    const shelfSeen = sight(SHIPPED, terraceEdge, shelf);
    expect(shelfSeen.seen / shelfSeen.pairs).toBeGreaterThan(0.5);
  });
});
