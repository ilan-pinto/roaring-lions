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
 * | 0    | `HULL_RENDER_ORDER`      | every `UnitInstancer` hull mesh -- three.js's own default, never set explicitly. `StructureInstancer` (idle/wreck billboards) ties here too, left at the same unset default -- real depth-tested world geometry, occluding units and buildings against each other purely through the actual depth buffer, exactly like Pixi's own `spriteLayer` depth-sorts buildings and units together by `zIndex` rather than giving buildings a separate paint pass. `STRUCTURE_RENDER_ORDER` (Task B4.4) is this same value, named and exported explicitly for the one caller that needs to SET it rather than merely rely on the default: a falling building's one-off collapse `Mesh` (`ThreeRenderer.beginCollapse`) is not an `InstancedMesh` tied to its own untransformed local origin the way `StructureInstancer`'s is (see this table's own top comment on why that tie is what makes `renderOrder` the deciding factor for instanced meshes) -- it is a real, individually-positioned `Mesh`, so leaving its `renderOrder` unset would be relying on the same numeric default by coincidence rather than by name. Below `FOG_RENDER_ORDER` is what matters for it: real `depthTest`/`depthWrite` handle occlusion against terrain and units correctly regardless of the exact value chosen among 0-3, and being here (rather than band 3) is what lets `FogMesh`'s own unconditional overpaint (band 4, `depthTest: false`) hide a collapse standing in fog rather than the collapse poking through it -- the identical mechanism that already hides a `tunnel_collapse` dust burst in fog (this table's own band-4 row). |
 * | 1    | `TURRET_RENDER_ORDER`    | every `UnitInstancer` turret mesh -- must outrank its own hull at a co-located, identical-depth instance (`instances.ts`'s own "why this needs to be explicit" comment) |
 * | 2    | `FX_RENDER_ORDER`        | `TracerBatch` and the BELOW-tier `ParticleInstancer` (Pixi's `fxG`) -- still depth-tested against terrain/buildings/units, so must outrank every unit mesh, hull AND turret, now that FX's own materials are `depthWrite: false` (`fx.ts`'s "FX-vs-UNIT ordering is a DIFFERENT question") |
 * | 3    | `FX_RENDER_ORDER_ABOVE`  | the ABOVE-tier `ParticleInstancer` (`above_units`-tagged emitters, Pixi's `fxAboveG`) -- `depthTest: false`, unconditionally on top |
 * | 4    | `FOG_RENDER_ORDER`       | `FogMesh` (`../fog-mesh.ts`) -- Pixi's `fogG`, the LAST child added to `world` (`renderer.ts:551`, its own comment: "above terrain AND units"). `depthTest: false` like band 3, for the identical reason: fog must hide a hostile standing on the tile it covers regardless of how tall that unit's own geometry rises above the flat ground plane a fog quad sits on -- a depth-tested quad coplanar with the ground would lose that comparison to the unit's own raised vertices. One band above every FX tier, not merely above units, because a below-tier particle (e.g. `tunnel_collapse`, genuinely depth-tested against terrain) must not poke through fog covering the ground it is spawned into either -- Pixi's `fxG` sits below `fogG` in container order for the identical reason. |
 *
 * Phase C (selection rings, HP bars, group badges, hover, and a focus ring)
 * will add more bands, all of them UI-adjacent overlays that want to sit
 * above everything already here -- above `FOG_RENDER_ORDER` too, matching
 * Pixi's own `hpBarG`/`selectionG`/etc., every one of them added to `world`
 * AFTER `fogG` (`renderer.ts:551` onward). This module is where they get
 * added: one file, one ascending list, so the next collision is a merge
 * conflict or a failing test in THIS file, not a second silent tie two
 * modules apart. Nothing above band 4 is declared yet -- Phase C has not
 * asked for it, and inventing bands on spec would just be a second place a
 * future author could get the number wrong.
 */
export const HULL_RENDER_ORDER = 0;
export const TURRET_RENDER_ORDER = 1;
export const FX_RENDER_ORDER = 2;
export const FX_RENDER_ORDER_ABOVE = 3;
export const FOG_RENDER_ORDER = 4;
/** Task B4.4: the band a falling building's collapse `Mesh` draws in --
 *  see the table's band-0 row above ("`STRUCTURE_RENDER_ORDER`...") for why
 *  this is an explicit alias of `HULL_RENDER_ORDER` rather than a fresh
 *  number, and why a real, individually-positioned `Mesh` needs it named
 *  and set explicitly where `StructureInstancer` does not. */
export const STRUCTURE_RENDER_ORDER = HULL_RENDER_ORDER;
