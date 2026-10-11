/* eslint-disable @typescript-eslint/no-explicit-any -- reads mission/map JSON by shape, on purpose */
// Wadi Halam pacing ladder (GH-90, GH-93): passive / naive / sensible / optimal over many seeds,
// with a DEAD-AIR instrument beside the usual win/loss/Conduct/credits columns.
//
//   npx tsx tools/src/backtest/wh_pacing.ts [seeds=10] [mission-id ...]
//   WH_BASE_REV=origin/main npx tsx tools/src/backtest/wh_pacing.ts      # the BEFORE table
//   WH_PROBES=1 ...                                                      # V's lost-demolisher probes
//   WH_OBJ=1 ...   when each objective resolved      WH_V=1|2 ...   per-seed lines (2: fight spans)
//   WH_TRACE=<mission>:<tier>:<seed>:<from>:<to>      both sides and the hold clock every 5 s
//   WH_CAL=<id,...>                                   the instrument on any mission's passive run
//
// Results and the proposal they measured: docs/campaign/wadi_halam/pacing-2026-10.md.
//
// WH_BASE_REV reads the five Wadi Halam mission files out of git at that revision instead of the
// tree, so the before and after tables come from ONE script run in ONE tree: nothing but the
// mission JSON differs between them. Maps, units and the sim are always the tree's.
//
// The rungs:
//   passive  - no orders at all.
//   naive    - one attackMove of the whole force to the mission's focus at t=0, never re-issued.
//   sensible - wh_ladder.ts's sensible plan (re-anchor every 45 s, demolishers demolish inside a
//              raze zone, one carrier/squad shepherds each civilian group, jeep+APC run at III's
//              HVT, IV's houses nearest-first), plus for I a drone tour over the three hides.
//              Written against markers and zones, never coordinates.
//   optimal  - the scripted plans in playtest.ts, COPIED here verbatim. They are coordinate-bound
//              and playtest.ts runs them at import, so they cannot be imported. The copy is checked:
//              at seed 424242 with the chained ledger, every optimal row must print the same
//              result / minutes / ROE / credits as `pnpm playtest` does (the "xcheck" lines).
//
// Ledger: each rung of mission k plays on the ledger the OPTIMAL plan of mission k-1 produced at
// the same seed (mission I on {}), which is what playtest.ts's passive controls do too. Only this
// mission's play varies between rungs.
//
// Dead air. A second of mission time is ENGAGED when a `fire` event passes between a side-0 unit
// and a side-1 unit (either direction; rounds at buildings and at civilians do not count), or an
// objective changes state in it. Engaged seconds less than 10 s apart are one FIGHT (a reload is
// part of a fight; 10 s is REGEN_DELAY_TICKS, when field recovery starts). Every second outside a
// fight is DEAD. Reported: dead seconds as a share of the run, dead seconds inside the HOLD WINDOW
// (from the first tick the primary hold_for clock counts to its completion or the end), the opening
// (seconds to the first fight), the longest dead stretch, fights per run, their mean length, the
// mean gap between them, the lowest total-HP share the force fell to (attrition: does it compound?),
// and scripted orders a minute. Orders do not count as activity -- a real player's orders are what
// dead air is measured against, not something that fills it.
import { execFileSync } from 'node:child_process';
import {
  Sim,
  fx,
  TICKS_PER_SECOND,
  MissionRuntime,
  resolveUpgrades,
  creditsFor,
  creditInputFrom,
  type MissionJson,
  type LedgerData,
  type TunnelRouteJson,
  type UnlockGate,
  type SimEvent,
} from '@lions/sim';
import { units, maps, missions, structures as structureCatalogue, parseMap, applyTerrain } from '@lions/data';

type Tier = 'passive' | 'naive' | 'sensible' | 'optimal';
type At = (t: number, fn: () => void) => void;
type Plan = (sim: Sim, rt: MissionRuntime, ids: (t: string) => number[], at: At, map: any, mission: any) => void;

const seedsN = Number(process.argv[2] ?? 10);
const only = process.argv.slice(3);
const CHAIN = ['wadi_halam_1_fords', 'wadi_halam_2_laager', 'wadi_halam_3_counterraid', 'wadi_halam_4_village', 'wadi_halam_5_depot'] as const;
const MEASURE = only.length > 0 ? only : [...CHAIN];
const BASE = process.env.WH_BASE_REV;
const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });
const CAP_TICKS = 20 * 60 * TICKS_PER_SECOND; // playtest.ts's own ceiling
const FIGHT_GAP_S = 10;

function missionJson(id: string): MissionJson {
  if (!BASE) return missions[id as keyof typeof missions] as unknown as MissionJson;
  return JSON.parse(execFileSync('git', ['show', `${BASE}:data/missions/${id}.json`], { encoding: 'utf8' }));
}

function gateOf(u: any): UnlockGate | undefined {
  return u?.unlock
    ? { roeMin: u.unlock.roe_rating_min, starsMin: u.unlock.stars_min, afterMission: u.unlock.after_mission, price: u.unlock.price, bought: false }
    : undefined;
}

// ---------------------------------------------------------------- optimal (copied from playtest.ts)

const own = (sim: Sim): number[] => {
  const cur: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1) cur.push(i);
  return cur;
};

const OPTIMAL: Record<string, Plan> = {
  wadi_halam_1_fords: (sim, _rt, ids, at) => {
    const drone = ids('recon_drone');
    const screen = [...ids('apc_eitan'), ...ids('inf_squad'), ...ids('at_team')];
    const jeep = ids('jeep_shoded');
    at(0, () => {
      sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(9, 15) });
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(15, 31) });
      sim.queueCommand({ kind: 'move', ids: drone, ...M(20, 17) });
    });
    at(45, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(20, 30) }));
    at(60, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(9, 31) }));
    at(60, () => sim.queueCommand({ kind: 'move', ids: jeep, ...M(17, 34) }));
    at(90, () => sim.queueCommand({ kind: 'move', ids: drone, ...M(21, 35) }));
    at(120, () => sim.queueCommand({ kind: 'attackMove', ids: jeep, ...M(10, 24) }));
    at(110, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(10, 24) }));
    for (let when = 130; when <= 320; when += 45) at(when, () => sim.queueCommand({ kind: 'attackMove', ids: own(sim), ...M(10, 24) }));
  },
  wadi_halam_2_laager: (sim, rt, ids, at) => {
    const engineers = new Set(ids('demo_squad'));
    const picket = new Set(ids('at_team'));
    const kept = new Set([...engineers, ...picket]);
    const anchor = (): void => sim.queueCommand({ kind: 'attackMove', ids: own(sim).filter((i) => !kept.has(i)), ...M(21, 25) });
    const burn = (): void => {
      for (const [tx, ty] of [[18, 22], [13, 25]] as const) {
        const s = sim.structureAt(tx, ty);
        if (s >= 0) {
          sim.queueCommand({ kind: 'demolish', ids: [...engineers], structure: s });
          return;
        }
      }
    };
    at(0, () => {
      burn();
      sim.queueCommand({ kind: 'attackMove', ids: [...picket], ...M(9, 9) });
    });
    at(1, anchor);
    for (let when = 15; when <= 300; when += 15) at(when, burn);
    for (let when = 45; when <= 700; when += 45) at(when, anchor);
    for (let when = 90; when <= 700; when += 60) at(when, () => void rt.requestBuild('inf_squad'));
  },
  wadi_halam_3_counterraid: (sim, _rt, ids, at) => {
    const chase = [...ids('jeep_shoded'), ...ids('apc_eitan')];
    const shepherd = ids('inf_squad').slice(0, 1);
    const kept = new Set(shepherd);
    const anchor = (): void => sim.queueCommand({ kind: 'attackMove', ids: own(sim).filter((i) => !kept.has(i)), ...M(21, 22) });
    at(0, () => {
      sim.queueCommand({ kind: 'attackMove', ids: chase, ...M(25, 7) });
      sim.queueCommand({ kind: 'attackMove', ids: [...ids('ifv_namer'), ...ids('inf_squad').slice(1), ...ids('at_team')], ...M(21, 22) });
      sim.queueCommand({ kind: 'move', ids: shepherd, ...M(25, 32) });
    });
    at(75, () => {
      kept.clear();
      sim.queueCommand({ kind: 'attackMove', ids: shepherd, ...M(21, 22) });
    });
    for (let when = 60; when <= 700; when += 45) at(when, anchor);
  },
  wadi_halam_4_village: (sim, _rt, ids, at) => {
    const apc = ids('apc_eitan');
    const ifv = ids('ifv_namer');
    const guns = [...apc, ...ids('inf_squad'), ...ids('at_team')];
    at(0, () => {
      sim.queueCommand({ kind: 'move', ids: guns, ...M(20, 27) });
      sim.queueCommand({ kind: 'move', ids: ifv, ...M(31, 23) });
    });
    at(30, () => sim.queueCommand({ kind: 'move', ids: ifv, ...M(36, 23) }));
    at(55, () => sim.queueCommand({ kind: 'move', ids: ifv, ...M(27, 27) }));
    at(80, () => sim.queueCommand({ kind: 'move', ids: ifv, ...M(3, 24) }));
    const stages: { house: [number, number]; stand: [number, number] }[] = [
      { house: [19, 24], stand: [20, 27] },
      { house: [33, 25], stand: [34, 28] },
      { house: [37, 25], stand: [38, 28] },
      { house: [42, 26], stand: [43, 29] },
      { house: [43, 20], stand: [44, 23] },
    ];
    let stage = 0;
    let finished = false;
    for (let when = 10; when <= 800; when += 5) {
      at(when, () => {
        const cur = stages[stage];
        if (cur && sim.structureAt(cur.house[0], cur.house[1]) < 0) {
          stage++;
          const next = stages[stage];
          const all = when >= 170 ? [...guns, ...ifv] : guns;
          if (next) sim.queueCommand({ kind: 'move', ids: all, ...M(next.stand[0], next.stand[1]) });
        }
        if (stage >= stages.length && !finished) {
          finished = true;
          sim.queueCommand({ kind: 'attackMove', ids: [...guns, ...ifv], ...M(34, 24) });
        }
      });
    }
  },
  wadi_halam_5_depot: (sim, _rt, ids, at) => {
    const screen = [...ids('apc_eitan'), ...ids('ifv_namer'), ...ids('inf_squad'), ...ids('at_team')];
    const dozer = ids('dozer_d9');
    const engineers = ids('demo_squad');
    const jeep = ids('jeep_shoded');
    const targets: [number, number][] = [[30, 6], [34, 6], [37, 6], [30, 10], [35, 10], [38, 11], [36, 14]];
    const orderNext = (unit: number[], forward: boolean): void => {
      const order = forward ? targets : [...targets].reverse();
      for (const [tx, ty] of order) {
        const s = sim.structureAt(tx, ty);
        if (s >= 0) {
          sim.queueCommand({ kind: 'demolish', ids: unit, structure: s });
          return;
        }
      }
    };
    at(0, () => {
      sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(33, 20) });
      sim.queueCommand({ kind: 'move', ids: jeep, ...M(32, 27) });
      orderNext(dozer, true);
      orderNext(engineers, false);
    });
    for (let when = 15; when <= 200; when += 15) {
      at(when, () => {
        orderNext(dozer, true);
        orderNext(engineers, false);
      });
    }
    at(40, () => sim.queueCommand({ kind: 'attackMove', ids: screen, ...M(33, 12) }));
    for (let when = 85; when <= 400; when += 45) at(when, () => sim.queueCommand({ kind: 'attackMove', ids: own(sim), ...M(33, 12) }));
  },
};

// ---------------------------------------------------------------- naive / sensible (marker-based)

function focusOf(mission: any, map: any): [number, number] {
  const centre = (z: number[]): [number, number] => [z[0] + z[2] / 2, z[1] + z[3] / 2];
  if (mission.id.includes('depot')) return map.markers.depot_gate;
  if (mission.id.includes('village')) return map.markers.village_center;
  const hold = mission.objectives.find((o: any) => o.type === 'hold_for' || o.type === 'capture' || o.type === 'raze');
  return centre(map.zones[hold.target]);
}

const typeName = (sim: Sim, i: number): string => sim.unitTypes[sim.state.typeIdx[i]].id;

const NAIVE: Plan = (sim, _rt, _ids, at, map, mission) => {
  const f = focusOf(mission, map);
  at(0, () => sim.queueCommand({ kind: 'attackMove', ids: own(sim), ...M(f[0], f[1]) }));
};

const SENSIBLE: Plan = (sim, _rt, _ids, at, map, m) => {
  const focus = focusOf(m, map);
  const typeOf = (i: number) => typeName(sim, i);
  const start = own(sim);
  const specialists = new Set(start.filter((i) => ['demo_squad', 'dozer_d9'].includes(typeOf(i))));
  const drones = start.filter((i) => typeOf(i) === 'recon_drone');
  const civGroups: { at: [number, number] }[] = (m.civilians?.groups ?? []).map((g: any) => ({ at: g.at }));
  const refuge: [number, number] | null = m.civilians ? map.markers[m.civilians.refuge] : null;
  const hvt = m.objectives.find((o: any) => o.type === 'eliminate_hvt') && m.id.includes('counterraid');
  const razeZone = m.objectives.find((o: any) => o.type === 'raze');
  const ifvs = start.filter((i) => typeOf(i) === 'ifv_namer');
  const useIfv = ifvs.length > 0 && !hvt;
  const shepherd = civGroups.length > 0 ? (useIfv ? ifvs : start.filter((i) => typeOf(i) === 'inf_squad').slice(0, 1)) : [];
  const chase = hvt ? start.filter((i) => ['jeep_shoded', 'apc_eitan'].includes(typeOf(i))) : [];
  const apart = new Set<number>([...specialists, ...shepherd, ...chase, ...drones]);
  const anchor = () => {
    const ids = own(sim).filter((i) => !apart.has(i));
    if (ids.length) sim.queueCommand({ kind: 'attackMove', ids, ...M(focus[0], focus[1]) });
  };
  const demolishNext = () => {
    if (!razeZone) return;
    const z = map.zones[razeZone.target] as number[];
    // Live, not the t=0 set: a demolisher that arrives later (a `reinforce` trigger) is used too,
    // and kept out of the anchor sweep like the ones that started. With no reinforcement this is
    // exactly the t=0 set, so the BEFORE table is unchanged by it.
    for (const i of own(sim)) if (['demo_squad', 'dozer_d9'].includes(typeOf(i))) { specialists.add(i); apart.add(i); }
    const spec = [...specialists].filter((i) => sim.state.alive[i] === 1);
    if (!spec.length) return;
    const seen = new Set<number>();
    const list: number[] = [];
    for (let y = z[1]; y < z[1] + z[3]; y++)
      for (let x = z[0]; x < z[0] + z[2]; x++) {
        const s = sim.structureAt(x, y);
        if (s >= 0 && !seen.has(s)) {
          seen.add(s);
          list.push(s);
        }
      }
    spec.forEach((u, k) => {
      if (list.length) sim.queueCommand({ kind: 'demolish', ids: [u], structure: list[(k * 3) % list.length] });
    });
  };
  const houses = ((m.enemy?.garrison ?? []) as any[])
    .filter((g) => g.stance?.kind === 'garrison' && g.at)
    .map((g) => ({ b: g.stance.building as [number, number], at: g.at as [number, number] }))
    .sort((a, b) => Math.hypot(a.at[0] - 9, a.at[1] - 21) - Math.hypot(b.at[0] - 9, b.at[1] - 21));
  let stage = -1;
  const advance = () => {
    if (houses.length === 0 || stage >= houses.length) return;
    if (stage >= 0 && sim.structureAt(houses[stage].b[0], houses[stage].b[1]) >= 0) return;
    stage++;
    const ids = own(sim).filter((i) => !apart.has(i));
    if (stage < houses.length) sim.queueCommand({ kind: 'move', ids, ...M(houses[stage].at[0], houses[stage].at[1] - 1) });
    else sim.queueCommand({ kind: 'attackMove', ids, ...M(focus[0], focus[1]) });
  };
  // I's picture: the drone tours the hides and the pump house, one leg every 40 s.
  const tour = ['pump_house', 'hide_north', 'hide_south'].filter((k) => map.markers[k]);
  at(0, () => {
    if (houses.length) advance();
    else anchor();
    if (chase.length) sim.queueCommand({ kind: 'attackMove', ids: chase, ...M(map.markers.hide_north[0], map.markers.hide_north[1] + 3) });
  });
  if (drones.length && m.objectives.some((o: any) => o.type === 'locate' && o.count))
    tour.forEach((k, n) => at(n * 40, () => sim.queueCommand({ kind: 'move', ids: drones, ...M(map.markers[k][0], map.markers[k][1]) })));
  for (let s = 0; s * TICKS_PER_SECOND < CAP_TICKS; s += 5) {
    at(s, () => {
      if (houses.length) advance();
      else if (s % 45 === 0 && s > 0) anchor();
      if (s % 15 === 0) demolishNext();
    });
  }
  if (shepherd.length) {
    const leg = useIfv ? 22 : 40;
    civGroups.forEach((g, k) => at(leg * k, () => sim.queueCommand({ kind: 'move', ids: shepherd, ...M(g.at[0], g.at[1]) })));
    if (useIfv && refuge) at(leg * civGroups.length, () => sim.queueCommand({ kind: 'move', ids: shepherd, ...M(refuge[0], refuge[1]) }));
    if (!useIfv) at(leg * civGroups.length + 40, () => { for (const q of shepherd) apart.delete(q); });
  }
};

// ---------------------------------------------------------------- one run, instrumented

interface Probe { kill?: { unit: string; at: number }[]; trace?: [number, number] }
interface Run {
  result: string; mins: number; roe: number; credits: number; stars: number; lost: number; produced: LedgerData;
  dead: number; deadPct: number; holdDead: number; holdLen: number; opening: number; longestDead: number;
  fights: number; fightLen: number; fightGap: number; minHpPct: number; orders: number; objectives: string;
  /** Structures still standing in the raze zone at the end, and demolishers still alive. */
  razeLeft: number; demoAlive: number;
  spans: string;
  /** Second each objective resolved, by id. */
  objAt: Record<string, number>;
}

function run(id: string, plan: Plan, ledger: LedgerData, seed: number, probe: Probe = {}): Run {
  const mission = missionJson(id);
  const mapJson = maps[mission.map.file as keyof typeof maps] as any;
  const map = parseMap(mapJson);
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) structIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  for (const b of map.structures) sim.addStructure(structIdx.get(b.type) as number, b.tiles);
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({ id: t.id, points: t.points, dig_tiles_per_s: t.digTilesPerS, pre_dug: t.preDug }));
  for (const tr of tunnelRoutes) sim.addTunnel(tr);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u));
  const unitData = units as Record<string, any>;
  const resolved = resolveUpgrades(mission, ledger, (u) => gateOf(unitData[u]));
  const rt = new MissionRuntime(sim, resolved, {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    tunnels: tunnelRoutes,
    ledger,
    unitInfo: (u) => {
      const d = unitData[u];
      if (!d || d.faction !== 'kdf') return null;
      return { logistics: d.cost.logistics, buildTimeS: d.cost.build_time_s ?? 20, unlock: gateOf(d) };
    },
  });
  rt.start();
  const ids = (t: string): number[] => own(sim).filter((i) => typeName(sim, i) === t);
  const timed: [number, () => void][] = [];
  // Orders counted only while a plan callback runs: the runtime queues commands too (waves).
  let orders = 0;
  let inPlan = false;
  const realQueue = sim.queueCommand.bind(sim);
  (sim as any).queueCommand = (c: any) => {
    if (inPlan) orders++;
    return realQueue(c);
  };
  plan(sim, rt, ids, (t, fn) => timed.push([t * TICKS_PER_SECOND, fn]), mapJson, mission);
  for (const k of probe.kill ?? []) timed.push([k.at * TICKS_PER_SECOND, () => { for (const i of ids(k.unit)) sim.debugKill(i); }]);
  timed.sort((a, b) => a[0] - b[0]);

  const holdObj = (mission.objectives as any[]).find((o) => o.type === 'hold_for' && o.primary);
  const engagedSec = new Set<number>();
  const objAt: Record<string, number> = {};
  let holdStart = -1;
  let holdEnd = -1;
  let produced: LedgerData = {};
  let hpMax = 0;
  const counted = new Set<number>();
  let minHpPct = 100;
  let t = 0;
  for (; t < CAP_TICKS; t++) {
    inPlan = true;
    for (const [when, fn] of timed) if (when === t) fn();
    inPlan = false;
    const evs: SimEvent[] = sim.tick();
    const sec = Math.floor(t / TICKS_PER_SECOND);
    for (const e of evs) {
      if (e.kind !== 'fire' || e.target < 0) continue;
      const a = sim.state.side[e.shooter];
      const b = sim.state.side[e.target];
      if ((a === 0 && b === 1) || (a === 1 && b === 0)) engagedSec.add(sec);
    }
    for (const me of rt.step(evs)) {
      if (me.kind === 'missionEnd') produced = me.ledger;
      if (me.kind === 'objective') {
        engagedSec.add(sec);
        objAt[me.id] = sec;
      }
    }
    if (holdObj) {
      const o = rt.objectiveList.find((x) => x.id === holdObj.id);
      if (o && holdStart < 0 && o.status === 'active' && o.ticksLeft !== undefined && o.ticksLeft < holdObj.seconds * TICKS_PER_SECOND) holdStart = sec;
      if (o && holdEnd < 0 && o.status !== 'active') holdEnd = sec;
    }
    if (t % TICKS_PER_SECOND === 0) {
      let hp = 0;
      for (let i = 0; i < sim.entityCount; i++) {
        if (sim.state.side[i] !== 0) continue;
        if (!counted.has(i)) {
          counted.add(i);
          hpMax += sim.unitTypes[sim.state.typeIdx[i]].hp;
        }
        if (sim.state.alive[i] === 1) hp += sim.state.hp[i];
      }
      if (hpMax > 0) minHpPct = Math.min(minHpPct, (100 * hp) / hpMax);
    }
    if (probe.trace && t % (5 * TICKS_PER_SECOND) === 0 && sec >= probe.trace[0] && sec <= probe.trace[1] && holdObj) {
      const o = rt.objectiveList.find((x) => x.id === holdObj.id)!;
      const where = (side: number) =>
        Array.from({ length: sim.entityCount }, (_, i) => i)
          .filter((i) => sim.state.alive[i] === 1 && sim.state.side[i] === side)
          .map((i) => `${typeName(sim, i)}@${sim.state.posX[i] >> 16},${sim.state.posY[i] >> 16}`)
          .join(' ');
      console.log(`  t=${sec} ${o.status} left=${((o.ticksLeft ?? 0) / TICKS_PER_SECOND).toFixed(0)} ${o.paused ?? 'held'} | P ${where(0)} | E ${where(1)}`);
    }
    if (rt.result !== 'ongoing') break;
  }
  const total = Math.floor(t / TICKS_PER_SECOND) + 1;
  // Fights: engaged seconds merged across gaps under FIGHT_GAP_S. A reload is part of a fight; a
  // gap of 10 s is also exactly REGEN_DELAY_TICKS (200), the point where field recovery starts and
  // the last fight stops costing the player anything.
  const fights: [number, number][] = [];
  for (const s of [...engagedSec].sort((a, b) => a - b)) {
    const last = fights[fights.length - 1];
    if (last && s - last[1] < FIGHT_GAP_S) last[1] = s;
    else fights.push([s, s]);
  }
  const inFight = new Uint8Array(total);
  for (const [a, b] of fights) for (let s = a; s <= b && s < total; s++) inFight[s] = 1;
  let dead = 0;
  let longest = 0;
  let cur = 0;
  for (let s = 0; s < total; s++) {
    if (inFight[s]) cur = 0;
    else {
      dead++;
      cur++;
      longest = Math.max(longest, cur);
    }
  }
  const opening = fights.length ? fights[0][0] : total;
  let holdDead = 0;
  let holdLen = 0;
  if (holdStart >= 0) {
    const end = holdEnd >= 0 ? holdEnd : total - 1;
    holdLen = end - holdStart + 1;
    for (let s = holdStart; s <= end; s++) if (!inFight[s]) holdDead++;
  }
  const fightLen = fights.length ? fights.reduce((a, f) => a + f[1] - f[0] + 1, 0) / fights.length : 0;
  const gaps = fights.slice(1).map((f, k) => f[0] - fights[k][1] - 1);
  const fightGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : NaN;
  const lost = [...counted].filter((i) => sim.state.alive[i] === 0 && sim.unitTypes[sim.state.typeIdx[i]].id !== 'civilians').length;
  const credits = creditsFor(creditInputFrom(rt, rt.roeScore, (mission as any).roe?.fail_below));
  const razeObj = (mission.objectives as any[]).find((o) => o.type === 'raze');
  let razeLeft = 0;
  if (razeObj) {
    const z = mapJson.zones[razeObj.target] as number[];
    const seen = new Set<number>();
    for (let y = z[1]; y < z[1] + z[3]; y++) for (let x = z[0]; x < z[0] + z[2]; x++) { const st = sim.structureAt(x, y); if (st >= 0) seen.add(st); }
    razeLeft = seen.size;
  }
  const demoAlive = own(sim).filter((i) => ['dozer_d9', 'demo_squad'].includes(typeName(sim, i))).length;
  return {
    razeLeft, demoAlive, objAt,
    spans: `hold ${holdStart}-${holdEnd} fights ${fights.map(([a, b]) => `${a}-${b}`).join(' ')}`,
    result: rt.result, mins: t / TICKS_PER_SECOND / 60, roe: rt.roeScore, credits, stars: rt.stars, lost, produced,
    dead, deadPct: (100 * dead) / total, holdDead, holdLen, opening, longestDead: longest,
    fights: fights.length, fightLen, fightGap, minHpPct, orders,
    objectives: rt.objectiveList.map((o) => `${o.id}=${o.status[0]}`).join(' '),
  };
}

// ---------------------------------------------------------------- the ladder

const planFor = (id: string, tier: Tier): Plan => (tier === 'passive' ? () => {} : tier === 'naive' ? NAIVE : tier === 'sensible' ? SENSIBLE : OPTIMAL[id]);

function chainLedgers(seed: number): Map<string, { ledger: LedgerData; opt: Run }> {
  const out = new Map<string, { ledger: LedgerData; opt: Run }>();
  let led: LedgerData = {};
  for (const id of CHAIN) {
    const opt = run(id, OPTIMAL[id], led, seed);
    out.set(id, { ledger: led, opt });
    led = opt.produced;
  }
  return out;
}

// WH_TRACE=<mission>:<tier>:<seed>:<from>:<to> -- print the hold state and both sides every 5 s.
if (process.env.WH_TRACE) {
  const [id, tier, seed, from, to] = process.env.WH_TRACE.split(':');
  const c = chainLedgers(Number(seed));
  run(id, planFor(id, tier as Tier), c.get(id)!.ledger, Number(seed), { trace: [Number(from), Number(to)] });
  process.exit(0);
}
// WH_CAL=<id,...>: the dead-air instrument on any mission's PASSIVE run on a bare ledger, for
// calibration against a mission whose enemy comes to the player (beit_sahwan_breach).
if (process.env.WH_CAL) {
  for (const id of process.env.WH_CAL.split(',')) {
    const rs = Array.from({ length: seedsN }, (_, k) => run(id, () => {}, {}, k + 1));
    const avg = (f: (r: Run) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    console.log(`cal ${id} passive: dead ${avg((r) => r.deadPct).toFixed(0)}%, longest ${avg((r) => r.longestDead).toFixed(0)} s, fights ${avg((r) => r.fights).toFixed(1)} x ${avg((r) => r.fightLen).toFixed(0)} s, gap ${avg((r) => r.fightGap).toFixed(0)} s, minHP ${avg((r) => r.minHpPct).toFixed(0)}%, ${rs.filter((r) => r.result === 'victory').length}/${seedsN} won, ${avg((r) => r.mins).toFixed(1)} min`);
  }
  process.exit(0);
}

const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '-');
console.log(`wh_pacing: seeds 1..${seedsN}${BASE ? `, missions from ${BASE}` : ', missions from the tree'}; cap 20 min`);

// Cross-check: the copied optimal plans must reproduce `pnpm playtest` at its pinned seed.
{
  const chain = chainLedgers(424242);
  for (const id of CHAIN) {
    const r = chain.get(id)!.opt;
    console.log(`xcheck ${id}: ${r.result.toUpperCase()} in ${r.mins.toFixed(1)} min, ROE ${r.roe}, stars ${r.stars}, credits ${r.credits}, objectives ${r.objectives}`);
  }
}

const chains = Array.from({ length: seedsN }, (_, k) => chainLedgers(k + 1));
const TIERS: Tier[] = ['passive', 'naive', 'sensible', 'optimal'];
console.log(
  'mission                    tier      win  @cap  min(won) max  lost  roe  cred  dead%  holdDead/len  1st  longest  fights  fLen  fGap  minHP%  ord/min'
);
for (const id of MEASURE) {
  for (const tier of TIERS) {
    const rs = chains.map((c, k) => (tier === 'optimal' ? c.get(id)!.opt : run(id, planFor(id, tier), c.get(id)!.ledger, k + 1)));
    if (process.env.WH_V) for (const [k, r] of rs.entries()) console.log(`    ${id} ${tier} seed ${k + 1}: ${r.result} ${r.mins.toFixed(1)}m ${r.objectives}${process.env.WH_V === '2' ? `\n      ${r.spans}` : ''}`);
    const won = rs.filter((r) => r.result === 'victory');
    const avg = (f: (r: Run) => number, sel = rs) => (sel.length ? sel.reduce((a, r) => a + f(r), 0) / sel.length : NaN);
    const held = rs.filter((r) => r.holdLen > 0);
    const objIds = [...new Set(rs.flatMap((r) => Object.keys(r.objAt)))];
    const objLine = objIds
      .map((o) => {
        const ts = rs.filter((r) => o in r.objAt).map((r) => r.objAt[o]);
        return `${o} ${Math.min(...ts)}-${Math.max(...ts)}s (${ts.length})`;
      })
      .join(', ');
    console.log(
      `${id.padEnd(26)} ${tier.padEnd(8)} ${String(won.length).padStart(2)}/${seedsN} ${String(rs.filter((r) => r.result === 'ongoing').length).padStart(2)}  ${fmt(avg((r) => r.mins, won), 1).padStart(6)} ${fmt(won.length ? Math.max(...won.map((r) => r.mins)) : NaN, 1).padStart(4)}  ` +
        `${fmt(avg((r) => r.lost), 1).padStart(5)}  ${fmt(avg((r) => r.roe)).padStart(3)}  ${fmt(avg((r) => r.credits)).padStart(4)}  ` +
        `${fmt(avg((r) => r.deadPct)).padStart(4)}%  ${(fmt(avg((r) => r.holdDead, held)) + '/' + fmt(avg((r) => r.holdLen, held))).padStart(11)}  ` +
        `${fmt(avg((r) => r.opening)).padStart(4)}  ${fmt(avg((r) => r.longestDead)).padStart(7)}  ${fmt(avg((r) => r.fights), 1).padStart(6)}  ` +
        `${fmt(avg((r) => r.fightLen)).padStart(4)}  ${fmt(avg((r) => r.fightGap)).padStart(4)}  ${fmt(avg((r) => r.minHpPct)).padStart(6)}  ` +
        `${fmt(avg((r) => r.orders / Math.max(r.mins, 0.01)), 1).padStart(6)}`
    );
    if (process.env.WH_OBJ) console.log(`    resolved: ${objLine}`);
  }
}

// V's lost-demolisher probes (GH-93): the optimal and sensible plans with a demolisher killed.
if (process.env.WH_PROBES) {
  const id = 'wadi_halam_5_depot';
  const probes: [string, Probe][] = [
    ['dozer dead t=0', { kill: [{ unit: 'dozer_d9', at: 0 }] }],
    ['dozer dead t=60', { kill: [{ unit: 'dozer_d9', at: 60 }] }],
    ['engineers dead t=0', { kill: [{ unit: 'demo_squad', at: 0 }] }],
    ['both dead t=0', { kill: [{ unit: 'dozer_d9', at: 0 }, { unit: 'demo_squad', at: 0 }] }],
    ['both dead t=60', { kill: [{ unit: 'dozer_d9', at: 60 }, { unit: 'demo_squad', at: 60 }] }],
    // Every demolisher on the map dead, a later arrival included: must still END (raze fails at
    // its deadline), never hang.
    ['all dead t=0 and t=90', { kill: [{ unit: 'dozer_d9', at: 0 }, { unit: 'demo_squad', at: 0 }, { unit: 'demo_squad', at: 90 }] }],
  ];
  for (const tier of ['sensible', 'optimal'] as Tier[]) {
    for (const [name, probe] of probes) {
      const rs = chains.map((c, k) => run(id, planFor(id, tier), c.get(id)!.ledger, k + 1, probe));
      const won = rs.filter((r) => r.result === 'victory');
      const stuck = rs.filter((r) => r.result === 'ongoing').length;
      const avgMin = won.length ? won.reduce((a, r) => a + r.mins, 0) / won.length : NaN;
      const endMin = rs.reduce((a, r) => a + r.mins, 0) / rs.length;
      const lostRaze = rs.filter((r) => r.result !== 'victory' && r.razeLeft > 0);
      console.log(
        `probe ${id} ${tier.padEnd(8)} ${name.padEnd(20)} win ${won.length}/${seedsN}  min(won) ${fmt(avgMin, 1)}  ended at ${fmt(endMin, 1)} min  stuck ${stuck}  raze failed with a demolisher alive ${lostRaze.filter((r) => r.demoAlive > 0).length}, with none ${lostRaze.filter((r) => r.demoAlive === 0).length}; structures left (failed runs) ${lostRaze.map((r) => r.razeLeft).join(',')}` +
          (process.env.WH_V ? `\n      ${rs.map((r) => r.objectives).join('\n      ')}` : '')
      );
    }
  }
}
