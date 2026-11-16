// GH-1417 S3: a player's report of the other player's chat, through POST /api/feedback. The twin and the schema agree on the shape
// (`feedback-meta.test.ts`); this holds what the Worker does with it: it stores it, limits it (5 a session in 10 minutes), closes with
// the feedback switch, never makes it a GitHub issue link, and refuses every id a report must not carry.
import { describe, expect, it } from 'vitest';
import { handleFeedback } from './feedback-ingest';
import { applyFeedbackAction, feedbackDetail, setFeedbackOpen } from './feedback-triage';
import { openReportD1, migrationsAcceptReports } from './test-d1-reports';
import type { Env } from './d1';

const ORIGIN = 'https://game.example.workers.dev';
const NOW = 1_790_000_000_000;
const MIN = 60_000;
const S1 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const S2 = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const PLAYER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const REPORT = {
  v: 1,
  t: NOW - 3000,
  source: 'match',
  category: 'report',
  text: 'He kept at it all match.',
  build: '0.133.11',
  session: S1,
  map: 'wadi_tarfan',
  context: { lines: ['1: you are rubbish', '0: gg', '1: report me then'], seat: 0, reported_seat: 1, reason: 'abuse', reported_public_id: 'K7M4Q2XW' },
};

function setup() {
  const db = openReportD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
  const post = (meta: unknown, now = NOW, extra: (f: FormData) => void = () => undefined, headers: Record<string, string> = {}) => {
    const f = new FormData();
    f.set('meta', JSON.stringify(meta));
    extra(f);
    return handleFeedback(new Request(`${ORIGIN}/api/feedback`, { method: 'POST', body: f, headers: { origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9', ...headers } }), env, now);
  };
  const rows = () => db.raw.prepare('SELECT * FROM feedback ORDER BY id').all() as Record<string, unknown>[];
  return { db, env, post, rows };
}
const err = async (r: Response) => (await r.json()) as { error?: string; retryAfter?: number };

describe('the test database', () => {
  it('accepts the report category: the real migration, or the fixture standing in for it until then', () => {
    const h = setup();
    expect(() =>
      h.db.raw.prepare(`INSERT INTO feedback (received_at, t, build, source, category, text, context, updated_at) VALUES (1, 1, '0.1.0', 'match', 'report', '', '{}', 1)`).run()
    ).not.toThrow();
    expect(typeof migrationsAcceptReports()).toBe('boolean');
  });
});

describe('POST /api/feedback with a report', () => {
  it('stores it as new, with the reporter\'s session and the evidence in context, and no tester, contact or player', async () => {
    const h = setup();
    const res = await h.post(REPORT);
    expect(res.status).toBe(201);
    const [row] = h.rows();
    expect(row).toMatchObject({ source: 'match', category: 'report', status: 'new', session: S1, player: null, tester: null, contact: null, map: 'wadi_tarfan', text: 'He kept at it all match.' });
    expect(JSON.parse(row.context as string)).toEqual(REPORT.context);
  });

  it('a report with no note and no session (an opt-out) is stored and read as a report', async () => {
    const h = setup();
    const res = await h.post({ ...REPORT, text: '', session: undefined });
    expect(res.status).toBe(201);
    expect(h.rows()[0]).toMatchObject({ category: 'report', text: '', session: null });
  });

  it.each([
    ['a tester label', { tester: 'dana' }, 'tester'],
    ['a contact', { contact: 'dana on Discord' }, 'contact'],
    ['the persistent player id', { player: PLAYER }, 'player'],
    ['a room code in the context', { context: { ...REPORT.context, room_code: 'ABC234' } }, 'context key'],
    ['no lines', { context: { ...REPORT.context, lines: [] } }, 'context.lines'],
    ['a persistent anonymous id as the reported id', { context: { ...REPORT.context, reported_public_id: PLAYER } }, 'context.reported_public_id'],
    ['the pause source', { source: 'pause' }, 'category does not match source'],
  ])('refuses %s with 400 "%s" and stores nothing', async (_n, patch, why) => {
    const h = setup();
    const res = await h.post({ ...REPORT, ...patch });
    expect(res.status).toBe(400);
    expect((await err(res)).error).toBe(why);
    expect(h.rows()).toEqual([]);
  });

  it('refuses a picture and a replay with a report: only the pause form sends those', async () => {
    const h = setup();
    const png = new Uint8Array(64);
    png.set(new TextEncoder().encode('RIFF'), 0);
    png.set(new TextEncoder().encode('WEBP'), 8);
    const shot = await h.post(REPORT, NOW, (f) => f.set('shot', new Blob([png], { type: 'image/webp' }), 'shot.webp'));
    expect(shot.status).toBe(400);
    const replay = await h.post(REPORT, NOW, (f) => f.set('replay', new Blob(['{}'], { type: 'application/json' }), 'replay.json'));
    expect(replay.status).toBe(400);
    expect(h.rows()).toEqual([]);
  });

  it('is closed by the feedback switch (410) and by a foreign origin (403)', async () => {
    const h = setup();
    expect((await h.post(REPORT, NOW, () => undefined, { origin: 'https://evil.example' })).status).toBe(403);
    await setFeedbackOpen(h.db, false, NOW);
    expect((await h.post(REPORT)).status).toBe(410);
    expect(h.rows()).toEqual([]);
  });
});

describe('the report limit (the lead\'s D7): 5 a session in 10 minutes', () => {
  it('the sixth report from one session inside the window is 429 with a retry time, and a different session is not affected', async () => {
    const h = setup();
    for (let i = 0; i < 5; i++) expect((await h.post(REPORT, NOW + i * 1000)).status, `report ${i + 1}`).toBe(201);
    const sixth = await h.post(REPORT, NOW + 5000);
    expect(sixth.status).toBe(429);
    const wait = (await err(sixth)).retryAfter ?? 0;
    // the oldest of the five was at NOW, so the window frees it at NOW + 10 min: 595 s after the sixth try
    expect(wait).toBe(595);
    expect((await h.post({ ...REPORT, session: S2 }, NOW + 5000)).status).toBe(201);
    expect(h.rows()).toHaveLength(6);
  });

  it('the window moves: ten minutes after the oldest, a report is accepted again', async () => {
    const h = setup();
    for (let i = 0; i < 5; i++) await h.post(REPORT, NOW + i * 1000);
    expect((await h.post(REPORT, NOW + 10 * MIN - 1)).status).toBe(429);
    expect((await h.post(REPORT, NOW + 10 * MIN + 1)).status).toBe(201);
  });

  it('ordinary notes from the session do not spend its five, and reports do not leave it unable to send a note', async () => {
    const h = setup();
    const note = { v: 1, t: NOW, source: 'pause', category: 'idea', text: 'x', build: '0.133.11', session: S1, context: {} };
    for (let i = 0; i < 4; i++) expect((await h.post(note, NOW + i)).status).toBe(201);
    for (let i = 0; i < 5; i++) expect((await h.post(REPORT, NOW + 10 + i)).status, `report ${i + 1}`).toBe(201);
    // ten in the hour is the general limit: nine rows so far, so one more note is the tenth and a further one is refused by THAT limit
    expect((await h.post(note, NOW + 100)).status).toBe(201);
    expect((await h.post(note, NOW + 101)).status).toBe(429);
  });

  it('reports with no session share a smaller ceiling of 20 in 10 minutes, and do not count toward any session\'s five', async () => {
    const h = setup();
    const anon = { ...REPORT, session: undefined };
    for (let i = 0; i < 20; i++) expect((await h.post(anon, NOW + i, () => undefined, { 'cf-connecting-ip': `198.51.100.${i + 1}` })).status, `anonymous ${i + 1}`).toBe(201);
    expect((await h.post(anon, NOW + 30, () => undefined, { 'cf-connecting-ip': '198.51.100.99' })).status).toBe(429);
    expect((await h.post(REPORT, NOW + 31)).status).toBe(201);
  });
});

describe('triage: a report is read on /stats and never filed as a GitHub issue', () => {
  it('its detail carries the evidence and no issue link, and the file and issue actions answer 409', async () => {
    const h = setup();
    await h.post(REPORT);
    const d = await feedbackDetail(h.env, 1, ORIGIN);
    expect(d?.category).toBe('report');
    expect(d?.issue).toEqual({ url: '', title: '', body: '', truncated: false });
    expect(d?.context).toEqual(REPORT.context);
    for (const action of [{ action: 'file' }, { action: 'file', issue: 12 }, { action: 'issue', issue: 12 }]) {
      const r = await applyFeedbackAction(h.env, 1, action, NOW);
      expect(r).toEqual({ ok: false, code: 409, error: 'a report is never filed as a GitHub issue' });
    }
    expect(h.rows()[0].status).toBe('new');
  });

  it('the lead can still triage, dismiss, note and delete it', async () => {
    const h = setup();
    await h.post(REPORT);
    expect((await applyFeedbackAction(h.env, 1, { action: 'triage' }, NOW))).toMatchObject({ ok: true, status: 'triaged' });
    expect((await applyFeedbackAction(h.env, 1, { action: 'note', note: 'read it' }, NOW))).toMatchObject({ ok: true });
    expect((await applyFeedbackAction(h.env, 1, { action: 'delete' }, NOW))).toMatchObject({ ok: true, status: 'deleted' });
    expect(h.rows()).toEqual([]);
  });

  it('an ordinary note still gets its issue link (the refusal is for reports alone)', async () => {
    const h = setup();
    await h.post({ v: 1, t: NOW, source: 'pause', category: 'idea', text: 'more routes', build: '0.133.11', context: {} });
    const d = await feedbackDetail(h.env, 1, ORIGIN);
    expect(d?.issue.url).toContain('https://github.com/');
  });
});
