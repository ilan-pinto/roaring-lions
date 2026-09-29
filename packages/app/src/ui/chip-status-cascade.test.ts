// @vitest-environment jsdom
//
// GH-262 final fix wave: `.rl-chip__status { color: var(--ink-dim) }`
// (theme.css ~2226) used to sit after `.rl-hot` (~1387) and `.rl-bad-text`
// (~1378) at EQUAL specificity (one class each), so on a chip status element
// that also carries `.rl-hot` or `.rl-bad-text` the later, plain
// `.rl-chip__status` rule won the cascade and the tone colour never applied
// -- a pinned chip's "1 PINNED" and a broken chip's "BROKEN" both drew grey.
//
// This is a real cascade question, not a text-pattern one, so it is proven
// by loading the actual theme.css into jsdom and reading getComputedStyle --
// jsdom's CSSOM does resolve selector specificity and source order for a
// same-document <style> block (verified by hand: a two-rule repro of the
// exact `.rl-chip__status` / `.rl-hot` shape resolves to the later rule's
// colour in jsdom, matching real browsers). The custom properties
// (--hot/--bad-text/--ink-dim) are not defined by theme.css itself -- they
// come from the palette Vite plugin at build time. jsdom's CSSOM does not
// resolve `var()` at computed-value time (measured by hand: it returns the
// literal `var(--token)` text rather than a resolved rgb()), but that is
// exactly what this test needs -- it names which custom property the
// WINNING declaration references, which is the cascade question at stake.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf8');

function computedColorFor(classNames: string): string {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = `<span class="${classNames}">x</span>`;
  const el = document.body.querySelector('span') as HTMLElement;
  return getComputedStyle(el).color;
}

describe('.rl-chip__status tone cascade (GH-262)', () => {
  // Falsified by hand: reverting the fix (dropping the `:not(.rl-hot)
  // :not(.rl-bad-text)` from `.rl-chip__status`'s selector) turns this red --
  // it then reads 'var(--ink-dim)', the plain grey, instead of the tone.
  it('a pinned chip status (.rl-hot) draws --hot, not the plain grey', () => {
    expect(computedColorFor('rl-chip__status rl-hot')).toBe('var(--hot)');
  });

  it('a broken chip status (.rl-bad-text) draws --bad-text, not the plain grey', () => {
    expect(computedColorFor('rl-chip__status rl-bad-text')).toBe('var(--bad-text)');
  });

  // Every other chip status -- the overwhelming majority, anything with no
  // tone class -- must be completely unchanged by this fix.
  it('an untoned chip status still draws the plain grey', () => {
    expect(computedColorFor('rl-chip__status')).toBe('var(--ink-dim)');
  });
});
