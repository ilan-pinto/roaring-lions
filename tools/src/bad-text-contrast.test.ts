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
});
