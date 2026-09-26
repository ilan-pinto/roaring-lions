/**
 * Final whole-branch review (Fix 1): this module's own scheme -- the
 * relative ordering of its bands, `STRUCTURE_RENDER_ORDER`'s alias, and the
 * reserved gap the overlay tier needs -- had no test of its own. Every OTHER
 * module that consumes a `*_RENDER_ORDER` constant asserts against it
 * relationally (`structures.test.ts`, `fx.test.ts`), never against a
 * literal number, which is exactly why this file's own review-round
 * renumber of the fog band (4 -> 10) required no edits anywhere else.
 * Task 10 then retired that band entirely -- fog is a post pass
 * (`../fog-pass.ts`) and draws nothing in this scene -- so every relation
 * below that ended at fog now ends at the highest band a real object still
 * occupies, `SILHOUETTE_RENDER_ORDER`. This file follows the same discipline:
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
  FX_RENDER_ORDER_ADDITIVE,
  FX_RENDER_ORDER_ABOVE,
  FX_RENDER_ORDER_ABOVE_ADDITIVE,
  OVERLAY_RENDER_ORDER,
  SMOKE_RENDER_ORDER,
  STRUCTURE_RENDER_ORDER,
  TRAIL_RENDER_ORDER,
  SILHOUETTE_RENDER_ORDER,
  WORLD_RENDER_ORDER,
  DECAL_PERSISTENT_RENDER_ORDER,
  DECAL_FADING_RENDER_ORDER,
} from './render-order';

describe('render order bands', () => {
  it('ascend strictly: hull < turret < fx < fx-above < overlay', () => {
    expect(HULL_RENDER_ORDER).toBeLessThan(TURRET_RENDER_ORDER);
    expect(TURRET_RENDER_ORDER).toBeLessThan(FX_RENDER_ORDER);
    expect(FX_RENDER_ORDER).toBeLessThan(FX_RENDER_ORDER_ABOVE);
    // A comparison against the fog band closed this chain until Task 10
    // retired it; the overlay tier is the next real band above FX-above.
    expect(FX_RENDER_ORDER_ABOVE).toBeLessThan(OVERLAY_RENDER_ORDER);
  });

  it('the badge numeral sits strictly between the turret and FX bands -- Pixi paints it above every hull/turret sprite but below FX and unitsG', () => {
    expect(BADGE_NUMERAL_RENDER_ORDER).toBeGreaterThan(TURRET_RENDER_ORDER);
    expect(BADGE_NUMERAL_RENDER_ORDER).toBeLessThan(FX_RENDER_ORDER);
  });

  it('the occlusion silhouette sits above the overlay and smoke tiers', () => {
    // Above overlays and smoke because both are depthTest:false tiers that
    // paint over a unit's body unconditionally, and smoke's 0.72-alpha
    // full-body wash would gut the one cue that survives an occluder --
    // see this module's own "Update, the silhouette band" paragraph. A
    // third assertion put it below fog, for the overhang onto unobserved
    // ground; Task 10 retired that band and settles the overhang per PIXEL
    // instead, which is strictly better than a whole-outline relation could
    // be.
    expect(SILHOUETTE_RENDER_ORDER).toBeGreaterThan(OVERLAY_RENDER_ORDER);
    expect(SILHOUETTE_RENDER_ORDER).toBeGreaterThan(SMOKE_RENDER_ORDER);
  });

  it('world geometry draws BEFORE every unit band, not merely at a different one', () => {
    // The silhouette's stencil mask is only true if a unit body was
    // depth-tested against a world that had already drawn -- see the
    // table's own -1 row for the measured incident. Strictly below hull,
    // which is the band every unit body path starts from.
    expect(WORLD_RENDER_ORDER).toBeLessThan(HULL_RENDER_ORDER);
    expect(WORLD_RENDER_ORDER).toBeLessThan(TURRET_RENDER_ORDER);
    // ...and it is NOT the band a structure billboard or a collapse mesh
    // uses: both are transparent, drawn after every opaque object whatever
    // number they carry, and band 0 is load-bearing for them.
    expect(STRUCTURE_RENDER_ORDER).not.toBe(WORLD_RENDER_ORDER);
  });

  it('the shared overlay tier sits strictly above fx-above, and does not collide with the badge numeral band', () => {
    expect(OVERLAY_RENDER_ORDER).toBeGreaterThan(FX_RENDER_ORDER_ABOVE);
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

  it('smoke sits strictly above the overlay tier -- it must paint over HP bars/rings/markers', () => {
    // Pixi's own smoke block draws into the SAME unitsG container the
    // overlay tier does, LATER in the same per-frame method -- on screen
    // that paints smoke over the rest of the overlay tier, not merely
    // alongside it (this file's own band-5 row has the full argument for
    // why a dedicated band, not a shared one, is what reproduces that).
    // "...and still be hidden by fog" was the second half until Task 10:
    // fog is a post pass now and hides smoke by depth, not by band.
    expect(SMOKE_RENDER_ORDER).toBeGreaterThan(OVERLAY_RENDER_ORDER);
  });

  it('the additive (hotCore) sibling of each FX tier sits strictly after its own normal tier, and strictly before the next tier', () => {
    // Not tied to its normal sibling -- see units/fx.ts's createParticleMaterial
    // doc comment for why: a hotCore fragment writes alpha 1.0 (an opaque
    // overwrite, not a commutative sum), so it must draw AFTER its own
    // tier's ordinary dust/smoke or a later-submitted normal particle could
    // paint over the hot core it should sit on top of.
    expect(FX_RENDER_ORDER_ADDITIVE).toBeGreaterThan(FX_RENDER_ORDER);
    expect(FX_RENDER_ORDER_ADDITIVE).toBeLessThan(FX_RENDER_ORDER_ABOVE);
    expect(FX_RENDER_ORDER_ABOVE_ADDITIVE).toBeGreaterThan(FX_RENDER_ORDER_ABOVE);
    expect(FX_RENDER_ORDER_ABOVE_ADDITIVE).toBeLessThan(OVERLAY_RENDER_ORDER);
  });

  it('leaves a gap of at least four bands above FX_RENDER_ORDER_ABOVE for the overlay tier', () => {
    // Not "exactly four", not "exactly six" -- the fix round that reserved
    // 4-9 (six numbers) left the GUARANTEE this pins: enough room for
    // several overlay bands (selection rings, HP bars, group badges, hover,
    // order markers, a focus ring) above FX. It used to be anchored at the
    // fog band's own 10; with that band retired the anchor is the top of
    // the reserved range instead, which is the same number and no longer
    // depends on an object being there. Asserting the literal reserved
    // count would make this fail the moment a future tier claims one of
    // those numbers for real, which is not a regression -- so the floor,
    // not the exact width, is what is pinned.
    const RESERVED_TOP = 10;
    expect(SILHOUETTE_RENDER_ORDER).toBeLessThanOrEqual(RESERVED_TOP);
    expect(RESERVED_TOP - FX_RENDER_ORDER_ABOVE).toBeGreaterThanOrEqual(4);
  });

  it('the decal pool bands are named aliases, not independent numbers, and sit below the turret', () => {
    // ground-plan-1 Task 10: the persistent decal mesh (crater/scorch/oil/
    // rubble) draws at the same band a mesh building's opaque hull does --
    // under everything that moves -- and the fading mesh (tread/tyre) draws
    // at the same band the tunnel-trail mesh does, so a tread print can sit
    // over an older crater without ever outranking a unit standing on it.
    expect(DECAL_PERSISTENT_RENDER_ORDER).toBe(WORLD_RENDER_ORDER);
    expect(DECAL_FADING_RENDER_ORDER).toBe(TRAIL_RENDER_ORDER);
    expect(DECAL_PERSISTENT_RENDER_ORDER).toBeLessThan(TURRET_RENDER_ORDER);
    expect(DECAL_FADING_RENDER_ORDER).toBeLessThan(TURRET_RENDER_ORDER);
  });
});
