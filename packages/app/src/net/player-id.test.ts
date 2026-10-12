import { describe, it, expect } from 'vitest';
import { playerId } from './player-id';

const memory = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
let n = 0;
const mint = (): string => `id-${++n}`;

describe('playerId', () => {
  it('the first call mints and stores; the second returns the stored id', () => {
    const store = memory();
    const first = playerId(store, mint);
    expect(store.data['lions.versus.player']).toBe(first);
    expect(playerId(store, () => 'never')).toBe(first);
  });
  it('lives under its own key, not the telemetry opt-out keys', () => {
    const store = memory();
    playerId(store, mint);
    expect(Object.keys(store.data)).toEqual(['lions.versus.player']);
  });
  it('a store whose setItem throws still returns an id, the same one on a second call', () => {
    const store = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const first = playerId(store, mint);
    expect(first).not.toBe('');
    expect(playerId(store, mint)).toBe(first);
  });
  it('a null store (blocked storage) still returns an id, stable for the page', () => {
    const first = playerId(null, mint);
    expect(playerId(null, mint)).toBe(first);
  });
});
