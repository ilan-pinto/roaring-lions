/**
 * `art/video/ledger.jsonl` -- one line per SUBMITTED take, appended by
 * `cli.ts` immediately BEFORE the request goes out (so a crash mid-request
 * still leaves the spend on record), then patched with the outcome.
 *
 * `spentUsd` sums `usd_estimated` over EVERY line, whatever its status. Veo
 * bills only a take that succeeds, so a filtered or failed take is counted
 * here and was not charged: the ledger can only over-state the spend, never
 * under-state it, which is the direction a hard cap needs. The Gemini API has
 * no per-request cost endpoint; the bill in Cloud Billing is the truth, and
 * `pnpm video -- ledger` prints the estimate beside a reminder to check it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ModelKey, Resolution } from './pricing';

export type TakeStatus = 'submitted' | 'succeeded' | 'failed';

export interface LedgerEntry {
  readonly at: string; // ISO 8601
  readonly shot: string;
  readonly stage: 'explore' | 'final';
  readonly model: ModelKey;
  readonly model_id: string;
  readonly resolution: Resolution;
  readonly seconds_billed: number;
  readonly usd_estimated: number;
  /** Local id until the API answers, then the operation name / interaction id. */
  readonly id: string;
  readonly status: TakeStatus;
  readonly output?: string;
  readonly error?: string;
}

export const LEDGER_RELATIVE_PATH = path.join('art', 'video', 'ledger.jsonl');

export function readLedger(ledgerPath: string): LedgerEntry[] {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as LedgerEntry);
}

export function appendLedgerEntry(ledgerPath: string, entry: LedgerEntry): void {
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

/** Rewrites the line whose `id` is `id` (atomic rename in the same dir). */
export function patchLedgerEntry(ledgerPath: string, id: string, patch: Partial<LedgerEntry>): void {
  const entries = readLedger(ledgerPath);
  const i = entries.findIndex((e) => e.id === id);
  if (i === -1) throw new Error(`ledger patch: no entry with id "${id}" in ${ledgerPath}`);
  entries[i] = { ...entries[i], ...patch };
  const tmp = path.join(path.dirname(ledgerPath), `.${path.basename(ledgerPath)}.${process.pid}.tmp`);
  writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  renameSync(tmp, ledgerPath);
}

export function spentUsd(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.usd_estimated, 0);
}
