// The promotion PR's changelog and its "is it already current" rule, on literal fixtures (B5-1).
//
// Every subject below is a literal copied from `git log origin/main..origin/dev` on 17 Nov 2026 or written by hand for
// its case; nothing is computed by the module under test and then asserted back against it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  END,
  MARKER,
  ciLine,
  decide,
  entriesOf,
  entryOf,
  groupOf,
  neutralise,
  notesLine,
  parseLog,
  renderBody,
  splitBody,
  titleOf,
  withTail,
  type Commit,
} from '../../ci/promotion-pr.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ci/promotion-pr.mjs');

const c = (sha: string, subject: string, parents = ['p'], body = ''): Commit => ({ sha, parents, subject, body });

// Newest first, as `git log` prints them: the real dev range of 17 Nov 2026.
const REAL: Commit[] = [
  c('f9b59a582aaaa', 'tools: report what a commercial build would leave out (GH-1415 c, report only) (PR 1547)'),
  c('f7de12777aaaa', 'ci + CLAUDE.md: PRs merge into dev; main moves only by promotion (#1544)'),
  c('c880317b8aaaa', "fonts: Cyrillic companions for Barlow and Big Shoulders Display, the lead's option B (GH-1407) (#1541)"),
  c('a00000001aaaa', 'content: held-ground income on four clearances, batch 2 of GH-1386 (#1498)'),
  c('a00000002aaaa', 'app: review notes on the save/resume follow-ups (GH-1393) (#1497)'),
  c('a00000003aaaa', 'i18n: stale-translation guard, a source-text hash per overlay entry (GH-1406 part 5) (#1468)'),
  c('a00000004aaaa', 'art: the Combat Engineers (demo_squad) figure, Meshy body + fitted kit (GH-826 unit 1) (#1537)'),
];

describe('neutralise', () => {
  it('rewrites a trailing (#NNN) as (PR NNN)', () => {
    expect(neutralise('app: thing (#1497)')).toBe('app: thing (PR 1497)');
  });
  it('keeps a trailing (PR NNN) as it is', () => {
    expect(neutralise('tools: thing (PR 1547)')).toBe('tools: thing (PR 1547)');
  });
  it('rewrites an inline #NNN as GH-NNN', () => {
    expect(neutralise('fix: the regression from #568 (#569)')).toBe('fix: the regression from GH-568 (PR 569)');
  });
  it('wraps an @handle so the body notifies nobody', () => {
    expect(neutralise('chore(deps-dev): bump @types/node, thanks @someone (#12)')).toBe(
      'chore(deps-dev): bump `@types/node`, thanks `@someone` (PR 12)',
    );
  });
  it('leaves an e-mail address alone', () => {
    expect(neutralise('docs: write to a@b.example (#3)')).toBe('docs: write to a@b.example (PR 3)');
  });
});

describe('groupOf', () => {
  it('reads the first word of the prefix', () => {
    expect(groupOf('ci + CLAUDE.md: PRs merge into dev')).toBe('ci');
    expect(groupOf('docs(campaign): a page')).toBe('docs');
    expect(groupOf('fix(ui)!: a break')).toBe('fix');
    expect(groupOf('tools, economy, net: three at once')).toBe('tools');
    expect(groupOf('App: capitalised')).toBe('app');
  });
  it('sends a subject with no prefix to other', () => {
    expect(groupOf('Show why a unit died (#900)')).toBe('other');
    expect(groupOf('a sentence that mentions 12:30 later')).toBe('other');
  });
});

describe('entryOf', () => {
  it('reads a squash subject in either spelling', () => {
    expect(entryOf(REAL[0])).toEqual({
      pr: 1547,
      sha: 'f9b59a582',
      group: 'tools',
      line: 'tools: report what a commercial build would leave out (GH-1415 c, report only) (PR 1547)',
    });
    expect(entryOf(REAL[1])).toEqual({
      pr: 1544,
      sha: 'f7de12777',
      group: 'ci',
      line: 'ci + CLAUDE.md: PRs merge into dev; main moves only by promotion (PR 1544)',
    });
  });
  it('reads a merge-commit PR from its body, not its subject', () => {
    const merged = c('b1', 'Merge pull request #1600 from ilan-pinto/some-branch', ['p1', 'p2'], 'app: the PR title (GH-12)\n\nmore');
    expect(entryOf(merged)).toEqual({ pr: 1600, sha: 'b1', group: 'app', line: 'app: the PR title (GH-12) (PR 1600)' });
  });
  it('skips a back-merge of main and a release bump', () => {
    expect(entryOf(c('b2', "Merge branch 'main' into dev", ['p1', 'p2']))).toBeNull();
    expect(entryOf(c('b3', 'chore(release): v0.133.13 [skip ci]'))).toBeNull();
  });
  it('lists a commit with no ref as a direct commit', () => {
    expect(entryOf(c('d0000000099', 'hotfix straight onto dev'))).toEqual({
      pr: null,
      sha: 'd00000000',
      group: 'other',
      line: 'hotfix straight onto dev',
    });
  });
});

describe('entriesOf', () => {
  it('lists oldest first, one per PR', () => {
    const dup = c('e1', 'art: the Combat Engineers again (#1537)');
    const out = entriesOf([dup, ...REAL]);
    expect(out.map((e) => e.pr)).toEqual([1537, 1468, 1497, 1498, 1541, 1544, 1547]);
  });
});

describe('ciLine', () => {
  it('reports the run on the tip', () => {
    expect(
      ciLine('f9b59a582aaaa', {
        tip: { status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/7' },
        latest: null,
      }),
    ).toBe('**Latest dev CI:** **success** on `f9b59a582`, the dev tip: https://github.com/o/r/actions/runs/7');
  });
  it('says a run is unfinished rather than calling it a result', () => {
    expect(ciLine('f9b59a582aaaa', { tip: { status: 'in_progress', conclusion: null, html_url: 'u' } })).toBe(
      '**Latest dev CI:** **in_progress** (not finished) on `f9b59a582`, the dev tip: u',
    );
  });
  it('falls back to the newest dev run and names its sha', () => {
    expect(
      ciLine('f9b59a582aaaa', {
        tip: null,
        latest: { status: 'completed', conclusion: 'failure', html_url: 'u2', head_sha: 'c880317b8bbbb' },
      }),
    ).toBe('**Latest dev CI:** no `ci` run found for the dev tip `f9b59a582`. The newest `ci` run on dev is **failure** on `c880317b8`: u2');
  });
  it('says unknown when there is nothing', () => {
    expect(ciLine('f9b59a582aaaa', null)).toBe(
      '**Latest dev CI:** unknown. No `ci` push run on dev was found for `f9b59a582` or before it.',
    );
  });
});

describe('titleOf', () => {
  it('counts PRs and direct commits, and carries no date', () => {
    expect(titleOf(entriesOf(REAL))).toBe('promote: dev to main (7 PRs)');
    expect(titleOf(entriesOf([c('d1', 'x'), REAL[0]]))).toBe('promote: dev to main (1 PR, 1 direct commit)');
  });
});

describe('renderBody', () => {
  const body = renderBody({
    entries: entriesOf([c('d1aaaaaaaaaa', 'straight onto dev'), c('o1aaaaaaaaaa', 'Show why a unit died (#900)'), ...REAL]),
    headSha: 'd1aaaaaaaaaa',
    baseSha: '0123456789ab',
    ci: { tip: { status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/7' } },
    compareUrl: 'https://github.com/o/r/compare/0123456789ab...d1aaaaaaaaaa',
  });

  it('groups alphabetically with other after them, one line per PR, and lists direct commits last', () => {
    const changelog = body.slice(body.indexOf('## Changelog'), body.indexOf(MARKER));
    expect(changelog).toBe(
      [
        '## Changelog',
        '',
        '### app (1)',
        '',
        '- app: review notes on the save/resume follow-ups (GH-1393) (PR 1497)',
        '',
        '### art (1)',
        '',
        '- art: the Combat Engineers (demo_squad) figure, Meshy body + fitted kit (GH-826 unit 1) (PR 1537)',
        '',
        '### ci (1)',
        '',
        '- ci + CLAUDE.md: PRs merge into dev; main moves only by promotion (PR 1544)',
        '',
        '### content (1)',
        '',
        '- content: held-ground income on four clearances, batch 2 of GH-1386 (PR 1498)',
        '',
        '### fonts (1)',
        '',
        "- fonts: Cyrillic companions for Barlow and Big Shoulders Display, the lead's option B (GH-1407) (PR 1541)",
        '',
        '### i18n (1)',
        '',
        '- i18n: stale-translation guard, a source-text hash per overlay entry (GH-1406 part 5) (PR 1468)',
        '',
        '### tools (1)',
        '',
        '- tools: report what a commercial build would leave out (GH-1415 c, report only) (PR 1547)',
        '',
        '### other (1)',
        '',
        '- Show why a unit died (PR 900)',
        '',
        '### Direct commits, no PR (1)',
        '',
        '- `d1aaaaaaa` straight onto dev',
        '',
        '',
      ].join('\n'),
    );
  });
  it('carries the dev CI result, the GITHUB_TOKEN note and the marker', () => {
    expect(body).toContain('**Latest dev CI:** **success** on `d1aaaaaaa`, the dev tip: https://github.com/o/r/actions/runs/7');
    expect(body).toContain('**This PR has no `ci` run of its own.**');
    expect(body).toContain('merge commit');
    expect(body).toContain(MARKER);
    expect(body.endsWith(END)).toBe(true);
  });
  it('holds no hash followed by a digit anywhere', () => {
    expect(body).not.toMatch(/#[0-9]/);
  });
  it('cuts an over-long changelog under the limit and says so', () => {
    const many = Array.from({ length: 400 }, (_, i) => c(`s${i}`, `app: change number ${i} with a long subject line to fill (#${i + 1})`));
    const cut = renderBody({ entries: entriesOf(many), headSha: 'h', baseSha: 'b', ci: null, limit: 8000 });
    expect(cut.length).toBeLessThanOrEqual(8000);
    expect(cut).toContain('The changelog is cut here');
    expect(cut).toContain(MARKER);
    expect(cut.endsWith(END)).toBe(true);
  });
});

// GH-1622: the release notes line. The texts are literal next.json files, as a drafter would commit them.
describe('notesLine', () => {
  const EMPTY = '{\n  "version": "next",\n  "units": [],\n  "rules": [],\n  "fixes": []\n}\n';
  const DRAFTED = JSON.stringify({
    version: 'next',
    units: ['The Namer carrier joins the camp menu.'],
    rules: ['Smoke now blocks sight for 30 seconds.', 'Mortars can fire from inside a house.'],
    fixes: [],
  });
  it('says a missing file must be created before promoting', () => {
    expect(notesLine(null)).toBe(
      '**Release notes:** `data/release-notes/next.json` does not exist on `dev`: create and draft it before promoting ' +
        '(guide: `docs/agent-notes/release-notes.md`).',
    );
  });
  it('says an empty file must be drafted before promoting', () => {
    expect(notesLine(EMPTY)).toBe(
      '**Release notes:** `data/release-notes/next.json` is empty: draft it before promoting ' +
        '(guide: `docs/agent-notes/release-notes.md`). A release cut from it says "No player-facing changes".',
    );
  });
  it('counts the entries per section, singular and plural', () => {
    expect(notesLine(DRAFTED)).toBe(
      '**Release notes:** `data/release-notes/next.json` holds 1 new unit, 2 rules and features, 0 fixes. ' +
        "The lead approves the wording in this PR's diff before merging.",
    );
    expect(notesLine('{"version":"next","units":[],"rules":["A."],"fixes":["B.","C."]}')).toBe(
      '**Release notes:** `data/release-notes/next.json` holds 0 new units, 1 rule or feature, 2 fixes. ' +
        "The lead approves the wording in this PR's diff before merging.",
    );
  });
  it('says a file that does not parse must be fixed', () => {
    expect(notesLine('{"version": "next", ')).toBe(
      '**Release notes:** `data/release-notes/next.json` on `dev` is not valid JSON: fix it before promoting ' +
        '(guide: `docs/agent-notes/release-notes.md`).',
    );
  });
  it('flags an entry a release on main already shipped (main not merged back into dev)', () => {
    const shipped = [
      { version: '0.135.0', raw: '{"version":"0.135.0","units":[],"rules":["Smoke now blocks sight for 30 seconds."],"fixes":[]}' },
      { version: '0.134.0', raw: '{"version":"0.134.0","units":["The Namer carrier joins the camp menu."],"rules":[],"fixes":[]}' },
      { version: '0.133.0', raw: 'not json' },
    ];
    expect(notesLine(DRAFTED, shipped)).toBe(
      '**Release notes:** `data/release-notes/next.json` holds 1 new unit, 2 rules and features, 0 fixes. ' +
        "The lead approves the wording in this PR's diff before merging. **2 of them already shipped** " +
        '(v0.134.0, v0.135.0 on `main`): merge `main` into `dev` and drop them before promoting.',
    );
    expect(notesLine(DRAFTED, [shipped[0]])).toContain('**1 of them already shipped** (v0.135.0 on `main`): merge `main` into `dev` and drop it');
    expect(notesLine(EMPTY, shipped)).toContain('is empty');
  });
  it('sits under the CI line in the body, and the body still holds no hash and digits', () => {
    const notes = notesLine(DRAFTED);
    const body = renderBody({ entries: entriesOf(REAL), headSha: 'h'.repeat(12), baseSha: 'b'.repeat(12), ci: null, notes });
    const ci = body.indexOf('**Latest dev CI:**');
    expect(ci).toBeGreaterThan(0);
    expect(body.indexOf(notes)).toBeGreaterThan(ci);
    expect(body.indexOf(notes)).toBeLessThan(body.indexOf('**This PR has no `ci` run of its own.**'));
    expect(body).not.toMatch(/#[0-9]/);
    // Idempotence: the same inputs write the same body; a changed next.json writes a different one.
    expect(renderBody({ entries: entriesOf(REAL), headSha: 'h'.repeat(12), baseSha: 'b'.repeat(12), ci: null, notes })).toBe(body);
    expect(renderBody({ entries: entriesOf(REAL), headSha: 'h'.repeat(12), baseSha: 'b'.repeat(12), ci: null, notes: notesLine(EMPTY) })).not.toBe(body);
  });
});

describe('decide', () => {
  const entries = entriesOf(REAL);
  const title = 'promote: dev to main (7 PRs)';
  const body = `intro\n${MARKER}`;

  it('creates when nothing is open', () => {
    expect(decide({ entries, title, body, open: [] })).toEqual({ action: 'create', number: null });
  });
  it('does nothing when the open PR already says exactly this, CRLF and a trailing newline aside', () => {
    expect(decide({ entries, title, body, open: [{ number: 9, title, body: `intro\r\n${MARKER}\r\n` }] })).toEqual({
      action: 'none',
      number: 9,
    });
  });
  it('updates when the body differs', () => {
    expect(decide({ entries, title, body, open: [{ number: 9, title, body: `older\n${MARKER}` }] })).toEqual({
      action: 'update',
      number: 9,
    });
  });
  it('updates when only the title differs', () => {
    expect(decide({ entries, title, body, open: [{ number: 9, title: 'promote: dev to main (6 PRs)', body }] })).toEqual({
      action: 'update',
      number: 9,
    });
  });
  it('never touches a PR a person opened', () => {
    expect(decide({ entries, title, body, open: [{ number: 9, title: 'my promotion', body: 'hand-written' }] })).toEqual({
      action: 'foreign',
      number: 9,
    });
  });
  it('opens nothing when dev holds nothing new', () => {
    expect(decide({ entries: [], title, body, open: [] })).toEqual({ action: 'empty', number: null });
  });

  // A review bot appends its summary below the body (it did on the hand-opened PR 1553).
  const ours = `intro\n${MARKER}\n${END}`;
  const bot = '<!-- an auto-generated comment: release notes -->\n## Summary\n\n* a feature';
  it('ignores what another writer appended after the end line', () => {
    expect(decide({ entries, title, body: ours, open: [{ number: 9, title, body: `${ours}\n\n${bot}\n` }] })).toEqual({
      action: 'none',
      number: 9,
    });
  });
  it('but still updates when our part above the end line differs', () => {
    expect(
      decide({ entries, title, body: ours, open: [{ number: 9, title, body: `older\n${MARKER}\n${END}\n\n${bot}` }] }),
    ).toEqual({ action: 'update', number: 9 });
  });
});

describe('splitBody and withTail', () => {
  const ours = `intro\n${MARKER}\n${END}`;
  it('split at the end line', () => {
    expect(splitBody(`${ours}\n\nbot text`)).toEqual({ ours, tail: '\n\nbot text' });
    expect(splitBody('no end line here')).toEqual({ ours: 'no end line here', tail: '' });
  });
  it('keep the appended tail on an update, after a blank line', () => {
    expect(withTail('new body', `old body\r\n${END}\r\n\r\nbot text\r\n`)).toBe('new body\n\nbot text');
  });
  it('add nothing when nothing was appended', () => {
    expect(withTail('new body', `old body\n${END}\n`)).toBe('new body');
    expect(withTail('new body', '')).toBe('new body');
  });
});

describe('parseLog', () => {
  it('splits the record and unit separators', () => {
    const raw = 'aaa\x1fp1\x1fapp: one (#1)\x1f\x1e\nbbb\x1fp1 p2\x1fMerge pull request #2 from o/b\x1fapp: two\n\x1e\n';
    expect(parseLog(raw)).toEqual([
      { sha: 'aaa', parents: ['p1'], subject: 'app: one (#1)', body: '' },
      { sha: 'bbb', parents: ['p1', 'p2'], subject: 'Merge pull request #2 from o/b', body: 'app: two' },
    ]);
  });
});

// The wiring: a throwaway repository where `dev` holds a squash commit, a merge-commit PR (whose second-parent commits
// must NOT be listed one by one) and a back-merge of main, and `main` holds a release bump dev never saw.
describe('the CLI on a real repository', () => {
  it('lists first-parent PRs only and prints the action', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'promotion-pr-'));
    const git = (...a: string[]) =>
      execFileSync('git', a, {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
      });
    const commit = (file: string, msg: string) => {
      writeFileSync(path.join(dir, file), msg);
      git('add', file);
      git('commit', '-q', '-m', msg);
    };
    git('init', '-q', '-b', 'main');
    commit('a', 'init');
    git('checkout', '-q', '-b', 'dev');
    commit('b', 'app: squashed change (#10)');
    // GH-1622: dev's notes, read from the dev ref (not the working tree), and main has no release-notes directory yet.
    mkdirSync(path.join(dir, 'data', 'release-notes'), { recursive: true });
    writeFileSync(path.join(dir, 'data', 'release-notes', 'next.json'), '{"version":"next","units":[],"rules":["A."],"fixes":[]}');
    git('add', 'data/release-notes/next.json');
    git('commit', '-q', '-m', 'data: the release notes (#12)');
    git('checkout', '-q', '-b', 'feature');
    commit('c', 'wip one');
    commit('d', 'wip two');
    git('checkout', '-q', 'dev');
    git('merge', '-q', '--no-ff', 'feature', '-m', 'Merge pull request #11 from o/feature\n\nsim: merged change');
    git('checkout', '-q', 'main');
    // The release on main shipped "A." already (v1.0.1.json), so dev's next.json repeating it is flagged.
    mkdirSync(path.join(dir, 'data', 'release-notes'), { recursive: true });
    writeFileSync(path.join(dir, 'data', 'release-notes', 'v1.0.1.json'), '{"version":"1.0.1","units":[],"rules":["A."],"fixes":[]}');
    git('add', 'data/release-notes/v1.0.1.json');
    commit('v', 'chore(release): v1.0.1 [skip ci]');
    git('checkout', '-q', 'dev');
    git('merge', '-q', '--no-ff', 'main', '-m', "Merge branch 'main' into dev");

    const out = path.join(dir, 'body.md');
    const printed = execFileSync('node', [SCRIPT, '--base=main', '--head=dev', `--out=${out}`], { cwd: dir, encoding: 'utf8' });
    expect(printed).toBe('action=create\nnumber=\ntitle=promote: dev to main (3 PRs)\n');
    const body = readFileSync(out, 'utf8');
    expect(body).toContain('- app: squashed change (PR 10)');
    expect(body).toContain('- sim: merged change (PR 11)');
    expect(body).not.toContain('wip');
    expect(body).not.toContain('Merge branch');
    expect(body).toContain('**Release notes:** `data/release-notes/next.json` holds 0 new units, 1 rule or feature, 0 fixes.');
    expect(body).toContain('**1 of them already shipped** (v1.0.1 on `main`)');

    // The same range against an open PR of ours that a bot has appended to: an update that keeps the bot's text.
    const open = path.join(dir, 'open.json');
    writeFileSync(open, JSON.stringify([{ number: 5, title: 'old', body: `stale\n${MARKER}\n${END}\n\nbot summary` }]));
    const again = execFileSync('node', [SCRIPT, '--base=main', '--head=dev', `--open=${open}`, `--out=${out}`], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(again).toBe('action=update\nnumber=5\ntitle=promote: dev to main (3 PRs)\n');
    const updated = readFileSync(out, 'utf8');
    expect(updated.startsWith(body.trimEnd())).toBe(true);
    expect(updated.endsWith(`${END}\n\nbot summary\n`)).toBe(true);
  });
});
