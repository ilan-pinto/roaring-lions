// GH-1406: the translators' worklist (tools/locales_pending.mjs) and the weekly job that posts it. Everything here is constructed: a language's
// files are copied from the real ones and then damaged in a known way, and the worklist must name exactly that damage and nothing else.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs module with no declarations.
import { pendingChrome, pendingFor, pendingMissions, pendingUnits, renderMarkdown, stagedLocales } from '../locales_pending.mjs';

const ROOT = join(__dirname, '..', '..');
const read = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as T;
type Rec = Record<string, unknown>;

// ---- chrome ------------------------------------------------------------------------------------------------------------------------------
describe('pendingChrome', () => {
  const en = { 'a.plain': 'Back', 'a.name': 'Mute {name}', 'a.plural': '{n, plural, one {# unit} other {# units}}', 'a.new': 'Saved' };
  const tr = { 'a.plain': 'Zurück', 'a.name': '{name} stummschalten', 'a.plural': '{n, plural, one {# Einheit} other {# Einheiten}}' };
  const h = (s: string): string => execFileSync('node', ['-e', `console.log(require('node:crypto').createHash('sha256').update(${JSON.stringify(s)}).digest('hex').slice(0,8))`]).toString().trim();
  const src = { 'a.plain': h('Back'), 'a.name': h('Mute {name}'), 'a.plural': h('{n, plural, one {# unit} other {# units}}') };

  it('is empty for a catalogue that is complete, current and well-formed', () => {
    const { 'a.new': _x, ...enOld } = en;
    void _x;
    expect(Object.values(pendingChrome(enOld, tr, src, 'de')).flat()).toEqual([]);
  });
  it('lists a key the English gained as missing, and only that', () => {
    const r = pendingChrome(en, tr, src, 'de');
    expect(r).toEqual({ missing: ['a.new'], extra: [], stale: [], unhashed: [], shape: [] });
  });
  it('lists a key whose English changed after translation as stale', () => {
    const { 'a.new': _x, ...enOld } = en;
    void _x;
    expect(pendingChrome({ ...enOld, 'a.plain': 'Back to menu' }, tr, src, 'de').stale).toEqual(['a.plain']);
  });
  it('lists a translated key with no hash as unhashed, and a key the English dropped as extra', () => {
    const { 'a.new': _x, ...enOld } = en;
    void _x;
    const { 'a.name': _y, ...fewer } = src;
    void _y;
    expect(pendingChrome(enOld, tr, fewer, 'de').unhashed).toEqual(['a.name']);
    const { 'a.plain': _z, ...enLess } = enOld;
    void _z;
    expect(pendingChrome(enLess, tr, src, 'de').extra).toEqual(['a.plain']);
  });
  it('lists a key with a renamed placeholder or the wrong plural shape; Russian\'s four forms are fine for ru and not for de', () => {
    const { 'a.new': _x, ...enOld } = en;
    void _x;
    expect(pendingChrome(enOld, { ...tr, 'a.name': '{nom} stummschalten' }, src, 'de').shape).toEqual(['a.name']);
    const ru = { ...tr, 'a.plural': '{n, plural, one {# единица} few {# единицы} many {# единиц} other {# единицы}}' };
    expect(pendingChrome(enOld, ru, src, 'ru').shape).toEqual([]);
    expect(pendingChrome(enOld, ru, src, 'de').shape).toEqual(['a.plural']);
  });
  it('treats a missing catalogue and a missing sidecar as everything missing', () => {
    expect(pendingChrome(en, null, null, 'de').missing).toEqual(Object.keys(en));
    expect(pendingChrome(en, tr, null, 'de').unhashed).toEqual(['a.plain', 'a.name', 'a.plural']);
  });
});

// ---- missions and units --------------------------------------------------------------------------------------------------------------------
describe('pendingMissions and pendingUnits', () => {
  const enM = read<Rec>('data/locales/en/missions.json');
  const enU = read<Rec>('data/locales/en/units.json');
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const id = Object.keys(enM)[0] ?? '';
  const uid = Object.keys(enU)[0] ?? '';

  it('is empty when the overlay is the English catalogue itself (every path present, every hash current)', () => {
    expect(Object.values(pendingMissions(enM, clone(enM))).flat()).toEqual([]);
    expect(Object.values(pendingUnits(enU, clone(enU))).flat()).toEqual([]);
  });
  it('lists a mission with no entry as missing as a whole, and an overlay entry for a gone mission as extra', () => {
    const tr = clone(enM) as Rec;
    delete tr[id];
    tr.gone_mission = {};
    const r = pendingMissions(enM, tr);
    expect(r.missing).toEqual([{ id, path: null }]);
    expect(r.extra).toEqual([{ id: 'gone_mission', path: null }]);
  });
  it('lists exactly the paths that were removed, edited and added', () => {
    const tr = clone(enM) as Record<string, Rec>;
    const e = tr[id] as Record<string, unknown>;
    const objectives = e.objectives as Record<string, string>;
    const firstObjective = Object.keys(objectives)[0] ?? '';
    delete objectives[firstObjective];
    const src = e.src as Record<string, string>;
    src.name = '00000000'; // stale: translated from other English
    delete src.briefing; // unhashed
    (e.sections as Record<string, string>).invented_section = 'x'; // extra
    const r = pendingMissions(enM, tr);
    expect(r.missing).toEqual([{ id, path: `objectives.${firstObjective}` }]);
    expect(r.stale).toEqual([{ id, path: 'name' }]);
    expect(r.unhashed).toEqual([{ id, path: 'briefing' }]);
    expect(r.extra).toEqual([{ id, path: 'sections.invented_section' }]);
  });
  it('lists a unit whose English changed (stale), and a unit blurb that is gone (missing)', () => {
    const tr = clone(enU) as Record<string, Rec>;
    const u = tr[uid] as Record<string, unknown>;
    (u.src as Record<string, string>).name = 'ffffffff';
    const withBlurb = Object.keys(enU).find((k) => typeof (enU[k] as Rec).blurb === 'string') ?? '';
    delete (tr[withBlurb] as Rec).blurb;
    const r = pendingUnits(enU, tr);
    expect(r.stale).toEqual([{ id: uid, path: 'name' }]);
    expect(r.missing).toEqual([{ id: withBlurb, path: 'blurb' }]);
  });
});

// ---- a whole tree, and the CLI ---------------------------------------------------------------------------------------------------------------
describe('pendingFor, renderMarkdown and the command line, on a copy of the real tree', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'locales-pending-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  // A tree with the English files and, if the repository has staged languages, the first one, copied; else a synthetic language built from English.
  const staged = stagedLocales(ROOT) as string[];
  const lang = staged[0] ?? 'xx';
  const tree = (name: string): string => {
    const dir = join(tmp, name);
    for (const rel of ['packages/app/src/i18n/en.json', 'data/locales/en/missions.json', 'data/locales/en/units.json']) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      cpSync(join(ROOT, rel), join(dir, rel));
    }
    mkdirSync(join(dir, `data/locales/${lang}`), { recursive: true });
    if (staged.length > 0) {
      for (const rel of [`packages/app/src/i18n/${lang}.json`, `data/locales/${lang}/missions.json`, `data/locales/${lang}/units.json`, `data/locales/${lang}/chrome.src.json`]) {
        if (existsSync(join(ROOT, rel))) cpSync(join(ROOT, rel), join(dir, rel));
      }
    }
    return dir;
  };
  const edit = (dir: string, rel: string, fn: (o: Rec) => void): void => {
    const o = JSON.parse(readFileSync(join(dir, rel), 'utf8')) as Rec;
    fn(o);
    writeFileSync(join(dir, rel), JSON.stringify(o, null, 2));
  };
  const cli = (...args: string[]): { out: string; status: number | null } => {
    const r = spawnSync('node', [join(ROOT, 'tools/locales_pending.mjs'), ...args], { encoding: 'utf8' });
    return { out: r.stdout + r.stderr, status: r.status };
  };

  it('the language is current in the tree as copied (so the damage below is the only thing reported)', () => {
    if (staged.length === 0) return;
    const dir = tree('clean');
    expect(pendingFor(dir, lang).total).toBe(0);
    const r = cli(lang, `--root=${dir}`);
    expect(r.status).toBe(0);
    expect(r.out).toContain('<!-- locales-pending: no -->');
  });
  it('a key main added, an English line edited and a mission string edited show up, with the English beside each, and the exit code stays 0', () => {
    if (staged.length === 0) return;
    const dir = tree('behind');
    edit(dir, 'packages/app/src/i18n/en.json', (en) => {
      en['zz.brand.new'] = 'A key main added';
      const first = Object.keys(en)[0] ?? '';
      en[first] = `${String(en[first])} (edited)`;
    });
    edit(dir, 'data/locales/en/missions.json', (m) => {
      const e = Object.values(m)[0] as Rec;
      e.name = 'A renamed mission';
      (e.src as Rec).name = 'aaaaaaaa';
    });
    const r = cli(lang, `--root=${dir}`);
    expect(r.status).toBe(0);
    expect(r.out).toContain('<!-- locales-pending: yes -->');
    expect(r.out).toContain('`zz.brand.new`: `A key main added`');
    expect(r.out).toMatch(/Chrome, stale/);
    expect(r.out).toContain('(edited)');
    expect(r.out).toContain('`name`: `A renamed mission`');
    const json = JSON.parse(cli(lang, '--json', `--root=${dir}`).out) as { chrome: { missing: string[]; stale: string[] }; missions: { stale: unknown[] } }[];
    expect(json[0]?.chrome.missing).toEqual(['zz.brand.new']);
    expect(json[0]?.chrome.stale).toHaveLength(1);
    expect(json[0]?.missions.stale).toHaveLength(1);
  });
  it('an overlay line the English no longer has is listed under "extra" without English text, and the English directory is never a language', () => {
    if (staged.length === 0) return;
    expect(staged).not.toContain('en');
    const dir = tree('extra');
    edit(dir, `data/locales/${lang}/missions.json`, (m) => {
      const e = Object.values(m)[0] as Record<string, Record<string, string>>;
      (e.sections as Record<string, string>).invented_section = 'x';
    });
    const out = cli(lang, `--root=${dir}`).out;
    expect(out).toMatch(/\*\*Missions, extra \(no longer in the English\) \(1\)\*\*\n- `[^`]+` `sections\.invented_section`\n/);
    expect(cli('--all', `--root=${dir}`).out).not.toMatch(/^### en$/m);
  });
  it('changes nothing on disk: the tree is byte-identical before and after a run', () => {
    if (staged.length === 0) return;
    const dir = tree('readonly');
    const before = ['packages/app/src/i18n/en.json', `packages/app/src/i18n/${lang}.json`, `data/locales/${lang}/missions.json`].map((rel) => readFileSync(join(dir, rel), 'utf8'));
    cli('--all', `--root=${dir}`);
    const after = ['packages/app/src/i18n/en.json', `packages/app/src/i18n/${lang}.json`, `data/locales/${lang}/missions.json`].map((rel) => readFileSync(join(dir, rel), 'utf8'));
    expect(after).toEqual(before);
  });
  it('cuts a long list at --max-chars and says how much is left', () => {
    if (staged.length === 0) return;
    const dir = tree('long');
    edit(dir, 'packages/app/src/i18n/en.json', (en) => {
      for (let i = 0; i < 400; i++) en[`zz.many.${i}`] = `English line number ${i}`;
    });
    const r = cli(lang, '--max-chars=3000', `--root=${dir}`);
    expect(r.out.length).toBeLessThan(3400);
    expect(r.out).toMatch(/cut to fit the comment size; about \d+ more items/);
    expect(cli(lang, `--root=${dir}`).out).not.toMatch(/cut to fit/);
  });
  it('a missing language is a bad command line (exit 2), "en" is not a staged language, and no argument is a usage error', () => {
    expect(cli('en').status).toBe(2);
    expect(cli('zz-not-staged').status).toBe(2);
    expect(cli().status).toBe(2);
    expect(cli('--all', 'de').status).toBe(2);
  });
  it('an empty tree (no staged language) says so and posts nothing: the marker is "no"', () => {
    const dir = mkdtempSync(join(tmp, 'empty-'));
    expect(renderMarkdown([], dir)).toContain('<!-- locales-pending: no -->');
    expect(renderMarkdown([], dir)).toContain('No staged locale on this tree.');
  });
});

// ---- the weekly job ------------------------------------------------------------------------------------------------------------------------
describe('.github/workflows/locales-pending.yml', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/locales-pending.yml'), 'utf8');
  const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  it('runs weekly and on demand, and never on a push or a pull request', () => {
    expect(code).toMatch(/schedule:\s*\n\s*-\s*cron:\s*'41 6 \* \* 1'/);
    expect(code).toContain('workflow_dispatch');
    expect(code).not.toMatch(/\bpush:|\bpull_request/);
  });
  it('can only comment: contents read, issues write, nothing else', () => {
    expect(code).toMatch(/permissions:\s*\n\s*contents: read\s*\n\s*issues: write/);
    expect(code).not.toMatch(/\bwrite-all\b|contents: write|pull-requests: write|id-token/);
  });
  it('is report-only: both steps are continue-on-error, and the post is guarded by the tool\'s own marker', () => {
    expect((code.match(/continue-on-error: true/g) ?? []).length).toBe(2);
    expect(code).toContain('node tools/locales_pending.mjs --all --max-chars=60000 > worklist.md');
    expect(code).toContain("grep -q '^<!-- locales-pending: yes -->' worklist.md");
    expect(code).toContain('gh issue comment 1406 --body-file worklist.md');
  });
  it('installs nothing: the tool needs no dependency, and a cut at 60,000 characters keeps under the 65,536 comment cap', () => {
    expect(code).not.toMatch(/pnpm install|npm (ci|install)|pip install/);
    expect(60000).toBeLessThan(65536);
  });
});
