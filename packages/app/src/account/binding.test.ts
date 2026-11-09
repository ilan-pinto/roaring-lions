import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../brigade-account';
import { ACCOUNT_BINDING_KEY, clearBinding, clearDeviceId, readBinding, writeBinding } from './binding';

function mem(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
const boom = (): never => {
  throw new Error('blocked');
};
const throwing: StorageLike = { getItem: boom, setItem: boom, removeItem: boom };

describe('binding', () => {
  it('round trips', () => {
    const s = mem();
    writeBinding(s, { version: 1, publicId: 'p1' });
    expect(readBinding(s)).toEqual({ version: 1, publicId: 'p1' });
    clearBinding(s);
    expect(readBinding(s)).toBeNull();
  });
  it('a throwing storage reads as guest and writes do not throw (A1-12)', () => {
    expect(readBinding(throwing)).toBeNull();
    expect(() => writeBinding(throwing, { version: 1, publicId: 'p' })).not.toThrow();
    expect(() => clearBinding(throwing)).not.toThrow();
    expect(readBinding(null)).toBeNull();
  });
  it('malformed reads as null', () => {
    const s = mem();
    for (const v of ['not json', 'null', '{"version":2,"publicId":"p"}', '{"version":1}', '{"version":1,"publicId":""}', '[]']) {
      s.map.set(ACCOUNT_BINDING_KEY, v);
      expect(readBinding(s)).toBeNull();
    }
  });
});

describe('binding (A2)', () => {
  const DEV = '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc';
  it('keeps a valid deviceId and an integer claimedAt, and drops anything else', () => {
    const s = mem();
    writeBinding(s, { version: 1, publicId: 'p1', deviceId: DEV, claimedAt: 5 });
    expect(readBinding(s)).toEqual({ version: 1, publicId: 'p1', deviceId: DEV, claimedAt: 5 });
    s.map.set(ACCOUNT_BINDING_KEY, JSON.stringify({ version: 1, publicId: 'p1', deviceId: 'nope', claimedAt: 1.5 }));
    expect(readBinding(s)).toEqual({ version: 1, publicId: 'p1' });
    s.map.set(ACCOUNT_BINDING_KEY, JSON.stringify({ version: 1, publicId: 'p1', deviceId: 7, claimedAt: '5' }));
    expect(readBinding(s)).toEqual({ version: 1, publicId: 'p1' });
  });

  it('clearDeviceId forgets the device id and the claim mark and keeps the member (§0.16)', () => {
    const s = mem();
    writeBinding(s, { version: 1, publicId: 'pub1', deviceId: '0b5f6d3e-1c2a-4f7b-9d8e-123456789abc', claimedAt: 4 });
    clearDeviceId(s);
    expect(readBinding(s)).toEqual({ version: 1, publicId: 'pub1' });
    clearDeviceId(mem()); // no binding: nothing happens
    expect(() => clearDeviceId(throwing)).not.toThrow();
  });
});
