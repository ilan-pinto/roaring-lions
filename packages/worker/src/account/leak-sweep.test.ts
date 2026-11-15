/**
 * GH-1075 public-endpoint review: no response the account door writes carries a secret.
 *
 * Every route in ACCOUNT_ROUTES (plus an unknown path) is driven signed out and signed in, with a body that is
 * valid JSON but wrong, not JSON, an array, and over the cap. Whatever comes back, its body and headers must hold
 * none of: the session token or its hash, the caller's address, another member's rows, or the words of a
 * database or runtime failure, nor any value the request itself supplied. A route that starts echoing request data or an exception into an error body
 * turns this red.
 */
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from './config';
import { sha256Hex } from './crypto';
import { ACCOUNT_ROUTES } from './routes';
import { accountHarness, seedFullMember } from './test-kit';

const IP = '198.51.100.77';
const SAMPLE_ID = 'sample-id';
const NOW = 1_790_000_000_000;
/** Another member's data, which no answer to M may carry. */
const OTHER = ['uh2', 'code-hash', '76561197960287931'];
const FAILURE_WORDS = /SQLITE|constraint failed|no such (table|column)|node_modules|\bat \S+ \(|TypeError|ReferenceError|stack/i;

const pathOf = (pattern: string): string => '/api/account/' + pattern.replace(/:\w+/g, SAMPLE_ID);

const REQ = 'SENTINEL-REQ-VALUE';
const OP = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('the account door leaks nothing (GH-1075 review)', () => {
  const scenarios = [
    { label: 'signed out', signedIn: false, later: 0, deny: false },
    { label: 'signed in', signedIn: true, later: 0, deny: false },
    // Past the 5-minute fresh window: the routes that need a fresh session answer 403 reauth.
    { label: 'signed in, session no longer fresh', signedIn: true, later: 600_000, deny: false },
    // The per-minute limiter refuses every call: the 429 path.
    { label: 'limiter refuses', signedIn: true, later: 0, deny: true },
  ];

  for (const sc of scenarios) {
    it(`${sc.label}: no body or header of any route holds a token, an address, another member, a request value or a failure trace`, async () => {
      const h = accountHarness({ now: NOW + sc.later, denyLimiter: sc.deny ? ['ACCOUNT_OP_LIMIT'] : [] });
      const { cookie } = await seedFullMember(h.db, NOW);
      const token = cookie.slice(cookie.indexOf('=') + 1);
      const tokenHash = await sha256Hex(token);
      expect(token.length).toBeGreaterThan(20);

      const bodies: { name: string; init: { body?: unknown; rawBody?: string } }[] = [
        { name: 'wrong object', init: { body: { op_id: 12, displayName: 7, avatar: { x: 1 }, missionId: [], purpose: 9 } } },
        // Strings that are valid in kind and wrong in value: a refusal that echoes one is caught by REQ.
        { name: 'wrong strings', init: { body: { op_id: OP, displayName: `${REQ}-name-that-is-far-too-long`, avatar: `${REQ}-avatar`, missionId: `${REQ}-mission`, purpose: `${REQ}-purpose`, idHash: `${REQ}-hash`, code: `${REQ}-code`, slot: REQ } } },
        // Reaches the checks that sit behind the name's: the avatar and the show-record flag.
        { name: 'wrong avatar', init: { body: { op_id: OP, avatar: `${REQ}-avatar` } } },
        { name: 'wrong flag', init: { body: { op_id: OP, showRecord: REQ } } },
        { name: 'not json', init: { rawBody: `{"op_id":"${REQ}` } },
        { name: 'array', init: { body: [1, 2, 3] } },
        { name: 'over the cap', init: { rawBody: JSON.stringify({ pad: 'x'.repeat(2_000_000), note: REQ }) } },
      ];
      const paths = [...ACCOUNT_ROUTES.map((r) => ({ method: r.method, path: pathOf(r.pattern) })), { method: 'GET', path: `/api/account/no/such/${REQ}` }];

      let answered = 0;
      let expected = 0;
      const errors = new Set<string>();
      for (const { method, path } of paths) {
        for (const b of method === 'GET' ? bodies.slice(0, 1) : bodies) {
          expected++;
          const where = `${sc.label}: ${method} ${path} / ${b.name}`;
          const res = await h.call(method, path, { ...(method === 'GET' ? {} : b.init), cookie: sc.signedIn ? cookie : undefined, headers: { 'cf-connecting-ip': IP } });
          answered++;
          const text = await res.text();
          const headers = [...res.headers].filter(([k]) => k !== 'set-cookie').map(([k, v]) => `${k}: ${v}`).join('\n');
          for (const [what, hay] of [['body', text], ['headers', headers]] as const) {
            for (const secret of [token, tokenHash, IP, REQ, ...OTHER]) expect(hay.includes(secret), `${where}: ${what} holds ${secret.slice(0, 8)}...`).toBe(false);
            expect(FAILURE_WORDS.test(hay), `${where}: ${what} reads like a failure trace`).toBe(false);
          }
          // A cookie is only ever set to a live session's own or cleared; never to anything of the request's.
          for (const c of res.headers.getSetCookie()) expect(c.startsWith(`${SESSION_COOKIE}=`) || c.startsWith('__Host-rl_pre_'), where).toBe(true);
          // A refusal is JSON with an `error` that is a short code, not a sentence built from input.
          if (res.status >= 400) {
            const err = (JSON.parse(text) as { error?: unknown }).error;
            if (typeof err === 'string') errors.add(err);
            expect(typeof err, where).toBe('string');
            expect((err as string).length, where).toBeLessThan(40);
          }
        }
      }
      expect(answered).toBe(expected);
      // The scenario reached the path it exists for, or it proved nothing.
      if (sc.deny) expect(errors.has('limit')).toBe(true);
      if (sc.later > 0) expect(errors.has('reauth')).toBe(true);
    });
  }
});
