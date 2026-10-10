import type { Env } from './d1';
import { handleIngest } from './ingest';
import { handleStats } from './stats';
import { handleFeedback } from './feedback-ingest';
import { purgeExpired } from './feedback-triage';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/events') return handleIngest(req, env, Date.now());
    if (pathname === '/api/feedback') return handleFeedback(req, env, Date.now());
    if (pathname === '/stats' || pathname.startsWith('/stats/')) return handleStats(req, env, Date.now());
    return env.ASSETS.fetch(req);
  },
  /** The daily Cron Trigger (wrangler.jsonc `triggers.crons`): GH-464's
   *  180-day purge of feedback pictures, replays and contacts. */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await purgeExpired(env, Date.now());
  },
};
