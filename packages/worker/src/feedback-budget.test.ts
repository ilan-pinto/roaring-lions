/**
 * #559 M-4: one flood must not lock feedback out for everyone. The session and
 * player limits apply only when a note names them, so before this 500
 * anonymous notes spent the global ceiling and every player got 429 for a day.
 */
import { describe, expect, it } from 'vitest';
import { handleFeedback, FEEDBACK_IP_PER_DAY, FEEDBACK_LIMITS } from './feedback-ingest';
import { openTestD1 } from './test-d1';
import type { Env } from './d1';

const ORIGIN = 'https://game.example.workers.dev';
const NOW = 1_790_000_000_000;
const META = { v: 1, t: NOW - 5000, source: 'menu', category: 'idea', text: 'spam', build: '0.122.0', context: {} };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const post = (meta: unknown, ip: string) => {
  const f = new FormData();
  f.set('meta', JSON.stringify(meta));
  return new Request(`${ORIGIN}/api/feedback`, { method: 'POST', body: f, headers: { origin: ORIGIN, 'cf-connecting-ip': ip } });
};

describe('#559 M-4: feedback budgets', () => {
  it('anonymous notes stop at their own ceiling, and a player who names itself still gets through', async () => {
    const db = openTestD1();
    const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') } };
    let created = 0;
    for (let i = 0; i < 500; i++) if ((await handleFeedback(post(META, `198.51.100.${i % 250}`), env, NOW + i)).status === 201) created++;
    expect(created).toBe(FEEDBACK_LIMITS.anonymous.max);
    const legit = await handleFeedback(post({ ...META, text: 'a real bug', player: '0f8fad5b-d9cb-469f-a165-70867728950e', session: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }, '203.0.113.50'), env, NOW + 1000);
    expect(legit.status).toBe(201);
  });

  it('one address is held to FEEDBACK_IP_PER_DAY notes a day however many ids it invents, and never stored', async () => {
    const db = openTestD1();
    const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: 'ticket-secret' };
    const statuses: number[] = [];
    for (let i = 0; i < FEEDBACK_IP_PER_DAY + 3; i++) {
      statuses.push((await handleFeedback(post({ ...META, player: uuid(i), session: uuid(1000 + i) }, '198.51.100.7'), env, NOW + i)).status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(FEEDBACK_IP_PER_DAY);
    expect(statuses.slice(FEEDBACK_IP_PER_DAY)).toEqual([429, 429, 429]);
    expect(JSON.stringify(db.raw.prepare('SELECT * FROM rate_day').all())).not.toContain('198.51.100.7');
    expect((await handleFeedback(post({ ...META, player: uuid(99) }, '203.0.113.1'), env, NOW + 50)).status).toBe(201);
    // The next UTC day, the address has a fresh budget.
    expect((await handleFeedback(post({ ...META, player: uuid(98) }, '198.51.100.7'), env, NOW + 86_400_000)).status).toBe(201);
  });

  it('a note refused by another limit spends nothing of its address\'s day', async () => {
    const db = openTestD1();
    const env: Env = { DB: db, ASSETS: { fetch: async () => new Response('') }, TICKET_SECRET: 'ticket-secret' };
    const session = uuid(7);
    for (let i = 0; i < FEEDBACK_LIMITS.session.max + 5; i++) await handleFeedback(post({ ...META, session }, '198.51.100.7'), env, NOW + i);
    const row = db.raw.prepare("SELECT n FROM rate_day WHERE scope = 'feedback-ip'").get() as { n: number };
    expect(row.n).toBe(FEEDBACK_LIMITS.session.max);
  });
});
