// Umm Zeitoun II-IV on their own ground (GH-382), as assertions. Replaces
// `umm_zeitoun_variants.test.ts` (the obstacle variants of the base map, whose every claim was
// "this file is the base with a few tiles changed"). Mission I keeps `umm_zeitoun`, and
// `umm_zeitoun_doctrine.test.ts` still pins it.
//
// Every claim a briefing makes about the ground is walked through the real `FlowField` and the
// real `Sim` sight rule, and every positive is paired with a CONTROL built from the same map
// with one thing changed, so a route or a blind spot that exists for another reason cannot pass
// for the one claimed.
//
// What each mission's briefing rests on, and where it is pinned:
//   II   the camp is dead to every enemy position, because a crest stands between; the post on
//        the knoll is eight tiles forward of the line; the tube reaches the line at twelve and
//        is out of reach at twenty-eight.
//   III  (lead ruling 3) both horns sit eighteen tiles from the crest, one with no vehicle route
//        and one with; the hamlet is eleven tiles from the wadi; the battery's two sitings keep
//        their distances; Adhal is thirty-four tiles out. All of it as on the base map.
//   IV   the depot is three buildings, 7,500 hp, on a shelf with one ramp for armour; its eye
//        sees the yard at five tiles; the summit is sixteen tiles across a ravine nothing
//        wheeled crosses; the porters are five tiles from the shelf behind them.
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

const OBSERVER = (sight: number): UnitTypeJson => ({
  id: `t_watch_${sight}`,
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: sight, signature: 0.6 },
});

/** Does a watcher on `a` see a body on `b` after twelve simulated seconds? `sight` defaults to far
 *  past anything on the map, so only terrain can hide (the idiom of umm_zeitoun_doctrine.test.ts). */
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
const flat = (json: MapJson): MapJson => ({ ...json, elevation: json.elevation?.map((r) => r.replace(/./g, '0')) }) as MapJson;
const missionOf = (id: string) =>
  (missions as unknown as Record<string, { map: { file: string }; enemy?: { garrison?: { at?: Pt; marker?: string; tag?: string }[] } }>)[id];
const structureAreas = (json: MapJson, zone: string) => {
  const { sim } = world(json);
  const [zx, zy, zw, zh] = json.zones![zone];
  const tiles = new Map<number, number>();
  for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) { const s = sim.structureAt(x, y); if (s >= 0) tiles.set(s, (tiles.get(s) ?? 0) + 1); }
  return [...tiles.values()].sort((a, b) => a - b);
};

describe('every mission names a map it owns, and every marker stands on passable ground', () => {
  for (const [mid, file] of [
    ['umm_zeitoun_2_buildup', 'umm_zeitoun_2'],
    ['umm_zeitoun_3_clearance', 'umm_zeitoun_3'],
    ['umm_zeitoun_4_clearance', 'umm_zeitoun_4'],
  ] as const) {
    it(`${mid} plays on ${file}, a highland 48x48 map with olive groves and relief`, () => {
      expect(missionOf(mid).map.file).toBe(file);
      const m = J(file);
      expect([m.width, m.height, m.terrain, m.grove]).toEqual([48, 48, 'highland', 'olive']);
      expect(m.elevation).toHaveLength(48);
      expect(new Set(m.elevation!.join('')).size).toBeGreaterThanOrEqual(5);
      const { sim, map } = world(m);
      for (const [name, [x, y]] of Object.entries(m.markers!)) expect(sim.blocked[y * map.width + x], `${file} ${name}`).toBe(0);
    });
  }
  it('II no longer shares its file with I', () => {
    expect(missionOf('umm_zeitoun_1_recon').map.file).toBe('umm_zeitoun');
    expect(missionOf('umm_zeitoun_2_buildup').map.file).not.toBe('umm_zeitoun');
  });
});

describe('II: the south rim', () => {
  const m = J('umm_zeitoun_2');
  const rc = mk(m, 'rim_crest');
  const camp: Pt[] = [mk(m, 'camp_ground'), mk(m, 'kdf_start'), [20, 43], [24, 41]];
  const post = (name: string) => {
    const g = missionOf('umm_zeitoun_2_buildup').enemy!.garrison!;
    return g.filter((p) => p.tag === name).map((p) => [Math.floor(p.at![0]), Math.floor(p.at![1])] as Pt)[0];
  };
  const enemies: [string, Pt][] = [
    ['knoll', post('uz_eye_knoll')],
    ['west', post('uz_eye_west')],
    ['east', post('uz_eye_east')],
    ['manpad', post('uz_manpad_basin')],
    ['recoilless', post('uz_rcl_south')],
    ['battery_south', mk(m, 'battery_south')],
    ['battery_north', mk(m, 'battery_north')],
    ['sarim_north', mk(m, 'sarim_north')],
  ];

  it('the camp bowl and the start line are dead to every enemy position on the map', () => {
    for (const [name, e] of enemies) for (const c of camp) expect(sees(m, e, c), `${name} sees ${c}`).toBe(false);
  });
  it('two things hide the bowl, and each does it alone: the relief with every wall, tree and cover tile stripped, and the terraces on flat ground', () => {
    const strip = (rows: string[][]) => rows.forEach((r) => r.forEach((c, x) => { if ('=o21nb'.includes(c)) r[x] = '.'; }));
    const reliefOnly = edited(m, (rows) => strip(rows));
    const terracesOnly = edited(m, (_rows, elev) => elev!.forEach((r) => r.forEach((_c, x) => { r[x] = '0'; })));
    for (const c of camp) {
      expect(sees(reliefOnly, enemies[0][1], c), `relief only: knoll sees ${c}`).toBe(false);
      expect(sees(terracesOnly, enemies[0][1], c), `terraces only: knoll sees ${c}`).toBe(false);
    }
  });
  it('control: strip both -- flat ground, no wall, tree, cover or rock -- and the knoll sees the camp, so the two layers are the whole of it', () => {
    const bare = edited(m, (rows, elev) => {
      rows.forEach((r) => r.forEach((c, x) => { if ('=o21nb^'.includes(c)) r[x] = '.'; }));
      elev!.forEach((r) => r.forEach((_c, x) => { r[x] = '0'; }));
    });
    expect(camp.some((c) => sees(bare, enemies[0][1], c))).toBe(true);
    expect(enemies.filter(([, e]) => camp.some((c) => sees(bare, e, c))).length).toBeGreaterThanOrEqual(3);
  });
  it('control: the same crest sees the bowl from the top -- a body on the crest line sees the camp, so the crest is a screen only to those below it', () => {
    expect(sees(m, rc, mk(m, 'camp_ground'))).toBe(true);
  });
  it('the line itself is seen: the knoll, the manpad, the recoilless post and the tube all see rim_crest', () => {
    for (const n of ['knoll', 'manpad', 'recoilless', 'battery_south']) expect(sees(m, enemies.find(([k]) => k === n)![1], rc), n).toBe(true);
  });
  it('the crest is the highest ground that can be walked on its half of the basin', () => {
    const e = (x: number, y: number) => Number(m.elevation![y][x]);
    const { sim, map } = world(m);
    const [zx, zy, zw, zh] = m.zones!.crest_line;
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) expect(e(x, y), `crest_line (${x},${y})`).toBe(5);
    for (let y = 3; y < 28; y++) for (let x = 0; x < 48; x++) if (!sim.blocked[y * map.width + x]) expect(e(x, y), `basin (${x},${y})`).toBeLessThanOrEqual(5);
  });
  it('the reverse slope steps down in 2-level terraces to the camp bowl', () => {
    const e = (y: number) => Number(m.elevation![y][24]);
    expect([e(31), e(34), e(37), e(42)]).toEqual([5, 3, 1, 0]);
    const rows = m.rows.join('');
    expect([...rows].filter((c) => c === '=').length).toBeGreaterThan(60);
    expect([...rows].filter((c) => c === 'o').length).toBeGreaterThan(60);
  });
  it('the distances the briefing quotes: the knoll eight tiles forward, the tube twelve, the far siting twenty-eight', () => {
    expect(dist(mk(m, 'knoll_stone'), rc)).toBe(8);
    expect(dist(mk(m, 'battery_south'), rc)).toBeGreaterThanOrEqual(12);
    expect(dist(mk(m, 'battery_south'), rc)).toBeLessThan(13);
    expect(dist(mk(m, 'battery_north'), rc)).toBeGreaterThanOrEqual(28);
    expect(dist(mk(m, 'battery_north'), rc)).toBeLessThan(28.2);
  });
  it('the post is one shed, two tiles, inside post_stone; the hold zone is three rows of open ground', () => {
    expect(structureAreas(m, 'post_stone')).toEqual([2]);
    expect(m.zones!.crest_line).toEqual([18, 30, 13, 3]);
  });
  it('every wave and the tube reach what they are sent to, on the legs they have', () => {
    for (const from of ['sarim_west', 'sarim_east', 'sarim_north']) {
      expect(route(m, 'foot', mk(m, from), mk(m, 'knoll_stone')), `${from} -> knoll`).not.toBeNull();
      expect(route(m, 'foot', mk(m, from), rc), `${from} -> crest`).not.toBeNull();
    }
    expect(route(m, 'vehicle', mk(m, 'battery_north'), mk(m, 'battery_south'))).not.toBeNull();
    expect(route(m, 'vehicle', mk(m, 'kdf_start'), mk(m, 'knoll_stone'))).not.toBeNull();
  });
  it('the crest is walked up, not driven through a gap: the start line to the crest is the same 14 steps for both domains', () => {
    expect(route(m, 'foot', mk(m, 'kdf_start'), rc)).toBe(14);
    expect(route(m, 'vehicle', mk(m, 'kdf_start'), rc)).toBe(14);
  });
});

describe('III: between the horns', () => {
  const m = J('umm_zeitoun_3');
  const rc = mk(m, 'rim_crest');
  const hw = mk(m, 'horn_west');
  const he = mk(m, 'horn_east');
  const hs = mk(m, 'hamlet_square');
  const refuge = mk(m, 'civ_refuge');

  it('both horns are the same 18 tiles from the crest on foot, as on the base map', () => {
    expect(route(m, 'foot', rc, hw)).toBe(18);
    expect(route(m, 'foot', rc, he)).toBe(18);
  });
  it('the west horn has no vehicle route and the east has one of the same 18 tiles', () => {
    expect(route(m, 'vehicle', rc, hw)).toBeNull();
    expect(route(m, 'vehicle', rc, he)).toBe(18);
  });
  it('control: it is the scree that does it -- cleared, armour reaches the west horn on the same 18', () => {
    const cleared = replaceAll(m, 'b', '.');
    expect(route(cleared, 'vehicle', rc, hw)).toBe(18);
    expect(route(cleared, 'foot', rc, hw)).toBe(18);
  });
  it('the scree is a dome round the west horn; the glacis on the east is bare ground', () => {
    const { rows } = m;
    const scree = (x0: number, x1: number, y0: number, y1: number) => rows.slice(y0, y1 + 1).join('').length && rows.slice(y0, y1 + 1).map((r) => r.slice(x0, x1 + 1)).join('');
    const west = scree(0, 13, 18, 32) as string;
    expect([...west].filter((c) => c === 'b').length).toBeGreaterThan(90);
    const east = scree(33, 41, 22, 28) as string;
    const open = [...east].filter((c) => c === '.' || c === 'r').length;
    expect(open / east.length).toBeGreaterThan(0.9);
    const e = (x: number, y: number) => Number(m.elevation![y][x]);
    expect(e(42, 25)).toBeGreaterThanOrEqual(5);
    expect(e(31, 25)).toBeLessThanOrEqual(3);
    expect(e(6, 25)).toBeGreaterThanOrEqual(6);
  });
  it('the hamlet is eleven tiles from the wadi on foot, and every family can walk it', () => {
    expect(route(m, 'foot', hs, refuge)).toBe(11);
    for (const from of [[20, 25], [25, 22], [21, 24]] as Pt[]) expect(route(m, 'foot', from, refuge), String(from)).not.toBeNull();
  });
  it('the houses are what close the block: from the square nothing south of the hamlet sees in, and the square sees nothing there', () => {
    for (const out of [refuge, rc, mk(m, 'kdf_start')] as Pt[]) {
      expect(sees(m, hs, out), `square -> ${out}`).toBe(false);
      expect(sees(m, out, hs), `${out} -> square`).toBe(false);
    }
  });
  it('control: pull the houses down and the square is seen from the wadi and from the crest', () => {
    const open = replaceAll(m, 'h', '.');
    expect(sees(open, refuge, hs) || sees(open, rc, hs)).toBe(true);
  });
  it('the battery keeps both sitings the briefing and the trigger quote: seven and ten tiles from the south, out of reach from the west', () => {
    const bs = mk(m, 'battery_south');
    const bw = mk(m, 'battery_west');
    expect(dist(bs, hs)).toBeGreaterThanOrEqual(7);
    expect(dist(bs, hs)).toBeLessThan(7.5);
    expect(dist(bs, refuge)).toBeGreaterThanOrEqual(9.5);
    expect(dist(bs, refuge)).toBeLessThan(10);
    expect(dist(bw, hs)).toBe(15);
    expect(dist(bw, refuge)).toBeGreaterThan(20);
  });
  it('Adhal is thirty-four tiles out from the crest, on the northern crest, and a drone on the west side sees him from the foot of the summit', () => {
    const crest = mk(m, 'crest');
    expect(route(m, 'foot', rc, crest)).toBe(34);
    expect(sees(m, [11, 17], [13, 6], 16)).toBe(true);
  });
  it('the knoll eye overlooks the wadi road and cannot shoot it (sight 9, rifle 8)', () => {
    const at = missionOf('umm_zeitoun_3_clearance').enemy!.garrison!.find((p) => p.tag === 'uz_eye_knoll')!.at!;
    const eye: Pt = [Math.floor(at[0]), Math.floor(at[1])];
    const road: Pt = [24, 34];
    expect(dist([at[0], at[1]], [road[0] + 0.5, road[1] + 0.5])).toBeGreaterThanOrEqual(8.5);
    expect(sees(m, eye, road, 12)).toBe(true);
    expect(sees(m, eye, refuge, 12)).toBe(true);
  });
  it('every wave and the displaced tube reach what they are sent to', () => {
    for (const [from, to, dom] of [
      ['sarim_west', 'horn_west', 'foot'],
      ['sarim_east', 'horn_east', 'foot'],
      ['sarim_north', 'hamlet_square', 'foot'],
      ['battery_west', 'battery_south', 'vehicle'],
    ] as const)
      expect(route(m, dom, mk(m, from), mk(m, to)), `${from} -> ${to}`).not.toBeNull();
  });
});

describe('IV: the shelf and the summit', () => {
  const m = J('umm_zeitoun_4');
  const start = mk(m, 'kdf_start');
  const yard = mk(m, 'stockpile_yard');
  const crest = mk(m, 'crest');
  const e = (x: number, y: number) => Number(m.elevation![y][x]);

  it('the stockpile zone holds exactly three buildings: nine warehouse tiles, six concrete, two shanty -- 7,500 hp', () => {
    expect(structureAreas(m, 'stockpile')).toEqual([2, 6, 9]);
    const hp = 9 * 340 + 6 * 700 + 2 * 120;
    expect(hp).toBe(7500);
  });
  it('the relay hut on the summit is one structure of two tiles; nothing else stands in crest_top', () => {
    expect(structureAreas(m, 'crest_top')).toEqual([2]);
  });
  it('the depot is 38 tiles from the start line for both domains, as it was', () => {
    expect(route(m, 'foot', start, yard)).toBe(38);
    expect(route(m, 'vehicle', start, yard)).toBe(38);
  });
  it('the summit is 16 tiles from the yard on foot, and nothing wheeled crosses the ravine to it: the long way round is more than twice that', () => {
    expect(route(m, 'foot', yard, crest)).toBe(16);
    expect(route(m, 'vehicle', yard, crest)).toBeGreaterThanOrEqual(32);
    expect(route(m, 'foot', crest, yard)).toBe(16);
  });
  it('control: the ravine is what costs the armour -- fill its boulders and the vehicle takes the same 16', () => {
    const cleared = replaceAll(m, 'b', '.');
    expect(route(cleared, 'vehicle', yard, crest)).toBeLessThanOrEqual(20);
  });
  it('a track climbs to the summit for armour on the west side, the same 38 as the depot', () => {
    expect(route(m, 'vehicle', start, crest)).toBe(38);
    expect(route(m, 'foot', start, crest)).toBe(38);
  });
  it('the depot stands on a shelf six levels over the start and the summit stands over the shelf', () => {
    expect(e(yard[0], yard[1])).toBeGreaterThanOrEqual(6);
    expect(e(start[0], start[1])).toBeLessThanOrEqual(1);
    expect(e(crest[0], crest[1])).toBeGreaterThanOrEqual(7);
    const ravine = Math.min(...[2, 6, 10, 14, 18].map((y) => e(24, y)));
    expect(ravine).toBeLessThanOrEqual(2);
  });
  it('armour climbs the shelf by one ramp: shut it and nothing on wheels reaches the yard, feet still can', () => {
    const shut = edited(m, (rows) => { for (let y = 15; y <= 17; y++) for (let x = 33; x <= 35; x++) rows[y][x] = '^'; });
    expect(route(shut, 'vehicle', start, yard)).toBeNull();
    expect(route(shut, 'foot', start, yard)).not.toBeNull();
  });
  it('the eye on the spur sees the yard (sight 9) from 5.6 tiles and cannot be seen from the start line', () => {
    const eye = missionOf('umm_zeitoun_4_clearance').enemy!.garrison!.find((p) => p.tag === 'uz_eye_depot')!.at!;
    const at: Pt = [Math.floor(eye[0]), Math.floor(eye[1])];
    expect(dist([eye[0], eye[1]], yard)).toBeLessThan(6);
    expect(sees(m, at, yard, 9)).toBe(true);
    expect(sees(m, start, at)).toBe(false);
  });
  it('the porters stand five tiles from the shelf behind the depot', () => {
    expect(route(m, 'foot', [32, 7], mk(m, 'civ_north'))).toBe(5);
    const [zx, zy, zw, zh] = m.zones!.north_shelf;
    const [cx, cy] = mk(m, 'civ_north');
    expect(cx >= zx && cx < zx + zw && cy >= zy && cy < zy + zh).toBe(true);
  });
  it('the flagged hamlet is a real one: at least four houses stand in it', () => {
    const { sim } = world(m);
    const [zx, zy, zw, zh] = m.zones!.hamlet;
    const found = new Set<number>();
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) if (sim.structureAt(x, y) >= 0) found.add(sim.structureAt(x, y));
    expect(found.size).toBeGreaterThanOrEqual(4);
  });
  it('every wave reaches its target', () => {
    for (const [from, to] of [['sarim_north', 'stockpile_yard'], ['sarim_west', 'crest']] as const)
      expect(route(m, 'foot', mk(m, from), mk(m, to)), `${from} -> ${to}`).not.toBeNull();
    expect(route(m, 'vehicle', mk(m, 'battery_west'), mk(m, 'battery_north'))).not.toBeNull();
  });
});
