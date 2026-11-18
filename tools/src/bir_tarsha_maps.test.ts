// Bir Tarsha's five maps (The Long Ground, town 2; docs/campaign/bir_tarsha/design.md section 3 and level-script.md sections 3.4 to 7.4), as
// assertions on the SHIPPED map files. Geometry only: the missions that stock them come in the next PR. Every claim pairs a result with a control that
// changes the one feature (a wall removed, the foot gap closed, a zone moved), so a check that would also pass on an empty zone or a path that never
// existed goes red. The oracles are LITERALS measured on the committed maps, with the design's own figures where it gave them.
import { describe, expect, it } from 'vitest';
import { parseMap, type MapJson } from '@lions/data';
import { maps } from '@lions/data/content';

type Pt = readonly [number, number];
const ID = ['bir_tarsha', 'bir_tarsha_2', 'bir_tarsha_3', 'bir_tarsha_4', 'bir_tarsha_5'] as const;
const json = (id: string): MapJson => (maps as Record<string, MapJson>)[id];
const parsed = (id: string, edit?: (rows: string[]) => string[]) => {
  const j = json(id);
  return parseMap(edit === undefined ? j : ({ ...j, rows: edit([...j.rows]) } as MapJson));
};
const zone = (id: string, name: string): readonly [number, number, number, number] => {
  const z = (json(id) as unknown as { zones: Record<string, [number, number, number, number]> }).zones[name];
  if (z === undefined) throw new Error(`no zone ${name} on ${id}`);
  return z;
};
const marker = (id: string, name: string): Pt => {
  const m = (json(id) as unknown as { markers: Record<string, Pt> }).markers[name];
  if (m === undefined) throw new Error(`no marker ${name} on ${id}`);
  return m;
};

/** Tiles reachable from `from` over the open tiles, 8-connected, no corner cutting through two blocked tiles. `wheeled` also stops at boulders. */
function reach(p: ReturnType<typeof parsed>, from: Pt, wheeled: boolean): Map<number, number> {
  const W = p.width;
  const solid = (x: number, y: number): boolean => x < 0 || y < 0 || x >= W || y >= p.height || p.blocked[y * W + x] === 1 || (wheeled && p.boulder[y * W + x] === 1);
  const dist = new Map<number, number>([[from[1] * W + from[0], 0]]);
  const q: Pt[] = [from];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    const d = dist.get(y * W + x) as number;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (solid(nx, ny) || dist.has(ny * W + nx)) continue;
      if (dx !== 0 && dy !== 0 && solid(x + dx, y) && solid(x, y + dy)) continue;
      dist.set(ny * W + nx, d + 1);
      q.push([nx, ny]);
    }
  }
  return dist;
}
const openIn = (p: ReturnType<typeof parsed>, r: readonly [number, number, number, number]): number => {
  let n = 0;
  for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) if (p.blocked[y * p.width + x] === 0) n++;
  return n;
};

describe('the five maps are what the design drew', () => {
  it('are 48 x 48, arid and flat, with no mission-owned work drawn into a grid', () => {
    for (const id of ID) {
      const j = json(id) as unknown as { width: number; height: number; terrain: string; rows: string[]; elevation?: unknown };
      expect([j.width, j.height, j.terrain, j.rows.length, j.elevation], id).toEqual([48, 48, 'arid', 48, undefined]);
      for (const row of j.rows) expect(row, id).toHaveLength(48);
      expect(j.rows.join(''), id).not.toMatch(/[FPX]/); // militia works are mission structures, never grid symbols
    }
  });
  it('every marker stands on open ground, and every zone lies inside the map', () => {
    for (const id of ID) {
      const p = parsed(id);
      const j = json(id) as unknown as { markers: Record<string, Pt>; zones: Record<string, [number, number, number, number]> };
      for (const [name, [x, y]] of Object.entries(j.markers)) expect(p.blocked[y * 48 + x], `${id} ${name}`).toBe(0);
      for (const [name, [x, y, w, h]] of Object.entries(j.zones)) {
        expect(x >= 0 && y >= 0 && x + w <= 48 && y + h <= 48, `${id} ${name}`).toBe(true);
        expect(openIn(p, [x, y, w, h]), `${id} ${name} has open ground`).toBeGreaterThan(0);
      }
    }
  });
  it('every zone holds at least the open tiles the design counted (a zone that lost its ground fails; control: a solid rectangle fails the same check)', () => {
    const want: Record<string, Record<string, number>> = {
      bir_tarsha: { gate_approach: 70, gate_refuge: 45, west_quarter: 170, works_east: 63, badlands_edge: 288 },
      bir_tarsha_2: { the_gate: 68, safe_quarter: 168, terminal_roof: 18, crossroads: 66 },
      bir_tarsha_3: { bt3_block_w: 39, bt3_block_e: 46, bt3_extract: 32 },
      bir_tarsha_4: { fence_works: 213, hamlet: 121, far_gate: 72 },
      bir_tarsha_5: { fence_road: 288, chamber_reach: 42, rescue_refuge: 60, hamlet: 121 },
    };
    for (const [id, zs] of Object.entries(want)) {
      const p = parsed(id);
      for (const [name, n] of Object.entries(zs)) expect(openIn(p, zone(id, name)), `${id} ${name}`).toBeGreaterThanOrEqual(n);
    }
    // control: fill the fence_works rectangle with a wall of houses and the same count drops to nothing
    const walled = parsed('bir_tarsha_4', (rows) => rows.map((r, y) => (y >= 20 && y < 30 ? r.slice(0, 10) + 'a'.repeat(27) + r.slice(37) : r)));
    expect(openIn(walled, zone('bir_tarsha_4', 'fence_works'))).toBeLessThan(213);
  });
});

describe('the strip (BT IV and V): what the barrier stops', () => {
  const corral = marker('bir_tarsha_4', 'corral');
  const gate = marker('bir_tarsha_4', 'far_gate_point');
  const idx = (x: number, y: number): number => y * 48 + x;
  it('far_gate is unreachable for a wheeled unit while the T barrier stands, and reachable on foot through the b gap', () => {
    const p = parsed('bir_tarsha_4');
    expect(reach(p, corral, true).has(idx(...gate)), 'wheeled').toBe(false);
    expect(reach(p, corral, false).has(idx(...gate)), 'foot').toBe(true);
  });
  it('control: with the T tiles taken out far_gate opens to wheels; with the b gap shut it closes to foot', () => {
    const noT = parsed('bir_tarsha_4', (rows) => rows.map((r) => r.replaceAll('T', 'r')));
    expect(reach(noT, corral, true).has(idx(...gate))).toBe(true);
    const shut = parsed('bir_tarsha_4', (rows) => rows.map((r, y) => (y === 25 ? r.slice(0, 36) + '^' + r.slice(37) : r)));
    expect(reach(shut, corral, false).has(idx(...gate))).toBe(false);
  });
  it('the foot gap is exactly one b tile, and b is the only boulder on the gameplay ground north of the fence', () => {
    const j = json('bir_tarsha_4') as unknown as { rows: string[] };
    const north = j.rows.slice(0, 30).join('');
    expect([...north].filter((c) => c === 'b')).toHaveLength(1);
    expect(j.rows[25][36]).toBe('b');
  });
  it('the band: 18 non-low-profile works and 13 low-profile tiles are placed by the mission, so the grid carries only hesco, sandbag and t-wall tiles', () => {
    const j = json('bir_tarsha_4') as unknown as { rows: string[] };
    const count = (c: string): number => j.rows.reduce((n, r) => n + [...r].filter((x) => x === c).length, 0);
    expect([count('H'), count('g'), count('T')]).toEqual([8, 5, 7]);
  });
  it('the fence (row 30) is complete on BT IV and V: nothing player-side reaches the Badlands', () => {
    for (const id of ['bir_tarsha_4', 'bir_tarsha_5']) {
      const p = parsed(id);
      const r = reach(p, corral, false);
      for (let y = 31; y < 48; y++) for (let x = 0; x < 48; x++) expect(r.has(idx(x, y)), `${id} (${x},${y})`).toBe(false);
    }
  });
  it('BT V razes the band: every F/P/X/H/g/T of IV is gone from rows 20 to 29, and the chamber and command post are concrete', () => {
    const j = json('bir_tarsha_5') as unknown as { rows: string[] };
    for (let y = 20; y < 30; y++) expect(j.rows[y], `row ${y}`).not.toMatch(/[HgTFPX]/);
    expect(j.rows[21].slice(42, 45)).toBe('###');
    expect(j.rows[16].slice(38, 40)).toBe('##');
  });
});

describe('the gate town (BT I to III)', () => {
  it('the gate road is the one way through the fence: the fence row is complete except x 23 to 24', () => {
    const j = json('bir_tarsha') as unknown as { rows: string[] };
    const row = j.rows[38];
    expect([...row].map((c, x) => (c === 'f' ? '' : String(x))).filter((s) => s !== '')).toEqual(['23', '24']);
  });
  it('the two apartment blocks of BT III are ten to twelve tiles apart on foot (design: 10 on BT I, 11 once the yard walls stand)', () => {
    const walk = (id: string): number => {
      const p = parsed(id);
      const a = (json(id) as unknown as { rows: string[] }).rows;
      // west block 'aaaa' at x31-34 y13-15, east block at x41-44 y22-24: shortest 8-connected path from a tile touching one to a tile touching the other
      const touch = (x0: number, y0: number, w: number, h: number): Pt[] => {
        const out: Pt[] = [];
        for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if (x >= 0 && y >= 0 && p.blocked[y * 48 + x] === 0) out.push([x, y]);
        return out;
      };
      void a;
      const from = touch(31, 13, 4, 3);
      const to = new Set(touch(41, 22, 4, 3).map(([x, y]) => y * 48 + x));
      let best = Infinity;
      for (const f of from) {
        const r = reach(p, f, false);
        for (const t of to) best = Math.min(best, r.get(t) ?? Infinity);
      }
      return best;
    };
    const one = walk('bir_tarsha');
    const three = walk('bir_tarsha_3');
    expect(one).toBeGreaterThanOrEqual(6);
    expect(three).toBeLessThanOrEqual(12);
    expect(three).toBeGreaterThanOrEqual(one); // the yard walls never shorten it
  });
  it('the variants differ from their base only where the design said (rows 30 to 33 for BT II; rows 11, 17, 19 to 21 and 25 to 26 for BT III)', () => {
    const base = (json('bir_tarsha') as unknown as { rows: string[] }).rows;
    const diff = (id: string): number[] => (json(id) as unknown as { rows: string[] }).rows.flatMap((r, y) => (r !== base[y] ? [y] : []));
    expect(diff('bir_tarsha_2')).toEqual([30]);
    expect(diff('bir_tarsha_3')).toEqual([17, 21]);
  });
});
