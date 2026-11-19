/**
 * The legacy owner's Switch and Return, on a GUEST's device (GH-1384 slice 2; design §4.2, §4.3; the
 * lead's Q8, Q11 and R12). `@lions/economy`'s `switchLegacy` and `returnLegacy` decide, as one pure
 * pair over the brigade account and the coin wallet; this module only reads both stores afresh and
 * writes both answers, ALL OR NONE: a refused wallet write puts the account back as it was read, as
 * `coupon-redeem.ts` does, so a Switch never moves one store without the other and a Return never
 * refunds one currency for a tier the other store still holds.
 *
 * A member's Switch and Return are server routes (the net and Worker slice): `main.ts` passes the
 * Garage these handlers for a guest store only.
 *
 * While the branch switch is closed the shipped branched table is empty, so `legacyOffers` is `{}` and
 * both actions refuse without a write.
 */
import { legacyOffer, returnLegacy, shippedBranched, switchLegacy, type BranchedTable, type CoinSplit } from '@lions/economy';
import type { LedgerStore } from './ledger-store';
import type { ForkLegacy } from './ui/garage-fork';

type Stores = Pick<LedgerStore, 'readAccount' | 'writeAccount' | 'readRoar' | 'writeRoar'>;

/** Unit -> track -> what its legacy owner is offered, for every branched (unit, track) that offers
 *  Switch or Return (a standing legacy marker). Empty when no marker stands. */
export function legacyOffers(
  account: ReturnType<Stores['readAccount']>,
  roar: ReturnType<Stores['readRoar']>,
  branched: BranchedTable = shippedBranched()
): Record<string, Record<string, ForkLegacy>> {
  const out: Record<string, Record<string, ForkLegacy>> = {};
  for (const [unitId, tracks] of Object.entries(branched)) {
    for (const track of Object.keys(tracks)) {
      const o = legacyOffer(account, roar, unitId, track, branched);
      if (o.canSwitch || o.canReturn) (out[unitId] ??= {})[track] = { canSwitch: o.canSwitch, canReturn: o.canReturn };
    }
  }
  return out;
}

export type LegacyOutcome = { ok: true; refund: { credits: number; coins: CoinSplit } } | { ok: false };

/** Switch or Return on (unit, track), off a FRESH read of both stores, written all or none. */
export function legacyOnStore(
  store: Stores,
  unitId: string,
  track: string,
  action: 'switch' | 'return',
  at: number,
  branched: BranchedTable = shippedBranched()
): LegacyOutcome {
  const account = store.readAccount();
  const roar = store.readRoar();
  const r =
    action === 'switch'
      ? { ...switchLegacy(account, roar, unitId, track, branched), refund: { credits: 0, coins: { free: 0, paid: 0 } } }
      : returnLegacy(account, roar, unitId, track, at, branched);
  if (!r.ok) return { ok: false };
  try {
    if (r.account !== account) store.writeAccount(r.account);
    if (r.roar !== roar) store.writeRoar(r.roar);
  } catch (err) {
    console.error('the legacy branch write was refused:', err);
    try {
      store.writeAccount(account);
    } catch {
      /* storage is refusing writes; nothing more can be undone */
    }
    return { ok: false };
  }
  return { ok: true, refund: r.refund };
}
