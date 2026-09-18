// packages/app/src/i18n/t.ts
/**
 * The lookup + format + transform pipeline every screen's chrome text goes
 * through. Module state rather than a class -- there is exactly one active
 * catalogue for the whole document at a time (`main.ts` sets it once at
 * boot, from settings/`?lang`/`?pseudo`), and every screen calls the same
 * `t`.
 *
 * A missing key returns the key itself (so a broken lookup reads as an odd
 * label rather than blank chrome) and warns to the console exactly once per
 * key per session -- `missingKeys()` is what the tests and the pseudo
 * capture pass read back rather than scraping console output.
 */
import { format, type Params } from './format';
import en from './en.json';

export type { Params };
export type Catalogue = Readonly<Record<string, string>>;

interface State {
  locale: string;
  messages: Catalogue;
  transform?: (s: string) => string;
}

// Defaults to the bundled `en` catalogue rather than an empty one:
// `main.ts` overwrites this at boot from settings/`?lang`/`?pseudo`
// (`locales.ts`'s `loadLocale` + this module's own `setCatalogue`), but a UI
// test that mounts `settingsPanel`/`pauseMenu`/`showSaves`/`showCredits`
// directly -- without going through boot -- never calls `setCatalogue`
// itself, and still needs `t()` to resolve real English text the moment the
// module loads.
let state: State = { locale: 'en', messages: en };
const missing = new Set<string>();
const warned = new Set<string>();

export function setCatalogue(locale: string, messages: Catalogue, transform?: (s: string) => string): void {
  state = { locale, messages, transform };
}

export function currentLocale(): string {
  return state.locale;
}

export function missingKeys(): readonly string[] {
  return [...missing];
}

/** The pseudo-locale is the `en` catalogue with a transform layered on top
 *  (see `locales.ts`), not a real locale -- its plural CATEGORIES stay
 *  English even while its glyphs do not, so `Intl.PluralRules` gets `en`
 *  under `'pseudo'` rather than a tag it was never given rules for. */
function pluralLocale(locale: string): string {
  return locale === 'pseudo' ? 'en' : locale;
}

export function t(key: string, params?: Params): string {
  const msg = state.messages[key];
  if (msg === undefined) {
    missing.add(key);
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
  }
  const out = format(msg, params ?? {}, pluralLocale(state.locale));
  return state.transform ? state.transform(out) : out;
}
