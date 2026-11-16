// GH-1406: a non-English chrome catalogue has exactly en.json's keys and each value's message shape. Fixtures only for the cases a
// real catalogue never produces on purpose; the last block runs the check against every catalogue that ships beside en.json.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromeCatalogueFailures, messageShape } from '../validate_chrome_catalogue.mjs';

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
  for (const f of others) {
    it(`${f} has every key of en.json, the same shapes, and nothing else`, () => {
      expect(fails(en, JSON.parse(readFileSync(join(dir, f), 'utf8')))).toEqual([]);
    });
  }
  it('en.json itself is self-consistent under the shape reader (no unparsed or unbalanced message)', () => {
    for (const [k, v] of Object.entries(en)) expect((messageShape(v) as string[]).filter((s) => s.startsWith('!')), k).toEqual([]);
  });
});
