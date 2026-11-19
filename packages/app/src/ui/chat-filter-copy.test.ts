// GH-1417 follow-up (PR 1583 review, F4): the game's own free-play copy must pass the chat word filter's hide tier. A map card's name
// and its one line are what a player reads, quotes and types back in chat; a line the filter would hide whole, a callsign made of a
// map name that reads as the fallback name, is the game tripping its own filter. Every chrome catalogue is read (the shipped English
// and the staged languages alike, so a language is clean on the day it ships), and every shipped map's name.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maps } from '@lions/data/content';
import { filterLine, shippedFilter } from './chat-filter';

const I18N = join(dirname(fileURLToPath(import.meta.url)), '../i18n');
const MISSIONS_EN = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/locales/en/missions.json');

/** Every player-visible English mission string (the generated catalogue's text leaves; `src` holds hashes, not text). */
function missionLines(): { at: string; line: string }[] {
  const out: { at: string; line: string }[] = [];
  const walk = (v: unknown, at: string): void => {
    if (typeof v === 'string') out.push({ at, line: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'src') walk(x, `${at}.${k}`);
  };
  walk(JSON.parse(readFileSync(MISSIONS_EN, 'utf8')), 'missions');
  return out;
}
const catalogues = readdirSync(I18N)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ lang: f.slice(0, -'.json'.length), cat: JSON.parse(readFileSync(join(I18N, f), 'utf8')) as Record<string, string> }));

describe('free-play copy against the chat filter (GH-1417)', () => {
  it('every free-play map line, in every catalogue, passes the hide tier for a reader of that language', () => {
    // Not vacuous: English and the three staged languages, and English holds a line for every shipped map name below.
    expect(catalogues.map((c) => c.lang)).toEqual(expect.arrayContaining(['en', 'de', 'es-ES', 'fr']));
    let n = 0;
    for (const { lang, cat } of catalogues) {
      const reader = shippedFilter(lang);
      for (const [key, line] of Object.entries(cat)) {
        if (!key.startsWith('freePlay.map.')) continue;
        expect(filterLine(reader, line, { mask: false }).kind, `${lang} ${key}: ${line}`).toBe('show');
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(4 * 40);
  });

  it('every shipped map name passes the hide tier', () => {
    const names = Object.values(maps).map((m) => m.name);
    expect(names.length).toBeGreaterThanOrEqual(40);
    const reader = shippedFilter('en');
    for (const name of names) expect(filterLine(reader, name, { mask: false }).kind, name).toBe('show');
  });

  // The lead, 18 Nov 2026: reword the Ein Qasab II dyke lines too (briefing, trigger label and its radio line). Every shipped
  // mission line a player reads (briefing, objectives, labels, radio) passes the hide tier, so a later briefing cannot reintroduce one.
  it('every shipped English mission line passes the hide tier', () => {
    const lines = missionLines();
    expect(lines.length).toBeGreaterThanOrEqual(750);
    const reader = shippedFilter('en');
    for (const { at, line } of lines) expect(filterLine(reader, line, { mask: false }).kind, `${at}: ${line}`).toBe('show');
  });
});
