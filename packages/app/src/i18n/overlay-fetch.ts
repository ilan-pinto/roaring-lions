// packages/app/src/i18n/overlay-fetch.ts
/**
 * The one fetch every non-`en` locale file goes through (GH-1406 part 4): the chrome catalogue (`locales/<id>.json`), the mission text
 * (`locales/<lang>/missions.json`) and the unit text (`locales/<lang>/units.json`).
 *
 * `en` is the source text and the two pseudo-locales are `en` through a transform: none of them has a file, so none is ever fetched and
 * none ever warns. Any OTHER id whose file does not arrive is still a null result, so a missing or broken translation degrades to English
 * instead of breaking boot, but it is no longer SILENT: a `console.warn` names the URL and what came back, once per URL a session. A
 * warn, not an error, because `pnpm ui:routes` fails on any console error.
 *
 * Three ways a file fails to arrive, each worded: a status that is not ok, a request that throws, and the one that bit first, a 200 whose body
 * is not JSON. The dev server and the Worker both answer an unknown path with `index.html` and a 200 (the single-page-app fallback), so
 * "res.ok" alone says nothing about whether a translator's file is really there.
 */
const warned = new Set<string>();

export function resetOverlayWarnings(): void {
  warned.clear();
}

function warnOnce(url: string, message: string): void {
  if (warned.has(url)) return;
  warned.add(url);
  console.warn(`[i18n] ${message}`);
}

export async function fetchLocaleJson<T>(
  lang: string,
  url: string,
  what: string,
  fetchFn: typeof fetch = (...a) => fetch(...a)
): Promise<T | null> {
  if (lang === 'en' || lang === 'pseudo' || lang === 'pseudo-rtl') return null;
  try {
    const res = await fetchFn(url);
    if (!res.ok) {
      warnOnce(url, `${what} for "${lang}" did not load: ${url} answered ${res.status}; playing in English`);
      return null;
    }
    try {
      return (await res.json()) as T;
    } catch {
      warnOnce(url, `${what} for "${lang}" did not load: ${url} answered ${res.status} but its body is not JSON (a single-page-app fallback page, so the file is not served); playing in English`);
      return null;
    }
  } catch (err) {
    warnOnce(url, `${what} for "${lang}" did not load: ${url} could not be fetched (${err instanceof Error ? err.message : String(err)}); playing in English`);
    return null;
  }
}
