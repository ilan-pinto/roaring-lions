/**
 * `budgetedOp` (GH-1075 A2): the one wrapper every account write goes through. Its order is the contract:
 *   1. a malformed op id is a 400;
 *   2. a stored answer comes back as stored, before any budget (a retry spends nothing: §0.3);
 *   3. the optional extra check, then the member's day budget, then the extra bump: any refusal is a 429 `limit` (the bump is a guarded UPSERT, so two racing claims cannot both take the last unit);
 *   4. `withOp`, up to `CAS_TRIES` times while its batch fails a CHECK and a re-read shows a wallet or campaign
 *      revision moved (§0.32, §0.35). Each attempt re-runs `build`, which re-reads. The budget is charged ONCE.
 *   5. a CHECK failure with no revision moved is a real bug and answers 500, never the lost-race 409. Exhausted
 *      tries answer 409 `busy`. A cap guard that trips answers 409 `cap` (or `s.capError`).
 * An `OpReject` thrown by `build` answers its status and body and writes nothing.
 */
import type { D1Like, D1Stmt } from '../d1';
import { isCapFailure, isCasFailure, isDeviceCapFailure } from './coin';
import { CAS_TRIES } from './config';
import { opBudget } from './limits';
import { OpReject, storedAnswer, validOpId, withOp, type OpAnswer } from './op';
import type { AccountCtx } from './routes';

export interface OpSpec {
  memberId: string;
  opId: unknown;
  kind: string;
  /** A read (the claim's `acct-claim` count) before the member's budget, and the bump after it. */
  extra?: { check: (db: D1Like) => Promise<boolean>; bump: (db: D1Like) => Promise<boolean> };
  /** R24: a tripped slot guard re-runs `build` (within `CAS_TRIES`) instead of answering 409 `cap`; the re-read decides. */
  retryOnCap?: boolean;
  /** The error a tripped cap guard answers; `cap` unless a route says otherwise (`claim_cap`). */
  capError?: string;
  /** The error a tripped DEVICE guard (`member.created_at`) answers: `claim_cap` for the claim; `cap` by default. */
  deviceCapError?: string;
}

export interface BuiltOp {
  statements: D1Stmt[];
  status: number;
  response: unknown;
}

/** The wallet and campaign revisions: a CHECK failure is a lost race only if one of these moved since before `build` read. */
async function revisions(db: D1Like, memberId: string): Promise<string> {
  const r = await db
    .prepare('SELECT (SELECT revision FROM wallet WHERE member_id = ?1) AS w, (SELECT revision FROM campaign_state WHERE member_id = ?1) AS c')
    .bind(memberId)
    .first<{ w: number | null; c: number | null }>();
  return JSON.stringify(r);
}

export async function budgetedOp(ctx: AccountCtx, s: OpSpec, build: () => Promise<BuiltOp>): Promise<OpAnswer> {
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return { status: 503, body: { error: 'accounts are not configured' } };
  if (!validOpId(s.opId)) return { status: 400, body: { error: 'op_id' } };
  const hit = await storedAnswer(db, s.memberId, s.opId);
  if (hit !== null) return hit;
  if (s.extra !== undefined && !(await s.extra.check(db))) return { status: 429, body: { error: 'limit' } };
  if (!(await opBudget(db, s.memberId, ctx.now))) return { status: 429, body: { error: 'limit' } };
  if (s.extra !== undefined && !(await s.extra.bump(db))) return { status: 429, body: { error: 'limit' } };
  for (let attempt = 0; attempt < CAS_TRIES; attempt++) {
    const seen = await revisions(db, s.memberId);
    try {
      return await withOp(db, s.memberId, s.opId, s.kind, ctx.now, build);
    } catch (err) {
      if (err instanceof OpReject) return { status: err.status, body: err.body };
      if (isDeviceCapFailure(err)) return { status: 409, body: { error: s.deviceCapError ?? 'cap' } };
      if (isCapFailure(err) && s.retryOnCap === true) continue;
      if (isCapFailure(err)) return { status: 409, body: { error: s.capError ?? 'cap' } };
      if (!isCasFailure(err)) throw err;
      if ((await revisions(db, s.memberId)) === seen) {
        console.error('account op failed a CHECK with no revision moved', s.kind, err);
        return { status: 500, body: { error: 'server' } };
      }
    }
  }
  return { status: 409, body: { error: 'busy' } };
}
