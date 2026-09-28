import { describe, expect, it } from 'vitest';
import { SYMBOL_IDS, symbolSvg, symbolBody, VIEWBOX, W } from './symbol';

describe('the symbol family (G1 r2 roles, r5 orders, r2 utility marks)', () => {
  it('is nineteen distinct ids: seven roles, eight orders, four utility marks', () => {
    expect(SYMBOL_IDS).toHaveLength(19);
    expect(new Set(SYMBOL_IDS).size).toBe(19);
  });

  it('fills with currentColor and names no colour or variable', () => {
    for (const id of SYMBOL_IDS) {
      for (const framed of [false, true]) {
        const svg = symbolSvg(id, 16, { framed });
        expect(svg).toContain('currentColor');
        expect(svg).not.toMatch(/#[0-9a-fA-F]{3}/);
        expect(svg).not.toContain('var(--');
      }
    }
  });

  it('is filled shapes only -- no stroke anywhere (r2 rule: rings are even-odd fills)', () => {
    for (const id of SYMBOL_IDS) expect(symbolSvg(id, 16, { framed: true })).not.toMatch(/stroke/);
  });

  it('shares one viewBox and honours the size asked for', () => {
    const boxes = new Set(SYMBOL_IDS.map((id) => /viewBox="([^"]+)"/.exec(symbolSvg(id, 16))?.[1]));
    expect([...boxes]).toEqual([VIEWBOX]);
    expect(symbolSvg('armour', 10)).toContain('width="10"');
  });

  it('carries at least a pixel of ink at 10 px', () => {
    expect((W * 10) / 24).toBeGreaterThanOrEqual(1);
  });

  it('draws a different body framed and unframed for every role, and the same for non-roles', () => {
    for (const b of ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'] as const)
      expect(symbolBody(b, { framed: true })).not.toBe(symbolBody(b));
    expect(symbolBody('halt', { framed: true })).toBe(symbolBody('halt'));
  });

  it('tags its svg with the id, for tests and captures', () => {
    expect(symbolSvg('logistics', 12)).toContain('data-symbol="logistics"');
  });
});
