// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { units, type UpgradableUnit } from '@lions/data';
import {
  CHEVRON_SWEEP,
  KIT_ICON_SIGN,
  KIT_SYMBOLS,
  KIT_TRACKS,
  kitIconSignHtml,
  kitLevelLabel,
  kitPipsHtml,
  kitSignAspect,
  kitSummary,
  starOfDavidPath,
  kitSymbolSvg,
  withKitSign,
  type KitSymbolId,
} from './kit-sign';

const IDS: readonly KitSymbolId[] = ['kit', ...KIT_TRACKS];
/** One pixel of ink at 10 px, in the sheet's 24-unit box. */
const MIN_STROKE = 2.4;
const kdf = (id: keyof typeof units): UpgradableUnit => units[id] as unknown as UpgradableUnit;

/** Every diagonal segment in a glyph's paths, as |dx| over |dy|. The sheet
 *  uses absolute M/L/Z only, which is itself a property worth keeping. */
function slopes(svg: string): number[] {
  const out: number[] = [];
  for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
    for (const sub of (m[1] ?? '').split('Z')) {
      const pts = [...sub.matchAll(/[ML]\s*([\d.]+)\s+([\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]);
      if (pts.length > 2) pts.push(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
        const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
        if (dx > 0 && dy > 0) out.push(dx / dy);
      }
    }
  }
  return out;
}

// The S3e family's properties, as phase 3's gated `symbol.test.ts` pins them
// (docs/superpowers/plans/2026-09-19-shell-upgrade-phase-3-app.md, Task 11):
// these four move into `ui/symbol.ts` with the glyphs when G1 approves the
// sheet, and a different drawing passes them without a test edit.
describe('the kit glyphs (placeholders until G1, #165)', () => {
  it('fill and stroke with currentColor, and name no colour of their own', () => {
    for (const id of IDS) {
      const svg = kitSymbolSvg(id, 16, 3);
      expect(svg).toContain('currentColor');
      expect(svg).not.toMatch(/#[0-9a-fA-F]{3}/);
      expect(svg).not.toContain('var(--');
    }
  });

  it('share one viewBox and honour the size asked for', () => {
    const boxes = new Set(IDS.map((id) => /viewBox="([^"]+)"/.exec(kitSymbolSvg(id, 16))?.[1]));
    expect(boxes.size).toBe(1);
    expect(kitSymbolSvg('armour', 40)).toContain('width="40"');
    expect(kitSymbolSvg('kit', 48, 2)).toContain('height="48"');
  });

  it('carry at least a pixel of ink at 10 px', () => {
    // Vacuous for the fill-only glyphs (armour, firepower) and the mark's
    // rect bars -- there is no stroke-width to read on a fill shape. Those
    // are checked by hand (>= 3.5 units at 10 px) until G1's sheet lands.
    for (const id of IDS) {
      for (const m of kitSymbolSvg(id, 10, 3).matchAll(/stroke-width="([\d.]+)"/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(MIN_STROKE);
      }
    }
  });

  it('bevel at the chevron’s own sweep, 14 across over 24 up (mark.ts)', () => {
    const all = IDS.flatMap((id) => slopes(kitSymbolSvg(id, 24, 3)));
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const s of all) expect(s).toBeCloseTo(CHEVRON_SWEEP, 9);
  });

  it('hold one bar per kit level on the mark', () => {
    expect(([1, 2, 3] as const).map((l) => (kitSymbolSvg('kit', 24, l).match(/<rect /g) ?? []).length)).toEqual([
      1, 2, 3,
    ]);
  });

  it('draw from KIT_SYMBOLS and nowhere else, so G1’s sheet is a one-line swap', () => {
    expect(kitSymbolSvg('armour', 24)).toContain(KIT_SYMBOLS.track.armour);
    expect(kitSymbolSvg('kit', 24, 2)).toContain(KIT_SYMBOLS.mark(2));
    expect(kitSymbolSvg('sensors', 24)).toContain(`viewBox="${KIT_SYMBOLS.viewBox}"`);
  });
});

describe('kitSummary', () => {
  it('reads the audit seed: level, pips, the kit’s share of the hit points, and what it cost', () => {
    expect(kitSummary(kdf('inf_squad'), { armour: 2, sensors: 1 })).toEqual({
      level: 1,
      maxed: false,
      pips: [
        { track: 'armour', owned: 2, length: 3 },
        { track: 'sensors', owned: 1, length: 3 },
        { track: 'firepower', owned: 0, length: 3 },
      ],
      hpKit: 60, // tier 2's cumulative patch, not 28 + 60
      spent: 385, // 115 + 175 + 95
      total: 1655,
    });
  });

  it('calls a fully bought unit maxed, and prices it whole', () => {
    const s = kitSummary(kdf('mbt_lavi'), { armour: 3, sensors: 3, firepower: 3 });
    expect([s.level, s.maxed, s.hpKit, s.spent, s.total]).toEqual([3, true, 750, 5150, 5150]);
  });

  it('draws a track the type does not have as an empty column', () => {
    const s = kitSummary(kdf('dozer_d9'), {});
    expect(s.pips.map((p) => [p.track, p.length])).toEqual([
      ['armour', 3],
      ['sensors', 3],
      ['firepower', 0],
    ]);
    expect([s.level, s.maxed, s.spent, s.total]).toEqual([0, false, 0, 1985]);
  });

  it('clamps an owned tier past its track, in the pips and in the spend', () => {
    const s = kitSummary(kdf('recon_drone'), { armour: 9 });
    expect(s.pips[0]).toEqual({ track: 'armour', owned: 3, length: 3 });
    expect([s.level, s.spent]).toEqual([2, 390]);
  });

  it('never throws on a unit whose JSON cannot take its own patch', () => {
    const broken: UpgradableUnit = {
      id: 'broken',
      hull: { hp: 10 },
      upgrades: { armour: { tiers: [{ price: 5, patch: { 'hull.armor.front': 5 } }] } },
    };
    expect(() => kitSummary(broken, { armour: 1 })).not.toThrow();
    expect(kitSummary(broken, { armour: 1 }).hpKit).toBe(0);
  });
});

describe('kitPipsHtml', () => {
  const pips = kitSummary(kdf('inf_squad'), { armour: 2, sensors: 1 }).pips;
  /** Parsed, not regexed: the HUD builds a string, the garage sets innerHTML. */
  const parse = (html: string): HTMLElement => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
  };
  it('draws three columns in track order, filled from the account', () => {
    const root = parse(kitPipsHtml(pips));
    const cols = [...root.querySelectorAll('.rl-kit-pips__col')];
    expect(cols.map((c) => c.getAttribute('data-track'))).toEqual(['armour', 'sensors', 'firepower']);
    expect(cols.map((c) => c.querySelectorAll('[data-on="1"]').length)).toEqual([2, 1, 0]);
    expect(cols.map((c) => c.querySelectorAll('.rl-kit-pips__pip').length)).toEqual([3, 3, 3]);
  });

  it('says the kit in words for a screen reader, skipping a track the type lacks', () => {
    expect(kitPipsHtml(pips)).toContain('aria-label="Kit: Armour 2 of 3, Sensors 1 of 3, Firepower 0 of 3"');
    const d9 = kitSummary(kdf('dozer_d9'), { armour: 1 }).pips;
    expect(kitPipsHtml(d9)).toContain('aria-label="Kit: Armour 1 of 3, Sensors 0 of 3"');
    expect(kitPipsHtml(d9)).toContain('data-track="firepower" data-len="0"');
  });

  it('labels a level for the plate', () => {
    expect([kitLevelLabel(1), kitLevelLabel(2), kitLevelLabel(3)]).toEqual(['Kit I', 'Kit II', 'Kit III']);
  });
});

// NOT `new URL('./theme.css', import.meta.url)`: under this file's jsdom
// environment Vite's client transform special-cases exactly that syntactic
// pattern into a dev-server asset URL (`http://localhost:.../theme.css`),
// discarding the filesystem path -- measured directly, not assumed. Building
// the path in two steps keeps the plain runtime semantics.
const THEME = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf8');

/** A rule's body by its exact selector at the start of a line, so
 *  `.rl-kit-icon` never matches `.rl-kit-icon svg` or `.rl-tile > .rl-kit-icon`. */
function ruleBody(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
  const body = new RegExp(`\\n${esc}\\s*\\{([^}]*)\\}`).exec(THEME)?.[1];
  if (body === undefined) throw new Error(`fixture: theme.css has no rule "${selector}"`);
  return body;
}

/** Every star the icon sign draws, read back out of its markup -- never
 *  restated -- as vertex lists in the svg's own viewBox (`0 0 w STAR_H`,
 *  `w` following the level), left to right. */
function signSvg(level: 1 | 2 | 3): SVGSVGElement {
  const host = document.createElement('div');
  host.innerHTML = kitIconSignHtml(level);
  const svg = host.querySelector('svg');
  if (svg === null) throw new Error('fixture: the sign has no svg');
  return svg;
}
/** The svg's viewBox as [width, height]; it always starts at 0 0. */
function viewBox(level: 1 | 2 | 3): [number, number] {
  const vb = (signSvg(level).getAttribute('viewBox') ?? '').split(' ').map(Number);
  expect(vb.slice(0, 2)).toEqual([0, 0]);
  return [vb[2] ?? NaN, vb[3] ?? NaN];
}
function signStars(level: 1 | 2 | 3): [number, number][][] {
  return [...signSvg(level).querySelectorAll('path')]
    .map((path) => {
      const d = path.getAttribute('d') ?? '';
      return [...d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m): [number, number] => [Number(m[1]), Number(m[2])]);
    })
    .sort((p, q) => Math.min(...p.map((v) => v[0])) - Math.min(...q.map((v) => v[0])));
}
const extent = (vs: [number, number][], axis: 0 | 1): [number, number] => [
  Math.min(...vs.map((v) => v[axis])),
  Math.max(...vs.map((v) => v[axis])),
];

describe('the kit sign on a unit icon (plan 2b, G-N2)', () => {
  const ICON = '<img class="rl-chip__art" src="/x.png" alt="" draggable="false">';

  it('is the approved sizes, and the stylesheet draws the chip and everything else at exactly those sizes', () => {
    // G-N2 FINAL, the lead, 2026-09-27: "B, but 20 px on the chip." The
    // plan's original single 1.25rem (G-N2's recommendation, R-6) survives
    // only on the chip; every other surface takes the smaller 0.5rem ('small').
    // Fix round 1 (review): the size is picked by a CSS selector, never by a
    // JS parameter -- `kitIconSignHtml`/`withKitSign` take no surface
    // argument at all, so there is nothing here for a call site to omit.
    // "Bigger stars" (the lead, 2026-09-27, judging the G-P3 captures): each
    // size is now ONE STAR's height -- about 10 px on the chip, 8 px on the
    // card, the dock tile and the rail -- and the sign's width follows from
    // the level (`kitSignAspect`), so the stylesheet sets the height only.
    expect(KIT_ICON_SIGN).toEqual({ chip: { rem: 0.625, px: 10 }, small: { rem: 0.5, px: 8 } });
    expect(KIT_ICON_SIGN.chip.px).toBe(KIT_ICON_SIGN.chip.rem * 16);
    expect(KIT_ICON_SIGN.small.px).toBe(KIT_ICON_SIGN.small.rem * 16);
    const base = ruleBody('.rl-kit-icon svg');
    expect(base).toMatch(/width:\s*auto;/);
    expect(base).toMatch(new RegExp(`height:\\s*${KIT_ICON_SIGN.small.rem}rem`));
    // The chip-only size: an ancestor/sibling selector keyed on the chip's
    // own art class (hud.ts's renderChips, ~line 1611), read straight out of
    // theme.css -- not a class the JS output adds for this purpose.
    const chip = ruleBody('.rl-chip__art + .rl-kit-icon svg');
    expect(chip).toMatch(/width:\s*auto;/);
    expect(chip).toMatch(new RegExp(`height:\\s*${KIT_ICON_SIGN.chip.rem}rem`));
  });

  it('draws every star the sign’s full height -- 10 px on the chip, 8 px elsewhere -- a clear gap apart, in a row as wide as the level asks', () => {
    // "Bigger stars": one star per level, all the same size so the COUNT is
    // what reads, the row growing leftward from the top-right corner.
    for (const level of [1, 2, 3] as const) {
      const [vbW, vbH] = viewBox(level);
      expect(vbW / vbH, `L${level}: aspect`).toBeCloseTo(kitSignAspect(level), 3);
      const stars = signStars(level);
      for (const s of stars) {
        const [y0, y1] = extent(s, 1);
        const [x0, x1] = extent(s, 0);
        expect(((y1 - y0) / vbH) * KIT_ICON_SIGN.chip.px, `L${level}: chip star height`).toBeCloseTo(10, 2);
        expect(((y1 - y0) / vbH) * KIT_ICON_SIGN.small.px, `L${level}: small star height`).toBeCloseTo(8, 2);
        expect(x0, `L${level}: inside the box`).toBeGreaterThanOrEqual(-1e-3);
        expect(x1).toBeLessThanOrEqual(vbW + 1e-3);
      }
      for (let i = 1; i < stars.length; i++) {
        const gap = extent(stars[i], 0)[0] - extent(stars[i - 1], 0)[1];
        expect((gap / vbH) * KIT_ICON_SIGN.chip.px, `L${level}: gap ${i}`).toBeGreaterThanOrEqual(0.8);
      }
    }
    // Three stars on the chip: about 30 px (27.65), one star 8.66 px wide.
    expect(kitSignAspect(1) * KIT_ICON_SIGN.chip.px).toBeCloseTo(8.66, 2);
    expect(kitSignAspect(3) * KIT_ICON_SIGN.chip.px).toBeCloseTo(27.65, 2);
    expect(kitSignAspect(3) * KIT_ICON_SIGN.small.px).toBeCloseTo(22.12, 2);
  });

  it('draws each star as a closed six-pointed figure: twelve vertices, alternating tip and notch', () => {
    const path = starOfDavidPath(12, 12, 6);
    expect(path).toMatch(/^M[^Z]*Z$/);
    const vs = [...path.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(vs).toHaveLength(12);
    const radii = vs.map(([x, y]) => Math.hypot(x - 12, y - 12));
    radii.forEach((r, i) => expect(r, `vertex ${i}`).toBeCloseTo(i % 2 === 0 ? 6 : 6 / Math.sqrt(3), 2));
    // Point up, as the star is drawn: the first vertex is the top tip.
    expect(vs[0][0]).toBeCloseTo(12, 6);
    expect(vs[0][1]).toBeCloseTo(6, 6);
  });

  it('draws one star per kit level, right-aligned into the corner, in currentColor with no colour of its own', () => {
    for (const level of [1, 2, 3] as const) {
      const stars = signStars(level);
      expect(stars, `L${level}`).toHaveLength(level);
      expect(extent(stars[stars.length - 1], 0)[1], `L${level}: flush with the right edge`).toBeCloseTo(viewBox(level)[0], 2);
      const html = kitIconSignHtml(level);
      expect(html).toContain('currentColor');
      expect(html).not.toMatch(/#[0-9a-fA-F]{3}/);
      expect(html).not.toContain('var(--');
    }
    // Every level's corner star sits the same distance from the right edge:
    // anchored top-right, the corner holds still and the row grows leftward.
    const fromRight = ([1, 2, 3] as const).map((l) => {
      const [x0, x1] = extent(signStars(l).at(-1) ?? [], 0);
      return [viewBox(l)[0] - x1, viewBox(l)[0] - x0];
    });
    expect(fromRight[1][0]).toBeCloseTo(fromRight[0][0], 2);
    expect(fromRight[1][1]).toBeCloseTo(fromRight[0][1], 2);
    expect(fromRight[2][0]).toBeCloseTo(fromRight[0][0], 2);
    expect(fromRight[2][1]).toBeCloseTo(fromRight[0][1], 2);
  });

  it('draws nothing at level 0, and leaves an unkitted icon byte-identical', () => {
    expect(kitIconSignHtml(0)).toBe('');
    expect(withKitSign(ICON, 0)).toBe(ICON);
  });

  it('is steel stars at the level asked, drawn at the smaller size (CSS sizes the chip up), and names the level for a screen reader', () => {
    for (const level of [1, 2, 3] as const) {
      const host = document.createElement('div');
      host.innerHTML = kitIconSignHtml(level);
      const sign = host.querySelector<HTMLElement>('.rl-kit-icon');
      expect(sign?.dataset.kit).toBe(String(level));
      expect(sign?.className).toBe('rl-kit-icon rl-kit-mark'); // no size modifier class -- CSS alone decides
      expect(sign?.getAttribute('role')).toBe('img');
      expect(sign?.getAttribute('aria-label')).toBe(kitLevelLabel(level));
      const svg = sign?.querySelector('svg');
      expect(Number(svg?.getAttribute('width'))).toBeCloseTo(KIT_ICON_SIGN.small.px * kitSignAspect(level), 2);
      expect(svg?.getAttribute('height')).toBe(String(KIT_ICON_SIGN.small.px));
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(sign?.querySelectorAll('path')).toHaveLength(level);
      // Not the garage bay's bevelled plate-and-bars mark any more (G-P3).
      expect(sign?.querySelectorAll('rect')).toHaveLength(0);
    }
  });

  it('wraps a kitted icon in a host the sign can sit in, icon first', () => {
    const host = document.createElement('div');
    host.innerHTML = withKitSign(ICON, 2);
    const wrap = host.firstElementChild;
    expect(wrap?.className).toBe('rl-kit-host');
    expect(wrap?.children).toHaveLength(2);
    expect(wrap?.children[0]?.className).toBe('rl-chip__art');
    expect(wrap?.children[1]?.className).toBe('rl-kit-icon rl-kit-mark');
  });

  it('places the sign directly after the chip’s own art, so the chip-only size selector can reach it', () => {
    // The whole point of fix round 1: `.rl-chip__art + .rl-kit-icon` only
    // works because `withKitSign` never puts anything between the icon it is
    // given and the sign it appends. This pins that adjacency directly,
    // rather than trusting the CSS selector test above to catch a reorder.
    const host = document.createElement('div');
    host.innerHTML = withKitSign(ICON, 2);
    const art = host.querySelector('.rl-chip__art');
    expect(art?.nextElementSibling?.className).toBe('rl-kit-icon rl-kit-mark');
  });

  it('tints a kitted chip’s border in three distinct steel steps, tokens only, and leaves its inside alone (G-P3)', () => {
    // "Tinted border" (the lead, 2026-09-27): stronger per level.
    const shares = ([1, 2, 3] as const).map((level) => {
      const body = ruleBody(`.rl-chip[data-kit='${level}']`);
      // Border colour and nothing else: the chip's inside is unchanged.
      expect(body.replace(/\/\*[\s\S]*?\*\//g, '').trim(), `L${level}`).toMatch(/^border-color:[^;]+;$/);
      const m = /border-color:\s*color-mix\(in srgb, var\(--kit\) (\d+)%, var\(--kit-edge\)\)/.exec(body);
      expect(m, `L${level}: color-mix of --kit toward --kit-edge`).not.toBeNull();
      return Number(m?.[1]);
    });
    expect(new Set(shares).size).toBe(3);
    expect([...shares].sort((a, b) => a - b)).toEqual(shares); // stronger at every step
    // The tint sits BEFORE hover and focus in the cascade, so both still win on a kitted chip.
    const at = (sel: string): number => THEME.indexOf(`\n${sel} {`);
    expect(at(".rl-chip[data-kit='3']")).toBeGreaterThan(at('.rl-chip'));
    expect(at(".rl-chip[data-kit='3']")).toBeLessThan(at('.rl-chip:hover'));
    expect(at(".rl-chip[data-kit='3']")).toBeLessThan(at(".rl-chip[data-focus='1']"));
  });

  it('sits top-right, coloured by tokens only, and never changes an icon’s size', () => {
    const sign = ruleBody('.rl-kit-icon');
    expect(sign).toMatch(/position:\s*absolute/);
    expect(sign).toMatch(/top:\s*0/);
    expect(sign).toMatch(/right:\s*0/);
    expect(sign).not.toMatch(/\b(left|bottom):/);
    expect(sign).toMatch(/drop-shadow\([^)]*var\(--kit-edge\)\)/);
    expect(sign).toMatch(/pointer-events:\s*none/);
    expect(ruleBody('.rl-kit-host')).toMatch(/position:\s*relative/);
    expect(ruleBody('.rl-card__frame > .rl-kit-icon')).toMatch(/top:\s*0\.1875rem;\s*right:\s*0\.1875rem/);
    expect(ruleBody('.rl-tile > .rl-kit-icon')).toMatch(/top:\s*0\.125rem;\s*right:\s*0\.125rem/);
    expect(ruleBody(".rl-tile[data-locked='1'] > .rl-kit-icon")).toMatch(/display:\s*none/);
  });
});
