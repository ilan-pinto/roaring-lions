/**
 * Final whole-branch review (Fix 1): this module's own scheme -- the
 * relative ordering of its bands, `STRUCTURE_RENDER_ORDER`'s alias, and the
 * reserved gap the overlay tier needs -- had no test of its own. Every OTHER
 * module that consumes a `*_RENDER_ORDER` constant asserts against it
 * relationally (`fog-mesh.test.ts:198-199`, `structures.test.ts:527-528`,
 * `fx.test.ts:565`), never against a literal number, which is exactly why
 * this file's own review-round renumber (`FOG_RENDER_ORDER` 4 -> 10)
 * required no edits anywhere else. This file follows the same discipline:
 * every assertion below is relational, on purpose, so a future renumber
 * (Phase C claiming bands 4-9) does not require touching this file either.
 *
 * Per this project's own standard (twenty-three tests found, across three
 * phases, that passed while checking nothing): every assertion below was
 * verified by hand by changing the constant it guards and confirming the
 * SPECIFIC test named goes red, then reverting. See this task's own report
 * for exactly what was broken and what each break's failure message said.
 */
import { describe, it, expect } from 'vitest';
import {
  HULL_RENDER_ORDER,
  TURRET_RENDER_ORDER,
  BADGE_NUMERAL_RENDER_ORDER,
  FX_RENDER_ORDER,
  FX_RENDER_ORDER_ABOVE,
  OVERLAY_RENDER_ORDER,
  SMOKE_RENDER_ORDER,
  FOG_RENDER_ORDER,
  STRUCTURE_RENDER_ORDER,
  TRAIL_RENDER_ORDER,
} from './render-order';

describe('render order bands', () => {
  it('ascend strictly: hull < turret < fx < fx-above < fog', () => {
    expect(HULL_RENDER_ORDER).toBeLessThan(TURRET_RENDER_ORDER);
    expect(TURRET_RENDER_ORDER).toBeLessThan(FX_RENDER_ORDER);
    expect(FX_RENDER_ORDER).toBeLessThan(FX_RENDER_ORDER_ABOVE);
    expect(FX_RENDER_ORDER_ABOVE).toBeLessThan(FOG_RENDER_ORDER);
  });

  it('the badge numeral sits strictly between the turret and FX bands -- Pixi paints it above every hull/turret sprite but below FX, unitsG and fog alike', () => {
    expect(BADGE_NUMERAL_RENDER_ORDER).toBeGreaterThan(TURRET_RENDER_ORDER);
    expect(BADGE_NUMERAL_RENDER_ORDER).toBeLessThan(FX_RENDER_ORDER);
  });

  it('the shared overlay tier sits strictly between fx-above and fog, and does not collide with the badge numeral band', () => {
    expect(OVERLAY_RENDER_ORDER).toBeGreaterThan(FX_RENDER_ORDER_ABOVE);
    expect(OVERLAY_RENDER_ORDER).toBeLessThan(FOG_RENDER_ORDER);
    expect(OVERLAY_RENDER_ORDER).not.toBe(BADGE_NUMERAL_RENDER_ORDER);
  });

  it('STRUCTURE_RENDER_ORDER is an alias of HULL_RENDER_ORDER, not an independent number', () => {
    // A falling building's collapse Mesh (ThreeRenderer.beginCollapse) needs
    // to draw at the same band StructureInstancer's own unset default
    // occupies -- see the constant's own doc comment for why that has to be
    // true BY NAME rather than by two constants that merely happen to agree
    // today.
    expect(STRUCTURE_RENDER_ORDER).toBe(HULL_RENDER_ORDER);
  });

  it('TRAIL_RENDER_ORDER is an alias of HULL_RENDER_ORDER, and sits below TURRET -- never band 1', () => {
    // trail-mesh.ts's TrailMesh needs to draw at or below HULL_RENDER_ORDER,
    // never at TURRET_RENDER_ORDER (band 1) -- this file's own closing
    // paragraphs name that explicitly as the one band a trail must not
    // out-rank the ground by claiming. Real depthTest/depthWrite arbitration
    // does the actual occlusion work; this constant only has to stay named
    // and out of the turret band.
    expect(TRAIL_RENDER_ORDER).toBe(HULL_RENDER_ORDER);
    expect(TRAIL_RENDER_ORDER).toBeLessThan(TURRET_RENDER_ORDER);
  });

  it('smoke sits strictly between the overlay tier and fog -- it must paint over HP bars/rings/markers, and still be hidden by fog', () => {
    // Pixi's own smoke block draws into the SAME unitsG container the
    // overlay tier does, LATER in the same per-frame method -- on screen
    // that paints smoke over the rest of the overlay tier, not merely
    // alongside it (this file's own band-5 row has the full argument for
    // why a dedicated band, not a shared one, is what reproduces that).
    expect(SMOKE_RENDER_ORDER).toBeGreaterThan(OVERLAY_RENDER_ORDER);
    expect(SMOKE_RENDER_ORDER).toBeLessThan(FOG_RENDER_ORDER);
  });

  it('leaves a gap of at least four bands above FX_RENDER_ORDER_ABOVE for Phase C\'s overlay tier', () => {
    // Not "exactly four", not "exactly six" -- the brief for this fix round
    // reserves 4-9 (six numbers) but the scheme this test pins is the
    // GUARANTEE Phase C depends on: enough room for several overlay bands
    // (selection rings, HP bars, group badges, hover, order markers, a
    // focus ring) without touching FOG_RENDER_ORDER again. Asserting the
    // literal reserved count here would make this test fail the moment
    // Phase C claims one of those numbers for real, which is not a
    // regression -- so the floor, not the exact width, is what is pinned.
    expect(FOG_RENDER_ORDER - FX_RENDER_ORDER_ABOVE).toBeGreaterThanOrEqual(4);
  });
});
