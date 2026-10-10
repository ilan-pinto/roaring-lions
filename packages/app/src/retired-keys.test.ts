import { describe, expect, it } from 'vitest';
import { forgetRetiredKeys, RETIRED_STORAGE_KEYS } from './retired-keys';

const mapStorage = (seed: Record<string, string>) => {
  const box = new Map(Object.entries(seed));
  return { box, removeItem: (k: string) => void box.delete(k) };
};

describe('forgetRetiredKeys', () => {
  it('removes a returning player’s lions.renderer=pixi and nothing else', () => {
    const s = mapStorage({ 'lions.renderer': 'pixi', 'lions.settings': '{}', 'lions.ledger': '{}' });
    forgetRetiredKeys(() => s);
    expect([...s.box.keys()].sort()).toEqual(['lions.ledger', 'lions.settings']);
  });
  it('names the renderer key (the literal, not a re-export)', () => {
    expect(RETIRED_STORAGE_KEYS).toContain('lions.renderer');
  });
  it('survives storage that throws on access, and a bare {}', () => {
    expect(() =>
      forgetRetiredKeys(() => {
        throw new Error('SecurityError');
      })
    ).not.toThrow();
    expect(() => forgetRetiredKeys(() => ({}))).not.toThrow();
    expect(() => forgetRetiredKeys(() => null)).not.toThrow();
  });
});
