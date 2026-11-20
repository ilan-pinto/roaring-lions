// GH-1387 S0, the pure half of the spend probe: REPORT-ONLY. What a plan did with its purse, and what it did with every spend
// refused, as one table. `spend-probe.ts` is the preload that refuses the spends; this file reads the runs it leaves behind and
// has no side effect, so its arithmetic is held by `spend-table.test.ts` against numbers written out by hand.
//
// The design (`docs/superpowers/specs/2026-11-16-purse-binding-design.md`, sections 2, 9 and 10) found that the purse binds on none of
// the 20 economy missions: with every build and support spend refused, all 20 winning plans still win. S0 makes that measurement
// repeatable; `SPEND_BOUND` (empty until slice S1) is the set of missions that must LOSE under refusal.
import { availableOf, bankedOver, bankedPercent, spentOf, type Banking } from './banking';

/** One winning plan's run, as the playtest harness records it (`runLog`) plus the spend calls the probe refused during it. */
export interface SpendRun {
  id: string;
  result: 'ongoing' | 'victory' | 'defeat';
  minutes: number;
  stars: number;
  roe: number;
  banking: Banking;
  /** `requestBuild` and `requestSupport` calls refused during this run. Always 0 with the refusal off. */
  refused: number;
}

export interface SpendRow {
  id: string;
  /** `logistics_start` + earned: everything the plan had to spend (P in the design). */
  purse: number;
  spent: number;
  /** Whole-number percent held at the end, or null when there was nothing to bank. */
  bankPct: number | null;
  /** Banked more than 30% of the purse, the gate `BANKING_OVER_30_MAX` counts. */
  over30: boolean;
  result: SpendRun['result'];
  minutes: number;
  stars: number;
  refused: number;
}

export function spendRows(runs: readonly SpendRun[]): SpendRow[] {
  return runs.map((r) => {
    const purse = availableOf(r.banking);
    return {
      id: r.id,
      purse,
      spent: spentOf(r.banking),
      bankPct: purse === 0 ? null : Math.round((100 * r.banking.held) / purse),
      over30: bankedOver(r.banking, 30),
      result: r.result,
      minutes: r.minutes,
      stars: r.stars,
      refused: r.refused,
    };
  });
}

/** The missions whose plan must LOSE (or fail to win) with every spend refused: the ones the purse binds. EMPTY until S1 binds the
 *  first four (design section 10). A mission goes in here in the slice that makes the purse bind it, never before. */
export const SPEND_BOUND: ReadonlySet<string> = new Set<string>();

/** The sentence for each reason the refusal run cannot be trusted or a bound mission still wins, or [] when it holds. */
export function spendProbeFailures(rows: readonly SpendRow[], refusalOn: boolean, bound: ReadonlySet<string> = SPEND_BOUND): string[] {
  const out: string[] = [];
  if (rows.length === 0) out.push('no winning plan was recorded, so the table reads nothing');
  if (refusalOn) {
    // C11: a control that proves the probe refuses. A refusal that refused nothing leaves every plan winning for the wrong reason.
    const spenders = rows.filter((r) => r.refused > 0).length;
    if (rows.length > 0 && spenders === 0) out.push('the refusal was on and refused 0 spend calls in every run: the table is the ordinary playtest, not a no-spend one');
    for (const id of bound) {
      const r = rows.find((x) => x.id === id);
      if (r === undefined) out.push(`${id} is bound but no run of it was recorded`);
      else if (r.result === 'victory') out.push(`${id} is bound (the purse must matter) but its plan still won with every spend refused`);
    }
  }
  return out;
}

const pad = (s: string, n: number): string => s.padEnd(n);
/** The report: one line per run, then the counts the design's section 2 states. */
export function spendReport(rows: readonly SpendRow[], refusalOn: boolean): string[] {
  const lines = [`spend probe (${refusalOn ? 'every build and support spend REFUSED' : 'as played, nothing refused'}): ${rows.length} winning-plan runs`];
  const w = Math.max(0, ...rows.map((r) => r.id.length));
  for (const r of rows) {
    lines.push(
      `${pad(r.id, w)}  purse ${String(r.purse).padStart(5)}  spent ${String(r.spent).padStart(5)}  bank ${r.bankPct === null ? '-' : `${r.bankPct}%`}  ` +
        `${r.result} in ${r.minutes.toFixed(1)} min, stars ${r.stars}  refused ${r.refused}`
    );
  }
  const won = rows.filter((r) => r.result === 'victory').length;
  lines.push(
    `spend probe: ${rows.filter((r) => r.over30).length} of ${rows.length} bank over 30%, ${rows.filter((r) => r.spent === 0).length} spend nothing, ` +
      `${won} of ${rows.length} win${refusalOn ? ' with every spend refused' : ''}`
  );
  return lines;
}

export { bankedPercent };

const SPEND_METHODS = ['requestBuild', 'requestSupport'] as const;

/** Replaces each spend method on `proto` with one that refuses and counts, and returns the count's reader. It lives here, not in the
 *  preload, so a test can install it on a stand-in object: the preload patches the real `MissionRuntime` the moment it is imported. */
export function installRefusal(proto: object, onRefuse: (rt: object, method: string) => void): () => number {
  let refused = 0;
  const p = proto as Record<string, unknown>;
  for (const name of SPEND_METHODS) {
    if (typeof p[name] !== 'function') throw new Error(`spend-probe: the runtime has no ${name} to refuse`);
    p[name] = function (this: object): boolean {
      refused++;
      onRefuse(this, name);
      return false;
    };
  }
  return () => refused;
}
