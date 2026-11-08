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
import type { LedgerData } from '@lions/sim';
import { campaignComplete } from './campaign-complete';
import { grantFree, type EarnRecord, type EarnSource, type RoarWallet } from './wallet';
import { worldMissionIds, type ParsedWorld } from './world';

/** What each kind of payout is worth. The Stores' copy and the debrief read these. */
export const EARN = { welcome: 100, firstWin: 10, star: 5, campaign: 100 } as const;
/** The most a mission grades to. */
export const MAX_STARS = 3;

/** One payout. `star` carries the number of new stars it paid for. */
export interface EarnAward {
  source: EarnSource;
  coins: number;
  missionId?: string;
  stars?: number;
}

/** A won campaign mission, as the victory handler knows it. */
export interface VictoryWin {
  missionId: string;
  /** THIS run's grade (the runtime's), never the ledger's best. */
  stars: number;
  /** The ledger as this win leaves it: the campaign is complete or it is not. */
  ledger: LedgerData;
}

const clampStars = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(MAX_STARS, Math.floor(n))) : 0);

/**
 * What a victory pays, and the wallet after it. Pure. A mission `world.json` does
 * not name (the tutorial, or any mission off the map) pays nothing, and so does a
 * replay that raises no star. The same wallet comes back, by identity, when nothing
 * is owed.
 */
export function roarEarn(w: RoarWallet, win: VictoryWin, world: ParsedWorld, at: number): { wallet: RoarWallet; awards: EarnAward[]; total: number } {
  const none = { wallet: w, awards: [] as EarnAward[], total: 0 };
  if (!worldMissionIds(world).includes(win.missionId)) return none;
  const prev = w.earn.missions[win.missionId] ?? { won: false, stars: 0 };
  const stars = clampStars(win.stars);
  const awards: EarnAward[] = [];
  if (!w.earn.welcomed) awards.push({ source: 'welcome', coins: EARN.welcome });
  if (!prev.won) awards.push({ source: 'first_win', coins: EARN.firstWin, missionId: win.missionId });
  const newStars = Math.max(0, stars - prev.stars);
  if (newStars > 0) awards.push({ source: 'star', coins: EARN.star * newStars, missionId: win.missionId, stars: newStars });
  const finishes = !w.earn.campaignDone && campaignComplete(world, win.ledger);
  if (finishes) awards.push({ source: 'campaign', coins: EARN.campaign });
  if (awards.length === 0) return none;

  let wallet: RoarWallet = {
    ...w,
    earn: {
      welcomed: true,
      campaignDone: w.earn.campaignDone || finishes,
      backfilled: w.earn.backfilled,
      missions: { ...w.earn.missions, [win.missionId]: { won: true, stars: Math.max(prev.stars, stars) } },
    },
  };
  for (const a of awards) {
    wallet = grantFree(wallet, a.coins, (id, coins) => ({ kind: 'earn', id, at, coins, source: a.source, ...(a.missionId !== undefined ? { missionId: a.missionId } : {}) }), at);
  }
  return { wallet, awards, total: awards.reduce((n, a) => n + a.coins, 0) };
}

/** What a ledger proves was won: the input of the back-payment's difference loop. */
export interface EarnEvidence {
  missions: Readonly<Record<string, { won: boolean; stars: number }>>;
  campaignDone: boolean;
}

/**
 * The wins a campaign ledger holds: world missions in `campaign.completed_missions`
 * only, each `won: true`, its stars clamped 0 to 3 from `campaign.mission_results`.
 */
export function evidenceFromLedger(ledger: LedgerData, world: ParsedWorld): EarnEvidence {
  const doneRaw = ledger['campaign.completed_missions'];
  const done = new Set(Array.isArray(doneRaw) ? doneRaw.filter((m): m is string => typeof m === 'string') : []);
  const results = ledger['campaign.mission_results'];
  const missions: Record<string, { won: boolean; stars: number }> = {};
  for (const id of worldMissionIds(world)) {
    if (!done.has(id)) continue;
    missions[id] = { won: true, stars: clampStars(results?.[id]?.stars ?? 0) };
  }
  return { missions, campaignDone: campaignComplete(world, ledger) };
}

/**
 * What the table owes for `evidence` beyond what `record` already holds, and the
 * record once paid. Pure; ids are taken in `worldMissionIds` order, and an id off
 * the world pays nothing.
 */
export function earnDifference(record: EarnRecord, evidence: EarnEvidence, world: ParsedWorld): { coins: number; record: EarnRecord } {
  const missions: Record<string, { won: boolean; stars: number }> = { ...record.missions };
  let coins = 0;
  let anyWin = false;
  for (const id of worldMissionIds(world)) {
    const ev = evidence.missions[id];
    if (!ev || !ev.won) continue;
    anyWin = true;
    const prev = missions[id] ?? { won: false, stars: 0 };
    const stars = clampStars(ev.stars);
    // Only the difference between the lifetime record and what `earn` holds.
    if (!prev.won) coins += EARN.firstWin;
    coins += EARN.star * Math.max(0, stars - prev.stars);
    missions[id] = { won: true, stars: Math.max(prev.stars, stars) };
  }
  if (anyWin && !record.welcomed) coins += EARN.welcome;
  const finishes = evidence.campaignDone && !record.campaignDone;
  if (finishes) coins += EARN.campaign;
  return { coins, record: { welcomed: record.welcomed || anyWin, campaignDone: record.campaignDone || finishes, backfilled: record.backfilled, missions } };
}

/**
 * The one-time back-payment (GH-317, lead ruling 5 Nov): a wallet that is being
 * CREATED is paid, from the campaign ledger as it stands, what the earn table
 * would have paid for the wins already on it -- the welcome issue (if any mission
 * is won), 10 a won mission, 5 a star at its best, 100 if the campaign is done.
 * The tutorial and any mission off the map pay nothing, as in `roarEarn`.
 *
 * Pure. It is called by `loadRoar` only when the key is absent (`ledger-store.ts`),
 * never on a slot load or import, and it fills `earn` exactly as winning would
 * (`welcomed`, `campaignDone`, `missions`), so it cannot pay twice and a later
 * replay pays only for a NEW star. One receipt, `source: 'backfill'`. The coins
 * are free coins; `paid` is untouched.
 */
export function roarBackfill(w: RoarWallet, ledger: LedgerData, world: ParsedWorld, at: number): RoarWallet {
  const r = earnDifference(w.earn, evidenceFromLedger(ledger, world), world);
  const base: RoarWallet = { ...w, earn: { ...r.record, backfilled: true } };
  return grantFree(base, r.coins, (id, c) => ({ kind: 'earn', id, at, coins: c, source: 'backfill' }), at);
}
