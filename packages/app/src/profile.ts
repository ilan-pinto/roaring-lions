/**
 * Save slots. The ACTIVE campaign stays where it always was — the ledger under
 * `lions.campaign.ledger`, the brigade account under `lions.brigade.account`,
 * the tutorial flag under `lions.tutorial.done` — so nothing that reads them
 * changes. A slot is a snapshot of all three, named, under `lions.saves`.
 * Loading a slot writes the three keys back; saving reads them. Two stores
 * or it is not a save: the brigade account survives a new campaign on
 * purpose (spec 2026-09-15 §4.1), so a slot that carried only the ledger
 * would restore a campaign into the wrong brigade.
 */
import type { LedgerData } from '@lions/sim';
// This module names no storage key but its own, and reaches no storage API at
// all: the active campaign's three keys arrive through `LedgerStore`
// (`ledger-store.ts`), which is the app's one door to the save. `SAVES_KEY`
// below is still declared here -- the slots are this module's own format --
// and the door reads and writes it as an opaque string, because a damaged slot
// has to stay skippable by `importSlot` without the door knowing what a slot is.
import { migrateAccount, type BrigadeAccount } from './brigade-account';
import type { LedgerStore } from './ledger-store';

export const SAVES_KEY = 'lions.saves';
export const SAVE_VERSION = 1 as const;

export interface SaveSlot {
  version: typeof SAVE_VERSION;
  id: string;
  name: string;
  savedAt: number;
  build: string;
  ledger: LedgerData;
  account: BrigadeAccount;
  tutorialDone: boolean;
}

export interface SlotMeta { id: string; name: string; savedAt: number; build: string; missions: number; credits: number }
export interface ActiveState { ledger: LedgerData; account: BrigadeAccount; tutorialDone: boolean }

/** A slot ledger's completed missions, for `migrateAccount`. */
function slotCompleted(ledger: unknown): ReadonlySet<string> {
  const done = isRecord(ledger) ? ledger['campaign.completed_missions'] : undefined;
  return new Set(Array.isArray(done) ? done.filter((m): m is string => typeof m === 'string') : []);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function readActive(store: LedgerStore): ActiveState {
  return { ledger: store.readLedger(), account: store.readAccount(), tutorialDone: store.tutorialDone() };
}

/**
 * The one coded reason a LOAD can leave the campaign mixed: the browser
 * refused one of the three writes AND refused putting the old campaign back.
 * A catalogue key, like `SAVE_ERROR_NOT_A_SAVE` below and for the same reason.
 */
export const SAVE_ERROR_LOAD_MIXED = 'saves.error.storage.loadMixed';

/**
 * Write a slot's three keys back over the ACTIVE campaign -- all three, or
 * none of them.
 *
 * `Storage` offers one `setItem` at a time and no transaction, so a
 * `QuotaExceededError` (or a Safari private-window refusal) partway down used
 * to leave the ACTIVE state half written: a ledger married to the previous
 * brigade account, which is precisely the corruption this module's own header
 * says two stores exist to prevent -- and `ui/saves.ts` could only tell the
 * player "your campaign may be mixed" (save reliability walk,
 * polish/keyboard-and-saves). Now the door's own byte snapshot is taken first
 * and put back on any refusal, and the ORIGINAL error is rethrown: the load
 * failed and nothing changed. Putting back what was stored before cannot need
 * more room than it had, so the restore is expected to succeed; if it is
 * refused too, `SAVE_ERROR_LOAD_MIXED` is thrown instead, and that is the one
 * case the player is told the campaign may be mixed.
 *
 * Ledger first is kept: it is the larger payload and the likelier refusal,
 * so the common case fails before anything has changed at all.
 *
 * An UNAVAILABLE store (`available: false`) writes nothing and throws
 * nothing, which is a different case entirely: nothing is half written
 * because nothing is written, and the saves screen is not reachable in that
 * state anyway (`main.ts`'s `mountSaves` refuses it).
 */
export function writeActive(store: LedgerStore, s: ActiveState): void {
  const before = store.snapshotCampaign();
  try {
    store.writeLedger(s.ledger);
    store.writeAccount(s.account);
    store.setTutorialDone(s.tutorialDone);
  } catch (err) {
    try {
      store.restoreCampaign(before);
    } catch {
      throw new Error(SAVE_ERROR_LOAD_MIXED);
    }
    throw err;
  }
}

/**
 * The id a whole-blob failure is filed under. When `lions.saves` itself does
 * not parse (a truncated write, a hand edit), its raw TEXT is kept as one
 * damaged entry rather than dropped: the next save would otherwise replace the
 * unreadable blob with a fresh one and the old text would be gone for good.
 */
export const DAMAGED_BLOB_ID = 'damaged:blob';

interface SlotTable {
  /** Slots that parsed and validated. */
  slots: Record<string, SaveSlot>;
  /** Everything else, verbatim: each value is what the blob held under that id
   *  (or, for `DAMAGED_BLOB_ID`, the blob's raw text). Written back untouched
   *  by `writeAll`, so no save or delete can drop it (K-12). */
  damaged: Record<string, unknown>;
}

function readAll(store: LedgerStore): SlotTable {
  const text = store.readSlotsRaw();
  if (text === null) return { slots: {}, damaged: {} };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { slots: {}, damaged: { [DAMAGED_BLOB_ID]: text } };
  }
  if (!isRecord(v)) return { slots: {}, damaged: { [DAMAGED_BLOB_ID]: text } };
  const slots: Record<string, SaveSlot> = {};
  const damaged: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(v)) {
    try {
      slots[id] = importSlot(JSON.stringify(raw));
    } catch {
      // A damaged slot never hides its neighbours, and is never dropped.
      damaged[id] = raw;
    }
  }
  return { slots, damaged };
}

function writeAll(store: LedgerStore, table: SlotTable): void {
  store.writeSlotsRaw(JSON.stringify({ ...table.damaged, ...table.slots }));
}

export function listSlots(store: LedgerStore): SlotMeta[] {
  return Object.values(readAll(store).slots)
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((s) => ({
      id: s.id, name: s.name, savedAt: s.savedAt, build: s.build,
      missions: (s.ledger['campaign.completed_missions'] ?? []).length,
      credits: s.account.balance,
    }));
}

/** A slot that is stored but cannot be read. `bytes` is the length of what is
 *  kept, so the screen can say how much there is to recover. */
export interface DamagedMeta { id: string; bytes: number }

export function listDamaged(store: LedgerStore): DamagedMeta[] {
  return Object.entries(readAll(store).damaged).map(([id, raw]) => ({ id, bytes: damagedText(raw).length }));
}

function damagedText(raw: unknown): string {
  return typeof raw === 'string' ? raw : JSON.stringify(raw) ?? '';
}

/** The kept text of a damaged slot, for export; null when no such entry. */
export function damagedRaw(store: LedgerStore, id: string): string | null {
  const table = readAll(store);
  return id in table.damaged ? damagedText(table.damaged[id]) : null;
}

export function saveSlot(store: LedgerStore, id: string, name: string, s: ActiveState, build: string, now: number): SaveSlot {
  const slot: SaveSlot = { version: SAVE_VERSION, id, name, savedAt: now, build, ledger: s.ledger, account: s.account, tutorialDone: s.tutorialDone };
  const all = readAll(store);
  all.slots[id] = slot;
  writeAll(store, all);
  return slot;
}

export function loadSlot(store: LedgerStore, id: string): SaveSlot | null {
  return readAll(store).slots[id] ?? null;
}

/** Remove a slot, or a damaged entry (the only way one is ever discarded). */
export function deleteSlot(store: LedgerStore, id: string): void {
  const all = readAll(store);
  if (id in all.slots) delete all.slots[id];
  else if (id in all.damaged) delete all.damaged[id];
  else return;
  writeAll(store, all);
}

export function exportSlot(slot: SaveSlot): string {
  return JSON.stringify(slot);
}

/**
 * The one coded reason an import is refused -- a catalogue KEY, not a sentence.
 *
 * I8 (final review): this used to be `throw new Error('not a Roaring Lions
 * save')`, and `ui/saves.ts` printed `err.message` straight into an
 * `aria-live` line. That is a player-facing chrome string outside the
 * catalogue, and one `tools/validate_i18n.mjs` structurally cannot see: its
 * regex is anchored on a sink assignment with an adjacent quote, and this is a
 * `throw` whose value reaches the sink through a variable (blind spot #2, which
 * the validator's own header names). Throwing the key instead keeps
 * `profile.ts` free of `t()` -- it owns storage, not language -- while giving
 * the screen something it can resolve.
 */
export const SAVE_ERROR_NOT_A_SAVE = 'saves.error.notASave';

export function importSlot(json: string): SaveSlot {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    throw new Error(SAVE_ERROR_NOT_A_SAVE);
  }
  if (!isRecord(v) || v.version !== SAVE_VERSION || typeof v.id !== 'string' || typeof v.name !== 'string' || !isRecord(v.ledger) || !isRecord(v.account)) {
    throw new Error(SAVE_ERROR_NOT_A_SAVE);
  }
  return {
    version: SAVE_VERSION,
    id: v.id,
    name: v.name,
    savedAt: typeof v.savedAt === 'number' ? v.savedAt : 0,
    build: typeof v.build === 'string' ? v.build : '',
    ledger: v.ledger as LedgerData,
    // A version-1 slot's per-campaign record (GH-330) is derived against the
    // slot's OWN ledger, the campaign it was saved in, not the active one.
    account: migrateAccount(v.account, slotCompleted(v.ledger)),
    tutorialDone: v.tutorialDone === true,
  };
}
