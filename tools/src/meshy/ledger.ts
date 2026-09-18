/**
 * `art/meshy/ledger.jsonl` — one line per SPEND (a submitted preview, refine
 * or image task), appended by `cli.ts` right after a successful submit. This
 * is the project's answer to "how much have we spent": `pnpm meshy -- spent`
 * sums it, and nothing else in the tool reads or writes it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

/**
 * Patches the ledger line for `id`, setting `credits_consumed` to what
 * Meshy actually reported once the task reached SUCCEEDED. Called by
 * `cli.ts` right after `pollTask` returns a terminal SUCCEEDED status --
 * deliberately never before, and deliberately never touching
 * `appendLedgerEntry`'s own pre-poll write, so a crash mid-poll leaves the
 * estimate-only line exactly as `appendLedgerEntry` wrote it.
 *
 * Rewrites the whole file: read every line, replace the one entry whose
 * `id` matches, serialize the full set back out to a temp file in the SAME
 * directory (so the following rename is same-filesystem and therefore
 * atomic), then rename over the original. `readLedger`/`appendLedgerEntry`
 * are line-oriented and don't support an in-place edit, and this is a rare
 * enough call (once per finished task) that a full rewrite costs nothing.
 *
 * Throws if no line carries `id` -- appending a new line here would be
 * wrong (the entry should already exist from the pre-poll append) and
 * silently doing nothing would leave `spent` wrong with no sign why.
 */
export function patchLedgerCreditsConsumed(ledgerPath: string, id: string, creditsConsumed: number): void {
  const entries = readLedger(ledgerPath);
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) {
    throw new Error(`ledger patch: no entry with id "${id}" found in ${ledgerPath}`);
  }
  const patched = entries.slice();
  patched[index] = { ...patched[index], credits_consumed: creditsConsumed };

  const dir = path.dirname(ledgerPath);
  const tmpPath = path.join(dir, `.${path.basename(ledgerPath)}.${process.pid}-${Date.now()}.tmp`);
  const text = patched.map((entry) => JSON.stringify(entry)).join('\n') + (patched.length > 0 ? '\n' : '');
  writeFileSync(tmpPath, text, 'utf8');
  renameSync(tmpPath, ledgerPath);
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
