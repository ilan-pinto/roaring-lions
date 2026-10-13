/**
 * #559 L-5 (and F7): security headers. Before, no Worker response carried
 * nosniff, a referrer policy or framing protection, /stats's login page and
 * dashboard had no CSP, and the game's static files had no `_headers`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import worker from './index';
import { openTestD1 } from './test-d1';
import { sessionCookieHeader } from './auth';
import { FEEDBACK_PAGE_CSP } from './feedback-page';
import type { Env } from './d1';

const ORIGIN = 'https://game.example.workers.dev';
const SECRET = 'pw-for-test';

async function responses(): Promise<[string, Response][]> {
  const env = {
    DB: openTestD1(), ASSETS: { fetch: async () => new Response('asset') }, STATS_PASSWORD: SECRET, TICKET_SECRET: 't',
    ROOMS: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('x', { status: 404 }) }) },
  } as unknown as Env;
  const cookie = (await sessionCookieHeader(SECRET, Date.now())).split(';')[0];
  const reqs: [string, Request][] = [
    ['GET /stats (login page)', new Request(`${ORIGIN}/stats`)],
    ['GET /stats (dashboard)', new Request(`${ORIGIN}/stats`, { headers: { cookie } })],
    ['GET /stats/feedback', new Request(`${ORIGIN}/stats/feedback`, { headers: { cookie } })],
    ['GET /stats/api/summary', new Request(`${ORIGIN}/stats/api/summary`, { headers: { cookie } })],
    ['POST /stats/logout', new Request(`${ORIGIN}/stats/logout`, { method: 'POST', headers: { origin: ORIGIN } })],
    ['POST /api/events', new Request(`${ORIGIN}/api/events`, { method: 'POST', body: '{}' })],
    ['GET /api/feedback', new Request(`${ORIGIN}/api/feedback`)],
    ['POST /api/match', new Request(`${ORIGIN}/api/match`, { method: 'POST', headers: { origin: ORIGIN }, body: '{}' })],
    ['GET /api/match/ABCDEF/ws', new Request(`${ORIGIN}/api/match/ABCDEF/ws`, { headers: { origin: ORIGIN, upgrade: 'websocket' } })],
  ];
  const out: [string, Response][] = [];
  for (const [name, req] of reqs) out.push([name, await worker.fetch(req, env)]);
  return out;
}

describe('#559 L-5: security headers', () => {
  it('every Worker response carries nosniff, a same-origin referrer policy, DENY framing and a CSP with frame-ancestors none', async () => {
    for (const [name, res] of await responses()) {
      expect(res.headers.get('x-content-type-options'), name).toBe('nosniff');
      expect(res.headers.get('referrer-policy'), name).toBe('same-origin');
      expect(res.headers.get('x-frame-options'), name).toBe('DENY');
      expect(res.headers.get('content-security-policy'), name).toContain("frame-ancestors 'none'");
    }
  });

  it('the /stats pages -- login and dashboard -- carry the triage page\'s CSP', async () => {
    const all = new Map(await responses());
    for (const name of ['GET /stats (login page)', 'GET /stats (dashboard)', 'GET /stats/feedback']) {
      expect(all.get(name)?.headers.get('content-security-policy'), name).toBe(FEEDBACK_PAGE_CSP);
    }
    expect(all.get('GET /stats/api/summary')?.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('F7: the game\'s _headers file gives every static file a CSP that allows wasm and blob workers and nothing from elsewhere', () => {
    const text = readFileSync(fileURLToPath(new URL('../../../assets/_headers', import.meta.url)), 'utf8');
    const rules = text.split('\n').filter((l) => !l.startsWith('#'));
    expect(rules).toContain('/*');
    const header = (name: string): string => rules.find((l) => l.trim().toLowerCase().startsWith(`${name.toLowerCase()}:`))?.split(':').slice(1).join(':').trim() ?? '';
    const csp = header('Content-Security-Policy');
    for (const d of ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "frame-ancestors 'none'", "object-src 'none'", "worker-src 'self' blob:", "connect-src 'self' blob: data:"]) expect(csp).toContain(d);
    expect(csp).not.toMatch(/'unsafe-eval'|https?:|\*/);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('same-origin');
  });
});
