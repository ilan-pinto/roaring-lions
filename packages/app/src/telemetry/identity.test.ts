import { describe, it, expect } from 'vitest';
import { resolveIdentity, safeStorage, type StorageLike } from './identity';

function memory(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const q = (s = '') => new URLSearchParams(s);

describe('resolveIdentity', () => {
  it('creates and stores a player id on a first visit', () => {
    const s = memory();
    const id = resolveIdentity(s, q(), () => ID);
    expect(id).toEqual({ player: ID, returning: false, optedOut: false });
    expect(s.data['lions.telemetry.player']).toBe(ID);
  });

  it('reuses a stored id and reports a returning player', () => {
    const s = memory({ 'lions.telemetry.player': ID });
    expect(resolveIdentity(s, q(), () => 'other').player).toBe(ID);
    expect(resolveIdentity(s, q(), () => 'other').returning).toBe(true);
  });

  it('replaces a malformed stored id', () => {
    const s = memory({ 'lions.telemetry.player': 'garbage' });
    expect(resolveIdentity(s, q(), () => ID)).toMatchObject({ player: ID, returning: false });
  });

  it('persists a valid ?tester and ignores an invalid one', () => {
    const s = memory();
    expect(resolveIdentity(s, q('tester=dani'), () => ID).tester).toBe('dani');
    expect(resolveIdentity(s, q(), () => ID).tester).toBe('dani');
    const t = memory();
    expect(resolveIdentity(t, q('tester=dani%20cohen'), () => ID).tester).toBeUndefined();
  });

  it('persists ?notrack', () => {
    const s = memory();
    expect(resolveIdentity(s, q('notrack'), () => ID).optedOut).toBe(true);
    expect(resolveIdentity(s, q(), () => ID).optedOut).toBe(true);
  });

  it('works for one session when storage is unavailable', () => {
    expect(resolveIdentity(null, q('tester=dani'), () => ID)).toEqual({
      player: ID, tester: 'dani', returning: false, optedOut: false,
    });
  });
});

describe('safeStorage', () => {
  it('returns null when the accessor throws', () => {
    expect(safeStorage(() => { throw new Error('SecurityError'); })).toBeNull();
  });
  it('returns null for a bare object with no getItem (jsdom on Node 25)', () => {
    expect(safeStorage(() => ({}))).toBeNull();
  });
  it('wraps a real storage so a throwing setItem is swallowed', () => {
    const s = safeStorage(() => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }));
    expect(s).not.toBeNull();
    expect(() => s?.setItem('a', 'b')).not.toThrow();
  });
});
