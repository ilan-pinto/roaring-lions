// pnpm balance — headless battle sim. Runs the GDD §5.7 backtest targets
// against the shipped data/units roster and prints win rates and Pk values.
// Exit code 1 when any target is missed: the combat model is the product,
// and these numbers are its acceptance test.

import { branchedTracks, units as shipped, type BranchPick, type UpgradableUnit } from '@lions/data';
import { atgmPk, apsIntercept, standoff, urbanRatio, urbanSmokeStep, urbanAttackFormation, lanchester, airContested, airDefence, ambush, raidEscape, raidCaught } from '../backtest/targets';
import { report, unitsAtMaxTier, withRoster, type TargetResult } from '../backtest/harness';

/** Every target, one entry each, so a table can run them one at a time. */
const TARGETS: readonly (() => TargetResult | TargetResult[])[] = [
  () => atgmPk(),
  () => apsIntercept(),
  () => standoff(),
  () => urbanRatio(),
  // `urbanSmokeStep` is not a §5.7 target -- §5.7 measures the model without
  // smoke -- but it runs in both tables so a tier cannot buy smoke a second step.
  () => urbanSmokeStep(),
  // `urbanAttackFormation` is not a §5.7 target either: it holds the Attack formation to the urban band, so
  // an order that names a formation cannot buy a ratio step the way a screen does (GH-859 P1a, D10).
  () => urbanAttackFormation(),
  () => lanchester(),
  () => airContested(),
  () => airDefence(),
  () => ambush(),
  () => raidEscape(),
  () => raidCaught(),
];

function runTargets(): TargetResult[] {
  return TARGETS.flatMap((f) => f());
}

/** The shipped units that branch a track (GH-1384). */
const BRANCHED = new Set(
  Object.values(shipped)
    .filter((u) => branchedTracks(u as unknown as UpgradableUnit).length > 0)
    .map((u) => u.id)
);

/** `roster`, recording every unit id a target READS off it (`units.<id>` in `targets.ts`), so the
 *  cross product below is taken over the branched units each target registers, never a list kept
 *  by hand beside `targets.ts`. */
function recording<R extends object>(roster: R, read: Set<string>): R {
  return new Proxy(roster, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') read.add(prop);
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}

/** Every pick vector over `ids` that is NOT uniform (the uniform two have their own tables). */
function mixedVectors(ids: readonly string[]): Record<string, BranchPick>[] {
  const out: Record<string, BranchPick>[] = [];
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    if (mask === 0 || mask === (1 << ids.length) - 1) continue;
    const v: Record<string, BranchPick> = {};
    ids.forEach((id, i) => (v[id] = mask & (1 << i) ? 2 : 1));
    out.push(v);
  }
  return out;
}

const t0 = Date.now();
// Base table: the shipped roster, exactly as before -- nothing here reads the
// max-tier roster, so this table's numbers are unchanged from today.
const baseResults = runTargets();
const baseOk = report(baseResults, 'base');
// Max-tier tables (brigade economy Task 5; GH-1384 §6.2): every KDF type patched to its own
// maximum tiers for the duration of one call, once per uniform branch vector. `withRoster` swaps
// `units`/`MBT_BARE` in `harness.ts` for the callback and restores the base roster afterward, so the
// targets above never see the max-tier roster and no table leaks into a later run of this process.
// The branch-1 run also records which branched units each target reads.
const readBy: Set<string>[] = TARGETS.map(() => new Set<string>());
// `withRoster` derives `MBT_BARE` off the roster BEFORE the target runs; that read is not the target's, so it is cleared.
const max1 = TARGETS.flatMap((f, i) =>
  withRoster(recording(unitsAtMaxTier(1), readBy[i]), () => {
    readBy[i].clear();
    return f();
  })
);
const max1Ok = report(max1, 'max tier, branch 1');
const max2Ok = report(withRoster(unitsAtMaxTier(2), runTargets), 'max tier, branch 2');
// GH-1384 §6.2: a branch can move a target the envelope passed, and uniform vectors do not cover a
// target that registers two or more branched units, so each such target also runs every MIXED
// vector over the branched units it read.
let mixedOk = true;
TARGETS.forEach((f, i) => {
  const ids = [...readBy[i]].filter((id) => BRANCHED.has(id)).sort();
  for (const v of mixedVectors(ids)) {
    const label = `max tier, mixed ${ids.map((id) => `${id}=${v[id]}`).join(' ')}`;
    const r = withRoster(unitsAtMaxTier(v), f);
    mixedOk = report(Array.isArray(r) ? r : [r], label) && mixedOk;
  }
});
const ok = baseOk && max1Ok && max2Ok && mixedOk;
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(ok ? 0 : 1);
