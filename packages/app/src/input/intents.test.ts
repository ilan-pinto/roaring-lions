import { describe, expect, it } from 'vitest';
import { fx, type Command } from '@lions/sim';
import {
  applyIntent,
  issueOrder,
  sortMount,
  sortStructureOrder,
  INTENT_KINDS,
  type CommandSink,
  type IntentWorld,
  type OrderSink,
  type PlayerIntent,
} from './intents';

/** Recording sink — `applyIntent` must not need a real Sim to be testable. */
function sink(): CommandSink & { out: Command[] } {
  const out: Command[] = [];
  return { out, queueCommand: (c: Command) => out.push(c) };
}

describe('applyIntent', () => {
  it('turns an attackMove order into one attackMove command', () => {
    const s = sink();
    applyIntent(s, { kind: 'order', verb: 'attackMove', ids: [1, 2], x: 4.5, y: 6.5, append: false });
    expect(s.out).toEqual([
      { kind: 'attackMove', ids: [1, 2], x: fx.from(4.5), y: fx.from(6.5), append: false },
    ]);
  });

  it('carries the append flag, so shift queues a route instead of replacing it', () => {
    const s = sink();
    applyIntent(s, { kind: 'order', verb: 'move', ids: [3], x: 1, y: 2, append: true });
    expect(s.out[0]).toMatchObject({ kind: 'move', append: true });
  });

  it('issues nothing for intents the sim has no command for', () => {
    // Selection, overlay and group recall are pure UI. If any of them reached
    // the sim, UI state would be influencing simulation (invariant 4).
    const s = sink();
    applyIntent(s, { kind: 'select', ids: [1], via: 'click' });
    applyIntent(s, { kind: 'overlay', on: true });
    applyIntent(s, { kind: 'group', slot: 2, action: 'recall' });
    expect(s.out).toEqual([]);
  });

  it('loads riders into the carrier on a mount intent', () => {
    const s = sink();
    applyIntent(s, { kind: 'mount', riders: [5, 6], carrier: 9 });
    expect(s.out).toEqual([{ kind: 'load', ids: [5, 6], carrier: 9 }]);
  });
});

describe('sortMount', () => {
  it('never puts a tank in the passenger list', () => {
    // The shipped bug this replaces: a box-select over an armoured force
    // loaded Merkavas into the APC and left the infantry behind, because
    // riders were filtered on "has no transport slots" rather than on
    // "can embark".
    const isCarrier = (i: number) => i === 1; // the APC
    const canEmbark = (i: number) => i >= 3; // infantry only
    expect(sortMount([1, 2, 3, 4], isCarrier, canEmbark)).toEqual({ carrier: 1, riders: [3, 4] });
  });

  it('reports no carrier when nothing selected can carry', () => {
    expect(sortMount([3, 4], () => false, () => true)).toEqual({ carrier: undefined, riders: [3, 4] });
  });

  it('reports no riders when nothing selected can embark', () => {
    expect(sortMount([1], (i) => i === 1, () => false)).toEqual({ carrier: 1, riders: [] });
  });
});

describe('INTENT_KINDS', () => {
  it('lists every kind in the PlayerIntent union', () => {
    // Task 5's step cross-check validates tutorial JSON against this list, so
    // a kind missing here becomes a step nobody can complete.
    const kinds: PlayerIntent['kind'][] = [
      'select', 'order', 'garrison', 'demolish', 'chargeTunnel', 'mount', 'dismount',
      'smoke', 'halt', 'group', 'overlay', 'support',
    ];
    expect([...INTENT_KINDS].sort()).toEqual([...kinds].sort());
  });
});

describe('chargeTunnel intent', () => {
  it('turns a tunnel-charge designation into one chargeTunnel command', () => {
    const s = sink();
    applyIntent(s, { kind: 'chargeTunnel', ids: [4], tunnel: 1 });
    expect(s.out).toEqual([{ kind: 'chargeTunnel', ids: [4], tunnel: 1 }]);
  });
});

// Right-clicking a building splits the selection three ways: demolishers level
// it, garrisoners enter it, everyone else attack-moves at it. That is fine for
// a shed and catastrophic for a hall.
//
// The sim already refuses to level a protected site on a unit's own initiative
// (`PROTECTED_ROE`, and the carve-outs in selectStructureTarget, the demolition
// auto-search, and selectBreachTarget). What it cannot refuse is an explicit
// `demolish` order, because an explicit order means the player accepted the
// bill. The trap was that the app manufactured that order out of an ambiguous
// click: select the whole force, right-click east past a hall to advance, and
// the D9 in the selection quietly took a demolish order worth 30 ROE while
// everything else attack-moved and it looked like a move.
//
// So a protected site is only ever ordered down by a selection that is nothing
// but demolishers -- isolating the engineers IS the act of taking
// responsibility. Anything else, and the click is a move.
describe('sortStructureOrder', () => {
  const DEMOLISHERS = new Set([10, 11]);
  const GARRISONERS = new Set([20, 21]);
  const canDemolish = (id: number) => DEMOLISHERS.has(id);
  const canGarrison = (id: number) => GARRISONERS.has(id);

  it('sends demolishers at an ordinary building even in a mixed selection', () => {
    const got = sortStructureOrder([10, 20, 30], canDemolish, canGarrison, false);
    expect(got).toEqual({ razers: [10], enterers: [20], rest: [30] });
  });

  it('refuses to level a protected site when the selection is not all demolishers', () => {
    const got = sortStructureOrder([10, 20, 30], canDemolish, canGarrison, true);
    expect(got.razers).toEqual([]);
  });

  it('attack-moves the demolisher instead, so the click reads as the move it was', () => {
    const got = sortStructureOrder([10, 30], canDemolish, canGarrison, true);
    expect(got).toEqual({ razers: [], enterers: [], rest: [10, 30] });
  });

  it('still lets garrisoners enter a protected site — going in harms nothing', () => {
    const got = sortStructureOrder([20, 30], canDemolish, canGarrison, true);
    expect(got).toEqual({ razers: [], enterers: [20], rest: [30] });
  });

  it('levels a protected site when every selected unit is a demolisher', () => {
    const got = sortStructureOrder([10, 11], canDemolish, canGarrison, true);
    expect(got).toEqual({ razers: [10, 11], enterers: [], rest: [] });
  });

  it('treats an empty selection as nothing to order', () => {
    const got = sortStructureOrder([], canDemolish, canGarrison, true);
    expect(got).toEqual({ razers: [], enterers: [], rest: [] });
  });
});

// --- carrying a right-click out, wherever it landed (Task 10) -------------
//
// The minimap became a control, and its right-click issues the same order the
// battlefield's does. `issueOrder` is the ONE place that happens: two
// implementations would be two answers to one question, and the one that
// would drift first is the protected-structure refusal, which is invisible on
// open ground and is exactly what a player right-clicking a clinic through
// the minimap would meet.

/** A world where nothing exists unless a test says it does. */
function world(over: Partial<IntentWorld> = {}): IntentWorld {
  return {
    structureAt: () => -1,
    tunnelAt: () => -1,
    isProtected: () => false,
    structureRoePenalty: () => 0,
    garrisonFree: () => 0,
    canDemolish: () => false,
    canGarrison: () => false,
    canTunnelCharge: () => false,
    inFlaggedZone: () => false,
    ...over,
  };
}

type Effect =
  | { did: 'dispatch'; intent: PlayerIntent }
  | { did: 'note'; text: string; tone: string }
  | { did: 'marker'; x: number; y: number };

/** Records the three things a resolved click can do, in the order it did
 *  them — the order matters, because a note explaining a refusal that arrived
 *  after the marker would read as a note about the next click. */
function orderSink(): OrderSink & { log: Effect[] } {
  const log: Effect[] = [];
  return {
    log,
    dispatch: (intent) => log.push({ did: 'dispatch', intent }),
    note: (text, tone) => log.push({ did: 'note', text, tone }),
    marker: (x, y) => log.push({ did: 'marker', x, y }),
  };
}

describe('issueOrder', () => {
  it('dispatches the resolution, then notes it, then drops the marker', () => {
    const s = orderSink();
    const res = issueOrder(world(), s, [1, 2], 4.5, 6.5, { append: false, confirm: false });
    expect(res.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [1, 2], x: 4.5, y: 6.5, append: false },
    ]);
    expect(s.log).toEqual([
      { did: 'dispatch', intent: res.intents[0] },
      { did: 'marker', x: 4.5, y: 6.5 },
    ]);
  });

  it('carries append through, so shift from either surface queues a route', () => {
    const s = orderSink();
    issueOrder(world(), s, [1], 1, 2, { append: true, confirm: false });
    expect(s.log[0]).toMatchObject({ did: 'dispatch', intent: { append: true } });
  });

  // The falsification target. An order that reached the sim without going
  // through `resolvePointer` would queue an attack on a clinic and report
  // nothing, and NOTHING else in this tree would notice: the ROE deduction
  // lands minutes later, in the debrief.
  it('refuses a protected structure, dispatches nothing, and says why', () => {
    const s = orderSink();
    const res = issueOrder(
      world({ structureAt: () => 7, isProtected: () => true }),
      s,
      [1],
      3.5,
      3.5,
      { append: false, confirm: false }
    );
    expect(res.intents).toEqual([]);
    expect(res.refused).toBe(true);
    expect(res.roe).toBe('protected');
    expect(s.log.filter((e) => e.did === 'dispatch')).toEqual([]);
    expect(s.log.filter((e) => e.did === 'marker')).toEqual([]);
    expect(s.log.filter((e) => e.did === 'note')).toHaveLength(1);
  });

  it('honours confirm, so Alt is the override on both surfaces alike', () => {
    const s = orderSink();
    const res = issueOrder(
      world({ structureAt: () => 7, isProtected: () => true }),
      s,
      [1],
      3.5,
      3.5,
      { append: false, confirm: true }
    );
    expect(res.refused).toBeUndefined();
    expect(res.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [1], x: 3.5, y: 3.5, append: false },
    ]);
    expect(s.log.filter((e) => e.did === 'dispatch')).toHaveLength(1);
  });

  it('never spends an armed support call', () => {
    // Only pointerup's left click may do that. A right-click made while a
    // call is armed must give the ordinary order it looks like, whichever
    // surface it arrived on — and `issueOrder` is the reason neither surface
    // gets to decide that for itself.
    const s = orderSink();
    const res = issueOrder(world(), s, [1], 2, 2, { append: false, confirm: false });
    expect(res.armed).toBeUndefined();
  });

  it('does nothing at all with an empty selection', () => {
    const s = orderSink();
    const res = issueOrder(world(), s, [], 2, 2, { append: false, confirm: false });
    expect(res.intents).toEqual([]);
    expect(s.log).toEqual([]);
  });

  /**
   * DISCLOSED: this one cannot fail on its own, and that is the point of it
   * rather than an oversight. It compares one function with itself, because
   * one function is exactly what the minimap and the battlefield now share --
   * there is no second implementation left for it to disagree with. It is
   * kept as the written-down statement of the contract the tests above
   * actually gate; the mutation that reddens the pair is a change to
   * `issueOrder` (proved against the protected-structure case above), not a
   * change to this.
   */
  it('gives the field and the minimap the identical order for the same tile', () => {
    const ev = { shiftKey: true, altKey: false };
    const w = world({ structureAt: () => 7, isProtected: () => true });
    const field = orderSink();
    const minimap = orderSink();
    const a = issueOrder(w, field, [1, 2], 4.5, 6.5, { append: ev.shiftKey, confirm: ev.altKey });
    const b = issueOrder(w, minimap, [1, 2], 4.5, 6.5, { append: ev.shiftKey, confirm: ev.altKey });
    expect(b).toEqual(a);
    expect(minimap.log).toEqual(field.log);
  });
});
