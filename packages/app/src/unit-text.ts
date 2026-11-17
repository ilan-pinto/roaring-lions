/**
 * Unit display text through the locale overlay (GH-1406), the way mission text goes through `applyMissionLocale`.
 *
 * `data/locales/<lang>/units.json` maps a unit id to `{ name?, blurb? }` (`data/locales/README.md`). The overlay is set once at boot
 * (`setUnitOverlay`, next to the chrome catalogue's `setCatalogue`) and every reader asks at CALL time -- never a table resolved at module
 * load, which is the mistake CLAUDE.md warns of -- so a language chosen after import still shows.
 *
 * Two things this file does NOT do, on purpose:
 *  - It never touches `@lions/data`'s `units`. The net content digest hashes that JSON, name included, so a peer on another language must
 *    still compute the same digest. The overlay is applied on the way OUT, to a copy.
 *  - It never feeds the sim anything it hashes. `sim.addUnitType` takes a localized copy (a type table is not hashed), but ids, costs and
 *    stats are untouched, so a replay in any language is the same replay.
 */
import { applyUnitLocale, units, type UnitLocaleOverlay } from '@lions/data';
import { fetchLocaleJson } from './i18n/overlay-fetch';

let overlay: UnitLocaleOverlay | null = null;

/** Install (or clear, with `null`) the active locale's unit text. */
export function setUnitOverlay(o: UnitLocaleOverlay | null): void {
  overlay = o;
}

/** A unit's JSON (or any `{ id, name?, blurb? }`) with the active overlay on top; the same object when nothing overlays it. */
export function localizedUnit<T extends { id: string; name?: string; blurb?: string }>(u: T): T {
  return applyUnitLocale(u, overlay);
}

/** What a player reads for a unit type id: the overlay's name, else the source name, else the id itself. */
export function unitName(id: string): string {
  const source = (units as Readonly<Record<string, { id: string; name?: string } | undefined>>)[id];
  return source === undefined ? (overlay?.[id]?.name ?? id) : (localizedUnit(source).name ?? id);
}

/** A unit's one-line description in the active locale, or undefined when the unit has none. */
export function unitBlurb(id: string): string | undefined {
  const source = (units as Readonly<Record<string, { id: string; name?: string; blurb?: string } | undefined>>)[id];
  return source === undefined ? undefined : localizedUnit(source).blurb;
}

/**
 * `data/locales/<lang>/units.json`, served from `${base}locales/` (`vite-plugin-locales.ts`). `en` is the source text and is never fetched. Any
 * other id whose file is missing or unreadable is a null overlay, so a translator's file going missing degrades to English instead of
 * breaking boot, and a `console.warn` names the URL (`i18n/overlay-fetch.ts`).
 */
export async function loadUnitOverlay(lang: string, base: string): Promise<UnitLocaleOverlay | null> {
  return fetchLocaleJson<UnitLocaleOverlay>(lang, `${base}locales/${lang}/units.json`, 'unit text');
}
