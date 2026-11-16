/**
 * The challenge coin (GH-1395, lead ruling D1, 16 Nov 2026): a beaten challenge pays 10 Roar coins ONCE PER ACCOUNT,
 * recorded as `challenge: true` on the wallet's lifetime mission record, and only for a mission in @lions/data's
 * challenge index, whatever a client reports. It pays no credits (D3) and is not a star (D2): `starsEarned`, the unit
 * gates and `roarEarn`'s star table never see it.
 *
 * Its own module, apart from `earn.ts`, on purpose: `roarEarn` and `earnDifference` are on the app's entry chunk
 * (the boot back-payment, the signed-in view), which sits at the `webgpu:bundle` ceiling, while this is called only by
 * the lazily loaded victory settle (`packages/app/src/victory-settle.ts`) and the Worker (`account/victory.ts`,
 * `account/claim.ts`). So the entry chunk carries none of it.
 *
 * The lifetime cap it adds: 10 x the challenge index's length (60 for the six-mission pilot), on top of `earn.ts`'s 830;
 * the G-E2 pin reads the count from the index.
 */
import { challengeMissionIds, hasChallenge } from '@lions/data';
import type { EarnAward } from './earn';
import { grantFree, type EarnRecord, type RoarWallet } from './wallet';

/** The `challenge` field as a record writes it: present only when true, so a record that never paid one keeps its bytes. */
export const challengeFlag = (on: boolean): { challenge?: true } => (on ? { challenge: true } : {});

/** What a beaten challenge is worth (D1), a literal. */
export const CHALLENGE_COINS = 10;

/**
 * Pays `missionId`'s challenge into `w`, once: nothing (the same wallet back, award null) for a mission with no
 * challenge or one whose lifetime record already holds the flag. Pure. Call it AFTER `roarEarn` for the same win, so the
 * mission's record exists; its `won` and `stars` are kept as they are.
 */
export function payChallenge(w: RoarWallet, missionId: string, at: number): { wallet: RoarWallet; award: EarnAward | null } {
  const prev = Object.hasOwn(w.earn.missions, missionId) ? w.earn.missions[missionId] : undefined;
  if (!hasChallenge(missionId) || prev?.challenge === true) return { wallet: w, award: null };
  const record = { won: prev?.won ?? true, stars: prev?.stars ?? 0, ...challengeFlag(true) };
  const marked: RoarWallet = { ...w, earn: { ...w.earn, missions: { ...w.earn.missions, [missionId]: record } } };
  const wallet = grantFree(marked, CHALLENGE_COINS, (id, coins) => ({ kind: 'earn', id, at, coins, source: 'challenge', missionId }), at);
  return { wallet, award: { source: 'challenge', coins: CHALLENGE_COINS, missionId } };
}

/**
 * The Worker's claim (GH-1075 A2): the challenge coins a device's wallet proves beyond the member's LIFETIME record,
 * and the record with those flags set. Only an indexed mission counts, each once, so a forged flag on every mission is
 * worth at most 10 x the index; a ledger or save slot proves none (only a wallet's flag does). Pure.
 */
export function challengeDifference(lifetime: EarnRecord, device: RoarWallet): { coins: number; ids: string[]; record: EarnRecord } {
  const ids = challengeMissionIds.filter(
    (id) => Object.hasOwn(device.earn.missions, id) && device.earn.missions[id]?.challenge === true && lifetime.missions[id]?.challenge !== true,
  );
  return { coins: CHALLENGE_COINS * ids.length, ids, record: withChallengeFlags(lifetime, ids) };
}

/** `record` with the challenge flag set on each of `ids` (a mission it does not hold yet is added, won). */
export function withChallengeFlags(record: EarnRecord, ids: readonly string[]): EarnRecord {
  if (ids.length === 0) return record;
  const missions = { ...record.missions };
  for (const id of ids) {
    const p = Object.hasOwn(missions, id) ? missions[id] : undefined;
    missions[id] = { won: p?.won ?? true, stars: p?.stars ?? 0, ...challengeFlag(true) };
  }
  return { ...record, missions };
}
