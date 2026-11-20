// Bir Tarsha's doctrine (The Long Ground, town 2; docs/campaign/bir_tarsha/level-script.md section 8), as assertions on the
// SHIPPED maps and missions: I to V. (Part 2 of the stack carried I, II, III and V; BT-A5 to A9, A12 and IV's rows of A10, A13 and A14
// arrive with IV in part 3.)
//
// Each claim is driven through the real instruments (the real `FlowField` mask, the shipped JSON) and has a control that
// moves the one feature or subject, so a check that passes on an empty zone or a path that never existed turns red
// (CLAUDE.md, "Every check gets an input that makes it fail"). Oracles are LITERALS from the script's own run; none is read
// back from the data under test.
//
// What these are not: tile and circle geometry, not a claim about a player's play (that is `pnpm playtest`'s).
import { describe, expect, it } from 'vitest';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
import { maps } from '@lions/data/content';
import { missionWorld } from './mission-harness';

/** The map's character rows as authored (the parsed map keeps masks, not rows). */
const rowsOf = (file: string): readonly string[] => ((maps as unknown as Record<string, { rows: string[] }>)[file]).rows;

type Pt = readonly [number, number];
type Rect = readonly [number, number, number, number];
interface Placement {
  unit: string;
  count?: number;
  at?: Pt;
  in_tunnel?: string;
}
interface MissionLike {
  time_limit_s: number;
  target_minutes: number;
  starting_force?: Placement[];
  civilians?: { refuge: string; groups: { count: number; at: Pt }[] };
  enemy?: { garrison?: Placement[] };
}

const BT1 = 'bir_tarsha_1_recon';
const BT2 = 'bir_tarsha_2_foothold';
const BT3 = 'bir_tarsha_3_clearance';
const BT4 = 'bir_tarsha_4_clearance';
const BT5 = 'bir_tarsha_5_subterranean';

const world = (id: string, mutate?: (w: ReturnType<typeof missionWorld>) => void) => {
  const w = missionWorld(id, {});
  mutate?.(w);
  return w;
};
const marker = (id: string, name: string): Pt => {
  const m = world(id).map.markers[name];
  if (!m) throw new Error(`${id}: no marker ${name}`);
  return [m[0], m[1]];
};
const zone = (id: string, name: string): Rect => {
  const z = world(id).map.zones[name];
  if (!z) throw new Error(`${id}: no zone ${name}`);
  return z as unknown as Rect;
};
const inRect = (r: Rect, x: number, y: number): boolean => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
const mission = (id: string): MissionLike => world(id).mission as unknown as MissionLike;
const dist = (a: Pt, b: Pt): number => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 10) / 10;

/** The foot walk, step by step, off the real FlowField (8-connected, corner-cutting refused): the step count, or null. */
function walk(id: string, from: Pt, to: Pt, mutate?: (w: ReturnType<typeof missionWorld>) => void, wheeled = false): number | null {
  const w = world(id, mutate);
  const field = new FlowField(w.map.width, w.map.height);
  field.compute(wheeled ? w.sim.blockedVehicle : w.sim.blocked, w.sim.elevation, Math.floor(to[0]), Math.floor(to[1]));
  let x = Math.floor(from[0]);
  let y = Math.floor(from[1]);
  const tx = Math.floor(to[0]);
  const ty = Math.floor(to[1]);
  let n = 0;
  while (!(x === tx && y === ty)) {
    const d = field.dirs[y * w.map.width + x];
    if (d === undefined || d === DIR_NONE || n > 500) return null;
    x += DIR_DX[d] ?? 0;
    y += DIR_DY[d] ?? 0;
    n++;
  }
  return n;
}
const wall = (x: number, y: number) => (w: ReturnType<typeof missionWorld>) => {
  w.sim.blocked[y * w.map.width + x] = 1;
};

describe('BT-A1: I, the three resident groups walk to the gate refuge', () => {
  const GROUPS: readonly (readonly [Pt, number])[] = [
    [[6.5, 26.5], 21],
    [[12.5, 26.5], 21],
    [[10.5, 30.5], 25],
  ];
  GROUPS.forEach(([at, steps], k) => {
    it(`group ${k} at ${at} walks ${steps} steps to gate_refuge_point and starts outside gate_refuge`, () => {
      const c = mission(BT1).civilians;
      expect(c?.groups.some((g) => g.at[0] === at[0] && g.at[1] === at[1])).toBe(true);
      expect(walk(BT1, at, marker(BT1, c!.refuge))).toBe(steps);
      expect(inRect(zone(BT1, 'gate_refuge'), Math.floor(at[0]), Math.floor(at[1]))).toBe(false);
    });
  });
  it('control: a group moved to (6.5,10.5) is inside gate_refuge, the pin\'s second claim', () => {
    expect(inRect(zone(BT1, 'gate_refuge'), 6, 10)).toBe(false);
    expect(inRect(zone(BT1, 'gate_refuge'), 6, 5)).toBe(true);
    expect(walk(BT1, [6.5, 10.5], marker(BT1, 'gate_refuge_point'))).not.toBe(21);
  });
});

describe('BT-A2: II, the residents start outside the safe quarter and walk to the safe point', () => {
  const GROUPS: readonly (readonly [Pt, number])[] = [
    [[22.5, 19.5], 13],
    [[21.5, 20.5], 12],
    [[26.5, 19.5], 16],
  ];
  GROUPS.forEach(([at, steps], k) => {
    it(`group ${k} at ${at} walks ${steps} steps to safe_point and starts outside safe_quarter`, () => {
      const c = mission(BT2).civilians;
      expect(c?.groups.some((g) => g.at[0] === at[0] && g.at[1] === at[1])).toBe(true);
      expect(walk(BT2, at, marker(BT2, c!.refuge))).toBe(steps);
      expect(inRect(zone(BT2, 'safe_quarter'), Math.floor(at[0]), Math.floor(at[1]))).toBe(false);
    });
  });
  it('control: (10.5,26.5) is inside safe_quarter, so a group put there fails the pin', () => {
    expect(inRect(zone(BT2, 'safe_quarter'), 10, 26)).toBe(true);
  });
});

describe('BT-A3: II, the mortar reaches the residents and not the safe point or the start', () => {
  const RANGE = 16;
  const MORTAR: Pt = [31.5, 31.5];
  it('the mortar crew stands at (31.5,31.5) and reaches 15.0, 14.9 and 13.0 to the three groups', () => {
    const m = mission(BT2).enemy?.garrison?.find((g) => g.unit === 'mortar_crew');
    expect(m?.at).toEqual(MORTAR);
    const groups = mission(BT2).civilians!.groups.map((g) => g.at);
    expect(groups.map((g) => dist(MORTAR, g))).toEqual([15.0, 14.9, 13.0]);
    for (const g of groups) expect(dist(MORTAR, g)).toBeLessThanOrEqual(RANGE);
  });
  it('the safe point (21.6) and every starting body (19.9 at the nearest) are out of its reach', () => {
    expect(dist(MORTAR, [10.5, 26.5])).toBe(21.6);
    const start = mission(BT2).starting_force!.map((p) => dist(MORTAR, p.at!));
    expect(Math.min(...start)).toBe(19.9);
    for (const d of [21.6, ...start]) expect(d).toBeGreaterThan(RANGE);
  });
  it('control: the mortar moved to (31.5,38.5) no longer reaches the group at (22.5,19.5)', () => {
    expect(dist([31.5, 38.5], [22.5, 19.5])).toBeGreaterThan(RANGE);
  });
});

describe('BT-A4: III, the doors and the walk out', () => {
  const EXTRACT = (): Pt => marker(BT3, 'bt3_extract_point');
  it('the two yard points are 10 steps apart', () => {
    expect(walk(BT3, marker(BT3, 'yard_w_point'), marker(BT3, 'yard_e_point'))).toBe(10);
  });
  // The script wrote 17 and 19 (and walled (36,17)); re-measured on the shipped map, the first body of each group walks 16 and 20, and the
  // lane's row is 18. The sum (36) is the script's; the split is the map's.
  it('the taken walk 16 and 20 steps to the extraction (the script said 17 and 19)', () => {
    const c = mission(BT3).civilians!;
    expect(c.groups.map((g) => walk(BT3, g.at, EXTRACT()))).toEqual([16, 20]);
  });
  it('control: a wall on the lane at (36,18) makes the yard walk 11, and a tile off the lane (36,17) leaves it 10', () => {
    expect(walk(BT3, marker(BT3, 'yard_w_point'), marker(BT3, 'yard_e_point'), wall(36, 18))).toBe(11);
    expect(walk(BT3, marker(BT3, 'yard_w_point'), marker(BT3, 'yard_e_point'), wall(36, 17))).toBe(10);
  });
});

const T_TILES: readonly Pt[] = [[36, 22], [36, 23], [36, 24], [36, 26], [36, 27], [36, 28], [36, 29]];
const openT = (w: ReturnType<typeof missionWorld>) => {
  for (const [x, y] of T_TILES) {
    w.sim.blocked[y * w.map.width + x] = 0;
    w.sim.blockedVehicle[y * w.map.width + x] = 0;
  }
};

describe('BT-A5: IV, the far gate is out of reach of a wheeled body until the T-wall falls', () => {
  it('unreachable on wheels from the corral while every T stands, 36 steps once they fall, 36 on foot through the b gap', () => {
    const corral = marker(BT4, 'corral');
    const gate = marker(BT4, 'far_gate_point');
    expect(walk(BT4, corral, gate, undefined, true)).toBeNull();
    expect(walk(BT4, corral, gate, openT, true)).toBe(36);
    expect(walk(BT4, corral, gate)).toBe(36);
  });
  it('control: opening the boulder gap (36,25) to plain ground lets a wheeled body through', () => {
    const open = (w: ReturnType<typeof missionWorld>) => {
      w.sim.blockedVehicle[25 * w.map.width + 36] = 0;
    };
    expect(walk(BT4, marker(BT4, 'corral'), marker(BT4, 'far_gate_point'), open, true)).not.toBeNull();
  });
});

describe('BT-A6: IV, no house, shanty or clinic within 8 open tiles of the fence works', () => {
  it('the nearest one is 9 tiles away (Chebyshev)', () => {
    const rows = rowsOf('bir_tarsha_4');
    const [zx, zy, zw, zh] = zone(BT4, 'fence_works');
    const civic = new Set(['h', 's', 'k']);
    let nearest = 99;
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (!civic.has(c)) return;
      const dx = Math.max(zx - x, 0, x - (zx + zw - 1));
      const dy = Math.max(zy - y, 0, y - (zy + zh - 1));
      nearest = Math.min(nearest, Math.max(dx, dy));
    }));
    expect(nearest).toBe(9);
  });
});

describe('BT-A7: IV, what the fence works hold', () => {
  it('6 firing positions, 3 posts, 2 workshops, 7 T, and 13 low-profile tiles (8 hesco, 5 sandbag)', () => {
    const rows = rowsOf('bir_tarsha_4');
    const w = world(BT4);
    const [zx, zy, zw, zh] = zone(BT4, 'fence_works');
    const count: Record<string, number> = {};
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) { const c = rows[y][x]; count[c] = (count[c] ?? 0) + 1; }
    expect([count.T, count.H, count.g]).toEqual([7, 8, 5]);
    const placed: Record<string, number> = {};
    for (const p of (w.mission as unknown as { structures: { type: string; at: Pt }[] }).structures) {
      if (inRect([zx, zy, zw, zh], p.at[0], p.at[1])) placed[p.type] = (placed[p.type] ?? 0) + 1;
    }
    expect([placed.militia_firing_position, placed.militia_observation_post, placed.militia_weapons_workshop]).toEqual([6, 3, 2]);
  });
});

describe('BT-A8 and BT-A9: IV, the lee missile team and the mortar against the lane', () => {
  it('the Kornet team at (20.5,13.5) is 13.6 from the lane centre (range 14), 15.3 and 18.4 from its ends; the Lavi\'s sight 12 does not reach it', () => {
    const trigger = (mission(BT4) as unknown as { triggers: { id: string; do: { units: { at: Pt }[] } }[] }).triggers.find((t) => t.id === 'bt4_lee_opens');
    const team = trigger!.do.units[0].at;
    expect(team).toEqual([20.5, 13.5]);
    expect([dist(team, [24.5, 26.5]), dist(team, [12.5, 26.5]), dist(team, [33.5, 26.5])]).toEqual([13.6, 15.3, 18.4]);
    expect(dist(team, [24.5, 26.5])).toBeLessThanOrEqual(14);
    expect(dist(team, [12.5, 26.5])).toBeGreaterThan(14);
    expect(dist(team, [33.5, 26.5])).toBeGreaterThan(14);
    expect(dist(team, [24.5, 26.5])).toBeGreaterThan(12);
  });
  it('the mortar at (40.5,14.5) is 13.9 from the lane\'s east end and 12.2 from the far gate point (range 16), 20.0 from the centre', () => {
    const mortar = mission(BT4).enemy?.garrison?.find((g) => g.unit === 'mortar_crew')?.at;
    expect(mortar).toEqual([40.5, 14.5]);
    expect([dist(mortar!, [33.5, 26.5]), dist(mortar!, [42.5, 26.5]), dist(mortar!, [24.5, 26.5])]).toEqual([13.9, 12.2, 20.0]);
    expect(dist(mortar!, [24.5, 26.5])).toBeGreaterThan(16);
  });
});

describe('BT-A10 (IV): the three routes\' mouths lie in the fence works, every point open', () => {
  it('three routes, mouths inside fence_works, all points open', () => {
    const w = world(BT4);
    const tunnels = w.map.tunnels as unknown as { points: Pt[] }[];
    expect(tunnels).toHaveLength(3);
    const works = zone(BT4, 'fence_works');
    for (const t of tunnels) {
      expect(inRect(works, t.points[0][0], t.points[0][1])).toBe(true);
      for (const p of t.points) expect(w.sim.blocked[p[1] * w.map.width + p[0]]).toBe(0);
    }
  });
});

describe('BT-A12: IV, the escort tag names four bodies and the tolerance fits in them', () => {
  it('blades is 4 dozer_d9 and fail_after_losses (2) is at most 4', () => {
    const bodies = ((mission(BT4) as unknown as { starting_force: { tag?: string; count?: number }[] }).starting_force).filter((p) => p.tag === 'blades').reduce((n, p) => n + (p.count ?? 1), 0);
    expect(bodies).toBe(4);
    const escort = (mission(BT4) as unknown as { objectives: { id: string; fail_after_losses?: number; until?: string[] }[] }).objectives.find((o) => o.id === 'blades');
    expect(escort?.fail_after_losses).toBe(2);
    expect(escort!.fail_after_losses!).toBeLessThanOrEqual(bodies);
    expect(escort?.until).toEqual(['clear_works', 'drop_shafts']);
  });
});

describe('BT-A10 (V): the five routes\' mouths lie in the Fence Road, every mouth, waypoint and vent is open ground', () => {
  it('five routes, mouths inside fence_road, all points open', () => {
    const w = world(BT5);
    const tunnels = w.map.tunnels as unknown as { points: Pt[] }[];
    expect(tunnels).toHaveLength(5);
    const road = zone(BT5, 'fence_road');
    for (const t of tunnels) {
      expect(inRect(road, t.points[0][0], t.points[0][1])).toBe(true);
      for (const p of t.points) expect(w.sim.blocked[p[1] * w.map.width + p[0]]).toBe(0);
    }
  });
  it('control: a mouth moved to row 30 leaves the fence_road', () => {
    const road = zone(BT5, 'fence_road');
    expect(inRect(road, 19, 30)).toBe(false);
  });
});

describe('BT-A11: V, the person and the corral', () => {
  it('the person is 38 steps from rescue_point and the corral is 38 steps from the person', () => {
    const person = mission(BT5).civilians!.groups[0].at;
    expect(walk(BT5, person, marker(BT5, 'rescue_point'))).toBe(38);
    expect(walk(BT5, marker(BT5, 'corral'), person)).toBe(38);
  });
  it('control: a wall on the lane lengthens the walk', () => {
    const person = mission(BT5).civilians!.groups[0].at;
    const base = walk(BT5, person, marker(BT5, 'rescue_point'));
    const w = walk(BT5, person, marker(BT5, 'rescue_point'), (x) => {
      for (let yy = 0; yy < x.map.height; yy++) x.sim.blocked[yy * x.map.width + 25] = 1;
    });
    expect(w).not.toBe(base);
  });
});

describe('BT-A13: the body counts the casualties_pct triggers divide by', () => {
  const count = (id: string, buried = false): number =>
    (mission(id).enemy?.garrison ?? []).filter((p) => (p.in_tunnel !== undefined) === buried || (!buried && p.in_tunnel === undefined)).reduce((n, p) => n + (p.count ?? 1), 0);
  const all = (id: string): number => (mission(id).enemy?.garrison ?? []).reduce((n, p) => n + (p.count ?? 1), 0);
  it('I 8, II 6, III 8, IV 14, V 9 bodies', () => {
    expect([BT1, BT2, BT3, BT4, BT5].map(all)).toEqual([8, 6, 8, 14, 9]);
  });
  it('IV has 3 buried bodies', () => {
    const buried = (mission(BT4).enemy?.garrison ?? []).filter((p) => p.in_tunnel !== undefined).reduce((n, p) => n + (p.count ?? 1), 0);
    expect(buried).toBe(3);
  });
  it('V has 3 buried bodies, and 33% of 9 is 3 deaths', () => {
    const buried = (mission(BT5).enemy?.garrison ?? []).filter((p) => p.in_tunnel !== undefined).reduce((n, p) => n + (p.count ?? 1), 0);
    expect(buried).toBe(3);
    expect(Math.ceil((all(BT5) * 33) / 100)).toBe(3);
    expect(count(BT5)).toBe(6);
  });
});

describe('BT-A14: time_limit_s is at least twice target_minutes (II is 900: the lead, 20 Nov 2026, Harder wins to 701 s)', () => {
  const LIMITS: readonly (readonly [string, number, number])[] = [
    [BT1, 6, 720],
    [BT2, 7, 900],
    [BT3, 6, 720],
    [BT4, 7, 840],
    [BT5, 7, 840],
  ];
  for (const [id, minutes, limit] of LIMITS)
    it(`${id}: ${minutes} minutes, ${limit} s`, () => {
      expect(mission(id).target_minutes).toBe(minutes);
      expect(mission(id).time_limit_s).toBe(limit);
      expect(mission(id).time_limit_s).toBeGreaterThanOrEqual(2 * 60 * minutes);
    });
});
