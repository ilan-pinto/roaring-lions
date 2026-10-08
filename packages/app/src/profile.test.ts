import { describe, expect, it } from 'vitest';
import { ACCOUNT_KEY, emptyAccount } from './brigade-account';
import { LEDGER_KEY, TUTORIAL_DONE_KEY } from './main-keys';
import { memoryLedgerStore } from './ledger-store';
import { DAMAGED_BLOB_ID, SAVES_KEY, SAVE_ERROR_NOT_A_SAVE, damagedRaw, deleteSlot, exportSlot, importSlot, listDamaged, listSlots, loadSlot, readActive, saveSlot, writeActive } from './profile';

// The `Map`-backed `StorageLike` fake this file used to carry is now
// `memoryLedgerStore()` (`ledger-store.ts`), which runs the SAME
// implementation the browser path does over a Map instead of `localStorage` --
// so these specs are about the shipping door, not about a second one written
// for tests. `.map` is that Map, exposed as test-only surface, and it is what
// the assertions below read the raw bytes out of.
const memStore = memoryLedgerStore;
const ledger = { 'campaign.completed_missions': ['beit_sahwan_1_recon'], 'roe.mission_ratings': { beit_sahwan_1_recon: 88 } };
// `grants` carries the balance, not just `balance`/`earned_total` themselves --
// `migrateAccount` (brigade-account.ts) bounds a balance the grants log cannot
// account for down to what it can (its own "tidiness check against a lazy
// hand-edit"), and `readAll`/`readActive` both run every account through it.
// A fixture with a bare balance and an empty `grants` array is exactly the
// hand-edit that check exists to catch, so it would not survive its OWN
// round trip -- the grant entry here is what makes 120 the account's true,
// stable balance rather than a number the very first read clips to zero.
const account = { ...emptyAccount(), balance: 120, earned_total: 120, grants: [{ source: 'granted' as const, amount: 120, at: 1 }] };

describe('profile slots', () => {
  it('a slot round-trips the ledger and the account byte for byte', () => {
    const s = memStore();
    writeActive(s, { ledger, account, tutorialDone: true });
    // Independent of the call above: `before` is what a correct `writeActive`
    // MUST have written, computed straight from the fixtures, not read back
    // through the store afterwards. Reading it back instead (`s.map.get(...)`)
    // was tried first and could not fail -- a `writeActive` with its
    // `saveAccount` call deleted still leaves `ACCOUNT_KEY` unset on both the
    // seed write above and the restore write below, so `before.account` and
    // the final `s.map.get(ACCOUNT_KEY)` were both `undefined` and the
    // comparison held by accident (CLAUDE.md's "independent oracle" trap).
    const before = { ledger: JSON.stringify(ledger), account: JSON.stringify(account) };
    saveSlot(s, 'a', 'First push', readActive(s), '0.68.0', 1_700_000_000_000);
    s.map.delete(LEDGER_KEY);
    s.map.delete(ACCOUNT_KEY);
    s.map.delete(TUTORIAL_DONE_KEY);
    const slot = loadSlot(s, 'a');
    if (!slot) throw new Error('slot missing');
    writeActive(s, slot);
    expect(s.map.get(LEDGER_KEY)).toBe(before.ledger);
    expect(s.map.get(ACCOUNT_KEY)).toBe(before.account);
    expect(s.map.get(TUTORIAL_DONE_KEY)).toBe('1');
  });
  it('lists slots newest first with the numbers the screen shows', () => {
    const s = memStore();
    saveSlot(s, 'a', 'Old', { ledger, account, tutorialDone: true }, '0.68.0', 1);
    saveSlot(s, 'b', 'New', { ledger: {}, account: emptyAccount(), tutorialDone: false }, '0.68.0', 2);
    expect(listSlots(s).map((m) => [m.id, m.missions, m.credits])).toEqual([['b', 0, 0], ['a', 1, 120]]);
  });
  it('export and import are inverse, and import refuses a stranger', () => {
    const s = memStore();
    const slot = saveSlot(s, 'a', 'X', { ledger, account, tutorialDone: false }, '0.68.0', 5);
    expect(importSlot(exportSlot(slot))).toEqual(slot);
    // I8: the thrown value is a catalogue KEY, not a sentence -- `ui/saves.ts`
    // resolves it through `t()`. Asserted against the exported constant AND
    // against its literal spelling, because the constant alone would go on
    // passing if the key were renamed out from under `en.json`.
    expect(() => importSlot('{"hello":1}')).toThrow(SAVE_ERROR_NOT_A_SAVE);
    expect(() => importSlot('nope')).toThrow(SAVE_ERROR_NOT_A_SAVE);
    expect(SAVE_ERROR_NOT_A_SAVE).toBe('saves.error.notASave');
  });
  it('import migrates an old account shape through migrateAccount and drops unknown ledger keys never', () => {
    const raw = JSON.stringify({ version: 1, id: 'z', name: 'Z', savedAt: 1, build: '0.60.0', ledger: { 'campaign.completed_missions': [], 'future.key': 1 }, account: { version: 1, balance: 3 }, tutorialDone: false });
    const slot = importSlot(raw);
    // Version 2 since GH-330: a version-1 account migrates on import.
    expect(slot.account.version).toBe(2);
    expect(slot.account.paid).toEqual({});
    expect(slot.account.campaign_paid).toEqual({});
    expect(slot.ledger['future.key']).toBe(1);
  });
  // GH-330 D4: a version-1 slot's per-campaign record is derived against the
  // SLOT'S OWN ledger -- the campaign it was saved in -- not the active one.
  it('import derives a version-1 slot\'s per-campaign record from the slot\'s own ledger', () => {
    const raw = JSON.stringify({
      version: 1, id: 'z', name: 'Z', savedAt: 1, build: '0.60.0',
      ledger: { 'campaign.completed_missions': ['khan_rafid_1_recon'] },
      account: { version: 1, balance: 0, paid: { khan_rafid_1_recon: 310, beit_sahwan_breach: 160 } },
      tutorialDone: false,
    });
    expect(importSlot(raw).account.campaign_paid).toEqual({ khan_rafid_1_recon: 310 });
  });
  it('a corrupt slot store reads as empty, and a delete of a missing id is a no-op', () => {
    const s = memStore();
    s.map.set(SAVES_KEY, '{');
    expect(listSlots(s)).toEqual([]);
    expect(() => deleteSlot(s, 'nope')).not.toThrow();
  });

  // K-12: a damaged slot used to be deleted for good by the next save or delete,
  // because both rewrote only the slots that parsed.
  it('a corrupt slot survives a new save, verbatim, and the good slots stay', () => {
    const s = memStore();
    saveSlot(s, 'good', 'Good', { ledger, account, tutorialDone: true }, '0.68.0', 1);
    const blob = JSON.parse(s.map.get(SAVES_KEY) ?? '{}') as Record<string, unknown>;
    const broken = { version: 1, id: 'bad', name: 'Broken', ledger: 'not a ledger', extra: [1, 2, 3] };
    blob.bad = broken;
    s.map.set(SAVES_KEY, JSON.stringify(blob));
    expect(listDamaged(s).map((d) => d.id)).toEqual(['bad']);
    saveSlot(s, 'new', 'New', { ledger, account, tutorialDone: false }, '0.68.0', 2);
    expect(JSON.parse(damagedRaw(s, 'bad') ?? 'null')).toEqual(broken);
    expect(listSlots(s).map((m) => m.id)).toEqual(['new', 'good']);
    // and a delete of a neighbour keeps it too
    deleteSlot(s, 'good');
    expect(listDamaged(s).map((d) => d.id)).toEqual(['bad']);
    // only an explicit delete of the damaged id discards it
    deleteSlot(s, 'bad');
    expect(listDamaged(s)).toEqual([]);
    expect(listSlots(s).map((m) => m.id)).toEqual(['new']);
  });
  it('an unparseable slot blob is kept as raw text across a new save', () => {
    const s = memStore();
    s.map.set(SAVES_KEY, '{"a": {"version": 1, "na');
    saveSlot(s, 'n', 'N', { ledger, account, tutorialDone: false }, '0.68.0', 1);
    expect(listSlots(s).map((m) => m.id)).toEqual(['n']);
    expect(listDamaged(s).map((d) => d.id)).toEqual([DAMAGED_BLOB_ID]);
    expect(damagedRaw(s, DAMAGED_BLOB_ID)).toBe('{"a": {"version": 1, "na');
    // it stays recoverable through further saves
    saveSlot(s, 'm', 'M', { ledger, account, tutorialDone: false }, '0.68.0', 2);
    expect(damagedRaw(s, DAMAGED_BLOB_ID)).toBe('{"a": {"version": 1, "na');
  });
  it('a blob that parses to a non-object is kept too', () => {
    const s = memStore();
    s.map.set(SAVES_KEY, '[1,2]');
    saveSlot(s, 'n', 'N', { ledger, account, tutorialDone: false }, '0.68.0', 1);
    expect(damagedRaw(s, DAMAGED_BLOB_ID)).toBe('[1,2]');
  });
});
