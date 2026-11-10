/**
 * What a device's claim proves and what it may raise (GH-1075 A2). Pure.
 */
import type { LedgerData } from '@lions/sim';
import { MAX_STARS, evidenceFromLedger, type EarnEvidence } from './earn';
import type { EarnRecord, RoarWallet } from './wallet';
import { worldMissionIds, type ParsedWorld } from './world';

const clamp = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(MAX_STARS, Math.floor(n))) : 0);

type Mission = { won: boolean; stars: number };

/** Folds `m` into `missions[id]` as an OWN property: an id like `constructor` or `__proto__` reads and writes no inherited slot. */
function mergeMission(missions: Record<string, Mission>, id: string, m: Mission): void {
  const p = Object.hasOwn(missions, id) ? missions[id] : undefined;
  const value = p ? { won: p.won || m.won, stars: Math.max(p.stars, m.stars) } : { ...m };
  Object.defineProperty(missions, id, { value, enumerable: true, configurable: true, writable: true });
}

/** Per mission the max of `won` and `stars`; `welcomed` and `campaignDone` ORed; `backfilled` from `a`. */
export function maxRecord(a: EarnRecord, b: EarnRecord): EarnRecord {
  const missions: Record<string, { won: boolean; stars: number }> = { ...a.missions };
  for (const [id, m] of Object.entries(b.missions)) {
    mergeMission(missions, id, m);
  }
  return { welcomed: a.welcomed || b.welcomed, campaignDone: a.campaignDone || b.campaignDone, backfilled: a.backfilled, missions };
}

/** `record` raised by what `earnDifference` PAID (`raised`) and nothing else. */
export function raiseBy(record: EarnRecord, raised: EarnEvidence & { welcomed: boolean }): EarnRecord {
  const missions: Record<string, { won: boolean; stars: number }> = { ...record.missions };
  for (const [id, m] of Object.entries(raised.missions)) {
    mergeMission(missions, id, m);
  }
  return {
    welcomed: record.welcomed || raised.welcomed,
    campaignDone: record.campaignDone || raised.campaignDone,
    backfilled: record.backfilled,
    missions,
  };
}

/**
 * The best of every source: the wallet's own `earn` and the evidence of each ledger, per world
 * mission, stars clamped 0 to 3. `campaignDone` if any source says so.
 */
export function claimEvidence(c: { wallet: RoarWallet; ledgers: LedgerData[]; world: ParsedWorld }): EarnEvidence {
  const missions: Record<string, { won: boolean; stars: number }> = {};
  let campaignDone = c.wallet.earn.campaignDone;
  const take = (id: string, m: { won: boolean; stars: number }): void => {
    const p = missions[id];
    missions[id] = { won: (p?.won ?? false) || m.won, stars: Math.max(p?.stars ?? 0, clamp(m.stars)) };
  };
  const ids = worldMissionIds(c.world);
  for (const id of ids) {
    const m = c.wallet.earn.missions[id];
    if (m) take(id, m);
  }
  for (const l of c.ledgers) {
    const ev = evidenceFromLedger(l, c.world);
    for (const id of ids) {
      const m = ev.missions[id];
      if (m) take(id, m);
    }
    campaignDone = campaignDone || ev.campaignDone;
  }
  return { missions, campaignDone };
}

/** The coins a coupon body grants: a positive integer, else nothing. */
export function couponGrant(c: { coins?: unknown }): number {
  return typeof c.coins === 'number' && Number.isInteger(c.coins) && c.coins > 0 ? c.coins : 0;
}
