import { describe, expect, it } from 'vitest';
import { fx, type Command } from '@lions/sim';
import { applyIntent, sortMount, INTENT_KINDS, type CommandSink, type PlayerIntent } from './intents';

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
      'select', 'order', 'garrison', 'mount', 'dismount',
      'smoke', 'halt', 'group', 'overlay', 'support',
    ];
    expect([...INTENT_KINDS].sort()).toEqual([...kinds].sort());
  });
});
