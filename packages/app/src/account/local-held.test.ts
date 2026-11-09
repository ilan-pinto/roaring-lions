import { describe, expect, it } from 'vitest';
import { memStorage } from './fixtures';
import { addHeld, HELD_KEY, readHeld, removeHeld, type HeldItem } from './local-held';

const item = (id: string, over: Partial<HeldItem> = {}): HeldItem => ({ id, kind: 'campaign', reason: 'held', text: '{"x":1}', at: 5, publicId: 'pub1', digest: 'dg', ...over });
const boom = (): never => {
  throw new Error('blocked');
};

describe('lions.account.local', () => {
  it('adds, reads oldest first, and replaces an item with the same id', () => {
    const s = memStorage();
    expect(addHeld(s, item('a'))).toBe(true);
    expect(addHeld(s, item('b'))).toBe(true);
    expect(addHeld(s, item('a', { text: 'new' }))).toBe(true);
    expect(readHeld(s).map((h) => [h.id, h.text])).toEqual([['a', 'new'], ['b', '{"x":1}']]);
  });

  it('removeHeld removes only on the digest the item was stored with', () => {
    const s = memStorage();
    addHeld(s, item('a'));
    expect(removeHeld(s, 'a', 'other')).toBe(false);
    expect(readHeld(s)).toHaveLength(1);
    expect(removeHeld(s, 'zzz', 'dg')).toBe(false);
    expect(removeHeld(s, 'a', 'dg')).toBe(true);
    expect(readHeld(s)).toEqual([]);
    expect(s.map.has(HELD_KEY)).toBe(false);
  });

  it('an item with no digest is never removed by removeHeld', () => {
    const s = memStorage();
    addHeld(s, item('a', { digest: undefined }));
    expect(removeHeld(s, 'a', '')).toBe(false);
    expect(readHeld(s)).toHaveLength(1);
  });

  it('a refusing storage: addHeld is false, reads are empty, nothing throws', () => {
    const refusing = { getItem: boom, setItem: boom, removeItem: boom };
    expect(addHeld(refusing, item('a'))).toBe(false);
    expect(readHeld(refusing)).toEqual([]);
    expect(removeHeld(refusing, 'a', 'dg')).toBe(false);
    expect(addHeld(null, item('a'))).toBe(false);
  });

  it('malformed entries are skipped', () => {
    const s = memStorage();
    s.setItem(HELD_KEY, JSON.stringify([item('a'), { id: 1 }, null, item('b', { reason: 'nope' as never })]));
    expect(readHeld(s).map((h) => h.id)).toEqual(['a']);
    s.setItem(HELD_KEY, 'not json');
    expect(readHeld(s)).toEqual([]);
  });
});
