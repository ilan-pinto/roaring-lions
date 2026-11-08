import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../brigade-account';
import { ACCOUNT_BINDING_KEY, readBinding, writeBinding } from './binding';
import type { AccountClient, MeResult } from './client';
import { resolveSignedIn, sha256Hex } from './signed-in';

function mem(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
function fake(me: MeResult, gone: 'deleted' | 'unknown', seen: string[] = []): AccountClient {
  const never = (): never => {
    throw new Error('unused');
  };
  return { enabled: true, me: () => Promise.resolve(me), gone: (h) => (seen.push(h), Promise.resolve(gone)), open: never, steamStart: never, logout: never, logoutAll: never, patchProfile: never, deleteIdentity: never, exportData: never, deleteAccount: never };
}
const IN: MeResult = { kind: 'signedIn', publicId: 'pub1', displayName: 'Abc', showRecord: false, fresh: true, identities: [] };

describe('resolveSignedIn', () => {
  it('signed in writes the binding', async () => {
    const s = mem();
    expect((await resolveSignedIn(fake(IN, 'unknown'), s)).kind).toBe('signedIn');
    expect(readBinding(s)?.publicId).toBe('pub1');
  });
  it('401 with no binding is a guest', async () => {
    expect(await resolveSignedIn(fake({ kind: 'signedOut' }, 'deleted'), mem())).toEqual({ kind: 'guest' });
  });
  it('deleted on another device: gone 410 clears the binding (A1-16)', async () => {
    const s = mem();
    writeBinding(s, { version: 1, publicId: 'pub1' });
    const seen: string[] = [];
    expect(await resolveSignedIn(fake({ kind: 'signedOut' }, 'deleted', seen), s)).toEqual({ kind: 'deleted' });
    expect(s.getItem(ACCOUNT_BINDING_KEY)).toBeNull();
    expect(seen).toEqual([await sha256Hex('pub1')]);
  });
  it('gone 404 keeps the binding and is signedOut (A1-16)', async () => {
    const s = mem();
    writeBinding(s, { version: 1, publicId: 'pub1' });
    expect(await resolveSignedIn(fake({ kind: 'signedOut' }, 'unknown'), s)).toEqual({ kind: 'signedOut', publicId: 'pub1' });
    expect(readBinding(s)?.publicId).toBe('pub1');
  });
  it('no answer from the server (off) keeps the binding and never asks gone', async () => {
    const s = mem();
    writeBinding(s, { version: 1, publicId: 'pub1' });
    const seen: string[] = [];
    expect(await resolveSignedIn(fake({ kind: 'off' }, 'deleted', seen), s)).toEqual({ kind: 'signedOut', publicId: 'pub1' });
    expect(seen).toEqual([]);
  });
  it('sha256Hex matches a known vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
