// pnpm balance — headless battle sim. Runs the GDD §5.7 backtest targets
// against the shipped data/units roster and prints win rates and Pk values.
// Exit code 1 when any target is missed: the combat model is the product,
// and these numbers are its acceptance test.

import { atgmPk, apsIntercept, urbanRatio, lanchester, airContested } from '../backtest/targets';
import { report } from '../backtest/harness';

const t0 = Date.now();
const results = [atgmPk(), apsIntercept(), urbanRatio(), lanchester(), airContested()];
const ok = report(results);
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(ok ? 0 : 1);
