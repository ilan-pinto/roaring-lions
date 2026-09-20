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
 * (`settings.ts`) and `lions.renderer` (`renderer-choice.ts`, `ui/menu.ts`),
 * plus the hint line's `lions.seen` (`ui/hint-model.ts`). Those are facts about
 * the PERSON and the DEVICE, not about the campaign: ST6 moves a save to a
 * server, it does not move somebody's `--ui-scale`, and a renderer choice that
 * needed a network round trip before the menu could draw would be a
 * regression. `main.ts` keeps its own `safeStorage()` for exactly those two.
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
 * which is let through, because `profile.ts`'s `writeActive` has no
 * transaction and `ui/saves.ts` has to tell the player when a load was half
 * applied (profile.ts, I2).
 */
import type { LedgerData, LedgerRosterEntry } from '@lions/sim';
import {
  emptyAccount,
  loadAccount,
  resetAccount as removeStoredAccount,
  saveAccount,
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
  tutorialDone(): boolean;
  /** `true` writes the flag, `false` removes it. One pair, one predicate. */
  setTutorialDone(done: boolean): void;
  /** Slots move BYTES, not meaning: `profile.ts` keeps its own parse and its
   *  own `importSlot` validation, so a damaged slot stays skippable without
   *  this module knowing what a slot is. */
  readSlotsRaw(): string | null;
  writeSlotsRaw(json: string): void;
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
    readLedger: (): CampaignLedger => loadLedger(store),
    writeLedger: (l: CampaignLedger): void => {
      if (store) saveLedger(store, l);
    },
    clearLedger: (): void => {
      store?.removeItem(LEDGER_KEY);
    },
    readAccount: (): BrigadeAccount => (store ? loadAccount(store) : emptyAccount()),
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
 *  site data blocked. Test-only, like its parent. */
memoryLedgerStore.blocked = function blockedMemoryLedgerStore(): MemoryLedgerStore {
  return { ...overStorage(null), raw: () => null, map: new Map<string, string>() };
};
