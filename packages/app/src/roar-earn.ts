/**
 * How Roar coins are earned (GH-317). Every payout is LIFETIME: it is recorded in
 * the wallet (`lions.roar`'s `earn`), survives "New campaign" and `?fresh`, and
 * never pays twice. The lead approved this table on 4 Nov 2026:
 *
 *   welcome issue         100   once, on the first campaign victory (never before play)
 *   first win of a mission 10   the first victory ever on the account, per mission
 *   a new star             5    per star, only when the lifetime best rises
 *   campaign complete     100   once, on the win that finishes the campaign
 *   replays, Conduct points, time, losses, versus: 0
 *
 * That caps a lifetime at 100 + 10 per mission + 5 per star + 100: 830 coins over
 * the 29 missions and the 68 stars the playtest ladder reaches, and one campaign
 * buys the dearest unit in the Stores (800). `roar_earn.test.ts` pins that against
 * the ladder (gate G-E2). Conduct is paid through the second star (the Conduct
 * line), so a Conduct point pays nothing of its own.
 *
 * Coins and credits stay apart (spec guard G3): credits are the wage, paid on every
 * win by `payMission`; coins are a lifetime bonus. Nothing here touches the brigade
 * account (G-E4), and nothing here is read from the ledger's stars: a win pays by
 * the RUN's stars, so loading or importing a save slot earns nothing (G-E3).
 */
import { EARN, MAX_STARS, roarEarn, roarBackfill, worldMissionIds } from '@lions/economy';
import type { EarnAward, VictoryWin } from '@lions/economy';
import type { BrigadeAccount } from './brigade-account';
import type { ParsedWorld } from './campaign';
import type { CampaignLedger, LedgerStore, VictoryWrite } from './ledger-store';
import { spendable } from './roar-wallet';

/** The earn table and its rules live in `@lions/economy` (GH-1075 A0); re-exported so no caller changes. */
export { EARN, MAX_STARS, roarEarn, roarBackfill, worldMissionIds };
export type { EarnAward, VictoryWin };

/** What `settleVictory` managed, for the end screen. */
export interface VictorySettle {
  write: VictoryWrite;
  /** What the win paid, and only if the write was kept: a refused write earned nothing. */
  awards: EarnAward[];
  total: number;
  /** Coins on hand after the win (before it, if the write was refused). */
  balance: number;
}

/**
 * The victory handler's whole write: the ledger, the brigade account's credit pay
 * and the wallet's coins, all or none (`writeVictory`). `account` is the credit pay
 * `payVictory` computed, untouched by coins (G-E4); `win` is `null` for a mission
 * that pays no coins (the tutorial, or a blocked store). `start` is the `mission/start` nonce a server-backed
 * store sends with the win (null until Task 2.12 wires it); the guest store ignores it.
 */
export function settleVictory(
  store: LedgerStore,
  v: { ledger: CampaignLedger; account: BrigadeAccount | null; win: VictoryWin | null; world: ParsedWorld; at: number; start: string | null }
): VictorySettle {
  const before = store.readRoar();
  const earned = v.win !== null ? roarEarn(before, v.win, v.world, v.at) : null;
  const owed = earned !== null && earned.awards.length > 0 ? earned : null;
  const write = store.recordVictory({ ledger: v.ledger, account: v.account, roar: owed !== null ? owed.wallet : null, win: v.win, start: v.start });
  if (write !== 'saved' || owed === null) return { write, awards: [], total: 0, balance: spendable(before) };
  return { write, awards: owed.awards, total: owed.total, balance: spendable(owed.wallet) };
}

/* `roarBackfill` moved to @lions/economy (GH-1075 A0); see the re-export above. */

/**
 * Settles an unsettled wallet's back-payment at boot (G-E3), before any slot or
 * import UI can swap the ledger: the first `readRoar` is what settles it, so it is
 * made here, against the ledger the player actually earned.
 */
export function settleRoarAtBoot(store: Pick<LedgerStore, 'readRoar'>): void {
  store.readRoar();
}
