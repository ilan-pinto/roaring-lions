/**
 * How often the debrief asks "How was that mission?" (GH-464, spec §1, D2).
 *
 * At most once per mission id per player, on that mission's first debrief,
 * win or lose -- a replay of an asked mission is never asked again. After
 * three asks in a row go unanswered it stops asking until the next build
 * (`__APP_BUILD__` changes). Never in a sandbox; the tutorial is asked, since
 * it is the funnel's biggest question.
 *
 * State lives in browser storage under `lions.feedback`, read and written through
 * `safeStorage`, so blocked site data degrades to "ask every time this tab"
 * rather than a throw.
 */
import type { StorageLike } from '../telemetry/identity';

export const PROMPT_STATE_KEY = 'lions.feedback';
export const IGNORE_LIMIT = 3;

export interface PromptState {
  /** Missions already asked about (the spec's name for the field). */
  rated: string[];
  /** Unanswered asks in a row. */
  ignored: number;
  build: string;
}

export function readPromptState(storage: StorageLike | null, build: string): PromptState {
  let s: PromptState = { rated: [], ignored: 0, build };
  try {
    const raw = storage?.getItem(PROMPT_STATE_KEY) ?? null;
    const v: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      s = {
        rated: Array.isArray(o.rated) ? o.rated.filter((x): x is string => typeof x === 'string').slice(-500) : [],
        ignored: typeof o.ignored === 'number' && Number.isFinite(o.ignored) ? Math.max(0, Math.floor(o.ignored)) : 0,
        build: typeof o.build === 'string' ? o.build : build,
      };
    }
  } catch {
    /* unreadable: start clean */
  }
  // A new build forgives the silence; it does not forget what was asked.
  if (s.build !== build) s = { ...s, ignored: 0, build };
  return s;
}

export function writePromptState(storage: StorageLike | null, s: PromptState): void {
  storage?.setItem(PROMPT_STATE_KEY, JSON.stringify(s));
}

export function shouldAsk(s: PromptState, mission: string, opts: { sandbox: boolean }): boolean {
  if (opts.sandbox) return false;
  if (s.ignored >= IGNORE_LIMIT) return false;
  return !s.rated.includes(mission);
}

/** The prompt was shown for `mission`. */
export const asked = (s: PromptState, mission: string): PromptState =>
  s.rated.includes(mission) ? s : { ...s, rated: [...s.rated, mission] };
/** The player picked a rating: the silence streak ends. */
export const answered = (s: PromptState): PromptState => ({ ...s, ignored: 0 });
/** The debrief was left with no rating picked. */
export const ignored = (s: PromptState): PromptState => ({ ...s, ignored: s.ignored + 1 });
