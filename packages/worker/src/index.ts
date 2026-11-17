import type { Env } from './d1';
import { handleIngest, purgeEvents, purgePlayers } from './ingest';
import { purgeRateDays } from './rate-day';
import { withSecurityHeaders } from './security-headers';
import { handleStats } from './stats';
import { handleFeedback } from './feedback-ingest';
import { purgeExpired } from './feedback-triage';
import { handleArenaResults, isArenaPath } from './arena-results';
import { handlePrivacy } from './privacy-page';
import { handleAccount } from './account/routes';
import { accountCron } from './account/sweep';
import { sweepAdminViews } from './admin/view-sweep';
import { handleMatch } from './match/routes';
import { purgeDesyncs } from './match/desync-log';
import { purgeSnapMismatches } from './match/snap-mismatch-log';

/** N0: the one Durable Object class; wrangler.jsonc's `net-v1` migration names it. */
export { MatchRoom } from './match/match-room';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    // #559 L-5: every response the Worker writes carries the security headers.
    if (pathname === '/api/events') return withSecurityHeaders(await handleIngest(req, env, Date.now()));
    if (pathname === '/api/feedback') return withSecurityHeaders(await handleFeedback(req, env, Date.now()));
    if (pathname.startsWith('/api/account/')) return withSecurityHeaders(await handleAccount(req, env, Date.now()));
    if (pathname === '/api/match' || pathname.startsWith('/api/match/')) return withSecurityHeaders(await handleMatch(req, env, Date.now()));
    // GH-1075 A1: the privacy page. No D1, no cookie; closed (503) until the lead supplies the contact and age.
    if (pathname === '/privacy') return withSecurityHeaders(handlePrivacy(req));
    // GH-954 P3: public, bundled data, no D1 and no cookie. Not under /stats.
    if (isArenaPath(pathname)) return withSecurityHeaders(handleArenaResults(req, env));
    if (pathname === '/stats' || pathname.startsWith('/stats/')) return withSecurityHeaders(await handleStats(req, env, Date.now()));
    // The game's files: `assets/_headers` gives them theirs.
    return env.ASSETS.fetch(req);
  },
  /** The daily Cron Trigger (wrangler.jsonc `triggers.crons`): GH-464's
   *  180-day purge of feedback pictures, replays and contacts, N1b's of
   *  desync evidence (M-6) and of snapshot mismatch rows (snapshot S3), #559 M-3's of raw events, and the day counters, and GH-695's 180-day sweep of admin `view` rows. Each runs whatever the other does -- a missing
   *  table on one side must not keep the other's data -- and a failure still
   *  fails the run. */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const now = Date.now();
    // GH-1432: the sweep and the reconciler share ONE member delete batch (a delete is 17 statements), and the reconciler's scan runs
    // even if the sweep fails. Every share of the 50 D1 queries an invocation may make is pinned by `cron-budget.test.ts`. A member
    // whose delete keeps failing is isolated by `accountCron`'s fallback (GH-1530), whose runs reject here while it is recorded, so it is seen.
    const accountDb = env.ACCOUNTS;
    const tombs = env.ACCOUNT_TOMBSTONES;
    const accounts = accountDb !== undefined && tombs !== undefined ? [accountCron(accountDb, now, tombs), sweepAdminViews(accountDb, now)] : [];
    const runs = await Promise.allSettled([purgeExpired(env, now), purgeDesyncs(env.DB, now), purgeSnapMismatches(env.DB, now), purgeEvents(env.DB, now), purgePlayers(env.DB, now), purgeRateDays(env.DB, now), ...accounts]);
    for (const r of runs) if (r.status === 'rejected') throw r.reason;
  },
};
