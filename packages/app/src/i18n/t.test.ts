// packages/app/src/i18n/t.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentLocale, missingKeys, setCatalogue, t } from './t';

describe('t', () => {
  beforeEach(() => setCatalogue('en', { 'menu.campaign': 'Campaign', 'hud.survivors': '{n, plural, one {# unit survives} other {# units survive}}' }));
  it('looks a key up and formats', () => {
    expect(t('menu.campaign')).toBe('Campaign');
    expect(t('hud.survivors', { n: 1 })).toBe('1 unit survives');
    expect(currentLocale()).toBe('en');
  });
  it('returns the key for a miss, warns once, and records it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(t('nope.key')).toBe('nope.key');
    expect(t('nope.key')).toBe('nope.key');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(missingKeys()).toContain('nope.key');
    warn.mockRestore();
  });
  it('a transform (the pseudo-locale) wraps the formatted text but never the params', () => {
    setCatalogue('pseudo', { 'hud.survivors': '{n, plural, one {# unit survives} other {# units survive}}' }, (s) => `⟦${s}⟧`);
    expect(t('hud.survivors', { n: 3 })).toBe('⟦3 units survive⟧');
  });
});
