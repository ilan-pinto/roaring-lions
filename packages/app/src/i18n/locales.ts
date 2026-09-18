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
 * bundled `en` catalogue rather than leaving a screen with raw keys.
 */
import type { Catalogue } from './t';
import en from './en.json';

export interface Locale {
  id: string;
  name: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALES: readonly Locale[] = [{ id: 'en', name: 'English', dir: 'ltr' }];

const ENGLISH: Catalogue = en;

/** `lang` on `<html>` always reflects what was actually asked for, even an id
 *  nobody shipped a catalogue for -- a browser's own language heuristics
 *  (spellcheck, font fallback) still benefit from an honest tag. `dir` falls
 *  back to `ltr` for the same case, since `loadLocale` hands back the `en`
 *  catalogue (itself `ltr`) whenever it cannot find the one that was asked
 *  for. */
export function applyLocale(root: HTMLElement, id: string): void {
  root.setAttribute('lang', id);
  root.dir = LOCALES.find((l) => l.id === id)?.dir ?? 'ltr';
}

/** `en` (and the pseudo-locale, which is `en`'s own catalogue run through a
 *  transform in `t.ts`'s `setCatalogue`, not a file of its own) come from the
 *  bundle; anything else is fetched, and a missing or unreadable file falls
 *  back to `en` rather than booting the shell with an empty catalogue. */
export async function loadLocale(id: string, base: string): Promise<Catalogue> {
  if (id === 'en' || id === 'pseudo') return ENGLISH;
  try {
    const res = await fetch(`${base}locales/${id}.json`);
    if (!res.ok) return ENGLISH;
    return (await res.json()) as Catalogue;
  } catch {
    return ENGLISH;
  }
}
