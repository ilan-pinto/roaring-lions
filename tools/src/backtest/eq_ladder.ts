/* eslint-disable @typescript-eslint/no-explicit-any -- reads mission/map JSON by shape, on purpose */
// Ein Qasab plan ladder (GH-912): passive / naive / sensible / optimal over many seeds, for the three missions of
// the flood week, with the two probes the level script asked for.
//
//   npx tsx tools/src/backtest/eq_ladder.ts [seeds=30] [mission-id ...]
//   EQ_TIERS=passive,naive,sensible,optimal   which rungs to run (default all four)
//   EQ_SWARM=off                              run Ein Qasab II WITHOUT its 215 s drone_swarm wave (T-B1)
//   EQ_CARRY=1                                Ein Qasab III's carry probe: with the marks forwarded vs without
//   EQ_FROM=wh3|wh5                           the ledger Ein Qasab I is played on (default wh3: the town opens after it)
//   EQ_V=1                                    one line per seed
//
// The rungs, written against MARKERS AND ZONES (never coordinates) except `optimal`:
//   passive  - no orders at all.
//   naive    - one attackMove of the whole force to the mission's focus at t=0, never re-issued.
//   sensible - what a player who read the briefing would do (see `sensible` below).
//   optimal  - the scripted plans `pnpm playtest` runs: the SAME objects, from plans/ein_qasab.ts.
//
// Ledger: each rung of mission k plays on the ledger the OPTIMAL plan of mission k-1 produced at the same seed
// (Ein Qasab I on the Wadi Halam III ledger, itself the optimal chain I..III at that seed), as the passive
// controls in playtest.ts do. Only the mission under test varies between rungs.
//
// Every figure is from `run()` in playtest-run.ts, the instrument `pnpm playtest` uses.
import { fx, type LedgerData, type MissionEvent, type MissionRuntime, type Sim } from '@lions/sim';
import { missions } from '@lions/data';
import { run, setSweep, tapMissionEvents, type Plan } from './playtest-run';
import { WADI_HALAM_CHAIN, WADI_HALAM_PLANS } from './plans/wadi_halam';
import * as EQ from './plans/ein_qasab';
import { EIN_QASAB_CHAIN, EIN_QASAB_PLANS, eqNaive, eqSensible, eqFoot, eq2CrestPlan } from './plans/ein_qasab';
import { SWEEP_SEEDS } from './passive-sweep';

type Tier = 'passive' | 'naive' | 'sensible' | 'optimal' | 'foot' | 'crest';
const seedsN = Number(process.argv[2] ?? 30);
const only = process.argv.slice(3);
const TIERS = (process.env.EQ_TIERS ?? 'passive,naive,sensible,optimal').split(',').filter(Boolean) as Tier[];
const MEASURE = only.length > 0 ? only : [...EIN_QASAB_CHAIN];
const SEEDS = SWEEP_SEEDS.slice(0, seedsN);
void fx;

interface Result {
  seed: number;
  result: string;
  seconds: number;
  roe: number;
  stars: number;
  credits: number;
  lost: number;
  evacuated: number;
  cause?: string;
  produced: LedgerData;
  /** Trigger id -> [fire second, living size of the group it acts on at that tick]. */
  fired: Record<string, [number, number]>;
  /** First second of each field-works event, and whether the outpost still stood at the end. */
  works: Record<string, number>;
  /** The drone swarm: the second it was destroyed (undefined: never killed), and whether it ever spawned. */
  swarm: { spawned: boolean; diedAt?: number; kdfLostAfter: number };
  /** Orders the plan itself gave (every `queueCommand` made from inside one of its timed callbacks). */
  orders: number;
}

const quiet = <T>(fn: () => T): T => {
  const log = console.log;
  const err = console.error;
  const code = process.exitCode;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = err;
    process.exitCode = code;
  }
};

function playOne(id: string, plan: Plan, ledger: LedgerData, seed: number, overrides: { noSwarm?: boolean } = {}): Result {
  const m = missions[id as keyof typeof missions] as any;
  const waves = (m.enemy?.waves ?? []) as any[];
  const swarmAt = waves.findIndex((w) => w.units.some((u: any) => u.unit === 'drone_swarm'));
  const held = swarmAt >= 0 && overrides.noSwarm ? waves.splice(swarmAt, 1)[0] : undefined;
  let lost = 0;
  let evacuated = 0;
  const fired: Record<string, [number, number]> = {};
  const works: Record<string, number> = {};
  const swarm: Result['swarm'] = { spawned: false, kdfLostAfter: 0 };
  let simRef: Sim | undefined;
  tapMissionEvents((evs: readonly MissionEvent[], rt: MissionRuntime, sim: Sim) => {
    simRef = sim;
    for (const e of evs) {
      if (e.kind === 'unitLost' && e.side === 0 && !e.unit.startsWith('wounded_')) {
        lost++;
        if (swarm.spawned && swarm.diedAt === undefined) swarm.kdfLostAfter++;
      }
      else if (e.kind === 'evacuated') evacuated++;
      else if (e.kind === 'trigger') {
        const t = (m.triggers as any[]).find((x) => x.id === e.id);
        const g = t?.do?.group as string | undefined;
        const members = ((rt as any).groups?.get(g ?? '') ?? []) as number[];
        fired[e.id] = [Math.round(e.tick / 20), members.filter((i) => sim.state.alive[i] === 1).length];
      }
    }
  });
  let orders = 0;
  let inPlan = false;
  const counted: Plan = (sim, rt, ids, at) => {
    const real = sim.queueCommand.bind(sim);
    (sim as any).queueCommand = (c: Parameters<Sim['queueCommand']>[0]) => {
      if (inPlan) orders++;
      return real(c);
    };
    plan(sim, rt, ids, (t, fn) =>
      at(t, () => {
        inPlan = true;
        try {
          fn();
        } finally {
          inPlan = false;
        }
      })
    );
  };
  const meas = { result: 'ongoing', stars: 0, roeScore: 0, credits: 0 } as NonNullable<Parameters<typeof run>[10]>;
  let produced: LedgerData;
  try {
    produced = quiet(() => {
      setSweep(seed, true);
      const r = run(id as never, counted, ledger, 'victory', `${id} (ladder)`, 0, undefined, new Set(), undefined, undefined, meas, [], (sevs) => {
        for (const e of sevs) {
          if (e.kind === 'constructQueued' || e.kind === 'constructStaked' || e.kind === 'structureComplete' || e.kind === 'constructCancelled' || e.kind === 'constructRefused')
            works[e.kind] ??= Math.round(e.tick / 20);
          else if (e.kind === 'spawn' || e.kind === 'destroyed') {
            const ent = (e as { entity?: number }).entity;
            if (ent === undefined || simRef === undefined) continue;
            if (simRef.unitTypes[simRef.state.typeIdx[ent]].id !== 'drone_swarm') continue;
            if (e.kind === 'spawn') swarm.spawned = true;
            else swarm.diedAt ??= Math.round(e.tick / 20);
          }
        }
      });
      return r;
    });
  } finally {
    setSweep(undefined, false);
    tapMissionEvents(undefined);
    if (held) waves.splice(swarmAt, 0, held);
  }
  return {
    seed,
    result: meas.result,
    seconds: (meas.minutes ?? 0) * 60,
    roe: meas.roeScore,
    stars: meas.stars,
    credits: meas.credits,
    lost,
    evacuated,
    cause: meas.cause,
    produced,
    fired,
    works,
    swarm,
    orders,
  };
}

const PASSIVE: Plan = () => {};
function planFor(id: string, tier: Tier): Plan {
  if (tier === 'passive') return PASSIVE;
  if (tier === 'naive') return eqNaive(id);
  if (tier === 'sensible') return eqSensible(id);
  if (tier === 'foot') return eqFoot(id);
  if (tier === 'crest') return eq2CrestPlan;
  const n = EIN_QASAB_CHAIN.indexOf(id as never) + 1;
  const named = process.env[`EQ_OPT_${n}`];
  return named ? ((EQ as any)[named] as Plan) : (EIN_QASAB_PLANS as Record<string, Plan>)[id];
}

/** The Wadi Halam III ledger at a seed, from the optimal chain (the ledger Ein Qasab I is entered on). */
function wadiHalamLedger(seed: number, upto: 3 | 5): LedgerData {
  let ledger: LedgerData = {};
  for (const wid of WADI_HALAM_CHAIN.slice(0, upto)) {
    const r = playOne(wid, WADI_HALAM_PLANS[wid], ledger, seed);
    ledger = r.produced;
  }
  return ledger;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f = (x: number, d = 1): string => (Number.isNaN(x) ? '-' : x.toFixed(d));

function summarise(label: string, rs: Result[]): void {
  const wins = rs.filter((r) => r.result === 'victory');
  const limit = (missions as any)[label.split(' ')[0]]?.time_limit_s as number | undefined;
  const slowest = Math.max(0, ...wins.map((r) => r.seconds));
  const stars = [0, 1, 2, 3].map((s) => wins.filter((r) => r.stars === s).length).join('/');
  const causes: Record<string, number> = {};
  for (const r of rs) if (r.result !== 'victory') causes[`${r.result}:${r.cause ?? '-'}`] = (causes[`${r.result}:${r.cause ?? '-'}`] ?? 0) + 1;
  const margin = limit !== undefined && wins.length > 0 ? `limit ${limit}s, headroom ${f(limit - slowest, 0)}s (need ${f(Math.max(120, slowest * 0.2), 0)})` : '';
  console.log(
    `${label}: wins ${wins.length}/${rs.length}, mean ${f(mean(wins.map((r) => r.seconds)) / 60)} min, slowest ${f(slowest / 60)} min (${f(slowest, 0)} s), ` +
      `ROE ${f(mean(wins.map((r) => r.roe)), 0)} (min ${f(Math.min(...wins.map((r) => r.roe)), 0)}), stars 0..3 ${stars}, lost ${f(mean(rs.map((r) => r.lost)))}, ` +
      `evac ${f(mean(rs.map((r) => r.evacuated)))}, orders ${f(mean(rs.map((r) => r.orders)), 0)} (${f(mean(rs.map((r) => r.orders / Math.max(r.seconds / 60, 0.1))))} a min), credits ${f(mean(wins.map((r) => r.credits)), 0)} ${margin}` +
      (Object.keys(causes).length ? `, lost by ${JSON.stringify(causes)}` : '')
  );
  if (process.env.EQ_V) for (const r of rs) console.log(`   seed ${r.seed}: ${r.result} ${f(r.seconds, 0)}s ROE ${r.roe} stars ${r.stars} lost ${r.lost} evac ${r.evacuated} ${r.cause ?? ''} ${JSON.stringify(r.fired)}`);
  const fires = new Map<string, number[][]>();
  for (const r of rs) for (const [k, v] of Object.entries(r.fired)) fires.set(k, [...(fires.get(k) ?? []), v]);
  const wk = rs.filter((r) => Object.keys(r.works).length > 0);
  if (wk.length > 0) {
    const med = (k: string): string => {
      const xs = wk.map((r) => r.works[k]).filter((x) => x !== undefined).sort((a, b) => a - b);
      return xs.length ? `${xs.length}/${rs.length} (first s: min ${xs[0]}, max ${xs[xs.length - 1]})` : `0/${rs.length}`;
    };
    console.log(`   field works: queued ${med('constructQueued')}, staked ${med('constructStaked')}, complete ${med('structureComplete')}, cancelled ${med('constructCancelled')}, refused ${med('constructRefused')}`);
  }
  const sw = rs.filter((r) => r.swarm.spawned);
  if (sw.length > 0) {
    const died = sw.filter((r) => r.swarm.diedAt !== undefined);
    console.log(`   swarm: spawned on ${sw.length}/${rs.length}, destroyed on ${died.length}/${sw.length}${died.length ? ` (second ${Math.min(...died.map((r) => r.swarm.diedAt as number))}..${Math.max(...died.map((r) => r.swarm.diedAt as number))})` : ''}, KDF units lost while it lived: ${sw.reduce((a, r) => a + r.swarm.kdfLostAfter, 0)} total`);
  }
  for (const [k, v] of fires) console.log(`   trigger ${k}: fired on ${v.length}/${rs.length} seeds, tick(s) min ${Math.min(...v.map((x) => x[0]))} max ${Math.max(...v.map((x) => x[0]))}, group size at fire min ${Math.min(...v.map((x) => x[1]))} max ${Math.max(...v.map((x) => x[1]))}`);
}

console.log(`seeds ${SEEDS.length} (${SEEDS[0]}, 1..${SEEDS.length - 1}); rungs ${TIERS.join('/')}; from ${process.env.EQ_FROM ?? 'wh3'}; swarm ${process.env.EQ_SWARM ?? 'on'}`);
const from = (process.env.EQ_FROM ?? 'wh3') === 'wh5' ? 5 : 3;
// Per seed: the ledger each mission is entered on, built by the OPTIMAL chain.
const entry = new Map<string, Map<number, LedgerData>>();
for (const id of EIN_QASAB_CHAIN) entry.set(id, new Map());
const chainRuns = new Map<string, Result[]>();
for (const seed of SEEDS) {
  let ledger = wadiHalamLedger(seed, from);
  for (const id of EIN_QASAB_CHAIN) {
    entry.get(id)?.set(seed, ledger);
    const r = playOne(id, planFor(id, 'optimal'), ledger, seed, { noSwarm: process.env.EQ_SWARM === 'off' && id === 'ein_qasab_2_foothold' });
    chainRuns.set(id, [...(chainRuns.get(id) ?? []), r]);
    ledger = r.produced;
  }
}
for (const id of MEASURE) {
  for (const tier of TIERS) {
    if ((tier === 'foot' && id !== 'ein_qasab_1_recon') || (tier === 'crest' && id !== 'ein_qasab_2_foothold')) continue;
    const rs: Result[] =
      tier === 'optimal'
        ? (chainRuns.get(id) as Result[])
        : SEEDS.map((seed) => playOne(id, planFor(id, tier), entry.get(id)?.get(seed) as LedgerData, seed, { noSwarm: process.env.EQ_SWARM === 'off' && id === 'ein_qasab_2_foothold' }));
    summarise(`${id} ${tier}`, rs);
  }
}

if (process.env.EQ_CARRY) {
  const id = 'ein_qasab_3_buildup';
  const MARKS = ['eq_reed_cell', 'eq_causeway_rpg', 'eq_saddle_truck'];
  console.log('carry probe: Ein Qasab III, optimal plan, on its ledger with the marks forwarded vs without');
  const variants: [string, (l: LedgerData) => LedgerData][] = [
    ['forwarded (as the chain hands it)', (l) => l],
    ['none (marks stripped)', (l) => ({ ...l, 'intel.marked_positions': [] })],
    ...MARKS.map((t): [string, (l: LedgerData) => LedgerData] => [`only ${t}`, (l) => ({ ...l, 'intel.marked_positions': [t] })]),
  ];
  for (const [name, mut] of variants) {
    const rs = SEEDS.map((seed) => playOne(id, planFor(id, 'optimal'), mut(entry.get(id)?.get(seed) as LedgerData), seed));
    summarise(`${id} carry ${name}`, rs);
  }
}
