/**
 * What a device's claim proves and what it may raise (GH-1075 A2). Pure.
 */
import type { LedgerData } from '@lions/sim';
import { MAX_STARS, evidenceFromLedger, type EarnEvidence } from './earn';
/** The `challenge` field as a record writes it (GH-1395): present only when true. A local copy of challenge-earn.ts's, so
 *  this barrel-exported module never imports that one (the entry chunk would carry it). */
const challengeFlag = (on: boolean): { challenge?: true } => (on ? { challenge: true } : {});
import type { EarnMission, EarnRecord, RoarWallet } from './wallet';
import { worldMissionIds, type ParsedWorld } from './world';

const clamp = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(MAX_STARS, Math.floor(n))) : 0);

type Mission = EarnMission;

/** Folds `m` into `missions[id]` as an OWN property: an id like `constructor` or `__proto__` reads and writes no inherited slot.
 *  GH-1395: `challenge` is ORed, never taken from the later side, so a guest wallet claimed into an account, or two devices,
 *  can neither double the challenge coin nor clear the flag that stops a second one. */
function mergeMission(missions: Record<string, Mission>, id: string, m: Mission): void {
  const p = Object.hasOwn(missions, id) ? missions[id] : undefined;
  const challenge = p?.challenge === true || m.challenge === true;
  const value: Mission = p
    ? { won: p.won || m.won, stars: Math.max(p.stars, m.stars), ...challengeFlag(challenge) }
    : { won: m.won, stars: m.stars, ...challengeFlag(challenge) };
  Object.defineProperty(missions, id, { value, enumerable: true, configurable: true, writable: true });
}

/** Per mission the max of `won` and `stars` and the OR of `challenge`; `welcomed` and `campaignDone` ORed; `backfilled` from `a`. */
export function maxRecord(a: EarnRecord, b: EarnRecord): EarnRecord {
  const missions: Record<string, Mission> = { ...a.missions };
  for (const [id, m] of Object.entries(b.missions)) {
    mergeMission(missions, id, m);
  }
  return { welcomed: a.welcomed || b.welcomed, campaignDone: a.campaignDone || b.campaignDone, backfilled: a.backfilled, missions };
}

/** `record` raised by what `earnDifference` PAID (`raised`) and nothing else. */
export function raiseBy(record: EarnRecord, raised: EarnEvidence & { welcomed: boolean }): EarnRecord {
  const missions: Record<string, Mission> = { ...record.missions };
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
 * mission, stars clamped 0 to 3, `challenge` ORed (GH-1395; `earnDifference` pays it only for a
 * mission in the challenge index). `campaignDone` if any source says so.
 */
export function claimEvidence(c: { wallet: RoarWallet; ledgers: LedgerData[]; world: ParsedWorld }): EarnEvidence {
  const missions: Record<string, Mission> = {};
  let campaignDone = c.wallet.earn.campaignDone;
  const take = (id: string, m: Mission): void => {
    const p = missions[id];
    const challenge = p?.challenge === true || m.challenge === true;
    missions[id] = { won: (p?.won ?? false) || m.won, stars: Math.max(p?.stars ?? 0, clamp(m.stars)), ...challengeFlag(challenge) };
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
