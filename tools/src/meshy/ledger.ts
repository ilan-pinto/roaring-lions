/**
 * `art/meshy/ledger.jsonl` — one line per SPEND (a submitted preview, refine
 * or image task), appended by `cli.ts` right after a successful submit. This
 * is the project's answer to "how much have we spent": `pnpm meshy -- spent`
 * sums it, and nothing else in the tool reads or writes it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { TaskKind } from './options';

export interface LedgerEntry {
  readonly at: string; // ISO 8601
  readonly kind: TaskKind;
  readonly mode: 'preview' | 'refine' | 'image';
  readonly id: string;
  readonly name?: string;
  readonly prompt?: string;
  readonly credits_estimated: number;
  readonly credits_consumed?: number;
  readonly usd_estimated: number;
}

export const LEDGER_RELATIVE_PATH = path.join('art', 'meshy', 'ledger.jsonl');

export function appendLedgerEntry(ledgerPath: string, entry: LedgerEntry): void {
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

/** Missing file reads as no spends yet, not an error -- true the first time
 *  anyone runs the CLI in a fresh clone. */
export function readLedger(ledgerPath: string): LedgerEntry[] {
  if (!existsSync(ledgerPath)) return [];
  const text = readFileSync(ledgerPath, 'utf8');
  const out: LedgerEntry[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    out.push(JSON.parse(line) as LedgerEntry);
  }
  return out;
}

export interface LedgerSummary {
  readonly count: number;
  readonly creditsEstimated: number;
  readonly creditsConsumed: number;
  readonly usdEstimated: number;
}

export function summarizeLedger(entries: readonly LedgerEntry[]): LedgerSummary {
  let creditsEstimated = 0;
  let creditsConsumed = 0;
  let usdEstimated = 0;
  for (const entry of entries) {
    creditsEstimated += entry.credits_estimated;
    creditsConsumed += entry.credits_consumed ?? 0;
    usdEstimated += entry.usd_estimated;
  }
  return { count: entries.length, creditsEstimated, creditsConsumed, usdEstimated };
}
