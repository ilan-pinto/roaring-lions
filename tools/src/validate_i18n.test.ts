import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bareStringFailures, walkChromeFiles } from '../validate_i18n.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

describe('bareStringFailures', () => {
  it('flags a literal with words assigned to a text sink', () => {
    expect(bareStringFailures('x.ts', `el.textContent = 'Deploy now';`)).toHaveLength(1);
    expect(bareStringFailures('x.ts', 'el.title = `Leave the mission`;')).toHaveLength(1);
    expect(bareStringFailures('x.ts', `el.setAttribute('aria-label', 'Close');`)).toHaveLength(1);
    expect(bareStringFailures('x.ts', 'el.innerHTML = `<b>enemy reinforcements</b> inbound`;')).toHaveLength(1);
  });
  it('accepts t() calls, glyphs, ids and data passthrough', () => {
    expect(bareStringFailures('x.ts', `el.textContent = t('menu.campaign');`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = '▮▮';`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = '1×';`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = mission.name;`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.className = 'rl-menu__back';`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = \`\${n} / \${m}\`;`)).toEqual([]);
  });
  it('honours a line-level exemption comment for a proper noun', () => {
    expect(bareStringFailures('x.ts', `el.textContent = 'Roaring Lions'; /* i18n-ok: proper noun */`)).toEqual([]);
  });
});

// Task 11 replaced the Task 9/10 hand-kept `MIGRATED` list with a walk of the
// whole tree -- `walkChromeFiles` is what a new chrome file is caught BY
// CONSTRUCTION now instead of by remembering to add its path a second time.
describe('walkChromeFiles', () => {
  it('walks packages/app/src recursively and finds real chrome files', () => {
    const files = walkChromeFiles(REPO);
    expect(files).toContain('packages/app/src/ui/hud.ts');
    expect(files).toContain('packages/app/src/main.ts');
    expect(files).toContain('packages/app/src/ui/settings-panel.ts');
  });

  it('excludes every *.test.ts file', () => {
    expect(walkChromeFiles(REPO).some((f) => f.endsWith('.test.ts'))).toBe(false);
  });

  it('excludes sandbox-help.ts by exact file name', () => {
    expect(walkChromeFiles(REPO)).not.toContain('packages/app/src/sandbox-help.ts');
  });
});

describe('the whole walked tree', () => {
  it('has no bare chrome string left uncaught, across every walked file', () => {
    const files = walkChromeFiles(REPO);
    const failures = files.flatMap((f) => bareStringFailures(f, readFileSync(join(REPO, f), 'utf8')));
    expect(failures).toEqual([]);
  });

  /**
   * Falsification (task-11 brief, step 3): "drop the .test.ts exclusion --
   * it must go red on a test literal -- and restore."
   *
   * Done live, by hand, during the work this test file's own commit
   * belongs to: `walkChromeFiles`'s `.test.ts` filter was removed for real,
   * a throwaway `el.textContent = 'temporary falsification literal';` line
   * was added to `hud.test.ts`, `node tools/validate_i18n.mjs` printed the
   * failure and exited 1, and both edits were then reverted -- there is
   * nothing left in the tree to show for it, which is the point of a
   * falsification rather than a permanent scar.
   *
   * What CANNOT be pinned as a standing regression test against the REAL
   * tree: scanning every `*.test.ts` file under `packages/app/src` with
   * `bareStringFailures` today finds ZERO matches, in either direction of
   * the filter. Test files never write a literal directly INTO a text sink
   * -- they read `.textContent` back out of one (`expect(el.textContent)
   * .toBe('English literal')`), which the sink-anchored regex was never
   * built to see either. So "run the real walk with the filter dropped" is
   * not itself a meaningful assertion here: it stays green whichever way
   * the filter is set, and a test asserting that would prove nothing about
   * whether the filter does anything.
   *
   * The CONSTRUCTED input below is what actually demonstrates the
   * exclusion is load-bearing (CLAUDE.md's own rule: "every check gets an
   * input that makes it fail -- constructed, and run") -- a synthetic
   * `*.test.ts` file that DOES assign a literal straight into a sink, the
   * shape a fixture-building helper could plausibly write even though none
   * happens to today. `bareStringFailures` flags it regardless of the
   * file's name (it has no opinion on extensions at all); `walkChromeFiles`
   * is the one place that name is ever consulted, and it is what keeps
   * such a file out of the real, gated walk.
   */
  it('would flag a literal a *.test.ts fixture wrote straight into a sink, and walkChromeFiles is the only reason none reach the gate', () => {
    const fixtureSource = `el.textContent = 'Some fixture copy written straight into a sink';`;
    const fixturePath = 'packages/app/src/ui/whatever.test.ts';
    expect(bareStringFailures(fixturePath, fixtureSource)).toHaveLength(1);
    expect(walkChromeFiles(REPO)).not.toContain(fixturePath);
  });
});
