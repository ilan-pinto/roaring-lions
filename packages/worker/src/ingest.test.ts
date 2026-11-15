import { describe, it, expect } from 'vitest';
import { handleIngest } from './ingest';
import { openTestD1 } from './test-d1';
import type { Env, RateLimiter } from './d1';

const P = '0f8fad5b-d9cb-469f-a165-70867728950e';
const S = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const env0 = { v: 1, player: P, session: S, build: '0.78.0', t: 1_790_000_000_000 };
const hb = (tick: number) => ({ ...env0, type: 'heartbeat', mission: 'm1', tick });
const win = { ...env0, type: 'mission_end', mission: 'm1', result: 'victory', tick: 6000, roe: 90, fielded: 5, lost: 1, objectivesDone: 1, objectivesTotal: 1 };
const progress = { ...env0, type: 'campaign_progress', mission: 'm1', missionsWon: 3 };

function setup(limiter?: RateLimiter) {
  const db = openTestD1();
  const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('asset') }, INGEST_LIMIT: limiter };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handleIngest(
      new Request('https://game.example.workers.dev/api/events', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { origin: 'https://game.example.workers.dev', 'cf-connecting-ip': '203.0.113.9', ...headers },
      }),
      env,
      1_790_000_001_000
    );
  const count = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n;
  return { db, post, count };
}

describe('POST /api/events', () => {
  it('stops reading a body that has no Content-Length once it is over the cap (GH-1075 review)', async () => {
    // A chunked upload declares no length, so the header check cannot refuse it:
    // the reader itself must stop. Counting the chunks pulled is the witness.
    const h = setup();
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 4096) c.close(); // 64 MiB offered at most
        else c.enqueue(chunk);
      },
    });
    const req = new Request('https://game.example.workers.dev/api/events', {
      method: 'POST',
      body,
      // @ts-expect-error undici needs `duplex` for a stream body
      duplex: 'half',
      headers: { origin: 'https://game.example.workers.dev', 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(req.headers.get('content-length')).toBeNull();
    expect((await handleIngest(req, { DB: h.db, ASSETS: { fetch: async () => new Response('asset') } }, 1_790_000_001_000)).status).toBe(204);
    // 64 KiB cap = 4 chunks; a reader that stops at the cap pulls a handful, not thousands.
    expect(pulled).toBeLessThan(16);
  });

  it('stores valid events, drops invalid ones, and always answers 204', async () => {
    const h = setup();
    const res = await h.post({ events: [hb(1), { ...hb(2), email: 'x@y.z' }, hb(3)] });
    expect(res.status).toBe(204);
    expect(h.count('SELECT COUNT(*) AS n FROM events_all')).toBe(2);
  });

  it('upserts the player summary once per request', async () => {
    const h = setup();
    await h.post({ events: [hb(1), hb(2), win, progress] });
    await h.post({ events: [hb(3)] });
    const row = h.db.raw.prepare('SELECT * FROM players').get() as Record<string, unknown>;
    expect(row).toMatchObject({ player: P, seconds_played: 180, missions_won: 3, last_won: 'm1', dev: 0 });
  });

  it('never stores the IP', async () => {
    const h = setup();
    await h.post({ events: [hb(1)] });
    const dump = JSON.stringify(h.db.raw.prepare('SELECT * FROM events_all').all());
    expect(dump).not.toContain('203.0.113.9');
  });

  it('rejects a foreign origin, an oversized body and a bad shape without storing', async () => {
    const h = setup();
    expect((await h.post({ events: [hb(1)] }, { origin: 'https://evil.example' })).status).toBe(204);
    expect((await h.post('x'.repeat(70_000))).status).toBe(204);
    expect((await h.post({ events: 'nope' })).status).toBe(204);
    expect((await h.post({ events: Array.from({ length: 51 }, (_, i) => hb(i)) })).status).toBe(204);
    expect(h.count('SELECT COUNT(*) AS n FROM events_all')).toBe(0);
  });

  it('M5: rejects on a Content-Length over 64 KB before reading the body', async () => {
    const db = openTestD1();
    const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('asset') } };
    let bodyRead = false;
    const req = {
      method: 'POST',
      url: 'https://game.example.workers.dev/api/events',
      headers: new Headers({
        origin: 'https://game.example.workers.dev',
        'cf-connecting-ip': '203.0.113.9',
        'content-length': String(70_000),
      }),
      text: async () => {
        bodyRead = true;
        return JSON.stringify({ events: [hb(1)] });
      },
    } as unknown as Request;
    const res = await handleIngest(req, env, 1_790_000_001_000);
    expect(res.status).toBe(204);
    expect(bodyRead).toBe(false);
    expect((db.raw.prepare('SELECT COUNT(*) AS n FROM events_all').get() as { n: number }).n).toBe(0);
  });

  it('keys the rate limit on the connecting IP and stores nothing when limited', async () => {
    const keys: string[] = [];
    const h = setup({ limit: async ({ key }) => { keys.push(key); return { success: false }; } });
    await h.post({ events: [hb(1)] });
    expect(keys).toEqual(['203.0.113.9']);
    expect(h.count('SELECT COUNT(*) AS n FROM events_all')).toBe(0);
  });
});
