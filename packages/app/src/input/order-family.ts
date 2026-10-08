/**
 * VR-33: which order family an issued order belongs to, so the route and the
 * order marker it leaves on the ground wear the colour of the cursor that
 * issued it. Before this, every route and marker was tracer lime whatever the
 * order, so a move order was cyan as a cursor and lime on the ground.
 *
 * The family is decided by the CURSOR, not by the intent's verb: every plain
 * order is `attackMove` to the tile (`resolvePointer`), and what the player
 * was shown was `move` over open ground and `advance` (the attack-move sight)
 * over a hostile or with attack-move armed. `plainOrderSight` is that rule,
 * the same one `cursor.ts`'s `intentVerb` applies to an `order` intent.
 *
 * Colour is read from `ORDER_FAMILY_COLOR_KEY` (`ui/order-sight.ts`), the one
 * table the cursor's own `main` is drawn from, so the two cannot drift.
 */
import { ORDER_FAMILY_COLOR_KEY, ORDER_SIGHT, type OrderFamily } from '../ui/order-sight';
import type { PlayerIntent } from './intents';

/** The sight a plain order was issued under: the attack-move sight over a
 *  hostile or when the player armed attack-move, the move sight otherwise. */
export type PlainOrderSight = 'move' | 'attackMove';

export function plainOrderSight(hostile: boolean, armedAttackMove = false): PlainOrderSight {
  return hostile || armedAttackMove ? 'attackMove' : 'move';
}

/** The units one dispatched intent gives an order to, and the family their
 *  route now wears. `family` is null where that order's cursor is not a
 *  family sight -- garrison, demolish and charge draw a housing cursor in UI
 *  ink, not a palette key -- and those routes keep the overlay accent they
 *  always had. Null overall for an intent that orders no unit (select,
 *  group, overlay, support). */
export interface IntentRoute {
  readonly ids: readonly number[];
  readonly family: OrderFamily | null;
}

export function intentRoute(intent: PlayerIntent, plain: PlainOrderSight): IntentRoute | null {
  switch (intent.kind) {
    case 'order':
      return { ids: intent.ids, family: ORDER_SIGHT[plain].family };
    case 'smoke':
      return { ids: intent.ids, family: ORDER_SIGHT.smoke.family };
    case 'halt':
      return { ids: intent.ids, family: ORDER_SIGHT.halt.family };
    case 'mount':
      return { ids: intent.riders, family: ORDER_SIGHT.load.family };
    case 'dismount':
      return { ids: intent.carriers, family: ORDER_SIGHT.unload.family };
    case 'garrison':
    case 'demolish':
    case 'chargeTunnel':
      return { ids: intent.ids, family: null };
    case 'select':
    case 'group':
    case 'overlay':
    case 'support':
      return null;
  }
}

/** The family a click's order marker wears: its FIRST intent's, which is the
 *  one the cursor showed -- `resolvePointer` puts demolish, garrison and
 *  charge ahead of the attack-move for the rest, the same ranking
 *  `cursorFor` gives them. Null (the overlay accent) with no intent. */
export function markerFamily(intents: readonly PlayerIntent[], plain: PlainOrderSight): OrderFamily | null {
  const first = intents.length > 0 ? intentRoute(intents[0], plain) : null;
  return first?.family ?? null;
}

/** The palette key a family's route and marker draw in -- the same key its
 *  cursor's `main` is drawn in. Null means "no family": the renderer keeps
 *  its overlay accent. */
export function orderColorKey(family: OrderFamily | null): string | null {
  return family === null ? null : ORDER_FAMILY_COLOR_KEY[family];
}
