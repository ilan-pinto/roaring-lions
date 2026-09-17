// pnpm balance — headless battle sim. Runs the GDD §5.7 backtest targets
// against the shipped data/units roster and prints win rates and Pk values.
// Exit code 1 when any target is missed: the combat model is the product,
// and these numbers are its acceptance test.

import { atgmPk, apsIntercept, urbanRatio, lanchester, airContested } from '../backtest/targets';
import { report, unitsAtMaxTier, withRoster } from '../backtest/harness';

function runTargets() {
  return [atgmPk(), apsIntercept(), urbanRatio(), lanchester(), airContested()];
}

const t0 = Date.now();
// Base table: the shipped roster, exactly as before -- nothing here reads the
// max-tier roster, so this table's numbers are unchanged from today.
const baseResults = runTargets();
const baseOk = report(baseResults, 'base');
// Max-tier table (brigade economy Task 5): every KDF type patched to its own
// maximum tiers for the duration of this one call. `withRoster` swaps `units`/
// `MBT_BARE` in `harness.ts` for the callback and restores the base roster
// afterward, so the targets above never see the max-tier roster and this table
// never leaks into a later run of this same process.
const maxTierResults = withRoster(unitsAtMaxTier, runTargets);
const maxTierOk = report(maxTierResults, 'max tier');
const ok = baseOk && maxTierOk;
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(ok ? 0 : 1);
