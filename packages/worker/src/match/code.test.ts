import { describe, it, expect, vi } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, mintCode, isCode } from './code';

describe('room codes', () => {
  it('uses the unambiguous alphabet only and is six long', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    let i = 0;
    const code = mintCode(() => ((i++ * 7) % 32) / 32);
    expect(code).toHaveLength(CODE_LENGTH);
    expect([...code].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
    expect(isCode(code)).toBe(true);
  });
  it('rejects codes with 0, O, 1, I, lowercase, or the wrong length', () => {
    for (const bad of ['ABCDE0', 'ABCDEO', 'ABCDE1', 'ABCDEI', 'abcdef', 'ABCDE', 'ABCDEFG']) expect(isCode(bad)).toBe(false);
  });
});

describe('room codes, default random', () => {
  it('draws from the Web Crypto CSPRNG, not Math.random', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const mathSpy = vi.spyOn(Math, 'random');
    const code = mintCode();
    expect(isCode(code)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(CODE_LENGTH);
    expect(mathSpy).not.toHaveBeenCalled();
    spy.mockRestore();
    mathSpy.mockRestore();
  });
});
