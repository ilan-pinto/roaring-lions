/**
 * The Rifle Squad's forearms (GH-826 step 2, R1 fix 2): a sleeved cross-section and the old sleeve's own cloth, read off
 * the shipped bytes by `mesh_forearm.ts`. The bands are LITERALS, from the high-effort review of 1 Nov 2026.
 *
 *   section      every ring: left and right within 0.010 m on both axes
 *                near the elbow  <= 0.115 x 0.095
 *                at mid (ring 3 of 5)  major 0.085-0.100, minor 0.065-0.085
 *                at the cuff     width >= depth
 *   texture      the texels under the tube vary (std >= 13 of 255, over the three channels) and are the sleeve's colour
 *                (CIE76 <= 6 to the review's sleeve mean); before the fix one flat texel: std 0, dE 0
 *
 * Constructed failing inputs, each run and watched red before it was written down:
 *   1. every tube UV on one texel (the shipped flat sleeve before this fix): std 0, and the section's stat unchanged;
 *   2. the tube's UVs moved onto the glove's texel: the colour distance goes red (dE 19.7, the review's glove bar is 15);
 *   3. HEAD's bytes (the round 0.11 x 0.11 tube, the flat texel): no vertex under the old sleeve's rectangle, which the
 *      "60 vertices a tube" check refuses rather than passing a vacuous reading.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_REFERENCE, DEMO_SLEEVE_RECT, measureForearm, SLEEVE_RECT } from './mesh_forearm';

const FILE = fileURLToPath(new URL('../../art/meshes/inf_squad.glb', import.meta.url));
const FIGURES = ['f0', 'f1', 'f2'] as const;
const SIDES = ['L', 'R'] as const;
const RINGS = 5;

const GLOVE_TEXEL = { x: 540, y: 594, atlas: [2048, 1024] as const };

describe('every Rifle Squad forearm is a sleeved ellipse over the old sleeve cloth', () => {
  for (const fig of FIGURES) {
    for (const side of SIDES) {
      it(`${fig}_forearm_${side}: 60 tube vertices, 5 rings inside the section bands, texels that vary and are the sleeve's colour`, () => {
        const r = measureForearm(FILE, fig, side);
        expect(r.vertices, 'tube vertices (5 rings of 12)').toBe(12 * RINGS);
        expect(r.rings.length).toBe(RINGS);
        const [elbow, , mid, , cuff] = r.rings;
        expect(elbow[0], 'near the elbow, major').toBeLessThanOrEqual(0.115);
        expect(elbow[1], 'near the elbow, minor').toBeLessThanOrEqual(0.095);
        expect(mid[0], 'mid, major').toBeGreaterThanOrEqual(0.085);
        expect(mid[0], 'mid, major').toBeLessThanOrEqual(0.1);
        expect(mid[1], 'mid, minor').toBeGreaterThanOrEqual(0.065);
        expect(mid[1], 'mid, minor').toBeLessThanOrEqual(0.085);
        expect(cuff[0], 'the cuff: width at least depth').toBeGreaterThanOrEqual(cuff[1]);
        expect(r.texelStd, 'texel std over the tube').toBeGreaterThanOrEqual(13);
        expect(r.distinctUvs, 'distinct UVs (a flat sleeve has one)').toBeGreaterThan(20);
        expect(r.deltaE, 'mean texel against the review\'s sleeve colour, CIE76').toBeLessThanOrEqual(6);
      });
    }
  }

  it('left and right forearms of every figure match to 0.010 m on both axes at every ring', () => {
    for (const fig of FIGURES) {
      const L = measureForearm(FILE, fig, 'L'), R = measureForearm(FILE, fig, 'R');
      expect(L.rings.length).toBe(RINGS);
      for (let k = 0; k < RINGS; k++) {
        expect(Math.abs(L.rings[k][0] - R.rings[k][0]), `${fig} ring ${k}, major`).toBeLessThanOrEqual(0.01);
        expect(Math.abs(L.rings[k][1] - R.rings[k][1]), `${fig} ring ${k}, minor`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('the old sleeve\'s rectangles are inside the 2048 x 1024 atlas', () => {
    for (const side of SIDES) {
      const [x, y, w, h] = SLEEVE_RECT[side];
      expect(x + w).toBeLessThanOrEqual(2048);
      expect(y + h).toBeLessThanOrEqual(1024);
    }
  });
});

describe('the forearm check can fail', () => {
  it('constructed input 1: every tube UV on one texel reads a flat sleeve (std 0, one UV)', () => {
    const flat = measureForearm(FILE, 'f1', 'L', () => [(339 + 0.5) / 2048, (370 + 0.5) / 1024]);
    expect(flat.vertices).toBe(60);
    expect(flat.texelStd).toBeLessThan(1);
    expect(flat.distinctUvs).toBe(1);
    expect(measureForearm(FILE, 'f1', 'L').texelStd).toBeGreaterThanOrEqual(13);
  });

  it('constructed input 2: the tube on the glove\'s texel is not the sleeve\'s colour', () => {
    const glove = measureForearm(FILE, 'f1', 'R', () => [(GLOVE_TEXEL.x + 0.5) / GLOVE_TEXEL.atlas[0], (GLOVE_TEXEL.y + 0.5) / GLOVE_TEXEL.atlas[1]]);
    expect(glove.deltaE).toBeGreaterThan(15);
    expect(measureForearm(FILE, 'f1', 'R').deltaE).toBeLessThanOrEqual(6);
  });
});

// ---- the Demolition squad (GH-826 step 3) ---------------------------------------------------------------------
// Its old forearm UVs are fragments of plain olive (the largest all-cloth rectangle is 12 x 9 and 17 x 39 px, texel std 2 to 3), so the
// sleeve cloth is the atlas's own 64 x 32 px all-cloth rectangle at (749, 363) with the most texture whose colour is the sleeve's and stays clear of the glove (std 5.7, dE76 1.8 to the sleeve, 17.1 from the glove): departure 42.
// The bands are the same section bands; the texture bar is half the upper arm's own sleeve (std 7 to 11 at its vertices), not 13.
const DEMO_FILE = fileURLToPath(new URL('../../art/meshes/demo_squad.glb', import.meta.url));
const DEMO_FIGURES = ['demo_b', 'demo_a'] as const;
const DEMO_TEXEL_STD_MIN = 4;
describe('every Demolition forearm is a sleeved ellipse over the atlas\'s sleeve cloth', () => {
  for (const fig of DEMO_FIGURES) {
    for (const side of SIDES) {
      it(`${fig}_forearm_${side}: 60 tube vertices, 5 rings inside the section bands, texels that vary and are the sleeve's colour`, () => {
        const r = measureForearm(DEMO_FILE, fig, side, undefined, DEMO_REFERENCE);
        expect(r.vertices, 'tube vertices (5 rings of 12)').toBe(12 * RINGS);
        expect(r.rings.length).toBe(RINGS);
        const [elbow, , mid, , cuff] = r.rings;
        expect(elbow[0], 'near the elbow, major').toBeLessThanOrEqual(0.115);
        expect(elbow[1], 'near the elbow, minor').toBeLessThanOrEqual(0.095);
        expect(mid[0], 'mid, major').toBeGreaterThanOrEqual(0.085);
        expect(mid[0], 'mid, major').toBeLessThanOrEqual(0.1);
        expect(mid[1], 'mid, minor').toBeGreaterThanOrEqual(0.065);
        expect(mid[1], 'mid, minor').toBeLessThanOrEqual(0.085);
        expect(cuff[0], 'the cuff: width at least depth').toBeGreaterThanOrEqual(cuff[1]);
        expect(r.texelStd, 'texel std over the tube').toBeGreaterThanOrEqual(DEMO_TEXEL_STD_MIN);
        expect(r.distinctUvs, 'distinct UVs (a flat sleeve has one)').toBeGreaterThan(20);
        expect(r.deltaE, 'mean texel against the review\'s sleeve colour, CIE76').toBeLessThanOrEqual(6);
      });
    }
  }

  it('left and right forearms of both figures match to 0.010 m on both axes at every ring', () => {
    for (const fig of DEMO_FIGURES) {
      const L = measureForearm(DEMO_FILE, fig, 'L', undefined, DEMO_REFERENCE), R = measureForearm(DEMO_FILE, fig, 'R', undefined, DEMO_REFERENCE);
      expect(L.rings.length).toBe(RINGS);
      for (let k = 0; k < RINGS; k++) {
        expect(Math.abs(L.rings[k][0] - R.rings[k][0]), `${fig} ring ${k}, major`).toBeLessThanOrEqual(0.01);
        expect(Math.abs(L.rings[k][1] - R.rings[k][1]), `${fig} ring ${k}, minor`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('the sleeve rectangle is inside the 2048 x 1024 atlas', () => {
    const [x, y, w, h] = DEMO_SLEEVE_RECT.L;
    expect(x + w).toBeLessThanOrEqual(2048);
    expect(y + h).toBeLessThanOrEqual(1024);
  });

  it('constructed failing input: every tube UV on the glove\'s texel (805, 792) is not the sleeve\'s colour, and one texel is not texture', () => {
    const glove = measureForearm(DEMO_FILE, 'demo_a', 'R', () => [(805 + 0.5) / 2048, (792 + 0.5) / 1024], DEMO_REFERENCE);
    expect(glove.vertices).toBe(60);
    expect(glove.deltaE, 'the dust.6 glove against the sleeve').toBeGreaterThan(15);
    expect(glove.distinctUvs).toBe(1);
    expect(glove.texelStd).toBeLessThan(DEMO_TEXEL_STD_MIN);
  });
});
