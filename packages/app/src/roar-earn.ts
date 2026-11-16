/**
 * How Roar coins are earned (GH-317). Every payout is LIFETIME: it is recorded in
 * the wallet (`lions.roar`'s `earn`), survives "New campaign" and `?fresh`, and
 * never pays twice. The lead approved this table on 4 Nov 2026:
 *
 *   welcome issue         100   once, on the first campaign victory (never before play)
 *   first win of a mission 10   the first victory ever on the account, per mission
 *   a new star             5    per star, only when the lifetime best rises
 *   campaign complete     100   once, on the win that finishes the campaign
 *   a beaten challenge     10   once per account, per mission with one (GH-1395, the lead, 16 Nov 2026)
 *   replays, Conduct points, time, losses, versus: 0
 *
 * That caps a lifetime at 100 + 10 per mission + 5 per star + 100 + 10 per challenge:
 * 830 coins over the 29 missions and the 68 stars the playtest ladder reaches, 890 with
 * the six-mission challenge pilot, and one campaign buys the dearest unit in the Stores
 * (800). `roar_earn.test.ts` pins that against the ladder and the challenge index (gate
 * G-E2). Conduct is paid through the second star (the Conduct line), so a Conduct point
 * pays nothing of its own. Whether a run beat its challenge is `challenge.ts`'s call.
 *
 * Coins and credits stay apart (spec guard G3): credits are the wage, paid on every
 * win by `payMission`; coins are a lifetime bonus. Nothing here touches the brigade
 * account (G-E4), and nothing here is read from the ledger's stars: a win pays by
 * the RUN's stars, so loading or importing a save slot earns nothing (G-E3).
 */
import { EARN, MAX_STARS, roarEarn, roarBackfill, worldMissionIds } from '@lions/economy';
import type { EarnAward, VictoryWin } from '@lions/economy';
import type { LedgerStore } from './ledger-store';

/** The earn table and its rules live in `@lions/economy` (GH-1075 A0); re-exported so no caller changes. */
export { EARN, MAX_STARS, roarEarn, roarBackfill, worldMissionIds };
export type { EarnAward, VictoryWin };

/* `settleVictory` and `VictorySettle` moved to `victory-settle.ts` (GH-1395), loaded lazily with the campaign code so the
   entry chunk never carries them; the type is re-exported here so no caller changes. */
export type { VictorySettle } from './victory-settle';

/* `roarBackfill` moved to @lions/economy (GH-1075 A0); see the re-export above. */

/**
 * Settles an unsettled wallet's back-payment at boot (G-E3), before any slot or
 * import UI can swap the ledger: the first `readRoar` is what settles it, so it is
 * made here, against the ledger the player actually earned.
 */
export function settleRoarAtBoot(store: Pick<LedgerStore, 'readRoar'>): void {
  store.readRoar();
}
