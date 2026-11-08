/** The /api/account/* dispatcher (GH-1075 A1). */
import type { Env } from '../d1';
import { accountGuard, accountJson } from './http';
import { accountsOpen } from './member';
import { perMinute } from './limits';
import { deleteIdentity } from './identity';
import { deleteAccount, gone } from './delete';
import { exportAccount } from './export';
import { me, patchProfile } from './profile';
import { steamReturn, steamStart } from './steam';
import { clearedSessionCookie, requireSession, sessionJson } from './session';

export interface AccountDeps { fetch(url: string, init: RequestInit): Promise<Response> }

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
      return accountJson(200, { open: db !== undefined && (await accountsOpen(db)) });
    },
  },
  { method: 'GET', pattern: 'me', handler: me },
  { method: 'PATCH', pattern: 'profile', handler: patchProfile },
  { method: 'DELETE', pattern: 'identity/:id', handler: deleteIdentity },
  { method: 'GET', pattern: 'export', handler: exportAccount },
  { method: 'POST', pattern: 'delete', handler: deleteAccount },
  { method: 'POST', pattern: 'gone', handler: gone },
  { method: 'POST', pattern: 'steam/start', handler: steamStart },
  { method: 'GET', pattern: 'steam/return', handler: steamReturn },
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

/** Routes that do not take the signed-in limiter: `open` is a public read; `steam/*` and `gone` take ACCOUNT_LIMIT themselves. */
const UNLIMITED_HERE: ReadonlySet<string> = new Set(['open', 'steam/start', 'steam/return', 'gone']);

export async function handleAccount(req: Request, env: Env, now: number, deps?: AccountDeps): Promise<Response> {
  if (env.ACCOUNTS === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const path = new URL(req.url).pathname.slice(PREFIX.length);
  const blocked = accountGuard(req, env, path);
  if (blocked !== null) return blocked;
  const method = req.method.toUpperCase();
  for (const route of ACCOUNT_ROUTES) {
    if (route.method !== method) continue;
    const params = matchPath(route.pattern, path);
    if (params === null) continue;
    // The signed-in class (everything but `open` and the sign-in class, which limit themselves) shares ACCOUNT_OP_LIMIT.
    if (!UNLIMITED_HERE.has(route.pattern) && (await perMinute(req, env.ACCOUNT_OP_LIMIT))) return accountJson(429, { error: 'limit' });
    return route.handler({ req, env, now, deps: deps ?? { fetch: (url, init) => globalThis.fetch(url, init) }, path, params });
  }
  return accountJson(404, { error: 'not_found' });
}
