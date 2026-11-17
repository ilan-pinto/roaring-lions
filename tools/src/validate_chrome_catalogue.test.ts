// GH-1406: a non-English chrome catalogue has exactly en.json's keys and each value's message shape. Fixtures only for the cases a
// real catalogue never produces on purpose; the last block runs the check against every catalogue that ships beside en.json.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChromeSource, chromeCatalogueFailures, chromeSourceFailures, messageShape } from '../validate_chrome_catalogue.mjs';
// @ts-expect-error: a plain .mjs module with no declarations, like the other validators the tools tests import.
import { isStaged, shippedLocaleIds } from '../locale_staging.mjs';

const fails = (en: Record<string, string>, tr: unknown): string[] => chromeCatalogueFailures('de.json', en, tr) as string[];
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
  const root = join(__dirname, '..', '..');
  const shipped = shippedLocaleIds(root);
  for (const f of others) {
    const id = f.slice(0, -'.json'.length);
    const staged = isStaged(id, shipped);
    // A SHIPPED language (in LOCALES) must carry every key of en.json; a STAGED one may lag (reported by validate:data) but is held to the same
    // shapes and to "nothing else" (tools/src/locale_staging.test.ts builds both cases).
    it(`${f} (${staged ? 'staged' : 'shipped'}) has ${staged ? 'only keys of' : 'every key of'} en.json, the same shapes, and nothing else`, () => {
      const lag: string[] = [];
      expect((chromeCatalogueFailures as (...a: unknown[]) => unknown)(f, en, JSON.parse(readFileSync(join(dir, f), 'utf8')), { staged, lag })).toEqual([]);
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
