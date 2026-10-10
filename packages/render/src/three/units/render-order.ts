/**
 * Bugfix: the single source of truth for every `Object3D.renderOrder` band
 * this backend uses, across every module that sets one.
 *
 * Before this module existed, `instances.ts` (hull/turret, Task B3.6) and
 * `fx.ts` (tracers/particles, Task B3.13/B3.14) each declared their own
 * `*_RENDER_ORDER` constants independently, and nothing checked them against
 * each other -- `FX_RENDER_ORDER` was not even exported, so no test could
 * reach across the two files to compare it with `TURRET_RENDER_ORDER`. The
 * two collided: `TURRET_RENDER_ORDER` and the old `FX_RENDER_ORDER` were
 * both `1`. `fx.ts`'s own top comment claimed FX's `renderOrder` sat
 * "strictly above every `UnitInstancer.mesh`'s default (0, never set
 * explicitly there)" -- true the day it was written, false the moment the
 * turret task landed a SECOND `UnitInstancer.mesh` with a non-default,
 * explicit `renderOrder` of its own, and nothing caught the parenthetical
 * going stale.
 *
 * The concrete failure: a tracer or the below-tier particle mesh passing in
 * front of a turret ties with it at `renderOrder` 1. Both meshes sit at
 * their own untransformed local origin (`fx.ts`'s own top comment, "Without
 * an explicit renderOrder..."), so `z` ties too, and the sort falls through
 * to `Object3D.id` -- FX meshes are built in `ThreeRenderer`'s constructor,
 * turret instancers later, inside the async `loadSprites`, so the turret's
 * higher id draws SECOND and paints over the tracer. Tank fights are exactly
 * where tracers come from.
 *
 * Every band below is `Object3D.renderOrder`: three.js's own explicit
 * submission-order tiebreak among transparent meshes tied at `z` (which,
 * per the above, every mesh in this pipeline is, against every other -- so
 * `renderOrder` is the ENTIRE ordering mechanism here, not a tiebreak of
 * last resort). It says nothing about genuine depth occlusion against
 * opaque, depth-writing geometry (terrain, buildings, and units themselves,
 * `depthWrite: true`) -- that is real depth-buffer arbitration, unaffected
 * by any of these numbers.
 *
 * | band | constant                 | what draws there |
 * |------|--------------------------|-------------------|
 * | -1   | `WORLD_RENDER_ORDER`     | Opaque, depth-writing WORLD geometry that units stand in front of and behind -- today, mesh buildings (`units/mesh-building.ts`, idle and wreck alike). Every band in this table above 0 is about compositing translucent things in the right order; this one is not, and it is the only band whose value has an effect on an OPAQUE mesh, where the depth buffer normally makes submission order irrelevant. It was added for `units/silhouette.ts`'s stencil mask, which back when the silhouette was a solid FILL was stamped only where a unit body's fragment WON the depth test -- true only once everything that could beat it had already drawn. three.js's opaque sort is `groupOrder, renderOrder, material.id, z` -- `material.id` BEFORE `z` -- so at band 0 the draw order between a unit and a building is decided by which template happened to load first, and on `beit_sahwan_outskirts` it is the units (measured: unit materials 164-167, building materials 246-250). A tank behind an apartment therefore stamped the mask while only terrain was in the depth buffer, the building overwrote the colour but not the mask, and the tank's own silhouette was masked out down to a few slivers. **That dependency is gone.** The outline needs the mask to mean "a unit's footprint covers this pixel", so a body now stamps on `stencilZFail` as well, which no depth test and therefore no draw order can change. The band stays because it is still correct, still free, and still where a future opaque occluder belongs -- but it is no longer load-bearing, and reverting it would not bring the slivers back. |
 * | 0    | `HULL_RENDER_ORDER`      | every `UnitInstancer` hull mesh -- three.js's own default, never set explicitly. `StructureInstancer` (idle/wreck billboards) ties here too, left at the same unset default -- real depth-tested world geometry, occluding units and buildings against each other purely through the actual depth buffer, exactly like Pixi's own `spriteLayer` depth-sorts buildings and units together by `zIndex` rather than giving buildings a separate paint pass. `STRUCTURE_RENDER_ORDER` (Task B4.4) is this same value, aliased and exported explicitly for the one caller that needs to SET it rather than merely rely on the default -- see that constant's own doc comment below for why. |
 * | 0.25 | `TUNNEL_XRAY_RENDER_ORDER` (+ `_FIGURE_` 0.3, `_BEAM_` 0.35) | GH-471: the x-ray of an identified tunnel (`../tunnel-xray.ts`) -- the bore, its shafts and surface collars at 0.25, the fighters inside at 0.3, the 1.2 s discovery beam at 0.35. Transparent, so only their order within the transparent pass is at stake: AFTER the surface trail and the decals (0, -1), so the cut reads through the spoil tint and a crater; BEFORE the selection ring (0.5), every FX band (2+), the overlay tier (4), smoke (5) and the occlusion silhouette (6), so a ring, a tracer, an HP bar or a smoke screen over the tunnel still wins. Which PIXELS it covers is not this number's business: the bore and the figures carry the silhouette's own `GreaterDepth` + unit-stencil flags, so they draw only where the ground (or a roof, or a ridge) is in front of them and never over a unit body. Fractional for the selection ring's reason: it squeezes between two adjacent constants. |
 * | 1    | `TURRET_RENDER_ORDER`    | every `UnitInstancer` turret mesh -- must outrank its own hull at a co-located, identical-depth instance (`instances.ts`'s own "why this needs to be explicit" comment) |
 * | 2    | `FX_RENDER_ORDER`        | `TracerBatch` and the BELOW-tier, normal-blended `ParticleInstancer` (Pixi's `fxG`) -- still depth-tested against terrain/buildings/units, so must outrank every unit mesh, hull AND turret, now that FX's own materials are `depthWrite: false` (`fx.ts`'s "FX-vs-UNIT ordering is a DIFFERENT question") |
 * | 2.5  | `FX_RENDER_ORDER_ADDITIVE` | the BELOW-tier's `additive`-flagged `ParticleInstancer` (`units/fx.ts`'s `createParticleMaterial`, the `additive` schema field) -- forced-opaque hot-core particles (`vfx.white_hot`-class effects), which must draw AFTER this tier's own normal siblings or an ordinary dust/smoke particle that happens to submit later would opaquely overwrite the hot core it should sit on top of. Not a GPU blend-mode band (`fx.ts`'s own doc comment explains why true `AdditiveBlending` was rejected -- it sums to colours no palette entry names) -- this is still `depthTest: true`, normal-blended-but-forced-to-alpha-1 geometry, one band later than its sibling for exactly the ordering reason just given. |
 * | 3    | `FX_RENDER_ORDER_ABOVE`  | the ABOVE-tier, normal-blended `ParticleInstancer` (`above_units`-tagged emitters, Pixi's `fxAboveG`) -- `depthTest: false`, unconditionally on top |
 * | 3.5  | `FX_RENDER_ORDER_ABOVE_ADDITIVE` | the ABOVE-tier's `additive`-flagged `ParticleInstancer` -- same forced-opaque hot-core treatment as band 2.5, one band after `FX_RENDER_ORDER_ABOVE` for the identical reason: it must draw over this tier's own normal siblings (muzzle-flash cores over their own ring/smoke), not the other way around. Every shipped `additive: true` particle today lands here (all eleven `above_units` fire/cigarette emitters) -- band 2.5 exists for schema completeness, not because anything currently populates it. |
 * | 4    | `OVERLAY_RENDER_ORDER`   | Phase C: `OverlayBatch` (`units/overlays.ts`) -- selection rings, HP bars, suppression bars, the control-group badge's DISC (not its numeral, and not the veterancy chevron; both of those are textured and sit at band 4.5, just above), order markers, the tutorial focus ring, the garrison hover highlight, and the refuge ring (GH-279, a timed dashed ring through `OverlayBatch.dashedEllipseRing`). The objective zone's halo and outline draw here too; its FILL does not any more (#470: it drowned a town) -- the zone's ground band is `ZONE_BAND_RENDER_ORDER`, band 0. One shared band for the whole tier, matching Pixi's own single `unitsG` exactly (this file's closing paragraphs explain why Pixi has only the one container despite drawing all of this). |
 * | 4.5  | `BADGE_NUMERAL_RENDER_ORDER` | Every TEXTURED quad in the overlay tier -- two of them today: the control-group badge's NUMERAL (`NumeralBatch`, Phase C) and the veterancy chevron (`ChevronBatch`, spec 2026-09-10 §4.7). They cannot share band 4 with the vertex-coloured rest of the tier (`units/overlays.ts`'s top comment: a textured quad is its own batch), and they must draw AFTER it, because the badge's own disc is in band 4 and both are `depthTest: false`. **Until WP-P4 (2026-10-07) this was 1.5**, between turret and FX, copying a Pixi container order (this file's closing paragraphs) -- which put the numeral UNDER its own 95%-opaque disc on every grouped unit, so the badge read as a blank lime blob (polish audit PA-18). This row said "above the vertex-coloured tier" the whole time; the number said below. Pixi is deleted (WP-A3.3), so nothing argues for 1.5 any more. The chevron moves with it: it never overlaps band-4 geometry, and one textured band is still the right count. The name stays the badge's, as `STRUCTURE_RENDER_ORDER` keeps its own. |
 * | 5    | `SMOKE_RENDER_ORDER`     | Phase D readiness fix: `SmokeMesh` (`../smoke-mesh.ts`) -- one translucent quad per smoked tile. Pixi's own smoke loop draws into the SAME `unitsG` every band-4 overlay does (`renderer.ts`'s smoke block runs later in the identical per-frame method, after the order-marker/tutorial-focus passes, still before `fogG`), so on screen it paints OVER the overlay tier, not merely alongside it -- a dedicated band one above `OVERLAY_RENDER_ORDER`, rather than folding smoke into `OverlayBatch` itself, reproduces that draw-order relationship without depending on which of two independently-constructed meshes happens to get a lower `Object3D.id` (this file's own top comment: id is the tiebreak of last resort, and relying on construction order to encode a real ordering requirement is the exact hazard the badge-numeral/turret history above already paid for once). `depthTest: false`, matching fog and the overlay tier -- Pixi's comment ("drawn over the ground and under the units so troops inside one still read") is about ALPHA legibility (smoke tops out at 0.72), not depth occlusion; Pixi's own container order paints it over units regardless, translucently. |
 * | 5.5  | `COLLAPSE_FLASH_RENDER_ORDER` | Polish VR-22: the brief fireball a building collapse throws THROUGH its own dust shroud (`data/vfx/collapse_flash.json`, a second pooled `ExplosionBurstManager`). The shroud (`units/collapse-shroud.ts`) is `depthTest: false` at band 5, so the collapse's ordinary burst at 3.5 is painted over by the cloud it is meant to glow inside -- measured: no fireball visible in any collapse frame at 96-600 ms. Half a band ABOVE smoke so this one burst reads through the cloud, below the silhouette so an occluded unit's outline still wins. **PA-19: a vehicle kill's fireball draws here too** (the same pooled manager, `EXPLOSION_BURST_DEFAULT_DURATION_MS`): a killed vehicle throws its own shroud (`beginVehicleCollapseShroud`), and at 3.5 its fireball read as an orange rim round a tan cloud (`pnpm blast:capture`, mbt_lavi at 200 ms). Nothing else draws here. |
 * | 6    | `SILHOUETTE_RENDER_ORDER` | The occlusion silhouette (`units/silhouette.ts`): a team-coloured OUTLINE of a unit's own shape, drawn ONLY where the unit already lost the depth test to something in front of it -- an inverted hull whose interior the stencil punches out. Unlike every other band in this table, its material is neither `depthTest: false` nor an ordinary `LessEqualDepth` -- it is `depthTest: true` with the comparison INVERTED (`GreaterDepth`) plus a view-space bias, so "which pixels" is settled by the depth buffer and this number settles only "in what order". See that module's own top comment for the mechanism and for the fog guarantee (a silhouette rides the body's own `Object3D.visible`, or the hull's own `instanceMatrix`/`count` -- it never re-derives visibility). Why band 6 and not one of the fractional slots below band 4: see this file's closing "Update, the silhouette band" paragraph. |
 * | 7-9  | *(reserved, no constant)* | Still headroom, now that Phase C claimed band 4, the Phase D readiness fix claimed band 5 and the silhouette claimed band 6 -- and more of it than before, since band 10 is retired (row below). Kept reserved rather than renumbered, on the same "reserving the NUMBERS costs nothing, reserving unconsumed CONSTANTS recreates the hazard" reasoning this table's top comment already gives. |
 * | 10   | *(retired 2026-09-14)*   | Fog of war is a post pass now (`../fog-pass.ts`); **nothing in the scene draws at 10**. It used to be `FogMesh` -- one `depthTest: false` black quad per non-visible tile, the top band precisely so it could paint over everything unconditionally. That is what a quad lying on the ground plane has to do to hide a unit whose body rises above it, and it is also why a building in an explored tile wore a black slab across its roof and every fog edge was a tile staircase. Dimming by the world position the DEPTH buffer reports needs neither a band nor a scene object: it runs after the whole scene is drawn, so there is nothing left to be ordered against. Consequently the old "X must sit below the fog band" relation, which several bands below were chosen to satisfy, no longer constrains anything -- fog does not compete with any object. |
 *
 * Phase C (selection rings, HP bars, group badges, hover, and a focus ring)
 * adds two bands, both UI-adjacent overlays -- and when fog was still a
 * mesh they belonged BELOW it, not above. (That relation is retired with
 * the band; the paragraph is kept because it is also the derivation of
 * where the overlay tier sits relative to FX, which still holds.) An
 * earlier version of this
 * paragraph claimed the opposite, citing Pixi identifiers (`hpBarG`,
 * `selectionG`) that do not exist and a container order that is backwards;
 * `grep -c "hpBarG\|selectionG" packages/render/src/renderer.ts` returns 0.
 * The real Pixi picture, verified against the file directly:
 *
 * Pixi has exactly ONE overlay container, `unitsG` (`renderer.ts:197`) --
 * not a per-overlay container per band. Every overlay this list names (HP
 * bars, suppression bars, selection rings, badges, hover, order markers, the
 * focus ring) draws into that same `Graphics` in one place
 * (`renderer.ts:1898`, `const g = this.unitsG`).
 *
 * The one exception, and it was a trap for the Phase C badge port: a control-
 * group badge is SPLIT across two containers. Its ring is drawn into
 * `unitsG` like everything else (`renderer.ts:2310`), but its numeral is a
 * `Text` added to `spriteLayer` (`:2307`) carrying `zIndex =
 * Number.MAX_SAFE_INTEGER` (`:2315`, its own comment: "Above every sorted
 * tile and sprite"). That puts the numeral above every sprite in its own
 * layer and BELOW `fxAboveG`, `unitsG` and `fogG` alike -- so Pixi paints
 * above-units FX over a group numeral, and porting the whole badge into
 * `OVERLAY_RENDER_ORDER` would have lifted the numeral over FX where Pixi
 * covers it. The ring and the numeral do not share a band in Pixi, and Phase
 * C's `NumeralBatch` (`units/overlays.ts`) did not share one here either.
 * **Retired by WP-P4**: copying that put the numeral under its own disc, and
 * with Pixi deleted the numeral now draws just above the overlay tier -- see
 * `BADGE_NUMERAL_RENDER_ORDER`'s own row above.
 *
 * And `unitsG` is added to
 * `world` BEFORE `fogG`, not after: `renderer.ts:548` then `:551`, with
 * `fogG` the LAST child `world` gets, ahead only of `:552`'s
 * `this.app.stage.addChild(this.world)`. `fxAboveG`'s own doc comment
 * (`renderer.ts:239`) states the intent outright: `above_units` particles
 * draw "under `unitsG`, so HP bars, suppression bars and selection rings
 * stay on top" -- on top of FX, and then fog is painted over all of it. So
 * in Pixi every overlay draws UNDER fog, never over it, and the behavioural
 * difference is not pedantic: an order marker or queued route on unexplored
 * ground, a selected unit's weapon envelope crossing into fog, or the
 * tutorial focus ring on an unexplored objective must be covered by fog,
 * not painted bright over black. (A unit you can currently see is
 * unaffected either way -- that tile is fog level 2 and draws no fog quad
 * at all. The cases that differ are exactly the ones that reach onto ground
 * you cannot see.)
 *
 * Bands 4-9 -- above every FX tier, and (while fog was still band 10)
 * below it -- were reserved for this
 * tier, and Phase C took the "one shared overlay band" option the paragraph
 * above always allowed: `OVERLAY_RENDER_ORDER` (band 4) is one `unitsG`-
 * shaped bucket, matching Pixi exactly, for every overlay this table names
 * except the textured ones -- the badge numeral and the veterancy chevron,
 * which share band 4.5 just above it. Bands 7-9 stay
 * reserved and undeclared -- Phase C did not need a second band, and this
 * module remains where any of it gets added if a future task does: one
 * file, one ascending list, so the next collision is a merge conflict or a
 * failing test in THIS file, not a second silent tie two modules apart.
 *
 * One more trap worth naming, since trails are on Phase C's own list:
 * trails are NOT part of this overlay tier. Pixi's `trailG` (tunnel spoil)
 * is `world`'s SECOND child (`renderer.ts:539`) -- below `fxG`,
 * `wreckLayer` and `spriteLayer` alike, underneath everything rather than
 * over anything. Nowhere in 4-9, then; but nor is a band the right
 * instrument. A trail is flat, depth-tested ground geometry, and this
 * table's own top comment already says what settles that case: real
 * `depthTest`/`depthWrite` arbitration against terrain and units, not a
 * `renderOrder` number (`units/fx.ts:116` makes the same argument for the
 * `trailG`/`fxG`/`wreckLayer`-below-`spriteLayer` debt, which is why that
 * debt does not reproduce in this backend). If a Phase C trail port needs a
 * band at all, it belongs at or below `HULL_RENDER_ORDER` -- never band 1,
 * which is the TURRET band and sits ABOVE every hull, the exact inverse of
 * the Pixi relation derived above.
 *
 * Update, the Phase C trail port: it landed as `TRAIL_RENDER_ORDER`, an
 * alias of `HULL_RENDER_ORDER` exported below for the identical reason
 * `STRUCTURE_RENDER_ORDER` is (see that constant's own doc comment) --
 * naming it is what catches a future edit that moves `HULL_RENDER_ORDER`
 * and silently strands this one behind it. `trail-mesh.ts` is the mesh this
 * drives.
 *
 * Update, the silhouette band: band 6, the first of the four this file
 * reserved, claimed by `units/silhouette.ts`. It is a whole band and not a
 * fractional one on this file's own precedent -- every fraction here (2.5,
 * 3.5, 4.5) exists because a value had to squeeze BETWEEN two constants
 * that were already adjacent, while bands 4 and 5 were whole numbers
 * because each opened a genuinely new tier. The silhouette opens a new
 * tier: it is the first material in this backend whose depth comparison is
 * inverted rather than merely enabled or disabled.
 *
 * Why it sits where it does, against the three bands the reserved-headroom
 * paragraph above names:
 *
 *  - Above `OVERLAY_RENDER_ORDER` (4) and `SMOKE_RENDER_ORDER` (5). Both of
 *    those are `depthTest: false` tiers that paint over a unit's body
 *    unconditionally, and a silhouette exists precisely because something
 *    already hid that body once. Smoke is the case that decides it: it
 *    tops out at 0.72 alpha across the WHOLE body (`smoke-mesh.ts`), and a
 *    town assault is exactly where smoke and buildings coincide, so a
 *    silhouette underneath it would be washed to a quarter strength in the
 *    one situation it was added for. The overlay tier costs the reverse
 *    trade and it is much cheaper: an HP bar sits above the head and a
 *    selection ring is a stroke at the feet, so what a silhouette can
 *    cover of either is a few pixels of ring where the body already
 *    overlaps it -- against smoke's full-body wash, this is the smaller
 *    loss, and it is a loss rather than a wash because the silhouette
 *    draws only over the OCCLUDED part.
 *  - Below the retired fog band (10). A silhouette is
 *    only ever drawn for a unit that already passed the fog gate
 *    (`units/observed.ts`), so this was never what stopped a silhouette
 *    leaking an unseen unit -- that is settled structurally, in
 *    `units/silhouette.ts`. What it settled was the overhang: a unit's
 *    geometry standing at the edge of observed ground reaches over
 *    neighbouring tiles that are NOT observed, and on that ground fog must
 *    cover the silhouette exactly as it covers the unit's own body.
 *    **The post pass settles that by construction now** and settles it
 *    better: it dims by the world position each PIXEL reports, so the part
 *    of an outline that overhangs unobserved ground is dimmed and the part
 *    over observed ground is not -- where a band could only ever have hidden
 *    the whole outline or none of it. Fog no longer competes with any
 *    object, so this bullet constrains nothing; it is kept because the two
 *    bullets above it are still live.
 *
 * One property this band deliberately does NOT carry, unlike every other
 * entry from 3 upward: it is not what decides which pixels the silhouette
 * covers. `GreaterDepth` plus a view-space bias does that, against the real
 * depth buffer. This number only decides the order in which the result is
 * composited, which is why it can sit above two `depthTest: false` tiers
 * without becoming one.
 */
/**
 * Opaque world geometry -- mesh buildings -- drawn BEFORE anything that
 * stands among it. See the table's own -1 row for the measured incident
 * that put it here, and for why the silhouette's move from a fill to an
 * outline retired the dependency without retiring the band.
 *
 * Deliberately NOT applied to `StructureInstancer`'s billboards or to a
 * collapse `Mesh` (`STRUCTURE_RENDER_ORDER`, band 0): both are
 * `transparent: true`, so they are drawn in the transparent pass after
 * every opaque object regardless of what number they carry, and moving
 * them would change how they composite against unit billboards for no
 * gain. See `STRUCTURE_RENDER_ORDER`'s own doc comment for why band 0 is
 * load-bearing there.
 */
export const WORLD_RENDER_ORDER = -1;
export const HULL_RENDER_ORDER = 0;
export const TURRET_RENDER_ORDER = 1;
/**
 * The textured quads of the overlay tier. TWO consumers, not one, despite
 * the name: `NumeralBatch` (the control-group badge's numeral, Phase C) and
 * `ChevronBatch` (the veterancy chevron, spec 2026-09-10 §4.7). Both are
 * textured quads that must sit ABOVE the vertex-coloured overlay tier, where
 * the badge's own disc is drawn -- see the table's 4.5 row.
 *
 * It was 1.5 until WP-P4 (PA-18), which put the numeral under its own disc:
 * the badge read as a blank lime blob at every zoom. A half band, between
 * `OVERLAY_RENDER_ORDER` and `SMOKE_RENDER_ORDER`, because the numeral is
 * part of the overlay tier and smoke still paints over the whole of it.
 *
 * The name is the badge's because the badge got here first, and renaming a
 * band every consumer already imports would buy nothing the line above does
 * not already say -- the same call `STRUCTURE_RENDER_ORDER` makes.
 */
export const BADGE_NUMERAL_RENDER_ORDER = 4.5;
export const FX_RENDER_ORDER = 2;
/**
 * `additive`-flagged particles at the BELOW-tier (`depthTest: true`) --
 * forced-opaque hot cores, one band after `FX_RENDER_ORDER` so they draw
 * over their own tier's ordinary dust/smoke rather than risking being
 * overwritten by it. See the table's own 2.5 row for the full account,
 * including why this is not a GPU blend-mode band.
 */
export const FX_RENDER_ORDER_ADDITIVE = 2.5;
export const FX_RENDER_ORDER_ABOVE = 3;
/**
 * `additive`-flagged particles at the ABOVE-tier (`depthTest: false`) --
 * every shipped muzzle-flash core lands here today. See the table's own 3.5
 * row.
 */
export const FX_RENDER_ORDER_ABOVE_ADDITIVE = 3.5;
/**
 * Phase C: `OverlayBatch` (`units/overlays.ts`) -- every overlay this
 * table's own 4-9 row and closing paragraphs describe, EXCEPT the two
 * textured quads, the badge numeral and the veterancy chevron
 * (`BADGE_NUMERAL_RENDER_ORDER`, half a band above this one). One band for the whole tier,
 * matching Pixi's own single `unitsG` container.
 */
export const OVERLAY_RENDER_ORDER = 4;
/**
 * Phase D readiness fix: `SmokeMesh` (`../smoke-mesh.ts`) -- see the table's
 * own 5 row for the full reasoning. One band above `OVERLAY_RENDER_ORDER`
 * (not sharing it) so smoke reliably paints over the rest of the overlay
 * tier the way Pixi's own later-in-the-same-`unitsG`-pass draw order does,
 * without depending on `Object3D.id` construction-order tiebreaking.
 */
export const SMOKE_RENDER_ORDER = 5;
/**
 * Polish VR-22: the collapse flash, the one burst that must read THROUGH the
 * collapse shroud at band 5 -- see the table's own 5.5 row.
 */
export const COLLAPSE_FLASH_RENDER_ORDER = 5.5;
/**
 * The occlusion silhouette (`units/silhouette.ts`) -- see the table's own
 * band-6 row for what draws here and this file's closing "Update, the
 * silhouette band" paragraph for why it sits ABOVE `OVERLAY_RENDER_ORDER`
 * and `SMOKE_RENDER_ORDER`. (It also sat below the fog band, which is
 * retired -- fog no longer competes with any object.)
 */
export const SILHOUETTE_RENDER_ORDER = 6;
/* Bands 7 and up (undeclared on purpose): still-reserved headroom above
 * `SILHOUETTE_RENDER_ORDER` -- see the table's own 7-9 row for why the gap
 * is deliberate rather than a typo. Band 10 -- the fog band until
 * 2026-09-14 -- is now free too: fog is a post pass (`../fog-pass.ts`) and
 * draws nothing in this scene. Its constant is DELETED rather than kept at
 * its old value, because an exported band nothing sets is exactly the
 * "reserving unconsumed CONSTANTS recreates the hazard" trap the table's
 * own 7-9 row warns about -- and because every `toBeLessThan` test it
 * anchored was asserting a relation that no longer exists. */
/**
 * Task B4.4: the band a falling building's collapse `Mesh` draws in -- the
 * same value as `HULL_RENDER_ORDER` (band 0), aliased and exported under
 * its own name rather than left as a bare `0` at the one call site that
 * needs it (`ThreeRenderer.beginCollapse`).
 *
 * Why it needs a name at all, when `StructureInstancer` (idle/wreck
 * billboards) draws at the same band by doing nothing -- leaving
 * `renderOrder` at three.js's own default: `StructureInstancer`'s
 * billboards are an `InstancedMesh` tied to its own untransformed local
 * origin, exactly the shape this file's own top comment explains makes
 * `renderOrder` (not `z`) the deciding factor. A falling building's
 * collapse `Mesh` is not that shape -- it is a real, individually-
 * positioned `Mesh` (`beginCollapse` gives it the building's own world
 * transform) -- so leaving its `renderOrder` unset would be relying on the
 * same numeric default by coincidence rather than by name, with nothing to
 * catch a future edit that changed `HULL_RENDER_ORDER` and left this one
 * behind.
 *
 * Why band 0 specifically, and not band 3: real `depthTest`/`depthWrite`
 * handle a collapse's occlusion against terrain and units correctly
 * regardless of which of bands 0-3 it draws in -- none of those four are
 * `depthTest: false`. The band used to buy a second property as well,
 * staying below the fog band so `FogMesh`'s unconditional overpaint
 * could hide a collapse standing in fog; that is retired with the band
 * (this file's own band-10 row), since the post pass dims a collapse by the
 * same depth-reported world position as the ground it stands on, whatever
 * band it draws in.
 */
export const STRUCTURE_RENDER_ORDER = HULL_RENDER_ORDER;

/**
 * Phase C: the tunnel-trail mesh's own band (`trail-mesh.ts`'s `TrailMesh`)
 * -- the same value as `HULL_RENDER_ORDER` (band 0), aliased and exported
 * under its own name for the identical reason `STRUCTURE_RENDER_ORDER` is
 * (see that constant's own doc comment for the full argument: relying on
 * the bare numeric default by coincidence leaves nothing to catch a future
 * edit that moves `HULL_RENDER_ORDER` and strands this one behind it).
 *
 * Why band 0 specifically, and not band 2 (`FX_RENDER_ORDER`, where the
 * below-tier particle mesh's own materially-similar recipe -- `depthTest:
 * true`, `depthWrite: false` -- otherwise lives): this file's own closing
 * paragraphs, "One more trap worth naming", settle it explicitly for
 * trails by name -- "if a Phase C trail port needs a band at all, it
 * belongs at or below `HULL_RENDER_ORDER` -- never band 1" (band 1 is
 * `TURRET_RENDER_ORDER`, which sits ABOVE every hull; a trail must never
 * out-rank the ground it paints). Real `depthTest`/`depthWrite` arbitration
 * against terrain and units settles genuine occlusion regardless of which
 * of bands 0-9 this sits in (none of them are `depthTest: false`) -- the
 * band only has to avoid TURRET, and `HULL_RENDER_ORDER` is the value this
 * file's own text already named.
 */
export const TRAIL_RENDER_ORDER = HULL_RENDER_ORDER;

/**
 * Task 10 (`docs/superpowers/plans/2026-09-25-ground-plan-1.md`): the shared
 * decal pool's PERSISTENT mesh (crater/scorch/oil/rubble) -- an alias of
 * `WORLD_RENDER_ORDER`, under everything that moves: a decal is world
 * geometry, the same tier a mesh building's opaque hull occupies, not an FX
 * band, and setting it explicitly by name is what stops a later "fix" from
 * moving it into a tier where it would paint over a unit standing on the
 * ground it marks.
 */
export const DECAL_PERSISTENT_RENDER_ORDER = WORLD_RENDER_ORDER;

/**
 * Task 10: the shared decal pool's FADING mesh (tread/tyre) -- an alias of
 * `TRAIL_RENDER_ORDER`, the same band `trail-mesh.ts`'s `TrailMesh` draws
 * in. A tread print has to sit over an older, persistent decal (a crater or
 * an oil pool) that shares the same ground, but never over a unit standing
 * on top of it -- the exact ordering `TRAIL_RENDER_ORDER` already
 * guarantees against `HULL_RENDER_ORDER`/`TURRET_RENDER_ORDER` (this file's
 * own "never band 1" argument for that constant applies here without
 * change, since both are real `depthTest`/`depthWrite` ground geometry).
 */
export const DECAL_FADING_RENDER_ORDER = TRAIL_RENDER_ORDER;

/**
 * #470: the objective zone's hatched ground band (`zone-band.ts`) -- an
 * alias of `DECAL_FADING_RENDER_ORDER`, because it IS a fading-decal-shaped
 * thing: flat ground geometry, depth-tested, not depth-writing, MULTIPLIED
 * onto the lit ground. Multiplication commutes, so its order against the
 * tread prints sharing band 0 changes no pixel. Below
 * `SELECTION_RING_RENDER_ORDER`, so a selected unit's ring reads over the
 * band it stands in. It replaced the zone's fill in `OVERLAY_RENDER_ORDER`
 * (band 4, `depthTest: false`), which painted over every roof and hull in
 * the zone -- do not move the band back up into an overlay tier.
 */
export const ZONE_BAND_RENDER_ORDER = DECAL_FADING_RENDER_ORDER;

/**
 * A4 (GH-186, spec 2026-09-28 sec 2.2): `SelectionRingBatch`
 * (`selection-ring.ts`), the selection ring drawn ON the ground rather than
 * as a screen-space billboard. Depth-tested and not depth-writing, like the
 * decals it sits among, so the band only orders it within the transparent
 * pass: after `DECAL_FADING_RENDER_ORDER` (0), so a selected tank's ring
 * reads over its own tread prints, and before `TURRET_RENDER_ORDER` (1) and
 * every FX band, so the unit standing in it depth-occludes the ring's inside
 * -- the "under the feet" read. Not an integer for the badge numeral's
 * reason: every integer in that neighbourhood is already claimed.
 */
export const SELECTION_RING_RENDER_ORDER = 0.5;

/**
 * GH-471: the tunnel x-ray's three draws -- see the table's 0.25 row. The bore
 * (with its shafts) and the collars share the first; the figures inside draw
 * after it so they read over the bore's floor; the discovery beam last, over
 * both. All three stay below `SELECTION_RING_RENDER_ORDER`.
 */
export const TUNNEL_XRAY_RENDER_ORDER = 0.25;
export const TUNNEL_XRAY_FIGURE_RENDER_ORDER = 0.3;
export const TUNNEL_XRAY_BEAM_RENDER_ORDER = 0.35;
