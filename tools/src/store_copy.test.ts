// GH-1407 / GH-1378 Q8, Q6: the Steam store page copy (data/store/<lang>.md) keeps the lead's rules, and the numbers it states are the
// repository's own, DERIVED here from the data so the guard cannot pin a literal that drifts. The copy is a DRAFT held for the lead; this guard
// exists so an edit cannot quietly break a ruling or drift from the build.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const STORE = join(ROOT, 'data', 'store');
const LANGS = ['en', 'de', 'fr', 'es-ES'] as const;
type Lang = (typeof LANGS)[number];
const text = (l: string): string => readFileSync(join(STORE, `${l}.md`), 'utf8');
/** The visible copy: the file without its leading HTML comment. */
const copy = (l: string): string => text(l).replace(/^<!--[\s\S]*?-->\s*/, '');
const section = (l: string, name: string): string => new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(copy(l))?.[1] ?? '';
/** Lower-case, accents stripped: "Israël", "israélien" and "Israel" are one thing to the ban list. */
const plain = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The lead's ruling (GH-1378 Q8): this line, in each language. */
const MIDDLE_EAST: Record<Lang, string> = {
  en: 'inspired by modern Middle East conflicts',
  de: 'inspiriert von modernen Konflikten im Nahen Osten',
  fr: 'inspiré des conflits modernes au Moyen-Orient',
  'es-ES': 'inspirada en los conflictos modernos de Oriente Medio',
};
const NEVER_SOLD: Record<Lang, string> = {
  en: 'earned and never sold',
  de: 'verdient und nie verkauft',
  fr: 'se gagnent et ne se vendent jamais',
  'es-ES': 'se ganan y nunca se venden',
};
/** What coins buy, said truthfully (the lead's rule, 18 Nov 2026: coins buy new units; the Stores also sell upgrade tiers for coins, `stores.lede`). */
const COINS_BUY_UNITS: Record<Lang, string> = {
  en: 'buy new units and upgrade tiers',
  de: 'kaufen neue Einheiten und Aufrüstungsstufen',
  fr: 'achètent de nouvelles unités et des niveaux d\'amélioration',
  'es-ES': 'compran unidades nuevas y niveles de mejora',
};
/** The old promise, in each language: coins buy cosmetics only. It is no longer true and must not come back. */
const COSMETICS_PROMISE = /cosmeti[cq]|kosmet|cosm[ée]ti[cq]/i;
/** "Free to play", said the same way everywhere in a language: the short description, the bold heading and the key-features bullet. */
const FREE_TO_PLAY: Record<Lang, string> = {
  en: 'Free to play',
  de: 'Kostenlos spielbar',
  fr: 'Jouable gratuitement',
  'es-ES': 'Gratis para jugar',
};
/** The mission count in words, per language, for 30 to 40, and the noun after it. A count outside the table fails with a message to add the word,
 *  so a new batch of missions moves the copy and this guard together (PR 1452 brings five more). */
const MISSION_WORDS: Record<Lang, { noun: string; words: Record<number, string> }> = {
  en: { noun: 'missions', words: { 30: 'Thirty', 31: 'Thirty-one', 32: 'Thirty-two', 33: 'Thirty-three', 34: 'Thirty-four', 35: 'Thirty-five', 36: 'Thirty-six', 37: 'Thirty-seven', 38: 'Thirty-eight', 39: 'Thirty-nine', 40: 'Forty' } },
  de: { noun: 'Einsätze', words: { 30: 'Dreißig', 31: 'Einunddreißig', 32: 'Zweiunddreißig', 33: 'Dreiunddreißig', 34: 'Vierunddreißig', 35: 'Fünfunddreißig', 36: 'Sechsunddreißig', 37: 'Siebenunddreißig', 38: 'Achtunddreißig', 39: 'Neununddreißig', 40: 'Vierzig' } },
  fr: { noun: 'missions', words: { 30: 'Trente', 31: 'Trente et une', 32: 'Trente-deux', 33: 'Trente-trois', 34: 'Trente-quatre', 35: 'Trente-cinq', 36: 'Trente-six', 37: 'Trente-sept', 38: 'Trente-huit', 39: 'Trente-neuf', 40: 'Quarante' } },
  'es-ES': { noun: 'misiones', words: { 30: 'Treinta', 31: 'Treinta y una', 32: 'Treinta y dos', 33: 'Treinta y tres', 34: 'Treinta y cuatro', 35: 'Treinta y cinco', 36: 'Treinta y seis', 37: 'Treinta y siete', 38: 'Treinta y ocho', 39: 'Treinta y nueve', 40: 'Cuarenta' } },
};

/** What the repository says. */
const jsonFiles = (dir: string): string[] => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.json'));
const missionFiles = jsonFiles('data/missions');
const mapFiles = jsonFiles('data/maps');
/** Free Play's picker hides these cards (packages/app/src/ui/menu.ts, `UNLISTED_MAP_IDS`); a store reader counts the picker. */
const UNLISTED = [...(/UNLISTED_MAP_IDS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(readFileSync(join(ROOT, 'packages/app/src/ui/menu.ts'), 'utf8'))?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
const FREE_PLAY_MAPS = mapFiles.length - UNLISTED.length;

/** The Kedem towns and regions, read from the data so the list cannot go stale: the town part of each mission name and each region name. */
const NOT_PLACES = new Set(['Working Up', 'Tutorial Ground', 'Tile Study']);
function kedemNames(): string[] {
  const names = new Set<string>();
  const world = JSON.parse(readFileSync(join(ROOT, 'data/campaign/world.json'), 'utf8')) as { regions: { name: string }[] };
  for (const r of world.regions) {
    names.add(r.name);
    names.add(r.name.replace(/^The /, '').replace(/ Strip$/, ''));
  }
  for (const f of missionFiles) {
    const name = (JSON.parse(readFileSync(join(ROOT, 'data/missions', f), 'utf8')) as { name?: string }).name ?? '';
    const town = (name.split(/\s+[—–-]\s+/)[0] ?? '').replace(/\s+[IVX]+$/, '').trim();
    if (town !== '' && !NOT_PLACES.has(town)) names.add(town);
  }
  return [...names];
}

/** Real-world words the copy must not carry, matched from the START of a word (so "israeli" and "arabic" are caught), accents ignored: places,
 *  peoples, faiths, persons and operations. The lead's one line ("Middle East") is the only real-world name allowed. */
const BANNED_STEMS = [
  'israel', 'gaza', 'palestin', 'hamas', 'hezbol', 'hisbol', 'jerusal', 'lebanon', 'libanon', 'liban', 'syria', 'syrien', 'syrie', 'siria',
  'iraq', 'irak', 'iran', 'afghan', 'jordan', 'egypt', 'agypt', 'egipt', 'turk', 'turc', 'turqu', 'saudi', 'yemen', 'kurd', 'persia', 'persian', 'persisch', 'persan',
  'arab', 'hebre', 'hebra', 'jewish', 'juif', 'judio', 'juedisch', 'judisch', 'muslim', 'islam', 'christ', 'cristian', 'chretien', 'allah', 'sunni', 'shia', 'schii',
  'netanyahu', 'nasrallah', 'assad', 'saddam', 'bin laden', 'arafat', 'erdogan', 'putin', 'trump', 'biden', 'obama',
  'protective edge', 'cast lead', 'iron swords', 'desert storm', 'enduring freedom', 'yom kippur', 'six-day', 'gulf war',
];
/** Whole words only (short, or inside common words). */
const BANNED_WORDS = ['idf', 'jew', 'jude', 'juden', 'perse', 'persa'];
/** Claims the build cannot back today (lead: no co-op, no skirmish unless it exists). */
const UNBACKED = [
  'co-op', 'coop', 'co-operative', 'cooperative', 'kooperativ', 'cooperatif', 'cooperativo',
  'skirmish', 'scharmutzel', 'escarmouche', 'escaramuza',
  'ranked', 'leaderboard', 'achievement', 'steam deck', 'controller', 'gamepad', 'ray tracing', 'pay to win', 'pay-to-win', 'loot box', 'webgpu',
];
const hits = (haystack: string, term: string, wholeWord: boolean): boolean =>
  new RegExp(`(^|[^a-z])${term.replace(/[-.]/g, '\\$&')}${wholeWord ? '([^a-z]|$)' : ''}`).test(haystack);

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
      it('claims nothing the build cannot back, and names no real war, place, people, person, operation or faith', () => {
        const p = plain(copy(l));
        for (const w of UNBACKED) expect(hits(p, plain(w), true), `"${w}" in ${l}.md`).toBe(false);
        for (const w of BANNED_STEMS) expect(hits(p, plain(w), false), `"${w}" in ${l}.md`).toBe(false);
        for (const w of BANNED_WORDS) expect(hits(p, w, true), `"${w}" in ${l}.md`).toBe(false);
      });
      it('names no Kedem town or region (read from the data), so a place is never pinned to the fiction', () => {
        const c = copy(l);
        const names = kedemNames();
        expect(names.length, 'the name list is not empty').toBeGreaterThan(10);
        for (const n of names) expect(new RegExp(`(^|[^\\p{L}])${n.replace(/[-.]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(c), `"${n}" in ${l}.md`).toBe(false);
      });
      it('says credits are earned and never sold, and that coins buy new units and upgrade tiers (GH-1378 Q6, as reversed by the lead on 18 Nov 2026)', () => {
        const about = section(l, 'About this game');
        expect(about).toContain(NEVER_SOLD[l]);
        expect(about).toContain(COINS_BUY_UNITS[l]);
      });
      it('makes no cosmetics-only promise anywhere in the copy (the rule was reversed)', () => {
        expect(copy(l)).not.toMatch(COSMETICS_PROMISE);
      });
      it('says "free to play" one way: in the short description, as a bold heading, and in a key-features bullet', () => {
        expect(section(l, 'Short description')).toContain(`${FREE_TO_PLAY[l]}.`);
        expect(section(l, 'About this game')).toContain(`**${FREE_TO_PLAY[l]}.**`);
        expect(section(l, 'Key features')).toMatch(new RegExp(`^- ${FREE_TO_PLAY[l]}, `, 'm'));
      });
      it('states the repository\'s own numbers: the missions, the Free Play maps and the unit types', () => {
        const about = section(l, 'About this game');
        const { noun, words } = MISSION_WORDS[l];
        const word = words[missionFiles.length];
        expect(word, `add the word for ${missionFiles.length} missions to MISSION_WORDS (${l}), and move the copy and README E4 with it`).toBeDefined();
        expect(about).toContain(`${word} ${noun}`);
        for (const where of [about, section(l, 'Key features')]) expect(where, `${FREE_PLAY_MAPS} free-play maps`).toMatch(new RegExp(`\\b${FREE_PLAY_MAPS}\\b`));
        expect(section(l, 'Key features')).toMatch(/\b40\b/);
      });
      it('has the same shape as the English: the same bullets, bold headings and list items', () => {
        const count = (lang: string, re: RegExp): number => (copy(lang).match(re) ?? []).length;
        expect(count(l, /^- /gm)).toBe(count('en', /^- /gm));
        expect(count(l, /^\*\*/gm)).toBe(count('en', /^\*\*/gm));
      });
    });
  }
  it('Free Play hides exactly the unlisted maps, and the count is what a picker shows (the guard reads menu.ts)', () => {
    expect(UNLISTED.length).toBeGreaterThan(0);
    for (const id of UNLISTED) expect(mapFiles, id).toContain(`${id}.json`);
    expect(FREE_PLAY_MAPS).toBeGreaterThan(0);
    expect(FREE_PLAY_MAPS).toBeLessThan(mapFiles.length);
  });
  it('the unit-type claim ("more than 40") is true: the unit files minus civilians and the wounded', () => {
    const files = readdirSync(join(ROOT, 'data', 'units'), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json'));
    const ids = files.map((f) => (JSON.parse(readFileSync(join(ROOT, 'data', 'units', f), 'utf8')) as { id?: string }).id).filter((x): x is string => typeof x === 'string');
    const real = ids.filter((id) => id !== 'civilians' && !id.startsWith('wounded_'));
    expect(real.length).toBeGreaterThan(40);
  });
});
