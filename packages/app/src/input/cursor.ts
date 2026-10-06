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
import { ORDER_SIGHT, type SightOrderId } from '../ui/order-sight';

/** `advance` is the cursor over a hostile, and it was `attack` until WP-P4
 *  (PA-08). The rename is the point: a right-click over an enemy does not
 *  target it. Every plain order is `attackMove` to the TILE, and the sim's
 *  `selectTarget` picks what each unit shoots -- so a clicked AA truck could
 *  read "Engaging: Militia Cell". The sight it draws was always the
 *  attack-move graphic; the key `cursorKey()` reports, and the fire panel's
 *  footer line that reads it (`hud.fire.clickAdvances`), now say the same
 *  thing: advance there and engage. When the Stage 4 targeted-fire order
 *  (GH-420) lands, a real `attack` name comes back with it, for that order. */
export type CursorName =
  | 'default'
  | 'move'
  | 'advance'
  | 'blocked'
  | 'costly'
  | 'protected'
  | 'sweep'
  | 'strike'
  | 'garrison'
  | 'demolish'
  | 'charge'
  | 'mount'
  | 'dismount'
  | 'smoke'
  | 'pinned';

/** What the resolution cannot know, because resolvePointer never looks at
 *  enemy positions or tile passability. The caller has both already. */
export interface CursorHints {
  hostile: boolean;
  blocked: boolean;
  /** The smoke order is armed on the order row (`main.ts`'s `armedOrder`),
   *  so the next click lays a screen rather than giving the order under the
   *  pointer. Optional: every caller that has no armed order to report
   *  compiles, and reads, unchanged. */
  armedSmoke?: boolean;
  /** Every id of the order intent is pinned (GH-262): the click will be
   *  accepted and nobody will go, so the cursor says so before the click
   *  rather than the feed after it. Computed in `main.ts` from the order
   *  intent's own ids, never from the whole selection -- a pinned unit
   *  inside a demolish or garrison group is not this cursor's business. */
  pinned?: boolean;
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
export type UnbadgedName = 'default' | 'blocked' | 'costly' | 'protected' | 'sweep' | 'strike' | 'pinned';

export const UNBADGED_NAMES: ReadonlySet<CursorName> = new Set<UnbadgedName>([
  'default',
  'blocked',
  'costly',
  'protected',
  'sweep',
  'strike',
  // Describes the units' state, not who is acting: a whole order pinned
  // means nobody is, so a role badge would name an actor that does not move.
  'pinned',
]);

/** How many frames a cursor steps through, and how long each frame holds. */
export interface CursorAnimation {
  frames: number;
  /** Milliseconds each frame holds before the next one shows. */
  intervalMs: number;
}

/** Which approved G1 order sight each wired cursor name draws (Q2). `advance`
 *  is the attackMove sight -- a plain order over a hostile is an attack-move
 *  -- and the other four share their order's own id. `load`, `unload` and
 *  `halt` are drawn by the plugin but reach no cursor name: halt is instant,
 *  and load/unload come only from the keyboard path, whose result never
 *  reaches the hover ticker. */
const SIGHT_OF: Readonly<Partial<Record<CursorName, SightOrderId>>> = {
  move: 'move',
  advance: 'attackMove',
  sweep: 'sweep',
  strike: 'strike',
  smoke: 'smoke',
};

/** One sight's animation, read straight off `ORDER_SIGHT`: as many frames as
 *  it has phases, each held for an equal share of the order's approved
 *  period (Q14). */
const anim = (id: SightOrderId): CursorAnimation => ({
  frames: ORDER_SIGHT[id].phases.length,
  intervalMs: Math.round(ORDER_SIGHT[id].periodMs / ORDER_SIGHT[id].phases.length),
});

/** The cursor names that animate, and their frame count/rate -- the one
 *  table both the plugin (which draws `frames` distinct SVGs per name, keyed
 *  by a `data-cursor-frame` attribute) and main.ts's frame driver (which
 *  cycles `data-cursor-frame` on a `setInterval` of `intervalMs`) read, so
 *  the two can never disagree on how many frames exist.
 *
 *  WHICH names belong here is now the lead's approval rather than a rule
 *  derived from the sim. G1 round 4 (2026-09-28, "Use more war game
 *  symbols") gave every order cursor the same chevron stadia aim with that
 *  order's APP-6 tactical graphic animated around it, and round 5 ("Can you
 *  add more colors", APPROVED) coloured each by order family and kept round
 *  4's shapes, motion and periods. So the five wired sights -- `move`,
 *  `advance` (the attackMove sight), `sweep`, `strike` and `smoke` -- all
 *  animate, at the frame counts and periods `ORDER_SIGHT` carries, and this
 *  table is DERIVED from it rather than restating a number that could drift.
 *
 *  That reverses two things this comment used to say, and the reversal is
 *  recorded rather than silently dropped. It said a cursor animates only
 *  when the order it previews pins a unit to a spot while a sim timer runs
 *  (`demolish`'s `demolitionTicks`, `charge`'s `tunnelChargeTicks`), and it
 *  recorded `advance` as an admitted exception to that rule. And it recorded
 *  armed support as REJECTED: a targeting mode that covers every tile while
 *  armed, whose motion "would be constant and carry no per-tile information
 *  ... the 'a cursor that always moves is noise' failure". The lead looked
 *  at exactly that -- animated move, sweep and strike, drawn and recorded at
 *  true size in r4 and r5 -- and approved it. The motion is now the order's
 *  identity (what KIND of order the click gives), not a timer's; a still
 *  frame 0 remains the rest pose, the reduced-motion frame and the HUD's
 *  static mark (Q14).
 *
 *  `charge` and `demolish` keep the housing and its motion unchanged (Q1:
 *  G1 drew no sight for them), and their original reason still holds for
 *  them: each pins a unit on the spot while a named sim counter runs.
 *  `demolish`: 4 frames at 300ms -- a bone-white beacon rotates clockwise
 *  over the four corner plates above a core that never moves. `charge`: 4
 *  frames at 200ms -- a spark crawling down the fuse toward a buried
 *  satchel. See vite-plugin-cursors.ts's BEACON_SWEEP/CHARGE_SPARKS tables
 *  for the geometry. The sight rates follow `round(periodMs / frames)`, so
 *  the set now has more than two rates; that was accepted with the periods.
 *
 *  Driven from JS on a plain timer rather than a CSS `@keyframes` animation
 *  on `cursor` itself. What is actually known, restated in 2026-09-02 after a
 *  second session measured it from a new direction and got further than the
 *  first: a `@keyframes` animation with `steps()` timing DOES step the
 *  *computed* `cursor: url(...)` value over time, and so does this timer.
 *  Both were then re-measured against a REMOTE (http) cursor URL with a
 *  request log, and both fetch each frame's image on their own cadence with
 *  zero input events after the initial move. That is NOT the proof it looks
 *  like, and the control is why: an unhovered element's cursor image is
 *  fetched too, at load, with no pointer event ever -- so Blink loads a
 *  cursor image at style-resolution time, and a fetch is evidence of a style
 *  recalc, never of a pointer repaint. **The repaint past the style write
 *  therefore remains unproven for BOTH mechanisms** (macOS blocks
 *  `screencapture` on Screen Recording permission -- "could not create image
 *  from display" -- and CDP screenshots exclude the OS pointer by
 *  construction). Do not re-run the remote-URL probe expecting an answer; it
 *  cannot give one.
 *
 *  So the JS timer is kept for a smaller, honest reason than this comment
 *  used to give. It previously claimed the dataset write "inherits proven
 *  behaviour" from `updateHover`; that overclaims -- `updateHover`'s own
 *  repaint rests on exactly the same unverified step, and the measurement
 *  above shows `@keyframes` is not observably worse. It is kept because it is
 *  the mechanism already shipping, switching buys nothing measured, and the
 *  timer alone can hold the frame index in the DOM where `cursorKey()` and a
 *  test can read it back. If someone ever captures the real pointer and finds
 *  no repaint, the answer is to delete the animation, not to swap mechanisms. */
export const ANIMATED_CURSORS: Readonly<Partial<Record<CursorName, CursorAnimation>>> = {
  move: anim('move'),
  advance: anim('attackMove'),
  sweep: anim('sweep'),
  strike: anim('strike'),
  smoke: anim('smoke'),
  charge: { frames: 4, intervalMs: 200 },
  demolish: { frames: 4, intervalMs: 300 },
};

export { SIGHT_OF };

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
  if (has('order') && hints.hostile) return 'advance';
  if (has('garrison')) return 'garrison';
  if (has('mount')) return 'mount';
  if (has('dismount')) return 'dismount';
  if (has('smoke')) return 'smoke';
  return null;
}

export function cursorFor(res: Resolution, hints: CursorHints): CursorName {
  // Armed support outranks everything: it is what the pointer means, and it
  // fires with an empty selection, which is how pointerup always calls it.
  // The cursor names the call itself (Q3): sweep and strike draw different
  // sights, and res.armed already carries which one it is.
  if (res.armed) return res.armed;
  // An armed smoke order is the same argument one rung down (Q2): the next
  // click lays a screen whatever is under the pointer. Below armed support,
  // because only one of the two can spend the click and a support call is
  // armed from the production bar, deliberately.
  if (hints.armedSmoke) return 'smoke';
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
  // resolves that to 'advance' too (ordering decision 2), so 'advance' now
  // outranks costly and blocked as well, not only the six new verbs --
  // a click over impassable ground with a hostile hint reads 'advance', not
  // 'blocked'. Deliberate, and the reason cursor.test.ts's two
  // costly/blocked-vs-advance cases changed expectations in this same slice.
  const verb = winningVerb(res, hints);
  // Pinned (GH-262) replaces only the plain order's own names -- `advance`
  // here and `move` at the bottom -- because the hint speaks only for the
  // order intent's ids. Every rung above still outranks it, and so do
  // costly and blocked below, which describe the target rather than the
  // order. The order-intent check is belt and braces: `winningVerb` names
  // `advance` only for an order, and the final fallback is reached with one.
  const wholeOrderPinned = hints.pinned === true && res.intents.some((i) => i.kind === 'order');
  if (verb === 'advance' && wholeOrderPinned) return 'pinned';
  if (verb) return verb;
  if (res.roe === 'costly') return 'costly';
  if (hints.blocked) return 'blocked';
  if (wholeOrderPinned) return 'pinned';
  // winningVerb already returns 'advance' for a hostile plain order, so this
  // line is only reached when there are no intents of any ranked kind --
  // kept anyway, because an unranked future intent kind would otherwise fall
  // through to 'move' over a hostile.
  return hints.hostile ? 'advance' : 'move';
}

/** Whichever id field this intent's kind carries. Written explicitly rather
 *  than cast, because the variants genuinely differ -- `ids` for most kinds,
 *  `riders` for mount, `carriers` for dismount -- and a cast would silently
 *  return undefined for the two that don't have `ids`. */
export function idsOf(intent: PlayerIntent): number[] {
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
      return hints.hostile ? 'advance' : 'move';
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
  // because 'sweep' and 'strike' are in UNBADGED_NAMES below, but so this stays true
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
