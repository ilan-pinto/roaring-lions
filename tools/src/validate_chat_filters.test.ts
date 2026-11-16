// GH-1417 S2: data/chat/filter.<lang>.json, its schema, and the provenance, licence and tier rules tools/validate_chat_filters.mjs
// holds over it. The shipped files must pass; then one fixture per rule, built in a scratch folder with a pristine "upstream" file of
// invented words, each run green and then broken by one edit.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { afterAll, describe, expect, it } from 'vitest';
import { chatFilterFailures } from '../validate_chat_filters.mjs';

const ROOT = join(__dirname, '..', '..');
const CHAT = join(ROOT, 'data', 'chat');
const shipped = readdirSync(CHAT)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: `data/chat/${f}`, doc: JSON.parse(readFileSync(join(CHAT, f), 'utf8')) as unknown }));

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => (d: unknown) => boolean })({ allErrors: true, strict: false });
const schema = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'chat_filter.schema.json'), 'utf8')) as object);

describe('the shipped chat word lists', () => {
  it('pass the schema and every cross-file rule, and report each language whose hide tier waits for a native reader', () => {
    expect(shipped.length).toBe(5);
    for (const s of shipped) expect(schema(s.doc), s.file).toBe(true);
    const r = chatFilterFailures(shipped, CHAT);
    expect(r.failures).toEqual([]);
    expect(r.warnings.map((w) => w.split(':')[0]).sort()).toEqual([
      'data/chat/filter.de.json',
      'data/chat/filter.es-ES.json',
      'data/chat/filter.fr.json',
      'data/chat/filter.ru.json',
    ]);
  });
});

// --- fixtures ----------------------------------------------------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'rl-chat-filter-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, 'third_party', 'fake'), { recursive: true });
const UPSTREAM = 'zorgon\nblarg\nescortz\nrude phrase\n';
writeFileSync(join(dir, 'third_party', 'fake', 'en'), UPSTREAM);
writeFileSync(join(dir, 'LICENSES.md'), '# licences\n\n- `third_party/fake/`: invented, CC BY 4.0\n');
const SHA = createHash('sha256').update(UPSTREAM).digest('hex');

interface Doc {
  [k: string]: unknown;
  hide: string[];
  mask: string[];
  allow: string[];
  dropped: string[];
  in_house: string[];
  source: Record<string, unknown>;
}
const good = (): Doc => ({
  version: 1,
  lang: 'en',
  review: 'in_house',
  source: { name: 'fake', url: 'https://example.invalid/fake', commit: 'a'.repeat(40), file: 'third_party/fake/en', sha256: SHA, licence: 'CC-BY-4.0' },
  hide: ['zorgon', 'quorlax'],
  mask: ['blarg', 'rude phrase'],
  allow: ['azorgonite'],
  dropped: ['escortz'],
  in_house: ['quorlax'],
});
const run = (doc: Doc, file = 'data/chat/filter.en.json') => chatFilterFailures([{ file, doc }], dir);

describe('chatFilterFailures, one fixture per rule', () => {
  it('passes the good fixture, and the schema takes it', () => {
    expect(run(good())).toEqual({ failures: [], warnings: [] });
    expect(schema(good())).toBe(true);
  });

  it('refuses a file not named for its lang', () => {
    expect(run(good(), 'data/chat/filter.fr.json').failures.join('\n')).toMatch(/not named filter\.en\.json/);
  });

  it('refuses a Chinese file (held out, proposal W4)', () => {
    const d = { ...good(), lang: 'zh-Hans' };
    expect(run(d, 'data/chat/filter.zh-Hans.json').failures.join('\n')).toMatch(/Chinese is held out/);
  });

  it('refuses a pristine copy edited after it was pinned', () => {
    const d = good();
    d.source = { ...d.source, sha256: 'b'.repeat(64) };
    expect(run(d).failures.join('\n')).toMatch(/not the pinned/);
  });

  it('refuses a source folder the licence record does not name', () => {
    mkdirSync(join(dir, 'third_party', 'other'), { recursive: true });
    writeFileSync(join(dir, 'third_party', 'other', 'en'), UPSTREAM);
    const d = good();
    d.source = { ...d.source, file: 'third_party/other/en' };
    expect(run(d).failures.join('\n')).toMatch(/third_party\/other is not named in data\/chat\/LICENSES\.md/);
  });

  it('refuses a missing source file', () => {
    const d = good();
    d.source = { ...d.source, file: 'third_party/fake/nope' };
    expect(run(d).failures.join('\n')).toMatch(/does not exist/);
  });

  it('refuses an upstream entry left out of every tier', () => {
    const d = good();
    d.dropped = [];
    expect(run(d).failures.join('\n')).toMatch(/upstream entry "escortz" is in none of hide, mask and dropped/);
  });

  it('refuses an entry that is neither upstream nor declared in_house (nothing copied without rights)', () => {
    const d = good();
    d.in_house = [];
    expect(run(d).failures.join('\n')).toMatch(/"quorlax" is not in the upstream list and not declared in_house/);
  });

  it('refuses an in_house entry that is upstream, or in no tier', () => {
    const d = good();
    d.in_house = ['quorlax', 'blarg', 'ghost'];
    const out = run(d).failures.join('\n');
    expect(out).toMatch(/in_house "blarg" is an upstream entry/);
    expect(out).toMatch(/in_house "ghost" is in neither hide nor mask/);
  });

  it('refuses an entry in two tiers', () => {
    const d = good();
    d.mask = [...d.mask, 'zorgon'];
    expect(run(d).failures.join('\n')).toMatch(/"zorgon" is in both hide and mask/);
  });

  it('refuses a hide tier on an unreviewed list, and reports an unreviewed list even when it is empty', () => {
    const d = { ...good(), review: 'none' };
    expect(run(d).failures.join('\n')).toMatch(/review is "none", so hide must be empty/);
    const empty = { ...good(), review: 'none', hide: [], mask: ['blarg', 'rude phrase', 'zorgon'], allow: [], in_house: [] };
    const r = run(empty);
    expect(r.failures).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/hide tier is empty until a native reader/);
  });

  it('refuses an allow entry that holds no hide entry', () => {
    const d = good();
    d.allow = ['azorgonite', 'harmless'];
    expect(run(d).failures.join('\n')).toMatch(/allow "harmless" contains no hide entry/);
  });

  it('refuses a missing licence record', () => {
    const bare = mkdtempSync(join(tmpdir(), 'rl-chat-bare-'));
    try {
      expect(chatFilterFailures([], bare).failures.join('\n')).toMatch(/LICENSES\.md: missing/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('chat_filter.schema.json', () => {
  it('refuses a pattern-looking entry, a stray space, an unknown key and a licence nobody ruled on', () => {
    for (const bad of ['f*ck', 'bad.+word', '(a|b)', '[ab]', ' lead', 'trail ', 'two  spaces', '^anchor$', 'back\\slash']) {
      const d = good();
      d.mask = [...d.mask, bad];
      expect(schema(d), bad).toBe(false);
    }
    expect(schema({ ...good(), extra: true })).toBe(false);
    expect(schema({ ...good(), source: { ...good().source, licence: 'CC-BY-SA-4.0' } })).toBe(false);
    expect(schema({ ...good(), review: 'maybe' })).toBe(false);
  });
});
