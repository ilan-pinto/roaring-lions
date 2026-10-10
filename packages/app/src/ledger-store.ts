// packages/app/src/ledger-store.ts
/**
 * One door to the save.
 *
 * Three things the app persists are ONE thing to a player -- the campaign
 * ledger (`lions.campaign.ledger`), the brigade account
 * (`lions.brigade.account`) and the named save slots (`lions.saves`, each of
 * which is a snapshot of the first two plus the tutorial flag). Until this
 * module they were three clean single-purpose pairs (`main-keys.ts`,
 * `brigade-account.ts`, `profile.ts`) with no object a caller could hold, so
 * ten `safeStorage()` calls in `main.ts` each passed a `Storage | null` around
 * and each re-decided what a blocked store means. This is that object. It
 * WRAPS those three modules rather than reimplementing them: every byte
 * written here is written by the same function that wrote it before.
 *
 * It exists now, ahead of the cap and the slot identity, for two reasons.
 *
 * **WP-ST6 (GH-205, gate G7 / GH-199) replaces the implementation and opens no
 * screen.** A server-authoritative ledger swaps what is behind `LedgerStore`;
 * nothing above it learns that the campaign ever was a string in
 * `localStorage`. That is only true while this stays the only door, so a new
 * reader or writer of these three keys belongs here and nowhere else.
 *
 * **The app needs its own ledger TYPE.** `LedgerData` belongs to `@lions/sim`
 * and the gamification plan may not add a key to it (R-2: `packages/sim` is
 * untouched, byte for byte). `CampaignLedger` is `LedgerData` plus the three
 * app-only keys E2/E4 add, and this module is the one place a parsed ledger is
 * widened to it. `RosterEntry` and `LostRecord` are declared here for the same
 * reason -- the caster cannot cast to a type it does not know. Tasks 3-5 give
 * them meaning; this module only names them.
 *
 * **What is deliberately NOT behind this door (R-9).** `lions.settings`
 * (`settings.ts`) and the hint line's `lions.seen` (`ui/hint-model.ts`), plus
 * `retired-keys.ts`'s one-time removal of the retired `lions.renderer` (the
 * Pixi choice, WP-A3.3). Those are facts about the PERSON and the DEVICE, not
 * about the campaign: ST6 moves a save to a server, it does not move
 * somebody's `--ui-scale`. `main.ts` keeps its own `safeStorage()` for them.
 * Do not "finish the job" by moving them here.
 *
 * **Why the interface is eleven methods and not nine.** `clearLedger` and
 * `resetAccount` are the two REMOVALS the app already performed -- "New
 * campaign" (`main.ts`'s `purgeCampaign`) and the brigade screen's reset -- and
 * they are here rather than expressed as `writeLedger({})` /
 * `writeAccount(emptyAccount())` so that nothing changes on disk: the key is
 * removed, exactly as before. They are also real operations of the seam rather
 * than conveniences; a server ledger has to express both. What was considered
 * and REFUSED is a `readRoster`/`writeRoster` pair: the roster is read and
 * written as part of one ledger object at one seam, and a second path to it is
 * a second place for the cap to be forgotten.
 *
 * **A blocked store is a quiet no-op, not an error and not a memory.**
 * `available` is false when `window.localStorage` cannot be reached or does not
 * carry the methods; every read then answers empty and every write does
 * nothing. That is exactly what `safeStorage()` bought at each of its call
 * sites, now decided once. It is NOT the same case as a store that accepts
 * writes and refuses one -- a quota refusal, a Safari private-window write --
 * which is let through: `profile.ts`'s `writeActive` and `writeVictory` below
 * catch it, put the three keys back from `snapshotCampaign`, and the screen
 * says the write was refused (save reliability, keyboard-and-saves).
 */
import { emptyRoarTest, loadRoarTest, saveRoarTest, type RoarTestAccount } from './roar-test';
import type { LedgerData, LedgerRosterEntry } from '@lions/sim';
import {
  ACCOUNT_KEY,
  emptyAccount,
  loadAccount,
  resetAccount as removeStoredAccount,
  saveAccount,
  startCampaign as clearCampaignPay,
  type BrigadeAccount,
  type StorageLike,
} from './brigade-account';
import {
  LEDGER_KEY,
  TUTORIAL_DONE_KEY,
  loadLedger,
  markTutorialDone,
  saveLedger,
  tutorialDone as storedTutorialDone,
} from './main-keys';
import { SAVES_KEY } from './profile';

/**
 * A roster entry as the APP sees it: the sim's own entry plus the durable slot
 * id E4 issues. `slot` is optional, and that is what makes the widening free --
 * `Readonly<LedgerRosterEntry>` is assignable to `Readonly<RosterEntry>`, so a
 * screen holding the sim's type can widen with no cast.
 */
export interface RosterEntry extends LedgerRosterEntry {
  /** Place in the order of battle, issued app-side, durable across missions. */
  slot?: number;
  /** The mission that first brought this body home (roster R-2): set app-side
   *  on a body that arrives fresh, carried by slot after that. The sim never
   *  reads it; `checkEnd` copies an unfielded entry whole, so it rides along.
   *  Absent on a body enlisted before R-2 shipped, which R-2 then never drops. */
  enlisted?: string;
}

/** The memorial half of a service record: who held a slot, and where they were
 *  lost. Append-only; never counted against the roster cap. */
export interface LostRecord {
  slot: number;
  name?: string;
  type: string;
  veterancy: number;
  missions: number;
  kills: number;
  missionId: string;
  tick: number;
}

/**
 * The app's ledger: `@lions/sim`'s, plus the three keys E2/E4 add and one
 * counter. None of them is in any mission's `ledger.requires`/`produces`
 * contract, none is on `mission.schema.json`'s enum of legal ledger keys, and
 * `checkEnd` carries them through its merge untouched because it builds what it
 * produces from `produces` alone.
 */
export interface CampaignLedger extends LedgerData {
  'roster.surviving_units'?: RosterEntry[];
  /** Overflow past the roster cap. Structurally undrawable: `MissionRuntime`
   *  seeds its pool from `roster.surviving_units` and nothing else. */
  'roster.reserve'?: RosterEntry[];
  'roster.lost'?: LostRecord[];
  /** Monotone slot counter, the mirror of `campaign.names_issued`. */
  'campaign.slots_issued'?: number;
}

/** The one object a caller holds. See the module header for what is behind it,
 *  what is deliberately not, and why `available` is a property rather than a
 *  decision each call site makes. */
export interface LedgerStore {
  /** False when there is nowhere durable to write. Reads answer empty and
   *  writes do nothing; nothing throws. */
  readonly available: boolean;
  readLedger(): CampaignLedger;
  writeLedger(l: CampaignLedger): void;
  /** "New campaign": remove the ledger key outright. */
  clearLedger(): void;
  readAccount(): BrigadeAccount;
  writeAccount(a: BrigadeAccount): void;
  /** The brigade screen's reset: remove the account key, hand back the empty
   *  account the caller should now render. */
  resetAccount(): BrigadeAccount;
  /** "New campaign"'s account half (GH-330): clear the per-campaign improvement
   *  record and nothing else. With no account stored there is nothing to clear,
   *  and nothing is written. */
  startCampaign(): void;
  tutorialDone(): boolean;
  /** `true` writes the flag, `false` removes it. One pair, one predicate. */
  setTutorialDone(done: boolean): void;
  /** Slots move BYTES, not meaning: `profile.ts` keeps its own parse and its
   *  own `importSlot` validation, so a damaged slot stays skippable without
   *  this module knowing what a slot is. */
  readSlotsRaw(): string | null;
  writeSlotsRaw(json: string): void;
  /** The Roar coin TEST wallet (`roar-test.ts`, key `lions.roar.test`): a
   *  test tool, never a money field of the brigade account. */
  readRoarTest(): RoarTestAccount;
  writeRoarTest(a: RoarTestAccount): void;
  /** The three campaign keys AS STORED -- ledger, account, tutorial flag --
   *  for `restoreCampaign` to put back. Bytes, not parsed values: a restore
   *  that re-serialised a migrated account or a cleaned ledger would be a
   *  write of its own, not an undo (save reliability, keyboard-and-saves). */
  snapshotCampaign(): CampaignSnapshot;
  /** Put the three keys back exactly as `snapshotCampaign` found them; a key
   *  that was absent is removed. Can throw, like any write. */
  restoreCampaign(snap: CampaignSnapshot): void;
}

/** Opaque to everything but this door: what `snapshotCampaign` took. */
export interface CampaignSnapshot {
  readonly ledger: string | null;
  readonly account: string | null;
  readonly tutorial: string | null;
}

/**
 * The three app-only keys, checked at the door. `loadLedger`'s
 * `JSON.parse(...) as LedgerData` is a cast, not a check, so a hand-edited save
 * used to reach the victory write as whatever it said -- `"roster.lost": {}`
 * throws inside `appendLost`'s spread, and a fractional or string
 * `campaign.slots_issued` would number slots `2.5` or `"71"`. A malformed key is
 * dropped to ABSENT, which is exactly the shape a pre-change save has (R-7), so
 * everything downstream already handles it. Only the container is checked --
 * an array, an integer -- not each record inside it: the sim's own keys have
 * never been checked on read either, and a per-record schema here would be a
 * second validator for one door. A well-formed ledger comes back as the same
 * object, untouched.
 */
function dropMalformed(ledger: CampaignLedger): CampaignLedger {
  if (ledger === null || typeof ledger !== 'object') return ledger;
  const lostOk = ledger['roster.lost'] === undefined || Array.isArray(ledger['roster.lost']);
  const reserveOk = ledger['roster.reserve'] === undefined || Array.isArray(ledger['roster.reserve']);
  const issuedOk = ledger['campaign.slots_issued'] === undefined || Number.isInteger(ledger['campaign.slots_issued']);
  if (lostOk && reserveOk && issuedOk) return ledger;
  const out: CampaignLedger = { ...ledger };
  if (!lostOk) delete out['roster.lost'];
  if (!reserveOk) delete out['roster.reserve'];
  if (!issuedOk) delete out['campaign.slots_issued'];
  return out;
}

/** A ledger's completed missions, as `campaign.ts` reads them. */
function completedIn(ledger: LedgerData | null | undefined): ReadonlySet<string> {
  const done = ledger?.['campaign.completed_missions'];
  return new Set(Array.isArray(done) ? done.filter((m): m is string => typeof m === 'string') : []);
}

/**
 * The whole implementation, over anything shaped like `Storage`. `null` is the
 * blocked store. Both `browserLedgerStore` and `memoryLedgerStore` are this
 * function with a different backend, which is what keeps the test double from
 * being a second implementation that can disagree with the real one.
 */
function overStorage(store: StorageLike | null): LedgerStore {
  return {
    available: store !== null,
    readLedger: (): CampaignLedger => dropMalformed(loadLedger(store)),
    writeLedger: (l: CampaignLedger): void => {
      if (store) saveLedger(store, l);
    },
    clearLedger: (): void => {
      store?.removeItem(LEDGER_KEY);
    },
    // The current campaign's completed missions are handed over only to migrate a
    // version-1 save's per-campaign record (`migrateAccount`); a version-2 save
    // ignores them.
    readAccount: (): BrigadeAccount => (store ? loadAccount(store, completedIn(loadLedger(store))) : emptyAccount()),
    startCampaign: (): void => {
      if (!store || store.getItem(ACCOUNT_KEY) === null) return;
      const before = loadAccount(store, completedIn(loadLedger(store)));
      const after = clearCampaignPay(before);
      // Written even when `after === before` would be a no-op for the record, so a
      // version-1 save is persisted as version 2 at the moment its campaign ends.
      saveAccount(store, after);
    },
    writeAccount: (a: BrigadeAccount): void => {
      if (store) saveAccount(store, a);
    },
    resetAccount: (): BrigadeAccount => (store ? removeStoredAccount(store) : emptyAccount()),
    tutorialDone: (): boolean => storedTutorialDone(store),
    setTutorialDone: (done: boolean): void => {
      if (!store) return;
      if (done) markTutorialDone(store);
      else store.removeItem(TUTORIAL_DONE_KEY);
    },
    readSlotsRaw: (): string | null => store?.getItem(SAVES_KEY) ?? null,
    writeSlotsRaw: (json: string): void => {
      if (store) store.setItem(SAVES_KEY, json);
    },
    readRoarTest: (): RoarTestAccount => (store ? loadRoarTest(store) : emptyRoarTest()),
    writeRoarTest: (a: RoarTestAccount): void => {
      if (store) saveRoarTest(store, a);
    },
    snapshotCampaign: (): CampaignSnapshot => ({
      ledger: store?.getItem(LEDGER_KEY) ?? null,
      account: store?.getItem(ACCOUNT_KEY) ?? null,
      tutorial: store?.getItem(TUTORIAL_DONE_KEY) ?? null,
    }),
    restoreCampaign: (snap: CampaignSnapshot): void => {
      if (!store) return;
      // Removals first: they cannot be refused, and each one frees room for
      // the writes after it. A value that was stored before fitted then, so
      // putting it back fits again under the same quota.
      const keys: [string, string | null][] = [[LEDGER_KEY, snap.ledger], [ACCOUNT_KEY, snap.account], [TUTORIAL_DONE_KEY, snap.tutorial]];
      for (const [key, value] of keys) if (value === null) store.removeItem(key);
      for (const [key, value] of keys) if (value !== null) store.setItem(key, value);
    },
  };
}

/**
 * `window.localStorage` can throw on the PROPERTY ACCESS itself (private mode,
 * site data blocked) and it can also be present without being usable -- this
 * repository's own vitest jsdom config hands over a bare `{}` with no
 * `getItem`, and a real browser with site data blocked throws on the access.
 * Both are "no durable store", so both answer `available: false` rather than
 * being discovered later as a TypeError inside a write.
 */
function safeStorage(): StorageLike | null {
  try {
    const raw: unknown = window.localStorage;
    if (raw === null || typeof raw !== 'object') return null;
    const s = raw as Partial<StorageLike>;
    if (typeof s.getItem !== 'function' || typeof s.setItem !== 'function' || typeof s.removeItem !== 'function') {
      return null;
    }
    return s as StorageLike;
  } catch {
    return null;
  }
}

/** The shipping store. The app builds exactly one, in `main.ts`. */
export function browserLedgerStore(): LedgerStore {
  return overStorage(safeStorage());
}

/**
 * The test double, and the only store the specs use. `raw` and `map` are
 * TEST-ONLY surface beyond `LedgerStore` -- the bytes under the door, for a
 * spec that wants to assert what was actually written (and, for `map`, to set
 * up or clear one key the way `profile.test.ts`'s own fake did). Production
 * code holds a `LedgerStore` and can reach neither.
 */
export interface MemoryLedgerStore extends LedgerStore {
  /** Test-only. */
  raw(key: string): string | null;
  /** Test-only. */
  readonly map: Map<string, string>;
}

export function memoryLedgerStore(seed: Partial<Record<string, string>> = {}): MemoryLedgerStore {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(seed)) if (value !== undefined) map.set(key, value);
  // Through the same `overStorage` the browser path takes, so a spec written
  // against this double is a spec about the shipping implementation.
  const backend: StorageLike = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  return { ...overStorage(backend), raw: (k) => map.get(k) ?? null, map };
}

/** The unavailable variant: what every call site gets in a private window with
 *  site data blocked. Test-only, like its parent. Its `map` is a fresh Map that
 *  is DISCONNECTED from the store -- there is no backend behind a blocked store,
 *  so no read ever consults it and no write ever reaches it, and a spec that
 *  seeds it or reads it back is testing nothing. It exists only so the type
 *  matches `MemoryLedgerStore`. */
memoryLedgerStore.blocked = function blockedMemoryLedgerStore(): MemoryLedgerStore {
  return { ...overStorage(null), raw: () => null, map: new Map<string, string>() };
};

/**
 * "New campaign" (the menu button and the `?fresh` landing, both through
 * `main.ts`'s `purgeCampaign`): the ledger key and the tutorial flag are
 * REMOVED, as before, and the brigade account's per-campaign improvement record
 * is cleared (GH-330), so every mission pays in full again the first time it is
 * won in the new campaign. The account itself -- balance, purchases, the
 * lifetime record -- survives, as spec 2026-09-15 §4.1 promises.
 */
export function newCampaign(store: LedgerStore): void {
  store.clearLedger();
  store.setTutorialDone(false);
  store.startCampaign();
}

/** What `writeVictory` managed: both keys written; refused and put back; or
 *  no durable storage to write to at all (a blocked store, never a refusal). */
export type VictoryWrite = 'saved' | 'refused' | 'unavailable';

/**
 * The victory handler's write (`main.ts`): the ledger that records the win,
 * then -- when the win paid -- the brigade account. Both or neither. The
 * handler used to wrap only the ledger write, so a refused ACCOUNT write (a
 * quota, a private-window refusal) threw out of it after the ledger had
 * already recorded the win: a won mission with no pay, and the end screen
 * taken down with the throw (save reliability walk, keyboard-and-saves). Now
 * the door's byte snapshot is put back on any refusal and the answer is
 * `'refused'`, which the HUD reports as "not saved". Nothing throws: a
 * restore refused too is logged, and the answer is still `'refused'`.
 */
export function writeVictory(store: LedgerStore, ledger: CampaignLedger, account: BrigadeAccount | null): VictoryWrite {
  if (!store.available) return 'unavailable';
  const before = store.snapshotCampaign();
  try {
    store.writeLedger(ledger);
    if (account) store.writeAccount(account);
    return 'saved';
  } catch (err) {
    console.error('campaign victory write refused:', err);
    try {
      store.restoreCampaign(before);
    } catch (restoreErr) {
      console.error('campaign victory write: the restore was refused too:', restoreErr);
    }
    return 'refused';
  }
}
