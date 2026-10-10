import { describe, expect, it } from 'vitest';
import type { PlayerIntent } from '../input/intents';
import { cursorFor } from '../input/cursor';
import {
  INITIAL_DIRECTOR,
  VOICE_TIMING,
  decideCalls,
  decideDeaths,
  decideOrder,
  gestureVerb,
  type DirectorLook,
  type DirectorState,
  type Gesture,
} from './director';
import type { OrderVerb, VoiceClass } from './lines';
import type { SimEvent } from '@lions/sim';

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
      // One deliberate difference in NAME, not in ranking (WP-P4, PA-08):
      // the cursor over a hostile is `advance`, because the click is an
      // attack-move to the tile, and the voice keeps its `attack` call.
      const said = shown === 'advance' ? 'attack' : shown;
      expect(gestureVerb(g(intents, hostile))?.verb, label).toBe(said);
      expect(said, label).toBe(verb);
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

describe('death calls (N6, N7, D6, D10)', () => {
  const DEATH_UNITS: Record<number, { faction: string; voice: VoiceClass } | undefined> = {
    ...UNITS,
    10: { faction: 'sarim', voice: 'crew' },
    11: { faction: 'ashwar', voice: 'infantry' },
    12: { faction: 'civilian', voice: 'infantry' },
    13: { faction: 'ashwar', voice: 'infantry' },
    14: { faction: 'ashwar', voice: 'infantry' },
  };
  const SIDE: Record<number, number> = { 10: 1, 11: 1, 12: 2, 13: 1, 14: 1 };
  const POS: Record<number, { x: number; y: number } | undefined> = {
    10: { x: 5, y: 5 }, 11: { x: 30, y: 0 }, 13: { x: 18, y: 0 }, 14: { x: 18.01, y: 0 },
  };
  const deathLook = (over: Partial<DirectorLook> = {}): DirectorLook => ({
    unitOf: (id) => DEATH_UNITS[id] ?? null,
    side: (id) => SIDE[id] ?? 0,
    pos: (id) => POS[id] ?? { x: 0, y: 0 },
    isVisible: () => true,
    camera: () => ({ x: 0, y: 0 }),
    ...over,
  });
  const destroyed = (entity: number): SimEvent => ({ kind: 'destroyed', tick: 1, entity, by: 99 });
  const removed = (entity: number, side: number): SimEvent => ({ kind: 'removed', tick: 1, entity, side });
  function deaths(lk: DirectorLook = deathLook()) {
    let s: DirectorState = INITIAL_DIRECTOR;
    return (ms: number, ...ids: number[]): [string, string | null][] => {
      const d = decideDeaths(s, ids.map(destroyed), lk, LANGS, ms);
      s = d.state;
      return d.notes.map((n) => [n.why, n.cue?.key ?? null]);
    };
  }

  it('a KDF death is a radio call from its class pool: unplaced, KDF priority', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(1)], deathLook(), LANGS, 0);
    expect(d.notes).toHaveLength(1);
    expect(d.notes[0]?.cue).toEqual({
      key: 'he.infantry.death', lang: 'he', speaker: 'infantry', trigger: 'death', priority: 'kdf_death', at: null,
    });
  });

  it('many KDF deaths in one tick are one call (N6)', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(1), destroyed(3), destroyed(5)], deathLook(), LANGS, 0);
    expect(d.notes.filter((n) => n.cue !== null).map((n) => n.cue?.key)).toEqual(['he.infantry.death']);
  });

  it('4 s per class and 2.5 s across all KDF (N6)', () => {
    const at = deaths();
    expect(at(0, 1)).toEqual([['line', 'he.infantry.death']]);
    expect(at(1000, 3)).toEqual([['silent:throttle', null]]); // global
    expect(at(2600, 1)).toEqual([['silent:throttle', null]]); // infantry's own 4 s
    expect(at(2600, 3)).toEqual([['line', 'he.crew.death']]);
    expect(at(4000, 1)).toEqual([['silent:throttle', null]]); // global, from 2600
    expect(at(5100, 1)).toEqual([['line', 'he.infantry.death']]);
  });

  it('a salvo whose first death is throttled still gets its one call from the next', () => {
    const at = deaths();
    expect(at(0, 1)).toEqual([['line', 'he.infantry.death']]);
    expect(at(2600, 1, 3)).toEqual([['silent:throttle', null], ['line', 'he.crew.death']]);
  });

  it('an enemy death speaks Arabic, placed where it fell, at enemy priority (D6, R-14)', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(10)], deathLook(), LANGS, 0);
    expect(d.notes[0]?.cue).toEqual({
      key: 'ar.crew.death', lang: 'ar', speaker: 'crew', trigger: 'death', priority: 'enemy_death', at: { x: 5, y: 5 },
    });
  });

  it('only when the player can see it, and within 18 tiles of the camera (N7)', () => {
    expect(deaths(deathLook({ isVisible: () => false }))(0, 10)).toEqual([['silent:unseen', null]]);
    expect(deaths()(0, 11)).toEqual([['silent:far', null]]);
    expect(deaths()(0, 13)).toEqual([['line', 'ar.infantry.death']]); // exactly 18
    expect(deaths()(0, 14)).toEqual([['silent:far', null]]);
  });

  it('one enemy call per 6 s (N7)', () => {
    const at = deaths();
    expect(at(0, 10)).toEqual([['line', 'ar.crew.death']]);
    expect(at(5999, 10)).toEqual([['silent:throttle', null]]);
    expect(at(VOICE_TIMING.enemyDeathGlobalMs, 10)).toEqual([['line', 'ar.crew.death']]);
  });

  it('a KDF death and an enemy death in one tick are two calls; the mixer arbitrates', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(10), destroyed(1)], deathLook(), LANGS, 0);
    expect(d.notes.map((n) => n.cue?.priority)).toEqual(['enemy_death', 'kdf_death']);
  });

  it('civilians and removals are silent, and leave no note (D10: an abduction is not a death)', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(12), removed(1, 0)], deathLook(), LANGS, 0);
    expect(d.notes).toEqual([]);
  });

  it('a death call is speech: it holds its class’s order cooldown too (R-12)', () => {
    const d = decideDeaths(INITIAL_DIRECTOR, [destroyed(1)], deathLook(), LANGS, 0);
    expect(decideOrder(d.state, g([order(2)]), look, LANGS, 500).why).toBe('ack:cooldown');
  });
});

describe('a move to a pinned unit answers "can’t move", never "moving" (GH-262)', () => {
  const PINNED = new Set([1, 3]);
  const pinLook: DirectorLook = { ...look, isPinned: (id) => PINNED.has(id) };
  const at = (s: DirectorState, ms: number, ...ids: number[]) => decideOrder(s, g([order(...ids)]), pinLook, LANGS, ms);

  it('speaks the pinned call, in the pinned unit’s voice, captioned', () => {
    const d = at(INITIAL_DIRECTOR, 0, 1);
    expect(d.cue).toMatchObject({
      key: 'he.common.pinned', trigger: 'pinned', priority: 'order', at: null, caption: 'voice.caption.pinned',
    });
    expect(d.why).toBe('line');
  });

  it('a mixed group speaks for the pinned part only', () => {
    expect(at(INITIAL_DIRECTOR, 0, 2, 3).cue?.speaker).toBe('crew'); // 2 is free infantry, 3 is pinned crew
  });

  it('an attack-move over a hostile takes the pinned call too', () => {
    expect(decideOrder(INITIAL_DIRECTOR, g([order(1)], true), pinLook, LANGS, 0).cue?.key).toBe('he.common.pinned');
  });

  it('garrison and the other verbs are untouched', () => {
    expect(decideOrder(INITIAL_DIRECTOR, g([{ kind: 'garrison', ids: [1], structure: 2 }]), pinLook, LANGS, 0).cue?.key).toBe(
      'he.common.garrison'
    );
  });

  it('a repeat inside pinnedRepeatMs is silent, and never "moving"', () => {
    const first = at(INITIAL_DIRECTOR, 0, 1);
    const again = at(first.state, VOICE_TIMING.pinnedRepeatMs - 1, 1);
    expect(again.why).toBe('silent:throttle');
    expect(again.cue).toBeNull();
    expect(at(first.state, VOICE_TIMING.pinnedRepeatMs, 1).why).toBe('line');
  });

  it('a different pinned selection inside pinnedGlobalMs is silent too', () => {
    const first = at(INITIAL_DIRECTOR, 0, 1);
    expect(at(first.state, VOICE_TIMING.pinnedGlobalMs - 1, 3).why).toBe('silent:throttle');
    expect(at(first.state, VOICE_TIMING.pinnedGlobalMs, 3).why).toBe('line');
  });

  it('a look with no isPinned behaves exactly as before', () => {
    expect(decideOrder(INITIAL_DIRECTOR, g([order(1)]), look, LANGS, 0).cue?.key).toBe('he.infantry.move');
  });
});

describe('decideCalls: ours report breaking and vehicle damage (pass C2/C4, A1)', () => {
  const routed = (entity: number): SimEvent => ({ kind: 'routed', tick: 0, entity }) as SimEvent;
  const component = (target: number, result: string): SimEvent =>
    ({ kind: 'component', tick: 0, target, result, overmatch: 0 }) as unknown as SimEvent;

  it('says broken, immobilised and gun out on the net, captioned, at the death calls’ priority', () => {
    const b = decideCalls(INITIAL_DIRECTOR, [routed(1)], look, LANGS, 0);
    expect(b.notes).toEqual([
      { why: 'line', cue: { key: 'he.common.broken', lang: 'he', speaker: 'infantry', trigger: 'broken', priority: 'kdf_death', at: null, caption: 'voice.caption.broken' } },
    ]);
    expect(decideCalls(INITIAL_DIRECTOR, [component(3, 'mobility_kill')], look, LANGS, 0).notes[0].cue?.key).toBe('he.common.immobilised');
    expect(decideCalls(INITIAL_DIRECTOR, [component(3, 'firepower_kill')], look, LANGS, 0).notes[0].cue?.key).toBe('he.common.gunout');
    expect(decideCalls(INITIAL_DIRECTOR, [component(3, 'combat_ineffective')], look, LANGS, 0).notes[0].cue?.key).toBe('he.common.gunout');
  });

  it('is silent for a shaken crew, an enemy, and a civilian', () => {
    expect(decideCalls(INITIAL_DIRECTOR, [component(3, 'crew_shaken')], look, LANGS, 0).notes).toEqual([]);
    const enemy: DirectorLook = { ...look, side: () => 1 };
    expect(decideCalls(INITIAL_DIRECTOR, [routed(1)], enemy, LANGS, 0).notes).toEqual([]);
    expect(decideCalls(INITIAL_DIRECTOR, [routed(7)], look, LANGS, 0).notes).toEqual([]);
  });

  it('speaks once a tick and throttles like the death calls', () => {
    const first = decideCalls(INITIAL_DIRECTOR, [routed(1), routed(2)], look, LANGS, 0);
    expect(first.notes.filter((n) => n.why === 'line')).toHaveLength(1);
    const soon = decideCalls(first.state, [routed(2)], look, LANGS, VOICE_TIMING.callGlobalMs - 1);
    expect(soon.notes).toEqual([{ why: 'silent:throttle', cue: null }]);
    const later = decideCalls(first.state, [routed(2)], look, LANGS, VOICE_TIMING.callGlobalMs);
    expect(later.notes[0].why).toBe('line');
    const sameUnit = decideCalls(first.state, [routed(1)], look, LANGS, VOICE_TIMING.callGlobalMs);
    expect(sameUnit.notes).toEqual([{ why: 'silent:throttle', cue: null }]);
  });
});
