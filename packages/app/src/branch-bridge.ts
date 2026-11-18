/**
 * GH-1384 slice 1's one bridge, until the Garage draws the fork (the next slice): which branch the
 * Garage's and the Stores' existing Buy buy when the rung they buy is a BRANCHED tier, and which
 * branch their benefit lines and previews read for that rung. Branch 1 is the design's default
 * branch (the lead, Q8: the legacy default), authored as the one closer to the unit's job.
 *
 * It is a fresh, final buy (Q2) of branch 1, made through the economy's `buyBranch` and
 * `buyBranchWithCoins`, whose cross-store guard refuses the other branch: the bridge cannot put
 * both branches in one account. The fork replaces every read of this constant with the player's
 * own choice; `git grep GARAGE_BRANCH` lists them.
 */
import type { BranchPick } from '@lions/data';
import { shippedBranched, type CoinAsk } from '@lions/economy';

export const GARAGE_BRANCH: BranchPick = 1;


/** A coin ask with `branch: GARAGE_BRANCH` added when it names a branched tier (the economy
 *  refuses a branched tier asked for with no branch), and unchanged otherwise. */
export function withGarageBranch(ask: CoinAsk): CoinAsk {
  if (ask.kind !== 'tier' || ask.branch !== undefined) return ask;
  const fork = shippedBranched()[ask.unitId]?.[ask.track];
  return fork !== undefined && ask.tier >= fork.tier ? { ...ask, branch: GARAGE_BRANCH } : ask;
}
