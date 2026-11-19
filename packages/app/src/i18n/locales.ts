// packages/app/src/i18n/locales.ts
/**
 * The locale table -- one row per shipped catalogue. `dir` exists because
 * Arabic and Hebrew (`format.test.ts` already exercises both locales'
 * plural rules) read right-to-left; nothing ships either catalogue yet, but
 * `applyLocale` and the schema are ready for the day `en.json`'s keys get a
 * sibling file.
 *
 * Only `en` ships today -- `loadLocale` for anything else fetches a JSON file
 * under `${base}locales/` that does not exist yet and falls back to the
 * bundled `en` catalogue rather than leaving a screen with raw keys. That file
 * is `packages/app/src/i18n/<id>.json`, beside `en.json`:
 * `vite-plugin-locales.ts` serves it at `locales/<id>.json` in dev and emits it
 * in the build.
 */
import type { Catalogue } from './t';
import en from './en.json';
import { fetchLocaleJson } from './overlay-fetch';

export interface Locale {
  id: string;
  name: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALES: readonly Locale[] = [{ id: 'en', name: 'English', dir: 'ltr' }];

/** The mirrored pseudo-locale's id (`?pseudo=rtl`). Not a shipped catalogue and never a `?lang=` value: it is `en` run through
 *  `pseudo.ts`'s `pseudoRtl`, with `dir="rtl"` and the standard mirrored pseudo-locale tag `qps-plocm`. */
export const PSEUDO_RTL = 'pseudo-rtl';

/** Whether `id` is one of the two pseudo-locales (`en` through a transform, no file of its own). */
export function isPseudo(id: string): boolean {
  return id === 'pseudo' || id === PSEUDO_RTL;
}

/** What `?pseudo=<value>` asks for: `rtl` is the mirrored one, any other present value (`1`, empty) the plain one, absent is neither. */
export function pseudoModeOf(value: string | null): 'pseudo' | typeof PSEUDO_RTL | null {
  if (value === null) return null;
  return value === 'rtl' ? PSEUDO_RTL : 'pseudo';
}

const ENGLISH: Catalogue = en;

/** `lang` on `<html>` always reflects what was actually asked for, even an id
 *  nobody shipped a catalogue for -- a browser's own language heuristics
 *  (spellcheck, font fallback) still benefit from an honest tag. `dir` falls
 *  back to `ltr` for the same case, since `loadLocale` hands back the `en`
 *  catalogue (itself `ltr`) whenever it cannot find the one that was asked
 *  for. */
export function applyLocale(root: HTMLElement, id: string): void {
  if (id === PSEUDO_RTL) {
    root.setAttribute('lang', 'qps-plocm');
    root.dir = 'rtl';
    return;
  }
  root.setAttribute('lang', id);
  root.dir = LOCALES.find((l) => l.id === id)?.dir ?? 'ltr';
}

/** `en` (and the pseudo-locale, which is `en`'s own catalogue run through a
 *  transform in `t.ts`'s `setCatalogue`, not a file of its own) come from the
 *  bundle; anything else is fetched, and a missing or unreadable file falls
 *  back to `en` rather than booting the shell with an empty catalogue. */
export async function loadLocale(id: string, base: string): Promise<Catalogue> {
  if (id === 'en' || isPseudo(id)) return ENGLISH;
  return (await fetchLocaleJson<Catalogue>(id, `${base}locales/${id}.json`, 'chrome catalogue')) ?? ENGLISH;
}

/**
 * Which locale this load uses (security review review 559, F6). `?lang=` used to go
 * straight into the catalogue fetch path (`locales/${id}.json`) and the
 * mission-overlay path, so a crafted link steered a same-origin fetch to
 * wherever it liked. Only a shipped locale id, or the pseudo-locale, is
 * honoured; anything else is ignored and the saved language stands.
 */
export function resolveLang(requested: string | null, saved: string): string {
  if (requested !== null && isHonouredLang(requested)) return requested;
  return saved;
}

function isHonouredLang(id: string): boolean {
  return id === 'pseudo' || LOCALES.some((l) => l.id === id);
}

/**
 * The locale THIS load's URL forced on the document, or null when the saved
 * language stands (GH-1413 review F2): an honoured `?lang=`, or `?pseudo=rtl`,
 * whose tag and `dir` `applyLocale` writes. `applySettings` is handed it so a
 * settings change re-applies the session override, not the stored language,
 * until the page is left. Plain `?pseudo=1` keeps `lang` as it was, so it is no override here.
 */
export function sessionLangOverride(requested: string | null, pseudoMode: 'pseudo' | typeof PSEUDO_RTL | null): string | null {
  if (pseudoMode === PSEUDO_RTL) return PSEUDO_RTL;
  return requested !== null && isHonouredLang(requested) ? requested : null;
}
