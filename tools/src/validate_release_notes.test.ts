// GH-1622: data/release-notes/*.json, its schema, and the filter gate tools/validate_release_notes.mjs holds over it.
// The shipped files must pass; then one literal entry per rule class goes red, and the word-boundary cases that must
// stay green are pinned beside them. Every fixture is a literal: nothing here is computed by the module under test.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { DENYLIST, entryHits, releaseNotesFailures } from '../validate_release_notes.mjs';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'data', 'release-notes');
const shipped = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: `data/release-notes/${f}`, doc: JSON.parse(readFileSync(join(DIR, f), 'utf8')) as unknown }));

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => (d: unknown) => boolean })({ allErrors: true, strict: false });
const schema = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'release_notes.schema.json'), 'utf8')) as object);

const next = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ version: 'next', units: [], rules: [], fixes: [], ...over });
const one = (entry: string) => releaseNotesFailures([{ file: 'data/release-notes/next.json', doc: next({ fixes: ['Tanks turn faster.', entry] }) }]);

describe('the shipped release notes', () => {
  it('include next.json, and every file passes the schema and the filter gate', () => {
    expect(shipped.map((s) => s.file)).toContain('data/release-notes/next.json');
    for (const s of shipped) expect(schema(s.doc), s.file).toBe(true);
    expect(releaseNotesFailures(shipped)).toEqual([]);
  });
});

describe('the schema', () => {
  it('takes the pinned format, empty arrays included', () => {
    expect(schema(next())).toBe(true);
    expect(schema({ version: '0.135.0', units: ['The Namer carrier joins the camp menu.'], rules: [], fixes: [] })).toBe(true);
  });
  it('refuses another key, a missing section, a bad version and a bad entry', () => {
    expect(schema(next({ extra: [] }))).toBe(false);
    expect(schema({ version: 'next', units: [], rules: [] })).toBe(false);
    expect(schema(next({ version: 'v0.135.0' }))).toBe(false);
    expect(schema(next({ version: '0.135' }))).toBe(false);
    expect(schema(next({ fixes: [''] }))).toBe(false);
    expect(schema(next({ fixes: [' leading space'] }))).toBe(false);
    expect(schema(next({ fixes: ['trailing space '] }))).toBe(false);
    expect(schema(next({ fixes: ['two\nlines'] }))).toBe(false);
    expect(schema(next({ fixes: ['x'.repeat(161)] }))).toBe(false);
    expect(schema(next({ fixes: ['x'.repeat(160)] }))).toBe(true);
    expect(schema(next({ fixes: ['Same.', 'Same.'] }))).toBe(false);
    expect(schema(next({ fixes: [3] }))).toBe(false);
  });
});

describe('the filter gate: one constructed entry per rule class goes red', () => {
  it('a denylisted word, with the file, the section, the index and the word', () => {
    expect(one('The CI is faster.')).toEqual([
      'data/release-notes/next.json: fixes[1] holds the denylisted word "CI" (CI): "The CI is faster."',
    ]);
  });
  // The lead's list (GH-1622), copied here as a literal so that deleting a word from the module goes red. "license", the US
  // spelling of "licence", is the one addition beyond the lead's list.
  const LEAD_LIST = [
    'worker', 'telemetry', 'D1', 'privacy', 'legal', 'licence', 'license', 'CLA', 'secret', 'password', 'token', 'stats', 'CI',
    'workflow', 'deploy', 'wrangler', 'Cloudflare', 'migration', 'admin', 'steward', 'agent',
  ];
  it('is exactly the lead\'s list', () => {
    expect([...DENYLIST]).toEqual(LEAD_LIST);
  });
  it('every denylisted word, in any case, and its simple plural', () => {
    for (const w of LEAD_LIST) {
      expect(entryHits(`A ${w} here.`), w).toHaveLength(1);
      expect(entryHits(`A ${w.toUpperCase()} here.`), w).toHaveLength(1);
      expect(entryHits(`Two ${w.toLowerCase()}s here.`), w).toHaveLength(1);
    }
    expect(entryHits('Fewer agents.')).toEqual(['the denylisted word "agents" (agent)']);
    expect(entryHits('New passwords.')).toEqual(['the denylisted word "passwords" (password)']);
    expect(entryHits("The agent's rule.")).toEqual(['the denylisted word "agent" (agent)']);
    expect(entryHits('A CI-only fix.')).toEqual(['the denylisted word "CI" (CI)']);
    expect(entryHits('Runs on Cloudflare.')).toEqual(['the denylisted word "Cloudflare" (Cloudflare)']);
  });
  it('a PR reference', () => {
    expect(one('Smoke lasts longer (PR 1547).')).toEqual([
      'data/release-notes/next.json: fixes[1] holds a PR reference "PR 1547": "Smoke lasts longer (PR 1547)."',
    ]);
    expect(entryHits('see pr12')).toEqual(['a PR reference "pr12"']);
  });
  it('an issue reference', () => {
    expect(one('Smoke lasts longer, GH-1622.')).toEqual([
      'data/release-notes/next.json: fixes[1] holds an issue reference "GH-1622": "Smoke lasts longer, GH-1622."',
    ]);
  });
  it('a hash sign followed by digits', () => {
    expect(entryHits('Smoke lasts longer (#1544).')).toEqual(['a hash sign followed by digits "#1544"']);
  });
  it('a git hash, short or full', () => {
    expect(one('Reverted f9b59a582.')).toEqual([
      'data/release-notes/next.json: fixes[1] holds a git hash "f9b59a582": "Reverted f9b59a582."',
    ]);
    expect(entryHits('At ec1f85fda0123456789abcdef0123456789abcde.')).toEqual(['a git hash "ec1f85fda0123456789abcdef0123456789abcde"']);
    expect(entryHits('Upper ABC1234 too.')).toEqual(['a git hash "ABC1234"']);
  });
  it('an internal id (snake_case)', () => {
    expect(one('The mbt_lavi turns faster.')).toEqual([
      'data/release-notes/next.json: fixes[1] holds an internal id (snake_case) "mbt_lavi": "The mbt_lavi turns faster."',
    ]);
  });
  it('a URL and a path', () => {
    expect(entryHits('Read https://example.com first.')).toEqual(['a URL "https://example.com"']);
    expect(entryHits('Read http://example.com/news.')).toEqual(['a URL "http://example.com/news."', 'a path "http://example.com/news."']);
    expect(entryHits('See data/units/x.json.')).toEqual(['a path "data/units/x.json."']);
    expect(entryHits('Faster CI/CD.')).toEqual(['the denylisted word "CI" (CI)', 'a path "CI/CD."']);
  });
  it('a word hidden by fullwidth letters or a format character, which is also refused on its own', () => {
    expect(entryHits('The \uFF23\uFF29 is faster.')).toEqual(['the denylisted word "CI" (CI)']);
    expect(entryHits('Rows in D\uFF11.')).toEqual(['the denylisted word "D1" (D1)']);
    expect(entryHits('Runs on C\u200Bloudflare.')).toEqual([
      'a format character (zero-width, soft hyphen or similar) U+200B',
      'the denylisted word "Cloudflare" (Cloudflare)',
    ]);
    expect(entryHits('Dep\u00ADloy faster.')).toEqual([
      'a format character (zero-width, soft hyphen or similar) U+00AD',
      'the denylisted word "Deploy" (deploy)',
    ]);
    expect(entryHits('Tanks\u200B turn.')).toEqual(['a format character (zero-width, soft hyphen or similar) U+200B']);
  });
  it('known gap: a look-alike letter from another script is not folded', () => {
    // Cyrillic U+0421 for the Latin C: documented in the module, no script check by the lead's choice.
    expect(entryHits('The \u0421I is faster.')).toEqual([]);
  });
  it('an @', () => {
    expect(entryHits('Thanks @someone.')).toEqual(['an @ (a handle or an address) "@someone."']);
  });
  it('reports every hit in an entry, and every bad entry in every section', () => {
    expect(entryHits('The admin fixed mbt_lavi (PR 12).')).toEqual([
      'the denylisted word "admin" (admin)',
      'a PR reference "PR 12"',
      'an internal id (snake_case) "mbt_lavi"',
    ]);
    expect(one('The admin fixed mbt_lavi (PR 12).')).toHaveLength(3);
    const r = releaseNotesFailures([
      { file: 'data/release-notes/next.json', doc: next({ units: ['ok', 'A new token.'], rules: ['The workflow.'], fixes: ['GH-1'] }) },
    ]);
    expect(r.map((f) => f.split(' holds ')[0])).toEqual([
      'data/release-notes/next.json: units[1]',
      'data/release-notes/next.json: rules[0]',
      'data/release-notes/next.json: fixes[0]',
    ]);
  });
});

describe('the filter gate: whole words, so these stay green', () => {
  it.each([
    'Civilians flee the town square faster.',
    'Circling helicopters keep their height.',
    'Illegal targets are marked in red.',
    'The unit status card shows wounds.',
    'Coins? No: credits.',
    'Special forces arrive by night.',
    'The defaced mosque wall reads as damaged.',
    'Night raids last 7 minutes, not 12.',
    'Version 0.135.0 of the tank turns at 25 degrees a second.',
    'Engineers clear 1,500,000 square metres.',
    'Prone riflemen are harder to hit.',
    'Ghosts of smoke no longer linger.',
    'A ditch-crossing bug no longer strands the Namer.',
  ])('%s', (entry) => {
    expect(entryHits(entry)).toEqual([]);
  });
});

describe('the filename rule', () => {
  it('holds next.json to "next" and v<X.Y.Z>.json to X.Y.Z', () => {
    const ok = [
      { file: 'data/release-notes/next.json', doc: next() },
      { file: 'data/release-notes/v0.135.0.json', doc: next({ version: '0.135.0' }) },
    ];
    expect(releaseNotesFailures(ok)).toEqual([]);
    expect(releaseNotesFailures([ok[0], { file: 'data/release-notes/v0.135.0.json', doc: next({ version: '0.135.1' }) }])).toEqual([
      'data/release-notes/v0.135.0.json: "version" is "0.135.1", and this file\'s name says "0.135.0"',
    ]);
    expect(releaseNotesFailures([{ file: 'data/release-notes/next.json', doc: next({ version: '0.135.0' }) }])).toEqual([
      'data/release-notes/next.json: "version" is "0.135.0", and this file\'s name says "next"',
    ]);
  });
  it('refuses another name, and a directory with no next.json', () => {
    expect(releaseNotesFailures([{ file: 'data/release-notes/next.json', doc: next() }, { file: 'data/release-notes/0.135.0.json', doc: next({ version: '0.135.0' }) }])).toEqual([
      'data/release-notes/0.135.0.json: the name must be next.json or v<X.Y.Z>.json',
    ]);
    expect(releaseNotesFailures([{ file: 'data/release-notes/v0.135.0.json', doc: next({ version: '0.135.0' }) }])).toEqual([
      'data/release-notes/next.json: missing; the release step and the promotion PR read it (an empty one is fine)',
    ]);
  });
});
