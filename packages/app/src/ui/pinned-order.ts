/**
 * The order-feedback line (GH-262): when a player orders a pinned or broken
 * unit, the feed says why it waits rather than staying silent while the unit
 * appears to ignore the command.
 *
 * Pure, like `alerts.ts` beside it: no DOM, no `t()`, no clock of its own.
 * Returns catalogue keys and params; the caller resolves them (`alertNotice`
 * in `mission-notice.ts`) and supplies `nowMs`.
 */

import type { PlayerIntent } from '../input/intents';
import type { AlertLine } from './alerts';

/** How long the same pinned-id set stays silent after making the feed. */
export const PINNED_NOTE_MS = 4000;

/** The narrow slice of world state the rule needs, so a test supplies three
 *  functions rather than a `Sim`. */
export interface PinnedOrderWorld {
  pinned(id: number): boolean;
  routed(id: number): boolean;
  soft(id: number): boolean;
}

/** What has to survive between orders: when each pinned-id set last made the
 *  feed, keyed by the sorted, comma-joined id list. */
export interface PinnedNoteState {
  readonly bySel: Readonly<Record<string, number>>;
}

export const INITIAL_PINNED_NOTE: PinnedNoteState = { bySel: {} };

export function pinnedOrderNote(
  s: PinnedNoteState,
  intent: PlayerIntent,
  w: PinnedOrderWorld,
  nowMs: number
): { state: PinnedNoteState; line: AlertLine | null } {
  if (intent.kind !== 'order') return { state: s, line: null };

  const routedIds = intent.ids.filter((id) => w.routed(id));
  if (routedIds.length > 0) {
    return { state: s, line: { key: 'order.broken.note', params: { n: routedIds.length }, tone: 'bad' } };
  }

  const pinnedIds = intent.ids.filter((id) => w.pinned(id));
  if (pinnedIds.length === 0) return { state: s, line: null };

  const sel = [...pinnedIds].sort((a, b) => a - b).join(',');
  const last = s.bySel[sel];
  if (last !== undefined && nowMs - last < PINNED_NOTE_MS) return { state: s, line: null };

  const soft = pinnedIds.some((id) => w.soft(id));
  const key = soft ? 'order.pinned.note.soft' : 'order.pinned.note';
  return {
    state: { bySel: { ...s.bySel, [sel]: nowMs } },
    line: { key, params: { n: pinnedIds.length }, tone: 'warn' },
  };
}
