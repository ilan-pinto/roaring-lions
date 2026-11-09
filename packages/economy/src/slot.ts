/**
 * A save slot's format and its one parser (GH-1075 A2). Moved from the app's `profile.ts` so
 * the Worker validates a slot with the same rules the importer does. Pure: no storage here.
 */
import type { LedgerData } from '@lions/sim';
import { migrateAccount, type BrigadeAccount } from './brigade';
import { sanitiseLedger } from './ledger-shape';

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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A slot ledger's completed missions, for `migrateAccount`. */
export function completedOf(ledger: unknown): ReadonlySet<string> {
  const done = isRecord(ledger) ? ledger['campaign.completed_missions'] : undefined;
  return new Set(Array.isArray(done) ? done.filter((m): m is string => typeof m === 'string') : []);
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

export function parseSlot(json: string): SaveSlot {
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
    // review 559 F4: an imported file is somebody else's bytes -- element by element.
    ledger: sanitiseLedger(v.ledger as LedgerData),
    // A version-1 slot's per-campaign record (GH-330) is derived against the
    // slot's OWN ledger, the campaign it was saved in, not the active one.
    account: migrateAccount(v.account, completedOf(v.ledger)),
    tutorialDone: v.tutorialDone === true,
  };
}
