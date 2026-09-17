// packages/app/src/i18n/format.test.ts
import { describe, expect, it } from 'vitest';
import { format } from './format';

describe('format', () => {
  it('interpolates named params and leaves unknown ones visible', () => {
    expect(format('Conduct {conduct}', { conduct: 88 }, 'en')).toBe('Conduct 88');
    expect(format('Hello {who}', {}, 'en')).toBe('Hello {who}');
  });
  it('selects English plural categories and substitutes #', () => {
    const m = '{n, plural, one {# unit survives} other {# units survive}}';
    expect(format(m, { n: 1 }, 'en')).toBe('1 unit survives');
    expect(format(m, { n: 0 }, 'en')).toBe('0 units survive');
    expect(format(m, { n: 12 }, 'en')).toBe('12 units survive');
  });
  it('exact matches win over categories', () => {
    const m = '{n, plural, =0 {none carried} one {# carried} other {# carried}}';
    expect(format(m, { n: 0 }, 'en')).toBe('none carried');
    expect(format(m, { n: 1 }, 'en')).toBe('1 carried');
  });
  it('select on a string, with other as the fallback', () => {
    const m = '{result, select, victory {Mission accomplished} defeat {Mission failed} other {Mission over}}';
    expect(format(m, { result: 'victory' }, 'en')).toBe('Mission accomplished');
    expect(format(m, { result: 'draw' }, 'en')).toBe('Mission over');
  });
  it('nests one level and keeps text around the argument', () => {
    expect(format('{n, plural, one {{n} position is} other {{n} positions are}} marked', { n: 2 }, 'en')).toBe('2 positions are marked');
  });
  it('uses the locale plural rules (Arabic has six categories; Hebrew has two/many)', () => {
    const m = '{n, plural, one {a} two {b} few {c} many {d} other {e}}';
    expect(format(m, { n: 2 }, 'ar')).toBe('b');
    expect(format(m, { n: 2 }, 'he')).toBe('b');
    expect(format(m, { n: 5 }, 'en')).toBe('e');
  });
});
