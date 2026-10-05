// Tel Marum I, II and III on their own ground (GH-382), as assertions. The base `tel_marum` carries
// no mission any more: it is the sandbox, the golden gate's `relief` scenario and the subject of
// `tel_marum_doctrine.test.ts`, and it is not touched. The three missions that used to be 90-94%
// copies of it (`tel_marum_variants.test.ts`, retired with this file) now play on maps of their own:
//
//   I   `tel_marum_1`  the long valley -- open slopes, a stony stream with three fords, a knoll
//                      line with the hollow behind it, the pass a notch in a rock band
//   II  `tel_marum_2`  the terraced slope -- three rock risers and a gully cut up through them
//   III `tel_marum_3`  the massif -- a switchback road and a foot-only defile through twenty rows
//
// Every claim a briefing makes about the ground is walked through the real `Sim` / `FlowField`, and
// every positive is paired with a CONTROL built from the same map with one thing changed, so a route
// or a sight line that exists for another reason cannot pass for the one claimed.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, missions, parseMap, structures as structureCatalogue, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

type Pt = readonly [number, number];
type Extra = readonly { type: string; at: Pt; size: Pt }[];
const J = (id: string): MapJson => (maps as unknown as Record<string, MapJson>)[id];

function world(json: MapJson, extra: Extra = []) {
  const map = parseMap(json);
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 64 });
  applyTerrain(map, sim);
  const idx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue))
    idx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  for (const b of map.structures) sim.addStructure(idx.get(b.type) as number, b.tiles);
  for (const e of extra) {
    const tiles: number[] = [];
    for (let j = 0; j < e.size[1]; j++) for (let i = 0; i < e.size[0]; i++) tiles.push((e.at[1] + j) * map.width + e.at[0] + i);
    sim.addStructure(idx.get(e.type) as number, tiles);
  }
  return { map, sim };
}

/** Tiles on the flow-field route from `from` to `to`, or null when there is none. */
function path(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt, extra: Extra = []): Pt[] | null {
  const { map, sim } = world(json, extra);
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
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The same map with some tiles rewritten. */
function edited(json: MapJson, edits: readonly (readonly [number, number, string])[]): MapJson {
  const rows = json.rows.map((r) => r.split(''));
  for (const [x, y, ch] of edits) rows[y][x] = ch;
  return { ...json, rows: rows.map((r) => r.join('')) } as MapJson;
}
/** The same map with a rectangle's elevation set (and, if asked, its tiles rewritten). */
function levelled(json: MapJson, [x0, y0, x1, y1]: readonly number[], level: number, ch?: string): MapJson {
  const elev = (json.elevation as string[]).map((r) => r.split(''));
  const rows = json.rows.map((r) => r.split(''));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      elev[y][x] = String(level);
      if (ch !== undefined) rows[y][x] = ch;
    }
  return { ...json, elevation: elev.map((r) => r.join('')), rows: rows.map((r) => r.join('')) } as MapJson;
}
const rect = (x0: number, y0: number, x1: number, y1: number, ch: string): (readonly [number, number, string])[] => {
  const out: [number, number, string][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y, ch]);
  return out;
};

function observer(sight: number): UnitTypeJson {
  return {
    id: `tm_obs_${sight}`,
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

interface Placement {
  unit: string;
  at: Pt;
  tag?: string;
}
interface MissionJson {
  map: { file: string; player_start: Pt };
  civilians?: { groups: { at: Pt }[] };
  enemy: { garrison: Placement[]; waves?: { to: string; units: { from?: string }[] }[] };
}
const missionOf = (id: string) => (missions as unknown as Record<string, MissionJson>)[id];
const post = (mission: string, tag: string): Pt => {
  const g = missionOf(mission).enemy.garrison.find((p) => p.tag === tag);
  if (!g) throw new Error(`no placement ${tag}`);
  return [Math.floor(g.at[0]), Math.floor(g.at[1])];
};
const tilesOf = (json: MapJson, ch: string): Pt[] => {
  const out: Pt[] = [];
  json.rows.forEach((r, y) => r.split('').forEach((c, x) => c === ch && out.push([x, y])));
  return out;
};

describe('every mission starts on its own map file and every wave route reaches its target', () => {
  for (const [mid, file] of [
    ['tel_marum_1_recon', 'tel_marum_1'],
    ['tel_marum_2_foothold', 'tel_marum_2'],
  ] as const) {
    it(`${mid} plays on ${file}`, () => {
      expect(missionOf(mid).map.file).toBe(file);
    });
    for (const w of missionOf(mid).enemy.waves ?? [])
      for (const u of w.units)
        if (u.from)
          it(`${mid}: ${u.from} -> ${w.to} (on foot, and on wheels where the ground allows it)`, () => {
            const m = J(file);
            expect(path(m, 'foot', mk(m, u.from as string), mk(m, w.to))).not.toBeNull();
            expect(path(m, 'vehicle', mk(m, u.from as string), mk(m, w.to))).not.toBeNull();
          });
  }
  it('the base map carries no mission', () => {
    for (const m of Object.values(missions as unknown as Record<string, MissionJson>)) expect(m.map.file).not.toBe('tel_marum');
  });
});

describe('I: the long valley', () => {
  const m = J('tel_marum_1');
  const elev = (x: number, y: number) => Number(m.elevation![y][x]);
  const start = mk(m, 'start_line');
  const hollow = mk(m, 'hollow');
  const battery = mk(m, 'battery_position');
  const MID = 'tel_marum_1_recon';
  const FORDS = { west: rect(13, 31, 15, 34, 'b'), mid: rect(23, 38, 25, 41, 'b'), east: rect(33, 32, 35, 35, 'b') };

  it('has no flank walls: the two slopes are open ground climbing seven levels, and the only rock is the band at the head and the west spur back wall', () => {
    for (const x of [0, 1, 2, 45, 46, 47]) for (let y = 14; y < 48; y++) expect(m.rows[y][x], `(${x},${y})`).not.toBe('^');
    expect(elev(2, 30)).toBeGreaterThanOrEqual(6);
    expect(elev(45, 30)).toBeGreaterThanOrEqual(5);
    expect(elev(2, 30) - elev(24, 44)).toBeGreaterThanOrEqual(5);
    const rock = tilesOf(m, '^');
    expect(rock.filter(([, y]) => y < 8 || y > 13).every(([x, y]) => y === 17 && x >= 6 && x <= 13)).toBe(true);
    expect(path(m, 'foot', start, [3, 30])).not.toBeNull();
    expect(path(m, 'vehicle', start, [3, 30])).not.toBeNull();
  });
  it('the stream is a four-tile stony bed lying two levels under its banks, with three fords and nowhere else to cross', () => {
    const free: number[] = [];
    for (let x = 5; x <= 43; x++) if (![30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41].some((y) => m.rows[y][x] === 'b')) free.push(x);
    expect(free).toEqual([13, 14, 15, 23, 24, 25, 33, 34, 35]);
    expect(elev(30, 36) - elev(29, 37)).toBeGreaterThanOrEqual(0);
    const bed = tilesOf(m, 'b');
    expect(bed.length).toBeGreaterThan(90);
    for (const [x, y] of bed.filter(([x]) => Math.abs(x - 24) <= 12)) expect(elev(x, y), `bed (${x},${y})`).toBeLessThanOrEqual(1);
    expect(elev(10, 30)).toBeGreaterThanOrEqual(2);
  });
  it('a vehicle fords it in 15 tiles; shut the central ford and it is 24, shut all three and it is 45 -- and a rifleman never notices', () => {
    expect(steps(path(m, 'vehicle', start, hollow))).toBe(15);
    expect(steps(path(edited(m, FORDS.mid), 'vehicle', start, hollow))).toBe(24);
    expect(steps(path(edited(m, FORDS.west), 'vehicle', start, hollow))).toBe(15);
    expect(steps(path(edited(m, [...FORDS.west, ...FORDS.mid, ...FORDS.east]), 'vehicle', start, hollow))).toBe(45);
    expect(steps(path(edited(m, [...FORDS.west, ...FORDS.mid, ...FORDS.east]), 'foot', start, hollow))).toBe(15);
  });
  it('the hollow is dead ground behind a three-level swell and the knoll line, and out of the battery\'s reach; the herders\' ground is not', () => {
    for (const y of [25, 26, 27]) for (let x = 14; x <= 34; x++) expect(elev(x, y), `swell (${x},${y})`).toBeGreaterThanOrEqual(3);
    expect(elev(hollow[0], hollow[1])).toBe(1);
    expect(m.rows[26].slice(13, 17)).toBe('nnnn');
    expect(dist(battery, hollow)).toBeGreaterThan(20);
    const herders = missionOf(MID).civilians!.groups[0].at;
    expect(dist(battery, herders)).toBeLessThan(20);
    for (const from of [[24, 20], [24, 22], [24, 24]] as Pt[]) expect(sees(m, 12, from, hollow), `from ${from}`).toBe(false);
    // control: level the swell and the same watchers see it
    const flat = levelled(m, [11, 25, 37, 27], 1);
    expect(sees(flat, 12, [24, 20], hollow)).toBe(true);
    expect(sees(flat, 12, [24, 22], hollow)).toBe(true);
  });
  it('no post of the garrison sees the hollow or the approach', () => {
    for (const tag of ['tm_spotter_west', 'tm_pocket_west', 'tm_pocket_east', 'tm_picket_wide']) {
      const p = post(MID, tag);
      expect(sees(m, 10, p, hollow), tag).toBe(false);
    }
  });
  it('the pass is a notch in a six-row rock band; shut it and wheels go round the slopes, 38 tiles becoming 54', () => {
    for (let y = 8; y <= 13; y++) {
      expect(m.rows[y].slice(8, 23)).toBe('^'.repeat(15));
      expect(m.rows[y].slice(23, 27)).toBe('rrrr');
      expect(m.rows[y].slice(27, 40)).toBe('^'.repeat(13));
    }
    expect(elev(10, 10) - elev(24, 16)).toBeGreaterThanOrEqual(3);
    expect(steps(path(m, 'vehicle', start, battery))).toBe(38);
    expect(steps(path(m, 'foot', start, battery))).toBe(38);
    const shut = edited(m, rect(23, 8, 26, 13, '^'));
    expect(steps(path(shut, 'vehicle', start, battery))).toBe(54);
    expect(steps(path(shut, 'foot', start, battery))).toBe(53);
  });
  it('each Kornet pocket stands on a spur four levels over the floor under it', () => {
    const w = post(MID, 'tm_pocket_west');
    const e = post(MID, 'tm_pocket_east');
    expect(elev(w[0], w[1]) - elev(w[0], 24)).toBeGreaterThanOrEqual(3);
    expect(elev(e[0], e[1]) - elev(24, e[1])).toBeGreaterThanOrEqual(3);
    // the west spur has a rock back wall on its north face and nothing in front of it
    expect(m.rows[17].slice(6, 14)).toBe('^'.repeat(8));
    expect(elev(7, 17)).toBe(9);
  });
  it('from the approach the drone reads both spurs and the west lip, and not the battery', () => {
    const drone: Pt = mk(m, 'drone_0');
    expect(sees(m, 16, drone, post(MID, 'tm_pocket_west'))).toBe(true);
    expect(sees(m, 16, drone, post(MID, 'tm_pocket_east'))).toBe(true);
    expect(sees(m, 16, drone, post(MID, 'tm_spotter_west'))).toBe(true);
    expect(sees(m, 16, drone, battery)).toBe(false);
  });
  it('the only floor line to the battery runs up the notch inside the picket\'s rifles; the east flank gives it at 11 tiles and nothing there shoots at air', () => {
    const picket = post(MID, 'tm_picket_wide');
    expect(sees(m, 16, [24, 21], battery)).toBe(true);
    expect(dist([24, 21], picket)).toBeLessThanOrEqual(8);
    expect(sees(m, 16, [24, 22], battery)).toBe(false);
    const stand = mk(m, 'drone_standoff');
    expect(sees(m, 16, stand, battery)).toBe(true);
    expect(dist(stand, battery)).toBeLessThan(12);
    const riflemen = [post(MID, 'tm_picket_wide'), post(MID, 'tm_spotter_west')];
    for (const w of ['drone_1', 'drone_2', 'drone_3', 'drone_standoff']) for (const r of riflemen) expect(dist(mk(m, w), r), `${w} vs ${r}`).toBeGreaterThan(9);
    // the west flank is under the lip's rifles
    expect(dist([6, 23], post(MID, 'tm_spotter_west'))).toBeLessThan(8);
    // control: from a floor tile that is in range but off the notch line the rock band hides the battery, and without the band it is in plain view
    expect(sees(m, 16, [20, 20], battery)).toBe(false);
    const open = edited(levelled(m, [8, 8, 39, 13], 1), rect(8, 8, 39, 13, '.'));
    expect(sees(open, 16, [20, 20], battery)).toBe(true);
  });
  it('the herders walk to the muster ground in 20 tiles, 25 s of a 300 s clock', () => {
    const herders = missionOf(MID).civilians!.groups[0].at;
    const s = steps(path(m, 'foot', [Math.floor(herders[0]), Math.floor(herders[1])], start)) as number;
    expect(s).toBe(20);
    expect(s / 0.8).toBeLessThan(300);
  });
});

describe('II: the terraced slope', () => {
  const m = J('tel_marum_2');
  const elev = (x: number, y: number) => Number(m.elevation![y][x]);
  const MID = 'tel_marum_2_foothold';
  const start = missionOf(MID).map.player_start;
  const approach = mk(m, 'approach');
  const saddle = mk(m, 'saddle_wide');
  const SHANTY: Extra = [{ type: 'shanty', at: [28, 21], size: [2, 2] }];

  it('climbs by three terraces and a wall: each riser stands three levels over the ground it holds', () => {
    // (column, riser row, level of the ground behind it, riser's own level)
    for (const [x, y, behind, own] of [
      [5, 40, 2, 5],
      [15, 41, 2, 5],
      [15, 32, 4, 7],
      [24, 24, 5, 8],
      [38, 25, 5, 8],
    ] as const) {
      expect(m.rows[y][x], `(${x},${y})`).toBe('^');
      expect(elev(x, y)).toBe(own);
      expect(elev(x, y) - behind).toBeGreaterThanOrEqual(3);
    }
    expect(elev(24, 44)).toBe(0);
    expect(elev(20, 36)).toBe(2);
    expect(elev(20, 28)).toBe(4);
    expect(elev(20, 21)).toBe(5);
    for (let y = 12; y <= 17; y++) expect(m.rows[y].slice(0, 27)).toBe('^'.repeat(27));
    expect(elev(10, 14) - elev(10, 20)).toBeGreaterThanOrEqual(3);
  });
  it('the risers are staggered: the ramps are at the centre, the west and the centre-west, the saddle in the east', () => {
    const r = path(m, 'vehicle', start, saddle) as Pt[];
    const cross = (y: number) => r.filter((p) => p[1] === y).map((p) => p[0]);
    expect(steps(r)).toBe(31);
    const within = (xs: number[], lo: number, hi: number) => xs.length > 0 && xs.every((x) => x >= lo && x <= hi);
    expect(within(cross(41), 22, 26)).toBe(true);
    expect(within(cross(32), 11, 14)).toBe(true);
    expect(within(cross(24), 13, 22)).toBe(true);
    expect(cross(14).every((x) => x >= 27 && x <= 32)).toBe(true);
    // order along the route: R1 first, then R2, then R3
    const at = (y: number) => r.findIndex((p) => p[1] === y);
    expect(at(41)).toBeLessThan(at(32));
    expect(at(32)).toBeLessThan(at(24));
  });
  it('shut any one ramp and wheels have no way north of it; the foot still climbs the gully past the second and third', () => {
    const R1 = edited(m, rect(22, 41, 26, 41, '^'));
    const R2 = edited(m, rect(11, 32, 14, 32, '^'));
    const R3 = edited(m, rect(13, 24, 22, 24, '^'));
    expect(path(R1, 'vehicle', start, approach)).toBeNull();
    expect(path(R1, 'foot', start, saddle)).toBeNull();
    expect(path(R2, 'vehicle', start, approach)).toBeNull();
    expect(steps(path(R2, 'foot', start, saddle))).toBe(31);
    expect(steps(path(R3, 'vehicle', start, approach))).toBe(20);
    expect(path(R3, 'vehicle', start, saddle)).toBeNull();
    expect(steps(path(R3, 'foot', start, saddle))).toBe(31);
  });
  it('the approach is 20 tiles from the start line for wheels and for feet', () => {
    expect(steps(path(m, 'vehicle', start, approach))).toBe(20);
    expect(steps(path(m, 'foot', start, approach))).toBe(20);
  });
  it('the draw is a three-wide boulder gully cut diagonally up through two risers, two levels under its banks, shut to wheels', () => {
    const draw = tilesOf(m, 'b');
    expect(draw.length).toBe(44);
    expect(Math.min(...draw.map((p) => p[1]))).toBe(21);
    expect(Math.max(...draw.map((p) => p[1]))).toBe(34);
    expect(Math.max(...draw.map((p) => p[0])) - Math.min(...draw.map((p) => p[0]))).toBeGreaterThanOrEqual(8);
    expect(elev(32, 28)).toBe(2);
    expect(elev(30, 28)).toBe(4);
    expect(elev(32, 28)).toBeLessThanOrEqual(elev(30, 28) - 2);
    const head: Pt = [28, 23];
    // wheels reach the head only from the terrace above, round by the third ramp; feet go straight up the draw
    expect(steps(path(m, 'vehicle', start, head, SHANTY))).toBe(28);
    expect(steps(path(m, 'foot', start, head, SHANTY))).toBe(24);
    // control: the same ground with the boulders cleared is 24 for a vehicle too
    const plain = { ...m, rows: m.rows.map((r) => r.replace(/b/g, '.')) } as MapJson;
    expect(steps(path(plain, 'vehicle', start, head, SHANTY))).toBe(24);
    // the mission's shanty stands on boulder tiles at the draw's head
    for (const [x, y] of rect(28, 21, 29, 22, 'b')) expect(m.rows[y][x]).toBe('b');
  });
  it('the cache is in dead ground: the east pocket, the picket and the lip observer cannot see it over the draw\'s edge', () => {
    const cache: Pt = [28, 21];
    expect(sees(m, 10, post(MID, 'tm_pocket_east'), cache)).toBe(false);
    expect(sees(m, 9, post(MID, 'tm_picket_wide'), cache)).toBe(false);
    expect(sees(m, 9, post(MID, 'tm_spotter_west'), cache)).toBe(false);
    // control: fill the draw's head level with the terrace and they all see it
    const filled = levelled(m, [26, 18, 31, 24], 5);
    expect(sees(filled, 10, post(MID, 'tm_pocket_east'), cache)).toBe(true);
    expect(sees(filled, 9, post(MID, 'tm_picket_wide'), cache)).toBe(true);
  });
  it('a riser is dead ground to the one above it: behind the third, nothing on the fourth terrace sees the third', () => {
    expect(sees(m, 16, [24, 22], [24, 28])).toBe(false);
    const open = levelled(m, [0, 24, 47, 25], 5, '.');
    expect(sees(open, 16, [24, 22], [24, 28])).toBe(true);
  });
  it('the approach is watched in part: the lip observer sees 12 of its 35 tiles, the west pocket 17, the east pocket none; 17 stay in view of someone and 18 do not', () => {
    const z = m.zones!.approach;
    expect(z[2] * z[3]).toBe(35);
    const tiles: Pt[] = [];
    for (let y = z[1]; y < z[1] + z[3]; y++) for (let x = z[0]; x < z[0] + z[2]; x++) tiles.push([x, y]);
    const sp = post(MID, 'tm_spotter_west');
    const pw = post(MID, 'tm_pocket_west');
    const pe = post(MID, 'tm_pocket_east');
    const seen = (p: Pt, s: number) => tiles.filter((t) => sees(m, s, p, t));
    expect(seen(sp, 9)).toHaveLength(12);
    expect(seen(pw, 10)).toHaveLength(17);
    expect(seen(pe, 10)).toHaveLength(0);
    expect(tiles.filter((t) => sees(m, 9, sp, t) || sees(m, 10, pw, t) || sees(m, 10, pe, t))).toHaveLength(17);
    // the observer is on a shelf two levels over the approach
    expect(elev(sp[0], sp[1]) - elev(z[0] + 3, z[1] + 2)).toBeGreaterThanOrEqual(2);
  });
  it('the second terrace is out of everyone\'s sight, and the mortar stands on it', () => {
    for (const p of [post(MID, 'tm_spotter_west'), post(MID, 'tm_pocket_west'), post(MID, 'tm_pocket_east')]) expect(sees(m, 16, p, [22, 33]), `${p}`).toBe(false);
  });
});
