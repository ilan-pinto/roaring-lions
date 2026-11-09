/**
 * `POST spend`, `POST coupon` and `POST reset-free` (GH-1075 A2, §0.14, §0.18, §0.29). The three moves of the free
 * half that are not a victory. No request field is an amount or a price: a spend names an item, a coupon names a code,
 * a reset names nothing. Each runs through `budgetedOp`; its batch is wallet, campaign, other rows, then the op insert
 * (R2). The wallet and the campaign are written only through `coin.ts` and `campaign.ts`, which guard on the revision
 * they read, so a stale read fails the batch and `budgetedOp` re-reads and re-prices.
 */
import {
  buyWithCoins,
  canonicalCampaign,
  coinCost,
  couponGrant,
  emptyAccount,
  grantCouponCoins,
  redeemCoupon,
  resetFree,
  sha256Hex,
  spendable,
  storeInputFor,
  storeItems,
  toCoinAsk,
  type BrigadeAccount,
  type CampaignBody,
  type CampaignView,
  type CoinAskWire,
  type RoarWallet,
  type WalletView,
} from '@lions/economy';
import { coupons } from '@lions/data';
import type { D1Like, D1Stmt } from '../d1';
import { budgetedOp } from './budget';
import { campaignViewOf, campaignWrite, readCampaign, type CampaignRead } from './campaign';
import { asRoar, readWallet, receiptsOf, walletWrite, type JournalEntry, type WalletRow } from './coin';
import { accountJson, readAccountBody } from './http';
import { OpReject } from './op';
import type { AccountCtx } from './routes';
import { requireSession, sessionJson } from './session';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const CODE_MAX = 256;

/** The wire view of `roar` as it stands after a write that bumped the revision `bumped` times. */
function viewOf(w: WalletRow, roar: RoarWallet, bumped: boolean): WalletView {
  return { free: roar.coins.free, paid: 0, entitlements: roar.entitlements, earn: roar.earn, receipts: roar.receipts, revision: w.revision + (bumped ? 1 : 0) };
}

/** A campaign body written at `revision`, as the wire shows it. */
async function viewAt(body: CampaignBody, revision: number): Promise<CampaignView> {
  const read: CampaignRead = { revision, body, text: canonicalCampaign(body) };
  return campaignViewOf(read);
}

async function open(ctx: AccountCtx, max?: number) {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  if (ctx.env.ACCOUNTS === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const raw = await readAccountBody<unknown>(ctx.req, max);
  return { db: ctx.env.ACCOUNTS, memberId: got.session.memberId, setCookie: got.setCookie, raw };
}

/** The wire ask, or null for anything that is not exactly one of the two shapes. */
function parseAsk(v: Record<string, unknown>): CoinAskWire | null {
  if (typeof v.unitId !== 'string' || v.unitId === '') return null;
  if (v.item === 'unit') return { item: 'unit', unitId: v.unitId };
  if (v.item === 'tier' && typeof v.track === 'string' && v.track !== '' && typeof v.tier === 'number' && Number.isInteger(v.tier) && v.tier >= 1) {
    return { item: 'tier', unitId: v.unitId, track: v.track, tier: v.tier };
  }
  return null;
}

export async function spend(ctx: AccountCtx): Promise<Response> {
  const o = await open(ctx);
  if (o instanceof Response) return o;
  const { db, memberId, setCookie, raw } = o;
  if (raw === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  const ask = isRec(raw) ? parseAsk(raw) : null;
  if (!isRec(raw) || ask === null) return sessionJson(400, { error: 'body' }, setCookie);
  const coinAsk = toCoinAsk(ask);

  const out = await budgetedOp(ctx, { memberId, opId: raw.op_id, kind: 'spend' }, async () => {
    const wallet = await readWallet(db, memberId);
    const camp = await readCampaign(db, memberId);
    const receipts = await receiptsOf(db, memberId);
    const roar = asRoar(wallet, receipts);
    const input = storeInputFor({ ledger: camp?.body.ledger ?? {}, brigade: camp?.body.brigade ?? emptyAccount(), roar });
    const bought = buyWithCoins(input, roar, coinAsk, ctx.now);
    if (!bought.ok) {
      // The item is on sale but the wallet is short: `coins`. Anything else (earned, owned, unpriced, unknown): `closed`.
      const items = storeItems(input);
      const item =
        coinAsk.kind === 'unit'
          ? items.units.find((u) => u.id === coinAsk.unitId)
          : items.tiers.find((t) => t.unitId === coinAsk.unitId && t.track === coinAsk.track && t.next?.tier === coinAsk.tier);
      const cost = item === undefined ? null : coinCost(item);
      const reason = cost !== null && cost > 0 && spendable(roar) < cost ? 'coins' : 'closed';
      throw new OpReject(409, { error: 'refused', reason, wallet: viewOf(wallet, roar, false) });
    }
    const after = bought.account;
    const receipt = after.receipts[after.receipts.length - 1] ?? null;
    const entry: JournalEntry = {
      kind: coinAsk.kind,
      delta: after.coins.free - wallet.free,
      receipt,
      detail: coinAsk.kind === 'unit' ? { unitId: coinAsk.unitId } : { unitId: coinAsk.unitId, track: coinAsk.track, tier: coinAsk.tier },
      opId: raw.op_id as string,
      at: ctx.now,
    };
    // The price came from the campaign read above: if another device wrote the campaign since, this guard trips
    // `campaign_state`'s bytes CHECK and `budgetedOp` re-reads and re-prices. With no row read it matches nothing.
    // `bytes = bytes` on a match leaves the revision alone, so other writers are not disturbed.
    const campaignGuard =
      camp === null
        ? db.prepare('UPDATE campaign_state SET bytes = 262145 WHERE member_id = ?1').bind(memberId)
        : db.prepare('UPDATE campaign_state SET bytes = CASE WHEN revision = ?2 THEN bytes ELSE 262145 END WHERE member_id = ?1').bind(memberId, camp.revision);
    return {
      statements: [...walletWrite(db, wallet, { roar: after, earnLifetime: wallet.earnLifetime }, [entry]), campaignGuard],
      status: 200,
      response: { wallet: viewOf(wallet, after, true) },
    };
  });
  return sessionJson(out.status, out.body, setCookie);
}

/** What the member's claim and backfill journal rows already credited for coupon `id` (`detail.coupons[].credited`). */
async function claimedFor(db: D1Like, memberId: string, id: string): Promise<number> {
  const r = await db
    .prepare(
      `SELECT COALESCE(SUM(json_extract(c.value, '$.credited')), 0) AS n
       FROM coin_journal j, json_each(j.detail, '$.coupons') c
       WHERE j.member_id = ?1 AND j.kind IN ('claim', 'backfill') AND json_extract(c.value, '$.id') = ?2`,
    )
    .bind(memberId, id)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function coupon(ctx: AccountCtx): Promise<Response> {
  const o = await open(ctx);
  if (o instanceof Response) return o;
  const { db, memberId, setCookie, raw } = o;
  if (raw === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  if (!isRec(raw)) return sessionJson(400, { error: 'op_id' }, setCookie);
  if (typeof raw.code !== 'string' || raw.code.length > CODE_MAX) return sessionJson(400, { error: 'body' }, setCookie);
  const code = raw.code;
  const table = ctx.deps.coupons ?? coupons;

  const out = await budgetedOp(ctx, { memberId, opId: raw.op_id, kind: 'coupon' }, async () => {
    const wallet = await readWallet(db, memberId);
    const camp = await readCampaign(db, memberId);
    const receipts = await receiptsOf(db, memberId);
    const roar = asRoar(wallet, receipts);
    const used = (await db.prepare('SELECT coupon_id FROM coupon_use WHERE member_id = ?1').bind(memberId).all<{ coupon_id: string }>()).results.map((r) => r.coupon_id);
    // `coupon_use`, never the brigade's own list, says what is used: a reset empties the brigade (A2-11).
    const brigade: BrigadeAccount = { ...(camp?.body.brigade ?? emptyAccount()), coupons: used };
    const red = redeemCoupon(brigade, code, table, sha256Hex, ctx.now);
    if (!red.ok) {
      return {
        statements: [],
        status: 200,
        response: { result: red.reason, ids: [], coins: 0, credits: 0, wallet: viewOf(wallet, roar, false), campaign: camp === null ? null : await campaignViewOf(camp) },
      };
    }
    let coins = 0;
    for (const id of red.ids) {
      const entry = table.find((c) => c.id === id);
      const grant = entry === undefined ? 0 : couponGrant(entry);
      coins += Math.max(0, grant - (await claimedFor(db, memberId, id)));
    }
    const statements: D1Stmt[] = [];
    const paid = grantCouponCoins(roar, coins, red.ids, ctx.now);
    const added = paid.coins.free - roar.coins.free;
    if (added > 0) {
      const entry: JournalEntry = { kind: 'coupon', delta: added, receipt: paid.receipts[paid.receipts.length - 1] ?? null, detail: { couponIds: red.ids }, opId: raw.op_id as string, at: ctx.now };
      statements.push(...walletWrite(db, wallet, { roar: paid, earnLifetime: wallet.earnLifetime }, [entry]));
    }
    const body: CampaignBody = { ledger: camp?.body.ledger ?? {}, brigade: red.account, tutorialDone: camp?.body.tutorialDone ?? false };
    statements.push(...(await campaignWrite(db, memberId, camp === null ? null : camp.revision, body, ctx.now)));
    for (const id of red.ids) {
      statements.push(db.prepare('INSERT INTO coupon_use (member_id, coupon_id, at) VALUES (?1, ?2, ?3)').bind(memberId, id, ctx.now));
    }
    return {
      statements,
      status: 200,
      response: { result: 'ok', ids: red.ids, coins: added, credits: red.credits, wallet: viewOf(wallet, paid, added > 0), campaign: await viewAt(body, (camp?.revision ?? 0) + 1) },
    };
  });
  return sessionJson(out.status, out.body, setCookie);
}

export async function resetFreeRoute(ctx: AccountCtx): Promise<Response> {
  const o = await open(ctx);
  if (o instanceof Response) return o;
  const { db, memberId, setCookie, raw } = o;
  if (raw === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  if (!isRec(raw)) return sessionJson(400, { error: 'op_id' }, setCookie);

  const out = await budgetedOp(ctx, { memberId, opId: raw.op_id, kind: 'reset' }, async () => {
    const wallet = await readWallet(db, memberId);
    const camp = await readCampaign(db, memberId);
    const receipts = await receiptsOf(db, memberId);
    const roar = asRoar(wallet, receipts);
    const after = resetFree(roar);
    // `earn` is emptied and `earn_lifetime` is not: the claim record outlives the reset (R15).
    const entry: JournalEntry = { kind: 'reset', delta: after.coins.free - wallet.free, receipt: null, detail: { free: wallet.free }, opId: raw.op_id as string, at: ctx.now };
    const statements: D1Stmt[] = [...walletWrite(db, wallet, { roar: after, earnLifetime: wallet.earnLifetime }, [entry])];
    let campaign: CampaignView | null = null;
    if (camp !== null) {
      const body: CampaignBody = { ...camp.body, brigade: emptyAccount() };
      statements.push(...(await campaignWrite(db, memberId, camp.revision, body, ctx.now)));
      campaign = await viewAt(body, camp.revision + 1);
    } else {
      // No campaign row was read. If another device's first PUT lands before this batch, the brigade would go un-reset
      // while the wallet is: this guard trips `campaign_state`'s bytes CHECK when a row exists now, so `budgetedOp`
      // sees a moved revision and re-reads (both-or-neither). With no row it matches nothing.
      statements.push(db.prepare('UPDATE campaign_state SET bytes = 262145 WHERE member_id = ?1').bind(memberId));
    }
    // The journal keeps its receipts, so the answer matches what `GET state` reads back next.
    return { statements, status: 200, response: { wallet: viewOf(wallet, { ...after, receipts }, true), campaign } };
  });
  return sessionJson(out.status, out.body, setCookie);
}
