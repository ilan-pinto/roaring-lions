// Beit Sahwan IV: fifteen people (GH-1438, docs/campaign/civilian-drama.md section 3.2 row 5).
//
// The mission used to place eight, two of them inside the starting force (24.5, 33.5), where the shepherd rule
// (a ground soldier within 4 tiles walks a family out) banked them for a player who did not move. It places fifteen:
// four held beside Sahim, two on the quarry floor, and nine residents in four groups that run to a muster at 2 s and
// wait there for a soldier. What this pins is the shape that keeps a player who gives no orders from collecting them.
//
//   - the data: fifteen bodies, four resident groups, one `withdraw_to` at 2 s and one `remove` at the deadline + 2 each;
//   - the ground: no muster in the collection zone, none within 4.5 tiles of a starting body, a foot route for every leg;
//   - the world: after `start()` (the assembly layout applied) every civilian body and every muster stands 4.5 tiles or
//     more from every ground side-0 body (the E13 reading, tools/validate_force_to_gate.mjs on the civilian branch);
//   - the control: a no-orders run banks nobody, on any seed, and loses on `get_them_out`. `playtest.ts`'s
//     `passiveAcrossSeeds` reads only the outcome name, and this mission has two OTHER failable primaries (the collapse
//     and, past 240 s, nothing else), so a muster that walked the nine into the zone would still read `defeat` there, on
//     the collapse clock. The zero-`evacuated` assertion below is the one that sees it.
import { describe, expect, it } from 'vitest';
import { maps, missions } from '@lions/data/content';
import { FlowField, DIR_DX, DIR_DY, DIR_NONE } from '../../packages/sim/src/flowfield';
import { MissionRuntime, type MissionJson } from '@lions/sim';
import { run, setSweep, tapMissionEvents, type Plan } from './backtest/playtest-run';
import { controlPlan } from './backtest/passive-plans';
import { missionStage } from './mission-harness';
import { applyTerrain, parseMap, type MapJson } from '@lions/data';
import { Sim } from '../../packages/sim/src/sim';
import { fx } from '../../packages/sim/src/fixed';

const ID = 'beit_sahwan_4_subterranean';
const m = (missions as Record<string, unknown>)[ID] as MissionJson & {
  civilians: { refuge: string; groups: { unit: string; count: number; at: [number, number]; group?: string }[] };
  triggers: { id: string; on: { kind: string; value: number }; do: { kind: string; group: string; to?: string }; label?: string }[];
  objectives: { id: string; type: string; count?: number; seconds?: number; primary: boolean; hostages?: boolean }[];
  enemy: { garrison: { count?: number }[]; waves: { units: { count?: number }[] }[] };
  starting_force: { unit: string; count?: number; at: [number, number] }[];
};
const mapJson = (maps as unknown as Record<string, MapJson & { markers: Record<string, [number, number]>; zones: Record<string, [number, number, number, number]> }>)['beit_sahwan_4'];

const RESIDENTS = { yard_families: 2, souk_families: 3, market_families: 2, clinic_families: 2 } as const;
const MUSTER_CLEARANCE = 4.5; // the shepherd's 4 tiles plus 0.5

const inZone = (z: readonly number[], x: number, y: number): boolean => x >= z[0] && x < z[0] + z[2] && y >= z[1] && y < z[1] + z[3];

describe('the data', () => {
  it('places fifteen people: four held, two on the quarry floor, nine residents in four groups', () => {
    const groups = m.civilians.groups;
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(15);
    expect(groups.filter((g) => g.group === 'hostages').reduce((n, g) => n + g.count, 0)).toBe(4);
    expect(groups.filter((g) => g.group === undefined).reduce((n, g) => n + g.count, 0)).toBe(2);
    for (const [name, count] of Object.entries(RESIDENTS)) {
      expect(groups.filter((g) => g.group === name).reduce((n, g) => n + g.count, 0), name).toBe(count);
    }
  });
  it('every resident group runs to a named muster at 2 s and is taken at the deadline + 2', () => {
    const primary = m.objectives.find((o) => o.id === 'get_them_out');
    const secondary = m.objectives.find((o) => o.id === 'most_of_them');
    expect([primary?.count, primary?.seconds, primary?.hostages, primary?.primary]).toEqual([9, 240, true, true]);
    expect([secondary?.count, secondary?.seconds, secondary?.primary]).toEqual([12, 240, false]);
    for (const name of Object.keys(RESIDENTS)) {
      const run2s = m.triggers.filter((t) => t.do.kind === 'withdraw_to' && t.do.group === name);
      expect(run2s, `${name} withdraw_to`).toHaveLength(1);
      expect(run2s[0].on).toEqual({ kind: 'timer_s', value: 2 });
      expect(typeof run2s[0].label).toBe('string');
      expect((run2s[0].label as string).length).toBeLessThanOrEqual(48);
      expect(mapJson.markers[run2s[0].do.to as string], `${name} muster marker`).toBeDefined();
      const taken = m.triggers.filter((t) => t.do.kind === 'remove' && t.do.group === name);
      expect(taken, `${name} remove`).toHaveLength(1);
      expect(taken[0].on).toEqual({ kind: 'timer_s', value: (primary?.seconds as number) + 2 });
    }
    // Nobody else is taken: the held people stay held.
    expect(m.triggers.filter((t) => t.do.kind === 'remove')).toHaveLength(4);
  });
  it('authors 43 entities, well inside the 160 budget (E10)', () => {
    const force = m.starting_force.reduce((n, p) => n + (p.count ?? 1), 0);
    const garrison = m.enemy.garrison.reduce((n, p) => n + (p.count ?? 1), 0);
    const waves = m.enemy.waves.reduce((n, w) => n + w.units.reduce((k, u) => k + (u.count ?? 1), 0), 0);
    const civilians = m.civilians.groups.reduce((n, g) => n + g.count, 0);
    expect(force + garrison + waves + civilians).toBe(43);
  });
});

describe('the ground', () => {
  const refuge = mapJson.markers[m.civilians.refuge];
  const zone = mapJson.zones['collection_point'];
  const musterOf = (name: string): [number, number] => mapJson.markers[m.triggers.find((t) => t.do.kind === 'withdraw_to' && t.do.group === name)?.do.to as string];

  /** Steps along the flow field from `from` to `to`, or null when there is none. */
  function steps(from: readonly [number, number], to: readonly [number, number]): number | null {
    const map = parseMap(mapJson);
    const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
    applyTerrain(map, sim);
    const field = new FlowField(map.width, map.height);
    field.compute(sim.blocked, sim.elevation, to[0], to[1]);
    let [x, y] = [Math.floor(from[0]), Math.floor(from[1])];
    for (let n = 0; n <= map.width * map.height; n++) {
      if (x === to[0] && y === to[1]) return n;
      const d = field.dirs[y * map.width + x];
      if (d === undefined || d === DIR_NONE) return null;
      x += DIR_DX[d] ?? 0;
      y += DIR_DY[d] ?? 0;
    }
    return null;
  }

  it('no muster stands in the collection zone, and each is on passable ground', () => {
    const map = parseMap(mapJson);
    const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
    applyTerrain(map, sim);
    for (const name of Object.keys(RESIDENTS)) {
      const [x, y] = musterOf(name);
      expect(inZone(zone, x, y), `${name} muster (${x}, ${y})`).toBe(false);
      expect(sim.blocked[y * map.width + x], `${name} muster tile`).toBe(0);
    }
  });
  it('every leg has a foot route: home to muster, and muster to the collection point; both fit the clock', () => {
    for (const name of Object.keys(RESIDENTS)) {
      const home = m.civilians.groups.find((g) => g.group === name)?.at as [number, number];
      const toMuster = steps(home, musterOf(name));
      const out = steps(musterOf(name), refuge);
      expect(toMuster, `${name} home to muster`).not.toBeNull();
      expect(out, `${name} muster to the collection point`).not.toBeNull();
      // 0.8 tiles a second (civilians.json) inside the 240 s clock, with the shepherd's own walk taken off: 100 steps is 125 s.
      expect(out as number, `${name} muster to the collection point`).toBeLessThanOrEqual(60);
    }
  });
  it('the authored spread: no resident body and no muster is within 4.5 tiles of an authored starting body', () => {
    const bodies = (ps: readonly { count?: number; at?: readonly number[] }[]) =>
      ps.flatMap((p) => {
        const [x, y] = p.at ?? [0, 0];
        return Array.from({ length: p.count ?? 1 }, (_, k) => [x + (k % 3) * 1.25, y + Math.floor(k / 3) * 1.25] as const);
      });
    const force = bodies(m.starting_force.filter((p) => p.unit !== 'recon_drone'));
    const points = [
      ...bodies(m.civilians.groups.filter((g) => g.group !== undefined && g.group in RESIDENTS)),
      ...Object.keys(RESIDENTS).map((n) => [musterOf(n)[0] + 0.5, musterOf(n)[1] + 0.5] as const),
    ];
    let nearest = Infinity;
    for (const f of force) for (const p of points) nearest = Math.min(nearest, Math.hypot(f[0] - p[0], f[1] - p[1]));
    expect(nearest).toBeGreaterThan(MUSTER_CLEARANCE);
  });
});

describe('the world after start(), the assembly layout applied', () => {
  it('every civilian body and every muster stands more than 4.5 tiles from every ground side-0 body', () => {
    const { mission, sim, context } = missionStage(ID);
    new MissionRuntime(sim, mission, context({})).start();
    const st = sim.state;
    const force: [number, number][] = [];
    const people: [number, number][] = [];
    for (let i = 0; i < sim.entityCount; i++) {
      if (st.alive[i] !== 1) continue;
      const p: [number, number] = [st.posX[i] / 65536, st.posY[i] / 65536];
      if (st.side[i] === 0 && !sim.unitTypes[st.typeIdx[i]].isAir) force.push(p);
      if (st.side[i] === 2 && st.tunnelIn[i] < 0) people.push(p);
    }
    const musters = Object.keys(RESIDENTS).map((n) => {
      const mk = mapJson.markers[m.triggers.find((t) => t.do.kind === 'withdraw_to' && t.do.group === n)?.do.to as string];
      return [mk[0] + 0.5, mk[1] + 0.5] as [number, number];
    });
    expect(force.length).toBe(8); // 2 Yahalom, 3 rifle squads, the Namer, the Eitan, the medics (the drone is air)
    expect(people.length).toBe(15);
    let nearest = Infinity;
    for (const f of force) for (const p of [...people, ...musters]) nearest = Math.min(nearest, Math.hypot(f[0] - p[0], f[1] - p[1]));
    expect(nearest).toBeGreaterThan(MUSTER_CLEARANCE);
  });
});

/** A run with `plan`, its quiet seed, and every civilian who reached the zone: the tick of each `evacuated` event. */
function play(plan: Plan, seed: number, expectResult: 'victory' | 'defeat'): { evacuated: number[]; cause: string | undefined; result: string } {
  const evacuated: number[] = [];
  const measured = { result: 'ongoing', stars: 0, roeScore: 0, credits: 0 } as NonNullable<Parameters<typeof run>[10]>;
  const code = process.exitCode;
  try {
    setSweep(seed, true);
    tapMissionEvents((evs) => {
      for (const e of evs) if (e.kind === 'evacuated') evacuated.push(e.tick);
    });
    run(ID, plan, {}, expectResult, `${ID} (bs4_civilians test, seed ${seed})`, 0, undefined, new Set(), undefined, undefined, measured);
  } finally {
    tapMissionEvents(undefined);
    setSweep(undefined, false);
    process.exitCode = code;
  }
  return { evacuated, cause: measured.cause, result: measured.result };
}

describe('the control', () => {
  const SEEDS = [424242, 1, 2, 3, 4, 5, 6, 7];
  it('a player who gives no orders banks nobody, on eight seeds, and loses on get_them_out at 240 s', { timeout: 120_000 }, () => {
    for (const seed of SEEDS) {
      const r = play(controlPlan('none'), seed, 'defeat');
      expect(r.evacuated, `seed ${seed}: evacuated events`).toEqual([]);
      expect(r.result, `seed ${seed}`).toBe('defeat');
      expect(r.cause, `seed ${seed}`).toBe('objective:get_them_out');
    }
  });
  it('the counter can see a rescue: parking the Namer 3.5 tiles from the clinic muster banks both clinic families by 30 s', { timeout: 60_000 }, () => {
    const parked: Plan = (sim, _rt, ids, at) => {
      at(1, () => sim.queueCommand({ kind: 'move', ids: ids('ifv_namer'), x: fx.from(32.5), y: fx.from(35.5) }));
      at(16, () => sim.queueCommand({ kind: 'move', ids: ids('ifv_namer'), x: fx.from(29), y: fx.from(33) }));
    };
    const r = play(parked, 424242, 'defeat');
    expect(r.evacuated.filter((t) => t <= 30 * 20)).toHaveLength(2);
    // ...and that is all one order buys: nine are needed, so it still loses on the same clock.
    expect(r.cause).toBe('objective:get_them_out');
  });
});
