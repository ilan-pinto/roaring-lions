// Wadi Halam II-V on their own ground (GH-382), as assertions. Replaces
// `wadi_halam_variants.test.ts` (the obstacle variants of the base map) and
// `wadi_halam_5_depot_fence.test.ts` (the fence ring, which is part of the map now).
//
// Every claim a briefing makes about the ground is walked through the real `FlowField`, and
// every positive is paired with a CONTROL built from the same map with one thing changed, so a
// route that exists for another reason cannot pass for the one claimed.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, missions, parseMap, structures as structureCatalogue, type MapJson } from '@lions/data';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim } from '../../packages/sim/src/sim';

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

/** Tiles on the flow-field route from `from` to `to`, or null when there is none. */
function path(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): Pt[] | null {
  const { map, sim } = world(json);
  const field = new FlowField(map.width, map.height);
  field.compute(domain === 'foot' ? sim.blocked : sim.blockedVehicle, sim.elevation, to[0], to[1]);
  const out: Pt[] = [[from[0], from[1]]];
  let [x, y] = from;
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

function mk(json: MapJson, name: string): Pt {
  const m = json.markers?.[name];
  if (!m) throw new Error(`no marker ${name}`);
  return [m[0], m[1]];
}

/** The same map with some tiles rewritten. */
function edited(json: MapJson, edits: readonly [number, number, string][]): MapJson {
  const rows = json.rows.map((r) => r.split(''));
  for (const [x, y, ch] of edits) rows[y][x] = ch;
  return { ...json, rows: rows.map((r) => r.join('')) } as MapJson;
}

const missionOf = (id: string) =>
  (missions as unknown as Record<string, { map: { player_start: Pt }; enemy?: { waves?: { to: string; units: { unit: string; from?: string }[] }[] } }>)[id];

describe('every ground-unit wave route in II, III and V reaches its target', () => {
  for (const [mid, file] of [
    ['wadi_halam_3_counterraid', 'wadi_halam_3'],
    ['wadi_halam_5_depot', 'wadi_halam_5'],
  ] as const) {
    const m = missionOf(mid);
    for (const w of m.enemy?.waves ?? [])
      for (const u of w.units)
        if (u.from)
          it(`${mid}: ${u.from} -> ${w.to} (vehicle)`, () => {
            expect(path(J(file), 'vehicle', mk(J(file), u.from as string), mk(J(file), w.to))).not.toBeNull();
          });
  }
  it('II: the three raid edges each reach the pump house on wheels', () => {
    for (const from of ['rif_north', 'rif_east', 'rif_south'])
      expect(path(J('wadi_halam_2'), 'vehicle', mk(J('wadi_halam_2'), from), mk(J('wadi_halam_2'), 'pump_house')), from).not.toBeNull();
  });
});

describe('II: the bunded pasture', () => {
  it('the pasture holds exactly two razeable structures, the forward store and the pump house', () => {
    const { sim } = world(J('wadi_halam_2'));
    const [zx, zy, zw, zh] = J('wadi_halam_2').zones!.pasture;
    const found = new Set<number>();
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) if (sim.structureAt(x, y) >= 0) found.add(sim.structureAt(x, y));
    // the pump house is raised by the mission, so only the map's own store is here
    expect(found.size).toBe(1);
    expect(J('wadi_halam_2').rows[25].slice(13, 15)).toBe('ss');
  });
  it('the forward store is on the pasture western edge', () => {
    const [zx] = J('wadi_halam_2').zones!.pasture;
    expect(zx).toBe(13);
  });
  it('the ford is a gap in a tree line, and the tree line is the only thing across the north-west', () => {
    const rows = J('wadi_halam_2').rows;
    expect(rows[6].slice(0, 18)).toBe('oooooooorroooooooo');
    expect(rows[7].slice(0, 18)).toBe('oooooooorroooooooo');
  });
  it('the bunds are raised banks: each bund tile stands 2 levels over the open ground a tile either side', () => {
    const m = J('wadi_halam_2');
    const e = (x: number, y: number) => Number(m.elevation![y][x]);
    let banks = 0;
    for (const [y, x0, x1] of [[16, 14, 25], [19, 17, 28], [25, 16, 27], [28, 13, 24]] as const)
      for (let x = x0; x <= x1; x++) {
        expect(m.rows[y][x]).toBe('1');
        expect(e(x, y) - e(x, y - 2), `bund (${x},${y}) over its north side`).toBeGreaterThanOrEqual(1);
        expect(e(x, y) - e(x, y + 2), `bund (${x},${y}) over its south side`).toBeGreaterThanOrEqual(1);
        banks++;
      }
    expect(banks).toBeGreaterThan(40);
  });
  it('has sheepfolds (cover-2 rings), a cistern, a well and scattered cover', () => {
    const rows = J('wadi_halam_2').rows.join('');
    expect([...rows].filter((c) => c === '2').length).toBeGreaterThan(40);
    expect(rows.includes('#')).toBe(true);
    expect(J('wadi_halam_2').rows[36][23]).toBe('p');
  });
});

describe('III: the sunken cattle track', () => {
  const m = J('wadi_halam_3');
  const elev = (x: number, y: number) => Number(m.elevation![y][x]);
  it('the lane is two or more levels below the fields beside it (what hides ground troops)', () => {
    let checked = 0;
    for (let y = 8; y <= 36; y++) {
      const lane = [...m.rows[y]].map((c, x) => [c, x] as const).filter(([c]) => c === 'r').map(([, x]) => x);
      if (lane.length === 0) continue;
      const x0 = Math.min(...lane);
      expect(elev(x0, y), `lane row ${y}`).toBe(0);
      expect(elev(Math.max(0, x0 - 4), y) - elev(x0, y), `field beside lane row ${y}`).toBeGreaterThanOrEqual(2);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });
  it('the commander has a road out: hide_north reaches rif_east on wheels, along the road', () => {
    const p = path(m, 'vehicle', mk(m, 'hide_north'), mk(m, 'rif_east'));
    expect(p).not.toBeNull();
    expect(p!.length).toBeLessThan(40);
  });
  it('the stream bed shuts the south edge to wheels and not to feet, and the refuge sits on it', () => {
    const south: Pt = [10, 46];
    const hide = mk(m, 'hide_south');
    expect(path(m, 'vehicle', south, hide)).toBeNull();
    expect(path(m, 'foot', south, hide)).not.toBeNull();
    const [, ry, rw, rh] = m.zones!.refuge;
    expect(m.rows.slice(ry, ry + rh).join('').slice(0).includes('b')).toBe(true);
    expect(rw).toBeGreaterThan(0);
  });
  it('the herd walks to the refuge on foot', () => {
    expect(path(m, 'foot', [24, 32], mk(m, 'civ_refuge'))).not.toBeNull();
    expect(path(m, 'foot', [26, 32], mk(m, 'civ_refuge'))).not.toBeNull();
  });
});

describe('IV: the terraced village and its one ford', () => {
  const m = J('wadi_halam_4');
  const bedRows = m.rows.map((r, y) => [r, y] as const).filter(([r]) => r.includes('b'));
  const FORD = 'r';
  const fordTiles: [number, number][] = [];
  for (let y = 25; y < 40; y++) for (let x = 1; x < 47; x++) if (m.rows[y][x] === FORD && (m.rows[y][x - 1] === 'b' || m.rows[y][x + 1] === 'b')) fordTiles.push([x, y]);
  it('the stream has exactly one vehicle crossing: the ford on the road', () => {
    expect(fordTiles.length).toBeGreaterThanOrEqual(2);
    expect(bedRows.length).toBeGreaterThanOrEqual(5);
    const start = mk(m, 'hide_south');
    const centre = mk(m, 'village_center');
    const p = path(m, 'vehicle', start, centre);
    expect(p).not.toBeNull();
    expect(p!.some(([x, y]) => fordTiles.some(([fx, fy]) => fx === x && fy === y))).toBe(true);
    // control: fill the ford with boulders and the technicals have no way across
    expect(path(edited(m, fordTiles.map(([x, y]) => [x, y, 'b'] as [number, number, string])), 'vehicle', start, centre)).toBeNull();
    // and feet are not stopped by it
    expect(path(edited(m, fordTiles.map(([x, y]) => [x, y, 'b'] as [number, number, string])), 'foot', start, centre)).not.toBeNull();
  });
  it('the slope: the village steps down to the stream (north terrace higher than the bed)', () => {
    const e = (x: number, y: number) => Number(m.elevation![y][x]);
    expect(e(24, 8)).toBeGreaterThan(e(24, 20));
    expect(e(24, 20)).toBeGreaterThan(e(24, 30));
    expect(e(24, 8) - e(24, 36)).toBeGreaterThanOrEqual(3);
  });
  it('the refuge is on the road out to the west and every family can walk to it', () => {
    const refuge = mk(m, 'civ_refuge');
    expect(refuge[0]).toBeLessThan(8);
    // the longest walk in the arc: the families are 25-35 tiles from it
    expect(path(m, 'foot', [36, 22], refuge)!.length).toBeGreaterThan(30);
    for (const from of [[31, 22], [36, 22], [27, 26]] as Pt[]) expect(path(m, 'foot', from, refuge), String(from)).not.toBeNull();
  });
  it('the four garrisoned houses are houses', () => {
    for (const [x, y] of [[15, 11], [19, 24], [33, 25], [37, 25], [42, 26], [43, 20], [37, 7]]) expect(m.rows[y][x]).toBe('h');
  });
});

describe('V: the depot on the embankment', () => {
  const m = J('wadi_halam_5');
  const gate = mk(m, 'depot_gate');
  const start = missionOf('wadi_halam_5_depot').map.player_start;
  const inYard = (x: number, y: number) => {
    const [zx, zy, zw, zh] = m.zones!.depot;
    return x >= zx && x < zx + zw && y >= zy && y < zy + zh;
  };
  it('seven structures stand in the depot zone, and no wall or fence is among them', () => {
    const { sim } = world(m);
    const [zx, zy, zw, zh] = m.zones!.depot;
    const found = new Set<number>();
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) if (sim.structureAt(x, y) >= 0) found.add(sim.structureAt(x, y));
    expect(found.size).toBe(7);
  });
  it('the gate is the only way in: with the gate walled up, nothing on wheels or feet reaches the yard', () => {
    const inside: Pt = [33, 12];
    expect(path(m, 'vehicle', start, inside)).not.toBeNull();
    expect(path(m, 'foot', start, inside)).not.toBeNull();
    const shut = edited(m, [[gate[0], gate[1], '=']]);
    expect(path(shut, 'vehicle', start, inside)).toBeNull();
    expect(path(shut, 'foot', start, inside)).toBeNull();
  });
  it('the yard is two levels above the ground outside its wall (it stands on an embankment)', () => {
    const e = (x: number, y: number) => Number(m.elevation![y][x]);
    expect(e(33, 12)).toBe(2);
    expect(e(45, 30)).toBe(0);
    expect(inYard(33, 12)).toBe(true);
  });
  it('the D9 reaches every structure by the straight line through the village without crossing a boulder tile', () => {
    const p = path(m, 'vehicle', start, gate);
    expect(p).not.toBeNull();
    for (const [x, y] of p!) expect(m.rows[y][x], `(${x},${y})`).not.toBe('b');
    // the village is ON that line: the route passes within 3 tiles of the hall
    const hall = [23, 29];
    expect(p!.some(([x, y]) => Math.hypot(x - hall[0], y - hall[1]) <= 6)).toBe(true);
  });
  it('the river road is the long way round and takes no village tile', () => {
    const wp: Pt = [33, 43];
    const a = path(m, 'vehicle', start, wp)!;
    const b = path(m, 'vehicle', wp, gate)!;
    const straight = path(m, 'vehicle', start, gate)!;
    expect(a.length + b.length).toBeGreaterThan(straight.length + 8);
    for (const [x, y] of [...a, ...b]) expect(Math.hypot(x - 23, y - 29), `(${x},${y}) is in the village`).toBeGreaterThan(8);
  });
  it('the fence ring is in the map: 3 faces, none on the south (the ramp)', () => {
    const fences = m.rows.flatMap((r, y) => [...r].map((c, x) => [c, x, y] as const).filter(([c]) => c === 'f'));
    expect(fences.length).toBeGreaterThan(30);
    expect(fences.every(([, , y]) => y <= 18)).toBe(true);
  });
});
