import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

/**
 * Every top-level `@media (min-width: <query>px) { ... }` block in the file
 * whose opening line matches `query`, brace-matched to its own closing `}`
 * rather than to the next occurrence of the same literal string. There are
 * TWO `1900px` queries in this file (the scale-setting one at theme.css:294
 * and Task 7's own composed-column one on `.rl-menu`), and slicing from the
 * first match to end of file -- what the brief's own test 3 did before the
 * pre-flight scan's M1 correction -- can never go red, because the file
 * already holds nine unrelated `grid-template-columns` declarations after
 * that point. This returns each block separately so a test can name which
 * one it means.
 */
function mediaBlocks(source: string, widthPx: string): string[] {
  const re = new RegExp(`@media \\(min-width: ${widthPx}px\\)[^{]*\\{`, 'g');
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    blocks.push(source.slice(m.index, i));
  }
  return blocks;
}

describe('composed layouts (D-8)', () => {
  // The scale is one number and it has two steps. A third would move every
  // screen in the product to buy two, which is what R-7 refuses.
  //
  // Falsified by hand: adding
  // `@media (min-width: 2000px) { :root { --ui-scale: 1.25; } }` turns
  // `steps` into `['1900', '2000', '2400']`, which fails `toEqual`.
  it('has exactly two --ui-scale breakpoints, both tagged px-ok', () => {
    const steps = [...css.matchAll(/@media \(min-width: (\d+)px\)[^{]*\{\s*:root \{ --ui-scale/g)];
    expect(steps.map((m) => m[1])).toEqual(['1900', '2400']);
    for (const m of steps) {
      const line = css.slice(0, m.index).split('\n').length;
      expect(css.split('\n')[line - 1]).toContain('/* px-ok */');
    }
  });

  // D-8: Phase 0 deferred the number with "Phase 3's acceptance owns the
  // number". This is it, and it is in the file rather than in a plan.
  //
  // T7 review, fix round 1: the number is what D-8 asks Phase 3 to set, so
  // the test asserts the declared VALUE, not merely that a token by this
  // name exists -- a renamed-and-reworded rule with the wrong figure would
  // have passed the earlier version, which only checked for the strings
  // `--menu-col-wide:` and `D-8` anywhere in the file. `toHaveLength(1)`
  // is the "scoped to the rule that defines it" half: if a second
  // `--menu-col-wide` declaration were ever added, this fails loudly
  // instead of the `toMatch` below silently matching whichever one agrees.
  //
  // Falsified by hand: changing `min(34rem, 82vw)` to `min(36rem, 82vw)`
  // in theme.css (leaving the token name, the `D-8` comment and everything
  // else untouched) turns the second assertion red.
  it('declares the composed menu column, and says what it is a fraction of', () => {
    const declarations = [...css.matchAll(/--menu-col-wide:\s*[^;]+;/g)];
    expect(declarations).toHaveLength(1);
    expect(css).toMatch(/--menu-col-wide:\s*min\(34rem,\s*82vw\)/);
    expect(css).toMatch(/D-8/);
  });

  // M1 (pre-flight scan): the brief's original version of this test sliced
  // from the FIRST `@media (min-width: 1900px)` marker to the end of the
  // file, which already held nine `grid-template-columns` declarations
  // below that point and so could never fail. Scoped here to the actual
  // 1900px block that carries a composed grid, brace-matched rather than
  // string-sliced, and required to name the selector it composes -- so a
  // grid declared anywhere else in the file (1280's own 1024px query
  // included, which is below the fit floor this task adds no query for)
  // does not satisfy it.
  //
  // Falsified by hand: deleting the `.rl-loading__box--spread` rule out of
  // Task 7's 1900px block (leaving `.rl-deploy__ground` alone in it) turns
  // `composed` undefined and the block-level assertions red.
  //
  // T7 review, fix round 1 (MINOR): retitled. `.rl-loading__box--spread`
  // has been a two-column grid since Task 3's own 1024px rule, so "1280
  // stays one column" was never true of it -- what this test actually
  // checks is that the WIDE (1900px) block grows that existing grid
  // further, while the PLAIN menu (`.rl-menu`) gets no grid at all here,
  // only a wider `--menu-col`.
  it('the wide-band grid belongs to the briefing spread; the plain menu only widens its column', () => {
    const blocks = mediaBlocks(css, '1900');
    expect(blocks.length).toBeGreaterThanOrEqual(2);

    const scaleBlock = blocks.find((b) => b.includes('--ui-scale'));
    expect(scaleBlock).toBeDefined();
    expect(scaleBlock).not.toMatch(/grid-template-columns/);

    // The plain menu's own 1900px block (D-8, previous test) widens
    // --menu-col-wide and nothing else here -- it must not ALSO carry a
    // grid, or the title's "only widens its column" half would be false.
    const menuColBlock = blocks.find((b) => b.includes('--menu-col-wide'));
    expect(menuColBlock).toBeDefined();
    expect(menuColBlock).not.toMatch(/grid-template-columns/);

    const composed = blocks.find((b) => b.includes('grid-template-columns'));
    expect(composed).toBeDefined();
    expect(composed).toMatch(/\.rl-loading__box--spread/);

    // 1280 stays on the 1024px rule's own 3fr:2fr split — the wide block
    // must not be the ONLY place `.rl-loading__box--spread` becomes a grid.
    const narrowGrid = mediaBlocks(css, '1024').find((b) => b.includes('.rl-loading__box--spread'));
    expect(narrowGrid).toBeDefined();
    expect(narrowGrid).toMatch(/grid-template-columns/);
  });
});
