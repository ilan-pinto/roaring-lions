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
const REQ = 'SENTINEL-REQ-VALUE';
/** The path id is a sentinel too: a 404 that echoes `:id` back is caught by REQ. */
const SAMPLE_ID = `${REQ}-id`;
const NOW = 1_790_000_000_000;
/** Data that is not M's own, which no answer to M may carry: the opponent's handle and SteamID, M's own recovery
 *  subject (kept out of every answer), and a THIRD member who shares no match with M, so none of it is legitimately
 *  visible anywhere (n1 is M's opponent in SHARED, so `/matches` rightly shows n1's callsign: it cannot go here). */
const THIRD = { callsign: 'Callsign Three', publicId: 'PPPP3333', handle: 'uh3', steam: '76561197960287932', google: 'google-sub-p1' };
/** GH-1370 C1: THIRD's coin journal and an admin's public id, none of which `GET coins` may show M. */
const THIRD_COINS = { mission: 'SENTINEL-THIRD-MISSION', reason: 'SENTINEL-THIRD-REASON', note: 'SENTINEL-THIRD-NOTE' };
const ADMIN_PUBLIC_ID = 'ADMN4444';
const OTHER = ['uh2', 'code-hash', '76561197960287931', ...Object.values(THIRD), ...Object.values(THIRD_COINS), ADMIN_PUBLIC_ID];
/** The two sign-in return routes read their query string, so the sweep gives them one carrying sentinels. */
const QUERY: Record<string, string> = {
  'steam/return': `?c=${REQ}-c&openid.mode=${REQ}-mode&openid.claimed_id=${REQ}-claimed&openid.sig=${REQ}-sig`,
  'google/return': `?code=${REQ}-code&state=${REQ}-state&error=${REQ}-error`,
  // A 400 that echoed the query would hold REQ.
  coins: `?before=${REQ}-b&limit=${REQ}-l`,
};
const FAILURE_WORDS = /SQLITE|constraint failed|no such (table|column)|node_modules|\bat \S+ \(|TypeError|ReferenceError|stack/i;

const pathOf = (pattern: string): string => '/api/account/' + pattern.replace(/:\w+/g, SAMPLE_ID);

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
      const run = (sql: string, ...v: unknown[]) => h.db.prepare(sql).bind(...v).run();
      await run('INSERT INTO member VALUES (?1, ?2, ?3, ?4, ?5, ?6)', 'p1', THIRD.publicId, await sha256Hex(THIRD.publicId), THIRD.handle, NOW, 0);
      await run('INSERT INTO profile (member_id, display_name, show_record, updated_at) VALUES (?1, ?2, 0, ?3)', 'p1', THIRD.callsign, NOW);
      await run("INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES ('i5','p1','steam',?1,?2)", THIRD.steam, NOW);
      await run("INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES ('i6','p1','google',?1,?2)", THIRD.google, NOW);
      await run('INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)', 'p1', NOW, 'earn', 10, JSON.stringify({ source: 'first_win', missionId: THIRD_COINS.mission }), 'third-1');
      await run('INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)', 'p1', NOW, 'admin', 5, JSON.stringify({ mode: 'grant', reason: THIRD_COINS.reason, note: THIRD_COINS.note }), 'third-2');
      // An admin (p2) who changed M's coins: M's own admin row is legitimate, the admin's identity is not.
      await run('INSERT INTO member VALUES (?1, ?2, ?3, ?4, ?5, ?6)', 'p2', ADMIN_PUBLIC_ID, await sha256Hex(ADMIN_PUBLIC_ID), 'uh4', NOW, 0);
      await run('INSERT INTO admin_member VALUES (?1, ?2)', 'p2', NOW);
      await run("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', ?1, 'admin', 7, '{\"mode\":\"grant\",\"by\":\"p2\"}', 'adm-m1')", NOW);
      await run("INSERT INTO admin_action (at, admin_id, member_id, action, mode, delta, before, after, reason, op_id) VALUES (?1, 'p2', 'm1', 'coins', 'grant', 7, 5, 12, 'seeded', 'adm-m1')", NOW);
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
      // QUERY gives `coins` its 400 below; this entry is the same route answering 200, where a leak would be. It runs
      // FIRST: `logout` later in the list ends the session.
      const paths = [{ method: 'GET', path: '/api/account/coins' }, ...ACCOUNT_ROUTES.map((r) => ({ method: r.method, path: pathOf(r.pattern) + (QUERY[r.pattern] ?? '') })), { method: 'GET', path: `/api/account/no/such/${REQ}` }];

      let answered = 0;
      let coins200 = 0;
      let expected = 0;
      const errors = new Set<string>();
      for (const { method, path } of paths) {
        for (const b of method === 'GET' ? bodies.slice(0, 1) : bodies) {
          expected++;
          const where = `${sc.label}: ${method} ${path} / ${b.name}`;
          const res = await h.call(method, path, { ...(method === 'GET' ? {} : b.init), cookie: sc.signedIn ? cookie : undefined, headers: { 'cf-connecting-ip': IP } });
          answered++;
          const text = await res.text();
          // The 200 call must really answer 200, or it proves nothing (a reorder behind `logout` would 401).
          if (sc.signedIn && !sc.deny && path === '/api/account/coins') {
            expect(res.status, where).toBe(200);
            coins200++;
          }
          const headers = [...res.headers].filter(([k]) => k !== 'set-cookie').map(([k, v]) => `${k}: ${v}`).join('\n');
          for (const [what, hay] of [['body', text], ['headers', headers]] as const) {
            for (const secret of [token, tokenHash, IP, REQ, ...OTHER]) expect(hay.includes(secret), `${where}: ${what} holds ${secret.slice(0, 8)}...`).toBe(false);
            expect(FAILURE_WORDS.test(hay), `${where}: ${what} reads like a failure trace`).toBe(false);
          }
          // A cookie is only ever set to a live session's own or cleared; never to anything of the request's.
          for (const c of res.headers.getSetCookie()) {
            expect(c.startsWith(`${SESSION_COOKIE}=`) || c.startsWith('__Host-rl_pre_'), where).toBe(true);
            // ...and its value is not request data, an address or another member's.
            for (const secret of [IP, REQ, ...OTHER]) expect(c.includes(secret), `${where}: set-cookie holds ${secret.slice(0, 8)}...`).toBe(false);
          }
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
      expect(coins200).toBe(sc.signedIn && !sc.deny ? 1 : 0);
      // The scenario reached the path it exists for, or it proved nothing.
      if (sc.deny) expect(errors.has('limit')).toBe(true);
      if (sc.later > 0) expect(errors.has('reauth')).toBe(true);
    });
  }

  it('GET coins is not vacuous: a signed-in member sees their own rows', async () => {
    const h = accountHarness({ now: NOW });
    const { cookie } = await seedFullMember(h.db, NOW);
    const run = (sql: string, ...v: unknown[]) => h.db.prepare(sql).bind(...v).run();
    await run("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', ?1, 'unit', -3, '{\"unitId\":\"at_team\"}', 'sp1')", NOW);
    const res = await h.call('GET', '/api/account/coins', { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { delta: number; what: { kind: string } }[]; next: string | null };
    expect(body.rows.map((r) => r.what.kind)).toEqual(['unit', 'earn']);
    expect(body.rows.map((r) => r.delta)).toEqual([-3, 5]);
    expect(body.next).toBeNull();
  });
});
