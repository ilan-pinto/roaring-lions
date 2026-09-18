/**
 * Ledger append/read/sum against a temp `.jsonl` file -- never the real
 * `art/meshy/ledger.jsonl`, and no network.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendLedgerEntry, readLedger, summarizeLedger, type LedgerEntry } from './ledger';

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    at: '2026-09-18T00:00:00.000Z',
    kind: 'text',
    mode: 'preview',
    id: 'task-1',
    name: 'watchtower',
    prompt: 'a desert watchtower',
    credits_estimated: 20,
    usd_estimated: 0.4,
    ...overrides,
  };
}

describe('ledger', () => {
  let dir: string;
  let ledgerPath: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function freshPath(): string {
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-ledger-test-'));
    ledgerPath = path.join(dir, 'nested', 'ledger.jsonl');
    return ledgerPath;
  }

  it('reads an empty summary when the file does not exist yet', () => {
    const p = freshPath();
    expect(readLedger(p)).toEqual([]);
    expect(summarizeLedger(readLedger(p))).toEqual({ count: 0, creditsEstimated: 0, creditsConsumed: 0, usdEstimated: 0 });
  });

  it('appends one JSON line per entry and creates parent directories', () => {
    const p = freshPath();
    appendLedgerEntry(p, entry());
    const raw = readFileSync(p, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(raw.trim())).toEqual(entry());
  });

  it('round-trips multiple entries in append order', () => {
    const p = freshPath();
    appendLedgerEntry(p, entry({ id: 'task-1' }));
    appendLedgerEntry(p, entry({ id: 'task-2', kind: 'image', mode: 'image' }));
    const read = readLedger(p);
    expect(read.map((e) => e.id)).toEqual(['task-1', 'task-2']);
  });

  it('sums estimated and consumed credits and USD across entries', () => {
    const p = freshPath();
    appendLedgerEntry(p, entry({ id: 'a', credits_estimated: 20, credits_consumed: 20, usd_estimated: 0.4 }));
    appendLedgerEntry(p, entry({ id: 'b', credits_estimated: 30, usd_estimated: 0.6 })); // consumed not yet known
    appendLedgerEntry(p, entry({ id: 'c', credits_estimated: 10, credits_consumed: 15, usd_estimated: 0.2 }));
    const summary = summarizeLedger(readLedger(p));
    expect(summary.count).toBe(3);
    expect(summary.creditsEstimated).toBe(60);
    expect(summary.creditsConsumed).toBe(35);
    expect(summary.usdEstimated).toBeCloseTo(1.2, 10);
  });

  it('skips blank lines when reading', () => {
    const p = freshPath();
    appendLedgerEntry(p, entry({ id: 'a' }));
    // Simulate a stray blank line (e.g. from a manual edit) by appending
    // directly rather than through appendLedgerEntry.
    appendFileSync(p, '\n');
    appendLedgerEntry(p, entry({ id: 'b' }));
    expect(readLedger(p).map((e) => e.id)).toEqual(['a', 'b']);
  });
});
