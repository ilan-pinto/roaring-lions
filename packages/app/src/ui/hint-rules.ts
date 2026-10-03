// packages/app/src/ui/hint-rules.ts
/**
 * GH-345 follow-up: the data-driven half of the hint line. The nine-beat
 * tutorial dropped several lessons (box-select and waypoints, snipers, drones,
 * mounting, armour, groups, plus the logistics and intel counters); they come
 * back here as one-liners the first time the player meets the thing, listed in
 * `data/hints/first_use.json`.
 *
 * Everything in this file is pure. `ruleHolds` answers from a `HintContext`
 * `main.ts` builds from facts it already has; `owedRule` picks the first
 * unseen rule that holds; `createShownTimer` turns "was on screen for N
 * seconds" into the one moment a rule is marked seen. Memory is
 * `lions.seen.hints`, a list of rule ids, beside `lions.seen`
 * (`hint-model.ts`) and for the same reason NOT in settings.
 */
import type { FirstUseHintRule } from '@lions/data';
import type { StorageLike } from '../brigade-account';

/** The facts a rule may test. Anything costly is a thunk: it is only called
 *  for a rule that is still unseen and whose cheaper conditions already held. */
export interface HintContext {
  missionId: string;
  hasResources: boolean;
  selectedCount: number;
  selectedTypes: () => ReadonlySet<string>;
  forceSize: () => number;
  carrierEmptySeat: () => boolean;
  enemyPinned: () => boolean;
}

/** Every condition a rule declares must hold; a rule with none holds always. */
export function ruleHolds(r: FirstUseHintRule, c: HintContext): boolean {
  if (r.mission && !r.mission.includes(c.missionId)) return false;
  if (r.resources && !c.hasResources) return false;
  if (r.selected_over !== undefined && !(c.selectedCount > r.selected_over)) return false;
  if (r.selected_type) {
    const have = c.selectedTypes();
    if (!r.selected_type.some((t) => have.has(t))) return false;
  }
  if (r.force_over !== undefined && !(c.forceSize() > r.force_over)) return false;
  if (r.carrier_empty_seat && !c.carrierEmptySeat()) return false;
  if (r.enemy_pinned && !c.enemyPinned()) return false;
  return true;
}

/** The first rule, in file order, that is unseen and holds. */
export function owedRule(
  rules: readonly FirstUseHintRule[],
  seen: ReadonlySet<string>,
  c: HintContext
): FirstUseHintRule | null {
  for (const r of rules) {
    if (!seen.has(r.id) && ruleHolds(r, c)) return r;
  }
  return null;
}

export const HINTS_SEEN_KEY = 'lions.seen.hints';

/** Guarded like `loadSeen`: a missing or blocked store, or JSON that is not a
 *  string list, reads as "nothing seen yet" and never throws. */
export function loadHintsSeen(store: StorageLike | null): Set<string> {
  if (!store) return new Set();
  try {
    const raw = store.getItem(HINTS_SEEN_KEY);
    if (raw === null) return new Set();
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return new Set();
    return new Set(v.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function markHintSeen(store: StorageLike | null, id: string): void {
  if (!store) return;
  try {
    const s = loadHintsSeen(store);
    s.add(id);
    store.setItem(HINTS_SEEN_KEY, JSON.stringify([...s]));
  } catch {
    // Blocked store: `main.ts` keeps its in-memory set for this session.
  }
}

/**
 * Shown-once needs a definition of "shown": a hint that merely flashed past
 * taught nobody, and one that waits for the player to USE it would sit on the
 * line forever (the dock hint did, until a key press). A hint counts as shown
 * once it has been the line, continuously, for `windowMs`.
 * `tick(id, now)` returns the id exactly once, on the tick the window closes.
 */
export function createShownTimer(windowMs: number): { tick: (id: string | null, nowMs: number) => string | null } {
  let current: string | null = null;
  let since = 0;
  return {
    tick(id, nowMs) {
      if (id !== current) {
        current = id;
        since = nowMs;
        return null;
      }
      if (id !== null && nowMs - since >= windowMs) {
        current = null;
        return id;
      }
      return null;
    },
  };
}
