// GH-1407 / GH-1378 Q8, Q6: the Steam store page copy (data/store/<lang>.md) keeps the lead's rules, and the numbers it states are the
// repository's own. The copy is a DRAFT held for the lead; this guard exists so an edit cannot quietly break a ruling or drift from the build.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const STORE = join(ROOT, 'data', 'store');
const LANGS = ['en', 'de', 'fr', 'es-ES'] as const;
const text = (l: string): string => readFileSync(join(STORE, `${l}.md`), 'utf8');
/** The visible copy: the file without its leading HTML comment. */
const copy = (l: string): string => text(l).replace(/^<!--[\s\S]*?-->\s*/, '');
const section = (l: string, name: string): string => new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(copy(l))?.[1] ?? '';

/** The lead's ruling (GH-1378 Q8): this line, in each language. */
const MIDDLE_EAST: Record<(typeof LANGS)[number], string> = {
  en: 'inspired by modern Middle East conflicts',
  de: 'inspiriert von modernen Konflikten im Nahen Osten',
  fr: 'inspiré des conflits modernes au Moyen-Orient',
  'es-ES': 'inspirada en los conflictos modernos de Oriente Medio',
};
const NEVER_SOLD: Record<(typeof LANGS)[number], string> = {
  en: 'earned and never sold',
  de: 'verdient und nie verkauft',
  fr: 'se gagnent et ne se vendent jamais',
  'es-ES': 'se ganan y nunca se venden',
};
const COSMETICS_ONLY: Record<(typeof LANGS)[number], string> = {
  en: 'buy cosmetics only',
  de: 'kaufen nur Kosmetik',
  fr: "n'achètent que des éléments cosmétiques",
  'es-ES': 'solo compran elementos cosméticos',
};
const THIRTY: Record<(typeof LANGS)[number], string> = { en: 'Thirty missions', de: 'Dreißig Einsätze', fr: 'Trente missions', 'es-ES': 'Treinta misiones' };

/** Claims the build cannot back today (lead: no co-op, no skirmish unless it exists), and real-world names the ruling forbids. */
const BANNED = [
  'co-op', 'coop', 'co-operative', 'cooperative', 'kooperativ', 'coopératif', 'cooperativo',
  'skirmish', 'scharmützel', 'escarmouche', 'escaramuza',
  'ranked', 'leaderboard', 'achievement', 'steam deck', 'controller', 'gamepad', 'ray tracing', 'pay to win', 'pay-to-win', 'loot box',
  'israel', 'gaza', 'palestin', 'hamas', 'hezbollah', 'hisbollah', 'idf', 'jerusalem', 'lebanon', 'libanon', 'liban', 'líbano', 'syria', 'syrien', 'syrie', 'siria',
  'iraq', 'irak', 'iran', 'afghanistan', 'jordan', 'egypt', 'ägypten', 'égypte', 'egipto', 'yom kippur', 'six-day', 'jew', 'jude', 'juif', 'judío', 'muslim', 'islam', 'allah', 'christian',
];

describe('the store page copy (data/store)', () => {
  it('has exactly the four files, the English source and three AI translations', () => {
    expect(readdirSync(STORE).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()).toEqual([...LANGS].map((l) => `${l}.md`).sort());
  });
  for (const l of LANGS) {
    describe(l, () => {
      it('has the five sections, the short description within Steam\'s 300 characters, and no placeholder passed off as copy', () => {
        const c = copy(l);
        expect([...c.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(['Short description', 'About this game', 'Key features', 'Languages', 'System requirements']);
        expect([...section(l, 'Short description').trim()].length).toBeLessThanOrEqual(300);
        expect(section(l, 'System requirements')).toMatch(/\[(PLACEHOLDER|PLATZHALTER|MARCADOR)/);
      });
      it('keeps the lead\'s line ("inspired by modern Middle East conflicts") in the short description and the long one', () => {
        expect(section(l, 'Short description')).toContain(MIDDLE_EAST[l]);
        expect(section(l, 'About this game')).toContain(MIDDLE_EAST[l]);
      });
      it('claims nothing the build cannot back and names no real war, place, person or faith', () => {
        const lower = copy(l).toLowerCase();
        for (const w of BANNED) expect(new RegExp(`(^|[^a-zà-ÿ])${w.replace(/[-.]/g, '\\$&')}([^a-zà-ÿ]|$)`).test(lower), `"${w}" in ${l}.md`).toBe(false);
      });
      it('says credits are earned and never sold, and that paid coins buy cosmetics only (GH-1378 Q6)', () => {
        const about = section(l, 'About this game');
        expect(about).toContain(NEVER_SOLD[l]);
        expect(about).toContain(COSMETICS_ONLY[l]);
      });
      it('states the repository\'s own numbers: the missions, the maps and the unit types', () => {
        const about = section(l, 'About this game');
        expect(about).toContain(THIRTY[l]);
        expect(readdirSync(join(ROOT, 'data', 'missions')).filter((f) => f.endsWith('.json'))).toHaveLength(30);
        expect(readdirSync(join(ROOT, 'data', 'maps')).filter((f) => f.endsWith('.json'))).toHaveLength(41);
        expect(about).toMatch(/\b41\b/);
        expect(section(l, 'Key features')).toMatch(/\b41\b/);
        expect(section(l, 'Key features')).toMatch(/\b40\b/);
      });
      it('has the same shape as the English: the same bullets, bold headings and list items', () => {
        const count = (lang: string, re: RegExp): number => (copy(lang).match(re) ?? []).length;
        expect(count(l, /^- /gm)).toBe(count('en', /^- /gm));
        expect(count(l, /^\*\*/gm)).toBe(count('en', /^\*\*/gm));
      });
    });
  }
  it('the unit-type claim ("more than 40") is true: the unit files minus civilians and the wounded', () => {
    const files = readdirSync(join(ROOT, 'data', 'units'), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json'));
    const ids = files.map((f) => (JSON.parse(readFileSync(join(ROOT, 'data', 'units', f), 'utf8')) as { id?: string }).id).filter((x): x is string => typeof x === 'string');
    const real = ids.filter((id) => id !== 'civilians' && !id.startsWith('wounded_'));
    expect(real.length).toBeGreaterThan(40);
  });
});
