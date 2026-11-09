/** Rate limits and day budgets for the accounts routes (GH-1075 A1). The per-minute bindings bound a burst;
 *  the day budgets live in the ACCOUNTS database's `rate_day`. No IP is stored: only `ipKey`. */
import type { D1Like, Env, RateLimiter } from '../d1';
import { bump, countToday, ipKey, ipSecret } from '../rate-day';
import { NEW_ALL, NEW_PER_IP, OPS_ALL, OPS_PER_MEMBER, START_ALL, START_PER_IP } from './config';

/** True when the request is over the per-minute limit. No limiter bound means not limited here; `handleAccount`
 *  answers 503 before any route when ACCOUNTS is bound without both limiters, so that case never reaches this. */
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
    const ip = ipBudgetAddress(req.headers.get('cf-connecting-ip') ?? 'unknown');
    if (!(await bump(db, 'acct-new-ip', await ipKey(secret, ip, now), now, NEW_PER_IP))) return false;
  }
  return bump(db, 'acct-new-all', '', now, NEW_ALL);
}

/** The address the start budget counts: an IPv4 address as is, an IPv6 one reduced to its /64 (one subscriber
 *  holds a whole /64, so per-address counting would be no limit). Anything unparseable is returned unchanged. */
export function ipBudgetAddress(ip: string): string {
  if (!ip.includes(':')) return ip;
  const zone = ip.split('%')[0] ?? ip;
  const halves = zone.split('::');
  if (halves.length > 2) return ip;
  const head = halves[0] === '' ? [] : (halves[0] ?? '').split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? (halves[1] ?? '').split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(Math.max(fill, 0)).fill('0'), ...tail];
  if (groups.length < 4 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return ip;
  return groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, '0')).join(':') + '::/64';
}

/** True when a sign-in may be started today (steam/start writes a challenge row). Per-ip first, so an over-ip
 *  request does not burn the overall count. The per-ip count is skipped without a secret. */
export async function startBudget(db: D1Like, env: Env, req: Request, now: number): Promise<boolean> {
  // Read first: once the overall cap is hit, a refused request must write nothing (no per-ip row for a fresh address).
  if ((await countToday(db, 'acct-start-all', '', now)) >= START_ALL) return false;
  const secret = ipSecret(env);
  if (secret !== null) {
    const ip = ipBudgetAddress(req.headers.get('cf-connecting-ip') ?? 'unknown');
    if (!(await bump(db, 'acct-start-ip', await ipKey(secret, ip, now), now, START_PER_IP))) return false;
  }
  return bump(db, 'acct-start-all', '', now, START_ALL);
}

/** True when this member's write may proceed today. */
export async function opBudget(db: D1Like, memberId: string, now: number): Promise<boolean> {
  if (!(await bump(db, 'acct-ops', memberId, now, OPS_PER_MEMBER))) return false;
  return bump(db, 'acct-all', '', now, OPS_ALL);
}
