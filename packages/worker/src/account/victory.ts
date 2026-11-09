/**
 * `POST mission/start` and `POST victory` (GH-1075 A2, §0.5, §0.20, §0.25 item 709).
 *
 * A start is a `withOp` write of kind `mission.start` whose response `{ start, missionId, at }` IS the nonce: `start`
 * is the start's own op id. A victory names it. It pays coins only when the nonce is plausible (a start row, for this
 * mission, no older than `START_MAX_AGE_MS`, no younger than the mission's win floor) and rewrites the row's kind to
 * `mission.start.used` in the same batch, so a second victory with the same nonce pays nothing. A victory that is
 * not plausible still records its campaign. Its coin half is a fact, so a stale `base` still pays and stores the
 * body as a `conflict` slot (§0.20). Batch order (R2): wallet, campaign or conflict slot, the start row, the cap guard.
 */
import {
  canonicalCampaign,
  maxRecord,
  parseWorld,
  roarEarn,
  worldMissionIds,
  MAX_COINS,
  type CampaignBody,
  type EarnAward,
  type RoarReceipt,
  type WalletView,
} from '@lions/economy';
import { minWinSeconds, world } from '@lions/data';
import type { D1Stmt } from '../d1';
import { budgetedOp } from './budget';
import { asRoar, readWallet, receiptsOf, walletWrite, type JournalEntry } from './coin';
import { campaignViewOf, campaignWrite, conflictSlot, digestOf, readCampaign } from './campaign';
import { CAMPAIGN_BODY_MAX, START_MAX_AGE_MS } from './config';
import { accountJson, readAccountBody } from './http';
import { validOpId } from './op';
import type { AccountCtx } from './routes';
import { requireSession, sessionJson } from './session';

const parsedWorld = parseWorld(world);
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function missionStart(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const body = await readAccountBody<{ op_id?: unknown; missionId?: unknown }>(ctx.req);
  if (body === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  if (!isRec(body) || !validOpId(body.op_id)) return sessionJson(400, { error: 'op_id' }, setCookie);
  const missionId = body.missionId;
  if (typeof missionId !== 'string' || !worldMissionIds(parsedWorld).includes(missionId)) return sessionJson(400, { error: 'mission' }, setCookie);
  const opId = body.op_id;
  const out = await budgetedOp(ctx, { memberId: session.memberId, opId, kind: 'mission.start' }, async () => ({
    statements: [],
    status: 200,
    response: { start: opId, missionId, at: ctx.now },
  }));
  return sessionJson(out.status, out.body, setCookie);
}

interface VictoryBody {
  op_id: string;
  missionId: string;
  stars: number;
  start: string | null;
  base: number;
  campaign: CampaignBody | null;
}

function parseVictory(v: unknown): VictoryBody | 'op_id' | 'body' {
  if (!isRec(v)) return 'op_id';
  if (!validOpId(v.op_id)) return 'op_id';
  const c = v.campaign;
  const campaignOk = c === null || (isRec(c) && isRec(c.ledger) && isRec(c.brigade) && typeof c.tutorialDone === 'boolean');
  if (
    typeof v.missionId !== 'string' ||
    typeof v.stars !== 'number' ||
    !(typeof v.start === 'string' || v.start === null) ||
    !Number.isInteger(v.base) ||
    (v.base as number) < 0 ||
    !campaignOk
  ) {
    return 'body';
  }
  return { op_id: v.op_id, missionId: v.missionId, stars: v.stars, start: v.start, base: v.base as number, campaign: c as CampaignBody | null };
}

/** The start row's stored `at`, when the row is a live start for `missionId`; else null. */
function startAt(row: { kind: string; response: string } | null, missionId: string): number | null {
  if (row === null || row.kind !== 'mission.start') return null;
  try {
    const v = JSON.parse(row.response) as unknown;
    const b = isRec(v) ? v.b : null;
    if (!isRec(b) || b.missionId !== missionId || typeof b.at !== 'number') return null;
    return b.at;
  } catch {
    return null;
  }
}

export async function victory(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const raw = await readAccountBody<unknown>(ctx.req, CAMPAIGN_BODY_MAX);
  if (raw === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  const body = parseVictory(raw);
  if (typeof body === 'string') return sessionJson(400, { error: body }, setCookie);
  let sent: CampaignBody | null = null;
  let sentText = '';
  if (body.campaign !== null) {
    try {
      sentText = canonicalCampaign(body.campaign);
      sent = JSON.parse(sentText) as CampaignBody;
    } catch {
      return sessionJson(400, { error: 'body' }, setCookie);
    }
  }
  const memberId = session.memberId;
  const floors = ctx.deps.minWinSeconds ?? minWinSeconds;

  const out = await budgetedOp(ctx, { memberId, opId: body.op_id, kind: 'victory' }, async () => {
    const wallet = await readWallet(db, memberId);
    const camp = await readCampaign(db, memberId);
    const receipts = await receiptsOf(db, memberId);
    const row =
      body.start === null
        ? null
        : await db
            .prepare('SELECT kind, response FROM account_op WHERE member_id = ?1 AND op_id = ?2')
            .bind(memberId, body.start)
            .first<{ kind: string; response: string }>();
    const at = startAt(row, body.missionId);
    const floor = floors[body.missionId];
    const plausible = at !== null && typeof floor === 'number' && ctx.now - at <= START_MAX_AGE_MS && ctx.now - at >= floor * 1000;

    const statements: D1Stmt[] = [];
    let awards: EarnAward[] = [];
    let walletOut: WalletView = { free: wallet.free, paid: 0, entitlements: wallet.entitlements, earn: wallet.earn, receipts, revision: wallet.revision };
    if (plausible) {
      const ledger = sent?.ledger ?? camp?.body.ledger ?? {};
      const paid = roarEarn(asRoar(wallet, receipts), { missionId: body.missionId, stars: body.stars, ledger }, parsedWorld, ctx.now);
      awards = paid.awards;
      if (paid.awards.length > 0) {
        // One journal row per award that moved coins, aligned with the receipts roarEarn appended (the tail).
        const entries: JournalEntry[] = [];
        let free = wallet.free;
        for (const a of paid.awards) {
          const added = Math.min(free + a.coins, MAX_COINS) - free;
          if (added <= 0) continue;
          free += added;
          entries.push({ kind: 'earn', delta: added, receipt: null, detail: { source: a.source, ...(a.missionId !== undefined ? { missionId: a.missionId } : {}) }, opId: body.op_id, at: ctx.now });
        }
        const tail: RoarReceipt[] = entries.length === 0 ? [] : paid.wallet.receipts.slice(-entries.length);
        entries.forEach((e, i) => { e.receipt = tail[i] ?? null; });
        const earnLifetime = maxRecord(wallet.earnLifetime, paid.wallet.earn);
        statements.push(...walletWrite(db, wallet, { roar: paid.wallet, earnLifetime }, entries));
        walletOut = { free: paid.wallet.coins.free, paid: 0, entitlements: paid.wallet.entitlements, earn: paid.wallet.earn, receipts: paid.wallet.receipts, revision: wallet.revision + 1 };
      }
    }

    // The campaign half (§0.20): a write at the current revision, a conflict slot when stale, nothing for null.
    let campaignOut = camp === null ? null : await campaignViewOf(camp);
    let conflict: { slot: unknown } | { held: true } | undefined;
    let guard: D1Stmt[] = [];
    if (sent !== null) {
      const expected = camp?.revision ?? 0;
      if (body.base === expected) {
        statements.push(...(await campaignWrite(db, memberId, camp === null ? null : camp.revision, sent, ctx.now)));
        campaignOut = { ...sent, revision: expected + 1, digest: await digestOf(sentText) };
      } else {
        const c = await conflictSlot(db, memberId, sent, ctx.now, 'conflict');
        conflict = c.answer;
        if (c.statements.length > 0) {
          statements.push(...c.statements.slice(0, -1));
          guard = c.statements.slice(-1);
        }
      }
    }
    if (plausible) {
      statements.push(
        db
          .prepare("UPDATE account_op SET kind = 'mission.start.used' WHERE member_id = ?1 AND op_id = ?2 AND kind = 'mission.start'")
          .bind(memberId, body.start),
      );
    }
    statements.push(...guard);
    return {
      statements,
      status: 200,
      response: { coins: awards.reduce((n, a) => n + a.coins, 0), awards, wallet: walletOut, campaign: campaignOut, ...(conflict !== undefined ? { conflict } : {}) },
    };
  });
  return sessionJson(out.status, out.body, setCookie);
}
