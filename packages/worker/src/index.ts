import type { Env } from './d1';
import { handleIngest } from './ingest';
import { handleStats } from './stats';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/events') return handleIngest(req, env, Date.now());
    if (pathname === '/stats' || pathname.startsWith('/stats/')) return handleStats(req, env, Date.now());
    return env.ASSETS.fetch(req);
  },
};
