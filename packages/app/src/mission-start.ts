// The mission starts after the renderer does, and the renderer has to be told.
//
// Shell-upgrade Phase 3, Task 4 moved `new MissionRuntime` + `runtime.start()`
// past the deploy screen (plan R-5), which put them AFTER `await
// renderer.init(stage)`. `init()` seeds the renderer from the sim -- its
// interpolation copies, its fog, its structure instancers -- and it now does
// that on a sim with nothing in it: `runtime.start()` spawns the starting
// force AND raises the mission's own structures afterwards. Measured on the
// Task 4 review, with nothing re-seeding: until tick 1 the whole starting
// force drew at world (0, 0); on tick 1 it lerped out to its spawns and every
// vehicle threw a dust burst off the speed spike; the map stayed full shroud
// until tick 3; and Pixi never seeded turret facing. On `&nomesh` a mission
// structure could also go undrawn, because the three.js structure instancer
// was sized before it existed.
//
// The fix is `Renderer.reseed()` (`packages/render/src/api.ts`): one call,
// after the spawn, and each backend owns what re-seeding means for it. The
// shipped stopgap before it called `snapshot()` three times from here, a
// count coupled to how many snapshots `init()` took and to the 5 Hz fog
// cadence, with nothing tying them together. The spawn and the reseed are one
// function so no caller can do the first and forget the second, and so a
// test can drive that function and go red when the reseed is skipped
// (`tools/src/deploy_choice.test.ts`). It lives here rather than in
// `main.ts` for that reason alone: `main.ts` boots on import and no test can
// load it.

import { MissionRuntime, type MissionContext, type MissionJson, type Sim } from '@lions/sim';
import type { Renderer } from '@lions/render';

/**
 * Build the mission's runtime, spawn its starting force, and re-seed the
 * renderer from that force -- the three steps that must happen together after
 * the player deploys. `ctx.ledger` is whatever the deploy choice produced
 * (`deployedLedger`, `ui/deploy-select.ts`); this function does not care.
 *
 * Only a MISSION needs this. A sandbox spawns its force (and raises no
 * structures of its own) before `renderer.init()`, so `init()` already seeds
 * from it.
 */
export function startMission(
  sim: Sim,
  mission: MissionJson,
  ctx: MissionContext,
  renderer: Pick<Renderer, 'reseed'>
): MissionRuntime {
  const runtime = new MissionRuntime(sim, mission, ctx);
  runtime.start();
  renderer.reseed();
  return runtime;
}
