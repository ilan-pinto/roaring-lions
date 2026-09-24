import type { Env } from './d1';
import { handleIngest } from './ingest';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/events') return handleIngest(req, env, Date.now());
    return env.ASSETS.fetch(req);
  },
};
