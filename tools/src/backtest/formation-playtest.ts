// GH-859 P1b, spec 8.5: the playtest variants. REPORT-ONLY (prints a table, exits 0 whatever it says). Not in CI.
// Run: pnpm --filter @lions/tools formations:playtest   (or: npx tsx src/backtest/formation-playtest.ts [--seeds=30])
//
// Does a scripted winning plan still win when its main-body order carries a combat formation? The three missions
// are Beit Sahwan IV (`beit_sahwan_4_subterranean`), Tel Marum II (`tel_marum_2_foothold`) and Qarn Hadid III
// (`qarn_hadid_3_clearance`), each played on the 30 seeds the winning-plan sweep uses (`SWEEP_SEEDS`), once as the
// shipped plan and once for each of the three MVP formations. Reported per mission and variant: the verdict counts,
// the winning minutes (median and slowest), the ROE (Conduct) and stars of the wins, and how many orders carried the
// formation and how many units ever stood in a group (so a variant that formed nothing says so).
//
// THE PLANS ARE NOT COPIED AND NOT EDITED. `playtest.ts` runs its whole ladder at import, so it cannot be imported;
// this file reads its source with the TypeScript parser, takes the three plan functions out of it by name, and
// compiles them again (`loadPlans`). A plan that changes there changes here; one that moved or was renamed makes
// this file throw, naming it. `pnpm playtest` is untouched, byte for byte.
//
// What a variant changes. The plan runs unmodified except that `sim.queueCommand` is wrapped: a plain `move` or
// `attackMove` order of at least `MAIN_BODY_MIN` (3) units (not `exact`, not an `append`) whose verb is the
// formation's gets `formation: <id>` added. Attack is for `attackMove`; Column and Ambush are for `move`. The
// formations are registered on the sim by the wrapper, before the plan runs. Nothing else differs, so a verdict
// that moves is the formation's. The ledger a plan gets is the one the shipped playtest hands it on the same seed:
// the campaign's earlier missions are replayed (unmodified, quiet) from `playtest.ts`'s own `led1`, `led2`, `led3`,
// `ledQH1` and `ledQH2` declarations (with `led0`, `breachRescue` and `ledTelMarum3` under them) (`ledgerFor`), Tel Marum II's being `{}`. The unmodified plan (`none`) is the
// baseline each variant is read against; on seed 424242 it is the shipped playtest's own run.

import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formations } from '@lions/data';
import { fx, type Command, type LedgerData, type SimEvent } from '@lions/sim';
import { run, runLog, setSweep, type Plan } from './playtest-run';
import { firstLightPlan } from './plans/beit_sahwan';
import { telMarum3Plan } from './plans/tel_marum';
import { Picture, living } from './player-picture';
import { SWEEP_SEEDS } from './passive-sweep';

/** The least units in an order for it to be a main body: smaller orders are detachments, scouts and escorts. Three,
 *  because Tel Marum II's largest order is its three rifle squads (a formation needs two). */
export const MAIN_BODY_MIN = 3;
export const MISSIONS = ['beit_sahwan_4_subterranean', 'tel_marum_2_foothold', 'qarn_hadid_3_clearance'] as const;
export type Mission = (typeof MISSIONS)[number];
export const VARIANTS = ['none', 'attack', 'column', 'ambush'] as const;
export type Variant = (typeof VARIANTS)[number];
/** The verb each MVP formation is for. */
export const VERB_OF: Record<Exclude<Variant, 'none'>, 'move' | 'attackMove'> = { attack: 'attackMove', column: 'move', ambush: 'move' };

const PLAYTEST = fileURLToPath(new URL('./playtest.ts', import.meta.url));

/** `playtest.ts`'s scripted plan for each of the three missions, compiled out of its source. */
export function loadPlans(source: string = readFileSync(PLAYTEST, 'utf8')): Record<Mission, Plan> {
  const sf = ts.createSourceFile('playtest.ts', source, ts.ScriptTarget.ES2022, true);
  const found = new Map<Mission, string>();
  const named: Record<string, Mission> = { bs4Plan: 'beit_sahwan_4_subterranean', qarnHadid3Plan: 'qarn_hadid_3_clearance' };
  const visit = (node: ts.Node): void => {
    // `const bs4Plan: Plan = (sim, rt, ids, at) => {...}`
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text in named && node.initializer !== undefined) {
      found.set(named[node.name.text], node.initializer.getText(sf));
    }
    // `run('tel_marum_2_foothold', (sim, _rt, ids, at) => {...}, {}, 'victory', 'tel_marum_2_foothold')`: the winning run
    // (label equal to the id), with the plan written inline.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'run' && node.arguments.length >= 5) {
      const [id, plan, , , label] = node.arguments;
      if (ts.isStringLiteral(id) && id.text === 'tel_marum_2_foothold' && ts.isStringLiteral(label) && label.text === id.text && (ts.isArrowFunction(plan) || ts.isFunctionExpression(plan))) {
        found.set('tel_marum_2_foothold', plan.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const M = (x: number, y: number): { x: number; y: number } => ({ x: fx.from(x), y: fx.from(y) });
  const out = {} as Record<Mission, Plan>;
  for (const m of MISSIONS) {
    const text = found.get(m);
    if (text === undefined) throw new Error(`formation playtest: could not find ${m}'s plan in playtest.ts (renamed or moved?)`);
    const js = ts.transpileModule(`const plan = (${text});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    // The names the three plans use from playtest.ts's own scope.
    out[m] = new Function('M', 'Picture', 'living', 'fx', `${js}\nreturn plan;`)(M, Picture, living, fx) as Plan;
  }
  return out;
}

export interface Tally {
  /** Orders the wrapper tagged with the formation. */
  carried: number;
  /** Units named in those orders, and how many of them stood in a formation group at any tick. */
  ordered: Set<number>;
  everGrouped: Set<number>;
  /** Formation events seen over the run, by kind. */
  events: Record<string, number>;
  /** The run's sim, set by the wrapper, so the per-tick hook can read the groups. */
  sim?: { formationGroupOf(id: number): number };
}
export const newTally = (): Tally => ({ carried: 0, ordered: new Set(), everGrouped: new Set(), events: {} });

/** Whether a command is a main-body order for `variant`, and so gets the formation. */
export function carries(c: Command, variant: Exclude<Variant, 'none'>): boolean {
  if (c.kind !== VERB_OF[variant] || c.formation !== undefined || c.exact === true || c.append === true) return false;
  return new Set(c.ids).size >= MAIN_BODY_MIN;
}

/** `plan` with its main-body orders carrying `variant` (`none` returns it as it is), counted into `tally`. */
export function variantPlan(plan: Plan, variant: Variant, tally: Tally): Plan {
  if (variant === 'none') return plan;
  return (sim, rt, ids, at) => {
    for (const f of formations) sim.addFormationType(f);
    tally.sim = sim;
    const queue = sim.queueCommand.bind(sim);
    (sim as unknown as { queueCommand: (c: Command) => void }).queueCommand = (c: Command): void => {
      if ((c.kind === 'move' || c.kind === 'attackMove') && carries(c, variant)) {
        tally.carried++;
        for (const id of c.ids) tally.ordered.add(id);
        queue({ ...c, formation: variant });
      } else queue(c);
    };
    plan(sim, rt, ids, at);
  };
}

/** The declarations of `playtest.ts` that build each plan's ledger, in the order they must run. */
const CHAIN: Record<Mission, readonly string[]> = {
  beit_sahwan_4_subterranean: ['breachRescue', 'led0', 'led1', 'led2', 'led3', 'led4In'],
  tel_marum_2_foothold: [],
  qarn_hadid_3_clearance: ['ledTelMarum3', 'ledQH1', 'ledQH2', 'ledQH2In'],
};
const LEDGER_OF: Record<Mission, string | null> = { beit_sahwan_4_subterranean: 'led4In', tel_marum_2_foothold: null, qarn_hadid_3_clearance: 'ledQH2In' };

/** The text of the `const <name> = <initializer>` statements of `playtest.ts` named in `names`. */
export function chainSource(names: readonly string[], source: string = readFileSync(PLAYTEST, 'utf8')): Map<string, string> {
  const sf = ts.createSourceFile('playtest.ts', source, ts.ScriptTarget.ES2022, true);
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && names.includes(d.name.text) && d.initializer !== undefined) out.set(d.name.text, d.initializer.getText(sf));
    }
  }
  for (const n of names) if (!out.has(n)) throw new Error(`formation playtest: could not find \`const ${n}\` in playtest.ts (renamed or moved?)`);
  return out;
}

/** The ledger `playtest.ts` hands `mission`'s plan on `seed`: its earlier missions replayed, unmodified, on that seed.
 *  Quiet; leaves `process.exitCode` as it was. `{}` for a mission that is run on none. */
export function ledgerFor(mission: Mission, seed: number, source?: string): LedgerData {
  const names = CHAIN[mission];
  const want = LEDGER_OF[mission];
  if (want === null) return {};
  const decls = chainSource(names, source);
  const scope: Record<string, unknown> = {
    run, Picture, living, fx, M: (x: number, y: number) => ({ x: fx.from(x), y: fx.from(y) }), firstLightPlan, telMarum3Plan,
  };
  const exit = process.exitCode;
  const err = console.error;
  const log = console.log;
  console.error = () => {};
  console.log = () => {};
  setSweep(seed, true);
  try {
    for (const n of names) {
      const js = ts.transpileModule(`const value = (${decls.get(n)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
      const keys = Object.keys(scope);
      scope[n] = new Function(...keys, `${js}\nreturn value;`)(...keys.map((k) => scope[k]));
    }
  } finally {
    setSweep(undefined, false);
    console.error = err;
    console.log = log;
    process.exitCode = exit;
  }
  return scope[want] as LedgerData;
}

export interface Played {
  mission: Mission;
  variant: Variant;
  seed: number;
  result: 'victory' | 'defeat' | 'ongoing';
  stuck: boolean;
  minutes: number;
  roe: number;
  stars: number;
  cause?: string;
  carried: number;
  ordered: number;
  everGrouped: number;
  events: Record<string, number>;
}

/** One run of one mission with one variant on one seed, quiet, and with `process.exitCode` as it was. */
export function play(mission: Mission, variant: Variant, seed: number, plans: Record<Mission, Plan> = loadPlans(), ledger: LedgerData = ledgerFor(mission, seed)): Played {
  const tally = newTally();
  const plan = variantPlan(plans[mission], variant, tally);
  const exit = process.exitCode;
  const err = console.error;
  const log = console.log;
  console.error = () => {};
  console.log = () => {};
  setSweep(seed, true);
  try {
    run(
      mission,
      plan,
      ledger,
      'victory',
      `${mission} [${variant}]`,
      0,
      undefined,
      new Set(),
      undefined,
      undefined,
      undefined,
      [],
      (evs: readonly SimEvent[]) => {
        if (tally.sim !== undefined) for (const id of tally.ordered) if (tally.sim.formationGroupOf(id) >= 0) tally.everGrouped.add(id);
        for (const e of evs) {
          if (e.kind === 'formationSprung' || e.kind === 'formationContact' || e.kind === 'formationReleased' || e.kind === 'formationCall') tally.events[e.kind] = (tally.events[e.kind] ?? 0) + 1;
        }
      },
    );
  } finally {
    setSweep(undefined, false);
    console.error = err;
    console.log = log;
    process.exitCode = exit;
  }
  const r = runLog[runLog.length - 1];
  return {
    mission, variant, seed, result: r.result, stuck: r.stuck, minutes: r.minutes, roe: r.roe, stars: r.stars, cause: r.cause,
    carried: tally.carried, ordered: tally.ordered.size, everGrouped: tally.everGrouped.size, events: tally.events,
  };
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

export interface Reading {
  mission: Mission;
  variant: Variant;
  runs: number;
  victories: number;
  defeats: number;
  stuck: number;
  /** Winning minutes: median and slowest; null with no win. */
  medianMinutes: number | null;
  slowestMinutes: number | null;
  /** The ROE (Conduct) of the wins: median and lowest. */
  medianRoe: number | null;
  lowestRoe: number | null;
  /** Wins with fewer than 2 stars. */
  underTwoStars: number;
  carried: number;
  ordered: number;
  everGrouped: number;
  /** Runs in which a formation group ever stood. */
  runsFormed: number;
  events: Record<string, number>;
  /** Why the lost runs were lost (`causeText`), counted. */
  causes: Record<string, number>;
}

const med = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2;
};

export function read(games: readonly Played[]): Reading {
  const wins = games.filter((g) => g.result === 'victory');
  const events: Record<string, number> = {};
  for (const g of games) for (const [k, n] of Object.entries(g.events)) events[k] = (events[k] ?? 0) + n;
  const causes: Record<string, number> = {};
  for (const g of games) if (g.cause !== undefined) causes[g.cause] = (causes[g.cause] ?? 0) + 1;
  return {
    mission: games[0].mission,
    variant: games[0].variant,
    runs: games.length,
    victories: wins.length,
    defeats: games.filter((g) => g.result === 'defeat').length,
    stuck: games.filter((g) => g.stuck).length,
    medianMinutes: med(wins.map((g) => g.minutes)),
    slowestMinutes: wins.length === 0 ? null : Math.max(...wins.map((g) => g.minutes)),
    medianRoe: med(wins.map((g) => g.roe)),
    lowestRoe: wins.length === 0 ? null : Math.min(...wins.map((g) => g.roe)),
    underTwoStars: wins.filter((g) => g.stars < 2).length,
    carried: games.reduce((n, g) => n + g.carried, 0),
    ordered: games.reduce((n, g) => n + g.ordered, 0),
    everGrouped: games.reduce((n, g) => n + g.everGrouped, 0),
    runsFormed: games.filter((g) => g.everGrouped > 0).length,
    events,
    causes,
  };
}

const fmt = (x: number | null, d = 1): string => (x === null ? 'n/a' : x.toFixed(d));

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const a = args.find((x) => x.startsWith('--seeds='));
  const n = a === undefined ? SWEEP_SEEDS.length : Number(a.slice(8));
  if (!Number.isInteger(n) || n < 1 || n > SWEEP_SEEDS.length) throw new Error(`--seeds must be a whole number from 1 to ${SWEEP_SEEDS.length}`);
  const only = args.find((x) => x.startsWith('--mission='))?.slice(10);
  if (only !== undefined && !(MISSIONS as readonly string[]).includes(only)) throw new Error(`--mission must be one of ${MISSIONS.join(', ')}`);
  const seeds = SWEEP_SEEDS.slice(0, n);
  const plans = loadPlans();
  console.log(`formation playtest variants (GH-859 P1b spec 8.5; report-only): ${seeds.length} seeds (${seeds.slice(0, 3).join(', ')}, ...), main-body orders of >= ${MAIN_BODY_MIN} units carry the formation whose verb they have`);
  console.log('mission                          variant  wins/defeats/stuck  win min median / slowest  ROE median / lowest  <2 stars  orders carried  units ordered / ever grouped  runs formed  events (contact/sprung/released/call)');
  for (const mission of MISSIONS) {
    if (only !== undefined && mission !== only) continue;
    const by = new Map<Variant, Played[]>(VARIANTS.map((v) => [v, []]));
    for (const seed of seeds) {
      const ledger = ledgerFor(mission, seed);
      for (const v of VARIANTS) (by.get(v) as Played[]).push(play(mission, v, seed, plans, ledger));
    }
    for (const v of VARIANTS) {
      const r = read(by.get(v) as Played[]);
      console.log(
        `${mission.padEnd(33)}${v.padEnd(9)}${`${r.victories}/${r.defeats}/${r.stuck}`.padEnd(20)}${`${fmt(r.medianMinutes)} / ${fmt(r.slowestMinutes)}`.padEnd(26)}${`${fmt(r.medianRoe, 0)} / ${fmt(r.lowestRoe, 0)}`.padEnd(21)}${String(r.underTwoStars).padEnd(10)}` +
          `${String(r.carried).padEnd(16)}${`${r.ordered} / ${r.everGrouped}`.padEnd(30)}${String(r.runsFormed).padEnd(13)}${['formationContact', 'formationSprung', 'formationReleased', 'formationCall'].map((k) => r.events[k] ?? 0).join('/')}`,
      );
      for (const [cause, count] of Object.entries(r.causes)) console.log(`${' '.repeat(42)}lost ${count}: ${cause}`);
    }
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
