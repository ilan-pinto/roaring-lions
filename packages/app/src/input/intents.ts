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

/** How much a click here costs against the rules of engagement. Three tiers,
 *  because the data supports three: a mosque (30) is protected, an apartment
 *  (14) is costly, a wall (0) is free. */
export type RoeTier = 'free' | 'costly' | 'protected';

/** The narrow slice of the world the resolver needs — so a test can describe
 *  a situation instead of building a Sim, exactly as CommandSink does for
 *  applyIntent. No Sim import: intents.ts has no sim dependency and must not
 *  gain one. */
export interface IntentWorld {
  structureAt(x: number, y: number): number;
  tunnelAt(x: number, y: number): number;
  isProtected(structIdx: number): boolean;
  structureRoePenalty(structIdx: number): number;
  garrisonFree(structIdx: number): number;
  canDemolish(id: number): boolean;
  canGarrison(id: number): boolean;
  canTunnelCharge(id: number): boolean;
  /** Mission-declared no-fire zone. Wired in slice 2; false until then. */
  inFlaggedZone(x: number, y: number): boolean;
}

export interface PointerContext {
  /** Already filtered to living units on side 0 by the caller. */
  ids: number[];
  x: number;
  y: number;
  append: boolean;
  /**
   * The support call currently armed via the production bar, or null.
   * Required rather than optional on purpose: a caller must say what it
   * means, one way or the other, rather than inherit a default. Only
   * pointerup's left-click may pass a non-null value — it is the only click
   * that can spend an armed call. The right-click path (contextmenu) must
   * always pass null explicitly, or a right-click made while a call is
   * armed would silently consume it instead of issuing the ordinary order
   * it looks like.
   */
  armed: 'strike' | 'sweep' | null;
}

/** Everything the click does, as data: the intents to dispatch in order, the
 *  ROE tier of what is under the pointer, whether to drop an order marker,
 *  and any HUD note. */
export interface Resolution {
  intents: PlayerIntent[];
  roe: RoeTier;
  marker: boolean;
  note?: { text: string; tone: 'info' | 'mute' };
  /**
   * Set when `ctx.armed` was non-null: the pointer means "call for support
   * here." resolvePointer stops there rather than issuing an order, because
   * whether the runtime accepts the call is not knowable inside a pure
   * function — the caller (pointerup) still owns making the runtime call,
   * dispatching the `support` intent with the real outcome, and choosing the
   * note from it.
   */
  armed?: 'strike' | 'sweep';
}

/**
 * What a right-click here means.
 *
 * Lifted verbatim from main.ts's contextmenu handler so that one decision can
 * serve two callers: the click dispatches the result, and slice 2's cursor
 * draws it. Written as two code paths they would drift, and the failure mode
 * is a cursor that confidently promises an order the click does not issue.
 *
 * Order matters and is preserved: structure, then identified tunnel, then
 * ordinary attack-move. A structure wins a tile it shares with a tunnel
 * because the structure branch returns first. An armed support call outranks
 * all of it — checked before the empty-selection and structure branches, so
 * that a click over a building or with nothing selected still reports the
 * call rather than falling into either of those shapes.
 */
export function resolvePointer(world: IntentWorld, ctx: PointerContext): Resolution {
  const { ids, x, y, append, armed } = ctx;
  const roe = roeTierAt(world, x, y);
  if (armed) return { intents: [], roe, marker: false, armed };
  if (ids.length === 0) return { intents: [], roe, marker: false };

  const struct = world.structureAt(x, y);
  if (struct >= 0) {
    const { razers, enterers, rest } = sortStructureOrder(
      ids,
      (i) => world.canDemolish(i),
      (i) => world.canGarrison(i),
      world.isProtected(struct)
    );
    const intents: PlayerIntent[] = [];
    if (razers.length > 0) intents.push({ kind: 'demolish', ids: razers, structure: struct });
    if (enterers.length > 0) intents.push({ kind: 'garrison', ids: enterers, structure: struct });
    if (rest.length > 0) {
      intents.push({ kind: 'order', verb: 'attackMove', ids: rest, x, y, append: false });
    }
    return { intents, roe, marker: true };
  }

  const route = world.tunnelAt(x, y);
  if (route >= 0) {
    const chargers = ids.filter((i) => world.canTunnelCharge(i));
    if (chargers.length > 0) {
      const rest = ids.filter((i) => !world.canTunnelCharge(i));
      const intents: PlayerIntent[] = [{ kind: 'chargeTunnel', ids: chargers, tunnel: route }];
      if (rest.length > 0) {
        intents.push({ kind: 'order', verb: 'attackMove', ids: rest, x, y, append: false });
      }
      return {
        intents,
        roe,
        marker: true,
        note: { text: '<b>tunnel charge</b> — team moving to the route', tone: 'info' },
      };
    }
    // Nobody can charge: fall through to the ordinary order, as main.ts does.
  }

  return {
    intents: [{ kind: 'order', verb: 'attackMove', ids, x, y, append }],
    roe,
    marker: true,
  };
}

export interface KeyContext {
  ids: number[];
  /** Where the cursor is, for smoke. Ignored by mount and dismount. */
  x: number;
  y: number;
  isCarrier(id: number): boolean;
  canEmbark(id: number): boolean;
  canSmoke(id: number): boolean;
  passengerCount(id: number): number;
}

/**
 * The three verbs the keyboard owns, resolved through the same door as the
 * mouse. Their bindings are unchanged — g, u and f still trigger them. What
 * moves is the decision, so that slice 2's cursor can ask what `g` would do
 * right now instead of re-deriving the eligibility rules a second time.
 */
export function resolveKeyVerb(
  _world: IntentWorld,
  verb: 'mount' | 'dismount' | 'smoke',
  ctx: KeyContext
): Resolution {
  const free: RoeTier = 'free';
  if (verb === 'mount') {
    const { carrier, riders } = sortMount(ctx.ids, ctx.isCarrier, ctx.canEmbark);
    if (carrier === undefined || riders.length === 0) {
      return {
        intents: [],
        roe: free,
        marker: false,
        note: { text: 'select a transport and the infantry to load', tone: 'mute' },
      };
    }
    return {
      intents: [{ kind: 'mount', riders, carrier }],
      roe: free,
      marker: false,
      note: { text: '<b>mount up</b> — infantry boarding', tone: 'info' },
    };
  }
  if (verb === 'dismount') {
    const carriers = ctx.ids.filter((i) => ctx.passengerCount(i) > 0);
    if (carriers.length === 0) return { intents: [], roe: free, marker: false };
    return {
      intents: [{ kind: 'dismount', carriers }],
      roe: free,
      marker: false,
      note: { text: '<b>dismount</b> — infantry debussing', tone: 'info' },
    };
  }
  const smokers = ctx.ids.filter((i) => ctx.canSmoke(i));
  if (smokers.length === 0) {
    return {
      intents: [],
      roe: free,
      marker: false,
      note: { text: 'nothing selected that carries smoke', tone: 'mute' },
    };
  }
  return {
    intents: [{ kind: 'smoke', ids: smokers, x: ctx.x, y: ctx.y }],
    roe: free,
    marker: true,
  };
}

/** The tier of whatever is under the pointer. A mission-flagged zone is
 *  protected regardless of what stands on it. */
function roeTierAt(world: IntentWorld, x: number, y: number): RoeTier {
  if (world.inFlaggedZone(x, y)) return 'protected';
  const struct = world.structureAt(x, y);
  if (struct < 0) return 'free';
  if (world.isProtected(struct)) return 'protected';
  return world.structureRoePenalty(struct) > 0 ? 'costly' : 'free';
}
