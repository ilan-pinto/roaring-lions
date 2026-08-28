/**
 * Which renderer backend boots, and whether that choice should be written
 * back to storage.
 *
 * Two bugs lived here before this file existed. First: `main.ts` tested
 * `params.get('renderer') === 'three'` and treated everything else — an
 * explicit `pixi`, a typo, an absent param — identically, as "fall through
 * to Pixi". That only ever looked like a working escape hatch because Pixi
 * is the default; `?renderer=pixi` did nothing that an empty query string
 * did not already do. The moment the default flips to three, that hatch
 * stops existing and nothing says so. Second: even a correctly parsed
 * choice lived only in the URL, and every `menu.ts` navigation link
 * hard-codes its own query string (`?mission=${id}`, `?campaign`, bare
 * `?`), dropping whatever the player had chosen. A player who hits a
 * three-only bug, sets `?renderer=pixi`, and clicks "next mission" was
 * silently back on three.
 *
 * The fix here is the one CLAUDE.md already uses for the campaign ledger
 * and the tutorial-done flag: persist the choice in `localStorage` rather
 * than trying to thread it through every link `menu.ts` builds. An explicit
 * `?renderer=pixi` or `?renderer=three` is both a real, parsed value AND
 * gets written to storage, so it outlives the navigation that carried it.
 * Absent the query param, the last explicit choice wins; absent both, Pixi
 * is still the default — this file does not change that.
 *
 * Pure: two strings in, a decision out. No DOM, no storage I/O — the caller
 * does the read/write so this stays testable without jsdom.
 */

export type RendererChoice = 'pixi' | 'three';

/** localStorage key. `lions.*`, matching `LEDGER_KEY` / `TUTORIAL_DONE_KEY`
 *  in main.ts. Exported so main.ts and any test that wants to assert against
 *  the real key use the same literal. */
export const RENDERER_STORAGE_KEY = 'lions.renderer';

export interface RendererDecision {
  /** Which backend to construct this boot. */
  choice: RendererChoice;
  /** What to write to storage, if anything. `null` means "leave storage
   *  alone" -- an unset or garbage query param must not overwrite a
   *  previously remembered explicit choice. */
  persist: RendererChoice | null;
}

/** `requested` is `params.get('renderer')` -- `null`, `'pixi'`, `'three'`,
 *  or a typo. `stored` is whatever storage held at boot, or `null`. */
export function resolveRendererChoice(
  requested: string | null,
  stored: string | null
): RendererDecision {
  if (requested === 'three' || requested === 'pixi') {
    return { choice: requested, persist: requested };
  }
  const choice: RendererChoice = stored === 'three' ? 'three' : 'pixi';
  return { choice, persist: null };
}
