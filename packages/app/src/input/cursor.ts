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
import type { PlayerIntent, Resolution } from './intents';
import type { RoleBucket } from '../ui/role';

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

/** Names that describe the target or the mode, never the actor: nothing
 *  "wins" a badge for these, because a badge would be answering a question
 *  nobody asked. Shared by three callers so they cannot drift the way
 *  `protected-soft` did (Critical 1, final cursor-slice-3 review) --
 *  `badgeFor` refuses to compute a badge for them, `cursorKey` refuses to
 *  compose one even if a caller passes one anyway, and the plugin's
 *  `BADGED_VERBS` is typed so one of these can never appear as a key at
 *  all. One rule, several callers -- the same pattern this milestone
 *  already uses for `zoneContains`, `roleBucket` and `cursorKey` itself. */
export type UnbadgedName = 'default' | 'blocked' | 'costly' | 'protected' | 'support';

export const UNBADGED_NAMES: ReadonlySet<CursorName> = new Set<UnbadgedName>([
  'default',
  'blocked',
  'costly',
  'protected',
  'support',
]);

/** The heaviest thing this click will cause, or null if it is a plain order.
 *
 *  One click can emit demolish, garrison and attack-move at once -- there is
 *  one cursor, so it names the worst outcome. The cost, stated: it hides that
 *  the other two groups are also acting. Ranking by the resolver's dispatch
 *  order instead would key the cursor to an implementation detail.
 *
 *  Deliberately has no `move` rung: a bare order must never win this
 *  ranking, or cursorFor's `costly` and `blocked` checks below it would
 *  never be reached for a hostile-free plain move. cursorFor names `move`
 *  itself, in its own final fallback -- and badgeFor no longer asks this
 *  function what the verb is at all; it matches the name cursorFor already
 *  chose against `intentVerb` instead, which does know about `move`. See
 *  that function's comment for why the two no longer share one ranking. */
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

/** Whichever id field this intent's kind carries. Written explicitly rather
 *  than cast, because the variants genuinely differ -- `ids` for most kinds,
 *  `riders` for mount, `carriers` for dismount -- and a cast would silently
 *  return undefined for the two that don't have `ids`. */
function idsOf(intent: PlayerIntent): number[] {
  switch (intent.kind) {
    case 'select':
    case 'order':
    case 'garrison':
    case 'demolish':
    case 'chargeTunnel':
    case 'smoke':
    case 'halt':
      return intent.ids;
    case 'mount':
      return intent.riders;
    case 'dismount':
      return intent.carriers;
    case 'group':
    case 'overlay':
    case 'support':
      return [];
  }
}

/** The name one intent alone would earn. Used by badgeFor to find which
 *  intent produced the name cursorFor already resolved -- including
 *  'move', which winningVerb deliberately has no rung for. The two
 *  functions now serve different jobs rather than mirroring one mapping:
 *  winningVerb ranks *across* intents, to decide what cursorFor's ranking
 *  shows; intentVerb names *one* intent, to decide which group badgeFor
 *  badges. 'move' only needs the latter -- a badge still has to find the
 *  mover even though winningVerb never lets 'move' win the ranking. */
function intentVerb(intent: PlayerIntent, hints: CursorHints): CursorName | null {
  switch (intent.kind) {
    case 'demolish':
      return 'demolish';
    case 'chargeTunnel':
      return 'charge';
    case 'order':
      return hints.hostile ? 'attack' : 'move';
    case 'garrison':
      return 'garrison';
    case 'mount':
      return 'mount';
    case 'dismount':
      return 'dismount';
    case 'smoke':
      return 'smoke';
    default:
      return null;
  }
}

/** How the caller turns a unit id into its display bucket. A port, so this
 *  module needs no sim import and a test can describe a selection. */
export interface BadgeHints {
  bucketOf(id: number): RoleBucket;
}

/** The bucket of the group behind `name` -- the CursorName `cursorFor`
 *  already resolved, not a second, independent guess. Two functions each
 *  computing "what verb is this" is how Critical 1 and Critical 2 shipped:
 *  `cursorFor` decided `protected` (the roe rung fires before the verb
 *  rung), while a second, independent `winningVerb` call still found a
 *  demolish intent underneath and badged it -- composing `protected-armour`,
 *  a key the plugin never generates a rule for, so the ROE warning silently
 *  fell back to the OS arrow. And `winningVerb` has no `move` rung at all
 *  (see its own comment), so a badge for a plain move was impossible by
 *  construction, even though the spec's whole coverage argument for
 *  ability-less units depends on one. There is now one decision, made once
 *  by `cursorFor`, and badgeFor only asks which intent produced it.
 *
 *  Null for the unbadged set (`UNBADGED_NAMES`) -- those describe the
 *  target or the mode, not the actor -- and null when no intent's
 *  `intentVerb` matches `name`, when the matched intent has no ids, or when
 *  the matched group spans buckets. A badge asserts "this kind of unit is
 *  doing this"; when it is not one kind, saying nothing beats picking one. */
export function badgeFor(
  res: Resolution,
  hints: CursorHints,
  badges: BadgeHints,
  name: CursorName
): RoleBucket | null {
  // Armed support always vetoes a badge on its own account -- not merely
  // because 'support' is in UNBADGED_NAMES below, but so this stays true
  // even if a future caller passes a name that disagrees with res.armed.
  if (res.armed) return null;
  if (UNBADGED_NAMES.has(name)) return null;
  const winner = res.intents.find((i) => intentVerb(i, hints) === name);
  const ids = winner ? idsOf(winner) : [];
  if (ids.length === 0) return null;
  const first = badges.bucketOf(ids[0]);
  return ids.every((id) => badges.bucketOf(id) === first) ? first : null;
}

/** `name` alone, or `name-badge`. The plugin generates a rule per key, and a
 *  test asserts both sides agree -- a mismatch here is silent, which is how
 *  slice 2 shipped a cursor that could never appear. Suppresses a badge on
 *  `UNBADGED_NAMES` even if a caller passes one anyway -- the same
 *  one-rule-two-callers guard `badgeFor` applies, kept here too because
 *  this is the last stop before a key reaches the DOM. */
export function cursorKey(name: CursorName, badge: RoleBucket | null): string {
  return badge && !UNBADGED_NAMES.has(name) ? `${name}-${badge}` : name;
}
