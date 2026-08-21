import { describe, expect, it } from 'vitest';
import { fx, type Command } from '@lions/sim';
import {
  applyIntent,
  sortMount,
  sortStructureOrder,
  INTENT_KINDS,
  type CommandSink,
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
// a shed and catastrophic for a mosque.
//
// The sim already refuses to level a protected site on a unit's own initiative
// (`PROTECTED_ROE`, and the carve-outs in selectStructureTarget, the demolition
// auto-search, and selectBreachTarget). What it cannot refuse is an explicit
// `demolish` order, because an explicit order means the player accepted the
// bill. The trap was that the app manufactured that order out of an ambiguous
// click: select the whole force, right-click east past a mosque to advance, and
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
