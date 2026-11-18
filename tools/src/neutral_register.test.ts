// The neutral register of the English text (docs/legal/naming-review.md): the words an age-rating board or storyline.md's register would
// object to, kept out of every string a player reads in English, and the four that are in today pinned to the exact string that holds them.
//
// Two guards, both on VALUES (a key or an id is not text, and ids such as `charge_squad` and the weapon id `vest` are not touched):
//   1. ZERO TOLERANCE: no English string may contain martyr, terror*, massacre, slaughter, genocid*, torture, rape, behead*, jihad,
//      infidel, crusad* or "holy war". Today there are none; a new one fails here.
//   2. THE RECORDED CENSUS: suicid*, explosive vest(s), kamikaze and execut* occur exactly where the review recorded them. A fifth place
//      fails (the guard), and so does a recorded place that has gone (the demotion assertion: when the lead picks a rename, delete the
//      matching entry in the same commit, which is what makes the rename visible).
// The oracles are LITERALS from the review's census, never read back from the data under test.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCES = ['data/locales/en/missions.json', 'data/locales/en/units.json', 'packages/app/src/i18n/en.json'] as const;

type Leaf = readonly [source: string, path: string, text: string];

function leaves(value: unknown, source: string, path = '', out: Leaf[] = []): Leaf[] {
  if (typeof value === 'string') out.push([source, path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => leaves(v, source, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object')
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) leaves(v, source, path === '' ? k : `${path}.${k}`, out);
  return out;
}

/** Every English string a player can read, with where it lives. `src` hash blocks are not text: they are skipped. */
function corpus(): Leaf[] {
  const out: Leaf[] = [];
  for (const s of SOURCES) leaves(JSON.parse(readFileSync(join(ROOT, s), 'utf8')), s, '', out);
  return out.filter(([, path]) => path !== 'src' && !/(^|\.)src(\.|$)/.test(path));
}

const BANNED = /martyr|terroris|terror\b|terrorism|massacre|slaughter|genocid|torture|\brape\b|behead|jihad|infidel|crusad|holy war/i;
const CENSUS_TERMS: Record<string, RegExp> = {
  suicide: /suicid/i,
  vest: /\bvests?\b/i,
  kamikaze: /kamikaze/i,
  execution: /\bexecut/i,
};
/** Where each recorded term lives today: `source :: path => text`. LITERALS (the review's census, 18 Nov 2026). */
const RECORDED: Record<string, readonly string[]> = {
  suicide: ['data/locales/en/units.json :: charge_squad.name => Suicide Squad'],
  vest: ['packages/app/src/i18n/en.json :: weapon.vest => Explosive vests'],
  kamikaze: ['packages/app/src/i18n/en.json :: dock.bucket.kamikaze => kamikaze'],
  execution: ['packages/app/src/i18n/en.json :: briefing.section.execution => Execution'],
};

const hitsOf = (rows: readonly Leaf[], re: RegExp): string[] => rows.filter(([, , text]) => re.test(text)).map(([s, p, t]) => `${s} :: ${p} => ${t}`).sort();

describe('the English text keeps the neutral register', () => {
  const rows = corpus();
  it('the corpus is real (so an empty scan cannot pass)', () => {
    expect(rows.length).toBeGreaterThan(2500);
    for (const s of SOURCES) expect(rows.some(([src]) => src === s), s).toBe(true);
  });
  it('no English string uses a zero-tolerance term', () => {
    expect(hitsOf(rows, BANNED)).toEqual([]);
  });
  for (const [term, re] of Object.entries(CENSUS_TERMS)) {
    it(`"${term}" occurs exactly where the review recorded it (a new place fails; a place that is gone must be deleted from RECORDED)`, () => {
      expect(hitsOf(rows, re)).toEqual([...(RECORDED[term] ?? [])].sort());
    });
  }
});

describe('the scanner can fail (constructed corpora)', () => {
  const base: Leaf[] = [['u', 'a.name', 'Charge Squad'], ['c', 'weapon.x', 'Satchel charges']];
  it('finds a zero-tolerance word in any case and inside a longer string', () => {
    expect(hitsOf([...base, ['u', 'b.blurb', 'A MARTYR walks in.']], BANNED)).toHaveLength(1);
    expect(hitsOf([...base, ['u', 'b.blurb', 'Fear of terrorism.']], BANNED)).toHaveLength(1);
    expect(hitsOf(base, BANNED)).toEqual([]);
  });
  it('finds a census term in a place nobody recorded, and does not match a harmless word', () => {
    expect(hitsOf([...base, ['c', 'new.label', 'Suicide run']], CENSUS_TERMS.suicide)).toHaveLength(1);
    expect(hitsOf([...base, ['c', 'new.label', 'The harvest vestibule']], CENSUS_TERMS.vest)).toEqual([]);
    expect(hitsOf([...base, ['c', 'new.label', 'Explosive vest']], CENSUS_TERMS.vest)).toHaveLength(1);
  });
  it('reads a recorded place that has gone as a difference, so a rename must delete its entry', () => {
    expect(hitsOf(base, CENSUS_TERMS.suicide)).not.toEqual(RECORDED.suicide);
  });
});
