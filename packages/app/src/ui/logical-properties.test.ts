/**
 * GH-1406 (RTL readiness): `theme.css` styles the INLINE axis with logical properties, so a right-to-left locale mirrors a component with no
 * second stylesheet. In a left-to-right layout every logical property resolves to the physical one it replaced, so no screen moves.
 *
 * What stays physical on purpose, and so is named below: an offset that places a box against the VIEWPORT or the stage (the HUD docks, the
 * minimap, banners), a centring `left: 50%` paired with `translateX(-50%)` (mirroring it would push the box off centre), a pixel position the
 * code computes (`--tip-x`), and a knob whose on-state is a physical `translateX`. Mirroring the HUD itself is a design decision, not a
 * stylesheet pass.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Block comments blanked in place (newlines kept) so line numbers still match the file and prose never counts as a declaration.
const css = readFileSync(join(__dirname, 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const lines = css.split('\n');

/** Selectors whose `left`/`right` is a deliberate physical position (see the file header). */
const PHYSICAL_OFFSET_OK = new Set([
  '.rl-world__town::before',
  '.rl-avatar-picker__tag',
  '.rl-intro__skip',
  '.rl-obj-panel--tracker',
  '.rl-clock',
  '.rl-cmd',
  '.rl-minimap',
  '.rl-group-bar',
  '.rl-loan--tab',
  '.rl-invoice',
  '.rl-bigbanner',
  '.rl-titlecard',
  '.rl-dock',
  '.rl-tip',
  '.rl-menu',
  '.rl-endpanel',
  ".rl-garage__plate[data-model='pending']::after",
  '.rl-settings',
  '.rl-versus__knob::after',
  '.rl-chat--float',
  '.rl-force__bench',
  '.rl-net-status',
  '.rl-advisor',
  '.rl-below',
  '.rl-net-score',
  '.rl-net-points',
  '.rl-arena-strip',
]);

function selectorOf(i: number): string {
  let j = i;
  while (j > 0 && !lines[j].includes('{')) j--;
  return lines[j].split('{')[0].trim();
}

describe('theme.css uses logical properties on the inline axis', () => {
  it('no margin, padding, border, text-align or float names a physical side', () => {
    const re = /(?<![-\w])(margin-(left|right)|padding-(left|right)|border-(left|right)(-(color|width|style))?|text-align\s*:\s*(left|right)\b|float\s*:\s*(left|right)\b)/;
    const offenders = lines.flatMap((l, i) => (!re.test(l) ? [] : [`${i + 1}: ${l.trim()}`]));
    expect(offenders).toEqual([]);
  });

  it('a physical left/right offset is only on a selector that places a box against the viewport (the named list)', () => {
    const offenders = lines.flatMap((l, i) => {
      if (!/(^|[\s{;])(left|right)\s*:/.test(l)) return [];
      const sel = selectorOf(i);
      return PHYSICAL_OFFSET_OK.has(sel) ? [] : [`${i + 1}: ${sel} { ${l.trim()} }`];
    });
    expect(offenders).toEqual([]);
  });

  it('the logical form is really there: the pass did not just delete the rules', () => {
    const count = (re: RegExp): number => lines.filter((l) => re.test(l)).length;
    expect(count(/margin-inline-start/)).toBeGreaterThan(10);
    expect(count(/border-inline-start/)).toBeGreaterThan(10);
    expect(count(/inset-inline-(start|end)/)).toBeGreaterThan(20);
    expect(count(/text-align\s*:\s*(start|end)/)).toBeGreaterThan(20);
  });

  it('every selector in the physical allowlist still carries a physical offset (a stale entry would hide a regression)', () => {
    const used = new Set<string>();
    lines.forEach((l, i) => {
      if (/(^|[\s{;])(left|right)\s*:/.test(l)) used.add(selectorOf(i));
    });
    const stale = [...PHYSICAL_OFFSET_OK].filter((s) => !used.has(s));
    expect(stale).toEqual([]);
  });
});
