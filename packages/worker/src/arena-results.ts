/**
 * GET /arena-results (HTML) and /arena-results.json (GH-954 P3): the public arena results, rendered from the bundled
 * data/arena/results.json by the same module the local preview uses (`tools/src/net/arena-results-render.ts`).
 * PUBLIC on purpose: no D1, no cookie, no login, and it is not under /stats. The data is a committed file the lead
 * merged himself (D-P2), so the Worker only reads it. ETag is the file's own content digest.
 * Kill switch needing no deploy: the secret/var ARENA_RESULTS_HIDDEN (any value but empty, `0` or `false`) -> 404.
 */
import type { ArenaResults } from '../../../tools/src/net/arena-publish';
import { renderEmpty, renderPreview } from '../../../tools/src/net/arena-results-render';
import { ARENA_RESULTS } from './arena-data';
import { PAGE_CSP } from './security-headers';

/** PAGE_CSP with its inline-script allowance removed: this page has no script, so it may run none. */
export const ARENA_PAGE_CSP = PAGE_CSP.replace("script-src 'unsafe-inline'", "script-src 'none'");

export const ARENA_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600';

export interface ArenaEnv { ARENA_RESULTS_HIDDEN?: string }

export const arenaHidden = (env: ArenaEnv): boolean => {
  const v = (env.ARENA_RESULTS_HIDDEN ?? '').trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
};

export const isArenaPath = (pathname: string): boolean => pathname === '/arena-results' || pathname === '/arena-results.json';

const notFound = (): Response => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export function handleArenaResults(req: Request, env: ArenaEnv, doc: ArenaResults | null = ARENA_RESULTS): Response {
  const { pathname } = new URL(req.url);
  if (arenaHidden(env)) return notFound();
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  const json = pathname === '/arena-results.json';
  // Nothing published: the page says so; the JSON has nothing to hand out, so it is a plain 404 (not cached long).
  if (doc === null && json) return notFound();
  const etag = `"${doc === null ? 'empty' : doc.digest}"`;
  const headers: Record<string, string> = { 'cache-control': doc === null ? 'public, max-age=60' : ARENA_CACHE_CONTROL, etag };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  headers['content-type'] = json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8';
  if (!json) headers['content-security-policy'] = ARENA_PAGE_CSP;
  const body = json ? JSON.stringify(doc) : doc === null ? renderEmpty() : renderPreview(doc);
  return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers });
}
