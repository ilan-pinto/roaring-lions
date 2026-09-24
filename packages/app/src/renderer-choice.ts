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
 * Absent the query param, the last explicit choice wins; absent both, the
 * default is THREE as of Phase D. It was Pixi until then, which is what made
 * the first bug above invisible: `?renderer=pixi` and an empty query string
 * genuinely did the same thing, so nothing could tell a working hatch from a
 * missing one. Flipping the default is what turns that escape hatch from
 * decoration into the only way back.
 *
 * `resolveRendererChoice` is pure: two strings in, a decision out, no DOM and
 * no storage I/O, so it stays testable without jsdom. The read and the write
 * are the two guarded helpers at the bottom, `readStoredRenderer` and
 * `rememberRenderer`, which take the storage as a parameter for the same
 * reason. They moved here from `ui/menu.ts` (scene-host plan, Task 6) when the
 * menu itself began asking which renderer this player chose.
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
  const choice: RendererChoice = stored === 'pixi' ? 'pixi' : 'three';
  return { choice, persist: null };
}

/** Where the remembered choice is read from and written to -- `localStorage`
 *  in the app, a stand-in in a test. `Partial` because this vitest jsdom
 *  configuration under Node 25 supplies a bare `{}` with no Storage API. */
type StorageDoor<K extends 'getItem' | 'setItem'> = () => Partial<Pick<Storage, K>> | undefined;

/**
 * The remembered renderer choice, or `null`.
 *
 * Guarded rather than called inline because reaching `localStorage` is not
 * guaranteed to work: a browser with site data blocked THROWS on the
 * property access itself, and this vitest jsdom configuration supplies a
 * bare `{}` with no Storage API at all -- so an unguarded `getItem` takes the
 * whole screen that asked down in both. Losing the remembered choice is a
 * small cost (the default is three, and `?renderer=` still works for that
 * session); losing the screen is not.
 */
export function readStoredRenderer(storage: StorageDoor<'getItem'> = () => window.localStorage): string | null {
  try {
    return storage()?.getItem?.(RENDERER_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Remember an explicit choice, guarded for the same reasons as
 *  `readStoredRenderer`. */
export function rememberRenderer(choice: string, storage: StorageDoor<'setItem'> = () => window.localStorage): void {
  try {
    storage()?.setItem?.(RENDERER_STORAGE_KEY, choice);
  } catch {
    // Nothing to do and nothing to say: the player asked for a backend, they
    // get it this session, and it simply will not outlive the navigation.
  }
}
