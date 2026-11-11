import { describe, expect, it } from 'vitest';
import { parseSoftArg, withSoftQuery } from './soft-arg';

describe('--soft', () => {
  it('parses on, off and absent, and refuses anything else', () => {
    expect(parseSoftArg('on')).toBe('on');
    expect(parseSoftArg('off')).toBe('off');
    expect(parseSoftArg(undefined)).toBeUndefined();
    expect(() => parseSoftArg('yes')).toThrow(/not on or off/);
  });
  it('on adds the flag once, off removes it, absent leaves the query as typed', () => {
    const q = '?sandbox=beit_sahwan_outskirts&sur&civ';
    expect(withSoftQuery(q, 'on')).toBe(`${q}&soft`);
    expect(withSoftQuery(`${q}&soft`, 'on')).toBe(`${q}&soft`);
    expect(withSoftQuery(`${q}&soft`, 'off')).toBe(q);
    expect(withSoftQuery(q, 'off')).toBe(q);
    expect(withSoftQuery(`${q}&soft`, undefined)).toBe(`${q}&soft`);
  });
  it('does not touch a longer key that starts with soft', () => {
    expect(withSoftQuery('?sandbox=x&softer', 'on')).toBe('?sandbox=x&softer&soft');
  });
});
