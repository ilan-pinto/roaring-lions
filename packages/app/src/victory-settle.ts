/**
 * The victory handler's whole write (GH-317; moved out of `roar-earn.ts` for GH-1395): the ledger, the brigade
 * account's credit pay and the wallet's coins, all or none (`writeVictory`). Its own module so it is loaded LAZILY with
 * the campaign code (`./posture` re-exports it through `./challenge`): the entry chunk sits at the `webgpu:bundle`
 * ceiling, and only a campaign victory ever settles. The earn table itself stays in `@lions/economy` (`roarEarn`).
 *
 * GH-1395 (lead ruling D1): a win that beat its challenge (`win.challenge`) also pays the challenge's 10 Roar coins,
 * once per account (`payChallenge`: the wallet's lifetime flag), in the SAME write as the rest of the win.
 */
import { roarEarn, type EarnAward, type VictoryWin } from '@lions/economy';
// A subpath, never the barrel: through `@lions/economy`'s index the coin rule would ride the entry chunk's copy of it.
import { payChallenge } from '@lions/economy/challenge-earn';
import type { BrigadeAccount } from './brigade-account';
import type { ParsedWorld } from './campaign';
import type { CampaignLedger, LedgerStore, VictoryWrite } from './ledger-store';
import { spendable } from './roar-wallet';

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
 * `account` is the credit pay `payVictory` computed, untouched by coins (G-E4); `win` is `null` for a mission that pays
 * no coins (the tutorial, or a blocked store). `start` is the `mission/start` nonce a server-backed store sends with the
 * win; the guest store ignores it.
 */
export function settleVictory(
  store: LedgerStore,
  v: { ledger: CampaignLedger; account: BrigadeAccount | null; win: VictoryWin | null; world: ParsedWorld; at: number; start: string | null }
): VictorySettle {
  const before = store.readRoar();
  let earned = v.win !== null ? roarEarn(before, v.win, v.world, v.at) : null;
  if (v.win?.challenge === true && earned !== null) {
    const c = payChallenge(earned.wallet, v.win.missionId, v.at);
    if (c.award !== null) earned = { wallet: c.wallet, awards: [...earned.awards, c.award], total: earned.total + c.award.coins };
  }
  const owed = earned !== null && earned.awards.length > 0 ? earned : null;
  const write = store.recordVictory({ ledger: v.ledger, account: v.account, roar: owed !== null ? owed.wallet : null, win: v.win, start: v.start });
  if (write !== 'saved' || owed === null) return { write, awards: [], total: 0, balance: spendable(before) };
  // The balance is what the store holds AFTER the write: a server-backed store with no `start` nonce queues a victory
  // that moves no coin (§0.48), so the local `roarEarn` must not be reported as paid. A guest's read equals `owed.wallet`.
  const after = spendable(store.readRoar());
  if (after <= spendable(before)) return { write, awards: [], total: 0, balance: after };
  return { write, awards: owed.awards, total: owed.total, balance: after };
}
