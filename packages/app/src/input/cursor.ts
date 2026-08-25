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
  | 'support'
  | 'garrison'
  | 'demolish'
  | 'charge'
  | 'mount'
  | 'dismount'
  | 'smoke';

/** What the resolution cannot know, because resolvePointer never looks at
 *  enemy positions or tile passability. The caller has both already. */
export interface CursorHints {
  hostile: boolean;
  blocked: boolean;
}

/** The heaviest thing this click will cause, or null if it is a plain order.
 *
 *  One click can emit demolish, garrison and attack-move at once -- there is
 *  one cursor, so it names the worst outcome. The cost, stated: it hides that
 *  the other two groups are also acting. Ranking by the resolver's dispatch
 *  order instead would key the cursor to an implementation detail. */
export function winningVerb(res: Resolution, hints: CursorHints): CursorName | null {
  const has = (kind: string): boolean => res.intents.some((i) => i.kind === kind);
  if (has('demolish')) return 'demolish';
  if (has('chargeTunnel')) return 'charge';
  if (has('order') && hints.hostile) return 'attack';
  if (has('garrison')) return 'garrison';
  if (has('mount')) return 'mount';
  if (has('dismount')) return 'dismount';
  if (has('smoke')) return 'smoke';
  return null;
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
  // The verb outranks costly: a house is a blocked tile with a non-zero
  // roe_penalty, so without this a dozer over a house would read "costly"
  // instead of "demolish" -- true, milder, and useless beside "you are about
  // to level this." This also reaches a hostile plain order: winningVerb
  // resolves that to 'attack' too (ordering decision 2), so 'attack' now
  // outranks costly and blocked as well, not only the six new verbs --
  // a click over impassable ground with a hostile hint reads 'attack', not
  // 'blocked'. Deliberate, and the reason cursor.test.ts's two
  // costly/blocked-vs-attack cases changed expectations in this same slice.
  const verb = winningVerb(res, hints);
  if (verb) return verb;
  if (res.roe === 'costly') return 'costly';
  if (hints.blocked) return 'blocked';
  // winningVerb already returns 'attack' for a hostile plain order, so this
  // line is only reached when there are no intents of any ranked kind --
  // kept anyway, because an unranked future intent kind would otherwise fall
  // through to 'move' over a hostile.
  return hints.hostile ? 'attack' : 'move';
}
