/**
 * Task B3.13: combat feedback on screen. `vfx/particles.ts`'s `ParticleSystem`
 * (Task B3.12) is already backend-agnostic -- `spawn`/`step`/`forEachLive` are
 * pure struct-of-arrays maths, and `forEachLive` is a read path that names no
 * graphics library at all. `./tracers.ts` (also B3.12) is the same pure port
 * of Pixi's tracer model. Neither is reimplemented here: this module is the
 * three.js *draw*, built the same way `units/instances.ts` is -- pure
 * geometry/attribute arithmetic first (testable in `environment: 'node'`),
 * `THREE.*` GPU construction after the divider below.
 *
 * ## What `FX_LAYER_BELOW`/`FX_LAYER_ABOVE` mean here, and how that changed
 *
 * (This section's title is B3.13's own, kept for history; B3.13's answer was
 * "the distinction dissolves into one mesh" -- B3.14 revises that, see "The
 * `above_units` split (B3.14)" further down for the current answer: it is
 * back, expressed as which of TWO `ParticleInstancer`s a particle's
 * `layerIdx` routes it to, rather than which Pixi `Graphics` it drew on.)
 *
 * Pixi's `fxG` (below `spriteLayer`) and `fxAboveG` (above it) exist because
 * Pixi has no depth buffer -- draw order IS depth there, so "does this effect
 * sit in front of or behind units" has to be decided by which Graphics a
 * particle lands on, once, at spawn time, and held for its whole life
 * regardless of where either the particle or the units around it move to.
 *
 * three.js has no such question to answer FOR OCCLUSION AGAINST TERRAIN --
 * a particle carries a real world position (`writeParticleInstances` below
 * writes it at the particle's own `(x, y)` tile-space coordinates, height
 * included), and the tracer material plus the BELOW-tier particle material
 * (see "The `above_units` split (B3.14)" further down -- Task B3.14 gives
 * `above_units` particles their OWN, `depthTest: false` mesh, so this
 * paragraph's claim is scoped to everything else) keep `depthTest: true`
 * against the terrain/building meshes, which are OPAQUE (`MeshBasicMaterial`,
 * `terrain/mesh.ts`) and so commit real depth in three.js's opaque pass
 * regardless of anything FX does. So "does this effect sit behind a ridge or
 * a building" is answered per pixel, by genuine proximity, for every
 * below-tier FX fragment and every tracer -- see the next section for the
 * browser-verified proof. `above_units` particles deliberately do NOT get
 * this treatment; see the dedicated section below for why that is a faithful
 * match to Pixi, not an oversight.
 *
 * FX-vs-UNIT ordering is a DIFFERENT question, deliberately answered
 * differently, and this is a REVISION from this task's first round: both
 * particle and tracer materials below are `depthWrite: false`, not `true`.
 * Units keep `depthWrite: true` (`instances.ts`'s own recipe is correct for
 * units -- near-binary-alpha sprite texels, where writing depth costs
 * nothing and buys real occlusion). Particles are NOT near-binary alpha --
 * `alpha_over_life` fades 1.0 -> 0.0 by design, and `catastrophic_kill.json`
 * spawns 18-26 overlapping discs meant to read as one dense burst. With
 * `depthWrite: true`, two overlapping translucent particles at nearly the
 * same depth do not blend -- whichever's fragment reaches a pixel first
 * commits depth, and the other is flatly depth-rejected rather than
 * composited, so the burst reads as a handful of separate blobs instead of
 * one dense one. `depthWrite: false` lets every live particle blend against
 * whatever is already in the colour buffer (including other particles,
 * including units), while `depthTest: true` keeps the terrain/building
 * occlusion above intact -- that guarantee comes from terrain's own
 * `depthWrite`, not FX's.
 *
 * Without FX writing depth, FX-vs-UNIT ordering needs a different mechanism
 * than "let the depth buffer sort it out" -- every FX mesh here
 * (`TracerBatch.mesh`, and both `ParticleInstancer` meshes -- see "The
 * `above_units` split (B3.14)" below for why there are now two) sets
 * `renderOrder` strictly above every `UnitInstancer.mesh` -- hull's default
 * (0) AND turret's own explicit, non-default value (Task B3.6,
 * `instances.ts`'s `TURRET_RENDER_ORDER`) alike. (Bugfix note: this
 * parenthetical used to read "0, never set explicitly" -- true when B3.13
 * wrote it, false from the moment B3.6's turret task gave `UnitInstancer` a
 * SECOND, non-default `renderOrder`, and nothing caught the drift because
 * `FX_RENDER_ORDER` was not exported and no test could compare the two
 * modules' constants. `TURRET_RENDER_ORDER` and this file's own
 * `FX_RENDER_ORDER` were both `1` as a result -- see `./render-order`'s doc
 * comment, now the single source of truth both files import from, for the
 * full account and the fix.) three.js sorts its transparent render list by
 * `renderOrder` ascending BEFORE it ever reaches a `z`/`id` tiebreak, which
 * settles FX-vs-FX blend order deterministically (no more "whichever mesh's
 * constructor happened to run first", the accident the next subsection
 * documents) and, for the depthTest-off `above_units` tier specifically,
 * ALSO guarantees it is never hidden behind a unit -- but for anything that
 * keeps `depthTest: true` (tracers, and the below-tier particle mesh),
 * `renderOrder` alone decides only ordering among ties; genuine occlusion by
 * an already-drawn, depth-writing unit still applies regardless of
 * `renderOrder`, exactly the same as it does against terrain. This IS a
 * DECLARED behaviour choice for the `above_units` tier specifically, not a
 * rediscovery of "true depth" -- Pixi's tracers lived on `fxG`, below
 * `spriteLayer` (so below units too); this backend's tracer mesh (and the
 * below-tier particle mesh) stay in that same relative position, and only
 * the NEW `above_units` particle mesh is pulled unconditionally in front,
 * matching Pixi's own `fxAboveG` (drawn after `spriteLayer`, so above
 * BOTH terrain/buildings and unit sprites, unconditionally -- see the
 * `above_units` section for the container-order proof). The two-layer SPLIT
 * Pixi had does NOT dissolve after all; B3.14 reinstates it, on the
 * `depthTest` axis rather than Pixi's container-order one -- see that
 * section for the full account of why round 1 merged it and round 2 split
 * it back apart, and what each choice costs.
 *
 * ### Without an explicit `renderOrder`, ordering against units is an ACCIDENT, not a design
 *
 * The first round of this task shipped with no `renderOrder` at all, relying
 * on three.js's own transparent-list sort. That sort is `WebGLRenderLists`'
 * `painterSortStable`: compare `renderOrder` (tied, both default 0), then
 * `z` -- each object's OWN `matrixWorld` position transformed to view space,
 * NOT per-vertex or per-instance data -- then `id` ascending as the final
 * tiebreak. Every mesh here (`ParticleInstancer.mesh`, `TracerBatch.mesh`,
 * every `UnitInstancer.mesh`) sits at its own untransformed local origin
 * `(0, 0, 0)`; only the vertex/instance buffers carry real position. So `z`
 * ties for EVERY pair of these meshes, every frame, and the sort falls
 * through to `id` -- the order three.js's internal counter assigned each
 * mesh when it was constructed. `ParticleInstancer`/`TracerBatch` are built
 * in `ThreeRenderer`'s constructor; `UnitInstancer`s are built later, inside
 * the async `loadSprites`. Lower id sorts first, so FX drew BEFORE units --
 * true in the browser, verified, but true because of WHEN two unrelated
 * constructors happened to run, not because either drawn frame stood in
 * front of the other. `FX_RENDER_ORDER` replaces that accident with the
 * declared choice above.
 *
 * ## The `trailG`/`fxG`/`wreckLayer`-below-`spriteLayer` debt does not exist here (tracers, below-tier particles)
 *
 * CLAUDE.md's "Known scaling debts" records that Pixi's `fxG` (tracers,
 * particles) sits below `spriteLayer` (raised terrain, buildings)
 * UNCONDITIONALLY -- a tracer genuinely in front of a ridge is still drawn
 * behind it, because "in front of" is never asked; the Graphics container
 * order already decided the answer before either object's position mattered.
 * That is precisely the class of bug a real depth buffer cannot have: the
 * tracer mesh and the BELOW-tier particle mesh are placed at real world
 * positions (see `tracerQuadPositions`, `writeParticleInstances`) and keep
 * `depthTest: true` against the SAME opaque, depth-writing terrain/building
 * geometry units resolve their own tie against (`instances.ts`'s
 * "unit-vs-tree tie" section) -- `depthWrite` on FX's own materials plays no
 * part in this particular guarantee, only `depthTest` does. A tracer nearer
 * the camera than a ridge's own near face draws over it; one farther is
 * correctly hidden. Browser-verified directly (B3.13 report): a tracer run
 * from behind a building to in front of it is cleanly, fully hidden for its
 * occluded span in this backend, where the identical spawn against Pixi
 * bleeds through wherever the building sprite's own art happens to be
 * transparent. Neither the debt nor a version of it was introduced writing
 * this file -- there is no unconditional container order left to
 * reintroduce it into, for tracers or for `below_units` particles.
 *
 * This guarantee is DELIBERATELY NOT extended to the `above_units` particle
 * tier (`depthTest: false`, added in B3.14) -- see "The `above_units` split"
 * below for why matching Pixi's own `fxAboveG` (which is subject to the
 * identical debt in the opposite direction: it draws unconditionally over
 * terrain too, since it sits after `spriteLayer` in Pixi's own container
 * order) is the correct target to match here, not an accidental regression.
 *
 * ## Elevation lift, round 1 (B3.13): deliberately NOT applied to particles or tracers
 *
 * The account below is B3.13's own reasoning for shipping with NO ground-lift
 * fix at all, kept verbatim because the finding it records (particles are
 * physically buried, not merely misplaced) is what B3.14's fix, in the
 * sections below, actually responds to -- for BOTH particles ("round 2") and
 * tracers ("round 3"), the latter added after this task's own first pass
 * shipped tracers still flat and a post-commit review found the same bug in
 * them (see "Elevation lift, round 3" further down for why that finding
 * landed, and why the "flat lift was fine for tracers" claim below does not
 * hold up).
 *
 * Pixi's own particle/tracer/puff draw calls (`particles.ts`'s `draw`,
 * `renderer.ts`'s tracer and puff loops) never call `groundOffset` --
 * unlike every unit, mark and structure sprite, VFX in the shipping game
 * ignores elevation entirely and draws at a small FIXED screen-pixel lift
 * above flat ground (-3px for particles/puffs, -4px for tracers). CLAUDE.md's
 * own "Known scaling debts" names this directly: "VFX are not lifted to
 * terrain height" is one of the three gaps the E1-E3 elevation milestone
 * left inert on purpose, dormant only because no shipped map had authored
 * relief yet. This module reproduces that same flat lift (`PARTICLE_LIFT_PX`,
 * `TRACER_LIFT_PX`, run through `WORLD_Y_PER_LIFT_PIXEL` the same way every
 * other screen-pixel nudge in this backend is) rather than reaching for
 * `groundWorldY` -- fixing an acknowledged, tracked, out-of-scope gap here
 * would be a silent behaviour change relative to Pixi on the one map
 * (Tel Marum) where it would actually show, and "particles must appear where
 * Pixi's do" is this task's own browser-check bar.
 *
 * That gap turns out to be MORE visible here than the CLAUDE.md bullet
 * implies, and the B3.13 browser check found the concrete shape of it: since
 * every OTHER piece of terrain/unit geometry in this backend IS real depth,
 * a particle whose fixed lift sits below the actual ground it is drawn over
 * does not merely draw "at the wrong height" the way it would in Pixi's flat
 * 2D -- it is genuinely, physically buried by the opaque ground/terrace
 * geometry above it and does not render at all. Confirmed two ways in the
 * browser: (1) on flat ground (elevation 0, matching `PARTICLE_LIFT_PX`'s own
 * assumption), a particle whose own radius exceeds the ~3px lift still
 * partially sinks into the ground plane and shows a flat-bottomed silhouette
 * -- expected for a large burst (a 120mm hit, `catastrophic_kill.json`'s
 * `size_px` up to 52), invisible for the small-arms scale (`size_px` 2-3)
 * this system spends most of its particles on; (2) on Tel Marum, EVERY tile
 * this map authors is elevation >= 1, and one elevation level
 * (`WORLD_PER_LEVEL`, ~0.255 world units) already dwarfs the 3px lift
 * (~0.077 world units) by more than 3x -- so a particle spawned anywhere on
 * that map's own ground is buried under its own local terrace regardless of
 * any ridge, ranging from partial to total depending on the tile. Neither
 * finding changes the ruling above -- the fix is still `groundWorldY`, still
 * out of scope, still Tel Marum's alone to need -- but "dormant" undersells
 * it: the moment relief exists, particles on it do not degrade, they
 * disappear.
 *
 * ## Elevation lift, round 2 (B3.14): particles follow the ground
 *
 * B3.14's own orchestrator review sharpened the finding above in two ways,
 * both measured rather than argued:
 *
 *  1. It is not confined to relief. On FLAT ground the particle quad is
 *     CENTRED on the fixed 3px lift (`particleBillboardGeometry`'s local `up`
 *     spans -1..1), so any particle whose radius exceeds `PARTICLE_LIFT_PX`
 *     loses its lower half into the ground plane. `catastrophic_kill.json`
 *     (`size_px` 10-22, `size_over_life` up to x1.6) loses most of itself on
 *     EVERY shipped map, not only Tel Marum -- this was reachable
 *     immediately, not "when a map authors relief."
 *  2. `groundWorldY` is necessary but not sufficient. It answers the
 *     ELEVATION half (which terrace a particle's tile stands on), but a
 *     particle centred on `groundWorldY + PARTICLE_LIFT_PX` still clips into
 *     that same flat ground the instant its own radius exceeds the lift --
 *     `groundWorldY` alone does not touch the round-1 flat-ground finding at
 *     all.
 *
 * `writeParticleInstances` below now writes each live particle's own world
 * Y as `groundWorldY(elevation, mapWidth, mapHeight, x, y) + max(PARTICLE_LIFT_PX,
 * radius) * WORLD_Y_PER_LIFT_PIXEL` -- two decisions, both made deliberately
 * rather than picked by default:
 *
 *  - **Sampled per frame, at the particle's OWN current (x, y), not once at
 *    spawn.** A particle moves during its life (`ParticleSystem.step`
 *    integrates velocity and gravity) -- sampling at spawn would keep it on
 *    the terrace plane it was born on as it crosses a terrace edge, which
 *    reads as the particle floating off a cliff it should be tracking down
 *    (or through a rise it should be tracking up). Sampling per frame instead
 *    makes it visibly STEP as it crosses a terrace, exactly the same
 *    trade-off B2's own terraced ground and `entityFrame`'s own `groundWorldY`
 *    call already accepted for UNITS (`ground-height.ts`'s own doc comment:
 *    "a unit crossing a terrace steps up rather than ramping"). At particle
 *    lifetimes of 60-620ms this pop is not perceptible in practice, and
 *    `ParticleSystem` already treats a particle as flat 2-D motion (`x`, `y`
 *    only, no world-height state of its own) -- there is no smooth height
 *    trajectory being interrupted, because none was ever being tracked.
 *  - **`max(PARTICLE_LIFT_PX, radius)`, not a re-anchored quad.** The other
 *    option the orchestrator review posed was anchoring
 *    `particleBillboardGeometry`'s quad at its bottom edge (local `up` 0..2)
 *    rather than centring it (-1..1), mirroring `unitBillboardGeometry`'s own
 *    feet anchor. Rejected: the circle-cutout fragment shader
 *    (`createParticleMaterial`'s `dot(vLocal, vLocal) > 1.0`) assumes `vLocal`
 *    is the offset from the particle's own CENTRE, and a re-anchored quad
 *    would need that shader to also carry a per-vertex centre-offset to keep
 *    drawing a circle rather than a lopsided sliver -- a real change to
 *    shared, GPU-facing geometry (`fx.ts` is under review; this task was
 *    asked to keep changes here minimal). The chosen formula needs no
 *    geometry change at all, only a different Y written into the SAME
 *    instance-position slot every particle already had: when `radius <=
 *    PARTICLE_LIFT_PX` (the common case -- small-arms muzzle sparks, impact
 *    puffs), the centre sits at `groundWorldY + PARTICLE_LIFT_PX *
 *    WORLD_Y_PER_LIFT_PIXEL` exactly as round 1 already did, comfortably clear
 *    of the ground. When `radius > PARTICLE_LIFT_PX` (a large burst), the
 *    centre rises to `groundWorldY + radius * WORLD_Y_PER_LIFT_PIXEL` -- the
 *    quad's own bottom edge (`centre - radius * WORLD_Y_PER_LIFT_PIXEL`) then
 *    lands EXACTLY on `groundWorldY`, touching the ground plane rather than
 *    crossing it, for every radius, not merely the ones smaller than 3px.
 *
 * ## Elevation lift, round 3 (post-review fix): tracers follow the ground too
 *
 * This task's own first pass left tracers on the flat `TRACER_LIFT_PX` lift,
 * reasoning that giving each of a tracer's two endpoints its own
 * `groundWorldY` sample would "kink" the ribbon and that fixing it was a
 * separate design question. A post-commit review found both halves of that
 * wrong:
 *
 *  - **It is not a misplacement, it is invisibility.** `TRACER_LIFT_PX` (4
 *    lift-px) is smaller than a SINGLE elevation level's own rise
 *    (`ELEV_STEP`, 10 lift-px). So on every raised tile a flat-lifted tracer
 *    sat at least 6px UNDER its own ground -- and `createTracerMaterial`
 *    keeps `depthTest: true`, so a tracer under the ground it is drawn over
 *    does not render at all. That is the exact "buried, not misplaced"
 *    failure round 1 documented for particles above, reproduced here in the
 *    one FX kind round 2 did not reach.
 *  - **A quad cannot kink.** `tracerQuadPositions` returns four vertices for
 *    TWO endpoints (`s0`/`s1` share the shooter's position, `t0`/`t1` share
 *    the target's) -- there is no third, interior vertex along the ribbon's
 *    length for two different end-lifts to disagree across. Lifting each
 *    end by its own `groundWorldY` would TILT the planar quad, which is a
 *    real, harmless geometric operation four-vertex quads support trivially;
 *    it was never going to kink anything.
 *
 * The fix actually shipped sidesteps even the tilt: `liftY` is ONE scalar --
 * `max(groundWorldY(sx, sy), groundWorldY(tx, ty)) + TRACER_LIFT_PX *
 * WORLD_Y_PER_LIFT_PIXEL` -- applied to all four vertices identically, so the
 * ribbon stays exactly as flat and straight as it always was, but never
 * sits under the higher of its own two ends' ground. A tracer whose shooter
 * and target stand at different elevations rides at the higher one's
 * height along its whole length rather than at the lower one's (or a flat
 * average) -- visibly floating a little above the lower end's ground in
 * that specific case, which is a real, acknowledged simplification, not
 * "sits under the ground it's drawn over": a tracer that reads as floating
 * slightly is a cosmetic nit; a tracer that never renders at all is the
 * urgent failure this fix exists for.
 *
 * ## The `above_units` split (B3.14): a second particle draw call, deliberately
 *
 * 11 of the 12 shipped emitters (`data/vfx/*.json`) declare `layer:
 * "above_units"`; only `tunnel_collapse` declares `below_units`. B3.13 merged
 * both into ONE `InstancedMesh` on the argument that the depth buffer
 * resolves front-from-behind per pixel, which is true for particle-vs-terrain
 * occlusion (unchanged, still correct, see the section above this one) but
 * is NOT the same claim as "an above_units effect is never hidden by a unit
 * sprite" -- Pixi's `fxAboveG` draws with NO depth reasoning at all (Pixi has
 * no depth buffer), an absolute guarantee this backend's single merged mesh
 * does not reproduce: `depthTest: true` still rejects a fragment genuinely
 * farther from camera than whatever a unit already committed to the depth
 * buffer at that pixel, and a muzzle flash spawned `shooter + 0.4-0.8 tiles
 * along facing` (`ThreeRenderer.onEvents`, mirroring `renderer.ts:783`)
 * lands exactly there when the barrel points away from camera -- a real,
 * visible regression against Pixi (a flash that flickers out depending on
 * which way the shooter happens to be facing), not a hypothetical.
 *
 * Three shapes were on the table, and the choice is deliberate, not a
 * default:
 *
 *  1. **Leave the single merged mesh alone.** Costs nothing extra, but keeps
 *     the regression above for every one of the 11 `above_units` emitters --
 *     unacceptable given this task exists specifically to make combat FX
 *     read correctly, and the emitter data is unambiguous about intent.
 *  2. **Split into two meshes by layer** (the choice made): one FX draw call
 *     stays exactly as B3.13 left it -- `depthTest: true`, `renderOrder =
 *     FX_RENDER_ORDER` -- for `below_units`/`ground_decal`/`sky`-tagged
 *     particles (today, only `tunnel_collapse`); a SECOND mesh, new in this
 *     task, carries `above_units` particles with `depthTest: false` (an
 *     unconditional pass, matching Pixi's own unconditional `fxAboveG`
 *     guarantee exactly rather than merely approximating it with a higher
 *     `renderOrder` and hoping ties never arise) and a higher `renderOrder`
 *     (`FX_RENDER_ORDER_ABOVE`) so it also wins any blend order contest
 *     against the first FX mesh and against tracers. Cost: one more draw
 *     call (three total for FX instead of two: below-tier particles, tracers
 *     -- both depth-tested against real geometry -- and above-tier
 *     particles, which are not) and one more `PARTICLE_CAPACITY`-sized
 *     `InstancedMesh` (positions/colors/alphas/scale attribute arrays sized
 *     to the full 2048, not half of it -- a live particle's `layerIdx` is
 *     fixed at spawn and the two tiers draw from the SAME underlying
 *     `ParticleSystem` pool, so either tier could in principle hold every
 *     live particle at once, exactly the reasoning `PARTICLE_CAPACITY`
 *     itself already rests on for the single-mesh case). Roughly another
 *     ~40KB of typed-array memory; negligible next to the terrain meshes.
 *  3. **Force `depthTest: false` on the ONE merged mesh instead of adding a
 *     second one.** Free (no extra draw call), and would equally guarantee
 *     `above_units` particles are never hidden -- but it also stops
 *     `tunnel_collapse` particles from being properly occluded by a building
 *     or ridge standing in front of them, which is exactly the terrain-
 *     occlusion win this file's own "The `trailG`/`fxG`/`wreckLayer`..."
 *     section above documents and treats as a real improvement over Pixi's
 *     `fxG`-always-behind-`spriteLayer` bug. Rejected because it would trade
 *     one faithfully-reproduced Pixi guarantee (above_units is never hidden)
 *     for silently breaking a DIFFERENT thing this backend already gets
 *     right that Pixi does not (below_units genuinely occludes against
 *     terrain).
 *
 * Tracers are unaffected by this split -- Pixi's tracers live on `fxG` (the
 * below layer) unconditionally, which is exactly where `TracerBatch` already
 * sits (`depthTest: true`, `renderOrder = FX_RENDER_ORDER`, unchanged by this
 * task). `fxLayerIndex` (in `ThreeRenderer.ts`, mirroring `renderer.ts`'s
 * own private helper of the same name) is what routes a spawned particle --
 * both real emitter particles and this task's own synthetic flat-colour
 * puffs -- to one tier or the other by its declared `layer`.
 */
import * as THREE from 'three';
import type { ParticleSystem } from '../../vfx';
import { WORLD_Y_PER_LIFT_PIXEL, isoX, isoY } from '../../project';
import { screenOffsetToWorld, hexToUnit } from '../terrain/shared';
import { groundWorldY } from '../ground-height';
import { tracerAlpha, type TracerModel } from './tracers';
import {
  FX_RENDER_ORDER,
  FX_RENDER_ORDER_ADDITIVE,
  FX_RENDER_ORDER_ABOVE,
  FX_RENDER_ORDER_ABOVE_ADDITIVE,
} from './render-order';

// ---------------------------------------------------------------------------
// Pure: geometry and per-instance attribute arithmetic. No THREE.* GPU
// objects below this line yet -- mirrors instances.ts's own split, for the
// same reason: `ParticleInstancer`/`TracerBatch` construction needs nothing
// headless cannot provide, but nothing here needs even that much.
// ---------------------------------------------------------------------------

/** Same capacity Pixi's `ParticleSystem` is built with, `renderer.ts:644`.
 *  Sizing the `InstancedMesh` to the identical number means a live particle
 *  can never outrun what this backend can draw -- the two capacities are the
 *  same pool by construction (`ParticleSystem`'s `layerIdx` is not a second,
 *  per-layer capacity; see `particles.ts`'s own doc comment), so this number
 *  is not a separate guess, it is the one true ceiling reused. */
export const PARTICLE_CAPACITY = 2048;

/**
 * Ceiling on simultaneously-live tracers this backend will draw.
 *
 * Unlike particles, Pixi's own `tracers` array is unbounded (nothing evicts
 * a tracer early; only `TRACER_LIFETIME_S` retires one). An `InstancedMesh`/
 * batched `BufferGeometry` needs a fixed capacity, so this picks one:
 * `TRACER_LIFETIME_S` (150 ms) times a deliberately generous fire cadence
 * (5 shots/s per shooter, well above any authored weapon's real rate) times
 * the GDD's 300-unit target gives ~225 concurrent tracers in the worst
 * physically-plausible case -- but Task B3.14 measured a real firefight
 * (`beit_sahwan_2_foothold`, roughly a dozen shooters) at 268-270 CONCURRENT
 * tracers, already past that estimate with a tenth of the unit count. 512
 * looked like >2x headroom over the analytical estimate and was actually
 * under 2x over the measured one; at 300 units it would silently drop most
 * long-flight tracers (overflow evicts oldest first, so the truncation is
 * quiet -- Task B3.11's 300-unit gate would measure a renderer quietly doing
 * less work than a correct one). Raised to 4096 for that gate: comfortably
 * above the measured 270 even after scaling shooters by another order of
 * magnitude, and still cheap -- 4096 * 4 verts = 16384, four times the
 * particle pool's vertex count but still hundreds of KB, not MB, for a
 * `Float32Array` of positions/colors/alphas.
 */
export const TRACER_CAPACITY = 4096;

/** Screen-pixel lift a particle draws at above flat ground, matching
 *  `particles.ts`'s own `draw()`: `isoY(x, y) - 3`. See this file's top
 *  comment, "Elevation lift is deliberately NOT applied". Exported (like
 *  `TRACER_LIFT_PX`/`TRACER_WIDTH_PX` below) so `fx.test.ts` can check the
 *  actual documented relationship between the two lifts rather than
 *  hardcoding a duplicate literal. */
export const PARTICLE_LIFT_PX = 3;
/** Screen-pixel lift ABOVE ITS OWN GROUND a tracer draws at -- matches
 *  `renderer.ts:2599`'s `isoY(t.sx, t.sy) - 4` on flat ground (elevation 0,
 *  where `groundWorldY` contributes nothing). On a raised tile,
 *  `tracerQuadPositions` adds `groundWorldY`'s own height on top of this;
 *  see that function's doc comment ("Elevation lift, round 3") for why a
 *  flat `TRACER_LIFT_PX` alone buried a tracer under any tile at elevation
 *  >= 1 rather than merely misplacing it. */
export const TRACER_LIFT_PX = 4;
/** Tracer ribbon width in screen pixels, matching `renderer.ts:2601`'s
 *  `stroke({ width: 1.5, ... })`. */
export const TRACER_WIDTH_PX = 1.5;

/**
 * `renderOrder` for the tracer mesh and the BELOW-tier particle mesh,
 * strictly above every `UnitInstancer.mesh` -- hull's default (0) AND
 * turret's explicit value alike (see `./render-order`'s own doc comment for
 * the collision this fixed: this constant and `instances.ts`'s
 * `TURRET_RENDER_ORDER` used to both be `1`, tying a tracer or a below-tier
 * particle against a turret at the exact instant it passed in front of one).
 * See this file's top comment ("FX-vs-UNIT ordering is a DIFFERENT
 * question") for the ordering reasoning -- in short, `depthWrite: false` on
 * FX's materials means the depth buffer no longer arbitrates FX-vs-FX blend
 * order (though `depthTest: true` on this tier still arbitrates genuine
 * FX-vs-unit and FX-vs-terrain occlusion), so this is the explicit
 * replacement for what used to be an accident of construction order.
 *
 * `FX_RENDER_ORDER_ABOVE` (the ABOVE-tier particle mesh, `above_units`-tagged
 * emitters) is one higher again, so it also wins any submission-order tie
 * against this tier and against tracers, on top of its own `depthTest:
 * false` already guaranteeing it is never hidden behind a unit -- see "The
 * `above_units` split (B3.14)", this file's top comment, for the full
 * reasoning.
 *
 * `FX_RENDER_ORDER_ADDITIVE`/`FX_RENDER_ORDER_ABOVE_ADDITIVE` are the
 * `hotCore` (`additive: true`) sibling of each tier, one band after its own
 * normal tier for a DIFFERENT reason than the above/below split -- normal
 * blending pinned to alpha 1 is an opaque overwrite, not a commutative sum,
 * so a hot core must draw AFTER its tier's own ordinary dust/smoke or a
 * later-submitted normal particle could paint over it. See
 * `createParticleMaterial`'s own doc comment for why this is not a GPU
 * additive blend mode, and `./render-order`'s 2.5/3.5 rows for the band
 * account.
 *
 * All four are re-exported from `./render-order`, the single source of
 * truth for every band this backend uses -- not declared here, so a future
 * band can never collide with `instances.ts`'s bands without both living
 * in, and being checked against, the same file. Exported (unlike before
 * this fix) so `fx.test.ts`'s cross-module invariant suite can assert the
 * relationship directly, rather than being unable to reach this value at
 * all.
 */
export { FX_RENDER_ORDER, FX_RENDER_ORDER_ADDITIVE, FX_RENDER_ORDER_ABOVE, FX_RENDER_ORDER_ABOVE_ADDITIVE };

/** Plain-array quad geometry for the particle billboard every particle
 *  instance shares, in "per one screen pixel of radius" units -- an
 *  instance's own `radius` (from `ParticleSystem.forEachLive`) scales it via
 *  the instance matrix, so this is built once, not per particle per frame. */
export interface ParticleBillboardGeometry {
  /** xyz triples, three.js world space, per 1px of the eventual instance
   *  radius. Four vertices: bottom-left, bottom-right, top-right, top-left. */
  positions: Float32Array;
  /** Local (-1..1, -1..1) coordinate per vertex, same order as `positions`
   *  -- the circle cutout test in the fragment shader below reads this
   *  directly rather than deriving it from `uv`, since there is no texture
   *  here for a `uv` to address. */
  local: Float32Array;
  indices: Uint32Array;
}

/**
 * The camera-facing quad every particle instance shares, built on the exact
 * two axes `unitBillboardGeometry` (`instances.ts`) uses -- `right =
 * screenOffsetToWorld(1, 0)` for the horizontal axis, `WORLD_Y_PER_LIFT_PIXEL`
 * for the vertical -- because both are already calibrated so that 1 unit
 * along either axis, in this convention, reprojects to 1 equal screen pixel
 * (that calibration is what lets `unitBillboardGeometry` draw a SQUARE sprite
 * frame without distortion; a particle's circle needs the identical
 * property, or it would render as an ellipse). Centred on (0, 0, 0), same as
 * `unitBillboardGeometry`'s own `-half..+half` convention -- a particle's
 * own world position IS its centre, matching Pixi's `g.circle(cx, cy, r)`.
 */
export function particleBillboardGeometry(): ParticleBillboardGeometry {
  const right = screenOffsetToWorld(1, 0);
  const corner = (rightPx: number, upPx: number): [number, number, number] => [
    right.dx * rightPx,
    upPx * WORLD_Y_PER_LIFT_PIXEL,
    right.dy * rightPx,
  ];
  const bl = corner(-1, -1);
  const br = corner(1, -1);
  const tr = corner(1, 1);
  const tl = corner(-1, 1);
  return {
    positions: Float32Array.from([...bl, ...br, ...tr, ...tl]),
    local: Float32Array.from([-1, -1, 1, -1, 1, 1, -1, 1]),
    // Identical corner convention (bl, br, tr, tl) on the identical two axes
    // as unitBillboardGeometry -- the winding this camera needs was already
    // derived and tested there (instances.ts's own top comment, "The
    // unit-vs-tree tie"); centring the quad doesn't change which way it
    // faces, only where its own local origin sits.
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  };
}

/** Per-instance GPU attribute arrays `writeParticleInstances` fills, sized
 *  (by the caller) to `PARTICLE_CAPACITY`. */
export interface ParticleInstanceBuffers {
  /** xyz triples, world space -- the translation each instance's
   *  `instanceMatrix` gets. */
  positions: Float32Array;
  /** rgb triples in 0..1, one per instance. */
  colors: Float32Array;
  /** One alpha per instance. */
  alphas: Float32Array;
  /** World-space uniform scale per instance -- `particleBillboardGeometry`'s
   *  quad is built in "per 1px of radius" units, so this IS the particle's
   *  own screen-pixel radius, applied as `Matrix4.makeScale`. */
  scales: Float32Array;
}

/**
 * `hexToUnit(color)`, memoised. `forEachLive`'s own doc comment (`particles.ts`)
 * says the flat-argument callback shape exists so a three.js caller
 * "inherits no GC-pressure regression `draw()` never had" -- `writeParticleInstances`
 * calling `hexToUnit` fresh per particle per frame would be exactly that
 * regression reintroduced one call up: one destructured tuple plus (inside
 * `hexToUnit`) four `slice`/`parseInt` substring allocations, for EVERY live
 * particle, EVERY frame -- roughly 10k allocations a frame at
 * `PARTICLE_CAPACITY`. `color_over_life` and `tracerColors` both draw from a
 * tiny, effectively fixed palette (a handful of `data/vfx/*.json` hex
 * strings, two team tracer colours), so a module-level cache keyed on the hex
 * string itself is safe -- `hexToUnit` is pure, and every distinct colour
 * this module will ever see gets computed once and reused for the life of
 * the tab, not per `ParticleSystem`/`ThreeRenderer` instance. Callers only
 * ever READ the returned tuple (destructure into scalars, copy into a typed
 * array) -- never mutate it -- so sharing the same array reference across
 * every hit is safe.
 */
const hexToUnitCache = new Map<string, readonly [number, number, number]>();
function cachedHexToUnit(hex: string): readonly [number, number, number] {
  let rgb = hexToUnitCache.get(hex);
  if (!rgb) {
    rgb = hexToUnit(hex);
    hexToUnitCache.set(hex, rgb);
  }
  return rgb;
}

/**
 * Visits every live particle on ONE of `ParticleSystem`'s draw layers
 * (`layerIdx` -- see "The `above_units` split (B3.14)", this file's top
 * comment, for why callers now visit the two layers separately, into two
 * separate instance buffers, rather than merging both into one the way
 * B3.13 did) and writes GPU-facing attributes. Pure aside from the
 * `forEachLive` callback boundary -- no `THREE.*` touched, so this is
 * exercised directly in `fx.test.ts` with a real `ParticleSystem` (itself
 * Pixi-free) rather than needing a `WebGLRenderer`.
 *
 * `elevation`/`mapWidth`/`mapHeight` are `groundWorldY`'s own inputs
 * (`ground-height.ts`), threaded through unchanged so this function needs no
 * `Sim` of its own -- exactly the same boundary `frame-state.ts`'s
 * `entityFrame` already draws for units. See "Elevation lift, round 2
 * (B3.14)" for the `max(PARTICLE_LIFT_PX, radius)` formula's derivation.
 *
 * Returns the number of instances written, which the caller sets
 * `mesh.count` to -- the only "hide an instance" mechanism an
 * `InstancedMesh` has, exactly `writeUnitInstances`'s own contract.
 */
export function writeParticleInstances(
  particles: ParticleSystem,
  layerIdx: number,
  elevation: Uint8Array | null,
  mapWidth: number,
  mapHeight: number,
  out: ParticleInstanceBuffers
): number {
  const capacity = out.alphas.length;
  let count = 0;
  const visit = (x: number, y: number, color: string, alpha: number, radius: number): void => {
    if (count >= capacity) return;
    const [r, g, b] = cachedHexToUnit(color);
    const liftY = groundWorldY(elevation, mapWidth, mapHeight, x, y) + Math.max(PARTICLE_LIFT_PX, radius) * WORLD_Y_PER_LIFT_PIXEL;
    out.positions[count * 3] = x;
    out.positions[count * 3 + 1] = liftY;
    out.positions[count * 3 + 2] = y;
    out.colors[count * 3] = r;
    out.colors[count * 3 + 1] = g;
    out.colors[count * 3 + 2] = b;
    out.alphas[count] = alpha;
    out.scales[count] = radius;
    count++;
  };
  particles.forEachLive(layerIdx, visit);
  return count;
}

/**
 * World-space corners of one tracer's ribbon quad -- a thin rectangle from
 * the shooter's position to the target's, `TRACER_WIDTH_PX` wide in SCREEN
 * pixels regardless of the shot's own bearing.
 *
 * World X/Z here are `t.sx`/`t.sy`/`t.tx`/`t.ty` directly, unprojected --
 * `camera.ts`'s own documented convention, "game tile (x, y) is three.js
 * (x, elevation, y)". `isoX`/`isoY` (`project.ts`) are used ONLY to find the
 * shot's on-SCREEN direction, so the perpendicular offset -- computed in
 * screen space, then converted back to a world delta via
 * `screenOffsetToWorld` -- keeps the ribbon's width constant on screen no
 * matter which way the shot points, the same guarantee `stroke({width:
 * 1.5})` gives Pixi for free from a 2D API this backend does not have.
 *
 * `liftY` FIX (post-B3.14 review): `TRACER_LIFT_PX` (4) is smaller than a
 * SINGLE elevation level's own lift (`ELEV_STEP` is 10 lift-pixels), so a
 * flat `TRACER_LIFT_PX` sat at least 6px under a tracer's own ground on
 * every raised tile -- with `depthTest: true` on the tracer material, that
 * is not a misplaced tracer, it is an INVISIBLE one, the identical failure
 * mode particles had before the B3.14 ground-lift fix, just not caught by
 * that fix because tracers were left out of it on a "would kink the ribbon"
 * argument that does not survive scrutiny: with four vertices for two
 * endpoints, lifting each end by its OWN `groundWorldY` tilts the ribbon (a
 * planar quad can be tilted), it cannot kink it (kinking needs a THIRD
 * vertex along the ribbon's length, which this geometry never had). The fix
 * actually shipped is simpler than either: `liftY` is ONE scalar,
 * `max(groundWorldY(sx,sy), groundWorldY(tx,ty)) + TRACER_LIFT_PX *
 * WORLD_Y_PER_LIFT_PIXEL`, applied to all four vertices -- still flat, still
 * perfectly straight, but never sits under the higher of its own two ends'
 * ground.
 */
export function tracerQuadPositions(
  t: TracerModel,
  elevation: Uint8Array | null,
  mapWidth: number,
  mapHeight: number
): Float32Array {
  const dxScreen = isoX(t.tx, t.ty) - isoX(t.sx, t.sy);
  const dyScreen = isoY(t.tx, t.ty) - isoY(t.sx, t.sy);
  const len = Math.hypot(dxScreen, dyScreen);
  // A zero-length shot (source === target, e.g. a point-blank resolve with
  // no travel) has no defined bearing. Falling back to a fixed perpendicular
  // keeps the quad's area nonzero rather than collapsing it to an invisible
  // line; nobody can tell which way a 1.5px-wide, near-zero-length ribbon's
  // width axis points regardless.
  const nx = len > 0 ? -dyScreen / len : 1;
  const ny = len > 0 ? dxScreen / len : 0;
  const half = TRACER_WIDTH_PX / 2;
  const perp = screenOffsetToWorld(nx * half, ny * half);
  const groundY = Math.max(
    groundWorldY(elevation, mapWidth, mapHeight, t.sx, t.sy),
    groundWorldY(elevation, mapWidth, mapHeight, t.tx, t.ty)
  );
  const liftY = groundY + TRACER_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL;

  return Float32Array.from([
    t.sx - perp.dx, liftY, t.sy - perp.dy,
    t.sx + perp.dx, liftY, t.sy + perp.dy,
    t.tx + perp.dx, liftY, t.ty + perp.dy,
    t.tx - perp.dx, liftY, t.ty - perp.dy,
  ]);
}

/** Per-vertex GPU attribute arrays `writeTracerInstances` fills, sized (by
 *  the caller) to `TRACER_CAPACITY * 4` vertices -- four per tracer slot,
 *  not instanced (see `TracerBatch`'s own doc comment for why). */
export interface TracerInstanceBuffers {
  /** xyz triples, world space, `capacity * 4` long. */
  positions: Float32Array;
  /** rgb triples in 0..1, `capacity * 4` long -- all four vertices of one
   *  tracer share a colour, but this is per-vertex storage regardless,
   *  since the mesh is a single batched (not instanced) geometry. */
  colors: Float32Array;
  /** One alpha per vertex, `capacity * 4` long. */
  alphas: Float32Array;
}

/**
 * Writes every live tracer's quad into a flat, batched buffer. Pure aside
 * from calling `tracerQuadPositions`/`tracerAlpha` (both pure themselves) --
 * no `THREE.*`. Returns the number of QUADS written (not vertices or
 * indices); the caller derives `drawRange` from it.
 *
 * `tracers` is spawn-ordered (oldest at index 0, newest last -- `Array.push`
 * spawn order, preserved by `stepTracers`'s own filter). When there are more
 * live tracers than `TRACER_CAPACITY`, this keeps the NEWEST ones and drops
 * the oldest, by starting the walk at `tracers.length - capacity` rather
 * than at 0: a `break` at capacity, ordered oldest-first, would silently
 * drop the shots that just happened -- the ones a player is actually
 * looking at -- while a handful of stale, nearly-faded-out tracers held the
 * buffer for the rest of their (short) lives. Dropping the oldest instead
 * means the tracer capacity, whatever it is set to, degrades toward "the
 * newest N stay visible" rather than "the game freezes which shots you can
 * see."
 */
export function writeTracerInstances(
  tracers: readonly TracerModel[],
  tracerColors: readonly [string, string],
  elevation: Uint8Array | null,
  mapWidth: number,
  mapHeight: number,
  out: TracerInstanceBuffers
): number {
  const capacity = out.alphas.length / 4;
  const start = Math.max(0, tracers.length - capacity);
  let count = 0;
  for (let i = start; i < tracers.length; i++) {
    const t = tracers[i];
    const quad = tracerQuadPositions(t, elevation, mapWidth, mapHeight);
    const alpha = tracerAlpha(t);
    const [r, g, b] = cachedHexToUnit(tracerColors[t.side] ?? tracerColors[0]);
    out.positions.set(quad, count * 12);
    for (let v = 0; v < 4; v++) {
      const ci = count * 12 + v * 3;
      out.colors[ci] = r;
      out.colors[ci + 1] = g;
      out.colors[ci + 2] = b;
      out.alphas[count * 4 + v] = alpha;
    }
    count++;
  }
  return count;
}

/** Index buffer for `capacity` batched tracer quads: two triangles per quad,
 *  `(4i, 4i+1, 4i+2)` and `(4i, 4i+2, 4i+3)` -- the same `[0,1,2,0,2,3]`
 *  pattern `particleBillboardGeometry`/`unitBillboardGeometry` use, just
 *  repeated at every quad's own vertex base. Built once at construction, not
 *  touched again -- only the positions/colors/alphas and the draw range
 *  change per frame. Plain `Uint32Array` arithmetic, no `THREE.*`. */
export function tracerIndexBuffer(capacity: number): Uint32Array {
  const indices = new Uint32Array(capacity * 6);
  for (let i = 0; i < capacity; i++) {
    const base = i * 4;
    const o = i * 6;
    indices[o] = base;
    indices[o + 1] = base + 1;
    indices[o + 2] = base + 2;
    indices[o + 3] = base;
    indices[o + 4] = base + 2;
    indices[o + 5] = base + 3;
  }
  return indices;
}

// ---------------------------------------------------------------------------
// GPU-facing: everything below touches THREE.* GPU-side construction
// (BufferGeometry, InstancedMesh, ShaderMaterial). Not exercised by
// fx.test.ts for the same reason instances.ts's own GPU half is not --
// three.js accepts these buffers under `environment: 'node'` (no
// WebGLRenderer needed merely to construct them, `instances.test.ts`'s own
// "render-order tie-break" suite already relies on this), but *using* them
// end to end needs a real WebGLRenderer. Covered by the browser verification
// in the B3.13 report instead.
// ---------------------------------------------------------------------------

/**
 * One draw call's worth of particles, on ONE of Pixi's former layers --
 * `ParticleInstancer` now builds one of these per tier (below/above), see
 * this file's top comment ("The `above_units` split (B3.14)") for why the
 * two-layer distinction is back, on the `depthTest` axis this parameter
 * controls.
 *
 * `depthWrite: false` unconditionally, NOT the `true` `units/instances.ts`
 * uses -- see this file's top comment, "FX-vs-UNIT ordering is a DIFFERENT
 * question", for the full reasoning. In short: particles are inherently
 * translucent (`alpha_over_life` fades by design; `catastrophic_kill.json`
 * overlaps 18-26 discs meant to read as one dense burst), and `depthWrite:
 * true` would depth-reject the far side of every overlap instead of letting
 * it blend.
 *
 * `depthTest` is the caller's choice: `true` for the below-tier (matches
 * `units/instances.ts`'s own building/ridge occlusion result -- terrain and
 * units are opaque and write real depth regardless of what FX does with its
 * own), `false` for the above-tier (an unconditional pass, matching Pixi's
 * own `fxAboveG`, which has no depth reasoning to opt out of because Pixi
 * has no depth buffer at all -- see the `above_units` section for the full
 * account).
 *
 * No alpha-threshold discard is needed here the way `instances.ts`'s
 * `ALPHA_PADDING_DISCARD` is for units: that constant exists purely to stop
 * a near-zero-alpha fragment from committing occluding depth, and with
 * `depthWrite: false` a particle commits no depth at all, so there is
 * nothing for a faint fragment to pollute.
 *
 * ## `hotCore` (`ParticleSpec.additive`): the dead-schema-field fix, and why
 * it is NOT GPU additive blending
 *
 * `ParticleSpec.additive` has validated and typechecked since the emitter
 * schema's own first draft, and until this fix nothing read it -- every
 * particle composited with three.js's default `NormalBlending` regardless
 * of what the JSON said, so `vfx.white_hot` (`#FFF6D0`) painted exactly the
 * pale cream blob it is, alpha-diluted against the ring/smoke/terrain
 * around it, never the blown-out incandescent core the reference photos the
 * project lead supplied show.
 *
 * The first draft of this fix (kept in history, not here) used
 * `THREE.AdditiveBlending` (`ONE, ONE`) -- the obvious reading of "additive"
 * -- and it was REJECTED after review, not merely reconsidered:
 *
 *  - **This backend's palette guarantee is per-material, enforced by
 *    construction.** `palette-material.ts`'s `toonRampMaterial` can only
 *    emit a colour it reads out of `uRamp` -- its own doc comment: "A shaded
 *    fragment cannot emit an off-palette colour because the only values it
 *    can write are the ones read out of the ramp." This material has no
 *    ramp (it writes a literal resolved palette hex straight to
 *    `gl_FragColor`), but the SAME property -- every fragment this material
 *    ever writes is one of the 65 -- held for it too, by a different
 *    mechanism (a hardcoded, already-palette-resolved `vColor`), until
 *    `AdditiveBlending` broke it: the GPU blend stage runs AFTER the
 *    fragment shader, summing whatever the shader wrote with whatever is
 *    already in the framebuffer, and that sum is arithmetic on RGB channels
 *    with no palette awareness at all. Two `vfx.white_hot` (`#FFF6D0`)
 *    fragments overlapping at partial alpha sum to something between
 *    `#FFF6D0` and white that is neither -- off-palette, silently, every
 *    frame it happens.
 *  - **Clamping to white does not save it.** `#FFFFFF` was checked against
 *    `data/palette.json` directly (`grep -n "FFFFFF" data/palette.json`) --
 *    zero hits. The palette has no white entry, so even the one case where
 *    additive summation saturates cleanly (enough full-alpha overlap to hit
 *    the byte ceiling) lands on a colour the palette does not name either.
 *    There is no accidental save here.
 *  - **The `vfx` band being "RUNTIME ONLY... rejected by CI if found in
 *    STATIC ART" is licence for saturated colour CHOICE, not for
 *    arithmetic that exceeds the palette.** `data/palette.json`'s own text
 *    for that band: "reserved so explosions and tracers pop against
 *    desaturated terrain" -- about which 65 colours exist to choose from,
 *    not about permission to synthesise a 66th at the blend stage. Ordinary
 *    alpha compositing already produces continuously-varying, technically
 *    off-palette output pixels wherever two different palette colours
 *    overlap at partial alpha (every particle system in this file has
 *    always done this, unremarked, because no CI path screenshots a live
 *    frame and checks it) -- but that is `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`
 *    interpolating BETWEEN two already-on-palette colours, bounded within
 *    their span. Additive is `ONE, ONE`, unbounded, and can produce a
 *    result brighter than either input -- a qualitatively different kind of
 *    off-palette, not the same accepted-by-precedent one.
 *
 * The fix actually shipped keeps `NormalBlending` for every tier and
 * instead makes the `hotCore` fragment shader IGNORE its own alpha
 * attribute and always write 1.0: `gl_FragColor = vec4(vColor, 1.0)`. With
 * alpha pinned to 1, `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` degenerates to `dst =
 * src` -- a flat, opaque overwrite of whatever pixel is beneath it with
 * EXACTLY the resolved `color_over_life` palette entry for that particle's
 * current age, no interpolation, no summation. Every fragment a `hotCore`
 * material writes is therefore on-palette by construction, the identical
 * strength of guarantee `toonRampMaterial` gives lit geometry, achieved a
 * different way because this material has no lighting term to quantize.
 *
 * This is a real, load-bearing behaviour change from what `additive: true`
 * suggests by name: it no longer sums brightness at all, so a cluster of
 * overlapping `vfx.white_hot` particles reads as a solid patch of
 * `#FFF6D0`, not a blown-out white beyond it -- `#FFF6D0` IS already close
 * to white (246, 208 of 255 on the two cooler channels) and, drawn fully
 * opaque rather than alpha-diluted toward the dust/smoke around it, reads
 * meaningfully brighter than the pre-fix pale blob, but it has a real
 * ceiling this mechanism cannot cross while staying on-palette: no
 * arrangement of `hotCore` particles can look brighter than `vfx.white_hot`
 * itself, because nothing drawn through this material is ever allowed to.
 * `data/vfx/fire_apfsds.json`'s own redesign (multiple concentric
 * `hotCore` layers -- a tight `vfx.white_hot` root, a wider
 * `vfx.white_hot`-to-`vfx.fire` flare, a `vfx.fire`-to-`vfx.ember` outer
 * edge) leans on SPATIAL layering of the three reserved `vfx` ramp steps to
 * build the reference's white-to-orange-to-red-orange grade, rather than on
 * summation this fix deliberately does not provide -- see that file's own
 * comments for the full account.
 *
 * `additive: true` is kept as the schema field's name (renaming it would
 * touch every shipped emitter and the schema's own vocabulary for no
 * behavioural gain) but is renamed to `hotCore` at this function's own
 * boundary and below, so nothing in this module's code claims a summing
 * blend mode it does not have. `ParticleInstancer`'s `additive` CONSTRUCTOR
 * parameter is left as `additive` for now (it reads `ParticleSpec.additive`
 * one call site up in `ThreeRenderer.ts`, and renaming across that seam too
 * is out of scope for this fix) but is documented there with the same
 * correction.
 */
function createParticleMaterial(depthTest: boolean, hotCore: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec2 aLocal;
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec2 vLocal;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vLocal = aLocal;
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vLocal;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        // Hard-edged circle cutout -- matches Pixi's g.circle().fill(),
        // itself a flat fill with no soft falloff, rather than inventing
        // a smoother look Pixi's own particles do not have. Nothing else is
        // discarded: alpha, however faint, still blends (see this
        // function's own doc comment for why that is now safe).
        if (dot(vLocal, vLocal) > 1.0) discard;
        // hotCore: alpha is pinned to 1.0, not read off vAlpha -- see this
        // function's own doc comment, "The fix actually shipped keeps
        // NormalBlending...", for why an opaque overwrite is what keeps
        // every hotCore fragment on-palette by construction.
        gl_FragColor = vec4(vColor, ${hotCore ? '1.0' : 'vAlpha'});
      }
    `,
    transparent: true,
    depthTest,
    depthWrite: false,
    side: THREE.FrontSide,
    // NormalBlending, always -- see this function's own doc comment for why
    // AdditiveBlending was tried and rejected. hotCore's opacity guarantee
    // comes from the fragment shader above pinning alpha to 1, not from a
    // different GPU blend equation.
    blending: THREE.NormalBlending,
  });
}

/**
 * Every live particle on ONE tier (`layerIdx`), one `THREE.InstancedMesh`,
 * one draw call -- the same shape `UnitInstancer` gives units, sized to
 * `PARTICLE_CAPACITY` (not a fraction of it) so a live particle can never
 * outrun what this instancer can draw REGARDLESS of which tier ends up
 * holding it -- both tiers draw from the same underlying `ParticleSystem`
 * pool, and a particle's `layerIdx` is fixed at spawn, so in the worst case
 * every live particle could land on ONE tier at once (today, 11 of 12
 * shipped emitters are `above_units`, so this is not merely a theoretical
 * worst case).
 *
 * `ThreeRenderer` constructs two of these -- one per tier -- rather than
 * this class branching on `layerIdx` internally, so each tier's `depthTest`
 * material flag and `renderOrder` are fixed at construction, matching how
 * `UnitInstancer` is one instance per unit type rather than one instance
 * juggling several.
 */
export class ParticleInstancer {
  readonly mesh: THREE.InstancedMesh;
  private readonly layerIdx: number;
  private readonly colorAttr: THREE.InstancedBufferAttribute;
  private readonly alphaAttr: THREE.InstancedBufferAttribute;
  private readonly scratchPositions: Float32Array;
  private readonly scratchScales: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();

  /**
   * `layerIdx` selects which of `ParticleSystem`'s FOUR draw layers this
   * instancer reads (`FX_LAYER_BELOW`/`FX_LAYER_ABOVE`/
   * `FX_LAYER_BELOW_ADDITIVE`/`FX_LAYER_ABOVE_ADDITIVE`, `ThreeRenderer.ts`)
   * -- widened from two to four the same day `additive` itself was wired,
   * since blending is a whole-`ShaderMaterial` state (there is no per-
   * instance blend mode an `InstancedMesh` can express), so a `hotCore`
   * particle needs its own draw call, exactly like an above/below-tier
   * particle already does. `depthTest` is this tier's own material flag --
   * `true` for a below-tier instancer (real occlusion against
   * units/terrain), `false` for an above-tier one (Pixi-`fxAboveG`-faithful,
   * unconditional). `additive` (this constructor's own parameter name, kept
   * for the caller in `ThreeRenderer.ts` which reads `ParticleSpec.additive`
   * directly -- see `createParticleMaterial`'s own doc comment for why the
   * schema field name did not change) is orthogonal to both: whether this
   * instancer's material pins every fragment's alpha to 1 (an opaque hot
   * core, `vfx.white_hot`-class effects) or samples the authored
   * `alpha_over_life` curve normally (everything else, unchanged). This is
   * NOT a summing/additive GPU blend mode -- see `createParticleMaterial`'s
   * own doc comment for the full account of why that was tried and
   * rejected, and for what `additive: true` in the JSON actually causes
   * now.
   */
  constructor(capacity: number, layerIdx: number, depthTest: boolean, additive = false) {
    this.layerIdx = layerIdx;
    const geo = particleBillboardGeometry();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    geometry.setAttribute('aLocal', new THREE.BufferAttribute(geo.local, 2));
    geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1));

    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    this.mesh = new THREE.InstancedMesh(geometry, createParticleMaterial(depthTest, additive), capacity);
    this.mesh.count = 0;
    // Draw after every unit, deliberately -- see this file's top comment,
    // "FX-vs-UNIT ordering is a DIFFERENT question", for why this is now
    // required rather than optional once depthWrite is off above. The
    // above-tier (depthTest false) additionally wins any tie against the
    // below-tier and against tracers, via the higher constant. A hotCore
    // (additive: true) instancer sits ONE BAND AFTER its own tier's normal
    // sibling, not tied to it -- with alpha pinned to 1 (an opaque
    // overwrite, `createParticleMaterial`'s own doc comment), draw order
    // between it and its normal sibling is no longer harmless the way true
    // additive summation would have been: a normal-tier dust/smoke particle
    // that happened to submit after the hot core would opaquely paint over
    // it. `render-order.ts`'s own 2.5/3.5 rows have the full account.
    this.mesh.renderOrder = depthTest
      ? additive
        ? FX_RENDER_ORDER_ADDITIVE
        : FX_RENDER_ORDER
      : additive
        ? FX_RENDER_ORDER_ABOVE_ADDITIVE
        : FX_RENDER_ORDER_ABOVE;
    // Particles move continuously across the whole map, exactly like units
    // -- see UnitInstancer's own identical frustumCulled = false and its
    // comment for why an origin-centred bounding sphere would be wrong, not
    // merely unhelpful, here.
    this.mesh.frustumCulled = false;

    this.scratchPositions = new Float32Array(capacity * 3);
    this.scratchScales = new Float32Array(capacity);
  }

  /**
   * `particles` is `null` before `ThreeRenderer.useEmitters` has wired a
   * `ParticleSystem` in. Truthfully nothing to draw yet -- `mesh.count`
   * drops to 0 rather than throwing or holding stale instances on screen.
   *
   * `elevation`/`mapWidth`/`mapHeight` thread straight through to
   * `writeParticleInstances` -- see its own doc comment for why they are
   * needed at all (Task B3.14's ground-lift fix).
   */
  update(particles: ParticleSystem | null, elevation: Uint8Array | null, mapWidth: number, mapHeight: number): void {
    if (!particles) {
      this.mesh.count = 0;
      return;
    }
    const count = writeParticleInstances(particles, this.layerIdx, elevation, mapWidth, mapHeight, {
      positions: this.scratchPositions,
      colors: this.colorAttr.array as Float32Array,
      alphas: this.alphaAttr.array as Float32Array,
      scales: this.scratchScales,
    });
    for (let i = 0; i < count; i++) {
      this.scratchMatrix.makeScale(this.scratchScales[i], this.scratchScales[i], this.scratchScales[i]);
      this.scratchMatrix.setPosition(
        this.scratchPositions[i * 3],
        this.scratchPositions[i * 3 + 1],
        this.scratchPositions[i * 3 + 2]
      );
      this.mesh.setMatrixAt(i, this.scratchMatrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Flat-shaded, per-vertex-alpha material for the batched tracer mesh -- no
 * texture and no circle cutout, a tracer is a plain rectangle.
 *
 * `depthWrite: false`, matching `createParticleMaterial`'s own revised
 * recipe and for the same reason (this file's top comment,
 * "FX-vs-UNIT ordering is a DIFFERENT question") -- a tracer fades over its
 * lifetime exactly like a particle does (`tracerAlpha`), and two tracers
 * that happen to cross should blend, not depth-reject one of them.
 * `depthTest` stays `true`, which is the half of this recipe the
 * building/ridge occlusion result actually depends on.
 */
function createTracerMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    // DoubleSide, unlike every billboard elsewhere in this backend --
    // deliberate, not an oversight. unitBillboardGeometry/
    // particleBillboardGeometry are each built ONCE against this camera's
    // fixed azimuth and their winding proven correct for it (instances.ts's
    // own "unit-vs-tree tie" section, confirmed to float precision against
    // the real camera). A tracer's quad is rebuilt fresh EVERY FRAME from
    // two arbitrary world points whose bearing changes shot to shot
    // (`tracerQuadPositions`), so there is no fixed winding to prove once --
    // getting it backwards for some bearings and not others would make
    // tracers flicker depending on which way a unit happened to be facing
    // when it fired. instances.ts's own top comment already notes DoubleSide
    // "addresses back-face culling, not depth ordering" -- exactly why this
    // costs nothing: the depth resolution against opaque terrain/buildings
    // (`depthTest: true` above) is unaffected by which faces get
    // rasterised.
    side: THREE.DoubleSide,
  });
}

/**
 * Every live tracer, ONE batched (not instanced) `THREE.Mesh`, one draw
 * call. Not an `InstancedMesh` like `ParticleInstancer`/`UnitInstancer`:
 * both of those scale a SHARED base quad by a single per-instance factor
 * (radius, or nothing at all) via `Matrix4`. A tracer's quad varies in both
 * length AND direction per shot (`tracerQuadPositions` computes four
 * absolute world corners, not a scale+translate of a shared shape), so this
 * writes real per-vertex positions into one large `BufferGeometry` instead
 * -- still exactly one draw call, `drawRange`-trimmed to the live count each
 * frame, the same "hide the unused tail" idea `mesh.count` gives an
 * `InstancedMesh`.
 */
export class TracerBatch {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;

  constructor(capacity: number) {
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(capacity * 4 * 3), 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(capacity * 4), 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);
    geometry.setIndex(new THREE.BufferAttribute(tracerIndexBuffer(capacity), 1));
    geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(geometry, createTracerMaterial());
    // Draw after every unit -- see ParticleInstancer's identical field and
    // this file's top comment for why.
    this.mesh.renderOrder = FX_RENDER_ORDER;
    // Tracers span the whole map, exactly like units and particles -- see
    // ParticleInstancer's identical field and UnitInstancer's own comment.
    this.mesh.frustumCulled = false;
  }

  /**
   * `elevation`/`mapWidth`/`mapHeight` thread straight through to
   * `tracerQuadPositions` via `writeTracerInstances` -- the post-B3.14
   * review fix: a tracer's own lift now tracks the higher of its two
   * endpoints' ground height, so it is never buried under a raised tile
   * the way a flat `TRACER_LIFT_PX` left it. See `tracerQuadPositions`'s
   * own doc comment for the full account.
   */
  update(
    tracers: readonly TracerModel[],
    tracerColors: readonly [string, string],
    elevation: Uint8Array | null,
    mapWidth: number,
    mapHeight: number
  ): void {
    const count = writeTracerInstances(tracers, tracerColors, elevation, mapWidth, mapHeight, {
      positions: this.positionAttr.array as Float32Array,
      colors: this.colorAttr.array as Float32Array,
      alphas: this.alphaAttr.array as Float32Array,
    });
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, count * 6);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
