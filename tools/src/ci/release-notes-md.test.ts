// GH-1622: the release step's notes, on literal fixtures. The markdown body for `gh release create`, the version rewrite
// of the released file, the fresh next.json, and the CLI's cut and render in a scratch directory.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { NOTHING, emptyNotes, escapeMd, releasedText, renderMarkdown } from '../../ci/release-notes-md.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ci/release-notes-md.mjs');

describe('renderMarkdown', () => {
  it('writes a heading per section, in order, one bullet per entry', () => {
    expect(
      renderMarkdown({
        version: '0.135.0',
        units: ['The Namer carrier joins the camp menu.'],
        rules: ['Smoke now blocks sight for 30 seconds.', 'Mortars can fire from inside a house.'],
        fixes: ['Tanks no longer spin on the spot before reversing.'],
      }),
    ).toBe(
      [
        '## New units',
        '',
        '- The Namer carrier joins the camp menu.',
        '',
        '## Rules and features',
        '',
        '- Smoke now blocks sight for 30 seconds.',
        '- Mortars can fire from inside a house.',
        '',
        '## Fixes',
        '',
        '- Tanks no longer spin on the spot before reversing.',
        '',
      ].join('\n'),
    );
  });
  it('leaves an empty section out', () => {
    expect(renderMarkdown({ version: '0.135.0', units: [], rules: [], fixes: ['Saves load faster.'] })).toBe('## Fixes\n\n- Saves load faster.\n');
    expect(renderMarkdown({ version: '0.135.0', units: ['A.'], rules: [], fixes: ['B.'] })).toBe('## New units\n\n- A.\n\n## Fixes\n\n- B.\n');
  });
  it('says there are no player-facing changes when all three are empty', () => {
    expect(NOTHING).toBe('No player-facing changes');
    expect(renderMarkdown({ version: '0.135.0', units: [], rules: [], fixes: [] })).toBe('No player-facing changes\n');
  });
  it('escapes markdown punctuation so an entry reads as written', () => {
    expect(escapeMd('Hold *Shift* for <more> [x] ~ | `a` \\')).toBe('Hold \\*Shift\\* for \\<more\\> \\[x\\] \\~ \\| \\`a\\` \\\\');
    expect(renderMarkdown({ version: '1.0.0', units: [], rules: ['Press *Q*.'], fixes: [] })).toBe('## Rules and features\n\n- Press \\*Q\\*.\n');
  });
  it('refuses a document that is not the pinned shape', () => {
    expect(() => renderMarkdown(null)).toThrow(/not an object/);
    expect(() => renderMarkdown({ version: '1.0.0', units: [], rules: [] })).toThrow(/"fixes" is not an array/);
    expect(() => renderMarkdown({ version: '1.0.0', units: [1], rules: [], fixes: [] })).toThrow(/"units" is not an array of strings/);
  });
});

describe('emptyNotes and releasedText', () => {
  it('write the committed shape', () => {
    expect(emptyNotes('next')).toBe('{\n  "version": "next",\n  "units": [],\n  "rules": [],\n  "fixes": []\n}\n');
  });
  it('rewrite only the version line of a hand-written file', () => {
    const raw = '{\n  "version": "next",\n  "units": [],\n  "rules": ["Smoke lasts longer."],\n  "fixes": []\n}\n';
    expect(releasedText(raw, '0.135.0')).toBe('{\n  "version": "0.135.0",\n  "units": [],\n  "rules": ["Smoke lasts longer."],\n  "fixes": []\n}\n');
  });
  it('rewrite a file in another layout into the committed shape', () => {
    expect(releasedText('{"version":"next","units":[],"rules":[],"fixes":["A."]}', '1.2.3')).toBe(
      '{\n  "version": "1.2.3",\n  "units": [],\n  "rules": [],\n  "fixes": [\n    "A."\n  ]\n}\n',
    );
  });
  it('refuse a file that is not next, and a version that is not X.Y.Z', () => {
    expect(() => releasedText('{"version":"0.1.0","units":[],"rules":[],"fixes":[]}', '0.2.0')).toThrow(/not "next"/);
    expect(() => releasedText(emptyNotes('next'), 'v0.2.0')).toThrow(/not X.Y.Z/);
    expect(() => releasedText(emptyNotes('next'), '0.2')).toThrow(/not X.Y.Z/);
    expect(() => releasedText('not json', '0.2.0')).toThrow();
  });
});

describe('the CLI', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'release-notes-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...a: string[]) => execFileSync('node', [SCRIPT, ...a, `--dir=${dir}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  it('cuts a moved next.json into vX.json and writes a fresh next.json, then renders it', () => {
    // The workflow's `git mv` has already happened: the drafted file sits at vX.json, still saying "next".
    writeFileSync(path.join(dir, 'v0.135.0.json'), '{\n  "version": "next",\n  "units": [],\n  "rules": [],\n  "fixes": ["Saves load faster."]\n}\n');
    run('cut', '--version=0.135.0');
    expect(readFileSync(path.join(dir, 'v0.135.0.json'), 'utf8')).toBe(
      '{\n  "version": "0.135.0",\n  "units": [],\n  "rules": [],\n  "fixes": ["Saves load faster."]\n}\n',
    );
    expect(readFileSync(path.join(dir, 'next.json'), 'utf8')).toBe('{\n  "version": "next",\n  "units": [],\n  "rules": [],\n  "fixes": []\n}\n');
    const out = path.join(dir, 'notes.md');
    run('render', '--version=0.135.0', `--out=${out}`);
    expect(readFileSync(out, 'utf8')).toBe('## Fixes\n\n- Saves load faster.\n');
  });
  it('still releases with no notes to move: an empty vX.json, and the empty body', () => {
    rmSync(path.join(dir, 'next.json'));
    run('cut', '--version=0.135.1');
    expect(readFileSync(path.join(dir, 'v0.135.1.json'), 'utf8')).toBe(emptyNotes('0.135.1'));
    expect(existsSync(path.join(dir, 'next.json'))).toBe(true);
    const out = path.join(dir, 'empty.md');
    run('render', '--version=0.135.1', `--out=${out}`);
    expect(readFileSync(out, 'utf8')).toBe('No player-facing changes\n');
  });
  it('creates the directory when it is missing', () => {
    const fresh = path.join(dir, 'not-there-yet');
    execFileSync('node', [SCRIPT, 'cut', '--version=2.0.0', `--dir=${fresh}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(readFileSync(path.join(fresh, 'v2.0.0.json'), 'utf8')).toBe(emptyNotes('2.0.0'));
    expect(readFileSync(path.join(fresh, 'next.json'), 'utf8')).toBe(emptyNotes('next'));
  });
  it('refuses to cut while next.json is still in place, and a bad version', () => {
    expect(() => run('cut', '--version=0.135.2')).toThrow(/still there/);
    expect(() => run('cut', '--version=v0.135.2')).toThrow(/X\.Y\.Z/);
    expect(() => run('publish', '--version=0.135.2')).toThrow(/cut or render/);
  });
});
