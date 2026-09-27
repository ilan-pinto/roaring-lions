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
  kitSummary,
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

/** The mark's own geometry, read back out of the markup the garage draws --
 *  never restated -- in the sheet's 24-unit box: the plate's inner bottom
 *  edge, and each bar's [top, bottom]. */
function markGeometry(level: 1 | 2 | 3): { plateInnerBottom: number; bars: [number, number][] } {
  const svg = kitSymbolSvg('kit', 24, level);
  const d = /<path d="([^"]+)"/.exec(svg)?.[1];
  const stroke = Number(/stroke-width="([\d.]+)"/.exec(svg)?.[1]);
  if (d === undefined || !Number.isFinite(stroke)) throw new Error('fixture: the kit mark has no stroked plate');
  const ys = [...d.matchAll(/[ML]\s*[\d.]+\s+([\d.]+)/g)].map((m) => Number(m[1]));
  const bars = [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)].map(
    (m): [number, number] => [Number(m[1]), Number(m[1]) + Number(m[2])]
  );
  return { plateInnerBottom: Math.max(...ys) - stroke / 2, bars };
}

/** jsdom (30.x) always serializes a foreign SVG element with an explicit
 *  closing tag, even one built from self-closing source markup (`<path
 *  d="…"/>` round-trips as `<path d="…"></path>`) -- measured directly, not
 *  a real-browser rule. Comparing `element.innerHTML` against a raw
 *  `kitSymbolSvg(...)` string is therefore a DOM-vs-string comparison that
 *  fails on syntax alone; round-tripping the expected side through the same
 *  parser makes it a DOM-vs-DOM comparison of the markup that matters. */
function parseSvg(svg: string): string {
  const div = document.createElement('div');
  div.innerHTML = svg;
  return div.innerHTML;
}

describe('the kit sign on a unit icon (plan 2b, G-N2)', () => {
  const ICON = '<img class="rl-chip__art" src="/x.png" alt="" draggable="false">';

  it('is the approved sizes, and the stylesheet draws the chip and everything else at exactly those sizes', () => {
    // G-N2 FINAL, the lead, 2026-09-27: "B, but 20 px on the chip." The
    // plan's original single 1.25rem (G-N2's recommendation, R-6) survives
    // only on the chip; every other surface takes the smaller 1rem ('small').
    // Fix round 1 (review): the size is picked by a CSS selector, never by a
    // JS parameter -- `kitIconSignHtml`/`withKitSign` take no surface
    // argument at all, so there is nothing here for a call site to omit.
    expect(KIT_ICON_SIGN).toEqual({ chip: { rem: 1.25, px: 20 }, small: { rem: 1, px: 16 } });
    expect(KIT_ICON_SIGN.chip.px).toBe(KIT_ICON_SIGN.chip.rem * 16);
    expect(KIT_ICON_SIGN.small.px).toBe(KIT_ICON_SIGN.small.rem * 16);
    const base = ruleBody('.rl-kit-icon svg');
    expect(base).toMatch(new RegExp(`width:\\s*${KIT_ICON_SIGN.small.rem}rem`));
    expect(base).toMatch(new RegExp(`height:\\s*${KIT_ICON_SIGN.small.rem}rem`));
    // The chip-only size: an ancestor/sibling selector keyed on the chip's
    // own art class (hud.ts's renderChips, ~line 1611), read straight out of
    // theme.css -- not a class the JS output adds for this purpose.
    const chip = ruleBody('.rl-chip__art + .rl-kit-icon svg');
    expect(chip).toMatch(new RegExp(`width:\\s*${KIT_ICON_SIGN.chip.rem}rem`));
    expect(chip).toMatch(new RegExp(`height:\\s*${KIT_ICON_SIGN.chip.rem}rem`));
  });

  it('keeps every bar a clear pixel apart, and off the plate, on the chip at the smallest UI scale (R-6)', () => {
    // Only the chip is held to R-6's floor: it is the one surface the lead
    // kept at the legible size ("B, but 20 px on the chip", G-N2 FINAL).
    const scale = KIT_ICON_SIGN.chip.px / 24; // --ui-scale 1: the smallest the sign is ever drawn
    for (const level of [1, 2, 3] as const) {
      const { plateInnerBottom, bars } = markGeometry(level);
      expect(bars).toHaveLength(level);
      const lowestFirst = [...bars].sort((a, b) => b[0] - a[0]);
      expect((plateInnerBottom - lowestFirst[0][1]) * scale, `L${level}: lowest bar to plate`).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < lowestFirst.length; i++) {
        expect((lowestFirst[i - 1][0] - lowestFirst[i][1]) * scale, `L${level}: gap ${i}`).toBeGreaterThanOrEqual(1);
      }
      for (const [top, bottom] of bars) expect((bottom - top) * scale, `L${level}: bar height`).toBeGreaterThanOrEqual(2);
    }
  });

  it('is smaller everywhere but the chip, at every level, at a clearance the lead accepted below R-6’s own floor', () => {
    // The card frame, the dock tile and the garage rail all take the 16 px
    // 'small' size R-6 measured and rejected (0.83 px of clearance, under
    // the 1 px floor -- the level-1 bar fusing into the plate). The lead saw
    // the B-halo L1 crop this produces and chose it anyway for every surface
    // but the chip ("B, but 20 px on the chip", G-N2 FINAL, 2026-09-27; fix
    // round 1 extended this record from level 1 alone to every level, since
    // the lowest bar -- the one R-6 measured -- sits at the same place in
    // the 24-unit box regardless of how many bars are drawn above it). This
    // test records the accepted number; it does not gate on the floor.
    const scale = KIT_ICON_SIGN.small.px / 24;
    for (const level of [1, 2, 3] as const) {
      const { plateInnerBottom, bars } = markGeometry(level);
      const lowestFirst = [...bars].sort((a, b) => b[0] - a[0]);
      expect((plateInnerBottom - lowestFirst[0][1]) * scale, `L${level}`).toBeCloseTo(0.83, 2);
    }
  });

  it('draws nothing at level 0, and leaves an unkitted icon byte-identical', () => {
    expect(kitIconSignHtml(0)).toBe('');
    expect(withKitSign(ICON, 0)).toBe(ICON);
  });

  it('is the garage’s own mark, at the level asked, drawn at the smaller size (CSS sizes the chip up), and names the level for a screen reader', () => {
    for (const level of [1, 2, 3] as const) {
      const host = document.createElement('div');
      host.innerHTML = kitIconSignHtml(level);
      const sign = host.querySelector<HTMLElement>('.rl-kit-icon');
      expect(sign?.dataset.kit).toBe(String(level));
      expect(sign?.className).toBe('rl-kit-icon rl-kit-mark'); // no size modifier class -- CSS alone decides
      expect(sign?.getAttribute('role')).toBe('img');
      expect(sign?.getAttribute('aria-label')).toBe(kitLevelLabel(level));
      expect(sign?.innerHTML).toBe(parseSvg(kitSymbolSvg('kit', KIT_ICON_SIGN.small.px, level)));
      expect(sign?.querySelectorAll('rect')).toHaveLength(level);
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
