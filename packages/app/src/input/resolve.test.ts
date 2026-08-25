// The right-click decision, as a pure function.
//
// This tree lived inline in main.ts's contextmenu handler and had no tests at
// all. It is lifted here so slice 2's cursor can ask "what would this click
// do" and get the same answer the click gives -- two code paths would drift,
// and the failure mode is a cursor that promises what the click will not do.
import { describe, expect, it } from 'vitest';
import { resolvePointer, resolveKeyVerb, type IntentWorld } from './intents';

/** A world where nothing exists unless a test says it does. */
function emptyWorld(over: Partial<IntentWorld> = {}): IntentWorld {
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

describe('right-clicking open ground', () => {
  it('is one attack-move for the whole selection', () => {
    const r = resolvePointer(emptyWorld(), { ids: [1, 2], x: 4.5, y: 6.5, append: false, armed: null });
    expect(r.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [1, 2], x: 4.5, y: 6.5, append: false },
    ]);
    expect(r.marker).toBe(true);
    expect(r.roe).toBe('free');
  });

  it('passes Shift through as append — the waypoint rule', () => {
    const r = resolvePointer(emptyWorld(), { ids: [1], x: 1.5, y: 1.5, append: true, armed: null });
    expect(r.intents[0]).toMatchObject({ kind: 'order', append: true });
  });

  it('does nothing at all with an empty selection', () => {
    const r = resolvePointer(emptyWorld(), { ids: [], x: 1.5, y: 1.5, append: false, armed: null });
    expect(r.intents).toEqual([]);
    expect(r.marker).toBe(false);
  });
});

describe('right-clicking a building', () => {
  const world = (over: Partial<IntentWorld> = {}): IntentWorld =>
    emptyWorld({ structureAt: () => 7, garrisonFree: () => 2, ...over });

  it('splits a mixed selection three ways, in order', () => {
    const r = resolvePointer(
      world({ canDemolish: (i) => i === 1, canGarrison: (i) => i === 2 }),
      { ids: [1, 2, 3], x: 3.5, y: 3.5, append: false, armed: null }
    );
    expect(r.intents).toEqual([
      { kind: 'demolish', ids: [1], structure: 7 },
      { kind: 'garrison', ids: [2], structure: 7 },
      { kind: 'order', verb: 'attackMove', ids: [3], x: 3.5, y: 3.5, append: false },
    ]);
  });

  it('omits an empty group rather than dispatching it', () => {
    const r = resolvePointer(world({ canGarrison: () => true }), {
      ids: [2],
      x: 3.5,
      y: 3.5,
      append: false,
      armed: null,
    });
    expect(r.intents).toEqual([{ kind: 'garrison', ids: [2], structure: 7 }]);
  });

  it('ignores Shift for the rest-group order — append is always false here', () => {
    // main.ts hardcodes append: false in the structure branch and only passes
    // ev.shiftKey on the final fall-through. ctx.append: true must not leak
    // into the rest-group order.
    const r = resolvePointer(
      world({ canDemolish: (i) => i === 1 }),
      { ids: [1, 2], x: 3.5, y: 3.5, append: true, armed: null }
    );
    expect(r.intents).toEqual([
      { kind: 'demolish', ids: [1], structure: 7 },
      { kind: 'order', verb: 'attackMove', ids: [2], x: 3.5, y: 3.5, append: false },
    ]);
  });

  it('levels a protected site only for a selection that is all demolishers', () => {
    const pure = resolvePointer(
      world({ isProtected: () => true, structureRoePenalty: () => 30, canDemolish: () => true }),
      { ids: [1, 2], x: 3.5, y: 3.5, append: false, armed: null }
    );
    expect(pure.intents).toEqual([{ kind: 'demolish', ids: [1, 2], structure: 7 }]);
    expect(pure.roe).toBe('protected');
  });

  it('and turns the same click into a move when anything else is selected', () => {
    // The mosque bug: an ambiguous click past a protected site used to give
    // the D9 a 30-point demolish order while everything else attack-moved.
    const mixed = resolvePointer(
      world({ isProtected: () => true, structureRoePenalty: () => 30, canDemolish: (i) => i === 1 }),
      { ids: [1, 2], x: 3.5, y: 3.5, append: false, armed: null }
    );
    expect(mixed.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [1, 2], x: 3.5, y: 3.5, append: false },
    ]);
  });
});

describe('right-clicking an identified tunnel', () => {
  const tunnelWorld = (over: Partial<IntentWorld> = {}): IntentWorld =>
    emptyWorld({ tunnelAt: () => 3, ...over });

  it('sends charge teams and attack-moves everyone else', () => {
    const r = resolvePointer(tunnelWorld({ canTunnelCharge: (i) => i === 9 }), {
      ids: [9, 4],
      x: 8.5,
      y: 2.5,
      append: false,
      armed: null,
    });
    expect(r.intents).toEqual([
      { kind: 'chargeTunnel', ids: [9], tunnel: 3 },
      { kind: 'order', verb: 'attackMove', ids: [4], x: 8.5, y: 2.5, append: false },
    ]);
    expect(r.note?.tone).toBe('info');
  });

  it('falls through to an ordinary order when nobody can charge', () => {
    const r = resolvePointer(tunnelWorld(), { ids: [4], x: 8.5, y: 2.5, append: false, armed: null });
    expect(r.intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [4], x: 8.5, y: 2.5, append: false },
    ]);
    expect(r.note).toBeUndefined();
  });

  it('prefers the building when a structure and a tunnel share a tile', () => {
    // main.ts returns inside the structure branch, so the tunnel is never
    // reached. Pinned because it is invisible in the source.
    const r = resolvePointer(
      tunnelWorld({ structureAt: () => 7, canTunnelCharge: () => true, canGarrison: () => true }),
      { ids: [9], x: 8.5, y: 2.5, append: false, armed: null }
    );
    expect(r.intents[0]?.kind).toBe('garrison');
  });
});

describe('the ROE tier', () => {
  it('is free over open ground and over a zero-penalty structure', () => {
    expect(
      resolvePointer(emptyWorld(), { ids: [1], x: 1.5, y: 1.5, append: false, armed: null }).roe
    ).toBe('free');
    expect(
      resolvePointer(emptyWorld({ structureAt: () => 7, structureRoePenalty: () => 0 }), {
        ids: [1], x: 1.5, y: 1.5, append: false, armed: null,
      }).roe
    ).toBe('free');
  });

  it('is costly for a penalty below the protected threshold', () => {
    const r = resolvePointer(
      emptyWorld({ structureAt: () => 7, structureRoePenalty: () => 14 }),
      { ids: [1], x: 1.5, y: 1.5, append: false, armed: null }
    );
    expect(r.roe).toBe('costly');
  });

  it('is protected inside a flagged zone even on open ground', () => {
    const r = resolvePointer(emptyWorld({ inFlaggedZone: () => true }), {
      ids: [1], x: 1.5, y: 1.5, append: false, armed: null,
    });
    expect(r.roe).toBe('protected');
  });
});

describe('an armed support call', () => {
  // A building on the tile, and a non-empty selection that would otherwise
  // split into a demolish/garrison/order group -- so a resolution of
  // { intents: [], armed: 'sweep' } proves the arm branch pre-empts the
  // structure branch rather than merely agreeing with it on empty ground.
  const buildingWorld = (over: Partial<IntentWorld> = {}): IntentWorld =>
    emptyWorld({ structureAt: () => 7, canGarrison: () => true, ...over });

  it('reports the call and issues no order, even over a building', () => {
    const r = resolvePointer(buildingWorld(), {
      ids: [1, 2],
      x: 3.5,
      y: 3.5,
      append: false,
      armed: 'sweep',
    });
    expect(r.intents).toEqual([]);
    expect(r.marker).toBe(false);
    expect(r.armed).toBe('sweep');
  });

  it('the same building, unarmed, still gives the ordinary structure split', () => {
    const r = resolvePointer(buildingWorld(), {
      ids: [1, 2],
      x: 3.5,
      y: 3.5,
      append: false,
      armed: null,
    });
    expect(r.intents).toEqual([{ kind: 'garrison', ids: [1, 2], structure: 7 }]);
    expect(r.armed).toBeUndefined();
  });
});

describe('the keyboard verbs, resolved the same way', () => {
  const world = (over: Partial<IntentWorld> = {}): IntentWorld =>
    emptyWorld({ ...over }) as IntentWorld;

  it('mounts riders into the one carrier', () => {
    const r = resolveKeyVerb(world(), 'mount', {
      ids: [1, 2, 3],
      x: 0, y: 0,
      isCarrier: (i) => i === 1,
      canEmbark: (i) => i !== 1,
      canSmoke: () => false,
      passengerCount: () => 0,
    });
    expect(r.intents).toEqual([{ kind: 'mount', riders: [2, 3], carrier: 1 }]);
    expect(r.note?.tone).toBe('info');
  });

  it('explains itself when there is no carrier', () => {
    const r = resolveKeyVerb(world(), 'mount', {
      ids: [2, 3], x: 0, y: 0,
      isCarrier: () => false, canEmbark: () => true,
      canSmoke: () => false, passengerCount: () => 0,
    });
    expect(r.intents).toEqual([]);
    expect(r.note?.tone).toBe('mute');
  });

  it('dismounts only carriers that hold somebody', () => {
    const r = resolveKeyVerb(world(), 'dismount', {
      ids: [1, 2], x: 0, y: 0,
      isCarrier: () => true, canEmbark: () => false,
      canSmoke: () => false, passengerCount: (i) => (i === 1 ? 2 : 0),
    });
    expect(r.intents).toEqual([{ kind: 'dismount', carriers: [1] }]);
  });

  it('lays smoke at the point, from whoever carries it', () => {
    const r = resolveKeyVerb(world(), 'smoke', {
      ids: [4, 5], x: 9.5, y: 2.5,
      isCarrier: () => false, canEmbark: () => false,
      canSmoke: (i) => i === 4, passengerCount: () => 0,
    });
    expect(r.intents).toEqual([{ kind: 'smoke', ids: [4], x: 9.5, y: 2.5 }]);
    expect(r.marker).toBe(true);
  });

  it('says so when nothing selected carries smoke', () => {
    const r = resolveKeyVerb(world(), 'smoke', {
      ids: [5], x: 9.5, y: 2.5,
      isCarrier: () => false, canEmbark: () => false,
      canSmoke: () => false, passengerCount: () => 0,
    });
    expect(r.intents).toEqual([]);
    expect(r.marker).toBe(false);
    expect(r.note?.tone).toBe('mute');
  });
});
