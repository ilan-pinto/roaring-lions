// The neutral register of the English text (docs/legal/naming-review.md): the words an age-rating board or storyline.md's register would
// object to, kept out of every string a player reads in English. The lead ruled on 18 Nov 2026 (PR 1594): "Suicide Squad", "Explosive vests"
// and the "kamikaze" dock bucket are renamed (Charge Squad, Satchel charges, one-way), so they join the zero-tolerance list; "Execution" (the
// orders heading) stays and is the one recorded exception.
//
// Two guards, both on VALUES (a key or an id is not text, and ids such as `charge_squad` and the weapon id `vest` are not touched):
//   1. ZERO TOLERANCE: no English string may contain martyr, terror*, massacre, slaughter, genocid*, torture, rape, behead*, jihad,
//      infidel, crusad*, "holy war", and since the rulings suicid*, "explosive vest(s)" and kamikaze. Today there are none; a new one fails.
//   2. THE RECORDED CENSUS: execut* occurs exactly where the review recorded it (the orders heading). A second place fails, and so does
//      the recorded place going (the demotion assertion: a rename must delete the entry in the same commit).
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

const BANNED = /martyr|terroris|terror\b|terrorism|massacre|slaughter|genocid|torture|\brape\b|behead|jihad|infidel|crusad|holy war|suicid|explosive vests?|kamikaze/i;
const CENSUS_TERMS: Record<string, RegExp> = {
  execution: /\bexecut/i,
};
/** Where each recorded term lives today: `source :: path => text`. LITERALS (the review's census, 18 Nov 2026). */
const RECORDED: Record<string, readonly string[]> = {
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
  it('finds the renamed words if they come back, and does not match a harmless word', () => {
    expect(hitsOf([...base, ['c', 'new.label', 'Suicide Squad']], BANNED)).toHaveLength(1);
    expect(hitsOf([...base, ['c', 'new.label', 'Explosive vests']], BANNED)).toHaveLength(1);
    expect(hitsOf([...base, ['c', 'new.label', 'kamikaze']], BANNED)).toHaveLength(1);
    expect(hitsOf([...base, ['c', 'new.label', 'The harvest vestibule, one-way']], BANNED)).toEqual([]);
  });
  it('finds a census term in a second place, and reads the recorded place going as a difference', () => {
    expect(hitsOf([...base, ['c', 'new.label', 'Execution']], CENSUS_TERMS.execution)).not.toEqual(RECORDED.execution);
    expect(hitsOf(base, CENSUS_TERMS.execution)).not.toEqual(RECORDED.execution);
  });
});
