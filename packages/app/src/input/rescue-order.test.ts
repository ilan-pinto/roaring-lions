/**
 * The rescue order from input (GH-707 P2): a medic in the selection and a
 * right-click on a wounded man is a `rescue` command, and the cursor reads
 * `rescue`. Oracles are literals. The sim half is a real `Sim` with test-only
 * types (no shipped JSON carries a wound field); the pixel pick is stubbed to
 * name one id, because the filter under test is `pointerPoint`'s.
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx, type Command, type UnitTypeJson } from '@lions/sim';
import { INTENT_KINDS, applyIntent, resolvePointer, type IntentWorld, type PlayerIntent } from './intents';
import { ANIMATED_CURSORS, CURSOR_ALIAS, SIGHT_OF, UNBADGED_NAMES, cursorFor, cursorKey, winningVerb, type CursorHints } from './cursor';
import { cursorAt, pointerPoint, simIntentWorld, type PointerView } from './pointer';

const HINTS: CursorHints = { hostile: false, blocked: false };

function fake(over: Partial<IntentWorld> = {}): IntentWorld {
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
    groundAt: () => 'open',
    flies: () => false,
    canFocus: () => false,
    focusHurts: () => false,
    canRescue: () => false,
    garrisoned: () => false,
    ...over,
  };
}
const click = (world: IntentWorld, ids: number[], extra: Record<string, unknown> = {}) =>
  resolvePointer(world, { ids, x: 5.5, y: 5.5, append: false, armed: null, confirm: false, wounded: 9, woundedAt: { x: 7.5, y: 8.5 }, ...extra });

describe('resolvePointer: the rescue rung', () => {
  const medicWorld = fake({ canRescue: (i) => i === 1 || i === 2 });
  it('sends the medics to the wounded man, and the rest attack-move to his tile (Q4)', () => {
    const r = click(medicWorld, [1, 2, 3]);
    expect(r.intents).toEqual([
      { kind: 'rescue', ids: [1, 2], target: 9 },
      { kind: 'order', verb: 'attackMove', ids: [3], x: 7.5, y: 8.5, append: false },
    ]);
    expect(r.marker).toBe(true);
    expect(r.at).toEqual({ x: 7.5, y: 8.5 });
  });
  it('an all-medic selection sends the rescue alone', () => {
    expect(click(medicWorld, [1, 2]).intents).toEqual([{ kind: 'rescue', ids: [1, 2], target: 9 }]);
  });
  it('a garrisoned unit in the rest keeps its post, silently (R-20)', () => {
    const w = fake({ canRescue: (i) => i === 1, garrisoned: (i) => i === 4 });
    const r = click(w, [1, 3, 4]);
    expect(r.intents).toEqual([
      { kind: 'rescue', ids: [1], target: 9 },
      { kind: 'order', verb: 'attackMove', ids: [3], x: 7.5, y: 8.5, append: false },
    ]);
    expect(r.note).toBeUndefined();
  });
  it('is not a rescue without a medic: the click falls through to the ordinary order', () => {
    const r = click(fake(), [3, 4]);
    expect(r.intents).toEqual([{ kind: 'order', verb: 'attackMove', ids: [3, 4], x: 5.5, y: 5.5, append: false }]);
  });
  it('outranks the hostile rung: a wounded ENEMY under a medic is a rescue, not a focus', () => {
    const w = fake({ canRescue: (i) => i === 1, canFocus: () => true, focusHurts: () => true });
    expect(click(w, [1, 3], { hostile: 9, hostileAt: { x: 7.5, y: 8.5 } }).intents).toEqual([
      { kind: 'rescue', ids: [1], target: 9 },
      { kind: 'order', verb: 'attackMove', ids: [3], x: 7.5, y: 8.5, append: false },
    ]);
  });
  it('a shift-click (append) keeps the queued attack-move, as the attack order does', () => {
    expect(click(medicWorld, [1], { append: true }).intents[0].kind).toBe('order');
  });
  it('no wounded under the pointer: unchanged', () => {
    expect(click(medicWorld, [1], { wounded: -1 }).intents[0].kind).toBe('order');
    expect(click(medicWorld, [1], { wounded: undefined }).intents[0].kind).toBe('order');
  });
});

describe('the rescue intent dispatches the rescue command', () => {
  it('queues { kind: rescue, ids, target } and is a registered intent kind', () => {
    const sent: Command[] = [];
    applyIntent({ queueCommand: (c) => sent.push(c) }, { kind: 'rescue', ids: [3, 4], target: 12 }, { width: 40, height: 40 });
    expect(sent).toEqual([{ kind: 'rescue', ids: [3, 4], target: 12 }]);
    expect(INTENT_KINDS).toContain('rescue');
  });
});

describe('the rescue cursor', () => {
  const rescue: PlayerIntent = { kind: 'rescue', ids: [1], target: 9 };
  const res = (roe: 'free' | 'protected' = 'free') => ({ intents: [rescue], roe, marker: true });
  it('reads rescue with the escort order beside it', () => {
    const escort: PlayerIntent = { kind: 'order', verb: 'attackMove', ids: [3], x: 7.5, y: 8.5, append: false };
    expect(cursorFor({ intents: [rescue, escort], roe: 'free', marker: true }, { ...HINTS, hostile: true })).toBe('rescue');
  });
  it('reads rescue, bare, whatever the ground says', () => {
    expect(cursorFor(res(), HINTS)).toBe('rescue');
    expect(cursorFor(res('protected'), HINTS)).toBe('rescue');
    expect(cursorFor(res(), { ...HINTS, hostile: true })).toBe('rescue');
    expect(cursorKey('rescue', 'soft')).toBe('rescue');
  });
  it('draws its own sight (no longer an alias of advance), animated at its own period, and is not a badged verb', () => {
    expect('rescue' in CURSOR_ALIAS).toBe(false);
    expect(SIGHT_OF.rescue).toBe('rescue');
    expect(ANIMATED_CURSORS.rescue).toEqual({ frames: 4, intervalMs: 325 });
    expect(UNBADGED_NAMES.has('rescue')).toBe(true);
    expect(winningVerb(res(), HINTS)).toBe('rescue');
  });
});

// The sim half ---------------------------------------------------------------

const BASE: UnitTypeJson = {
  id: 'ro_rifles', name: 'Rifles', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};
const MEDIC: UnitTypeJson = {
  ...BASE, id: 'ro_medic', abilities: ['rescue'],
  hull: { hp: 200, armor: { front: 10, side: 10, rear: 10 }, transport_slots: 1, can_carry: ['wounded'] },
  rescue: { radius_tiles: 8, treat_s: 6, drag_speed_mult: 0.5, carry_speed_mult: 0.75 },
};
const WOUNDED: UnitTypeJson = {
  id: 'ro_wounded', name: 'Wounded', role: 'wounded',
  hull: { hp: 30, armor: { front: 0, side: 0, rear: 0 }, can_embark: true },
  mobility: { speed_tiles_s: 0.12 },
  sensors: { optics: 0.5, sight_tiles: 0, signature: 0.3 },
};
const AMBULANCE: UnitTypeJson = {
  id: 'ro_amb', name: 'Amb', role: 'apc',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 }, transport_slots: 4, can_carry: ['wounded'] },
  mobility: { speed_tiles_s: 2 },
  sensors: { optics: 1, sight_tiles: 8 },
};

function sim() {
  const s = new Sim({ seed: 0x707, width: 24, height: 24, capacity: 32 });
  const t = new Map<string, number>();
  const put = (j: UnitTypeJson, side: number, x: number, y: number): number => {
    if (!t.has(j.id)) t.set(j.id, s.addUnitType(j));
    return s.spawn(t.get(j.id) as number, side, fx.from(x), fx.from(y));
  };
  return { s, put };
}
function viewFor(pick: number, visible = true): PointerView {
  return {
    screenToWorld: () => ({ x: 10.5, y: 10.5 }),
    structureAtScreen: () => -1,
    isVisible: () => visible,
    unitAtScreen: () => pick,
    viewer: 0,
  };
}

describe('pointerPoint: the wounded under the pixel', () => {
  it('names a wounded-role body of any side, and where he lies', () => {
    const { s, put } = sim();
    const own = put(WOUNDED, 0, 4.5, 6.5);
    const enemy = put(WOUNDED, 1, 8.5, 6.5);
    expect(s.state.woundState[own]).toBe(1);
    expect(pointerPoint(viewFor(own), s, 0, 0).wounded).toBe(own);
    expect(pointerPoint(viewFor(own), s, 0, 0).woundedAt).toEqual({ x: 4.5, y: 6.5 });
    expect(pointerPoint(viewFor(enemy), s, 0, 0).wounded).toBe(enemy);
  });
  it('refuses a standing rifleman, a dead man, a carried man and a body in the fog', () => {
    const { s, put } = sim();
    const rifle = put(BASE, 0, 4.5, 6.5);
    const w = put(WOUNDED, 0, 5.5, 6.5);
    expect(pointerPoint(viewFor(rifle), s, 0, 0).wounded).toBe(-1);
    expect(pointerPoint(viewFor(w, false), s, 0, 0).wounded).toBe(-1);
    const amb = put(AMBULANCE, 0, 6.5, 6.5);
    expect(s.embarkAtSpawn(amb, w)).toBe(true);
    expect(pointerPoint(viewFor(w), s, 0, 0).wounded).toBe(-1);
    const w2 = put(WOUNDED, 0, 5.5, 8.5);
    s.debugKill(w2);
    expect(pointerPoint(viewFor(w2), s, 0, 0).wounded).toBe(-1);
  });
  it('no pick at all is -1', () => {
    const { s } = sim();
    expect(pointerPoint(viewFor(-1), s, 0, 0).wounded).toBe(-1);
  });
});

describe('end to end through the real sim adapter', () => {
  it('a medic selected over a wounded man: the cursor key reads rescue; a rifleman alone reads advance', () => {
    const { s, put } = sim();
    const medic = put(MEDIC, 0, 3.5, 3.5);
    const rifle = put(BASE, 0, 3.5, 5.5);
    const w = put(WOUNDED, 1, 8.5, 6.5);
    // The sim's own gate: an enemy casualty must be known to the medic's side.
    const unknown = simIntentWorld(s, () => false).canRescue(medic, w);
    s.identifyTo(0, w);
    expect(unknown).toBe(false);
    const world = simIntentWorld(s, () => false);
    const p = pointerPoint(viewFor(w), s, 0, 0);
    const ctx = { armed: null, confirm: false, armedSmoke: false } as const;
    const read = cursorAt(s, world, p, { ids: [medic, rifle], ...ctx });
    expect(read.key).toBe('rescue');
    expect(read.res.intents).toEqual([
      { kind: 'rescue', ids: [medic], target: w },
      { kind: 'order', verb: 'attackMove', ids: [rifle], x: 8.5, y: 6.5, append: false },
    ]);
    expect(cursorAt(s, world, p, { ids: [rifle], ...ctx }).key).not.toBe('rescue');
  });
});
