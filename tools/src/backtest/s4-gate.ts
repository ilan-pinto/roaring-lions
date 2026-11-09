// The paired S4 gate (GH-859 P1b, Task 7): does a formation move a versus cell's win share by more than the
// lead allows? `pnpm s4:gate`. The lead's ruling (Q1, confirmed), made exact.
//
// It reads two sets of per-seed files written by `pnpm versus:probe -- --per-seed=<file>`: the BASE (no
// formation) and the ARM (the same cells, the same seeds, a formation), and judges each cell on the paired
// games. It plays nothing itself.
//
//   pnpm s4:gate -- --end=both --base-a=base-a.json --arm-a=arm-a.json [--base-b=base-b.json --arm-b=arm-b.json]
//   --end=<both|friendly|hostile>   which ends carry the formation in the arm files: (b) both ends in Attack,
//                                   (c) one end only. The arm files must say the same (see the guard).
//   --base-a / --arm-a   set A (seeds 0..191 by convention); each takes a comma list of files, merged.
//   --base-b / --arm-b   set B (192..383), the games a RERUN asks for; only the cells that were RERUN need be in it.
//
// A share is wins over ALL the seeds, as the probe defines it (a draw is no one's). Integer arithmetic only.
//
// (b), per cell. S is the arm's leading-end share (the end with more wins in the arm), B the same end's base
// share on the same seeds.
//   S <= 55                  PASS
//   55 < S <= 65 at set A    RERUN: play set B and judge the pooled seeds; pooled S <= 60 PASS, above it the
//                            baseline clause. (With no set B given for the cell: RERUN, still unplayed.)
//   S > 65 at set A          the baseline clause
// (c), per cell and formed end (--end=friendly|hostile). S is the FORMED end's share, B the same end's base share.
//   S <= 60                  PASS
//   60 < S <= 70 at set A    RERUN, judged pooled against 65
//   S > 70 at set A          the baseline clause against 65
// The baseline clause (bar 60 for (b), 65 for (c)): TRIP, unless B is itself above the bar for that end and the
// paired sign test does not show a shift toward that end (two-sided p >= 0.05, or more flips away than toward).
// That cell was outside before any formation, and the formation did not make it worse: PASS (baseline outside,
// not worse).
//
// The sign test. Over the discordant seeds, a toward (the end wins in the arm and not in the base) and b away
// (the reverse): exact two-sided binomial, p = min(1, 2 * sum_{k <= min(a,b)} C(a+b, k) / 2^(a+b)).
//
// Exit codes: 0 every cell passes; 1 any TRIP; 3 a RERUN is still unplayed (and no TRIP); 2 the gate refused
// (the pairing guard: a file that is not valid, an arm's formation not the one named, seed lists that differ
// between an arm and its base, cell lists that differ, a different seat table or cap, set B seeds that overlap
// set A's, no cells at all).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePerSeed, type PerSeedCell, type PerSeedFile, type PerSeedRow } from './per-seed';

export type EndsCarrying = 'both' | 'friendly' | 'hostile';
export type Verdict = 'PASS' | 'RERUN' | 'TRIP' | 'PASS (baseline outside, not worse)';

/** The bars of one reading, in percent. */
export interface Bars {
  /** At or below this at set A: PASS. */
  pass: number;
  /** At or below this at set A (and above `pass`): RERUN. Above it: the baseline clause. */
  rerun: number;
  /** The pooled seeds are judged against this. */
  pooled: number;
  /** The baseline clause: B must itself be above this. */
  baseline: number;
}
export const BARS_B: Bars = { pass: 55, rerun: 65, pooled: 60, baseline: 60 };
export const BARS_C: Bars = { pass: 60, rerun: 70, pooled: 65, baseline: 65 };

/** The one formation the S4 gate judges. */
export const S4_FORMATION = 'attack';

/** The sign test's significance level. */
export const SIGN_ALPHA_PERCENT = 5;

/** Exact two-sided binomial sign test over `toward` and `away` discordant seeds; 1 when there are none. */
export function signTestP(toward: number, away: number): number {
  const n = toward + away;
  const m = Math.min(toward, away);
  // sum_{k <= m} C(n, k), exactly.
  let sum = 0n;
  let c = 1n;
  for (let k = 0; k <= m; k++) {
    sum += c;
    c = (c * BigInt(n - k)) / BigInt(k + 1);
  }
  const SCALE = 10n ** 12n;
  const scaled = (2n * sum * SCALE) / (1n << BigInt(n));
  return scaled >= SCALE ? 1 : Number(scaled) / 1e12;
}

/** Whether p < 0.05, in exact integers (2 * sum * 100 < 2^n * 5): the clause must not hang on a float. */
function significant(toward: number, away: number): boolean {
  const n = toward + away;
  const m = Math.min(toward, away);
  let sum = 0n;
  let c = 1n;
  for (let k = 0; k <= m; k++) {
    sum += c;
    c = (c * BigInt(n - k)) / BigInt(k + 1);
  }
  return 2n * sum * 100n < (1n << BigInt(n)) * BigInt(SIGN_ALPHA_PERCENT);
}

/** What one end did over a set of paired games. */
export interface EndCounts {
  seeds: number;
  base: number;
  arm: number;
  toward: number;
  away: number;
}

/** The paired reading of `end` over base and arm rows of the same seeds, in the same order. */
export function countsOf(base: readonly PerSeedRow[], arm: readonly PerSeedRow[], end: 0 | 1): EndCounts {
  const c: EndCounts = { seeds: arm.length, base: 0, arm: 0, toward: 0, away: 0 };
  arm.forEach((a, i) => {
    const b = base[i];
    const aw = a.winner === end;
    const bw = b.winner === end;
    if (aw) c.arm++;
    if (bw) c.base++;
    if (aw && !bw) c.toward++;
    if (bw && !aw) c.away++;
  });
  return c;
}

const winsOf = (rows: readonly PerSeedRow[], end: 0 | 1): number => rows.filter((r) => r.winner === end).length;

/** One cell's two sets of paired games (set B absent until it is played). */
export interface CellGames {
  key: string;
  arr: string;
  baseA: readonly PerSeedRow[];
  armA: readonly PerSeedRow[];
  baseB?: readonly PerSeedRow[];
  armB?: readonly PerSeedRow[];
}

export interface CellReport {
  key: string;
  arr: string;
  /** `A` or `A+B`. */
  set: 'A' | 'A+B';
  /** The n ranges judged, for the line. */
  range: string;
  end: 0 | 1;
  counts: EndCounts;
  p: number;
  verdict: Verdict;
}

/** The baseline clause: the cell was outside before any formation and did not get worse. */
function baselineClause(c: EndCounts, bar: number): Verdict {
  const outside = c.base * 100 > bar * c.seeds;
  const notWorse = !significant(c.toward, c.away) || c.away > c.toward;
  return outside && notWorse ? 'PASS (baseline outside, not worse)' : 'TRIP';
}

const rangeOf = (rows: readonly PerSeedRow[]): string => `${rows[0].n}..${rows[rows.length - 1].n}`;

/** The end a reading is about: the formed end for (c), else the end with more wins in the arm (end 0 on a tie). */
function endOf(kind: EndsCarrying, armRows: readonly PerSeedRow[]): 0 | 1 {
  if (kind === 'friendly') return 0;
  if (kind === 'hostile') return 1;
  return winsOf(armRows, 1) > winsOf(armRows, 0) ? 1 : 0;
}

/** Judges one cell. */
export function judgeCell(kind: EndsCarrying, g: CellGames): CellReport {
  const bars = kind === 'both' ? BARS_B : BARS_C;
  const finish = (set: 'A' | 'A+B', range: string, end: 0 | 1, counts: EndCounts, verdict: Verdict): CellReport =>
    ({ key: g.key, arr: g.arr, set, range, end, counts, p: signTestP(counts.toward, counts.away), verdict });

  const endA = endOf(kind, g.armA);
  const a = countsOf(g.baseA, g.armA, endA);
  const rangeA = rangeOf(g.armA);
  if (a.arm * 100 <= bars.pass * a.seeds) return finish('A', rangeA, endA, a, 'PASS');
  if (a.arm * 100 > bars.rerun * a.seeds) return finish('A', rangeA, endA, a, baselineClause(a, bars.baseline));
  // The RERUN band. Without set B the cell is still owed its second set.
  if (g.baseB === undefined || g.armB === undefined) return finish('A', rangeA, endA, a, 'RERUN');
  const armAll = [...g.armA, ...g.armB];
  const baseAll = [...g.baseA, ...g.baseB];
  const end = endOf(kind, armAll);
  const pooled = countsOf(baseAll, armAll, end);
  const range = `${rangeA}+${rangeOf(g.armB)}`;
  if (pooled.arm * 100 <= bars.pooled * pooled.seeds) return finish('A+B', range, end, pooled, 'PASS');
  return finish('A+B', range, end, pooled, baselineClause(pooled, bars.baseline));
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

/** The files of one side of one set, merged: a cell per key. Faults are sentences. */
function merge(files: readonly { name: string; file: PerSeedFile }[], faults: string[]): Map<string, PerSeedCell> {
  const out = new Map<string, PerSeedCell>();
  for (const { name, file } of files) {
    for (const c of file.cells) {
      if (out.has(c.key)) faults.push(`${name}: cell "${c.key}" appears twice in the files of one side`);
      out.set(c.key, c);
    }
  }
  return out;
}

export interface GateInput {
  kind: EndsCarrying;
  baseA: { name: string; file: PerSeedFile }[];
  armA: { name: string; file: PerSeedFile }[];
  baseB?: { name: string; file: PerSeedFile }[];
  armB?: { name: string; file: PerSeedFile }[];
}

const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const endsOfKind = (k: EndsCarrying): [boolean, boolean] => [k !== 'hostile', k !== 'friendly'];

/** The pairing guard: every reason this is not a pairing. Empty means the games can be compared seed for seed. */
export function pairingFaults(inp: GateInput): string[] {
  const faults: string[] = [];
  const sets: { label: string; base: GateInput['baseA']; arm: GateInput['armA'] }[] = [{ label: 'set A', base: inp.baseA, arm: inp.armA }];
  if ((inp.baseB === undefined) !== (inp.armB === undefined)) faults.push('set B needs both --base-b and --arm-b');
  if (inp.baseB !== undefined && inp.armB !== undefined) sets.push({ label: 'set B', base: inp.baseB, arm: inp.armB });
  // The S4 formation is Attack, in every arm file of both sets: any other id (which also covers two files
  // recorded under different ones) is not the pairing.
  const armIds = new Set(sets.flatMap((s) => s.arm.flatMap((x) => (x.file.formation === null ? [] : [x.file.formation.id]))));
  if ([...armIds].some((id) => id !== S4_FORMATION)) {
    faults.push(`the arm files were played under formation ${[...armIds].sort().join(', ')}; S4 judges ${S4_FORMATION} alone, the same in every arm file`);
  }
  const mergedBase: Map<string, PerSeedCell>[] = [];
  for (const s of sets) {
    const want = endsOfKind(inp.kind);
    for (const { name, file } of s.arm) {
      if (file.formation === null || file.formation.ends[0] !== want[0] || file.formation.ends[1] !== want[1]) {
        faults.push(`${s.label}: ${name} was played with ${file.formation === null ? 'no formation' : `formation ${file.formation.id} on ends ${JSON.stringify(file.formation.ends)}`}, not on ends ${JSON.stringify(want)} (--end=${inp.kind})`);
      }
    }
    // One end formed (c): the loose end orders its aircraft apart since Q2 (GH-859 P1c). A file without the mark was
    // played with them inside the one combined order, which is not this comparator.
    if (inp.kind !== 'both') {
      for (const { name, file } of s.arm) {
        if (file.formation !== null && file.formation.looseAir !== 'separate') faults.push(`${s.label}: ${name} is a one-end arm played before the loose end ordered its aircraft separately (Q2); replay it with the current probe`);
      }
    }
    for (const { name, file } of s.base) if (file.formation !== null) faults.push(`${s.label}: base file ${name} was played under formation ${file.formation.id}: a base is the game with none`);
    const both = [...s.base, ...s.arm];
    if (both.length === 0 || s.base.length === 0 || s.arm.length === 0) faults.push(`${s.label}: needs at least one base file and one arm file`);
    for (const x of both) {
      if (x.file.rules !== both[0].file.rules) faults.push(`${s.label}: ${x.name} is on the ${x.file.rules} seat table, ${both[0].name} on the ${both[0].file.rules}`);
      if (x.file.capSeconds !== both[0].file.capSeconds) faults.push(`${s.label}: ${x.name} has a ${x.file.capSeconds} s cap, ${both[0].name} a ${both[0].file.capSeconds} s`);
    }
    const b = merge(s.base, faults);
    const a = merge(s.arm, faults);
    mergedBase.push(b);
    const bk = [...b.keys()].sort();
    const ak = [...a.keys()].sort();
    if (bk.length === 0) faults.push(`${s.label}: no cells at all`);
    if (bk.join('\n') !== ak.join('\n')) {
      faults.push(`${s.label}: the base file's cell list differs from the arm's (base only: ${bk.filter((k) => !a.has(k)).join('; ') || 'none'}; arm only: ${ak.filter((k) => !b.has(k)).join('; ') || 'none'})`);
    }
    for (const [key, ac] of a) {
      const bc = b.get(key);
      if (bc === undefined) continue;
      if (ac.rows.length === 0) faults.push(`${s.label}: cell "${key}" has no games`);
      if (!same(ac.rows.map((r) => r.seed), bc.rows.map((r) => r.seed))) {
        faults.push(`${s.label}: cell "${key}": the arm's seed list differs from its base's (arm ${ac.rows.length} seeds from ${ac.rows[0]?.seed ?? '-'}, base ${bc.rows.length} seeds from ${bc.rows[0]?.seed ?? '-'})`);
      }
      if (ac.arr !== bc.arr) faults.push(`${s.label}: cell "${key}": the arm is ${ac.arr}, the base ${bc.arr}`);
    }
  }
  if (sets.length === 2) {
    const [a, b] = [merge(sets[0].arm, []), merge(sets[1].arm, [])];
    for (const [key, bc] of b) {
      const ac = a.get(key);
      if (ac === undefined) { faults.push(`set B has cell "${key}", which set A does not`); continue; }
      const seedsA = new Set(ac.rows.map((r) => r.seed));
      const clash = bc.rows.filter((r) => seedsA.has(r.seed)).length;
      if (clash > 0) faults.push(`cell "${key}": ${clash} seeds are in both sets: pooling would count a game twice`);
    }
  }
  return faults;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

const pct = (w: number, n: number): string => (n === 0 ? '-' : `${(Math.round((1000 * w) / n) / 10).toFixed(1)}`);

export interface GateResult {
  code: 0 | 1 | 2 | 3;
  reports: CellReport[];
  lines: string[];
  faults: string[];
}

export function gate(inp: GateInput): GateResult {
  const faults = pairingFaults(inp);
  if (faults.length > 0) return { code: 2, reports: [], lines: [], faults };
  const lookup = (files: GateInput['baseA'] | undefined): Map<string, PerSeedCell> => merge(files ?? [], []);
  const baseA = lookup(inp.baseA);
  const armA = lookup(inp.armA);
  const baseB = inp.baseB === undefined ? undefined : lookup(inp.baseB);
  const armB = inp.armB === undefined ? undefined : lookup(inp.armB);
  const reports: CellReport[] = [];
  for (const [key, ac] of armA) {
    const bB = baseB?.get(key);
    const aB = armB?.get(key);
    reports.push(judgeCell(inp.kind, {
      key, arr: ac.arr, baseA: (baseA.get(key) as PerSeedCell).rows, armA: ac.rows,
      ...(bB !== undefined && aB !== undefined ? { baseB: bB.rows, armB: aB.rows } : {}),
    }));
  }
  const pad = (s: string | number, n: number): string => String(s).padEnd(n);
  const lines: string[] = [];
  const bars = inp.kind === 'both' ? BARS_B : BARS_C;
  lines.push(`S4 gate (${inp.kind === 'both' ? 'b: both ends in the formation' : `c: the ${inp.kind} end in the formation`}): PASS at or below ${bars.pass}%, RERUN to ${bars.rerun}% (pooled bar ${bars.pooled}%), baseline clause above ${bars.rerun}% (the base must itself be above ${bars.baseline}%)`);
  lines.push(`${pad('cell', 46)}${pad('set', 5)}${pad('seeds', 20)}${pad('end', 9)}${pad('B%', 7)}${pad('S%', 7)}${pad('delta', 8)}${pad('flips +/-', 11)}${pad('p', 8)}verdict`);
  for (const r of reports) {
    const c = r.counts;
    const delta = Math.round((1000 * (c.arm - c.base)) / c.seeds) / 10;
    lines.push(
      `${pad(r.key, 46)}${pad(r.set, 5)}${pad(`${c.seeds} (n ${r.range})`, 20)}${pad(r.end === 0 ? 'friendly' : 'hostile', 9)}${pad(pct(c.base, c.seeds), 7)}${pad(pct(c.arm, c.seeds), 7)}` +
        `${pad(`${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`, 8)}${pad(`${c.toward}/${c.away}`, 11)}${pad(`${r.p.toFixed(4)}`, 8)}${r.verdict}`,
    );
  }
  const n = (v: Verdict): number => reports.filter((r) => r.verdict === v).length;
  const trips = n('TRIP');
  const reruns = n('RERUN');
  const code = trips > 0 ? 1 : reruns > 0 ? 3 : 0;
  lines.push(`S4 gate: ${reports.length} cells: ${n('PASS')} PASS, ${n('PASS (baseline outside, not worse)')} PASS (baseline outside, not worse), ${reruns} RERUN, ${trips} TRIP -> exit ${code}`);
  return { code, reports, lines, faults: [] };
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

const flag = (args: readonly string[], name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function load(names: string | undefined, faults: string[]): { name: string; file: PerSeedFile }[] | undefined {
  if (names === undefined) return undefined;
  return names.split(',').map((name) => {
    try {
      const { file, faults: f } = parsePerSeed(JSON.parse(readFileSync(name, 'utf8')) as unknown, name);
      faults.push(...f);
      return { name, file };
    } catch (e) {
      faults.push(`${name}: cannot be read as JSON (${e instanceof Error ? e.message : String(e)})`);
      return { name, file: parsePerSeed(null, name).file };
    }
  });
}

/** Prints the table and returns the exit code (0, 1, 2 or 3; see the header). */
export function main(args: readonly string[] = process.argv.slice(2)): number {
  const refuse = (faults: readonly string[]): number => {
    console.error('S4 GATE REFUSED -- the files are not a pairing, so no verdict is printed:');
    for (const f of faults) console.error(`  ${f}`);
    return 2;
  };
  const kind = flag(args, 'end');
  if (kind !== 'both' && kind !== 'friendly' && kind !== 'hostile') return refuse(['--end=<both|friendly|hostile> is required']);
  const faults: string[] = [];
  const baseA = load(flag(args, 'base-a'), faults);
  const armA = load(flag(args, 'arm-a'), faults);
  const baseB = load(flag(args, 'base-b'), faults);
  const armB = load(flag(args, 'arm-b'), faults);
  if (baseA === undefined || armA === undefined) return refuse([...faults, '--base-a and --arm-a are required']);
  if (faults.length > 0) return refuse(faults);
  const r = gate({ kind, baseA, armA, ...(baseB !== undefined ? { baseB } : {}), ...(armB !== undefined ? { armB } : {}) });
  if (r.code === 2) return refuse(r.faults);
  for (const l of r.lines) console.log(l);
  return r.code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
