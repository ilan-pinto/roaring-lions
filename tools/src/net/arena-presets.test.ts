// GH-954 W2: the presets file. Real files in a temp directory with real modes; no model, no key.
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogueOf, loadPresets, modeRefusal, parsePresets, presetIdOf, PresetsError } from './arena-presets';

const dirs: string[] = [];
afterEach(() => { while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true }); });
function fileWith(text: string, mode: number): string {
  const d = mkdtempSync(join(tmpdir(), 'arena-presets-'));
  dirs.push(d);
  const f = join(d, 'arena-players.json');
  writeFileSync(f, text);
  chmodSync(f, mode);
  return f;
}
const TEMPLATE = 'cmd:/abs/model --mcp-config {mcp} --seat {seat} < {prompt}';
const JUDGE = 'cmd:/abs/model --stats {stats} < {prompt}';
const GOOD = JSON.stringify({ players: {
  'opus-5.5': { label: 'Claude Opus 5.5', template: TEMPLATE, judgeTemplate: JUDGE, usage: 'claude-json' },
  'player-only': { label: 'Player only', template: TEMPLATE },
  'judge-only': { label: 'Judge only', judgeTemplate: JUDGE },
} });

describe('modeRefusal (pure)', () => {
  it('accepts owner-only modes and refuses any group or world bit', () => {
    for (const m of [0o600, 0o400, 0o700, 0o100000 | 0o600]) expect(modeRefusal(m), m.toString(8)).toBeNull();
    for (const m of [0o640, 0o604, 0o660, 0o606, 0o644, 0o666, 0o610, 0o601]) expect(modeRefusal(m), m.toString(8)).not.toBeNull();
  });
});

describe('loadPresets: the file must be private', () => {
  it('reads a 0600 file', () => {
    const p = loadPresets(fileWith(GOOD, 0o600));
    expect([...p.byId.keys()]).toEqual(['opus-5.5', 'player-only', 'judge-only']);
  });
  it('REFUSES a file readable by its group or by everyone, with the mode and the fix in the message, and reads nothing from it', () => {
    for (const mode of [0o640, 0o604, 0o644, 0o660, 0o666]) {
      const f = fileWith(GOOD, mode);
      let err: unknown;
      try { loadPresets(f); } catch (e) { err = e; }
      expect(err, mode.toString(8)).toBeInstanceOf(PresetsError);
      expect((err as Error).message).toContain('chmod 600');
      expect((err as Error).message).not.toContain('/abs/model');   // the message never quotes a template
    }
  });
  it('a missing file is no presets; a directory, an unreadable shape and bad JSON are refused', () => {
    const d = mkdtempSync(join(tmpdir(), 'arena-presets-'));
    dirs.push(d);
    expect(loadPresets(join(d, 'nope.json')).byId.size).toBe(0);
    mkdirSync(join(d, 'dir'), { mode: 0o700 });
    expect(() => loadPresets(join(d, 'dir'))).toThrow(PresetsError);
    expect(() => loadPresets(fileWith('{nope', 0o600))).toThrow(/not JSON/);
    expect(() => loadPresets(fileWith('[]', 0o600))).toThrow(PresetsError);
    // A symlink is judged by its target's mode.
    const open = fileWith(GOOD, 0o644);
    const link = join(d, 'link.json');
    symlinkSync(open, link);
    expect(() => loadPresets(link)).toThrow(/chmod 600/);
  });
});

describe('parsePresets', () => {
  const bad = (players: unknown, re: RegExp): void => { expect(() => parsePresets(JSON.stringify({ players }), 'f.json')).toThrow(re); };
  it('accepts player-only, judge-only and both, and a usage note', () => {
    const p = parsePresets(GOOD, 'f.json');
    expect(p.byId.get('opus-5.5')).toMatchObject({ label: 'Claude Opus 5.5', template: TEMPLATE, judgeTemplate: JUDGE, usage: 'claude-json' });
    expect(p.byId.get('judge-only')?.template).toBeNull();
    expect(p.byId.get('player-only')?.judgeTemplate).toBeNull();
  });
  it('refuses what the arena could not run or would mislabel, before any room', () => {
    bad({ x: { label: 'X' } }, /neither a template nor a judgeTemplate/);
    bad({ x: { label: 'X', template: 'claude -p' } }, /cmd:/);
    bad({ x: { label: 'X', template: 'cmd:run {nope}' } }, /not a placeholder/);
    bad({ x: { label: 'X', judgeTemplate: 'cmd:run {mcp}' } }, /not a placeholder/);   // a judge has no MCP config
    bad({ x: { label: 'X', template: 'cmd:run "open' } }, /unclosed/);
    bad({ x: { label: 'X', template: TEMPLATE, apiKey: 'k' } }, /unknown field/);
    bad({ x: { label: '', template: TEMPLATE } }, /label/);
    bad({ x: { label: 'X', template: TEMPLATE, usage: 'other' } }, /claude-json/);
    bad({ rush: { label: 'X', template: TEMPLATE } }, /not a usable id/);
    bad({ 'a/b': { label: 'X', template: TEMPLATE } }, /not a usable id/);
    bad({ '../x': { label: 'X', template: TEMPLATE } }, /not a usable id/);
    expect(() => parsePresets(JSON.stringify({ players: {}, extra: 1 }), 'f.json')).toThrow(PresetsError);
  });
  it('presetIdOf takes only a well-formed preset: spec', () => {
    expect(presetIdOf('preset:opus-5.5')).toBe('opus-5.5');
    for (const s of ['preset:', 'preset:a/b', 'preset: x', 'cmd:x', 'opus', 'preset:../x']) expect(presetIdOf(s), s).toBeNull();
  });
});

describe('catalogueOf: the screen is told ids, labels and kinds, never a template', () => {
  it('lists passive and rush first, then each preset by what it can be', () => {
    const rows = catalogueOf(parsePresets(GOOD, 'f.json'));
    expect(rows).toEqual([
      { id: 'passive', label: 'passive', kind: 'scripted' },
      { id: 'rush', label: 'rush', kind: 'scripted' },
      { id: 'opus-5.5', label: 'Claude Opus 5.5', kind: 'model_judge' },
      { id: 'player-only', label: 'Player only', kind: 'model' },
      { id: 'judge-only', label: 'Judge only', kind: 'judge' },
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('/abs/model');
    expect(text).not.toContain('cmd:');
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['id', 'kind', 'label']);
  });
});
