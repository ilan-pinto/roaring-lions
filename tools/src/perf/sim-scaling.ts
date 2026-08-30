// Sim-tick scaling curve, with per-phase attribution.
//
// CLAUDE.md's "Known scaling debts" names four things that "want staggering
// in the same sweep" -- detection's O(N^2) pair scan, the trail-detection
// scan (trailStrengthFor), the mark_tunnel scan (markerSeesRoute), and
// drawTrail (renderer-side, out of this file's scope) -- but nobody had
// ever measured which one actually dominates, or at what unit count.
// three-units.ts's own Node CLI times sim.tick() as one number up to 400
// units on a TUNNEL-FREE world (buildWorld never calls addTunnel) --
// useful for its own regression-gate purpose, useless for attribution, and
// its checkpoints stop well short of the GDD's 300-unit target's
// neighbourhood.
//
// This file times the SAME world-construction machinery
// (buildWorld/computeAnchors/createSpawner/spawnUpTo, imported unchanged
// from three-units.ts -- not reimplemented, so the roster, map and spawn
// pattern are identical to the renderer curve in docs/PERFORMANCE.md and a
// unit count means the same thing in both documents) but additionally:
//
//   1. registers beit_sahwan_outskirts's own 4 authored tunnel routes
//      (map.tunnels, the same conversion main.ts performs) so
//      trailStrengthFor and markerSeesRoute actually run every tick --
//      buildWorld alone leaves tunnelCount_ at 0, which would make the
//      whole debt this file exists to measure silently cost zero. The
//      friendly roster's own recon_drone carries mark_tunnel already (real
//      content, not invented for this harness), so both scans get real
//      load without adding a unit type.
//   2. instruments each of tick()'s named phases by wrapping the
//      corresponding PROTOTYPE method with a timing accumulator before the
//      timed loop runs, and restores the original after -- TypeScript
//      `private` is a compile-time-only modifier, so this reaches real
//      methods without editing sim.ts at all. stepDetection is further
//      split into its pairwise unit-vs-unit scan (attributed as
//      stepDetection's own total minus the two sub-scans below) and the
//      two named sub-scans (trailStrengthFor, markerSeesRoute), each
//      wrapped separately -- both are called at most 2*tunnelCount times a
//      tick (a handful), so wrapping them adds no per-call overhead worth
//      worrying about, unlike wrapping the O(N^2) pair predicate itself
//      would.
//   3. wraps FlowField.prototype.compute (the O(width*height) BFS a fresh
//      goal triggers) to attribute pathing recompute cost separately from
//      stepMovement's own per-tick bookkeeping.
//
// Usage:
//   npx tsx tools/src/perf/sim-scaling.ts
//   npx tsx tools/src/perf/sim-scaling.ts --checkpoints=150,300,600,1000,1500
//   npx tsx tools/src/perf/sim-scaling.ts --ticks=60 --warmup=10

import { FlowField, type TunnelRouteJson } from '@lions/sim';
import {
  buildWorld,
  computeAnchors,
  createSpawner,
  spawnUpTo,
  livingCount,
  summarize,
  type SampleStats,
} from './three-units';

// ============================================================================
// CLI args
// ============================================================================

function parseArgs(argv: readonly string[]): { checkpoints: number[]; ticks: number; warmup: number; maxRoutes: boolean } {
  const flags = new Map(
    argv
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        return [k, v ?? 'true'] as const;
      })
  );
  const checkpointsArg = flags.get('checkpoints');
  const checkpoints = checkpointsArg
    ? checkpointsArg.split(',').map((s) => Number.parseInt(s, 10))
    : [150, 300, 600, 1000, 1500];
  const ticks = Number.parseInt(flags.get('ticks') ?? '40', 10);
  const warmup = Number.parseInt(flags.get('warmup') ?? '5', 10);
  const maxRoutes = flags.has('stress-routes');
  return { checkpoints, ticks, warmup, maxRoutes };
}

// ============================================================================
// Phase instrumentation
// ============================================================================

/** Every phase tick() calls, in the order tick() calls them (sim.ts's own
 *  `tick()` body -- kept in sync by eye since there is no programmatic way
 *  to read a method's call order out of another method). `applyCommands`
 *  is included even though this harness issues no commands (spawnUpTo
 *  never calls sim.command) -- it still runs its per-tick queue-drain
 *  check every tick, and a curve that silently omitted it would misattribute
 *  that cost into "everything else" for the wrong reason. */
const PHASES = [
  'applyCommands',
  'stepDigging',
  'stepDetection',
  'stepSurfacing',
  'stepCombat',
  'stepProjectiles',
  'stepStrikes',
  'stepKamikaze',
  'stepSweep',
  'stepMovement',
  'stepTransport',
  'stepFields',
  'stepGarrison',
  'stepDemolition',
  'stepUpkeep',
  'stepTunnelCharge',
] as const;

/** The two named sub-scans inside stepDetection this task exists to
 *  attribute. Wrapped independently of the PHASES list above so
 *  stepDetection's own accumulator can be reported both as a total AND
 *  split into "pairwise scan" (total minus these two) and these two by
 *  name. */
const DETECTION_SUBSCANS = ['trailStrengthFor', 'markerSeesRoute'] as const;

interface Instrumentation {
  totals: Map<string, number>;
  restore: () => void;
}

/** Wraps every name in `methodNames` on `proto` with a timing accumulator.
 *  Returns the running totals (ms, reset externally between checkpoints)
 *  and a restore function. `private` in TypeScript source is erased at
 *  compile time -- these are ordinary enumerable prototype methods at
 *  runtime, reachable the same way any instrumentation profiler reaches
 *  them, without editing sim.ts. */
function instrument(proto: object, methodNames: readonly string[]): Instrumentation {
  const totals = new Map<string, number>();
  const originals = new Map<string, (...args: unknown[]) => unknown>();
  const record = proto as Record<string, (...args: unknown[]) => unknown>;
  for (const name of methodNames) {
    totals.set(name, 0);
    const original = record[name];
    if (typeof original !== 'function') {
      throw new Error(`sim-scaling: no method named ${name} found -- sim.ts's phase list moved`);
    }
    originals.set(name, original);
    record[name] = function (this: unknown, ...args: unknown[]): unknown {
      const t0 = performance.now();
      const result = original.apply(this, args);
      totals.set(name, (totals.get(name) ?? 0) + (performance.now() - t0));
      return result;
    };
  }
  return {
    totals,
    restore: () => {
      for (const name of methodNames) {
        record[name] = originals.get(name)!;
      }
    },
  };
}

// ============================================================================
// Main
// ============================================================================

interface PhaseReport {
  name: string;
  avgMs: number;
  shareOfTick: number;
}

interface CheckpointReport {
  target: number;
  living: number;
  tick: SampleStats;
  phases: PhaseReport[];
  detectionPairwiseAvgMs: number;
  trailStrengthAvgMs: number;
  markerSeesRouteAvgMs: number;
  flowFieldComputeAvgMs: number;
  flowFieldComputeCalls: number;
}

async function main(): Promise<void> {
  const { checkpoints, ticks: timedTicks, warmup, maxRoutes } = parseArgs(process.argv.slice(2));
  const capacity = checkpoints[checkpoints.length - 1] + 100;

  const world = buildWorld(capacity);
  const { sim, map, typeOf } = world;

  // Register the map's own authored tunnels -- see the file-header comment
  // for why this is required for the trail/marker debt to cost anything at
  // all. Identical conversion to main.ts's own (points/dig_tiles_per_s/
  // pre_dug), reusing map.tunnels rather than inventing routes.
  const tunnelRoutes: TunnelRouteJson[] = map.tunnels.map((t) => ({
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
  }));
  // --stress-routes: pad to MAX_TUNNELS (16) by cloning the authored routes
  // (distinct ids, identical geometry -- addTunnel does not require unique
  // tile sets, and this measures the per-ROUTE iteration cost the debt
  // describes, not a realistic mission). Off by default: 4 authored routes
  // is what the largest real mission has ever shipped with.
  if (maxRoutes) {
    let n = 0;
    while (tunnelRoutes.length < 16) {
      const base = map.tunnels[n % map.tunnels.length];
      tunnelRoutes.push({
        id: `${base.id}_stress${n}`,
        points: base.points,
        dig_tiles_per_s: base.digTilesPerS,
        pre_dug: base.preDug,
      });
      n++;
    }
  }
  for (let i = 0; i < tunnelRoutes.length; i++) {
    const got = sim.addTunnel(tunnelRoutes[i]);
    if (got !== i) throw new Error(`tunnel "${tunnelRoutes[i].id}" registered as route ${got}, expected ${i}`);
  }
  console.log(
    `Registered ${tunnelRoutes.length} tunnel route(s)${maxRoutes ? ' (--stress-routes: padded to MAX_TUNNELS)' : ` from ${map.id}`}: ${tunnelRoutes.map((t) => t.id).join(', ')}`
  );

  const anchors = computeAnchors(map);
  const spawner = createSpawner(sim, typeOf, anchors.friendly, anchors.hostile);

  // Instrument once, up front, for the whole run -- checkpoints share one
  // continuous Sim (spawnUpTo only ever adds units), so wrapping and
  // unwrapping per checkpoint would be pure overhead for no benefit; totals
  // are reset per checkpoint instead.
  const simProto = Object.getPrototypeOf(sim) as object;
  const phaseInstr = instrument(simProto, PHASES);
  const subscanInstr = instrument(simProto, DETECTION_SUBSCANS);
  const flowFieldInstr = instrument(FlowField.prototype as object, ['compute']);
  const flowFieldCalls = { count: 0 };
  {
    // instrument() only times; count calls separately by wrapping again
    // over its own wrapper is wasteful, so patch a call counter into the
    // same wrapped function instead of a second layer.
    const proto = FlowField.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const timed = proto.compute;
    proto.compute = function (this: unknown, ...args: unknown[]): unknown {
      flowFieldCalls.count++;
      return timed.apply(this, args);
    };
  }

  const reports: CheckpointReport[] = [];

  for (const target of checkpoints) {
    spawnUpTo(sim, spawner, target);
    const living = livingCount(sim);

    // Warmup: let combat reach steady state (target selection, movement
    // orders) before timing -- unchanged rationale from three-units.ts's
    // own WARMUP_TICKS. Not timed, and its phase cost is discarded.
    for (let i = 0; i < warmup; i++) sim.tick();

    for (const t of phaseInstr.totals.keys()) phaseInstr.totals.set(t, 0);
    for (const t of subscanInstr.totals.keys()) subscanInstr.totals.set(t, 0);
    flowFieldCalls.count = 0;

    const samples: number[] = new Array<number>(timedTicks);
    for (let i = 0; i < timedTicks; i++) {
      const t0 = performance.now();
      sim.tick();
      samples[i] = performance.now() - t0;
    }
    const tickStats = summarize(samples);

    const phases: PhaseReport[] = PHASES.map((name) => {
      const totalMs = phaseInstr.totals.get(name) ?? 0;
      return { name, avgMs: totalMs / timedTicks, shareOfTick: totalMs / tickStats.totalMs };
    });

    const trailTotal = subscanInstr.totals.get('trailStrengthFor') ?? 0;
    const markerTotal = subscanInstr.totals.get('markerSeesRoute') ?? 0;
    const detectionTotal = phaseInstr.totals.get('stepDetection') ?? 0;
    const flowFieldTotal = flowFieldInstr.totals.get('compute') ?? 0;

    reports.push({
      target,
      living,
      tick: tickStats,
      phases,
      detectionPairwiseAvgMs: (detectionTotal - trailTotal - markerTotal) / timedTicks,
      trailStrengthAvgMs: trailTotal / timedTicks,
      markerSeesRouteAvgMs: markerTotal / timedTicks,
      flowFieldComputeAvgMs: flowFieldTotal / timedTicks,
      flowFieldComputeCalls: flowFieldCalls.count,
    });
  }

  phaseInstr.restore();
  subscanInstr.restore();
  flowFieldInstr.restore();

  // -------------------------------------------------------------- report

  const BUDGET_MS = 50; // invariant 1: fixed 20 Hz tick.

  console.log('');
  console.log(`Capture: node ${process.version}, ${timedTicks} timed ticks / ${warmup} warmup per checkpoint, map ${map.id}, seed fixed (three-units.ts's SEED).`);
  console.log('Budget crossing is against the 50ms/20Hz TICK budget (invariant 1), not the renderer 16.7ms frame budget.');
  console.log('');
  console.log('| target | living | tick avg | tick p95 | tick max | detection pairwise | trailStrengthFor | markerSeesRoute | stepCombat | stepMovement | stepProjectiles | flowField.compute (calls) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of reports) {
    const byName = new Map(r.phases.map((p) => [p.name, p]));
    const combat = byName.get('stepCombat')!;
    const movement = byName.get('stepMovement')!;
    const projectiles = byName.get('stepProjectiles')!;
    const crossed = r.tick.avgMs >= BUDGET_MS ? '  <-- BUDGET CROSSED (avg)' : r.tick.p95Ms >= BUDGET_MS ? '  <-- BUDGET CROSSED (p95)' : '';
    console.log(
      `| ${r.target} | ${r.living} | ${r.tick.avgMs.toFixed(2)} | ${r.tick.p95Ms.toFixed(2)} | ${r.tick.maxMs.toFixed(2)} | ${r.detectionPairwiseAvgMs.toFixed(3)} | ${r.trailStrengthAvgMs.toFixed(3)} | ${r.markerSeesRouteAvgMs.toFixed(3)} | ${combat.avgMs.toFixed(3)} | ${movement.avgMs.toFixed(3)} | ${projectiles.avgMs.toFixed(3)} | ${r.flowFieldComputeAvgMs.toFixed(3)} (${r.flowFieldComputeCalls}) |${crossed}`
    );
  }
  console.log('');
  console.log('Full phase breakdown per checkpoint (avg ms/tick, share of total tick):');
  for (const r of reports) {
    console.log(`\n-- target=${r.target} living=${r.living} tick avg=${r.tick.avgMs.toFixed(3)}ms p95=${r.tick.p95Ms.toFixed(3)}ms --`);
    const rows = [...r.phases].sort((a, b) => b.avgMs - a.avgMs);
    for (const p of rows) {
      if (p.avgMs < 0.001) continue;
      console.log(`  ${p.name.padEnd(18)} ${p.avgMs.toFixed(4).padStart(9)}ms  ${(p.shareOfTick * 100).toFixed(1).padStart(5)}%`);
    }
    console.log(`  ${'  detection pairwise'.padEnd(18)} ${r.detectionPairwiseAvgMs.toFixed(4).padStart(9)}ms`);
    console.log(`  ${'  trailStrengthFor'.padEnd(18)} ${r.trailStrengthAvgMs.toFixed(4).padStart(9)}ms`);
    console.log(`  ${'  markerSeesRoute'.padEnd(18)} ${r.markerSeesRouteAvgMs.toFixed(4).padStart(9)}ms`);
    console.log(`  ${'flowField.compute'.padEnd(18)} ${r.flowFieldComputeAvgMs.toFixed(4).padStart(9)}ms  (${r.flowFieldComputeCalls} calls across ${timedTicks} ticks)`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
