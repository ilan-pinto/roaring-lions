// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { writeBinding, CLAIMING_KEY } from './binding';
import { writeCache } from './cache';
import { selectLedgerStore } from './select-store';
import { cacheOf, world } from './fixtures';
import { LEDGER_KEY } from '../main-keys';

const DEV = '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc';
const MARKER = `{"deviceId":"${DEV}","digests":{"campaign":null,"slots":{}},"at":1}`;
const backfill = (w: Parameters<NonNullable<Parameters<typeof selectLedgerStore>[2]>>[0]) => w;
const q = (s: string) => new URLSearchParams(s);

afterEach(() => window.localStorage.clear());

function deviceWithMarker(): Storage {
  const s = window.localStorage;
  writeBinding(s, { version: 1, publicId: 'pub1', deviceId: DEV });
  s.setItem(CLAIMING_KEY, MARKER);
  return s;
}

describe('M2: the claim marker locks the guest store only where a claim can run', () => {
  it('with a matching marker, ?accounts refuses guest writes (the claim is moving them) and accounts off or ?fresh does not', () => {
    const s = deviceWithMarker();
    const on = selectLedgerStore(q('accounts'), s, backfill, { world });
    expect(() => on.store.writeLedger({ 'campaign.completed_missions': ['a'] })).toThrow();
    for (const query of ['', 'accounts&fresh']) {
      const sel = selectLedgerStore(q(query), s, backfill, { world });
      expect(() => sel.store.writeLedger({ 'campaign.completed_missions': ['a'] }), query).not.toThrow();
      expect(JSON.parse(s.getItem(LEDGER_KEY) ?? '{}')).toEqual({ 'campaign.completed_missions': ['a'] });
      s.removeItem(LEDGER_KEY);
    }
  });

  it('I2 at boot: a claimed device with a cache keeps its guest keys when no ?accounts boot is running', () => {
    const s = window.localStorage;
    writeBinding(s, { version: 1, publicId: 'pub1', claimedAt: 5, deviceId: DEV });
    writeCache(s, cacheOf());
    s.setItem(LEDGER_KEY, '{"campaign.completed_missions":["g"]}');
    selectLedgerStore(q(''), s, backfill, { world });
    selectLedgerStore(q('accounts&fresh'), s, backfill, { world });
    expect(s.getItem(LEDGER_KEY)).not.toBeNull();
    selectLedgerStore(q('accounts'), s, backfill, { world }); // ?accounts with no marker: still not an interrupted claim
    expect(s.getItem(LEDGER_KEY)).not.toBeNull();
    s.setItem(CLAIMING_KEY, MARKER);
    selectLedgerStore(q('accounts'), s, backfill, { world }); // the marker is the evidence
    expect(s.getItem(LEDGER_KEY)).toBeNull();
  });
});
