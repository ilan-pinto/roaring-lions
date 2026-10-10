// Khan Rafid II and III on their own ground (GH-382), as assertions. Mission I keeps `khan_rafid`
// and its doctrine block (`khan_rafid_doctrine.test.ts`); this file is the same method for the two
// maps that replaced it: every claim a briefing makes about the ground is walked through the real
// `Sim` / `FlowField`, and every positive is paired with a CONTROL built from the same map with one
// thing changed, so a route or a sight line that exists for another reason cannot pass for the one
// claimed.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, missions, parseMap, structures as structureCatalogue, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];
const J = (id: string): MapJson => (maps as unknown as Record<string, MapJson>)[id];

function world(json: MapJson) {
  const map = parseMap(json);
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 64 });
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
const steps = (p: Pt[] | null): number | null => (p === null ? null : p.length - 1);

function mk(json: MapJson, name: string): Pt {
  const m = json.markers?.[name];
  if (!m) throw new Error(`no marker ${name}`);
  return [m[0], m[1]];
}

/** The same map with some tiles rewritten. */
function edited(json: MapJson, edits: readonly (readonly [number, number, string])[]): MapJson {
  const rows = json.rows.map((r) => r.split(''));
  for (const [x, y, ch] of edits) rows[y][x] = ch;
  return { ...json, rows: rows.map((r) => r.join('')) } as MapJson;
}

function observer(sight: number): UnitTypeJson {
  return {
    id: `kr_obs_${sight}`,
    role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1.2 },
    sensors: { optics: 1, sight_tiles: sight, signature: 0.6 },
  };
}
function sees(json: MapJson, sight: number, a: Pt, b: Pt): boolean {
  const { sim } = world(json);
  const t = sim.addUnitType(observer(sight));
  const watcher = sim.spawn(t, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const target = sim.spawn(t, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  return sim.debugDetection(watcher, target)?.visible ?? false;
}

const missionOf = (id: string) =>
  (missions as unknown as Record<
    string,
    { map: { file: string; player_start: Pt }; civilians?: { groups: { at: Pt }[] }; enemy?: { waves?: { to: string; units: { from?: string }[] }[] } }
  >)[id];

/** Gaps in the perimeter of a rectangle of wall: the perimeter tiles that are not `=`. */
function gaps(json: MapJson, [x, y, w, h]: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < w; i++)
    for (const yy of [y, y + h - 1]) if (json.rows[yy][x + i] !== '=') out.push([x + i, yy]);
  for (let j = 1; j < h - 1; j++)
    for (const xx of [x, x + w - 1]) if (json.rows[y + j][xx] !== '=') out.push([xx, y + j]);
  return out;
}

describe('every ground-unit wave route on II and III reaches its target on wheels', () => {
  for (const [mid, file] of [
    ['khan_rafid_2_foothold', 'khan_rafid_2'],
    ['khan_rafid_3_clearance', 'khan_rafid_3'],
  ] as const) {
    for (const w of missionOf(mid).enemy?.waves ?? [])
      for (const u of w.units)
        if (u.from) it(`${mid}: ${u.from} -> ${w.to}`, () => {
          expect(path(J(file), 'vehicle', mk(J(file), u.from as string), mk(J(file), w.to))).not.toBeNull();
        });
  }
  it('both missions start on their own map file', () => {
    expect(missionOf('khan_rafid_2_foothold').map.file).toBe('khan_rafid_2');
    expect(missionOf('khan_rafid_3_clearance').map.file).toBe('khan_rafid_3');
  });
});

describe('II: the ward on the mound', () => {
  const m = J('khan_rafid_2');
  const WARD = m.zones!.ward;
  const elev = (x: number, y: number) => Number(m.elevation![y][x]);
  const refuge = mk(m, 'civ_refuge');
  const start = missionOf('khan_rafid_2_foothold').map.player_start;
  const GATES: [number, number][] = [[24, 20], [24, 26], [20, 23], [28, 23]];

  it('the ward is 9 by 7, walled all round, with exactly four gates, one in each side', () => {
    expect(WARD.slice(2)).toEqual([9, 7]);
    expect(gaps(m, WARD).sort()).toEqual([...GATES].sort());
    // control: a fifth hole in the wall is seen by the same measurement
    expect(gaps(edited(m, [[22, 20, '.']]), WARD)).toHaveLength(5);
  });
  it('the gates are the only way in: shut all four and nothing reaches the refuge, wheels or feet', () => {
    expect(steps(path(m, 'vehicle', start, refuge))).toBe(22);
    expect(steps(path(m, 'foot', start, refuge))).toBe(22);
    const shut = edited(m, GATES.map(([x, y]) => [x, y, '='] as const));
    expect(path(shut, 'vehicle', start, refuge)).toBeNull();
    expect(path(shut, 'foot', start, refuge)).toBeNull();
  });
  it('the ward stands on a mound: 5 levels over the plain, falling a level a tile, so the ring road at its foot is at 1 and 0', () => {
    for (let y = WARD[1]; y < WARD[1] + WARD[3]; y++) for (let x = WARD[0]; x < WARD[0] + WARD[2]; x++) expect(elev(x, y), `(${x},${y})`).toBe(5);
    expect(elev(24, 19)).toBe(4);
    expect(elev(24, 17)).toBe(2);
    expect(elev(24, 16)).toBe(1);
    expect(elev(24, 15)).toBe(0);
    expect(elev(2, 40)).toBe(0);
  });
  it('the Old Town stands on a shelf three levels over the plain, stepping down over its last rows', () => {
    expect(elev(24, 5)).toBe(3);
    expect(elev(40, 9)).toBe(3);
    expect(elev(24, 11)).toBe(2);
    expect(elev(24, 12)).toBe(1);
    expect(elev(24, 13)).toBe(0);
    expect(elev(24, 5) - elev(2, 40)).toBeGreaterThanOrEqual(3);
  });
  it('a ring road circles the mound: the loop is closed, and cutting it at both arcs opens it', () => {
    // road tiles of the annulus only: the four spokes (north road, south approach, main street) are excluded
    const isRing = (x: number, y: number) => m.rows[y][x] === 'r' && x >= 14 && x <= 34 && y >= 14 && y <= 32 && !(x === 24 && (y < 16 || y > 30));
    const reach = (from: Pt, blocked: (x: number, y: number) => boolean): Set<string> => {
      const seen = new Set<string>([from.join()]);
      const q: Pt[] = [from];
      while (q.length) {
        const [x, y] = q.pop() as Pt;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx > 47 || ny > 47 || seen.has(`${nx},${ny}`) || !isRing(nx, ny) || blocked(nx, ny)) continue;
          seen.add(`${nx},${ny}`);
          q.push([nx, ny]);
        }
      }
      return seen;
    };
    const west: Pt = [16, 23];
    const east = '32,23';
    expect(reach(west, () => false).has(east)).toBe(true);
    // control: cut the north arc and the loop still closes through the south; cut both and it does not
    expect(reach(west, (_x, y) => y === 17 || y === 16 || y === 15).has(east)).toBe(true);
    expect(reach(west, (_x, y) => (y <= 16 || y >= 30) && y !== 23).has(east)).toBe(false);
  });
  it('you see over the wall: a rifleman at the souk alley sees the first row inside, and a concrete wall in its place hides it', () => {
    const alley = mk(m, 'souk_alley');
    expect(alley).toEqual([24, 14]);
    expect(sees(m, 7, alley, [24, 21])).toBe(true);
    const concrete = edited(m, [20, 21, 22, 23, 24, 25, 26, 27, 28].map((x) => [x, 20, '#'] as const));
    expect(sees(concrete, 7, alley, [24, 21])).toBe(false);
  });
  it('the mound hides nothing from the road because it falls a level a tile: the same hill at two levels a tile blinds the alley', () => {
    const steep = { ...m, elevation: m.elevation!.map((row) => [...row].map((c) => String(Math.min(9, Number(c) * 2))).join('')) } as MapJson;
    expect(sees(m, 7, mk(m, 'souk_alley'), [24, 21])).toBe(true);
    expect(sees(steep, 7, mk(m, 'souk_alley'), [24, 21])).toBe(false);
  });
  it('the three civilian groups walk to the ward in 15, 14 and 9 tiles', () => {
    const groups = missionOf('khan_rafid_2_foothold').civilians!.groups.map((g) => g.at);
    expect(groups.map((g) => steps(path(m, 'foot', g, refuge)))).toEqual([15, 14, 9]);
  });
  it('the souk alley is six tiles from the north gate: the push at the gate starts close', () => {
    expect(steps(path(m, 'foot', mk(m, 'souk_alley'), mk(m, 'ward_north_gate')))).toBe(6);
  });
  it('the market is a square of stalls east of the ring road, and the camp ground is clear', () => {
    const [x, y, w, h] = m.zones!.market;
    expect(x).toBeGreaterThan(33);
    const open = m.rows.slice(y + 1, y + h - 1).map((r) => r.slice(x + 1, x + w - 1)).join('');
    expect([...open].filter((c) => c === '.').length).toBeGreaterThan(12);
    const camp = [[20, 38], [21, 38], [20, 39], [21, 39]];
    for (const [cx, cy] of camp) expect(m.rows[cy][cx]).toBe('.');
  });
  it('the Old Town is not a grid: no two house rows repeat and four building kinds stand in it', () => {
    const band = m.rows.slice(3, 14);
    const distinct = new Set(band.map((r) => r.slice(2, 16)));
    expect(distinct.size).toBe(band.length);
    const kinds = new Set(band.join('').replace(/[^hasw]/g, ''));
    expect(kinds.size).toBe(4);
  });
});

describe('III: the garden souk', () => {
  const m = J('khan_rafid_3');
  const refuge = mk(m, 'civ_refuge');
  const ORCHARDS: [string, Pt, Pt][] = [
    ['orchard_west', [7, 17], [11, 17]],
    ['orchard_east', [40, 17], [40, 21]],
    ['orchard_south', [40, 34], [36, 34]],
  ];
  it('every orchard is a room with exactly one gap in its wall, and trees in it', () => {
    for (const [zone, , gap] of ORCHARDS) {
      const z = m.zones![zone];
      expect(gaps(m, z), zone).toEqual([gap]);
      const inside = m.rows.slice(z[1] + 1, z[1] + z[3] - 1).map((r) => r.slice(z[0] + 1, z[0] + z[2] - 1)).join('');
      expect([...inside].filter((c) => c === 'o').length, zone).toBeGreaterThan(25);
    }
  });
  it('a family in an orchard walks out through the gap: seal the gap and they cannot reach the refuge', () => {
    const groups = missionOf('khan_rafid_3_clearance').civilians!.groups.map((g) => g.at);
    expect(groups.map((g) => steps(path(m, 'foot', g, refuge)))).toEqual([23, 18, 35, 30]);
    for (const [, from, gap] of ORCHARDS) {
      expect(steps(path(m, 'foot', from, refuge))).not.toBeNull();
      expect(path(edited(m, [[gap[0], gap[1], '=']]), 'foot', from, refuge), `sealed ${gap}`).toBeNull();
    }
  });
  it('an orchard is a room for wheels too: the Eitan drives in through the gap, and not over the wall', () => {
    for (const [, from, gap] of ORCHARDS) {
      expect(path(m, 'vehicle', [24, 45], from)).not.toBeNull();
      expect(path(edited(m, [[gap[0], gap[1], '=']]), 'vehicle', [24, 45], from)).toBeNull();
    }
  });
  it('the store is a walled yard on the north edge with one gate, and nothing reaches it with the gate shut', () => {
    const z = m.zones!.store;
    expect(z[1]).toBe(1);
    expect(gaps(m, z)).toEqual([[14, 7]]);
    expect(path(m, 'foot', [24, 45], [14, 4])).not.toBeNull();
    expect(path(edited(m, [[14, 7, '=']]), 'foot', [24, 45], [14, 4])).toBeNull();
    // the garrisoned warehouse is in the yard
    expect(m.rows[3][19]).toBe('w');
  });
  it('the ward stands south-west, its civic hall holds the commander, and it has two gates', () => {
    const z = m.zones!.ward;
    expect(gaps(m, z).sort()).toEqual([[10, 29], [14, 33]]);
    expect(m.rows[32][6]).toBe('m');
    expect(z[0] + z[2]).toBeLessThan(17);
    const hall = missionOf('khan_rafid_3_clearance');
    expect(hall).toBeDefined();
    expect(steps(path(m, 'vehicle', [24, 45], refuge))).toBe(17);
  });
  it('the souk is the core: no wall stands inside its zone, and its alley meets the road at the centre', () => {
    const [x, y, w, h] = m.zones!.souk;
    expect(m.rows.slice(y, y + h).map((r) => r.slice(x, x + w)).join('')).not.toContain('=');
    expect(mk(m, 'souk_alley')).toEqual([24, 18]);
  });
  it('the town is flat: no elevation grid, the walls and the gardens are the obstacle', () => {
    expect(m.elevation).toBeUndefined();
    expect(m.grove).toBe('olive');
  });
  it('the structure count leaves room to build: under the sim cap of 256 by at least 30', () => {
    expect(parseMap(m).structures.length).toBeLessThanOrEqual(226);
    expect(parseMap(J('khan_rafid_2')).structures.length).toBeLessThanOrEqual(226);
  });
});
