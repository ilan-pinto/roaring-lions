/**
 * #559 L-5: the headers every response the Worker writes carries. The game's
 * own static files get theirs from `assets/_headers` (copied into the build),
 * which Cloudflare applies without the Worker.
 *
 * Referrer-Policy is `same-origin`, not `no-referrer`, on purpose: under
 * `no-referrer` a browser sends `Origin: null` on a form POST and on a
 * `sendBeacon`, and the /stats login and logout and /api/events check the
 * Origin -- the lead could not sign in, and pagehide telemetry would drop.
 * `same-origin` still sends nothing to any other site.
 */
import { FEEDBACK_PAGE_CSP } from './feedback-page';

/** A Worker page (the /stats login, the dashboard, the triage view): the triage page's own CSP. */
export const PAGE_CSP = FEEDBACK_PAGE_CSP;
/** Anything else the Worker answers (JSON, text, redirects): nothing may load from it or frame it. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const BASE: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

/** The response with the headers added where it has none of its own. A 101
 *  (a socket upgrade) is returned as it is: it carries the socket, and its
 *  headers are not the page's. */
export function withSecurityHeaders(res: Response): Response {
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(BASE)) if (!out.headers.has(k)) out.headers.set(k, v);
  if (!out.headers.has('content-security-policy')) {
    const html = (out.headers.get('content-type') ?? '').startsWith('text/html');
    out.headers.set('content-security-policy', html ? PAGE_CSP : API_CSP);
  }
  return out;
}
