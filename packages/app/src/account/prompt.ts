/**
 * The guest's "Save your progress" prompt (GH-1075 A2, A2-13, A1-12 prompt half): when the debrief may offer it. State is
 * `lions.account.prompt` = `{version: 1, shown, never}`. Every access is guarded: with site data blocked the property access
 * itself throws, and then the prompt answers by the page alone (`pageShown`), so it shows at most once per page load.
 */
import type { StorageLike } from '../brigade-account';

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

function write(storage: StorageLike | null, state: PromptState): void {
  try {
    storage?.setItem(PROMPT_KEY, JSON.stringify(state));
  } catch {
    /* blocked storage: the page-level flag stands in */
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
}

export function promptDue(o: PromptDueOptions): boolean {
  if (!o.enabled || !o.open || o.signedIn || o.tutorial || o.moment === null) return false;
  const state = read(o.storage);
  if (state === null) return !o.pageShown;
  return state.shown < PROMPT_MAX_SHOWINGS && !state.never;
}

export function markShown(storage: StorageLike | null): void {
  const s = read(storage) ?? FRESH;
  write(storage, { ...s, shown: s.shown + 1 });
}

export function markNever(storage: StorageLike | null): void {
  const s = read(storage) ?? FRESH;
  write(storage, { ...s, never: true });
}
