import { describe, expect, it } from 'vitest';
import { LOCALES, PSEUDO_RTL, applyLocale, isPseudo, loadLocale, pseudoModeOf, resolveLang } from './locales';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setCatalogue, t } from './t';
import { pseudoRtl } from './pseudo';
import en from './en.json';

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

// GH-1406: STAGED languages have their files in the repo (data/locales/<id>/, packages/app/src/i18n/<id>.json) but are not shipped: `LOCALES`
// does not list them, so `?lang=<id>` and a saved setting are ignored and every player sees English. Adding one to `LOCALES` is the lead's
// shipping step (after a human proofreading pass); the commit that does it removes the id from this list on purpose.
const STAGED = ['de'];
describe('staged languages are not shipped (GH-1406)', () => {
  it('LOCALES lists none of them', () => {
    for (const id of STAGED) expect(LOCALES.map((l) => l.id), id).not.toContain(id);
  });
  it('?lang=<staged> is ignored and the saved language stands', () => {
    for (const id of STAGED) {
      expect(resolveLang(id, 'en'), id).toBe('en');
      expect(resolveLang(id, 'pseudo'), id).toBe('pseudo');
    }
  });
});

/** The two things `applyLocale` touches, as a stub: this suite runs in a node environment. */
function root(): { attrs: Record<string, string>; dir: string; setAttribute: (k: string, v: string) => void } {
  const r = { attrs: {} as Record<string, string>, dir: '', setAttribute(k: string, v: string) { r.attrs[k] = v; } };
  return r;
}

describe('the mirrored pseudo-locale (GH-1406 part 2)', () => {
  it('?pseudo= picks the mode: rtl is the mirrored one, any other value the plain one, absent neither', () => {
    expect(pseudoModeOf('rtl')).toBe(PSEUDO_RTL);
    expect(pseudoModeOf('1')).toBe('pseudo');
    expect(pseudoModeOf('')).toBe('pseudo');
    expect(pseudoModeOf(null)).toBeNull();
  });
  it('applyLocale sets dir=rtl and the mirrored pseudo tag for it, and dir=ltr for en and the plain pseudo-locale', () => {
    const a = root(); applyLocale(a as never, PSEUDO_RTL);
    expect(a.dir).toBe('rtl'); expect(a.attrs.lang).toBe('qps-plocm');
    const b = root(); applyLocale(b as never, 'en');
    expect(b.dir).toBe('ltr'); expect(b.attrs.lang).toBe('en');
    const c = root(); applyLocale(c as never, 'pseudo');
    expect(c.dir).toBe('ltr');
  });
  it('is not a shipped locale and never a ?lang= value (a crafted link cannot steer a fetch with it)', () => {
    expect(LOCALES.some((l) => l.id === PSEUDO_RTL)).toBe(false);
    expect(resolveLang(PSEUDO_RTL, 'en')).toBe('en');
  });
  it('loads the bundled English catalogue, with no fetch', async () => {
    expect(isPseudo(PSEUDO_RTL) && isPseudo('pseudo') && !isPseudo('en')).toBe(true);
    const calls: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((...a: unknown[]) => { calls.push(a); return Promise.reject(new Error('no network in a test')); }) as typeof fetch;
    try {
      expect(await loadLocale(PSEUDO_RTL, 'https://invalid.example/')).toBe(en);
      expect(await loadLocale('pseudo', 'https://invalid.example/')).toBe(en);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual([]);
  });
  it('plural rules are asked for `en` under the mirrored locale, never for the made-up tag (the runtime would pick its own default)', () => {
    const asked: string[] = [];
    const Real = Intl.PluralRules;
    (Intl as unknown as { PluralRules: unknown }).PluralRules = class extends Real {
      constructor(locales?: string | string[], options?: Intl.PluralRulesOptions) {
        super(locales, options);
        asked.push(String(locales));
      }
    };
    try {
      setCatalogue(PSEUDO_RTL, { 'x.n': '{n, plural, one {# a} other {# b}}' }, pseudoRtl);
      t('x.n', { n: 3 });
    } finally {
      (Intl as unknown as { PluralRules: unknown }).PluralRules = Real;
      setCatalogue('en', en);
    }
    expect(asked).toEqual(['en']);
  });
  it('t() runs a string through the mirrored transform and keeps English plural categories', () => {
    setCatalogue(PSEUDO_RTL, { 'x.one': '{n, plural, one {# unit} other {# units}}' }, pseudoRtl);
    expect(t('x.one', { n: 1 })).toContain('üñîţ');
    expect(t('x.one', { n: 1 }).startsWith('\u202E')).toBe(true);
    expect(t('x.one', { n: 1 })).not.toContain('üñîţš');
    expect(t('x.one', { n: 2 })).toContain('üñîţš');
    setCatalogue('en', en);
  });
  it('boot is wired to it: ?pseudo= is parsed by pseudoModeOf, the transform and dir follow the mode (source guard)', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(main).toContain("const pseudoMode = pseudoModeOf(q.get('pseudo'));");
    expect(main).toContain('pseudoMode === PSEUDO_RTL ? pseudoRtl : pseudoMode');
    expect(main).toContain('applyLocale(document.documentElement, pseudoMode === PSEUDO_RTL ? PSEUDO_RTL : lang);');
    expect(main).not.toMatch(/q\.has\('pseudo'\)/);
  });
});
