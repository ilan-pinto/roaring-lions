/**
 * The guest's "Save your progress" prompt (GH-1075 A2, A2-13, A1-12 prompt half): when the debrief may offer it. State is
 * `lions.account.prompt` = `{version: 1, shown, never}`. Every access is guarded: with site data blocked the property access
 * itself throws, and then the prompt answers by the page alone (`pageShown`), so it shows at most once per page load.
 */
import type { StorageLike } from '../brigade-account';
import { campaignComplete, townProgress, type ParsedWorld } from '@lions/economy';
import type { LedgerData } from '@lions/sim';

export const PROMPT_KEY = 'lions.account.prompt';
export const PROMPT_MAX_SHOWINGS = 3;

export type PromptMoment = 'firstVictory' | 'firstTown' | 'campaignDone';

interface PromptState {
  version: 1;
  shown: number;
  never: boolean;
}

const FRESH: PromptState = { version: 1, shown: 0, never: false };

/** The stored state; FRESH for nothing or a damaged record; null when storage itself refused (or there is none). */
function read(storage: StorageLike | null): PromptState | null {
  if (storage === null) return null;
  try {
    const text = storage.getItem(PROMPT_KEY);
    if (typeof text !== 'string') return FRESH;
    const j: unknown = JSON.parse(text);
    if (typeof j === 'object' && j !== null && !Array.isArray(j)) {
      const r = j as Record<string, unknown>;
      if (r.version === 1 && typeof r.shown === 'number' && Number.isFinite(r.shown) && r.shown >= 0 && typeof r.never === 'boolean') {
        return { version: 1, shown: Math.floor(r.shown), never: r.never };
      }
    }
    return FRESH;
  } catch {
    return null;
  }
}

/** False when the record could not be kept (no storage, or a refused write): the caller falls back to the once-per-page rule. */
function write(storage: StorageLike | null, state: PromptState): boolean {
  try {
    if (storage === null) return false;
    storage.setItem(PROMPT_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export interface PromptDueOptions {
  storage: StorageLike | null;
  enabled: boolean;
  open: boolean;
  signedIn: boolean;
  moment: PromptMoment | null;
  tutorial: boolean;
  /** The prompt was already shown on this page load. */
  pageShown: boolean;
  /** `markShown` reported that it could not keep the count (a refused write, e.g. quota): the page alone then limits it. */
  unpersisted?: boolean;
}

export function promptDue(o: PromptDueOptions): boolean {
  if (!o.enabled || !o.open || o.signedIn || o.tutorial || o.moment === null) return false;
  const state = read(o.storage);
  if (state === null || o.unpersisted === true) return !o.pageShown;
  return state.shown < PROMPT_MAX_SHOWINGS && !state.never;
}

/** Counts a showing. Returns whether the count was kept. */
export function markShown(storage: StorageLike | null): boolean {
  const s = read(storage) ?? FRESH;
  return write(storage, { ...s, shown: s.shown + 1 });
}

export function markNever(storage: StorageLike | null): boolean {
  const s = read(storage) ?? FRESH;
  return write(storage, { ...s, never: true });
}

/** The completed-mission ids of a ledger. */
const doneOf = (l: LedgerData | undefined): readonly string[] => {
  const d = l?.['campaign.completed_missions'];
  return Array.isArray(d) ? (d as string[]) : [];
};

/**
 * Which moment a victory is, for the guest's save prompt: the end of the war (checked first), the first finished town (the
 * mission's OWN town went complete and no town was complete before), or the first campaign win. Null for a defeat, a
 * tutorial or any non-campaign mission (`campaign` false: it produces nothing the ledger counts), or any other win.
 */
export function saveMoment(
  world: ParsedWorld,
  townId: string | undefined,
  campaign: boolean,
  victory: boolean,
  before: LedgerData | undefined,
  after: LedgerData | undefined,
): PromptMoment | null {
  if (!victory || !campaign) return null;
  if (campaignComplete(world, after) && !campaignComplete(world, before)) return 'campaignDone';
  const towns = world.regions.flatMap((r) => r.towns);
  const complete = (l: LedgerData | undefined) => (t: (typeof towns)[number]): boolean => {
    const p = townProgress(t, l);
    return p.total > 0 && p.done === p.total;
  };
  const mine = towns.find((t) => t.id === townId);
  if (mine !== undefined && complete(after)(mine) && !towns.some(complete(before))) return 'firstTown';
  return doneOf(before).length === 0 && doneOf(after).length > 0 ? 'firstVictory' : null;
}
