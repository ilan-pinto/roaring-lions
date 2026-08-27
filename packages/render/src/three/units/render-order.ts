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
 * | 0    | `HULL_RENDER_ORDER`      | every `UnitInstancer` hull mesh -- three.js's own default, never set explicitly |
 * | 1    | `TURRET_RENDER_ORDER`    | every `UnitInstancer` turret mesh -- must outrank its own hull at a co-located, identical-depth instance (`instances.ts`'s own "why this needs to be explicit" comment) |
 * | 2    | `FX_RENDER_ORDER`        | `TracerBatch` and the BELOW-tier `ParticleInstancer` (Pixi's `fxG`) -- still depth-tested against terrain/buildings/units, so must outrank every unit mesh, hull AND turret, now that FX's own materials are `depthWrite: false` (`fx.ts`'s "FX-vs-UNIT ordering is a DIFFERENT question") |
 * | 3    | `FX_RENDER_ORDER_ABOVE`  | the ABOVE-tier `ParticleInstancer` (`above_units`-tagged emitters, Pixi's `fxAboveG`) -- `depthTest: false`, unconditionally on top |
 *
 * Phase C (selection rings, HP bars, group badges, hover, and a focus ring)
 * will add more bands, all of them UI-adjacent overlays that want to sit
 * above everything already here. This module is where they get added: one
 * file, one ascending list, so the next collision is a merge conflict or a
 * failing test in THIS file, not a second silent tie two modules apart.
 * Nothing above band 3 is declared yet -- Phase C has not asked for it, and
 * inventing bands on spec would just be a second place a future author could
 * get the number wrong.
 */
export const HULL_RENDER_ORDER = 0;
export const TURRET_RENDER_ORDER = 1;
export const FX_RENDER_ORDER = 2;
export const FX_RENDER_ORDER_ABOVE = 3;
