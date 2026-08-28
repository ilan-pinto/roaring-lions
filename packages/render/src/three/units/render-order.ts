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
 * | 0    | `HULL_RENDER_ORDER`      | every `UnitInstancer` hull mesh -- three.js's own default, never set explicitly. `StructureInstancer` (idle/wreck billboards) ties here too, left at the same unset default -- real depth-tested world geometry, occluding units and buildings against each other purely through the actual depth buffer, exactly like Pixi's own `spriteLayer` depth-sorts buildings and units together by `zIndex` rather than giving buildings a separate paint pass. `STRUCTURE_RENDER_ORDER` (Task B4.4) is this same value, aliased and exported explicitly for the one caller that needs to SET it rather than merely rely on the default -- see that constant's own doc comment below for why. |
 * | 1    | `TURRET_RENDER_ORDER`    | every `UnitInstancer` turret mesh -- must outrank its own hull at a co-located, identical-depth instance (`instances.ts`'s own "why this needs to be explicit" comment) |
 * | 1.5  | `BADGE_NUMERAL_RENDER_ORDER` | Phase C: the control-group badge's NUMERAL only -- see this file's closing paragraphs for why it cannot share `OVERLAY_RENDER_ORDER` (band 4) with the rest of the overlay tier, including its own ring. Deliberately a non-integer: it has to sit strictly between `TURRET_RENDER_ORDER` and `FX_RENDER_ORDER`, and nothing was free there before Phase C claimed it. |
 * | 2    | `FX_RENDER_ORDER`        | `TracerBatch` and the BELOW-tier `ParticleInstancer` (Pixi's `fxG`) -- still depth-tested against terrain/buildings/units, so must outrank every unit mesh, hull AND turret, now that FX's own materials are `depthWrite: false` (`fx.ts`'s "FX-vs-UNIT ordering is a DIFFERENT question") |
 * | 3    | `FX_RENDER_ORDER_ABOVE`  | the ABOVE-tier `ParticleInstancer` (`above_units`-tagged emitters, Pixi's `fxAboveG`) -- `depthTest: false`, unconditionally on top |
 * | 4    | `OVERLAY_RENDER_ORDER`   | Phase C: `OverlayBatch` (`units/overlays.ts`) -- selection rings, HP bars, suppression bars, the control-group badge's RING (not its numeral, see band 1.5 above), order markers, the tutorial focus ring, and the garrison hover highlight. One shared band for the whole tier, matching Pixi's own single `unitsG` exactly (this file's closing paragraphs explain why Pixi has only the one container despite drawing all of this). |
 * | 5    | `SMOKE_RENDER_ORDER`     | Phase D readiness fix: `SmokeMesh` (`../smoke-mesh.ts`) -- one translucent quad per smoked tile. Pixi's own smoke loop draws into the SAME `unitsG` every band-4 overlay does (`renderer.ts`'s smoke block runs later in the identical per-frame method, after the order-marker/tutorial-focus passes, still before `fogG`), so on screen it paints OVER the overlay tier, not merely alongside it -- a dedicated band one above `OVERLAY_RENDER_ORDER`, rather than folding smoke into `OverlayBatch` itself, reproduces that draw-order relationship without depending on which of two independently-constructed meshes happens to get a lower `Object3D.id` (this file's own top comment: id is the tiebreak of last resort, and relying on construction order to encode a real ordering requirement is the exact hazard the badge-numeral/turret history above already paid for once). `depthTest: false`, matching fog and the overlay tier -- Pixi's comment ("drawn over the ground and under the units so troops inside one still read") is about ALPHA legibility (smoke tops out at 0.72), not depth occlusion; Pixi's own container order paints it over units regardless, translucently. |
 * | 6-9  | *(reserved, no constant)* | Still headroom, now that Phase C claimed band 4 and this fix round claimed band 5 -- kept reserved rather than renumbering `FOG_RENDER_ORDER` down, on the same "reserving the NUMBERS costs nothing, reserving unconsumed CONSTANTS recreates the hazard" reasoning this table's top comment already gives. |
 * | 10   | `FOG_RENDER_ORDER`       | `FogMesh` (`../fog-mesh.ts`) -- Pixi's `fogG`, the LAST child added to `world` (`renderer.ts:551`, its own comment: "above terrain AND units"). `depthTest: false` like band 3, for the identical reason: fog must hide a hostile standing on the tile it covers regardless of how tall that unit's own geometry rises above the flat ground plane a fog quad sits on -- a depth-tested quad coplanar with the ground would lose that comparison to the unit's own raised vertices. Above every FX tier, not merely above units, because a below-tier particle (e.g. `tunnel_collapse`, genuinely depth-tested against terrain) must not poke through fog covering the ground it is spawned into either -- Pixi's `fxG` sits below `fogG` in container order for the identical reason. Numbered 10, not 4 (its value before this fix round) -- see the 4-9 row above and this file's closing paragraph: Pixi draws its overlays BELOW fog, not above it, so fog had to move up to leave room for that tier underneath it rather than the tier being squeezed in below band 3. |
 *
 * Phase C (selection rings, HP bars, group badges, hover, and a focus ring)
 * adds two bands, both UI-adjacent overlays -- but they belong
 * BELOW `FOG_RENDER_ORDER`, not above it. An earlier version of this
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
 * C's `NumeralBatch` (`units/overlays.ts`) does not share one here either --
 * see `BADGE_NUMERAL_RENDER_ORDER`'s own row above.
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
 * Bands 4-9 -- above every FX tier, below `FOG_RENDER_ORDER` (moved from 4
 * to 10 in an earlier fix round to open the room) -- were reserved for this
 * tier, and Phase C took the "one shared overlay band" option the paragraph
 * above always allowed: `OVERLAY_RENDER_ORDER` (band 4) is one `unitsG`-
 * shaped bucket, matching Pixi exactly, for every overlay this table names
 * except the badge numeral (its own band, 1.5, above). Bands 5-9 stay
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
 */
export const HULL_RENDER_ORDER = 0;
export const TURRET_RENDER_ORDER = 1;
/**
 * Phase C: the control-group badge's NUMERAL alone -- see the table's own
 * 1.5 row and the closing paragraphs' "one exception... a control-group
 * badge is SPLIT across two containers" section for why this cannot be
 * `OVERLAY_RENDER_ORDER`. Deliberately not an integer: it has to sit
 * strictly between `TURRET_RENDER_ORDER` and `FX_RENDER_ORDER`, and every
 * integer in that neighbourhood was already claimed before Phase C needed
 * this one.
 */
export const BADGE_NUMERAL_RENDER_ORDER = 1.5;
export const FX_RENDER_ORDER = 2;
export const FX_RENDER_ORDER_ABOVE = 3;
/**
 * Phase C: `OverlayBatch` (`units/overlays.ts`) -- every overlay this
 * table's own 4-9 row and closing paragraphs describe, EXCEPT the badge
 * numeral (`BADGE_NUMERAL_RENDER_ORDER` above). One band for the whole
 * tier, matching Pixi's own single `unitsG` container.
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
/** Bands 6-9 (undeclared on purpose): still-reserved headroom above
 *  `SMOKE_RENDER_ORDER` -- see the table's own 6-9 row and this file's
 *  closing paragraphs for why the gap remains deliberate rather than a
 *  typo, now that Phase C claimed band 4 and this fix round claimed band 5. */
export const FOG_RENDER_ORDER = 10;
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
 * Why band 0 specifically, and not band 3 (still below fog either way):
 * real `depthTest`/`depthWrite` handle a collapse's occlusion against
 * terrain and units correctly regardless of which of bands 0-3 it draws
 * in -- none of those four are `depthTest: false`. What band 0 buys is the
 * OTHER property: staying below `FOG_RENDER_ORDER` (band 10) at all, which
 * is what lets `FogMesh`'s own unconditional overpaint (`depthTest: false`)
 * hide a collapse standing in fog rather than the collapse poking through
 * it -- the identical mechanism that already hides a `tunnel_collapse` dust
 * burst in fog (this file's own band-10 row, above).
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
