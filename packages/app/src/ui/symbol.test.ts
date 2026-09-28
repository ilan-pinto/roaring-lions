import { describe, expect, it } from 'vitest';
import { SYMBOL_IDS, DINGBAT_IDS, symbolLabel, symbolSvg, symbolBody, VIEWBOX, W, type SymbolId } from './symbol';

const ORDER_IDS = ['move', 'attackMove', 'halt', 'smoke', 'load', 'unload', 'sweep', 'strike'] as const;
const isOrder = (id: SymbolId): boolean => (ORDER_IDS as readonly string[]).includes(id);
const viewBoxOf = (svg: string): number[] => (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map(Number);

describe('the symbol family (G1 r2 roles, r5 orders, r2 utility marks)', () => {
  it('is thirty-two distinct ids: seven roles, eight orders, four utility marks, thirteen GH-261 marks', () => {
    expect(SYMBOL_IDS).toHaveLength(32);
    expect(new Set(SYMBOL_IDS).size).toBe(32);
  });

  it('fills with currentColor and names no colour or variable', () => {
    for (const id of SYMBOL_IDS) {
      for (const framed of [false, true]) {
        const svg = symbolSvg(id, 16, { framed });
        expect(svg).toContain('currentColor');
        expect(svg).not.toMatch(/#[0-9a-fA-F]{3}/);
        expect(svg).not.toContain('var(--');
      }
    }
  });

  it('is filled shapes only -- no stroke anywhere (r2 rule: rings are even-odd fills)', () => {
    for (const id of SYMBOL_IDS) expect(symbolSvg(id, 16, { framed: true })).not.toMatch(/stroke/);
  });

  it('draws roles and utility marks on the shared 24-box, and honours the size asked for', () => {
    const boxes = new Set(SYMBOL_IDS.filter((id) => !isOrder(id)).map((id) => /viewBox="([^"]+)"/.exec(symbolSvg(id, 16))?.[1]));
    expect([...boxes]).toEqual([VIEWBOX]);
    expect(symbolSvg('armour', 10)).toContain('width="10"');
  });

  it('carries at least a pixel of ink at 10 px', () => {
    expect((W * 10) / 24).toBeGreaterThanOrEqual(1);
  });

  it('draws a different body framed and unframed for every role, and the same for non-roles', () => {
    for (const b of ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'] as const)
      expect(symbolBody(b, { framed: true })).not.toBe(symbolBody(b));
    expect(symbolBody('halt', { framed: true })).toBe(symbolBody('halt'));
  });

  it('tags its svg with the id, for tests and captures', () => {
    expect(symbolSvg('logistics', 12)).toContain('data-symbol="logistics"');
  });
});

// Fix round 1 (Task 2 review): a static order mark is its surround at rest
// with the aim left out (Q6), and every surround lives in the TOP half of the
// 24-box the aim was drawn in -- so on the full box the HUD mark rode high
// and small (the arrow a sliver at the top of a 14 px glyph, sweep specks at
// 18 px). The HUD crops each order to its own surround's bounds; the cursor
// (Task 4) keeps the full box, because its hotspot is (12, 12) in it.
describe('the HUD order marks are cropped to their own surround', () => {
  it('never draws an order on the full 24-box', () => {
    for (const id of ORDER_IDS) expect(viewBoxOf(symbolSvg(id, 14))).not.toEqual([0, 0, 24, 24]);
  });

  it('keeps every vertex of the rest mark inside the crop, with a margin', () => {
    for (const id of ORDER_IDS) {
      const [x, y, w, h] = viewBoxOf(symbolSvg(id, 14));
      // Polygon vertices ('M x y L x y ... Z') -- every surround's straight
      // edges, which are where its extremes sit.
      const pts = [...symbolBody(id).matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      expect(pts.length).toBeGreaterThan(0);
      for (const [px, py] of pts) {
        expect(px).toBeGreaterThanOrEqual(x + 0.5);
        expect(px).toBeLessThanOrEqual(x + w - 0.5);
        expect(py).toBeGreaterThanOrEqual(y + 0.5);
        expect(py).toBeLessThanOrEqual(y + h - 0.5);
      }
    }
  });

  it('crops tight: a mark in the top half of the box no longer carries the empty bottom half', () => {
    // Every surround but strike's ring sits above y = 11 at rest.
    for (const id of ORDER_IDS.filter((o) => o !== 'strike')) {
      const [, y, , h] = viewBoxOf(symbolSvg(id, 14));
      expect(y + h).toBeLessThan(12);
    }
  });

  it('keeps the aspect ratio: the drawn box is the viewBox scaled, never stretched', () => {
    for (const id of ORDER_IDS) {
      const svg = symbolSvg(id, 14);
      const [, , w, h] = viewBoxOf(svg);
      const width = Number(/ width="([^"]+)"/.exec(svg)?.[1]);
      const height = Number(/ height="([^"]+)"/.exec(svg)?.[1]);
      expect(height).toBe(14);
      expect(width / height).toBeCloseTo(w / h, 1);
      expect(svg).not.toContain('preserveAspectRatio="none"');
    }
  });
});


// GH-261: the Military set the lead picked on 29 Sep, ported from
// `.superpowers/dingbats-mock/gen.mjs`. The mock mirrored with a transform;
// the sheet bakes the coordinates, so no `<g transform>` ever ships.
describe('the GH-261 dingbat marks (Military set)', () => {
  const vertices = (id: SymbolId): string[] =>
    [...symbolBody(id).matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => `${Number(m[1])},${Number(m[2])}`).sort();
  const mirrored = (id: SymbolId): string[] =>
    [...symbolBody(id).matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)]
      .map((m) => `${Math.round((24 - Number(m[1])) * 100) / 100},${Number(m[2])}`)
      .sort();

  it('names the thirteen marks the pick covers', () => {
    expect([...DINGBAT_IDS].sort()).toEqual(
      ['audioOff', 'audioOn', 'back', 'broken', 'heavy', 'leave', 'next', 'objectiveDone', 'objectiveFailed', 'objectiveOpen', 'pageNext', 'pagePrev', 'pause'].sort()
    );
    for (const id of DINGBAT_IDS) expect(SYMBOL_IDS).toContain(id);
  });

  it('draws every one on the shared 24-box, filled in currentColor, with no transform and no stroke', () => {
    for (const id of DINGBAT_IDS) {
      const svg = symbolSvg(id, 16);
      expect(viewBoxOf(svg)).toEqual([0, 0, 24, 24]);
      expect(svg).toContain('fill="currentColor"');
      expect(svg).not.toMatch(/stroke|transform/);
    }
  });

  it('bakes the mirrored pairs: back is next reflected, pagePrev is pageNext reflected', () => {
    expect(vertices('back')).toEqual(mirrored('next'));
    expect(vertices('pagePrev')).toEqual(mirrored('pageNext'));
  });

  it('keeps pairs that mean different things visibly different', () => {
    expect(symbolBody('audioOff')).not.toBe(symbolBody('audioOn'));
    expect(symbolBody('audioOff').startsWith(symbolBody('audioOn'))).toBe(true); // B: the same bolt, struck through
    const objs = new Set(['objectiveOpen', 'objectiveDone', 'objectiveFailed'].map((id) => symbolBody(id as SymbolId)));
    expect(objs.size).toBe(3);
  });

  it('keeps every vertex inside the box', () => {
    for (const id of DINGBAT_IDS) {
      for (const v of vertices(id)) {
        const [x, y] = v.split(',').map(Number);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(24);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(24);
      }
    }
  });
});

describe('symbolLabel: a mark beside catalogue text', () => {
  it('puts the mark before the text by default, and escapes the text', () => {
    const html = symbolLabel('back', 'main <menu>');
    expect(html.indexOf('data-symbol="back"')).toBeLessThan(html.indexOf('main'));
    expect(html).toContain('main &lt;menu&gt;');
  });

  it('puts the mark after the text when asked', () => {
    const html = symbolLabel('next', 'next mission', { after: true });
    expect(html.indexOf('next mission')).toBeLessThan(html.indexOf('data-symbol="next"'));
  });
});
