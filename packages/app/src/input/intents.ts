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
