import type { LedgerData } from '@lions/sim';
import { gateRequirement } from './gate';
import { townProgress, type ParsedWorld } from './world';

/** Every region that has missions is finished, and there is at least one.
 *  Equivalent to the app's `regionProgress(...).status === 'complete'` over each
 *  region with missions: `gateSentence` is null exactly when `gateRequirement` is.
 *  A CUT world (the desktop demo's, GH-1418) is never complete: finishing the demo
 *  is not winning the war, so it says no closing exchange, shows no "every front is
 *  closed" line and pays no campaign bonus (which would then never be paid again). */
export function campaignComplete(world: ParsedWorld, ledger: LedgerData | undefined): boolean {
  if (world.cut === true) return false;
  let any = false;
  for (const region of world.regions) {
    let done = 0;
    let total = 0;
    for (const town of region.towns) {
      const p = townProgress(town, ledger);
      done += p.done;
      total += p.total;
    }
    if (total === 0) continue;
    if (gateRequirement(region.unlock, ledger) !== null) return false;
    if (done !== total) return false;
    any = true;
  }
  return any;
}
