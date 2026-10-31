/**
 * The combat-formation order from input (GH-859 P1a; the approved HUD mock, Q1-Q3).
 *
 * R, T and Y (or the formation row's buttons) arm a formation; the next click on open ground sends
 * it. The sim already places the units (`Command.move|attackMove` carry `formation`), so this is
 * only the resolver and the arming rule, and nothing else:
 *
 *  - the verb is the formation's own (attack rides `attackMove`, column and ambush ride `move`);
 *  - blocked or off-map ground is refused exactly as `resolveMoveOrder` refuses it;
 *  - below the formation's `min_members` free units the order degrades to the plain order with the
 *    `hud.formation.refused.tooFew` note, as the sim does;
 *  - in a versus room (`formationsOpen` false) nothing is sent and the versus reason is the note:
 *    formations are off there until P1b, so an armed formation can never produce an order intent.
 *
 * Pure: no DOM, no sim. `main.ts` owns the armed state and the dispatch; this file takes the
 * boolean from `formationsOpenIn` and never reads the room's mode itself.
 */
import { FM_CLASS_NONE } from '@lions/sim';
import { t } from '../i18n/t';
import { FORMATION_VERSUS_REASON_KEY } from '../net/versus-formations';
import { formationMinMembers, formationVerb, type FormationId, type FormationView } from '../ui/formation-model';
import { orderDenied, resolveMoveOrder, type IntentWorld, type OrderSink, type Resolution } from './intents';
import type { Action } from './keymap';

/** Who a formation order is handed: the selection less any unit inside a building, aboard a carrier,
 *  below ground or routed -- the sim leaves those out at accept time (a routed or carried unit is never
 *  gathered), so leaving them out here keeps the `min_members` count honest. */
export function formationIds(
  ids: readonly number[],
  garrisoned: (id: number) => boolean,
  carried: (id: number) => boolean,
  buried: (id: number) => boolean,
  routed: (id: number) => boolean
): number[] {
  return ids.filter((i) => !garrisoned(i) && !carried(i) && !buried(i) && !routed(i));
}

export interface FormationOrderContext {
  /** Already `formationIds`-filtered by the caller. */
  ids: number[];
  formation: FormationId;
  x: number;
  y: number;
  append: boolean;
  /** `formationsOpenIn(netConfig?.mode)`. */
  formationsOpen: boolean;
  /** The unit's formation class (`FM_CLASS_NONE` = none): the sim counts only classed units toward `min_members`, so the
   *  resolver does too, and the order degrades exactly when the sim would. */
  classOf: (id: number) => number;
}

/** How many of `ids` the sim would place in a formation: a unit of class none ignores the order. */
export function placeableCount(ids: readonly number[], classOf: (id: number) => number): number {
  let n = 0;
  for (const i of ids) if (classOf(i) !== FM_CLASS_NONE) n++;
  return n;
}

/** What a click means once a formation is armed. Pure, and the one decision for the click and the hover cursor. */
export function resolveFormationOrder(world: IntentWorld, ctx: FormationOrderContext): Resolution {
  const { ids, formation, x, y, append } = ctx;
  // The plain move's resolution decides the ground, the ROE tier and the empty selection; this
  // function only changes what an accepted click turns into.
  const base = resolveMoveOrder(world, { ids, x, y, append });
  if (!ctx.formationsOpen) {
    return { intents: [], roe: base.roe, marker: false, note: { text: t(FORMATION_VERSUS_REASON_KEY), tone: 'mute' } };
  }
  if (base.intents.length === 0) return base;
  const verb = formationVerb(formation);
  if (placeableCount(ids, ctx.classOf) < formationMinMembers(formation)) {
    return {
      ...base,
      intents: [{ kind: 'order', verb, ids, x, y, append }],
      note: { text: t('hud.formation.refused.tooFew'), tone: 'mute' },
    };
  }
  return { ...base, intents: [{ kind: 'order', verb, ids, x, y, append, formation }] };
}

/** Which formation a key arms, given the row the HUD is showing: the formation's id when its button
 *  is there and not inert, else null. Versus rooms (every button inert) and a selection too small for
 *  a row therefore arm nothing. */
export function armFormationKey(row: readonly FormationView[], action: Action): FormationId | null {
  const view = row.find((v) => v.key === action);
  return view !== undefined && !view.inert ? view.id : null;
}

/**
 * `issueMove` for an armed formation: resolve, dispatch every intent, show the note, drop the
 * marker, and say no. Shared by the left click, so the click and the hover cursor (which reads
 * `resolveFormationOrder` through `cursorAt`) are the same decision. The deny cue sounds when the
 * order came to nothing (`orderDenied`) AND when it degraded to the plain order for want of
 * members, since that click did not do what the armed button promised.
 */
export function issueFormation(world: IntentWorld, sink: OrderSink, ctx: FormationOrderContext): Resolution {
  const res = resolveFormationOrder(world, ctx);
  for (const intent of res.intents) sink.dispatch(intent);
  if (res.note) sink.note(res.note.text, res.note.tone);
  if (res.marker) sink.marker(ctx.x, ctx.y);
  const degraded = ctx.formationsOpen && res.intents.length > 0 && placeableCount(ctx.ids, ctx.classOf) < formationMinMembers(ctx.formation);
  if (degraded || orderDenied(res, ctx.ids.length)) sink.deny();
  return res;
}
