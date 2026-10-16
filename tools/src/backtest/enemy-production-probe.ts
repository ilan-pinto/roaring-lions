// Report-only: what does side 1 do with a camp and a purse? (F4 Task 9, GH-183 / LD6 ask 10.)
// NOT a gate, NOT wired into `pnpm playtest` or any CI job, and it has no passing band.
//
//   pnpm --filter @lions/tools exec tsx src/backtest/enemy-production-probe.ts
//
// It loads `tel_marum_3_clearance` and, IN MEMORY ONLY (data/missions is untouched), gives the
// Sarim a camp and a menu:
//   camp   a `camp` structure placed with `side: 1` at CAMP_TILE = (27,7), 2x2 (tiles x 27-28,
//          y 7-8): open ground two tiles east of `battery_position` (25,6). It is NOT on the
//          marker: the HVT `rocket_battery` stands at (25.5,6.5), and mission structures are
//          raised before any spawn, so a camp there would make `assertGroundClear` refuse the load.
//   purse  `enemy.production.logistics_start` 640 (1.6x the KDF's 400, Q7's ratio; a PROBE number
//          only), no rate, so side 1's purse is the 640 and nothing else.
//   menu   `sarim_rifles` (340, 2 pop, 26 s) and `atgm_cell` (235, 1 pop, 20 s).
//   rally  `battery_position`, group `camp_guard`: bought units walk to the HVT and hold.
// and runs two things on `main`'s 30-seed set (SWEEP_SEEDS: 424242, then 1..29, #539/#542 --
// NOT the G3 sheet's set): the shipped winning plan (copied below from playtest.ts, so it can
// drift from it; it is unaltered when this was written) and a no-orders passive control. One
// forked worker per slot, as `plan-sweep.ts` does, each running a queue of (kind, seed) jobs.
//
// Per run: units bought (counted from `built` events with `side: 1`), logistics unspent at the end
// as a share of the purse (start + earned), the outcome and its length. Expected: unspent near
// the leftover below the cheapest item (D8), against the spike's banked thousands.
import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Sim, MissionRuntime, resolveUpgrades, fx, TICKS_PER_SECOND, type MissionJson } from '@lions/sim';
import { units, maps, missions, structures as structureCatalogue, parseMap, applyTerrain, roadMaskOf } from '@lions/data';
import { SWEEP_SEEDS } from './passive-sweep';

const ID = 'tel_marum_3_clearance' as const;
const CAMP_TILE: [number, number] = [27, 7];
const START = 640;

type Kind = 'plan' | 'passive';
interface Job { kind: Kind; seed: number }
interface Reply extends Job {
  bought: number;
  unspentPct: number;
  result: string;
  cause: string;
  minutes: number;
}

const M = (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) });

type Plan = (sim: Sim, ids: (t: string) => number[], at: (t: number, fn: () => void) => void) => void;

/** playtest.ts's Tel Marum III winning plan, verbatim apart from the signature. */
const SHIPPED_PLAN: Plan = (sim, ids, at) => {
  const tanks = ids('mbt_lavi');
  const namer = ids('ifv_namer');
  const armour = ids('apc_eitan');
  const foot = ids('inf_squad');
  const at_ = ids('at_team');
  const mortar = ids('mortar_team');
  at(2, () => {
    sim.queueCommand({ kind: 'move', ids: [...tanks, ...namer, ...armour], ...M(28, 19) });
    sim.queueCommand({ kind: 'move', ids: [...foot, ...at_], ...M(27, 19) });
    sim.queueCommand({ kind: 'move', ids: mortar, ...M(26, 19) });
  });
  at(40, () => sim.queueCommand({ kind: 'attackMove', ids: tanks, ...M(33, 16) }));
  at(62, () => sim.queueCommand({ kind: 'move', ids: tanks, ...M(33, 11) }));
  at(80, () => {
    sim.queueCommand({ kind: 'move', ids: armour, ...M(33, 14) });
    sim.queueCommand({ kind: 'move', ids: [...foot, ...at_], ...M(33, 17) });
  });
  at(100, () => {
    sim.queueCommand({ kind: 'move', ids: [...foot, ...at_], ...M(33, 11) });
    sim.queueCommand({ kind: 'move', ids: armour, ...M(28, 6) });
  });
  at(115, () => sim.queueCommand({ kind: 'move', ids: armour, ...M(29, 36) }));
};

function runOne(job: Job): Reply {
  const base = missions[ID] as unknown as MissionJson;
  const mission: MissionJson = {
    ...base,
    structures: [...(base.structures ?? []), { type: 'camp', at: CAMP_TILE, size: [2, 2], side: 1 }],
    enemy: {
      ...base.enemy,
      production: { menu: ['sarim_rifles', 'atgm_cell'], logistics_start: START, rally: 'battery_position', group: 'camp_guard' },
    },
  };
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  const sim = new Sim({ seed: job.seed, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const ti = structIdx.get(b.type);
    if (ti === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(ti, b.tiles);
  }
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as Parameters<typeof sim.addUnitType>[0]));
  const data = units as unknown as Record<string, { faction: string; cost: { logistics: number; build_time_s?: number; population?: number } } | undefined>;
  const rt = new MissionRuntime(sim, resolveUpgrades(mission, {}, () => undefined), {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    roadMask: roadMaskOf(map),
    ledger: {},
    // Side-aware (R-F4-5): side 0 sees the KDF menu, side 1 the Sarim one.
    unitInfo: (u, side) => {
      const d = data[u];
      if (d === undefined || d.faction !== (side === 0 ? 'kdf' : 'sarim')) return null;
      return { logistics: d.cost.logistics, buildTimeS: d.cost.build_time_s ?? 20, population: d.cost.population ?? 1 };
    },
  });
  rt.start();
  const ids = (t: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++)
      if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === t) out.push(i);
    return out;
  };
  const timed = new Map<number, (() => void)[]>();
  if (job.kind === 'plan') {
    SHIPPED_PLAN(sim, ids, (t, fn) => {
      const when = t * TICKS_PER_SECOND;
      const l = timed.get(when);
      if (l) l.push(fn);
      else timed.set(when, [fn]);
    });
  }
  let bought = 0;
  const maxTicks = 20 * 60 * TICKS_PER_SECOND;
  let t = 0;
  for (; t < maxTicks; t++) {
    const due = timed.get(t);
    if (due) for (const fn of due) fn();
    const evs = sim.tick();
    for (const me of rt.step(evs)) if (me.kind === 'built' && me.side === 1) bought++;
    if (rt.result !== 'ongoing') break;
  }
  const purse = START + rt.logisticsEarned(1);
  const cause = rt.result === 'defeat' ? (typeof rt.defeatCause === 'string' ? rt.defeatCause : rt.defeatCause === undefined ? '' : `objective:${rt.defeatCause.objective}`) : '';
  return {
    ...job,
    bought,
    unspentPct: Math.round((100 * rt.logisticsOf(1)) / purse),
    result: t >= maxTicks && rt.result === 'ongoing' ? 'STUCK' : rt.result,
    cause,
    minutes: t / TICKS_PER_SECOND / 60,
  };
}

if (process.argv[2] === '--worker') {
  process.on('message', (job: Job) => {
    process.send?.(runOne(job));
  });
} else {
  const jobs: Job[] = [];
  for (const kind of ['plan', 'passive'] as const) for (const seed of SWEEP_SEEDS) jobs.push({ kind, seed });
  const replies: Reply[] = [];
  const path = fileURLToPath(import.meta.url);
  const workers = Math.max(1, Math.min(8, availableParallelism() - 1));
  let live = 0;
  const queue = jobs.slice();
  const next = (child: ReturnType<typeof fork>): void => {
    const job = queue.shift();
    if (job === undefined) child.kill();
    else child.send(job);
  };
  const report = (): void => {
    console.log(`enemy-production probe: ${ID} + a side-1 camp at tile ${CAMP_TILE.join(',')} (beside battery_position 25,6), purse ${START}, menu sarim_rifles/atgm_cell`);
    console.log('seeds: main SWEEP_SEEDS (424242, then 1..29), not the G3 sheet\'s set. REPORT ONLY, no gate.');
    for (const kind of ['plan', 'passive'] as const) {
      const rs = replies.filter((r) => r.kind === kind).sort((a, b) => SWEEP_SEEDS.indexOf(a.seed) - SWEEP_SEEDS.indexOf(b.seed));
      console.log(`\n${kind === 'plan' ? 'shipped winning plan' : 'passive control (no orders)'}`);
      console.log('seed      bought  unspent%  outcome   minutes  cause');
      for (const r of rs) {
        console.log(`${String(r.seed).padEnd(9)} ${String(r.bought).padStart(6)}  ${String(r.unspentPct).padStart(7)}  ${r.result.padEnd(8)}  ${r.minutes.toFixed(1).padStart(7)}  ${r.cause}`);
      }
      const n = rs.length;
      const sum = (f: (r: Reply) => number): number => rs.reduce((a, r) => a + f(r), 0);
      const outcomes = new Map<string, number>();
      for (const r of rs) outcomes.set(r.result, (outcomes.get(r.result) ?? 0) + 1);
      console.log(
        `summary: ${n} runs, bought mean ${(sum((r) => r.bought) / n).toFixed(2)} (min ${Math.min(...rs.map((r) => r.bought))}, max ${Math.max(...rs.map((r) => r.bought))}), ` +
          `unspent mean ${(sum((r) => r.unspentPct) / n).toFixed(1)}%, outcomes ${[...outcomes].map(([k, v]) => `${k} ${v}`).join(', ')}, ` +
          `minutes mean ${(sum((r) => r.minutes) / n).toFixed(1)}`
      );
    }
  };
  for (let w = 0; w < workers && queue.length > 0; w++) {
    const child = fork(path, ['--worker'], { execArgv: process.execArgv });
    live++;
    child.on('message', (r: Reply) => {
      replies.push(r);
      next(child);
    });
    child.on('exit', () => {
      if (--live === 0) {
        if (replies.length !== jobs.length) {
          console.error(`only ${replies.length} of ${jobs.length} runs answered`);
          process.exitCode = 1;
        }
        report();
      }
    });
    next(child);
  }
}
