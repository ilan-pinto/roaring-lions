/**
 * The valley backdrop's three promises, checked on the pure height field
 * (`backdropField`), which needs no WebGL: it never covers the playable
 * lozenge (rule 1), it meets the map's own rim without a step, and it is
 * deterministic. The oracle's numbers are literals: the camera's descent per
 * tile along the view axis is sqrt(2) * tan(30 deg) = 0.8165, written here
 * and not imported from the module under test.
 */
import { describe, expect, it } from 'vitest';
import { backdropField, NEAR_CAP_SLOPE, type BackdropSpec } from './backdrop';

const W = 48;
const H = 48;
const SPEC: BackdropSpec = { valley: 'ns', crest: 48, seed: 7, hamlets: 8 };
const LIMIT = 0.8165;
/** The design margin: a head clear of the line at 6+ tiles out (55% of LIMIT). */
const MARGIN = 0.5;
/** The authored crest of the shipped trial blocks, and the schema's tallest. */
const CRESTS = [48, 80];

/** Two rims: flat, and one that climbs 3 world units across the map. */
const RIMS: [string, (x: number, z: number) => number][] = [
  ['flat', () => 0],
  ['tilted', (x, z) => 0.03 * x + 0.03 * z],
];

describe('backdropField', () => {
  for (const [name, rim] of RIMS) for (const crest of CRESTS) {
    it(`never stands above the camera's line to the map on a near side (${name} rim, crest ${crest})`, () => {
      const field = backdropField({ ...SPEC, crest }, rim, W, H);
      let tested = 0;
      let worst = -Infinity;
      for (let x = -48; x <= 96; x += 0.5) {
        for (let z = -48; z <= 96; z += 0.5) {
          const t0 = Math.max(x - W, z - H);
          if (t0 <= 0) continue;
          // Walk the ray back along (-1,-1) to where it enters the map.
          const ex = x - t0;
          const ez = z - t0;
          if (ex < 0 || ex > W || ez < 0 || ez > H) continue; // passes beside the map: no occlusion
          tested++;
          const over = field(x, z).y - rim(ex, ez);
          worst = Math.max(worst, over / t0);
          expect(over).toBeLessThanOrEqual(LIMIT * t0 + 1e-9);
          expect(over).toBeLessThanOrEqual(MARGIN * t0 + 1e-9);
        }
      }
      // Not vacuous: a lot of rays were tested, and the cap is what holds them
      // (the surface does climb on the near side, it is just held under).
      expect(tested).toBeGreaterThan(5000);
      expect(worst).toBeGreaterThan(0.2);
      expect(NEAR_CAP_SLOPE).toBeLessThan(LIMIT);
    });
  }

  it('rises steeply beyond the far edges, where nothing can cover the map', () => {
    const field = backdropField(SPEC, () => 0, W, H);
    // 20 tiles out past the west edge, mid-valley: tall limestone wall.
    expect(field(-20, 24).y).toBeGreaterThan(8);
    // And at the head of the valley, past the north edge.
    expect(field(24, -30).y).toBeGreaterThan(8);
  });

  it('meets the map rim without a step', () => {
    const rim = (x: number, z: number): number => 0.03 * x + 0.03 * z;
    const field = backdropField(SPEC, rim, W, H);
    for (let i = 0; i <= 48; i += 4) {
      expect(Math.abs(field(0, i).y - rim(0, i))).toBeLessThan(1e-6);
      expect(Math.abs(field(i, 0).y - rim(i, 0))).toBeLessThan(1e-6);
      expect(Math.abs(field(W, i).y - rim(W, i))).toBeLessThan(0.05);
      expect(Math.abs(field(i, H).y - rim(i, H))).toBeLessThan(0.05);
    }
  });

  it('is deterministic and seed-dependent', () => {
    const a = backdropField(SPEC, () => 0, W, H);
    const b = backdropField(SPEC, () => 0, W, H);
    const c = backdropField({ ...SPEC, seed: 8 }, () => 0, W, H);
    expect(a(-17, 31).y).toBe(b(-17, 31).y);
    expect(a(-17, 31).y).not.toBe(c(-17, 31).y);
  });
});
