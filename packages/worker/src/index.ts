import type { Env } from './d1';
import { handleIngest, purgeEvents } from './ingest';
import { purgeRateDays } from './rate-day';
import { withSecurityHeaders } from './security-headers';
import { handleStats } from './stats';
import { handleFeedback } from './feedback-ingest';
import { purgeExpired } from './feedback-triage';
import { handleMatch } from './match/routes';
import { purgeDesyncs } from './match/desync-log';

/** N0: the one Durable Object class; wrangler.jsonc's `net-v1` migration names it. */
export { MatchRoom } from './match/match-room';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    // #559 L-5: every response the Worker writes carries the security headers.
    if (pathname === '/api/events') return withSecurityHeaders(await handleIngest(req, env, Date.now()));
    if (pathname === '/api/feedback') return withSecurityHeaders(await handleFeedback(req, env, Date.now()));
    if (pathname === '/api/match' || pathname.startsWith('/api/match/')) return withSecurityHeaders(await handleMatch(req, env, Date.now()));
    if (pathname === '/stats' || pathname.startsWith('/stats/')) return withSecurityHeaders(await handleStats(req, env, Date.now()));
    // The game's files: `assets/_headers` gives them theirs.
    return env.ASSETS.fetch(req);
  },
  /** The daily Cron Trigger (wrangler.jsonc `triggers.crons`): GH-464's
   *  180-day purge of feedback pictures, replays and contacts, N1b's of
   *  desync evidence (M-6), #559 M-3's of raw events, and the day counters. Each runs whatever the other does -- a missing
   *  table on one side must not keep the other's data -- and a failure still
   *  fails the run. */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const now = Date.now();
    const runs = await Promise.allSettled([purgeExpired(env, now), purgeDesyncs(env.DB, now), purgeEvents(env.DB, now), purgeRateDays(env.DB, now)]);
    for (const r of runs) if (r.status === 'rejected') throw r.reason;
  },
};
