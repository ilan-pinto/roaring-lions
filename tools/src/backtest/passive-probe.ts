// The passive-player probe (civilian drama E11, GH-1438; docs/campaign/civilian-drama.md sections 1.1, 10.2, 10.4
// and 11.2): does a player who gives no orders WIN a mission with civilians, over thirty seeds?
//
//   pnpm passive:probe [-- --missions=<id,...>] [--seeds=30] [--plans=none,naive,parked] [--park=<marker>]
//                      [--per-seed] [--gate]
//
// REPORT-ONLY by default: it prints one line per mission and plan (and per seed with `--per-seed`) and exits 0
// whatever they say. The gate on the no-orders control is `pnpm playtest`'s `passiveAcrossSeeds`, which already
// holds every shipped control to a loss on `SWEEP_SEEDS`; this probe is the reading the crowd work is designed
// against, and it adds what that gate does not count: the civilians counted in (`evacuated`) with nobody sent for
// them, at 60/120/180/240/300 s, the civilians downed, killed and taken, and the entity budget (peak living, and the
// lifetime count the 256 capacity is spent from). `--gate` makes the no-orders verdict an exit code (1 on WINS or
// LEAKS, section 10.4's P0), for the day a crowd mission wants it in CI; nothing runs it with `--gate` today.
//
// The world is `run()`'s own (`playtest-run.ts`), the one `pnpm playtest` and its sweep workers build, seeded per
// run by `setSweep`, so seed 424242 of a mission here is that mission's passive control there. Two differences, both
// deliberate: every mission runs on an EMPTY ledger (`playtest.ts` chains some controls off an earlier winning plan:
// Wadi Halam II to V, Ein Qasab, the later Qasr Liwan and Bir Tarsha), and at Standard posture only.
//
// Plans (`--plans`):
//   none    no orders: the control. This is the one the verdict is about.
//   naive   the one-click player: every living side-0 ground unit attack-moves at t=0 on the centroid of the side-1
//           units alive at t=0 (the map centre when none is), and is never ordered again (section 10.4's P2, made
//           map-generic: the design's own "east" and "(4,23)" are one map's direction).
//   parked  one unit to a named marker (`--park=<marker>`) at t=0 and nothing else (section 10.4's P1, the keeper at
//           the apron): the first living side-0 `inf_squad`, else the first side-0 ground unit. A mission without
//           that marker skips the plan and says so.
//
// Mission set: every mission whose `civilians.groups` is non-empty (section 3's census, 29 files on dev at the time
// of writing), or `--missions`.
//
// Falsified (see the PR): the verdict's win test inverted (`isWin` true for anything but victory) turns the unit
// tests red; it is put back by copy and confirmed with `cmp`.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICKS_PER_SECOND, type MissionJson, type SimEvent } from '@lions/sim';
import { parseMap } from '@lions/data';
import { maps, missions } from '@lions/data/content';
import { run, setSweep, tapMissionEvents, type Plan } from './playtest-run';
import {
  evacuatedAtCheckpoints,
  exitCodeFor,
  formatRow,
  formatSummary,
  outcomeOf,
  seedsOf,
  summarise,
  type SeedRow,
  type Summary,
} from './passive-probe-read';

export type ProbePlan = 'none' | 'naive' | 'parked';
const PLANS: readonly ProbePlan[] = ['none', 'naive', 'parked'];

type MissionId = keyof typeof missions;

/** Every shipped mission that places civilians. */
export function civilianMissions(): MissionId[] {
  return (Object.keys(missions) as MissionId[])
    .filter((id) => ((missions[id] as unknown as MissionJson).civilians?.groups.length ?? 0) > 0)
    .sort();
}

const ground = (sim: Parameters<Plan>[0], i: number): boolean => !sim.unitTypes[sim.state.typeIdx[i]].isAir;

const naivePlan: Plan = (sim, _rt, _ids, at) => {
  at(0, () => {
    const st = sim.state;
    const force: number[] = [];
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < sim.entityCount; i++) {
      if (st.alive[i] !== 1) continue;
      if (st.side[i] === 0 && ground(sim, i)) force.push(i);
      else if (st.side[i] === 1) {
        sx += st.posX[i];
        sy += st.posY[i];
        n++;
      }
    }
    if (force.length === 0) return;
    // Integer centroid in Q16.16, as the sim reads it: no float reaches a command.
    const x = n > 0 ? Math.trunc(sx / n) : sim.width * 32768;
    const y = n > 0 ? Math.trunc(sy / n) : sim.height * 32768;
    sim.queueCommand({ kind: 'attackMove', ids: force, x, y });
  });
};

function parkedPlan(marker: readonly number[]): Plan {
  return (sim, _rt, ids, at) => {
    at(0, () => {
      const st = sim.state;
      let who = ids('inf_squad')[0];
      if (who === undefined) {
        for (let i = 0; i < sim.entityCount; i++) {
          if (st.alive[i] === 1 && st.side[i] === 0 && ground(sim, i)) {
            who = i;
            break;
          }
        }
      }
      if (who === undefined) return;
      // The marker's tile centre, as `MissionRuntime.markerPos` reads one.
      sim.queueCommand({ kind: 'move', ids: [who], x: marker[0] * 65536 + 32768, y: marker[1] * 65536 + 32768 });
    });
  };
}

/** Runs `fn` with `run()`'s own lines muted and the exit code it would set put back: `run()` holds a run to its
 *  expectation (a `naive` victory reads as FAILED there), and a report-only probe must not inherit that. */
function muted<T>(fn: () => T): T {
  const { log, error } = console;
  const code = process.exitCode;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = error;
    process.exitCode = code;
  }
}

/** One seed of one mission under one plan, on `run()`'s world. */
export function probeSeed(id: MissionId, plan: Plan, seed: number): SeedRow {
  const evacTicks: number[] = [];
  let downed = 0;
  let killed = 0;
  let taken = 0;
  let peakLiving = 0;
  let lifetime = 0;
  // Sim events arrive (`onEvents`) before the mission tap of the same tick; they are held and read in the tap, where
  // the sim is in hand. A dead or removed body keeps its `side`, so the lookup is good after the event.
  const pending: SimEvent[] = [];
  const onEvents = (evs: readonly SimEvent[]): void => {
    for (const e of evs) if (e.kind === 'woundedDown' || e.kind === 'destroyed' || e.kind === 'removed') pending.push(e);
  };
  tapMissionEvents((mevs, _rt, sim) => {
    for (const e of mevs) if (e.kind === 'evacuated') evacTicks.push(e.tick);
    for (const e of pending) {
      if (e.kind === 'woundedDown' && sim.state.side[e.entity] === 2) downed++;
      else if (e.kind === 'destroyed' && sim.state.side[e.entity] === 2) killed++;
      else if (e.kind === 'removed' && e.side === 2) taken++;
    }
    pending.length = 0;
    let living = 0;
    for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1) living++;
    if (living > peakLiving) peakLiving = living;
    lifetime = sim.entityCount;
  });
  const m = { result: 'ongoing', stars: 0, roeScore: 0, credits: 0 } as NonNullable<Parameters<typeof run>[10]>;
  try {
    setSweep(seed, true);
    muted(() => run(id, plan, {}, 'defeat', `${id} (passive probe, seed ${seed})`, 0, undefined, new Set(), undefined, undefined, m, [], onEvents));
  } finally {
    setSweep(undefined, false);
    tapMissionEvents(undefined);
  }
  const endS = (m.minutes ?? 0) * 60;
  return {
    seed,
    outcome: outcomeOf(m.result, m.cause),
    cause: m.cause,
    endS,
    evacuated: evacTicks.length,
    evacuatedAt: evacuatedAtCheckpoints(evacTicks, TICKS_PER_SECOND),
    downed,
    killed,
    taken,
    peakLiving,
    lifetime,
  };
}

function argOf(argv: readonly string[], name: string): string | undefined {
  const p = `--${name}=`;
  return argv.find((a) => a.startsWith(p))?.slice(p.length);
}

export function main(argv: readonly string[], log: (line: string) => void): 0 | 1 {
  const seeds = seedsOf(Number(argOf(argv, 'seeds') ?? 30));
  const only = argOf(argv, 'missions');
  const ids = only === undefined ? civilianMissions() : (only.split(',') as MissionId[]);
  for (const id of ids) if (!(id in missions)) throw new Error(`no shipped mission "${id}"`);
  const plans = (argOf(argv, 'plans') ?? 'none').split(',') as ProbePlan[];
  for (const p of plans) if (!PLANS.includes(p)) throw new Error(`unknown plan "${p}" (one of ${PLANS.join(', ')})`);
  const park = argOf(argv, 'park');
  if (plans.includes('parked') && park === undefined) throw new Error('--plans=parked needs --park=<marker>');
  const perSeed = argv.includes('--per-seed');
  const gate = argv.includes('--gate');
  log(
    `passive probe: ${ids.length} mission(s), plans ${plans.join(',')}, ${seeds.length} seeds (${seeds[0]}, ${seeds.slice(1, 3).join(', ')}${seeds.length > 3 ? ', ...' : ''}), empty ledger, standard posture; ` +
      (gate ? 'GATE on the no-orders verdict' : 'report-only')
  );
  const summaries: Summary[] = [];
  for (const id of ids) {
    for (const p of plans) {
      let plan: Plan;
      if (p === 'parked') {
        const mission = missions[id] as unknown as MissionJson;
        const marker = parseMap(maps[mission.map.file as keyof typeof maps]).markers[park ?? ''];
        if (marker === undefined) {
          log(`${id} [parked]: skipped -- no marker "${park}" on ${mission.map.file}`);
          continue;
        }
        plan = parkedPlan(marker);
      } else plan = p === 'naive' ? naivePlan : () => {};
      const rows = seeds.map((seed) => probeSeed(id, plan, seed));
      if (perSeed) for (const r of rows) log(formatRow(id, p, r));
      const s = summarise(id, p, rows);
      summaries.push(s);
      log(formatSummary(s));
    }
  }
  const none = summaries.filter((s) => s.plan === 'none');
  if (none.length > 0) {
    const count = (v: string): number => none.filter((s) => s.verdict === v).length;
    log(`passive probe: no-orders verdicts -- WINS ${count('WINS')}, LEAKS ${count('LEAKS')}, HOLDS ${count('HOLDS')} of ${none.length}`);
  }
  return exitCodeFor(summaries, gate);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), (line) => console.log(line));
}
