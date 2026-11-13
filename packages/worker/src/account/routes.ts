/** The /api/account/* dispatcher (GH-1075 A1). */
import type { Env } from '../d1';
import { accountGuard, accountJson } from './http';
import { accountsOpen, openProviders } from './member';
import { perMinute } from './limits';
import { deleteIdentity } from './identity';
import { deleteAccount, gone } from './delete';
import { exportAccount } from './export';
import { claim } from './claim';
import { getState, putCampaign } from './campaign';
import { matches } from './matches';
import { me, patchProfile } from './profile';
import { deleteSlot, getSlot, putSlot } from './slots';
import { coupon, resetFreeRoute, spend } from './spend';
import { missionStart, victory } from './victory';
import { googleStart } from './google';
import { steamReturn, steamStart } from './steam';
import { clearedSessionCookie, requireSession, sessionJson } from './session';

export interface AccountDeps {
  fetch(url: string, init: RequestInit): Promise<Response>;
  /** The victory's win floors (R4); default `minWinSeconds` from @lions/data. A test sets one. */
  minWinSeconds?: Readonly<Record<string, number>>;
  /** The coupon table `POST coupon` matches (default `coupons` from @lions/data). A test sets one with a known code's hash. */
  coupons?: readonly { id: string; sha256: string; credits?: number; coins?: number }[];
}

export interface AccountCtx {
  req: Request;
  env: Env;
  now: number;
  deps: AccountDeps;
  /** The part of the path after `/api/account/`. */
  path: string;
  /** The `:name` segments of the matched pattern. */
  params: Record<string, string>;
}

export interface AccountRoute {
  method: string;
  /** The path after `/api/account/`. A `:name` segment matches one segment of `[A-Za-z0-9_-]{1,64}` and is passed in `ctx.params`. */
  pattern: string;
  handler(ctx: AccountCtx): Promise<Response>;
}

export const ACCOUNT_ROUTES: readonly AccountRoute[] = [
  {
    method: 'GET',
    pattern: 'open',
    handler: async (ctx) => {
      const db = ctx.env.ACCOUNTS;
      if (db === undefined) return accountJson(200, { open: false, providers: [] });
      return accountJson(200, { open: await accountsOpen(db), providers: await openProviders(db, ctx.env) });
    },
  },
  { method: 'GET', pattern: 'me', handler: me },
  { method: 'GET', pattern: 'state', handler: getState },
  { method: 'GET', pattern: 'matches', handler: matches },
  { method: 'GET', pattern: 'slots/:id', handler: getSlot },
  { method: 'PUT', pattern: 'campaign', handler: putCampaign },
  { method: 'PUT', pattern: 'slots/:id', handler: putSlot },
  { method: 'DELETE', pattern: 'slots/:id', handler: deleteSlot },
  { method: 'PATCH', pattern: 'profile', handler: patchProfile },
  { method: 'DELETE', pattern: 'identity/:id', handler: deleteIdentity },
  { method: 'GET', pattern: 'export', handler: exportAccount },
  { method: 'POST', pattern: 'delete', handler: deleteAccount },
  { method: 'POST', pattern: 'gone', handler: gone },
  { method: 'POST', pattern: 'mission/start', handler: missionStart },
  { method: 'POST', pattern: 'victory', handler: victory },
  { method: 'POST', pattern: 'claim', handler: claim },
  { method: 'POST', pattern: 'spend', handler: spend },
  { method: 'POST', pattern: 'coupon', handler: coupon },
  { method: 'POST', pattern: 'reset-free', handler: resetFreeRoute },
  { method: 'POST', pattern: 'steam/start', handler: steamStart },
  { method: 'GET', pattern: 'steam/return', handler: steamReturn },
  { method: 'POST', pattern: 'google/start', handler: googleStart },
  {
    method: 'POST',
    pattern: 'logout',
    handler: async (ctx) => {
      const got = await requireSession(ctx);
      if (got instanceof Response) return got;
      await ctx.env.ACCOUNTS?.prepare('DELETE FROM session WHERE token_hash = ?1').bind(got.session.tokenHash).run();
      return accountJson(200, { ok: true }, { 'set-cookie': clearedSessionCookie() });
    },
  },
  {
    method: 'POST',
    pattern: 'logout-all',
    handler: async (ctx) => {
      const got = await requireSession(ctx);
      if (got instanceof Response) return got;
      await ctx.env.ACCOUNTS?.prepare('DELETE FROM session WHERE member_id = ?1').bind(got.session.memberId).run();
      return sessionJson(200, { ok: true }, clearedSessionCookie());
    },
  },
];

const PREFIX = '/api/account/';
const PARAM = /^[A-Za-z0-9_-]{1,64}$/;

/** The params of `pattern` matched against `path`, or null. Literal segments match exactly. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/');
  const have = path.split('/');
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i] ?? '';
    const h = have[i] ?? '';
    if (w.startsWith(':')) {
      if (!PARAM.test(h)) return null;
      params[w.slice(1)] = h;
    } else if (w !== h) return null;
  }
  return params;
}

/** Routes that do not take the signed-in limiter: `steam/*`, `google/start` and `gone` take ACCOUNT_LIMIT themselves. */
const UNLIMITED_HERE: ReadonlySet<string> = new Set(['steam/start', 'steam/return', 'google/start', 'gone']);

export async function handleAccount(req: Request, env: Env, now: number, deps?: AccountDeps): Promise<Response> {
  if (env.ACCOUNTS === undefined) return accountJson(503, { error: 'accounts are not configured' });
  // Fail closed: a bound database with a missing limiter would silently lift every per-minute limit.
  if (env.ACCOUNT_LIMIT === undefined || env.ACCOUNT_OP_LIMIT === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const path = new URL(req.url).pathname.slice(PREFIX.length);
  const blocked = accountGuard(req, env, path);
  if (blocked !== null) return blocked;
  const method = req.method.toUpperCase();
  for (const route of ACCOUNT_ROUTES) {
    if (route.method !== method) continue;
    const params = matchPath(route.pattern, path);
    if (params === null) continue;
    // The signed-in class (everything but the sign-in class, which limits itself) shares ACCOUNT_OP_LIMIT.
    if (!UNLIMITED_HERE.has(route.pattern) && (await perMinute(req, env.ACCOUNT_OP_LIMIT))) return accountJson(429, { error: 'limit' });
    return route.handler({ req, env, now, deps: deps ?? { fetch: (url, init) => globalThis.fetch(url, init) }, path, params });
  }
  return accountJson(404, { error: 'not_found' });
}
