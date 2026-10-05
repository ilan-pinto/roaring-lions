// Beit Sahwan II, III and IV on their own ground (GH-382), as assertions. Mission I keeps
// `beit_sahwan_outskirts` (the golden gate's `quiet`/`vehicle` scenes and the menu diorama stand on it)
// and the breach keeps `marj_perimeter`; before this the other three missions were played on three
// copies of the outskirts that differed by a wall and a rubble band (92-98% the same tiles).
//
// Every claim a briefing makes about the ground is walked through the real `FlowField` and the
// real `Sim` sight rule, and every positive is paired with a CONTROL built from the same map
// with one thing changed, so a route or a blind spot that exists for another reason cannot pass
// for the one claimed.
//
// What each mission's briefing rests on, and where it is pinned:
//   II   you hold the top terrace of a stepped hillside; a dry channel of boulders lies at its foot
//        and wheels cross it only at three fords; a terrace wall with four gates stands on the
//        step; the tunnel's mouth is in a yard in the town strip and its vent is in a sump in the
//        channel bed, two levels below the line.
//   III  the old town: two boulevards cross at a square with the civic hall on it, the clinic block
//        lies south of the crossing behind a walled yard, every alley is rubble and so foot-only
//        (armour keeps to the boulevards), and sight in the streets is short.
//   IV   a rubble quarter with one main road, and the shaft head on the floor of a limestone pit:
//        walls on three sides, scree down the fourth (foot only), one haul ramp for wheels; all
//        four routes' mouths in the town zone.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, missions, parseMap, structures as structureCatalogue, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];
const J = (id: string): MapJson => (maps as unknown as Record<string, MapJson>)[id];

function world(json: MapJson) {
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
  applyTerrain(map, sim);
  const idx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue))
    idx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  for (const b of map.structures) sim.addStructure(idx.get(b.type) as number, b.tiles);
  return { map, sim };
}

/** Steps on the flow-field route from `from` to `to` (slope priced in), or null when there is none. */
function route(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): number | null {
  const { map, sim } = world(json);
  const field = new FlowField(map.width, map.height);
  field.compute(domain === 'foot' ? sim.blocked : sim.blockedVehicle, sim.elevation, to[0], to[1]);
  let [x, y] = from;
  for (let n = 0; n <= map.width * map.height; n++) {
    if (x === to[0] && y === to[1]) return n;
    const d = field.dirs[y * map.width + x];
    if (d === undefined || d === DIR_NONE) return null;
    x += DIR_DX[d] ?? 0;
    y += DIR_DY[d] ?? 0;
  }
  return null;
}

/** The tiles a route steps on, in order (including both ends), or null. */
function path(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): Pt[] | null {
  const { map, sim } = world(json);
  const field = new FlowField(map.width, map.height);
  field.compute(domain === 'foot' ? sim.blocked : sim.blockedVehicle, sim.elevation, to[0], to[1]);
  let [x, y] = from;
  const out: Pt[] = [[x, y]];
  for (let n = 0; n <= map.width * map.height; n++) {
    if (x === to[0] && y === to[1]) return out;
    const d = field.dirs[y * map.width + x];
    if (d === undefined || d === DIR_NONE) return null;
    x += DIR_DX[d] ?? 0;
    y += DIR_DY[d] ?? 0;
    out.push([x, y]);
  }
  return null;
}

const OBSERVER = (sight: number): UnitTypeJson => ({
  id: `t_watch_${sight}`,
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: sight, signature: 0.6 },
});

/** Does a watcher on `a` see a body on `b` after twelve simulated seconds? `sight` defaults to far
 *  past anything on the map, so only terrain can hide. */
function sees(json: MapJson, a: Pt, b: Pt, sight = 48): boolean {
  // The structures are registered on purpose: a low-profile wall (`=`) only stops being a sight
  // blocker once its structure entity exists (the sim reads `low_profile` off the entity), so a
  // terrain-only world draws every field wall as a rock.
  const { sim } = world(json);
  const tw = sim.addUnitType(OBSERVER(sight));
  const tt = sim.addUnitType({ ...OBSERVER(sight), id: 't_target' });
  const w = sim.spawn(tw, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const t = sim.spawn(tt, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  const d = sim.debugDetection(w, t);
  if (!d) throw new Error(`no detection record between ${a} and ${b}`);
  return d.visible;
}

const mk = (json: MapJson, name: string): Pt => {
  const m = json.markers?.[name];
  if (!m) throw new Error(`no marker ${name}`);
  return [m[0], m[1]];
};
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const edited = (json: MapJson, f: (rows: string[][], elev: string[][] | null) => void): MapJson => {
  const rows = json.rows.map((r) => r.split(''));
  const elev = json.elevation ? json.elevation.map((r) => r.split('')) : null;
  f(rows, elev);
  return { ...json, rows: rows.map((r) => r.join('')), ...(elev ? { elevation: elev.map((r) => r.join('')) } : {}) } as MapJson;
};
const replaceAll = (json: MapJson, from: string, to: string): MapJson =>
  edited(json, (rows) => rows.forEach((r) => r.forEach((c, x) => { if (c === from) r[x] = to; })));
const tile = (json: MapJson, x: number, y: number) => json.rows[y][x];
const elevAt = (json: MapJson, x: number, y: number) => Number(json.elevation![y][x]);
const inZone = (json: MapJson, zone: string, p: Pt) => {
  const [zx, zy, zw, zh] = json.zones![zone];
  return p[0] >= zx && p[0] < zx + zw && p[1] >= zy && p[1] < zy + zh;
};


type Mission = {
  map: { file: string; player_start: Pt };
  structures?: { type: string; at: Pt; size: Pt }[];
  starting_force: { at: Pt }[];
  roe?: { flagged_zones?: string[] };
  enemy: {
    garrison: { at?: number[]; tag?: string; in_tunnel?: string; digs?: string; marker?: string; stance?: { kind: string; building?: Pt } }[];
    waves: { to: string; units: { from: string }[] }[];
  };
  civilians?: { refuge: string; groups: { at: number[]; group?: string }[] };
};
const missionOf = (id: string) => (missions as unknown as Record<string, Mission>)[id];
/** The routes an objective's zone claims: those whose MOUTH lies inside it (mission.ts, `collapse`). */
const routesIn = (json: MapJson, zone: string) => (json.tunnels ?? []).filter((t) => inZone(json, zone, [t.mouth[0], t.mouth[1]])).map((t) => t.id);
const flatten = (json: MapJson): MapJson => edited(json, (_r, e) => { if (e) for (const row of e) row.fill('1'); });
const fl = (p: readonly number[]): Pt => [Math.floor(p[0]), Math.floor(p[1])];
/** Cost of the foot route (slope priced in) from a tile to a goal, straight off the flow field. */
function footCost(json: MapJson, from: Pt, to: Pt): number {
  const { map, sim } = world(json);
  const field = new FlowField(map.width, map.height);
  field.compute(sim.blocked, sim.elevation, to[0], to[1]);
  return field.costAt(from[1] * map.width + from[0]);
}
/** Structures of one type on a map, as the loader reads them. */
const structuresOf = (json: MapJson, type: string) => world(json).map.structures.filter((s) => s.type === type);
const footprint = (s: { tiles: number[] }, width: number) => {
  const xs = s.tiles.map((t) => t % width);
  const ys = s.tiles.map((t) => Math.floor(t / width));
  return `${Math.max(...xs) - Math.min(...xs) + 1}x${Math.max(...ys) - Math.min(...ys) + 1}:${s.tiles.length}`;
};

describe('every mission names a map it owns, and every marker stands on passable ground', () => {
  for (const [mid, file, grid] of [
    ['beit_sahwan_2_foothold', 'beit_sahwan_2', true],
    ['beit_sahwan_3_clearance', 'beit_sahwan_3', false],
    ['beit_sahwan_4_subterranean', 'beit_sahwan_4', true],
  ] as const) {
    it(`${mid} plays on ${file}, an arid 48x48 map${grid ? ' with relief 0-3' : ' with no relief at all'}`, () => {
      expect(missionOf(mid).map.file).toBe(file);
      const m = J(file);
      expect([m.width, m.height, m.terrain]).toEqual([48, 48, 'arid']);
      if (grid) expect([...new Set(m.elevation!.join(''))].sort().join('')).toBe('0123');
      else expect(m.elevation).toBeUndefined();
      const { sim, map } = world(m);
      for (const [name, [x, y]] of Object.entries(m.markers!)) expect(sim.blocked[y * map.width + x], `${file} ${name}`).toBe(0);
      for (const t of m.tunnels ?? []) for (const [x, y] of [t.mouth, t.vent]) expect(sim.blocked[y * map.width + x], `${file} ${t.id} (${x},${y})`).toBe(0);
      const p = missionOf(mid).map.player_start;
      expect(sim.blocked[p[1] * map.width + p[0]], `${file} player_start`).toBe(0);
      for (const f of missionOf(mid).starting_force) expect(sim.blocked[f.at[1] * map.width + f.at[0]], `${file} force at ${f.at}`).toBe(0);
    });
  }
  it('II, III and IV no longer share a file with I (the outskirts) or with each other', () => {
    expect(missionOf('beit_sahwan_1_recon').map.file).toBe('beit_sahwan_outskirts');
    expect(new Set(['beit_sahwan_1_recon', 'beit_sahwan_2_foothold', 'beit_sahwan_3_clearance', 'beit_sahwan_4_subterranean'].map((x) => missionOf(x).map.file)).size).toBe(4);
  });
  it('no mission garrisons a body on a wall, and every `garrison` stance names a building tile', () => {
    for (const mid of ['beit_sahwan_2_foothold', 'beit_sahwan_3_clearance', 'beit_sahwan_4_subterranean']) {
      const m = J(missionOf(mid).map.file);
      const { sim, map } = world(m);
      for (const g of missionOf(mid).enemy.garrison) {
        if (g.stance?.kind === 'garrison') expect(sim.structureAt(g.stance.building![0], g.stance.building![1]), `${mid} ${g.tag}`).toBeGreaterThanOrEqual(0);
        else if (g.at && !g.in_tunnel) expect(sim.blocked[Math.floor(g.at[1]) * map.width + Math.floor(g.at[0])], `${mid} ${g.tag ?? g.at}`).toBe(0);
      }
    }
  });
});

describe('II: the western terraces', () => {
  const m = J('beit_sahwan_2');
  const ms = missionOf('beit_sahwan_2_foothold');
  const kdf = mk(m, 'kdf_assembly');
  const town = mk(m, 'town_center');
  const mortar = mk(m, 'mortar_line');
  const west = (m.tunnels ?? [])[0];
  const FORD_ROWS = [7, 8, 9, 20, 21, 22, 23, 36, 37, 38];
  const bedCols = (y: number): number[] => { const out: number[] = []; for (let x = 15; x <= 21; x++) if (tile(m, x, y) === 'b') out.push(x); return out; };

  it('you hold the top of a stepped hillside: the line stands at level 3, the terraces step down through 2 and 1 to the channel bed at 0, and the ground climbs again to the town (1 at the tunnel mouth, 2 at the crossroads, 3 at the mortar line)', () => {
    for (const f of ms.starting_force) expect(elevAt(m, f.at[0], f.at[1]), `force at ${f.at}`).toBe(3);
    const camp = ms.structures!.find((s) => s.type === 'camp')!;
    expect(elevAt(m, camp.at[0], camp.at[1])).toBe(3);
    expect(elevAt(m, kdf[0], kdf[1])).toBe(3);
    expect(elevAt(m, 11, 20)).toBe(2);
    expect(elevAt(m, 14, 20)).toBe(1);
    expect(elevAt(m, west.vent[0], west.vent[1])).toBe(0);
    expect(elevAt(m, 24, 12)).toBe(0);
    expect(elevAt(m, west.mouth[0], west.mouth[1])).toBe(1);
    expect(elevAt(m, town[0], town[1])).toBe(2);
    expect(elevAt(m, mortar[0], mortar[1])).toBe(3);
  });
  it('the dry channel is a three-wide bed of boulders on every row that is not a ford (bar the two rows of the sump), and the three fords are the only rows without one', () => {
    for (let y = 0; y < 48; y++) {
      if (FORD_ROWS.includes(y)) expect(bedCols(y), `ford row ${y}`).toEqual([]);
      else expect(bedCols(y).length, `bed row ${y}`).toBe(y === 25 || y === 26 ? 1 : 3);
    }
    for (let y = 0; y < 48; y++) for (const x of bedCols(y)) expect(elevAt(m, x, y), `bed (${x},${y})`).toBe(0);
  });
  it('wheels cross the channel only at its fords: a crossing straight over the bed is long for a vehicle and nine steps for a rifleman', () => {
    const a: Pt = [24, 31];
    const b: Pt = [15, 31];
    expect(route(m, 'foot', a, b)).toBe(9);
    expect(route(m, 'vehicle', a, b)!).toBeGreaterThanOrEqual(13);
    const p = path(m, 'vehicle', a, b)!;
    expect(p.some(([x, y]) => tile(m, x, y) === 'b')).toBe(false);
    const bedX = (y: number) => 17 + (y < 14 ? -1 : y > 33 ? 1 : 0);
    const bedSteps = p.filter(([x, y]) => x >= bedX(y) && x <= bedX(y) + 2).map(([, y]) => y);
    expect(bedSteps.length).toBeGreaterThan(0);
    for (const y of bedSteps) expect(FORD_ROWS, `entered the bed at row ${y}`).toContain(y);
  });
  it('control: with no boulders the same crossing is nine steps for a vehicle too, so the bed is what bends it', () => {
    const bare = replaceAll(m, 'b', '.');
    expect(route(bare, 'vehicle', [24, 31], [15, 31])).toBe(9);
  });
  it('shut the three fords and no vehicle gets from the town to the line, while the infantry still do', () => {
    expect(route(m, 'vehicle', town, kdf)).not.toBeNull();
    const sealed = edited(m, (rows) => { for (const y of FORD_ROWS) for (let x = 16; x <= 20; x++) rows[y][x] = 'b'; });
    expect(route(sealed, 'vehicle', town, kdf)).toBeNull();
    expect(route(sealed, 'foot', town, kdf)).not.toBeNull();
  });
  it('the terrace wall at x=9 has four gates, and the road\'s is the only one two wide: the vehicle route crosses the wall at the road gate', () => {
    const gates: number[] = [];
    for (let y = 11; y <= 35; y++) if (tile(m, 9, y) !== '=' && tile(m, 9, y) !== '^') gates.push(y);
    expect(gates).toEqual([14, 21, 22, 29]);
    const p = path(m, 'vehicle', [14, 25], [4, 25])!;
    const through = p.filter(([x]) => x === 9).map(([, y]) => y);
    expect(through).toHaveLength(1);
    expect(gates).toContain(through[0]);
    expect(p.length - 1).toBeGreaterThan(10);
  });
  it('control: take the wall down and the same walk is the ten steps it looks like', () => {
    const noWall = edited(m, (rows) => { for (let y = 11; y <= 35; y++) rows[y][9] = '.'; });
    expect(route(noWall, 'foot', [14, 25], [4, 25])).toBe(10);
    expect(route(m, 'foot', [14, 25], [4, 25])!).toBeGreaterThan(10);
  });
  it('the attack climbs at you: the foot walk from the town to the line costs at least two levels of climb more than the same ground flattened', () => {
    const climbed = footCost(m, town, kdf);
    const level = footCost(flatten(m), town, kdf);
    expect(climbed - level).toBeGreaterThanOrEqual(20);
  });
  it('the line sees down into the bed along most of its length (the crags on the brow shade three of seventeen rows), and the sheds in the middle terrace hide the camp from the vent', () => {
    const rows = [8, 10, 12, 14, 16, 18, 20, 22, 26, 28, 30, 32, 34, 38, 40, 42, 44];
    const visible = (json: MapJson) => rows.filter((y) => sees(json, [7, y], [y < 14 ? 17 : y > 33 ? 19 : 18, y])).length;
    expect(visible(m)).toBe(14);
    // control: take the crags away and the line sees the bed on every sampled row
    const uncragged = edited(m, (r, e) => { for (let y = 0; y < r.length; y++) for (let x = 0; x < r[y].length; x++) if (r[y][x] === '^') { r[y][x] = '.'; e![y][x] = x <= 12 ? '2' : '1'; } });
    expect(visible(uncragged)).toBe(rows.length);
    const vent: Pt = [west.vent[0], west.vent[1]];
    expect(sees(m, kdf, vent)).toBe(false);
    expect(sees(replaceAll(m, 's', '.'), kdf, vent)).toBe(true);
  });
  it('the tunnel: one route, the mouth in a yard between houses inside tunnel_mouth_west, the vent in a clean sump in the channel bed, 14 tiles from the camp', () => {
    expect(routesIn(m, 'tunnel_mouth_west')).toEqual(['bs_tn_west']);
    expect((m.tunnels ?? []).map((t) => t.id)).toEqual(['bs_tn_west']);
    expect(tile(m, west.mouth[0] - 2, west.mouth[1])).toBe('h');
    expect(tile(m, west.mouth[0] + 2, west.mouth[1])).toBe('h');
    expect(tile(m, west.vent[0], west.vent[1])).toBe('.');
    expect(west.vent[0]).toBeGreaterThanOrEqual(17);
    expect(west.vent[0]).toBeLessThanOrEqual(19);
    expect(dist([west.vent[0], west.vent[1]], kdf)).toBeGreaterThan(13);
    expect(dist([west.vent[0], west.vent[1]], kdf)).toBeLessThan(15);
    expect(inZone(m, 'west_approach', [west.vent[0], west.vent[1]])).toBe(false);
    expect(ms.enemy.garrison.filter((g) => g.in_tunnel === 'bs_tn_west').map((g) => g.at)).toEqual([[west.mouth[0] + 0.5, west.mouth[1] + 0.5]]);
    expect(ms.enemy.garrison.filter((g) => g.digs === 'bs_tn_west')).toHaveLength(1);
  });
  it('the hold zone is the terraces and stops short of the channel: it holds the camp and every starting tile and no boulder', () => {
    const [zx, zy, zw, zh] = m.zones!.west_approach;
    expect(zx + zw).toBeLessThan(17);
    expect(inZone(m, 'west_approach', kdf)).toBe(true);
    for (const f of ms.starting_force) expect(inZone(m, 'west_approach', f.at), `force at ${f.at}`).toBe(true);
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) expect(tile(m, x, y), `(${x},${y})`).not.toBe('b');
  });
  it('the waves come from the road in the town: both sources are road tiles and each reaches the line on foot, the mortar line on wheels too', () => {
    expect(ms.enemy.waves.map((w) => [w.units[0].from, w.to])).toEqual([['town_center', 'kdf_assembly'], ['town_center', 'kdf_assembly'], ['mortar_line', 'kdf_assembly']]);
    expect(tile(m, town[0], town[1])).toBe('r');
    expect(route(m, 'foot', town, kdf)).not.toBeNull();
    expect(route(m, 'foot', mortar, kdf)).not.toBeNull();
    expect(route(m, 'vehicle', mortar, kdf)).not.toBeNull();
  });
  it('the town is a skyline strip of mixed buildings on the east edge, and no more than two of one footprint stand side by side', () => {
    const { map } = world(m);
    const strip = map.structures.filter((s) => s.tiles.every((t) => t % map.width >= 28));
    expect(strip.length).toBeGreaterThanOrEqual(25);
    expect(new Set(strip.map((s) => s.type)).size).toBeGreaterThanOrEqual(4);
    const houses = strip.filter((s) => s.type === 'house');
    expect(new Set(houses.map((s) => footprint(s, map.width))).size).toBeGreaterThanOrEqual(4);
    expect(map.structures.filter((s) => s.tiles.some((t) => t % map.width < 16 && s.type !== 'wall' && s.type !== 'shanty'))).toHaveLength(0);
  });
});

describe('III: the old town', () => {
  const m = J('beit_sahwan_3');
  const ms = missionOf('beit_sahwan_3_clearance');
  const start = mk(m, 'kdf_assembly');
  const centre = mk(m, 'town_center');
  const atgm = fl(ms.enemy.garrison.find((g) => g.tag === 'bs_hvt_atgm')!.at!);
  const cellCentre = fl(ms.enemy.garrison.find((g) => g.tag === 'bs_cell_centre')!.at!);
  const BLOCKS: [string, number, number, number, number][] = [
    ['NW', 12, 3, 10, 17], ['NC', 23, 3, 5, 14], ['NE', 30, 3, 7, 14], ['E', 38, 3, 4, 14],
    ['SW', 12, 24, 7, 21], ['SC', 23, 35, 5, 10], ['SE', 30, 35, 7, 10],
  ];
  /** Open tiles of a block the start line can reach, per domain. */
  function reach(json: MapJson, domain: 'foot' | 'vehicle', x0: number, y0: number, w: number, h: number): number {
    const { map, sim } = world(json);
    const blocked = domain === 'foot' ? sim.blocked : sim.blockedVehicle;
    const field = new FlowField(map.width, map.height);
    field.compute(blocked, sim.elevation, start[0], start[1]);
    let n = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (blocked[y * map.width + x] === 0 && field.dirs[y * map.width + x] !== DIR_NONE) n++;
    return n;
  }

  it('there is no relief: the streets are the relief, and the town stands on one flat plain', () => {
    expect(m.elevation).toBeUndefined();
  });
  it('the town is dense and mixed: fifty buildings or more of six kinds, and the houses come in five footprints or more', () => {
    const { map } = world(m);
    const real = map.structures.filter((s) => s.type !== 'wall');
    expect(real.length).toBeGreaterThanOrEqual(50);
    expect(new Set(real.map((s) => s.type))).toEqual(new Set(['house', 'apartment', 'shanty', 'warehouse', 'hall', 'clinic']));
    expect(new Set(real.filter((s) => s.type === 'house').map((s) => footprint(s, map.width))).size).toBeGreaterThanOrEqual(5);
  });
  it('two boulevards cross at the square: a two-wide road runs the whole way east-west and the whole way north-south, and the town centre is at the crossing', () => {
    for (let x = 8; x < 48; x++) for (const y of [21, 22]) expect(tile(m, x, y), `(${x},${y})`).toBe('r');
    for (let y = 2; y < 46; y++) for (const x of [28, 29]) expect(tile(m, x, y), `(${x},${y})`).toBe('r');
    expect(centre).toEqual([28, 21]);
  });
  it('the square is open ground with the civic hall on its north edge, and nothing but the hall stands on it', () => {
    const { map } = world(m);
    const [zx, zy, zw, zh] = [24, 18, 10, 8];
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) expect(world(m).sim.blocked[y * map.width + x], `(${x},${y})`).toBe(0);
    const hall = structuresOf(m, 'hall');
    expect(hall).toHaveLength(1);
    expect(hall[0].tiles.map((t) => t % map.width).every((x) => x >= 24 && x < 34)).toBe(true);
    expect(hall[0].tiles.map((t) => Math.floor(t / map.width)).every((y) => y < 18)).toBe(true);
  });
  it('the clinic block is south of the crossing: a walled yard with the clinic in it, three gates, and Sahim\'s cell standing in the open on its north edge', () => {
    const [zx, zy, zw, zh] = m.zones!.clinic;
    expect(zy).toBeGreaterThan(22);
    expect(ms.roe!.flagged_zones).toEqual(['clinic']);
    const { map, sim } = world(m);
    const k = structuresOf(m, 'clinic');
    expect(k).toHaveLength(1);
    for (const t of k[0].tiles) expect(inZone(m, 'clinic', [t % map.width, Math.floor(t / map.width)])).toBe(true);
    expect(inZone(m, 'clinic', cellCentre)).toBe(true);
    expect(inZone(m, 'town', cellCentre)).toBe(true);
    expect(sim.blocked[cellCentre[1] * map.width + cellCentre[0]]).toBe(0);
    // the yard wall: a ring x19-27, y27-33, with gaps only at the gates
    let gaps = 0;
    for (let x = zx; x < zx + zw; x++) for (const y of [27, 33]) if (tile(m, x, y) !== '=') gaps++;
    for (let y = 27; y <= 33; y++) for (const x of [zx, zx + zw - 1]) if (tile(m, x, y) !== '=') gaps++;
    expect(gaps).toBe(5);
    expect(zh).toBe(8);
  });
  it('the alleys are rubble, and rubble is foot-only: in every block the vehicles reach under half of what the infantry do, and with the rubble cleared they reach all of it', () => {
    for (const [n, x, y, w, h] of BLOCKS) {
      const f = reach(m, 'foot', x, y, w, h);
      const v = reach(m, 'vehicle', x, y, w, h);
      expect(v, `${n} vehicle ${v} of ${f}`).toBeLessThan(f * 0.45);
    }
    const bare = replaceAll(m, 'b', '.');
    for (const [n, x, y, w, h] of BLOCKS) expect(reach(bare, 'vehicle', x, y, w, h), n).toBeGreaterThanOrEqual(reach(m, 'foot', x, y, w, h));
  });
  it('armour lives on the two boulevards: the vehicle route from the start line to the town centre and to the ATGM cell is as short as the foot one and runs on the boulevards', () => {
    expect(route(m, 'vehicle', start, centre)).toBe(route(m, 'foot', start, centre));
    expect(route(m, 'vehicle', start, atgm)).toBe(route(m, 'foot', start, atgm));
    for (const goal of [centre, atgm]) {
      const p = path(m, 'vehicle', start, goal)!;
      for (const [x, y] of p.filter(([x]) => x >= 12 && x <= 41)) expect(['r'].includes(tile(m, x, y)) || (y >= 19 && y <= 24), `(${x},${y})`).toBe(true);
    }
  });
  it('sight in the streets is short: the square sees a cell three tiles off at sight 5 and not one eight tiles off, and a post in a rubble alley cannot see seven tiles across the next house', () => {
    const lane = fl(ms.enemy.garrison.find((g) => g.tag === 'bs_ambush_market_lane')!.at!);
    const ne = fl(ms.enemy.garrison.find((g) => g.tag === 'bs_cell_north_east')!.at!);
    expect(sees(m, centre, lane, 5)).toBe(true);
    expect(sees(m, centre, ne, 5)).toBe(false);
    expect(sees(m, centre, ne, 9)).toBe(true);
    expect(sees(m, [13, 24], [20, 24], 12)).toBe(false);
  });
  it('control: pull the buildings down and the same alley post sees across, so it is the masonry that hides it', () => {
    let bare = m;
    for (const c of 'hasw') bare = replaceAll(bare, c, '.');
    expect(sees(bare, [13, 24], [20, 24], 12)).toBe(true);
  });
  it('the ATGM cell overlooks the east road: it stands within three tiles of it, in a low-walled nook, and covers the boulevard junction', () => {
    const road = [42, atgm[1]] as Pt;
    expect(tile(m, road[0], road[1])).toBe('r');
    expect(dist(atgm, road)).toBeLessThanOrEqual(3);
    expect(tile(m, atgm[0], atgm[1])).toBe('.');
    expect(sees(m, atgm, road, 9)).toBe(true);
    expect(sees(m, atgm, [42, 22], 9)).toBe(true);
    expect(tile(m, atgm[0] - 1, atgm[1] + 1)).toBe('=');
  });
  it('the north-block cell garrisons a house, and the mortar yard and the technicals\' road are on the east edge', () => {
    const house = ms.enemy.garrison.find((g) => g.tag === 'bs_cell_north_block')!;
    expect(tile(m, house.stance!.building![0], house.stance!.building![1])).toBe('h');
    expect(tile(m, 42, 14)).toBe('r');
    expect(tile(m, 42, 32)).toBe('r');
    expect(route(m, 'vehicle', mk(m, 'mortar_line'), centre)).not.toBeNull();
  });
  it('the people have somewhere to go: every civilian group has a foot route to the refuge in the west fields', () => {
    const refuge = mk(m, 'civ_refuge');
    expect(refuge[0]).toBeLessThan(12);
    for (const g of ms.civilians!.groups) expect(route(m, 'foot', fl(g.at), refuge), `group at ${g.at}`).not.toBeNull();
  });
});

describe('IV: the rubble quarter', () => {
  const m = J('beit_sahwan_4');
  const ms = missionOf('beit_sahwan_4_subterranean');
  const start = ms.map.player_start;
  const shaft = mk(m, 'civ_collection') && ([26, 9] as Pt);
  const collect = mk(m, 'civ_collection');
  const north = m.tunnels!.find((t) => t.id === 'bs_tn_north')!;
  const westR = m.tunnels!.find((t) => t.id === 'bs_tn_west')!;
  const RAMP = [8, 9, 10];

  it('the town claims exactly the four routes the mission names, and no other route exists on the map', () => {
    expect(routesIn(m, 'town')).toEqual(['bs_tn_west', 'bs_tn_north', 'bs_tn_souk', 'bs_tn_clinic']);
    expect((m.tunnels ?? []).map((t) => t.id)).toEqual(['bs_tn_west', 'bs_tn_north', 'bs_tn_souk', 'bs_tn_clinic']);
    const stocked = new Set(ms.enemy.garrison.map((g) => g.in_tunnel).filter(Boolean));
    expect([...stocked].sort()).toEqual(['bs_tn_clinic', 'bs_tn_north', 'bs_tn_souk']);
    for (const g of ms.enemy.garrison.filter((x) => x.in_tunnel)) {
      const t = m.tunnels!.find((r) => r.id === g.in_tunnel)!;
      expect(g.at, g.in_tunnel).toEqual([t.mouth[0] + 0.5, t.mouth[1] + 0.5]);
    }
  });
  it("the shaft head is the pit's and its route runs out under the scree: the north mouth is inside the shaft_head zone, inside a wall collar, on the quarry floor, and the vent is up on the apron", () => {
    expect(routesIn(m, 'shaft_head')).toEqual(['bs_tn_north']);
    expect(elevAt(m, north.mouth[0], north.mouth[1])).toBe(0);
    expect(tile(m, north.mouth[0] + 2, north.mouth[1])).toBe('=');
    expect(tile(m, north.mouth[0], north.mouth[1] - 2)).toBe('=');
    expect(inZone(m, 'shaft_head', [north.vent[0], north.vent[1]])).toBe(false);
    expect(elevAt(m, north.vent[0], north.vent[1])).toBe(2);
    expect(north.vent[1]).toBeGreaterThan(16);
    // a waypoint under the scree: the line passes the rim between the floor and the apron
    expect(north.waypoints!.some(([, y]) => y >= 14 && y <= 16)).toBe(true);
    expect(ms.enemy.garrison.filter((g) => g.in_tunnel === 'bs_tn_north')).toHaveLength(1);
  });
  it('the quarry is a pit: floor at level 0, rock walls at 3 round three sides, scree down the south side from the plateau at 2, and one haul ramp through the east wall', () => {
    for (let y = 5; y <= 13; y++) for (let x = 21; x <= 33; x++) expect(elevAt(m, x, y), `floor (${x},${y})`).toBe(0);
    for (let y = 3; y <= 16; y++) for (const x of [19, 20]) expect(tile(m, x, y), `west wall (${x},${y})`).toBe('^');
    for (let x = 19; x <= 35; x++) for (const y of [3, 4]) expect(tile(m, x, y), `north wall (${x},${y})`).toBe('^');
    for (let y = 3; y <= 16; y++) if (!RAMP.includes(y)) for (const x of [34, 35]) expect(tile(m, x, y), `east wall (${x},${y})`).toBe('^');
    for (const y of RAMP) for (const x of [34, 35]) expect(tile(m, x, y)).toBe('r');
    for (let y = 14; y <= 16; y++) for (let x = 21; x <= 33; x++) expect(tile(m, x, y), `scree (${x},${y})`).toBe('b');
    for (let y = 3; y <= 16; y++) for (let x = 19; x <= 35; x++) if (tile(m, x, y) === '^') expect(elevAt(m, x, y), `wall (${x},${y})`).toBe(3);
    expect(elevAt(m, 30, 18)).toBe(2);
    expect([14, 15, 16].map((y) => elevAt(m, 30, y))).toEqual([1, 1, 2]);
  });
  it('foot goes down the scree and wheels go round by the ramp: the Namer\'s way to the shaft is far longer than a rifleman\'s, and with the ramp shut it has none', () => {
    expect(route(m, 'foot', start, [26, 9])).toBe(25);
    expect(route(m, 'vehicle', start, [26, 9])!).toBeGreaterThanOrEqual(40);
    const p = path(m, 'vehicle', start, [26, 9])!;
    expect(p.some(([x, y]) => (x === 34 || x === 35) && RAMP.includes(y))).toBe(true);
    const shut = edited(m, (rows) => { for (const y of RAMP) for (const x of [34, 35]) rows[y][x] = '^'; });
    expect(route(shut, 'vehicle', start, [26, 9])).toBeNull();
    expect(route(shut, 'foot', start, [26, 9])).toBe(25);
  });
  it('control: clear the rubble and the vehicle walks the rifleman\'s twenty-five, so it is the scree that sends it round', () => {
    expect(route(replaceAll(m, 'b', '.'), 'vehicle', start, [26, 9])).toBe(25);
  });
  it('you look down into the pit and they cannot look up: a watcher on the apron sees the shaft head floor, one on the floor cannot see the road above it, and flattened both can', () => {
    expect(elevAt(m, 30, 18)).toBe(2);
    expect(elevAt(m, 28, 12)).toBe(0);
    expect(sees(m, [30, 18], [30, 10])).toBe(true);
    expect(sees(m, [28, 12], [28, 22])).toBe(false);
    expect(sees(flatten(m), [28, 12], [28, 22])).toBe(true);
  });
  it('the west route runs along the main road: a two-wide road the whole width of the map, the mouth and the vent on it, and every point of the line on its rows', () => {
    for (let x = 0; x < 48; x++) for (const y of [22, 23]) expect(tile(m, x, y), `(${x},${y})`).toBe('r');
    expect(tile(m, westR.mouth[0], westR.mouth[1])).toBe('r');
    expect(tile(m, westR.vent[0], westR.vent[1])).toBe('r');
    for (const [, y] of [westR.mouth, ...(westR.waypoints ?? []), westR.vent]) expect([22, 23]).toContain(y);
    expect(westR.mouth[0] - westR.vent[0]).toBeGreaterThanOrEqual(28);
    expect(ms.enemy.garrison.filter((g) => g.digs === 'bs_tn_west')).toHaveLength(1);
  });
  it('rubble stops wheels everywhere but the main road and the lane: a vehicle gets from the start to the clinic route in three times the steps a rifleman needs, through the lane and along the road', () => {
    const clinic = m.tunnels!.find((t) => t.id === 'bs_tn_clinic')!;
    const goal: Pt = [clinic.mouth[0], clinic.mouth[1]];
    expect(route(m, 'foot', start, goal)).toBe(13);
    expect(route(m, 'vehicle', start, goal)!).toBeGreaterThanOrEqual(30);
    const p = path(m, 'vehicle', start, [26, 22])!;
    expect(p.filter(([, y]) => y >= 24 && y <= 30).every(([x]) => x === 26 || x === 27)).toBe(true);
    expect(route(replaceAll(m, 'b', '.'), 'vehicle', start, goal)).toBe(13);
  });
  it('the quarter is mostly rubble: more than a third of the ground between the pit and the south edge is boulder field', () => {
    let b = 0;
    let all = 0;
    for (let y = 17; y <= 43; y++) for (let x = 8; x <= 40; x++) { all++; if (tile(m, x, y) === 'b') b++; }
    expect(b / all).toBeGreaterThan(0.33);
  });
  it('the collection point is three tiles from the start line, in the yard, and the people in the pit have a foot route out of it that fits the clock', () => {
    expect(dist(start, collect)).toBeGreaterThan(2.5);
    expect(dist(start, collect)).toBeLessThan(3.5);
    expect(inZone(m, 'collection_point', collect)).toBe(true);
    const hostages = ms.civilians!.groups.find((g) => g.group === 'hostages')!;
    const r = route(m, 'foot', fl(hostages.at), collect)!;
    expect(r).not.toBeNull();
    expect(r).toBeLessThanOrEqual(40);
  });
  it('the souk and the north block are garrisoned in the right buildings, and the clinic route\'s mouth stands in the flagged zone', () => {
    const souk = ms.enemy.garrison.find((g) => g.tag === 'bs4_cell_souk')!;
    const block = ms.enemy.garrison.find((g) => g.tag === 'bs_cell_north_block')!;
    expect(tile(m, souk.stance!.building![0], souk.stance!.building![1])).toBe('s');
    expect(tile(m, block.stance!.building![0], block.stance!.building![1])).toBe('h');
    expect(inZone(m, 'clinic', m.tunnels!.find((t) => t.id === 'bs_tn_clinic')!.mouth as unknown as Pt)).toBe(true);
    expect(ms.roe!.flagged_zones).toEqual(['clinic']);
  });
  it('every wave reaches the town: the mortar line has a foot and a wheeled route to the town centre', () => {
    expect(ms.enemy.waves.every((w) => w.to === 'town_center')).toBe(true);
    expect(route(m, 'foot', mk(m, 'mortar_line'), mk(m, 'town_center'))).not.toBeNull();
    expect(route(m, 'vehicle', mk(m, 'mortar_line'), mk(m, 'town_center'))).not.toBeNull();
    expect(shaft).toEqual([26, 9]);
  });
});
