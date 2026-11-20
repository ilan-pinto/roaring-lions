/**
 * `POST branch/switch` and `POST branch/return` (GH-1384 §4.2, §4.3; the lead's Q4, Q8, Q11 and R12): a member's one-time choice on a
 * track whose branched tier predates branching. Registered only while branching is open (`routes.ts`), so a closed Worker answers
 * both as any unknown route.
 *
 * The request names a unit and a track, nothing else: no branch, no price, no flag. Both stores are read here, the wallet settled
 * (`readWallet`) and the campaign's account settled (its canonical text), and the economy's `switchLegacy` / `returnLegacy` decide
 * and price it, in one pair. The wallet and the campaign go in ONE `budgetedOp` batch whose revision guards serialise two writes.
 *
 *   - **Switch** moves every store holding the branched tier to the other branch and clears its marker. The coins do not move, so no
 *     journal row is written.
 *   - **Return** drops every store holding a LEGACY marker to the tier below and refunds it. The coins are a `tier` journal row with
 *     `detail.refund: true` and a positive `free_delta` (the lead, Q4: the `kind` CHECK does not change), so
 *     `wallet.free = SUM(free_delta)` holds; the credits are the account's balance. A fresh branch buy is never refunded (R12).
 *   The wallet is always rewritten (a revision bump), because the offer read it: a concurrent coin buy makes the batch fail and
 *   `budgetedOp` re-reads and re-decides.
 */
import { campaignViewOf, campaignWrite, readCampaign } from './campaign';
import { emptyAccount, returnLegacy, shippedBranched, switchLegacy, type CampaignBody } from '@lions/economy';
import { budgetedOp } from './budget';
import { asRoar, readWallet, receiptsOf, walletWrite, type JournalEntry } from './coin';
import { accountJson, readAccountBody } from './http';
import { OpReject } from './op';
import type { AccountCtx } from './routes';
import { requireSession, sessionJson } from './session';
import { viewAt, viewOf } from './spend';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_MAX = 64;
const TRACK_MAX = 32;
const SLUG = /^[A-Za-z0-9_.-]+$/;
const slug = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && SLUG.test(v);

async function move(ctx: AccountCtx, which: 'switch' | 'return'): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const raw = await readAccountBody<unknown>(ctx.req);
  if (raw === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  if (!isRec(raw)) return sessionJson(400, { error: 'op_id' }, setCookie);
  if (!slug(raw.unitId, ID_MAX) || !slug(raw.track, TRACK_MAX)) return sessionJson(400, { error: 'body' }, setCookie);
  const { unitId, track } = raw;
  const memberId = session.memberId;

  const out = await budgetedOp(ctx, { memberId, opId: raw.op_id, kind: `branch.${which}` }, async () => {
    const wallet = await readWallet(db, memberId);
    const camp = await readCampaign(db, memberId);
    const receipts = await receiptsOf(db, memberId);
    const roar = asRoar(wallet, receipts);
    const body: CampaignBody = camp === null ? { ledger: {}, brigade: emptyAccount(), tutorialDone: false } : (JSON.parse(camp.text) as CampaignBody);
    const fork = shippedBranched()[unitId]?.[track];
    const r = which === 'switch' ? switchLegacy(body.brigade, roar, unitId, track) : returnLegacy(body.brigade, roar, unitId, track, ctx.now);
    // A refund that would put paid coins in the wallet cannot be written (`walletWrite` keeps paid at 0): refused, not a 500.
    if (!r.ok || fork === undefined || r.roar.coins.paid !== roar.coins.paid) {
      throw new OpReject(409, { error: 'refused', wallet: viewOf(wallet, roar, false), campaign: camp === null ? null : await campaignViewOf(camp) });
    }
    const refund = 'refund' in r ? r.refund : null;
    const entries: JournalEntry[] = [];
    if (refund !== null && r.roar !== roar) {
      entries.push({
        kind: 'tier',
        delta: r.roar.coins.free - roar.coins.free,
        receipt: r.roar.receipts[r.roar.receipts.length - 1] ?? null,
        detail: { unitId, track, tier: fork.tier, refund: true },
        opId: raw.op_id as string,
        at: ctx.now,
      });
    }
    const accountMoved = r.account !== body.brigade;
    const next: CampaignBody = { ...body, brigade: r.account };
    // The offer read the campaign: if another device wrote it since, this guard trips `campaign_state`'s CHECK and `budgetedOp`
    // re-reads and re-decides (as `spend` does). A write at the read revision is its own guard.
    const campaignStatements = accountMoved
      ? await campaignWrite(db, memberId, camp === null ? null : camp.revision, next, ctx.now)
      : camp === null
        ? [db.prepare('UPDATE campaign_state SET bytes = 262145 WHERE member_id = ?1').bind(memberId)]
        : [db.prepare('UPDATE campaign_state SET bytes = CASE WHEN revision = ?2 THEN bytes ELSE 262145 END WHERE member_id = ?1').bind(memberId, camp.revision)];
    return {
      statements: [...walletWrite(db, wallet, { roar: r.roar, earnLifetime: wallet.earnLifetime }, entries), ...campaignStatements],
      status: 200,
      response: {
        wallet: viewOf(wallet, r.roar, true),
        campaign: accountMoved ? await viewAt(next, (camp?.revision ?? 0) + 1) : camp === null ? null : await campaignViewOf(camp),
        ...(refund === null ? {} : { refund }),
      },
    };
  });
  return sessionJson(out.status, out.body, setCookie);
}

export const branchSwitch = (ctx: AccountCtx): Promise<Response> => move(ctx, 'switch');
export const branchReturn = (ctx: AccountCtx): Promise<Response> => move(ctx, 'return');
