// The order a campaign is PLAYED in, as the board offers it, for the harness's credit walk.
//
// world.json lists towns in rank order, and a town can be listed ahead of the mission that opens it: Ein Qasab is
// listed FIRST in Naharin (so the Lt Col rank by position lands on it) but its `unlock` is
// `wadi_halam_3_counterraid` (GH-912, G1). Walking the LISTED order asks `payVictory` to pay missions the board
// would not yet offer, and every credit walk read "is not open in world order". This asks the app's own
// `missionOpen` (GH-330, guard G-A: it reads `nextMissionOf`, which reads the town and region gates) for the first
// listed mission that is open and not done, plays it, and goes round again. No second implementation of the gate.
// Where nothing is gated the result is the listed order, byte for byte.
import type { LedgerData } from '@lions/sim';
import { missionOpen, type ParsedWorld } from '../../../packages/app/src/campaign';

/** `listed` in play order. `stuck` names the missions left over if nothing listed was open at some step (a
 *  gate that can never open), appended in listed order so a caller can still print them. */
export function playOrderOf(world: ParsedWorld, listed: readonly string[]): { order: string[]; stuck: string[] } {
  const order: string[] = [];
  let ledger: LedgerData = {};
  while (order.length < listed.length) {
    const next = listed.find((id) => !order.includes(id) && missionOpen(world, id, ledger));
    if (next === undefined) return { order: [...order, ...listed.filter((id) => !order.includes(id))], stuck: listed.filter((id) => !order.includes(id)) };
    order.push(next);
    ledger = { ...ledger, 'campaign.completed_missions': [...order] };
  }
  return { order, stuck: [] };
}
