// packages/app/src/ui/hint-model.ts
/**
 * Task 9: the bottom-centre hint line, and first-use memory for the two
 * things a new player never finds on their own -- the projected-fire panel
 * beside a hovered hostile, and the reinforcements dock (bound to `b`).
 *
 * `hintFor` is pure: it takes the facts `main.ts` already has in hand
 * (selection size, whether the cursor is over a hostile, whether each
 * first-use hint has already been earned, and whether this mission even
 * fields a dock) and answers which ONE line the strip shows. It never reads
 * storage or the sim itself -- that keeps the priority order a plain table
 * this file's own tests can pin without booting a `Hud`.
 *
 * `loadSeen`/`markSeen` are the other half: a single `lions.seen` object
 * remembering which first-use hint has already done its job. This is
 * deliberately NOT a `Settings` field (`settings.ts`) -- it is not a
 * preference, nobody would go looking for "have I seen the dock hint yet" on
 * a settings screen, and putting it there would mean a settings reset erases
 * a tutorial memory that has nothing to do with settings. The guard shape
 * (missing store, blocked store, a value that parses to something other than
 * the expected object) copies `settings.ts`'s own `loadSettings`/
 * `saveSettings` field-by-field.
 */
import type { StorageLike } from '../brigade-account';

/** What the strip needs to decide, gathered once by `main.ts` per render. */
export interface HintFacts {
  /** `renderer.selection.length`. */
  selected: number;
  /** `renderer.hoverEntity >= 0` -- the same signal the cursor resolver
   *  already treats as "over a hostile" (`main.ts`'s own `hints.hostile`). */
  hoveringHostile: boolean;
  /** Has this player already been shown projected fire long enough to have
   *  used it once (`loadSeen(...).projectedFire`)? */
  sawProjectedFire: boolean;
  /** Has this player already used the dock once (`loadSeen(...).dock`)? */
  sawDock: boolean;
  /** `mission?.resources !== undefined` -- a sandbox or a mission with no
   *  economy has no dock to teach, so naming it would be a lie. */
  dockAvailable: boolean;
}

export interface HintLine {
  key: string;
  params?: Readonly<Record<string, string | number>>;
}

/**
 * A priority list, not a set of independent conditions: two first-use hints
 * can be owed at once (a first-time player hovering a hostile on a
 * dock-bearing mission who has used neither), and the strip is one line, so
 * exactly one wins. Projected fire outranks the dock because it is the more
 * time-sensitive of the two -- it is only on screen while the cursor sits
 * over this one target, where the dock waits for the player at their own
 * pace. Below both first-use hints, "something is selected" no longer hides
 * the line at all (the inversion this task exists for): it says so, then
 * only the base controls line remains for an empty selection.
 */
export function hintFor(f: HintFacts): HintLine | null {
  if (f.hoveringHostile && f.selected > 0 && !f.sawProjectedFire) {
    return { key: 'hud.hint.projectedFire' };
  }
  if (!f.sawDock && f.dockAvailable) {
    return { key: 'hud.hint.dock' };
  }
  if (f.selected > 0) {
    return { key: 'hud.hint.selected' };
  }
  return { key: 'hud.controlHint' };
}

export const FIRST_USE_KEY = 'lions.seen';

interface Seen {
  projectedFire: boolean;
  dock: boolean;
}

const unseen = (): Seen => ({ projectedFire: false, dock: false });

/** Guarded exactly the way `settings.ts:109-116`'s `loadSettings` guards its
 *  own store: a missing store, a blocked read, or JSON that is not the shape
 *  expected all fall back to "nothing seen yet" rather than throwing. */
export function loadSeen(store: StorageLike | null): { projectedFire: boolean; dock: boolean } {
  if (!store) return unseen();
  try {
    const raw = store.getItem(FIRST_USE_KEY);
    if (raw === null) return unseen();
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return unseen();
    const r = v as Record<string, unknown>;
    return {
      projectedFire: typeof r.projectedFire === 'boolean' ? r.projectedFire : false,
      dock: typeof r.dock === 'boolean' ? r.dock : false,
    };
  } catch {
    return unseen();
  }
}

/** Guarded exactly the way `settings.ts:118-124`'s `saveSettings` guards its
 *  own write: a blocked store keeps the flag in memory for this session only
 *  (`main.ts` mirrors it there), and nothing throws past this call. */
export function markSeen(store: StorageLike | null, what: 'projectedFire' | 'dock'): void {
  if (!store) return;
  try {
    const seen = loadSeen(store);
    seen[what] = true;
    store.setItem(FIRST_USE_KEY, JSON.stringify(seen));
  } catch {
    // A blocked store keeps this session's memory in-memory only; nothing to say.
  }
}
