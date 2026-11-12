/**
 * GH-1197 P5: the collapse debris plan. Literal oracles from the design (section 3.3-3.5) and the lead's rulings.
 */
import { describe, expect, it } from 'vitest';
import {
  COLLAPSE_CHUNK_CAP,
  collapseChunkCount,
  collapseDustRecipe,
  planCollapseChunks,
  rangeInsideCircle,
} from './collapse-debris';
import { planDebris } from './debris-flight';
import { FLIPBOOK_SMOKE_ALPHA } from './flipbook-fx';

describe('how many: 40 a 3x3 by area, capped at 48; 6 a tile for a per-tile wall', () => {
  it('literal counts', () => {
    expect(collapseChunkCount(9, false)).toBe(40);
    expect(collapseChunkCount(4, false)).toBe(18);
    expect(collapseChunkCount(12, false)).toBe(48); // 53 by area, capped
    expect(collapseChunkCount(100, false)).toBe(48);
    expect(COLLAPSE_CHUNK_CAP).toBe(48);
    expect(collapseChunkCount(1, true)).toBe(6);
    expect(collapseChunkCount(9, true)).toBe(48); // 54, capped
  });
});

/** The angle between two headings, in [0, pi]. */
function gap(a: number, b: number): number {
  const d = Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return d;
}

describe('which way: biased 60/40 AWAY from the last hit side', () => {
  it('over many collapses, 60% of chunks go to the away half and 40% to the hit side, each within +-90 degrees of it', () => {
    let away = 0;
    let n = 0;
    for (let s = 0; s < 300; s++) {
      // Hit from the east of a 3x3 at 20..22: away is west (pi).
      for (const c of planCollapseChunks(s, 20, 20, 22, 22, { x: 40, y: 21.5 }, 2.6, 40)) {
        n++;
        if (c.away) {
          away++;
          expect(gap(c.headingRad, Math.PI)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
        } else {
          expect(gap(c.headingRad, 0)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
        }
      }
    }
    expect(away / n).toBeGreaterThan(0.57);
    expect(away / n).toBeLessThan(0.63);
  });
  it('with no recorded hit, all round: no side is favoured', () => {
    let west = 0;
    let n = 0;
    for (let s = 0; s < 300; s++) {
      for (const c of planCollapseChunks(s, 20, 20, 22, 22, null, 2.6, 40)) {
        n++;
        if (Math.cos(c.headingRad) < 0) west++;
        expect(c.away).toBe(false);
      }
    }
    expect(west / n).toBeGreaterThan(0.45);
    expect(west / n).toBeLessThan(0.55);
  });
  it('is the same plan every time for the same structure (a hash, not a running PRNG)', () => {
    const a = planCollapseChunks(7, 20, 20, 22, 22, { x: 40, y: 21 }, 2.6, 40);
    planCollapseChunks(8, 1, 1, 3, 3, null, 2.6, 40);
    expect(planCollapseChunks(7, 20, 20, 22, 22, { x: 40, y: 21 }, 2.6, 40)).toEqual(a);
  });
});

describe('from where, when, how far and how high', () => {
  const chunks = planCollapseChunks(3, 20, 20, 22, 22, { x: 40, y: 21.5 }, 2.6, 40);
  it('from the roof (inside the footprint), over 0-300 ms', () => {
    for (const c of chunks) {
      expect(c.x).toBeGreaterThanOrEqual(20);
      expect(c.x).toBeLessThanOrEqual(23);
      expect(c.delayMs).toBeGreaterThanOrEqual(0);
      expect(c.delayMs).toBeLessThanOrEqual(300);
    }
  });
  it('an apex of 2-4 t, a throw of at most 3.0 t', () => {
    for (const c of chunks) {
      expect(c.apexTiles).toBeGreaterThanOrEqual(2);
      expect(c.apexTiles).toBeLessThanOrEqual(4);
      expect(c.rangeTiles).toBeLessThanOrEqual(3);
    }
  });
  it('flown from a 1 t roof on flat ground, every chunk rests inside the rubble decal', () => {
    for (let k = 0; k < chunks.length; k++) {
      const c = chunks[k];
      const p = planDebris(c.x, 1, c.z, k, false, { clods: 0, chunks: 1, throwTiles: c.rangeTiles, apexTiles: c.apexTiles }, () => 0, { dirRad: c.headingRad, spreadRad: 0 }, true);
      expect(Math.hypot(p.rest[0] - 21.5, p.rest[2] - 21.5)).toBeLessThanOrEqual(2.6);
    }
  });
  it('the room to the circle is measured along the heading', () => {
    expect(rangeInsideCircle(0, 0, 0, 0, 0, 2)).toBeCloseTo(2, 12);
    expect(rangeInsideCircle(1, 0, 0, 0, 0, 2)).toBeCloseTo(1, 12);
    expect(rangeInsideCircle(1, 0, Math.PI, 0, 0, 2)).toBeCloseTo(3, 12);
  });
});

describe('the landing dust (design 3.5)', () => {
  it('12 billows, never denser than 0.45 (the dust ceiling after 0.6 s)', () => {
    const [layer] = collapseDustRecipe(2.6);
    expect(layer.count).toBe(12);
    expect((layer.alpha ?? 1) * FLIPBOOK_SMOKE_ALPHA).toBeCloseTo(0.45, 9);
    expect(layer.delay_ms[0]).toBeGreaterThanOrEqual(600);
  });
});
