import { describe, expect, it } from 'vitest';
import { restoreFocus, retainSelection } from './garage-model';

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
