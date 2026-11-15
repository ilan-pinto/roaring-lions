// Qasr Liwan's doctrine (The Long Ground, town 1; docs/campaign/qasr_liwan/design.md section 3.7 and level-script.md
// section 8), as assertions on the SHIPPED maps and missions.
//
// The town rests on claims a drawn sketch cannot settle, so each is driven through the real instruments (the real
// `FlowField` masks, the real `Sim`, the shipped JSON) and paired with a control that turns the one feature back into
// plain ground, or moves the subject one tile. A check with no such control also passes when the zone was empty or the
// path never existed, which is the shape this repository has been bitten by (CLAUDE.md, "Every check gets an input that
// makes it fail"). Oracles are LITERALS, measured on the committed maps; none is read back from the data under test.
//
// What these are not: QL-A1 to QL-A5 and QL-A7 are tile and circle geometry, and QL-A6 and the walks go through the
// real sim; none of them is a claim about a player's play, which is `pnpm playtest`'s.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { missionStage } from './mission-harness';
import { missionWorld } from './mission-harness';

type Pt = readonly [number, number];
type Rect = readonly [number, number, number, number];
interface Placement {
  unit: string;
  count?: number;
  at?: Pt;
  from?: string;
  stance?: { kind: string };
  group?: string;
  tag?: string;
  in_tunnel?: string;
}
interface MissionLike {
  starting_force?: Placement[];
  civilians?: { refuge: string; groups: { count: number; at: Pt }[] };
  enemy?: { garrison?: Placement[]; waves?: { to: string; units: Placement[] }[] };
  map: { player_start?: Pt };
}

const QL1 = 'qasr_liwan_1_recon';
const QL2 = 'qasr_liwan_2_foothold';
const QL3 = 'qasr_liwan_3_buildup';
const QL4 = 'qasr_liwan_4_clearance';
const QL5 = 'qasr_liwan_5_subterranean';

const world = (id: string) => missionWorld(id, {});
const zone = (id: string, name: string): Rect => {
  const z = world(id).map.zones[name];
  if (!z) throw new Error(`${id}: no zone ${name}`);
  return z as unknown as Rect;
};
const marker = (id: string, name: string): Pt => {
  const m = world(id).map.markers[name];
  if (!m) throw new Error(`${id}: no marker ${name}`);
  return [m[0], m[1]];
};
const inRect = (r: Rect, x: number, y: number): boolean => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];

/** Tiles of a zone that are open to BOTH domains, in the world exactly as the app builds it (camps raised). */
function passable(id: string, name: string, mutate?: (w: ReturnType<typeof world>) => void): { foot: number; wheel: number } {
  const w = world(id);
  mutate?.(w);
  const r = zone(id, name);
  const W = w.map.width;
  let foot = 0;
  let wheel = 0;
  for (let y = r[1]; y < r[1] + r[3]; y++)
    for (let x = r[0]; x < r[0] + r[2]; x++) {
      if (w.sim.blocked[y * W + x] === 0) foot++;
      if (w.sim.blockedVehicle[y * W + x] === 0) wheel++;
    }
  return { foot, wheel };
}

describe('QL-A1: every capture, hold and collapse zone has room to stand in', () => {
  const FLOOR = 12;
  // [mission, zone, passable tiles]. Both domains read the same on these maps: they carry no b, d or ^.
  const TABLE: readonly (readonly [string, string, number])[] = [
    [QL2, 'ring_north', 40],
    [QL2, 'the_cut', 34],
    [QL2, 'coast_road', 42],
    [QL3, 'staging', 34],
    [QL3, 'water_point', 15],
    [QL4, 'clinic_yard', 43],
    [QL5, 'pump_yard', 45],
    [QL5, 'shore_grid', 71],
  ];
  for (const [id, name, n] of TABLE) {
    it(`${id} ${name}: ${n} tiles, on foot and by wheel, above the floor of ${FLOOR}`, () => {
      const got = passable(id, name);
      expect(got.foot).toBe(n);
      expect(got.wheel).toBe(n);
      expect(n).toBeGreaterThanOrEqual(FLOOR);
    });
  }

  it('control: a wall dropped on one tile of a zone is read as one tile fewer, on foot (the count is live)', () => {
    const [id, name, n] = TABLE[0];
    const r = zone(id, name);
    const cut = passable(id, name, (w) => {
      // The first open tile of the zone (a sandbag run stands on row 1 of this one, so a fixed offset would hit a wall already).
      for (let y = r[1]; y < r[1] + r[3]; y++)
        for (let x = r[0]; x < r[0] + r[2]; x++)
          if (w.sim.blocked[y * w.map.width + x] === 0) return void (w.sim.blocked[y * w.map.width + x] = 1);
    });
    // These maps carry no b, d or ^, so the two masks are one array and the wall closes both domains.
    expect(cut.foot).toBe(n - 1);
    expect(cut.wheel).toBe(n - 1);
  });
});

describe('QL-A2: each refuge marker lies inside the zone its evacuation names', () => {
  const REFUGES: readonly (readonly [string, string, string])[] = [
    [QL1, 'ql_extract_point', 'ql_extract'],
    [QL2, 'refuge_point', 'cut_refuge'],
    [QL3, 'pause_refuge_point', 'pause_refuge'],
    [QL4, 'clinic_refuge_point', 'clinic_refuge'],
  ];
  for (const [id, m, z] of REFUGES) {
    it(`${id}: ${m} is inside ${z}`, () => {
      const [x, y] = marker(id, m);
      expect(inRect(zone(id, z), x, y)).toBe(true);
    });
  }
  it('control: the marker moved to the zone edge plus one tile reads outside (the runtime would throw at load)', () => {
    const [x, y] = marker(QL2, 'refuge_point');
    const r = zone(QL2, 'cut_refuge');
    expect(inRect(r, x, y)).toBe(true);
    expect(inRect(r, x, r[1] + r[3])).toBe(false);
  });
});

/** The foot walk, step by step, off the real FlowField: [steps, weighted length]. */
function walk(id: string, from: Pt, to: Pt): [number, number] | null {
  const w = world(id);
  const field = new FlowField(w.map.width, w.map.height);
  field.compute(w.sim.blocked, w.sim.elevation, to[0], to[1]);
  let x = from[0];
  let y = from[1];
  let n = 0;
  let len = 0;
  while (!(x === to[0] && y === to[1])) {
    const d = field.dirs[y * w.map.width + x];
    if (d === undefined || d === DIR_NONE || n > 500) return null;
    const dx = DIR_DX[d] ?? 0;
    const dy = DIR_DY[d] ?? 0;
    len += dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
    x += dx;
    y += dy;
    n++;
  }
  return [n, Math.round(len * 10) / 10];
}

/** Where body k of a placement stands: `spawnPlacement` offsets it (k mod 3) * 1.25 east and floor(k / 3) * 1.25 south. */
const body = (at: Pt, k: number): Pt => [Math.floor(at[0] + (k % 3) * 1.25), Math.floor(at[1] + Math.floor(k / 3) * 1.25)];

describe('QL-A3: the civilians', () => {
  // [mission, group at, per body: steps, weighted length]. The design said "14 or fewer" and meant STEPS (8-connected
  // moves); the weighted lengths run 15 to 20 percent longer (level-script F-9), and both are pinned.
  const WALKS: readonly (readonly [string, Pt, readonly (readonly [number, number])[]])[] = [
    [QL1, [18.5, 9.5], [[8, 9.7]]],
    [QL2, [15.5, 37.5], [[13, 16.3], [12, 15.3], [11, 13.9]]],
    [QL2, [19.5, 37.5], [[11, 13.5], [11, 13.1], [11, 12.2]]],
    [QL2, [35.5, 37.5], [[12, 13.2], [12, 13.7], [12, 14.5]]],
    [QL3, [11.5, 37.5], [[8, 8.4], [8, 8.0], [8, 8.8], [7, 7.4]]],
    [QL4, [30.5, 26.5], [[12, 13.2], [12, 13.7], [14, 15.7]]],
    [QL4, [30.5, 27.5], [[11, 12.2], [12, 13.2], [14, 15.2]]],
  ];
  for (const [id, at, expected] of WALKS) {
    it(`${id} group at ${at}: every body walks to the refuge in the pinned steps, none over 14`, () => {
      const m = (world(id).mission as unknown as MissionLike).civilians;
      expect(m).toBeDefined();
      const refuge = marker(id, m!.refuge);
      const group = m!.groups.find((g) => g.at[0] === at[0] && g.at[1] === at[1]);
      expect(group, 'the group is in the mission').toBeDefined();
      expect(group!.count).toBe(expected.length);
      expected.forEach(([steps, len], k) => {
        expect(walk(id, body(at, k), refuge), `body ${k}`).toEqual([steps, len]);
        expect(steps).toBeLessThanOrEqual(14);
      });
    });
  }

  it('every group stands more than 4 tiles (the shepherd radius) from the start and from every player placement', () => {
    for (const id of [QL1, QL2, QL3, QL4]) {
      const mission = world(id).mission as unknown as MissionLike;
      const mine: Pt[] = [mission.map.player_start ?? [0, 0]];
      for (const p of mission.starting_force ?? [])
        for (let k = 0; k < (p.count ?? 1); k++) mine.push([(p.at?.[0] ?? 0) + (k % 3) * 1.25, (p.at?.[1] ?? 0) + Math.floor(k / 3) * 1.25]);
      for (const g of mission.civilians?.groups ?? [])
        for (let k = 0; k < g.count; k++) {
          const cx = g.at[0] + (k % 3) * 1.25;
          const cy = g.at[1] + Math.floor(k / 3) * 1.25;
          for (const [mx, my] of mine) expect(Math.hypot(cx - mx, cy - my), `${id} civ (${cx},${cy}) from (${mx},${my})`).toBeGreaterThan(4);
        }
    }
  });

  it('QL III: one soldier at (12.5,40) is within the shepherd radius of all four of the taken, and not from (12.5,44)', () => {
    // Level-script F-6, bound to the SHIPPED group: the four stand together, so a single rescuer shepherds them all (the
    // "one of them is not walking" twist would have needed the fourth 8.1 tiles from the other three). The second point is the control.
    const group = (world(QL3).mission as unknown as MissionLike).civilians!.groups[0];
    expect(group.count).toBe(4);
    const near = (sx: number, sy: number): number[] =>
      [0, 1, 2, 3].map((k) => Math.hypot(group.at[0] + (k % 3) * 1.25 - sx, group.at[1] + Math.floor(k / 3) * 1.25 - sy));
    for (const d of near(12.5, 40)) expect(d).toBeLessThan(4);
    expect(Math.max(...near(12.5, 44))).toBeGreaterThan(4);
  });
});

describe('QL-A4: what stands in the two zones QL IV protects', () => {
  it('clinic_yard holds sandbags and nothing else; the clinic zone holds exactly one clinic of 12 tiles', () => {
    const w = world(QL4);
    const yard = zone(QL4, 'clinic_yard');
    const clinic = zone(QL4, 'clinic');
    const W = w.map.width;
    const within = (r: Rect, s: { tiles: number[] }): number => s.tiles.filter((t) => inRect(r, t % W, Math.floor(t / W))).length;
    const inYard = w.map.structures.filter((s) => within(yard, s) > 0);
    expect(inYard.map((s) => s.type)).toEqual(['sandbag_wall', 'sandbag_wall']); // two one-tile runs
    expect(inYard.reduce((n, s) => n + within(yard, s), 0)).toBe(2);
    const inClinic = w.map.structures.filter((s) => within(clinic, s) > 0);
    expect(inClinic.map((s) => s.type)).toEqual(['clinic']);
    expect(inClinic[0].tiles).toHaveLength(12);
  });
  it('control: the yard rectangle slid five tiles east takes the clinic in, so the filter above is not vacuous', () => {
    const w = world(QL4);
    const W = w.map.width;
    const slid: Rect = [30, 20, 5, 9];
    const types = w.map.structures.filter((s) => s.tiles.some((t) => inRect(slid, t % W, Math.floor(t / W)))).map((s) => s.type);
    expect(types).toContain('clinic');
  });
});

describe('QL-A5: QL V\'s routes against the collapse zone and the depot', () => {
  const inGrid = (id: string, p: Pt): boolean => inRect(zone(id, 'shore_grid'), p[0], p[1]);
  const inDepot = (id: string, p: Pt): boolean => inRect(zone(id, 'relief_depot'), p[0], p[1]);
  const ROUTES: readonly (readonly [string, Pt, boolean, Pt, boolean])[] = [
    ['ql5_shallow_n', [15, 24], false, [6, 24], false],
    ['ql5_shallow_s', [19, 34], false, [6, 34], false],
    ['ql5_deep_depot', [11, 29], true, [11, 23], true],
    ['ql5_deep_quay', [9, 34], true, [1, 37], false],
    ['ql5_deep_cut', [15, 35], true, [22, 39], false],
  ];
  for (const [rid, mouth, mouthInGrid, vent, ventInDepot] of ROUTES) {
    it(`${rid}: mouth ${mouth} ${mouthInGrid ? 'in' : 'outside'} shore_grid, vent ${vent} ${ventInDepot ? 'inside' : 'outside'} relief_depot`, () => {
      const t = world(QL5).map.tunnels.find((r) => r.id === rid);
      expect(t, 'the route is on the map').toBeDefined();
      expect([t!.points[0][0], t!.points[0][1]]).toEqual([...mouth]);
      const last = t!.points[t!.points.length - 1];
      expect([last[0], last[1]]).toEqual([...vent]);
      expect(inGrid(QL5, mouth)).toBe(mouthInGrid);
      expect(inDepot(QL5, vent)).toBe(ventInDepot);
    });
  }
  it('control: the collapse counts mouths, so the grid names exactly the three deep routes (and the dug one is the only route not pre_dug)', () => {
    const w = world(QL5);
    const inside = w.map.tunnels.filter((r) => inGrid(QL5, [r.points[0][0], r.points[0][1]])).map((r) => r.id);
    expect(inside.sort()).toEqual(['ql5_deep_cut', 'ql5_deep_depot', 'ql5_deep_quay']);
    expect(w.map.tunnels.filter((r) => !r.preDug).map((r) => r.id)).toEqual(['ql5_deep_cut']);
  });
});

describe('QL-A6: the depot route can be found without standing in the depot', () => {
  // A ground mark_tunnel observer (the dog, sight 12) on a tile, on a fresh sim, one tick: is route 2 (ql5_deep_depot) identified?
  const DEPOT_ROUTE = 2;
  function identifiedFrom(x: number, y: number): boolean {
    const st = missionStage(QL5);
    const dog = st.sim.unitTypes.findIndex((u) => u.id === 'ugv_recon_dog');
    expect(dog).toBeGreaterThanOrEqual(0);
    st.sim.spawn(dog, 0, fx.from(x + 0.5), fx.from(y + 0.5));
    st.sim.tick();
    return st.sim.tunnelContactLevel(0, DEPOT_ROUTE) === 2;
  }
  it('from (11,30), outside relief_depot and beside the mouth, the route is identified', () => {
    expect(inRect(zone(QL5, 'relief_depot'), 11, 30)).toBe(false);
    expect(identifiedFrom(11, 30)).toBe(true);
  });
  it('from (16,14), 9 tiles north-east of the vent and outside the depot walls, the route is identified (the sight is 12)', () => {
    // Measured over x 0-29, y 14-41: 290 passable tiles outside the depot identify it, 180 of them 8 or more tiles from the mouth.
    expect(inRect(zone(QL5, 'relief_depot'), 16, 14)).toBe(false);
    expect(identifiedFrom(16, 14)).toBe(true);
  });
  it('control: from the start line (24,44), 20 tiles away, it is not (the observer is not omniscient)', () => {
    expect(identifiedFrom(24, 44)).toBe(false);
  });
});

/** Distances from a point to the nearest tile centre inside a zone, and to the zone's rectangle. */
function toZone(p: Pt, r: Rect): { centre: number; edge: number } {
  let centre = Infinity;
  for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) centre = Math.min(centre, Math.hypot(p[0] - (x + 0.5), p[1] - (y + 0.5)));
  const dx = Math.max(r[0] - p[0], 0, p[0] - (r[0] + r[2]));
  const dy = Math.max(r[1] - p[1], 0, p[1] - (r[1] + r[3]));
  return { centre, edge: Math.hypot(dx, dy) };
}

describe('QL-A7: the pause (QL III) is distance and stance', () => {
  // Every enemy body that is not the handover party (exempt before 90 s), against the three zones the player needs.
  // The floor is the longest ground sight in the issued force (10: the Eitan and the jeep) plus one.
  const FLOOR_CENTRE = 11.0;
  const FLOOR_EDGE = 10.5;
  const mins = (garrison: Placement[]): Record<string, { centre: number; edge: number }> => {
    const out: Record<string, { centre: number; edge: number }> = {};
    for (const zn of ['staging', 'handover', 'water_point']) {
      let centre = Infinity;
      let edge = Infinity;
      for (const p of garrison) {
        if (p.group === 'handover_party') continue;
        for (let k = 0; k < (p.count ?? 1); k++) {
          const d = toZone([(p.at?.[0] ?? 0) + (k % 3) * 1.25, (p.at?.[1] ?? 0) + Math.floor(k / 3) * 1.25], zone(QL3, zn));
          centre = Math.min(centre, d.centre);
          edge = Math.min(edge, d.edge);
        }
      }
      out[zn] = { centre: Math.round(centre * 10) / 10, edge: Math.round(edge * 10) / 10 };
    }
    return out;
  };
  const garrison = (): Placement[] => (world(QL3).mission as unknown as MissionLike).enemy!.garrison!;

  it('no standing body is nearer than the floor to staging, the handover or the water point', () => {
    const m = mins(garrison());
    expect(m).toEqual({
      staging: { centre: 12.0, edge: 11.5 },
      handover: { centre: 11.3, edge: 10.7 },
      water_point: { centre: 13.0, edge: 12.5 },
    });
    for (const zn of Object.keys(m)) {
      expect(m[zn].centre).toBeGreaterThanOrEqual(FLOOR_CENTRE);
      expect(m[zn].edge).toBeGreaterThanOrEqual(FLOOR_EDGE);
    }
  });

  it('control: the west line moved 3 tiles south reads nearer, and under the floor (the check can fail)', () => {
    const moved = garrison().map((p) => (p.group === 'pause_lines' && p.at?.[0] === 5.5 ? { ...p, at: [p.at[0], p.at[1] + 3] as Pt } : p));
    expect(mins(moved).handover.edge).toBeLessThan(FLOOR_EDGE);
  });

  it('the handover party stands within 4 tiles of the taken, which is the point (it steps back at 90 s)', () => {
    const party = garrison().find((p) => p.group === 'handover_party');
    expect(party).toBeDefined();
    const civ = (world(QL3).mission as unknown as MissionLike).civilians!.groups[0].at;
    expect(Math.hypot(party!.at![0] - civ[0], party!.at![1] - civ[1])).toBeLessThan(4);
  });
});

describe('QL-A8: QL I\'s mortar reaches the courtyard and not the extraction', () => {
  const MORTAR = 'ql_mortar';
  const RANGE = 16;
  const mortarAt = (): Pt => {
    const m = (world(QL1).mission as unknown as MissionLike).enemy!.garrison!.find((p) => p.tag === MORTAR);
    return m!.at as Pt;
  };
  const d = (a: Pt, b: Pt): number => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 10) / 10;

  it('is at (8.5,15.5), marker mortar_lot at (8,15)', () => {
    expect(mortarAt()).toEqual([8.5, 15.5]);
    expect(marker(QL1, 'mortar_lot')).toEqual([8, 15]);
  });
  it('reaches the courtyard, the gate and the lane, and stops short of the north road past x=18', () => {
    const m = mortarAt();
    expect(d(m, [18.5, 9.5])).toBe(11.7);
    expect(d(m, [18.5, 7.5])).toBe(12.8);
    expect(d(m, [18.5, 6.5])).toBe(13.5);
    expect(d(m, [18.5, 3.5])).toBe(15.6);
    expect(d(m, [19.5, 3.5])).toBe(16.3);
    expect(d(m, [22.5, 1.5])).toBe(19.8);
    for (const p of [[18.5, 9.5], [18.5, 7.5], [18.5, 6.5], [18.5, 3.5]] as Pt[]) expect(d(m, p)).toBeLessThanOrEqual(RANGE);
    for (const p of [[19.5, 3.5], [22.5, 1.5]] as Pt[]) expect(d(m, p)).toBeGreaterThan(RANGE);
  });
  it('is at least 16.5 from every tile of ql_extract (the nearest edge is 17.0)', () => {
    const r = zone(QL1, 'ql_extract');
    const m = mortarAt();
    expect(toZone(m, r).edge).toBeCloseTo(17.0, 1);
    expect(toZone(m, r).centre).toBeGreaterThanOrEqual(16.5);
  });
  it('control: the design\'s (10.5,15.5) put the extraction\'s nearest edge at 15.7, inside the range, which is why it moved', () => {
    const r = zone(QL1, 'ql_extract');
    expect(toZone([10.5, 15.5], r).edge).toBeCloseTo(15.7, 1);
    expect(toZone([10.5, 15.5], r).edge).toBeLessThan(RANGE);
  });
});

describe('the billing floor (D-5): a weapon authored at exactly 0.30 bills a stray', () => {
  it('fx.from(0.3) is 19661, the integer mission.ts bills at', () => {
    expect(fx.from(0.3)).toBe(19661);
    expect(fx.from(0.29)).toBeLessThan(19661);
  });
  it('the KDF weapons at or above 0.3 are exactly these twelve (a retune across the line goes red here)', () => {
    const dir = join(__dirname, '..', '..', 'data', 'units', 'kdf');
    const found: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      const u = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { id: string; weapons?: { id: string; collateral_risk?: number }[] };
      for (const w of u.weapons ?? []) if ((w.collateral_risk ?? 0) >= 0.3) found.push(`${u.id} ${w.id} ${w.collateral_risk}`);
    }
    expect(found).toEqual([
      'at_team spike_atgm 0.3',
      'attack_drone warhead 0.35',
      'demo_squad charges 0.6',
      'heli_peten chain_gun_30 0.5',
      'heli_peten_gunship chain_gun_30 0.5',
      'ifv_namer cannon_30 0.35',
      'inf_grenadier gl_40 0.3',
      'mbt_lavi gun_120 0.55',
      'mbt_lavi_camo gun_120 0.55',
      'mortar_team mortar_60 0.7',
      'spg_cluster dpicm_155 0.95',
      'spg_long_range howitzer_155 0.8',
    ]);
  });
});

describe('every standing placement, wave marker and civilian body stands on open ground (level-script F-3)', () => {
  const bodies = (id: string): { what: string; p: Pt }[] => {
    const mission = world(id).mission as unknown as MissionLike;
    const w = world(id);
    const out: { what: string; p: Pt }[] = [];
    const add = (what: string, pl: Placement | { count: number; at: Pt }, from?: Pt, half = 0): void => {
      const base = from ?? (pl as Placement).at;
      if (!base) return;
      for (let k = 0; k < ((pl as { count?: number }).count ?? 1); k++)
        out.push({ what: `${what}#${k}`, p: [Math.floor(base[0] + half + (k % 3) * 1.25), Math.floor(base[1] + half + Math.floor(k / 3) * 1.25)] });
    };
    for (const p of mission.starting_force ?? []) add(`${id} force ${p.unit}`, p);
    for (const g of mission.civilians?.groups ?? []) add(`${id} civilians`, g);
    for (const p of mission.enemy?.garrison ?? []) {
      if (p.stance?.kind === 'garrison' || p.in_tunnel !== undefined || (p as { digs?: string }).digs !== undefined) continue;
      add(`${id} garrison ${p.unit}`, p);
    }
    for (const wv of mission.enemy?.waves ?? [])
      for (const u of wv.units) {
        const m = w.map.markers[u.from!];
        add(`${id} wave ${u.unit} from ${u.from}`, u, [m[0], m[1]], 0.5);
      }
    return out;
  };
  for (const id of [QL1, QL2, QL3, QL4, QL5]) {
    it(`${id}: no body of a standing group is inside a wall, a building or a camp`, () => {
      const w = world(id);
      const W = w.map.width;
      for (const b of bodies(id)) expect(w.sim.blocked[b.p[1] * W + b.p[0]], `${b.what} at ${b.p}`).toBe(0);
    });
  }
  it('control: QL IV\'s forecourt group at the design\'s (32.5,26.5) puts a body on the east wall at (35,26)', () => {
    const w = world(QL4);
    expect(w.sim.blocked[26 * w.map.width + 35]).toBe(1);
    expect(body([32.5, 26.5], 2)).toEqual([35, 26]);
  });
});
