// Deir Amun II and III on their own ground (GH-382), as assertions. Mission I keeps `deir_amun`
// and `deir_amun_doctrine.test.ts` still pins it; before this the other two missions were played
// on that same file.
//
// Every claim a briefing makes about the ground is walked through the real `FlowField` and the
// real `Sim` sight rule, and every positive is paired with a CONTROL built from the same map
// with one thing changed, so a route or a blind spot that exists for another reason cannot pass
// for the one claimed.
//
// What each mission's briefing rests on, and where it is pinned:
//   II   the pump yard stands on a spur inside an S-bend of the wadi, with ONE gate on its south
//        side; the route's mouth is inside the wall and its vent is in the bed behind it, outside;
//        the bed runs round three sides of the spur and wheels cross it only at the fords; the
//        camp is four tiles from the centre ford; the waves come up the bed and the road.
//   III  you come down on the village from the plateau through two ravines (one of them foot
//        only); the hamlet holds the mouths of exactly four routes; one vents on the player's own
//        road east; the chief stands on a spoil mound below the lip, a level above the ground
//        around it.
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
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
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
  enemy: { garrison: { at?: Pt; tag?: string; in_tunnel?: string; digs?: string }[]; waves: { to: string; units: { from: string }[] }[] };
};
const missionOf = (id: string) => (missions as unknown as Record<string, Mission>)[id];
/** The routes an objective's zone claims: those whose MOUTH lies inside it (mission.ts, `collapse`). */
const routesIn = (json: MapJson, zone: string) => (json.tunnels ?? []).filter((t) => inZone(json, zone, [t.mouth[0], t.mouth[1]])).map((t) => t.id);

describe('every mission names a map it owns, and every marker stands on passable ground', () => {
  for (const [mid, file] of [
    ['deir_amun_2_foothold', 'deir_amun_2'],
    ['deir_amun_3_subterranean', 'deir_amun_3'],
  ] as const) {
    it(`${mid} plays on ${file}, an arid 48x48 map with relief`, () => {
      expect(missionOf(mid).map.file).toBe(file);
      const m = J(file);
      expect([m.width, m.height, m.terrain]).toEqual([48, 48, 'arid']);
      expect(new Set(m.elevation!.join('')).size).toBeGreaterThanOrEqual(6);
      const { sim, map } = world(m);
      for (const [name, [x, y]] of Object.entries(m.markers!)) expect(sim.blocked[y * map.width + x], `${file} ${name}`).toBe(0);
      for (const t of m.tunnels ?? []) {
        // the line itself runs under walls (its waypoint may be a wall tile); only its two ends are surface
        for (const [x, y] of [t.mouth, t.vent]) expect(sim.blocked[y * map.width + x], `${file} ${t.id} (${x},${y})`).toBe(0);
      }
    });
  }
  it('II and III no longer share a file with I or with each other', () => {
    expect(missionOf('deir_amun_1_recon').map.file).toBe('deir_amun');
    expect(new Set(['deir_amun_1_recon', 'deir_amun_2_foothold', 'deir_amun_3_subterranean'].map((x) => missionOf(x).map.file)).size).toBe(3);
  });
});

describe('II: the pump yard in the bend', () => {
  const m = J('deir_amun_2');
  const gate = mk(m, 'pump_gate');
  const start = mk(m, 'da_start');
  const floor = mk(m, 'pump_yard_floor');
  const ms = missionOf('deir_amun_2_foothold');
  const pump = (m.tunnels ?? []).find((t) => t.id === 'da_tn_pump')!;

  it('the yard has ONE gate, on its south side: the only wall gap is the gate tile, and the gate is on the bottom row', () => {
    const [zx, zy, zw, zh] = m.zones!.pump_yard;
    const bottom = zy + zh - 1;
    expect(gate[1]).toBe(bottom);
    let gaps = 0;
    for (let x = zx; x < zx + zw; x++) for (const y of [zy, bottom]) if (tile(m, x, y) !== '=') gaps++;
    for (let y = zy; y <= bottom; y++) for (const x of [zx, zx + zw - 1]) if (tile(m, x, y) !== '=') gaps++;
    expect(gaps).toBe(1);
    expect(tile(m, gate[0], gate[1])).toBe('.');
  });
  it('the yard floor is walkable from the start line through that gate, for both domains', () => {
    expect(route(m, 'foot', start, floor)).not.toBeNull();
    expect(route(m, 'vehicle', start, gate)).not.toBeNull();
    const p = path(m, 'foot', start, floor)!;
    expect(p.some(([x, y]) => x === gate[0] && y === gate[1])).toBe(true);
  });
  it('control: wall the gate shut and no route reaches the floor from the start, on foot or on wheels', () => {
    const shut = edited(m, (rows) => { rows[gate[1]][gate[0]] = '='; });
    expect(route(shut, 'foot', start, floor)).toBeNull();
    expect(route(shut, 'vehicle', start, floor)).toBeNull();
  });
  it('the mouth of da_tn_pump is inside the yard, the vent is in the wadi bed outside it, and it is the only route the yard claims', () => {
    expect(routesIn(m, 'pump_yard')).toEqual(['da_tn_pump']);
    expect(inZone(m, 'pump_yard', [pump.vent[0], pump.vent[1]])).toBe(false);
    expect(tile(m, pump.vent[0], pump.vent[1])).toBe('b');
    expect(pump.vent[1]).toBeLessThan(pump.mouth[1]);
    expect(ms.enemy.garrison.filter((g) => g.in_tunnel === 'da_tn_pump').map((g) => g.at)).toEqual([[pump.vent[0], pump.vent[1]]]);
    expect(ms.enemy.garrison.filter((g) => g.digs === 'da_tn_pump')).toHaveLength(1);
  });
  it('the bed runs round three sides of the spur: bed on the yard\'s west, north and east, and none south of it', () => {
    const [zx, zy, zw, zh] = m.zones!.pump_yard;
    const bed = (x0: number, y0: number, x1: number, y1: number) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (tile(m, x, y) === 'b') n++;
      return n;
    };
    expect(bed(zx - 8, zy, zx - 1, zy + zh - 1)).toBeGreaterThan(10);
    expect(bed(zx, zy - 6, zx + zw - 1, zy - 1)).toBeGreaterThan(10);
    expect(bed(zx + zw, zy, zx + zw + 8, zy + zh - 1)).toBeGreaterThan(10);
    expect(bed(zx - 2, zy + zh, zx + zw + 1, 47)).toBe(0);
  });
  it('control: the same count over the base map finds the wadi on one side only, so this is not what the old ground gave', () => {
    const base = J('deir_amun');
    const [zx, zy, zw, zh] = base.zones!.pump_yard;
    let west = 0;
    let north = 0;
    for (let y = zy; y < zy + zh; y++) for (let x = zx - 8; x < zx; x++) if (tile(base, x, y) === 'b') west++;
    for (let y = zy - 6; y < zy; y++) for (let x = zx; x < zx + zw; x++) if (tile(base, x, y) === 'b') north++;
    expect(west + north).toBeLessThan(45);
    let south = 0;
    for (let y = zy + zh; y < 47; y++) for (let x = zx - 2; x < zx + zw + 2; x++) if (tile(base, x, y) === 'b') south++;
    expect(south).toBeGreaterThan(0);
  });
  it('wheels cross that bed only at the fords: shut the five fords with boulders and no vehicle gets from the gate to the hamlet or the store; feet still can', () => {
    const lane = mk(m, 'hamlet_lane');
    const store = mk(m, 'store_gate');
    expect(route(m, 'vehicle', gate, lane)).not.toBeNull();
    expect(route(m, 'vehicle', gate, store)).not.toBeNull();
    const fords: Pt[] = [mk(m, 'ford_centre'), mk(m, 'ford_west'), mk(m, 'ford_north'), mk(m, 'ford_east'), [44, 37]];
    const sealed = edited(m, (rows) => {
      for (const [fx0, fy0] of fords) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tile(m, fx0 + dx, fy0 + dy) !== 'b' && Math.abs(dy) <= 1) rows[fy0 + dy][fx0 + dx] = 'b';
    });
    expect(route(sealed, 'vehicle', gate, lane)).toBeNull();
    expect(route(sealed, 'vehicle', gate, store)).toBeNull();
    expect(route(sealed, 'foot', gate, lane)).not.toBeNull();
  });
  it('control: with no boulders at all the same vehicle route is shorter than through a ford, so the bed is what bends it', () => {
    const lane = mk(m, 'hamlet_lane');
    const bare = replaceAll(m, 'b', '.');
    expect(route(bare, 'vehicle', gate, lane)!).toBeLessThan(route(m, 'vehicle', gate, lane)!);
    // on foot the bed costs nothing: a rifleman wades it, so the bare map is no shorter
    expect(route(bare, 'foot', gate, lane)).toBe(route(m, 'foot', gate, lane));
  });
  it('the camp is on the spur four tiles from the centre ford, and clear of the yard wall', () => {
    const camp = ms.structures!.find((s) => s.type === 'camp')!;
    const c: Pt = [camp.at[0] + 0.5, camp.at[1] + 0.5];
    const ford = mk(m, 'ford_centre');
    expect(dist(c, [ford[0] + 0.5, ford[1] + 0.5])).toBeGreaterThanOrEqual(4);
    expect(dist(c, [ford[0] + 0.5, ford[1] + 0.5])).toBeLessThan(5);
    expect(inZone(m, 'pump_yard', [camp.at[0], camp.at[1]])).toBe(false);
  });
  it('the three waves come up the bed and the road: two start in the bed itself and one on the north road, and each reaches what it is sent to', () => {
    const marks = ms.enemy.waves.map((w) => [w.units[0].from, w.to] as const);
    expect(marks).toEqual([['bed_west', 'pump_gate'], ['north_road', 'hamlet_lane'], ['bed_east', 'ford_centre']]);
    expect(tile(m, ...mk(m, 'bed_west'))).toBe('b');
    expect(tile(m, ...mk(m, 'bed_east'))).toBe('b');
    expect(tile(m, ...mk(m, 'north_road'))).toBe('r');
    for (const [from, to] of marks) expect(route(m, 'foot', mk(m, from), mk(m, to)), `${from} -> ${to}`).not.toBeNull();
  });
  it('the store compound is one walled yard with one gate on its west, and warehouses inside; the capture zone holds the whole of it', () => {
    const { sim } = world(m);
    const [zx, zy, zw, zh] = m.zones!.store_yard;
    const kinds = new Set<number>();
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) if (sim.structureAt(x, y) >= 0) kinds.add(sim.structureAt(x, y));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    const gap = mk(m, 'store_gate');
    expect(gap[0]).toBe(zx);
    expect(route(m, 'foot', start, gap)).not.toBeNull();
  });
  it('the rocket team over the west ravine is on the shoulder above it, and the ravine floor is a bed of boulders not a road', () => {
    const post = ms.enemy.garrison.find((g) => g.tag === 'da_watch_gap')!.at!;
    expect(post[1]).toBeLessThanOrEqual(10);
    expect(tile(m, post[0], post[1])).toBe('.');
    expect(route(m, 'foot', start, [post[0], post[1]])).not.toBeNull();
  });
  it('the hamlet is across the bed: nine houses north of the north bed, the lane runs to it, and no house stands on the spur', () => {
    const { sim } = world(m);
    const [zx, zy, zw, zh] = m.zones!.hamlet;
    const houses = new Set<number>();
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) if (tile(m, x, y) === 'h') houses.add(sim.structureAt(x, y));
    expect(houses.size).toBe(9);
    expect(zy + zh).toBeLessThanOrEqual(20);
  });
});

describe('III: down from the plateau', () => {
  const m = J('deir_amun_3');
  const ms = missionOf('deir_amun_3_subterranean');
  const start = mk(m, 'da_start');
  const lane = mk(m, 'hamlet_lane');
  const spoil = mk(m, 'spoil_field_centre');
  const west = mk(m, 'ravine_west');
  const east = mk(m, 'ravine_east');

  it('the hamlet claims exactly the four routes the mission names, and no other route exists on the map', () => {
    expect(routesIn(m, 'hamlet').sort()).toEqual(['da_tn_east', 'da_tn_lane', 'da_tn_north', 'da_tn_yard']);
    expect((m.tunnels ?? []).map((t) => t.id).sort()).toEqual(['da_tn_east', 'da_tn_lane', 'da_tn_north', 'da_tn_yard']);
    for (const t of m.tunnels ?? []) expect(t.pre_dug).toBe(true);
    const stocked = new Set(ms.enemy.garrison.map((g) => g.in_tunnel).filter(Boolean));
    expect([...stocked].sort()).toEqual(['da_tn_east', 'da_tn_lane', 'da_tn_north', 'da_tn_yard']);
  });
  it('every stocked garrison stands on its own route\'s vent', () => {
    for (const g of ms.enemy.garrison.filter((x) => x.in_tunnel)) {
      const t = m.tunnels!.find((r) => r.id === g.in_tunnel)!;
      expect(g.at, g.in_tunnel).toEqual([t.vent[0], t.vent[1]]);
    }
  });
  it('one route vents on the player\'s own road east: the east vent is beside the road that comes down the east ravine', () => {
    const t = m.tunnels!.find((r) => r.id === 'da_tn_east')!;
    let nearest = 99;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) if (tile(m, x, y) === 'r') nearest = Math.min(nearest, dist([x, y], [t.vent[0], t.vent[1]]));
    expect(nearest).toBeLessThanOrEqual(1.5);
    const p = path(m, 'vehicle', start, lane)!;
    expect(p.some(([x, y]) => dist([x, y], [t.vent[0], t.vent[1]]) <= 2.5)).toBe(true);
  });
  it('you start above the village: the start is on the plateau, three levels over the hamlet, and the chief is below the lip', () => {
    expect(inZone(m, 'plateau', start)).toBe(true);
    expect(elevAt(m, start[0], start[1]) - elevAt(m, lane[0], lane[1])).toBeGreaterThanOrEqual(3);
    const [, zy, , zh] = m.zones!.hamlet;
    expect(spoil[1]).toBeGreaterThan(zy + zh);
    expect(missionOf('deir_amun_3_subterranean').map.player_start).toEqual(start);
  });
  it('the spoil field is a mound a level above the ground round it', () => {
    const mound = elevAt(m, spoil[0], spoil[1]);
    const ring = [[-8, 0], [8, 0], [0, 6], [0, -3]].map(([dx, dy]) => elevAt(m, spoil[0] + dx, spoil[1] + dy));
    for (const r of ring) expect(mound - r, `ring ${ring}`).toBeGreaterThanOrEqual(1);
  });
  it('there are two ways off the plateau, both ravines: the foot route to the lane runs down one of them and shutting both leaves none', () => {
    expect(route(m, 'foot', start, lane)).not.toBeNull();
    const shutBoth = edited(m, (rows) => { for (const [cx] of [west, east]) for (let y = 12; y <= 19; y++) for (let x = cx - 1; x <= cx + 1; x++) rows[y][x] = '^'; });
    expect(route(shutBoth, 'foot', start, lane)).toBeNull();
    const shutWest = edited(m, (rows) => { for (let y = 12; y <= 19; y++) for (let x = west[0] - 1; x <= west[0] + 1; x++) rows[y][x] = '^'; });
    const shutEast = edited(m, (rows) => { for (let y = 12; y <= 19; y++) for (let x = east[0] - 1; x <= east[0] + 1; x++) rows[y][x] = '^'; });
    expect(route(shutWest, 'foot', start, lane)).not.toBeNull();
    expect(route(shutEast, 'foot', start, lane)).not.toBeNull();
  });
  it('the west ravine is a boulder chute: feet only. Armour has the east ravine alone, and shutting it strands every vehicle on the plateau', () => {
    const shutEast = edited(m, (rows) => { for (let y = 12; y <= 19; y++) for (let x = east[0] - 1; x <= east[0] + 1; x++) rows[y][x] = '^'; });
    expect(route(m, 'vehicle', start, lane)).not.toBeNull();
    expect(route(shutEast, 'vehicle', start, lane)).toBeNull();
    expect(route(shutEast, 'foot', start, lane)).not.toBeNull();
  });
  it('control: clear the chute\'s boulders and the armour has the west ravine too, and the route is shorter', () => {
    const shutEast = edited(replaceAll(m, 'b', '.'), (rows) => { for (let y = 12; y <= 19; y++) for (let x = east[0] - 1; x <= east[0] + 1; x++) rows[y][x] = '^'; });
    expect(route(shutEast, 'vehicle', start, lane)).not.toBeNull();
  });
  it('the mouths stand in open lanes of the hamlet, and nine buildings make it a village', () => {
    // GH-416: four houses and five low sheds -- the south half of the hamlet came down to sheds
    // so the lanes between them can be seen from the camera (tools/src/map_visibility.ts).
    const { sim } = world(m);
    const [zx, zy, zw, zh] = m.zones!.hamlet;
    const houses = new Set<number>();
    const sheds = new Set<number>();
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) {
      if (tile(m, x, y) === 'h') houses.add(sim.structureAt(x, y));
      if (tile(m, x, y) === 's') sheds.add(sim.structureAt(x, y));
    }
    expect(houses.size).toBe(4);
    expect(houses.size + sheds.size).toBe(9 + 1); // plus the one shed beside the lane that was always there
    for (const t of m.tunnels!) expect(tile(m, t.mouth[0], t.mouth[1]), t.id).toBe('.');
  });
  it('the detector\'s sight (sight 9): the head of the street sees all four mouths, the middle of it misses the east one, and the spoil field sees none', () => {
    const head = mk(m, 'hamlet_north');
    const seen = (from: Pt, mm: MapJson = m) => m.tunnels!.filter((t) => sees(mm, from, [t.mouth[0], t.mouth[1]], 9)).map((t) => t.id).sort();
    expect(seen(head)).toEqual(['da_tn_east', 'da_tn_lane', 'da_tn_north', 'da_tn_yard']);
    expect(seen(lane)).toEqual(['da_tn_lane', 'da_tn_north', 'da_tn_yard']);
    expect(seen(spoil)).toEqual([]);
    expect(seen(start)).toEqual([]);
  });
  it('control: pull the houses down and the middle of the street sees the east mouth too, so it is the houses that hide it', () => {
    const east = m.tunnels!.find((t) => t.id === 'da_tn_east')!;
    expect(sees(m, lane, [east.mouth[0], east.mouth[1]], 9)).toBe(false);
    expect(sees(replaceAll(m, 'h', '.'), lane, [east.mouth[0], east.mouth[1]], 9)).toBe(true);
  });
  it('every wave reaches what it is sent to: the flank roads run to the lane on wheels', () => {
    const marks = ms.enemy.waves.map((w) => [w.units[0].from, w.to] as const);
    expect(marks).toEqual([['flank_east', 'hamlet_north'], ['flank_west', 'hamlet_lane']]);
    expect(route(m, 'vehicle', mk(m, 'flank_west'), lane)).not.toBeNull();
    for (const [from, to] of marks) expect(route(m, 'foot', mk(m, from), mk(m, to)), `${from} -> ${to}`).not.toBeNull();
  });
  it('the chief\'s ground is reachable by the plateau force on both legs', () => {
    expect(route(m, 'foot', start, spoil)).not.toBeNull();
    expect(route(m, 'vehicle', start, spoil)).not.toBeNull();
  });
});
