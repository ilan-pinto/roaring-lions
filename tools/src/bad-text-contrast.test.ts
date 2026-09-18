// A red that FILLS a bar (the ROE gauge, the debrief list) is not the same
// job as a red that IS text over a panel: the shipped `--bad` token
// (`team.hostile`, #D93A2B) reads 4.01:1 against the panel ground it sits on
// as a string -- under WCAG AA's 4.5:1 floor for body text. `team.hostile_text`
// exists to cover the reading job without touching the fill colour everything
// else still uses.
//
// This test reads data/palette.json directly, never the CSS, so it pins the
// SOURCE fact rather than a derived one: theme.css could point --bad-text at
// the wrong palette key and still "work" if that key happened to be readable,
// which would make the token meaningless. Reading the palette means the only
// way to pass is for the palette itself to carry a readable red.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function luminance(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('the red that renders as text', () => {
  const palette = JSON.parse(readFileSync(new URL('../../data/palette.json', import.meta.url), 'utf8'));
  const panel: string = palette.ramps.shadow.colors[1]; // --rl-shadow-1, the panel ground

  it('team.hostile_text reads at AA over the panel ground, where team.hostile does not', () => {
    expect(contrast(palette.reserved.team.colors.hostile, panel)).toBeLessThan(4.5); // the review's 4.01 -- the reason the token exists
    expect(contrast(palette.reserved.team.colors.hostile_text, panel)).toBeGreaterThanOrEqual(4.5);
  });

  // Task 12: every colour-vision variant swaps in its OWN hostile_text
  // (theme.css's :root[data-cvd=...] blocks), so each one needs its own AA
  // floor over the same panel ground -- a variant token that reads fine to a
  // trichromat but under 4.5:1 would be a readability regression hiding
  // behind an accessibility feature.
  for (const variant of ['deuteranopia', 'protanopia', 'tritanopia'] as const) {
    it(`team.variants.${variant}.hostile_text reads at AA over the panel ground`, () => {
      expect(contrast(palette.reserved.team.variants[variant].hostile_text, panel)).toBeGreaterThanOrEqual(4.5);
    });
  }

  // Fix round 1 (review finding #3): `--warn` (`team.neutral`) is read as
  // TEXT too -- `.rl-warn` and `.rl-clock[data-tone='warn']` in theme.css --
  // the same job `--bad-text` exists for on the hostile side, but `neutral`
  // has no separate "_text" token of its own because it has never needed
  // one: unlike `team.hostile` (4.01:1, under AA), the plain `neutral` fill
  // already clears 4.5:1 on the panel ground in every variant, default
  // included (measured: default 10.75:1, deuteranopia/protanopia 13.88:1,
  // tritanopia 5.997:1 -- tritanopia's `neutral` swap to `#CC79A7` is the
  // closest to the floor and still clears it by a third). Gated here so a
  // future variant pick cannot regress it silently the way `team.hostile`
  // once did.
  it('team.colors.neutral reads at AA over the panel ground (no separate _text token needed)', () => {
    expect(contrast(palette.reserved.team.colors.neutral, panel)).toBeGreaterThanOrEqual(4.5);
  });
  for (const variant of ['deuteranopia', 'protanopia', 'tritanopia'] as const) {
    it(`team.variants.${variant}.neutral reads at AA over the panel ground`, () => {
      expect(contrast(palette.reserved.team.variants[variant].neutral, panel)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * I2 (shell-upgrade Phase 0 final review): the palette-reading test above
 * proves the TOKEN pair is right; it cannot see a CSS site that names the
 * wrong one of the two. Five sites did exactly that -- `color: var(--bad)`
 * on static text (a campaign-board line, a dock tile's price, the
 * boot-error screen, the debrief's deduction list, the tutorial nudge) --
 * and were found by a one-off `grep`, a sweep rather than a rule. This
 * reads `theme.css` directly and turns it into one: every `color:`
 * declaration (never `border-color:`/`background-color:`, which the
 * negative lookbehind below excludes) that names `--bad` must belong to one
 * of the two selectors this repo still allows it for.
 */
const COLOR_BAD_RE = /(?<![-a-zA-Z])color:\s*var\(--bad\)/g;

/** The selector (or `@keyframes` percentage) whose block a `color:
 *  var(--bad)` match sits in directly, found by walking outward from the
 *  match to the nearest unclosed `{` and the `}` before that -- correct for
 *  this file's flat (non-nested) CSS, and stripped of any doc comment that
 *  sits between the previous rule's `}` and this selector. */
function enclosingSelector(css: string, matchIndex: number): string {
  const braceIdx = css.lastIndexOf('{', matchIndex);
  const prevCloseIdx = css.lastIndexOf('}', braceIdx);
  return css
    .slice(prevCloseIdx + 1, braceIdx)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
}

/** `.rl-bad` is the reserved FILL class (an SVG `fill: currentColor`
 *  consumer per its own comment in `theme.css`, never a rendered string --
 *  nothing in `packages/app/src` applies it as a DOM class today, which a
 *  future `git grep classList.*rl-bad` can re-check). `rl-drop`'s `40%`
 *  keyframe is a 300ms flash midpoint on `.rl-flash-bad`, not static body
 *  text the WCAG AA floor gates the way the five I2 sites were. Every other
 *  selector that sets `color:` from `--bad` must read `--bad-text` instead. */
const ALLOWED_BAD_COLOR_SELECTORS = ['.rl-bad', '40%'];

function findBadColorOffenders(css: string): string[] {
  const offenders: string[] = [];
  for (const m of css.matchAll(COLOR_BAD_RE)) {
    const selector = enclosingSelector(css, m.index ?? 0);
    if (!ALLOWED_BAD_COLOR_SELECTORS.includes(selector)) offenders.push(selector || '(unresolved selector)');
  }
  return offenders;
}

describe('color: var(--bad) is a rule now, not a sweep (I2)', () => {
  const cssPath = new URL('../../packages/app/src/ui/theme.css', import.meta.url);

  it('theme.css has no text site left reading the unreadable fill token', () => {
    const css = readFileSync(cssPath, 'utf8');
    expect(findBadColorOffenders(css)).toEqual([]);
  });

  it('is falsifiable: a sixth text site reading --bad is caught by name', () => {
    // Constructed input, run, watched failing -- CLAUDE.md's own discipline
    // for a check that did not exist before this fix. Reproduces the exact
    // shape the five real sites had: an element selector setting `color:`
    // straight from `--bad` with no allow-listed name.
    const injected = readFileSync(cssPath, 'utf8') + '\n.rl-falsify-bad-text {\n  color: var(--bad);\n}\n';
    expect(findBadColorOffenders(injected)).toEqual(['.rl-falsify-bad-text']);
  });

  it('does not false-positive on border-color or background-color', () => {
    const css = '.rl-x { border-color: var(--bad); background-color: var(--bad); }';
    expect(findBadColorOffenders(css)).toEqual([]);
  });
});
