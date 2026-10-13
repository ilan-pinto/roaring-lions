import { describe, expect, it } from 'vitest';
import { resolveLang } from './locales';

describe('resolveLang (#559 F6)', () => {
  it('honours a shipped locale and the pseudo-locale', () => {
    expect(resolveLang('en', 'xx')).toBe('en');
    expect(resolveLang('pseudo', 'en')).toBe('pseudo');
  });
  it('falls back to the saved language for no param', () => {
    expect(resolveLang(null, 'en')).toBe('en');
  });
  it('ignores anything that is not a shipped locale -- path segments included', () => {
    for (const bad of ['../../api/x', 'en/../../x', 'he', '', 'EN', 'en.json', '//evil.example/x', '__proto__']) {
      expect(resolveLang(bad, 'en'), bad).toBe('en');
    }
  });
});
