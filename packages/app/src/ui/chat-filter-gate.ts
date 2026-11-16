// packages/app/src/ui/chat-filter-gate.ts
/**
 * The chat word filter's door on the entry path (GH-1417 S2). The filter (`chat-filter.ts`) and its word lists
 * (`@lions/data/chat-filters`) are some 21 KB the entry chunk cannot carry (the main-chunk guard, `webgpu:bundle`, whose ceiling never
 * rises), and they are needed only where versus chat or a typed name is shown. So they load on demand, here, the way `main.ts` loads
 * its other lazy modules: `importWithRetry(() => import(...))`, the failure caught and logged, and the caller checking it is still
 * wanted after the await.
 *
 * THE SAFE FALLBACK. Until the filter has loaded, and whenever it failed to load, nothing typed by another player is shown raw:
 *  - a received chat line is HELD by its inbox (`chat-inbox.ts`) and delivered, filtered, once the filter is in; if the load fails the
 *    held lines are dropped, never shown, and the next line asks again;
 *  - a typed name (a callsign, a member's name, a bot's typed model; `net/seat-label.ts`) reads as the room's fallback name,
 *    `DEFAULT_CALLSIGN` ("Lion"), which is also what a name with a filtered word reads as. The lobby relabels when the filter arrives,
 *    and the battlefield waits for it before it mounts a room's chat, score and status line.
 * `chat-filter-gate.test.ts` and `chat-inbox.test.ts` hold both; `chat-filter-wiring.test.ts` holds the lazy boundary.
 *
 * Presentation only: nothing here touches a command, a frame or the sim (invariant 4).
 */
import { DEFAULT_CALLSIGN } from '@lions/net';
import { currentLocale } from '../i18n/t';
import { importWithRetry } from '../shell/chunk';
import type * as ChatFilterModule from './chat-filter';
import type { ChatFilterView } from './chat-filter';

type FilterModule = typeof ChatFilterModule;

/** What a typed name reads as while the filter is not in: the room's fallback name, the same a filtered name reads as. */
export const PENDING_NAME = DEFAULT_CALLSIGN;

let loaded: FilterModule | null = null;
let loading: Promise<boolean> | null = null;

/** The production loader: the one dynamic import of the filter. */
const importFilter = (): Promise<FilterModule> => importWithRetry(() => import('./chat-filter'));

/**
 * Loads the word filter once; resolves true when it is in, false when it would not load (logged). It never rejects. A failure is not
 * remembered, so the next caller tries again. `load` is the test seam; production passes nothing.
 */
export function loadChatFilter(load: () => Promise<FilterModule> = importFilter): Promise<boolean> {
  if (loaded !== null) return Promise.resolve(true);
  loading ??= load().then(
    (m) => {
      loaded = m;
      return true;
    },
    (err: unknown) => {
      console.error('[chat-filter] the word filter failed to load: chat lines stay hidden and typed names read as the fallback name', err);
      loading = null;
      return false;
    },
  );
  return loading;
}

/** The shipped lists for a reader in UI language `lang`, or null while the filter has not loaded. */
export function chatFilterNow(lang: string = currentLocale()): ChatFilterView | null {
  return loaded === null ? null : loaded.shippedView(lang);
}

/** A typed name as this reader is shown it: filtered once the filter is in, `PENDING_NAME` until then. It does not ask for the load:
 *  the screens that show names do (the lobby's `adopt`, the battlefield's boot). */
export function shownName(raw: string): string {
  const f = chatFilterNow();
  return f === null ? PENDING_NAME : f.name(raw);
}

/** Tests only: back to the state before the first load. */
export function resetChatFilterGateForTests(): void {
  loaded = null;
  loading = null;
}
