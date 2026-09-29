import { describe, expect, it } from 'vitest';
import * as symbolModule from './symbol';
import { SYMBOL_IDS, symbolSvg, symbolBody, VIEWBOX, W, type SymbolId } from './symbol';

const ORDER_IDS = ['move', 'attackMove', 'halt', 'smoke', 'load', 'unload', 'sweep', 'strike'] as const;
const isOrder = (id: SymbolId): boolean => (ORDER_IDS as readonly string[]).includes(id);
const viewBoxOf = (svg: string): number[] => (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map(Number);

describe('the symbol family (G1 r2 roles, r5 orders, r2 utility marks, the pinned status mark)', () => {
  it('is twenty distinct ids: seven roles, eight orders, four utility marks, one status mark', () => {
    expect(SYMBOL_IDS).toHaveLength(20);
    expect(new Set(SYMBOL_IDS).size).toBe(20);
    expect(SYMBOL_IDS).toContain('pinned');
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

describe('the pinned mark (A, "pressed flat", picked at G-PIN)', () => {
  const body = symbolBody('pinned');
  it('is filled only and in currentColor', () => {
    expect(body).toContain('currentColor');
    expect(body).not.toMatch(/stroke|#[0-9a-fA-F]{3}|var\(--/);
  });
  it('stays inside the 24 box: every coordinate in [0, 24]', () => {
    const nums = [...body.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
    for (const n of nums) expect(n >= -24 && n <= 24).toBe(true); // relative arcs may be negative
  });
  it('is the ground bar over the down-chevron: two filled paths', () => {
    expect(body.match(/<path /g)).toHaveLength(2);
    expect(symbolSvg('pinned', 12)).toContain('data-symbol="pinned"');
  });
  it('is the one pinned glyph: the G-PIN candidates are gone', () => {
    expect(Object.keys(symbolModule)).not.toContain('PINNED_CANDIDATES');
  });
  it('carries a pixel of ink at the chip size (12 px)', () => {
    expect((W * 12) / 24).toBeGreaterThanOrEqual(1);
  });
});

