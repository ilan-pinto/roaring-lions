/**
 * Which cursor a resolution means.
 *
 * The cursor is the click decision drawn instead of dispatched, so it reads
 * the same Resolution the click acts on. Anything it decided for itself would
 * be a second opinion, and the failure mode is a cursor that promises an order
 * the click will not issue.
 *
 * No DOM here: this module is pure and its tests run in environment: 'node'.
 */
import type { Resolution } from './intents';

export type CursorName =
  | 'default'
  | 'move'
  | 'attack'
  | 'blocked'
  | 'costly'
  | 'protected'
  | 'support';

/** What the resolution cannot know, because resolvePointer never looks at
 *  enemy positions or tile passability. The caller has both already. */
export interface CursorHints {
  hostile: boolean;
  blocked: boolean;
}

export function cursorFor(res: Resolution, hints: CursorHints): CursorName {
  // Armed support outranks everything: it is what the pointer means, and it
  // fires with an empty selection, which is how pointerup always calls it.
  if (res.armed) return 'support';
  // A protected structure gated the whole selection and the player has not
  // held Alt to override it: `intents` is empty here too, but for a second,
  // distinct reason from "nothing selected" -- this rung must come before
  // the empty-intents rung below, or the refusal reads as "nothing selected"
  // and the X never appears for the one case it exists to warn about.
  if (res.refused) return 'protected';
  // Nothing selected means nothing will happen. Warning about rules of
  // engagement over a click that cannot fire would be a lie.
  if (res.intents.length === 0) return 'default';
  if (res.roe === 'protected') return 'protected';
  if (res.roe === 'costly') return 'costly';
  if (hints.blocked) return 'blocked';
  return hints.hostile ? 'attack' : 'move';
}
