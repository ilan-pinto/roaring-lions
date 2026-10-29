/**
 * The formation order from input (GH-859 P1a). Oracles are literals; the world is a fake and the
 * sim half is the recording sink `applyIntent` writes to.
 */
import { describe, expect, it } from 'vitest';
import { fx, type Command } from '@lions/sim';
import { formationRow, type FormationUnitFact } from '../ui/formation-model';
import { armFormationKey, formationIds, resolveFormationOrder, type FormationOrderContext } from './formation';
import { applyIntent, type IntentWorld } from './intents';
import { ACTIONS, bindingsFrom, rebind, resolveKey } from './keymap';

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
    groundAt: () => 'open',
    flies: () => false,
    canFocus: () => false,
    focusHurts: () => false,
    canRescue: () => false,
    garrisoned: () => false,
    ...over,
  };
}
const ctx = (over: Partial<FormationOrderContext> = {}): FormationOrderContext => ({
  ids: [1, 2, 3],
  formation: 'column',
  x: 6.5,
  y: 7.5,
  append: false,
  formationsOpen: true,
  ...over,
});

describe('who is handed a formation', () => {
  it('leaves out a unit in a building, aboard a carrier or below ground', () => {
    expect(formationIds([1, 2, 3, 4, 5], (i) => i === 2, (i) => i === 3, (i) => i === 4)).toEqual([1, 5]);
    expect(formationIds([1, 2], () => false, () => false, () => false)).toEqual([1, 2]);
    expect(formationIds([], () => false, () => false, () => false)).toEqual([]);
  });
});

describe('resolveFormationOrder: the verb the formation rides on', () => {
  it('column and ambush send a move; attack sends an attack-move', () => {
    expect(resolveFormationOrder(world(), ctx({ formation: 'column' })).intents).toEqual([
      { kind: 'order', verb: 'move', ids: [1, 2, 3], x: 6.5, y: 7.5, append: false, formation: 'column' },
    ]);
    expect(resolveFormationOrder(world(), ctx({ formation: 'ambush' })).intents).toEqual([
      { kind: 'order', verb: 'move', ids: [1, 2, 3], x: 6.5, y: 7.5, append: false, formation: 'ambush' },
    ]);
    expect(resolveFormationOrder(world(), ctx({ formation: 'attack' })).intents).toEqual([
      { kind: 'order', verb: 'attackMove', ids: [1, 2, 3], x: 6.5, y: 7.5, append: false, formation: 'attack' },
    ]);
  });

  it('Shift appends', () => {
    const res = resolveFormationOrder(world(), ctx({ formation: 'attack', append: true }));
    expect(res.intents).toEqual([{ kind: 'order', verb: 'attackMove', ids: [1, 2, 3], x: 6.5, y: 7.5, append: true, formation: 'attack' }]);
    expect(res.marker).toBe(true);
    expect(res.note).toBeUndefined();
  });
});

describe('resolveFormationOrder: ground', () => {
  it('refuses blocked ground as the plain move does', () => {
    const res = resolveFormationOrder(world({ groundAt: () => 'blocked' }), ctx());
    expect(res.intents).toEqual([]);
    expect(res.groundRefused).toBe('blocked');
    expect(res.marker).toBe(false);
    expect(res.note?.text).toBe('that ground is impassable — pick open ground to move there');
  });

  it('refuses the edge of the map', () => {
    const res = resolveFormationOrder(world({ groundAt: () => 'offmap' }), ctx());
    expect(res.intents).toEqual([]);
    expect(res.groundRefused).toBe('offmap');
  });

  it('a flyer in the selection keeps the order over rock, as for a plain move', () => {
    const res = resolveFormationOrder(world({ groundAt: () => 'blocked', flies: (i) => i === 2 }), ctx());
    expect(res.intents).toHaveLength(1);
  });

  it('sends nothing for nobody', () => {
    expect(resolveFormationOrder(world(), ctx({ ids: [] })).intents).toEqual([]);
  });
});

describe('resolveFormationOrder: too few free units', () => {
  it('degrades to the plain order with a note below min_members', () => {
    const res = resolveFormationOrder(world(), ctx({ ids: [9], formation: 'attack' }));
    expect(res.intents).toEqual([{ kind: 'order', verb: 'attackMove', ids: [9], x: 6.5, y: 7.5, append: false }]);
    expect(res.intents[0]).not.toHaveProperty('formation');
    expect(res.note).toEqual({ text: 'Too few free units for a formation — the order goes without one', tone: 'mute' });
    expect(res.marker).toBe(true);
  });

  it('two units are enough', () => {
    const res = resolveFormationOrder(world(), ctx({ ids: [4, 5], formation: 'ambush' }));
    expect(res.intents[0]).toMatchObject({ formation: 'ambush' });
    expect(res.note).toBeUndefined();
  });
});

describe('resolveFormationOrder: versus rooms (formations off until P1b)', () => {
  it('never yields an order intent, for any formation, with a note naming why', () => {
    for (const formation of ['column', 'attack', 'ambush'] as const) {
      const res = resolveFormationOrder(world(), ctx({ formation, formationsOpen: false }));
      expect(res.intents).toEqual([]);
      expect(res.marker).toBe(false);
      expect(res.note).toEqual({ text: 'Formations are not in versus rooms yet', tone: 'mute' });
    }
  });

  it('refuses before the ground does, and for a single unit too', () => {
    expect(resolveFormationOrder(world({ groundAt: () => 'blocked' }), ctx({ formationsOpen: false })).note?.text).toBe('Formations are not in versus rooms yet');
    expect(resolveFormationOrder(world(), ctx({ ids: [9], formationsOpen: false })).intents).toEqual([]);
  });
});

describe('applyIntent carries the formation to the sim command', () => {
  const sink = () => {
    const out: Command[] = [];
    return { out, queueCommand: (c: Command) => out.push(c) };
  };
  const MAP = { width: 48, height: 48 };

  it('copies formation onto a move and an attackMove', () => {
    const s = sink();
    applyIntent(s, { kind: 'order', verb: 'move', ids: [1, 2], x: 4.5, y: 6.5, append: false, formation: 'column' }, MAP);
    applyIntent(s, { kind: 'order', verb: 'attackMove', ids: [1, 2], x: 4.5, y: 6.5, append: true, formation: 'attack' }, MAP);
    expect(s.out).toEqual([
      { kind: 'move', ids: [1, 2], x: fx.from(4.5), y: fx.from(6.5), append: false, formation: 'column' },
      { kind: 'attackMove', ids: [1, 2], x: fx.from(4.5), y: fx.from(6.5), append: true, formation: 'attack' },
    ]);
  });

  it('still clamps the point to the map', () => {
    const s = sink();
    applyIntent(s, { kind: 'order', verb: 'move', ids: [1, 2], x: -3, y: 99, append: false, formation: 'ambush' }, MAP);
    expect(s.out).toEqual([{ kind: 'move', ids: [1, 2], x: 0, y: 48 * 65536 - 1, append: false, formation: 'ambush' }]);
  });

  it('a plain order carries no formation key at all', () => {
    const s = sink();
    applyIntent(s, { kind: 'order', verb: 'move', ids: [1], x: 1, y: 2, append: false }, MAP);
    expect(s.out[0]).not.toHaveProperty('formation');
  });
});

describe('the keys R, T and Y', () => {
  const b = bindingsFrom({});
  const press = (key: string) => resolveKey(b, { key, ctrlKey: false, metaKey: false });

  it('are bound to the three formations and listed to a player', () => {
    expect(press('r')).toBe('formationColumn');
    expect(press('t')).toBe('formationAttack');
    expect(press('y')).toBe('formationAmbush');
    expect(b.formationColumn).toBe('r');
  });

  it('collide with nothing', () => {
    for (const k of ['r', 't', 'y']) expect(ACTIONS.filter((a) => a.key === k && a.modifier === undefined)).toHaveLength(1);
  });

  it('are rebindable, and refuse a key another action holds', () => {
    const moved = rebind(b, 'formationColumn', 'j');
    expect(moved.ok && moved.bindings.formationColumn).toBe('j');
    expect(rebind(b, 'formationColumn', 'h')).toEqual({ ok: false, takenBy: 'halt' });
    expect(rebind(b, 'halt', 'r')).toEqual({ ok: false, takenBy: 'formationColumn' });
    for (const id of ['formationColumn', 'formationAttack', 'formationAmbush']) expect(ACTIONS.find((a) => a.id === id)?.rebindable).toBe(true);
  });

  const u = (cls: number, free = true): FormationUnitFact => ({ cls, free });
  const mixed = [u(0), u(0), u(3), u(3), u(6)];

  it('arm the formation when its button is live', () => {
    const row = formationRow({ formationsOpen: true, units: mixed }, null);
    expect(armFormationKey(row, 'formationColumn')).toBe('column');
    expect(armFormationKey(row, 'formationAttack')).toBe('attack');
    expect(armFormationKey(row, 'formationAmbush')).toBe('ambush');
    expect(armFormationKey(row, 'halt')).toBeNull();
  });

  it('arm nothing in a versus room, where every button is inert', () => {
    const row = formationRow({ formationsOpen: false, units: mixed }, null);
    expect(row).toHaveLength(3);
    for (const a of ['formationColumn', 'formationAttack', 'formationAmbush'] as const) expect(armFormationKey(row, a)).toBeNull();
  });

  it('arm nothing for one unit (no row), or an ambush with no ground to ring', () => {
    expect(armFormationKey(formationRow({ formationsOpen: true, units: [u(3)] }, null), 'formationColumn')).toBeNull();
    const air = formationRow({ formationsOpen: true, units: [u(6), u(6)] }, null);
    expect(armFormationKey(air, 'formationColumn')).toBe('column');
    expect(armFormationKey(air, 'formationAmbush')).toBeNull();
  });
});
