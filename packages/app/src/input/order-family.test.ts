/**
 * VR-33: an order's ground route and marker wear the colour of the cursor
 * that issued it. One table (`ORDER_FAMILY_COLOR_KEY`) feeds both ends; these
 * specs hold the two ends to it, for every family.
 *
 * Falsified, one line each: pointing the move cursor at another family's
 * key (`ORDER_SIGHT.move.main = ORDER_FAMILY_COLOR_KEY.transport`) reddens the
 * two agreement specs; making `orderColorKey` return the old route colour
 * (`'vfx.tracer'`) for every family reddens those two and the move-is-cyan
 * pin.
 */
import { describe, expect, it } from 'vitest';
import { ORDER_FAMILY_COLOR_KEY, ORDER_SIGHT, type OrderFamily, type SightOrderId } from '../ui/order-sight';
import type { PlayerIntent } from './intents';
import { intentRoute, markerFamily, orderColorKey, plainOrderSight } from './order-family';

const SIGHTS = Object.keys(ORDER_SIGHT) as SightOrderId[];
const FAMILIES = Object.keys(ORDER_FAMILY_COLOR_KEY) as OrderFamily[];

describe('one colour per order family, cursor and route alike (VR-33)', () => {
  it("every sight's cursor colour is its family's route colour", () => {
    for (const id of SIGHTS) {
      expect({ id, key: ORDER_SIGHT[id].main }).toEqual({ id, key: orderColorKey(ORDER_SIGHT[id].family) });
    }
  });

  it('every family has a cursor that shows its colour, so no route colour is one no cursor wears', () => {
    for (const family of FAMILIES) {
      const cursors = SIGHTS.filter((id) => ORDER_SIGHT[id].family === family);
      expect({ family, cursors: cursors.length > 0 }).toEqual({ family, cursors: true });
      for (const id of cursors) expect(ORDER_SIGHT[id].main).toBe(orderColorKey(family));
    }
  });

  it('a move order is cyan on the ground, not tracer lime; an attack-move wears the attack-move cursor', () => {
    expect(orderColorKey(intentRoute(order([1]), plainOrderSight(false))!.family)).toBe('vfx.interceptor');
    expect(orderColorKey(intentRoute(order([1]), plainOrderSight(true))!.family)).toBe(ORDER_SIGHT.attackMove.main);
    expect(orderColorKey(intentRoute(order([1]), plainOrderSight(false, true))!.family)).toBe(ORDER_SIGHT.attackMove.main);
  });

  it('no family is the overlay accent: the renderer keeps lime', () => {
    expect(orderColorKey(null)).toBeNull();
  });
});

function order(ids: number[]): PlayerIntent {
  return { kind: 'order', verb: 'attackMove', ids, x: 4, y: 4, append: false };
}

describe('intentRoute: which units an intent ordered, under which family', () => {
  it('maps each unit order to the family of the sight that shows it', () => {
    expect(intentRoute({ kind: 'smoke', ids: [3], x: 1, y: 1 }, 'move')).toEqual({ ids: [3], family: ORDER_SIGHT.smoke.family });
    expect(intentRoute({ kind: 'halt', ids: [4] }, 'move')).toEqual({ ids: [4], family: ORDER_SIGHT.halt.family });
    expect(intentRoute({ kind: 'mount', riders: [5, 6], carrier: 9 }, 'move')).toEqual({ ids: [5, 6], family: 'transport' });
    expect(intentRoute({ kind: 'dismount', carriers: [9] }, 'move')).toEqual({ ids: [9], family: 'transport' });
  });

  it('garrison, demolish and charge have no family sight: their units go back to the accent', () => {
    expect(intentRoute({ kind: 'garrison', ids: [1], structure: 2 }, 'move')).toEqual({ ids: [1], family: null });
    expect(intentRoute({ kind: 'demolish', ids: [1], structure: 2 }, 'move')).toEqual({ ids: [1], family: null });
    expect(intentRoute({ kind: 'chargeTunnel', ids: [1], tunnel: 0 }, 'move')).toEqual({ ids: [1], family: null });
  });

  it('orders no unit for select, group, overlay or support', () => {
    expect(intentRoute({ kind: 'select', ids: [1], via: 'click' }, 'move')).toBeNull();
    expect(intentRoute({ kind: 'group', slot: 1, action: 'recall' }, 'move')).toBeNull();
    expect(intentRoute({ kind: 'overlay', on: true }, 'move')).toBeNull();
    expect(intentRoute({ kind: 'support', call: 'strike', x: 1, y: 1, accepted: true }, 'move')).toBeNull();
  });

  it("the marker wears the first intent's family -- the one the cursor ranked first", () => {
    const garrisonThenAdvance: PlayerIntent[] = [{ kind: 'garrison', ids: [1], structure: 2 }, order([3])];
    expect(markerFamily(garrisonThenAdvance, 'move')).toBeNull();
    expect(markerFamily([order([3])], 'move')).toBe('manoeuvre');
    expect(markerFamily([], 'move')).toBeNull();
  });
});
