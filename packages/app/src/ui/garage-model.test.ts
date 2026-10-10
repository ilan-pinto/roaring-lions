import { describe, expect, it } from 'vitest';
import {
  CUE_SET,
  cardStatus,
  countAt,
  cueFor,
  KIT_VEHICLE_TYPES,
  restoreFocus,
  retainSelection,
  rovingStep,
  sortByKit,
  trackForDigit,
} from './garage-model';

describe('retainSelection', () => {
  it('keeps the unit in the bay while it is still on the roster', () => {
    expect(retainSelection('at_team', ['mbt_lavi', 'at_team'])).toBe('at_team');
  });
  it('falls to the first card only when the unit has gone', () => {
    expect(retainSelection('gone', ['mbt_lavi', 'at_team'])).toBe('mbt_lavi');
    expect(retainSelection('', [])).toBe('');
  });
});

describe('restoreFocus', () => {
  const keys = ['tab:all', 'card:inf_squad', 'track:armour', 'buy:armour', 'track:sensors', 'reset'];
  it('returns the asking control when it still exists -- the NEXT tier on the same track', () => {
    expect(restoreFocus('buy:armour', keys, 'inf_squad')).toBe('buy:armour');
  });
  it('falls from a maxed track’s Buy to the track itself', () => {
    expect(restoreFocus('buy:sensors', keys, 'inf_squad')).toBe('track:sensors');
  });
  it('falls from a unit Buy to the first tier Buy the unit now has', () => {
    expect(restoreFocus('unit-buy', keys, 'inf_squad')).toBe('buy:armour');
  });
  it('falls to the unit’s own card when nothing closer exists', () => {
    expect(restoreFocus('unit-buy', ['card:inf_squad'], 'inf_squad')).toBe('card:inf_squad');
    expect(restoreFocus('buy:rockets', ['card:inf_squad'], 'inf_squad')).toBe('card:inf_squad');
  });
  it('asks for nothing when nothing asked, or nothing is left', () => {
    expect(restoreFocus(null, keys, 'inf_squad')).toBeNull();
    expect(restoreFocus('buy:armour', [], 'inf_squad')).toBeNull();
  });
});

describe('rovingStep', () => {
  it('moves and wraps, and starts at an end from nowhere', () => {
    expect(rovingStep('ArrowDown', 0, 3)).toBe(1);
    expect(rovingStep('ArrowDown', 2, 3)).toBe(0);
    expect(rovingStep('ArrowUp', 0, 3)).toBe(2);
    expect(rovingStep('ArrowRight', -1, 3)).toBe(0);
    expect(rovingStep('ArrowLeft', -1, 3)).toBe(2);
    expect([rovingStep('Home', 2, 3), rovingStep('End', 0, 3)]).toEqual([0, 2]);
  });
  it('ignores every other key, and an empty list', () => {
    expect(rovingStep('Enter', 0, 3)).toBeNull();
    expect(rovingStep('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('trackForDigit', () => {
  it('maps 1-3 onto the tracks in board order', () => {
    const tracks = ['armour', 'sensors', 'firepower'];
    expect(['1', '2', '3'].map((k) => trackForDigit(k, tracks))).toEqual(tracks);
  });
  it('is null past the board, and for anything that is not a digit', () => {
    expect(trackForDigit('3', ['armour', 'sensors'])).toBeNull();
    expect(trackForDigit('0', ['armour'])).toBeNull();
    expect(trackForDigit('a', ['armour'])).toBeNull();
  });
});

describe('cardStatus (R-11)', () => {
  it('reads Locked before anything a locked unit might also be', () => {
    expect(cardStatus({ locked: true, bought: false, maxed: true })).toBe('locked');
  });
  it('reads Maxed over Bought over Earned', () => {
    expect(cardStatus({ locked: false, bought: true, maxed: true })).toBe('maxed');
    expect(cardStatus({ locked: false, bought: true, maxed: false })).toBe('bought');
    expect(cardStatus({ locked: false, bought: false, maxed: false })).toBe('earned');
  });
});

describe('cueFor / CUE_SET', () => {
  it('sounds a unit as a purchase and a tier as an upgrade, each its own set', () => {
    expect(cueFor({ kind: 'unit', unitId: 'x' })).toBe('purchase');
    expect(cueFor({ kind: 'upgrade', unitId: 'x', track: 'armour', tier: 1 })).toBe('upgrade');
    expect(CUE_SET).toEqual({ purchase: 'ui_purchase', upgrade: 'ui_upgrade', kit: 'ui_kit_fitted' });
  });
  it('sounds a tier on a kitted vehicle as a kit fitted, at every tier of every track', () => {
    for (const unitId of ['mbt_lavi', 'dozer_d9', 'heli_peten']) {
      for (const track of ['armour', 'sensors', 'firepower']) {
        for (const tier of [1, 2, 3]) {
          expect(cueFor({ kind: 'upgrade', unitId, track, tier })).toBe('kit');
        }
      }
    }
  });
  it('still sounds buying a kitted vehicle itself as a purchase, and a non-vehicle tier as an upgrade', () => {
    expect(cueFor({ kind: 'unit', unitId: 'mbt_lavi' })).toBe('purchase');
    expect(cueFor({ kind: 'upgrade', unitId: 'inf_squad', track: 'armour', tier: 1 })).toBe('upgrade');
    expect(cueFor({ kind: 'upgrade', unitId: 'attack_drone', track: 'sensors', tier: 1 })).toBe('upgrade');
  });
});

describe('KIT_VEHICLE_TYPES (GH-238 plan 3, Task 7)', () => {
  it('is exactly the plan’s eight vehicles', () => {
    // A literal list, not the code under test's own: the plan names these eight.
    expect([...KIT_VEHICLE_TYPES].sort()).toEqual(
      ['apc_eitan', 'apc_kipod', 'dozer_d9', 'heli_peten', 'ifv_namer', 'jeep_shoded', 'mbt_lavi', 'scout_shachaf'].sort(),
    );
  });
});

describe('countAt', () => {
  it('starts at from, lands exactly on to, and clamps outside the window', () => {
    expect(countAt(2400, 2225, 0, 400)).toBe(2400);
    expect(countAt(2400, 2225, 400, 400)).toBe(2225);
    expect(countAt(2400, 2225, 9999, 400)).toBe(2225);
    expect(countAt(2400, 2225, -5, 400)).toBe(2400);
  });
  it('counts down in whole credits, never overshooting', () => {
    const seq = [0, 50, 100, 200, 300, 399].map((ms) => countAt(2400, 2225, ms, 400));
    for (const v of seq) expect(Number.isInteger(v)).toBe(true);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]);
    expect(Math.min(...seq)).toBeGreaterThanOrEqual(2225);
  });
  it('is the answer at once for a zero duration', () => {
    expect(countAt(10, 3, 0, 0)).toBe(3);
  });
});

describe('sortByKit (GH-243, spec §4 Comparison)', () => {
  const rows = [
    { id: 'a', kit: 0 },
    { id: 'b', kit: 2 },
    { id: 'c', kit: 3 },
    { id: 'd', kit: 2 },
    { id: 'e', kit: 0 },
  ];
  it('puts the most kitted first', () => {
    expect(sortByKit(rows, (r) => r.kit).map((r) => r.id)[0]).toBe('c');
  });
  it('keeps the given order among equals, so the rail’s own order is the tiebreak', () => {
    expect(sortByKit(rows, (r) => r.kit).map((r) => r.id)).toEqual(['c', 'b', 'd', 'a', 'e']);
  });
  it('never reorders its input in place', () => {
    sortByKit(rows, (r) => r.kit);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
