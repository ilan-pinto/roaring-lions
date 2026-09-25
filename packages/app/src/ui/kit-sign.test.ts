// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { units, type UpgradableUnit } from '@lions/data';
import {
  CHEVRON_SWEEP,
  KIT_SYMBOLS,
  KIT_TRACKS,
  kitLevelLabel,
  kitPipsHtml,
  kitSummary,
  kitSymbolSvg,
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
