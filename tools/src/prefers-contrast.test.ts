// GH-1408: `prefers-contrast: more` is handled. theme.css carries one media block that re-points the three quiet tokens (the dim
// ink, the panel frame, the panel rule) one rung up their own ramp. This reads BOTH sides from source and computes the WCAG
// ratios itself: the CSS block (which palette key each token is pointed at) and data/palette.json (the colours), so a token
// pointed at a key that is not readable fails here, and so does a block that stops improving on the base. Thresholds are
// literals: 7:1 for text, 3:1 for a UI boundary (WCAG 1.4.6 and 1.4.11).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Comments stripped first: a declaration is preceded by prose in this file, and prose may hold a brace or a semicolon.
const css = readFileSync(new URL('../../packages/app/src/ui/theme.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const palette = JSON.parse(readFileSync(new URL('../../data/palette.json', import.meta.url), 'utf8')) as {
  ramps: Record<string, { colors: string[] }>;
};

function luminance(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((l1 ?? 0) + 0.05) / ((l2 ?? 0) + 0.05);
}
/** `--rl-<ramp>-<n>` to its hex, or null for anything that is not a plain ramp reference. */
function hexOf(ref: string): string | null {
  const m = /^var\(--rl-([a-z]+)-(\d+)\)$/.exec(ref.trim());
  return m ? (palette.ramps[m[1] ?? '']?.colors[Number(m[2])] ?? null) : null;
}
/** The declarations of the first rule body that follows `opener` in the CSS, as name -> value. */
function declsAfter(opener: string): Record<string, string> {
  const at = css.indexOf(opener);
  if (at < 0) return {};
  // The opener may already end in the brace (`:root {`): search from its own last one.
  const open = css.indexOf('{', at + Math.max(0, opener.lastIndexOf('{')));
  const close = css.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const d of css.slice(open + 1, close).split(';')) {
    const m = /^\s*(--[a-z-]+):\s*(.+?)\s*$/s.exec(d);
    if (m) out[m[1] ?? ''] = m[2] ?? '';
  }
  return out;
}

const ground = hexOf(declsAfter(':root {')['--panel-bg-solid'] ?? '') ?? '';
// The block sits inside `@media (prefers-contrast: more) {`, so read the :root rule after that opener.
const more = declsAfter('@media (prefers-contrast: more) {\n  :root {');
const base = declsAfter(':root {');

describe('prefers-contrast: more', () => {
  it('the panel ground resolves to a palette colour (the oracle has a ground to measure against)', () => {
    expect(ground).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('re-points exactly three tokens, each at a plain palette ramp key', () => {
    expect(Object.keys(more).sort()).toEqual(['--ink-dim', '--panel-frame', '--panel-rule']);
    for (const v of Object.values(more)) expect(hexOf(v), v).not.toBeNull();
  });

  it('the dim ink reads at 7:1 over the panel ground, where the base value does not', () => {
    expect(contrast(hexOf(base['--ink-dim'] ?? '') ?? '', ground)).toBeLessThan(7);
    expect(contrast(hexOf(more['--ink-dim'] ?? '') ?? '', ground)).toBeGreaterThanOrEqual(7);
  });

  it('the panel frame and rule read at 3:1 over the panel ground, where the base frame does not', () => {
    expect(contrast(hexOf(base['--panel-frame'] ?? '') ?? '', ground)).toBeLessThan(3);
    expect(contrast(hexOf(more['--panel-frame'] ?? '') ?? '', ground)).toBeGreaterThanOrEqual(3);
    expect(contrast(hexOf(more['--panel-rule'] ?? '') ?? '', ground)).toBeGreaterThanOrEqual(3);
  });

  it('the block comes after the :root block it overrides (same specificity, later wins)', () => {
    expect(css.indexOf('@media (prefers-contrast: more)')).toBeGreaterThan(css.indexOf('--panel-frame: var(--rl-gunmetal-3);'));
  });
});
