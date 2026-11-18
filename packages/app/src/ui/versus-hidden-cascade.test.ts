// @vitest-environment jsdom
//
// Versus field works (PR 1587 review): the lobby's field-works row and the room's field-works line are hidden with the
// `hidden` attribute, but their base classes (`.rl-versus__kit`, `.rl-versus__room-kit`) set `display: flex`. Any AUTHOR rule
// beats the user agent's `[hidden] { display: none }`, so without a `[hidden]` rule of their own every room showed "Field
// works: On" and the host switch stayed on screen for KDF v Sarim.
//
// jsdom cannot answer this through `getComputedStyle`: it reports `none` for any element with `hidden`, whatever the author
// CSS says (measured: `.a { display: flex }` on `<div class="a" hidden>` reads `none` there, `flex` in a browser). So the test
// runs the author cascade itself over the real theme.css: every rule jsdom's CSSOM parsed whose selector MATCHES the element
// and declares `display`, the winner by specificity and then source order. A hidden element is drawn unless that winner says
// `none`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf8');

/** Specificity of one simple-enough selector as [ids, classes + attributes + pseudo-classes, types]. */
function specificity(sel: string): [number, number, number] {
  const s = sel.replace(/::[\w-]+/g, ' ').replace(/:not\(([^)]*)\)/g, ' $1 ');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+(\([^)]*\))?/g) ?? []).length;
  const types = (s.replace(/\[[^\]]+\]/g, ' ').match(/(^|[\s>+~])([a-z][\w-]*)/gi) ?? []).length;
  return [ids, cls, types];
}
const beats = (a: [number, number, number], b: [number, number, number]): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];

/** The author `display` that wins on `el`, or null when no author rule sets one (then the user agent's applies). */
function authorDisplay(el: Element): string | null {
  let best: { spec: [number, number, number]; value: string } | null = null;
  const walk = (rules: CSSRuleList): void => {
    for (const rule of [...rules]) {
      // Inside a media query a `display` would win only on some screens: walk those too, as if every query matched, so a
      // narrow-screen `display: flex` cannot hide behind the default one (jsdom has no `matchMedia` to ask).
      if (rule instanceof CSSMediaRule) {
        walk(rule.cssRules);
        continue;
      }
      if (!(rule instanceof CSSStyleRule)) continue;
      const value = rule.style.getPropertyValue('display');
      if (value === '') continue;
      for (const sel of rule.selectorText.split(',').map((x) => x.trim())) {
        let hit = false;
        try { hit = el.matches(sel); } catch { hit = false; }
        if (!hit) continue;
        const spec = specificity(sel);
        if (best === null || beats(spec, best.spec)) best = { spec, value };
      }
    }
  };
  for (const sheet of [...document.styleSheets]) walk(sheet.cssRules);
  return best === null ? null : (best as { value: string }).value;
}

function drawn(tag: string, classNames: string, hidden: boolean): boolean {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = `<${tag} class="${classNames}"${hidden ? ' hidden' : ''}>x</${tag}>`;
  const el = document.body.firstElementChild as HTMLElement;
  const d = authorDisplay(el);
  return d === null ? !hidden : d !== 'none';
}

describe('versus field works: a hidden row or line is not drawn (PR 1587 review)', () => {
  it('the host\'s field-works row: not drawn when hidden, drawn when shown', () => {
    expect(drawn('div', 'rl-versus__kit rl-versus__works', true)).toBe(false);
    expect(drawn('div', 'rl-versus__kit rl-versus__works', false)).toBe(true);
  });

  it('the room\'s field-works line: not drawn when hidden, drawn when shown', () => {
    expect(drawn('p', 'rl-versus__room-kit rl-versus__room-works', true)).toBe(false);
    expect(drawn('p', 'rl-versus__room-kit rl-versus__room-works', false)).toBe(true);
  });

  it('the method sees the precedent: the win group\'s own `[hidden]` rule hides it, and a bare flex class would not', () => {
    expect(drawn('fieldset', 'rl-versus__sides rl-versus__win', true)).toBe(false);
    expect(drawn('div', 'rl-versus__kit', true)).toBe(true);
  });
});
