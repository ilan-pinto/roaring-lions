import type { Env } from './d1';

/** The strict Origin rule (`/api/feedback`, `/api/match*`): the request must
 *  carry an Origin, and it must be the Worker's own or one listed in
 *  `env.ALLOWED_ORIGINS` (comma-separated). A fetch or a WebSocket from the
 *  page always sends one. `/api/events` keeps its own, laxer rule, because
 *  `sendBeacon` may omit the header. */
export function originAllowed(req: Request, env: Env): boolean {
  const origin = req.headers.get('origin');
  if (origin === null) return false;
  const own = new URL(req.url).origin;
  const extra = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin === own || extra.includes(origin);
}
