/**
 * Which vehicle template a unit draws from (per-seat kit plan, Task 6).
 *
 * A versus room registers side 1 its own sim type for an id only when its kit
 * differs from side 0's (`sameTrackTiers`, which `buildMatchWorld` imports), and both copies keep
 * the SAME type id. So the renderer cannot key a kitted hull by id alone: it
 * keys by (id, side), and side 1 shares side 0's key whenever the two kits
 * agree -- which is what keeps a matched room loading nothing new.
 */
import { describe, expect, it } from 'vitest';
import { sameTrackTiers, templateKey, templateKitTiers, type KitTiersBySide } from './kit-template-key';

describe('templateKey', () => {
  it("side 1 gets its own key when its tiers for the id differ from side 0's", () => {
    expect(templateKey('mbt_lavi', 1, [{}, { mbt_lavi: { armour: 1 } }])).toBe('mbt_lavi#s1');
  });

  it('equal tables share the id', () => {
    const t = { mbt_lavi: { armour: 1, sensors: 2 } };
    expect(templateKey('mbt_lavi', 1, [t, { mbt_lavi: { sensors: 2, armour: 1 } }])).toBe('mbt_lavi');
  });

  it('absent bySide (single-player) is the id', () => {
    expect(templateKey('mbt_lavi', 1, undefined)).toBe('mbt_lavi');
  });

  it('side 0 is always the id, and so is any side past 1', () => {
    const bySide: KitTiersBySide = [{ mbt_lavi: { armour: 3 } }, { mbt_lavi: { armour: 1 } }];
    expect(templateKey('mbt_lavi', 0, bySide)).toBe('mbt_lavi');
    expect(templateKey('mbt_lavi', 2, bySide)).toBe('mbt_lavi');
  });

  it('only the differing id splits', () => {
    const bySide: KitTiersBySide = [{ mbt_lavi: {}, ifv_namer: { armour: 1 } }, { mbt_lavi: { armour: 2 }, ifv_namer: { armour: 1 } }];
    expect(templateKey('mbt_lavi', 1, bySide)).toBe('mbt_lavi#s1');
    expect(templateKey('ifv_namer', 1, bySide)).toBe('ifv_namer');
  });
});

describe('sameTrackTiers: buildMatchWorld\'s own rule', () => {
  it('a zero tier fields nothing, and an absent table is no kit', () => {
    expect(sameTrackTiers({ armour: 0 }, undefined)).toBe(true);
    expect(sameTrackTiers({ armour: 1, sensors: 0 }, { armour: 1 })).toBe(true);
  });

  it('the same level on a different track is a different kit', () => {
    expect(sameTrackTiers({ armour: 1 }, { sensors: 1 })).toBe(false);
  });
});

describe('templateKitTiers: the tiers a template is built with', () => {
  it('single-player reads unitKitTiers for every side', () => {
    const one = { mbt_lavi: { armour: 2 } };
    expect(templateKitTiers('mbt_lavi', 0, one, undefined)).toBe(one.mbt_lavi);
    expect(templateKitTiers('mbt_lavi', 1, one, undefined)).toBe(one.mbt_lavi);
  });

  it('a room reads each side its own table', () => {
    const bySide: KitTiersBySide = [{ mbt_lavi: { armour: 1 } }, { mbt_lavi: { armour: 3 } }];
    expect(templateKitTiers('mbt_lavi', 0, undefined, bySide)).toBe(bySide[0].mbt_lavi);
    expect(templateKitTiers('mbt_lavi', 1, undefined, bySide)).toBe(bySide[1].mbt_lavi);
  });

  it('absent everywhere is no kit', () => {
    expect(templateKitTiers('mbt_lavi', 0, undefined, undefined)).toBeUndefined();
  });
});
