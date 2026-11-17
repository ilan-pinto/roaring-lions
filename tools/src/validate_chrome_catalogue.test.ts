// GH-1406: a non-English chrome catalogue has exactly en.json's keys and each value's message shape. Fixtures only for the cases a
// real catalogue never produces on purpose; the last block runs the check against every catalogue that ships beside en.json.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTRA_PLURAL_CATEGORIES, buildChromeSource, chromeCatalogueFailures, chromeSourceFailures, messageShape, pluralExtrasFor, withoutExtraPlurals } from '../validate_chrome_catalogue.mjs';

const fails = (en: Record<string, string>, tr: unknown, locale?: string): string[] => chromeCatalogueFailures('de.json', en, tr, { locale }) as string[];
const EN = {
  'a.plain': 'Back',
  'a.name': 'Mute {name}',
  'a.two': '{n} of {max}',
  'a.plural': '{n, plural, one {# unit} other {# units}} at ({x}, {y})',
  'a.select': '{reason, select, left {The other seat left} void {Match void} other {Match closed}}',
};
const OK = {
  'a.plain': 'Zurück',
  'a.name': '{name} stummschalten',
  'a.two': '{max} Plätze, davon {n}',
  'a.plural': '{n, plural, one {# Einheit} other {# Einheiten}} bei ({x}, {y})',
  'a.select': '{reason, select, left {Der andere Platz ist weg} void {Einsatz ungültig} other {Einsatz beendet}}',
};

describe('chromeCatalogueFailures', () => {
  it('accepts a translation that reorders placeholders and translates the text around and inside the options', () => {
    expect(fails(EN, OK)).toEqual([]);
  });
  it('names a missing key and an extra key', () => {
    const { 'a.two': _drop, ...rest } = OK;
    void _drop;
    expect(fails(EN, rest)).toEqual(['de.json: missing key "a.two"']);
    expect(fails(EN, { ...OK, 'b.extra': 'x' })).toEqual(['de.json: "b.extra" is not a key of en.json']);
  });
  it('refuses an empty, blank or non-string value', () => {
    expect(fails(EN, { ...OK, 'a.plain': '' })[0]).toMatch(/non-empty string/);
    expect(fails(EN, { ...OK, 'a.plain': '  ' })[0]).toMatch(/non-empty string/);
    expect(fails(EN, { ...OK, 'a.plain': 3 })[0]).toMatch(/non-empty string/);
  });
  it('refuses a dropped, added or renamed placeholder', () => {
    expect(fails(EN, { ...OK, 'a.name': 'stummschalten' })[0]).toMatch(/"a.name" has the wrong placeholders/);
    expect(fails(EN, { ...OK, 'a.name': '{name} {extra} stummschalten' })[0]).toMatch(/wrong placeholders/);
    expect(fails(EN, { ...OK, 'a.name': '{nom} stummschalten' })[0]).toMatch(/wrong placeholders/);
    expect(fails(EN, { ...OK, 'a.two': '{n} Plätze' })[0]).toMatch(/wrong placeholders/);
  });
  it('allows the options of a select to come in another order', () => {
    expect(fails(EN, { ...OK, 'a.select': '{reason, select, other {Einsatz beendet} void {Einsatz ungültig} left {Der andere Platz ist weg}}' })).toEqual([]);
  });
  it('refuses a translated ICU option key, a changed kind, a dropped option and a lost #', () => {
    expect(fails(EN, { ...OK, 'a.select': '{reason, select, links {a} void {b} other {c}}' })[0]).toMatch(/"a.select"/);
    expect(fails(EN, { ...OK, 'a.select': '{reason, select, left {a} void {b}}' })[0]).toMatch(/"a.select"/);
    expect(fails(EN, { ...OK, 'a.plural': '{n, select, one {# Einheit} other {# Einheiten}} bei ({x}, {y})' })[0]).toMatch(/"a.plural"/);
    expect(fails(EN, { ...OK, 'a.plural': '{n, plural, one {eine Einheit} other {# Einheiten}} bei ({x}, {y})' })[0]).toMatch(/"a.plural"/);
  });
  it('sees a placeholder inside an option, and unbalanced braces', () => {
    const en = { k: '{s, select, a {{name} left} other {x}}' };
    expect(fails(en, { k: '{s, select, a {ist weg} other {x}}' })[0]).toMatch(/wrong placeholders/);
    expect(fails(en, { k: '{s, select, a {{name} weg} other {x}}' })).toEqual([]);
    expect(messageShape('{oops')).toEqual(['!unbalanced']);
  });
  it('is not satisfied by a non-object', () => {
    expect(fails(EN, null)).toEqual(['de.json: not a JSON object of key -> text']);
    expect(fails(EN, [])).toEqual(['de.json: not a JSON object of key -> text']);
  });
});

describe('every shipped chrome catalogue beside en.json', () => {
  const dir = join(__dirname, '..', '..', 'packages', 'app', 'src', 'i18n');
  const en = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')) as Record<string, string>;
  const others = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json');
  for (const f of others) {
    it(`${f} has every key of en.json, the same shapes, and nothing else`, () => {
      expect(fails(en, JSON.parse(readFileSync(join(dir, f), 'utf8')), f.slice(0, -'.json'.length))).toEqual([]);
    });
  }
  it('en.json itself is self-consistent under the shape reader (no unparsed or unbalanced message)', () => {
    for (const [k, v] of Object.entries(en)) expect((messageShape(v) as string[]).filter((s) => s.startsWith('!')), k).toEqual([]);
  });
});

// The source-hash sidecar (data/locales/<id>/chrome.src.json): an English edit after translation goes red.
const h = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8);
const srcOf = (en: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(en).map(([k, v]) => [k, h(v)]));
const srcFails = (en: Record<string, string>, tr: Record<string, string>, src: unknown): string[] => chromeSourceFailures('de/chrome.src.json', en, tr, src) as string[];

describe('chromeSourceFailures', () => {
  it('accepts a sidecar holding the hash of every translated string\'s English', () => {
    expect(srcFails(EN, OK, srcOf(EN))).toEqual([]);
  });
  it('goes red when the ENGLISH changes after translation, naming both hashes (the whole point)', () => {
    const edited = { ...EN, 'a.plain': 'Back to menu' };
    const out = srcFails(edited, OK, srcOf(EN));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"a.plain" is stale');
    expect(out[0]).toContain(h('Back'));
    expect(out[0]).toContain(h('Back to menu'));
  });
  it('goes red for a key translated without a hash, a malformed hash and a hash for a key the catalogue does not translate', () => {
    const { 'a.name': _drop, ...rest } = srcOf(EN);
    void _drop;
    expect(srcFails(EN, OK, rest)[0]).toMatch(/"a.name" is translated but carries no source hash: set it to /);
    expect(srcFails(EN, OK, { ...srcOf(EN), 'a.name': 'XYZ' })[0]).toMatch(/not 8 hex characters/);
    expect(srcFails(EN, OK, { ...srcOf(EN), 'a.name': 7 })[0]).toMatch(/not 8 hex characters/);
    expect(srcFails(EN, OK, { ...srcOf(EN), 'b.gone': '00000000' })[0]).toMatch(/hash for "b.gone"/);
  });
  it('is not satisfied by a non-object, and does not double-report a key the catalogue check already names', () => {
    expect(srcFails(EN, OK, null)).toEqual(['de/chrome.src.json: not a JSON object of key -> source hash']);
    expect(srcFails(EN, OK, [])).toEqual(['de/chrome.src.json: not a JSON object of key -> source hash']);
    // an extra translated key has no English to hash: chromeCatalogueFailures reports it, this stays quiet
    expect(srcFails(EN, { ...OK, 'b.extra': 'x' }, srcOf(EN))).toEqual([]);
  });
});

describe('buildChromeSource', () => {
  it('hashes every translated key for a new locale', () => {
    expect(buildChromeSource(EN, OK)).toEqual(srcOf(EN));
  });
  it('keeps an existing entry, so a stale one stays red, and takes the current hash only for new keys', () => {
    const existing = { 'a.plain': h('Back (old English)') };
    const built = buildChromeSource(EN, OK, existing) as Record<string, string>;
    expect(built['a.plain']).toBe(h('Back (old English)'));
    expect(built['a.name']).toBe(h(EN['a.name']));
    expect(srcFails(EN, OK, built)[0]).toContain('"a.plain" is stale');
  });
  it('re-blesses exactly the keys it is told to', () => {
    const existing = { 'a.plain': h('old'), 'a.name': h('older') };
    const built = buildChromeSource(EN, OK, existing, ['a.plain']) as Record<string, string>;
    expect(built['a.plain']).toBe(h('Back'));
    expect(built['a.name']).toBe(h('older'));
  });
  it('leaves out a key the catalogue does not translate', () => {
    const { 'a.two': _x, ...rest } = OK;
    void _x;
    expect(Object.keys(buildChromeSource(EN, rest))).not.toContain('a.two');
  });
});

describe('every shipped chrome catalogue has a current sidecar', () => {
  const root = join(__dirname, '..', '..');
  const dir = join(root, 'packages', 'app', 'src', 'i18n');
  const en = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')) as Record<string, string>;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'en.json')) {
    const id = f.slice(0, -'.json'.length);
    it(`${id}: data/locales/${id}/chrome.src.json exists and no English chrome string has changed since it was translated`, () => {
      const path = join(root, 'data', 'locales', id, 'chrome.src.json');
      expect(existsSync(path), 'the sidecar exists').toBe(true);
      expect(srcFails(en, JSON.parse(readFileSync(join(dir, f), 'utf8')), JSON.parse(readFileSync(path, 'utf8')))).toEqual([]);
    });
  }
});

// Russian counts 1 / 2-4 / 5-20 differently, so its plurals carry one, few, many and other. Only languages in EXTRA_PLURAL_CATEGORIES may.
describe('extra plural categories (ru)', () => {
  const EN_PL = { k: '{n, plural, one {# unit} other {# units}} at {x}', z: '{n, plural, =0 {none} one {# unit} other {# units}}' };
  const RU = {
    k: '{n, plural, one {# единица} few {# единицы} many {# единиц} other {# единицы}} в {x}',
    z: '{n, plural, =0 {нет} one {# единица} few {# единицы} many {# единиц} other {# единицы}}',
  };
  it('accepts four forms for ru, with the English exact branches kept, and the strict two for everyone else', () => {
    expect(fails(EN_PL, RU, 'ru')).toEqual([]);
    expect(fails(EN_PL, { ...RU, k: '{n, plural, one {# unit} other {# units}} at {x}' }, 'ru')).toHaveLength(2); // ru without few and many
    expect(fails(EN_PL, { k: '{n, plural, one {# Einheit} other {# Einheiten}} bei {x}', z: '{n, plural, =0 {keine} one {# Einheit} other {# Einheiten}}' }, 'de')).toEqual([]);
  });
  it('refuses few and many for a language that is not listed: the check is not weakened for the others', () => {
    for (const locale of ['de', 'fr', 'es-ES', 'en', undefined]) expect(fails(EN_PL, RU, locale).length, String(locale)).toBeGreaterThan(0);
  });
  it('names a missing few or many, and a form whose placeholders differ from other', () => {
    const noMany = { ...RU, k: '{n, plural, one {# единица} few {# единицы} other {# единицы}} в {x}' };
    expect(fails(EN_PL, noMany, 'ru')[0]).toMatch(/no "many" branch/);
    const noFew = { ...RU, k: '{n, plural, one {# единица} many {# единиц} other {# единицы}} в {x}' };
    expect(fails(EN_PL, noFew, 'ru')[0]).toMatch(/no "few" branch/);
    const driftedFew = { ...RU, k: '{n, plural, one {# единица} few {# единицы {x}} many {# единиц} other {# единицы}} в {x}' };
    expect(fails(EN_PL, driftedFew, 'ru')[0]).toMatch(/branch "few" has different placeholders/);
    const lostHash = { ...RU, k: '{n, plural, one {# единица} few {единицы} many {# единиц} other {# единицы}} в {x}' };
    expect(fails(EN_PL, lostHash, 'ru')[0]).toMatch(/branch "few" has different placeholders/);
  });
  it('still holds everything else for ru: the option keys of the English, the arguments and the exact branches', () => {
    expect(fails(EN_PL, { ...RU, z: '{n, plural, one {# единица} few {# единицы} many {# единиц} other {# единицы}}' }, 'ru')[0]).toMatch(/"z"/); // =0 dropped
    expect(fails(EN_PL, { ...RU, k: '{count, plural, one {# единица} few {# единицы} many {# единиц} other {# единицы}} в {x}' }, 'ru')[0]).toMatch(/"k"/); // renamed argument
    expect(fails(EN_PL, { ...RU, k: '{n, plural, one {# единица} few {# единицы} many {# единиц} other {# единицы}}' }, 'ru')[0]).toMatch(/"k"/); // {x} lost
    expect(fails({ s: '{r, select, a {A} other {B}}' }, { s: '{r, select, a {А} few {Б} other {В}}' }, 'ru')[0]).toMatch(/"s"/); // few in a select is not a plural form
  });
  it('a plural nested inside a select option is read too', () => {
    const en = { m: '{r, select, a {{n, plural, one {# man} other {# men}}} other {x}}' };
    const ok = { m: '{r, select, a {{n, plural, one {# человек} few {# человека} many {# человек} other {# человека}}} other {х}}' };
    expect(fails(en, ok, 'ru')).toEqual([]);
    expect(fails(en, { m: '{r, select, a {{n, plural, one {# человек} other {# человека}}} other {х}}' }, 'ru')[0]).toMatch(/no "few" branch/);
  });
  it('the table agrees with the platform\'s plural rules: ru has few and many beyond one/other, de/fr/es-ES/en need no more than one/other here', () => {
    expect(EXTRA_PLURAL_CATEGORIES).toEqual({ ru: ['few', 'many'] });
    expect(new Intl.PluralRules('ru').resolvedOptions().pluralCategories.sort()).toEqual(['few', 'many', 'one', 'other']);
    expect(pluralExtrasFor('ru')).toEqual(['few', 'many']);
    expect(pluralExtrasFor('RU')).toEqual(['few', 'many']);
    for (const l of ['en', 'de', 'fr', 'es-ES', undefined]) expect(pluralExtrasFor(l as string), String(l)).toEqual([]);
  });
  it('withoutExtraPlurals changes nothing when there are no extras', () => {
    const m = '{n, plural, one {a} few {b} other {c}}';
    expect(withoutExtraPlurals(m, [])).toEqual({ text: m, problems: [] });
  });
});

