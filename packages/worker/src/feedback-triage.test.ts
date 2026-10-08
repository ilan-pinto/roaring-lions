import { describe, it, expect } from 'vitest';
import { handleStats } from './stats';
import { handleIngest } from './ingest';
import { handleFeedback } from './feedback-ingest';
import {
  applyFeedbackAction,
  FEEDBACK_STATUSES,
  TRANSITIONS,
  purgeExpired,
  ANONYMOUS,
  NO_MISSION,
  type FeedbackStatus,
} from './feedback-triage';
import { FEEDBACK_HTML } from './feedback-page';
import { STATS_HTML } from './stats-page';
import { openTestD1 } from './test-d1';
import { openTestR2 } from './test-r2';
import { signSession, SESSION_COOKIE } from './auth';
import type { Env } from './d1';

const ORIGIN = 'https://g.dev';
const RETENTION_MS = 180 * 86_400_000; // spec §7, a literal on purpose
const NOW = 1_790_000_000_000;
const SECRET = 'correct horse battery staple';
const P = '0f8fad5b-d9cb-469f-a165-70867728950e';
const S = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const S2 = '7c9e6679-7425-40de-944b-e07fc1f90ae8';
const WEBP = (() => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode('RIFF'), 0);
  b.set(new TextEncoder().encode('WEBP'), 8);
  return b;
})();
const META = {
  v: 1, t: NOW - 60_000, source: 'pause', category: 'bug', text: 'Walked to the far wall.', build: '0.122.0', commit: '41bc520b',
  player: P, session: S, tester: 'dana', contact: undefined, mission: 'beit_sahwan_2_foothold', tick: 467,
  context: { renderer: 'three', gpu: 'ANGLE Metal', feed: ['Contact east'] },
};

async function setup() {
  const db = openTestD1();
  const r2 = openTestR2();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') }, FEEDBACK_BLOBS: r2, STATS_PASSWORD: SECRET };
  const cookie = `${SESSION_COOKIE}=${await signSession(SECRET, NOW + 3_600_000)}`;
  const send = async (meta: Record<string, unknown>, attach = true) => {
    const f = new FormData();
    f.set('meta', JSON.stringify(meta));
    if (attach) {
      f.set('shot', new Blob([WEBP], { type: 'image/webp' }));
      if (meta.category === 'bug') f.set('replay', new Blob([JSON.stringify({ commands: [1, 2, 3], hash: '0x5e21', tick: 467 })]));
    }
    const res = await handleFeedback(new Request(`${ORIGIN}/api/feedback`, { method: 'POST', body: f, headers: { origin: ORIGIN } }), env, NOW);
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: number }).id;
  };
  const req = (path: string, init: RequestInit & { auth?: boolean } = {}) => {
    const headers = new Headers(init.headers);
    if (init.auth !== false) headers.set('cookie', cookie);
    return handleStats(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, NOW);
  };
  const act = (id: number, body: unknown, headers: Record<string, string> = {}) =>
    req(`/stats/api/feedback/${id}`, { method: 'POST', body: JSON.stringify(body), headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers } });
  const status = (id: number) => (db.raw.prepare('SELECT status FROM feedback WHERE id = ?').get(id) as { status: string } | undefined)?.status;
  return { db, r2, env, cookie, send, req, act, status };
}

/** Every route this change adds under /stats, as [method, path]. */
const ROUTES: [string, string][] = [
  ['GET', '/stats/feedback'],
  ['GET', '/stats/feedback/1'],
  ['GET', '/stats/api/feedback'],
  ['GET', '/stats/api/feedback?status=new&tester=dana'],
  ['GET', '/stats/api/feedback/count'],
  ['GET', '/stats/api/feedback/1'],
  ['GET', '/stats/api/feedback/1/shot'],
  ['GET', '/stats/api/feedback/1/shot?download=1'],
  ['GET', '/stats/api/feedback/1/replay'],
  ['POST', '/stats/api/feedback/1'],
  ['GET', '/stats/api/feedback/switch'],
  ['POST', '/stats/api/feedback/switch'],
];

describe('/stats/feedback: auth on every route', () => {
  it('signed out, every route is the login page (pages) or 401 (API), and nothing changes', async () => {
    const h = await setup();
    const id = await h.send(META);
    for (const [method, path] of ROUTES) {
      const body = method === 'POST' ? JSON.stringify(path.endsWith('switch') ? { open: false } : { action: 'delete' }) : undefined;
      const res = await h.req(path, { method, body, auth: false, headers: { origin: ORIGIN, 'content-type': 'application/json' } });
      const text = await res.text();
      if (path.startsWith('/stats/api/')) {
        expect([path, res.status]).toEqual([path, 401]);
        expect(text).not.toContain('RIFF');
      } else {
        expect([path, res.status]).toEqual([path, 200]);
        expect(text).toContain('action="/stats/login"');
        expect(text).not.toContain('fb-list');
      }
    }
    expect(h.status(id)).toBe('new');
    expect(h.r2.objects.size).toBe(2);
    expect(await (await handleFeedback(new Request(`${ORIGIN}/api/feedback`), h.env, NOW)).json()).toEqual({ open: true });
  });

  it('a forged or expired cookie is treated as signed out on the picture route', async () => {
    const h = await setup();
    await h.send(META);
    const forged = `${SESSION_COOKIE}=${await signSession('wrong secret', NOW + 3_600_000)}`;
    const expired = `${SESSION_COOKIE}=${await signSession(SECRET, NOW - 1)}`;
    for (const cookie of [forged, expired]) {
      expect((await h.req('/stats/api/feedback/1/shot', { auth: false, headers: { cookie } })).status).toBe(401);
    }
  });

  it('with no STATS_PASSWORD every route is 403', async () => {
    const h = await setup();
    h.env.STATS_PASSWORD = undefined;
    for (const [method, path] of ROUTES) expect((await h.req(path, { method })).status).toBe(403);
  });

  it('signed in, the page and the picture are served, with a CSP on the page and nosniff on the picture', async () => {
    const h = await setup();
    const id = await h.send(META);
    const page = await h.req(`/stats/feedback/${id}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="fb-list"');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const shot = await h.req(`/stats/api/feedback/${id}/shot`);
    expect(shot.status).toBe(200);
    expect(shot.headers.get('content-type')).toBe('image/webp');
    expect(shot.headers.get('x-content-type-options')).toBe('nosniff');
    expect(shot.headers.get('content-disposition')).toBe('inline; filename="FB-0001.webp"');
    expect(new Uint8Array(await shot.arrayBuffer())).toEqual(WEBP);
    const dl = await h.req(`/stats/api/feedback/${id}/shot?download=1`);
    expect(dl.headers.get('content-disposition')).toBe('attachment; filename="FB-0001.webp"');
    const replay = await h.req(`/stats/api/feedback/${id}/replay`);
    expect(replay.headers.get('content-type')).toBe('application/json');
    expect(replay.headers.get('content-disposition')).toBe('attachment; filename="FB-0001-replay.json"');
  });

  it('a note with no picture answers 404 on the picture route, and an unknown id 404 everywhere', async () => {
    const h = await setup();
    const id = await h.send({ ...META, category: 'idea' }, false);
    expect((await h.req(`/stats/api/feedback/${id}/shot`)).status).toBe(404);
    expect((await h.req('/stats/api/feedback/99')).status).toBe(404);
    expect((await h.req('/stats/api/feedback/99/shot')).status).toBe(404);
    expect((await h.act(99, { action: 'triage' })).status).toBe(404);
  });
});

describe('/stats/api/feedback: list, filters, badge and detail', () => {
  async function seeded() {
    const h = await setup();
    await h.send(META); // 1 dana bug foothold
    await h.send({ ...META, category: 'balance', mission: 'tel_marum_2_foothold' }, false); // 2 dana
    const anon = { ...META, player: undefined, session: undefined, tester: undefined };
    await h.send({ ...anon, source: 'menu', category: 'idea', mission: undefined, tick: undefined }, false); // 3 anonymous, menu
    await h.send({ ...META, source: 'debrief', category: 'rating', rating: 2, text: '', session: S2 }, false); // 4 dana rating
    await h.act(2, { action: 'triage' });
    return h;
  }
  const list = async (h: Awaited<ReturnType<typeof setup>>, q = '') =>
    (await (await h.req(`/stats/api/feedback${q}`)).json()) as {
      rows: { id: number; who: string; session: string | null; status: string; shot: boolean; replay: boolean }[];
      counts: Record<string, number>;
      testers: string[];
      missions: string[];
      open: boolean;
    };

  it('lists newest first with counts per status, the filter options and the switch state', async () => {
    const h = await seeded();
    const j = await list(h);
    expect(j.rows.map((r) => r.id)).toEqual([4, 3, 2, 1]);
    expect(j.counts).toEqual({ new: 3, triaged: 1, filed: 0, dismissed: 0, all: 4 });
    expect(j.testers).toEqual(['dana']);
    expect(j.missions).toEqual(['beit_sahwan_2_foothold', 'tel_marum_2_foothold']);
    expect(j.open).toBe(true);
    expect(j.rows.find((r) => r.id === 1)).toMatchObject({ shot: true, replay: true, who: 'dana' });
  });

  it('an untagged player shows as "anonymous" with no session when opted out', async () => {
    const h = await seeded();
    expect((await list(h)).rows.find((r) => r.id === 3)).toMatchObject({ who: 'anonymous', session: null });
  });

  it('filters by status, tester (and anonymous), mission (and none) and kind', async () => {
    const h = await seeded();
    const ids = async (q: string) => (await list(h, q)).rows.map((r) => r.id);
    expect(await ids('?status=triaged')).toEqual([2]);
    expect(await ids('?status=new&tester=dana')).toEqual([4, 1]);
    expect(await ids(`?tester=${encodeURIComponent(ANONYMOUS)}`)).toEqual([3]);
    expect(await ids('?mission=tel_marum_2_foothold')).toEqual([2]);
    expect(await ids(`?mission=${encodeURIComponent(NO_MISSION)}`)).toEqual([3]);
    expect(await ids('?kind=rating')).toEqual([4]);
    expect((await list(h, '?tester=dana')).counts).toEqual({ new: 2, triaged: 1, filed: 0, dismissed: 0, all: 3 });
  });

  it('the badge counts only new rows', async () => {
    const h = await seeded();
    expect(await (await h.req('/stats/api/feedback/count')).json()).toEqual({ new: 3 });
  });

  it('the detail joins the session timeline from events (that session only) with the feedback rows of that session', async () => {
    const h = await setup();
    const ev = (session: string, t: number, extra: Record<string, unknown>) => ({ v: 1, player: P, session, build: '0.122.0', t, ...extra });
    await handleIngest(
      new Request(`${ORIGIN}/api/events`, {
        method: 'POST',
        body: JSON.stringify({
          events: [
            ev(S, NOW - 300_000, { type: 'mission_start', mission: 'beit_sahwan_2_foothold', replay: false }),
            ev(S, NOW - 200_000, { type: 'mission_end', mission: 'beit_sahwan_2_foothold', result: 'defeat', tick: 900, roe: 90, fielded: 9, lost: 9, objectivesDone: 0, objectivesTotal: 2 }),
            ev(S2, NOW - 100_000, { type: 'mission_start', mission: 'tel_marum_1_recon', replay: false }),
          ],
        }),
      }),
      h.env,
      NOW
    );
    const id = await h.send(META);
    const d = (await (await h.req(`/stats/api/feedback/${id}`)).json()) as {
      timeline: { type: string; result: string | null; mission: string | null }[];
      replay: { commands: number; hash: string; tick: number; bytes: number };
      issue: { url: string; truncated: boolean };
      who: string;
      player: string;
      transitions: string[];
      context: Record<string, unknown>;
    };
    expect(d.timeline.map((e) => [e.type, e.result])).toEqual([
      ['mission_start', null],
      ['mission_end', 'defeat'],
      ['feedback', 'FB-0001'],
    ]);
    expect(d.replay).toMatchObject({ commands: 3, hash: '0x5e21', tick: 467 });
    expect(d.who).toBe('dana');
    expect(d.player).toBe(P.slice(0, 8));
    expect(d.transitions).toEqual(['triaged', 'filed', 'dismissed']);
    expect(d.context).toEqual(META.context);
    expect(decodeURIComponent(d.issue.url)).not.toContain('dana');
  });

  it('an anonymous note has an empty timeline', async () => {
    const h = await setup();
    const anon = { ...META, player: undefined, session: undefined, tester: undefined };
    const id = await h.send(anon, false);
    const d = (await (await h.req(`/stats/api/feedback/${id}`)).json()) as { timeline: unknown[]; who: string };
    expect(d).toMatchObject({ timeline: [], who: 'anonymous' });
  });
});

describe('status transitions', () => {
  const ACTION_FOR: Record<FeedbackStatus, Record<string, unknown>> = {
    new: { action: 'reopen' },
    triaged: { action: 'triage' },
    filed: { action: 'file' },
    dismissed: { action: 'dismiss' },
  };

  it('every from -> to pair is allowed exactly when TRANSITIONS says so (or it is a no-op)', async () => {
    for (const from of FEEDBACK_STATUSES) {
      for (const to of FEEDBACK_STATUSES) {
        const h = await setup();
        const id = await h.send(META, false);
        h.db.raw.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(from, id);
        const res = await applyFeedbackAction(h.env, id, ACTION_FOR[to], NOW);
        const allowed = from === to || TRANSITIONS[from].includes(to);
        expect([from, to, res.ok]).toEqual([from, to, allowed]);
        expect(h.status(id)).toBe(allowed ? to : from);
        if (!res.ok) expect(res.code).toBe(409);
      }
    }
  });

  it('the table itself: filed only steps back to triaged, and nothing moves to an unknown status', () => {
    expect(TRANSITIONS).toEqual({
      new: ['triaged', 'filed', 'dismissed'],
      triaged: ['new', 'filed', 'dismissed'],
      filed: ['triaged'],
      dismissed: ['new', 'triaged'],
    });
  });

  it('over HTTP: triage, then a refused jump answers 409 and changes nothing', async () => {
    const h = await setup();
    const id = await h.send(META, false);
    expect(await (await h.act(id, { action: 'file', issue: 512 })).json()).toEqual({ status: 'filed' });
    expect(h.db.raw.prepare('SELECT issue FROM feedback WHERE id = ?').get(id)).toEqual({ issue: 512 });
    const res = await h.act(id, { action: 'dismiss' });
    expect(res.status).toBe(409);
    expect(h.status(id)).toBe('filed');
  });

  it('"Filed as issue #" files a new row and records the number; a bad number is 400', async () => {
    const h = await setup();
    const id = await h.send(META, false);
    for (const issue of [0, -1, 1.5, '12', 10_000_001]) expect((await h.act(id, { action: 'issue', issue })).status).toBe(400);
    expect(h.status(id)).toBe('new');
    expect((await h.act(id, { action: 'issue', issue: 77 })).status).toBe(200);
    expect(h.db.raw.prepare('SELECT status, issue FROM feedback WHERE id = ?').get(id)).toEqual({ status: 'filed', issue: 77 });
  });

  it('the private note saves at any status, and an empty one clears it', async () => {
    const h = await setup();
    const id = await h.send(META, false);
    await h.act(id, { action: 'dismiss' });
    expect((await h.act(id, { action: 'note', note: 'dup of #12' })).status).toBe(200);
    expect(h.db.raw.prepare('SELECT note, status FROM feedback WHERE id = ?').get(id)).toEqual({ note: 'dup of #12', status: 'dismissed' });
    await h.act(id, { action: 'note', note: '  ' });
    expect(h.db.raw.prepare('SELECT note FROM feedback WHERE id = ?').get(id)).toEqual({ note: null });
    expect((await h.act(id, { action: 'note', note: 'x'.repeat(2001) })).status).toBe(400);
    expect((await h.act(id, { action: 'shred' })).status).toBe(400);
  });

  it('delete removes the row and its R2 objects; an R2 failure keeps the row so it can be retried', async () => {
    const h = await setup();
    const id = await h.send(META);
    expect(h.r2.objects.size).toBe(2);
    h.r2.fail.delete = true;
    expect((await h.act(id, { action: 'delete' })).status).toBe(503);
    expect(h.status(id)).toBe('new');
    h.r2.fail.delete = false;
    expect(await (await h.act(id, { action: 'delete' })).json()).toEqual({ status: 'deleted' });
    expect(h.status(id)).toBeUndefined();
    expect(h.r2.objects.size).toBe(0);
  });

  it('a mutation from another origin, with no origin, or not as JSON is refused', async () => {
    const h = await setup();
    const id = await h.send(META, false);
    expect((await h.act(id, { action: 'dismiss' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await h.req(`/stats/api/feedback/${id}`, { method: 'POST', body: '{"action":"dismiss"}', headers: { 'content-type': 'application/json' } })).status).toBe(403);
    expect((await h.act(id, { action: 'dismiss' }, { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect(h.status(id)).toBe('new');
  });
});

describe('the kill switch from /stats/feedback', () => {
  it('POST /switch closes and reopens the public endpoint', async () => {
    const h = await setup();
    const post = (open: boolean) =>
      h.req('/stats/api/feedback/switch', { method: 'POST', body: JSON.stringify({ open }), headers: { origin: ORIGIN, 'content-type': 'application/json' } });
    expect(await (await post(false)).json()).toEqual({ open: false });
    const f = new FormData();
    f.set('meta', JSON.stringify(META));
    expect((await handleFeedback(new Request(`${ORIGIN}/api/feedback`, { method: 'POST', body: f, headers: { origin: ORIGIN } }), h.env, NOW)).status).toBe(410);
    expect(await (await post(true)).json()).toEqual({ open: true });
    expect((await h.req('/stats/api/feedback/switch', { method: 'POST', body: '{"open":"no"}', headers: { origin: ORIGIN, 'content-type': 'application/json' } })).status).toBe(400);
  });

  it('the env half wins: reopening the D1 flag does not open what FEEDBACK_CLOSED closed', async () => {
    const h = await setup();
    h.env.FEEDBACK_CLOSED = '1';
    const res = await h.req('/stats/api/feedback/switch', { method: 'POST', body: JSON.stringify({ open: true }), headers: { origin: ORIGIN, 'content-type': 'application/json' } });
    expect(await res.json()).toEqual({ open: false });
  });
});

describe('retention: the daily purge', () => {
  it('drops the picture, replay and contact after 180 days and keeps the note; newer rows are untouched', async () => {
    const h = await setup();
    const old = await h.send({ ...META, tester: undefined, contact: 'me@x.io' });
    const fresh = await h.send(META);
    h.db.raw.prepare('UPDATE feedback SET received_at = ? WHERE id = ?').run(NOW - RETENTION_MS - 1, old);
    expect(await purgeExpired(h.env, NOW)).toBe(1);
    expect(h.db.raw.prepare('SELECT shot_key, log_key, contact, text FROM feedback WHERE id = ?').get(old)).toEqual({
      shot_key: null, log_key: null, contact: null, text: META.text,
    });
    expect(h.r2.objects.size).toBe(2); // the fresh row's two
    expect((h.db.raw.prepare('SELECT shot_key FROM feedback WHERE id = ?').get(fresh) as { shot_key: string | null }).shot_key).not.toBeNull();
    expect(await purgeExpired(h.env, NOW)).toBe(0);
  });

  it('a row at exactly 180 days is kept', async () => {
    const h = await setup();
    const id = await h.send(META);
    h.db.raw.prepare('UPDATE feedback SET received_at = ? WHERE id = ?').run(NOW - RETENTION_MS, id);
    expect(await purgeExpired(h.env, NOW)).toBe(0);
  });
});

describe('the pages', () => {
  /** Lifts the page's own render functions out of its script and runs them. */
  function renderers() {
    const grab = (re: RegExp): string => {
      const m = FEEDBACK_HTML.match(re);
      expect(m).not.toBeNull();
      return m![0];
    };
    const src = [
      grab(/const esc=\([\s\S]*?\);\n/),
      grab(/const when=\([\s\S]*?\);\n/),
      grab(/const clock=\([\s\S]*?\};\n/),
      grab(/function who\(r\)\{[\s\S]*?\}\n/),
      grab(/function kindTag\(c\)\{[\s\S]*?\}\n/),
      'let openId=null;\n',
      grab(/function listRow\(r\)\{[\s\S]*?\n\}\n/),
      grab(/function kvRow\(k,v\)\{[\s\S]*?\}\n/),
      grab(/function ctxValue\(v\)\{[\s\S]*?\n\}\n/),
      grab(/function contextRows\(d\)\{[\s\S]*?\n\}\n/),
      grab(/function timelineRow\(e\)\{[\s\S]*?\}\n/),
      grab(/function detailHtml\(d\)\{[\s\S]*?\n\}\n/),
    ].join('');
    return new Function(`${src}; return { listRow, detailHtml };`)() as {
      listRow: (r: unknown) => string;
      detailHtml: (d: unknown) => string;
    };
  }
  const EVIL = '<img src=x onerror=alert(1)>"\'';

  it('every value the public sent is escaped in the list row and the detail', () => {
    const { listRow, detailHtml } = renderers();
    const row = listRow({ id: 1, ref: 'FB-0001', receivedAt: NOW, tester: EVIL, session: EVIL, category: EVIL, mission: EVIL, rating: null, snippet: EVIL, shot: true, replay: false, status: 'new', issue: null, dev: false });
    expect(row).not.toContain('<img');
    const html = detailHtml({
      id: 1, ref: 'FB-0001', receivedAt: NOW, who: EVIL, tester: EVIL, player: EVIL, session: EVIL, contact: EVIL, build: '0.1.0', commit: EVIL,
      source: 'pause', category: EVIL, rating: null, text: EVIL, mission: EVIL, tick: 40, status: 'new', transitions: ['triaged'], issueNumber: null,
      note: EVIL, context: { [EVIL]: EVIL, feed: [EVIL], nested: { a: EVIL } }, shot: true, replay: { bytes: 2048, commands: 3, hash: EVIL, tick: 3 },
      issue: { title: EVIL, body: EVIL, url: 'https://github.com/x', truncated: false }, timeline: [{ t: NOW, type: EVIL, mission: EVIL, result: EVIL }],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  });

  it('the /stats header links to the feedback view and shows the "N new" badge from its own guarded fetch', () => {
    expect(STATS_HTML).toContain('<a href="/stats/feedback">Feedback<span class="badge" id="fb-new"></span></a>');
    expect(STATS_HTML).toMatch(/fetch\('\/stats\/api\/feedback\/count'\)[^\n]*\.catch\(\(\)=>\{\}\)/);
  });
});
