/**
 * GH-1406 (RTL readiness): `theme.css` styles the INLINE axis with logical properties, so a right-to-left locale mirrors a component with no
 * second stylesheet. In a left-to-right layout every logical property resolves to the physical one it replaced, so no screen moves.
 *
 * What stays physical on purpose, and so is named below: an offset that places a box against the VIEWPORT or the stage (the HUD docks, the
 * minimap, banners), a centring `left: 50%` paired with `translateX(-50%)` (mirroring it would push the box off centre), a pixel position the
 * code computes (`--tip-x`), and a knob whose on-state is a physical `translateX`. Mirroring the HUD itself is a design decision, not a
 * stylesheet pass.
 *
 * GH-1406 part 2 converted three more (`.rl-intro__skip`, `.rl-loan--tab`, `.rl-force__bench`: each placed against its OWN panel or
 * screen, whose content mirrors with it), so 27 physical offsets became 24, and added the second guard below for inline styles
 * written from TypeScript, which the stylesheet test cannot see.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Block comments blanked in place (newlines kept) so line numbers still match the file and prose never counts as a declaration.
const css = readFileSync(join(__dirname, 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const lines = css.split('\n');

/** Selectors whose `left`/`right` is a deliberate physical position (see the file header). */
const PHYSICAL_OFFSET_OK = new Set([
  '.rl-world__town::before',
  '.rl-avatar-picker__tag',
  '.rl-obj-panel--tracker',
  '.rl-clock',
  '.rl-cmd',
  '.rl-minimap',
  '.rl-group-bar',
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

// --- inline styles written from TypeScript (GH-1406 part 2) -----------------------------------------------------------------------------
// `el.style.left = ...` and its kin set a PHYSICAL side that no stylesheet pass reaches. Every site today is a screen coordinate (a pixel
// projected from the world or the pointer, or a percentage of a map picture, which is geography and is never mirrored), so mirroring it
// would put the box on the wrong side of the thing it labels. The list names each file, how many sites it has and why; a new site fails
// until someone writes its reason here, and an entry whose sites are gone fails too (a stale entry would hide the next regression).
const STYLE_SITE = /\.style\.(left|right|marginLeft|marginRight|paddingLeft|paddingRight|textAlign|borderLeft|borderRight)\s*=/;
const PHYSICAL_STYLE_OK: Readonly<Record<string, { sites: number; why: string }>> = {
  'main.ts': { sites: 1, why: 'the drag-select box, from pointer client coordinates' },
  'ui/hud.ts': { sites: 3, why: 'the fire marker, the held-order marker and the works tip, each beside a world position projected to screen pixels' },
  'ui/versus-ground.ts': { sites: 1, why: 'a dot at a percentage of the ground picture: map geography, never mirrored' },
  'ui/worldmap.ts': { sites: 1, why: 'a town marker at a percentage of the campaign map art: geography, never mirrored' },
  'ui/worldmap3d.ts': { sites: 1, why: 'a town pin at the pixel the 3D board projects it to' },
};

function sourceFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full, base);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full.slice(base.length + 1).split('\\').join('/')] : [];
  });
}

describe('inline physical styles written from TypeScript are named', () => {
  const found: Record<string, number> = {};
  for (const file of sourceFiles(join(__dirname, '..'))) {
    const n = readFileSync(join(__dirname, '..', file), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && STYLE_SITE.test(l)).length;
    if (n > 0) found[file] = n;
  }
  it('every file with a physical inline style is on the list with the right count', () => {
    const offenders = Object.entries(found).flatMap(([f, n]) => (PHYSICAL_STYLE_OK[f]?.sites === n ? [] : [`${f}: ${n} site(s), listed ${PHYSICAL_STYLE_OK[f]?.sites ?? 'none'}`]));
    expect(offenders).toEqual([]);
  });
  it('no list entry is stale', () => {
    const stale = Object.keys(PHYSICAL_STYLE_OK).filter((f) => found[f] === undefined);
    expect(stale).toEqual([]);
  });
  it('the scan really sees the sites (it is not an empty walk)', () => {
    expect(Object.values(found).reduce((a, b) => a + b, 0)).toBe(7);
  });
});
