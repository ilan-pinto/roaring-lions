/**
 * Place names through the locale overlay (GH-1406), the way unit text goes through `unit-text.ts`.
 *
 * `data/locales/<lang>/places.json` carries a translation of the world's name, each region's, each town's and each map's
 * (`data/locales/README.md`). The overlay is set once at boot (`setPlaceOverlay`, beside `setUnitOverlay`) and every reader asks at CALL
 * time -- never a table resolved at module load -- so a language chosen after import still shows.
 *
 * Two things this file does NOT do, on purpose:
 *  - It never touches `@lions/data`'s `mapManifest`, `maps` or the world JSON. The net content digest hashes the maps, so a peer on another
 *    language must still compute the same digest. The overlay is applied on the way OUT, to a copy (`applyMapNamesLocale`,
 *    `applyWorldLocale`), and a copy is made only when something is renamed.
 *  - It never feeds the sim anything. Map ids, town ids and region ids are what every lookup, sort and route uses; only the displayed name
 *    changes.
 */
import { applyMapNamesLocale, applyWorldLocale, mapManifest, type PlaceLocaleOverlay, type PlaceNamedWorld } from '@lions/data';
import { fetchLocaleJson } from './i18n/overlay-fetch';

let overlay: PlaceLocaleOverlay | null = null;

/** Install (or clear, with `null`) the active locale's place names. */
export function setPlaceOverlay(o: PlaceLocaleOverlay | null): void {
  overlay = o;
}

/** The map manifest with the active overlay's names on top; the SAME object when nothing is renamed. Ask at call time, never at import. */
export function localizedMapManifest(): typeof mapManifest {
  return applyMapNamesLocale(mapManifest, overlay);
}

/**
 * What a player reads for a map id: the overlay's name, else the manifest's, else `fallback`, else the id itself. `fallback` is for a
 * caller that holds the map's own JSON name (a map the manifest does not list reads as its JSON name, then as its id).
 */
export function mapName(id: string, fallback?: string): string {
  const translated = overlay?.maps !== undefined && Object.hasOwn(overlay.maps, id) ? overlay.maps[id] : undefined;
  if (translated !== undefined) return translated;
  const source = Object.hasOwn(mapManifest, id) ? (mapManifest as Readonly<Record<string, { readonly name: string }>>)[id] : undefined;
  return source?.name ?? fallback ?? id;
}

/** A world (the raw JSON or the parsed one) with the world, region and town names of the active overlay; the same object when nothing is renamed. */
export function localizedWorld<W extends PlaceNamedWorld>(world: W): W {
  return applyWorldLocale(world, overlay);
}

/**
 * `data/locales/<lang>/places.json`, served from `${base}locales/` (`vite-plugin-locales.ts`). `en` is the source text and is never fetched.
 * Any other id whose file is missing or unreadable is a null overlay, so a language with no place names yet plays in English, and a
 * `console.warn` names the URL (`i18n/overlay-fetch.ts`).
 */
export async function loadPlaceOverlay(lang: string, base: string): Promise<PlaceLocaleOverlay | null> {
  return fetchLocaleJson<PlaceLocaleOverlay>(lang, `${base}locales/${lang}/places.json`, 'place names');
}
