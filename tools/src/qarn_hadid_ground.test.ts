// Qarn Hadid II and III on their own ground (GH-382), as assertions. Mission I keeps `qarn_hadid`
// and its doctrine and relief blocks (`qarn_hadid_doctrine.test.ts`, `qarn_hadid_relief.test.ts`); this
// file is the same method for the two maps that replaced the shared file: every claim a briefing makes about the ground is walked through the real
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

function world(json: MapJson, extra: readonly { type: string; at: Pt; size: Pt }[] = []) {
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
function path(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt, extra: readonly { type: string; at: Pt; size: Pt }[] = []): Pt[] | null {
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

/** The same map with some tiles rewritten. */
function edited(json: MapJson, edits: readonly (readonly [number, number, string])[]): MapJson {
  const rows = json.rows.map((r) => r.split(''));
  for (const [x, y, ch] of edits) rows[y][x] = ch;
  return { ...json, rows: rows.map((r) => r.join('')) } as MapJson;
}

function observer(sight: number): UnitTypeJson {
  return {
    id: `qh_obs_${sight}`,
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


const REVETMENT = [{ type: 'concrete', at: [13, 13] as Pt, size: [4, 1] as Pt }];

describe('every wave route on II (on foot) and III (on wheels) reaches its target', () => {
  for (const [mid, file] of [
    ['qarn_hadid_2_foothold', 'qarn_hadid_2'],
  ] as const) {
    for (const w of missionOf(mid).enemy?.waves ?? [])
      for (const u of w.units)
        if (u.from) it(`${mid}: ${u.from} -> ${w.to}`, () => {
          // II's waves are foot (the notch's ditch shuts it to wheels by design); III's are tested on wheels too
          const dom = file === 'qarn_hadid_2' ? 'foot' : 'vehicle';
          expect(path(J(file), dom, mk(J(file), u.from as string), mk(J(file), w.to))).not.toBeNull();
        });
  }
  it('both missions start on their own map file', () => {
    expect(missionOf('qarn_hadid_2_foothold').map.file).toBe('qarn_hadid_2');
  });
});

describe('II: the shoulder and the notch', () => {
  const m = J('qarn_hadid_2');
  const elev = (x: number, y: number) => Number(m.elevation![y][x]);
  const start = missionOf('qarn_hadid_2_foothold').map.player_start;
  const crest = mk(m, 'shoulder_gate');
  const north = mk(m, 'north_junction');
  const notchMid = mk(m, 'saddle_gate');

  it('the wall is sixteen rows of rock, rising to level 7: it reads three or more levels over the plains either side', () => {
    for (const x of [0, 5, 27, 44]) for (let y = 12; y <= 27; y++) expect(m.rows[y][x], `(${x},${y})`).toBe('^');
    expect(elev(28, 20)).toBeGreaterThanOrEqual(7);
    expect(elev(28, 20) - elev(28, 30)).toBeGreaterThanOrEqual(3);
    expect(elev(28, 20) - elev(28, 5)).toBeGreaterThanOrEqual(3);
  });
  it('the shoulder is a switchback: three legs at levels 2, 4 and 6, each walled from the next by a two-row rib', () => {
    for (const [y, lvl] of [[26, 2], [21, 4], [16, 6]] as const) for (const x of [14, 18]) expect(elev(x, y), `(${x},${y})`).toBe(lvl);
    for (const y of [23, 24, 18, 19]) expect(m.rows[y].slice(13, 19)).toBe('^^^^^^');
    expect(elev(14, 12) ).toBeLessThanOrEqual(5);
  });
  it('a vehicle climbs the switchback in 38 tiles; shut any one connector and there is no road', () => {
    expect(steps(path(m, 'vehicle', start, crest))).toBe(38);
    // control: the same ground with connector A (west end) filled in
    const cut = edited(m, [9, 10, 11].flatMap((x) => [22, 23, 24].map((y) => [x, y, '^'] as const)));
    expect(path(cut, 'vehicle', start, crest)).toBeNull();
    const cutB = edited(m, [20, 21, 22].flatMap((x) => [18, 19].map((y) => [x, y, '^'] as const)));
    expect(path(cutB, 'vehicle', start, crest)).toBeNull();
  });
  it('nothing on one leg sees the next: a rifleman on leg 1 sees along his own leg and not across the rib onto leg 2', () => {
    expect(sees(m, 8, [15, 26], [21, 26])).toBe(true);
    expect(sees(m, 8, [15, 26], [15, 21])).toBe(false);
    expect(sees(m, 8, [15, 21], [15, 16])).toBe(false);
  });
  it('the revetment seals the shoulder: with it, no vehicle route north and the way the foot takes is the notch; without it the road is open', () => {
    expect(steps(path(m, 'vehicle', start, north))).toBe(48);
    expect(path(m, 'vehicle', start, north, REVETMENT)).toBeNull();
    expect(steps(path(m, 'foot', start, north, REVETMENT))).toBe(40);
    // the foot route goes through the notch, not the switchback
    const r = path(m, 'foot', start, north, REVETMENT) as Pt[];
    expect(r.some(([x, y]) => x >= 33 && x <= 35 && y >= 12 && y <= 27)).toBe(true);
  });
  it('the notch is a straight cutting sixteen tiles long at plain level; its ditch shuts it to wheels and not to feet', () => {
    for (let y = 12; y <= 27; y++) for (let x = 33; x <= 35; x++) expect(['.', 'r', 'd']).toContain(m.rows[y][x]);
    expect(m.rows.slice(19, 21).map((r) => r.slice(33, 36))).toEqual(['ddd', 'ddd']);
    expect(path(m, 'vehicle', [34, 28], [34, 11], REVETMENT)).toBeNull();
    expect(steps(path(m, 'foot', [34, 28], [34, 11]))).toBe(17);
    const filled = edited(m, [33, 34, 35].flatMap((x) => [19, 20].map((y) => [x, y, '.'] as const)));
    expect(steps(path(filled, 'vehicle', [34, 28], [34, 11], REVETMENT))).toBe(17);
  });
  it('the cutting is covered from its north mouth end to end, and a boulder-sized rock in it breaks the line', () => {
    expect(sees(m, 17, [34, 11], [34, 27])).toBe(true);
    expect(sees(edited(m, [[34, 18, '^']]), 17, [34, 11], [34, 27])).toBe(false);
  });
  it('the notch gate and the shoulder gate cannot see each other', () => {
    expect(sees(m, 24, crest, notchMid)).toBe(false);
  });
  it('the hollow is a bowl in the south-east: floor 0, rim 3, and the camp ground is clear', () => {
    const f = mk(m, 'hollow_floor');
    expect(elev(f[0], f[1])).toBe(0);
    expect(elev(f[0] + 7, f[1])).toBeGreaterThanOrEqual(3);
    for (const [cx, cy] of [[25, 34], [26, 34], [25, 35], [26, 35]]) expect(m.rows[cy][cx]).toBe('.');
  });
  it('the boulder bench sits above the bowl on the south face: vehicles cannot cross it, men can', () => {
    expect(m.rows[29].slice(37, 47)).toBe('bbbbbbbbbb');
    // the bench spans x 37-46; its west end is the notch's own mouth, which stays open to wheels
    expect(path(m, 'vehicle', [40, 34], [40, 29])).toBeNull();
    expect(steps(path(m, 'foot', [40, 34], [40, 29]))).toBe(5);
    const flat = edited(m, Array.from({ length: 4 }, (_, j) => Array.from({ length: 10 }, (_, i) => [37 + i, 28 + j, '.'] as const)).flat());
    expect(path(flat, 'vehicle', [40, 34], [40, 29])).not.toBeNull();
  });
});
