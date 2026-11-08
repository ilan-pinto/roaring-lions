/** The /api/account/* dispatcher (GH-1075 A1). */
import type { Env } from '../d1';
import { accountGuard, accountJson } from './http';
import { accountsOpen } from './member';
import { me } from './profile';
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
}

export interface AccountRoute {
  method: string;
  /** The exact path after `/api/account/`. */
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

export async function handleAccount(req: Request, env: Env, now: number, deps?: AccountDeps): Promise<Response> {
  if (env.ACCOUNTS === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const path = new URL(req.url).pathname.slice(PREFIX.length);
  const blocked = accountGuard(req, env, path);
  if (blocked !== null) return blocked;
  const route = ACCOUNT_ROUTES.find((r) => r.method === req.method.toUpperCase() && r.pattern === path);
  if (route === undefined) return accountJson(404, { error: 'not_found' });
  return route.handler({ req, env, now, deps: deps ?? { fetch: (url, init) => globalThis.fetch(url, init) }, path });
}
