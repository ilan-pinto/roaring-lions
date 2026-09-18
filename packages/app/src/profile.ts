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
// Neither `ACCOUNT_KEY` (brigade-account.ts) nor `LEDGER_KEY` (main-keys.ts) is
// read here directly -- `loadAccount`/`saveAccount` and `loadLedger`/`saveLedger`
// are each key's one reader and writer, and this module goes through them rather
// than naming either string a second time.
import { loadAccount, migrateAccount, saveAccount, type BrigadeAccount, type StorageLike } from './brigade-account';
import { TUTORIAL_DONE_KEY, loadLedger, markTutorialDone, saveLedger, tutorialDone } from './main-keys';

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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function readActive(store: StorageLike): ActiveState {
  return { ledger: loadLedger(store), account: loadAccount(store), tutorialDone: tutorialDone(store) };
}

/**
 * Write a slot's three keys back over the ACTIVE campaign.
 *
 * Order, which is the accepted failure mode rather than an accident: ledger,
 * then account, then the tutorial flag. There is no transaction available here
 * -- `Storage` offers one `setItem` at a time -- so a `QuotaExceededError` (or
 * a Safari private-window write refusal) partway down leaves the ACTIVE state
 * half written: a ledger married to the previous brigade account, which is
 * precisely the corruption this module's own header says two stores exist to
 * prevent. Ledger first is the deliberate choice, because the ledger is the
 * larger of the two payloads and therefore the likelier one to be refused, so
 * the common quota failure happens before anything has changed at all.
 *
 * I2 (final review): this throws rather than swallowing, and every caller is
 * expected to say so out loud -- `ui/saves.ts` catches and routes the message
 * through its `role="status"` line. A silent half-write that re-renders as if
 * it had succeeded is the one way "a save slot round-trips the ledger
 * byte-for-byte" can be false with nothing on screen to say so.
 */
export function writeActive(store: StorageLike, s: ActiveState): void {
  saveLedger(store, s.ledger);
  saveAccount(store, s.account);
  if (s.tutorialDone) markTutorialDone(store);
  else store.removeItem(TUTORIAL_DONE_KEY);
}

function readAll(store: StorageLike): Record<string, SaveSlot> {
  try {
    const v: unknown = JSON.parse(store.getItem(SAVES_KEY) ?? '{}');
    if (!isRecord(v)) return {};
    const out: Record<string, SaveSlot> = {};
    for (const [id, raw] of Object.entries(v)) {
      try {
        out[id] = importSlot(JSON.stringify(raw));
      } catch {
        // a damaged slot is skipped, never allowed to hide its neighbours
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(store: StorageLike, all: Record<string, SaveSlot>): void {
  store.setItem(SAVES_KEY, JSON.stringify(all));
}

export function listSlots(store: StorageLike): SlotMeta[] {
  return Object.values(readAll(store))
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((s) => ({
      id: s.id, name: s.name, savedAt: s.savedAt, build: s.build,
      missions: (s.ledger['campaign.completed_missions'] ?? []).length,
      credits: s.account.balance,
    }));
}

export function saveSlot(store: StorageLike, id: string, name: string, s: ActiveState, build: string, now: number): SaveSlot {
  const slot: SaveSlot = { version: SAVE_VERSION, id, name, savedAt: now, build, ledger: s.ledger, account: s.account, tutorialDone: s.tutorialDone };
  const all = readAll(store);
  all[id] = slot;
  writeAll(store, all);
  return slot;
}

export function loadSlot(store: StorageLike, id: string): SaveSlot | null {
  return readAll(store)[id] ?? null;
}

export function deleteSlot(store: StorageLike, id: string): void {
  const all = readAll(store);
  if (!(id in all)) return;
  delete all[id];
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
    account: migrateAccount(v.account),
    tutorialDone: v.tutorialDone === true,
  };
}
