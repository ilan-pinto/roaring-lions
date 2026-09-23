// The mission starts after the renderer does, and the renderer has to be told.
//
// Shell-upgrade Phase 3, Task 4 moved `new MissionRuntime` + `runtime.start()`
// past the deploy screen (plan R-5), which put them AFTER `await
// renderer.init(stage)`. Both backends' `init()` end by calling `snapshot()`
// twice -- in `ThreeRenderer.init()` under the comment "Seeds prevX/prevY ==
// curX/curY from the sim's actual starting positions", and as the last two
// statements of `PixiRenderer.init()`, the second marked "prev == cur on the
// first frame" -- to seed their interpolation copies and fog from the sim's
// starting units. Cited by function and anchor, never by line: WP-A1.3 (GH-177)
// rewrites `ThreeRenderer.ts` and every line number in it moves. When `init()`
// ran after the spawn that seeded the real force; now it seeds from an EMPTY
// sim (`entityCount` 0), and nothing re-seeded after the spawn. Measured on
// the Task 4 review: until tick 1 the whole starting force drew at world
// (0, 0); on tick 1 it lerped out to its spawns and every vehicle threw a
// dust burst off the speed spike; the map stayed full shroud until tick 3;
// and Pixi never seeded turret facing.
//
// Fixed from the app side, through the `Renderer` seam's own `snapshot()`,
// because `packages/render/**` is not this lane's to edit (`ThreeRenderer.ts`
// is in flight elsewhere; `renderer.ts` is frozen). The spawn and the reseed
// are one function so no caller can do the first and forget the second, and
// so a test can drive that function and go red when the reseed is skipped
// (`tools/src/deploy_choice.test.ts`). It lives here rather than in
// `main.ts` for that reason alone: `main.ts` boots on import and no test can
// load it.

import { MissionRuntime, type MissionContext, type MissionJson, type Sim } from '@lions/sim';
import type { Renderer } from '@lions/render';

/**
 * How many `snapshot()` calls re-seed a renderer whose `init()` ran on an
 * empty sim. THREE, and the number is a coupling to three renderer internals,
 * each cited by function and a nearby anchor (not a line number, which the
 * A1.3 branch moves) so a change to one of them is a change to this:
 *
 *  1. **Interpolation, and the speed read off it.** Both backends'
 *     `snapshot()` copy `cur` into `prev` (`this.prevX.set(this.curX)`), read
 *     the sim into `cur`, and derive `entitySpeed` from the difference
 *     (`Math.hypot(dx, dy) * SIM_HZ`). Call 1 moves `cur` from the zero-fill
 *     to the spawns -- a speed spike; call 2 makes `prev == cur` and the speed
 *     0. So at least two, and the LAST call must not be the one that moves
 *     anything, or the first frame lerps the force in from (0, 0) and every
 *     reader of `entitySpeed` sees a vehicle that crossed the map in one
 *     tick. The re-seed protects `entitySpeed` for all of them: today
 *     `ThreeRenderer.updateVehicleAmbientFx` (`const speed =
 *     this.entitySpeed[i]`), which would read the spike as a dust burst; and,
 *     once WP-A1.3 (GH-177) lands, the vehicle weight model, which seeds its
 *     first frame from it -- `updateVehicleMeshes` feeds `entitySpeed` to
 *     `stepVehicleWeight` as the hull's speed, so a spike would throw every
 *     hull's lag, squat and lean on the frame the player first sees it.
 *  2. **Fog.** The fog (and the trail) refresh only on a call where
 *     `fogTick++ % 4 === 0` -- the first statement of both backends'
 *     `snapshot()` -- and read the sim directly when they do. `init()`'s two
 *     calls leave `fogTick` at 2, having refreshed once, on the empty sim.
 *     Calls at `fogTick` 2 and 3 do not refresh; the call at 4 does. So THREE
 *     is the least that seeds the fog from the force the player is about to
 *     command, where two would leave the map full shroud until the first
 *     refresh inside the tick loop. More than three would only shift the
 *     5 Hz phase, which nothing reads.
 *  3. **Pixi's turret seed.** `PixiRenderer.snapshot()` seeds turret facing to
 *     hull facing only while `frameN === 0` ("Seed turret facing to hull
 *     facing on first snapshot"), and `frameN` advances in `frame()`'s
 *     opening lines (`this.frameN++`). `main.ts`'s first `frame()` is after
 *     this, so all three calls are still inside that window. (three.js seeds
 *     turrets per entity in `entityFrame` instead and does not care.)
 *
 * It also assumes NOTHING else called `snapshot()` between `init()` and here,
 * which holds because `main.ts`'s `runTick` (the only other caller) cannot run
 * before the frame loop starts, and the frame loop starts after this.
 */
export const RESEED_SNAPSHOTS = 3;

/** Re-seed a renderer after the mission's starting force spawned into a sim
 *  the renderer had already been initialised on. See `RESEED_SNAPSHOTS`. */
export function reseedAfterSpawn(renderer: Pick<Renderer, 'snapshot'>): void {
  for (let k = 0; k < RESEED_SNAPSHOTS; k++) renderer.snapshot();
}

/**
 * Build the mission's runtime, spawn its starting force, and re-seed the
 * renderer from that force -- the three steps that must happen together after
 * the player deploys. `ctx.ledger` is whatever the deploy choice produced
 * (`deployedLedger`, `ui/deploy-select.ts`); this function does not care.
 *
 * Only a MISSION needs this. A sandbox spawns its force before
 * `renderer.init()`, so `init()`'s own two snapshots already seed it.
 */
export function startMission(
  sim: Sim,
  mission: MissionJson,
  ctx: MissionContext,
  renderer: Pick<Renderer, 'snapshot'>
): MissionRuntime {
  const runtime = new MissionRuntime(sim, mission, ctx);
  runtime.start();
  reseedAfterSpawn(renderer);
  return runtime;
}
