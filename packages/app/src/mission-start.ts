// The mission starts after the renderer does, and the renderer has to be told.
//
// Shell-upgrade Phase 3, Task 4 moved `new MissionRuntime` + `runtime.start()`
// past the deploy screen (plan R-5), which put them AFTER `await
// renderer.init(stage)`. Both backends' `init()` end by calling `snapshot()`
// twice -- `ThreeRenderer.ts:2149-2150`, `renderer.ts:557-558` -- to seed their
// interpolation copies and fog from the sim's starting units. When `init()`
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
 * each cited so a change to one of them is a change to this:
 *
 *  1. **Interpolation.** `snapshot()` copies `cur` into `prev` and then reads
 *     the sim into `cur` (`ThreeRenderer.ts:3070-3078`, `renderer.ts:736-747`),
 *     and derives `entitySpeed` from the difference. Call 1 moves `cur` from
 *     the zero-fill to the spawns -- a speed spike; call 2 makes `prev == cur`
 *     and the speed 0. So at least two, and the LAST call must not be the one
 *     that moves anything, or the first frame lerps the force in from (0, 0)
 *     and `updateVehicleAmbientFx` reads the spike as a dust burst
 *     (`ThreeRenderer.ts:3969`, reading `entitySpeed` at `:3986`).
 *  2. **Fog.** The fog (and the trail) refresh only on a call where
 *     `fogTick++ % 4 === 0` (`ThreeRenderer.ts:3066`, `renderer.ts:733`), and
 *     read the sim directly when they do. `init()`'s two calls leave `fogTick`
 *     at 2, having refreshed once, on the empty sim. Calls at `fogTick` 2 and
 *     3 do not refresh; the call at 4 does. So THREE is the least that seeds
 *     the fog from the force the player is about to command, where two would
 *     leave the map full shroud until the first refresh inside the tick loop.
 *     More than three would only shift the 5 Hz phase, which nothing reads.
 *  3. **Pixi's turret seed.** `renderer.ts:748-750` seeds turret facing to
 *     hull facing only while `frameN === 0`, and `frameN` advances in
 *     `frame()` (`renderer.ts:1881`). `main.ts`'s first `frame()` is after
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
