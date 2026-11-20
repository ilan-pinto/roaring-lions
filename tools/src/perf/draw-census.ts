// The draw-call census gate (GH-1411): what the 300-unit frame SUBMITS, read where CI can read it.
//
// Why a count and not a time. CI renders WebGL through SwiftShader, a CPU rasteriser whose frame time is no frame time
// a player sees (docs/PERFORMANCE.md, F5: 53 ms "measured" on it was retracted). A count is the same on SwiftShader as
// on Metal, because what a frame submits is decided on the CPU, before the rasteriser sees anything. And it is the
// count that matters: the measured bottleneck of the mesh-unit frame is draw-call SUBMISSION, 74-84% of `render()`
// (docs/PERFORMANCE.md, "Unit ceiling"), not vertices and not skinning.
//
// What it reads. `measureThreeMesh` in census mode (`three-units.ts`, `BenchOptions.censusOnly`): the bench world of
// every 300-unit curve in docs/PERFORMANCE.md, `beit_sahwan_outskirts`, seed 20260827, every roster type's real GLB,
// the shipped `high` preset. The empty scene (meshes loaded, nothing spawned, no tick) is the control; the 300
// checkpoint is the reading. The gate figure is the units' own submissions per living unit,
//
//     perUnit = (calls at the 300 checkpoint - calls in the empty scene) / living at the 300 checkpoint,
//
// so a map or decor change moves `emptyCalls`, not `perUnit`, and a roster that lost a different set of units to
// combat (a sim change) moves `living`, not the ratio's meaning.
//
// What it cannot see, said plainly: fill and shader cost (a heavier fragment shader at the same call count is
// invisible here), CPU work inside `frame()` that submits nothing (matrix walks, mixers), and any GPU other than the
// rasteriser's own count. It is a guard on the bottleneck the frame was measured to have, not on frame time.
//
// Two-sided: a per-unit figure that FALLS past the band fails too, because the likeliest cause of a drop is units
// that stopped drawing (a GLB that failed to load draws a proxy box, one mesh where a team drew several), and an
// upper-bound-only gate would call that an improvement. A real saving is re-pinned here with its reason, like the
// golden hash.

import type { BackendReport, DrawCensus } from './three-units';

export interface CensusBudget {
  /** The checkpoint the gate reads (the curve's lifetime spawn target). */
  target: number;
  /** Calls per living unit, measured; the band is `perUnit * (1 +- tolerance)`. */
  perUnit: number;
  tolerance: number;
  /** The empty scene's calls may not exceed this: a ceiling only (content may make the map cheaper). */
  maxEmptyCalls: number;
  /** Fewer living units than this at the checkpoint and the world did not fight the way the figure assumes. */
  minLiving: number;
  /** The sun's shadow pass alone, per living unit, and its own band (GH-1411 follow-up). */
  shadowPerUnit: number;
  shadowTolerance: number;
  /** The empty scene's shadow calls may not exceed this (a ceiling only, as `maxEmptyCalls`). */
  maxEmptyShadowCalls: number;
}

/**
 * Measured 2026-11-19, `high`, census mode (docs/PERFORMANCE.md, "The 300-unit figure, reconciled"): the same counts on
 * SwiftShader (the CI rasteriser, two runs) and on ANGLE/Metal (M3 Pro, four pages), so one budget serves both.
 *
 * The band is +-5%, not wider, because the count has no run-to-run noise to absorb (`censusRepeatsAgree`): what moves
 * it is a change. A sim or roster change that shifts which units survive to the checkpoint moves it a little; a
 * change that adds or drops a pass or a mesh per unit moves it by 8% or more (one call a unit is 8.1%). Re-pin with
 * the reason, like the golden hash; never widen to clear a red run.
 */
export const CENSUS_BUDGET: CensusBudget = {
  target: 300,
  // (3428 - 131) / 267 = 12.348: 3428 calls at the 300 checkpoint, 267 living at tick 135, over an empty scene of 131.
  // Read identically on SwiftShader (two runs) and on ANGLE/Metal (two runs, DPR 1 and DPR 2): a count, not a time.
  perUnit: 3297 / 267,
  tolerance: 0.05,
  // 131 measured; the ceiling leaves room for a prop or two on the bench map, not for a new full-screen pass.
  maxEmptyCalls: 145,
  minLiving: 200,
  // (1031 - 31) / 267 = 3.745: 1031 of the 3428 calls are the sun's depth pass, 31 of them in the empty scene. Read on
  // SwiftShader, two pages, to the call. +-2%, tighter than the total's 5%, because this figure is the one a shadow-only
  // change moves without moving the total much: the two survivors of the first falsification (infantry ramp meshes not
  // casting, -22 calls; vehicle ramp meshes, -30) are 2.2% and 3.0% of it. The colour and AO passes are the remainder
  // (8.603 a unit) and are held through the total.
  shadowPerUnit: 1000 / 267,
  shadowTolerance: 0.02,
  // 31 measured, as `maxEmptyCalls` leaves room for a prop or two.
  maxEmptyShadowCalls: 35,
};

export interface CensusReading {
  emptyCalls: number;
  calls: number;
  triangles: number;
  living: number;
  tickCount: number;
  perUnit: number;
  /** Of `calls`, those inside `shadowMap.render`; the empty scene's likewise. */
  shadowCalls: number;
  emptyShadowCalls: number;
  shadowPerUnit: number;
}

export type CensusVerdict =
  | { kind: 'pass'; reading: CensusReading; lines: string[] }
  | { kind: 'over-budget'; reading: CensusReading; lines: string[] }
  /** The instrument failed: an unstable count, a missing checkpoint, a world that did not fight. Exit 2, never 0. */
  | { kind: 'instrument'; lines: string[] };

/** The count may move between the census frames by at most this fraction. It does move, deterministically: measured
 *  2026-11-19, `low` at the 150 checkpoint read 1280 / 1280 / 1281 on SwiftShader and on Metal alike, every repeat (an FX
 *  instance retiring at a frame boundary on the frame clock). Triangles move more (a few hundred in 15.6 M) and are
 *  reported, never held. What the gate holds instead is the count's REPRODUCIBILITY: `censusRepeatsAgree`. */
export const MAX_FRAME_SPREAD = 0.01;

function spread(c: DrawCensus): number {
  if (c.calls.length === 0) return Number.POSITIVE_INFINITY;
  const lo = Math.min(...c.calls);
  const hi = Math.max(...c.calls);
  return lo > 0 ? (hi - lo) / lo : Number.POSITIVE_INFINITY;
}

/**
 * Two pages of the same census (same frames, same dt, same ticks) must read the SAME first-frame count, to the call:
 * a presentation that depends on wall time, load or anything outside the sim clock and the frame dt shows here, and a
 * gate on a count that is not reproducible is a gate on noise. Null when they agree; otherwise the lines to print.
 */
export function censusRepeatsAgree(reports: readonly BackendReport[], target: number): string[] | null {
  if (reports.length < 2) return null;
  const key = (r: BackendReport): string => {
    const cp = r.checkpoints.find((c) => c.target === target);
    return (
      `empty ${r.emptyCensus.calls[0]} (shadow ${r.emptyCensus.shadowCalls[0]}), target ${target} ` +
      `${cp === undefined ? 'missing' : `${cp.census.calls[0]} (shadow ${cp.census.shadowCalls[0]}) at ${cp.livingAtMeasure} living`}`
    );
  };
  const keys = reports.map(key);
  if (keys.every((k) => k === keys[0])) return null;
  return ['the census did not reproduce across pages of the same run (a defect to find, not a band to widen):', ...keys.map((k, i) => `  page ${i + 1}: ${k}`)];
}

/** Pure: the verdict on one census-mode report. `pageErrors` are the page's `pageerror` and `console.error` lines. */
export function censusVerdict(report: BackendReport, budget: CensusBudget, pageErrors: readonly string[]): CensusVerdict {
  const lines: string[] = [];
  if (!Number.isFinite(budget.perUnit) || !Number.isFinite(budget.maxEmptyCalls) || !Number.isFinite(budget.shadowPerUnit) || !Number.isFinite(budget.maxEmptyShadowCalls)) {
    return { kind: 'instrument', lines: ['the census budget is not pinned (a NaN in CENSUS_BUDGET)'] };
  }
  if (pageErrors.length > 0) {
    return {
      kind: 'instrument',
      lines: [
        `${pageErrors.length} page error(s); a unit whose GLB failed to load draws a proxy box and its count is not the shipped one:`,
        ...pageErrors.slice(0, 10).map((e) => `  ${e}`),
      ],
    };
  }
  const cp = report.checkpoints.find((c) => c.target === budget.target);
  if (cp === undefined) return { kind: 'instrument', lines: [`no checkpoint at target ${budget.target}`] };
  if (spread(report.emptyCensus) > MAX_FRAME_SPREAD || spread(cp.census) > MAX_FRAME_SPREAD) {
    return {
      kind: 'instrument',
      lines: [
        `the census moved more than ${(MAX_FRAME_SPREAD * 100).toFixed(0)}% between frames with no tick between them:`,
        `  empty calls ${report.emptyCensus.calls.join(', ')}; target ${budget.target} calls ${cp.census.calls.join(', ')}`,
      ],
    };
  }
  if (cp.livingAtMeasure < budget.minLiving) {
    return { kind: 'instrument', lines: [`only ${cp.livingAtMeasure} living at target ${budget.target} (floor ${budget.minLiving})`] };
  }
  const emptyCalls = report.emptyCensus.calls[0];
  const calls = cp.census.calls[0];
  const perUnit = (calls - emptyCalls) / cp.livingAtMeasure;
  const shadowCalls = cp.census.shadowCalls[0];
  const emptyShadowCalls = report.emptyCensus.shadowCalls[0];
  const shadowPerUnit = (shadowCalls - emptyShadowCalls) / cp.livingAtMeasure;
  const reading: CensusReading = {
    emptyCalls,
    calls,
    triangles: cp.census.triangles[0],
    living: cp.livingAtMeasure,
    tickCount: cp.tickCount,
    perUnit,
    shadowCalls,
    emptyShadowCalls,
    shadowPerUnit,
  };
  const lo = budget.perUnit * (1 - budget.tolerance);
  const hi = budget.perUnit * (1 + budget.tolerance);
  lines.push(
    `target ${budget.target}: ${reading.living} living at tick ${reading.tickCount}; calls ${calls} (empty scene ${emptyCalls}); ` +
      `triangles ${reading.triangles}`,
    `per living unit: ${perUnit.toFixed(3)} calls (band ${lo.toFixed(3)}-${hi.toFixed(3)}, pinned ${budget.perUnit.toFixed(3)} +-${(budget.tolerance * 100).toFixed(0)}%)`,
    `empty scene: ${emptyCalls} calls (ceiling ${budget.maxEmptyCalls})`
  );
  let over = false;
  if (perUnit > hi) {
    over = true;
    lines.push(`OVER: ${perUnit.toFixed(3)} calls per unit is above ${hi.toFixed(3)}: the units submit more than they did`);
  } else if (perUnit < lo) {
    over = true;
    lines.push(
      `UNDER: ${perUnit.toFixed(3)} calls per unit is below ${lo.toFixed(3)}: units that stopped drawing read as a saving; ` +
        'if it is a real one, re-pin CENSUS_BUDGET with the reason'
    );
  }
  const slo = budget.shadowPerUnit * (1 - budget.shadowTolerance);
  const shi = budget.shadowPerUnit * (1 + budget.shadowTolerance);
  lines.push(
    `shadow pass: ${shadowCalls} calls (empty scene ${emptyShadowCalls}); per living unit ${shadowPerUnit.toFixed(3)} ` +
      `(band ${slo.toFixed(3)}-${shi.toFixed(3)}, pinned ${budget.shadowPerUnit.toFixed(3)} +-${(budget.shadowTolerance * 100).toFixed(0)}%); ` +
      `colour and AO passes ${(perUnit - shadowPerUnit).toFixed(3)} per unit`
  );
  if (shadowPerUnit > shi) {
    over = true;
    lines.push(`OVER: the shadow pass submits ${shadowPerUnit.toFixed(3)} calls per unit, above ${shi.toFixed(3)}: a second caster, or a mesh that began to cast`);
  } else if (shadowPerUnit < slo) {
    over = true;
    lines.push(
      `UNDER: the shadow pass submits ${shadowPerUnit.toFixed(3)} calls per unit, below ${slo.toFixed(3)}: a unit mesh stopped casting ` +
        '(calls moved between passes keep the total in its band and show here); if it is a real saving, re-pin with the reason'
    );
  }
  if (emptyShadowCalls > budget.maxEmptyShadowCalls) {
    over = true;
    lines.push(`OVER: the empty scene's shadow pass submits ${emptyShadowCalls} calls, above its ceiling ${budget.maxEmptyShadowCalls}`);
  }
  if (emptyCalls > budget.maxEmptyCalls) {
    over = true;
    lines.push(`OVER: the empty scene submits ${emptyCalls} calls, above its ceiling ${budget.maxEmptyCalls}`);
  }
  return over ? { kind: 'over-budget', reading, lines } : { kind: 'pass', reading, lines };
}
