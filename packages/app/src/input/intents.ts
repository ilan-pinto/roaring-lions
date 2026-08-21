/**
 * Player intents — what the player did, named.
 *
 * Two jobs. It gives the tutorial something to observe that is not sim state
 * (selection and overlay are UI facts the sim must never learn), and it makes
 * the input verbs testable, which they were not while every listener called
 * `sim.queueCommand` inline.
 *
 * No DOM here on purpose: tests run in `environment: 'node'`. Listeners build
 * intents; this module interprets them.
 */

import { fx, type Command } from '@lions/sim';

/** The narrow slice of Sim `applyIntent` needs — so a test can record instead
 *  of constructing a world. */
export interface CommandSink {
  queueCommand(cmd: Command): void;
}

export type PlayerIntent =
  | { kind: 'select'; ids: number[]; via: 'click' | 'box' | 'group' }
  | { kind: 'order'; verb: 'move' | 'attackMove'; ids: number[]; x: number; y: number; append: boolean }
  | { kind: 'garrison'; ids: number[]; structure: number }
  | { kind: 'demolish'; ids: number[]; structure: number }
  | { kind: 'chargeTunnel'; ids: number[]; tunnel: number }
  | { kind: 'mount'; riders: number[]; carrier: number }
  | { kind: 'dismount'; carriers: number[] }
  | { kind: 'smoke'; ids: number[]; x: number; y: number }
  | { kind: 'halt'; ids: number[] }
  | { kind: 'group'; slot: number; action: 'assign' | 'recall' }
  | { kind: 'overlay'; on: boolean }
  | { kind: 'support'; call: 'strike' | 'sweep'; x: number; y: number; accepted: boolean };

/** Every kind in the union. Kept as a value so data can be validated against
 *  it — a `type` alone cannot be iterated at runtime. */
export const INTENT_KINDS = [
  'select', 'order', 'garrison', 'demolish', 'chargeTunnel', 'mount', 'dismount',
  'smoke', 'halt', 'group', 'overlay', 'support',
] as const satisfies readonly PlayerIntent['kind'][];

/**
 * Issue the sim command an intent implies, if any.
 *
 * `select`, `overlay`, `group` and `support` produce nothing: selection and the
 * overlay are presentation, and a support call goes through MissionRuntime
 * rather than a raw command. The tutorial still sees them as intents.
 */
export function applyIntent(sink: CommandSink, intent: PlayerIntent): void {
  switch (intent.kind) {
    case 'order':
      sink.queueCommand({
        kind: intent.verb,
        ids: intent.ids,
        x: fx.from(intent.x),
        y: fx.from(intent.y),
        append: intent.append,
      });
      return;
    case 'garrison':
      sink.queueCommand({ kind: 'garrison', ids: intent.ids, structure: intent.structure });
      return;
    case 'demolish':
      sink.queueCommand({ kind: 'demolish', ids: intent.ids, structure: intent.structure });
      return;
    case 'chargeTunnel':
      sink.queueCommand({ kind: 'chargeTunnel', ids: intent.ids, tunnel: intent.tunnel });
      return;
    case 'mount':
      sink.queueCommand({ kind: 'load', ids: intent.riders, carrier: intent.carrier });
      return;
    case 'dismount':
      sink.queueCommand({ kind: 'unload', ids: intent.carriers });
      return;
    case 'smoke':
      sink.queueCommand({ kind: 'smoke', ids: intent.ids, x: fx.from(intent.x), y: fx.from(intent.y) });
      return;
    case 'halt':
      sink.queueCommand({ kind: 'halt', ids: intent.ids });
      return;
    case 'select':
    case 'group':
    case 'overlay':
    case 'support':
      return;
  }
}

/**
 * Sort a selection into one carrier and its passengers.
 *
 * Riders are chosen by `canEmbark`, never by "has no transport slots" — that
 * inversion is what put tanks in the passenger list and left the infantry
 * standing in the open.
 */
export function sortMount(
  ids: number[],
  isCarrier: (id: number) => boolean,
  canEmbark: (id: number) => boolean
): { carrier: number | undefined; riders: number[] } {
  return {
    carrier: ids.find(isCarrier),
    riders: ids.filter(canEmbark),
  };
}

/**
 * Sort a selection for a right-click on a building: who levels it, who enters
 * it, and who merely attacks toward it.
 *
 * Demolition is tested before garrison because a unit that can do both is a
 * sapper, and a sapper sent at a building is being sent to demolish it —
 * main.ts's rule, kept here so the split is one stated fact rather than three
 * filters that have to agree.
 *
 * `isProtected` is the mosque case (`roePenalty >= PROTECTED_ROE`), and it is
 * the whole reason this function exists. The sim already refuses to level a
 * protected site on a unit's own initiative; what it cannot refuse is an
 * explicit `demolish` order, because an explicit order is how the player takes
 * responsibility for the ROE bill. The bug was that an ambiguous click
 * manufactured that order — select the force, right-click east past a mosque to
 * advance, and the D9 in the selection took a 30-point demolish order while
 * everything else attack-moved, so it read as a move and cost a third of the
 * mission's ROE budget.
 *
 * So a protected site comes down only for a selection that is nothing but
 * demolishers. Isolating the engineers IS the act of taking responsibility, and
 * it needs no modifier key to say so. Any other selection and the demolishers
 * fall in with `rest`: the click becomes the move it looked like.
 */
export function sortStructureOrder(
  ids: number[],
  canDemolish: (id: number) => boolean,
  canGarrison: (id: number) => boolean,
  isProtected: boolean
): { razers: number[]; enterers: number[]; rest: number[] } {
  // Deliberate: every selected body can work a charge. An empty selection is
  // not deliberate — there is nobody to have decided anything.
  const deliberate = ids.length > 0 && ids.every((id) => canDemolish(id));
  const razeAllowed = !isProtected || deliberate;
  const razers: number[] = [];
  const enterers: number[] = [];
  const rest: number[] = [];
  for (const id of ids) {
    if (canDemolish(id)) (razeAllowed ? razers : rest).push(id);
    else if (canGarrison(id)) enterers.push(id);
    else rest.push(id);
  }
  return { razers, enterers, rest };
}
