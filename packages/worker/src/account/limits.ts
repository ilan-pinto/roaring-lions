/** Rate limits and day budgets for the accounts routes (GH-1075 A1). The per-minute bindings bound a burst;
 *  the day budgets live in the ACCOUNTS database's `rate_day`. No IP is stored: only `ipKey`. */
import type { D1Like, Env, RateLimiter } from '../d1';
import { bump, ipKey, ipSecret } from '../rate-day';
import { NEW_ALL, NEW_PER_IP, OPS_ALL, OPS_PER_MEMBER } from './config';

/** True when the request is over the per-minute limit. No limiter bound means not limited. */
export async function perMinute(req: Request, limiter: RateLimiter | undefined): Promise<boolean> {
  if (!limiter) return false;
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const { success } = await limiter.limit({ key: ip });
  return !success;
}

/** True when a new account may be made today. The per-ip count is skipped without a secret. */
export async function newAccountBudget(db: D1Like, env: Env, req: Request, now: number): Promise<boolean> {
  const secret = ipSecret(env);
  if (secret !== null) {
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!(await bump(db, 'acct-new-ip', await ipKey(secret, ip, now), now, NEW_PER_IP))) return false;
  }
  return bump(db, 'acct-new-all', '', now, NEW_ALL);
}

/** True when this member's write may proceed today. */
export async function opBudget(db: D1Like, memberId: string, now: number): Promise<boolean> {
  if (!(await bump(db, 'acct-ops', memberId, now, OPS_PER_MEMBER))) return false;
  return bump(db, 'acct-all', '', now, OPS_ALL);
}
