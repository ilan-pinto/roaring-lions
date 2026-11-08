// GH-976 v2 R0.22: ONE reader for the flag block. A flag room reads either today's `flags` and `modes.flag.hold_s` (v1) or the
// staged `flag_setup` block, and the choice is the room's (`flagSetupRoom(config)`). `@lions/data`'s `flagBlockOf(file, setup)`
// makes it; a reader that goes round it to the mode file shows the wrong block in a set-up room (the wrong hold in the lobby,
// the wrong flags on the field). This is a source-grep test over the tracked files, so a new reader fails here the day it lands.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

/** Files that ARE the reader, or validate the files themselves. */
const READERS = new Set(['packages/data/src/versus.ts', 'tools/validate_versus_modes.mjs']);

/** The named exemption: `withFlagOverride` WRITES the v1 block in memory for the fit and restores it in `finally`; it reads nothing a
 *  room plays. WP5's probe rewrite replaces it. Its text is cut out before the scan, and the test below fails if it is gone. */
const EXEMPT_FN = { file: 'tools/src/backtest/versus-modes.ts', startsWith: 'export function withFlagOverride' };

const tracked = (): string[] =>
  execFileSync('/usr/bin/git', ['ls-files', '--', 'packages/**/*.ts', 'tools/**/*.ts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.length > 0 && !/\.test\.ts$/.test(f) && !/\.test-helper\.ts$/.test(f) && !READERS.has(f));

/** Comments cut, so prose that names `modes.flag.hold_s` is not a read. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** `text` with the exempt function's body removed (its `}` at column 0 closes it). */
function withoutExempt(file: string, text: string): string {
  if (file !== EXEMPT_FN.file) return text;
  const at = text.indexOf(EXEMPT_FN.startsWith);
  if (at < 0) return text;
  const end = text.indexOf('\n}\n', at);
  return text.slice(0, at) + text.slice(end < 0 ? text.length : end + 3);
}

/** The reads of the flag block found in `text` that go round `flagBlockOf`: the hold, and `.flags` on a mode-file value. */
export function directReads(text: string): string[] {
  const src = code(text);
  const out: string[] = [];
  for (const m of src.matchAll(/modes\.flag\??\.hold_s/g)) out.push(m[0]);
  // A mode-file value: `versusModes[...]` itself, a name bound from it (`const f = ... versusModes[...]`), or a parameter typed
  // `VersusModeFileJson`. A `.flags` read off any of them is a direct read.
  const names = new Set<string>();
  for (const m of src.matchAll(/\b(?:const|let)\s+(\w+)\b[^;=]*=[^;]*?\bversusModes\[/g)) names.add(m[1]);
  for (const m of src.matchAll(/\b(\w+)\s*\??:\s*(?:readonly\s+)?VersusModeFileJson\b/g)) names.add(m[1]);
  for (const m of src.matchAll(/versusModes\[[^\]]*\]!?\??\.flags\b/g)) out.push(m[0]);
  for (const n of names) {
    for (const m of src.matchAll(new RegExp(`\\b${n}(?:\\[[^\\]]*\\])?!?\\??\\.flags\\b`, 'g'))) out.push(m[0]);
  }
  return out;
}

describe('GH-976 R0.22: every reader of the flag block goes through flagBlockOf', () => {
  it('no tracked non-test source outside the reader reads modes.flag.hold_s or .flags off a mode file', () => {
    const files = tracked();
    expect(files.length, 'the tracked-file list is not empty').toBeGreaterThan(200);
    const bad: string[] = [];
    for (const f of files) {
      const reads = directReads(withoutExempt(f, readFileSync(join(ROOT, f), 'utf8')));
      if (reads.length > 0) bad.push(`${f}: ${reads.join(', ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('the scan sees the readers it exists for: each moved file is in the list and goes through flagBlockOf', () => {
    const files = new Set(tracked());
    for (const f of [
      'packages/app/src/main.ts', 'packages/app/src/ui/versus.ts', 'packages/app/src/ui/arena-setup.ts', 'packages/app/src/net/flag-view.ts',
      'packages/app/src/net/match-world.ts', 'tools/src/net/view.ts', 'tools/src/backtest/versus-modes.ts',
    ]) expect(files.has(f), f).toBe(true);
    for (const f of ['packages/app/src/main.ts', 'packages/app/src/ui/versus.ts', 'packages/app/src/ui/arena-setup.ts', 'packages/app/src/net/match-world.ts', 'tools/src/net/view.ts', 'tools/src/backtest/versus-modes.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).toMatch(/flagBlockOf\(/);
    }
  });

  it('the scan itself can fail: it names each shape of direct read, and ignores prose', () => {
    expect(directReads('const h = versusModes[map]?.modes.flag?.hold_s ?? 0;')).toEqual(['modes.flag?.hold_s']);
    expect(directReads('const f = file.modes.flag.hold_s;')).toEqual(['modes.flag.hold_s']);
    expect(directReads('const f = versusModes[mapId].flags!;')).toEqual(['versusModes[mapId].flags']);
    expect(directReads('const file = cond ? versusModes[m] : undefined;\nconst a = file?.flags.friendly;')).toEqual(['file?.flags']);
    expect(directReads('function f(doc: VersusModeFileJson) { return doc.flags; }')).toEqual(['doc.flags']);
    // Not a mode file: a unit's flags, the block that flagBlockOf RETURNS, a comment, a string.
    expect(directReads('const x = u.flags.includes("idle");')).toEqual([]);
    expect(directReads('const block = flagBlockOf(file, false);\nconst a = block.flags[end];')).toEqual([]);
    expect(directReads('// the old read, modes.flag.hold_s, is gone\n/* versusModes[m].flags */')).toEqual([]);
  });

  it('the named exemption still exists (when it is gone, delete the exemption)', () => {
    const text = readFileSync(join(ROOT, EXEMPT_FN.file), 'utf8');
    expect(text).toContain(EXEMPT_FN.startsWith);
    expect(directReads(text), 'the exemption is doing real work').not.toEqual([]);
    expect(directReads(withoutExempt(EXEMPT_FN.file, text))).toEqual([]);
  });
});
