// GH-1417 S3 (D5): the local block list, members by public id only.
import { describe, expect, it, vi } from 'vitest';
import type { StorageLike } from '../telemetry/identity';
import { BLOCK_KEY, BLOCK_MAX, createBlockList } from './block-list';

const store = (init: Record<string, string> = {}): StorageLike & { d: Record<string, string> } => {
  const d = { ...init };
  return { d, getItem: (k) => d[k] ?? null, setItem: (k, v) => void (d[k] = v) };
};
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** n distinct, valid public ids (8 Crockford characters, base 32). */
const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => {
    let x = i + 1;
    let out = '';
    for (let k = 0; k < 8; k++, x = Math.floor(x / 32)) out = CROCKFORD[x % 32] + out;
    return out;
  });

describe('createBlockList', () => {
  it('adds, reports and removes an id, and persists it under its one key', () => {
    const s = store();
    const l = createBlockList(s);
    expect(l.has('ABCDEFG1')).toBe(false);
    expect(l.add('ABCDEFG1')).toBe(true);
    expect(l.has('ABCDEFG1')).toBe(true);
    expect(JSON.parse(s.d[BLOCK_KEY]!)).toEqual(['ABCDEFG1']);
    l.remove('ABCDEFG1');
    expect(l.has('ABCDEFG1')).toBe(false);
    expect(JSON.parse(s.d[BLOCK_KEY]!)).toEqual([]);
  });

  it('a block made now is read by a list made later on the same storage (it holds across rooms and reloads)', () => {
    const s = store();
    createBlockList(s).add('ABCDEFG1');
    expect(createBlockList(s).has('ABCDEFG1')).toBe(true);
  });

  it('refuses anything that is not a public id and stores nothing for it', () => {
    const s = store();
    const l = createBlockList(s);
    for (const bad of ['', 'abcdefg1', 'ABCDEFG', 'ABCDEFG12', 'ABCDEFGI', 'guest-token', 'ABCDEFG!']) expect(l.add(bad), bad).toBe(false);
    expect(s.d[BLOCK_KEY]).toBeUndefined();
    expect(l.all()).toEqual([]);
  });

  it('drops junk found in storage instead of trusting it', () => {
    for (const raw of ['not json', '{"a":1}', '[1,2,3]', '["nope","ABCDEFG1","ABCDEFG1"]']) {
      const l = createBlockList(store({ [BLOCK_KEY]: raw }));
      expect(l.all().every((x) => /^[0-9A-HJKMNP-TV-Z]{8}$/.test(x)), raw).toBe(true);
    }
    expect(createBlockList(store({ [BLOCK_KEY]: '["nope","ABCDEFG1","ABCDEFG1"]' })).all()).toEqual(['ABCDEFG1']);
  });

  it('keeps the newest BLOCK_MAX and lets the oldest fall off', () => {
    const l = createBlockList(store());
    const all = ids(BLOCK_MAX + 5);
    for (const x of all) l.add(x);
    expect(l.all()).toHaveLength(BLOCK_MAX);
    expect(l.has(all[0]!)).toBe(false);
    expect(l.has(all[all.length - 1]!)).toBe(true);
  });

  it('works with no storage at all, and survives a storage that throws', () => {
    const none = createBlockList(null);
    expect(none.add('ABCDEFG1')).toBe(true);
    expect(none.has('ABCDEFG1')).toBe(true);
    const throwing: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    const l = createBlockList(throwing);
    expect(() => l.add('ABCDEFG1')).not.toThrow();
    expect(l.has('ABCDEFG1')).toBe(true);
  });

  it('notifies on a real change only, and the unsubscribe stops it', () => {
    const l = createBlockList(store());
    const fn = vi.fn();
    const off = l.onChange(fn);
    l.add('ABCDEFG1');
    l.add('ABCDEFG1');
    l.remove('ABCDEFG2');
    expect(fn).toHaveBeenCalledTimes(1);
    l.remove('ABCDEFG1');
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    l.add('ABCDEFG1');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
