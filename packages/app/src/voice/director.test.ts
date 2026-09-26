import { describe, expect, it } from 'vitest';
import type { PlayerIntent } from '../input/intents';
import { cursorFor } from '../input/cursor';
import { INITIAL_DIRECTOR, VOICE_TIMING, decideOrder, gestureVerb, type DirectorLook, type DirectorState, type Gesture } from './director';
import type { OrderVerb, VoiceClass } from './lines';

const LANGS = { kdf: 'he', ashwar: 'ar', sarim: 'ar', rif: 'ar' };
const UNITS: Record<number, { faction: string; voice: VoiceClass } | undefined> = {
  1: { faction: 'kdf', voice: 'infantry' },
  2: { faction: 'kdf', voice: 'infantry' },
  3: { faction: 'kdf', voice: 'crew' },
  4: { faction: 'kdf', voice: 'crew' },
  5: { faction: 'kdf', voice: 'engineer' },
  6: { faction: 'kdf', voice: 'air' },
  7: { faction: 'civilian', voice: 'infantry' },
};
const look: DirectorLook = {
  unitOf: (id) => UNITS[id] ?? null,
  side: () => 0,
  pos: () => ({ x: 0, y: 0 }),
  isVisible: () => true,
  camera: () => ({ x: 0, y: 0 }),
};
const order = (...ids: number[]): PlayerIntent => ({ kind: 'order', verb: 'attackMove', ids, x: 10, y: 10, append: false });
const g = (intents: PlayerIntent[], hostile = false): Gesture => ({ intents, hostile });
const once = (gesture: Gesture) => decideOrder(INITIAL_DIRECTOR, gesture, look, LANGS, 0);
/** A running director: each call advances its state. */
function director() {
  let s: DirectorState = INITIAL_DIRECTOR;
  return (ms: number, gesture: Gesture): [string, string | null] => {
    const d = decideOrder(s, gesture, look, LANGS, ms);
    s = d.state;
    return [d.why, d.cue?.key ?? null];
  };
}

describe('one line per gesture, ranked by the cursor (N1, R-4)', () => {
  it('a right-click that demolishes, garrisons and attack-moves at once says one thing: the demolition', () => {
    const d = once(g([{ kind: 'demolish', ids: [5], structure: 9 }, { kind: 'garrison', ids: [1], structure: 9 }, order(3, 4)], true));
    expect(d.cue?.key).toBe('he.engineer.task');
    expect(d.cue?.priority).toBe('order');
    expect(d.cue?.at).toBeNull();
    expect(d.why).toBe('line');
  });

  const POINTER: [string, PlayerIntent[], boolean, OrderVerb, string][] = [
    ['a plain order over open ground', [order(1)], false, 'move', 'he.infantry.move'],
    ['a plain order over a hostile', [order(1)], true, 'attack', 'he.infantry.attack'],
    ['attack outranks garrison', [{ kind: 'garrison', ids: [1], structure: 2 }, order(3)], true, 'attack', 'he.crew.attack'],
    ['garrison outranks a plain move', [{ kind: 'garrison', ids: [1], structure: 2 }, order(3)], false, 'garrison', 'he.common.garrison'],
    ['charge outranks attack', [{ kind: 'chargeTunnel', ids: [5], tunnel: 1 }, order(1)], true, 'charge', 'he.common.charge'],
    ['mount', [{ kind: 'mount', riders: [1], carrier: 3 }], false, 'mount', 'he.common.mount'],
    ['dismount', [{ kind: 'dismount', carriers: [3] }], false, 'dismount', 'he.common.dismount'],
    ['smoke', [{ kind: 'smoke', ids: [3], x: 1, y: 1 }], false, 'smoke', 'he.common.smoke'],
  ];

  it.each(POINTER)('%s', (_label, intents, hostile, verb, key) => {
    const d = once(g(intents, hostile));
    expect(d.trigger).toBe(verb);
    expect(d.cue?.key).toBe(key);
  });

  it('says what the cursor shows, for every pointer gesture', () => {
    for (const [label, intents, hostile, verb] of POINTER) {
      const shown = cursorFor({ intents, roe: 'free', marker: false }, { hostile, blocked: false });
      expect(gestureVerb(g(intents, hostile))?.verb, label).toBe(shown);
      expect(shown, label).toBe(verb);
    }
  });

  it('halt, which only a key issues, has a line of its own', () => {
    expect(once(g([{ kind: 'halt', ids: [1, 2] }])).cue?.key).toBe('he.common.halt');
  });

  it('selection, groups, the overlay and support calls are silent, and so is an order for nobody', () => {
    for (const intents of [
      [{ kind: 'select', ids: [1], via: 'click' }],
      [{ kind: 'group', slot: 1, action: 'recall' }],
      [{ kind: 'overlay', on: true }],
      [{ kind: 'support', call: 'strike', x: 1, y: 1, accepted: true }],
      [order()],
    ] as PlayerIntent[][]) {
      const d = once(g(intents));
      expect(d.cue).toBeNull();
      expect(d.why).toBe('silent:unvoiced');
    }
  });
});

describe('the speaker (spec §2, R-5)', () => {
  it('is the class with the most units in the winning intent', () => {
    expect(once(g([order(1, 3, 4)])).cue?.key).toBe('he.crew.move');
  });
  it('breaks a tie by who was selected first', () => {
    expect(once(g([order(3, 1)])).cue?.key).toBe('he.crew.move');
    expect(once(g([order(1, 3)])).cue?.key).toBe('he.infantry.move');
  });
  it('engineers move as engineers and attack from the infantry pool', () => {
    expect(once(g([order(5)])).cue?.key).toBe('he.engineer.move');
    expect(once(g([order(5)], true)).cue?.key).toBe('he.infantry.attack');
    expect(once(g([order(6)])).cue?.key).toBe('he.air.move');
  });
  it('a faction with no language never speaks (D10)', () => {
    expect(once(g([order(7)])).why).toBe('silent:unvoiced');
  });
});

describe('the repeat window and the class cooldown (N2, N3, R-12, R-13)', () => {
  it('the same verb and selection: a line, an ack, then silence until 4 s from the first', () => {
    const at = director();
    expect(at(0, g([order(1, 2)]))).toEqual(['line', 'he.infantry.move']);
    expect(at(1000, g([order(2, 1)]))).toEqual(['ack:repeat', 'he.common.ack']); // same set, any order
    expect(at(2000, g([order(1, 2)]))).toEqual(['silent:repeat', null]);
    expect(at(3999, g([order(1, 2)]))).toEqual(['silent:repeat', null]);
    expect(at(VOICE_TIMING.repeatWindowMs, g([order(1, 2)]))).toEqual(['line', 'he.infantry.move']);
  });

  it('a different selection or verb is not a repeat', () => {
    const at = director();
    expect(at(0, g([order(1, 2)]))).toEqual(['line', 'he.infantry.move']);
    expect(at(5000, g([order(1)]))).toEqual(['line', 'he.infantry.move']);
    expect(at(10_000, g([order(1)], true))).toEqual(['line', 'he.infantry.attack']);
  });

  it('a class that spoke under 1.5 s ago answers from ack; another class answers in full', () => {
    const at = director();
    expect(at(0, g([order(1)]))).toEqual(['line', 'he.infantry.move']);
    expect(at(100, g([order(3)]))).toEqual(['line', 'he.crew.move']);
    expect(at(1000, g([order(2)], true))).toEqual(['ack:cooldown', 'he.common.ack']);
    expect(at(2499, g([order(1, 2)]))).toEqual(['ack:cooldown', 'he.common.ack']); // the ack at 1000 was speech too
    expect(at(4000, g([order(2)]))).toEqual(['line', 'he.infantry.move']);
  });

  it('the cooldown ends at exactly 1.5 s', () => {
    const at = director();
    expect(at(0, g([order(1)]))).toEqual(['line', 'he.infantry.move']);
    expect(at(VOICE_TIMING.classCooldownMs, g([order(2)]))).toEqual(['line', 'he.infantry.move']);
  });

  it('never mutates the state it is given', () => {
    expect(Object.isFrozen(INITIAL_DIRECTOR)).toBe(true);
    expect(Object.isFrozen(INITIAL_DIRECTOR.spoke)).toBe(true);
    expect(() => once(g([order(1)]))).not.toThrow();
    expect(INITIAL_DIRECTOR.run).toBeNull();
  });
});
